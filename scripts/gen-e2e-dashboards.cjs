#!/usr/bin/env node
/* Create or update one Lovelace dashboard for every generated E2E profile. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE = path.resolve(__dirname, '..');
const CARD_URL = '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js';

function parseEnvFile(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(
    fs.readFileSync(filename, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

function envKeyForSlug(slug, suffix) {
  return `TEST_${slug.toUpperCase()}_${suffix}`;
}

function dashboardPathForSlug(slug) {
  return `e2e-${slug.replaceAll('_', '-')}`;
}

function buildDashboardStages(manifest) {
  return manifest.profiles.map(({ slug, name, profile }) => ({
    profile,
    slug,
    title: name,
    urlPath: dashboardPathForSlug(slug),
    growspaceEnvKey: envKeyForSlug(slug, 'GROWSPACE_ID'),
    dashboardEnvKey: envKeyForSlug(slug, 'DASHBOARD_PATH'),
  }));
}

function buildDashboardConfig(title, growspaceId) {
  return {
    views: [{
      title,
      type: 'sections',
      max_columns: 4,
      sections: [{
        type: 'grid',
        cards: [{
          type: 'custom:growspace-manager-card',
          default_growspace: growspaceId,
          grid_options: { rows: 4 },
        }],
      }],
    }],
  };
}

function messageError(message) {
  return JSON.stringify(message.error || message);
}

async function syncDashboards({ send, env, stages, log = console.log }) {
  const missing = stages.filter((stage) => !env[stage.growspaceEnvKey]);
  if (missing.length > 0) {
    throw new Error(missing.map((stage) => `${stage.profile}/${stage.slug}: ${stage.growspaceEnvKey} is empty`).join('\n'));
  }
  const existing = await send({ type: 'lovelace/dashboards/list' });
  if (!existing.success) throw new Error(`Could not list dashboards: ${messageError(existing)}`);
  const have = new Set((existing.result || []).map((dashboard) => dashboard.url_path));
  log('  existing dashboards:', [...have].join(', ') || '(none)');

  for (const stage of stages) {
    const growspaceId = env[stage.growspaceEnvKey];
    if (!have.has(stage.urlPath)) {
      const created = await send({
        type: 'lovelace/dashboards/create',
        url_path: stage.urlPath,
        title: stage.title,
        show_in_sidebar: false,
        require_admin: false,
      });
      if (!created.success) {
        throw new Error(`${stage.profile}/${stage.slug}: could not create ${stage.urlPath}: ${messageError(created)}`);
      }
      have.add(stage.urlPath);
      log(`  created dashboard ${stage.urlPath}`);
    } else {
      log(`  dashboard ${stage.urlPath} already exists`);
    }

    const saved = await send({
      type: 'lovelace/config/save',
      url_path: stage.urlPath,
      config: buildDashboardConfig(stage.title, growspaceId),
    });
    if (!saved.success) {
      throw new Error(`${stage.profile}/${stage.slug}: could not save ${stage.urlPath}: ${messageError(saved)}`);
    }
    log(`    config saved: ok -> growspace ${growspaceId.slice(0, 8)}`);
  }
}

function resourcePath(url) {
  try {
    return new URL(url, 'http://home-assistant.local').pathname;
  } catch {
    return url.split('?', 1)[0];
  }
}

async function ensureCardResource({ send, cardUrl = CARD_URL, log = console.log }) {
  const listed = await send({ type: 'lovelace/resources' });
  if (!listed.success) throw new Error(`Could not list Lovelace resources: ${messageError(listed)}`);
  const matches = (listed.result || []).filter(
    (resource) => resourcePath(resource.url) === resourcePath(cardUrl),
  );
  if (matches.length > 1) {
    // Older versions compared the complete URL, so a stamped `?v=` resource
    // looked different and could be registered a second time. Keep the stamped
    // row (or the first row) and remove only duplicates for this exact path.
    const keep = matches.find((item) => new URL(item.url, 'http://home-assistant.local').searchParams.has('v')) || matches[0];
    for (const duplicate of matches.filter((item) => item !== keep)) {
      if (!duplicate.id) throw new Error(`Duplicate Growspace Manager resource has no registry ID: ${duplicate.url}`);
      const deleted = await send({ type: 'lovelace/resources/delete', resource_id: duplicate.id });
      if (!deleted.success) throw new Error(`Could not remove duplicate resource ${duplicate.url}: ${messageError(deleted)}`);
      log(`  removed duplicate resource ${duplicate.url}`);
    }
    log(`  resource already registered: ${keep.url}`);
    return;
  }
  if (matches.length === 1) {
    log(`  resource already registered: ${matches[0].url}`);
    return;
  }
  const created = await send({
    type: 'lovelace/resources/create',
    res_type: 'module',
    url: cardUrl,
  });
  if (!created.success) throw new Error(`Could not register ${cardUrl}: ${messageError(created)}`);
  log(`  registered resource ${cardUrl}`);
}

function writeEnvValues(filename, values) {
  let content = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const matcher = new RegExp(`^${key}=.*$`, 'm');
    if (matcher.test(content)) content = content.replace(matcher, line);
    else content += `${content.endsWith('\n') || content === '' ? '' : '\n'}${line}\n`;
  }
  fs.writeFileSync(filename, content, 'utf8');
}

function dashboardEnvValues(stages, env) {
  const values = {};
  for (const stage of stages) values[stage.dashboardEnvKey] = `/${stage.urlPath}/0`;
  const veg = stages.find((stage) => stage.slug === 'veg');
  if (veg) {
    values.TEST_DASHBOARD_PATH = `/${veg.urlPath}/0`;
    values.TEST_GROWSPACE_ID = env[veg.growspaceEnvKey];
  }
  return values;
}

function connectHaWebSocket({ WebSocket, baseUrl, token }) {
  const url = new URL('/api/websocket', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();

  return new Promise((resolve, reject) => {
    const startup = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), 10_000);
    socket.on('error', reject);
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (message.type === 'auth_invalid') {
        clearTimeout(startup);
        reject(new Error('Home Assistant WebSocket authentication failed'));
      } else if (message.type === 'auth_ok') {
        clearTimeout(startup);
        resolve({
          send(command) {
            return new Promise((resolveCommand) => {
              const id = nextId++;
              pending.set(id, resolveCommand);
              socket.send(JSON.stringify({ id, ...command }));
            });
          },
          close() { socket.close(); },
        });
      } else if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
  });
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

async function main(argv = process.argv.slice(2)) {
  const cardRoot = path.resolve(readOption(argv, '--card-root', process.env.GROWSPACE_CARD || path.join(WORKSPACE, '..', 'lovelace-growspace-manager-card')));
  const envFile = path.resolve(readOption(argv, '--env-file', path.join(cardRoot, 'tests/e2e/.env.test')));
  const tokenFile = path.resolve(readOption(argv, '--token-file', path.join(WORKSPACE, '.ha-token')));
  const manifestFile = path.join(cardRoot, 'tests/e2e/fixtures/e2e-entity-coverage.generated.json');
  const env = { ...parseEnvFile(envFile), ...process.env };
  const token = env.HA_ACCESS_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
  const baseUrl = readOption(argv, '--base-url', env.HA_BASE_URL || 'http://localhost:8123');
  if (!token) throw new Error(`HA_ACCESS_TOKEN is empty and no token exists at ${tokenFile}`);
  if (!fs.existsSync(manifestFile)) throw new Error(`Missing generated manifest: ${manifestFile}`);

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const stages = buildDashboardStages(manifest);
  const WebSocket = require(require.resolve('ws', { paths: [cardRoot] }));
  const connection = await connectHaWebSocket({ WebSocket, baseUrl, token });
  try {
    await ensureCardResource({ send: connection.send });
    await syncDashboards({ send: connection.send, env, stages });
  } finally {
    connection.close();
  }
  writeEnvValues(envFile, dashboardEnvValues(stages, env));
  console.log(`  updated dashboard paths in ${envFile}`);
}

module.exports = {
  CARD_URL,
  buildDashboardConfig,
  buildDashboardStages,
  connectHaWebSocket,
  dashboardEnvValues,
  dashboardPathForSlug,
  ensureCardResource,
  parseEnvFile,
  resourcePath,
  syncDashboards,
  writeEnvValues,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message || error}`);
    process.exitCode = 1;
  });
}

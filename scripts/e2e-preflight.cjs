#!/usr/bin/env node
/* Verify the live Home Assistant E2E environment against the generated contract. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  CARD_URL,
  buildDashboardStages,
  connectHaWebSocket,
  parseEnvFile,
  resourcePath,
} = require('./gen-e2e-dashboards.cjs');

const WORKSPACE = path.resolve(__dirname, '..');
const UNAVAILABLE = new Set(['unknown', 'unavailable']);
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

function owner(entity) {
  return `${entity.profile}/${entity.slug} (${entity.role})`;
}

function stateMap(states) {
  return new Map(states.map((state) => [state.entity_id, state]));
}

function validateEntityStates(manifest, states) {
  const live = stateMap(states);
  const errors = [];
  const seen = new Set();
  for (const entity of manifest.entities) {
    if (seen.has(entity.entity_id)) {
      errors.push(`${owner(entity)}: contract repeats ${entity.entity_id}`);
      continue;
    }
    seen.add(entity.entity_id);
    const actualDomain = entity.entity_id.split('.', 1)[0];
    if (actualDomain !== entity.domain) {
      errors.push(`${owner(entity)}: ${entity.entity_id} declares ${entity.domain}, ID emits ${actualDomain}`);
    }
    const state = live.get(entity.entity_id);
    if (!state) {
      errors.push(`${owner(entity)}: missing entity ${entity.entity_id}`);
      continue;
    }
    if (UNAVAILABLE.has(state.state)) {
      errors.push(`${owner(entity)}: ${entity.entity_id} is ${state.state}`);
    }
    for (const key of ['unit_of_measurement', 'device_class', 'state_class']) {
      // Home Assistant omits metadata with a null value; the generated
      // manifest uses null to say that no device class is required.
      if (entity[key] != null && entity[key] !== state.attributes?.[key]) {
        errors.push(`${owner(entity)}: ${entity.entity_id} ${key} is ${JSON.stringify(state.attributes?.[key])}, expected ${JSON.stringify(entity[key])}`);
      }
    }
  }
  return errors;
}

function collectEntityIds(value, result = []) {
  if (typeof value === 'string' && ENTITY_ID.test(value)) result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectEntityIds(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectEntityIds(item, result));
  return result;
}

function validateBackendPayloads(manifest, states) {
  const live = stateMap(states);
  const errors = [];
  const growspaceIds = new Map();
  const expectedOverviews = new Set();

  for (const profile of manifest.profiles) {
    const overviewId = `sensor.e2e_${profile.slug}_overview`;
    expectedOverviews.add(overviewId);
    const overview = live.get(overviewId);
    if (!overview) {
      errors.push(`${profile.profile}/${profile.slug}: missing backend payload ${overviewId}`);
      continue;
    }
    if (UNAVAILABLE.has(overview.state)) {
      errors.push(`${profile.profile}/${profile.slug}: backend payload ${overviewId} is ${overview.state}`);
      continue;
    }
    const identity = overview.attributes?.identity || {};
    if (identity.name !== profile.name) {
      errors.push(`${profile.profile}/${profile.slug}: backend identity is ${JSON.stringify(identity.name)}, expected ${JSON.stringify(profile.name)}`);
    }
    if (!profile.growspace_id) {
      errors.push(`${profile.profile}/${profile.slug}: expected growspace ID is missing from the E2E environment`);
    }
    if (!identity.growspace_id) {
      errors.push(`${profile.profile}/${profile.slug}: backend payload has no growspace_id`);
    } else {
      if (profile.growspace_id && identity.growspace_id !== profile.growspace_id) {
        errors.push(`${profile.profile}/${profile.slug}: backend growspace_id is ${JSON.stringify(identity.growspace_id)}, expected ${JSON.stringify(profile.growspace_id)}`);
      }
      if (growspaceIds.has(identity.growspace_id)) {
        errors.push(`${profile.profile}/${profile.slug}: duplicate growspace_id ${identity.growspace_id}, also owned by ${growspaceIds.get(identity.growspace_id)}`);
      } else {
        growspaceIds.set(identity.growspace_id, `${profile.profile}/${profile.slug}`);
      }
    }

    const payload = JSON.stringify(overview.attributes);
    for (const entityId of collectEntityIds(profile.services)) {
      if (!payload.includes(JSON.stringify(entityId))) {
        errors.push(`${profile.profile}/${profile.slug}: backend payload dropped configured entity ${entityId}`);
      }
    }
  }

  for (const state of states) {
    if (!state.entity_id.startsWith('sensor.e2e_') || !state.entity_id.includes('_overview')) continue;
    if (state.attributes?.identity?.name?.startsWith('E2E ') && !expectedOverviews.has(state.entity_id)) {
      errors.push(`unexpected E2E overview ${state.entity_id} (${state.attributes.identity.name}); possible duplicate growspace`);
    }
  }
  return errors;
}

function serviceCallForState(state) {
  const [domain] = state.entity_id.split('.', 1);
  const entity = { entity_id: state.entity_id };
  if (domain === 'input_number' || domain === 'number') {
    return { domain, service: 'set_value', data: { ...entity, value: Number(state.state) } };
  }
  if (domain === 'select') {
    return { domain, service: 'select_option', data: { ...entity, option: state.state } };
  }
  if (domain === 'time') {
    return { domain, service: 'set_value', data: { ...entity, time: state.state } };
  }
  if (['input_boolean', 'switch', 'light', 'fan', 'humidifier'].includes(domain)) {
    // Humidifiers report active states such as "idle" and "humidifying" rather
    // than the generic "on" used by switches. Only an explicit off state
    // should receive turn_off.
    return { domain, service: state.state === 'off' ? 'turn_off' : 'turn_on', data: entity };
  }
  return null;
}

function validateRegistryDevices(manifest, entityRegistry) {
  const errors = [];
  const registry = new Map(entityRegistry.map((entity) => [entity.entity_id, entity]));
  const devicesByKey = new Map();
  for (const entity of manifest.entities.filter((item) => item.device_key)) {
    const registered = registry.get(entity.entity_id);
    if (!registered) {
      errors.push(`${owner(entity)}: ${entity.entity_id} is absent from the entity registry`);
      continue;
    }
    if (registered.platform !== entity.platform) {
      errors.push(`${owner(entity)}: ${entity.entity_id} platform is ${registered.platform}, expected ${entity.platform}`);
    }
    if (!registered.device_id) {
      errors.push(`${owner(entity)}: ${entity.entity_id} has no owning device`);
      continue;
    }
    const previous = devicesByKey.get(entity.device_key);
    if (previous && previous !== registered.device_id) {
      errors.push(`${owner(entity)}: bundle ${entity.device_key} spans devices ${previous} and ${registered.device_id}`);
    }
    devicesByKey.set(entity.device_key, registered.device_id);
  }
  const reverse = new Map();
  for (const [key, deviceId] of devicesByKey) {
    if (reverse.has(deviceId) && reverse.get(deviceId) !== key) {
      errors.push(`AC Infinity bundles ${reverse.get(deviceId)} and ${key} share device ${deviceId}`);
    }
    reverse.set(deviceId, key);
  }
  return errors;
}

function validateGlobalSettings(manifest, entries) {
  const errors = [];
  if (!manifest.global_settings || Object.keys(manifest.global_settings).length === 0) return errors;
  if (entries.length !== 1) return [`global settings: expected one Growspace Manager config entry, found ${entries.length}`];
  if (!entries[0].options) return ['global settings: config-entry storage has no options payload'];
  // The options flow nests install-wide fields under `global_settings`; older
  // entries kept them at the top level, so read whichever this entry carries.
  const options = entries[0].options.global_settings ?? entries[0].options;
  for (const [key, expected] of Object.entries(manifest.global_settings)) {
    if (options[key] !== expected) {
      errors.push(`global settings: ${key} is ${JSON.stringify(options[key])}, expected ${JSON.stringify(expected)}`);
    }
  }
  return errors;
}

function validateLovelace(manifest, dashboards, resources, dashboardConfigs) {
  const stages = buildDashboardStages(manifest);
  const errors = [];
  const dashboardPaths = new Set(dashboards.map((dashboard) => dashboard.url_path));
  for (const stage of stages) {
    if (!dashboardPaths.has(stage.urlPath)) {
      errors.push(`${stage.profile}/${stage.slug}: missing dashboard ${stage.urlPath}`);
      continue;
    }
    const config = dashboardConfigs.get(stage.urlPath);
    const cards = config?.views?.flatMap((view) => view.sections || [])
      .flatMap((section) => section.cards || []) || [];
    const matching = cards.filter((card) => card.type === 'custom:growspace-manager-card');
    if (matching.length !== 1) {
      errors.push(`${stage.profile}/${stage.slug}: dashboard ${stage.urlPath} has ${matching.length} Growspace Manager cards`);
      continue;
    }
    const expectedId = manifest.profiles.find((profile) => profile.slug === stage.slug)?.growspace_id;
    if (expectedId && matching[0].default_growspace !== expectedId) {
      errors.push(`${stage.profile}/${stage.slug}: dashboard selects ${matching[0].default_growspace}, expected ${expectedId}`);
    }
  }
  const cardResources = resources.filter((resource) => resourcePath(resource.url) === resourcePath(CARD_URL));
  if (cardResources.length !== 1) {
    errors.push(`expected one Growspace Manager Lovelace resource, found ${cardResources.length}`);
  }
  return errors;
}

async function restJson(baseUrl, token, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname}: HTTP ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

// Writing a simulated device is not a no-op the way writing a helper is: it
// pins that growspace to the value written, which is the point during a demo
// and exactly wrong after a preflight. Releasing the gates hands every
// dashboard back to its waveform.
const EQUIPMENT_GATE_ROLE = 'simulation.manual_equipment';

async function releaseSimulatedEquipment(manifest, baseUrl, token) {
  const errors = [];
  let released = 0;
  for (const entity of manifest.entities.filter((item) => item.role === EQUIPMENT_GATE_ROLE)) {
    try {
      await restJson(baseUrl, token, '/api/services/input_boolean/turn_off', {
        method: 'POST',
        body: JSON.stringify({ entity_id: entity.entity_id }),
      });
      released += 1;
    } catch (error) {
      errors.push(`${owner(entity)}: could not release ${entity.entity_id}: ${error.message}`);
    }
  }
  return { errors, released };
}

async function exerciseWritableEntities(manifest, states, baseUrl, token) {
  const live = stateMap(states);
  const errors = [];
  let exercised = 0;
  for (const entity of manifest.entities.filter((item) => item.behavior === 'controllable')) {
    const snapshot = live.get(entity.entity_id);
    if (!snapshot || UNAVAILABLE.has(snapshot.state)) continue;
    // Re-read rather than replay the batch snapshot: a simulated device moves
    // while the pass runs, and writing back a value it held minutes ago is a
    // visible jump in the demo's history rather than the no-op this intends.
    const state = await restJson(baseUrl, token, `/api/states/${entity.entity_id}`);
    if (!state || UNAVAILABLE.has(state.state)) continue;
    const call = serviceCallForState(state);
    if (!call || (Number.isNaN(call.data.value))) {
      errors.push(`${owner(entity)}: no safe no-op service exercise for ${entity.entity_id}=${state.state}`);
      continue;
    }
    try {
      await restJson(baseUrl, token, `/api/services/${call.domain}/${call.service}`, {
        method: 'POST',
        body: JSON.stringify(call.data),
      });
      const after = await restJson(baseUrl, token, `/api/states/${entity.entity_id}`);
      if (UNAVAILABLE.has(after.state)) throw new Error(`became ${after.state}`);
      exercised += 1;
    } catch (error) {
      errors.push(`${owner(entity)}: ${entity.entity_id} write exercise failed: ${error.message}`);
    }
  }
  return { errors, exercised };
}

async function bootstrapDashboards({ cardRoot, baseUrl, token, stages }) {
  const { chromium } = require(require.resolve('playwright', { paths: [cardRoot] }));
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  let bootstrapped = 0;
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript((accessToken) => {
      localStorage.setItem('hassTokens', JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 1900000000,
        refresh_token: '',
        hassUrl: location.origin,
        clientId: null,
        expires: Date.now() + 1900000000 * 1000,
      }));
    }, token);
    for (const stage of stages) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && /growspace|schema|zod|missing entit|bootstrap/i.test(message.text())) {
          pageErrors.push(message.text());
        }
      });
      try {
        await page.goto(new URL(`/${stage.urlPath}/0`, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForSelector('growspace-manager-card', { state: 'attached', timeout: 30_000 });
        await page.waitForFunction(() => customElements.get('growspace-manager-card') !== undefined);
        await page.waitForTimeout(1_000);
        const result = await page.locator('growspace-manager-card').first().evaluate((card) => ({
          hasShadowRoot: Boolean(card.shadowRoot),
          text: card.shadowRoot?.textContent || '',
        }));
        if (!result.hasShadowRoot) pageErrors.push('card has no rendered shadow root');
        if (/No valid growspace selected|Home Assistant not available|Growspace Manager Card Error/i.test(result.text)) {
          pageErrors.push(`card rendered an error: ${result.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`);
        }
        if (pageErrors.length === 0) bootstrapped += 1;
      } catch (error) {
        pageErrors.push(error.message);
      } finally {
        await page.close();
      }
      for (const error of pageErrors) errors.push(`${stage.profile}/${stage.slug}: ${error}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return { errors, bootstrapped };
}

function validateHaLog(filename) {
  if (!filename || !fs.existsSync(filename)) return [];
  return fs.readFileSync(filename, 'utf8').split('\n')
    .filter((line) => /Invalid config|Configuration error|Setup failed for|Unable to prepare setup|Error setting up entry/i.test(line))
    .map((line) => `Home Assistant log: ${line}`);
}

function readConfigEntryStorage(filename) {
  if (!filename || !fs.existsSync(filename)) return [];
  const storage = JSON.parse(fs.readFileSync(filename, 'utf8'));
  return (storage.data?.entries || []).filter((entry) => entry.domain === 'growspace_manager');
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

async function main(argv = process.argv.slice(2)) {
  const cardRoot = path.resolve(readOption(argv, '--card-root', process.env.GROWSPACE_CARD || path.join(WORKSPACE, '..', 'lovelace-growspace-manager-card')));
  const envFile = path.resolve(readOption(argv, '--env-file', path.join(cardRoot, 'tests/e2e/.env.test')));
  const tokenFile = path.resolve(readOption(argv, '--token-file', path.join(WORKSPACE, '.ha-token')));
  const logFile = path.resolve(readOption(argv, '--log-file', path.join(WORKSPACE, 'ha-dev/home-assistant.log')));
  const storageFile = path.resolve(readOption(argv, '--storage-file', path.join(WORKSPACE, 'ha-dev/.storage/core.config_entries')));
  const env = { ...parseEnvFile(envFile), ...process.env };
  const token = env.HA_ACCESS_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
  const baseUrl = readOption(argv, '--base-url', env.HA_BASE_URL || 'http://127.0.0.1:8123');
  const manifestFile = path.join(cardRoot, 'tests/e2e/fixtures/e2e-entity-coverage.generated.json');
  if (!token) throw new Error(`HA_ACCESS_TOKEN is empty and no token exists at ${tokenFile}`);
  if (!fs.existsSync(manifestFile)) throw new Error(`Missing generated manifest: ${manifestFile}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const stages = buildDashboardStages(manifest);
  for (const profile of manifest.profiles) {
    profile.growspace_id = env[`TEST_${profile.slug.toUpperCase()}_GROWSPACE_ID`];
  }

  console.log(`E2E preflight: ${manifest.entities.length} entities, ${manifest.profiles.length} profiles, ${stages.length} dashboards`);
  const states = await restJson(baseUrl, token, '/api/states');
  const errors = [
    ...validateEntityStates(manifest, states),
    ...validateBackendPayloads(manifest, states),
  ];

  const WebSocket = require(require.resolve('ws', { paths: [cardRoot] }));
  const connection = await connectHaWebSocket({ WebSocket, baseUrl, token });
  let entries;
  let entityRegistry;
  let dashboards;
  let resources;
  const configs = new Map();
  try {
    const [entryMessage, entityMessage, dashboardMessage, resourceMessage] = await Promise.all([
      connection.send({ type: 'config_entries/get', domain: 'growspace_manager' }),
      connection.send({ type: 'config/entity_registry/list' }),
      connection.send({ type: 'lovelace/dashboards/list' }),
      connection.send({ type: 'lovelace/resources' }),
    ]);
    for (const message of [entryMessage, entityMessage, dashboardMessage, resourceMessage]) {
      if (!message.success) throw new Error(JSON.stringify(message.error));
    }
    entries = entryMessage.result || [];
    entityRegistry = entityMessage.result || [];
    dashboards = dashboardMessage.result || [];
    resources = resourceMessage.result || [];
    await Promise.all(stages.map(async (stage) => {
      const message = await connection.send({ type: 'lovelace/config', url_path: stage.urlPath, force: true });
      if (message.success) configs.set(stage.urlPath, message.result);
      else errors.push(`${stage.profile}/${stage.slug}: cannot read dashboard ${stage.urlPath}: ${JSON.stringify(message.error)}`);
    }));
  } finally {
    connection.close();
  }
  if (entries.length !== 1 || entries[0].state !== 'loaded') {
    errors.push(`integration: expected one loaded Growspace Manager config entry, found ${entries.length}${entries[0] ? ` (${entries[0].state})` : ''}`);
  }
  errors.push(...validateGlobalSettings(manifest, readConfigEntryStorage(storageFile)));
  errors.push(...validateRegistryDevices(manifest, entityRegistry));
  errors.push(...validateLovelace(manifest, dashboards, resources, configs));

  const writes = await exerciseWritableEntities(manifest, states, baseUrl, token);
  errors.push(...writes.errors);
  const released = await releaseSimulatedEquipment(manifest, baseUrl, token);
  errors.push(...released.errors);
  const browser = argv.includes('--skip-browser')
    ? { errors: [], bootstrapped: 0 }
    : await bootstrapDashboards({ cardRoot, baseUrl, token, stages });
  errors.push(...browser.errors);
  errors.push(...validateHaLog(logFile));

  if (errors.length > 0) {
    console.error(`\nE2E preflight failed with ${errors.length} problem(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  PASS entities: ${manifest.entities.length}/${manifest.entities.length} available with contract metadata`);
  console.log(`  PASS writes: ${writes.exercised} controllable entities exercised with no-op service calls`);
  console.log(`  PASS simulation: ${released.released} growspaces released back to free-running devices`);
  console.log(`  PASS backend: ${manifest.profiles.length} profile payloads retained every configured entity role`);
  console.log(`  PASS registries: ${entityRegistry.length} entities checked; AC Infinity bundles have stable devices`);
  console.log(`  PASS Lovelace: ${stages.length} dashboards and one card resource are unique and current`);
  if (!argv.includes('--skip-browser')) console.log(`  PASS card: ${browser.bootstrapped}/${stages.length} dashboards bootstrapped without schema/entity errors`);
  console.log('E2E preflight healthy.');
}

module.exports = {
  EQUIPMENT_GATE_ROLE,
  collectEntityIds,
  readConfigEntryStorage,
  serviceCallForState,
  validateBackendPayloads,
  validateEntityStates,
  validateGlobalSettings,
  validateHaLog,
  validateLovelace,
  validateRegistryDevices,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message || error}`);
    process.exitCode = 1;
  });
}

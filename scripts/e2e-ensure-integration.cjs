#!/usr/bin/env node
/* Ensure a clean HA config has the single Growspace Manager config entry E2E expects. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { connectHaWebSocket, parseEnvFile } = require('./gen-e2e-dashboards.cjs');

async function postJson(baseUrl, token, pathname, data) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`POST ${pathname}: HTTP ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

// Home Assistant answers its HTTP API before the integration has finished
// setting up, and setup grows with the number of simulated entities, so an
// entry read once immediately after a restart is a race rather than a verdict.
const ENTRY_LOAD_TIMEOUT_MS = 120_000;
const ENTRY_POLL_INTERVAL_MS = 2_000;

async function ensureIntegration({
  listEntries,
  post = postJson,
  baseUrl,
  token,
  timeoutMs = ENTRY_LOAD_TIMEOUT_MS,
  intervalMs = ENTRY_POLL_INTERVAL_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const deadline = now() + timeoutMs;
  let entries = await listEntries();
  while (
    entries.length === 1 &&
    entries[0].state &&
    entries[0].state !== 'loaded' &&
    now() < deadline
  ) {
    await sleep(intervalMs);
    entries = await listEntries();
  }
  if (entries.length > 1) throw new Error(`Expected at most one Growspace Manager config entry, found ${entries.length}`);
  if (entries.length === 1) {
    if (entries[0].state && entries[0].state !== 'loaded') {
      throw new Error(`Growspace Manager config entry is still ${entries[0].state} after ${Math.round(timeoutMs / 1000)}s, expected loaded`);
    }
    return { created: false, entryId: entries[0].entry_id };
  }

  const started = await post(baseUrl, token, '/api/config/config_entries/flow', {
    handler: 'growspace_manager',
  });
  if (started.type !== 'form' || started.step_id !== 'user' || !started.flow_id) {
    throw new Error(`Could not start Growspace Manager config flow: ${JSON.stringify(started)}`);
  }
  const completed = await post(
    baseUrl,
    token,
    `/api/config/config_entries/flow/${started.flow_id}`,
    { name: 'Growspace Manager' },
  );
  if (completed.type !== 'create_entry') {
    throw new Error(`Could not create Growspace Manager config entry: ${JSON.stringify(completed)}`);
  }
  return { created: true, entryId: completed.result?.entry_id };
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

async function main(argv = process.argv.slice(2)) {
  const workspace = path.resolve(__dirname, '..');
  const cardRoot = path.resolve(readOption(argv, '--card-root', process.env.GROWSPACE_CARD || path.join(workspace, '..', 'lovelace-growspace-manager-card')));
  const envFile = path.resolve(readOption(argv, '--env-file', path.join(cardRoot, 'tests/e2e/.env.test')));
  const tokenFile = path.resolve(readOption(argv, '--token-file', path.join(workspace, '.ha-token')));
  const env = { ...parseEnvFile(envFile), ...process.env };
  const token = env.HA_ACCESS_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
  const baseUrl = readOption(argv, '--base-url', env.HA_BASE_URL || 'http://127.0.0.1:8123');
  if (!token) throw new Error(`HA_ACCESS_TOKEN is empty and no token exists at ${tokenFile}`);

  const WebSocket = require(require.resolve('ws', { paths: [cardRoot] }));
  const connection = await connectHaWebSocket({ WebSocket, baseUrl, token });
  try {
    const result = await ensureIntegration({
      baseUrl,
      token,
      listEntries: async () => {
        const message = await connection.send({ type: 'config_entries/get', domain: 'growspace_manager' });
        if (!message.success) throw new Error(`Could not list config entries: ${JSON.stringify(message.error)}`);
        return message.result || [];
      },
    });
    console.log(result.created ? '  created Growspace Manager config entry' : `  config entry already loaded: ${result.entryId}`);
  } finally {
    connection.close();
  }
}

module.exports = { ensureIntegration };

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message || error}`);
    process.exitCode = 1;
  });
}

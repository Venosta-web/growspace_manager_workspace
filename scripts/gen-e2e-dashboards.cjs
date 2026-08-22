#!/usr/bin/env node
/*
 * Create one Lovelace dashboard per e2e growspace, each holding a
 * growspace-manager-card bound to that growspace.
 *
 *   ./scripts/ha dev up
 *   ./scripts/ha dev token          # once, stores .ha-token
 *   node scripts/gen-e2e-dashboards.cjs
 *
 * Idempotent: existing dashboards are reused, their config re-saved.
 * Growspace IDs are read from tests/e2e/.env.test, which
 * tests/e2e/fixtures/e2e-setup.ts writes.
 *
 * Dashboards are created via the WebSocket API — HA has no REST endpoint
 * for lovelace/dashboards/create.
 */
const WebSocket = require('/home/maxi/dev/lovelace-growspace-manager-card/node_modules/ws');
const fs = require('fs');

const TOKEN = fs.readFileSync('/home/maxi/dev/growspace_manager_workspace/.ha-token','utf8').trim();
const env = Object.fromEntries(
  fs.readFileSync('/home/maxi/dev/lovelace-growspace-manager-card/tests/e2e/.env.test','utf8')
    .split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));

// url_path must contain a hyphen (HA requirement) and match TEST_*_DASHBOARD_PATH
const STAGES = [
  ['e2e-veg',        'TEST_VEG_GROWSPACE_ID',        'E2E Veg'],
  ['e2e-clone',      'TEST_CLONE_GROWSPACE_ID',      'E2E Clone'],
  ['e2e-mother',     'TEST_MOTHER_GROWSPACE_ID',     'E2E Mother'],
  ['e2e-flower',     'TEST_FLOWER_GROWSPACE_ID',     'E2E Flower'],
  ['e2e-dry',        'TEST_DRY_GROWSPACE_ID',        'E2E Dry'],
  ['e2e-cure',       'TEST_CURE_GROWSPACE_ID',       'E2E Cure'],
  ['e2e-vwc-veg',    'TEST_VWC_VEG_GROWSPACE_ID',    'E2E VWC Veg'],
  ['e2e-vwc-flower', 'TEST_VWC_FLOWER_GROWSPACE_ID', 'E2E VWC Flower'],
];

const ws = new WebSocket('ws://localhost:8123/api/websocket');
let id = 1; const pending = new Map();
const send = (msg) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, ...msg })); });

ws.on('message', async (raw) => {
  const m = JSON.parse(raw);
  if (m.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
  if (m.type === 'auth_invalid') { console.error('AUTH FAILED'); process.exit(1); }
  if (m.type === 'auth_ok') return run();
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

async function run() {
  const existing = await send({ type: 'lovelace/dashboards/list' });
  const have = new Set((existing.result || []).map(d => d.url_path));
  console.log('  existing dashboards:', [...have].join(', ') || '(none)');

  for (const [urlPath, envKey, title] of STAGES) {
    const gsId = env[envKey];
    if (!gsId) { console.log(`  SKIP ${urlPath}: ${envKey} empty`); continue; }

    if (!have.has(urlPath)) {
      const r = await send({ type: 'lovelace/dashboards/create', url_path: urlPath, title, show_in_sidebar: false, require_admin: false });
      if (!r.success) { console.log(`  FAIL create ${urlPath}:`, JSON.stringify(r.error)); continue; }
      console.log(`  created dashboard ${urlPath}`);
    } else { console.log(`  dashboard ${urlPath} already exists`); }

    const cfg = { views: [{ title, cards: [{ type: 'custom:growspace-manager-card', growspace_id: gsId }] }] };
    const s = await send({ type: 'lovelace/config/save', url_path: urlPath, config: cfg });
    console.log(`    config saved: ${s.success ? 'ok' : JSON.stringify(s.error)}  -> growspace ${gsId.slice(0,8)}`);
  }
  ws.close(); process.exit(0);
}

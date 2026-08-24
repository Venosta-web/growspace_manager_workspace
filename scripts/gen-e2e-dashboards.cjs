#!/usr/bin/env node
/*
 * Create one Lovelace Sections dashboard per e2e growspace, each holding a
 * four-row growspace-manager-card bound to that growspace. Sections views are
 * capped at four columns to exercise the representative desktop layout.
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
const fs = require('fs');

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
  ['e2e-telemetry-multi', 'TEST_TELEMETRY_MULTI_GROWSPACE_ID', 'E2E Multi Telemetry'],
  ['e2e-climate-plain', 'TEST_CLIMATE_PLAIN_GROWSPACE_ID', 'E2E Climate Plain'],
  ['e2e-vision',     'TEST_VISION_GROWSPACE_ID',     'E2E Vision'],
];

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

async function syncDashboards({ send, env, log = console.log }) {
  const existing = await send({ type: 'lovelace/dashboards/list' });
  const have = new Set((existing.result || []).map(d => d.url_path));
  log('  existing dashboards:', [...have].join(', ') || '(none)');

  for (const [urlPath, envKey, title] of STAGES) {
    const gsId = env[envKey];
    if (!gsId) { log(`  SKIP ${urlPath}: ${envKey} empty`); continue; }

    if (!have.has(urlPath)) {
      const r = await send({ type: 'lovelace/dashboards/create', url_path: urlPath, title, show_in_sidebar: false, require_admin: false });
      if (!r.success) { log(`  FAIL create ${urlPath}:`, JSON.stringify(r.error)); continue; }
      log(`  created dashboard ${urlPath}`);
    } else { log(`  dashboard ${urlPath} already exists`); }

    // The config key is `default_growspace` (see GrowspaceManagerCardConfig in
    // src/lib/types/config.ts). An unrecognised key is ignored and the card
    // auto-selects an arbitrary growspace instead — which looks like it works
    // until you notice every dashboard is showing the same wrong space.
    const cfg = buildDashboardConfig(title, gsId);
    const s = await send({ type: 'lovelace/config/save', url_path: urlPath, config: cfg });
    log(`    config saved: ${s.success ? 'ok' : JSON.stringify(s.error)}  -> growspace ${gsId.slice(0,8)}`);
  }
}

function main() {
  const WebSocket = require('/home/maxi/dev/lovelace-growspace-manager-card/node_modules/ws');
  const TOKEN = fs.readFileSync('/home/maxi/dev/growspace_manager_workspace/.ha-token','utf8').trim();
  const env = Object.fromEntries(
    fs.readFileSync('/home/maxi/dev/lovelace-growspace-manager-card/tests/e2e/.env.test','utf8')
      .split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
      .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));

  const ws = new WebSocket('ws://localhost:8123/api/websocket');
  let id = 1; const pending = new Map();
  const send = (msg) => new Promise((res) => {
    const i = id++;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, ...msg }));
  });

  ws.on('message', async (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
    if (m.type === 'auth_invalid') { console.error('AUTH FAILED'); process.exit(1); }
    if (m.type === 'auth_ok') return run();
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });

  const CARD_URL = '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js';

  /*
   * Register the card as a Lovelace resource.
   *
   * This CANNOT be done from configuration.yaml: `lovelace.resources` is only
   * honoured in YAML mode. This instance runs `lovelace: mode: storage`, where
   * resources live in .storage/lovelace_resources and are managed through the
   * websocket API. A YAML `resources:` block is silently ignored — the card JS
   * never loads, <growspace-manager-card> is never defined, and every spec that
   * waits for it times out with an empty page.
   */
  async function ensureResource() {
    const list = await send({ type: 'lovelace/resources' });
    const have = (list.result || []).find((r) => r.url === CARD_URL);
    if (have) { console.log('  resource already registered'); return; }
    const r = await send({ type: 'lovelace/resources/create', res_type: 'module', url: CARD_URL });
    console.log(r.success ? `  registered resource ${CARD_URL}` : `  FAIL resource: ${JSON.stringify(r.error)}`);
  }

  async function run() {
    await ensureResource();
    await syncDashboards({ send, env });
    ws.close(); process.exit(0);
  }
}

module.exports = { STAGES, buildDashboardConfig, syncDashboards };

if (require.main === module) main();

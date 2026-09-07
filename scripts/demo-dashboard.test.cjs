const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DASHBOARD_PATH,
  buildCaptureConfig,
  isCaptureConfig,
  readGrowspaces,
  removeCaptureDashboard,
  resolveGrowspace,
  syncCaptureDashboard,
} = require('./demo-dashboard');
const { buildDashboardConfig } = require('./gen-e2e-dashboards.cjs');

const GROWSPACE_ID = '4be01d30-670b-4115-9ad9-756356f1347b';

function recorder(responses = {}) {
  const sent = [];
  const send = async (command) => {
    sent.push(command);
    const reply = responses[command.type];
    if (typeof reply === 'function') return reply(command);
    return reply || { success: true };
  };
  return { send, sent, log: () => {} };
}

test('the capture view is a panel, which is what the profile dashboards are not', () => {
  const config = buildCaptureConfig('Demo Tent', GROWSPACE_ID);
  assert.deepEqual(config, {
    views: [{
      title: 'Demo Tent',
      path: '0',
      type: 'panel',
      cards: [{
        type: 'custom:growspace-manager-card',
        default_growspace: GROWSPACE_ID,
      }],
    }],
  });
  // No grid tile, so nothing constrains the card's width or height.
  assert.equal('grid_options' in config.views[0].cards[0], false);
});

test('a profile dashboard is not mistaken for a capture dashboard', () => {
  assert.equal(isCaptureConfig(buildCaptureConfig('Demo Tent', GROWSPACE_ID)), true);
  assert.equal(isCaptureConfig(buildDashboardConfig('Demo Tent', GROWSPACE_ID)), false);
  assert.equal(isCaptureConfig({ views: [] }), false);
  assert.equal(isCaptureConfig(undefined), false);
  assert.equal(
    isCaptureConfig({ views: [{ type: 'panel', cards: [{ type: 'markdown' }] }] }),
    false,
  );
});

test('growspaces come from the overview sensors and nothing else', () => {
  const growspaces = readGrowspaces([
    { attributes: { identity: { growspace_id: GROWSPACE_ID, name: 'Demo Tent' } } },
    { attributes: { identity: { growspace_id: 'f4a81be5', name: 'E2E Flower' } } },
    { attributes: { plant_id: 'a-plant', growspace_id: GROWSPACE_ID } },
    { attributes: { identity: 'not a mapping' } },
    { attributes: {} },
  ]);
  assert.deepEqual(growspaces, [
    { growspaceId: GROWSPACE_ID, name: 'Demo Tent' },
    { growspaceId: 'f4a81be5', name: 'E2E Flower' },
  ]);
});

test('a growspace resolves by id or by name, and says so when it cannot', () => {
  const growspaces = [
    { growspaceId: GROWSPACE_ID, name: 'Demo Tent' },
    { growspaceId: 'f4a81be5', name: 'E2E Flower' },
    { growspaceId: 'dupe-1', name: 'Twin' },
    { growspaceId: 'dupe-2', name: 'Twin' },
  ];
  assert.equal(resolveGrowspace(GROWSPACE_ID, growspaces).name, 'Demo Tent');
  assert.equal(resolveGrowspace('demo tent', growspaces).growspaceId, GROWSPACE_ID);
  assert.throws(() => resolveGrowspace('Nowhere', growspaces), /no growspace "Nowhere"/);
  assert.throws(() => resolveGrowspace('Twin', growspaces), /names 2 growspaces/);
});

test('a missing dashboard is created before its config is saved', async () => {
  const { send, sent, log } = recorder({
    'lovelace/dashboards/list': { success: true, result: [] },
  });
  await syncCaptureDashboard({
    send,
    urlPath: DASHBOARD_PATH,
    title: 'Demo Tent',
    growspaceId: GROWSPACE_ID,
    log,
  });
  assert.deepEqual(sent.map((command) => command.type), [
    'lovelace/dashboards/list',
    'lovelace/dashboards/create',
    'lovelace/config/save',
  ]);
  assert.equal(sent[1].url_path, DASHBOARD_PATH);
  assert.equal(sent[1].show_in_sidebar, true);
  assert.deepEqual(sent[2].config, buildCaptureConfig('Demo Tent', GROWSPACE_ID));
});

test('an existing dashboard is repointed rather than created twice', async () => {
  const { send, sent, log } = recorder({
    'lovelace/dashboards/list': {
      success: true,
      result: [{ id: 'demo_tent', url_path: DASHBOARD_PATH, title: 'Demo Tent' }],
    },
  });
  await syncCaptureDashboard({
    send,
    urlPath: DASHBOARD_PATH,
    title: 'E2E Vision',
    growspaceId: 'f4a81be5',
    log,
  });
  assert.deepEqual(sent.map((command) => command.type), [
    'lovelace/dashboards/list',
    'lovelace/config/save',
  ]);
  assert.deepEqual(sent[1].config, buildCaptureConfig('E2E Vision', 'f4a81be5'));
});

test('--remove deletes the dashboard this tool wrote', async () => {
  const { send, sent, log } = recorder({
    'lovelace/dashboards/list': {
      success: true,
      result: [{ id: 'demo_tent', url_path: DASHBOARD_PATH }],
    },
    'lovelace/config': {
      success: true,
      result: buildCaptureConfig('Demo Tent', GROWSPACE_ID),
    },
  });
  await removeCaptureDashboard({ send, urlPath: DASHBOARD_PATH, log });
  assert.deepEqual(sent.map((command) => command.type), [
    'lovelace/dashboards/list',
    'lovelace/config',
    'lovelace/dashboards/delete',
  ]);
  assert.equal(sent[2].dashboard_id, 'demo_tent');
});

test('--remove refuses a dashboard somebody has since made their own', async () => {
  const { send, log } = recorder({
    'lovelace/dashboards/list': {
      success: true,
      result: [{ id: 'demo_tent', url_path: DASHBOARD_PATH }],
    },
    'lovelace/config': {
      success: true,
      result: buildDashboardConfig('Demo Tent', GROWSPACE_ID),
    },
  });
  await assert.rejects(
    removeCaptureDashboard({ send, urlPath: DASHBOARD_PATH, log }),
    /not the capture dashboard any more/,
  );
});

test('--remove is a no-op when there is no such dashboard', async () => {
  const { send, sent, log } = recorder({
    'lovelace/dashboards/list': { success: true, result: [] },
  });
  await removeCaptureDashboard({ send, urlPath: DASHBOARD_PATH, log });
  assert.deepEqual(sent.map((command) => command.type), ['lovelace/dashboards/list']);
});

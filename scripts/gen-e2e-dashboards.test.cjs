const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDashboardConfig,
  buildDashboardStages,
  buildIntegrationDashboardConfig,
  buildIntegrationDashboardStages,
  dashboardEnvValues,
  ensureCardResource,
  syncDashboards,
  syncIntegrationDashboards,
} = require('./gen-e2e-dashboards.cjs');

const MANIFEST = {
  profiles: [
    { profile: 'stage', slug: 'veg', name: 'E2E Veg' },
    { profile: 'irrigation_monitored', slug: 'irrigation_monitored', name: 'E2E Irrigation Monitored' },
    { profile: 'lighting', slug: 'lighting', name: 'E2E Lighting' },
  ],
  integration_dashboards: [{
    slug: 'tc',
    title: 'E2E Tissue Culture',
    card: 'custom:growspace-tc-card',
    integration: 'growspace_manager_tc',
    purpose: 'The standalone host of the tissue-culture view.',
  }],
};
const STAGES = buildDashboardStages(MANIFEST);
const INTEGRATION_STAGES = buildIntegrationDashboardStages(MANIFEST);

test('derives dashboard identity and the shared four-column card layout from the manifest', () => {
  assert.deepEqual(STAGES.map(({ urlPath }) => urlPath), [
    'e2e-veg',
    'e2e-irrigation-monitored',
    'e2e-lighting',
  ]);
  assert.deepEqual(STAGES.map(({ growspaceEnvKey }) => growspaceEnvKey), [
    'TEST_VEG_GROWSPACE_ID',
    'TEST_IRRIGATION_MONITORED_GROWSPACE_ID',
    'TEST_LIGHTING_GROWSPACE_ID',
  ]);

  for (const stage of STAGES) {
    const growspaceId = `growspace-${stage.urlPath}`;
    assert.deepEqual(buildDashboardConfig(stage.title, growspaceId), {
      views: [{
        title: stage.title,
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
    });
  }
});

test('resaves every dashboard without creating duplicates on rerun', async () => {
  const dashboards = new Set(['e2e-veg']);
  const created = [];
  const saved = [];
  const env = Object.fromEntries(
    STAGES.map((stage) => [stage.growspaceEnvKey, `growspace-${stage.urlPath}`]),
  );
  const send = async (message) => {
    if (message.type === 'lovelace/dashboards/list') {
      return { success: true, result: [...dashboards].map((url_path) => ({ url_path })) };
    }
    if (message.type === 'lovelace/dashboards/create') {
      created.push(message.url_path);
      dashboards.add(message.url_path);
      return { success: true };
    }
    if (message.type === 'lovelace/config/save') {
      saved.push(message);
      return { success: true };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  };

  await syncDashboards({ send, env, stages: STAGES, log: () => {} });
  await syncDashboards({ send, env, stages: STAGES, log: () => {} });

  assert.deepEqual([...dashboards].sort(), STAGES.map(({ urlPath }) => urlPath).sort());
  assert.equal(created.length, STAGES.length - 1);
  assert.equal(saved.length, STAGES.length * 2);
});

test('refuses missing growspace IDs instead of silently omitting a dashboard', async () => {
  await assert.rejects(
    syncDashboards({
      send: async () => ({ success: true, result: [] }),
      env: {},
      stages: STAGES,
      log: () => {},
    }),
    /stage\/veg: TEST_VEG_GROWSPACE_ID is empty/,
  );
});

test('recognizes a stamped resource and repairs duplicate registrations', async () => {
  const sent = [];
  await ensureCardResource({
    send: async (message) => {
      sent.push(message);
      return { success: true, result: [{ url: '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js?v=abc' }] };
    },
    log: () => {},
  });
  assert.deepEqual(sent, [{ type: 'lovelace/resources' }]);

  const duplicateCalls = [];
  await ensureCardResource({
    send: async (message) => {
      duplicateCalls.push(message);
      if (message.type === 'lovelace/resources') {
        return {
          success: true,
          result: [
            { id: 'plain', url: '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js' },
            { id: 'stamped', url: '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js?v=abc' },
          ],
        };
      }
      return { success: true };
    },
    log: () => {},
  });
  assert.deepEqual(duplicateCalls, [
    { type: 'lovelace/resources' },
    { type: 'lovelace/resources/delete', resource_id: 'plain' },
  ]);
});

test('writes every generated dashboard path plus legacy smoke aliases', () => {
  const env = Object.fromEntries(
    STAGES.map((stage) => [stage.growspaceEnvKey, `growspace-${stage.slug}`]),
  );
  assert.deepEqual(dashboardEnvValues(STAGES, env, INTEGRATION_STAGES), {
    TEST_VEG_DASHBOARD_PATH: '/e2e-veg/0',
    TEST_IRRIGATION_MONITORED_DASHBOARD_PATH: '/e2e-irrigation-monitored/0',
    TEST_LIGHTING_DASHBOARD_PATH: '/e2e-lighting/0',
    // An integration dashboard has no growspace ID beside it, and its path is
    // discovered under exactly the key shape every profile dashboard uses.
    TEST_TC_DASHBOARD_PATH: '/e2e-tc/0',
    TEST_DASHBOARD_PATH: '/e2e-veg/0',
    TEST_GROWSPACE_ID: 'growspace-veg',
  });
});

test('derives an integration dashboard from the declaration, not from a growspace', () => {
  assert.deepEqual(INTEGRATION_STAGES, [{
    slug: 'tc',
    title: 'E2E Tissue Culture',
    card: 'custom:growspace-tc-card',
    integration: 'growspace_manager_tc',
    purpose: 'The standalone host of the tissue-culture view.',
    urlPath: 'e2e-tc',
    dashboardEnvKey: 'TEST_TC_DASHBOARD_PATH',
  }]);
  // No growspace to point it at, so no `growspaceEnvKey` and no
  // `default_growspace`: one panel view holding the declared card and nothing
  // else.
  assert.equal(INTEGRATION_STAGES[0].growspaceEnvKey, undefined);
  assert.deepEqual(
    buildIntegrationDashboardConfig('E2E Tissue Culture', 'custom:growspace-tc-card'),
    {
      views: [{
        title: 'E2E Tissue Culture',
        type: 'panel',
        cards: [{ type: 'custom:growspace-tc-card' }],
      }],
    },
  );
  assert.deepEqual(buildIntegrationDashboardStages({ profiles: [] }), []);
});

test('creates the integration dashboard once and resaves it on rerun', async () => {
  const dashboards = new Set();
  const created = [];
  const saved = [];
  const send = async (message) => {
    if (message.type === 'lovelace/dashboards/list') {
      return { success: true, result: [...dashboards].map((url_path) => ({ url_path })) };
    }
    if (message.type === 'lovelace/dashboards/create') {
      created.push(message);
      dashboards.add(message.url_path);
      return { success: true };
    }
    if (message.type === 'lovelace/config/save') {
      saved.push(message);
      return { success: true };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  };

  await syncIntegrationDashboards({ send, stages: INTEGRATION_STAGES, log: () => {} });
  await syncIntegrationDashboards({ send, stages: INTEGRATION_STAGES, log: () => {} });

  assert.deepEqual([...dashboards], ['e2e-tc']);
  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'E2E Tissue Culture');
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[1].config.views[0].cards, [{ type: 'custom:growspace-tc-card' }]);
});

test('names the integration rather than a profile when a dashboard cannot be saved', async () => {
  await assert.rejects(
    syncIntegrationDashboards({
      send: async (message) => (
        message.type === 'lovelace/config/save'
          ? { success: false, error: { message: 'nope' } }
          : { success: true, result: [{ url_path: 'e2e-tc' }] }
      ),
      stages: INTEGRATION_STAGES,
      log: () => {},
    }),
    /growspace_manager_tc\/tc: could not save e2e-tc/,
  );
});

test('asks Home Assistant nothing when no integration dashboard is declared', async () => {
  await syncIntegrationDashboards({
    send: async () => { throw new Error('should not send'); },
    stages: [],
    log: () => {},
  });
});

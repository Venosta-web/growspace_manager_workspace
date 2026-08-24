const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STAGES,
  buildDashboardConfig,
  syncDashboards,
} = require('./gen-e2e-dashboards.cjs');

const EXPECTED_DASHBOARDS = [
  'e2e-veg',
  'e2e-clone',
  'e2e-mother',
  'e2e-flower',
  'e2e-dry',
  'e2e-cure',
  'e2e-vwc-veg',
  'e2e-vwc-flower',
  'e2e-telemetry-multi',
  'e2e-climate-plain',
  'e2e-vision',
];

test('builds a four-column Sections view with a four-row card for every stage', () => {
  assert.deepEqual(STAGES.map(([urlPath]) => urlPath), EXPECTED_DASHBOARDS);

  for (const [urlPath, envKey, title] of STAGES) {
    const growspaceId = `growspace-${urlPath}`;

    assert.deepEqual(buildDashboardConfig(title, growspaceId), {
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
    }, `${urlPath} (${envKey}) should use the shared desktop layout`);
  }
});

test('resaves every dashboard without creating duplicates on rerun', async () => {
  const dashboards = new Set(['e2e-veg', 'e2e-clone']);
  const created = [];
  const saved = [];
  const env = Object.fromEntries(
    STAGES.map(([urlPath, envKey]) => [envKey, `growspace-${urlPath}`]),
  );

  const send = async (message) => {
    if (message.type === 'lovelace/dashboards/list') {
      return { result: [...dashboards].map((url_path) => ({ url_path })) };
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

  await syncDashboards({ send, env, log: () => {} });
  await syncDashboards({ send, env, log: () => {} });

  assert.deepEqual([...dashboards].sort(), [...EXPECTED_DASHBOARDS].sort());
  assert.equal(created.length, EXPECTED_DASHBOARDS.length - 2);
  assert.equal(saved.length, EXPECTED_DASHBOARDS.length * 2);

  for (const urlPath of EXPECTED_DASHBOARDS) {
    const savesForDashboard = saved.filter((message) => message.url_path === urlPath);
    assert.equal(savesForDashboard.length, 2, `${urlPath} should be updated on both runs`);
  }
});

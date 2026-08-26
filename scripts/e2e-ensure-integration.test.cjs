const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureIntegration } = require('./e2e-ensure-integration.cjs');

test('reuses the one loaded integration entry', async () => {
  const result = await ensureIntegration({
    listEntries: async () => [{ entry_id: 'entry-1', state: 'loaded' }],
    post: async () => assert.fail('must not open a config flow'),
  });
  assert.deepEqual(result, { created: false, entryId: 'entry-1' });
});

test('creates the integration entry through its user config flow', async () => {
  const requests = [];
  const result = await ensureIntegration({
    baseUrl: 'http://ha.local',
    token: 'secret',
    listEntries: async () => [],
    post: async (...args) => {
      requests.push(args.slice(2));
      if (requests.length === 1) return { type: 'form', step_id: 'user', flow_id: 'flow-1' };
      return { type: 'create_entry', result: { entry_id: 'entry-1' } };
    },
  });
  assert.deepEqual(result, { created: true, entryId: 'entry-1' });
  assert.deepEqual(requests, [
    ['/api/config/config_entries/flow', { handler: 'growspace_manager' }],
    ['/api/config/config_entries/flow/flow-1', { name: 'Growspace Manager' }],
  ]);
});

test('waits for an entry that is still setting up', async () => {
  const states = ['setup_in_progress', 'setup_in_progress', 'loaded'];
  let slept = 0;
  const result = await ensureIntegration({
    listEntries: async () => [{ entry_id: 'entry-1', state: states.shift() }],
    post: async () => assert.fail('must not open a config flow'),
    intervalMs: 5,
    sleep: async () => {
      slept += 1;
    },
  });
  assert.deepEqual(result, { created: false, entryId: 'entry-1' });
  assert.equal(slept, 2);
});

test('gives up on an entry that never loads', async () => {
  let ticks = 0;
  await assert.rejects(
    ensureIntegration({
      listEntries: async () => [{ entry_id: 'entry-1', state: 'setup_retry' }],
      timeoutMs: 30,
      intervalMs: 10,
      sleep: async () => {},
      now: () => (ticks += 10),
    }),
    /still setup_retry/,
  );
});

test('refuses duplicate integration entries', async () => {
  await assert.rejects(
    ensureIntegration({ listEntries: async () => [{}, {}] }),
    /found 2/,
  );
});

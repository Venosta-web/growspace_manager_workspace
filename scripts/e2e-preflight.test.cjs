const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectEntityIds,
  serviceCallForState,
  validateBackendPayloads,
  validateEntityStates,
  validateGlobalSettings,
  validateLovelace,
  validateRegistryDevices,
} = require('./e2e-preflight.cjs');

const ENTITY = {
  entity_id: 'input_number.e2e_profile_temperature',
  role: 'environment.temperature',
  profile: 'climate',
  slug: 'profile',
  domain: 'input_number',
  behavior: 'controllable',
};
const MANIFEST = {
  global_settings: {},
  entities: [ENTITY],
  profiles: [{
    profile: 'climate',
    slug: 'profile',
    name: 'E2E Profile',
    growspace_id: 'growspace-1',
    services: { configure_environment: { temperature_sensor: ENTITY.entity_id } },
  }],
};
const OVERVIEW = {
  entity_id: 'sensor.e2e_profile_overview',
  state: '1',
  attributes: {
    identity: { name: 'E2E Profile', growspace_id: 'growspace-1' },
    environment: { temperature_sensor: ENTITY.entity_id },
  },
};

test('live entity and backend validators report the owning capability', () => {
  assert.deepEqual(validateEntityStates(MANIFEST, []), [
    'climate/profile (environment.temperature): missing entity input_number.e2e_profile_temperature',
  ]);
  assert.deepEqual(validateBackendPayloads(MANIFEST, [
    { ...OVERVIEW, attributes: { ...OVERVIEW.attributes, environment: {} } },
  ]), [
    'climate/profile: backend payload dropped configured entity input_number.e2e_profile_temperature',
  ]);
  assert.match(validateBackendPayloads(
    { ...MANIFEST, profiles: [{ ...MANIFEST.profiles[0], growspace_id: 'growspace-2' }] },
    [OVERVIEW],
  )[0], /backend growspace_id/);
});

test('validates available entities and a retained backend payload', () => {
  const states = [
    { entity_id: ENTITY.entity_id, state: '25', attributes: {} },
    OVERVIEW,
  ];
  assert.deepEqual(validateEntityStates(MANIFEST, states), []);
  assert.deepEqual(validateBackendPayloads(MANIFEST, states), []);
});

test('extracts nested configured entities and maps writable domains to safe no-op calls', () => {
  assert.deepEqual(collectEntityIds({ sensors: [ENTITY.entity_id], value: 3 }), [ENTITY.entity_id]);
  assert.deepEqual(serviceCallForState({ entity_id: ENTITY.entity_id, state: '24.5' }), {
    domain: 'input_number',
    service: 'set_value',
    data: { entity_id: ENTITY.entity_id, value: 24.5 },
  });
  assert.deepEqual(serviceCallForState({ entity_id: 'switch.e2e_pump', state: 'off' }), {
    domain: 'switch',
    service: 'turn_off',
    data: { entity_id: 'switch.e2e_pump' },
  });
  assert.deepEqual(serviceCallForState({ entity_id: 'humidifier.e2e_tent', state: 'idle' }), {
    domain: 'humidifier',
    service: 'turn_on',
    data: { entity_id: 'humidifier.e2e_tent' },
  });
});

test('requires manifest global settings on the single integration entry', () => {
  const manifest = { global_settings: { units: 'metric', location: 'indoor' } };
  const entry = { options: { units: 'metric', location: 'indoor', unrelated: true } };
  assert.deepEqual(validateGlobalSettings(manifest, [entry]), []);
  assert.deepEqual(validateGlobalSettings(manifest, []), [
    'global settings: expected one Growspace Manager config entry, found 0',
  ]);
  assert.deepEqual(validateGlobalSettings(manifest, [{ options: { ...entry.options, units: 'imperial' } }]), [
    'global settings: units is "imperial", expected "metric"',
  ]);
});

test('requires one correctly bound dashboard and one resource per manifest profile', () => {
  const stages = [{ url_path: 'e2e-profile' }];
  const resources = [{ url: '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js?v=123' }];
  const configs = new Map([['e2e-profile', {
    views: [{ sections: [{ cards: [{
      type: 'custom:growspace-manager-card',
      default_growspace: 'growspace-1',
    }] }] }],
  }]]);
  assert.deepEqual(validateLovelace(MANIFEST, stages, resources, configs), []);
  assert.match(validateLovelace(MANIFEST, [], resources, new Map())[0], /missing dashboard/);
});

test('checks registry platform and stable device bundles', () => {
  const manifest = {
    entities: [
      { ...ENTITY, entity_id: 'number.e2e_port_speed', device_key: 'port', platform: 'ac_infinity' },
      { ...ENTITY, entity_id: 'select.e2e_port_mode', device_key: 'port', platform: 'ac_infinity' },
    ],
  };
  const registry = [
    { entity_id: 'number.e2e_port_speed', platform: 'ac_infinity', device_id: 'device-1' },
    { entity_id: 'select.e2e_port_mode', platform: 'ac_infinity', device_id: 'device-1' },
  ];
  assert.deepEqual(validateRegistryDevices(manifest, registry), []);
  assert.match(validateRegistryDevices(manifest, registry.slice(0, 1))[0], /absent from the entity registry/);
});

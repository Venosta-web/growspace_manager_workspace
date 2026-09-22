const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PROFILE,
  DIMENSIONS,
  PROCEDURE,
  parseArgs,
  pickDevice,
  printAll,
  recordSkeleton,
  resolveDensities,
} = require('./label-evidence-print');

const PROFILE = {
  id: DEFAULT_PROFILE,
  label_size_id: 'growspace.stock.50x30.v1',
  density_levels: { low: 2, normal: 3, high: 5 },
  supported_element_rotations: [0],
};

const B1 = {
  id: 'dev-b1',
  name: 'Niimbot B1',
  model: 'B1',
  sw_version: '5.14',
  identifiers: [['niimbot', 'AA:BB']],
};
const LAMP = { id: 'dev-lamp', name: 'Lamp', identifiers: [['hue', '1']] };

test('defaults print every density once on the first B1 profile', () => {
  const options = parseArgs([]);
  assert.equal(options.profile, DEFAULT_PROFILE);
  assert.deepEqual(options.densities, []);
  assert.equal(options.copies, 1);
  assert.equal(options.device, null);
});

test('options are read, and densities accumulate', () => {
  const options = parseArgs([
    '--density', 'low', '--density', 'high', '--copies', '5',
    '--device', 'dev-b1', '--base-url', 'http://ha.local:8123',
  ]);
  assert.deepEqual(options.densities, ['low', 'high']);
  assert.equal(options.copies, 5);
  assert.equal(options.device, 'dev-b1');
  assert.equal(options.baseUrl, 'http://ha.local:8123');
});

test('a copy count that is not a positive whole number is refused', () => {
  assert.throws(() => parseArgs(['--copies', '0']), /positive whole number/);
  assert.throws(() => parseArgs(['--copies', '1.5']), /positive whole number/);
});

test('an unknown option or a missing value is refused with the usage', () => {
  assert.throws(() => parseArgs(['--nope']), /Unknown option --nope[\s\S]*usage/);
  assert.throws(() => parseArgs(['--density']), /--density needs a value/);
  assert.throws(() => parseArgs(['--density', '--copies']), /--density needs a value/);
});

test('the one Niimbot printer is chosen without asking', () => {
  assert.equal(pickDevice([LAMP, B1], null), B1);
});

test('no printer, or several, is refused rather than guessed', () => {
  assert.throws(() => pickDevice([LAMP], null), /No Niimbot printer/);
  const other = { ...B1, id: 'dev-b1-2', name: 'Second B1' };
  assert.throws(() => pickDevice([B1, other], null), /2 Niimbot printers[\s\S]*dev-b1-2/);
});

test('a named device is used, and an unknown one lists the printers', () => {
  assert.equal(pickDevice([LAMP, B1], 'dev-b1'), B1);
  assert.throws(() => pickDevice([LAMP, B1], 'dev-x'), /No device dev-x[\s\S]*dev-b1/);
});

test('a printer registered by Bluetooth connection alone is found through its entities', () => {
  const b1 = { id: 'dev-b1', name: 'Niimbot 6649B9', model: 'B1', identifiers: [] };
  const entities = [
    { entity_id: 'light.lamp', platform: 'hue', device_id: 'dev-lamp' },
    { entity_id: 'sensor.niimbot_6649b9_battery', platform: 'niimbot', device_id: 'dev-b1' },
  ];
  assert.equal(pickDevice([LAMP, b1], null, entities), b1);
  assert.throws(() => pickDevice([LAMP, b1], null, []), /No Niimbot printer/);
});

test('densities default to every one the profile maps', () => {
  assert.deepEqual(resolveDensities(PROFILE, []), ['low', 'normal', 'high']);
  assert.deepEqual(resolveDensities(PROFILE, ['high']), ['high']);
  assert.throws(() => resolveDensities(PROFILE, ['extra']), /maps no density extra/);
});

test('the record skeleton names every field the product requires, left empty', () => {
  const record = recordSkeleton({
    profile: PROFILE,
    capability: { versions: { compiler: 'c1', qr_model: 'q1' } },
    device: B1,
    prints: [{ density: 'low' }, { density: 'high' }, { density: 'high' }],
    recordedOn: '2026-09-21',
  });
  assert.equal(record.procedure, PROCEDURE);
  assert.equal(record.printer_model, 'B1');
  assert.equal(record.firmware, '5.14');
  assert.equal(record.stock, PROFILE.label_size_id);
  for (const field of ['reference', 'profile_definition', 'driver', 'operator', 'reviewed_by']) {
    assert.equal(record[field], '', field);
  }
  assert.deepEqual(Object.keys(record.results), DIMENSIONS);
  assert.equal(record.results.edges.passed, false);
  assert.deepEqual(record.results.rotation.covers, ['0']);
  assert.deepEqual(record.results.density.covers, ['low', 'high']);
  assert.equal(record.dependencies.compiler, 'c1');
  assert.equal(record.dependencies.qr_model, 'q1');
});

test('every density is printed the asked number of times with the contract', async () => {
  const sent = [];
  const send = async (command) => {
    sent.push(command);
    return {
      success: true,
      result: { outcome: 'ok', print: { raster_identity: `r-${command.density}` } },
    };
  };
  const prints = await printAll({
    send,
    profile: PROFILE,
    device: B1,
    densities: ['low', 'high'],
    copies: 2,
    contract: { family: 'f', major: 1 },
    log: () => {},
  });
  assert.equal(sent.length, 4);
  assert.deepEqual(sent[0], {
    type: 'growspace_manager/print_label_evidence_sheet',
    contract: { family: 'f', major: 1 },
    profile_id: PROFILE.id,
    device_id: 'dev-b1',
    density: 'low',
  });
  assert.deepEqual(prints.map((item) => [item.density, item.copy]), [
    ['low', 1], ['low', 2], ['high', 1], ['high', 2],
  ]);
  assert.equal(prints[3].raster_identity, 'r-high');
});

test('a refused print stops the run and says why', async () => {
  const send = async () => ({
    success: true,
    result: {
      outcome: 'refused',
      refusal: { code: 'label_template.print_failed', reason: 'out of labels' },
    },
  });
  await assert.rejects(
    printAll({
      send, profile: PROFILE, device: B1, densities: ['low'], copies: 3,
      contract: {}, log: () => {},
    }),
    /low copy 1 was refused \(label_template.print_failed\): out of labels/,
  );
});

test('a command Home Assistant does not know is reported as such', async () => {
  const send = async () => ({ success: false, error: { message: 'Unknown command.' } });
  await assert.rejects(
    printAll({
      send, profile: PROFILE, device: B1, densities: ['low'], copies: 1,
      contract: {}, log: () => {},
    }),
    /rejected the print: Unknown command/,
  );
});

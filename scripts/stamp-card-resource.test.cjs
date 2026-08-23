const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HASH_LENGTH,
  hostPathFor,
  hostPathForResource,
  joinResourceUrl,
  mountsOf,
  shortHash,
  splitResourceUrl,
  stampResources,
} = require('./stamp-card-resource.cjs');

// The shape `docker compose config --format json` returns for the dev service.
const COMPOSE = {
  services: {
    'ha-dev': {
      volumes: [
        { type: 'bind', source: '/ws/ha-dev', target: '/config' },
        {
          type: 'bind',
          source: '/repos/growspace_manager/custom_components/growspace_manager',
          target: '/config/custom_components/growspace_manager',
        },
        {
          type: 'bind',
          source: '/repos/card/dist',
          target: '/config/www/community/lovelace-growspace-manager-card',
          read_only: true,
        },
      ],
    },
    'ha-test': { volumes: [{ type: 'bind', source: '/ws/ha-test', target: '/config' }] },
  },
};

const MOUNTS = mountsOf(COMPOSE, 'ha-dev');
const CARD_URL = '/local/community/lovelace-growspace-manager-card/growspace-manager-card.js';

test('resolves a resource through the deepest mount that covers it', () => {
  // The card's dist/ is mounted *inside* /config, so a naive first-match on the
  // mount list would resolve the card entry to ha-dev/www/... — a path that does
  // not exist — and the stamp would silently become a no-op.
  assert.equal(hostPathForResource(CARD_URL, MOUNTS), '/repos/card/dist/growspace-manager-card.js');
  assert.equal(hostPathForResource('/local/some-other.js', MOUNTS), '/ws/ha-dev/www/some-other.js');
});

test('mounts come from the named service only', () => {
  assert.deepEqual(mountsOf(COMPOSE, 'ha-test'), [{ source: '/ws/ha-test', target: '/config' }]);
  assert.deepEqual(mountsOf(COMPOSE, 'nope'), []);
});

test('a container path outside every mount resolves to nothing', () => {
  assert.equal(hostPathFor('/usr/src/app', MOUNTS), null);
  // A target is a directory boundary, not a string prefix.
  assert.equal(hostPathFor('/config-backup/x', MOUNTS), null);
});

test('only site-absolute local URLs are candidates', () => {
  assert.equal(splitResourceUrl('https://cdn.example/thing.js'), null);
  assert.equal(splitResourceUrl(undefined), null);
  assert.equal(hostPathForResource('/api/hassio/app/entry.js', MOUNTS), null);
});

test('stamps the entry with a content hash of the file it resolves to', () => {
  const items = [{ id: 'abc', type: 'module', url: CARD_URL }];
  const { items: stamped, changes } = stampResources(items, () => 'deadbeef1234');

  assert.deepEqual(stamped, [{ id: 'abc', type: 'module', url: `${CARD_URL}?v=deadbeef1234` }]);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    from: CARD_URL,
    to: `${CARD_URL}?v=deadbeef1234`,
    urlPath: CARD_URL,
    hash: 'deadbeef1234',
  });
});

test('a rebuild that changes nothing leaves the URL alone', () => {
  // The whole point of hashing content rather than stamping a timestamp: an
  // unchanged bundle must stay in the browser's cache.
  const items = [{ id: 'abc', type: 'module', url: `${CARD_URL}?v=deadbeef1234` }];
  const { items: stamped, changes } = stampResources(items, () => 'deadbeef1234');

  assert.deepEqual(stamped, items);
  assert.deepEqual(changes, []);
});

test('a changed bundle replaces the old stamp rather than appending one', () => {
  const items = [{ id: 'abc', type: 'module', url: `${CARD_URL}?v=oldoldoldold` }];
  const { items: stamped } = stampResources(items, () => 'newnewnewnew');

  assert.deepEqual(stamped, [{ id: 'abc', type: 'module', url: `${CARD_URL}?v=newnewnewnew` }]);
});

test('unrelated query parameters survive the stamp', () => {
  const items = [{ id: 'abc', type: 'module', url: `${CARD_URL}?hacstag=1.2.3` }];
  const { items: stamped } = stampResources(items, () => 'deadbeef1234');

  assert.equal(stamped[0].url, `${CARD_URL}?hacstag=1.2.3&v=deadbeef1234`);
});

test('an unhashable resource is left exactly as it was', () => {
  // `hashFor` returns null when dist/ is absent or the URL is not ours. Neither
  // is an error, and neither may strip a stamp that is still correct.
  const items = [
    { id: 'abc', type: 'module', url: `${CARD_URL}?v=stillcorrect` },
    { id: 'def', type: 'module', url: 'https://cdn.example/thing.js' },
  ];
  const { items: stamped, changes } = stampResources(items, () => null);

  assert.deepEqual(stamped, items);
  assert.deepEqual(changes, []);
});

test('every other field of a resource is preserved', () => {
  const items = [{ id: 'abc', type: 'module', url: CARD_URL, extra: { kept: true } }];
  const { items: stamped } = stampResources(items, () => 'deadbeef1234');

  assert.deepEqual(stamped[0].extra, { kept: true });
  assert.equal(stamped[0].id, 'abc');
});

test('joinResourceUrl drops an empty query entirely', () => {
  assert.equal(joinResourceUrl('/local/a.js', new URLSearchParams('')), '/local/a.js');
  assert.equal(joinResourceUrl('/local/a.js', new URLSearchParams('v=1')), '/local/a.js?v=1');
});

test('the hash is stable, content-derived and short enough to read', () => {
  assert.equal(shortHash('same'), shortHash('same'));
  assert.notEqual(shortHash('same'), shortHash('different'));
  assert.match(shortHash('same'), new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`));
});

#!/usr/bin/env node
'use strict';
//
// Cache-bust the dev instance's registered Lovelace resources.
//
//   node scripts/stamp-card-resource.cjs [service]     # default: ha-dev
//
// Two browser caches sit on one URL that never changes shape. HA serves
// /local/ with `Cache-Control: public, max-age=2678400`, so a warm browser will
// not ask again for 31 days; and HA's service worker answers from its own Cache
// Storage, which Ctrl+Shift+R does not bypass. A card rebuild therefore lands on
// disk, is served correctly by HA, and is still invisible in the browser.
// `./scripts/ha dev restart` cannot help: the staleness is not in the bind mount.
//
// HACS installs escape this because HACS appends `?hacstag=<version>`. The dev
// resource was registered by hand without one, so its URL is byte-identical
// across every build. This script gives it the same defence: it stamps `?v=` with
// a short content hash of the file the resource resolves to. A changed URL is a
// different cache key in both layers at once.
//
// Why here, and why like this:
//
//   * Direct file edit, not the WebSocket API. `.storage` is a plain host file
//     (the hub's core design rule), so this needs no token and no running HA.
//     `scripts/ha` calls it while the container is STOPPED — a running instance
//     holds lovelace_resources in memory and could flush its own copy back over
//     ours on shutdown.
//   * In the hub, not a card postbuild. A postbuild would need HA up and
//     credentials to reach the WS API, which a plain `npm run build` must not.
//   * Content hash, not a timestamp: a rebuild that changes nothing must leave
//     the URL alone, so unchanged bundles stay cached.
//   * The entry only, and only because that is all that is registered. The ~16
//     lazy chunks carry their hash in the filename, so their URLs already move.
//
// Nothing here is card-specific: every registered `/local/...` resource is
// resolved through the container's own bind mounts, so what gets stamped is
// whatever this compose file actually serves.
//
// This never exits non-zero. It is a convenience layer over the dev loop, and
// losing the runtime over a cache hint would invert the priority — every
// abnormal condition prints a note and returns 0.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WS = path.resolve(__dirname, '..');
const HASH_LENGTH = 12;
const STAMP_PARAM = 'v';

// HA's static handler maps this URL prefix onto www/ inside the config dir.
const WWW_URL_PREFIX = '/local/';
const WWW_CONTAINER_DIR = '/config/www';

// ---------------------------------------------------------------------------
// Pure core (unit-tested in stamp-card-resource.test.cjs)
// ---------------------------------------------------------------------------

/**
 * Bind mounts of one compose service, as {source, target} host/container pairs.
 * Sorted deepest target first so a prefix match hits the most specific mount:
 * `/config/www/community/...` must win over `/config`.
 */
function mountsOf(composeConfig, service) {
  const svc = (composeConfig.services || {})[service];
  if (!svc) return [];
  return (svc.volumes || [])
    .filter((v) => v.type === 'bind' && v.source && v.target)
    .map((v) => ({ source: v.source, target: v.target }))
    .sort((a, b) => b.target.length - a.target.length);
}

/** The host file a container path resolves to, or null if nothing mounts it. */
function hostPathFor(containerPath, mounts) {
  for (const { source, target } of mounts) {
    if (containerPath === target) return source;
    if (containerPath.startsWith(`${target}/`)) {
      return path.join(source, containerPath.slice(target.length + 1));
    }
  }
  return null;
}

/**
 * Split a registered resource URL into its path and its query parameters.
 * Returns null for anything that is not a site-absolute local URL — an
 * external CDN resource is not ours to stamp.
 */
function splitResourceUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) return null;
  const cut = url.indexOf('?');
  const urlPath = cut === -1 ? url : url.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? '' : url.slice(cut + 1));
  return { urlPath, params };
}

/** Reassemble a resource URL, dropping the `?` entirely when nothing is left. */
function joinResourceUrl(urlPath, params) {
  const query = params.toString();
  return query ? `${urlPath}?${query}` : urlPath;
}

/** The host file a `/local/...` resource URL is served from, or null. */
function hostPathForResource(urlPath, mounts) {
  if (!urlPath.startsWith(WWW_URL_PREFIX)) return null;
  const containerPath = `${WWW_CONTAINER_DIR}/${urlPath.slice(WWW_URL_PREFIX.length)}`;
  return hostPathFor(containerPath, mounts);
}

function shortHash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Restamp every resource whose URL `hashFor` can hash.
 *
 * `hashFor(urlPath)` returns a content hash, or null when the file is not there
 * — an absent dist/ leaves the URL exactly as it was rather than stripping a
 * stamp that is still correct for whatever comes back.
 *
 * Returns the rewritten items plus one record per resource that moved, so the
 * caller can report what it did without re-deriving it.
 */
function stampResources(items, hashFor) {
  const changes = [];
  const stamped = items.map((item) => {
    const split = splitResourceUrl(item.url);
    if (!split) return item;

    const hash = hashFor(split.urlPath);
    if (!hash || split.params.get(STAMP_PARAM) === hash) return item;

    split.params.set(STAMP_PARAM, hash);
    const url = joinResourceUrl(split.urlPath, split.params);
    changes.push({ from: item.url, to: url, urlPath: split.urlPath, hash });
    return { ...item, url };
  });
  return { items: stamped, changes };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const note = (msg) => process.stdout.write(`   stamp: ${msg}\n`);

function composeConfig() {
  const json = execFileSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: WS,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(json);
}

function main(service) {
  // Ask compose what it actually mounts rather than re-deriving it here. The
  // card's dist/ is overridable (GROWSPACE_CARD_DIST) and the config dir is a
  // mount like any other, so this is the only resolution guaranteed to name the
  // same files the container will serve.
  const mounts = mountsOf(composeConfig(), service);
  if (mounts.length === 0) {
    note(`no bind mounts for service '${service}' — nothing to stamp`);
    return;
  }

  const configDir = hostPathFor('/config', mounts);
  if (!configDir) {
    note(`service '${service}' does not mount /config — nothing to stamp`);
    return;
  }

  const storePath = path.join(configDir, '.storage', 'lovelace_resources');
  if (!fs.existsSync(storePath)) {
    note('no Lovelace resources registered yet');
    return;
  }

  const raw = fs.readFileSync(storePath, 'utf8');
  const store = JSON.parse(raw);
  const items = (store.data && store.data.items) || [];
  if (items.length === 0) {
    note('no Lovelace resources registered yet');
    return;
  }

  const missing = [];
  let hashed = 0;
  const hashFor = (urlPath) => {
    const hostPath = hostPathForResource(urlPath, mounts);
    if (!hostPath) return null;
    if (!fs.existsSync(hostPath)) {
      missing.push(urlPath);
      return null;
    }
    hashed += 1;
    return shortHash(fs.readFileSync(hostPath));
  };

  const { items: stamped, changes } = stampResources(items, hashFor);
  for (const urlPath of missing) note(`${urlPath} is not built — left unstamped`);

  if (changes.length === 0) {
    // Only claim the URLs are current if something was actually hashed;
    // otherwise the notes above are the whole story.
    if (hashed > 0) note('resource URLs already match the built files');
    return;
  }

  store.data.items = stamped;
  // HA writes .storage with orjson's two-space indent and no trailing newline;
  // match it so this edit does not show up as a whole-file rewrite next time HA
  // saves. Write through a temp file so a crash cannot truncate the store.
  const tmp = `${storePath}.stamp.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o644 });
  fs.renameSync(tmp, storePath);

  for (const { urlPath, hash } of changes) {
    process.stdout.write(`→ stamped ${path.basename(urlPath)} ?${STAMP_PARAM}=${hash}\n`);
  }
}

if (require.main === module) {
  try {
    main(process.argv[2] || 'ha-dev');
  } catch (err) {
    // Deliberately not fatal — see the header.
    note(`skipped (${err.message.split('\n')[0]})`);
  }
}

module.exports = {
  HASH_LENGTH,
  STAMP_PARAM,
  hostPathFor,
  hostPathForResource,
  joinResourceUrl,
  mountsOf,
  shortHash,
  splitResourceUrl,
  stampResources,
};

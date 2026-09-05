"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertTestInstance,
  brokenModules,
  findCardRepository,
  formatWalk,
  hacsConfigEntry,
  hacsRepositoryRow,
  parseArguments,
  parseModuleSpecifiers,
  resolveSpecifier,
  ulid,
  walkImportGraph,
  withHacsEntry,
  withHacsRepository,
} = require("./card-hacs-update");

const TEST_TARGET = {
  baseUrl: "http://localhost:8124",
  configDir: "/ws/ha-test",
};

test("refuses the dev instance by port and by config directory", () => {
  // Both halves matter: the port is what a --base-url typo reaches, and the
  // config directory is what a --config-dir typo reaches. On :8123 the card
  // directory is a read-only bind mount of dist/, so a HACS download there
  // takes the dev loop with it.
  assert.doesNotThrow(() => assertTestInstance(TEST_TARGET));
  assert.throws(
    () => assertTestInstance({ ...TEST_TARGET, baseUrl: "http://localhost:8123" }),
    /dev port/,
  );
  assert.throws(
    () => assertTestInstance({ ...TEST_TARGET, configDir: "/ws/ha-dev" }),
    /dev config directory/,
  );
});

test("reads the import forms rollup emits, minified or not", () => {
  assert.deepEqual(
    parseModuleSpecifiers('import{a}from"./x.js";import"./y.js";'),
    ["./x.js", "./y.js"],
  );
  assert.deepEqual(parseModuleSpecifiers('export{a}from"./e.js"'), ["./e.js"]);
  assert.deepEqual(parseModuleSpecifiers('export * from "./f.js"'), ["./f.js"]);
  assert.deepEqual(parseModuleSpecifiers('import("./lazy.js")'), ["./lazy.js"]);
  assert.deepEqual(parseModuleSpecifiers('import * as z from "lit";'), ["lit"]);
});

test("a commented import is not an import", () => {
  // This exact line ships inside the bundle — it is zod's own source, carried
  // through unminified — and reading it as an import cost a false 404 that
  // failed the whole run.
  assert.deepEqual(
    parseModuleSpecifiers(
      '// import { $ZodType } from "./schemas.js";\nimport"./real.js";',
    ),
    ["./real.js"],
  );
  assert.deepEqual(
    parseModuleSpecifiers('/* import x from "./b.js" */\nimport x from "./c.js"'),
    ["./c.js"],
  );
  assert.deepEqual(parseModuleSpecifiers('const important="./nope.js";'), []);
  assert.deepEqual(
    parseModuleSpecifiers('const t=`from "./fake.js"`;import("./real.js")'),
    ["./real.js"],
  );
});

test("specifiers resolve the way a browser resolves them", () => {
  const entry = "http://h/hacsfiles/card/entry.js?hacstag=105217085413048";
  // The importer's ?hacstag is HACS's cache-bust for the entry alone. Chunks
  // are requested without it, which is why a stale chunk set 404s.
  assert.equal(
    resolveSpecifier("./chunk.js", entry),
    "http://h/hacsfiles/card/chunk.js",
  );
  assert.equal(
    resolveSpecifier("../other/chunk.js", entry),
    "http://h/hacsfiles/other/chunk.js",
  );
  assert.equal(resolveSpecifier("/root.js", entry), "http://h/root.js");
  assert.equal(resolveSpecifier("lit", entry), null);
});

// Home Assistant serves the file whatever query the URL carries, so the fake
// ignores it exactly as the static handler does.
function fakeModules(bodies) {
  return async (url) => {
    const path = url.split("?")[0];
    return path in bodies
      ? { status: 200, body: bodies[path] }
      : { status: 404, body: "" };
  };
}

test("walks the graph, follows each module once, and does not follow a 404", () => {
  const entry = "http://h/c/entry.js?hacstag=1";
  const fetchModule = fakeModules({
    "http://h/c/entry.js": 'import"./a.js";import"./b.js";',
    "http://h/c/a.js": 'import"./shared.js";import"./missing.js";',
    "http://h/c/b.js": 'import"./shared.js";',
    "http://h/c/shared.js": "",
  });
  return walkImportGraph({ entryUrl: entry, fetchModule }).then((records) => {
    assert.deepEqual(
      records.map((record) => [record.url.replace("http://h/c/", ""), record.status]),
      [
        ["entry.js?hacstag=1", 200],
        ["a.js", 200],
        ["b.js", 200],
        ["shared.js", 200],
        ["missing.js", 404],
      ],
    );
    assert.deepEqual(
      brokenModules(records).map((record) => record.url),
      ["http://h/c/missing.js"],
    );
  });
});

test("a bare specifier is reported but never fetched or counted broken", async () => {
  const fetched = [];
  const records = await walkImportGraph({
    entryUrl: "http://h/c/entry.js",
    fetchModule: async (url) => {
      fetched.push(url);
      return { status: 200, body: 'import"lit";' };
    },
  });
  assert.deepEqual(fetched, ["http://h/c/entry.js"]);
  assert.deepEqual(records[1], {
    url: "lit",
    importer: "http://h/c/entry.js",
    status: null,
    bytes: 0,
  });
  assert.deepEqual(brokenModules(records), []);
});

test("the walk stops at its limit rather than chasing a cycle forever", async () => {
  let served = 0;
  const records = await walkImportGraph({
    entryUrl: "http://h/c/0.js",
    limit: 5,
    fetchModule: async () => {
      served += 1;
      return { status: 200, body: `import"./${served}.js";` };
    },
  });
  assert.equal(records.length, 5);
});

test("the report names the failures and totals them", () => {
  const records = [
    { url: "http://h/c/entry.js", importer: null, status: 200, bytes: 10 },
    {
      url: "http://h/c/gone.js",
      importer: "http://h/c/entry.js",
      status: 404,
      bytes: 0,
    },
  ];
  const report = formatWalk(records, { baseUrl: "http://h" });
  assert.match(report, /404 {2}\/c\/gone\.js {2}← entry\.js/);
  assert.match(report, /✗ 1 of 2 modules are not 200/);
  assert.match(
    formatWalk([records[0]], { baseUrl: "http://h" }),
    /✓ 1 modules, every one served/,
  );
});

test("the seeded HACS config entry looks like one the device flow wrote", () => {
  const entry = hacsConfigEntry({ token: "gh-token", now: new Date(0) });
  assert.deepEqual(entry.data, { token: "gh-token" });
  assert.equal(entry.domain, "hacs");
  // SOURCE_IMPORT makes HACS delete its own entry on startup.
  assert.equal(entry.source, "user");
  assert.equal(entry.options.experimental, true);
  assert.match(entry.entry_id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("a second run does not add a second HACS entry", () => {
  const storage = { data: { entries: [{ domain: "sun" }] } };
  const added = withHacsEntry(storage, hacsConfigEntry({ token: "t" }));
  assert.equal(added.data.entries.length, 2);
  assert.equal(added.data.entries[0].domain, "sun");
  assert.equal(withHacsEntry(added, hacsConfigEntry({ token: "t" })), null);
});

test("the seeded repository row survives HACS's startup prune", () => {
  const row = hacsRepositoryRow({ installedVersion: "v1.3.0-next.10" });
  // HACS unregisters every custom repository that is not downloaded during the
  // startup category refresh, and filters unfetched ones out of its own list —
  // so a row missing either of these is registered and then gone.
  assert.equal(row.installed, true);
  assert.ok(row.last_fetched > 0);
  // Without show_beta HACS filters away every release this repository has.
  assert.equal(row.show_beta, true);
  assert.equal(row.category, "plugin");
});

test("the repository store is created or merged, never replaced", () => {
  const created = withHacsRepository(null, "1", hacsRepositoryRow({}));
  // HACS compares its store version as a string and ignores the file otherwise.
  assert.equal(created.version, "6");
  assert.equal(created.key, "hacs.repositories");

  const store = { version: "6", data: { 99: { full_name: "other/repo" } } };
  const merged = withHacsRepository(store, "1", hacsRepositoryRow({}));
  assert.deepEqual(merged.data["99"], { full_name: "other/repo" });
  assert.equal(merged.data["1"].category, "plugin");

  const again = withHacsRepository(merged, "1", hacsRepositoryRow({ showBeta: false }));
  assert.equal(again.data["1"].show_beta, false);
});

test("switches do not swallow the tags that follow them", () => {
  const parsed = parseArguments([
    "--reset",
    "v1.3.0-next.10",
    "v1.3.0-next.48",
    "--base-url",
    "http://localhost:8124",
  ]);
  assert.deepEqual(parsed.positional, ["v1.3.0-next.10", "v1.3.0-next.48"]);
  assert.equal(parsed.options["--base-url"], "http://localhost:8124");
  assert.ok(parsed.switches.has("--reset"));
  assert.throws(() => parseArguments(["--nope"]), /unknown option/);
  assert.throws(() => parseArguments(["--base-url"]), /needs a value/);
});

test("entry ids are ULIDs, because HA repairs anything else", () => {
  const early = ulid(0);
  const later = ulid(1_000_000_000_000);
  assert.equal(early.length, 26);
  assert.match(later, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(later > early);
});

test("the card repository is matched however GitHub cases it", () => {
  const repositories = [
    { full_name: "someone/else", id: "1" },
    { full_name: "venosta-web/LOVELACE-growspace-manager-card", id: "2" },
  ];
  assert.equal(findCardRepository(repositories).id, "2");
  assert.equal(findCardRepository([repositories[0]]), undefined);
});

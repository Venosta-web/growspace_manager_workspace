"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  annotationLines,
  brokenModuleRows,
  jobSummary,
  moduleName,
  parseArguments,
  previousReleaseTag,
  releaseChannel,
  resolvePreviousTag,
} = require("./card-release-update-check");

const release = (tag, published_at, extra = {}) => ({
  tag_name: tag,
  published_at,
  prerelease: tag.includes("-next."),
  draft: false,
  ...extra,
});

const HISTORY = [
  release("v1.4.0-next.2", "2026-03-04T00:00:00Z"),
  release("v1.4.0-next.1", "2026-03-03T00:00:00Z"),
  release("v1.3.0", "2026-03-02T00:00:00Z"),
  release("v1.3.0-next.48", "2026-03-01T00:00:00Z"),
  release("v1.2.0", "2026-02-01T00:00:00Z"),
];

test("a stable release is checked against the previous stable, not the prereleases between", () => {
  // show_beta is off on a stable install, so every -next tag in between is
  // invisible to it. Pairing v1.3.0 with v1.3.0-next.48 would replay an
  // update no stable-channel user is ever offered.
  assert.equal(previousReleaseTag(HISTORY, "v1.3.0"), "v1.2.0");
});

test("a prerelease is checked against whatever was published before it", () => {
  // show_beta is what puts a prerelease within reach, and it does not hide
  // the stable releases — so the previous release of any kind is the one a
  // beta-channel install is actually updating from.
  assert.equal(previousReleaseTag(HISTORY, "v1.4.0-next.1"), "v1.3.0");
  assert.equal(previousReleaseTag(HISTORY, "v1.4.0-next.2"), "v1.4.0-next.1");
});

test("the oldest release has nothing to update from", () => {
  assert.equal(previousReleaseTag(HISTORY, "v1.2.0"), null);
});

test("drafts are not releases, and an unknown tag is an error rather than a pair", () => {
  const withDraft = [
    release("v1.5.0", "2026-04-01T00:00:00Z"),
    release("v1.4.1", "2026-03-20T00:00:00Z", { draft: true }),
    release("v1.4.0", "2026-03-10T00:00:00Z"),
  ];
  assert.equal(previousReleaseTag(withDraft, "v1.5.0"), "v1.4.0");
  assert.throws(() => previousReleaseTag(withDraft, "v9.9.9"), /no published release is tagged v9\.9\.9/);
});

test("a tag with a semver prerelease component is a prerelease whatever the flag says", () => {
  assert.equal(releaseChannel({ tag_name: "v1.3.0-next.4", prerelease: false }), "prerelease");
  assert.equal(releaseChannel({ tag_name: "v1.3.0", prerelease: true }), "prerelease");
  assert.equal(releaseChannel({ tag_name: "v1.3.0" }), "stable");
});

test("pages are fetched only until the predecessor is in hand", async () => {
  const pages = [
    [
      release("v2.0.0", "2026-05-01T00:00:00Z"),
      ...Array.from({ length: 99 }, (_, index) => {
        const number = 99 - index;
        return release(
          `v2.0.0-next.${number}`,
          new Date(Date.UTC(2026, 3, 1) + number * 60_000).toISOString(),
        );
      }),
    ],
    [release("v1.9.0", "2026-01-01T00:00:00Z")],
  ];
  const asked = [];
  const fetchPage = async (page) => {
    asked.push(page);
    return pages[page - 1] ?? [];
  };

  // The prerelease's predecessor is on the first page, so nothing else is read.
  assert.equal(await resolvePreviousTag({ tag: "v2.0.0-next.99", fetchPage }), "v2.0.0-next.98");
  assert.deepEqual(asked, [1]);

  // The stable's predecessor is a hundred prereleases back, which is the only
  // reason the second page is ever requested.
  asked.length = 0;
  assert.equal(await resolvePreviousTag({ tag: "v2.0.0", fetchPage }), "v1.9.0");
  assert.deepEqual(asked, [1, 2]);
});

test("paging stops at the end of the history instead of asking forever", async () => {
  const asked = [];
  const fetchPage = async (page) => {
    asked.push(page);
    return page === 1 ? [release("v1.0.0", "2026-01-01T00:00:00Z")] : [];
  };
  assert.equal(await resolvePreviousTag({ tag: "v1.0.0", fetchPage }), null);
  assert.deepEqual(asked, [1]);
});

const BROKEN_REPORT = {
  from: "v1.3.0-next.10",
  to: "v1.3.0-next.48",
  steps: [
    {
      label: "after installing v1.3.0-next.10",
      files: ["growspace-manager-card.js"],
      modules: [{ url: "http://h/hacsfiles/card/growspace-manager-card.js?hacstag=1", importer: null, status: 200 }],
    },
    {
      label: "after updating to v1.3.0-next.48",
      files: ["growspace-manager-card.js", "growspace-dialogs-b57c82.js"],
      modules: [
        { url: "http://h/hacsfiles/card/growspace-manager-card.js?hacstag=2", importer: null, status: 200 },
        {
          url: "http://h/hacsfiles/card/growspace-dialogs-a1b2c3.js",
          importer: "http://h/hacsfiles/card/growspace-manager-card.js?hacstag=2",
          status: 404,
        },
        { url: "lit", importer: "http://h/hacsfiles/card/growspace-manager-card.js?hacstag=2", status: null },
      ],
    },
  ],
};

test("a module that was never followed is not a broken module", () => {
  // A bare specifier is recorded with a null status because nothing resolved
  // it. Reading that as a failure would fail every run.
  const rows = brokenModuleRows(BROKEN_REPORT);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    step: "after updating to v1.3.0-next.48",
    status: 404,
    module: "growspace-dialogs-a1b2c3.js",
    url: "http://h/hacsfiles/card/growspace-dialogs-a1b2c3.js",
    importer: "growspace-manager-card.js",
  });
});

test("a failure names the missing chunk and both tags in the annotation title", () => {
  // The title is all a run summary shows. Someone who never opens the log has
  // to be able to tell which chunk went missing on which update from it.
  const [annotation] = annotationLines({
    from: "v1.3.0-next.10",
    to: "v1.3.0-next.48",
    rows: brokenModuleRows(BROKEN_REPORT),
  });
  assert.equal(
    annotation,
    "::error title=HACS v1.3.0-next.10 → v1.3.0-next.48 does not serve growspace-dialogs-a1b2c3.js" +
      "::HTTP 404 for http://h/hacsfiles/card/growspace-dialogs-a1b2c3.js after updating to v1.3.0-next.48," +
      " imported by growspace-manager-card.js",
  );
});

test("a run that never reported is red for a different reason than a broken graph", () => {
  const annotations = annotationLines({
    from: "v1",
    to: "v2",
    rows: [],
    failure: "card-hacs-update exited 1\nbefore walking anything",
  });
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /could not be checked/);
  // Newlines end an annotation, so they cannot reach one unescaped.
  assert.match(annotations[0], /exited 1%0Abefore walking/);
});

test("the summary states the verdict, both tags and the file counts", () => {
  const broken = jobSummary({
    from: "v1.3.0-next.10",
    to: "v1.3.0-next.48",
    rows: brokenModuleRows(BROKEN_REPORT),
    report: BROKEN_REPORT,
  });
  assert.match(broken, /1 module not served/);
  assert.match(broken, /`v1\.3\.0-next\.10` → `v1\.3\.0-next\.48`/);
  assert.match(broken, /\| 404 \| `growspace-dialogs-a1b2c3\.js` \| `growspace-manager-card\.js` \|/);
  assert.match(broken, /after updating to v1\.3\.0-next\.48: 2 files/);

  const green = jobSummary({ from: "v1", to: "v2", rows: [], report: BROKEN_REPORT });
  assert.match(green, /every module served/);
  assert.match(green, /4 modules walked/);

  const skipped = jobSummary({ from: null, to: "v1", rows: [], skipped: "nothing to update from" });
  assert.match(skipped, /skipped/);
  assert.match(skipped, /nothing to update from/);
});

test("the ?hacstag the entry carries is not part of a module's name", () => {
  assert.equal(moduleName("http://h/hacsfiles/card/entry.js?hacstag=105217085413048"), "entry.js");
  assert.equal(moduleName("/hacsfiles/card/chunk.js"), "chunk.js");
});

test("unknown arguments go to card-hacs-update instead of being rejected here", () => {
  const parsed = parseArguments([
    "--tag",
    "v1.3.0-next.48",
    "--reset",
    "--base-url",
    "http://localhost:8124",
  ]);
  assert.equal(parsed.options["--tag"], "v1.3.0-next.48");
  assert.deepEqual(parsed.passthrough, ["--reset", "--base-url", "http://localhost:8124"]);
  assert.ok(parsed.switches.has("--resolve-only") === false);
  assert.throws(() => parseArguments(["--tag"]), /needs a value/);
});

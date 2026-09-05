const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = path.resolve(__dirname, "..");

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  }).trim();
}

function commit(repository, name, contents) {
  fs.writeFileSync(path.join(repository, name), contents);
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", name);
}

// A hub holding nothing but `scripts/check`. The header is printed before any
// stage runs and every target below refuses at its guards, so the fixture never
// needs a venv, a node_modules, or the rest of the workspace.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-header-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const hub = path.join(root, "growspace_manager_workspace");
  fs.mkdirSync(path.join(hub, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(SOURCE_ROOT, "scripts", "check"),
    path.join(hub, "scripts", "check"),
  );
  fs.chmodSync(path.join(hub, "scripts", "check"), 0o755);
  return { root, hub };
}

// A checkout whose `main` tracks `origin/main`, both at the same commit.
function checkout(f, name) {
  const origin = path.join(f.root, "origins", `${name}.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = path.join(f.root, "seed", name);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  git(seed, "config", "user.email", "tests@example.com");
  git(seed, "config", "user.name", "Hub tooling tests");
  commit(seed, "README.md", name);
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");

  const clone = path.join(f.root, name);
  execFileSync("git", ["clone", "-q", origin, clone]);
  git(clone, "config", "user.email", "tests@example.com");
  git(clone, "config", "user.name", "Hub tooling tests");
  return clone;
}

// Move `origin/main` ahead of the working branch without a network: commit,
// point the remote-tracking ref at the result, then rewind the branch. What that
// leaves on disk is exactly what a checkout looks like after someone else pulled.
function advanceUpstream(clone, count) {
  for (let i = 0; i < count; i += 1) {
    commit(clone, `upstream-${i}.md`, "landed while you were away");
  }
  git(clone, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(clone, "reset", "-q", "--hard", `HEAD~${count}`);
}

function run(f, target, roots = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GROWSPACE_")) delete env[key];
  }
  Object.assign(env, roots);
  const result = spawnSync(
    path.join(f.hub, "scripts", "check"),
    [target, "fast"],
    { cwd: f.hub, encoding: "utf8", env },
  );
  // The header is what these tests are about; strip the colours it prints.
  return result.stdout.replace(/\[[0-9;]*m/g, "");
}

test("says nothing when the checkout is level with its upstream", (t) => {
  const f = fixture(t);
  const tc = checkout(f, "growspace_manager_tc");

  const header = run(f, "tc", { GROWSPACE_TC: tc });
  assert.match(header, new RegExp(`tc:\\s+${tc}`));
  assert.doesNotMatch(header, /behind/);
});

test("names the upstream ref and the distance when the checkout is behind", (t) => {
  const f = fixture(t);
  const tc = checkout(f, "growspace_manager_tc");
  advanceUpstream(tc, 2);

  const header = run(f, "tc", { GROWSPACE_TC: tc });
  assert.match(header, /! +main is 2 commits behind origin\/main$/m);
  assert.match(header, /check never fetches/);
});

test("counts one commit in the singular", (t) => {
  const f = fixture(t);
  const tc = checkout(f, "growspace_manager_tc");
  advanceUpstream(tc, 1);

  assert.match(
    run(f, "tc", { GROWSPACE_TC: tc }),
    /main is 1 commit behind origin\/main$/m,
  );
});

// Being behind is not the same news as having nothing of your own, and the
// reader is the one who decides whether either matters.
test("reports work the checkout carries that its upstream does not", (t) => {
  const f = fixture(t);
  const tc = checkout(f, "growspace_manager_tc");
  advanceUpstream(tc, 2);
  commit(tc, "mine.md", "local work");

  assert.match(
    run(f, "tc", { GROWSPACE_TC: tc }),
    /main is 2 commits behind origin\/main {2}\(1 ahead\)$/m,
  );
});

// The Vision case from #140: a checkout parked on a feature branch whose work is
// already upstream. There is no upstream ref to measure against, so the nearest
// integration branch stands in, and the line says so.
test("falls back to the nearest integration branch when there is no upstream", (t) => {
  const f = fixture(t);
  const tc = checkout(f, "growspace_manager_tc");
  advanceUpstream(tc, 6);
  git(tc, "switch", "-q", "-c", "codex/issue-96");

  assert.match(
    run(f, "tc", { GROWSPACE_TC: tc }),
    /codex\/issue-96 is 6 commits behind origin\/main {2}\(no upstream — nothing of its own\)$/m,
  );
});

test("names a detached HEAD as one", (t) => {
  const f = fixture(t);
  const tc = checkout(f, "growspace_manager_tc");
  advanceUpstream(tc, 3);
  git(tc, "checkout", "-q", "--detach", "HEAD");

  assert.match(
    run(f, "tc", { GROWSPACE_TC: tc }),
    /detached HEAD is 3 commits behind origin\/main/,
  );
});

// Every tree the header names is judged, not only the target's own — and the
// note about refs on disk is said once however many of them warned.
test("judges every checkout the header names, and explains itself once", (t) => {
  const f = fixture(t);
  const backend = checkout(f, "growspace_manager");
  const card = checkout(f, "lovelace-growspace-manager-card");
  advanceUpstream(backend, 2);
  advanceUpstream(card, 38);

  const header = run(f, "backend", {
    GROWSPACE_BACKEND: backend,
    GROWSPACE_CARD: card,
  });
  assert.match(header, /main is 2 commits behind origin\/main/);
  assert.match(header, /main is 38 commits behind origin\/main/);
  assert.equal(header.match(/check never fetches/g).length, 1);
});

// A tree that is not there at all, and one that is not a repository, are both
// the header's business to survive rather than the staleness check's to report.
test("stays quiet about a checkout that is missing or not a git repository", (t) => {
  const f = fixture(t);
  const loose = path.join(f.root, "not-a-repo");
  fs.mkdirSync(loose);

  assert.doesNotMatch(run(f, "tc", { GROWSPACE_TC: loose }), /behind/);
  const gone = run(f, "tc", { GROWSPACE_TC: path.join(f.root, "gone") });
  assert.match(gone, /\(MISSING\)/);
  assert.doesNotMatch(gone, /behind/);
});

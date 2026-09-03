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

// The layout the script expects: a hub checkout with sibling product repos,
// each cloned from an origin so that `origin/main` exists to test against.
function fixture(t, { merged = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-gc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const clones = {};
  for (const name of ["growspace_manager_workspace", "growspace_manager"]) {
    const origin = path.join(root, "origins", `${name}.git`);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    const seed = path.join(root, "seed", name);
    execFileSync("git", ["init", "-q", "-b", "main", seed]);
    git(seed, "config", "user.email", "tests@example.com");
    git(seed, "config", "user.name", "Hub tooling tests");
    commit(seed, "README.md", name);
    // The real hub gitignores `worktrees/`, which is why a directory holding
    // nested worktrees reads as clean rather than as untracked content.
    commit(seed, ".gitignore", "nested/\n");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");

    const clone = path.join(root, name);
    execFileSync("git", ["clone", "-q", origin, clone]);
    git(clone, "config", "user.email", "tests@example.com");
    git(clone, "config", "user.name", "Hub tooling tests");
    clones[name] = clone;
  }

  const hub = clones.growspace_manager_workspace;
  fs.mkdirSync(path.join(hub, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(SOURCE_ROOT, "scripts", "worktree-gc"),
    path.join(hub, "scripts", "worktree-gc"),
  );
  fs.chmodSync(path.join(hub, "scripts", "worktree-gc"), 0o755);

  // An offline `gh`, so the test never reaches the network and can still
  // exercise the squash-merge signal.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env bash\n[ "$1" = "pr" ] || exit 1\nprintf '%s\\n' ${
      merged.length ? merged.map((b) => `'${b}'`).join(" ") : '""'
    }\n`,
    { mode: 0o755 },
  );

  return { root, hub, backend: clones.growspace_manager, bin };
}

function run(f, args = [], cwd = f.hub) {
  return spawnSync(path.join(f.hub, "scripts", "worktree-gc"), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}` },
  });
}

// A branch merged into origin/main is dead weight locally; the point of the
// tool is that its directory goes and its branch does not.
test("removes a landed worktree and keeps its branch", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "landed");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/landed", wt, "origin/main");

  const report = run(f);
  assert.match(report.stdout, /landed — removable \(1\)/);
  assert.match(report.stdout, /feature\/landed/);
  assert.equal(fs.existsSync(wt), true, "a report must not remove anything");

  const pruned = run(f, ["--prune"]);
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.equal(fs.existsSync(wt), false);
  assert.match(git(f.backend, "branch", "--list", "feature/landed"), /feature\/landed/);
});

// Squashed commits are ancestors of nothing, so without the pull-request
// signal the overwhelmingly common merge style would never be collected.
test("treats a squash-merged branch as landed", (t) => {
  const f = fixture(t, { merged: ["feature/squashed"] });
  const wt = path.join(f.backend, ".worktrees", "squashed");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/squashed", wt, "origin/main");
  commit(wt, "squashed.md", "work that upstream flattened");

  assert.match(run(f).stdout, /PR merged \(squashed\)/);
  run(f, ["--prune"]);
  assert.equal(fs.existsSync(wt), false);
});

// Modified tracked files are somebody's work in progress. Landed or not, no
// flag reaches them.
test("holds back a worktree with uncommitted tracked changes", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "dirty");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/dirty", wt, "origin/main");
  fs.writeFileSync(path.join(wt, "README.md"), "edited");

  assert.match(run(f).stdout, /has uncommitted changes/);
  run(f, ["--prune", "--untracked"]);
  assert.equal(fs.existsSync(wt), true);
});

// Untracked files are usually build fallout, but deleting them is still a
// decision the caller makes rather than the default.
test("removes untracked-only fallout only when asked", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "fallout");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/fallout", wt, "origin/main");
  fs.mkdirSync(path.join(wt, ".cache"));
  fs.writeFileSync(path.join(wt, ".cache", "vite"), "");

  assert.match(run(f).stdout, /untracked files — pass --untracked/);
  run(f, ["--prune"]);
  assert.equal(fs.existsSync(wt), true);
  run(f, ["--prune", "--untracked"]);
  assert.equal(fs.existsSync(wt), false);
});

// The card's node_modules is ONE symlink into the main checkout's 465 MB tree.
// Following it while removing a worktree destroys the main checkout, so this
// is the assertion that matters most in the file.
test("never deletes through a shared dependency link", (t) => {
  const f = fixture(t);
  const shared = path.join(f.backend, "node_modules");
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(shared, "sentinel"), "the lender's tree");

  const wt = path.join(f.backend, ".worktrees", "linked");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/linked", wt, "origin/main");
  fs.symlinkSync(shared, path.join(wt, "node_modules"));

  run(f, ["--prune", "--untracked"]);
  assert.equal(fs.existsSync(wt), false);
  assert.equal(
    fs.readFileSync(path.join(shared, "sentinel"), "utf8"),
    "the lender's tree",
  );
});

// Codex nests a repository's worktree inside the hub's, so a landed outer
// directory can sit on top of unlanded work in a different repository. `rm -rf`
// does not consult the inner worktree's status: classifying the two
// independently deletes work the report claims to be holding back.
test("holds back a landed worktree that contains held-back work", (t) => {
  const f = fixture(t);
  const outer = path.join(f.hub, "worktrees", "nest");
  git(f.hub, "worktree", "add", "-q", "-b", "feature/outer", outer, "origin/main");

  const inner = path.join(outer, "nested", "backend");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/inner", inner, "origin/main");
  commit(inner, "unlanded.md", "work that never reached origin");

  const report = run(f);
  assert.match(report.stdout, /feature\/outer\s+.*contains held-back work/);
  assert.doesNotMatch(report.stdout, /landed — removable/);

  run(f, ["--prune", "--untracked"]);
  assert.equal(fs.existsSync(inner), true, "the inner worktree must survive");
  assert.equal(fs.existsSync(outer), true, "so must the directory holding it");
});

// A merged branch says nothing about whether an agent session is still sitting
// in the directory, and neither does being the checkout the run started from.
test("refuses the main checkout, its own directory and agent sessions", (t) => {
  const f = fixture(t);
  const session = path.join(f.hub, ".claude", "worktrees", "live");
  git(f.hub, "worktree", "add", "-q", "-b", "claude/live", session, "origin/main");
  const standing = path.join(f.backend, ".worktrees", "standing");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/standing", standing, "origin/main");

  const report = run(f, [], standing);
  assert.match(report.stdout, /live agent session/);
  assert.match(report.stdout, /this run is standing in it/);

  run(f, ["--prune", "--untracked"], standing);
  assert.equal(fs.existsSync(session), true);
  assert.equal(fs.existsSync(standing), true);
  assert.equal(fs.existsSync(path.join(f.hub, "README.md")), true);
});

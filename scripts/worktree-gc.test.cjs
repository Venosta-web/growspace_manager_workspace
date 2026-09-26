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
  for (const script of ["worktree-gc", "growspace-repos"]) {
    fs.copyFileSync(
      path.join(SOURCE_ROOT, "scripts", script),
      path.join(hub, "scripts", script),
    );
    fs.chmodSync(path.join(hub, "scripts", script), 0o755);
  }

  // An offline `gh`, reading the merged-pull-request table the test declares.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const table = path.join(root, "merged-prs.tsv");
  fs.writeFileSync(table, "");
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env bash\n[ "$1" = "pr" ] || exit 1\ncat ${table}\n`,
    { mode: 0o755 },
  );

  return { root, hub, backend: clones.growspace_manager, bin, table };
}

// gh reports the commit a pull request merged, and the tool insists on it.
function declareMerged(f, repository, branch) {
  const oid = git(repository, "rev-parse", branch);
  fs.appendFileSync(f.table, `${branch}\t${oid}\n`);
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
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "squashed");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/squashed", wt, "origin/main");
  commit(wt, "squashed.md", "work that upstream flattened");
  declareMerged(f, f.backend, "feature/squashed");

  assert.match(run(f).stdout, /PR merged \(squashed\)/);
  run(f, ["--prune"]);
  assert.equal(fs.existsSync(wt), false);
});

// A branch name outlives its pull request. Reuse one and the name still matches
// a MERGED PR while the commits on it are new — matching by name alone would
// collect work that has never been merged anywhere.
test("holds back a merged branch that was reused afterwards", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "reused");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/reused", wt, "origin/main");
  commit(wt, "first.md", "the round that merged");
  declareMerged(f, f.backend, "feature/reused");
  commit(wt, "second.md", "a second round on the same branch");

  const report = run(f, ["--branches"]);
  assert.match(report.stdout, /feature\/reused\s+not landed upstream/);
  assert.doesNotMatch(report.stdout, /landed branches/);

  run(f, ["--prune", "--branches", "--untracked"]);
  assert.equal(fs.existsSync(wt), true);
  assert.match(git(f.backend, "branch", "--list", "feature/reused"), /feature\/reused/);
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

// Branch collection is opt-in, leaves the integration branches alone whatever
// their state, and never touches a branch that is still checked out.
test("deletes landed branches only when asked, and never the protected ones", (t) => {
  const f = fixture(t);
  git(f.backend, "branch", "feature/gone", "origin/main");
  git(f.backend, "branch", "dev", "origin/main");
  git(f.backend, "branch", "feature/alive", "origin/main");
  const alive = path.join(f.backend, ".worktrees", "alive");
  git(f.backend, "worktree", "add", "-q", alive, "feature/alive");
  commit(alive, "unlanded.md", "never pushed anywhere");

  const quiet = run(f, ["--prune", "--untracked"]);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(git(f.backend, "branch", "--list", "feature/gone"), /feature\/gone/);

  const report = run(f, ["--branches"]);
  assert.match(report.stdout, /landed branches — deletable \(1\)/);

  run(f, ["--prune", "--branches", "--untracked"]);
  assert.equal(git(f.backend, "branch", "--list", "feature/gone"), "");
  assert.match(git(f.backend, "branch", "--list", "dev"), /dev/);
  assert.match(git(f.backend, "branch", "--list", "feature/alive"), /feature\/alive/);
});

// The pair is collected together: a branch whose only worktree this run removes
// is free by the time the branch pass deletes it, so it does not take a second
// run to disappear.
test("collects a branch freed by the same run", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "paired");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/paired", wt, "origin/main");

  const done = run(f, ["--prune", "--branches", "--untracked"]);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(fs.existsSync(wt), false);
  assert.equal(git(f.backend, "branch", "--list", "feature/paired"), "");
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

// A worktree made under /tmp outlives nothing: the directory goes with a
// reboot and the registration stays until `git worktree prune`. The report
// names it, and --prune drops it and says which entry it dropped.
test("prunes the entry of a worktree whose directory is gone, and says so", (t) => {
  const f = fixture(t);
  const gone = path.join(f.root, "tmp", "gone");
  git(f.hub, "worktree", "add", "-q", "-b", "scratch/gone", gone, "origin/main");
  fs.rmSync(gone, { recursive: true, force: true });

  const report = run(f);
  assert.match(report.stdout, /stale entries — --prune drops them \(1\)/);
  assert.match(report.stdout, /1 stale entr\(ies\) would be pruned/);
  assert.match(git(f.hub, "worktree", "list"), /tmp\/gone/);

  const pruned = run(f, ["--prune"]);
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.match(pruned.stdout, new RegExp(`pruned\\s+stale entry ${gone}\\s+scratch/gone`));
  assert.match(pruned.stdout, /pruned 1 stale entr\(ies\)/);
  assert.doesNotMatch(git(f.hub, "worktree", "list"), /tmp\/gone/);
});

// git itself will not prune a locked entry, and neither does this: the report
// says it is locked instead of promising a removal that will not happen.
test("leaves a locked stale entry alone and says how to release it", (t) => {
  const f = fixture(t);
  const gone = path.join(f.root, "usb", "locked");
  git(f.hub, "worktree", "add", "-q", "--lock", "-b", "scratch/locked", gone, "origin/main");
  fs.rmSync(gone, { recursive: true, force: true });

  const report = run(f);
  assert.match(report.stdout, /locked — git worktree unlock/);
  assert.doesNotMatch(report.stdout, /stale entries/);

  const pruned = run(f, ["--prune"]);
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.match(git(f.hub, "worktree", "list"), /usb\/locked/);
  assert.match(pruned.stdout, /pruned 0 stale entr\(ies\)/);
});

// A private venv is the environment backend-venv built for the worktree, not
// work in progress — and it is excluded whatever the branch's .gitignore says,
// which in this fixture says nothing about it.
test("counts a private .venv as build output, not as untracked work", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "private-venv");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/private-venv", wt, "origin/main");
  fs.mkdirSync(path.join(wt, ".venv", "bin"), { recursive: true });
  fs.writeFileSync(path.join(wt, ".venv", "bin", "python"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(wt, ".venv", "pyvenv.cfg"), "home = /usr/bin\n");

  const report = run(f);
  assert.match(report.stdout, /landed — removable \(1\)/);
  assert.doesNotMatch(report.stdout, /pass --untracked/);

  const pruned = run(f, ["--prune"]);
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.equal(fs.existsSync(wt), false);
});

// Only the root-level dependency trees are exempt. A `.venv` somewhere deeper
// is not something the hub put there.
test("still holds back untracked files beside a private .venv", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "venv-and-work");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/venv-and-work", wt, "origin/main");
  fs.mkdirSync(path.join(wt, ".venv"));
  fs.mkdirSync(path.join(wt, "tests", ".venv"), { recursive: true });
  fs.writeFileSync(path.join(wt, "tests", ".venv", "draft.py"), "");

  assert.match(run(f).stdout, /untracked files — pass --untracked/);
  run(f, ["--prune"]);
  assert.equal(fs.existsSync(wt), true);
});

// The count alone is what let the pile grow: every report says what it costs.
test("the report and the summary say how much disk the removable ones hold", (t) => {
  const f = fixture(t);
  const wt = path.join(f.backend, ".worktrees", "heavy");
  git(f.backend, "worktree", "add", "-q", "-b", "feature/heavy", wt, "origin/main");
  fs.mkdirSync(path.join(wt, ".venv"));
  fs.writeFileSync(path.join(wt, ".venv", "blob"), Buffer.alloc(3 * 1024 * 1024));

  const report = run(f);
  assert.match(report.stdout, /1 worktree\(s\) can be removed, holding 3\.\d MiB\./);

  const summary = run(f, ["--summary", "--offline"]);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /^worktree-gc: 1 landed worktree\(s\) holding 3\.\d MiB/);
  assert.match(summary.stdout, /collect them with: .*worktree-gc --prune --branches --untracked/);
});

// --nudge is for `feature new` and `codex-worktree setup`: silent below the
// threshold, the summary line at or above it.
test("--nudge speaks only once the removable count reaches the threshold", (t) => {
  const f = fixture(t);
  for (const name of ["one", "two"]) {
    git(f.backend, "worktree", "add", "-q", "-b", `feature/${name}`,
      path.join(f.backend, ".worktrees", name), "origin/main");
  }
  const nudge = (threshold) =>
    spawnSync(path.join(f.hub, "scripts", "worktree-gc"), ["--nudge"], {
      cwd: f.hub,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${f.bin}:${process.env.PATH}`,
        GROWSPACE_WORKTREE_GC_THRESHOLD: threshold,
      },
    });

  const quiet = nudge("3");
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout, "");

  const loud = nudge("2");
  assert.equal(loud.status, 0, loud.stderr);
  assert.match(loud.stdout, /^worktree-gc: 2 landed worktree\(s\) holding /);
  assert.match(loud.stdout, /offline count/);

  const bad = nudge("lots");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /must be a whole number/);
});

test("--nudge refuses to combine with --prune", (t) => {
  const f = fixture(t);
  const result = run(f, ["--nudge", "--prune"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /are reports/);
});

// Branch names repeat across repositories — a Codex set uses one name in all of
// them. Freeing the hub's worktree must not free the backend's branch of the
// same name while its own worktree is still held back.
test("a branch freed in one repository stays checked out in another", (t) => {
  const f = fixture(t);
  const hubWt = path.join(f.hub, "worktrees", "shared-name");
  git(f.hub, "worktree", "add", "-q", "-b", "codex/shared", hubWt, "origin/main");
  const backendWt = path.join(f.backend, ".worktrees", "shared-name");
  git(f.backend, "worktree", "add", "-q", "-b", "codex/shared", backendWt, "origin/main");
  fs.writeFileSync(path.join(backendWt, "draft.py"), "unsaved work");

  const report = run(f, ["--branches"]);
  assert.match(report.stdout, /landed branches — deletable \(1\)/);
  assert.match(report.stdout, /codex\/shared\s+contained in main\s+\S+\s+growspace_manager_workspace/);

  const done = run(f, ["--prune", "--branches"]);
  assert.equal(done.status, 0, done.stderr);
  assert.doesNotMatch(done.stdout, /git refused/);
  assert.equal(fs.existsSync(backendWt), true);
  assert.match(git(f.backend, "branch", "--list", "codex/shared"), /codex\/shared/);
});

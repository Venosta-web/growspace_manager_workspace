const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const SENTINEL = "growspace-hub: worktree-gc nudge";

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  }).trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "install-hooks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const clones = {};
  for (const name of ["growspace_manager_workspace", "growspace_manager"]) {
    // Landing is measured against origin/*, so the fixture needs a real one.
    const origin = path.join(root, "origins", `${name}.git`);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    const seed = path.join(root, "seed", name);
    execFileSync("git", ["init", "-q", "-b", "main", seed]);
    git(seed, "config", "user.email", "tests@example.com");
    git(seed, "config", "user.name", "Hub tooling tests");
    fs.writeFileSync(path.join(seed, "README.md"), name);
    git(seed, "add", ".");
    git(seed, "commit", "-q", "-m", "fixture");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");

    const repository = path.join(root, name);
    execFileSync("git", ["clone", "-q", origin, repository]);
    git(repository, "config", "user.email", "tests@example.com");
    git(repository, "config", "user.name", "Hub tooling tests");
    clones[name] = repository;
  }

  const hub = clones.growspace_manager_workspace;
  fs.mkdirSync(path.join(hub, "scripts"), { recursive: true });
  for (const script of ["install-hooks", "growspace-repos", "worktree-gc"]) {
    fs.copyFileSync(
      path.join(SOURCE_ROOT, "scripts", script),
      path.join(hub, "scripts", script),
    );
    fs.chmodSync(path.join(hub, "scripts", script), 0o755);
  }
  return { root, hub, backend: clones.growspace_manager };
}

function install(f, args = []) {
  return spawnSync(path.join(f.hub, "scripts", "install-hooks"), args, {
    cwd: f.hub,
    encoding: "utf8",
  });
}

const hookPath = (repository, hook) =>
  path.join(repository, ".git", "hooks", hook);

// `git pull --rebase` never fires post-merge, so covering only that hook would
// leave a whole workflow silently uncollected.
test("installs both hooks in every checkout it sweeps", (t) => {
  const f = fixture(t);
  const done = install(f);
  assert.equal(done.status, 0, done.stderr);

  for (const repository of [f.hub, f.backend]) {
    for (const hook of ["post-merge", "post-rewrite"]) {
      const file = hookPath(repository, hook);
      assert.match(fs.readFileSync(file, "utf8"), new RegExp(SENTINEL));
      assert.ok(fs.statSync(file).mode & 0o111, `${hook} must be executable`);
    }
  }
});

// Re-running is how the hook body gets updated, so it has to be repeatable.
test("is idempotent", (t) => {
  const f = fixture(t);
  install(f);
  const first = fs.readFileSync(hookPath(f.backend, "post-merge"), "utf8");
  assert.equal(install(f).status, 0);
  assert.equal(fs.readFileSync(hookPath(f.backend, "post-merge"), "utf8"), first);
});

// pre-commit can claim these same hook names. Overwriting one silently would
// disable whatever it was doing.
test("refuses to overwrite a hook it did not write", (t) => {
  const f = fixture(t);
  const file = hookPath(f.backend, "post-merge");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "#!/bin/sh\necho someone else was here\n", { mode: 0o755 });

  const done = install(f);
  assert.equal(done.status, 1, "a collision is a failure, not a silent skip");
  assert.match(done.stdout, /SKIPPED\s+post-merge/);
  assert.match(fs.readFileSync(file, "utf8"), /someone else was here/);
  // The uncontested hook in the same repository still goes in.
  assert.match(
    fs.readFileSync(hookPath(f.backend, "post-rewrite"), "utf8"),
    new RegExp(SENTINEL),
  );
});

test("--uninstall removes only its own hooks", (t) => {
  const f = fixture(t);
  install(f);
  const foreign = hookPath(f.hub, "pre-push");
  fs.writeFileSync(foreign, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const done = install(f, ["--uninstall"]);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(fs.existsSync(hookPath(f.hub, "post-merge")), false);
  assert.equal(fs.existsSync(hookPath(f.backend, "post-rewrite")), false);
  assert.equal(fs.existsSync(foreign), true);
});

// The whole point is that a pull says something when work has landed — and
// says nothing when it has not.
test("the installed hook reports landed work and is otherwise silent", (t) => {
  const f = fixture(t);
  install(f);
  const hook = hookPath(f.backend, "post-merge");

  const quiet = spawnSync(hook, ["0"], { cwd: f.backend, encoding: "utf8" });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout.trim(), "", "nothing landed, so nothing to say");

  git(f.backend, "branch", "feature/landed", "main");
  const loud = spawnSync(hook, ["0"], { cwd: f.backend, encoding: "utf8" });
  assert.equal(loud.status, 0, loud.stderr);
  assert.match(loud.stdout, /worktree-gc: 0 worktree\(s\), 1 branch\(es\) have landed/);
  assert.match(loud.stdout, /--prune --branches/);
});

// A hook is installed once and lives for years; the script it calls can be
// absent, whether because the branch carrying it has not landed in the main
// checkout yet or because the hub moved. Silence beats an error on every pull.
test("the hook is inert, not noisy, when worktree-gc is missing", (t) => {
  const f = fixture(t);
  install(f);
  fs.rmSync(path.join(f.hub, "scripts", "worktree-gc"));
  git(f.backend, "branch", "feature/landed", "main");

  const done = spawnSync(hookPath(f.backend, "post-merge"), ["0"], {
    cwd: f.backend,
    encoding: "utf8",
  });
  assert.equal(done.status, 0);
  assert.equal(done.stdout.trim(), "");
  assert.equal(done.stderr.trim(), "");
});

// post-rewrite fires on every `git commit --amend`, which cannot have landed
// anything.
test("the hook stays quiet on an amend", (t) => {
  const f = fixture(t);
  install(f);
  git(f.backend, "branch", "feature/landed", "main");

  const amend = spawnSync(hookPath(f.backend, "post-rewrite"), ["amend"], {
    cwd: f.backend,
    encoding: "utf8",
  });
  assert.equal(amend.status, 0);
  assert.equal(amend.stdout.trim(), "");

  const rebase = spawnSync(hookPath(f.backend, "post-rewrite"), ["rebase"], {
    cwd: f.backend,
    encoding: "utf8",
  });
  assert.match(rebase.stdout, /have landed/);
});

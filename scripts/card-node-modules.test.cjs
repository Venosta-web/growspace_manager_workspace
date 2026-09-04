const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SCRIPT = path.resolve(__dirname, "card-node-modules");
const LOCK = '{"lockfileVersion":3}\n';

// A stand-in for npm's offline `ci --dry-run`. Like the real one it reports on
// the tree `node_modules` actually resolves to — through a shared link that is
// the lender's — while running in whatever directory it was invoked from, which
// is what made the original message blame the wrong checkout.
const FAKE_NPM = `#!/usr/bin/env bash
printf '%s\\n' "$PWD" >> "$NPM_LOG"
target="$(readlink -f node_modules 2>/dev/null || true)"
plan="$(dirname "$target")/.npm-plan"
if [ -n "$target" ] && [ -f "$plan" ]; then cat "$plan"; else
  echo '{"added":0,"changed":0,"removed":0}'
fi
`;

function fixture(t, { lenderPlan, worktreeModules } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growspace-card-deps-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const lender = path.join(root, "lovelace-growspace-manager-card");
  const worktree = path.join(lender, ".worktrees", "feature");
  const bin = path.join(root, "bin");
  const npmLog = path.join(root, "npm.log");

  fs.mkdirSync(path.join(lender, "node_modules"), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(lender, "package-lock.json"), LOCK);
  fs.writeFileSync(path.join(worktree, "package-lock.json"), LOCK);
  fs.writeFileSync(path.join(bin, "npm"), FAKE_NPM, { mode: 0o755 });
  if (lenderPlan) {
    fs.writeFileSync(path.join(lender, ".npm-plan"), lenderPlan);
  }
  if (worktreeModules) {
    worktreeModules(worktree);
  }

  const run = () =>
    spawnSync(SCRIPT, [lender, worktree], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_LOG: npmLog },
    });

  return {
    lender,
    worktree,
    run,
    modules: path.join(worktree, "node_modules"),
    npmRuns: () =>
      fs.existsSync(npmLog)
        ? fs.readFileSync(npmLog, "utf8").trim().split("\n").filter(Boolean)
        : [],
  };
}

test("a clean lender backs the worktree through a single link", (t) => {
  const { lender, run, modules } = fixture(t);

  const result = run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sharing card dependencies/);
  assert.equal(fs.lstatSync(modules).isSymbolicLink(), true);
  assert.equal(
    fs.realpathSync(modules),
    fs.realpathSync(path.join(lender, "node_modules")),
  );
});

test("a drifted lender is blamed by name, with its own counts", (t) => {
  const { lender, worktree, run, modules, npmRuns } = fixture(t, {
    lenderPlan: '{"added":1,"changed":0,"removed":0}',
  });

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`node_modules in ${lender} does not`));
  assert.match(result.stderr, /added 1, changed 0, removed 0/);
  assert.match(result.stderr, new RegExp(`run: \\(cd ${lender} && npm ci\\)`));
  assert.doesNotMatch(
    result.stderr,
    new RegExp(`npm ci\\) *\n?.*${worktree}`),
    "the remediation must not point at the borrower",
  );
  assert.equal(fs.existsSync(modules), false, "a drifted lender leaves no link");
  assert.deepEqual(
    npmRuns(),
    [lender],
    "npm must be asked in the lender, never through a link",
  );
});

test("a drifted lender removes a link left by an earlier setup run", (t) => {
  const { lender, run, modules } = fixture(t);

  assert.equal(run().status, 0);
  assert.equal(fs.lstatSync(modules).isSymbolicLink(), true);
  fs.writeFileSync(
    path.join(lender, ".npm-plan"),
    '{"added":0,"changed":2,"removed":0}',
  );

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /added 0, changed 2, removed 0/);
  assert.equal(fs.existsSync(modules), false);
});

test("a drifted private install reports itself, with its own counts", (t) => {
  const { worktree, run, npmRuns } = fixture(t, {
    lenderPlan: '{"added":9,"changed":9,"removed":9}',
    worktreeModules: (tree) => {
      fs.mkdirSync(path.join(tree, "node_modules", "lit"), { recursive: true });
      fs.writeFileSync(
        path.join(tree, ".npm-plan"),
        '{"added":0,"changed":0,"removed":3}',
      );
    },
  });

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`node_modules in ${worktree} does not`));
  assert.match(result.stderr, /added 0, changed 0, removed 3/);
  assert.deepEqual(npmRuns(), [worktree]);
});

test("a clean private install is kept and never replaced by a link", (t) => {
  const { run, modules } = fixture(t, {
    worktreeModules: (tree) => {
      fs.mkdirSync(path.join(tree, "node_modules", "lit"), { recursive: true });
    },
  });

  const result = run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /using private card dependencies/);
  assert.equal(fs.lstatSync(modules).isDirectory(), true);
});

test("differing lockfiles refuse and drop any existing link", (t) => {
  const { worktree, run, modules } = fixture(t);

  assert.equal(run().status, 0);
  fs.writeFileSync(
    path.join(worktree, "package-lock.json"),
    '{"lockfileVersion":3,"name":"branch"}\n',
  );

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /card lockfiles differ/);
  assert.match(result.stderr, new RegExp(`npm ci in ${worktree}`));
  assert.equal(fs.existsSync(modules), false);
});

test("a legacy symlink farm is refused rather than blessed", (t) => {
  const { run } = fixture(t, {
    worktreeModules: (tree) => {
      fs.mkdirSync(path.join(tree, "node_modules"), { recursive: true });
      fs.symlinkSync("/nowhere", path.join(tree, "node_modules", "lit"));
    },
  });

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /legacy node_modules farm detected/);
});

test("a missing lender tree refuses before anything is linked", (t) => {
  const { lender, run, modules } = fixture(t);
  fs.rmSync(path.join(lender, "node_modules"), { recursive: true });

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /shared card dependencies missing/);
  assert.equal(fs.existsSync(modules), false);
});

test("an unexpected pre-existing link is never replaced", (t) => {
  const { run, modules } = fixture(t, {
    worktreeModules: (tree) => {
      fs.symlinkSync("/nowhere", path.join(tree, "node_modules"));
    },
  });

  const result = run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to replace unexpected node_modules link/);
  assert.equal(fs.readlinkSync(modules), "/nowhere");
});

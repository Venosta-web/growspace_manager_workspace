const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const REPOS = [
  "growspace_manager",
  "growspace_manager_tc",
  "growspace_manager_vision",
  "lovelace-growspace-manager-card",
];
// The branch each repository integrates on, per its own AGENTS.md.
const BASES = {
  growspace_manager: "prerelease",
  growspace_manager_tc: "main",
  growspace_manager_vision: "main",
  "lovelace-growspace-manager-card": "dev",
};

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  }).trim();
}

function executable(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function initRepository(repository) {
  fs.mkdirSync(repository, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repository]);
  git(repository, "config", "user.email", "tests@example.com");
  git(repository, "config", "user.name", "Hub tooling tests");
}

function commitAll(repository, message) {
  git(repository, "add", "-A");
  git(repository, "commit", "-q", "-m", message);
}

// A remote-tracking `origin/<branch>` on a commit of its own, so a worktree
// that started anywhere else is told apart by its HEAD.
function originBranch(repository, branch) {
  const commit = git(
    repository, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", `origin/${branch}`,
  );
  git(repository, "update-ref", `refs/remotes/origin/${branch}`, commit);
  return commit;
}

// Scrub the developer's own overrides so every default is the one under test.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GROWSPACE_") || key.startsWith("E2E_")) delete env[key];
  }
  return { ...env, ...extra };
}

/*
 * A dev root laid out like ~/dev: the four product repositories beside a hub
 * that is a real git checkout, and a Claude Code agent worktree of that hub at
 * `.claude/worktrees/agent` — the layout where `<script dir>/../<repo>` lands in
 * a directory of worktrees and finds nothing.
 *
 * Scripts are committed to the hub so the worktree carries the same ones; the
 * two helpers `feature` delegates to are stubs that log their arguments.
 */
function fixture(t, scripts = []) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "growspace-repos-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const repos = {};
  for (const name of REPOS) {
    repos[name] = path.join(root, name);
    initRepository(repos[name]);
    fs.writeFileSync(path.join(repos[name], "README.md"), name);
    commitAll(repos[name], "seed");
    originBranch(repos[name], BASES[name]);
  }

  const hub = path.join(root, "growspace_manager_workspace");
  initRepository(hub);
  for (const name of ["growspace-repos", "growspace-repos.cjs", ...scripts]) {
    const destination = path.join(hub, "scripts", name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(SOURCE_ROOT, "scripts", name), destination);
    fs.chmodSync(destination, 0o755);
  }
  executable(
    path.join(hub, "scripts", "backend-venv"),
    '#!/usr/bin/env bash\nprintf "venv:%s|%s\\n" "$1" "$2" >> "$HELPER_LOG"\n',
  );
  executable(
    path.join(hub, "scripts", "card-node-modules"),
    '#!/usr/bin/env bash\nprintf "card:%s|%s\\n" "$1" "$2" >> "$HELPER_LOG"\n',
  );
  fs.writeFileSync(path.join(hub, ".gitignore"), ".claude/\nworktrees/\n");
  commitAll(hub, "hub");

  const worktree = path.join(hub, ".claude", "worktrees", "agent");
  git(hub, "worktree", "add", "-q", "-b", "agent", worktree);
  return { root, hub, worktree, repos, helperLog: path.join(root, "helper.log") };
}

function resolve(checkout, ...args) {
  return execFileSync(path.join(checkout, "scripts", "growspace-repos"), args, {
    encoding: "utf8",
  }).trim();
}

for (const where of ["main checkout", "nested hub worktree"]) {
  test(`resolves the main hub and its siblings from the ${where}`, (t) => {
    const f = fixture(t);
    const checkout = where === "main checkout" ? f.hub : f.worktree;

    assert.equal(resolve(checkout, "--hub"), f.hub);
    for (const name of REPOS) {
      assert.equal(resolve(checkout, name), f.repos[name]);
    }
    assert.deepEqual(
      resolve(checkout).split("\n"),
      [...REPOS.map((name) => `${name}\t${f.repos[name]}`),
        `growspace_manager_workspace\t${f.hub}`],
    );
  });
}

test("names a sibling that is not cloned rather than hiding it", (t) => {
  const f = fixture(t);
  fs.rmSync(f.repos.growspace_manager_tc, { recursive: true, force: true });

  assert.equal(
    resolve(f.worktree, "growspace_manager_tc"),
    f.repos.growspace_manager_tc,
  );
  assert.doesNotMatch(resolve(f.worktree), /growspace_manager_tc/);
});

test("a hub that is no git checkout is its own main checkout", (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "growspace-repos-plain-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hub = path.join(root, "hub");
  fs.mkdirSync(path.join(hub, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(SOURCE_ROOT, "scripts", "growspace-repos"),
    path.join(hub, "scripts", "growspace-repos"),
  );

  assert.equal(resolve(hub, "--hub"), hub);
  assert.equal(resolve(hub, "growspace_manager"), path.join(root, "growspace_manager"));
});

test("refuses a repository it does not know", (t) => {
  const f = fixture(t);
  const result = spawnSync(
    path.join(f.worktree, "scripts", "growspace-repos"),
    ["growspace_manger"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown repository 'growspace_manger'/);
});

test("Node scripts ask the same resolver from a hub worktree", (t) => {
  const f = fixture(t);
  const shim = path.join(f.worktree, "scripts", "growspace-repos.cjs");
  const answer = execFileSync(
    process.execPath,
    [
      "-e",
      "const r = require(process.argv[1]); console.log(r.mainHub()); console.log(r.siblingRepo('lovelace-growspace-manager-card'))",
      shim,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    answer,
    `${f.hub}\n${f.repos["lovelace-growspace-manager-card"]}\n`,
  );
});

test("check from a hub worktree reports the main checkouts, not MISSING", (t) => {
  const f = fixture(t, ["check"]);
  const result = spawnSync(
    path.join(f.worktree, "scripts", "check"),
    ["backend", "fast"],
    { cwd: f.worktree, encoding: "utf8", env: cleanEnv() },
  );
  const header = result.stdout.replace(/\x1b\[[0-9;]*m/g, "");

  assert.doesNotMatch(header, /MISSING/);
  assert.match(header, new RegExp(`backend:\\s+${f.repos.growspace_manager}$`, "m"));
  assert.match(
    header,
    new RegExp(`card:\\s+${f.repos["lovelace-growspace-manager-card"]}$`, "m"),
  );
});

test("feature new from a hub worktree builds the pair on the main checkouts", (t) => {
  const f = fixture(t, ["feature"]);
  const result = spawnSync(
    path.join(f.worktree, "scripts", "feature"),
    ["new", "irrigation-v2"],
    {
      encoding: "utf8",
      env: cleanEnv({ HELPER_LOG: f.helperLog }),
    },
  );
  assert.equal(result.status, 0, result.stderr);

  const backendWorktree = path.join(f.repos.growspace_manager, ".worktrees", "irrigation-v2");
  const pair = path.join(f.hub, "worktrees", "irrigation-v2");
  assert.equal(git(backendWorktree, "branch", "--show-current"), "feature/irrigation-v2");
  assert.equal(fs.realpathSync(path.join(pair, "backend")), backendWorktree);
  assert.equal(git(path.join(pair, "card"), "branch", "--show-current"), "feature/irrigation-v2");
  assert.equal(
    git(path.join(pair, "card"), "rev-parse", "--path-format=absolute", "--git-common-dir"),
    path.join(f.repos["lovelace-growspace-manager-card"], ".git"),
  );
  assert.equal(fs.existsSync(path.join(f.worktree, "worktrees")), false);
  assert.equal(
    fs.readFileSync(f.helperLog, "utf8"),
    `venv:${f.repos.growspace_manager}|${backendWorktree}\n` +
      `card:${f.repos["lovelace-growspace-manager-card"]}|${path.join(pair, "card")}\n`,
  );
});

test("--base names each repository's own integration branch", (t) => {
  const f = fixture(t);
  for (const name of REPOS) {
    assert.equal(resolve(f.worktree, "--base", name), `origin/${BASES[name]}`);
  }
});

test("--base takes a per-repository override and refuses a branch that is not there", (t) => {
  const f = fixture(t);
  const card = f.repos["lovelace-growspace-manager-card"];
  originBranch(card, "main");
  const base = (env) =>
    spawnSync(
      path.join(f.worktree, "scripts", "growspace-repos"),
      ["--base", "lovelace-growspace-manager-card"],
      { encoding: "utf8", env: cleanEnv(env) },
    );

  assert.equal(base({ GROWSPACE_CARD_BASE_BRANCH: "main" }).stdout, "origin/main\n");
  // The override is per repository: the backend's does not move the card.
  assert.equal(base({ GROWSPACE_BACKEND_BASE_BRANCH: "main" }).stdout, "origin/dev\n");

  const missing = base({ GROWSPACE_CARD_BASE_BRANCH: "prerelease" });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /lovelace-growspace-manager-card has no origin\/prerelease/);
  assert.match(missing.stderr, /GROWSPACE_CARD_BASE_BRANCH/);

  git(card, "update-ref", "-d", "refs/remotes/origin/dev");
  const noDefault = base({});
  assert.equal(noDefault.status, 1);
  assert.match(noDefault.stderr, /lovelace-growspace-manager-card has no origin\/dev/);
  assert.match(noDefault.stderr, new RegExp(`git -C ${card} fetch origin`));
});

test("feature new starts every repository from its own base and says which", (t) => {
  const f = fixture(t, ["feature"]);
  const result = spawnSync(
    path.join(f.worktree, "scripts", "feature"),
    ["new", "coverage", "--all"],
    { encoding: "utf8", env: cleanEnv({ HELPER_LOG: f.helperLog }) },
  );
  assert.equal(result.status, 0, result.stderr);

  const pair = path.join(f.hub, "worktrees", "coverage");
  const worktrees = {
    growspace_manager: path.join(pair, "backend"),
    growspace_manager_tc: path.join(pair, "tc"),
    "lovelace-growspace-manager-card": path.join(pair, "card"),
  };
  for (const [name, worktree] of Object.entries(worktrees)) {
    assert.equal(
      git(worktree, "rev-parse", "HEAD"),
      git(f.repos[name], "rev-parse", `refs/remotes/origin/${BASES[name]}`),
      `${name} should start from origin/${BASES[name]}`,
    );
  }
  assert.match(result.stdout, /backend:[^\n]*\n\s+from:\s+base origin\/prerelease$/m);
  assert.match(result.stdout, /tc:[^\n]*\n\s+from:\s+base origin\/main$/m);
  assert.match(result.stdout, /card:[^\n]*\n\s+from:\s+base origin\/dev$/m);
  assert.doesNotMatch(result.stdout, /\(base: origin/);
});

test("feature new says so when it reuses an existing branch", (t) => {
  const f = fixture(t, ["feature"]);
  git(f.repos.growspace_manager, "branch", "feature/resume");
  const result = spawnSync(
    path.join(f.worktree, "scripts", "feature"),
    ["new", "resume", "--backend-only"],
    { encoding: "utf8", env: cleanEnv({ HELPER_LOG: f.helperLog }) },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /from:\s+existing branch feature\/resume$/m);
});

test("feature new refuses a missing base before making any worktree", (t) => {
  const f = fixture(t, ["feature"]);
  const card = f.repos["lovelace-growspace-manager-card"];
  git(card, "update-ref", "-d", "refs/remotes/origin/dev");

  const result = spawnSync(
    path.join(f.worktree, "scripts", "feature"),
    ["new", "stranded"],
    { encoding: "utf8", env: cleanEnv({ HELPER_LOG: f.helperLog }) },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lovelace-growspace-manager-card has no origin\/dev/);
  // Nothing silently fell back to main, and the backend was not left half-made.
  assert.equal(fs.existsSync(path.join(f.repos.growspace_manager, ".worktrees", "stranded")), false);
  assert.equal(fs.existsSync(path.join(f.hub, "worktrees", "stranded")), false);
  assert.equal(
    spawnSync("git", ["-C", card, "show-ref", "--quiet", "refs/heads/feature/stranded"]).status,
    1,
  );
});

test("feature new refuses a global BASE and names the per-repository overrides", (t) => {
  const f = fixture(t, ["feature"]);
  const result = spawnSync(
    path.join(f.worktree, "scripts", "feature"),
    ["new", "global"],
    { encoding: "utf8", env: cleanEnv({ BASE: "main", HELPER_LOG: f.helperLog }) },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /BASE=main would base every repository on one branch/);
  assert.match(result.stderr, /GROWSPACE_BACKEND_BASE_BRANCH=main/);
  assert.equal(fs.existsSync(path.join(f.hub, "worktrees", "global")), false);
});

test("e2e from a hub worktree runs the main card and backend checkouts", (t) => {
  const f = fixture(t, ["e2e"]);
  const card = f.repos["lovelace-growspace-manager-card"];
  fs.mkdirSync(path.join(card, "tests", "e2e"), { recursive: true });
  fs.writeFileSync(path.join(card, "tests", "e2e", ".env.test"), "HA_BASE_URL=http://x\n");
  fs.mkdirSync(path.join(f.repos.growspace_manager, "custom_components", "growspace_manager"), {
    recursive: true,
  });
  const bin = path.join(f.root, "bin");
  const npmLog = path.join(f.root, "npm.log");
  executable(path.join(bin, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*" > "$FAKE_NPM_LOG"\n');

  const result = spawnSync(path.join(f.worktree, "scripts", "e2e"), ["full"], {
    encoding: "utf8",
    env: cleanEnv({
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_NPM_LOG: npmLog,
      HA_ACCESS_TOKEN: "fake-token",
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(npmLog, "utf8").trim(),
    `--prefix ${path.join(card, "tests", "e2e")} test --`,
  );
});

test("vision from a hub worktree builds the main Vision checkout", (t) => {
  const f = fixture(t, ["vision"]);
  const buildLog = path.join(f.root, "build.log");
  executable(
    path.join(f.repos.growspace_manager_vision, "scripts", "build-app-images.sh"),
    '#!/bin/sh\nprintf "%s %s\\n" "$(pwd -P)" "$*" > "$FAKE_BUILD_LOG"\n',
  );

  const result = spawnSync(path.join(f.worktree, "scripts", "vision"), ["build"], {
    cwd: f.repos.growspace_manager_vision,
    encoding: "utf8",
    env: cleanEnv({ FAKE_BUILD_LOG: buildLog }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(buildLog, "utf8").trim(),
    `${f.repos.growspace_manager_vision} amd64`,
  );
});

test("ha's worktree refusal prints override paths that exist", (t) => {
  const f = fixture(t, ["ha"]);
  fs.mkdirSync(path.join(f.repos["lovelace-growspace-manager-card"], "dist"));

  const result = spawnSync(path.join(f.worktree, "scripts", "ha"), ["dev", "restart"], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`main: ${f.hub}$`, "m"));
  const dist = result.stderr.match(/GROWSPACE_CARD_DIST=(\S+)/)[1];
  assert.equal(dist, path.join(f.repos["lovelace-growspace-manager-card"], "dist"));
  assert.equal(fs.existsSync(dist), true);
  assert.match(result.stderr, new RegExp(`${f.hub}/scripts/ha dev restart`));
});

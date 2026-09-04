const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = path.resolve(__dirname, "..");

function executable(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function copyScript(name, hub) {
  const destination = path.join(hub, "scripts", name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(SOURCE_ROOT, "scripts", name), destination);
  fs.chmodSync(destination, 0o755);
}

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  }).trim();
}

function initRepository(repository, files = {}) {
  fs.mkdirSync(repository, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repository]);
  git(repository, "config", "user.email", "tests@example.com");
  git(repository, "config", "user.name", "Hub tooling tests");
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(repository, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "fixture");
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growspace-tc-tooling-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, hub: path.join(root, "growspace_manager_workspace") };
}

test("check tc validates the selected checkout through its own Python suite", (t) => {
  const { root, hub } = fixture(t);
  const tc = path.join(root, "growspace_manager_tc");
  const log = path.join(root, "python.log");
  copyScript("check", hub);
  executable(
    path.join(hub, "scripts", "check-e2e-coverage"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  fs.mkdirSync(path.join(tc, "custom_components", "growspace_manager_tc"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tc, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(tc, "requirements.txt"),
    "homeassistant==2026.8.0\n",
  );
  executable(
    path.join(tc, ".venv", "bin", "python"),
    "#!/usr/bin/env bash\n" +
      'if [ "${1:-}" = "-c" ]; then echo /tmp/package_constraints.txt; exit 0; fi\n' +
      'printf "%s\\n" "$*" >> "$FAKE_PYTHON_LOG"\n',
  );
  executable(
    path.join(tc, ".venv", "bin", "uv"),
    "#!/usr/bin/env bash\n" +
      'if [ "${FAKE_UV_DRIFT:-0}" = 1 ]; then echo "Would install homeassistant"; else echo "Would make no changes"; fi\n',
  );

  const result = spawnSync(path.join(hub, "scripts", "check"), ["tc", "fast"], {
    encoding: "utf8",
    env: { ...process.env, GROWSPACE_TC: tc, FAKE_PYTHON_LOG: log },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /checking.*tc \/ fast/s);
  assert.match(result.stdout, /TC pytest/);
  assert.match(fs.readFileSync(log, "utf8"), /-m pytest tests\/ -q/);

  const full = spawnSync(path.join(hub, "scripts", "check"), ["tc", "full"], {
    encoding: "utf8",
    env: { ...process.env, GROWSPACE_TC: tc, FAKE_PYTHON_LOG: log },
  });
  assert.equal(full.status, 0, full.stderr);
  assert.match(
    fs.readFileSync(log, "utf8"),
    /--cov=custom_components\.growspace_manager_tc/,
  );
});

test("check tc refuses dependency drift before running any validation stage", (t) => {
  const { root, hub } = fixture(t);
  const tc = path.join(root, "growspace_manager_tc");
  const log = path.join(root, "python.log");
  copyScript("check", hub);
  executable(
    path.join(hub, "scripts", "check-e2e-coverage"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  fs.mkdirSync(tc, { recursive: true });
  fs.writeFileSync(
    path.join(tc, "requirements.txt"),
    "homeassistant==2026.8.0\n",
  );
  executable(
    path.join(tc, ".venv", "bin", "python"),
    "#!/usr/bin/env bash\n" +
      'if [ "${1:-}" = "-c" ]; then echo /tmp/package_constraints.txt; exit 0; fi\n' +
      'printf "%s\\n" "$*" >> "$FAKE_PYTHON_LOG"\n',
  );
  executable(
    path.join(tc, ".venv", "bin", "uv"),
    '#!/usr/bin/env bash\necho "Would install homeassistant"\n',
  );

  const result = spawnSync(path.join(hub, "scripts", "check"), ["tc", "fast"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GROWSPACE_TC: tc,
      FAKE_PYTHON_LOG: log,
      FAKE_UV_DRIFT: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /tc environment drift/);
  assert.match(result.stdout, /refusing to run/);
  assert.equal(
    fs.existsSync(log),
    false,
    "ruff/mypy/pytest must not run after a guard refusal",
  );
});

test("check all validates TC rather than skipping it", (t) => {
  // Before the TC scaffold landed, `all` skipped the slot whenever the checkout
  // had no requirements.txt. Now that every TC checkout carries one, an absent
  // file means a stale or broken tree — and silence about it would let `all`
  // report green while validating two repositories out of four.
  const { root, hub } = fixture(t);
  const backend = path.join(root, "growspace_manager");
  const tc = path.join(root, "growspace_manager_tc");
  const card = path.join(root, "lovelace-growspace-manager-card");
  copyScript("check", hub);
  executable(
    path.join(hub, "scripts", "check-e2e-coverage"),
    "#!/usr/bin/env bash\nexit 0\n",
  );

  const fakePython =
    "#!/usr/bin/env bash\n" +
    'if [ "${1:-}" = "-c" ]; then echo /tmp/package_constraints.txt; exit 0; fi\n';
  const fakeUv = '#!/usr/bin/env bash\necho "Would make no changes"\n';

  // A backend and a card whose guards pass, so the only refusal is TC's.
  fs.mkdirSync(backend, { recursive: true });
  fs.writeFileSync(
    path.join(backend, "requirements.txt"),
    "homeassistant==2026.8.0\n",
  );
  executable(path.join(backend, ".venv", "bin", "python"), fakePython);
  executable(path.join(backend, ".venv", "bin", "uv"), fakeUv);
  fs.mkdirSync(path.join(card, "node_modules"), { recursive: true });

  // A TC checkout that exists but carries no requirements.txt.
  executable(path.join(tc, ".venv", "bin", "python"), fakePython);

  const result = spawnSync(path.join(hub, "scripts", "check"), ["all", "fast"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GROWSPACE_BACKEND: backend,
      GROWSPACE_TC: tc,
      GROWSPACE_CARD: card,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing .*growspace_manager_tc\/requirements\.txt/);
  assert.match(result.stdout, /refusing to run/);
  assert.doesNotMatch(result.stdout, /skipped/);
});

test("feature --tc creates a hook-depth TC worktree paired with the card", (t) => {
  const { root, hub } = fixture(t);
  const tc = path.join(root, "growspace_manager_tc");
  const card = path.join(root, "lovelace-growspace-manager-card");
  const helperLog = path.join(root, "helper.log");
  initRepository(tc, { "requirements.txt": "homeassistant==2026.8.0\n" });
  initRepository(card, { "package-lock.json": "{}\n" });
  fs.mkdirSync(hub, { recursive: true });
  copyScript("feature", hub);
  executable(
    path.join(hub, "scripts", "backend-venv"),
    '#!/usr/bin/env bash\nprintf "venv:%s|%s|%s\\n" "$1" "$2" "$3" >> "$HELPER_LOG"\n',
  );
  executable(
    path.join(hub, "scripts", "card-node-modules"),
    '#!/usr/bin/env bash\nprintf "card:%s|%s\\n" "$1" "$2" >> "$HELPER_LOG"\n',
  );

  const result = spawnSync(
    path.join(hub, "scripts", "feature"),
    ["new", "culture-lines", "--tc"],
    {
      encoding: "utf8",
      env: { ...process.env, BASE: "main", HELPER_LOG: helperLog },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const tcWorktree = path.join(tc, ".worktrees", "culture-lines");
  const pairRoot = path.join(hub, "worktrees", "culture-lines");
  assert.equal(
    fs.realpathSync(path.join(pairRoot, "tc")),
    fs.realpathSync(tcWorktree),
  );
  assert.equal(
    git(tcWorktree, "branch", "--show-current"),
    "feature/culture-lines",
  );
  assert.equal(
    git(path.join(pairRoot, "card"), "branch", "--show-current"),
    "feature/culture-lines",
  );
  assert.match(
    fs.readFileSync(helperLog, "utf8"),
    /venv:.*growspace_manager_tc.*\|tc/,
  );
});

test("Codex setup gives TC a private-venv-compatible worktree depth", (t) => {
  const { root, hub } = fixture(t);
  const backend = path.join(root, "growspace_manager");
  const tc = path.join(root, "growspace_manager_tc");
  const vision = path.join(root, "growspace_manager_vision");
  const card = path.join(root, "lovelace-growspace-manager-card");
  const helperLog = path.join(root, "helper.log");
  initRepository(hub, { "README.md": "fixture\n" });
  initRepository(backend, { "requirements.txt": "homeassistant==2026.8.0\n" });
  initRepository(tc, { "requirements.txt": "homeassistant==2026.8.0\n" });
  initRepository(vision, {
    "pyproject.toml": "[project]\nname='vision'\nversion='1'\n",
  });
  initRepository(card, { "package-lock.json": "{}\n" });
  executable(
    path.join(backend, ".venv", "bin", "python"),
    "#!/usr/bin/env bash\n",
  );
  executable(
    path.join(vision, ".venv", "bin", "python"),
    "#!/usr/bin/env bash\n",
  );
  fs.mkdirSync(path.join(card, "node_modules"), { recursive: true });
  copyScript("codex-worktree", hub);
  executable(
    path.join(hub, "scripts", "backend-venv"),
    '#!/usr/bin/env bash\nprintf "venv:%s|%s|%s\\n" "$1" "$2" "$3" >> "$HELPER_LOG"\n',
  );
  executable(
    path.join(hub, "scripts", "card-node-modules"),
    '#!/usr/bin/env bash\nprintf "card:%s|%s\\n" "$1" "$2" >> "$HELPER_LOG"\n',
  );

  const result = spawnSync(
    path.join(hub, "scripts", "codex-worktree"),
    ["setup"],
    {
      encoding: "utf8",
      env: { ...process.env, HELPER_LOG: helperLog },
    },
  );
  assert.equal(result.status, 0, result.stderr);

  const pairRoot = spawnSync(
    path.join(hub, "scripts", "codex-worktree"),
    ["path"],
    {
      encoding: "utf8",
    },
  ).stdout.trim();
  const tcWorktree = path.join(
    pairRoot,
    "growspace_manager_tc",
    ".worktrees",
    "tc",
  );
  assert.equal(
    fs.realpathSync(path.join(pairRoot, "tc")),
    fs.realpathSync(tcWorktree),
  );
  assert.equal(
    path.resolve(tcWorktree, "..", "..", ".venv"),
    path.join(pairRoot, "growspace_manager_tc", ".venv"),
  );
  assert.match(
    fs.readFileSync(helperLog, "utf8"),
    /venv:.*growspace_manager_tc.*\|tc/,
  );
});

test("Codex setup includes the Vision checkout used by workspace checks", (t) => {
  const { root, hub } = fixture(t);
  const backend = path.join(root, "growspace_manager");
  const tc = path.join(root, "growspace_manager_tc");
  const vision = path.join(root, "growspace_manager_vision");
  const card = path.join(root, "lovelace-growspace-manager-card");
  const checkLog = path.join(root, "check.log");
  initRepository(hub, { "README.md": "fixture\n" });
  initRepository(backend, { "requirements.txt": "homeassistant==2026.8.0\n" });
  initRepository(tc, { "requirements.txt": "homeassistant==2026.8.0\n" });
  initRepository(vision, { "pyproject.toml": "[project]\nname='vision'\nversion='1'\n" });
  initRepository(card, { "package-lock.json": "{}\n" });
  executable(path.join(backend, ".venv", "bin", "python"), "#!/usr/bin/env bash\n");
  executable(path.join(vision, ".venv", "bin", "python"), "#!/usr/bin/env bash\n");
  fs.mkdirSync(path.join(card, "node_modules"), { recursive: true });
  copyScript("codex-worktree", hub);
  executable(path.join(hub, "scripts", "backend-venv"), "#!/usr/bin/env bash\n");
  executable(path.join(hub, "scripts", "card-node-modules"), "#!/usr/bin/env bash\n");
  executable(
    path.join(hub, "scripts", "check"),
    '#!/usr/bin/env bash\nprintf "%s|%s\\n" "$GROWSPACE_VISION" "$GROWSPACE_VISION_PY" > "$CHECK_LOG"\n',
  );

  const result = spawnSync(
    path.join(hub, "scripts", "codex-worktree"),
    ["check", "vision", "fast"],
    { encoding: "utf8", env: { ...process.env, CHECK_LOG: checkLog } },
  );

  assert.equal(result.status, 0, result.stderr);
  const pairRoot = spawnSync(
    path.join(hub, "scripts", "codex-worktree"),
    ["path"],
    { encoding: "utf8" },
  ).stdout.trim();
  const visionWorktree = path.join(pairRoot, "vision");
  assert.equal(git(visionWorktree, "branch", "--show-current").startsWith("codex/"), true);
  assert.equal(
    fs.readFileSync(checkLog, "utf8").trim(),
    `${visionWorktree}|${path.join(vision, ".venv", "bin", "python")}`,
  );
});

test("the dev runtime reserves a host-owned TC mount when the checkout is absent", (t) => {
  const { hub } = fixture(t);
  copyScript("ha", hub);

  const result = spawnSync(path.join(hub, "scripts", "ha"), ["dev", "url"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "http://localhost:8123");
  assert.equal(
    fs.existsSync(
      path.join(hub, "ha-dev", "custom_components", "growspace_manager_tc"),
    ),
    true,
  );
  assert.match(
    fs.readFileSync(path.join(SOURCE_ROOT, "docker-compose.yml"), "utf8"),
    /GROWSPACE_TC_SRC.*\/config\/custom_components\/growspace_manager_tc/,
  );
});

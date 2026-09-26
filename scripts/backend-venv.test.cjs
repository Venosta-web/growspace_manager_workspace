const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// scripts/backend-venv gives every supported Python worktree a private venv and
// refuses branches whose fixed-path hooks would ignore it. These tests drive
// the real script against a fake `uv` that models what matters: a
// venv realizes a requirements.txt iff it was installed from one with the same
// content, and every install writes to the venv its --python resolves to — so
// an install through a `.venv` link lands in the lender, as it does for real.
// See docs/adr/0004-python-hooks-run-the-worktrees-own-venv.md.

const SOURCE_ROOT = path.resolve(__dirname, "..");

const MAIN_PINS = "homeassistant==2026.9.3\nfpdf2==2.8.7\n";
const BUMPED_PINS = "homeassistant==2026.9.3\nfpdf2==2.8.8\n";

const NEW_HOOKS = `repos:
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: python3 .github/scripts/run_venv_tool.py pytest
        language: system
`;
const OLD_HOOKS = `repos:
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: ../../.venv/bin/pytest
        language: system
`;

const FAKE_PYTHON =
  "#!/usr/bin/env bash\n" +
  'if [ "${1:-}" = "-c" ]; then echo /tmp/package_constraints.txt; exit 0; fi\n';

const FAKE_UV = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_UV_LOG"
case "$1" in
  venv)
    dest="\${@: -1}"
    [ -e "$dest" ] && { echo "A virtual environment already exists at $dest" >&2; exit 2; }
    mkdir -p "$dest/bin"
    printf '%s' "$FAKE_PYTHON_SOURCE" > "$dest/bin/python"
    chmod +x "$dest/bin/python"
    exit 0
    ;;
  pip)
    shift 2
    py="" req="" dry=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --python) py="$2"; shift ;;
        -r) req="$2"; shift ;;
        --dry-run) dry=1 ;;
      esac
      shift
    done
    venv="$(dirname "$(dirname "$py")")"
    [ -n "$req" ] || exit 0
    if [ "$dry" = 1 ]; then
      if cmp -s "$venv/pins" "$req"; then echo "Would make no changes"
      else echo "Would install 1 package"; echo " + fpdf2==2.8.8"; fi
      exit 0
    fi
    cp "$req" "$venv/pins"
    ;;
esac
`;

function executable(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

// Every hub script finds its checkouts through scripts/growspace-repos, so a
// copied script always brings the resolver along.
function copyScript(name, hub) {
  for (const script of [name, "growspace-repos"]) {
    const destination = path.join(hub, "scripts", script);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(SOURCE_ROOT, "scripts", script), destination);
    fs.chmodSync(destination, 0o755);
  }
}

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// A venv the fake uv regards as realizing `pins`.
function makeVenv(venv, pins, { uv = false } = {}) {
  executable(path.join(venv, "bin", "python"), FAKE_PYTHON);
  if (uv) executable(path.join(venv, "bin", "uv"), FAKE_UV);
  fs.writeFileSync(path.join(venv, "pins"), pins);
}

function commitAll(repository, files) {
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(repository, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  git(repository, "add", ".");
  git(repository, "commit", "-q", "--allow-empty", "-m", "fixture");
}

// A main checkout on MAIN_PINS with its venv, and a scripts/feature-layout
// worktree whose branch carries `hooks` and `pins`.
function fixture(t, { hooks, pins = MAIN_PINS, name = "x", mainVenvPins = MAIN_PINS } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growspace-backend-venv-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hub = path.join(root, "growspace_manager_workspace");
  const main = path.join(root, "growspace_manager");
  fs.mkdirSync(main, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "prerelease", main]);
  git(main, "config", "user.email", "tests@example.com");
  git(main, "config", "user.name", "Hub tooling tests");
  commitAll(main, {
    ".gitignore": ".venv\n.worktrees/\n",
    "requirements.txt": MAIN_PINS,
    ".pre-commit-config.yaml": NEW_HOOKS,
  });
  makeVenv(path.join(main, ".venv"), mainVenvPins, { uv: true });

  const worktree = path.join(main, ".worktrees", name);
  git(main, "worktree", "add", "-q", "-b", `feature/${name}`, worktree);
  if (hooks !== undefined || pins !== MAIN_PINS) {
    commitAll(worktree, {
      ".pre-commit-config.yaml": hooks ?? NEW_HOOKS,
      "requirements.txt": pins,
    });
  }

  for (const script of ["backend-venv", "feature", "check"]) copyScript(script, hub);
  executable(path.join(hub, "scripts", "check-e2e-coverage"), "#!/usr/bin/env bash\nexit 0\n");

  const log = path.join(root, "uv.log");
  const env = { ...process.env, FAKE_UV_LOG: log, FAKE_PYTHON_SOURCE: FAKE_PYTHON };
  return { root, hub, main, worktree, log, env };
}

function backendVenv(f, worktree = f.worktree, kind = "backend") {
  return spawnSync(path.join(f.hub, "scripts", "backend-venv"), [f.main, worktree, kind], {
    encoding: "utf8",
    env: f.env,
  });
}

function uvLog(f) {
  return fs.existsSync(f.log) ? fs.readFileSync(f.log, "utf8") : "";
}

function assertMainVenvUntouched(f) {
  const mainVenv = path.join(f.main, ".venv");
  assert.equal(fs.lstatSync(mainVenv).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(mainVenv, "pins"), "utf8"), MAIN_PINS);
  assert.ok(fs.existsSync(path.join(mainVenv, "bin", "python")));
  for (const line of uvLog(f).split("\n")) {
    assert.doesNotMatch(line, /--clear/);
    if (/--dry-run/.test(line)) continue;
    assert.ok(!line.includes(`${mainVenv}/`) && !line.endsWith(mainVenv), `install targeted the main venv: ${line}`);
  }
}

test("new-form hooks: a feature worktree gets a private venv realizing its own pins", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS, pins: BUMPED_PINS });

  const result = backendVenv(f);

  assert.equal(result.status, 0, result.stderr);
  const own = path.join(f.worktree, ".venv");
  assert.equal(fs.lstatSync(own).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(own, "pins"), "utf8"), BUMPED_PINS);
  assert.match(result.stdout, /private backend venv at .*\.worktrees\/x\/\.venv/);
  assertMainVenvUntouched(f);
});

test("new-form hooks: an install in one worktree reaches neither the main venv nor another worktree", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS });
  const other = path.join(f.main, ".worktrees", "y");
  git(f.main, "worktree", "add", "-q", "-b", "feature/y", other);
  assert.equal(backendVenv(f).status, 0);
  assert.equal(backendVenv(f, other).status, 0);

  // `uv pip install` into the first worktree's own interpreter.
  const extra = path.join(f.root, "extra.txt");
  fs.writeFileSync(extra, "cowsay\n");
  execFileSync(path.join(f.main, ".venv", "bin", "uv"), [
    "pip", "install", "--python", path.join(f.worktree, ".venv", "bin", "python"), "-r", extra,
  ], { env: f.env });

  assert.equal(fs.readFileSync(path.join(f.worktree, ".venv", "pins"), "utf8"), "cowsay\n");
  assert.equal(fs.readFileSync(path.join(f.main, ".venv", "pins"), "utf8"), MAIN_PINS);
  assert.equal(fs.readFileSync(path.join(other, ".venv", "pins"), "utf8"), MAIN_PINS);
});

test("new-form hooks: a .venv link to the main venv is replaced, never cleared through", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS, pins: BUMPED_PINS });
  fs.symlinkSync(path.join(f.main, ".venv"), path.join(f.worktree, ".venv"));

  const result = backendVenv(f);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /replacing the backend venv link .* with a private venv/);
  const own = path.join(f.worktree, ".venv");
  assert.equal(fs.lstatSync(own).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(own, "pins"), "utf8"), BUMPED_PINS);
  assertMainVenvUntouched(f);
});

test("new-form hooks: a drifted private venv is rebuilt, a current one left alone", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS, pins: BUMPED_PINS });
  makeVenv(path.join(f.worktree, ".venv"), MAIN_PINS);

  const rebuilt = backendVenv(f);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.match(rebuilt.stdout, /no longer realizes requirements\.txt; rebuilding/);
  assert.equal(fs.readFileSync(path.join(f.worktree, ".venv", "pins"), "utf8"), BUMPED_PINS);

  fs.writeFileSync(f.log, "");
  const again = backendVenv(f);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /building/);
  assert.doesNotMatch(uvLog(f), /^venv /m);
});

test("fixed-path hooks refuse before creating or changing a venv", (t) => {
  const f = fixture(t, { hooks: OLD_HOOKS, pins: BUMPED_PINS });
  const own = path.join(f.worktree, ".venv");
  fs.symlinkSync(path.join(f.main, ".venv"), own);

  const result = backendVenv(f);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hooks declare `entry: \.\.\/\.\.\/\.venv\/bin\/\.\.\.`/);
  assert.match(result.stderr, /rebase onto a base that has the hook runner/);
  assert.equal(fs.readlinkSync(own), path.join(f.main, ".venv"));
  assert.equal(uvLog(f), "");
  assertMainVenvUntouched(f);
});

test("quoted fixed-path TC hooks are refused too", (t) => {
  const f = fixture(t, { hooks: OLD_HOOKS.replace("entry: ../../", 'entry: "../../')
    .replace("/pytest\n", '/pytest"\n') });

  const result = backendVenv(f, f.worktree, "tc");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /rebase onto a base that has the hook runner/);
  assert.equal(fs.existsSync(path.join(f.worktree, ".venv")), false);
  assert.equal(uvLog(f), "");
  assertMainVenvUntouched(f);
});

test("a branch with no pre-commit config gets a private venv", (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.worktree, ".pre-commit-config.yaml"));

  const result = backendVenv(f);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(path.join(f.worktree, ".venv")).isSymbolicLink(), false);
  assertMainVenvUntouched(f);
});

test("the main checkout itself is refused", (t) => {
  const f = fixture(t);

  const result = backendVenv(f, f.main);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is the main backend checkout/);
  assert.equal(uvLog(f), "");
});

test("feature env converts a linked new-form worktree to a private venv", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS });
  fs.symlinkSync(path.join(f.main, ".venv"), path.join(f.worktree, ".venv"));

  const result = spawnSync(path.join(f.hub, "scripts", "feature"), ["env", "x"], {
    encoding: "utf8",
    env: f.env,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(path.join(f.worktree, ".venv")).isSymbolicLink(), false);
  assertMainVenvUntouched(f);
});

test("feature env refuses a name with no Python worktree", (t) => {
  const f = fixture(t);

  const result = spawnSync(path.join(f.hub, "scripts", "feature"), ["env", "nope"], {
    encoding: "utf8",
    env: f.env,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no backend or TC worktree named 'nope'/);
});

function checkBackend(f, checkout) {
  return spawnSync(path.join(f.hub, "scripts", "check"), ["backend", "fast"], {
    encoding: "utf8",
    env: { ...f.env, GROWSPACE_BACKEND: checkout },
  });
}

test("check's drift refusal in a feature worktree names feature env", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS, pins: BUMPED_PINS });
  fs.symlinkSync(path.join(f.main, ".venv"), path.join(f.worktree, ".venv"));

  const result = checkBackend(f, f.worktree);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /backend environment drift/);
  assert.match(result.stderr, /links to .*growspace_manager\/\.venv, which other checkouts run too/);
  assert.match(result.stderr, /\.\/scripts\/feature env x/);
  assert.doesNotMatch(result.stderr, /codex-worktree/);
});

test("check's drift refusal in a Codex set names codex-worktree setup", (t) => {
  const f = fixture(t);
  const owner = path.join(f.root, "hub-worktree");
  const pairWorktree = path.join(owner, "worktrees", "codex-abc123", "backend");
  git(f.main, "worktree", "add", "-q", "-b", "codex/abc", pairWorktree);
  commitAll(pairWorktree, { "requirements.txt": BUMPED_PINS });
  makeVenv(path.join(pairWorktree, ".venv"), MAIN_PINS);

  const result = checkBackend(f, pairWorktree);

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`\\(cd ${owner} && \\./scripts/codex-worktree setup\\)`));
  assert.doesNotMatch(result.stderr, /feature env/);
});

test("check's drift refusal in the main checkout points at its own pins", (t) => {
  const f = fixture(t, { mainVenvPins: "homeassistant==2026.8.1\n" });

  const result = checkBackend(f, f.main);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /this is the main backend checkout/);
  assert.match(result.stderr, /rebuild the venv from its own pins/);
  assert.doesNotMatch(result.stderr, /feature env|codex-worktree/);
});

test("check with no venv in a feature worktree names feature env", (t) => {
  const f = fixture(t, { hooks: NEW_HOOKS });

  const result = checkBackend(f, f.worktree);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no backend venv at .*\.worktrees\/x\/\.venv/);
  assert.match(result.stderr, /\.\/scripts\/feature env x/);
});

function codexWorktree(f, hooks, pins = MAIN_PINS) {
  const worktree = path.join(f.root, "hub-worktree", "worktrees", "codex-abc123", "backend");
  git(f.main, "worktree", "add", "-q", "-b", "codex/abc", worktree);
  commitAll(worktree, { ".pre-commit-config.yaml": hooks, "requirements.txt": pins });
  return worktree;
}

test("fixed-path hooks in a Codex set are refused without creating any venv", (t) => {
  const f = fixture(t);
  const worktree = codexWorktree(f, OLD_HOOKS, BUMPED_PINS);

  const result = backendVenv(f, worktree);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /rebase onto a base that has the hook runner/);
  // Where the old hooks would look from a flat pair: the hub worktree's
  // worktrees/ directory, which nothing may populate on their behalf.
  assert.equal(fs.existsSync(path.resolve(worktree, "..", "..", ".venv")), false);
  assert.equal(fs.existsSync(path.join(worktree, ".venv")), false);
  assert.equal(uvLog(f), "");
  assertMainVenvUntouched(f);
});

test("new-form hooks in a Codex set: a .venv link becomes the worktree's own", (t) => {
  const f = fixture(t);
  const worktree = codexWorktree(f, NEW_HOOKS, BUMPED_PINS);
  // The ADR 0002 container venv an old pair linked to.
  const lender = path.join(f.root, "hub-worktree", "worktrees", "codex-abc123", "growspace_manager", ".venv");
  makeVenv(lender, MAIN_PINS);
  fs.symlinkSync(lender, path.join(worktree, ".venv"));

  const result = backendVenv(f, worktree);

  assert.equal(result.status, 0, result.stderr);
  const own = path.join(worktree, ".venv");
  assert.equal(fs.lstatSync(own).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(own, "pins"), "utf8"), BUMPED_PINS);
  // Replaced by unlinking, not by clearing through the link.
  assert.equal(fs.readFileSync(path.join(lender, "pins"), "utf8"), MAIN_PINS);
  assertMainVenvUntouched(f);
});

// The dev runtime is one container shared by every agent session, so its source
// mounts are shared state: a restart that names one mount must leave the others
// where another session put them, and the container is the only record of where
// that is. These tests drive scripts/ha and codex-worktree against a fake
// docker whose `inspect` stands in for that container.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SOURCE_ROOT = path.resolve(__dirname, '..');

const TARGETS = {
  backend: '/config/custom_components/growspace_manager',
  tc: '/config/custom_components/growspace_manager_tc',
  card: '/config/www/community/lovelace-growspace-manager-card',
};

function executable(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function copyScript(name, hub) {
  const destination = path.join(hub, 'scripts', name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(SOURCE_ROOT, 'scripts', name), destination);
  fs.chmodSync(destination, 0o755);
}

// A hub that is not a git checkout is its own main checkout, so its siblings
// are the other directories under `root`.
function runtimeFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-ha-mounts-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hub = path.join(root, 'growspace_manager_workspace');
  const bin = path.join(root, 'bin');
  const main = {
    backend: path.join(root, 'growspace_manager', 'custom_components', 'growspace_manager'),
    tc: path.join(root, 'growspace_manager_tc', 'custom_components', 'growspace_manager_tc'),
    card: path.join(root, 'lovelace-growspace-manager-card', 'dist'),
  };
  for (const dir of Object.values(main)) fs.mkdirSync(dir, { recursive: true });

  copyScript('ha', hub);
  copyScript('growspace-repos', hub);
  executable(path.join(hub, 'scripts', 'vision'), '#!/bin/sh\nexit 0\n');
  executable(path.join(bin, 'node'), '#!/bin/sh\nexit 0\n');
  executable(path.join(bin, 'ss'), '#!/bin/sh\nexit 0\n');
  // `inspect` answers from $FAKE_INSPECT, or fails the way docker does when
  // there is no such container. `compose up` records what Compose was handed.
  executable(
    path.join(bin, 'docker'),
    `#!/bin/sh
case "$*" in
  inspect*)
    [ -f "$FAKE_INSPECT" ] || { echo "Error: No such object" >&2; exit 1; }
    cat "$FAKE_INSPECT" ;;
  "compose config --images"*) ;;
  "compose up"*)
    printf 'up|%s|%s|%s\\n' "$GROWSPACE_BACKEND_SRC" "$GROWSPACE_TC_SRC" "$GROWSPACE_CARD_DIST" >>"$FAKE_DOCKER_LOG" ;;
  *) printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG" ;;
esac
`,
  );

  const inspect = path.join(root, 'inspect.out');
  const dockerLog = path.join(root, 'docker.log');

  function container(mounts, state = 'running') {
    const lines = [state, `/config\t${path.join(hub, 'ha-dev')}`];
    for (const [name, source] of Object.entries(mounts)) lines.push(`${TARGETS[name]}\t${source}`);
    fs.writeFileSync(inspect, `${lines.join('\n')}\n`);
  }

  function worktree(name) {
    const dir = path.join(root, 'worktrees', name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function ha(args, env = {}) {
    return spawnSync(path.join(hub, 'scripts', 'ha'), ['dev', ...args], {
      cwd: hub,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_INSPECT: inspect,
        FAKE_DOCKER_LOG: dockerLog,
        GROWSPACE_BACKEND_SRC: '',
        GROWSPACE_TC_SRC: '',
        GROWSPACE_CARD_DIST: '',
        ...env,
      },
    });
  }

  // What the recreate handed Compose, as {backend, tc, card}.
  function started() {
    const ups = fs
      .readFileSync(dockerLog, 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('up|'));
    assert.equal(ups.length, 1, `expected one compose up, got: ${ups.join(', ')}`);
    const [, backend, tc, card] = ups[0].split('|');
    return { backend, tc, card };
  }

  function composeCalls() {
    return fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8') : '';
  }

  return { root, hub, main, container, worktree, ha, started, composeCalls };
}

test('a card override leaves the backend mounted from its worktree', (t) => {
  const f = runtimeFixture(t);
  const backend = f.worktree('backend');
  const card = f.worktree('card-dist');
  f.container({ backend, tc: f.main.tc, card: f.main.card });

  const result = f.ha(['restart'], { GROWSPACE_CARD_DIST: card });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.started(), { backend, tc: f.main.tc, card });
  assert.match(result.stdout, new RegExp(`backend\\s+override\\s+${backend}`));
  assert.match(result.stdout, new RegExp(`card\\s+override\\s+${card}`));
});

test('a plain restart changes no mount', (t) => {
  const f = runtimeFixture(t);
  const mounts = { backend: f.worktree('backend'), tc: f.worktree('tc'), card: f.worktree('card') };
  f.container(mounts, 'exited');

  const result = f.ha(['restart']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.started(), mounts);
});

test('up inherits the stopped container too, since Compose would recreate it', (t) => {
  const f = runtimeFixture(t);
  const tc = f.worktree('tc');
  f.container({ backend: f.main.backend, tc, card: f.main.card }, 'exited');

  const result = f.ha(['up']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.started(), { backend: f.main.backend, tc, card: f.main.card });
});

test('with no container every mount is the main checkout', (t) => {
  const f = runtimeFixture(t);

  const result = f.ha(['restart']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.started(), f.main);
});

test('--main resets the named mounts and keeps the rest', (t) => {
  const f = runtimeFixture(t);
  const mounts = { backend: f.worktree('backend'), tc: f.worktree('tc'), card: f.worktree('card') };
  f.container(mounts);

  const one = f.ha(['restart', '--main', 'backend', 'card']);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(f.started(), { backend: f.main.backend, tc: mounts.tc, card: f.main.card });
});

test('bare --main resets every mount', (t) => {
  const f = runtimeFixture(t);
  f.container({ backend: f.worktree('backend'), tc: f.worktree('tc'), card: f.worktree('card') });

  const result = f.ha(['restart', '--main']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.started(), f.main);
});

test('--main and an override of the same mount are refused before anything stops', (t) => {
  const f = runtimeFixture(t);
  f.container({ backend: f.worktree('backend') });

  const result = f.ha(['restart', '--main', 'backend'], {
    GROWSPACE_BACKEND_SRC: f.worktree('other'),
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--main backend contradicts GROWSPACE_BACKEND_SRC/);
  assert.doesNotMatch(f.composeCalls(), /compose (stop|up)/);
});

test('an unknown argument is refused rather than ignored', (t) => {
  const f = runtimeFixture(t);

  const stray = f.ha(['restart', 'backend']);
  assert.equal(stray.status, 2);
  assert.match(stray.stderr, /only means something after --main/);

  const typo = f.ha(['restart', '--mian']);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /does not take '--mian'/);
  assert.doesNotMatch(f.composeCalls(), /compose (stop|up)/);
});

// Docker creates a missing bind source as an empty root-owned directory, which
// for the card is a dashboard of 404s. A worktree removed since it was mounted
// is not an override anyone still wants.
test('an inherited mount whose checkout is gone falls back to the main checkout', (t) => {
  const f = runtimeFixture(t);
  const gone = path.join(f.root, 'worktrees', 'deleted', 'dist');
  f.container({ backend: f.main.backend, tc: f.main.tc, card: gone });

  const result = f.ha(['restart']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.started().card, f.main.card);
  assert.match(result.stderr, /card: the mounted .*deleted\/dist no longer exists/);
});

test('the TC placeholder is main, so a TC checkout that appears is picked up', (t) => {
  const f = runtimeFixture(t);
  const placeholder = path.join(f.hub, 'ha-dev', 'custom_components', 'growspace_manager_tc');
  fs.mkdirSync(placeholder, { recursive: true });
  f.container({ backend: f.main.backend, tc: placeholder, card: f.main.card });

  const result = f.ha(['restart']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.started().tc, f.main.tc);
});

test('mounts prints each source mount marked main or override', (t) => {
  const f = runtimeFixture(t);
  const backend = f.worktree('backend');
  const gone = path.join(f.root, 'worktrees', 'gone');
  f.container({ backend, tc: f.main.tc, card: gone }, 'exited');

  const human = f.ha(['mounts']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /growspace-ha-dev \(exited\)/);
  assert.match(human.stdout, new RegExp(`backend\\s+override\\s+${backend}\\n`));
  assert.match(human.stdout, new RegExp(`tc\\s+main\\s+${f.main.tc}\\n`));
  assert.match(human.stdout, new RegExp(`card\\s+override\\s+${gone}\\s+\\(missing\\)`));

  const porcelain = f.ha(['mounts', '--porcelain']);
  assert.equal(porcelain.status, 0, porcelain.stderr);
  assert.equal(
    porcelain.stdout,
    `backend\toverride\t${backend}\ntc\tmain\t${f.main.tc}\ncard\toverride\t${gone}\n`,
  );
});

test('mounts says so when there is no container', (t) => {
  const f = runtimeFixture(t);

  const human = f.ha(['mounts']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /no container — the next start mounts the main checkouts/);
  assert.equal(f.ha(['mounts', '--porcelain']).stdout, '');
});

// --- codex-worktree card-e2e -------------------------------------------------

function git(repository, ...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
}

function initRepository(repository, files = {}) {
  fs.mkdirSync(repository, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repository]);
  git(repository, 'config', 'user.email', 'tests@example.com');
  git(repository, 'config', 'user.name', 'Hub tooling tests');
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(repository, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  git(repository, 'add', '.');
  git(repository, 'commit', '-q', '-m', 'fixture');
}

// A Codex set whose scripts/ha is a recorder: `mounts --porcelain` answers from
// $FAKE_CARD_MOUNT, and every restart logs its arguments and card override.
function codexFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-card-e2e-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hub = path.join(root, 'growspace_manager_workspace');
  const bin = path.join(root, 'bin');
  const haLog = path.join(root, 'ha.log');

  initRepository(hub, { 'README.md': 'fixture\n' });
  initRepository(path.join(root, 'growspace_manager'), { 'requirements.txt': 'x\n' });
  initRepository(path.join(root, 'growspace_manager_tc'), { 'requirements.txt': 'x\n' });
  initRepository(path.join(root, 'growspace_manager_vision'), { 'pyproject.toml': '\n' });
  initRepository(path.join(root, 'lovelace-growspace-manager-card'), { 'package-lock.json': '{}\n' });
  executable(path.join(root, 'growspace_manager', '.venv', 'bin', 'python'), '#!/bin/sh\n');
  executable(path.join(root, 'growspace_manager_vision', '.venv', 'bin', 'python'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(root, 'lovelace-growspace-manager-card', 'node_modules'));

  copyScript('codex-worktree', hub);
  copyScript('growspace-repos', hub);
  executable(path.join(hub, 'scripts', 'backend-venv'), '#!/bin/sh\n');
  executable(path.join(hub, 'scripts', 'card-node-modules'), '#!/bin/sh\n');
  executable(
    path.join(hub, 'scripts', 'ha'),
    `#!/bin/sh
if [ "$*" = "dev mounts --porcelain" ]; then
  [ -z "$FAKE_CARD_MOUNT" ] || printf 'card\\toverride\\t%s\\n' "$FAKE_CARD_MOUNT"
  exit 0
fi
printf '%s|%s\\n' "$*" "\${GROWSPACE_CARD_DIST:-}" >>"$FAKE_HA_LOG"
`,
  );
  executable(path.join(bin, 'npm'), '#!/bin/sh\n[ "$2" != test:ha ] || exit "$FAKE_TEST_STATUS"\n');
  executable(path.join(bin, 'curl'), '#!/bin/sh\nprintf 200\n');

  const codex = (args, env = {}) =>
    spawnSync(path.join(hub, 'scripts', 'codex-worktree'), args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_HA_LOG: haLog,
        FAKE_CARD_MOUNT: '',
        FAKE_TEST_STATUS: '0',
        ...env,
      },
    });

  const setup = codex(['setup']);
  assert.equal(setup.status, 0, setup.stderr);
  const cardWorktree = path.join(codex(['path']).stdout.trim(), 'card');
  fs.mkdirSync(path.join(cardWorktree, 'tests', 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(cardWorktree, 'tests', 'e2e', '.env.test'), 'HA_BASE_URL=x\n');

  const restarts = () => fs.readFileSync(haLog, 'utf8').trim().split('\n');
  return { root, codex, cardWorktree, restarts };
}

for (const outcome of [
  { name: 'success', status: '0' },
  { name: 'failure', status: '1' },
]) {
  test(`card-e2e hands back the card bundle it found, on ${outcome.name}`, (t) => {
    const f = codexFixture(t);
    const previous = path.join(f.root, 'another-session', 'dist');
    fs.mkdirSync(previous, { recursive: true });

    const result = f.codex(['card-e2e'], {
      FAKE_CARD_MOUNT: previous,
      FAKE_TEST_STATUS: outcome.status,
    });

    assert.equal(result.status, Number(outcome.status), result.stderr);
    // Only the card is named: the backend and TC mounts are inherited both ways.
    assert.deepEqual(f.restarts(), [
      `dev restart|${path.join(f.cardWorktree, 'dist')}`,
      `dev restart|${previous}`,
    ]);
  });
}

test('card-e2e hands back the main dist/ when nothing was mounted before', (t) => {
  const f = codexFixture(t);

  const result = f.codex(['card-e2e'], { FAKE_TEST_STATUS: '1' });

  assert.equal(result.status, 1);
  assert.deepEqual(f.restarts(), [
    `dev restart|${path.join(f.cardWorktree, 'dist')}`,
    'dev restart --main card|',
  ]);
});

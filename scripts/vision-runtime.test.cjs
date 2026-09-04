const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WORKSPACE = path.resolve(__dirname, '..');

function composeConfig() {
  const rendered = spawnSync('docker', ['compose', '--profile', 'test', 'config', '--format', 'json'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env: {
      ...process.env,
      GROWSPACE_VISION_IMAGE: 'growspace-vision:test-amd64',
      GROWSPACE_VISION_PORT: '18099',
    },
  });

  assert.equal(rendered.status, 0, rendered.stderr);
  return JSON.parse(rendered.stdout);
}

function runVision(command, stateDir, extraEnv = {}) {
  return spawnSync('bash', [path.join(WORKSPACE, 'scripts', 'vision'), command], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env: {
      ...process.env,
      GROWSPACE_VISION_STATE_DIR: stateDir,
      ...extraEnv,
    },
  });
}

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

test('the dev runtime starts the host-configured Vision App before Home Assistant', () => {
  const config = composeConfig();
  const vision = config.services['vision-dev'];

  assert.equal(vision.image, 'growspace-vision:test-amd64');
  assert.equal(vision.pull_policy, 'never');
  assert.equal(vision.read_only, true);
  assert.deepEqual(vision.volumes.map(({ bind: _bind, ...volume }) => volume), [
    {
      type: 'bind',
      source: path.join(WORKSPACE, 'vision-dev'),
      target: '/data',
      read_only: true,
    },
  ]);
  assert.deepEqual(vision.ports, [
    {
      mode: 'ingress',
      host_ip: '127.0.0.1',
      target: 8099,
      published: '18099',
      protocol: 'tcp',
    },
  ]);
  assert.equal(config.services['ha-dev'].depends_on['vision-dev'].condition, 'service_healthy');
  assert.equal(config.services['ha-test'].depends_on, undefined);
});

test('prepare creates App options once and preserves them across restarts', (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-vision-state-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  const first = runVision('prepare', stateDir, {
    GROWSPACE_VISION_TOKEN: 'stable-test-token',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDir, 'options.json'), 'utf8')), {
    access_token: 'stable-test-token',
  });
  assert.equal(
    fs.readFileSync(path.join(stateDir, 'service.env'), 'utf8'),
    'GROWSPACE_VISION_TOKEN=stable-test-token\n',
  );
  assert.equal(fs.statSync(path.join(stateDir, 'options.json')).mode & 0o777, 0o600);

  const second = runVision('prepare', stateDir, {
    GROWSPACE_VISION_TOKEN: 'must-not-replace-existing-token',
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(runVision('token', stateDir).stdout.trim(), 'stable-test-token');
});

test('prepared host state injects the bearer token into the App container', (t) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-vision-compose-'));
  const stateDir = path.join(projectDir, 'vision-dev');
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const prepared = runVision('prepare', stateDir, {
    GROWSPACE_VISION_TOKEN: 'compose-runtime-token',
  });
  assert.equal(prepared.status, 0, prepared.stderr);

  const rendered = spawnSync(
    'docker',
    [
      'compose',
      '--project-directory',
      projectDir,
      '--file',
      path.join(WORKSPACE, 'docker-compose.yml'),
      'config',
      '--format',
      'json',
    ],
    { cwd: WORKSPACE, encoding: 'utf8', env: process.env },
  );
  assert.equal(rendered.status, 0, rendered.stderr);
  const config = JSON.parse(rendered.stdout);
  assert.equal(
    config.services['vision-dev'].environment.GROWSPACE_VISION_TOKEN,
    'compose-runtime-token',
  );
});

test('prepare generates a local token and reset returns the App to fresh state', (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-vision-reset-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  const first = runVision('prepare', stateDir, { GROWSPACE_VISION_TOKEN: '' });
  assert.equal(first.status, 0, first.stderr);
  const firstToken = runVision('token', stateDir).stdout.trim();
  assert.match(firstToken, /^[0-9a-f]{64}$/);

  const reset = runVision('reset', stateDir);
  assert.equal(reset.status, 0, reset.stderr);
  assert.equal(fs.existsSync(path.join(stateDir, 'options.json')), false);

  const second = runVision('prepare', stateDir, { GROWSPACE_VISION_TOKEN: '' });
  assert.equal(second.status, 0, second.stderr);
  const secondToken = runVision('token', stateDir).stdout.trim();
  assert.match(secondToken, /^[0-9a-f]{64}$/);
  assert.notEqual(secondToken, firstToken);
});

test('ha dev commands prepare and control Vision as part of the runtime', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-ha-runtime-'));
  const binDir = path.join(fixtureDir, 'bin');
  const stateDir = path.join(fixtureDir, 'vision-state');
  const dockerLog = path.join(fixtureDir, 'docker.log');
  fs.mkdirSync(binDir);
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  writeExecutable(path.join(binDir, 'git'), '#!/bin/sh\nexit 1\n');
  writeExecutable(path.join(binDir, 'ss'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
  writeExecutable(
    path.join(binDir, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >>"$FAKE_DOCKER_LOG"\n',
  );

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: dockerLog,
    GROWSPACE_VISION_STATE_DIR: stateDir,
    GROWSPACE_VISION_TOKEN: 'ha-runtime-token',
  };
  const up = spawnSync('bash', [path.join(WORKSPACE, 'scripts', 'ha'), 'dev', 'up'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env,
  });
  assert.equal(up.status, 0, up.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDir, 'options.json'), 'utf8')), {
    access_token: 'ha-runtime-token',
  });

  const down = spawnSync('bash', [path.join(WORKSPACE, 'scripts', 'ha'), 'dev', 'down'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env,
  });
  assert.equal(down.status, 0, down.stderr);
  assert.deepEqual(fs.readFileSync(dockerLog, 'utf8').trim().split('\n'), [
    'compose up -d ha-dev',
    'compose stop ha-dev vision-dev',
  ]);
});

test('smoke analyzes both simulated cameras without exposing the token in curl arguments', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-vision-smoke-'));
  const binDir = path.join(fixtureDir, 'bin');
  const stateDir = path.join(fixtureDir, 'vision-state');
  const curlLog = path.join(fixtureDir, 'curl.log');
  const analyzedResponse = JSON.stringify({
    status: 'analyzed',
    embedding: { dimension: 384, values: Array(384).fill(0) },
  });
  fs.mkdirSync(binDir);
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/bin/sh
printf '%s\\n' "$*" >>"$FAKE_CURL_LOG"
case "$*" in
  */health*) printf '%s\\n' '{"schema_version":1,"status":"ready"}' ;;
  */analyze*) printf '%s\\n' '${analyzedResponse}' ;;
esac
`,
  );

  const prepared = runVision('prepare', stateDir, {
    GROWSPACE_VISION_TOKEN: 'smoke-secret-token',
  });
  assert.equal(prepared.status, 0, prepared.stderr);

  const smoke = runVision('smoke', stateDir, {
    PATH: `${binDir}:${process.env.PATH}`,
    FAKE_CURL_LOG: curlLog,
    GROWSPACE_VISION_BASE_URL: 'http://127.0.0.1:18099',
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.match(smoke.stdout, /camera\.e2e_vision_1: analyzed \(dimension 384\)/);
  assert.match(smoke.stdout, /camera\.e2e_vision_2: analyzed \(dimension 384\)/);

  const calls = fs.readFileSync(curlLog, 'utf8');
  assert.match(calls, /e2e_vision_1\.jpg;type=image\/jpeg/);
  assert.match(calls, /e2e_vision_2\.jpg;type=image\/jpeg/);
  assert.match(calls, /--noproxy \*/);
  assert.doesNotMatch(calls, /smoke-secret-token/);
});

test('build delegates the amd64 image to the selected Vision checkout', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-vision-build-'));
  const visionRoot = path.join(fixtureDir, 'vision');
  const buildLog = path.join(fixtureDir, 'build.log');
  fs.mkdirSync(path.join(visionRoot, 'scripts'), { recursive: true });
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  writeExecutable(
    path.join(visionRoot, 'scripts', 'build-app-images.sh'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >"$FAKE_BUILD_LOG"\n',
  );

  const built = runVision('build', path.join(fixtureDir, 'state'), {
    GROWSPACE_VISION_SRC: visionRoot,
    FAKE_BUILD_LOG: buildLog,
  });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(fs.readFileSync(buildLog, 'utf8').trim(), 'amd64');
});

test('the supported E2E smoke workflow includes the real Vision Analysis scenario', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growspace-e2e-vision-'));
  const binDir = path.join(fixtureDir, 'bin');
  const cardRoot = path.join(fixtureDir, 'card');
  const backendRoot = path.join(fixtureDir, 'backend');
  const stateDir = path.join(fixtureDir, 'vision-state');
  const npmLog = path.join(fixtureDir, 'npm.log');
  const analyzedResponse = JSON.stringify({
    status: 'analyzed',
    embedding: { dimension: 384, values: Array(384).fill(0) },
  });
  fs.mkdirSync(binDir);
  fs.mkdirSync(path.join(cardRoot, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(backendRoot, 'custom_components', 'growspace_manager'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(cardRoot, 'tests', 'e2e', '.env.test'), 'HA_BASE_URL=http://example\n');
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  writeExecutable(path.join(binDir, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >"$FAKE_NPM_LOG"\n');
  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/bin/sh
case "$*" in
  */health*) printf '%s\\n' '{"schema_version":1,"status":"ready"}' ;;
  */analyze*) printf '%s\\n' '${analyzedResponse}' ;;
esac
`,
  );
  const prepared = runVision('prepare', stateDir, {
    GROWSPACE_VISION_TOKEN: 'e2e-smoke-token',
  });
  assert.equal(prepared.status, 0, prepared.stderr);

  const smoke = spawnSync('bash', [path.join(WORKSPACE, 'scripts', 'e2e'), 'smoke'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_NPM_LOG: npmLog,
      GROWSPACE_CARD: cardRoot,
      GROWSPACE_BACKEND: backendRoot,
      GROWSPACE_VISION_STATE_DIR: stateDir,
      GROWSPACE_VISION_BASE_URL: 'http://127.0.0.1:18099',
      HA_ACCESS_TOKEN: 'fake-ha-token',
    },
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.match(smoke.stdout, /camera\.e2e_vision_1: analyzed/);
  assert.match(smoke.stdout, /camera\.e2e_vision_2: analyzed/);
  assert.match(fs.readFileSync(npmLog, 'utf8'), /vision-camera-profile\.spec\.ts/);
});

test('workspace CI executes the simulated Vision runtime contract', () => {
  const workflow = fs.readFileSync(
    path.join(WORKSPACE, '.github', 'workflows', 'quality.yml'),
    'utf8'
  );

  assert.match(workflow, /node --test/);
  assert.match(workflow, /scripts\/vision-runtime\.test\.cjs/);
});

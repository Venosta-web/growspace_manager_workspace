#!/usr/bin/env node
/*
 * Prove the Vision V1 aggregate end to end against the simulated HA runtime.
 *
 * This is intentionally a live acceptance runner, not a product test. It uses
 * the real native App image, public integration services/WebSockets, durable
 * evidence store, and real card bundle. It replaces the dedicated E2E Vision
 * growspace's evidence history and restores its camera files and schedule.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const {
  connectHaWebSocket,
  parseEnvFile,
} = require("./gen-e2e-dashboards.cjs");

const HERE = path.resolve(__dirname, "..");
const CAMERAS = ["camera.e2e_vision_1", "camera.e2e_vision_2"];
const CAMERA_FILES = ["e2e_vision_1.jpg", "e2e_vision_2.jpg"];
const DEFAULT_BASE_URL = "http://127.0.0.1:8123";
const DEFAULT_VISION_URL = "http://127.0.0.1:8099";
const DEFAULT_SCHEDULE = {
  enabled: true,
  early_check_offset_minutes: 45,
  mid_check_hours: 6,
  late_check_offset_minutes: 45,
};

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function mainHubCheckout(checkout = HERE) {
  try {
    const common = execFileSync(
      "git",
      [
        "-C",
        checkout,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
      { encoding: "utf8" },
    ).trim();
    return path.resolve(common, "..");
  } catch {
    return checkout;
  }
}

function percentile(values, fraction) {
  assert(values.length > 0, "cannot summarize an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

function summarizeLatency(values) {
  return {
    samples: values.length,
    median_ms: Number(percentile(values, 0.5).toFixed(1)),
    p95_ms: Number(percentile(values, 0.95).toFixed(1)),
    max_ms: Number(Math.max(...values).toFixed(1)),
  };
}

function evidenceItems(history) {
  return history.filter((item) => item.result_schema === "evidence_v1");
}

function summarizeHistory(response) {
  const checkups = evidenceItems(response.history);
  const captures = checkups.flatMap((item) => item.captures);
  const verdicts = captures
    .map((capture) => capture.visual.verdict)
    .filter(Boolean);
  return {
    returned_checkups: checkups.length,
    total_checkups: response.total,
    total_captures: response.capture_total,
    ready_baselines: captures.filter(
      (capture) => capture.visual.baseline_state === "ready",
    ).length,
    normal_verdicts: verdicts.filter((verdict) => verdict === "normal").length,
    uncertain_verdicts: verdicts.filter((verdict) => verdict === "uncertain")
      .length,
    material_scene_changes: verdicts.filter(
      (verdict) => verdict === "material_scene_change",
    ).length,
    rejected_captures: captures.filter(
      (capture) => capture.analysis_state === "rejected",
    ).length,
    reports: captures.filter((capture) => capture.report).length,
  };
}

function scheduledCheckups(response) {
  return evidenceItems(response.history).filter(
    (item) => item.trigger_source === "scheduled",
  );
}

function newCompletedScheduledCheckup(
  response,
  previousIds,
  cameraCount = CAMERAS.length,
) {
  return scheduledCheckups(response).find(
    (item) =>
      !previousIds.has(item.checkup_id) &&
      item.status !== null &&
      item.captures.length === cameraCount,
  );
}

function browserBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString().replace(/\/$/, "");
}

function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

async function restJson(baseUrl, token, pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${pathname}: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitForHomeAssistant(baseUrl, token, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await restJson(baseUrl, token, "/api/");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Home Assistant did not become ready at ${baseUrl}`);
}

async function waitForIntegration(baseUrl, token, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const services = await restJson(baseUrl, token, "/api/services");
      if (services.some((entry) => entry.domain === "growspace_manager"))
        return;
    } catch {
      // HA's HTTP server can be ready before custom integrations finish setup.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Growspace Manager did not become ready within 30 seconds");
}

function requireWs(WebSocket, cardRoot, baseUrl, token) {
  return connectHaWebSocket({ WebSocket, baseUrl, token });
}

async function wsResult(connection, command) {
  const message = await connection.send(command);
  if (!message.success)
    throw new Error(`${command.type}: ${JSON.stringify(message.error)}`);
  return message.result;
}

async function waitForLoadedEntry(connection, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await wsResult(connection, {
      type: "config_entries/get",
      domain: "growspace_manager",
    });
    if (entries.length === 1 && entries[0].state === "loaded")
      return entries[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Growspace Manager config entry did not reach loaded state within 30 seconds",
  );
}

async function configureManualVision({
  connection,
  baseUrl,
  token,
  visionToken,
}) {
  const entry = await waitForLoadedEntry(connection);
  const started = await restJson(
    baseUrl,
    token,
    "/api/config/config_entries/options/flow",
    {
      handler: entry.entry_id,
    },
  );
  assert.equal(
    started.step_id,
    "init",
    `could not start options flow: ${JSON.stringify(started)}`,
  );
  const form = await restJson(
    baseUrl,
    token,
    `/api/config/config_entries/options/flow/${started.flow_id}`,
    {
      action: "configure_vision",
    },
  );
  assert.equal(
    form.step_id,
    "configure_vision",
    `could not open Vision settings: ${JSON.stringify(form)}`,
  );
  const completed = await restJson(
    baseUrl,
    token,
    `/api/config/config_entries/options/flow/${started.flow_id}`,
    {
      vision_connection_mode: "manual",
      vision_endpoint_url: "http://vision-dev:8099",
      vision_access_token: visionToken,
    },
  );
  assert.equal(
    completed.type,
    "create_entry",
    `could not save Vision settings: ${JSON.stringify(completed)}`,
  );
  const status = await wsResult(connection, {
    type: "growspace_manager/get_vision_status",
  });
  assert.equal(status.availability, "ready");
  assert.equal(status.connection_source, "manual");
  assert.equal(status.vision_schema_version, 1);
  return status;
}

async function history(connection, growspaceId, limit = 50) {
  return wsResult(connection, {
    type: "growspace_manager/get_vision_history_v2",
    growspace_id: growspaceId,
    limit,
  });
}

async function overview(baseUrl, token, growspaceId) {
  const states = await restJson(baseUrl, token, "/api/states");
  const state = states.find(
    (candidate) => candidate.attributes?.identity?.growspace_id === growspaceId,
  );
  assert(state, `no overview entity found for growspace ${growspaceId}`);
  return state.attributes;
}

function localClock(date = new Date(), timeZone = "Europe/Berlin") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    hour: parts.hour,
    minute: parts.minute,
    second: Number(parts.second),
  };
}

async function waitForSafeSchedulingSecond(timeZone) {
  let clock = localClock(new Date(), timeZone);
  if (clock.second < 45) return clock;
  const delay = (62 - clock.second) * 1_000;
  console.log(
    `  waiting ${Math.ceil(delay / 1_000)}s to avoid racing the minute boundary`,
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
  clock = localClock(new Date(), timeZone);
  return clock;
}

async function runNextScheduledCheckup({
  connection,
  baseUrl,
  token,
  growspaceId,
  timeZone,
}) {
  const before = await history(connection, growspaceId);
  const beforeIds = new Set(
    evidenceItems(before.history).map((item) => item.checkup_id),
  );
  const clock = await waitForSafeSchedulingSecond(timeZone);
  await restJson(
    baseUrl,
    token,
    "/api/services/growspace_manager/set_irrigation_strategy",
    {
      growspace_id: growspaceId,
      lights_on_time: `${clock.hour}:${clock.minute}:00`,
    },
  );
  const updated = await wsResult(connection, {
    type: "growspace_manager/update_vision_checkup_config",
    growspace_id: growspaceId,
    enabled: true,
    early_check_offset_minutes: 1,
    mid_check_hours: 6,
    late_check_offset_minutes: 45,
  });
  assert.equal(updated.success, true);
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const current = await history(connection, growspaceId);
    const checkup = newCompletedScheduledCheckup(current, beforeIds);
    if (checkup) return checkup;
  }
  throw new Error(
    "scheduled Vision Checkup did not complete within 100 seconds",
  );
}

async function updateCameras(baseUrl, token) {
  await restJson(baseUrl, token, "/api/services/homeassistant/update_entity", {
    entity_id: CAMERAS,
  });
}

async function benchmarkVision({
  visionUrl,
  visionToken,
  frame,
  growspaceId,
  samples = 12,
}) {
  const latencies = [];
  for (let index = 0; index < samples; index += 1) {
    const metadata = {
      schema_version: 1,
      camera_id: CAMERAS[0],
      growspace_id: growspaceId,
      captured_at: new Date().toISOString(),
      light_state: "on",
      model_id: "dinov2-vit-s-14-int8-onnx",
      model_version: "1.0.0",
    };
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json",
    );
    form.append(
      "image",
      new Blob([frame], { type: "image/jpeg" }),
      "frame.jpg",
    );
    const started = performance.now();
    const response = await fetch(new URL("/analyze", visionUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${visionToken}` },
      body: form,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        `Vision /analyze: HTTP ${response.status} ${JSON.stringify(result)}`,
      );
    assert.equal(result.status, "analyzed");
    assert.equal(result.embedding.dimension, 384);
    latencies.push(performance.now() - started);
  }
  return summarizeLatency(latencies);
}

function visionContainerMetrics(container = "growspace-vision-dev") {
  const [pidText, image] = execFileSync(
    "docker",
    ["inspect", "--format", "{{.State.Pid}} {{.Config.Image}}", container],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/, 2);
  const pid = Number(pidText);
  assert(pid > 0, `${container} is not running`);
  const cgroupLine = fs
    .readFileSync(`/proc/${pid}/cgroup`, "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"));
  assert(cgroupLine, `could not resolve the cgroup for ${container}`);
  const memoryPeakFile = path.join(
    "/sys/fs/cgroup",
    cgroupLine.slice(3),
    "memory.peak",
  );
  const peakBytes = Number(fs.readFileSync(memoryPeakFile, "utf8").trim());
  return {
    host_architecture: process.arch,
    image,
    peak_memory_bytes: peakBytes,
    peak_memory_mib: Number((peakBytes / 1024 / 1024).toFixed(1)),
  };
}

async function renderCard({
  cardRoot,
  baseUrl,
  token,
  dashboardPath,
  artifactDir,
}) {
  const { chromium } = require(
    require.resolve("playwright", { paths: [cardRoot] }),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      baseURL: browserBaseUrl(baseUrl),
    });
    await context.addInitScript((accessToken) => {
      localStorage.setItem(
        "hassTokens",
        JSON.stringify({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 1_900_000_000,
          refresh_token: "",
          hassUrl: window.location.origin,
          clientId: null,
          expires: Date.now() + 1_900_000_000 * 1_000,
        }),
      );
    }, token);
    const page = await context.newPage();
    await page.goto(dashboardPath, { waitUntil: "domcontentloaded" });
    const card = page.locator("growspace-manager-card").first();
    await card.waitFor({ state: "visible", timeout: 20_000 });
    await card.locator("button#menu-trigger").click();
    await card
      .locator("#header-menu .menu-item", { hasText: /camera snapshots/i })
      .dispatchEvent("click");
    const dialog = page.locator("snapshots-dialog gs-dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await dialog.getByText("Vision evidence", { exact: true }).click();
    await dialog
      .getByText("Scene-change monitoring only.", { exact: false })
      .first()
      .waitFor({ timeout: 20_000 });
    await dialog
      .getByText("Plant-health calibration: none in V1.", { exact: false })
      .first()
      .waitFor({ timeout: 10_000 });
    await dialog
      .getByText("Capture continuity break", { exact: false })
      .first()
      .waitFor({ timeout: 10_000 });
    const screenshot = path.join(artifactDir, "card-vision-evidence.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    return {
      screenshot,
      assertions: [
        "scope boundary",
        "calibration boundary",
        "capture continuity break",
      ],
    };
  } finally {
    await browser.close();
  }
}

function markdownReport(result) {
  const latency = result.performance.latency;
  const memory = result.performance.memory;
  return (
    `# Vision V1 simulated acceptance\n\n` +
    `Run: ${result.completed_at}\n\n` +
    `- Native image: \`${memory.image}\` on \`${memory.host_architecture}\`\n` +
    `- Analyze latency (${latency.samples} samples): median ${latency.median_ms} ms, p95 ${latency.p95_ms} ms, max ${latency.max_ms} ms\n` +
    `- Container cgroup peak memory: ${memory.peak_memory_mib} MiB (${memory.peak_memory_bytes} bytes)\n` +
    `- Seeded evidence: ${result.seeded.total_checkups} checkups / ${result.seeded.total_captures} captures\n` +
    `- Seeded outcomes: ${result.seeded.normal_verdicts} normal, ${result.seeded.material_scene_changes} material scene change, ${result.seeded.reports} optional explainer reports in the returned window\n` +
    `- Live scheduled checkups: ${result.live.checkups.length}; rejected captures: ${result.live.rejected_captures}\n` +
    `- Continuity: ${result.live.continuity.length} active camera alerts, each at ${result.live.continuity[0]?.consecutive_count ?? 0} consecutive captures\n` +
    `- Persistence: ${result.persistence.capture_ids.length} live capture IDs and active continuity alerts survived an HA restart\n` +
    `- Card assertions: ${result.card.assertions.join(", ")}\n\n` +
    `This run uses generated scenes only. It does not measure physical camera quality or ARM hardware performance.\n`
  );
}

async function main(argv = process.argv.slice(2)) {
  const mainHub = mainHubCheckout();
  const cardRoot = path.resolve(
    readOption(
      argv,
      "--card-root",
      process.env.GROWSPACE_CARD ||
        path.join(mainHub, "..", "lovelace-growspace-manager-card"),
    ),
  );
  const backendRoot = path.resolve(
    readOption(
      argv,
      "--backend-root",
      process.env.GROWSPACE_BACKEND ||
        path.join(mainHub, "..", "growspace_manager"),
    ),
  );
  const envFile = path.resolve(
    readOption(
      argv,
      "--env-file",
      process.env.E2E_ENV_FILE || path.join(cardRoot, "tests/e2e/.env.test"),
    ),
  );
  const env = { ...parseEnvFile(envFile), ...process.env };
  const baseUrl = readOption(
    argv,
    "--base-url",
    env.HA_BASE_URL || DEFAULT_BASE_URL,
  );
  const visionUrl = readOption(
    argv,
    "--vision-url",
    env.GROWSPACE_VISION_URL || DEFAULT_VISION_URL,
  );
  const tokenFile = path.join(mainHub, ".ha-token");
  const token =
    env.HA_ACCESS_TOKEN ||
    (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "");
  const growspaceId = env.TEST_VISION_GROWSPACE_ID;
  const dashboardPath = env.TEST_VISION_DASHBOARD_PATH || "/e2e-vision/0";
  assert(token, `HA_ACCESS_TOKEN is empty and no token exists at ${tokenFile}`);
  assert(growspaceId, `TEST_VISION_GROWSPACE_ID is empty in ${envFile}`);
  assert(
    fs.existsSync(path.join(cardRoot, "package.json")),
    `card checkout not found at ${cardRoot}`,
  );
  assert(
    fs.existsSync(
      path.join(backendRoot, "custom_components/growspace_manager"),
    ),
    `backend checkout not found at ${backendRoot}`,
  );

  const optionsFile = path.join(mainHub, "vision-dev/options.json");
  const visionToken = JSON.parse(
    fs.readFileSync(optionsFile, "utf8"),
  ).access_token;
  assert(visionToken, `${optionsFile} has no access_token`);
  const timeZone = env.TZ || "Europe/Berlin";
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  const artifactDir = path.join(
    mainHub,
    "artifacts/vision-v1-acceptance",
    stamp,
  );
  fs.mkdirSync(artifactDir, { recursive: true });

  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "growspace-vision-v1-"),
  );
  const generatedReference = path.join(temporary, "reference");
  const generatedUnusable = path.join(temporary, "unusable");
  const backup = path.join(temporary, "backup");
  const runtimeCameras = path.join(mainHub, "ha-dev/www/e2e-camera-assets");
  fs.mkdirSync(generatedReference);
  fs.mkdirSync(generatedUnusable);
  fs.mkdirSync(backup);
  let originalsBackedUp = false;
  let originalSchedule = null;
  let connection = null;
  let haNeedsRestart = false;
  const WebSocket = require(require.resolve("ws", { paths: [cardRoot] }));
  const mountEnvironment = {
    ...process.env,
    GROWSPACE_BACKEND_SRC: path.join(
      backendRoot,
      "custom_components/growspace_manager",
    ),
    GROWSPACE_CARD_DIST: path.join(cardRoot, "dist"),
  };

  const copySet = (source, destination) => {
    for (const filename of CAMERA_FILES)
      fs.copyFileSync(
        path.join(source, filename),
        path.join(destination, filename),
      );
  };
  const restart = async () => {
    run(path.join(mainHub, "scripts/ha"), ["dev", "restart"], {
      cwd: mainHub,
      env: mountEnvironment,
    });
    await waitForHomeAssistant(baseUrl, token);
    await waitForIntegration(baseUrl, token);
    haNeedsRestart = false;
  };

  const result = {
    issue:
      "https://github.com/Venosta-web/growspace_manager_workspace/issues/96",
    started_at: new Date().toISOString(),
    simulated: true,
    limitations: [
      "physical camera quality unmeasured",
      "ARM hardware performance unmeasured",
    ],
  };

  try {
    console.log("\n━━ prepare deterministic fixtures and selected builds");
    run(path.join(HERE, "scripts/gen-e2e-camera-assets"), [
      "--output-dir",
      generatedReference,
      "--scenario",
      "reference",
    ]);
    run(path.join(HERE, "scripts/gen-e2e-camera-assets"), [
      "--output-dir",
      generatedUnusable,
      "--scenario",
      "unusable",
    ]);
    run("npm", ["--prefix", cardRoot, "run", "--silent", "build"]);
    copySet(runtimeCameras, backup);
    originalsBackedUp = true;
    copySet(generatedReference, runtimeCameras);

    console.log(
      "\n━━ seed baseline, normal, material-change, and explainer evidence",
    );
    run("docker", ["stop", "growspace-ha-dev"]);
    haNeedsRestart = true;
    run(
      path.join(HERE, "scripts/seed-vision-history"),
      ["--growspace", "E2E Vision", "--days", "34", "--seed", "9601"],
      {
        cwd: HERE,
        env: { ...process.env, GROWSPACE_BACKEND: backendRoot },
      },
    );
    await restart();
    connection = await requireWs(WebSocket, cardRoot, baseUrl, token);
    result.vision_status = await configureManualVision({
      connection,
      baseUrl,
      token,
      visionToken,
    });

    const seededHistory = await history(connection, growspaceId);
    result.seeded = summarizeHistory(seededHistory);
    assert(
      result.seeded.total_checkups >= 102,
      "baseline seed did not produce 102 checkups",
    );
    assert(result.seeded.ready_baselines > 0, "baseline never reached ready");
    assert(result.seeded.normal_verdicts > 0, "normal comparison is absent");
    assert(
      result.seeded.material_scene_changes > 0,
      "material scene change is absent",
    );
    assert(result.seeded.reports > 0, "optional explainer report is absent");

    const state = await overview(baseUrl, token, growspaceId);
    const currentVision = state.environment.vision_checkup_config;
    originalSchedule = {
      lights_on_time: state.irrigation.irrigation_strategy.lights_on_time,
      vision: {
        enabled: currentVision.enabled ?? DEFAULT_SCHEDULE.enabled,
        early_check_offset_minutes:
          currentVision.early_check_offset_minutes ??
          DEFAULT_SCHEDULE.early_check_offset_minutes,
        mid_check_hours:
          currentVision.mid_check_hours ?? DEFAULT_SCHEDULE.mid_check_hours,
        late_check_offset_minutes:
          currentVision.late_check_offset_minutes ??
          DEFAULT_SCHEDULE.late_check_offset_minutes,
      },
    };

    console.log(
      "\n━━ prove local-only manual analysis and native App performance",
    );
    const manualResponse = await restJson(
      baseUrl,
      token,
      "/api/services/growspace_manager/trigger_vision_checkup?return_response",
      {
        growspace_id: growspaceId,
      },
    );
    const manual = manualResponse.service_response || manualResponse;
    assert.equal(manual.status, "completed");
    assert.equal(manual.checkup.trigger_source, "manual");
    assert(
      manual.checkup.captures.every(
        (capture) =>
          capture.provenance.model_id === result.vision_status.model.id,
      ),
    );
    assert(
      manual.checkup.captures.every((capture) => !capture.report),
      "local-only run unexpectedly produced an AI report",
    );
    result.local_only = {
      checkup_id: manual.checkup_id,
      captures: manual.checkup.captures.length,
      reports: 0,
      connection_source: result.vision_status.connection_source,
    };
    result.performance = {
      latency: await benchmarkVision({
        visionUrl,
        visionToken,
        frame: fs.readFileSync(path.join(generatedReference, CAMERA_FILES[0])),
        growspaceId,
      }),
    };

    console.log("\n━━ run one reference and three unusable scheduled checkups");
    const liveCheckups = [];
    liveCheckups.push(
      await runNextScheduledCheckup({
        connection,
        baseUrl,
        token,
        growspaceId,
        timeZone,
      }),
    );
    copySet(generatedUnusable, runtimeCameras);
    await updateCameras(baseUrl, token);
    for (let index = 0; index < 3; index += 1) {
      console.log(`  unusable scheduled capture ${index + 1}/3`);
      const checkup = await runNextScheduledCheckup({
        connection,
        baseUrl,
        token,
        growspaceId,
        timeZone,
      });
      assert(
        checkup.captures.every(
          (capture) => capture.analysis_state === "rejected",
        ),
      );
      assert(
        checkup.captures.every((capture) => capture.quality.accepted === false),
      );
      liveCheckups.push(checkup);
    }
    const alerts = await wsResult(connection, {
      type: "growspace_manager/get_ai_alerts",
      growspace_id: growspaceId,
    });
    const continuity = alerts.filter(
      (alert) =>
        alert.type === "capture_continuity_break" && alert.condition_active,
    );
    assert.equal(
      continuity.length,
      2,
      `expected two active continuity alerts, found ${continuity.length}`,
    );
    assert(continuity.every((alert) => alert.consecutive_count >= 3));
    result.live = {
      checkups: liveCheckups.map((checkup) => ({
        checkup_id: checkup.checkup_id,
        light_window: checkup.light_window,
        captures: checkup.captures.map((capture) => ({
          capture_id: capture.capture_id,
          camera_id: capture.camera_id,
          analysis_state: capture.analysis_state,
          quality_reasons: capture.quality.reasons,
          verdict: capture.visual.verdict || null,
        })),
      })),
      rejected_captures: liveCheckups
        .flatMap((checkup) => checkup.captures)
        .filter((capture) => capture.analysis_state === "rejected").length,
      continuity: continuity.map((alert) => ({
        id: alert.id,
        camera_id: alert.camera_id,
        consecutive_count: alert.consecutive_count,
        reason_counts: alert.reason_counts,
      })),
    };
    // Read the host cgroup before the persistence restart recreates the App
    // container and resets memory.peak. This includes the manual run, direct
    // benchmark, reference comparison, and quality-rejection workload.
    result.performance.memory = visionContainerMetrics();

    console.log(
      "\n━━ restore inputs and prove persistence across Home Assistant restart",
    );
    copySet(generatedReference, runtimeCameras);
    await updateCameras(baseUrl, token);
    await restJson(
      baseUrl,
      token,
      "/api/services/growspace_manager/set_irrigation_strategy",
      {
        growspace_id: growspaceId,
        lights_on_time: originalSchedule.lights_on_time,
      },
    );
    await wsResult(connection, {
      type: "growspace_manager/update_vision_checkup_config",
      growspace_id: growspaceId,
      ...originalSchedule.vision,
    });
    connection.close();
    connection = null;
    await restart();
    connection = await requireWs(WebSocket, cardRoot, baseUrl, token);
    await waitForLoadedEntry(connection);
    const persistedStatus = await wsResult(connection, {
      type: "growspace_manager/get_vision_status",
    });
    assert.equal(persistedStatus.availability, "ready");
    assert.equal(persistedStatus.connection_source, "manual");
    const persistedHistory = await history(connection, growspaceId);
    const persistedCaptureIds = new Set(
      evidenceItems(persistedHistory.history).flatMap((item) =>
        item.captures.map((capture) => capture.capture_id),
      ),
    );
    const expectedCaptureIds = liveCheckups.flatMap((item) =>
      item.captures.map((capture) => capture.capture_id),
    );
    assert(
      expectedCaptureIds.every((captureId) =>
        persistedCaptureIds.has(captureId),
      ),
      "live evidence did not survive restart",
    );
    const persistedAlerts = await wsResult(connection, {
      type: "growspace_manager/get_ai_alerts",
      growspace_id: growspaceId,
    });
    const persistedContinuity = persistedAlerts.filter(
      (alert) =>
        alert.type === "capture_continuity_break" && alert.condition_active,
    );
    assert.equal(
      persistedContinuity.length,
      2,
      "continuity conditions did not survive restart",
    );
    result.persistence = {
      capture_ids: expectedCaptureIds,
      active_continuity_alerts: persistedContinuity.length,
    };

    console.log("\n━━ render the persisted aggregate through the real card");
    result.card = await renderCard({
      cardRoot,
      baseUrl,
      token,
      dashboardPath,
      artifactDir,
    });
    result.card.screenshot = path.basename(result.card.screenshot);
    result.completed_at = new Date().toISOString();
    fs.writeFileSync(
      path.join(artifactDir, "evidence.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(artifactDir, "README.md"),
      markdownReport(result),
    );
    console.log(
      `\nPASS Vision V1 simulated acceptance\n  evidence: ${artifactDir}`,
    );
  } finally {
    if (connection) connection.close();
    if (originalsBackedUp) {
      try {
        copySet(backup, runtimeCameras);
      } catch (error) {
        console.error(
          `WARNING: could not restore camera files: ${error.message}`,
        );
      }
    }
    if (haNeedsRestart) {
      try {
        await restart();
      } catch (error) {
        console.error(
          `WARNING: could not restart Home Assistant during cleanup: ${error.message}`,
        );
      }
    }
    if (originalSchedule) {
      try {
        await waitForHomeAssistant(baseUrl, token, 5_000);
        const cleanupConnection = await requireWs(
          WebSocket,
          cardRoot,
          baseUrl,
          token,
        );
        await waitForLoadedEntry(cleanupConnection);
        await restJson(
          baseUrl,
          token,
          "/api/services/growspace_manager/set_irrigation_strategy",
          {
            growspace_id: growspaceId,
            lights_on_time: originalSchedule.lights_on_time,
          },
        );
        await wsResult(cleanupConnection, {
          type: "growspace_manager/update_vision_checkup_config",
          growspace_id: growspaceId,
          ...originalSchedule.vision,
        });
        await updateCameras(baseUrl, token);
        cleanupConnection.close();
      } catch (error) {
        console.error(
          `WARNING: could not restore the E2E Vision schedule: ${error.message}`,
        );
      }
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = {
  browserBaseUrl,
  evidenceItems,
  localClock,
  mainHubCheckout,
  newCompletedScheduledCheckup,
  percentile,
  renderCard,
  scheduledCheckups,
  summarizeHistory,
  summarizeLatency,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.stack || error}`);
    process.exitCode = 1;
  });
}

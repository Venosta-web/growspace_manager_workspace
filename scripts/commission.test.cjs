"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "commission");
const env = { ...process.env, HA_ACCESS_TOKEN: "test-token" };

test("commission lists all thirteen cases without contacting Home Assistant", () => {
  const result = spawnSync("python3", [script, "--list"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split("\n").length, 13);
});

test("commission refuses the clean ha-test instance by port", () => {
  const result = spawnSync(
    "python3",
    [script, "--base-url", "http://127.0.0.1:8124", "--scenario", "empty_tank"],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only accepts the local ha-dev URL on :8123/);
});

test("commission refuses clock tests from a different backend checkout", () => {
  const result = spawnSync(
    "python3",
    [script, "--backend-root", "/tmp", "--scenario", "dst_clock"],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /clock tests must use the live backend checkout/);
});

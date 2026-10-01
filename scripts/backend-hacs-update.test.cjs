"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertTarget,
  assertUpgrade,
  tags,
  uniqueIds,
} = require("./backend-hacs-update");
function fixture() {
  const gs = {
    irrigation_config: {
      irrigation_times: [{ time: "09:00:00", duration: 45 }],
      active_steering_phase: "p2",
    },
    environment_config: {
      soil_moisture_sensor: "sensor.moisture",
      irrigation_tanks: [{ name: "Tank" }],
    },
    irrigation_strategy: { enabled: true, lights_on_time: "06:30:00" },
    substrate_history: { shots_today: 6 },
  };
  const before = {
    version: 1,
    minor_version: 1,
    key: "growspace_manager.config",
    data: { growspaces: { tent: gs } },
  };
  const after = { ...structuredClone(before), version: 2 };
  after.data.growspaces.tent = {
    irrigation_config: {},
    environment_config: {
      irrigation_tanks: gs.environment_config.irrigation_tanks,
    },
    light_cycle: { lights_on_time: "06:30:00" },
    irrigation_zones: [
      {
        id: "default",
        irrigation_times: gs.irrigation_config.irrigation_times,
        active_steering_phase: "p2",
        soil_moisture_sensor: "sensor.moisture",
        strategy: { enabled: true },
        substrate_history: { shots_today: 6 },
      },
    ],
  };
  const ticks = {
    steering: [{ fire: null }, { fire: { duration: 30 } }],
    schedule: [{ fire: false }, { fire: true }],
    contract: null,
  };
  const afterTicks = {
    ...structuredClone(ticks),
    contract: {
      config_fields: ["irrigation_times", "active_steering_phase"],
      environment_fields: ["soil_moisture_sensor"],
      light_fields: ["lights_on_time"],
      problems: [],
    },
  };
  return [
    before,
    after,
    { ...structuredClone(before), key: "growspace_manager.config.v1" },
    ["entity1"],
    ["entity1"],
    ticks,
    afterTicks,
    "tent",
  ];
}
test("defaults from tag, accepts beta tags and rejects unsafe or ambiguous pairs", () => {
  assert.deepEqual(tags(["v1.3.1b550"]), ["v1.2.3", "v1.3.1b550"]);
  for (const args of [
    [],
    ["../evil"],
    ["v1.2.3", "v1.2.3"],
    ["v1.2.3", "v1.4.0", "extra"],
  ])
    assert.throws(() => tags(args));
});
test("requires actual test bind mount and loopback port including symlink aliases", (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "backend-upgrade-"));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  fs.mkdirSync(path.join(runtime, "ha-test"));
  fs.mkdirSync(path.join(runtime, "ha-dev"));
  fs.symlinkSync(path.join(runtime, "ha-dev"), path.join(runtime, "alias"));
  assertTarget("http://localhost:8124", path.join(runtime, "ha-test"), runtime);
  for (const url of [
    "http://localhost:8123",
    "http://remote:8124",
    "http://localhost:8124/other",
    "https://localhost:8124",
    "http://localhost:8124?foo=1",
  ])
    assert.throws(() =>
      assertTarget(url, path.join(runtime, "ha-test"), runtime),
    );
  assert.throws(() =>
    assertTarget("http://localhost:8124", path.join(runtime, "alias"), runtime),
  );
});
test("selects backend entity unique IDs", () =>
  assert.deepEqual(
    uniqueIds([
      { platform: "hacs", unique_id: "x" },
      { platform: "growspace_manager", unique_id: "a" },
    ]),
    ["a"],
  ));
test("accepts exact migration with fire and hold decisions", () =>
  assertUpgrade(...fixture()));
const mutations = {
  "store version": (f) => {
    f[1].version = 1;
  },
  "backup changed": (f) => {
    f[2].data.extra = true;
  },
  "entity disappeared": (f) => {
    f[4] = [];
  },
  "no original entities": (f) => {
    f[3] = [];
    f[4] = [];
  },
  "invalid cells": (f) => {
    f[6].contract.problems = ["missing cell"];
  },
  "extra zone": (f) => {
    f[1].data.growspaces.tent.irrigation_zones.push({ id: "other" });
  },
  "wrong zone id": (f) => {
    f[1].data.growspaces.tent.irrigation_zones[0].id = "other";
  },
  "schedule changed": (f) => {
    f[1].data.growspaces.tent.irrigation_zones[0].irrigation_times = [];
  },
  "field left behind": (f) => {
    f[1].data.growspaces.tent.irrigation_config.active_steering_phase = "p2";
  },
  "probe dropped": (f) => {
    delete f[1].data.growspaces.tent.irrigation_zones[0].soil_moisture_sensor;
  },
  "strategy changed": (f) => {
    f[1].data.growspaces.tent.irrigation_zones[0].strategy.enabled = false;
  },
  "history dropped": (f) => {
    f[1].data.growspaces.tent.irrigation_zones[0].substrate_history = {};
  },
  "tanks dropped": (f) => {
    f[1].data.growspaces.tent.environment_config.irrigation_tanks = [];
  },
  "steering differs": (f) => {
    f[6].steering[1].fire.duration = 99;
  },
  "schedule differs": (f) => {
    f[6].schedule[0].fire = true;
  },
  "vacuous ticks": (f) => {
    f[5].schedule = [];
    f[6].schedule = [];
  },
  "never fires": (f) => {
    f[5].steering = [{ fire: null }];
    f[6].steering = [{ fire: null }];
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test(`rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => assertUpgrade(...f));
  });

test("permits new entities and verdict annotations while preserving old decisions", () => {
  const f = fixture();
  f[4].push("new_feature_entity");
  f[6].steering[1].p1_completed_on = "2026-09-21";
  f[6].schedule[0].unknown_tank = null;
  assertUpgrade(...f);
});
test("rejects a new tank refusal", () => {
  const f = fixture();
  f[6].schedule[0].unknown_tank = { name: "Tank" };
  assert.throws(() => assertUpgrade(...f));
});
test("rejects wrong copy key and permits new tank settings without losing old values", () => {
  const f = fixture();
  f[1].data.growspaces.tent.environment_config.irrigation_tanks = [
    { name: "Tank", stale_after_minutes: 120 },
  ];
  assertUpgrade(...f);
  f[2].key = "wrong";
  assert.throws(() => assertUpgrade(...f));
});

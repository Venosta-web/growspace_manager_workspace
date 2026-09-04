"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  browserBaseUrl,
  localClock,
  newCompletedScheduledCheckup,
  percentile,
  summarizeHistory,
  summarizeLatency,
} = require("./vision-v1-acceptance.cjs");

test("percentile uses nearest-rank values and latency rounds once", () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
  assert.deepEqual(summarizeLatency([1.04, 2.05, 3.06]), {
    samples: 3,
    median_ms: 2,
    p95_ms: 3.1,
    max_ms: 3.1,
  });
});

test("history summary counts only evidence-v1 captures", () => {
  const capture = (overrides = {}) => ({
    analysis_state: "analyzed",
    visual: { baseline_state: "ready", verdict: "normal" },
    ...overrides,
  });
  assert.deepEqual(
    summarizeHistory({
      total: 4,
      capture_total: 6,
      history: [
        { result_schema: "legacy_cloud_v1" },
        {
          result_schema: "evidence_v1",
          captures: [
            capture(),
            capture({
              analysis_state: "rejected",
              visual: { outcome: "unavailable" },
              report: { observation: "optional" },
            }),
          ],
        },
        {
          result_schema: "evidence_v1",
          captures: [
            capture({
              visual: {
                baseline_state: "ready",
                verdict: "material_scene_change",
              },
            }),
          ],
        },
      ],
    }),
    {
      returned_checkups: 2,
      total_checkups: 4,
      total_captures: 6,
      ready_baselines: 2,
      normal_verdicts: 1,
      uncertain_verdicts: 0,
      material_scene_changes: 1,
      rejected_captures: 1,
      reports: 1,
    },
  );
});

test("browser URL avoids the localhost service-worker failure", () => {
  assert.equal(
    browserBaseUrl("http://localhost:8123"),
    "http://127.0.0.1:8123",
  );
  assert.equal(
    browserBaseUrl("https://ha.example.test"),
    "https://ha.example.test",
  );
});

test("localClock returns a stable selected-zone clock", () => {
  assert.deepEqual(localClock(new Date("2026-01-01T12:34:56Z"), "UTC"), {
    hour: "12",
    minute: "34",
    second: 56,
  });
});

test("scheduled polling ignores a checkup until every camera is terminal", () => {
  const prior = new Set(["old"]);
  const response = {
    history: [
      {
        result_schema: "evidence_v1",
        checkup_id: "new",
        trigger_source: "scheduled",
        status: null,
        captures: [{}],
      },
      {
        result_schema: "evidence_v1",
        checkup_id: "old",
        trigger_source: "scheduled",
        status: "completed",
        captures: [{}, {}],
      },
    ],
  };
  assert.equal(newCompletedScheduledCheckup(response, prior), undefined);
  response.history[0].status = "completed";
  response.history[0].captures.push({});
  assert.equal(
    newCompletedScheduledCheckup(response, prior)?.checkup_id,
    "new",
  );
});

# Vision V1 simulated acceptance

Issue: [growspace_manager_workspace#96](https://github.com/Venosta-web/growspace_manager_workspace/issues/96)

Recorded on 2026-09-04 with `./scripts/e2e vision` against the production
`growspace-vision:1.0.0-amd64` image on an x86-64 development host.

## Result

The aggregate passed from generated camera pixels to the native App, Home
Assistant integration, durable evidence store and card UI.

| Boundary              | Recorded evidence                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Service negotiation   | ready, manual local endpoint, schema 1, DINOv2 INT8 model 1.0.0, dimension 384                                |
| Baseline warm-up      | 102 seeded checkups / 204 captures; 30 samples admitted per camera/window bucket before scoring               |
| Comparison outcomes   | 17 normal, 6 uncertain, 1 material scene change                                                               |
| Optional explanation  | 37 two-pass explainer reports in the seeded run; the local-only manual run emitted none                       |
| Live integration path | 1 reference plus 3 unusable checkups through Home Assistant's real scheduler, 2 cameras each                  |
| Frame Quality Gate    | all 6 dark captures rejected for `too_dark`, `low_detail`, and `light_state_mismatch`                         |
| Capture continuity    | 2 active equipment alerts, one per camera, each at 3 consecutive `frame_rejected` captures                    |
| Persistence           | all 8 live capture IDs and both active continuity alerts survived a Home Assistant restart                    |
| Card                  | Vision evidence view rendered the scope/calibration boundaries, unusable reasons and Capture Continuity Break |

## Native amd64 performance

Twelve direct `/analyze` requests using the generated reference frame recorded
a 28.7 ms median, 33.2 ms p95 and 33.2 ms maximum. The App container's host
cgroup reported a 137.3 MiB peak (143,945,728 bytes) after the manual checkup,
direct benchmark, live comparison and rejection workload. The runner reads
`memory.peak` before the persistence restart recreates the container and resets
that counter.

These numbers describe this native amd64 development host only. Physical-camera
quality and ARM hardware latency/memory remain explicitly unmeasured.

## Reproduce

Provision the E2E environment once, then run the acceptance:

```bash
./scripts/e2e provision
./scripts/e2e vision
```

The command writes `evidence.json`, a concise Markdown summary and
`card-vision-evidence.png` under the ignored
`artifacts/vision-v1-acceptance/<timestamp>/` directory. It replaces the
dedicated E2E Vision history, temporarily substitutes the two camera files and
changes their schedule; camera files and schedule are restored in cleanup.

The source fixtures intentionally contain no diagnosis, confidence score or
health verdict. Their labels describe only framing. V1 demonstrates scene
change, quality, environmental evidence, fusion and equipment continuity—not a
symptom classifier.

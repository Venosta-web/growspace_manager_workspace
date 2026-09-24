# Irrigation safety baseline — simulated ha-dev, 2026-09-24

The unattended `./scripts/commission` run completed all 13 cases and cleaned up
without an error. Its full local JSON record is
`artifacts/commissioning/2026-09-24T18-26-17-808768Z.json` (runtime artifacts are
gitignored). This table preserves the observed baseline for review and for
updating each check as the backend safety work lands.

| Case | Outcome | Observation |
|---|---|---|
| Sensor disconnect | Not exercised | New monitored VWC mirror was not mounted in the running main `ha-dev` package. |
| Pump stuck ON | Met | Stuck switch stayed ON and the controller latched `fault_off_unconfirmed`. |
| Unexpected ON | Gap | Externally switched pump was ON; controller stayed `ready`. |
| HA restart mid-shot | Gap | Pump still read ON after restart and the observation window. |
| Power loss mid-shot | Gap | Restore state was staged ON; pump still read ON after startup. |
| Empty tank | Not exercised | Controller was already `running` before lowering the tank, so the case refused a confounded result. |
| Invalid VWC | Gap | `0`, `-5`, `150`, and `nan` showed no `sensor_invalid` reason. |
| Stale sensor | Not exercised | The new monitored VWC mirror was not mounted. |
| Service-call failure | Met | Erroring switch stayed OFF and the controller latched `fault_on_unconfirmed`. |
| Overlapping requests | Gap | A scheduled shot, manual request, and drain ran; both pumps were observed ON together. |
| Manual override | Not exercised | This backend checkout has no `set_override` service. |
| Config change while armed | Gap | Pump remap was accepted while the old pump still read ON. |
| DST / clock | Not exercised | The backend frozen-time commissioning test is not yet present. |

The run used Home Assistant 2026.8.2 and Growspace Manager 1.2.3 at backend
revision `3235ca5a`. It was simulated, not physical evidence. The harness
records both the declared and the live package hashes; they differed because
the main runtime had not yet received this branch's new mirror fixture. Once
this change is merged, run `./scripts/e2e provision` from the main hub checkout
and repeat the full run. The [commissioning guide](../COMMISSIONING.md) covers
the physical checks and their evidence.

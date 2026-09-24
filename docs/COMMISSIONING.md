# Irrigation safety commissioning

Run `./scripts/e2e provision` on the disposable `ha-dev` instance before a first
commissioning run. Then run `./scripts/commission`. It uses the `E2E VWC Veg`
growspace, its simulated pumps, tank and VWC sensor. It writes a dated JSON
record in the main hub checkout's ignored `artifacts/commissioning/` directory
and prints a summary. `--list` shows the cases; `--scenario NAME` runs one case.
The target must be `http://127.0.0.1:8123` (or localhost on the same port),
identify itself as `Growspace Dev`, and have the E2E profile installed. The
runner refuses `ha-test` and other Home Assistant instances. A token from
`.ha-token` or `HA_ACCESS_TOKEN` is required.
The full run takes at least 16 minutes because the stale-sensor case waits
through the validity window. Use `--scenario NAME` for focused reruns;
`--stale-seconds` changes the observation interval and should only be shortened
for harness debugging.

The record distinguishes `met`, `gap`, `not_exercised`, and `error`. A `gap`
means the observed state did not satisfy the scenario's stated safety check.
`not_exercised` means a required backend capability or unit test is still
missing. An `error` means the case could not be observed reliably. Treat only
`met` as positive evidence for the recorded `check`; the complete safety target
in the [hardening report](research/2026-09-23-competitive-hardening.md) also
includes alerts, ledger entries, and recovery behavior that need separate
evidence. Keep the JSON with the software versions and
hardware configuration used for the run. Current expectations are
characterization targets; update each check as its linked backend safety issue
lands. The harness does not certify a physical installation.

The stuck relay and erroring switch are generated from
`e2e/entity_coverage.py` along with the other E2E equipment. Regenerate with
`./scripts/e2e provision` from the main hub checkout after the change is
merged; it generates the package that the main `ha-dev` bind mount actually
serves. Generating inside a hub worktree writes that worktree's package and
does not update the running instance. Missing fixtures are reported as
`not_exercised`. The stuck switch deliberately needs its backing
`input_boolean` cleared after the case. The runner does this in cleanup.
The disconnect and stale cases use the `E2E Irrigation Monitored` mirrored VWC
sensor. Its manual gate pins the last reading and pauses periodic reports, so
the stale case waits through a real validity window. The disconnect case sets
that sensor `unavailable` while the gate is pinned. The invalid-value case uses
the writable VWC helper in `E2E VWC Veg`, since an `input_number` cannot accept
negative, out-of-range, or `nan` values through its normal service. These
injections exercise the backend sensor path but do not prove a physical probe's
disconnect behavior. The overlap case also uses `E2E Irrigation Monitored`,
which has a schedule and a separate drain pump; other live cases use
`E2E VWC Veg`.

## Repeating the cases on physical equipment

The backend's physical commissioning and hardware guide is tracked in
[growspace_manager#799](https://github.com/Venosta-web/growspace_manager/issues/799).
Record the actual pump and relay states, alert times, and controller reasons
for each procedure below. Confirm the pump's independent electrical
fail-safe and a means to stop water flow before starting. Run with a safe water
source and supervised discharge.

| Case | Physical action | Evidence to keep |
|---|---|---|
| Sensor disconnect | Unplug the VWC probe during an armed window; reconnect it after the alert delay. | Controller reason, alert time, no shot during loss, recovery without a burst. |
| Pump stuck ON | Use a relay or test circuit whose OFF command leaves the output ON. | OFF command, readback, fault time, notification, restart persistence. |
| Unexpected ON | Switch the pump externally while the controller is idle. | `unexpected_on` reason, alert, lack of competing automation. |
| HA restart | Restart Home Assistant during a timed shot. | Pump state through shutdown and setup, interrupted shot, cooldown and phase after setup. |
| Power loss | Cut controller power mid-shot while the relay is configured to restore ON, then restore power. | Relay restoration setting, ON state at boot, reconciliation command and readback. |
| Empty tank | Lower the tank reading below its warning threshold and request a shot. | Skip reason, pump OFF, notification, manual-run refusal. |
| Invalid VWC | Feed zero, negative, over-range and nonnumeric readings. | Reading, validity reason, lack of automatic shots for each value. |
| Stale sensor | Hold one reading without a new report beyond the validity window. | Last report timestamp, inhibit reason and alert. |
| Service failure | Make the mapped actuator's ON command fail. | Command error, OFF attempt, delivered-cycle count and fault state. |
| Overlap | Request a manual shot during a scheduled shot and drainage during irrigation. | State timeline for both pumps and the documented winning request. |
| Manual override | Set a ten-minute override, then operate the pump by hand. | Override and expiry times, command log and audit entry. |
| Config change | Change the pump mapping during a shot. | Old pump OFF readback, moment the new mapping took effect and config revision. |
| DST / clock | Run the backend frozen-time tests for both DST transitions and a forward clock jump. | Test output; leave the real host clock alone. |

Record physical results separately with `environment: "physical"`, the device
models, firmware, relay restoration setting, wiring and timestamps. A simulated
result cannot establish what a physical relay does after power restoration.

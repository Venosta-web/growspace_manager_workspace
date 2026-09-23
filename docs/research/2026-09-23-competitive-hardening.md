# Growspace Manager — competitive hardening investigation

Date: 2026-09-23. Evidence base: `growspace_manager` at `origin/prerelease`
`8d0a129`, `lovelace-growspace-manager-card` at `origin/dev` `4840ea90`, the hub at
`main` `98c371d`, the running `ha-dev` instance (Demo Tent), and the public
repositories of the five reference projects read through the GitHub API on the
same day. Line numbers refer to those commits.

This is a research report. No product code was changed. Where a behaviour is
inferred from code rather than observed, it says so. A bare `#NNN` refers to a
`Venosta-web/growspace_manager` issue. `GSM#`, `card#` and `hub#` links are the
issues this investigation filed; the appendix lists them.

---

## A. Executive summary

**Where Growspace Manager is strongest.** Breadth and domain depth. No project in
the comparison set combines per-plant lifecycle tracking, genetics/strain
library, crop steering with adaptive shot control, VPD-driven climate control
across four actuator kinds, tank accounting, post-harvest drying, label
printing, vision evidence and tissue culture. The domain model is unusually
rigorous: a 1,100-line glossary, 48 backend ADRs, pure decision modules
(`domain/pump_cycle.py`, `domain/steering_phase.py`, `domain/fan_control.py`)
that are unit-tested without Home Assistant, and a Grow Run model (ADR-0033 to
0038, tickets #668 to #684) that already defines the historical-comparison
product nobody else has. Automation never depends on the Recorder (ADR-0010),
and AI is strictly advisory: the only AI-to-service path is
`intent.py` calling `ask_grow_advice`, which returns text.

**Where it is weakest.** Three places.

1. *Unattended-operation safety of the execution layer.* The decision layer is
   good; the effect shell around it assumes the process lives through every
   cycle. A pump is switched off only by the `finally` block of an in-memory
   task (`irrigation_coordinator.py:481-655`). Nothing at start-up checks for or
   switches off an output left on by a crash or power loss. OFF is never read
   back. Daily caps are off by default and their counters reset on every
   restart. After a mid-day restart the crop-steering machine forgets both the
   last shot and that P1 already completed, so the first tick re-enters the P1
   ramp with no cooldown (`domain/steering_phase.py:284-299, 521`). Sensor
   values are used without freshness or plausibility checks, and an unreadable
   tank sensor lets irrigation proceed.
2. *Evidence.* There is no published statement of what has been verified on
   real hardware, no reliability counters, diagnostics that report `null` for
   every subsystem field, and no commissioning procedure.
   HA-Irrigation-Strategy's "validated feature matrix" shows what the
   alternative looks like.
3. *First contact.* 0 stars and no issue templates or Discussions. The card
   ships unminified: the published entry is 2.0 MB against 0.89 MB for a
   production build, because the release path never sets
   `NODE_ENV=production`. According to the hub's own notes, HACS cannot add the
   card from a clean install because 30+ consecutive prereleases push the stable
   release out of its window. The config flow creates the integration without
   a growspace; its `add_growspace` step is unreachable.

**Highest risk.** A pump or valve left running with nobody watching: after a
host crash or power loss mid-shot (the plug restores ON, and nothing turns it
off), after a relay that ignores `turn_off` (nobody reads it back), or after a
frozen-low VWC probe (shots continue until an optional, off-by-default cap).
Those are the failure modes that turn a crop problem into a flood.

**What the next phase should focus on.** In order:

1. Make irrigation restart-safe and fail-safe.
2. Give growers explicit safety controls and a visible controller state.
3. Produce evidence, meaning counters, an automated commissioning harness on
   `ha-dev`'s simulated equipment, and a published feature matrix.
4. Ship a Grow Run MVP, not the full 17-ticket model.
5. Fix the first-contact defects: minified release, HACS installability, a
   first growspace in the config flow, and an honest README.

Everything else (the dialog architecture, extra analytics, more AI) should wait
until those five are in place.

---

## B. Feature-gap matrix

Legend, per cell:

- **●** Implemented as a product capability a user can rely on without writing
  YAML: configured through UI or config flow, with defined behaviour.
- **◐** Partial. It exists but has a documented gap, is opt-in YAML, or covers
  only part of the category.
- **○** Absent.
- **—** Explicitly out of the project's scope.

No numeric scores. The cells are judgements against these definitions, backed by
the evidence column.

| Category | GSM | HA-Irrigation-Strategy (HAIS) | HAGR | Plant Monitor Premium | AC Infinity card | Homegrown-Assistant | Evidence / notes |
|---|---|---|---|---|---|---|---|
| Monitoring | ● | ◐ irrigation-centric | ● via ESPHome + AppDaemon | ◐ per plant | ◐ one controller | ◐ | GSM: env sensors, VPD, DLI, tanks, substrate, Bayesian risk |
| Climate control | ● | — ("does not control climate") | ◐ YAML automations | — | ○ display only | ◐ PID fan in YAML | GSM: dehum/hum on/off, exhaust demand, circulation, lights, AC Infinity bundles |
| Irrigation | ● | ● | ◐ YAML package | — | — | ◐ ESPHome-side | GSM: schedules, P0–P3 steering, adaptive shots, recipes, programs; HAIS: multi-zone, plans |
| Irrigation safety | ◐ | ● | ◐ automations | — | — | ◐ device `restore_mode` | See section C. HAIS: kill switch, write-ahead shot, readback, latched faults, setup revisions |
| Plant management | ● | ○ | ○ | ◐ houseplants | ○ | ○ | GSM: stage history, grid, moves, IPM, training, drying/cure |
| Genetics | ● | ○ | ○ | ○ (OpenPlantBook species) | ○ | ○ | Strain library, lineage, phenotypes, seed inventory |
| Analytics | ● | ◐ recorded VWC/EC, learning | ◐ Grafana, SOPs | ◐ health score | ○ | ◐ InfluxDB/Grafana | GSM: dryback, steering score, EC state, Bayesian stress/mold |
| Reporting / history | ◐ | ◐ run metadata + Recorder comparison + CSV | ○ | ○ | ○ | ○ | GSM Grow Runs are specified, not built; legacy per-plant report only |
| UI breadth | ● | ● dedicated workspace | ◐ dashboards | ◐ | ◐ | ○ | GSM: 9 cards, ~30 dialogs |
| UI clarity (first glance) | ◐ | ● | ◐ | ● | ● | ○ | GSM: contradictory status on Demo Tent; flat 17-item menu (section E) |
| Onboarding | ◐ | ● wizard + my-links, still two installs | ○ copy YAML | ● visual editor, picker preview | ● auto-detect | ○ | GSM: first growspace not created in flow |
| Mobile | ◐ | ◐ | — | ● | ◐ | — | GSM: equipment and phase hidden below the fold on 375 px |
| Reliability evidence | ○ | ● feature matrix, dated audits, live checks | ◐ lived-in build | ○ | ○ | ◐ journal | GSM has no published verification of physical behaviour |
| Community maturity | ○ 0★, no templates | ◐ 19★, Discussions | ● 63★, Discussions, sponsor | ◐ 30★ | ○ 1★ | ○ 9★ | GitHub API, 2026-09-23 |

The shape: GSM leads on breadth and domain modelling, and trails on safety and
reliability evidence and on first contact. Those gaps are what most affect
whether a grower trusts it unattended.

---

## Competitor study

### HA-Irrigation-Strategy (JakeTheRabbit): the safety benchmark

**Architecture.** Split into three: a HA custom integration `crop_steering`
(configuration, entities, setup API, run store, React operator workspace in a
same-origin sidebar panel), a separate Supervisor add-on `f2_control` (one
synchronous Python process, REST polling HA, 3,130-line `controller.py`), and a
pure `crop-steering-engine` package. The integration owns configuration and the
controller owns actuation. They agree through a published, versioned "engine
config" descriptor.

**Crop-steering algorithm.** P0–P3 like GSM. P1 ends on "target recovered after
at least `p1_minimum_shots`" or `p1_maximum_shots`, not on the clock. Rescue
shots (`p3_emergency`, `watchdog`, `min_daily`, `blind_fallback`,
`blind_copy_rescue`) are never blocked by a stale plan but are blocked by every
other gate (`PLAN_HOLD_EXEMPT`, controller.py:180). An optional "Auto Setpoints"
learner is bounded and off by default. An optional LLM (Cloudflare
`typesafe/jev`) can only veto or nudge in bounded steps, and "irrigation never
waits on it".

**Safety model.** This is what GSM should study.

- *Layered gates in one function* (`_blocked`, controller.py:1657). Setup
  pending, room archived, room off, plan hold, latched hardware fault
  (including on hardware shared with another room), no valve mapped, declared
  plumbing disagrees with mapped switches, kill switch off, system disabled,
  auto-irrigation disabled, zone disabled, manual override, external holds
  (dosing/fill/flush), source-water EC and pH out of band. A dead source-water
  probe **fails closed** after a grace window. Every gate returns a
  human-readable reason that is published per zone.
- *Kill switch per room, default OFF* for new rooms.
- *Write-ahead shot record* (`_execute_shot`, controller.py:2161). What the
  shot is about to open, and when, is persisted before anything opens.
- *Fail-closed open sequence.* Any failed `turn_on` cuts what is already on,
  alerts, and does not count the shot.
- *Monotonic shot deadline* that includes HA latency. Kill switch and override
  are re-read every ≤2 s during the shot.
- *Patient readback on close.* First read at 1 s, then every 0.5 s up to 6 s.
  This was tuned from a real 1.6 s Zigbee OFF report that had caused a false
  fault.
- *Persistent hardware-fault latch.* Saved to disk. It blocks every room that
  shares the hardware. It clears only when the engine flags read OFF **and**
  every affected switch reads OFF, and then requires an explicit re-arm. If the
  fault cannot be saved, the alert says "do not restart before repair".
- *Start-up reconcile of an interrupted shot*
  (`_reconcile_room_inflight`, controller.py:1984). The controller closes only
  switches that have been ON since the shot opened them, judged by
  `last_changed` inside a (-5 s, +60 s) window. A switch a person changed is
  left alone, together with everything upstream of it. The pump is not touched
  while a dosing, fill or flush hold is on. With the kill switch OFF the
  operator has it and nothing is touched.
- *Setup revisions.* Hardware-map changes carry a revision and fingerprint and
  are adopted only while engines and hardware read OFF. An unchanged revision
  resumes after a restart without a disarm cycle, a lesson from a live incident
  that cost two hours of P1.
- *Declared plumbing.* A room declares `valves_only`/`pump_valves`/…, so an
  unmapped pump cannot silently "deliver" water.
- *SIGTERM safe-off* closes only this process's in-flight shot. Tank
  circulation and hand watering are not ended by stopping the add-on.
- *Sensor reads* reject non-finite, out-of-range and **stale** values
  (`_read_sensor`, controller.py:1169: range `lo..hi`, `max_age_min=20` against
  `last_updated`, µS/cm→mS/cm conversion).

**Restart behaviour.** Missed shots are not replayed. An in-flight record is
reconciled. An unchanged setup resumes. A changed one needs a disarm cycle and
says so in a notification.

**Commissioning and evidence.** `docs/FEATURE_MATRIX.md` classifies every
feature as implemented, automatically tested or live-verified, with dated
observations. It says plainly what was *not* verified: "Physical water delivery
… remain[s] uncommissioned". Dated audits sit under `docs/audits/`. The
2026-09-21 first-run review found, among other things, that stub-based tests
could not see real HA failures, which led to a second tier of tests against real
HA core. There are 40+ safety regression tests with names that read as
specifications ("a pump that never reports off still latches, and within
seconds").

**UI.** A dedicated operator workspace (React/shadcn in the HA sidebar panel):
Overview, Zones, Irrigation plan (Today/Schedule), Compare runs, Insights,
Activity, Sensors, Rooms & setup, Settings. It has a public browser demo. Edits
are drafts until reviewed ("see each change before applying it").

**Plans and runs.** Versioned, dated per-zone plans are armed for the next
lights-on and never enable pumps or the engine. The controller consumes one
versioned snapshot, and a stale snapshot holds routine steering. "Runs" are
bounded metadata (≤100, ≤366 days) plus Recorder-based comparison aligned by
grow age. There is no yield, no water productivity and no genetics.

**MCP.** Local stdio server. Read tools by default. Writes are opt-in
(`CROP_STEERING_ALLOW_WRITES=true`) and limited to reviewed setup and draft-plan
saves. No actuation and no plan activation.

**What GSM should learn.** The execution-layer patterns above (write-ahead
record, fail-closed open, patient readback, persistent latch, reconcile with
human-override awareness, safe-off). The kill switch and its "operator has it"
semantics. Structured per-zone block reasons. Stale and range-checked sensor
reads. Source-water gates that fail closed. Setup revisions for hardware-map
changes. Declared plumbing. The practice of an evidence-levelled feature
matrix. Test names written as safety claims.

**What GSM should not copy.** The add-on/integration split: GSM is a single
integration, and its effect shells already run in HA's event loop with
cancellation. Adding a second process adds a deployment dependency GSM does not
need, so the patterns port without the process boundary. The synchronous
polling loop. The iframe workspace, since GSM's Lovelace card fits HA's model
better. Facility-scale zone machinery, which #544 already scoped out.

### HAGR (JakeTheRabbit)

**What it is.** A lived-in reference build: automations, blueprints, a YAML
crop-steering package, ESPHome device configs (SDI-12 TEROS-12, SCD41 CO₂,
ultrasonic and load-cell tanks, peristaltic dosing, PWM LED dimming, MLX90640
canopy thermal), an AppDaemon "grow monitor", and SOP documents. 63 stars, the
most in the set.

**Safety automations worth productizing:**

- **Light-leak detection.** Illuminance above threshold during the dark period
  kills the lights and sends a critical notification. It is re-checked on
  restart and every minute. GSM only warns about a stale-on light at start-up
  (`grow_light_coordinator.py:105`).
- **Sensor-unavailability watchdog.** It alerts after 10 minutes offline and
  fails safe the actuator that sensor governs.
- **Daily safe-state audit.** At 03:00 it force-closes every valve, the CO₂
  solenoid and the humidifier. The generalisable idea is a periodic reassertion
  that nothing GSM owns is on without a reason. Productize it as a periodic
  reconciliation, not a blind nightly switch-off.
- **Humidifier off at lights-off.** An interlock so the humidifier and
  dehumidifier never fight.
- **Consolidated, severity-graded alerting** with mute and pause. GSM's Triage
  Alerts already go this way.
- **Overheat light-dimming** with restore.

**Setup-specific, not to replicate:** the Athena Pro Line dosing sequences,
specific M5Stack/ESPHome wiring, door locks and sirens, Node-RED flows and
InfluxDB/Grafana plumbing. GSM should *link to* ESPHome examples, not own them.

**Documentation lesson.** The README is an index: every file has one line
saying what it does. Its growing SOPs build trust with growers because they
show the author grows.

### Plant Monitor Premium Card (djmaxwell1975): frontend usability benchmark

- 43 KB single-file card with a visual editor, a **card-picker preview**, and
  "graceful degradation when optional sensors are unavailable". Tested with 20+
  cards on one dashboard.
- It presents a health score with explicit bands, not raw numbers, and a
  mobile-first layout.
- **Lessons for GSM.** Every GSM card registers with `preview: false`
  (`src/index.ts`) even though each implements `getStubConfig`, so the picker
  shows nothing. The main card's first screen should answer "is it healthy"
  once, consistently. A 43 KB card that does one thing well is a reminder that
  size and first-render work grow with scope, which is the case for
  per-feature chunks.

### AC Infinity Lovelace card (JoshuaSeidel)

- It replicates the physical controller's face: ports 1–8 with power level,
  mode (AUTO/ON/OFF), and one large reading. It **auto-detects** entities by
  integration naming, and its only configuration is four booleans.
- **Lessons for GSM.** Equipment state is immediately legible because it
  mirrors the hardware the grower already knows. GSM's header chips ("Exhaust:
  8", "Fan: 8", "Humidifier: On") are close, but on mobile they are behind
  "More readings (20)". The integration's own device model (controller → ports)
  is the right grouping for equipment display.

### Homegrown-Assistant (jeemers)

- A reference implementation and journal: THC-S substrate sensors calibrated
  against a TEROS-12, on-device crop steering in ESPHome (`brain.yaml`,
  `THCS-steering.yaml`), load-cell and ultrasonic reservoir measurement,
  peristaltic dosing, pH automation, and a VPD PID for AC Infinity fans.
- **Safety lesson.** Relays declare `restore_mode: RESTORE_DEFAULT_OFF`, and
  shot timing runs on the device, so an HA outage cannot leave a pump on. This
  is the **hardware layer** of a safety model. GSM cannot enforce it but should
  document it and ship an example. HAIS's own code comments say the same thing:
  a failed close when HA is unreachable "the SOFTWARE CANNOT fix — only the
  hardware fail-safe (NC valve / pump-relay-default-off / independent
  watchdog) can".
- **Sensor lesson.** Cheap substrate probes (THC-S) are what hobbyists use.
  Calibration and plausibility are therefore first-class concerns, and GSM's
  plausibility gate (issue below) should expect them.

---

## C. Safety gap analysis

Severity:

- **Critical**: uncontrolled actuation can continue with no bound other than
  hardware.
- **High**: crop-damaging over- or under-actuation, or a failure that is
  hidden.
- **Medium**: degraded or misleading behaviour with a bound, or untested.
- **Low**: ergonomic.

### C.1 Actuation paths as implemented

| Output | Driven by | Path | Readback |
|---|---|---|---|
| Irrigation pump | `IrrigationCoordinator` schedules, `VWCIrrigationCoordinator` steering, manual run | `switch.turn_on` blocking → wait up to 10 s for `on` → `asyncio.sleep` → `finally: switch.turn_off` (`irrigation_coordinator.py:481-655`) | ON: waited for, and a timeout is logged but the cycle is booked as delivered. OFF: none |
| Drain pump | same schedule path | same | same |
| Zone valves | not modelled; `switch` domain only; `valve.*` unsupported | — | — |
| Fill pump / dosing | not modelled (`const.py:293` "no dosing hardware") | — | — |
| Dehumidifier / humidifier | `vpd_on_off_controller.py` on VPD/light state change | `GenericOnOffDriver` → `_safe_service_call(..., blocking=False)` (`actuator_driver.py:56`) | none; `is_on()` reads state |
| Exhaust fan | `exhaust_fan_coordinator.py` polling tick | `resolve_actuator_drivers` → `set_speed` | none |
| Circulation fan | `circulation_fan_coordinator.py` | drivers | none |
| Grow lights | `grow_light_coordinator.py` tick; AC Infinity schedule push | drivers | level-triggered reassertion each tick |

GSM exposes only one switch entity per growspace, notifications
(`switch.py`). There is no enable, arm, kill or e-stop entity. Nothing listens
for `EVENT_HOMEASSISTANT_START` to reconcile outputs.

### C.2 Failure-mode table

| # | Failure mode | Current behaviour (evidence) | Desired behaviour | Sev. | Mitigation (issue) | Files | Tests required |
|---|---|---|---|---|---|---|---|
| 1 | Host power loss / HA hard crash mid-cycle | Pump OFF lives only in the task's `finally`. No persisted in-flight record and no start-up reconcile. A plug that restores ON after power loss runs until the tank empties | Persist the in-flight record before `turn_on`. On setup, close what that shot opened and read back OFF. Leave anything a person changed, alert, latch a fault if it will not close | Critical | Write-ahead record + start-up reconcile ([GSM#784](https://github.com/Venosta-web/growspace_manager/issues/784)) + hardware guidance ([GSM#799](https://github.com/Venosta-web/growspace_manager/issues/799)) | `irrigation_coordinator.py`, `coordinator.py` setup, storage | Persisted record + pump ON at setup → OFF and readback; pump `last_changed` after record → left alone + alert; OFF not confirmed → fault latched |
| 2 | Relay or pump ignores `turn_off` / reports ON after OFF | Not detected. `turn_off` result and state never checked | Patient readback (1 s, then 0.5 s to ~6 s). On failure retry, send a critical notification, and latch a persistent fault that blocks further irrigation | Critical | Readback + fault latch ([GSM#785](https://github.com/Venosta-web/growspace_manager/issues/785), [GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783)) | `irrigation_coordinator.py`, `actuator_driver.py` | Simulated switch stuck ON → fault latched within the readback window; late-but-OK report → no false fault |
| 3 | Pump never confirms ON (offline Matter plug, dead relay) | Logged, timing taken from the command, cycle booked as delivered, counters incremented (`irrigation_coordinator.py:552-569`, glossary "Unconfirmed Pump Cycle") | Command OFF, verify, and record as not delivered. After N consecutive, fault. Water accounting follows #549 | High | [GSM#785](https://github.com/Venosta-web/growspace_manager/issues/785) (safety half); #549 decides accounting | same | Offline switch → OFF commanded, not delivered, fault after N |
| 4 | HA restart / reload during P1 or P2 window | Steering machine is recreated in P3 with `_target_reached_today=False` and `_last_cycle_timestamp=None`. The first tick in the window re-enters P1 and, with no last shot, skips cooldown **and** the infiltration gate (`steering_phase.py:284-299, 521`). A mid-P2 restart becomes a fresh P1 ramp | Restore last confirmed shot and the P1-complete date from persisted substrate/shot events. Startup inhibit until the grace period elapses and control sensors report fresh values | High | [GSM#786](https://github.com/Venosta-web/growspace_manager/issues/786) | `vwc_irrigation_coordinator.py`, `domain/steering_phase.py`, `substrate_tracker.py` | Restart at 14:00 after P1 completed → stays P2, respects cooldown from the persisted last shot; no shot inside the inhibit window |
| 5 | Daily caps across restart | `_cycles_today` and `_volume_dispensed_today` are in memory and reset to 0 on every restart (`irrigation_coordinator.py:74-76`; the code comment at :375 admits it). Caps default to `None` (`models/irrigation.py`, `IrrigationConfig`) | Persisted enforcement counters, rehydrated on setup. Caps on by default whenever the flow rate is known | High | [GSM#787](https://github.com/Venosta-web/growspace_manager/issues/787) (blocked by #546), [GSM#788](https://github.com/Venosta-web/growspace_manager/issues/788) | `irrigation_coordinator.py`, `models/irrigation.py` | Restart after N cycles → N preserved; cap still blocks |
| 6 | No absolute runtime bound | Durations are validated `min=1` with no max (`schemas.py:785, 824, 841`). A manual run accepts any duration. The composed shot has no absolute clamp | Hard per-cycle max runtime (configurable, conservative default) enforced in the shell *and* by an independent watchdog timer. Minimum interval between base-schedule events | High | [GSM#788](https://github.com/Venosta-web/growspace_manager/issues/788) | `schemas.py`, `irrigation_coordinator.py`, `domain/pump_cycle.py` | 86,400 s manual run refused; watchdog forces OFF even if the cycle task is stuck |
| 7 | VWC sensor frozen at one value | `_get_sensor_value` is freshness-blind. The infiltration monitor stops receiving samples and keeps its last state. A frozen-low reading keeps triggering shots every interval until an (optional) cap | Freshness via `last_reported` against an Observation Validity Window (the glossary already defines it). Stale → inhibit automatic shots with reason `sensor_stale` and alert after a delay | High | [GSM#789](https://github.com/Venosta-web/growspace_manager/issues/789) | `irrigation_coordinator.py`, `vwc_irrigation_coordinator.py`, new `domain/sensor_validity.py` | Pinned mirrored sensor with no reports for > window → no shots, reason published, alert |
| 8 | Invalid VWC (0, negative, > 100, NaN) | Parsed and used. 0 % looks bone-dry and fires shots | Plausibility bounds per quantity. Implausible → treated as unavailable, never as 0 | High | [GSM#789](https://github.com/Venosta-web/growspace_manager/issues/789) | same | 0 / -5 / 150 / "nan" → no shot, reason `sensor_implausible` |
| 9 | VWC unavailable | Handled. No shots, phase kept (`vwc_irrigation_coordinator.py:156-165`). Silent: no alert | Same, plus an alert after a configurable time, and visible controller state | Medium | [GSM#789](https://github.com/Venosta-web/growspace_manager/issues/789), [GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783) | same | Unavailable 15 min → one alert; recovery clears it |
| 10 | Tank-level sensor unavailable | **Fail-open.** Unreadable tanks are omitted from the gate (`irrigation_coordinator.py:400-417`), so irrigation proceeds with an unknown tank | Unreadable tank = gate closed (`tank_unknown`) when `pause_on_low_tank` is on | High | [GSM#790](https://github.com/Venosta-web/growspace_manager/issues/790) | `irrigation_coordinator.py`, `domain/pump_cycle.py` | Tank unavailable → cycle skipped with reason; manual run too |
| 11 | Tank empty | `pause_on_low_tank` default True, `warning_level` 30 %. Works with a healthy sensor. The gate is evaluated once, pre-cycle | Plus an optional mid-cycle abort if the level crosses a hard floor; docs on hardware float-switch dry-run protection | Medium | [GSM#790](https://github.com/Venosta-web/growspace_manager/issues/790), [GSM#799](https://github.com/Venosta-web/growspace_manager/issues/799) | same | Level drops below floor mid-shot → aborted, OFF confirmed |
| 12 | Service call fails | `turn_on` raising `HomeAssistantError` is not in the caught list. The `finally` still turns off, but the error surfaces as an unhandled task exception, not a logbook irrigation error. `turn_off` failure is unobserved. Climate drivers use `blocking=False`, so device-side failures are never seen | Fail-closed open sequence (HAIS). Every command awaited. Failures counted, surfaced and, when repeated, latched | Medium | [GSM#785](https://github.com/Venosta-web/growspace_manager/issues/785), [GSM#792](https://github.com/Venosta-web/growspace_manager/issues/792), [GSM#796](https://github.com/Venosta-web/growspace_manager/issues/796) | `irrigation_coordinator.py`, `actuator_driver.py` | `turn_on` raises → OFF commanded, not counted, reason recorded |
| 13 | Pump ON when GSM expects OFF (manual use or glitch) | Not observed. A scheduled cycle will "confirm" immediately and then switch it OFF at the end | State listener on managed outputs. ON without an in-flight record → `unexpected_on` event. Policy: alert and inhibit (default), or enforce OFF and fault | High | [GSM#793](https://github.com/Venosta-web/growspace_manager/issues/793) | `irrigation_coordinator.py` | External ON → alert + inhibit; automation does not start a cycle while a person holds the pump |
| 14 | Manual activation while automation runs | No override concept. Exhaust and circulation reassert every tick, so they fight the user. VPD on/off controllers override on the next sensor change | Explicit timed override (entity or service) per growspace/subsystem, persisted, audited, expiring | Medium | [GSM#793](https://github.com/Venosta-web/growspace_manager/issues/793) | fan coordinators, `vpd_on_off_controller.py` | Override for 30 min → no GSM commands; expiry → resumes; survives restart |
| 15 | Irrigation and drain overlap; overlapping requests | New scheduled event cancels the running one. Manual run cancels running. Irrigation and drain run concurrently with no interlock | Documented single-owner rule per pump. Optional irrigation/drain interlock | Low | [GSM#788](https://github.com/Venosta-web/growspace_manager/issues/788) | `irrigation_coordinator.py` | Overlap cases produce exactly one running cycle per pump |
| 16 | Config changes while armed | Options update → full reload → in-flight cycle cancelled (OFF in `finally`). Settings service → listeners rebuilt, running shot continues. Hardware re-mapping takes effect immediately | Hardware-map changes (pump entity, tank sensor) accepted only while the affected outputs read OFF, else deferred with a reason (HAIS setup-revision pattern). Setpoint changes apply at the next decision | Medium | [GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783) (config revision field), [GSM#784](https://github.com/Venosta-web/growspace_manager/issues/784) | `services/irrigation_change.py`, `config_handlers/irrigation_config_handler.py` | Change pump entity mid-shot → old entity turned OFF, change applied after |
| 17 | Recipe or program changes mid-cycle | Program Hold rules are sound (ADR-0045). A stamp never switches a subsystem on. The in-flight shot is unaffected | Keep. Record in the Run Configuration Timeline | Low | #680 | — | existing |
| 18 | Recorder unavailable | Automation is unaffected (ADR-0010). Audit trail (HA logbook) and legacy report depend on the Recorder and its 10-day default retention | Safety ledger (faults, overrides, e-stops, counters) in GSM's own store, independent of Recorder retention | Medium | [GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783), [GSM#796](https://github.com/Venosta-web/growspace_manager/issues/796) | storage | Purge Recorder → fault history still in diagnostics |
| 19 | DST / clock correction | Shot durations use `asyncio.sleep` (monotonic). Schedules use `async_track_time_change`. Phase boundaries are local-date arithmetic. No DST or clock-jump tests found | Commissioning scenarios for the spring-forward gap, fall-back repeat and a forward clock jump: no double shot, no missed midnight reset | Medium (untested) | [hub#246](https://github.com/Venosta-web/growspace_manager_workspace/issues/246) | `domain/steering_phase.py`, `domain/irrigation_schedule.py` | Freezegun across both transitions |
| 20 | Flow much higher/lower than expected | No flow input exists (#549 notes it) | Staged: actuator confirmation first, metered upgrade later (#549) | Medium | #549 | — | — |
| 21 | VPD sensor unavailable or frozen (dehum/hum) | `async_check_and_control` returns when VPD is `None` (`vpd_on_off_controller.py:174`), so the device holds its last state indefinitely. It is event-driven, so a frozen sensor produces no events at all. No max runtime | After a validity timeout, drive to a configured safe state (default OFF) and alert. Optional max continuous runtime | High | [GSM#792](https://github.com/Venosta-web/growspace_manager/issues/792) | `vpd_on_off_controller.py`, `dehumidifier_coordinator.py`, `humidifier_coordinator.py` | Sensor unavailable > timeout → OFF + alert |
| 22 | Humidifier and dehumidifier both ON | No interlock; independent thresholds can overlap | Never command both ON in one growspace. Last-wins with a logbook note | Medium | [GSM#792](https://github.com/Venosta-web/growspace_manager/issues/792) | same | Overlapping thresholds → at most one ON |
| 23 | Exhaust or circulation sensors all unavailable | `compute_exhaust_demand` returns `None` and the speed is held (`domain/fan_control.py`). The critical-temp override needs the temperature it has lost | Configurable fallback speed after the validity timeout (ventilating is usually the safe direction) | Medium | [GSM#792](https://github.com/Venosta-web/growspace_manager/issues/792) | `exhaust_fan_coordinator.py` | All sensors unavailable → fallback speed after timeout |
| 24 | Light on during the dark period | Warned only at start-up for a stale-on light | Continuous light-leak detection (managed light state and optional illuminance sensor) → critical alert, optionally switch managed lights OFF | Medium | [GSM#794](https://github.com/Venosta-web/growspace_manager/issues/794) | `grow_light_coordinator.py` | Illuminance > threshold in dark → alert (+ OFF if opted in) |
| 25 | AI failure affecting actuation | Not possible. AI only returns advice (`intent.py:63`) | Keep. State it in docs as a guarantee | — (strength) | [GSM#800](https://github.com/Venosta-web/growspace_manager/issues/800) | — | contract test that no AI service is registered as an actuation path |

### C.3 Proposed safety architecture

The design goal is predictable behaviour over clever recovery. It extends the
patterns the code base already uses (pure decision in `domain/`, effect shell
in the coordinator; ADR-0021, ADR-0023) instead of introducing a second
process.

**1. Operator controls, per growspace, as standard HA entities.**

- `switch.<gs>_automation`: the growspace master. OFF means GSM commands none of
  this growspace's outputs, and readings stay live. It is a real HA switch, so
  users can put it in their own automations.
- `switch.<gs>_irrigation_armed`: required for any *automatic* pump actuation.
  New irrigation configurations start disarmed. For migration, existing
  growspaces start armed so current behaviour is preserved, and a repair issue
  asks the grower to review the new safety settings.
- `button.<gs>_emergency_stop` plus a `growspace_manager.emergency_stop` service
  (optionally all growspaces). It commands every managed output to its safe
  state, verifies, and latches `emergency_stop`. It clears only through an
  explicit `growspace_manager.reset_safety` once outputs read safe.

**2. Controller state per subsystem (irrigation first, then climate).**

`sensor.<gs>_irrigation_controller`, an `enum` sensor with these states:

| State | Meaning | Latching |
|---|---|---|
| `idle` | Not configured, or automation off | — |
| `ready` | Armed, all gates pass, nothing running | — |
| `running` | An in-flight record exists | — |
| `inhibited` | A transient gate blocks: startup, sensor stale or implausible, tank low or unknown, cap, dark, runoff-EC halt, override | No. Clears itself, and clearing never actuates by itself; the next normal decision does |
| `fault` | Hardware disagreement: OFF or ON not confirmed, unexpected ON, repeated command failure | Yes. Persists across restart, needs outputs safe + acknowledgement |
| `emergency_stop` | Operator e-stop | Yes |

Attributes carry structured `reasons: [{code, detail, since}]` (codes such as
`startup_inhibit`, `sensor_stale:<entity>`, `tank_unknown:<tank>`,
`cap_volume`, `fault_off_unconfirmed:<entity>`), `fault_id`, `requires_ack`,
and `config_revision`.

**3. Gate order.** One pure function, extending the Pump Cycle Gate:

1. emergency_stop
2. fault
3. automation off
4. not armed
5. startup inhibit
6. unresolved in-flight record
7. sensor validity (stale or implausible control inputs)
8. tank gate (low **or unknown**)
9. caps: persisted cycles/volume, min interval, max runtime
10. dark
11. runoff-EC halt

A manual run passes gates 5 and 10 but never gates 1, 2, 6, 8 or 9.

**4. Execution shell, per cycle.**

1. Persist the in-flight record.
2. Blocking `turn_on`. On failure, command OFF, verify, and do not count.
3. Confirm ON. On timeout, command OFF, verify, record as *not delivered*, and
   fault after N consecutive.
4. Run to a monotonic deadline. An independent `async_call_later` watchdog at
   `deadline + grace` forces OFF even if the task is wedged.
5. `turn_off`, then patient readback (1 s, then 0.5 s up to 6 s).
6. On OFF failure, latch the fault, send a critical notification, and retry OFF
   every minute.
7. Clear the record.

**5. Start-up.** Load the in-flight record, faults, enforcement counters, last
confirmed shot and the P1-complete date. Reconcile the in-flight record with the
HAIS rules: close only what has been ON since that shot opened it, and leave
anything a person changed. Then enter `inhibited(startup)` for a grace period
(default 5 min) *and* until every control sensor has reported after start.
Missed schedules are never replayed.

**6. Monitoring and manual override.** A state listener on each managed output.
ON without an in-flight record raises `unexpected_on`. The default policy is to
alert and inhibit automation while it lasts, which treats it as a person's
action. An opt-in `enforce_off` policy switches it off and faults instead. An
explicit timed override (`growspace_manager.set_override`, duration required)
is persisted, audited and expires by itself.

**7. Sensor validity.** One `domain/sensor_validity.py` shared by irrigation and
climate. Freshness uses `last_reported` (falling back to `last_updated`)
against the glossary's **Observation Validity Window**. Plausibility bounds by
quantity (VWC 0–100 %, pore EC 0–20 mS/cm, temperature −10–60 °C, RH 0–100 %,
tank 0–100 %). Missing is never zero.

**8. Climate fail-safe.** Per actuator:

- dehumidifier/humidifier: default OFF after the validity timeout;
- exhaust: a configurable fallback speed;
- humidifier and dehumidifier: interlocked so both are never ON;
- optional max continuous runtime;
- every command awaited (`blocking=True`) with a bounded timeout and counted.

**9. Audit.** Every transition, gate reason change (edge-triggered), fault,
acknowledgement, override and e-stop is written to a GSM-owned safety ledger
(bounded ring in the integration store, per ADR-0010), fired as a logbook
event, and included in diagnostics. Nothing depends on Recorder retention.

**10. Hardware layer (documented, not enforced).**

- Normally-closed valves.
- Plugs configured to power-on OFF.
- ESPHome relays with `restore_mode: ALWAYS_OFF` and an on-device max-on
  interval.
- A hard-wired float switch for pump dry-run.

Software cannot close a valve when HA is down.

**Relationship to existing decisions.** It is consistent with ADR-0021 (pure
gate), ADR-0022 (driver abstraction gains readback), ADR-0045 (hold by
default), and ADR-0010 (persist events, not Recorder). It leaves #549's ledger
and accounting decision to #549; this model only needs "did the output reach
the state we commanded". It is deliberately *narrower* than the "Stateful
Irrigation Incidents with severity, ownership, acknowledgement, and escalation"
that #544 ruled out of scope. A single latched fault with an acknowledgement
step is not an incident-management product. If #544's charting disagrees, that
is the place to reconcile the two.

### C.4 Operational validation framework

**Counters.** Durable, per growspace, in the integration store, with lifetime
totals plus rolling 24 h and 30 d:

- irrigation requests, fired, completed-verified, completed-unverified, aborted
  (by cause: cancel, e-stop, override, error, watchdog), skipped (by gate
  reason);
- command failures (on/off), readback mismatches (on-unconfirmed,
  off-unconfirmed, unexpected-on);
- control-sensor unavailable minutes, stale events, implausible readings;
- inhibits by reason, faults latched/acknowledged, emergency stops;
- HA starts (and how many found an in-flight record, and whether a Grow Run was
  active), with actuator state after restart;
- automated runtime seconds per actuator, and water delivered (estimated vs
  verified, per #546/#549);
- days since last fault, and automation uptime (% of time armed and not
  faulted);
- Vision: reuse Capture Continuity counts.

**Where they appear:**

| Surface | What | Why |
|---|---|---|
| Diagnostics download | Everything, plus the last 100 ledger entries, the in-flight record, controller states and config revision | The bug-report attachment; the issue template asks for it |
| Growspace Logbook | Faults, e-stops, overrides, inhibit start/end (edge-triggered) | Human timeline |
| Grow Run report | Run-scoped summary: shots, aborted, faults, restarts during the run, verified vs estimated water | "What happened during this run" must include reliability |
| Sensors | `sensor.<gs>_irrigation_controller` plus one diagnostic-category counter sensor | Automations and dashboards |
| Dedicated reliability page | Not now. Fold a "Health" tab into the config dialog later | Avoid new surface area before content exists |
| Anonymous telemetry | **No**, not without a privacy review. Offer a user-initiated "evidence export" JSON the grower can attach to a Discussion instead | Consent and control stay with the user |

**Evidence statements this enables**, once a grower shares an export: "N
irrigation events, X % verified; Y days unattended; Z restarts, 0 outputs found
ON after restart; 0 unexpected-ON events".

### C.5 Commissioning test plan

Each case is run on real hardware by a grower (guide, [GSM#799](https://github.com/Venosta-web/growspace_manager/issues/799)). Where marked, it is
also automated on `ha-dev` against the hub's simulated devices and mirrored
sensors ([hub#246](https://github.com/Venosta-web/growspace_manager_workspace/issues/246)). "Expected" describes the target behaviour after the P0 issues
land; the harness should first characterise current behaviour.

| # | Test | Procedure | Expected safe behaviour | Record | Automatable on ha-dev |
|---|---|---|---|---|---|
| 1 | Sensor disconnect | Unpower the VWC probe / make the mirrored sensor `unavailable` | No automatic shots; controller `inhibited(sensor_unavailable)`; one alert after the delay; resumes after recovery with no burst | Ledger entry, alert time | Yes |
| 2 | Pump stuck ON | Relay that ignores OFF (simulated switch that refuses `turn_off`) | Fault latched within ~6 s of the OFF command; critical notification; no further cycles; survives restart | Latch time, notification | Yes (needs a "stuck" simulated switch) |
| 3 | Valve/pump state mismatch | Toggle the pump ON externally while idle | `unexpected_on` → alert + inhibit (default policy) | Ledger | Yes |
| 4 | HA restart mid-irrigation | `ha dev restart` during a 60 s shot | Pump OFF during shutdown, or reconciled OFF at start; no shot within the inhibit window; P1/P2 state and cooldown preserved | Shot log, pump state timeline | Yes |
| 5 | Host reboot / power loss | Hard-kill the container mid-shot (`docker kill`), with the plug set to restore ON | At start, the in-flight record is reconciled: pump OFF, readback OK; alert that the shot was interrupted | Ledger, alert | Yes (`docker kill`) |
| 6 | Empty tank | Drop the level below warning | Cycles skipped with reason; persistent notification; manual run also refused | Ledger | Yes |
| 7 | Invalid VWC | Pin the mirrored sensor to 0, -5, 150, `nan` | Treated as unavailable; no shots | Ledger | Yes |
| 8 | Stale sensor | Pin the mirrored sensor and stop its reports | After the validity window, `inhibited(sensor_stale)`; alert | Ledger | Yes |
| 9 | Service-call failure | Point the pump at a non-existent or erroring entity | Cycle not counted; OFF commanded; reason recorded; fault after N | Ledger | Yes |
| 10 | Overlapping requests | Manual run during a scheduled shot; drain during irrigation | Exactly one cycle per pump; documented winner; no orphaned ON | Timeline | Yes |
| 11 | Manual override | Set a 10 min override, then operate the pump by hand | No GSM commands during override; expiry resumes; audit entries | Ledger | Yes |
| 12 | Configuration change while armed | Change the pump entity mid-shot | Old output closed and verified; change applied after; config revision increments | Ledger | Yes |
| 13 | DST / time boundary | Freezegun across spring-forward and fall-back, and a +1 h clock jump | No double shot, no missed midnight reset, phase boundaries correct | Test output | Unit/integration test, not live |

Passing results are recorded in the validated feature matrix ([GSM#800](https://github.com/Venosta-web/growspace_manager/issues/800)) with a date,
the versions, and whether the run was simulated or on physical hardware.

---

## D. Grow Run implementation map

Status at `8d0a129`. "Planned" means a glossary entry, an ADR, or a ticket. The
only Grow Run code is a surrogate Grow Run identity inside the Vision Evidence
Store (`data_access/vision_evidence_schema.py`); nothing else exists.

| Concept | Planned | Backend | API/WS | HA entity | Frontend | Tested | Documented |
|---|---|---|---|---|---|---|---|
| Grow Run, state graph, Run Revision, Sequence Number | #668, ADR-0033/35 | ○ | ○ | ○ | ○ | ○ | ● glossary |
| Active Run Sensor | #668 | ○ | — | ○ | ○ | ○ | ● |
| Run Participation / Participant | #669 | ○ | ○ | — | ○ | ○ | ● |
| Activity Fact → projection | #669, ADR-0038 | ○ | ○ | — | — | ○ | ● |
| Unattributed Activity Ledger / backdating | #670, ADR-0036 | ○ | ○ | — | ○ | ○ | ● |
| Run Completion Preview | #671 | ○ | ○ | — | ○ | ○ | ● |
| Harvest Source Run / Window / attribution | #672 | ◐ plant `dry_start`, HarvestMetrics exist | ◐ | — | ◐ harvest dialogs | ◐ | ● |
| Yield, No Usable Yield | #672/#673 | ◐ per-plant `dry_weight` only | ◐ | — | ◐ | ◐ | ● |
| Finalized Run / Finalization Snapshot / Participant Identity Snapshot | #673, ADR-0033/34 | ○ | ○ | — | ○ | ○ | ● |
| Run Reopening, Void, Purge, corrections | #674 | ○ | ○ | — | ○ | ○ | ● |
| Grow Run View / Run Comparison | #675 | ○ | ○ | — | ○ | ○ | ● |
| Water Applied / Water Productivity | #676 | ◐ Aggregate Water Use (ADR-0017) exists per growspace, not per run | ◐ | ● `WaterUsageSensor` | ◐ water chip | ● for the aggregate | ● |
| Run Energy / Energy Productivity / Accounting Boundary | #677 | ○ | ○ | — | ○ | ○ | ● |
| Average VPD Deviation | #678 | ◐ targets resolved per stage/day-night exist | ○ | — | ○ | ◐ | ● |
| Mold-Risk Episodes | #679 | ◐ Bayesian mold-risk sensor exists | ○ | ● | ◐ | ● for the sensor | ● |
| Metric Coverage / Validity Window / Definition Version | #676–#679 | ○ | ○ | — | ○ | ○ | ● |
| Run Configuration / Activity Timeline | #680 | ◐ logbook events (Recorder-bound) | ◐ | — | ◐ logbook card | ◐ | ● |
| Run Media | #681 | ◐ camera snapshots, Vision store | ◐ | — | ◐ | ◐ | ● |
| Imported Run | #682 | ○ | ○ | — | ○ | ○ | ● |
| Run Export (JSON/PDF) | #683 | ◐ legacy per-plant `export_grow_report` / `get_grow_report` (Recorder) | ◐ | — | ◐ | ◐ | ● |
| Legacy Grow Report removal | #684 | — | — | — | — | — | ● |
| Run Lifecycle Suggestion, Live/Pending metrics | glossary | ○ | ○ | — | ○ | ○ | ● |

**Reading.** The model is conceptually complete and entirely unbuilt. The
tickets are good vertical slices. The risk is sequencing: #683 (export) is
blocked by *every* metric ticket, so the first exportable run waits for energy
accounting and media retention.

**Shortest path to a usable first release (MVP).**

1. **#668** Start and surface an active run.
2. **#669** Activity Facts → participation. Include water events and the safety
   ledger events from C.3, so a run records faults and restarts.
3. **#671** Complete with preview.
4. **#672** Harvest attribution → Yield.
5. **#673** Finalize snapshot. Pull *Run Reopening* forward from #674, because a
   finalized run with no correction path is a trap, and allow discarding an
   empty active run.
6. **#676** Water Applied and Water Productivity. These build on ADR-0017, the
   one metric whose inputs already exist.
7. **#675** Grow Run View and two-run comparison.
8. **#683, reduced.** JSON export of the finalized snapshot, blocked only by
   #673 and #675. PDF and the remaining metrics follow.

Defer #670 (backdating), the rest of #674 (void, purge, boundary correction),
#677 (energy), #678 (VPD consistency), #679 (mold episodes), #680 (full
timelines), #681 (media), #682 (import) and #684 until the MVP is in growers'
hands.

**UI recommendation.** Do not put Grow Runs inside the main card beyond a
compact active-run chip. Give them a surface of their own:

```
Main card header (Immediate layer)
┌──────────────────────────────────────────────────────────┐
│ Demo Tent · Run #4 · day 61 · 17 plants      [Complete…] │  ← chip opens Grow Run View
└──────────────────────────────────────────────────────────┘

Grow Run View (full-screen dialog; later also a sidebar panel page)
┌ Run #4  Active · started 2026-07-24 · Europe/Berlin ─────────────── [Export] ┐
│ Overview | Participants | Performance | History | Compare                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview: what happened                                                      │
│  Timeline strip: stage changes · moves · config changes · faults · harvest   │
│  Reliability: 412 shots (408 verified) · 1 fault (ack'd) · 2 HA restarts     │
│  Environment: VPD in band 81 % (coverage 97 %) · mold episodes 1             │
│ Performance: Yield 1,240 g (Pending, 2 plants missing) · Water 318 L         │
│              Water productivity: —  (needs final yield)                      │
│ Compare (Finalized only): Run #3 vs Run #4                                   │
│   Yield/HSP  78 g → 73 g ▼   Water prod. 3.4 → 3.9 g/L ▲   Duration 98 → 101 │
│   Config diffs: P2 dryback 6 → 8 %, EC band 3.0–3.8 → 3.2–4.0                │
│   "What to repeat": notes from both runs' retrospectives, side by side       │
└──────────────────────────────────────────────────────────────────────────────┘

Standalone card: growspace-runs-card (dashboard use)
┌ Runs · Demo Tent ───────────────────────────┐
│ #4 Active  day 61                           │
│ #3 Finalized  1,310 g · 3.4 g/L  ▸ compare  │
│ #2 Finalized  1,020 g · 2.9 g/L             │
└─────────────────────────────────────────────┘
```

How this answers the brief's questions:

- *What happened?* The Overview timeline plus the reliability line.
- *What performed well?* Performance with coverage shown.
- *What changed?* Compare plus configuration diffs.
- *What should I repeat?* Retrospective notes side by side.
- *What configuration was active?* The Configuration Timeline at any date,
  available once #680 lands.

---

## E. UX and onboarding audit

### E.1 First-user journey, as it stands

| Step | What the user does | Friction observed |
|---|---|---|
| 1 | Discover the project | Two repos, 0 stars. The README opens with an accurate one-line pitch, but the version badge says 1.2.1 against a 1.2.3 release, and it shows a "Quality Scale: Gold" badge that is a self-assessment (HA only rates core integrations) |
| 2 | Install the card via HACS | Custom repository only. Per the hub's AGENTS.md, a clean HACS cannot currently add the card: 30+ consecutive prereleases push the last stable (v1.3.1, 2026-08-26) out of HACS's release window, and `main` has no built `dist/` |
| 3 | Install the integration via HACS, restart | Custom repository. Requires HA **2026.5.4** (backend `hacs.json`), while the card declares 2025.12 |
| 4 | Add the integration | The config flow asks only for a name and creates the entry (`config_flow.py:66-107`). `async_step_add_growspace` exists but nothing routes to it, so the user lands with **no growspace** |
| 5 | Create a growspace | Configure → options menu → Manage Growspaces → Add. The options flow has ~40 steps (`config_flow.py:296-609`). The card also has its own config dialog, so there are two configuration surfaces |
| 6 | Map sensors, lights, climate, irrigation | Entity pickers across several option steps. No auto-suggestion by area or device class. No presets |
| 7 | Add the card | `type: custom:growspace-manager-card` with `default_growspace`. The card picker shows no previews (`preview: false`) |
| 8 | Add plants and strains | Card dialogs (good), or the options flow (duplicate path) |
| 9 | Tank, AI, Vision, labels | AI needs a Conversation Agent. Vision needs a separate App plus a token. Labels need a Niimbot over BLE. Each is independent, which is good, but none is surfaced as optional in a checklist |
| 10 | First look at the dashboard | Demo Tent shows "All 17 plants on track · No plant issues reported" beside "VPD **CRITICAL**" and "Optimal Conditions: Not Optimal: Temp out of range". On a 375 px screen, equipment state and the crop-steering phase sit behind a carousel and "More readings (20)" |

### E.2 First-run wizard (recommended)

Put it in two places, each doing what it is good at:

- **Config flow** (backend, one screen, required). It creates the first
  growspace with name, type preset and grid size, so step 4 is never empty.
  Optional: temperature and humidity, and a VPD sensor suggested by device
  class in the same area.
- **Card "setup checklist" empty state** (card). While a growspace lacks
  something, the main card shows a checklist in place of empty panels:
  1. Lights mapped
  2. Circulation and exhaust
  3. Climate control (optional)
  4. Irrigation (optional; ends *disarmed*, see C.3)
  5. Substrate sensors (optional)
  6. Add or import plants
  7. Dashboard ready

  Each item opens the existing dialog at the right tab. Optional modules (AI,
  Vision, labels, TC) are listed separately as "extras", so advanced features
  never block the basics.

**Presets** set feature visibility and which subsystems are offered. They never
set cultivation targets. The presets and what they show:

- *simple soil tent*: schedules, no steering;
- *living soil*: no feed EC;
- *coco crop-steering*: steering, substrate, tank;
- *hydroponic room*: tank, EC/pH focus;
- *mother/clone room*: no flower bands;
- *drying room* and *curing room*: dry/cure panels, humidity focus.

A preset is a stamp like ADR-0012's: applied once, freely editable afterwards.

### E.3 Information architecture

The main card should answer "what is happening in this growspace right now?"
Classifying today's surface, from the live `ha-dev` card and the dialog list:

| Layer | Belongs on the main card | Today |
|---|---|---|
| Immediate | health verdict (one, consistent), environment vs target, active alerts, lights/equipment state, irrigation phase and next shot, tank, plant grid, active run chip, safety state | Mostly present on desktop. Mobile hides equipment and phase. The health verdict contradicts the VPD tile |
| Operational | water, add plant, IPM, training, arrange, move, feed | In one flat menu with everything else |
| Analytical | compare, logbook, snapshots, analytics, Grow Runs | Same flat menu |
| Administrative | irrigation recipes and programs, nutrients, strains, label templates, TC, config | Same flat menu |

The actions menu is a single list of 17 entries:

- Select plants
- Add Plant
- Water Growspace
- Log / Manage IPM
- Log Training
- Arrange
- Irrigation
- Irrigation Recipes
- Irrigation Programs
- Nutrients
- Strains
- Tissue Culture
- Label Templates
- Compare
- Logbook
- Camera Snapshots
- Ask AI

**Recommendation ([card#972](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/972)).**

- Group the menu into *Do* (operational), *Review* (analytical) and *Manage*
  (administrative).
- Keep *Water now* and *Add plant* as direct actions.
- Make the header verdict derive from the same triage/alert source as the tiles,
  so it can never say "on track" beside "critical".
- On mobile, show an equipment strip (lights, exhaust, fans, dehum/hum, pump)
  and the phase/next-shot line above the readings carousel.
- Add the safety state chip ([card#974](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/974)) to the Immediate layer.

**Standalone cards vs dialogs.** Tank, logbook, analytics, AI insight, subarea,
grid and carousel are already standalone. Two features deserve their own
surface rather than a dialog. Grow Runs belong in a runs card and a full-screen
view (D). Irrigation deserves an "irrigation card" showing phase, next shot,
today's shots, water and controller state, because it is the thing an
unattended grower checks most. Label templates, recipes, programs and TC
management are administrative and correctly live in dialogs.

---

## F. Frontend performance audit

Built from `origin/dev` `4840ea90` with the repository's own `rollup.config.js`.
Sizes are bytes; gz is `gzip -9`.

### F.1 What ships vs what could ship

| Chunk | As released (dev mode) raw / gz | Production build raw / gz | Loaded |
|---|---|---|---|
| `growspace-manager-card.js` (entry) | **2,013,498** / 468,599 | 887,430 / 242,563 | every dashboard with any GSM card |
| `growspace-dialog-host.container-*` | 1,656,184 / 322,722 | 836,448 / 190,269 | first time *any* dialog opens |
| `growspace-heatmap-3d-*` (three.js) | 1,620,288 / 323,243 | 649,979 / 159,040 | only when the 3D view opens |
| `growspace-label-templates-*` | 384,476 / 85,351 | 150,915 / 37,741 | label template dialog |
| `growspace-config-dialog-*` | 353,155 / 73,029 | 177,651 / 39,819 | config dialog |
| `growspace-tc-*` | 142,485 / 29,843 | 66,117 / 13,945 | TC dialog/card |
| everything | 6.24 MB | 2.80 MB | — |

The dev-mode entry is byte-identical in size (2,013,498) to the published
`v1.4.0-next.25` asset. **Releases ship unminified**:
`scripts/publishing.mjs:199` runs `npm run build` and nothing in `scripts/` or
`.github/` sets `NODE_ENV=production`, so `rollup.config.js` skips terser and
`minifyHTML`. Fixing that alone halves every download and parse ([card#968](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/968)).

### F.2 Eager vs lazy

- Already lazy: three.js 3D view, dialog host, config dialog, label templates,
  TC view, "flow", environment ramp, and every card editor. **"Lazy-load the 3D
  visualization" is already done.**
- Eager in the entry (pre-minify rendered sizes):
  - luxon: 255.7 KB, imported by exactly two files
    (`slices/header-metrics/index.ts`,
    `features/ui/containers/growspace-header.container.ts`);
  - zod v4 classic including `to-json-schema`: ~175 KB;
  - `en.json`: 76 KB;
  - environment charts (`env-chart` 54 KB, `crop-steering-day-chart` 46 KB,
    `tank-water-chart` 27 KB, `metric-combo-chart` 17 KB);
  - `@mdi/js` path table: 44.5 KB;
  - `@lit-labs/virtualizer`: 38.7 KB;
  - the TC slice (31 KB) and labels slices (37 KB) are eager although their
    features are lazy;
  - all nine standalone cards register and bundle eagerly (for example the
    subarea card, 20 KB).
- The dialog host is one 1.34 MB (pre-minify) chunk of 116 modules:
  - irrigation UI 342 KB, plants 108 KB, strain editor 56 KB, snapshots
    (vision) 51 KB, `qrcode-generator` 51 KB, vision 43 KB, chat 24 KB, print
    label 19 KB, breeder manager 14 KB, and so on;
  - opening "Log Training" downloads the irrigation editor, the strain editor,
    the QR encoder and the AI chat.
- three.js is imported as `import * as THREE` in each renderer, and the chunk
  holds 1.4 MB of `three` pre-minify. It is acceptable because it is opt-in.
  Named imports would let tree-shaking help at the margin.

### F.3 Likely bottlenecks

1. Parse and compile of a 2 MB entry on a low-power HA tablet or phone webview,
   on every dashboard load (the service worker caches the download, not the
   compile).
2. First dialog open: a 1.66 MB (released) chunk before the dialog paints.
3. Several GSM cards on one dashboard share the entry, so there is no
   duplication, but every card type pays for every other card type's code.
4. Charts render eagerly on first paint, whatever the viewport.

### F.4 Budget (enforced in CI, [card#971](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/971))

Measured on the production build, gzip:

| Artifact | Now | Stage 1 (after [card#968](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/968)) | Stage 2 (after [card#969](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/969)/C3) | Rule |
|---|---|---|---|---|
| Entry | 469 KB (as shipped) | ≤ 250 KB | ≤ 170 KB | Fail CI above budget; raising it needs a changelog line |
| Any dialog chunk | 323 KB | ≤ 200 KB | ≤ 60 KB each | One dialog, one chunk (shared deps split out) |
| three.js chunk | 323 KB | ≤ 165 KB | ≤ 165 KB | Only loaded by an explicit 3D action |
| Standalone card own code | n/a | — | ≤ 25 KB each | A card imports only what it renders |
| Main-card first render work | unmeasured | measure | ≤ 100 ms scripting on a mid-range phone profile (4× CPU throttle) | Playwright trace in the e2e job |

Do not chase size at the cost of maintainability. The dialog split should
follow the existing `loadLazyChunk` / `LAZY_CHUNKS` pattern
(`src/lib/lazy-chunk.ts`), which already handles a stale chunk after a HACS
update. Replace luxon with `Intl.DateTimeFormat` plus HA's `hass.locale` time
zone helpers, or load it lazily. Consider `zod/mini` for the wire schemas only
if it does not fork the schema style (ADR 0031 constrains shapes, not the zod
flavour).

---

## G. Prioritized roadmap

Issue links are the ones created from this report (appendix lists them all).

### P0: safety and reliability (before trusting unattended control)

- Safety foundation: controller state, persisted fault ledger, acknowledge ([GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783))
- Reconcile and force outputs OFF after a restart or crash mid-cycle ([GSM#784](https://github.com/Venosta-web/growspace_manager/issues/784))
- Readback on every cycle and a persistent hardware-fault latch ([GSM#785](https://github.com/Venosta-web/growspace_manager/issues/785))
- Restore steering state and add a startup inhibit ([GSM#786](https://github.com/Venosta-web/growspace_manager/issues/786))
- Persist daily safety counters ([GSM#787](https://github.com/Venosta-web/growspace_manager/issues/787), blocked by #546)
- Hard max runtime per cycle, a minimum interval, and safe default caps ([GSM#788](https://github.com/Venosta-web/growspace_manager/issues/788))
- Sensor freshness and plausibility gate ([GSM#789](https://github.com/Venosta-web/growspace_manager/issues/789))
- Fail closed on an unreadable tank ([GSM#790](https://github.com/Venosta-web/growspace_manager/issues/790))
- Master, arm and emergency-stop controls ([GSM#791](https://github.com/Venosta-web/growspace_manager/issues/791))
- Climate fail-safe on sensor loss, runtime bound, hum/dehum interlock ([GSM#792](https://github.com/Venosta-web/growspace_manager/issues/792))
- Automated commissioning scenarios on `ha-dev` ([hub#246](https://github.com/Venosta-web/growspace_manager_workspace/issues/246))
- Ship minified releases ([card#968](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/968)). Listed here because it is trivial and it is a
  release-quality defect

### P1: product maturity

- Grow Run MVP cut and re-sequencing ([GSM#797](https://github.com/Venosta-web/growspace_manager/issues/797), using #668, #669, #671, #672, #673,
  #676, #675 and a reduced #683)
- Diagnostics fixed ([GSM#795](https://github.com/Venosta-web/growspace_manager/issues/795)); reliability counters ([GSM#796](https://github.com/Venosta-web/growspace_manager/issues/796))
- Unexpected-state detection and audited manual override ([GSM#793](https://github.com/Venosta-web/growspace_manager/issues/793))
- First growspace in the config flow ([GSM#798](https://github.com/Venosta-web/growspace_manager/issues/798)), then the guided setup and presets
  ([card#973](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/973))
- Commissioning guide, hardware fail-safes and supported hardware ([GSM#799](https://github.com/Venosta-web/growspace_manager/issues/799))
- README positioning, honest limitations, validated feature matrix ([GSM#800](https://github.com/Venosta-web/growspace_manager/issues/800))
- Issue templates, Discussions, contributing guide ([GSM#801](https://github.com/Venosta-web/growspace_manager/issues/801))
- Keep a stable card release inside HACS's window ([card#975](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/975))
- Safety state in the card ([card#974](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/974))

### P2: UX and performance

- Split the dialog host ([card#969](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/969)); drop luxon and trim the eager entry ([card#970](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/970)); bundle
  budget in CI ([card#971](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/971))
- Menu layering, mobile equipment strip, consistent health verdict ([card#972](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/972))
- Light-leak detection ([GSM#794](https://github.com/Venosta-web/growspace_manager/issues/794))
- Card-picker previews, and a dedicated irrigation card (fold into [card#972](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/972) or a
  follow-up)

### P3: advanced, only after the above

- Remaining Grow Run metrics (#677 energy, #678 VPD consistency, #679 mold
  episodes), timelines (#680), media (#681), import (#682), backdating (#670)
- Multi-zone irrigation (#544 map) once the single-zone execution layer is
  trustworthy
- Metered flow verification (#549 upgrade stage); dosing and fill hardware
- An MCP/LLM read-mostly connector following HAIS's opt-in-writes,
  no-actuation policy
- Any learning setpoint adjustment, bounded and off by default, with the
  deterministic controller authoritative

---

## Positioning

The proposed wording works *after* P0 lands and holds up:

> Growspace Manager is an open-source cultivation management system for Home
> Assistant: plant tracking from seed to cure, environmental automation,
> irrigation and crop steering, genetics, and harvest history, in one
> integration and one dashboard card.

Until the safety work and a feature matrix exist, lead with tracking,
monitoring and genetics. Describe automation as "opt-in, with documented
limits", and do not call it unattended control. Replace the quality badge with
a link to the self-assessment. Link a "Safety and limitations" page from the first screen of both
READMEs.

**Minimum before actively promoting:**

1. The P0 safety set (at least [GSM#784](https://github.com/Venosta-web/growspace_manager/issues/784), [GSM#786](https://github.com/Venosta-web/growspace_manager/issues/786), [GSM#785](https://github.com/Venosta-web/growspace_manager/issues/785), [GSM#788](https://github.com/Venosta-web/growspace_manager/issues/788), [GSM#789](https://github.com/Venosta-web/growspace_manager/issues/789), [GSM#790](https://github.com/Venosta-web/growspace_manager/issues/790), [GSM#791](https://github.com/Venosta-web/growspace_manager/issues/791), [GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783)).
2. Minified release and HACS installability ([card#968](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/968), [card#975](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/975)).
3. First growspace in the flow ([GSM#798](https://github.com/Venosta-web/growspace_manager/issues/798)).
4. README, feature matrix and limitations ([GSM#800](https://github.com/Venosta-web/growspace_manager/issues/800)).
5. Issue templates and Discussions ([GSM#801](https://github.com/Venosta-web/growspace_manager/issues/801)).
6. A commissioning guide ([GSM#799](https://github.com/Venosta-web/growspace_manager/issues/799)).

The live demo, screenshots and install buttons already exist and are good.

---

## Final question: the 5 highest-value things to build next

The goal is to make Growspace Manager the most trustworthy and complete Home
Assistant cultivation-management platform.

1. **A restart-safe, fail-safe irrigation execution layer.** Write-ahead
   in-flight record, start-up reconcile, patient OFF/ON readback, persistent
   fault latch, restored steering state and startup inhibit, persisted caps,
   and a hard runtime watchdog ([GSM#784](https://github.com/Venosta-web/growspace_manager/issues/784), [GSM#786](https://github.com/Venosta-web/growspace_manager/issues/786), [GSM#787](https://github.com/Venosta-web/growspace_manager/issues/787), [GSM#785](https://github.com/Venosta-web/growspace_manager/issues/785), [GSM#788](https://github.com/Venosta-web/growspace_manager/issues/788), [GSM#783](https://github.com/Venosta-web/growspace_manager/issues/783)).
   - *Evidence:* the Critical and High rows 1–6 in C.2 all trace to one
     assumption, that the HA process survives every cycle. HAIS demonstrates
     each countermeasure with regression tests and at least one live incident
     that motivated it.
2. **Operator safety controls and trustworthy inputs.** Master, arm and e-stop
   entities with an explicit controller state and structured reasons; a shared
   sensor-validity gate (freshness via `last_reported`, plausibility); tanks
   fail closed; climate actuators fail safe ([GSM#789](https://github.com/Venosta-web/growspace_manager/issues/789), [GSM#790](https://github.com/Venosta-web/growspace_manager/issues/790), [GSM#791](https://github.com/Venosta-web/growspace_manager/issues/791), [GSM#792](https://github.com/Venosta-web/growspace_manager/issues/792)).
   - *Evidence:* rows 7–10 and 21–23. GSM exposes no kill switch (`switch.py`
     only has notifications), while HAIS gates everything on one, and HAGR's
     most-used automations are exactly the sensor watchdog and safe-state
     sweep.
3. **Reliability evidence as a product feature.** Durable counters and a
   diagnostics download that works, an automated commissioning harness on
   `ha-dev`'s simulated equipment, and a published, dated,
   evidence-levelled feature matrix ([GSM#795](https://github.com/Venosta-web/growspace_manager/issues/795), [GSM#796](https://github.com/Venosta-web/growspace_manager/issues/796), [hub#246](https://github.com/Venosta-web/growspace_manager_workspace/issues/246), [GSM#799](https://github.com/Venosta-web/growspace_manager/issues/799), [GSM#800](https://github.com/Venosta-web/growspace_manager/issues/800)).
   - *Evidence:* diagnostics currently report `null` for every subsystem field.
     HAIS's feature matrix and audits are what let a stranger trust a
     19-star project.
4. **A Grow Run MVP.** Start → complete → attribute harvest → finalize →
   compare two runs → JSON export, with water productivity and a run-scoped
   reliability summary ([GSM#797](https://github.com/Venosta-web/growspace_manager/issues/797), #668–#676, a reduced #683).
   - *Evidence:* it is the capability no competitor has (HAIS's "runs" carry
     no yield, water productivity or genetics). It is fully specified and
     sliced, and it is blocked only by sequencing.
5. **A first-contact path that works.** Minified releases (2.0 MB → 0.89 MB
   entry), a stable card release HACS can install, the first growspace created
   by the config flow, a setup checklist with presets, a consistent health
   verdict, and issue templates and Discussions ([card#968](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/968), [card#975](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/975), [GSM#798](https://github.com/Venosta-web/growspace_manager/issues/798), [card#973](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/973), [card#972](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/972), [GSM#801](https://github.com/Venosta-web/growspace_manager/issues/801)).
   - *Evidence:* the published bundle size, HACS's release-window behaviour
     documented in the hub, the unreachable `add_growspace` step, and the
     Demo Tent's contradictory header all show a new user would hit these on
     day one.

---

## Appendix: issues created

The roadmap map is [growspace_manager_workspace#245](https://github.com/Venosta-web/growspace_manager_workspace/issues/245). Every child below is linked to it as a sub-issue, and blocked-by edges are set natively. The keys (B = backend, C = card, H = hub) are the ones this report uses.

| Key | Issue | Title |
|---|---|---|
| H0 | [growspace_manager_workspace#245](https://github.com/Venosta-web/growspace_manager_workspace/issues/245) | Roadmap: competitive hardening — safety, reliability evidence, Grow Run MVP, first contact |
| B9 | [growspace_manager#783](https://github.com/Venosta-web/growspace_manager/issues/783) | Safety: Explicit irrigation controller state, structured reasons, and a persistent fault latch |
| B1 | [growspace_manager#784](https://github.com/Venosta-web/growspace_manager/issues/784) | Safety: Reconcile and switch off irrigation outputs left on by a crash or restart mid-cycle |
| B4 | [growspace_manager#785](https://github.com/Venosta-web/growspace_manager/issues/785) | Safety: Read back pump state after every command and latch a fault on mismatch |
| B2 | [growspace_manager#786](https://github.com/Venosta-web/growspace_manager/issues/786) | Safety: Restore crop-steering state after a restart and add a startup inhibit |
| B3 | [growspace_manager#787](https://github.com/Venosta-web/growspace_manager/issues/787) | Safety: Persist daily irrigation safety counters across restarts |
| B5 | [growspace_manager#788](https://github.com/Venosta-web/growspace_manager/issues/788) | Safety: Enforce a hard maximum runtime per pump cycle and safe default caps |
| B6 | [growspace_manager#789](https://github.com/Venosta-web/growspace_manager/issues/789) | Safety: Gate control decisions on sensor freshness and plausibility |
| B7 | [growspace_manager#790](https://github.com/Venosta-web/growspace_manager/issues/790) | Safety: Fail closed when an irrigation tank level cannot be read |
| B8 | [growspace_manager#791](https://github.com/Venosta-web/growspace_manager/issues/791) | Safety: Add growspace automation, irrigation arm, and emergency stop controls |
| B10 | [growspace_manager#792](https://github.com/Venosta-web/growspace_manager/issues/792) | Safety: Fail-safe climate actuators on sensor loss and interlock humidifier with dehumidifier |
| B11 | [growspace_manager#793](https://github.com/Venosta-web/growspace_manager/issues/793) | Safety: Detect unexpected actuator state and support an explicit, audited manual override |
| B12 | [growspace_manager#794](https://github.com/Venosta-web/growspace_manager/issues/794) | Safety: Detect light leaks and grow lights on during the dark period |
| B13 | [growspace_manager#795](https://github.com/Venosta-web/growspace_manager/issues/795) | Diagnostics: Subsystem diagnostics report null for every field |
| B14 | [growspace_manager#796](https://github.com/Venosta-web/growspace_manager/issues/796) | Diagnostics: Add durable growspace reliability counters |
| B15 | [growspace_manager#797](https://github.com/Venosta-web/growspace_manager/issues/797) | Grow Runs: Define the MVP cut and re-sequence #668–#684 |
| B16 | [growspace_manager#798](https://github.com/Venosta-web/growspace_manager/issues/798) | Onboarding: The initial config flow never creates the first growspace |
| B17 | [growspace_manager#799](https://github.com/Venosta-web/growspace_manager/issues/799) | Docs: Commissioning guide, hardware fail-safe guidance, and supported hardware |
| B18 | [growspace_manager#800](https://github.com/Venosta-web/growspace_manager/issues/800) | Docs: README positioning, honest limitations, and a validated feature matrix |
| B19 | [growspace_manager#801](https://github.com/Venosta-web/growspace_manager/issues/801) | Community: Issue templates with diagnostics, Discussions, and a contributing guide |
| C1 | [lovelace-growspace-manager-card#968](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/968) | Release: Published bundles are unminified (2.0 MB entry instead of 0.89 MB) |
| C2 | [lovelace-growspace-manager-card#969](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/969) | Frontend: Split the dialog-host chunk so each dialog loads on its own |
| C3 | [lovelace-growspace-manager-card#970](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/970) | Frontend: Remove luxon and other heavyweights from the eager entry bundle |
| C4 | [lovelace-growspace-manager-card#971](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/971) | Frontend: Enforce a bundle-size budget in CI |
| C5 | [lovelace-growspace-manager-card#972](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/972) | UX: Layer the main-card actions menu, show equipment state first on mobile, and make the health verdict consistent |
| C6 | [lovelace-growspace-manager-card#973](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/973) | UX: Guided first-run setup checklist with growspace presets |
| C8 | [lovelace-growspace-manager-card#974](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/974) | Safety UI: Show controller state, faults, and emergency stop in the card |
| C9 | [lovelace-growspace-manager-card#975](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/975) | Release: Keep a stable release inside HACS's release window so new users can install the card |
| H1 | [growspace_manager_workspace#246](https://github.com/Venosta-web/growspace_manager_workspace/issues/246) | Commissioning: Automate the irrigation safety scenarios against ha-dev simulated equipment |

# Reproducible E2E environment workflow

The workspace owns one supported command for turning either an existing Home
Assistant developer instance or a newly onboarded config into the complete
Growspace Manager E2E environment:

```bash
cd ~/dev/growspace_manager_workspace
./scripts/vision build
./scripts/e2e provision
```

The build command delegates to the Vision repository's locked native-amd64 App image
pipeline. Set `GROWSPACE_VISION_SRC=/path/to/vision-worktree` to build an App branch;
set `GROWSPACE_VISION_IMAGE=<local-tag>` when starting the runtime if the pipeline used
a non-default tag.

`provision` is idempotent. It regenerates the Home Assistant package and card
setup manifest from `e2e/entity_coverage.py`, builds the selected card, recreates
Home Assistant with the selected backend and bundle, applies global settings and
all profile-owned service payloads, creates or reuses the integration entry,
growspaces, and camera config entries, re-saves every dashboard, and runs the
live preflight. A second
run performs the same verification but creates no additional growspaces,
plants, entities, devices, resources, or dashboards.

Recreating Home Assistant also starts the local Vision App and waits until its
unauthenticated health endpoint is ready. Its generated App options live in the
gitignored host file `vision-dev/options.json`, while the service is reachable only on
loopback port 8099 from the host and as `http://vision-dev:8099` from Home Assistant.

The command reads the token from `HA_ACCESS_TOKEN` or the workspace's
gitignored `.ha-token`. Run `./scripts/ha dev token` once after onboarding. It
creates the card's gitignored `tests/e2e/.env.test` from the checked-in example
when needed and writes all resolved growspace IDs and dashboard paths itself.
There is no manual entity assignment or dashboard editing step.
The separate local App bearer token is created automatically and remains stable across
restarts; `./scripts/vision token` prints it when the integration or a test needs it.

To exercise worktree code against the main runtime, run the command from the
main workspace checkout and select the paired repositories explicitly:

```bash
GROWSPACE_BACKEND=/path/to/backend-worktree \
GROWSPACE_CARD=/path/to/card-worktree \
  ./scripts/e2e provision
```

## Capability profiles

| Profile | Instances | What it demonstrates |
|---|---:|---|
| `stage` | 6 | Veg, clone, mother, flower, dry, and cure telemetry with pumps and tanks |
| `vwc` | 2 | Veg and flower Crop Steering with writable telemetry and tank guards |
| `telemetry_multi` | 1 | Independently driven plural sensors and backend aggregation |
| `irrigation_monitored` | 1 | Irrigation/drain pumps, flow, and drain-volume monitoring |
| `irrigation_tanks` | 1 | Pump-only irrigation with two tank-derived sources |
| `lighting` | 1 | Plain switch/light grow lights and automatic light-cycle tracking |
| `climate_plain` | 1 | Percentage, numeric, and binary fans plus HA humidifiers |
| `ac_infinity` | 1 | Five faithful AC Infinity port bundles and grow-light scheduling |
| `vision` | 1 | Two deterministic local-file cameras, real local Vision Analyses, and Vision Checkup scheduling |
| `source_air` | global | Writable lung-room temperature/humidity and offline outdoor weather |

The generated package currently exposes 516 contract entities: 204 sensors, 108
input booleans, 92 input numbers, 58 numbers, 38 switches, five selects, two
fans, two humidifiers, two times, two cameras, one binary sensor, one light, and
one weather entity. The generated table in [E2E.md](E2E.md) maps every concrete
family to its owning role, profile, domain, cardinality, and write behavior.

## Every dashboard is a live one

Every growspace carries the full environmental set — temperature, humidity, VPD,
CO₂, substrate temperature and moisture, power, energy and a 0-10 light index —
as free-running waveform sensors, so no dashboard opens onto an empty or flat
chart. A profile that owns irrigation hardware carries the water readings too:
feed/bulk/pore/runoff EC, pH, and whichever of flow, drain volume and tank level
its hardware truthfully measures. A profile whose *tests* drive a reading keeps a
writable `input_number` there instead — Crop Steering's substrate moisture and
tank guard, the monitored profile's flow and drain volume, the plain-climate
profile's temperature/humidity/VPD.

The five device chips are simulated the same way. Exhaust fan, circulation fan,
humidifier and grow light are 0-10 `number` entities — the numeric Fan Entity
Mode the backend's `NumberDriver` speaks and the card fixes its device axis to,
rather than a percentage or an on/off switch that would draw a flat line. The
dehumidifier stays binary, because that is how the card charts it, and cycles
rather than sitting still. Each free-runs on a waveform until something writes
it, then holds that value; `input_boolean.sim_e2e_<slug>_<device>_manual` is the
gate that records the difference. It is per *device*, not per growspace like the
telemetry gate: a test pins a growspace's readings together, but devices are
written one at a time, and a shared gate would freeze the other four the moment
one was touched. `./scripts/e2e preflight` releases every gate after exercising
the write path, so the demo keeps moving.

Profiles with faithful hardware keep it: `climate_plain` still exposes its
percentage fan, numeric fan and switch trio, and `ac_infinity` still exposes its
five real port bundles.

## What the preflight proves

`./scripts/e2e preflight` is read-mostly and can be run independently after any
developer change. It reports the owning profile and capability role for every
failure. A healthy verdict means:

- every contract entity exists in its declared domain, is available, and keeps
  its required unit, device class, and state class;
- every controllable helper or device accepts a safe no-op service call and
  remains available;
- each overview payload passes the live card bootstrap path and retains every
  sensor/device entity ID configured for that profile;
- generated growspace identities are unique, AC Infinity registry entities stay
  grouped into the correct distinct devices, and there is exactly one matching
  card resource;
- all 15 generated dashboards exist, contain one card bound to the expected
  growspace, and bootstrap in Chromium without card schema, missing-entity, or
  error-boundary failures; and
- the current Home Assistant log contains no configuration or setup failures.

The focused capability smoke set is:

```bash
./scripts/e2e smoke
```

It first submits both simulated camera JPEGs to the real authenticated Vision App and
requires analyzed 384-value embeddings. It then runs multi-sensor aggregation, both
irrigation hardware profiles, plain climate control, grow lights/light-cycle tracking,
AC Infinity ports, cameras, and source-air browser scenarios. `./scripts/e2e full` runs
every existing browser E2E spec.

Typical local runtimes are 2–4 minutes for provision plus preflight, 3–8 minutes
for the focused smoke set, and 25–45 minutes for the coordinator-heavy full
suite. Hardware speed and real coordinator polling windows dominate the latter.

## Clean reset and no-op proof

Reset is deliberately explicit because it removes Home Assistant authentication,
the local Vision App token, the database, and the storage registries:

```bash
./scripts/ha dev reset
./scripts/ha dev up
# complete Home Assistant onboarding in the browser
./scripts/ha dev token
# provision creates the Growspace Manager integration entry itself
./scripts/e2e provision
./scripts/e2e provision   # expected idempotent/no-duplicate rerun
```

For an existing developer instance, skip reset and onboarding; `provision`
patches only profile-owned Growspace Manager fields and preserves unrelated
global options and growspace configuration.

## Deliberate exclusions

This environment stays deterministic and offline. It runs the bundled local Vision App
but does not provision or call Niimbot label printing, AI conversation agents, cloud
inference, remote weather providers, notification destinations, or other credentialed
third-party services. HACS installation testing remains the separate `ha test` release
workflow on port 8124.

# End-to-end test environment

The Playwright suite in `lovelace-growspace-manager-card/tests/e2e` runs against
a **real Home Assistant instance** — the dev runtime on :8123. Three things have
to exist before it can run, and all three are reproducible from scripts.

## 1. Simulated sensors

`./scripts/gen-e2e-sensors` writes `ha-dev/packages/e2e_simulated_sensors.yaml`,
loaded via `homeassistant.packages` in `ha-dev/configuration.yaml`.

It covers exactly the entity set `tests/e2e/fixtures/e2e-setup.ts` wires
(`buildSensors`), for all 8 e2e growspaces:

| | Entities | Notes |
|---|---|---|
| Stage growspaces (veg, clone, mother, flower, dry, cure) | 96 `sensor.e2e_<slug>_<signal>` | trigger-based template sensors, recomputed every 30 s |
| VWC growspaces (vwc_veg, vwc_flower) | 32 `input_number.e2e_vwc_*` | specs set these directly via `input_number.set_value`, so they are **not** simulated |
| All 8 | 16 `switch.sim_e2e_<slug>_{irrigation,drain}_pump` | template switches backed by `input_boolean`, so specs can toggle them |

Waveforms are a pure function of `now()` — a sine between a per-signal low/high
over a per-signal period, with a 10-minute phase offset per growspace so the
spaces do not move in lockstep. Being time-derived, they are reproducible: the
same clock gives the same reading.

`energy` is the exception — it is `total_increasing` and must never decrease, so
it is a daily ramp rather than a sine.

Signals: temperature, humidity, vpd, co2, feed_ec, bulk_ec, pore_ec, runoff_ec,
ph, substrate_temperature, substrate_moisture, power, energy, drain_volume,
irrigation_flow, irrigation_tank.

```bash
./scripts/gen-e2e-sensors && ./scripts/ha dev restart
```

> Pumps must be declared under the `template:` key. The legacy
> `switch: - platform: template` form is rejected by current HA:
> *"Configuring the template integration under the switch platform key is not
> supported."*

## 2. Growspaces

`tests/e2e/fixtures/e2e-setup.ts` creates the 8 growspaces, places an anchor
plant in each, links the sensors above, and writes the resulting IDs back into
`tests/e2e/.env.test`. It is idempotent.

The script mixes ESM `import` with CommonJS `__dirname`, so it only runs under a
CJS transpiler. Neither `ts-node` nor `tsx` is installed; compile it instead:

```bash
cd ~/dev/lovelace-growspace-manager-card
npx --no-install tsc tests/e2e/fixtures/e2e-setup.ts --ignoreConfig \
  --module commonjs --target es2022 --esModuleInterop --skipLibCheck --outDir /tmp/e2e-build
cp /tmp/e2e-build/e2e-setup.js tests/e2e/fixtures/.e2e-setup.run.cjs
node tests/e2e/fixtures/.e2e-setup.run.cjs
rm tests/e2e/fixtures/.e2e-setup.run.cjs
```

It must be copied back beside the original because it resolves `.env.test`
relative to `__dirname`.

## 3. Dashboards

Seven of the nine specs navigate to a dashboard and wait for
`growspace-manager-card` to become visible. `TEST_*_DASHBOARD_PATH` in
`.env.test` points at these:

```bash
node scripts/gen-e2e-dashboards.cjs
```

Creates one dashboard per growspace (`/e2e-veg/0`, `/e2e-vwc-flower/0`, …), each
holding a single card bound to that growspace. Idempotent; uses the WebSocket
API because HA has no REST endpoint for `lovelace/dashboards/create`.

## Full rebuild from scratch

```bash
cd ~/dev/growspace_manager_workspace
./scripts/ha dev up
./scripts/ha dev token                       # once
./scripts/gen-e2e-sensors && ./scripts/ha dev restart
# then the e2e-setup compile-and-run above
node scripts/gen-e2e-dashboards.cjs
cd ../lovelace-growspace-manager-card && npm run test:ha
```

`.env.test` holds a long-lived token — it is gitignored and chmod 600. Never
commit it.

## Status

Verified 2026-08-22 against the generated environment:

| Spec | Result |
|---|---|
| `vwc-day-cycle` (pure-API, 12 tests) | **10 passed, 2 flaky** in 21.8 min |

Before the generators existed, all 12 failed at setup — the sensors, pumps and
input_numbers simply were not there.

### The two flaky tests

`P2 — maintenance shot fires after target reached` (veg and flower) fails on the
first attempt and passes on retry:

```
Entity switch.sim_e2e_vwc_flower_irrigation_pump expected "on" but got "off" after 90000ms
```

This is **not** caused by the simulation. VWC growspaces use `input_number`
helpers for every signal, which the spec sets directly — none of their values
come from the generated sine waves. The test waits up to 90 s for the
coordinator to schedule a maintenance shot, and that window appears to be
marginal relative to the coordinator's polling interval. Worth raising the
timeout or triggering a coordinator refresh explicitly rather than waiting.

### Runtime

The suite is slow — ~22 min for one spec — because it waits on real coordinator
cycles. Run individual specs while iterating:

```bash
npm run test:ha -- vwc-day-cycle
```

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
| `vwc-strategy` (dashboard, 3 tests) | card renders correctly; 3 fail on dialog interaction |

Before the generators existed, all of these failed at setup — the sensors,
pumps, input_numbers and dashboards simply were not there.

Full-suite run, 2026-08-22 (37 tests, 41.3 min): **17 passed, 18 failed,
2 flaky.** The dialog cause below is fixed; the remaining failures are the
three unrelated groups in "Full-suite breakdown".

### Two setup traps worth remembering

**The Lovelace resource must be registered over websocket.** A `resources:`
block under `lovelace:` is only honoured in YAML mode. This instance runs
`mode: storage`, where the block is silently ignored — the card JS never loads
and every navigating spec times out against an empty page with no error to
explain it. `gen-e2e-dashboards.cjs` handles this.

**The card config key is `default_growspace`, not `growspace_id`.** An
unrecognised key is ignored and the card auto-selects an arbitrary growspace, so
the dashboard renders fine while showing the *wrong* space — the "E2E VWC Veg"
dashboard displayed the Dry growspace. Silent and easy to miss.

With both fixed, the card renders the right growspace and displays the simulated
readings (temperature 24 °C, humidity 57.5 %, VPD 1.1 kPa, CO2 800 ppm — the
generated midpoints).

### Solved: no dialog could open — HA's service worker reloaded the page

Every dialog spec failed the same way:

```
expect(locator('config-dialog ha-dialog')).toHaveAttribute('open', '')
  element(s) not found, timeout 5000ms
```

That reads like the dialog never opened. It did. Polling the card's store every
200 ms after the click shows it open and then destroyed:

```
[poll  400ms] {"type":"CONFIG","portal":true,  "hostDefined":true}
[poll 2600ms] {"type":"CONFIG","portal":true,  "hostDefined":true}
[poll 2800ms] {"n":0}                       ← document gone
[poll 3000ms] {"type":"NONE", "portal":false, "hostDefined":false}
```

The HA frontend registers a **service worker** and calls `location.reload()` the
moment it takes control (`controllerchange`). Every Playwright context starts
with an empty SW registry, so the reload fires ~2 s into each test. Because
`growspace-manager-card` portals dialogs into `document.body`, the reload
destroys the portal *and* resets the global `activeDialog$` atom to `NONE`.

Fix: `serviceWorkers: 'block'` in `tests/e2e/playwright.config.ts`. Nothing under
test depends on the SW. `vwc-strategy` went 3 failed → **3 passed in 22 s, no
retries**.

Two earlier hypotheses were both wrong and worth not re-running: it is not a
lazy-load 404 (all 17 chunks serve 200), and it is not the 5 s expect timeout
being too short for the 351 KB code-split chunk (the dialog mounts in ~400 ms).

> **A stale `dist/` will masquerade as this.** The bundle being served was
> v1.0.31-alpha.1 while `package.json` said 1.1.6, and it shipped an unbundled
> bare specifier — `Failed to resolve module specifier "qrcode-generator"` —
> which broke the dialog-host chunk outright. Rollup emitted **no warning**. A
> fresh `rollup -c` bundles it correctly. Since `clean-dist` does
> `rmSync('dist')`, rebuilding also recreates the directory, so it needs
> `./scripts/ha dev restart` or Docker keeps serving the deleted inode.

### Full-suite breakdown

The 18 remaining failures are three groups, none of them the dialog layer:

**14 — the legacy dashboard path does not exist.** `TEST_DASHBOARD_PATH` is
`/dashboard-tesat/0`, but `gen-e2e-dashboards.cjs` only creates the eight
`e2e-*` dashboards. Every spec still on `testContext.dashboardPath` navigates to
a 404 and times out waiting for the card: `smoke` (4), `setup-dialogs` (4),
`plant-actions` (3), `insights-dialogs` (3). Either point that variable at
`e2e-veg`, or migrate those specs to a stage-specific path.

**2 — the simulated tank drains below the irrigation threshold.**
`vwc-day-cycle` veg P1/P2 wait 90 s for a pump that never fires, because the
coordinator refuses to run:

```
Irrigation skipped — tank 'Tank' is low (29.0% < 30.0%)
```

This is state drift across a long-lived dev instance, not the simulation feeding
bad values. Reset the tank level before the VWC specs.

**2 — genuine test timeouts.** `add-plant-dialog` (30 s) and
`plant-watering-round-trip` (45 s) both get *past* dialog-open and die while
filling a field or clicking a button, so they are slow rather than blocked.

`vwc-day-cycle` is pure-API — it never navigates a browser — so none of its
results are affected by the service-worker change.

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

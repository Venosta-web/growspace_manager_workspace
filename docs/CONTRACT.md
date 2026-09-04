# The backend ⇄ frontend contract

> This document governs `growspace_manager` ⇄ Lovelace card payloads. The separate,
> stateless `growspace_manager` ⇄ Growspace Vision HTTP boundary is specified by the
> versioned [Growspace Vision contract][vision-contract], and the optional
> `growspace_manager_tc` ⇄ card WebSocket boundary by the [TC contract][tc-contract]
> — including how the card detects whether TC is installed at all.

[vision-contract]: https://github.com/Venosta-web/growspace_manager_vision/tree/main/contracts/growspace-vision/v1
[tc-contract]: https://github.com/Venosta-web/growspace_manager_tc/blob/main/docs/websocket-contract.md

The integration and the card are separate repos with separate release cycles,
but they are one product. Everything they agree on crosses this boundary:

```
growspace_manager (Python)                 lovelace card (TypeScript)
──────────────────────────                 ──────────────────────────
services.yaml           ──────────────▶    services/api/*.ts  (callService)
websocket_api handlers  ──────────────▶    slices/*/schema.ts + index.ts
entity ids / attributes ──────────────▶    store atoms
response payloads       ──────────────▶    owning slice schema (zod)
```

> **Upstream already has tooling for this.** The card ships
> `npm run test:contract-fixture` (`vitest.contract.config.ts`), and the backend
> has `tests/contract/`. Use those rather than inventing a parallel mechanism —
> this document explains the *discipline*, not a separate system.

## Why this file exists

An agent working in one repo cannot see the other's tests. Without an explicit
contract, the failure mode is silent: the backend renames a payload field, every
Python test still passes, and the card breaks at runtime in the browser with a
zod validation error nobody sees until you open the dashboard.

## The rule

**A payload change is one feature across both repos**, in this order:

1. **Backend implementation** — the handler/service change.
2. **Backend test** — asserts the new shape.
3. **Contract fixture** — the recorded payload, shared by both sides.
4. **Frontend schema** — `src/schemas/api-schema.ts` updated to match.
5. **Frontend implementation + test** — consumes the new shape.

The backend contract must exist first; the card cannot invent a service or wire
shape. A breaking producer cutover may need three releases: additive backend
contract and fixtures, a [backward-safe card change](#backward-safe-card-change),
then backend activation. That still follows the five steps above—the card implements
an already-tested backend contract—but avoids a window in which the installed card
cannot display newly produced data.

Use a matched worktree pair so both sides are on the same branch:

```bash
~/dev/growspace_manager_workspace/scripts/feature new <name>
cd ~/dev/growspace_manager_workspace/worktrees/<name>/backend
claude --add-dir ../card
```

The backend branch must start at fresh **`origin/prerelease`**, and the card branch at
fresh **`origin/dev`**, following each product repo's canonical `AGENTS.md`. Verify
both after the helper runs; a fallback branch selected by workspace tooling does not
override a target repo's base-branch rule.

### Backward-safe card change

A card phase may release before a backend behaviour cutover only when it treats the
new command and every new field as optional, capability-detects them, falls back to
the released wire shape, and proves that fallback against the latest published
backend fixture. Passing only against the leading backend branch is not proof.

## Vision Checkup V1 migration

The accepted result shape, compatibility policy and complete file-level plan live in
[`growspace_manager` ADR 0043][vision-migration-adr]. The load-bearing sequence is:

1. **Additive backend foundation:** add `vision_models.py` and `vision_client.py`;
   implement the evidence store and pure comparison/fusion seams; add cached service
   status and integration-wide automatic/manual connection configuration; register
   `get_vision_status` and `get_vision_history_v2`; keep the cloud-era producer live.
2. **Backend executable contract:** generate
   `vision_status_response.json`, `vision_history_response.json` and
   `trigger_vision_checkup_response.json` beside `growspace_payload.json`. History is
   a `result_schema` union of `evidence_v1` Vision Checkup envelopes and
   `legacy_cloud_v1` rows; trigger keeps its legacy keys and adds the V1 envelope.
3. **Dual-contract card:** update `src/slices/camera/schema.ts` and `index.ts`, then
   extend `.github/workflows/contract-fixture.yml` and
   `tests/contract/contract-fixture.test.ts` to validate every fixture against both
   the current backend `prerelease` branch and latest published backend release. The
   card calls V1 when available and otherwise preserves the legacy path.
4. **Card presentation and configuration:** carry read-only status/model data through
   `vision-tab.viewmodel.ts` and `config-vision-tab.ts`; replace the severity-only
   projection in `snapshots-dialog.viewmodel.ts` and `snapshots-dialog.ts` with
   capture evidence plus a visibly marked legacy branch. Endpoint and token never
   cross into the card.
5. **Backend cutover:** refactor `vision_checkup_scheduler.py` to persist a checkup,
   fan out one local analysis per camera, compare, fuse, optionally explain and store.
   Stop appending the legacy list and stop the cloud severity notification path. An
   unavailable local service never falls back to the cloud-only producer.

`limit` and `total` count checkups, not captures. Existing legacy rows remain frozen
and readable but never participate in V1 baselines, fusion, trends or training. The
three-phase sequence is mandatory: cutting the producer over in step 1 would make new
results invisible to the released card.

[vision-migration-adr]: https://github.com/Venosta-web/growspace_manager/blob/prerelease/docs/adr/0043-vision-checkups-migrate-through-versioned-capture-contracts.md

### Vision V1 quality gate

Run `./scripts/check vision fast` from this workspace to execute the complete V1
handoff: the Vision-owned OpenAPI fixtures, byte-for-byte backend vendoring, the
backend's strict parser, the card's Zod schemas against the current backend fixtures,
and the simulated development runtime. `./scripts/check vision full` additionally
runs the whole Vision repository suite and builds and smokes both App architectures
with Docker networking disabled.

CI keeps ownership local. Growspace Vision runs its service suite and both locked App
images; Growspace Manager checks its vendored fixtures against Vision `main`; and the
card checks current `prerelease` fixtures for completeness plus the latest published
backend release for backward safety. A missing current fixture is an error and never
falls back to an older bootstrap commit.

## Breaking-change checklist

Before merging anything that touches the boundary, confirm:

- [ ] Entity IDs unchanged, or migration provided (users have automations on them)
- [ ] Service schema is backward compatible, or the card's minimum backend
      version is bumped in `hacs.json`
- [ ] `api-schema.ts` accepts both old and new shapes during a transition, or
      both repos release together
- [ ] The zod schema was actually updated — a missing field silently becomes
      `undefined` and fails at render time, not at parse time
- [ ] Verified in the browser at `http://localhost:8123`, not just in unit tests

## Where the seams are

| Seam | Backend | Frontend |
|---|---|---|
| Services | `custom_components/growspace_manager/services.yaml` | owning slice action |
| WebSocket | `custom_components/growspace_manager/websocket/` | owning slice `index.ts` |
| Validation | contract fixtures | owning slice `schema.ts` |
| State | coordinator → entities | nanostores atoms |

## Verifying the live contract

The dev instance exposes both sides at once. With `./scripts/ha dev up` running:

```bash
# list every service the integration actually registered
curl -s -H "Authorization: Bearer $(cat ~/dev/growspace_manager_workspace/.ha-token)" \
     http://localhost:8123/api/services | python3 -m json.tool \
  | grep -A2 growspace_manager
```

If a service the card calls is missing from that list, the contract is broken —
regardless of what the tests say.

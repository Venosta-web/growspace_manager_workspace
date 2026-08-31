# The backend ⇄ frontend contract

> This document governs `growspace_manager` ⇄ Lovelace card payloads. The separate,
> stateless `growspace_manager` ⇄ Growspace Vision HTTP boundary is specified by the
> versioned [Growspace Vision contract](../contracts/growspace-vision/v1/README.md).

The integration and the card are separate repos with separate release cycles,
but they are one product. Everything they agree on crosses this boundary:

```
growspace_manager (Python)                 lovelace card (TypeScript)
──────────────────────────                 ──────────────────────────
services.yaml           ──────────────▶    services/api/*.ts  (callService)
websocket_api handlers  ──────────────▶    services/api/*.ts  (callWS)
entity ids / attributes ──────────────▶    store atoms
response payloads       ──────────────▶    schemas/api-schema.ts  (zod)
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

The backend must land first; the card cannot call a service that does not exist.

Use a matched worktree pair so both sides are on the same branch:

```bash
~/dev/growspace_manager_workspace/scripts/feature new <name>
cd ~/dev/growspace_manager_workspace/worktrees/<name>/backend
claude --add-dir ../card
```

Worktrees branch from **`origin/prerelease`** by default — upstream's stated
base for architecture and refactor work. Override with `BASE=main`. The card
repo has no `prerelease`, so it falls back to `origin/main` automatically.

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
| Services | `custom_components/growspace_manager/services.yaml` | `src/services/api/` |
| WebSocket | `websocket_api` handlers | `BaseAPI.callWS` |
| Validation | — | `src/schemas/api-schema.ts` (~187 schemas) |
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

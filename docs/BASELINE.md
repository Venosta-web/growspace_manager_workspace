# Quality baseline — 2026-08-22

Captured the day the workspace was set up, **before** any code cleanup, so you
and your agents can tell "I broke this" from "this was already red".

`./scripts/check all fast` **fails today.** That is accurate, not a bug in the
script — the gate reports what is actually true about the repos.

## Backend — `growspace_manager`

| Stage | Result |
|---|---|
| `ruff check` | **82 errors** (7 auto-fixable, 46 more with `--unsafe-fixes`) |
| `ruff format --check` | **6 files** would be reformatted (93 clean) |
| `mypy` | **257 errors in 38 files** (99 files checked) |
| `pytest` | **1 failed, 2 errors, 1968 passed** in ~45 s |

Known failures:

```
FAILED tests/integration/test_storage_manager_coverage.py::test_storage_backup_corrupt_data_exception
ERROR  tests/services/test_notification_batching.py::test_batching_trigger
ERROR  tests/services/test_nutrient_deduction_integration.py::test_water_growspace_per_plant_compatibility
```

> **mypy was previously reporting nothing useful.** `mypy.ini` was a verbatim
> copy of HA Core's hassfest-generated config pinned to `python_version = 3.13`,
> so mypy aborted on a syntax error inside HA's own site-packages before
> checking any project code. Fixing the pin to 3.14 is what surfaced these 257
> errors — they are pre-existing, not new.

## Frontend — `lovelace-growspace-manager-card`

| Stage | Result |
|---|---|
| `eslint` | **188 errors, 549 warnings** (53 errors auto-fixable) |
| `tsc --noEmit` | **clean** ✅ |
| `vitest` | not captured — runs real Chromium, measure on a quiet machine |

## Suggested order of attack

1. `ruff format` + `ruff check --fix` on the backend — mechanical, zero risk.
2. `eslint --fix` on the card — 53 of 188 errors disappear.
3. The 3 failing backend tests — real signal, small surface.
4. mypy's 257 errors — grind these down per-module; don't try it in one pass.

Re-measure any time:

```bash
./scripts/check all full
```

Update this file when the numbers move, so it stays a useful reference point.

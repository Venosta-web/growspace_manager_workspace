# Quality baseline

Measured **2026-08-22**, against `origin/main`:

- `growspace_manager` @ `29395aa`
- `lovelace-growspace-manager-card` @ `a39faf67`

Re-measure with `./scripts/check all full`. Update this file when numbers move.

> An earlier version of this file recorded far worse numbers (255 mypy errors,
> 3 failing tests, 188 eslint errors). Those were measured against a local
> checkout that turned out to be **699 commits behind** origin/main. They were
> never representative. The figures below are from current upstream code.

## Backend — `growspace_manager`

| Stage | Scope | Result |
|---|---|---|
| `ruff check` | whole repo (`.`) | **All checks passed** ✅ (after `a9cf92e`) |
| `ruff format --check` | `custom_components/ tests/` (614 files) | **all formatted** ✅ |
| `mypy --follow-imports=silent` | `custom_components/` (206 files) | **no issues** ✅ |
| `pytest` | whole suite | **5091 passed** in ~113 s ✅ |

`./scripts/check backend fast` passes. Scopes mirror `.pre-commit-config.yaml`,
so a green run here means the hooks will not reject the commit.

> The formatting drift (140 files across `custom_components/` and `tests/`) was
> cleared by `50160f6` on branch `chore/ruff-format`. All 140 were verified
> AST-identical to their previous versions — mechanical reformat, zero
> semantic change.

### Repo-wide lint

`scratch_mock_test.py` — a tracked 1 KB ad-hoc script for probing AsyncMock
coroutine garbage collection, committed to the repo root by accident in
`fd4d962` — was the **only** source of ruff errors repo-wide: 6 of them
(`T201` print ×3, `D100`, `D103`, `SIM105`). It is referenced nowhere and
pytest never collected it (`testpaths = tests`).

Removed on branch `feature/rm-scratch-file` (`a9cf92e`, based on `origin/main`).
With it gone, `ruff check .` passes across the whole repository, so
`scripts/check` now runs `ruff check .` with no scoping — matching upstream's
`ruff-check` hook, which has no `files:` filter.

> Until that branch merges, `./scripts/check backend fast` reports 6 ruff errors
> on any branch that still contains the file. That is the gate being honest, not
> a regression. Verified: clean on `feature/rm-scratch-file`, 6 errors on
> `chore/ruff-format`.

The file still exists on `origin/main` and `origin/prerelease`; `origin/dev`
never had it.

### Committing: you must be in a worktree

Upstream's pytest and mypy hooks are declared as `entry: ../../.venv/bin/pytest`.
That path resolves to the repo venv **only** from `<repo>/.worktrees/<name>`.
From the main checkout it resolves to `~/dev/.venv`, which does not exist, so
both hooks fail and the commit is rejected. `no-commit-to-branch` additionally
blocks `main` and `dev`.

```bash
./scripts/feature new <name>     # creates the worktree in the right place
```

Verified: hooks from a generated worktree give pytest Passed / mypy Passed;
from the main checkout, both Failed.

> Do **not** run `pre-commit run --all-files` casually — prettier and
> `ruff --fix` rewrite files (43 in one observed run). Normal commits only run
> hooks on staged files.

## Frontend — `lovelace-growspace-manager-card`

| Stage | Result |
|---|---|
| `eslint` | **95 problems, 0 errors** (warnings only) ✅ |
| `typecheck` (`tsc --noEmit`) | **clean** ✅ |
| `test` (unit, real Chromium) | **7261 passed / 355 files** in ~70 s ✅ |

`./scripts/check card fast` passes.

### Playwright on Ubuntu 26.04

`npx playwright install chromium` fails outright here:

```
ERROR: Playwright does not support chromium on ubuntu26.04-x64
```

Playwright gates downloads on a known distro list, and its newest Linux target
is `ubuntu24.04`. The gate is the only problem — the binaries it fetches are
distro-independent Chrome-for-Testing builds (`chrome-linux64.zip`). Override
the host-platform check:

```bash
cd ~/dev/lovelace-growspace-manager-card
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
```

Installed and verified: `chromium-1223`, `chromium_headless_shell-1223`,
`ffmpeg-1011`; `chrome --version` reports Chrome for Testing 148.0.7778.96 and
runs natively on 26.04. **Re-run this after any Playwright major/minor bump** —
browser builds are pinned per Playwright version.

### After a `git reset --hard`, reinstall node deps

The reset moved `package.json` forward 38 commits but left `node_modules`
behind (Playwright 1.57 vs `^1.60.0`, vitest 4.1.7 vs `^4.1.8`). That mismatch
was also producing a phantom eslint error and TS errors in
`src/adapters/growspace-adapter.ts` — both vanished after `npm install`.
If lint or typecheck reports something that looks impossible, check dependency
drift before believing it.

## Build output — code splitting

Upstream now **code-splits**: `rollup.config.js` emits a thin entry
`dist/growspace-manager-card.js` (~1 KB) plus ~16 lazy chunks
`growspace-[name]-[hash].js`. The workspace mounts the whole `dist/` directory
into Home Assistant, so chunks resolve correctly — a single-file mount would
break the card entirely. Verified: entry HTTP 200, chunks HTTP 200.

`dist/*.js` and `dist/*.js.map` are **git-ignored** upstream as of
`a39faf67 chore(release): untrack built bundle`. Do not commit built output.

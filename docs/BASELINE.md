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

| Stage | Result |
|---|---|
| `ruff check` | **All checks passed** ✅ |
| `ruff format --check` | **28 files** would be reformatted ⚠️ |
| `mypy` | **Success — no issues in 205 source files** ✅ |
| `pytest` | **5091 passed**, 0 failed, in ~113 s ✅ |

The only red is formatting. Pre-commit's `ruff-format` hook covers the same
scope (`^(custom_components|tests)/.+\.(py|pyi)$`) but only runs on changed
files, so untouched files drifted. Fix in one shot when you want it:

```bash
cd ~/dev/growspace_manager && .venv/bin/python -m ruff format custom_components/ tests/
```

That is a 28-file diff — worth its own commit, not folded into feature work.

## Frontend — `lovelace-growspace-manager-card`

| Stage | Result |
|---|---|
| `eslint` | **96 problems** (1 error, 95 warnings) ⚠️ |
| `typecheck` (`tsc --noEmit`) | **errors present** ⚠️ |
| `test` (unit) | **BLOCKED — no browser installed** ❌ |

### The blocker

Unit tests run in real Chromium through `@vitest/browser-playwright`. The
browser binary is missing:

```
Executable doesn't exist at /home/maxi/.cache/ms-playwright/
  chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell
```

`~/.cache/ms-playwright/` exists but is empty — no browsers have ever been
installed for this Playwright version (`^1.60.0`). Until that is fixed, `npm
test`, `npm run test:coverage` and the e2e suite cannot run at all.

```bash
cd ~/dev/lovelace-growspace-manager-card && npx playwright install chromium
```

## Build output — code splitting

Upstream now **code-splits**: `rollup.config.js` emits a thin entry
`dist/growspace-manager-card.js` (~1 KB) plus ~16 lazy chunks
`growspace-[name]-[hash].js`. The workspace mounts the whole `dist/` directory
into Home Assistant, so chunks resolve correctly — a single-file mount would
break the card entirely. Verified: entry HTTP 200, chunks HTTP 200.

`dist/*.js` and `dist/*.js.map` are **git-ignored** upstream as of
`a39faf67 chore(release): untrack built bundle`. Do not commit built output.

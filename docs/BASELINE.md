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

# AGENTS.md — Growspace workspace hub

You are in the **workspace hub**, not in a product repo. This directory holds the
development runtime, the multi-root VS Code workspace, and the shared scripts.
The actual code lives in two sibling repositories.

## Map

```
~/dev/
├── growspace_manager/               Python — HA custom integration   (git repo)
├── lovelace-growspace-manager-card/ Lit/TS — Lovelace card           (git repo)
├── core/                            HA Core checkout — REFERENCE ONLY, never edit
└── growspace_manager_workspace/     ← you are here                   (the hub)
    ├── growspace.code-workspace     multi-root VS Code workspace
    ├── docker-compose.yml           HA dev + release-test runtimes
    ├── ha-dev/                      dev instance config — ON THE HOST
    ├── ha-test/                     clean instance for HACS verification
    ├── scripts/{ha,check,feature}
    └── worktrees/                   matched cross-repo agent worktrees
```

**Each repo has its own upstream-maintained `AGENTS.md`.** Read the one for the
repo you are changing — it is canonical and it wins over anything here. Notably
it documents conventions this hub must respect:

- The main checkout is **shared by concurrent agent sessions**; a pre-commit
  guard (`no-commit-to-branch`) rejects commits made on protected branches.
  Work in a worktree.
- Architecture/refactor work integrates on **`prerelease`**, not `main`.
- **Never** use a HA-core venv — its `syrupy` is newer than the one
  `pytest-homeassistant-custom-component` pins and every test dies at collection.

## Core design rule

**Nothing lives only inside a container.** Every path Home Assistant reads or
writes is a host bind mount. `ha-dev/.storage/`, `ha-dev/home-assistant.log` and
the SQLite DB are plain files you can read, grep and delete directly. If you find
yourself running `docker exec` to look at a file, you are doing it wrong — read
the host path instead.

## Runtime

```bash
./scripts/ha dev up        # http://localhost:8123 — live-mounted source
./scripts/ha dev logs      # follow
./scripts/ha dev reload    # reload growspace_manager without restarting HA
./scripts/ha dev restart   # full restart (manifest/import changes need this)
./scripts/ha dev reset     # wipe .storage + DB, back to onboarding
./scripts/ha test up       # http://localhost:8124 — virgin config, HACS test
```

The dev instance mounts:

| Host | Container |
|---|---|
| `../growspace_manager/custom_components/growspace_manager` | `/config/custom_components/growspace_manager` |
| `../lovelace-growspace-manager-card/dist` | `/config/www/community/lovelace-growspace-manager-card` (ro) |
| `./ha-dev` | `/config` |

The card is **code-split**: a thin `growspace-manager-card.js` entry plus ~16
lazy `growspace-[name]-[hash].js` chunks. The whole `dist/` directory is
mounted so chunk imports resolve; never mount just the entry file.

> **After any `git reset --hard`, branch switch, or build that recreates `dist/`, run
> `./scripts/ha dev restart`.** The command recreates the container so Docker
> remounts the current directory inode. Root-level card e2e commands enforce this
> automatically and refuse to start Playwright against a stale served bundle.

So: edit Python → `./scripts/ha dev reload`. Edit TypeScript → `npm run watch`
in the card repo → hard-refresh the browser. **Neither needs HACS.** HACS is the
release test at :8124, not the dev loop.

## Validation

```bash
./scripts/check backend fast|full
./scripts/check card    fast|full
./scripts/check all     fast|full
```

These are the exact commands to run — do not improvise venv paths or test flags.

## Parallel agents — and why you cannot commit from the main checkout

Never run two agents in the same checkout. Create a matched worktree pair:

```bash
./scripts/feature new irrigation-v2      # both repos, branch feature/irrigation-v2
./scripts/feature list
./scripts/feature rm  irrigation-v2
```

For a Codex-managed worktree of this hub, select the checked-in **growspace
workspace** local environment instead. It creates the matched pair during
setup; use `./scripts/codex-worktree path` to locate it and
`./scripts/codex-worktree check ...` to validate it. Do not create a second
pair with `scripts/feature` in the same task. Card browser tests use an exact
localhost/loopback allowlist. E2E credentials are never copied automatically;
place the ignored `tests/e2e/.env.test` in the managed card worktree explicitly
when E2E is required.

**The backend worktree must live at `growspace_manager/.worktrees/<name>`.**
Upstream's pre-commit hooks are declared as `entry: ../../.venv/bin/pytest`
(and the same for mypy). That relative path resolves to the repo venv only from
exactly that depth. From the main checkout it resolves to `~/dev/.venv`, which
does not exist, so the pytest and mypy hooks fail and **every commit from the
main checkout is rejected**. This is the "worktree guard" upstream's AGENTS.md
refers to; it is a side effect of the path, not a separate check.

`./scripts/feature` creates it in the right place and symlinks it to
`worktrees/<name>/backend` for the paired view. Run backend tests from a
worktree as `../../.venv/bin/pytest tests/ -q`.

The card has no such constraint — its hooks are `npm run ...` — but its
worktree gets a `node_modules` symlink so checks run without a reinstall.

`no-commit-to-branch` additionally blocks `main` and `dev` outright.

## Cross-repo contract

The two repos are coupled through HA services, WebSocket commands, and the zod
schemas in `card/src/schemas/api-schema.ts`. A change to any payload shape is
**one logical feature across both repos**:

```
backend impl → backend test → contract fixture → card impl → card test
```

The backend side must land first — the card cannot call a service that does not
exist. See `docs/CONTRACT.md`.

## Don't

- **Don't edit `../core/`.** It is a 3.7 GB read-only reference checkout.
- **Don't read the card's built bundles** (`dist/*.js`, root
  `growspace-manager-card.js`, `*.map`) — millions of generated tokens. Grep
  `src/` instead.
- **Don't commit `ha-dev/.storage/`** or anything else HA generates; it is
  git-ignored and contains your tokens.
- **Don't commit the card's build output.** `dist/*.js` is git-ignored upstream
  as of `a39faf67 chore(release): untrack built bundle`.
- **Don't work from a stale checkout.** `git fetch` and compare against
  `origin/main` before concluding anything is broken — these repos move fast.
- **Don't start a second thing on :8123.** `./scripts/ha dev up` refuses rather
  than silently losing the race.

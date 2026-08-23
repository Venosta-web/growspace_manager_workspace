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

> **After any `git reset --hard`, branch switch, or build that recreates `dist/`,
> run `./scripts/ha dev restart`.** Docker bind-mounts by inode, and rollup
> deletes and recreates `dist/`, so without this the container keeps serving the
> old, deleted directory and every chunk 404s. `restart` force-recreates the
> container, which is what re-resolves the path.
>
> **Nothing enforces this for you.** `npm run test:e2e` in the card repo is
> `npm run build && npm run test:ha` — it recreates `dist/` and then runs
> Playwright without remounting, so it validates whatever HA was already
> serving. Restart between the build and the run. The symptom when you forget is
> not a build error: every dashboard spec times out on `growspace-manager-card`
> never becoming visible.
>
> `./scripts/codex-worktree card-e2e` is the exception — it builds, remounts the
> shared runtime at its own `dist/` via `GROWSPACE_CARD_DIST`, waits for the
> bundle to serve, and hands the runtime back on exit.

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

`check` prints the two checkouts it resolved before it runs anything, because it
is not necessarily validating the tree you are sitting in. It takes
`GROWSPACE_BACKEND` / `GROWSPACE_CARD` when set — `codex-worktree check` sets
both — and otherwise falls back to the **main** checkouts. Run `./scripts/check
card` from a `scripts/feature` worktree and, without that variable, it reports
green about the main checkout; it now says so in the header and prints the
invocation that would check yours instead.

A card check also refuses, before any stage, if the checkout it resolved has a
**shared dependency link** whose `package-lock.json` no longer matches the
checkout it borrows from. That agreement is established at worktree setup and
nothing else re-checks it, so a drifted worktree would otherwise test green
against a dependency tree matching nobody's lockfile. The fix it prints is
`rm node_modules && npm ci` — the check refuses and never re-links, because
whether one checkout may back another is hub setup's decision, not a validation
command's.

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

The card has no such constraint — its hooks are `npm run ...` — but how it gets
`node_modules` depends on who created the worktree. The vocabulary, used
consistently across both repos:

- **Hub-managed worktree** — created by `scripts/feature` or
  `scripts/codex-worktree`. Gets a **shared dependency link** by default, subject
  to the guard below.
- **Standalone worktree** — created by hand with `git worktree add`. Shares
  nothing; it needs a **private install**.
- **Shared dependency link** — the single symlink from a worktree's
  `node_modules` to the main card checkout's. One link, never a per-file farm.
- **Private install** — a real `node_modules` directory in the worktree, from its
  own `npm ci`. Setup validates one it finds and never replaces it with a link.

`scripts/card-node-modules` is the one implementation, and it links only while
the two `package-lock.json` hashes match **and** an offline `npm ci --dry-run`
reports a zero add/change/remove plan. On drift it removes the link and requires
a private `npm ci`. Writable Vite/test caches are checkout-local under `.cache/`,
never inside the shared tree.

Never run dependency-mutating npm commands through a shared link. `npm ci` and
`npm install` merely convert the worktree to a private install, but `npm rebuild`,
`patch-package`, and dependency postinstalls **write through into the main
checkout's tree**, and no npm hook can catch them. That risk is accepted, not
guarded — see [`docs/adr/0001-guarded-shared-card-dependencies.md`](docs/adr/0001-guarded-shared-card-dependencies.md)
for the decision, the measurements, and the hub-heals/card-detects boundary.

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
- **Don't drive the runtime from a hub worktree.** `docker-compose.yml` resolves
  `ha-dev/` and both source mounts *relative to itself*, and a worktree yields
  the same Compose project and container names — so it does not start a second
  stack the port guard would catch, it recreates the shared one against that
  worktree's unbuilt siblings and empty config. `./scripts/ha` refuses; to serve
  a worktree's bundle, run it from the main checkout with `GROWSPACE_CARD_DIST`.

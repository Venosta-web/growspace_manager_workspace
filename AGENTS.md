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

**Each repo has its own `AGENTS.md`.** Read the one for the repo you are changing;
it is canonical for that repo's commands and rules.

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

## Parallel agents

Never run two agents in the same checkout. Create a matched worktree pair:

```bash
./scripts/feature new irrigation-v2      # both repos, branch feature/irrigation-v2
./scripts/feature list
./scripts/feature rm  irrigation-v2
```

`node_modules` and `.venv` are symlinked into new worktrees, so checks run
immediately without a reinstall.

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
- **Don't start a second thing on :8123.** `./scripts/ha dev up` refuses rather
  than silently losing the race.

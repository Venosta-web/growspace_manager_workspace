# Growspace development workspace

Hub for developing the **growspace_manager** Home Assistant integration and its
**Lovelace card** together, with a real HA runtime whose files live on the host.

```
~/dev/
├── growspace_manager/               integration   (git repo)
├── lovelace-growspace-manager-card/ card          (git repo)
├── core/                            HA Core — reference only
└── growspace_manager_workspace/     ← this hub
```

## Open the workspace

```bash
code ~/dev/growspace_manager_workspace/growspace.code-workspace
```

One window, four roots, four independent git histories.

## Start the dev loop

```bash
cd ~/dev/growspace_manager_workspace
./scripts/ha dev up                                  # http://localhost:8123
cd ../lovelace-growspace-manager-card && npm run watch
```

- **Python change** → `./scripts/ha dev reload` (or `restart` for manifest/imports)
- **TypeScript change** → rollup rebuilds `dist/` → hard-refresh the browser

Neither path goes through HACS. HACS is verified separately, before release.

## The runtimes

| | URL | Config on host | Source mounted? | Purpose |
|---|---|---|---|---|
| **dev** | http://localhost:8123 | `ha-dev/` | yes, both repos | daily development |
| **test** | http://localhost:8124 | `ha-test/` | **no** | clean HACS install check |

Start the release-test instance with `./scripts/ha test up`.

## Checks

```bash
./scripts/check all fast     # ruff+mypy+pytest, eslint+tsc+vitest
./scripts/check all full     # + coverage + production build
```

## Parallel agent work

```bash
./scripts/feature new irrigation-v2     # matched worktrees in BOTH repos
./scripts/feature list
./scripts/feature rm irrigation-v2
```

Then run the agent with both roots in context:

```bash
cd worktrees/irrigation-v2/backend && claude --add-dir ../card
```

Never run two agents in the same checkout.

### Codex managed worktrees

Select the checked-in **growspace workspace** local environment when starting a
Codex worktree task. Its setup creates an isolated matched pair on the same
`codex/codex-<id>` branch, using `prerelease` for the backend and `dev` for the
card. The pair and its mutable caches stay under `worktrees/codex-<id>/`; the
existing backend venv and card `node_modules` are reused through links rather
than copied or reinstalled.

The environment actions run the normal checks against the matched pair. From a
terminal, the equivalent commands are:

```bash
./scripts/codex-worktree status
./scripts/codex-worktree precommit
./scripts/codex-worktree check backend fast
./scripts/codex-worktree card-precommit
./scripts/codex-worktree card-e2e
./scripts/codex-worktree check all full
```

Card browser tests receive an exact localhost/loopback allowlist for their
local Vitest server and Home Assistant. E2E credentials are not copied into
managed worktrees: copy the ignored `tests/e2e/.env.test` into the paired card
worktree explicitly before running the E2E action.

## First-time setup

1. `./scripts/ha dev up`, then open http://localhost:8123 and complete onboarding.
2. Add the integration: Settings → Devices & Services → Add → *Growspace Manager*.
3. `cd ../lovelace-growspace-manager-card && npm run build` (populates `dist/`).
4. `./scripts/ha dev token` — paste a long-lived token so `./scripts/ha dev reload`
   and the e2e suite work. Stored at `.ha-token` (git-ignored, chmod 600).
5. For Playwright e2e: copy that token into
   `../lovelace-growspace-manager-card/tests/e2e/.env.test` with
   `HA_BASE_URL=http://localhost:8123`.

## Notes

- Everything HA writes is a plain file under `ha-dev/` — read
  `ha-dev/home-assistant.log` directly instead of `docker exec`.
- `./scripts/ha dev reset` wipes `.storage/` and the DB back to onboarding while
  keeping `configuration.yaml`.
- Agent instructions: `AGENTS.md` here and in each repo, imported by `CLAUDE.md`.
  Change `AGENTS.md`, never the copy.

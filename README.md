# Growspace development workspace

Cross-repository hub for the **growspace_manager** Home Assistant integration, its
optional **Tissue Culture companion**, **Lovelace card**, and **Growspace Vision**
service, with a real HA runtime whose files live on the host.

```
~/dev/
├── growspace_manager/               integration   (git repo)
├── lovelace-growspace-manager-card/ card          (git repo)
├── growspace_manager_vision/        vision service (git repo)
├── growspace_manager_tc/            TC integration  (git repo)
├── core/                            HA Core — reference only
└── growspace_manager_workspace/     ← this hub
```

## Open the workspace

```bash
code ~/dev/growspace_manager_workspace/growspace.code-workspace
```

One window, six roots, six independent git histories. The workspace hub remains the
cross-repository runtime, roadmap, and issue tracker; product artifacts live in their
own repositories.

## Start the dev loop

```bash
cd ~/dev/growspace_manager_workspace
./scripts/ha dev up                                  # http://localhost:8123
cd ../lovelace-growspace-manager-card && npm run watch
```

- **Python change** → `./scripts/ha dev reload` (or `restart` for manifest/imports)
- **TypeScript change** → rollup rebuilds `dist/` → hard-refresh the browser
- **Still seeing the old bundle?** → `./scripts/ha dev restart`

Neither path goes through HACS. HACS is verified separately, before release.

That last one is not superstition. HA serves `/local/` with a 31-day
`Cache-Control` behind a service worker `Ctrl+Shift+R` does not bypass, so a
rebuild can be correct on disk and invisible in the browser. `up` and `restart`
stamp the registered card resource with a content hash of the built entry
(`…/growspace-manager-card.js?v=b57c822473a4`), which misses both caches at once
and leaves an unchanged bundle alone. See `scripts/stamp-card-resource.cjs`.

## The runtimes

| | URL | Config on host | Source mounted? | Purpose |
|---|---|---|---|---|
| **dev** | http://localhost:8123 | `ha-dev/` | backend + card | daily development |
| **test** | http://localhost:8124 | `ha-test/` | **no** | clean HACS install check |

Start the release-test instance with `./scripts/ha test up`.

A user's copy of the card comes from HACS, and HACS never cleans the directory
it downloads into — an update writes the new release's files alongside the old
ones. `./scripts/card-hacs-update <from-tag> <to-tag>` reproduces that on the
test instance: it downloads the first tag through HACS, updates to the second,
then walks the entry bundle's import graph and reports the HTTP status of every
module it references. It refuses to run against the dev instance.

## Checks

```bash
./scripts/check all fast     # ruff+mypy+pytest, eslint+tsc+vitest
./scripts/check all full     # + coverage + production build
./scripts/check tc fast      # TC's own pytest suite
./scripts/check vision fast  # Vision V1 contract across service, backend, card, runtime
./scripts/check vision full  # + full Vision suite and network-isolated App images
```

## Parallel agent work

```bash
./scripts/feature new irrigation-v2     # matched worktrees in BOTH repos
./scripts/feature new culture-lines --tc # matched TC + card worktrees
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
Codex worktree task. Its setup creates isolated backend, TC, card, and Vision worktrees
on the same `codex/codex-<id>` branch, using `prerelease` for the backend, `main`
for TC and Vision, and `dev` for the card. The set and its mutable caches stay under
`worktrees/codex-<id>/`; backend and TC get private venvs, Vision uses its main
checkout's test environment, and the card reuses `node_modules` through a guarded
link when its lockfile agrees.

The environment actions run the normal checks against the matched set. From a
terminal, the equivalent commands are:

```bash
./scripts/codex-worktree status
./scripts/codex-worktree precommit
./scripts/codex-worktree check backend fast
./scripts/codex-worktree check tc fast
./scripts/codex-worktree check vision fast
./scripts/codex-worktree tc-precommit
./scripts/codex-worktree card-precommit
./scripts/codex-worktree card-e2e
./scripts/codex-worktree check all full
```

Card browser tests receive an exact localhost/loopback allowlist for their
local Vitest server and Home Assistant. E2E credentials are not copied into
managed worktrees: copy the ignored `tests/e2e/.env.test` into the paired card
worktree explicitly before running the E2E action.

### How the paired card worktree gets `node_modules`

Both `scripts/feature` and `scripts/codex-worktree` use one policy:

- A card worktree with no dependencies shares the main checkout's
  `node_modules` only when the two `package-lock.json` SHA-256 hashes match.
- An offline `npm ci --dry-run` must also report zero added, changed, or removed
  packages. This catches a stale main install even when the lockfiles agree.
- A lockfile mismatch removes the shared link and fails with instructions to
  run `npm ci` in the worktree. A real, matching `node_modules` is then kept
  private on later setup runs.

The card keeps Vite's optimiser cache and browser-test reports in its local
`.cache/`, so browser and E2E runs need no package farm. The farm mode was
removed: its ~24k symlinked files were write-through paths into the main
checkout and therefore were not a safe isolation mechanism.

Treat the one-link shared tree as read-only. Do not run `npm ci`, `npm install`,
`npm rebuild`, `patch-package`, or dependency postinstall tooling in a linked
worktree. Unlink `node_modules` and run `npm ci` locally before changing
dependencies.

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
- Agent instructions: `AGENTS.md` here and in each product repo, imported by `CLAUDE.md`.
  Change `AGENTS.md`, never the copy.

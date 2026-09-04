# AGENTS.md — Growspace workspace hub

You are in the **workspace hub**, not in a product repo. This directory holds the
development runtime, the multi-root VS Code workspace, and the shared scripts.
The product code lives in four sibling repositories.

## Map

```
~/dev/
├── growspace_manager/               Python — HA custom integration   (git repo)
├── lovelace-growspace-manager-card/ Lit/TS — Lovelace card           (git repo)
├── growspace_manager_vision/        Python — stateless vision service (git repo)
├── growspace_manager_tc/            Python — optional TC integration (git repo)
├── core/                            HA Core checkout — REFERENCE ONLY, never edit
└── growspace_manager_workspace/     ← you are here                   (the hub)
    ├── growspace.code-workspace     multi-root VS Code workspace
    ├── docker-compose.yml           HA dev + release-test runtimes
    ├── ha-dev/                      dev instance config — ON THE HOST
    ├── ha-test/                     clean instance for HACS verification
    ├── vision-dev/                  local Vision App options — ON THE HOST
    ├── scripts/{ha,check,feature}
    └── worktrees/                   matched cross-repo agent worktrees
```

**Each product repo has its own upstream-maintained `AGENTS.md`.** Read the one for
the repo you are changing — it is canonical and it wins over anything here. Notably
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
./scripts/vision build     # build the locked native amd64 Vision App image
./scripts/vision smoke     # analyze both deterministic camera fixtures
```

`ha dev up|restart` starts the production Vision App image before Home
Assistant and waits for its health check. The App is available to host
automation at `http://127.0.0.1:8099` and to Home Assistant at
`http://vision-dev:8099`; `ha test` remains isolated from it.

The dev instance mounts:

| Host | Container | Override |
|---|---|---|
| `../growspace_manager/custom_components/growspace_manager` | `/config/custom_components/growspace_manager` | `GROWSPACE_BACKEND_SRC` |
| `../growspace_manager_tc/custom_components/growspace_manager_tc` | `/config/custom_components/growspace_manager_tc` | `GROWSPACE_TC_SRC` |
| `../lovelace-growspace-manager-card/dist` | `/config/www/community/lovelace-growspace-manager-card` (ro) | `GROWSPACE_CARD_DIST` |
| `./ha-dev` | `/config` | — |
| `./vision-dev` | `/data` on the Vision App (ro) | — |

The integration and card source mounts default to the **main** checkouts; TC's
falls back to an empty host-owned directory under `ha-dev/custom_components/`
when that checkout is missing its component, so a hub without a TC clone still
starts. A worktree is served by setting its override on
`./scripts/ha dev restart`, run from the main hub checkout — which is the only
way to exercise a worktree's own code against :8123, since the runtime otherwise
keeps serving the main checkout while you believe you are testing your branch:

```bash
GROWSPACE_BACKEND_SRC=~/dev/growspace_manager/.worktrees/<name>/custom_components/growspace_manager \
GROWSPACE_TC_SRC=~/dev/growspace_manager_tc/.worktrees/<name>/custom_components/growspace_manager_tc \
GROWSPACE_CARD_DIST=./worktrees/<name>/card/dist \
  ./scripts/ha dev restart
```

Vision runs the exact App image rather than a live source mount. `./scripts/vision
build` delegates to `../growspace_manager_vision`; select a Vision worktree with
`GROWSPACE_VISION_SRC` while building and select another local tag at runtime with
`GROWSPACE_VISION_IMAGE`. The first `ha dev up|restart` creates a random App token in
gitignored `vision-dev/options.json`; later starts preserve it, `./scripts/vision
token` prints it for local configuration, and `ha dev reset` removes it with the Home
Assistant state. `./scripts/e2e smoke` proves both tracked Local File camera frames
complete real Vision Analyses before the browser specs run.

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

### The browser is the other stale layer

A hard refresh is not enough on its own. HA serves `/local/` with
`Cache-Control: public, max-age=2678400`, and its **service worker** answers from
its own Cache Storage — which `Ctrl+Shift+R` does *not* bypass. The card's entry
URL never changes shape, so a rebuild can land on disk, be served correctly by
HA, and still be invisible in the browser. Restarting cannot help; the staleness
is not in the bind mount. HACS installs escape this only because HACS appends
`?hacstag=<version>`.

`./scripts/ha dev up|restart` therefore stamps the registered resources in
`ha-dev/.storage/lovelace_resources` with a short content hash of the file each
one resolves to — `…/growspace-manager-card.js?v=b57c822473a4` — writing that
plain host file while the container is stopped, so HA loads the new value and
cannot flush its own copy back over it. A changed URL misses both cache layers at
once; an unchanged bundle keeps its hash and stays cached.

`scripts/stamp-card-resource.cjs` is the one implementation. It resolves every
`/local/` resource through the container's own bind mounts (so
`GROWSPACE_CARD_DIST` is honoured and nothing is assumed about paths), stamps the
entry only because the ~16 lazy chunks already carry their hash in the filename,
and never fails a start — an absent `dist/`, an unregistered resource or a
missing `docker` is a printed no-op. `ha test` (:8124) is untouched.

> **`npm run watch` does not re-stamp.** Rollup rewrites `dist/` without going
> through `scripts/ha`, so the URL keeps the previous build's hash. When a
> refresh shows stale code during a watch session, `./scripts/ha dev restart` —
> that is the only thing that re-reads the resource list.

## Validation

```bash
./scripts/check backend fast|full
./scripts/check tc      fast|full
./scripts/check card    fast|full
./scripts/check all     fast|full
```

These are the exact commands to run — do not improvise venv paths or test flags.

`check` prints the checkouts it resolved before it runs anything, because it is
not necessarily validating the tree you are sitting in. It takes
`GROWSPACE_BACKEND` / `GROWSPACE_TC` / `GROWSPACE_CARD` when set —
`codex-worktree check` sets all three — and otherwise falls back to the **main**
checkouts. Run `./scripts/check card` from a `scripts/feature` worktree and,
without that variable, it reports green about the main checkout; it now says so
in the header and prints the invocation that would check yours instead.

All targets refuse before any stage runs if the checkout they resolved would be
validated against the wrong dependencies.

A backend or TC check refuses if `<checkout>/.venv` does not realize that
checkout's `requirements.txt` — asked as an offline `uv pip install --dry-run`
against Home Assistant's own constraints, which costs about 0.1 s and names the
requirement that is unmet. This catches a worktree whose branch moved its pins,
a shared venv nobody rebuilt after the pins moved on `prerelease`, and an
environment that has drifted out from under both.

A card check also refuses if the checkout it resolved has a
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
./scripts/feature new culture-lines --tc # TC + card, same branch in both repos
./scripts/feature new shared-change --all # backend + TC + card
./scripts/feature list
./scripts/feature rm  irrigation-v2
```

Worktrees accumulate: a merged feature leaves its directories behind, and a card
worktree costs ~700 MB in build caches even though its `node_modules` is a
symlink. **Nothing upstream collects them.** A merge happens on a GitHub runner
and the worktree is a directory on your laptop, so no workflow can reach it —
merge state has to be pulled from this side:

```bash
./scripts/worktree-gc                       # report only — the default
./scripts/worktree-gc --prune               # remove the landed, clean ones
./scripts/worktree-gc --prune --untracked   # also those dirty with build fallout only
./scripts/worktree-gc --prune --branches    # delete the landed branches too
```

It sweeps all five checkouts, counting a worktree as landed when its HEAD is
contained in `origin/main`, `origin/dev` or `origin/prerelease` **or** when `gh`
reports a merged pull request whose merged head is exactly this tip — the second
signal is what catches squash merges, whose commits are ancestors of nothing,
and pinning it to the SHA is what stops a branch *reused* after its PR merged
from reading as landed on the strength of its name. Without `gh` those read as
unlanded rather than guessing.

`--branches` adds a second pass over the refs themselves, after any worktree
removal, so a branch and the worktree holding it are collected in the same run
rather than a run apart. `main`, `dev` and `prerelease` are excluded by name
whatever their state, and a branch checked out anywhere that survives the run is
left alone. Deletion prints the tip it removed, which restores the ref with
`git -C <repo> branch <name> <sha>`.

Everything else it refuses, with no flag to override: the main checkouts, the
worktree you are standing in, `.claude/worktrees/` agent sessions, anything with
modified tracked files, and any landed worktree that *contains* one of those —
Codex nests a repository's worktree inside the hub's, and `rm -rf` on the outer
directory does not consult the inner one's status.
To be reminded without remembering, install the nudge once:

```bash
./scripts/install-hooks              # post-merge + post-rewrite, all five repos
./scripts/install-hooks --uninstall
```

The hook **reports and never deletes** — it fires on every pull with nobody
necessarily watching, and collecting is a decision that wants a human at the
keyboard. It prints one line naming the command when something has landed, and
is silent when nothing has. It runs `--offline`, because the `gh` lookup is a
network round trip per repository (~6 s) and a pull should not wait for it; the
count then misses squash merges, says so, and the real command finds them.

Both hooks, because `git pull --rebase` never fires `post-merge`; `post-rewrite`
covers that path and filters out the `git commit --amend` it also fires on. The
installed hook calls the **main** hub checkout, never the checkout that
installed it — a worktree is ephemeral, this tool deletes them, and a hook
pointing into a deleted directory breaks every pull. Install from a worktree and
the hook stays quietly inert until that branch lands in the main checkout. A
`post-merge` this did not write (pre-commit can claim the same name) is reported
as a collision, never clobbered.

For a Codex-managed worktree of this hub, select the checked-in **growspace
workspace** local environment instead. It creates the matched three-repository
set during setup; use `./scripts/codex-worktree path` to locate it and
`./scripts/codex-worktree check ...` to validate it. Do not create a second
pair with `scripts/feature` in the same task. Card browser tests use an exact
localhost/loopback allowlist. E2E credentials are never copied automatically;
place the ignored `tests/e2e/.env.test` in the managed card worktree explicitly
when E2E is required.

**Backend and TC worktrees must live at `<repo>/.worktrees/<name>`.** Their
pre-commit hooks resolve Python tools through `../../.venv/bin/...`; that path
reaches the repo venv only from exactly that depth. From a main checkout it
resolves to `~/dev/.venv`, which does not exist, so Python hooks fail and every
commit from the protected checkout is rejected. This is a side effect of the
path, not a separate check.

`./scripts/feature` creates Python worktrees at the required depth and symlinks
them to `worktrees/<name>/backend` or `worktrees/<name>/tc` for the paired view.
Run their tests from a worktree as `../../.venv/bin/pytest tests/ -q`.

That same `../../.venv` decides which Python environment the worktree runs, and
where the worktree sits decides who owns it — which is why the two setup paths
behave differently:

| layout | `../../.venv` is | what setup does |
|---|---|---|
| `growspace_manager/.worktrees/<name>` (`scripts/feature`) | the main checkout's venv | **verifies** it realizes the branch's `requirements.txt`, and refuses if not |
| `<pair>/growspace_manager/.worktrees/backend` (`scripts/codex-worktree`) | a hub-owned path | builds a **private venv** there |
| `growspace_manager_tc/.worktrees/<name>` (`scripts/feature --tc`) | the main TC checkout's venv | **verifies** it realizes the branch's `requirements.txt`, and refuses if not |
| `<pair>/growspace_manager_tc/.worktrees/tc` (`scripts/codex-worktree`) | a hub-owned path | builds a **private venv** there |

`scripts/backend-venv` is the shared implementation for both Python repositories;
all setup paths call it, and both then point the worktree's own `.venv` at
whichever environment the hooks will use, so `./scripts/check backend` and
`./scripts/check tc` cannot validate a different one.

Codex-managed backend and TC worktrees do **not** share a venv the way card
worktrees share `node_modules`, and the reversal is measured rather than
stylistic: `uv` installs by hardlinking from a content-addressed cache, so a
private venv costs ~7.9 MiB of unique disk and ~0.4 s warm, against the card's
465 MB. Sharing buys nothing and costs a footgun npm does not have — `uv venv
--clear` through a symlinked `.venv` does not convert the worktree to a private
environment the way `npm ci` does, it **destroys the lender's**, and so does
every other install verb, because pip and uv follow the symlink to the real
`sys.prefix`. See
[`docs/adr/0002-private-backend-venvs-for-hub-managed-worktrees.md`](docs/adr/0002-private-backend-venvs-for-hub-managed-worktrees.md).

A `scripts/feature` pair therefore cannot carry a backend or TC dependency
change: its hook path *is* the corresponding main checkout's venv, so there is
nothing to redirect and a private venv in the worktree would be read by nothing.
Take pin changes on a Codex-managed set, or rebuild the shared venv deliberately
— every other worktree's guard re-checks it on the next run.

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
**in the lending checkout** reports a zero add/change/remove plan. The plan is
measured before the link exists, and against whichever checkout owns the tree it
describes: asked through the link, npm answers for the lender while every message
names the worktree, so a drifted main checkout used to be reported as ~193 added
/ 673 changed packages in the borrower instead of the one package it was actually
missing. A refusal therefore names the checkout to run `npm ci` in — the lender
when the shared tree drifted, which fixes it once for every future worktree, and
the worktree itself when it holds a drifted private install. On drift no link is
left behind. Writable Vite/test caches are checkout-local under `.cache/`, never
inside the shared tree.

Never run dependency-mutating npm commands through a shared link. `npm ci` and
`npm install` merely convert the worktree to a private install, but `npm rebuild`,
`patch-package`, and dependency postinstalls **write through into the main
checkout's tree**, and no npm hook can catch them. That risk is accepted, not
guarded — see [`docs/adr/0001-guarded-shared-card-dependencies.md`](docs/adr/0001-guarded-shared-card-dependencies.md)
for the decision, the measurements, and the hub-heals/card-detects boundary.

`no-commit-to-branch` additionally blocks `main` and `dev` outright.

## Cross-repo contract

The integration and card are coupled through HA services, WebSocket commands, and the
zod schemas in `card/src/schemas/api-schema.ts`. A change to any payload shape is
**one logical feature across both repositories**:

```
backend impl → backend test → contract fixture → card impl → card test
```

The backend side must land first — the card cannot call a service that does not
exist. See `docs/CONTRACT.md`.

Growspace Vision owns the stateless HTTP service contract under
`../growspace_manager_vision/contracts/growspace-vision/`. The hub remains the
cross-repository roadmap and issue tracker; service context, ADRs, research, fixtures,
and contract tests belong in the Vision repository. A change spanning Vision and Home
Assistant must update the Vision contract first, then the integration client and its
tests, and finally the card when the user-facing shape changes.

Growspace Manager TC is an optional companion integration. Phenotype identity flows
one way from `growspace_manager` into TC as opaque IDs with display-name snapshots;
graduation crosses back only through Growspace Manager's public service. TC owns its
WebSocket contract, which the card consumes through its lazy TC chunk. Land TC
contract fixtures and tests before the corresponding card schema, implementation,
and tests. Use `./scripts/feature new <name> --tc` for a matched TC+card pair,
`./scripts/check tc fast|full` for its Python suite, and `GROWSPACE_TC_SRC` on a
main-hub `./scripts/ha dev restart` to serve a TC worktree against :8123.

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
  `origin/main` before concluding anything is broken — the product repos move fast.
- **Don't start a second thing on :8123.** `./scripts/ha dev up` refuses rather
  than silently losing the race.
- **Don't drive the runtime from a hub worktree.** `docker-compose.yml` resolves
  `ha-dev/` and the source mounts *relative to itself*, and a worktree yields
  the same Compose project and container names — so it does not start a second
  stack the port guard would catch, it recreates the shared one against that
  worktree's unbuilt siblings and empty config. `./scripts/ha` refuses; to serve
  a worktree's bundle or integration, run it from the main checkout with
  `GROWSPACE_CARD_DIST` / `GROWSPACE_BACKEND_SRC` / `GROWSPACE_TC_SRC`.

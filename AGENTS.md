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
./scripts/seed-demo             # the demo's own content, all three halves of it
./scripts/seed-vision-history   # fake Vision Checkup history for the demo
./scripts/seed-tc-world         # a worked tissue-culture bench for the demo
./scripts/demo-dashboard        # the panel dashboard README captures come from
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

#### The published Vision tag, and the local one

`growspace_vision/config.yaml`'s `version` is the App version, and everything
downstream of it is that number: the Home Assistant App store reads it off the
default branch and pulls exactly `ghcr.io/venosta-web/growspace-manager-vision:<version>`,
Vision's `Release` workflow publishes that tag from a `main` push and refuses to
overwrite one that already exists, and `./scripts/build-app-images.sh` derives its
own local tag from the same line. So the compose default
`growspace-vision:<version>-amd64` and the published multi-arch tag name the same
release; the local one is per-architecture and built here, the published one is
generic and resolved by Supervisor.

A contributor who is not iterating on Vision does not have to build it:

```bash
GROWSPACE_VISION_IMAGE=ghcr.io/venosta-web/growspace-manager-vision:1.0.1 \
  ./scripts/ha dev restart
```

**The `docker-compose.yml` default stays the local build.** The dev loop's whole
point is iterating on Vision source, and a runtime that silently pulled a release
would be running something other than what you just built. Pointing
`GROWSPACE_VISION_IMAGE` at the published tag once is also the cheapest way to
exercise what a user actually gets, which no other part of this hub does.

The **model** version — `src/growspace_vision/model_manifest.json`, textually
identical to the App version today — is a different number and must not move
with it. It identifies the embeddings every Baseline Bucket and Framing Epoch in
`ha-dev/growspace_vision.db` is keyed to.

### Vision evidence, and the demo history

The Vision Evidence Store keeps its database at `ha-dev/growspace_vision.db` and
its image corpus under the **`local` media dir**, which
`ha-dev/configuration.yaml` pins to `/config/media` — i.e. `ha-dev/media/`. That
line is load-bearing twice over. Unset, Home Assistant running in Docker defaults
the media dir to `/media`, which is root-owned in the image while HA runs as
1000: the store cannot create `/media/growspace_vision` and every start logs
`Failed to open the Vision Evidence Store` with a `PermissionError`, leaving the
card with no V1 history at all and no obvious reason why. It would also be the
one thing HA writes that lives only inside the container. `media_dirs` is
validated with `vol.IsDir()` at config load, so `ha-dev/media/` has to exist —
that is what its tracked `.gitkeep` is for; the contents are ignored.

**Both instances carry the pin**, because the failure is not about Vision. It is
about `/media` being root-owned, so any instance without the pin logs that error
on every start whether or not anything asks it for evidence — and `ha-test` is
the one place a stray error costs the most, since a clean-room release
verification is supposed to make an unexplained log line mean something.
`ha-test/media/` therefore has its own tracked `.gitkeep` too.

`./scripts/seed-vision-history` fills that store with a plausible history so the
snapshot dialog has something to show:

```bash
./scripts/seed-vision-history                     # Demo Tent, 45 days
./scripts/seed-vision-history --growspace "E2E Vision"
./scripts/seed-vision-history --list              # what can be targeted
./scripts/seed-vision-history --clear             # drop that growspace's evidence
```

Only the calendar and the photographs are fake. Frames are drawn by importing
`scripts/gen-e2e-camera-assets` — one tent renderer, no binary blobs in git — and
then sent to the **running Vision App**, so the embeddings and quality signals
are the real model's. Those go through the integration's own
`VisualComparisonEngine` and `fuse_evidence`, and the rows are written with the
DDL imported from `vision_evidence_schema.py`. Verdicts, baseline readiness,
calibration and fusion states are therefore produced rather than chosen, and the
seeded captures carry the live model identity plus the surrogate Grow Run and
Framing Epoch the store itself would mint — so a real checkup afterwards
continues the seeded baseline instead of bootstrapping a fresh 30 samples.

Two consequences worth knowing before changing it. A Baseline Bucket is one
camera and light window, admits one capture a day and needs 30 before it scores
anything, so fewer than ~34 days seeds a history in which nothing is ever scored
— the script refuses. And a bucket only re-admits `normal` results, so a scene
that drifts faster than its rolling window scores anomalous once and then never
recovers; the seeded plants grow about 20% across the run for exactly that
reason, not for looks.

The Vision App must be up. Home Assistant need not be, but restart it afterwards
if its store failed to open when you seeded. Both the database and the images
are gitignored, and the script writes to the **main** hub checkout's `ha-dev/`
even when run from a worktree, because that is the only one the runtime mounts.

### The tissue-culture bench, which is not seeded through the API

A fresh install of Growspace Manager TC is functional and **empty**, so the
Tissue Culture dialog opens onto "Nothing is due. Every vessel still has time on
the medium it is on." — the same screen an install with a full bench shows on a
quiet day, and therefore the one screen a demo must not land on.

`./scripts/seed-tc-world` builds a worked bench: four Culture Media over five
Medium Versions, seven Culture Lines, twenty Cultures across five Locations,
twenty-six Maintenance Actions reaching back ninety days, and four Pairings.

```bash
./scripts/seed-tc-world           # the bench
./scripts/seed-tc-world --report  # what the store holds of this script's
./scripts/seed-tc-world --clear   # drop it, the graduated plant included
./scripts/seed-tc-world --no-graduated-plant   # the bench alone, no Home Assistant
```

**It writes the store directly, and that is the point.**
`MaintenanceAction.recorded()` takes an optional `now`, but no TC WebSocket
schema exposes `recorded_at` and no handler passes one — so an API-driven seed
stamps every act today, every Replate Due Date lands at today plus its interval,
and the Worklist stays empty: the same empty screen with ninety days of history
behind it. The calendar is therefore the one thing invented. Everything else
comes from TC's own models and repository, imported out of the checkout the way
`seed-vision-history` imports the Vision evidence schema — which Medium Version
a Plating pins, what a division does to a Culture's identity, which acts an
ended vessel refuses. They cannot drift from the shipped rules without this
script failing loudly.

**The one act it cannot write alone is a Graduation**, because it is the only
one whose data crosses back into Growspace Manager: TC ends the Culture, then
optionally calls GM's public `add_plant` and links the returned plant onto the
recorded act. Seeded in process that second half does not happen, so every
seeded Graduation would carry no plant — which is precisely the state TC's error
path writes when the bridge *fails* (`Culture %s graduated without a linked
plant`, logged and deliberately not retried). The script therefore calls that
same service on the running instance, in the same order, and seeds **one
Graduation of each kind**: one linked to a plant that really stands in the
canonical `clone` growspace with the Graduation's own instant as its
`clone_start`, and one unlinked, because a failed bridge is a real state nobody
would otherwise ever see. Both are honest rows; neither invents a state the
product cannot produce.

That half — and only that half — needs Home Assistant up and a token in
`.ha-token`, the same two things `seed-demo` needs; it is refused before
anything is written when either is missing, and `--no-graduated-plant` gives it
up and asks nothing of Home Assistant. The plant is recognised the way
`seed-demo` recognises its own — the declared position under that position's
declared strain — so a rerun adopts the plant already standing there instead of
adding a second, and corrects its `clone_start` if the calendar has moved since.
A position held by something else is refused rather than worked around, because
`add_plant` silently relocates to the next free cell and a demo whose graduate
wanders is worse than one that says why it stopped.

Three consequences worth knowing. **Home Assistant holds this state in memory
and saves over the file**, so seed with it down or restart it afterwards; the
script says which of the two applies on the run you just did, and `seed-demo`
runs it last so that notice is the last thing printed. Six of the seven lines
reference phenotypes by Growspace Manager's own key (`"<strain>|<phenotype>"`,
the string the card's client-side join indexes on) and the script **refuses**
if the strain library does not hold them — run `./scripts/seed-demo` first. And
the seventh references a phenotype nobody grows, on purpose: a **Missing
Phenotype** is the one TC state that cannot appear without being constructed,
and the script refuses just as loudly if the demo roster ever grows that strain
and quietly resolves it.

Records are recognised by declaration rather than by a marker of their own — a
medium this script named, a line pointing at a phenotype it references, and
everything hanging off such a line — so `--clear` leaves a medium you mixed by
hand and a line you introduced from the card alone, and a rerun over a bench
that is already there reports it and changes nothing. The removal is done to the
persisted dictionary rather than through the repository, because Maintenance
Actions are append-only by design and that is a rule about the product's history,
not about a demo's scaffolding. The graduated plant is the exception in both
directions: it is named by the seeded Graduation that created it rather than by
declaration, and it goes back out through `remove_plant`. Unlike seeding, that
degrades rather than refusing — the bench is already out of the store by then —
and an instance that is down leaves the plant behind with its ID printed.

### One command for the whole demo

Vision evidence is one part of it and the bench another. The third is that a
fresh clone's Demo Tent is an **empty tent**: the `demo` capability profile owns
the growspace's entities and wiring, and the card fixture that applies it drops
one anchor plant into a 2x2 grid — right for a test fixture, wrong for a demo.

`./scripts/seed-demo` owns the content:

```bash
./scripts/seed-demo                     # plants, the Vision history, the bench
./scripts/seed-demo --growspace "E2E Vision"
./scripts/seed-demo --no-vision         # skip the Vision history
./scripts/seed-demo --no-tc             # skip the tissue-culture bench
./scripts/seed-demo --list              # what can be targeted
./scripts/seed-demo --clear             # remove what it seeded, all three parts
```

It grows the tent to 4x5, puts the twelve strains it draws on into the strain
library, evicts the fixture's anchor plant, and places seventeen plants in
cohorts a fortnight or so apart — late, mid and early flower, one plant four
days past the flip, and the veg pair behind it — leaving three positions empty
so there is somewhere to demonstrate adding one. Then it **calls
`seed-vision-history` and `seed-tc-world`** rather than reimplementing either,
so none of the three can drift and one command leaves a fresh clone demo-ready.
The bench goes last, because its Home Assistant restart requirement is the only
thing in the run that is not already live. One plant lands outside the tent as
part of that: the bench's linked Graduation puts its graduate in the canonical
`clone` growspace, which is where a vessel out of vitro belongs.

Two things keep it honest. Everything goes in through `add_strain`, `add_plant`
and `update_growspace` on the **running instance**, so the entities, the timeline
and the stage arithmetic are the shipped implementation's rather than rows
written behind Home Assistant's back — which is also why plants are read back
from `/api/states` (each plant is an entity carrying its own `plant_id`) instead
of from `.storage/growspace_manager.plants`, a file Home Assistant only flushes
ten seconds late and which would make a second run place duplicates. And the
stage dates are days before *today*, anchored on the `stage_days_ago` the demo
profile declares in `e2e/entity_coverage.py`, so the tent the dashboard describes
and the plants standing in it cannot drift apart.

A position already occupied is reported and left alone, so a rerun is a no-op
and never overwrites something added while demoing; `--clear` removes only the
plants standing on a declared position under that position's declared strain,
and leaves the growspace itself. Home Assistant must be up, with a token in
`.ha-token` (`./scripts/ha dev token`) and the growspace already declared —
`./scripts/e2e provision` on a fresh clone. Like `seed-vision-history` it reads
and writes the **main** hub checkout's runtime even when run from a worktree,
while the roster and the declarations come from the checkout it was invoked
from, so a worktree exercises its own branch.

### Photographing it

All four repositories carry a README screenshot set, and all four photograph
this instance showing Demo Tent — the same tent with a different emphasis per
repository, never the same five pictures four times. The published Pages demo
is not a source for any of them: its recording holds one response per read-only
WebSocket command of the integration's, so TC is not in it at all.

```bash
./scripts/demo-dashboard                          # /demo-tent/0
./scripts/demo-dashboard --growspace "E2E Vision" # repoint it
./scripts/demo-dashboard --tc                     # /demo-tc/0, the TC card
./scripts/demo-dashboard --remove
```

The dashboards `./scripts/e2e provision` generates are *sections* views, which
render the card into one narrow column with its header chips clipped — right
for a spec, useless for a photograph. `demo-dashboard` writes a **panel** view
through Home Assistant's own Lovelace commands, so the card is the whole page
and its own layout decides the width. It is one dashboard whatever it is
pointed at, and `--remove` refuses once it holds anything other than the single
card it wrote.

`--tc` is a second dashboard rather than a second view, because
`custom:growspace-tc-card` is not a Growspace Manager card pointed at a
growspace — it takes no options, reads TC's domain, and renders nothing at all
without TC. It refuses when TC is not loaded rather than let you photograph a
blank page.

The subject, the viewport sizes, the theme, where the files land per repository
and the README shape they go into are all in
[`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md).

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

### And the third stale layer is HACS itself

A user does not get the card from a bind mount. HACS downloads it, and **HACS
never cleans the directory it downloads into** — a plugin release is single-file
content to it, so an update writes the new release's files alongside every file
the previous one left. A live install ended up serving the entry from
`v1.3.0-next.48` on the complete `v1.3.0-next.10` chunk set, every lazy chunk
the entry imports 404ing, and the dashboard rendering nothing. Neither runtime
here can see that: :8123 mounts `dist/` whole, and a fresh HACS download on
:8124 fetches every release asset and passes. Only install-then-update
reproduces it.

```bash
./scripts/card-hacs-update v1.3.0-next.10 v1.3.0-next.48
./scripts/card-hacs-update v1.3.0-next.10 v1.3.0-next.48 --reset   # from onboarding
```

It downloads the from-tag through HACS into the **clean :8124 instance**,
updates to the to-tag through HACS, and then walks the entry bundle's import
graph over HTTP — reporting every module URL with its status, printing the file
count in `www/community/` beside it, and exiting non-zero if any module is not
served. A JSON record of both walks lands in
`artifacts/card-hacs-update/<from>-to-<to>.json`. It **refuses the dev
instance** by port and by config directory: a HACS download into `ha-dev/` would
be writing through a read-only mount of `dist/`.

Three things it needs, and does for itself: HACS (downloaded into
`ha-test/custom_components/`), an onboarded instance (`.ha-test-token`, and it
prints the login it created), and a GitHub token — HACS authenticates every
repository read, so `gh auth login`, `HACS_GITHUB_TOKEN`, or `--github-token`.
Two rows are written into HA's and HACS's own stores, both because there is no
non-interactive way in: HACS's config entry only ever comes from a GitHub
device-code flow that ends in a browser, and the card **cannot currently be
added to HACS at all** — every one of its last 30 releases is a prerelease, so
with `show_beta` off HACS filters them all away, checks `main`, finds no
`growspace-manager-card.js` in a tree whose `dist/` is gitignored, and refuses
without logging anything. Everything about the download itself still goes
through HACS, from the real release assets.

Run against HACS 2.0.5, `v1.3.0-next.10 → v1.3.0-next.48` **does not** reproduce
the 404s: both downloads fetch the complete asset set of the tag they were asked
for and the entry's graph resolves. What it does show is 66 files where 34
belong. `--hacs-version` points it at the HACS a report came from, which is the
next thing to vary when a report says otherwise.

#### Every published release replays that update

Reproducing a pair on demand only helps someone who already suspects the bug.
`./scripts/card-release-update-check` is the same reproducer, pointed at the
release that was just published:

```bash
./scripts/card-release-update-check --tag v1.3.0-next.58
./scripts/card-release-update-check --tag v1.3.0-next.58 --resolve-only
./scripts/card-release-update-check --tag v1.3.0-next.58 --from v1.3.0-next.10 --reset
```

It resolves the predecessor from the card's GitHub releases, hands the pair to
`card-hacs-update`, and turns the report into a verdict — one `::error`
annotation per missing chunk naming the chunk and both tags, and a job summary
table beside it, so a red release is legible on the run page without opening a
log. `--resolve-only` prints the pair and stops, which is the cheap way to ask
what a publish would check. Anything it does not recognise goes to
`card-hacs-update` untouched.

The predecessor is per channel, because that is what the user's HACS offers:
a **stable** release is checked against the previous stable, since `show_beta`
is off there and every prerelease in between is invisible to that install; a
**prerelease** is checked against the previous release of any kind, since
`show_beta` is what puts prereleases in reach and it does not hide the stable
ones.

It runs **after** the publish, in the card repository's `Release` workflow —
`hacs-update-check.yaml`, a job that `needs` whichever publishing job ran and
therefore cannot gate or delay it. That placement is deliberate three times
over. [ADR-0025] makes e2e a main-only release gate and leaves the dev
prerelease job with no `needs` so the frequent path stays fast, and this must
not change that. A main-only gate would have caught nothing anyway: every
broken release in the incident was a dev prerelease. And a pre-publish check
could only install, which passes — the update is the path that breaks, and it
does not exist until both releases do.

The job checks this hub out for `docker-compose.yml`, `ha-test/` and the two
scripts, and sets `GROWSPACE_HA_USER` to the runner's own uid: the container
and the tooling driving it write the same bind-mounted config directory, and on
a runner that is not 1000.

[ADR-0025]: https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/main/docs/adr/0025-ci-merge-gate-and-e2e-on-main-only.md

## Validation

```bash
./scripts/check backend fast|full
./scripts/check tc      fast|full
./scripts/check card    fast|full
./scripts/check vision  fast|full
./scripts/check all     fast|full
```

These are the exact commands to run — do not improvise venv paths or test flags.

`check` prints the checkouts it resolved before it runs anything, because it is
not necessarily validating the tree you are sitting in. It takes
`GROWSPACE_BACKEND` / `GROWSPACE_TC` / `GROWSPACE_CARD` / `GROWSPACE_VISION`
when set — `codex-worktree check` sets all four — and otherwise falls back to the **main**
checkouts. Run `./scripts/check card` from a `scripts/feature` worktree and,
without that variable, it reports green about the main checkout; it now says so
in the header and prints the invocation that would check yours instead.

The header also says when a resolved checkout is **behind**, and by how much:
`prerelease is 2 commits behind origin/prerelease`. A tree a few commits back
fails in ways that belong to nobody's code — a fixture helper that does not exist
yet, a test file added upstream — and reads exactly like a regression in someone's
work; that is what it looked like for a whole `./scripts/check all` audit before
this existed. A branch with no upstream is measured against the nearest of
`origin/main`, `origin/prerelease` and `origin/dev`, so a checkout parked on a
merged feature branch reads as `6 commits behind origin/main  (no upstream —
nothing of its own)` rather than as work in progress. This **warns and never
refuses**: validating a deliberately older tree is legitimate. It reads only the
remote-tracking refs already on disk and never fetches, so the counts are as old
as your last fetch — `check` stays offline and fast, and the case that bites is a
checkout left behind by a pull somebody already did here.

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

The `backend`, `card` and `all` targets additionally refuse if the E2E entity
coverage contract has drifted. `e2e/entity_coverage.py` is the source of truth;
`ha-dev/packages/e2e_simulated_sensors.yaml`, `docs/E2E.md` and the card's
committed `tests/e2e/fixtures/e2e-entity-coverage.generated.json` are all
generated from it, and `scripts/check-e2e-coverage` compares each one against
the declarations. One command rewrites all three, and the refusal prints it with
the card checkout already filled in:

```bash
./scripts/gen-e2e-sensors --card-root <path-to-card-checkout>
```

**`backend` is in that list on purpose.** The declarations are edited here, in
the hub, but the artifact that goes stale lives in the card repository — so
guarding only `card` meant a hub declaration change passed `./scripts/check
backend` cleanly and then refused the *whole* card validation, eslint through
vitest, for whoever touched the card next
([card#884](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/884)).
Editing `e2e/entity_coverage.py` and regenerating is one action; the check now
treats it that way. The card checkout it will judge is named in the header even
on a `backend` run, since it is not otherwise a tree that target reports on.

### What CI gates on a pull request

`./scripts/check` validates the **product repositories**. The hub's own content —
the shell tooling, the Python behind the E2E contract, the YAML, the workflows —
is gated by three workflows on every pull request:

| workflow | job | what it runs |
|---|---|---|
| `Lint` | Shell, Python, YAML and spelling | ShellCheck, Ruff, yamllint, codespell |
| `Workspace quality` | Workspace contracts and tooling | the E2E coverage contract, and every `scripts/**/*.test.cjs` |
| `PR Title` | Conventional commit title | the PR title, against the card repository's type list |

Every tool is **pinned in the workflow** rather than taken from the runner image,
and every rule lives in a checked-in config — `ruff.toml`, `.yamllint`,
`.codespellrc` — never in a flag, so a local run and CI cannot disagree about
what the rules are. To run the lint job exactly as CI does:

```bash
pip install "ruff==0.15.12" "yamllint==1.37.1" "codespell==2.4.1" "shellcheck-py==0.11.0.1"
mapfile -t scripts < <(
  git ls-files scripts \
    | while read -r f; do
        head -1 "$f" | grep -qE '^#!.*(bash|/sh)$' && printf '%s\n' "$f"
      done
)
shellcheck "${scripts[@]}"
ruff check e2e ha-dev/custom_components/ac_infinity scripts
ruff format --check e2e ha-dev/custom_components/ac_infinity scripts
git ls-files -z '*.yml' '*.yaml' | xargs -0 yamllint --strict
git ls-files -z | xargs -0 codespell
```

Two of those deserve a note, because both encode a decision rather than a default.

**ShellCheck discovers its inputs by shebang**, the way the kernel does, because
the hub's shell tooling is extensionless. A script added to `scripts/` is covered
without anyone remembering to edit a list.

**The tooling suite is a glob, not a list.** The hand-written list it replaced had
silently dropped `card-node-modules.test.cjs` — nine passing tests that no CI run
had ever executed — because adding a test file and adding it to CI were two
actions and only the first one is obvious. `scripts/vision-runtime.test.cjs`
asserts that the workflow's pattern really selects it, expanding the glob rather
than matching its own name as a literal: a name check would have kept passing
while the file went unrun, which is the failure it exists to prevent.

What is **not** linted is as deliberate. `.yamllint` ignores the agent skill
manifests the installer owns, `ha-dev/packages/e2e_simulated_sensors.yaml`
(generated from `e2e/entity_coverage.py`, so a fix here is undone by the next
generation), and the stub files Home Assistant rewrites for itself. Ruff omits
`E501`, because this repository's Python carries the same long explanatory prose
its shell and Markdown do, and it exempts `e2e/entity_coverage.py` from `UP031`:
that module renders Jinja2 templates, whose own `{{ }}` make percent-formatting
the readable choice.

Ruff also targets **`py313`, not the 3.14 that CI and the integration repository
run** — the one place in this repository where a version pin is deliberately
behind. These scripts are host tooling you are told to run directly, and at
py314 the formatter drops the parentheses from `except (OSError, ...)` per
PEP 758: valid only on 3.14, a hard `SyntaxError` on every interpreter before
it, and worth nothing. Ruff catches the construct itself, so the floor is
enforced rather than hoped for.

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
workspace** local environment instead. It creates the matched four-repository
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
  `./scripts/check` says so in its header when a checkout it resolved is behind,
  but only as far as your last fetch knows.
- **Don't start a second thing on :8123.** `./scripts/ha dev up` refuses rather
  than silently losing the race.
- **Don't drive the runtime from a hub worktree.** `docker-compose.yml` resolves
  `ha-dev/` and the source mounts *relative to itself*, and a worktree yields
  the same Compose project and container names — so it does not start a second
  stack the port guard would catch, it recreates the shared one against that
  worktree's unbuilt siblings and empty config. `./scripts/ha` refuses; to serve
  a worktree's bundle or integration, run it from the main checkout with
  `GROWSPACE_CARD_DIST` / `GROWSPACE_BACKEND_SRC` / `GROWSPACE_TC_SRC`.

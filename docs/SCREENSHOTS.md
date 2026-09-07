# README screenshots

Four repositories carry a README screenshot set, and all four photograph the
same thing: **the live dev instance at `http://localhost:8123`, showing Demo
Tent.** One instance, one procedure, four different emphases. This document is
the procedure, from a cold workspace to committed images.

Read it end to end before capturing anything. The runtime preparation is the
part that decides whether the pictures are worth taking, and it is the part that
is easy to skip.

## The subject is Demo Tent

**Demo Tent**, and not one of the `E2E ` instances, because it is the only
growspace built to be looked at. It is a declared capability profile — see
[`CONTEXT.md`](../CONTEXT.md) for what that means and
[ADR-0003](adr/0003-demo-tent-as-a-declared-fixture.md) for why it is one — with
an entity set of its own, seventeen plants in cohorts a fortnight apart, a
populated strain library, a seeded Vision Checkup history and a worked
tissue-culture bench behind it.

The E2E instances are the wrong subject twice over. They are 2x2 grids holding
one `E2E Anchor` plant, which photographs as exactly what it is. And their
readings are **mirrored sensors**: a spec that writes one trips its manual gate,
after which it reports the written value instead of its free-running waveform.
A capture taken during or after an e2e run therefore shows telemetry frozen
wherever a test left it — flat sparklines, a light cycle that never turns over,
a crop-steering panel projecting from a pinned VWC. Demo Tent's equipment is
isolated from every spec, so nothing pins it mid-capture.

### The published demo is not the source

<https://Venosta-web.github.io/lovelace-growspace-manager-card/demo/> runs the
real card bundle, which makes it tempting. It is driven by a frozen recording
holding **one response per read-only WebSocket command of the integration's** —
twelve of them, every one `growspace_manager/*`. Unrecorded commands resolve to
`{}`.

So the recording contains nothing from Growspace Manager TC, whose commands
belong to another domain entirely, and nothing the recording predates. Its
telemetry is a 24-hour window re-based on load rather than live. It is a good
demo and a bad camera: **captures come from the live dev instance.**

## Getting the runtime ready

From the **main** hub checkout — `scripts/ha` and `scripts/e2e` refuse to drive
the runtime from a worktree, and the seeding scripts read the main checkout's
`ha-dev/` whichever checkout they were invoked from:

```bash
./scripts/vision build          # or set GROWSPACE_VISION_IMAGE, see below
./scripts/ha dev up
./scripts/ha dev token          # prompts for a long-lived token, saves .ha-token
./scripts/e2e provision         # declares every profile, Demo Tent included
./scripts/seed-demo             # plants, Vision history, tissue-culture bench
./scripts/demo-dashboard        # the panel dashboard captures are taken from
./scripts/ha dev restart        # the bench needs this; seed-demo says so last
```

On a clone that has never been started, Home Assistant onboards first: open
<http://localhost:8123> after `ha dev up`, create the account, and then ask for
the token — `ha dev token` walks you to the page it is created on.

`./scripts/e2e provision` is the slow one — it regenerates the coverage
adapters, builds the card, recreates the container and configures sixteen
growspaces. On an instance that is already provisioned, `./scripts/seed-demo`
and `./scripts/demo-dashboard` are the only two you need.

Four things worth knowing before the first run:

- **Vision has to be up before `seed-demo`.** The seeded evidence is scored by
  the real model, so the App is not optional; `--no-vision` skips that half.
  `docker-compose.yml` defaults to the locally built `growspace-vision:<version>-amd64`,
  which does not exist until `./scripts/vision build` has run. To skip the build,
  point at the published tag instead:
  `GROWSPACE_VISION_IMAGE=ghcr.io/venosta-web/growspace-manager-vision:1.0.1 ./scripts/ha dev restart`.
- **The tissue-culture bench is written straight to its store**, and Home
  Assistant saves over that file from memory. Seed with it down, or restart
  afterwards. `seed-tc-world` prints which of the two applies to the run you
  just did, and `seed-demo` runs it last so that notice is the last thing you
  see.
- **`seed-demo` is idempotent.** A position already occupied is reported and
  left alone, so a rerun before a re-capture is safe. `--clear` removes what it
  seeded and leaves the growspace.
- **To photograph a worktree's own code**, serve it from the main checkout with
  the source overrides — never by running the runtime from the worktree:

  ```bash
  GROWSPACE_BACKEND_SRC=~/dev/growspace_manager/.worktrees/<name>/custom_components/growspace_manager \
  GROWSPACE_TC_SRC=~/dev/growspace_manager_tc/.worktrees/<name>/custom_components/growspace_manager_tc \
  GROWSPACE_CARD_DIST=./worktrees/<name>/card/dist \
    ./scripts/ha dev restart
  ```

### The capture dashboard

`./scripts/demo-dashboard` creates `/demo-tent/0`, a **panel** view holding one
card pinned to Demo Tent. It exists because the dashboards `e2e provision`
generates are *sections* views, where the card renders into one narrow column
with its header chips clipped — right for a spec, useless for a photograph. A
panel view gives the card the whole page and lets its own layout decide the
width.

```bash
./scripts/demo-dashboard                          # Demo Tent
./scripts/demo-dashboard --growspace "E2E Vision" # repoint it
./scripts/demo-dashboard --tc                     # the tissue-culture bench
./scripts/demo-dashboard --remove
./scripts/demo-dashboard --tc --remove
```

It is one dashboard whatever it is pointed at, and `--remove` refuses to delete
it once it holds anything other than the single card this wrote.

`--tc` is a **second** dashboard, `/demo-tc/0`, holding one
`custom:growspace-tc-card`. It is separate rather than a second view because
that card is not a Growspace Manager card pointed at a growspace: it takes no
options, reads another integration's domain, and renders nothing at all where
TC is absent. For the same reason `--tc` refuses when TC is not loaded, rather
than leaving you to photograph a blank page — the tell is
`calendar.growspace_manager_tc_replates`, the one entity that integration
serves.

## The browser

| setting | value | why |
|---|---|---|
| URL | `http://localhost:8123/demo-tent/0` | the panel view above |
| theme | dark | the card is designed dark-first and every existing capture is dark |
| desktop viewport | 1280x720 | Playwright's `Desktop Chrome`, the card's own desktop test width |
| mobile viewport | 390x844 | the card's phone-viewport contract; its mobile layout starts below 600px |
| device scale factor | 2 | README images render at ~900px wide on GitHub; 1x looks soft |
| sidebar | collapsed | it is not part of the card, and it costs the card 200px |

Dark theme comes from `prefers-color-scheme`, not from a Home Assistant
setting: this instance's user has no theme of its own, so the frontend follows
the browser. Emulate it (`colorScheme: 'dark'` in Playwright, **Rendering →
Emulate CSS prefers-color-scheme** in DevTools) rather than relying on the host
machine's setting, or the same command produces a light capture on someone
else's laptop.

**Frame the card, not Home Assistant.** Every existing image is an element
capture of `growspace-manager-card` — no sidebar, no HA header, full card
height rather than one viewport of it. For a dialog, capture the dialog surface
the same way. Playwright pierces shadow DOM, so
`page.locator('growspace-manager-card').screenshot({ path })` is the whole
thing; in DevTools, select the node in the Elements tree and use **Capture node
screenshot**.

Two things that will waste a capture session:

- **Reload once after opening the dashboard, and wait for the plant grid.** The
  card can paint an empty page on a cold navigation in a scripted browser. If
  the tent is blank, it has not failed — it has not finished.
- **A rebuilt bundle needs `./scripts/ha dev restart`,** which re-stamps the
  Lovelace resource URL. `npm run watch` does not, and HA's service worker
  answers from its own cache that `Ctrl+Shift+R` does not bypass, so a fresh
  build can be on disk, served correctly, and still invisible. See the stale
  layers section in [`AGENTS.md`](../AGENTS.md).

## Reaching each surface

Everything below is on the card's header. The ⋮ menu carries three groups:
**Plant Care** (Select plants, Add Plant, Water Growspace, Log / Manage IPM,
Log Training),
**Setup** (Arrange, Irrigation, Irrigation Recipes, Irrigation Programs,
Nutrients, Strains, Tissue Culture) and **Insights** (Compare, Logbook, Camera
Snapshots, Ask AI).

| surface | how |
|---|---|
| overview / plant grid | the dashboard itself |
| plant dialog | click any plant |
| crop steering | ⋮ → Irrigation |
| strain library | ⋮ → Strains |
| logbook | ⋮ → Logbook |
| tissue culture | ⋮ → Tissue Culture |
| Vision evidence | ⋮ → Camera Snapshots → **Vision evidence** tab |
| mobile | the same URL at 390x844 |

The tissue-culture surfaces have a second, better frame of their own. The whole
TC view lives in one element that two hosts mount — the ⋮ dialog above, and the
standalone `growspace-tc-card` that `./scripts/demo-dashboard --tc` puts on
`/demo-tc/0`. Photograph TC from the standalone card: it is what TC's README
tells a reader to add, and it is the card's own sections rather than a dialog
belonging to the other card.

| TC surface | element to capture |
|---|---|
| replate worklist | `growspace-tc-worklist` |
| Culture Lines, and a line's vessels | `growspace-tc-culture-board`, after **Show vessels** |
| a Maintenance Action | `growspace-tc-action-dialog`, after **Replate** / **Graduate** / … |
| a vessel's history | `growspace-tc-action-dialog`, after **Show this vessel's history** |
| Culture Media and their versions | `growspace-tc-medium-library`, after **Show version history** |
| Curated Pairings | `growspace-tc-pairings` |
| the replate calendar | `/calendar` — Home Assistant's own panel, clipped past the calendar list |

**Graduation is the one act to photograph as a record rather than as a form.**
The Graduate dialog's bridge into Growspace Manager offers a destination only
where the growspace list has been hydrated, which the manager card's bootstrap
does and the standalone TC card does not — so on `/demo-tc/0` it reads "No
growspace is available for a new plant". The seeded bench carries one linked
graduation and one unlinked one, and the linked vessel's history shows the
crossing as it is actually kept: the act, and a link to the plant it made.

Home Assistant's calendar panel is the exception to framing on the card, because
the calendar entity is the one part of TC that is not in a card at all. Clip
past the calendar list on the left — `div.content` there is 1030x664 at
(250, 56) on a 1280x720 viewport — rather than photographing the sixteen
generated task calendars beside it.

The Camera Snapshots dialog opens on two tabs. **Captures** is empty on Demo
Tent and stays empty — the growspace is configured with climate and lighting
hardware, not cameras, so Home Assistant has no camera to snapshot. **Vision
evidence** is the one with the seeded history in it: model identity, frame
quality, baseline state, and the comparison against the camera's own recent
frames. That tab is Vision's subject; the empty one is nobody's.

## Where the files go

`assets/screenshots/` in every repository, kebab-case, `.png`, named for the
surface rather than for the story around it — `plant-dialog.png`,
`crop-steering.png`, `strain-library.png`, `logbook.png`, `mobile.png`. The
card's set is the one already in place.

The integration's single legacy image lives at
`images/growspace_manager_card_example.png` and is replaced rather than kept.

**Delete what a new set supersedes, in the same commit.** These are large files
— the card's current six are ~2.9 MB — and an orphaned set is not free, is not
obviously orphaned six months later, and has twice needed a `chore(assets): drop
the superseded screenshot set` commit of its own. Check for other references
before deleting: the card's Remotion walkthrough under `video/` requires
screenshot paths directly, and a delete that ignores it breaks that build
without failing CI.

## The README shape

The card's [README](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/main/README.md)
is the reference implementation. The shape is:

```markdown
# <Repository>

<the one-paragraph intro that was already there>

![<alt text>](assets/screenshots/overview.png)
_A sentence or two, in italics, saying what the reader is looking at._

...

## Screenshots

### <Surface>

One or two sentences of prose explaining what is on screen and what it means.
Not a click path.

![<alt text>](assets/screenshots/<surface>.png)
```

The hero goes directly under the intro paragraph, above the badges' fold and
above any table of contents. The `## Screenshots` section goes after the feature
prose and before installation — a reader who has decided to install does not
need convincing any more.

A README that puts installation first has no such position, and TC's does. There
the section goes after the prose that names the concepts its captions use and
before the reference material at the end — for TC, after "The calendar, missing
phenotypes, and your data" and before "V1 boundaries". The rule being kept is
the one the ordering exists for: the hero convinces, and the captions land where
the reader has just met the words they are written in.

Mobile is the one exception to the plain image link: a full-height phone capture
is 800px wide and 1700px tall, and GitHub renders it as a tower. Constrain it:

```markdown
<img src="assets/screenshots/mobile.png" alt="Mobile layout" width="360" />
```

## What each repository photographs

The same instance, with a different emphasis per repository. **Four sets of the
same five pictures is the failure mode this rule exists to prevent.** Where two
repositories do photograph the same screen — and the card and the integration
will — the caption has to be about a different thing, because the reader arrived
for a different reason.

| repository | what its captures are about |
|---|---|
| **card** | the interface. The grid, the dialogs, what a click opens, how it reflows on a phone. Captions describe what the user sees and does. |
| **integration** | what the backend provides. The entity model, the services, the Bayesian analytics, crop steering as a computed thing rather than a dialog, post-harvest tracking, label printing. Captions describe what the integration is doing underneath. |
| **TC** | the culture model. A culture line, the replate worklist and its ninety-day calendar, a missing phenotype, a graduation crossing back into Growspace Manager. Captions explain the model, not the click path. |
| **Vision** | the service, as the only place a user can see it working. The Vision evidence tab: a verdict, a baseline that is ready or still counting toward its thirty samples, calibration, fusion. Captions connect the screen to the concepts the README already explains. |

A capture of a state that is hard to reach is worth more than a second capture
of a clean one. A baseline that has not reached its sample count, a TC line
pointing at a phenotype nobody grows, a graduation whose bridge back failed —
the README prose already claims these states exist, and a picture is what makes
the claim land. Demo Tent is seeded to contain them on purpose.

## Before you commit

- [ ] Every image is Demo Tent on the live instance, not the Pages demo and not
      an E2E fixture.
- [ ] Dark theme, 1280x720 or 390x844, 2x, framed on the card.
- [ ] Every README image link resolves.
- [ ] The set this one supersedes is gone, and nothing else referenced it.
- [ ] The captions say something the neighbouring repository's captions do not.

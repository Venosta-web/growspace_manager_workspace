# What proves the TC dialog works, and what releasing it requires — issue #156

Decision for [#156](https://github.com/Venosta-web/growspace_manager_workspace/issues/156),
part of the specification map
[#149](https://github.com/Venosta-web/growspace_manager_workspace/issues/149).
It specifies future implementation and changes no product code. It is the last
grilling ticket on the map and answers for the whole of it, so it reads the
acceptance cases of
[#154](https://github.com/Venosta-web/growspace_manager_workspace/issues/154)
and [#155](https://github.com/Venosta-web/growspace_manager_workspace/issues/155)
and the lifecycle table of
[#152](https://github.com/Venosta-web/growspace_manager_workspace/issues/152)
as its input.

## Decision

Five answers, in the order they matter to a session that has to build this.

1. **The validator rule is part of this work, and it lands first** — as its own
   card pull request, before any dialog code. It passes today, measured, so it
   is a guard being installed rather than a regression being fixed.
2. **Nine vitest files carry the proof**, three of which catch something nothing
   else would. Two of the three must be alone in their file, for the reason
   `growspace-tc-card.lazy.test.ts` already documents.
3. **No screenshot baseline is involved.** The `__screenshots__` churn a session
   will see is failure captures, not references — 3213 of the card's 3250
   tracked PNGs sit under a test file that never calls `toMatchScreenshot`.
   Do not add a baseline for this dialog either.
4. **No Playwright spec.** The managed E2E runtime cannot install TC at all, the
   suite is a main-only gate that this work's prereleases never reach, and the
   fixture surface for TC data does not exist. The hub's E2E entity coverage
   contract needs **nothing**: TC contributes no entities and the dialog reads
   none. One line of the E2E page object changes anyway.
5. **Three ADRs in the card repository**, numbered against `origin/dev` at merge
   time — the first free number moved from 0054 to 0055 during this ticket.

## 1. The validator rule

### The hole, measured

`scripts/entry-bundle-shape.mjs` asserts two things: the entry bundle imports
nothing statically (`:42-59`), and no chunk statically imports the entry
(`:71-84`). Chunk-to-chunk edges are never examined, and #150's finding is that
the house pattern for a dialog is a static import — all 23 dialogs in
`growspace-dialog-host.container.ts:86-110` are written that way.

Chunk-to-chunk static imports are not, however, a smell to ban. The emitted
graph of the current build:

| chunk | statically imports |
| --- | --- |
| `growspace-manager-card.js` (entry) | — |
| `growspace-growspace-dialog-host.container-*.js` | `growspace-config-dialog-*.js`, `growspace-environment-ramp-*.js` |
| `growspace-heatmap-3d-*.js` | `growspace-environment-ramp-*.js` |
| seven `*-card-editor-*.js` | `growspace-growspace-options-controller-*.js`, `growspace-editor-utils-*.js` |
| `growspace-tc-*.js` | — |
| every other chunk | — |

The dialog host already does to the config dialog exactly what TC must never
have done to it: `config-dialog` has a `LAZY_CHUNKS` entry, is emitted as its
own file, is named in the release validator's required-chunk list — and is
statically imported by the dialog-host chunk
(`growspace-dialog-host.container.ts:92`), so opening any dialog fetches it.
That is correct there; `growspace-subarea-card.ts:534` is the dynamic caller
that keeps it a separate file at all. It is the proof that **a `LAZY_CHUNKS`
name says nothing about whether another chunk pulls the file in eagerly**, and
that the mistake #150 predicted is one the codebase has already made once, for
good reasons, with every check green.

So the rule is not "chunks may not import chunks". It is: **a chunk may declare
that nothing else may statically import it**, and TC's view chunk is the one
that declares it.

### Shape

In `src/lib/lazy-chunk.ts`, beside the `name` the release validator already
reads out of this file:

```ts
tcView: {
  name: 'tc',
  feature: 'The tissue culture view',
  // Nothing else may statically import it. A dashboard without Growspace
  // Manager TC must not pay for TC — TC ADR-0003, map #149.
  onDemandOnly: true,
},
```

In `entry-bundle-shape.mjs`, a sibling of `declaredLazyChunkNames` (`:89-96`)
reading the same source text, and an assertion built on the existing
`staticDependencies` (`:30-35`):

```js
export function declaredOnDemandOnlyChunkNames(registrySource) { /* … */ }

export function assertOnDemandChunksAreNotImported({ chunks, onDemandFileNames }) { /* … */ }
```

In `validate-hacs-release.mjs`, after the required-chunk loop that already
resolves a declared name to an emitted file (`:36-53`) and beside the two
existing assertions (`:55-70`). The failure message names the importing chunk,
the imported one, and the fix: make it a dynamic `import()`.

Tests go in `scripts/entry-bundle-shape.test.mjs`, which `npm run test:ci-policy`
runs and CI's Lint & Build job runs at `.github/workflows/lint.yml:32-33` — on
every push and pull request to `main` and `dev`.

### What it cannot catch, and what covers that

The rule reads emitted file-name edges. If a future contributor statically
imported a TC *sub*-module rather than the chunk entry — `import
'../../tc/containers/growspace-tc-view.container'` — rollup would find that
module reachable from two entry points and hoist it into a third, shared chunk
that both the dialog host and `growspace-tc-*.js` import. No edge from the
dialog-host chunk to `growspace-tc-*.js` would exist, and this rule would pass
while the view was eager.

That variant is caught by the vitest module-graph test in §2, at source level,
where the hoist has not happened yet. **The two guards are complements, not
belt-and-braces**, and neither is optional.

The exhaustive alternative — asserting over `chunk.moduleIds` in a rollup
`generateBundle` hook, which sees module provenance directly — is rejected. It
would have to live in `rollup.config.js`, and the whole point of the
bundle-shape checks is that they do not trust that file: their own header says
they assert on the emitted bytes rather than on the config, because the
regression they exist to catch is a one-character config change the build
reports as success.

The remaining gap after both guards is a TC module that registers no custom
element being statically imported and hoisted. Its cost is kilobytes, not
behaviour, and neither guard is worth complicating for it.

### Why first, and why alone

It passes against today's build — nothing imports `growspace-tc-*.js` — so it
is mergeable on its own the day it is written, and it is the only artifact of
this map that makes #149's central constraint real rather than aspirational.
Landing it after the dialog would mean the dialog's defining property was never
once verified by anything.

## 2. The vitest files

`./scripts/check card fast` runs `npm test`, which is the whole browser suite;
that is the loop an implementing session lives in. Batches are glob-derived
(`scripts/browser-test-batches.mjs`), so a new file under `tests/cards/`,
`tests/components/` or co-located in `src/` is picked up with no list to edit.
Placement follows card ADR-0004: pure modules co-locate, DOM-mounting tests live
in `tests/` — with the standing exception that the dialog host's and header's
own tests are already co-located and mount, so TC's additions to them stay
there.

### The three that matter

| file | proves | pattern |
| --- | --- | --- |
| `src/features/ui/containers/growspace-dialog-host.tc-lazy.test.ts` **(new, alone)** | importing the dialog host defines `growspace-dialog-host` and **not** `growspace-tc-view` or `growspace-tc-cultures` | `tests/cards/growspace-tc-card.lazy.test.ts` verbatim, one host over |
| `tests/components/growspace-tc-view.test.ts` (extend) | a rendered surface stays mounted across a tab switch: an open Culture Medium draft and an open maintenance action survive, and the hidden surface is still in the shadow root | #154 acceptance 2, the ADR-0019 exception |
| `src/features/ui/containers/growspace-dialog-host.tc-chunk.test.ts` **(new, alone)** | with `loadLazyChunk` mocked to `null` the dialog still opens, its content pane holds `growspace-lazy-chunk-error` naming `growspace-tc-*.js`, and Escape still closes it | `tests/cards/growspace-tc-card.chunk-missing.test.ts` |

The first two are the only automated statement of the two constraints this map
was chartered to protect. The third is the one user-visible failure HACS
actually produces, and the standalone card is already held to it.

**Both new files must be alone in theirs**, for the reason
`growspace-tc-card.lazy.test.ts` states in its own comment: a sibling test that
renders a present TC defines the element and makes the assertion vacuous. The
chunk-missing file is separate from the lazy file for the same reason in
reverse — it mocks `loadLazyChunk` and must not be the file that also claims
nothing was loaded. Follow the existing mock discipline exactly: replace only
`loadLazyChunk`, spread `importOriginal()` for the rest, so `LAZY_CHUNKS` and
`lazyChunkMessage` stay real and the message asserted is the message a user
reads.

### The rest

| file | covers |
| --- | --- |
| `src/slices/tc/tc-surfaces.test.ts` (new, pure) | `tcSurfaces()`: `[]` for a featureless manifest, one missing feature omits exactly one surface, stable order — #154 acceptance 4 and 5 |
| `src/slices/ui/dialogs.test.ts` (extend) | `openTcDialog()` writes `{ type: 'TC', payload }`; `growspaceId` and `portalId` reach it — #155 acceptance 1, 10 |
| `src/features/ui/containers/growspace-header.container.test.ts` (extend) | `case 'tc'` in the action switch, in the "cog menu actions" describe that already locks every other action's wiring; and the `StoreController` requirement — the item appears when `tcPresence$` resolves on an otherwise idle dashboard, which a bare `.get()` fails |
| `src/features/ui/components/growspace-header-actions-ui.test.ts` (extend) | the item's label, its `data-action`, its place in Setup after Strains, and its absence while presence is `unknown` or `absent` — the "EC Ramp Curves menu item" describe at `:35-59` is the negative-presence pattern to copy |
| `src/features/ui/containers/growspace-dialog-host.container.test.ts` (extend) | the portal cases, in the `render() multi-instance portal guard` describe at `:486-542` that #155 already names — two portals, TC opened from the second; and an absent `portalId` failing open |
| `tests/components/growspace-tc-cultures.test.ts` (extend) | an action opened from the Worklist returns to the Worklist; introduction and action both replace content — #154 acceptance 3 |
| `tests/cards/growspace-tc-card.test.ts` (extend) | `plant-view-requested` reaches the card and it navigates as the `<a>` does today — #154 acceptance 7's card half; the dialog half belongs to the host's own file |

The Culture Medium extraction moves `tests/components/growspace-tc-medium-library.test.ts`'s
subject into a new container and must not change what it asserts; that is what
"behaviour-preserving by construction" has to mean in review. The `devices$`
re-subscribe leak (#154 acceptance 8) is a **prerequisite ticket against the
card**, not this work — its test lands with its fix.

## 3. Screenshots

**No baseline is involved.** Thirteen files in the card call
`toMatchScreenshot`; none of them is a TC file, a dialog-host file or a header
file, and nothing in this map's acceptance cases is a pixel.

What a session *will* see is `__screenshots__` churn, and it is worth knowing
what it is. The card tracks 3250 PNGs under `__screenshots__/`; only 37 of them
sit under a test file that calls `toMatchScreenshot`. The rest are Vitest
browser-mode **failure captures** that were committed —
`src/dialogs/batch-clone-dialog.test.ts` has twelve tracked PNGs and zero
screenshot assertions. They are written on failure, so `retry: 2` and a flaky
run leave stray files behind, and they are not deleted when the test starts
passing. One landed in an ordinary irrigation pull request four commits ago.

The rule for an implementing session, which is what the hub's note about
rewritten baselines amounts to:

```bash
git status --porcelain -- '*__screenshots__*'
```

Never `git add -A` in this repository. Revert or delete stray `.png` before
committing; nothing in this work should change one.

**Do not add a visual baseline for the dialog.** #153's 920 × 720 desktop cap
and full-width mobile are asserted more cheaply and more legibly as the
`containerStyle` values passed to `gs-dialog` than as a pixel comparison — and a
new reference PNG in a corpus that is 99% failure noise is a file nobody will be
able to tell apart from the noise.

## 4. E2E, and the entity coverage contract

**The hub's E2E entity coverage contract needs nothing.** It declares simulated
*entities* and the capability profiles that own them, generated into
`ha-dev/packages/e2e_simulated_sensors.yaml`, `docs/E2E.md` and the card's
committed fixture. TC contributes no entity to a growspace, and #151 established
that the TC view reads no `hass` at all — its data arrives over TC's own
WebSocket namespace. So no declaration changes, `./scripts/gen-e2e-sensors` is
not run, and `./scripts/check-e2e-coverage` cannot drift because of this work.
A TC-installed dashboard is not something the fixtures cover, and it does not
need to be.

**No Playwright spec, for four reasons that compound.**

1. **The managed runtime cannot install TC.** `scripts/e2e-runtime-harness.mjs:360`
   mounts exactly one custom component — `growspace_manager` — and discovers
   exactly one sibling checkout (`:117-126`), validated at `:158-166`. A TC spec
   needs a second mount, a second discovery, a second validation, and a config
   entry created through TC's flow. TC's flow is a no-input confirm
   (`config_flow.py`), so the last part is three lines; the harness change is
   not.
2. **It would never run where this work lands.** ADR-0025 makes the E2E suite a
   main-only release gate — `e2e-frontend.yaml` has no `push` or `pull_request`
   trigger and is invoked by `release.yml` only for `main`. Every release this
   map produces on the way is a dev prerelease.
3. **The data does not exist.** A meaningful spec needs culture lines, media and
   a due worklist. TC owns its own storage; `tests/e2e/fixtures/e2e-setup.ts`
   knows nothing about it, and inventing a TC fixture surface is larger than
   the dialog.
4. **What it would prove is what a human proves in one pass**, in §5, in about
   four minutes — and the one property worth asserting on every build is not
   reachable by a browser at all. "A dashboard without TC never fetches the
   chunk" is a statement about the bundle graph, and §1's rule decides it in a
   second, for every build, on every pull request to `main` and `dev`.

**One E2E file changes anyway.** `tests/e2e/pages/GrowspaceCard.ts` carries a
`MenuAction` union documenting "the `data-action` of every entry in the card's
header menu" so a renamed action fails to typecheck instead of timing out.
Add `'tc'` to it, with a comment that it renders only when TC is present. A
union that claims to be exhaustive and is not costs one line to keep honest.

If a spec is wanted later, it is a follow-on ticket, and its body is item 1
above.

## 5. The hand check

The dev instance is already the negative case, which is the useful part:
`scripts/ha` mounts the main TC checkout's component automatically (`:25-39`),
so TC's code is present at `:8123`, but `ha-dev/.storage/core.config_entries`
holds no `growspace_manager_tc` entry — so `detectTc()` gets `unknown_command`,
presence is `absent`, and no menu item renders. Both halves of the check are
therefore reachable from one runtime, and putting it back is deleting an
integration.

Run from the **main hub checkout**, never from a worktree:

```bash
GROWSPACE_CARD_DIST=./worktrees/<name>/card/dist ./scripts/ha dev restart
```

`GROWSPACE_TC_SRC` is only needed if the branch also changes TC, which #149
forbids — the card is the only thing under test here.

**Without TC, which is the case that matters.** Open a dashboard with the
manager card, open DevTools → Network, filter `growspace-tc`, and:

- reload: no request, and no "Tissue Culture" in the three-dot menu;
- open any other dialog — Config is the sharpest, since its chunk is fetched
  through the dialog host: still no `growspace-tc-*.js` request.

The second bullet is the whole point. It fails the day someone writes the
static import, and it fails silently: the menu item is still absent, the dialog
still works, and the only symptom is a file in the Network tab.

**With TC.** Settings → Devices & Services → Add Integration → Growspace
Manager TC (it takes no input), then **reload the browser** — presence is
cached for the life of the page by design (#152), so a restart without a reload
proves nothing. Then: the item appears in Setup after Strains; opening it fetches
`growspace-tc-*.js` exactly once; a standalone TC card on the same dashboard
adds no second request; tab switches fetch nothing; and a maintenance action
opened from the Worklist returns to the Worklist.

**The stale-chunk case** is the one thing the runtime shows better than any
test: rename `dist/growspace-tc-*.js`, hard-reload, open the dialog. The frame
must open and hold the error naming the file. Restore the name afterwards, and
remember `./scripts/ha dev restart` after any rebuild that recreates `dist/`.

## 6. ADRs

Three, in the card repository. **Numbers are allocated against `origin/dev` at
merge time, not against a local checkout** — `docs/adr/` already carries three
collided numbers (0032, 0046, 0047) from parallel branches, and 0054 was taken
by an irrigation change during this ticket. First free at the time of writing is
0055.

| ADR | subject | why it must exist |
| --- | --- | --- |
| **TC surfaces stay mounted — the ADR-0019 exception** | ADR-0019 licenses a tabbed dialog to unmount inactive tabs because a Tab Component owns nothing. TC's surfaces own their fetches, drafts and subscriptions and have a second host with no dialog. | Demanded by #154. A contributor decomposing this dialog by the ADR-0019 recipe would break the standalone card without noticing, and ADR-0019 reads like permission. |
| **A chunk may declare that nothing else statically imports it** | The registry flag, the release-validator rule, the source-level test that covers its blind spot, and why a blanket chunk-to-chunk ban is wrong. | The rule looks like pointless ceremony next to `config-dialog`, which does the forbidden thing legitimately one line away. Without the reasoning written down it gets relaxed. |
| **TC presence is one probe per page, answered for the page's lifetime** | Installing TC and not seeing the menu item until reload is deliberate; a transient probe failure is cached too. | The most plausible "bug report" this feature will ever receive, and the obvious fix — poll, or invalidate on reconnect — is the one #152 forbids. It records existing `detectTc()` behaviour that the menu item makes user-visible for the first time. |

**Deliberately not ADRs.** `portalId` in the payload (#155) is a scoped
workaround for [card#913](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/913);
an ADR would freeze it, and it becomes redundant when the portal guard is fixed
— a comment at the field and a note on card#913 is the right weight. The tabbed
layout (#153) follows the existing convention and contradicts nothing. The seam
staying at the view's property interface (#154) is ADR-0001's slice/host
boundary applied, not amended. And TC ADR-0003 in the TC repository already
states the "users without TC download nothing eagerly" consequence — the new
validator rule makes that sentence enforceable rather than replacing it, so it
needs no amendment, and #149's card-only constraint means it gets none.

## 7. What releasing it requires

| stage | what runs | catches |
| --- | --- | --- |
| pull request to `dev` | `Lint & Build` (eslint, typecheck, `test:ci-policy`, tokens, **build + `validate:hacs-release`**), `Test` (browser suite), `Contract fixture`, `PR Title` | everything in §1 and §2 |
| push to `dev` | `Release` → prerelease, no `needs` — deliberately ungated (ADR-0025) | — |
| post-publish | `hacs-update-check.yaml` → the hub's `card-release-update-check` | a chunk graph the previous release's file set cannot serve |
| promotion to `main` | lint, unit, contract fixture, **e2e** | the gate this work never reaches until promotion |

Three things follow.

**The bundle assertion is a pull-request gate, not a release-time one.**
`validate:hacs-release` runs in `Lint & Build` after `npm run build`
(`lint.yml:47-51`), which fires on pull requests to `main` and `dev`. So §1's
rule fails the pull request that breaks it, which is the only placement worth
having.

**A stacked pull request gets no checks at all.** Every card workflow triggers
on `pull_request: branches: ['main', 'dev']`. A pull request from one feature
branch onto another — the natural shape for "validator rule, then dialog" —
reports nothing. Either target `dev` with each piece, or run
`./scripts/check card full` locally and say so in the description; a green
badge that is really an absent one is the failure mode here.

**The post-publish check already sees the TC chunk, and must keep seeing it.**
`scripts/card-hacs-update` follows `import()` as well as static imports when it
walks the entry's module graph over HTTP, so `growspace-tc-*.js` is already in
the reachable set through the standalone card's dynamic import. Done correctly,
the dialog adds a second dynamic edge to the same file and the graph gains no
node: the file count and module list in
`artifacts/card-hacs-update/<from>-to-<to>.json` are unchanged. A *new* file
appearing there means a second chunk was emitted — which is #155's "no new
`LAZY_CHUNKS` entry" being violated.

**One gap in this hub, worth closing with the same work.** `scripts/check`'s
card stages claim to mirror `lint.yml`'s job in its order, and omit
`npm run test:ci-policy` — so `./scripts/check card full` exercises §1's rule
against real `dist/` output but never runs the rule's own unit tests. Add it
between `typecheck` and `format:check`. One line, in `check_card`
(`scripts/check:92-112`).

## What "done" means

1. The validator rule, its registry flag and its `entry-bundle-shape.test.mjs`
   tests are merged, and `npm run test:ci-policy` is in `scripts/check`'s card
   stages.
2. The nine vitest files in §2 exist or are extended, with the two new
   dialog-host files alone in theirs.
3. `git status --porcelain -- '*__screenshots__*'` is empty at commit time.
4. `'tc'` is in the E2E `MenuAction` union.
5. The three ADRs are in the card repository, numbered against `origin/dev`.
6. The §5 walkthrough has been done by a human on `:8123`, both halves, with the
   Network tab open — including the stale-chunk rename.
7. The `devices$` re-subscribe leak is filed against the card and fixed before
   the dialog ships.

## Evidence

Read against card `origin/dev` at `a24bbf66` (fetched), TC main at its current
tip, and this hub at `e6086df`. The emitted-graph measurement was taken from the
`dist/` in the main card checkout, built from `dev` at `64075df5`; the four
commits it is behind touch irrigation and E2E only, and no TC, dialog-host or
`lazy-chunk` file among them.

- `scripts/entry-bundle-shape.mjs:12`, `:30-35`, `:42-59`, `:71-84`, `:89-96` —
  the parser, the two existing assertions, and the registry reader the new rule
  is a sibling of.
- `scripts/validate-hacs-release.mjs:36-53` (declared name → emitted file),
  `:55-70` (where the new call goes).
- `src/lib/lazy-chunk.ts:34`, `:87-91` (the `tcView` entry), `:116-126` (the
  memo the two hosts share).
- `src/features/ui/containers/growspace-dialog-host.container.ts:86-110` (23
  static dialog imports), `:92` (the config-dialog one), and
  `src/cards/growspace-subarea-card.ts:534` (the dynamic caller that keeps
  config-dialog a chunk).
- Emitted static-import graph of all 18 files in `dist/`, parsed with
  `staticDependencies` — the table in §1.
- `tests/cards/growspace-tc-card.lazy.test.ts` (the alone-in-its-file rule, in
  its own words), `growspace-tc-card.chunk-missing.test.ts` and
  `growspace-tc-card.wrapper-chunk-missing.test.ts` (the mock discipline).
- `src/features/ui/containers/growspace-dialog-host.container.test.ts:486-542`
  (the portal-guard describe to extend),
  `growspace-header.container.test.ts:29-31` (the cog-menu action wiring),
  `src/features/ui/components/growspace-header-actions-ui.test.ts:35-59` (the
  negative-presence pattern).
- `scripts/browser-test-batches.mjs` — batches are globs; no list to edit.
- `vitest.config.ts:42-46` (`toMatchScreenshot`'s pixelmatch settings),
  13 files calling it, 3250 tracked PNGs, 37 of them under such a file.
- `scripts/e2e-runtime-harness.mjs:117-126`, `:158-166`, `:360` — one component
  mounted, one sibling discovered.
- `e2e/entity_coverage.py:1-12` (the four consumers), and TC's
  `custom_components/growspace_manager_tc/config_flow.py` (the no-input flow).
- `tests/e2e/pages/GrowspaceCard.ts:5-26` — the `MenuAction` union, added on
  `origin/dev` at `a0281533`.
- `.github/workflows/lint.yml:7-8`, `:32-33`, `:47-51`; `test.yml:7-8`;
  `e2e-frontend.yaml:3-7` (no push or PR trigger); `release.yml:19-40`; `hacs-update-check.yaml:12-16`.
- `scripts/ha:25-39` (TC auto-mount), `ha-dev/.storage/core.config_entries` (no
  TC entry), `scripts/check:92-112` (the card stages, and the missing one),
  `scripts/card-hacs-update:128-141` (the specifier patterns, `import()`
  included).
- Card `docs/adr/0004-test-co-location-split-by-purity.md`,
  `0019-decompose-dialogs-into-per-tab-viewmodel-adapters.md`,
  `0025-ci-merge-gate-and-e2e-on-main-only.md`; TC
  `docs/adr/0003-ui-is-a-lazy-chunk-in-the-existing-card.md`.

No tests were run for this documentation-only decision; no runtime or bundles
changed. The one command executed against a build was a read-only parse of
`dist/` with the repository's own `staticDependencies`.

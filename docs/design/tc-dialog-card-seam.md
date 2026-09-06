# The seam between the TC dialog and the standalone TC card — issue #154

Decision for [#154](https://github.com/Venosta-web/growspace_manager_workspace/issues/154),
part of the specification map
[#149](https://github.com/Venosta-web/growspace_manager_workspace/issues/149).
It specifies future implementation and changes no product code. It follows
[#151](https://github.com/Venosta-web/growspace_manager_workspace/issues/151)
(what the view requires of a host),
[#152](https://github.com/Venosta-web/growspace_manager_workspace/issues/152)
(presence and probe ownership) and
[#153](https://github.com/Venosta-web/growspace_manager_workspace/issues/153)
(the tabbed dialog), and hands constraints to #155 and #156.

## Decision

`growspace-tc-view` stays the one component both hosts mount, and the seam stays
at its property interface. #151 found that seam already correctly placed; #153's
tabbed layout does not move it, because **the four tabs are the four surfaces
the view already composes** — the dialog needs the view to show one of them at a
time, not to be taken apart.

The interface grows by exactly three things and loses none:

| addition | direction | why |
| --- | --- | --- |
| `surface?: TcSurfaceId` | in | which surface to show; omitted means all of them, stacked — today's card render, unchanged |
| `plant-view-requested` | out | replaces the `<a href="?plantId=">` full-page navigation, which the two hosts must answer differently |
| `--growspace-tc-view-padding` | CSS | the host tunes the view's `padding: 16px` without a JS property |

Beside them, one pure function in the **already-eager** TC slice:

```ts
export type TcSurfaceId = 'worklist' | 'cultures' | 'media' | 'pairings';
export function tcSurfaces(manifest?: TcManifest): TcSurfaceId[];
```

It is the single answer to "which surfaces does this installation offer, in what
order". The view uses it to compose; the dialog uses it to build its tab bar.
One implementation, two callers — which is the whole reason the two hosts cannot
disagree about what Tissue Culture contains.

Everything else is host-owned and stays that way: chrome, container geometry,
scrolling, tab selection, and what a plant link means.

## What each side owns

| concern | owner | where |
| --- | --- | --- |
| TC presence and the manifest | the TC slice (#152) | `tcPresence$`, one deduped probe per page |
| which surfaces exist for a manifest | the TC slice | `tcSurfaces(manifest)` |
| surface content, fetching, drafts, actions | the shared view and its surface containers | the `growspace-tc` chunk |
| the featureless compatibility state (#152) | the shared view | rendered whatever `surface` says |
| which surface is showing | the host | `surface` in |
| tab bar, title, close, backdrop, focus trap | the host | `gs-dialog` + the dialog's own `.tab-bar` |
| width, height, what scrolls | the host | `ha-card` / `gs-dialog`'s container |
| what a plant link does | the host | `plant-view-requested` handler |

**Nobody fetches the manifest for the dialog.** The dialog host subscribes to
`tcPresence$` — the same atom the header's menu item reads — and passes
`presence.manifest` down. It must not re-probe, and the manifest must not travel
in the open payload: ADR-0027's payload discipline is about *targeting* the
dialog, and TC presence is a page-global fact, not a per-dialog one.

## Why the tabs do not fork the component

Today the view renders its four surfaces stacked, and three of them are already
separate elements. The tabbed dialog needs the same four, one at a time. Two
things stand between here and there, and both are small.

**The Worklist and the Culture Board are one element.**
`growspace-tc-cultures` holds both, and holding both is why it works: one fetch
of the culture lines, one strain-library join, one clock the worklist is judged
against, and one action state that either pane can open
(`growspace-tc-cultures.container.ts:153-187, 204-217, 259-261, 271-294,
437-466`). Splitting it into two elements would duplicate all four. So it does
not split — it gains the same `surface` property and renders one pane or both
from the state it already has. The dialog's two tabs are one mounted element
showing two faces, which is also what makes an action opened from the Worklist
tab return to the Worklist tab with nothing reloaded.

**The Culture Medium library has no container of its own.** It lives in the view
container itself — `_media`, `_editing`, `_pendingDelete`, `_saving`,
`_saveError`, `_load()` and `_renderMediumLibrary()`
(`growspace-tc-view.container.ts:47-56, 138-146, 156-223, 284-308`). So the view
is currently two things at once: the composition of TC's surfaces, and one of
those surfaces. Extract it to `growspace-tc-media.container.ts`, mirroring
`growspace-tc-cultures` and `growspace-tc-pairings`. The extraction is
behaviour-preserving, and it leaves the view holding no `@state()` at all — a
pure function of its properties, which is what makes it safe to mount in two
hosts that agree on nothing else.

After both, the view is a composition of four peer containers, and `surface`
selects among them.

## The rule the implementation must not break

**A surface that has been rendered stays mounted.** Selecting a tab hides the
others; it does not unmount them.

This is not a preference. Every TC surface owns its own fetch, subscriptions and
drafts, so unmounting one drops an in-progress Replate, a half-typed Culture
Medium, a Pairing edit, the culture-line fetch, and the clock the worklist is
judged against — and `growspace-tc-view.container.ts:142` latches `_requested`,
so the medium fetch does not come back on remount. Implement `surface` with
`hidden`, not with a conditional template branch. Mounting a surface lazily on
its first visit is a legitimate optimization; unmounting it afterwards is not.

Across *opens* the dialog still creates a fresh view, matching the card and
#151's finding 6.

## Conflict with ADR-0019

[ADR-0019](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/main/docs/adr/0019-decompose-dialogs-into-per-tab-viewmodel-adapters.md)
is the house shape for tabbed dialogs, and the TC dialog contradicts it head-on.
It requires a Tab Component to be dumb — `.vm` in, intents out, **no `@state()`
of its own** — with all draft state in the DialogStateMachine, and it says why:
"A Tab Component owns nothing, so the host may lazily render only the active tab
and unmounting on tab-switch loses no draft." That licence is exactly what the
rule above withdraws.

**Take the exception, and record it.** ADR-0019 governs the *internal*
decomposition of a dialog that owns its content — it says so in its own second
paragraph. TC's surfaces are not internal to this dialog: they predate it and
have a second host that has no dialog, no shell and no state machine. Hoisting
their state into a `TcDialogSM` would either fork them from the standalone card,
which is the one constraint #149 will not trade, or push a dialog state machine
into a card that has no dialog. Neither is worth ADR-0019's uniformity.

The consequences are contained and worth stating plainly: the TC dialog's state
machine holds tab selection and nothing else; its per-tab states are empty; its
`confirm-discard` status is unreachable, because the view exposes no dirty
signal (#151's finding 3) and the drafts it would guard are not the shell's to
see. #155 owns the final state shape — this ticket only forbids it from holding
TC draft state.

**This earns an ADR in the card repository**, since a future contributor
decomposing the TC dialog by the ADR-0019 recipe would break the shared
component without noticing. Name it in #156's ADR list.

## Where the chrome lives

`gs-dialog` (`features/shared/ui/gs-dialog.ts`) is the house chrome: the
`ha-dialog` wrapper, the glass container, and the header with icon, title,
subtitle, a `header-extra` slot and the close button. Thirteen call sites use
it. Its `--dialog-content-padding: 0` and `max-height: 85vh; overflow: hidden`
(`:27-31, 33-46`) mean the slotted content supplies its own padding and its own
scrollport — which is precisely the arrangement the view was already built for,
and it is why #151's "zero the 16px" turns out to be a non-issue: nothing
doubles it. Use `containerStyle` (`:20`) for #153's 920 × 720 caps rather than
editing the shell.

There is **no shared tab-strip component**. Six dialogs each render their own
`.tab-bar` as the first thing in the `gs-dialog` slot (`add-plant-dialog.ts:542`,
`logbook-dialog.ts:428`, `strain-library-dialog.ts:643`, `config-dialog.ts:2518`,
`harvest-scoring-dialog.ts:423`, `snapshots-dialog.ts:1926`). The TC dialog does
the same, from `tcSurfaces(manifest)`. `features/shared/layouts/base-dialog.layout.ts`
looks like the answer and is not: it renders a full dialog with a tab strip and
has **zero call sites** anywhere in `src/`. Do not adopt it here; adopting a dead
shell for the one dialog that also has a second host is how the seam gets
confused with the chrome.

So no chrome enters the `growspace-tc` chunk, in either direction: the card's
chrome is its `ha-card`, the dialog's is `gs-dialog` plus its own tab bar, and
neither is a thing the shared view knows about. The view continues to declare no
height and no overflow, which is the property that lets it live in both.

The host also **clamps the requested tab** to `tcSurfaces(manifest)`. An initial
tab that arrives in the open payload (#155) may name a surface this installation
does not offer; the host falls back to the first available one rather than
handing the view a `surface` it cannot render.

## Does the standalone card change?

Yes — a little in its own file, and visibly through the shared component. All of
it is in scope, because "one component" is not a property you can implement on
one side.

**In `growspace-tc-card.ts`: one handler.** The card gains a
`plant-view-requested` listener and keeps doing what the `<a>` does today. Its
render is otherwise untouched, because `surface` omitted is the stacked
composition it already gets.

That event is the one genuine host difference the seam exists to absorb, and it
is worth being precise about why. `growspace-tc-action-dialog.ts:392` renders
`<a href="?plantId=…">`: a full-page navigation, after which
`growspace-manager-card.ts:106-125` reads the parameter on load, strips it, and
calls `uiSlice.handleDeepLink(plantId)` (`slices/ui/dialogs.ts:136`) to open the
Plant Overview dialog. From inside the TC dialog that is absurd — the manager
card is on the page and `handleDeepLink` can be called directly, with no reload
and nothing destroyed. From the standalone card it is not absurd, because there
may be no manager card on the dashboard at all, and the reload is what makes the
link work. **The two hosts have different correct answers, which is what an
event at a seam is for**; TC has no business deciding how a plant gets shown.

**Through the shared chunk: one visible behaviour change and two invisible
ones.** #153 decided that actions replace content within the same modal and
return to their origin. Implemented where the action state lives — inside
`growspace-tc-cultures` — that reaches the card too, and should: today
`_acting.open` renders the action form *above* the still-visible worklist and
board (`:437-466`) while `_introducing` already *replaces* the whole render
(`:425-435`). Making the two consistent is the change #153 asks for, and #149's
"must not fork TC domain content or behavior" is the reason it lands on both
hosts rather than only in the dialog. The invisible two are the Media extraction
and the `surface` properties, both behaviour-preserving by construction.

**One prerequisite, not this map's scope.**
`growspace-tc-cultures.container.ts:179-187` unsubscribes in
`disconnectedCallback` and then immediately re-subscribes to `devices$`, leaking
a subscription per disconnect. A card never disconnects; a dialog disconnects on
every close. #151 reported this as ticketed separately — **it is not ticketed in
either repository**. File it against the card, and land it before the dialog
ships, or the leak becomes real the day the dialog does.

## Vocabulary

**TC Surface** — one of the four top-level panes of the Tissue Culture view:
Worklist, Cultures, Media, Pairings. Which of them exist is a function of the TC
manifest's features, never of the host. Distinct from the card glossary's
**Painted Surface**, which is a colour concept; if the spec adopts this term,
the card's `CONTEXT.md` should gain an entry for it, or the map's cross-context
vocabulary question (#149, "Not yet specified") should absorb it.

The four ids are stable and shared: they name the tabs, the `surface` property's
values, and `tcSurfaces()`'s return. A `TcSurfaceId` union makes the dialog's
id → label mapping and the view's id → element mapping exhaustive, so a fifth
surface cannot be added to one without the other failing to compile.

## Acceptance cases for implementation

1. `growspace-tc-card` renders with no `surface` and produces today's stacked
   view, byte-for-byte in behaviour: same fetches, same order, same states.
2. The dialog renders one surface at a time; switching tabs and switching back
   re-fetches nothing and loses no draft — assert this on the Culture Medium
   form and on an open maintenance action, not only on the board.
3. An action opened from the Worklist tab returns to the Worklist tab.
4. `tcSurfaces()` returns `[]` for a featureless manifest; the dialog renders no
   tab bar and the view renders #152's compatibility state; the card renders the
   same state.
5. A manifest missing one feature omits exactly that tab and that stacked
   section, from one function, in both hosts.
6. An initial tab naming an unavailable surface is clamped by the host to the
   first available one.
7. `plant-view-requested` reaches the card, which navigates as it does today;
   it reaches the dialog host, which closes the dialog and calls
   `handleDeepLink` without a page load.
8. Closing and reopening the dialog leaves no `devices$` subscription behind.
9. The view still holds no `@state()`, reads no `hass`, no context and no
   per-card store, and declares no height or overflow.
10. `growspace-tc` chunk contents are unchanged in kind: no `gs-dialog`, no
    `ha-dialog`, no tab bar, no dialog state machine inside it.

## Evidence

Read against card commit `a24bbf6666a29907bbc67b88d10b8dadf1c26a88`
(`origin/dev`, fetched). The four commits that branch carries beyond the local
checkout touch irrigation and E2E only; no TC file differs.

- `src/cards/growspace-tc-card.ts:74-77, 116-130, 132-147` — the host: probe,
  chunk load after the answer, and `manifest` + `language` down into the view.
- `src/features/tc/tc.ts:10-14` — the chunk registers two containers; a media
  container would be the third.
- `src/features/tc/containers/growspace-tc-view.container.ts:44-45` (the whole
  interface), `:47-56` (the state that belongs to the media surface), `:62-65`
  (the only layout it declares), `:113-123` (four feature gates, the seed of
  `tcSurfaces`), `:138-146` (the `_requested` latch), `:249-264` (#152's
  compatibility state), `:266-282` (the stacked composition), `:284-308` (the
  media surface with no container of its own).
- `src/features/tc/containers/growspace-tc-cultures.container.ts:153-187` (the
  subscriptions, and the re-subscribe leak at `:179-187`), `:204-237` (one fetch
  for both panes), `:259-261` (the worklist derived from the same lines),
  `:271-294` (action state), `:425-435` (introduction replaces content),
  `:437-466` (worklist and board in one render).
- `src/features/tc/components/growspace-tc-action-dialog.ts:392` — the plant
  link.
- `src/growspace-manager-card.ts:103, 106-125` and `src/slices/ui/dialogs.ts:136`
  — what that link resolves to, and the in-page operation the dialog can call
  instead.
- `src/slices/tc/index.ts:101, 104, 113, 696` (the feature constants, scattered),
  `:132-137` (presence union and atom). The slice is eager in the entry today,
  so `tcSurfaces()` costs no new chunk edge.
- `src/features/shared/ui/gs-dialog.ts:12-21, 27-46, 143-188` — the house chrome
  and its `containerStyle` escape hatch.
- `src/features/shared/layouts/base-dialog.layout.ts` — a complete tabbed dialog
  shell with zero call sites in `src/`.
- `src/features/ui/containers/growspace-dialog-host.container.ts:86-110` (23
  statically imported dialogs), `:184-291` (render and the dialog switch), `:207, 214-220` (the
  payload growspace id and the multi-instance portal guard).
- Card `docs/adr/0019-decompose-dialogs-into-per-tab-viewmodel-adapters.md` — the
  Tab Component rule and the unmount licence this decision withdraws.

No tests were run for this documentation-only decision; no runtime or bundles
changed.

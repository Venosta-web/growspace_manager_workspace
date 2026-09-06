# The TC dialog in the dialog host — issue #155

Decision agreed with the user on 2026-09-06. Part of the specification map
[#149](https://github.com/Venosta-web/growspace_manager_workspace/issues/149).
This document resolves [#155](https://github.com/Venosta-web/growspace_manager_workspace/issues/155);
it specifies future implementation and changes no product code.

It answers what the Tissue Culture dialog carries into the dialog host and how
it behaves there. Where the seam between the dialog and the standalone card
falls — what each host owns, and what the shared component exposes — is
[#154](https://github.com/Venosta-web/growspace_manager_workspace/issues/154)
and is deliberately not settled here.

## Decision

`{ type: 'TC'; payload: TcDialogState }` joins the `ActiveDialogState` union.
The payload carries the growspace id, an initial tab, a deep-link target and
the id of the portal that opened it. Live tab and action state is a
`DialogStateMachine` inside the lazy chunk, not in the payload. The host opens
the modal frame immediately and fills its content pane with a loading state,
then the view — or `<growspace-lazy-chunk-error>` when the chunk cannot load.
The portal that opened the dialog is the only one that renders it.

## The open payload

```ts
export type TcTabId = 'worklist' | 'cultures' | 'media' | 'pairings';

export interface TcDialogState {
  /** Target growspace, captured at open time (ADR-0027). */
  growspaceId?: string;
  /** Portal that opened this dialog; only that portal renders it. */
  portalId?: string;
  /** Which tab the dialog opens on. Unset means the worklist (#153). */
  initialTab?: TcTabId;
  /** Optional deep-link: a `data-scroll-target` value to scroll into view + pulse. */
  scrollToField?: string;
}
```

`growspaceId` is carried even though TC is not growspace-scoped, per the map's
standing constraint and ADR-0027: Graduation will need the growspace the menu
was opened from, and re-deriving it from ambient selection at that point is the
anti-pattern that ADR names. Nothing in the V1 dialog reads it, and nothing in
the dialog may filter TC data by it — the dialog shows all cultures (#153).

`initialTab` is a narrow union, not `IrrigationDialogState`'s `initialTab?:
string`. The tab set is fixed and small, the host has to hand it to the dialog
as a property, and a typo in a loose string silently falls back to the default
tab. The header menu item passes no tab, so an ordinary open leads with the
worklist.

`scrollToField` has exactly the `ConfigDialogState` semantics — a
`data-scroll-target` value inside the initial tab, scrolled into view and
pulsed on open (`dialogs/config-dialog.ts:162-163`,
`features/config/components/config-growlight-tab.ts:80-82`). It is a scroll
hint, not a selection and not a sub-view: a caller that wants a specific
culture or medium marks that row with `data-scroll-target` and names it here.
Reusing the existing mechanism is the point; do not invent a second deep-link
shape for TC.

Every field is optional so the payload has a legal empty form, matching
`IrrigationDialogState`. That is a type-level convenience, not a licence: the
opener always sets `growspaceId` and `portalId`.

## Tab and action state

The payload carries a **pointer**, never live state. `activeDialog$` is a
page-global atom (`store/ui/ui-store.ts:60`); putting the visible tab there
would make one card's navigation everybody's, which is the class of bug
#406–#408 fixed and ADR-0027 warns about.

So the dialog follows the `DialogStateMachine` convention #153 chose, in the
same shape as the config and irrigation dialogs:

- a `DialogStateMachine<TcTabId, TcTabStates>` (`dialogs/dialog-sm.ts:6-17`)
  owns `activeTab`, per-tab drafts, the `confirm-discard` and `applying`
  statuses, and the toast;
- the state machine module ships **inside the `growspace-tc` chunk**, not in
  `src/dialogs/`, so nothing about TC's tab states reaches the dialog-host
  chunk;
- the host passes `.initialTab` and `.scrollToField` as properties and the
  dialog seeds its machine from them, exactly as
  `growspace-dialog-host.container.ts:1031-1032` and `:1282-1283` already do
  for config and irrigation;
- a maintenance action is a content sub-view within the same modal (#153), so
  it is a state in that machine, not a second `ActiveDialogState` entry and not
  a nested dialog. `growspace-tc-action-dialog` is an inline `<form
  role="dialog">` despite its name (#151 §5), so no dialog-inside-a-dialog case
  arises.

A fresh element per open. The view holds a `_requested` fetch latch
(`growspace-tc-view.container.ts:142`) that only bites a host reusing one
element across opens (#151).

## Loading, and a chunk that will not load

The opener sets `activeDialog$` **before** the chunk is fetched. The host
renders the `gs-dialog` frame — heading, close affordance and the tab
navigation, all of which are already in the dialog-host chunk that just
loaded — and in the content pane:

| chunk state | content pane |
| --- | --- |
| in flight | a localized loading line, the view's own idiom (`<p class="supporting">`, new key `tc.view_loading`) |
| resolved | the TC view |
| `null` | `<growspace-lazy-chunk-error .chunk=${LAZY_CHUNKS.tcView}>` |

The click always produces a dialog. A menu item that silently opens nothing for
the length of a network fetch is indistinguishable from a broken one, and a
stale-HACS failure has to be reported where the user was reaching — the same
contract `growspace-tc-card.ts:127,137-140` and
`tests/cards/growspace-tc-card.chunk-missing.test.ts` already hold the
standalone card to. Escape and the close affordance work in all three states.

### What sharing `LAZY_CHUNKS.tcView` with the standalone card means

Both hosts load the same chunk through the same entry, and `loadLazyChunk`
memoises the attempt by `chunk.name` (`lib/lazy-chunk.ts:106,116-126`). Four
consequences, all of them load-bearing:

1. **The second caller's loader is ignored.** Whichever host reaches the chunk
   first wins; the other gets that promise. The dialog's dynamic import must
   therefore resolve to the same module as the card's — `src/features/tc/tc.ts`,
   the chunk's existing entry (`features/tc/tc.ts:10-14`). Note that the
   *specifier text* cannot be identical from a different directory: the card
   passes `import('../features/tc/tc')` and a host under
   `src/features/ui/containers/` passes `import('../../tc/tc')`. What matters
   is the resolved module — rollup dedupes on that and emits one chunk.
2. **No new `LAZY_CHUNKS` entry.** A second name under which no chunk is
   emitted fails `npm run validate:hacs-release` outright
   (`scripts/validate-hacs-release.mjs:44-53`, with the entry's own shape
   enforced by `scripts/entry-bundle-shape.mjs`), and #150 measured that reusing
   `tcView` leaves the entry and the chunk byte-identical.
3. **A failure is diagnosed once per page**, by design
   (`lib/lazy-chunk.ts:120-123`). The dialog must not depend on a console error
   to explain itself: with the standalone card on the same dashboard the
   dialog's own attempt is the memoised `null` and prints nothing. Each host
   renders its own `<growspace-lazy-chunk-error>` from that shared `null` —
   the card in its `ha-card`, the dialog in its content pane.
4. **The loading state is a first-open state only.** After either host has
   loaded the chunk, the memo resolves within a microtask and the pane goes
   straight to the view.

Reaching this chunk means the presence probe already answered `present`
(#152), so a failure here is a stale install to report, never an absent
integration to hide.

## The portal guard, and what it does not currently do

`activeDialog$` is one page-global atom, and every manager card and grid card
mounts its own dialog-host portal (`growspace-manager-card.ts:143-144,163-197`,
`cards/growspace-grid-card.ts:88-96`). The existing guard at
`growspace-dialog-host.container.ts:214-220` suppresses a portal when the
payload's `growspaceId` is not in that portal's `devices`.

**That test cannot separate two portals on one dashboard.**
`makePerCardGridSlice()` computes `$activeDevices` from the page-global
`devices$` and filters only optimistically deleted plants
(`slices/grid/index.ts:304-322`); only `$selectedDevice` is per-card. So every
portal's `devices` contains every growspace, every portal passes the test, and
two carousel cards produce two stacked dialogs. It is a device-ownership guard
— useful before hydration, or for a portal whose collection genuinely lacks the
growspace — not an instance guard, and its comment overstates it.

The TC dialog therefore does not inherit a working guard, and cannot borrow
one: it is not growspace-scoped, so there is no growspace to discriminate on
even in principle.

**Decision: the payload names the portal.** `GrowspaceStore` gains a
`readonly instanceId: string`, minted per instance. A store is created once per
card and handed to both the header (through the store context) and that card's
portal (`growspace-manager-card.ts:193`), so the store instance *is* the portal
identity. The opener captures `store.instanceId` as `portalId`; the host
renders the TC dialog only when `payload.portalId === this.store.instanceId`.

This is ADR-0027's own principle — bind at open time, never re-derive from
ambient page state — applied to portal identity instead of growspace identity,
and it earns an ADR in the card repository alongside 0027.

Two rules on the edges:

- **Absent `portalId` fails open**: every portal renders, which is today's
  behaviour. A dialog that opens nowhere is worse than one that opens twice,
  and the field is absent only in tests, because the single opener always sets
  it.
- **Scope is TC.** Every portal still *mounts* on any dialog open, and the
  existing device-ownership guard stays exactly as it is for the other 23
  dialog types. Generalizing the token to the whole host — which would also
  retire the irrigation duplicate — is a separate change to the card. That
  duplicate is a pre-existing bug, filed as
  [card#913](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/913),
  rather than something this map fixes on the way past.

## The opener

```ts
export function openTcDialog(options?: {
  growspaceId?: string;
  portalId?: string;
  initialTab?: TcTabId;
  scrollToField?: string;
}): void {
  openDialog({ type: 'TC', payload: options ?? {} });
}
```

In `slices/ui/dialogs.ts`, beside the others. An options object rather than
positional arguments, matching `openIrrigationDialog`
(`slices/ui/dialogs.ts:256-262`) — the closest analogue, and the codebase's
positional openers are the ones that never grew a third argument.

`TC` as the discriminant, `tc` as the header action string: it matches
`LAZY_CHUNKS.tcView`, the emitted `growspace-tc-*.js`, and every TC symbol the
card already has.

The header container calls it from its action switch
(`features/ui/containers/growspace-header.container.ts:286-347`), in the shape
the neighbouring cases already use:

```ts
case 'tc':
  uiSlice.openTcDialog({
    growspaceId: this.device?.deviceId || undefined,
    portalId: this.store.instanceId,
  });
  break;
```

The menu item itself is `${this._menuItem(mdiFlaskOutline, 'Tissue Culture',
'tc')}` in the Setup section after Strains
(`features/ui/components/growspace-header-actions-ui.ts:636`), rendered only
when `tcPresence$` reads `present` (#152).

## What the payload deliberately does not carry

- **The `TcManifest`.** It is page-global installation state owned by the TC
  slice (#152), not a per-open snapshot, and copying it into a page-global
  dialog atom would create a second writer of the presence answer. Where the
  dialog reads it from is #154's question; that it is not in the payload is
  settled here.
- **Any TC collection or record.** The dialog self-fetches on open, like every
  other dialog in this host (CONTEXT.md, "Dialog self-fetch on open").
- **`language`.** The host has `hass` and passes `hass.language` as a property,
  as the standalone card does (`growspace-tc-card.ts:143`).

## Acceptance cases for implementation

1. The menu item opens a dialog on the worklist tab, with no `initialTab` in
   the payload.
2. An open with `initialTab: 'media'` lands on the Media tab; an unknown value
   is a type error, not a runtime fallback.
3. `scrollToField` scrolls and pulses a `data-scroll-target` element in the
   initial tab, and is inert when nothing matches.
4. Switching tabs, opening a maintenance sub-view and returning does not write
   `activeDialog$`; a second card's dialog state is unaffected.
5. First open with a cold chunk shows the frame and the loading line, then the
   view. Second open shows the view with no loading line.
6. With `loadLazyChunk` resolving `null`, the dialog opens and its content pane
   holds `<growspace-lazy-chunk-error>` naming `growspace-tc-*.js`; the frame
   still closes on Escape and on the close affordance.
7. A standalone TC card and the dialog on one page produce one fetch and one
   `console.error`, and both surfaces render their own error.
8. Two manager cards on one dashboard, TC opened from the second: exactly one
   dialog renders, in the second card's portal.
9. A payload with no `portalId` renders in every portal (fail open).
10. `growspaceId` reaches the payload from the opening card's `device`, and no
    TC request is filtered by it.

Existing coverage to extend: `growspace-dialog-host.container.test.ts:486-542`
for the portal guard, and the `chunk-missing` pattern in
`tests/cards/growspace-tc-card.chunk-missing.test.ts` for the dialog's
equivalent. No tests were run for this documentation-only decision; no runtime
or bundles changed.

## Evidence

Read against card commit `a24bbf66` (`origin/dev`) after fetching refs; none
of the files cited here differ between that commit and the local `dev`
checkout the line numbers were taken from.

- `src/lib/lazy-chunk.ts:87-90,106,116-126` — `tcView`, the memo, and the
  once-per-page diagnosis.
- `src/features/tc/tc.ts:10-14` — the chunk entry both hosts must resolve to.
- `src/cards/growspace-tc-card.ts:121-130,137-144` — the standalone host's
  load-then-render order and its chunk-error surface.
- `src/features/ui/containers/growspace-dialog-host.container.ts:184-291` —
  `render()`, the guard at `:214-220` and its comment at `:209-213`, and the
  dialog switch.
- `src/slices/grid/index.ts:304-322` — `makePerCardGridSlice`, and why every
  portal's `devices` is identical.
- `src/store/ui/ui-store.ts:60` — `$activeDialog` is the page-global atom.
- `src/growspace-manager-card.ts:143-144,163-197` — one portal per card, the
  store handed to it, and the lazy dialog-host load.
- `src/store/ui/dialog-types.ts:23-47` — the `ActiveDialogState` union `TC`
  joins.
- `src/lib/types/dialog.ts:24-39,85-102,182-186` — `growspaceId` at `:26` per
  ADR-0027, and the `currentTab`/`initialTab`/`scrollToField` precedents.
- `src/slices/ui/dialogs.ts:249-262,327-334` — the opener conventions.
- `src/features/ui/containers/growspace-header.container.ts:286-347` — the
  action switch the `tc` case joins.
- `src/features/ui/components/growspace-header-actions-ui.ts:618-636` — the
  Setup section, Strains last.
- `src/features/shared/ui/gs-dialog.ts:14-20,184` — the frame the host renders
  before the chunk arrives.

One ADR is earned, in the card repository: the portal-identity token, as the
generalization of ADR-0027 from growspace identity to portal identity. No
domain glossary change: this ticket adds no vocabulary the card does not
already own. The final #149 session folds this into the specification alongside
#150–154 and #156.

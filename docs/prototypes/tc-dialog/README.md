# Tissue Culture dialog layout prototype

Throwaway artifact for [workspace #153](https://github.com/Venosta-web/growspace_manager_workspace/issues/153).
The question is the container and navigation layout, not production implementation.
All data is illustrative. Actions and edits are simulations and make no HA requests.

Open `index.html` directly in a browser, or run from this directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:8765/?variant=B`. The floating arrows (or keyboard
Left/Right outside a form) switch variants and update the URL. Close the dialog
and reopen it from the growspace header to try the entry point. Escape closes an
action first, then the parent. Cancel returns to the previous content scroll
position and action button. Reload resets all sample state.

## The alternatives

| Variant | Structure | First view | Action presentation | Tradeoff |
| --- | --- | --- | --- | --- |
| A | Standalone section order inside one bounded modal | Worklist | Second native modal above the parent | Familiar section sequence, but media and pairings are far below the fold; layered dismissal |
| B | Four tabs: Worklist, Cultures, Media, Pairings | Worklist | Replace the content within the existing modal, with Back/Cancel | Direct access to each surface; action temporarily hides navigation |
| C | Side navigation and worklist/detail columns | Worklist beside selected vessel | Replace the main pane, with Back/Cancel | More context on desktop; selection and detail separate vertically on phones |

The content and styling are simplified proxies for the existing card, not a
pixel-perfect copy or an implementation of `DialogStateMachine`.

## Recommendation for discussion

Prefer **B**, with due/overdue work leading on every fresh open. Culture inventory,
the Culture Medium library and pairings are each one navigation step away. Use
the established `DialogStateMachine` convention in production, with per-tab state
and an explicit action subview that retains its origin, filters and scroll.
This is a proposed layout, **not a user-approved decision**.

The header always says **All cultures**. Opening from Propagation room conveys
entry context, not a new growspace filter: the current standalone view is global.
A selected growspace may later be used for a graduation destination, but this
prototype does not invent that behavior.

At desktop sizes, the parent is at most 920 px wide and 720 px tall, reduced for
the viewport. Header, navigation and footer remain fixed; only the content pane
scrolls. Below 600 px, the dialog uses the full available width, tabs stay visible
and culture stages stack vertically. The prototype reserves 96 px at the bottom
for its comparison controls; **that gap is not a proposed production footer**.
A real phone dialog should fill the viewport and account for safe areas and the
software keyboard.

In C on phones, **View vessel** scrolls the selected vessel's details into view
and moves keyboard focus to that panel. On desktop, C's action subview uses the
full content width, including the space normally occupied by side navigation.

`growspace-tc-action-dialog` currently renders an inline `form[role=dialog]`, not
an independently opened HA modal. A deliberately shows the alternative of
wrapping that form in a second modal; B and C show integrating its content into
the parent instead. This prototype recreates a reduced replate/note form to
compare those choices. It does not mount the actual Lit component or prove the
HA portal integration. Replate and note stand in for the other maintenance
acts; record/save shows feedback without changing the dataset. Medium/pairing
editors are likewise reduced examples. Draft-discard guards, real validation,
loading/errors and capability gating belong to production implementation.

## Evidence and provenance

Reference: card `origin/dev` at
`64075df5e337f537335a6aa3986d053d2a58b33d` (local dev matched the fetched ref).
TC exists on dev; comparing only with main would omit this feature.

- `src/features/tc/containers/growspace-tc-view.container.ts`: stacked sections,
  feature gates, global scope.
- `src/features/tc/components/growspace-tc-worklist.ts`: due work first, location
  filter and maintenance actions.
- `src/features/tc/components/growspace-tc-action-dialog.ts`: inline action form.
- `src/dialogs/feed-and-water-dialog-sm.ts`: tab state and edit subviews.
- Hub `docs/design/tc-menu-presence.md`: header entry and presence decision.

Browser inspection in Chromium at 1280 × 900 and 390 × 844 covered all variants,
opening and cancelling actions, plus all four tabs in B. No page errors or
horizontal content overflow appeared in those checks. Screenshots are actual
browser captures of this artifact, named by variant and viewport width; files
with `action` show the action state. No product build or runtime restart is
needed. Keep this branch as evidence; do not merge the prototype into production.

| Layout | Desktop | Phone |
| --- | --- | --- |
| Stacked | [A](A-1280.png) | [A](A-390.png) |
| Tabbed | [B](B-1280.png) | [B](B-390.png) |
| Workbench | [C](C-1280.png) | [C](C-390.png) |
| Tabbed action | [B action](B-action-1280.png) | [B action](B-action-390.png) |

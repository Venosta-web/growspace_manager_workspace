# TC menu presence — issue #152

Decision agreed with the user on 2026-09-06. Part of the specification map
[#149](https://github.com/Venosta-web/growspace_manager_workspace/issues/149).
This document resolves [#152](https://github.com/Venosta-web/growspace_manager_workspace/issues/152);
it specifies future implementation and changes no product code.

## Decision

The TC slice owns the page-global presence atom and cached probe. Both the
manager card and standalone TC card initiate the same `detectTc()` operation
after Home Assistant transport is available. The header subscribes to
`tcPresence$`; its menu item is visible exactly when `status === 'present'`.

The answer is a snapshot for the lifetime of the loaded page. Browser reload is
the only production recheck. A valid manifest with no supported surfaces still
shows the menu item and opens an explanatory compatibility state in the shared
TC view. Each actual surface retains its manifest feature gate.

## Ownership and initialization

- Keep `tcPresence$`, the cached promise, and `detectTc()` in `src/slices/tc`.
  The slice remains the sole production writer of presence. No second probe,
  per-card presence store, or new bootstrap controller is needed.
- Initiate detection from `BootstrapController.updateHass`, immediately after
  `setHass(hass)`. It must not wait for Growspace collection hydration, block
  ordinary card loading, or repeat a network call on entity updates. The slice
  deduplicates concurrent and subsequent calls, including failed probes.
- The header container uses a typed nanostores `StoreController` subscription
  to the atom. Pass the derived visibility boolean through the existing header
  presentation components. A bare `.get()` in rendering is insufficient: the
  header must update when the probe resolves on an otherwise idle dashboard.
- The standalone card keeps its call to the same operation, so standalone-only
  dashboards work. Its local render state may consume the returned snapshot;
  it must not own another cache or another WebSocket probe.
- Both hosts wait for their first usable `hass`, inject it into the transport,
  and only then initiate detection. Constructing a card without `hass` leaves
  presence `unknown` and makes no request. Late `hass` starts the probe once.

ADR-0027 isolates growspace selection and dialog targeting, not installation
capabilities shared by every card on the same Home Assistant page. Presence
does not select a growspace or open a dialog. Dialog state and captured
`growspaceId` remain per-card under the existing payload and portal rules.

## Lifecycle and failure contract

| Condition | Menu behavior | Recheck |
| --- | --- | --- |
| No `hass`, or probe pending | Absent | First usable `hass` starts initial probe |
| Valid manifest | Visible | Browser reload |
| Unknown command or unloaded entry | Absent | Browser reload |
| Transport error or malformed manifest | Absent | Browser reload |
| TC installed or loaded after cached absence | Remains absent | Browser reload |
| TC unloaded or removed after cached presence | Remains visible | Browser reload |
| Reconnect, dashboard navigation, or card remount | Retain cached answer | Browser reload |

Do not add polling, reconnect invalidation, config-entry subscriptions, or a
production reset action. `resetTcPresence()` stays test-only. A stale positive
is not a promise that later operations succeed: those requests use existing
error handling and do not rewrite presence. A transient initial failure is
also cached; this is an accepted cost of the one-probe-per-page contract.

Use “available at the last probe” when explaining presence. “Installed” alone
is inaccurate: an installed but unloaded entry cannot serve the view. The
existing comment suggesting every installation/removal requires an HA restart
should instead state the deliberate browser-reload policy.

## Featureless compatibility state

Do not gate the item on a feature list, record count, or integration version.
The shared TC view decides whether it has any supported top-level surfaces:
currently Culture Medium library, Culture Lines, or Pairings. Maintenance and
Graduation flags modify the Culture Lines surface; they do not independently
make one available.

The view already has a nonblank fallback for a manifest without these features.
Its current English copy, “Nothing in culture yet”, describes missing data
rather than missing capabilities. Replace that fallback's localized copy with
an explicit compatibility message, for example:

> No supported Tissue Culture features
>
> This TC installation does not provide any features supported by this card.
> Check that Growspace Manager TC and this card are compatible and up to date,
> then reload the page.

Both hosts reuse this state. Supported but empty collections continue to use
their ordinary empty states. Unknown feature names do not count as supported;
do not issue requests for unsupported surfaces. Keep the fallback and its
feature knowledge inside the lazy TC view, not in the header.

## Acceptance cases for implementation

1. Multiple manager cards plus a standalone card issue one manifest request,
   regardless of mount order; their presence results agree.
2. A standalone-only dashboard detects TC without a manager card.
3. Mount both host types before `hass`: no request and no cached absence. Supply
   `hass` later: one shared request and normal visibility resolution.
4. An idle header updates from unknown to present without an entity update;
   disconnect/reconnect of the header preserves correct subscription behavior.
5. Unknown, unknown-command, not-loaded, transport-failure, and malformed-reply
   cases hide the item. Subsequent card mounts and reconnects do not re-probe.
6. A valid featureless or unknown-feature-only manifest shows the item and the
   compatibility state in either host, with no unsupported data requests.
7. Supported features with zero records show their normal empty surfaces.
8. Mid-session install/unload leaves the cached answer unchanged. A fresh page
   obtains the new answer. Cached positive operations may report existing errors.
9. Two manager cards retain separate growspace selection and dialog targets.
10. Detection alone never loads the TC view. The standalone host loads it only
    after presence; the manager host loads it only when the dialog is opened,
    following #150's lazy-loading contract.

Existing slice tests cover concurrent deduplication and cached absence. Host
readiness and reactive header tests are additional required coverage. No tests
were run for this documentation-only decision; no runtime or bundles changed.

## Evidence

Read against card commit `64075df5e337f537335a6aa3986d053d2a58b33d`
(`origin/dev`) and TC commit `2ca4cc410798650d35ef6cbffa929c0e2ee9c1ce`
(`origin/prerelease`) after fetching refs.

- Card `src/slices/tc/index.ts:132–173`: presence union, atom, cached probe,
  all-failure collapse to absence, and test reset.
- Card `src/slices/tc/schema.ts:11–28`: valid manifests allow empty features.
- Card `src/controllers/bootstrap.controller.ts:92–102`: transport is primed
  before the collection fetch; this is the manager initiation point.
- Card `src/features/ui/containers/growspace-header.container.ts:91–108`:
  established global-atom subscriptions through `StoreController`.
- Card `src/cards/growspace-tc-card.ts:74–80,116–133`: current unconditional
  first-update probe can cache absence before `hass`; later injection does not
  retry. Correct initialization is required in the implementation.
- Card `src/features/tc/containers/growspace-tc-view.container.ts:249–279`:
  featureless fallback and per-surface feature gates.
- Card `src/localize/languages/en.json:364–365`: fallback currently describes
  missing cultures, so it needs compatibility-specific wording.
- TC `custom_components/growspace_manager_tc/__init__.py:65–77` and
  `websocket/_common.py:52–64,83–90`: commands remain registered after unload,
  but require a loaded entry and otherwise return `not_loaded`.

No domain glossary change or ADR is necessary for this ticket: it preserves
the existing slice ownership and refresh contract. The final #149 session can
incorporate this decision into its specification alongside #153–156.

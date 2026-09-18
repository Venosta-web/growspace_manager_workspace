# Label Template lifecycle, ownership, and recovery — issue #205

Decision agreed with the user on 2026-09-18. Part of the specification map
[#200](https://github.com/Venosta-web/growspace_manager_workspace/issues/200).
This document resolves
[#205](https://github.com/Venosta-web/growspace_manager_workspace/issues/205);
it specifies future implementation and changes no product code.

The hub glossary deliberately excludes product-repository vocabulary. For this
cross-repository specification, “template” means a Label Template, “revision”
means a Template Revision, and “draft” means a Template Draft as defined below.

## Terminology

- A **Label Size** is the stable identity of one physical label stock size.
- A **Label Element** is an independently configurable text field, logo, QR
  code, or constrained divider.
- A **Label Template** is a reusable, published arrangement of Label Elements
  for exactly one Label Size.
- A **Factory Template** is supplied and revisioned by the integration; a
  **Named Template** is created and named by an administrator.
- A **Template Revision** is one immutable published state of a template.
- A **Template Draft** is one administrator's unpublished, durable editing
  state based on a revision, or an untitled state for one Label Size.
- The **Effective Default** is the template selected after applying an optional
  administrator override and then the factory fallback.
- An **Orphaned Draft** is preserved after its template is soft-deleted.
- A **Quarantined Template** is preserved but excluded from selection and
  printing because its saved state cannot be validated safely.
- The **Library Generation** identifies the complete committed library state
  and increases monotonically after mutations.

## Decision

The Home Assistant integration owns one authoritative template library per
Growspace Manager config entry. The library contains protected Factory
Templates, administrator-created Named Templates, one Effective Default per
Label Size, immutable revision history, administrator-scoped Template Drafts,
and recoverable deletion tombstones. The Lovelace card is an authenticated
editor and consumer of that model, never another source of truth.

Template identity, published history, and unfinished work are separate:

- a template has an opaque, immutable UUID and belongs permanently to one
  versioned Label Size identity;
- every successful publication appends an immutable, monotonically numbered
  revision beneath that UUID; and
- a draft is unpublished state owned by one administrator and based on one
  explicit revision, or is an untitled draft for one Label Size.

All writes are backend-authorized, backend-validated, transactional, and
optimistically concurrent. No path silently overwrites another editor's work,
rewrites published history, repairs physical layout approximately, or discards
data from a newer schema.

## Ownership and authorization

- The integration store is canonical. Browser storage may cache server state
  for responsiveness but cannot establish templates, defaults, revisions, or
  durable drafts.
- One config entry owns one shared namespace. Growspaces beneath that entry use
  the same library. Separate config entries do not share state implicitly.
- Home Assistant administrators may create, edit, rename, duplicate, Save As,
  delete, restore, import, export, test-print, and select defaults.
- Any authenticated user may list published templates, resolve defaults, and
  print a published revision.
- Authorization is evaluated for every request. Permission at editor-open time
  is not a capability lease. If an administrator loses that role, their draft
  remains preserved but becomes inaccessible for mutation and test printing
  until authority returns or the draft expires.
- Other administrators cannot appropriate, publish, or delete a user's draft.
  Entry deletion and full-store restore are the enclosing Home Assistant data
  lifecycle, not template-management shortcuts.

## Identities and invariants

| Concept | Identity | Invariant |
| --- | --- | --- |
| Config-entry library | Home Assistant config-entry ID | Sole authority for its templates and defaults |
| Label Size | Stable, versioned ID | Physical size identity is not inferred from a display name |
| Factory Template | Stable namespaced ID | Supplied by the integration; cannot be renamed, overwritten, or deleted |
| Named Template | Opaque UUID | UUID survives rename, revision, export/import, deletion, and restore |
| Template Revision | Template UUID plus increasing integer | Immutable after commit |
| Template Draft | Owner plus template UUID, or owner plus untitled Label Size slot | Unpublished and private to its owner |
| Effective Default | Label Size | Exactly one resolves at all times when that size is printable |
| Library Generation | Increasing integer | Advances once for every committed library mutation |

Additional invariants:

1. A template's Label Size cannot change. Conversion uses Save As and an
   explicit transform/validation flow.
2. A Named Template's trimmed name is case-insensitively unique within its
   Label Size. The same name may exist at another size.
3. A valid Factory Template is designated as the fallback for every supported
   Label Size. An administrator's optional override selects a template UUID,
   not a mutable display name.
4. Default resolution produces a concrete revision at the start of a render or
   print operation. Later saves or default changes cannot alter that operation.
5. The required strain-name element exists in a newly created blank template.
   Its layout remains editable, but publication cannot remove the requirement.
6. Template documents and unknown fields are never used as authorization or
   capability evidence merely because a client supplied them.

## Lifecycle operations

Every mutation carries an idempotency key and the expected library, template,
or draft version relevant to that command. Replaying a key with identical input
returns its original result; reusing it with different input is rejected.

| Operation | Result |
| --- | --- |
| Create from factory | Untitled draft initialized from the selected current Factory Template revision |
| Create from named | Untitled draft initialized from the selected current Named Template revision |
| Create blank | Untitled, valid-by-construction draft with the required strain-name element |
| Save | Validate the draft, compare its base to the current head, append one revision, and clear that draft atomically |
| Rename | Keep the UUID and append a revision containing the new unique name |
| Duplicate | Copy the current saved revision, not a draft, into a new UUID and name |
| Save As | Validate and publish the active draft under a new UUID, switch the editor to it, and clear the source draft only after success |
| Set default | Atomically replace the admin override for one Label Size and advance the library generation |
| Clear default | Remove the override and expose the designated Factory Template fallback |
| Delete | Soft-delete a Named Template for 30 days; atomically fall back if it was default |
| Restore deletion | Revive the same UUID, revisions, name, and provenance, subject to name conflict resolution; do not reclaim default status |
| Restore revision | Copy historical content into a new head revision recording its source; never rewind or delete history |
| Replace from factory | Initialize a draft from a chosen current Factory Template while retaining the Named Template's UUID and name |
| Discard draft | Explicitly remove unpublished work and return the editor to the saved base |

The interface must not expose an ambiguous generic “Reset.” Discard draft,
Restore revision, and Replace layout from factory have different consequences
and must remain explicit. Draft replacement is undoable in the active editor
session; saved state changes only through Save.

## Factory Template lifecycle

Factory Templates follow the installed integration version. An integration
upgrade may append a new shipped revision and advance the current factory head.
It never changes a Named Template copied from that factory.

An administrator selecting a Factory Template as the default accepts its
current shipped revision after upgrades. An administrator needing a frozen
layout uses Save As to create an independent Named Template. A factory update
can make an open draft stale in the same way as any other base-revision change.

Factory definitions do not need duplication in user backup data. Stored
references use stable factory and revision identities so restore and migration
can explain which installed definition is available.

## Template Draft lifecycle

The store holds at most one active draft per administrator/template and one
untitled draft per administrator/Label Size. A draft records at least its owner,
base template and revision where applicable, draft version, last-modified time,
layout schema version, and complete editing payload.

- Debounced autosave persists every editing state, including temporarily
  invalid content. Invalid drafts cannot be published or production-printed.
- Switching templates, closing the card, reconnecting, restarting Home
  Assistant, or moving to another authenticated client does not discard a
  draft.
- A draft expires after 90 days without modification unless it was already
  saved or explicitly discarded.
- Draft autosave is compare-and-swap on the draft version. A stale client write
  is rejected and cannot replace the server draft. The client preserves its
  unsynced payload and offers reload or Save As.
- Save compares the draft's base revision with the template's current head. A
  mismatch marks the draft stale and disables ordinary Save.
- Deleting a template turns associated drafts into Orphaned Drafts. Their
  owners may inspect, discard, or Save As from them. Restoring the template
  reconnects compatible orphaned drafts. Otherwise they expire with the
  30-day deletion tombstone.
- If an upgrade cannot migrate a draft losslessly, it becomes a read-only
  recovery artifact that may be exported or explicitly discarded. It is never
  partially published.

## Concurrent editing and change discovery

Opening a template does not acquire an exclusive lock. The editor may show
advisory presence, but correctness rests on revision checks. A remote save:

1. advances the template head and the library generation;
2. emits an authenticated change event naming the generation, affected IDs,
   and operation kind, without treating the event as the full document; and
3. causes clients with drafts based on the previous head to mark them stale
   without modifying their content.

A stale draft remains previewable and recoverable. Its owner may inspect the
new current revision, discard and reload, manually apply chosen changes to a
fresh draft, or Save As. The initial contract deliberately excludes automatic
visual-layout merging: independent moves, resizes, ordering, and typography
changes can be structurally mergeable while producing unsafe physical output.

Clients obtain an authoritative snapshot with its Library Generation, then
subscribe for changes. A reconnect, event gap, or unexpected generation causes
a complete snapshot refresh. Polling is not the primary consistency mechanism.

## Preview and print consistency

A production print request identifies a published template or asks the backend
to resolve the Effective Default. The backend captures one concrete revision at
request start and uses it for validation, rendering, printing, retries, batch
items, and audit metadata. Clients do not submit an authoritative template
document in place of that reference.

An administrator may preview and test-print a draft that passes all hard
validation. The backend captures one immutable draft-version snapshot and uses
the same canonical render path for preview and print. The operation is marked
as unpublished test output. Ordinary users and production print flows cannot
print drafts.

## Revision history, deletion, and recovery

Active Named Templates retain all committed revisions. Revisions record the
timestamp, acting Home Assistant user ID, operation kind, parent revision, and
relevant source revision, Factory Template, import, or restore provenance. The
system does not record every interactive drag as revision history.

Deleting a Named Template creates a tombstone and removes it from ordinary
selection. If it was the selected default, deletion and fallback are one
transaction. Factory Templates cannot be deleted.

For 30 days, an administrator may restore the same UUID and complete history.
If the old name has since been taken within that Label Size, restoration waits
for a new unique name. Restoration does not displace the current default. After
the tombstone expires, garbage collection may permanently remove the template,
its history, tombstone, and remaining Orphaned Drafts.

## Portable export and import

Portable export is for sharing published Named Templates, not restoring an
integration. A bundle contains one or more selected current revisions together
with its format version, layout schema version, stable identities, Label Size
and dependency references, structural provenance, and checksums. It excludes
drafts, history, defaults, tombstones, Factory Template definitions, and
installation-specific user identity by default.

Import is administrator-only and stages the entire bundle before writing:

1. authenticate and authorize the actor;
2. verify bundle structure and checksums;
3. migrate supported older formats in memory;
4. validate identities, names, Label Sizes, elements, assets, capability
   profiles, and complete layouts;
5. resolve every collision; and
6. commit all templates and one library-generation advance atomically.

An imported UUID absent locally is preserved. The same UUID with identical
content and lineage is a no-op. Divergent content is rejected unless the admin
explicitly imports it as a copy with a fresh UUID. Name conflicts must be
resolved before commit. An imported template arrives as a saved, non-default
Named Template; import never publishes drafts or changes defaults.

Newer or unsupported bundle formats fail preflight without writes and report
the required compatible Growspace Manager version. Unknown elements and
dependencies are never silently dropped or substituted.

## Backup and restore

A full integration backup contains all user-owned template state: Named
Templates, complete revision histories, default overrides, Template Drafts,
tombstones, provenance, and Library Generation. Factory Template definitions
come from the installed integration; stable references remain in the backup.

Restore is replacement, not merge. The integration validates checksums and
structure, migrates the complete staged store, and only then atomically replaces
the target config entry's library. Any failure leaves the pre-restore store
unchanged. Portable import is the separate additive workflow.

If an older integration encounters a store schema written by a newer version,
it preserves the store byte-for-byte, disables template mutation and
template-based printing for that entry, and raises a Home Assistant repair
issue naming the detected and supported versions. Other Growspace Manager
features continue when the boundary can be isolated. No best-effort downgrade
or factory reset is permitted.

## Validation and failure containment

The backend is the authority for layout, capability, and lifecycle validation.
Clients mirror those rules for immediate feedback but cannot publish or print
around the server. Errors expose stable machine-readable codes, affected
element or document paths, and parameters from which clients localize messages.

If the store is readable but one saved template fails validation, preserve it
as a Quarantined Template. It is unavailable for selection and printing but
remains visible to administrators for diagnostics, export, historical restore,
repair through a new draft, or replacement. If it was the selected default,
default resolution falls back atomically to the valid factory choice.

Capability-profile changes never clamp coordinates, discard properties, or
substitute assets silently. Unknown Label Sizes, element types, assets, fields,
and profile versions remain opaque preserved data and quarantine the affected
template until a compatible integration or explicit repair is available.

Every supported Label Size is expected to ship with at least one valid Factory
Template. If packaging or migration violates that invariant, template-based
printing for the size is disabled and a repair issue is raised. The integration
must not invent an approximate emergency layout or print a known-invalid one.

## Required acceptance cases for implementation

1. Two config entries may use the same names and UUID-shaped external input
   without sharing state or defaults.
2. Non-admin users can list and production-print published templates but every
   management command, draft mutation, test print, import, and export is denied.
3. Rename preserves UUID; Duplicate ignores the active draft; Save As uses it.
4. Label Size cannot be changed in place, and duplicate names are rejected only
   within the same size using trimmed, case-insensitive comparison.
5. Clearing, deleting, quarantining, or losing a selected override exposes the
   valid factory fallback in the same transaction.
6. A Factory Template upgrade advances its own head and default output without
   modifying any Named Template copied from it.
7. Invalid draft state survives reload and restart but cannot Save or print.
8. Two clients for the same administrator cannot overwrite a newer draft
   autosave; the rejected client's state remains recoverable.
9. Two administrators can edit the same base. The first Save succeeds; the
   second draft becomes stale and cannot overwrite it.
10. Remote saves never replace an open draft. Reconnect and generation gaps
    cause an authoritative snapshot refresh.
11. A timed-out mutation retried with the same idempotency key creates exactly
    one revision, template, import, deletion, or default change.
12. Preview, test print, production print, retry, and every item in a batch use
    the revision or draft snapshot captured at operation start.
13. Historical restore appends a new revision and leaves intervening revisions
    and their print references truthful.
14. Deleting the default preserves other users' drafts as orphaned recovery
    work, selects the fallback, and can restore the same identity within 30 days.
15. Restoring a tombstone with a conflicting name requires resolution and never
    steals the current default.
16. Portable import is all-or-nothing; identity and name conflicts, bad
    checksums, unsupported dependencies, or newer schemas produce no writes.
17. Importing identical identity/content is idempotent; divergent identity
    content requires an explicit fresh-ID copy.
18. Full restore recreates drafts, history, tombstones, defaults, and generation
    exactly after migration, while a failed restore preserves current state.
19. A newer unreadable store remains byte-identical and produces a repair issue
    instead of being reset or downgraded.
20. One invalid template is quarantined without disabling valid templates;
    absence of a valid factory fallback disables only the affected size.
21. Unknown fields and dependencies survive backup and diagnostic export even
    though they cannot be interpreted or printed.

## Evidence and boundaries

Read against backend commit `baec20b3993c10baeabe929e30f46fa28c57ecce`
and card commit `0bd7af52a0a49a4da00a7b0b0d7273a92d93b201`.

- Backend `custom_components/growspace_manager/services/strain_library.py`:
  `handle_print_label` currently constructs one fixed-coordinate Niimbot payload,
  scales it to five pixel canvases, and sends it directly to the printer service.
  There is no persisted template identity, revision, default, or draft today.
- Backend `custom_components/growspace_manager/websocket/plant.py`: the current
  print command forwards plant/strain fields, density, target, and a free-form
  `label_size` string to the service. It does not select a template revision.
- Card `src/dialogs/print-label-dialog.ts` and
  `src/dialogs/batch-print-label-dialog.ts`: both independently declare the same
  five Label Size choices. The future backend-owned model must remove this as a
  source-of-truth role rather than adding a third list.

This issue does not choose the canonical Label Layout document, rendering API,
or capability-profile schema; those belong to sibling issue #206. It does not
define content binding across strain, plant, and batch contexts (#202), physical
calibration and fidelity (#207), or rollout and migration from the current
fixed-coordinate request (#203). Those decisions must preserve the identities,
state transitions, failure behavior, and acceptance cases established here.

No runtime tests were run for this documentation-only decision; no product code
or bundles changed.

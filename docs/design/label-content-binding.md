# Label content binding across strain, plant, and batch printing — issue #202

Decision recorded on 2026-09-18. Part of the specification map
[#200](https://github.com/Venosta-web/growspace_manager_workspace/issues/200).
This document resolves
[#202](https://github.com/Venosta-web/growspace_manager_workspace/issues/202);
it specifies future implementation and changes no product code.

It builds on the Label Template lifecycle contract in
[`label-template-lifecycle.md`](label-template-lifecycle.md), the canonical
layout and renderer seam in
[`label-layout-and-rendering-seam.md`](label-layout-and-rendering-seam.md), and
the accepted editor prototype from issue #201. The hub glossary deliberately
excludes product-repository vocabulary, so the terms introduced here remain
local to this cross-repository specification rather than being added to
`CONTEXT.md`.

## Answer in brief

Every render resolves one source record into an immutable backend-owned **Label
Content Snapshot** before it measures or paints an element. Strain, plant, and
batch entry points use different source adapters, but every Label Template sees
the same closed, versioned Binding Catalogue. A template never reads Home
Assistant entity attributes, browser state, a mutable strain-library row, or an
arbitrary expression directly.

Version 1 contains ten bindings: strain name, phenotype, breeder, lineage,
current-stage start date, stage and age, plant ID, breeder logo, plant link, and
print date. Strain name is the only template-required binding. Plant-only
bindings render no ink and produce warnings in a strain context; their frames
remain reserved. No missing value, long value, locale, or source-context change
may reflow another element.

A batch captures one ordered snapshot per record and preflights every snapshot
before the first label prints. Warnings require explicit review; a hard content
error blocks the complete batch. Once printing starts, printer failures are
tracked per record and copy and can be retried against the original snapshots.

## Terminology

- A **Print Subject** identifies the saved strain or live plant requested by a
  caller. A batch contains an ordered list of plant subjects.
- A **Source Adapter** resolves one Print Subject from integration-owned state
  into a Label Content Snapshot.
- A **Label Content Snapshot** is the immutable, normalized content and
  provenance captured for one record at preview or print start.
- A **Binding Catalogue** is the versioned backend-owned list of supported
  binding IDs, element kinds, contexts, parameters, output types, missing-value
  policies, limits, and representative examples.
- A **Resolved Binding** is one typed value, absence, or error produced by
  applying a catalogue entry to a Label Content Snapshot.
- A **Batch Preflight** validates and renders every ordered record/copy plan
  without sending anything to the printer.
- A **Batch Attempt** is one record identity plus one-based copy index. It is
  the unit of progress, failure reporting, and retry.

The lifecycle meanings of Label Template, Template Revision, and Template
Draft, and the rendering meanings of Label Layout, Label Element, Capability
Profile, Render Context, and Render Result remain those defined by issues #205
and #206.

## One immutable content seam

The renderer accepts content only through a backend-created Label Content
Snapshot. Callers send subject references and render options, not authoritative
field values. The backend authorizes the request, resolves the subject, joins
the allowed library state, normalizes values, captures provenance and time, and
then freezes the snapshot.

The logical V1 envelope is:

```json
{
  "schema": "growspace.label-content-snapshot",
  "version": 1,
  "snapshot_id": "01K5M0QXJCM2JFPHZ8M3V9G70W",
  "context": "plant",
  "subject": {
    "kind": "plant",
    "id": "87b70561-96dd-4bcb-9153-6fc266b1d2dc",
    "version": "plant-state-version"
  },
  "sources": {
    "strain": { "id": "saved-strain-key", "version": "library-generation" },
    "phenotype": { "id": "saved-phenotype-key", "version": "library-generation" }
  },
  "locale": "de-DE",
  "time_zone": "Europe/Berlin",
  "as_of": "2026-09-18T14:30:00Z",
  "values": {
    "strain.name": "Northern Lights",
    "strain.phenotype": "NL #5",
    "strain.breeder": "Sensi Seeds",
    "strain.lineage": "Afghani × Thai",
    "plant.stage_started_on": "2026-09-02",
    "plant.stage": "flower",
    "plant.id": "87b70561-96dd-4bcb-9153-6fc266b1d2dc",
    "strain.breeder.logo": {
      "asset_id": "breeder-logo:sensi-seeds",
      "content_hash": "sha256:..."
    }
  }
}
```

This is the logical contract, not a promise that callers can fetch or submit the
stored envelope verbatim. Sensitive source versions and normalized values may
remain private behind an opaque `snapshot_id`. The important invariants are:

1. one snapshot belongs to one context and one subject;
2. every resolved value has one documented source;
3. `locale`, `time_zone`, and `as_of` are captured once;
4. asset identities refer to immutable normalized bytes;
5. preview, production print, retry, and audit can identify the exact snapshot;
6. later plant, library, configuration, locale, or clock changes do not mutate
   it; and
7. snapshots are bounded operational artifacts, not a second long-lived plant
   or strain database.

### Source contexts

V1 has exactly three render contexts:

| Context | Print Subject | Resolution |
| --- | --- | --- |
| `strain` | saved strain plus optional saved phenotype reference | saved strain-library state only |
| `plant` | live plant identity | captured plant state, enriched through its captured saved strain relationship |
| `batch_item` | one plant identity in an ordered batch | the same adapter and rules as `plant`; batch membership changes no value |

`batch_item` is explicit in diagnostics and capabilities even though its content
rules equal `plant`. That leaves room for batch-only safety limits without
letting a batch silently format a plant differently.

Direct strain production printing never reads an unsaved strain-editor draft.
The user saves it first. Template Draft test printing is different: the layout
may be unpublished, but its selected content subject is still a saved strain or
plant resolved by the backend.

### Source precedence

There is no general precedence or fallback chain. Each binding has one source
per supported context:

| Binding | `strain` source | `plant` / `batch_item` source |
| --- | --- | --- |
| `strain.name` | saved strain name | captured plant genetics strain name |
| `strain.phenotype` | selected saved phenotype name | captured plant phenotype name |
| `strain.breeder` | saved strain breeder | captured linked strain-library breeder |
| `strain.lineage` | saved strain lineage | captured linked strain-library lineage |
| `plant.stage_started_on` | unsupported | date belonging to the captured current stage |
| `plant.stage_and_age` | unsupported | captured current stage plus age from that stage's date |
| `plant.id` | unsupported | complete canonical plant ID |
| `strain.breeder.logo` | saved strain's linked breeder logo | captured linked strain-library breeder logo |
| `plant.link` | unsupported | route constructed for the captured canonical plant ID |
| `print.date` | snapshot date | snapshot date |

The sentinel phenotype name `default`, blank strings, and whitespace-only
strings normalize to absence. A plant's own strain and phenotype names remain
the authority for its identity even when the library relationship is missing.
Breeder, lineage, and breeder logo do not fall back to dialog state or stale
entity attributes when that relationship cannot resolve.

## The V1 Binding Catalogue

The first catalogue family is `growspace.label-bindings` version `1`. The
catalogue is closed: an unknown binding ID or parameter is an error, not a
request to inspect an object dynamically.

| Binding ID | Kinds | Contexts | Output | Parameters | Missing policy |
| --- | --- | --- | --- | --- | --- |
| `strain.name` | text | all | string | none | hard error |
| `strain.phenotype` | text | all | string | `presentation` | warn and omit |
| `strain.breeder` | text | all | string | `presentation` | warn and omit |
| `strain.lineage` | text | all | string | `presentation` | warn and omit |
| `plant.stage_started_on` | text | plant, batch | localized date | `presentation`, `date_style` | warn and omit |
| `plant.stage_and_age` | text | plant, batch | localized composite | none | warn and omit |
| `plant.id` | text | plant, batch | canonical string | `presentation` | hard record error |
| `strain.breeder.logo` | logo | all | image asset | none | warn and omit |
| `plant.link` | QR | plant, batch | URI | `target` | hard record error |
| `print.date` | text | all | localized date | `date_style` | cannot be absent |

Here, `all` means `strain`, `plant`, and `batch_item`. An unsupported-context
use is distinct from a supported binding whose optional value is absent: both
paint no ink and preserve the frame, but they emit different diagnostic codes.

### Required template content

Every publishable Template Revision contains at least one printable text
element bound directly to `strain.name`. A literal, QR, logo, or future
composite does not satisfy the invariant. Multiple strain-name elements are
allowed and remain independently measurable and diagnosable.

The rule is structural and record-level:

- publication fails if no valid `strain.name` text element exists;
- render/print fails if the subject's normalized strain name is absent; and
- a too-small, invalid, or unprintable required element cannot satisfy the rule
  merely because its binding ID is present in JSON.

Every other V1 binding is optional at the template level. Once a QR element
using `plant.link` is present for a plant context, however, inability to produce
a valid selected target is a hard record error rather than a blank optional QR.

### Presentation parameters

The backend owns final printable formatting. The document selects from closed
parameters; it never supplies a format string, expression, translation, HTML,
or prefix.

Text bindings that support captions accept:

```json
{ "presentation": "value" }
```

or:

```json
{ "presentation": "labeled" }
```

`value` emits only the normalized value. `labeled` emits a fixed
backend-localized caption and value. Defaults are:

| Binding | Default presentation |
| --- | --- |
| `strain.phenotype` | `value` |
| `strain.breeder` | `labeled` |
| `strain.lineage` | `labeled` |
| `plant.stage_started_on` | `labeled` |
| `plant.id` | `labeled` |

`strain.name` has no caption parameter. `plant.stage_and_age` uses the localized
compact form defined below, and `print.date` emits only its formatted date.
`plant.id` always formats the complete canonical ID; V1 does not invent a
collision-prone short identity.

## Missing and unsupported content

V1 never prints synthetic production placeholders such as `Unknown`, `-`, or
`N/A`. For each Label Element:

1. resolve and normalize its binding;
2. distinguish value, absent value, unsupported context, and invalid value;
3. retain the element's exact frame in every case;
4. paint no ink for absent or unsupported optional content; and
5. return a structured element/record diagnostic.

Nothing collapses, shifts, expands, or redistributes when content is absent.
The editor's selection overlay may name an empty frame so an administrator can
still select it, but the authoritative monochrome raster remains blank there.

Missing optional content is always visible before printing as a warning. It is
not silently discarded merely because the template is shared across contexts.
The user may proceed after batch/single-item review. Hard errors never have an
acknowledge-and-print escape hatch.

## Dates, age, locale, and time zone

Lifecycle fields are date-only domain values. The backend parses them strictly
as calendar dates and never shifts them between time zones.

`plant.stage_started_on` selects only the date belonging to the captured current
stage. It never falls back to `veg_start`, `flower_start`, creation time, or the
latest non-empty lifecycle field. An absent current-stage date warns and omits
both `plant.stage_started_on` and `plant.stage_and_age`. A start date after the
captured `as_of` date is a hard record error.

`plant.stage_and_age` formats the localized current-stage name plus whole
calendar days between `plant.stage_started_on` and the `as_of` date, for example
`Flower · 16 days`. Day zero is valid. The complete batch uses the same `as_of`
instant and Home Assistant configured time zone, so age cannot tick over between
items.

`print.date` is the calendar date containing `as_of` in the captured Home
Assistant time zone. It replaces today's unconditional `%d.%m.%Y` raster stamp;
the date appears only when a template contains this binding.

Date bindings accept only:

```json
{ "date_style": "short" }
```

`short`, `medium`, and `iso` are supported; `short` is the default. `short` and
`medium` use the captured BCP 47 client locale. `iso` is `YYYY-MM-DD` and is
locale-independent. Stage names, captions, singular/plural age units, and
punctuation are localized by the backend from the same captured locale.

The authenticated client supplies its Home Assistant locale identity as a
render option; it does not supply translations or a formatter. The backend
validates it against supported locales and snapshots the resolved locale.
Unsupported locale resolution fails preview/preflight explicitly rather than
silently changing the printed language.

## Long content and predictable geometry

Bindings normalize bounded Unicode values, but only the Label Element's
declared overflow policy decides how a valid value occupies its frame. Content
never grows a frame or reflows another element.

- `clip` paints the clipped result and warns.
- `ellipsis` retains the requested font size, truncates, and warns.
- `shrink` reduces the font to the declared minimum; inability to fit the full
  value at that minimum is a hard element/record error.
- `shrink_ellipsis` shrinks to the minimum, then truncates and warns if needed.

Successful fitting below a capability-profile comfort threshold emits an
aggressive-auto-fit warning even when the template's lower minimum would permit
it. The profile's calibrated readable minimum remains a hard floor.

The Render Result reports original code-point count, measured line count,
chosen font size, overflow outcome, and whether truncation occurred. It does
not echo the complete content value into logs or diagnostics merely to explain
the result. Catalogue input limits reject pathological text and URI sizes
before font measurement or QR generation.

## Logo resolution

`strain.breeder.logo` resolves only the integration-managed logo belonging to
the captured linked breeder. The snapshot contains an opaque asset identity,
content hash, media metadata, and normalized immutable bytes or a reference to
them. It never stores a browser URL as the authoritative asset.

Missing, unreadable, oversized, or unconvertible dynamic breeder logos warn and
paint no ink. They do not fall back to a remote URL, browser cache, strain image,
or generic logo. The renderer applies the layout's versioned monochrome token
and `contain` behavior from issue #206.

A template may instead contain a static integration-owned `asset_id`. That is a
different explicit source, not a fallback hidden inside the dynamic logo
binding. Static asset failure follows the layout dependency/quarantine rules
from issue #206.

## QR targets

`plant.link` accepts exactly one parameter:

```json
{ "target": "dashboard_url" }
```

or:

```json
{ "target": "home_assistant_app" }
```

- `dashboard_url` is an absolute configured Home Assistant dashboard URL whose
  route selects the captured plant ID.
- `home_assistant_app` is a `homeassistant://navigate/...` deep link to that
  same configured route.

The integration constructs and validates both from backend-owned Home Assistant
URL/routing configuration. The card cannot provide an arbitrary base URL.
`https://growspace.app/...`, `growspace://...`, and a raw UUID masquerading as a
link are not V1 targets.

Failure to construct the selected route, excessive encoded length, insufficient
QR geometry, or a matrix below the Capability Profile's calibrated module-size
floor is a hard error for that record. A strain-context `plant.link` is instead
an unsupported optional binding: it warns and paints no ink, because no plant
subject exists to target.

## Representative and actual previews

The backend Binding Catalogue supplies deterministic, versioned fixture
subjects for every context:

- **typical**: representative ordinary values;
- **long content**: bounded values designed to exercise wrapping, fitting,
  ellipsis, lineage length, canonical IDs, localized captions, and QR density;
  and
- **missing optional content**: a valid subject with every optional value
  absent.

Fixtures resolve through the production binding formatter and renderer. They
are not CSS-only example strings maintained by the card. The editor can switch
among them and may preview one explicitly selected real saved strain or plant.
That selection is editor state, not Template Revision state.

Single-item print preview always uses the actual captured snapshot. Batch
preflight resolves and renders every actual record; one representative item may
not stand in for unvalidated records. The batch preview pages through the
ordered snapshots and can jump among hard errors and warnings. It initially
shows the first hard error, otherwise the first warning, otherwise the first
record.

## Batch preflight, consent, order, and retry

A batch request contains an explicit ordered list of unique plant identities,
copy count, concrete Template Revision, Capability Profile, locale, and printer
settings. Duplicate plant identities are rejected rather than interpreted as
implicit extra copies.

Before sending any printer command, the backend:

1. authorizes and resolves the complete request;
2. captures one immutable Label Content Snapshot per plant in submitted order;
3. constructs the copy-major attempt plan;
4. validates every binding and dependency;
5. renders every distinct record against the captured Template Revision and
   Capability Profile; and
6. returns all diagnostics, rasters, and the immutable preflight identity.

For ordered records `A, B, C` and two copies, the attempt order is
`A1, B1, C1, A2, B2, C2`. The card displays this order before printing. The
backend preserves it exactly.

Any hard document, binding, record, asset, routing, capability, or render error
blocks the complete batch. There is no “print the valid subset” mode in V1.
Warnings permit printing only after explicit acknowledgement tied to the
preflight identity, which covers at least:

- Template Revision or immutable draft version;
- every content snapshot ID and source version;
- record and attempt order;
- Capability Profile and printer settings;
- locale, time zone, and `as_of`; and
- diagnostic set.

Changing any covered input invalidates acknowledgement and requires a new
preflight. Starting production print references the accepted preflight; the
client cannot recreate its inputs approximately.

Physical printing cannot be transactional. Once it starts, printer/runtime
failure may leave partial output. Results therefore identify every Batch
Attempt by snapshot/record identity and copy index with `pending`, `printed`, or
`failed` outcome. Retry selects failed attempt identities only, retains their
original relative order, and uses the same Template Revision, snapshots,
locale/time, rasters, and settings. New plant or library state cannot alter a
replacement label. Printing the whole batch again is a separate explicit new
job, not “retry.”

## Diagnostics contract

Diagnostics are backend-owned, stable machine-readable results localized by the
card. At minimum every diagnostic contains:

- stable code and severity (`warning` or `error`);
- snapshot/record identity and context;
- Template Revision and Label Element ID where applicable;
- binding ID and normalized parameter path where applicable;
- safe structured details needed to explain or locate the problem; and
- whether it blocks preview, publication, preflight, or printing.

Required V1 distinctions include:

- missing required strain name;
- missing supported optional content;
- unsupported binding context;
- missing or stale source relationship;
- invalid/future lifecycle date;
- unknown locale or parameter;
- auto-fit below the comfort threshold;
- clipping or ellipsis;
- content unable to fit at minimum size;
- missing/unreadable dynamic logo;
- unavailable or invalid QR target;
- QR below the calibrated module-size floor; and
- changed/expired preflight acknowledgement.

Warnings are not collapsed to a count. The single and batch review surfaces map
them back to records and elements, and assistive text conveys the same meaning
as color or canvas marks.

## Required acceptance cases for implementation

1. The same published Template Revision renders through `strain`, `plant`, and
   `batch_item` adapters without changing element frames or order.
2. A caller cannot submit authoritative field values, arbitrary binding IDs,
   formatter expressions, captions, URLs, or asset bytes in a production print
   request.
3. A snapshot remains byte/identity-stable for preview, print, audit, and retry
   after its plant, strain entry, breeder logo, locale, or clock changes.
4. Direct strain printing resolves a saved strain and optional saved phenotype;
   unsaved editor values never leak into production output.
5. Plant strain/phenotype identity comes from the captured plant, while breeder,
   lineage, and dynamic logo use only its captured linked library relationship.
6. `default`, empty, and whitespace-only phenotype names normalize to absence.
7. Publishing a template without a valid printable `strain.name` text element
   fails; a literal containing the strain's name does not satisfy the rule.
8. Missing strain name blocks one record. Every other supported missing V1
   value warns and paints no ink while preserving the exact frame.
9. A plant-only binding in strain context returns an unsupported-context
   warning distinct from missing supported content and does not reflow layout.
10. Captioned and value-only presentations use backend translations; the saved
    template contains only the closed parameter.
11. A current flower-stage plant uses only `flower_start`; it never silently
    chooses an earlier populated `veg_start`.
12. Missing current-stage date omits both stage-date and stage-age output with
    warnings; a future stage date is a hard record error.
13. A batch crossing local midnight uses one captured `as_of`, date, time zone,
    and age calculation for every item and retry.
14. `short` and `medium` dates and stage/age text follow the captured locale;
    `iso` remains `YYYY-MM-DD`. Unsupported locale resolution is explicit.
15. Omitting `print.date` from the layout removes the current-date stamp
    completely; including it uses the captured snapshot date.
16. A long value never changes its frame. Each overflow policy produces the
    specified fit, warning, truncation metadata, or hard error.
17. Diagnostics explain measurement outcomes without copying the complete
    source value into logs.
18. Dynamic breeder logo resolution produces one immutable normalized asset;
    missing or corrupt optional logos warn and render blank without fallback.
19. A static `asset_id` never silently turns into a dynamic breeder-logo source
    or vice versa.
20. `dashboard_url` and `home_assistant_app` resolve to the same configured
    plant route in their respective URI forms; caller-supplied arbitrary bases
    are rejected.
21. Failure to construct a selected plant QR target or meet the QR module-size
    floor blocks that record; strain-context use only warns as unsupported.
22. Typical, long, and missing-content fixtures pass through the production
    binding and renderer path and remain versioned with the catalogue.
23. Single preview uses the actual snapshot. Batch preflight renders every
    actual record and initially focuses the first error, warning, or record.
24. Duplicate plant IDs are rejected. A unique submitted order is preserved in
    preview, printing, results, and retry.
25. Records `A, B, C` with two copies plan exactly
    `A1, B1, C1, A2, B2, C2`.
26. One hard content error produces no physical output for the batch and lists
    every affected record rather than stopping at the first.
27. Warnings require explicit acknowledgement. Any change to a covered
    template, snapshot, order, profile, setting, locale/time, or diagnostic
    invalidates that acknowledgement.
28. A runtime failure may leave partial physical output, but every attempt has
    a record/copy outcome and only failed attempts are eligible for retry.
29. Retried attempts reuse original snapshots, revision, raster inputs, and
    relative order even after source data changes.
30. Card, websocket, service, automation, single-print, and batch-print callers
    converge on the same Source Adapters, Binding Catalogue, formatter,
    diagnostics, and renderer; none retains a private fallback path.

## Rejected alternatives

### Bind directly to entity attributes or JSON paths

Rejected because entity attributes are presentation payloads with incomplete
fields and changing shapes. JSON paths would expose implementation structure,
authorization gaps, browser/backend disagreements, and arbitrary missing-value
behavior as a permanent template language.

### Preserve dialog-state fallback

Rejected because the current card can preview a value the backend later
replaces, while batch and non-card callers have no equivalent dialog state.
One backend Source Adapter makes provenance and failure explicit.

### Store resolved values in Template Revisions

Rejected because a template is reusable layout, not one plant's label. Resolved
values belong to bounded snapshots captured per operation.

### Collapse absent elements and reflow

Rejected because an identical Template Revision would acquire record-dependent
geometry, defeating predictable preview, physical calibration, and batch
comparison.

### Add a general expression or format-string language

Rejected because it expands validation, escaping, localization, measurement,
authorization, migration, and compatibility surfaces without a V1 need. Named
semantic bindings and closed presentation parameters cover current content.

### Let one representative record validate a batch

Rejected because phenotype, lineage, IDs, dates, logos, and QR sizes vary across
the selected records. A preview of the first plant cannot establish that the
twelfth plant fits or resolves.

### Continue past content-invalid batch records

Rejected because it knowingly creates an incomplete physical set before the
user can correct it. Complete preflight can prevent this class of partial
output; only failures arising after printer commands begin are unavoidably
non-transactional.

### Re-resolve data for retry

Rejected because replacement labels could differ from the successful labels in
the original job after plant, library, locale, or time changes.

## Evidence and sibling boundaries

Read against backend commit `baec20b3993c10baeabe929e30f46fa28c57ecce`
and card commit `0bd7af52a0a49a4da00a7b0b0d7273a92d93b201`, the same evidence snapshots used
by issues #205 and #206.

- The current card declares nine fields, but the backend physically renders
  only strain name, phenotype, breeder, lineage, breeder logo, QR, and an
  unconditional current date. Start date, stage/age, and textual plant ID do
  not reach the raster.
- Current strain printing sends caller values with library fallback. Plant
  printing resolves plant strain/phenotype and then library breeder, lineage,
  and logo. The card separately falls back to dialog values and entity
  attributes, so preview and print can disagree.
- The current CSS preview uses browser locale and a `veg_start`-before-
  `flower_start` choice, while the physical label prints today's date as
  `%d.%m.%Y` and does not print the selected lifecycle date.
- Current preview QR values use fictitious `growspace.app` and `growspace://`
  targets. Physical output builds different web and Home Assistant routes from
  caller-provided base data.
- Current batch printing performs no content preflight, repeats the full record
  list once per copy, continues after individual failures, and reports only an
  aggregate error count.
- Long text currently relies on Niimbot `fit: true`; the CSS preview clips a
  separate composition without shared measurement or diagnostic behavior.

The Binding Catalogue and Label Content Snapshot replace these independent
sources of content meaning. This issue does not set physical warning thresholds,
calibration evidence, or preview responsiveness SLAs (#207), nor the
compatibility/migration sequence for old card and backend combinations (#203).
Those decisions must preserve the binding IDs, snapshot immutability,
diagnostics, and batch invariants specified here.

No runtime tests were run for this documentation-only decision; no product code
or bundles changed.

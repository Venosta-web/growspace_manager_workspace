# Label compatibility, rollout, and acceptance contract — issue #203

Decision agreed with the user on 2026-09-18. Part of the specification map
[#200](https://github.com/Venosta-web/growspace_manager_workspace/issues/200).
This document resolves
[#203](https://github.com/Venosta-web/growspace_manager_workspace/issues/203);
it specifies future implementation and changes no product code.

It builds on the Template lifecycle in
[`label-template-lifecycle.md`](label-template-lifecycle.md), the canonical
renderer seam in
[`label-layout-and-rendering-seam.md`](label-layout-and-rendering-seam.md), the
content rules in [`label-content-binding.md`](label-content-binding.md), the
preview and print-safety contract in
[`preview-fidelity-and-print-safety.md`](preview-fidelity-and-print-safety.md),
the accepted editor prototype from issue #201, and the Niimbot
rendering-envelope research from issue #204. It chooses migration, compatibility,
release, exposure, and final acceptance policy without weakening those earlier
contracts.

## Answer in brief

The Home Assistant integration lands first and advertises one explicit,
versioned Label Template capability. The card never infers support from an
integration release number or a partially present command. A new card uses the
new editor and print flow only when the complete capability is advertised; it
retains the current classic dialogs against an old backend. A new backend keeps
the legacy service and websocket contract for old cards. Unknown or incomplete
new contracts fail closed rather than falling through to classic printing.

There is no user template state to migrate today. The integration creates one
valid Factory Template for each of the five existing Label Sizes and designates
it as that size's fallback. Current printer, density, and QR choices remain
render-time choices rather than becoming layout state. A legacy request remains
identifiably classic and never creates a Template Revision or silently becomes
a user's default.

The new production path initially supports only the exact 203-dpi, 50-mm B1 or
B21 model, firmware, stock, and orientation combinations that pass physical
verification. D11/D110 and 300-dpi models remain outside new production
eligibility until their own profiles, templates where needed, and evidence
exist. Provisional profiles may preview and produce calibration or administrator
test labels, but never production labels.

Stable release requires both automated cross-repository proof and profile-specific
physical evidence. WCAG 2.2 AA failures, untranslated new English strings,
mixed-version regressions, missing legacy parity, or absent physical evidence
for a claimed production profile block release. The fixed-coordinate renderer
may be removed after one backend Compatibility Adapter reproduces the supported
legacy contract through the canonical renderer and ships for two stable backend
releases. The public legacy request contract remains deprecated for at least one
additional stable release.

## Terminology

- The **Template Capability** is the complete versioned capability envelope
  advertised by the integration for discovery, lifecycle, rendering, content,
  profiles, diagnostics, and operation limits.
- A **Classic Request** is the current `print_label` service or websocket shape,
  including caller-supplied fields, size, density, QR target, preview choice,
  and printer identity.
- The **Classic Path** is the compatibility behavior presented to old cards or
  by a new card when the backend has no complete Template Capability.
- The **Compatibility Adapter** is the single backend module that translates a
  Classic Request into immutable transient inputs for the canonical renderer.
  It is not a second renderer.
- A **Compatibility Render** is the adapter's transient render. It is not a
  Template Revision, Template Draft, default, portable export, or proof that a
  profile is product verified.
- A **Production Profile** is a Product-verified Profile with current local
  calibration that may authorize ordinary or batch production printing.
- A **Provisional Profile** has sufficient known geometry for preview,
  calibration, and administrator test printing, but not production eligibility.
- A **Claimed Combination** is one exact printer model/firmware, stock,
  orientation, profile, renderer/toolchain, font/assets, QR/image policy, and
  density mapping that the product says it supports for production.
- A **Release Evidence Record** is the immutable automated and physical proof
  associated with one release candidate and its claimed combinations.

## Capability negotiation and mixed versions

### One complete capability envelope

Capability discovery returns one envelope with at least:

- capability family and major/minor contract version;
- supported layout, template-store, portable-bundle, Binding Catalogue, Style
  Token catalogue, Capability Profile, compiler, renderer, and diagnostic
  versions;
- lifecycle, validate, preview, test-print, single-print, batch-preflight,
  batch-print, retry, import/export, and calibration operation availability;
- supported Label Sizes, source contexts, locales, element kinds, profiles,
  and operation limits;
- capability-generation identity; and
- the minimum compatible card contract where a restriction cannot be expressed
  through the envelope itself.

The envelope is valid only when every required v1 operation and catalogue can
be resolved consistently. A card must not assemble a guessed capability from
individual websocket registrations, entity attributes, manifest versions, or
successful trial calls. The integration changes the capability generation
whenever an advertised catalogue, profile, dependency, or operation changes.

Minor versions may add optional fields or catalogue entries only when older
clients can preserve or ignore them without changing meaning. A change to
document meaning, required input, output interpretation, authorization,
eligibility, or failure behavior requires a new major contract or an explicitly
negotiated feature. The card sends the negotiated contract identity on every
new-path command; the backend rejects a missing, stale, or unsupported identity
with a structured incompatibility result.

### Compatibility matrix

| Card | Integration | Behavior |
| --- | --- | --- |
| Old | Old | Existing Classic Path |
| New | Old | Classic dialogs and Classic Requests; no template controls or fidelity claim |
| Old | New | Legacy service/websocket contract remains functional through the legacy implementation or Compatibility Adapter |
| New | New, complete v1 capability | Template editor and canonical preview/print flow |
| New | New, incomplete/unknown capability | New flow unavailable with an actionable compatibility message; do not reinterpret it as a Classic Request |
| Any | Newer unreadable template/store | Preserve and quarantine according to the lifecycle contract; never downgrade or route it through classic printing |

Fallback is chosen before an operation starts. A failed template save, render,
preflight, or print never retries automatically through the Classic Path. Such
a retry could change content, layout, validation, authorization, or physical
output while presenting itself as recovery.

Capability loss during an open editor preserves the draft, marks previews
stale, disables mutation and printing, and offers reconnect/export recovery as
allowed by the lifecycle contract. It does not convert the draft to classic
dialog fields.

## Migration from the fixed layout

### No invented user migration

The current implementation persists no label layout, template identity,
default, dialog field selection, density, Label Size, or QR-target preference.
Both card dialogs initialize those values for each opening, and the backend
constructs one fixed payload for each request. Therefore rollout must not:

- claim that transient dialog choices were saved and migrated;
- scrape browser state into shared integration state;
- create Named Templates on behalf of users;
- turn a most-recent print into a default; or
- infer ownership or provenance that never existed.

On first initialization of the template store, the integration supplies stable,
versioned Factory Templates for the existing `50x30`, `40x30`, `50x50`,
`50x80`, and `50x15` Label Size identities. Each size has one valid designated
factory fallback. The layouts preserve the recognizable intent of the current
design, but they pass the new structural, content, profile, and print-safety
contracts; non-uniformly stretching the old 400×240 coordinates is not a
migration algorithm.

Factory initialization is idempotent and transactional. A retry cannot create
duplicates, change administrator defaults, or overwrite Named Templates. An
upgrade may advance a Factory Template head only under the lifecycle rules.

### Render-time choices remain outside templates

Printer installation, Capability Profile, local calibration, orientation,
density, copy count, subject, locale/time, and QR route configuration remain
Render Context or content inputs. They are not embedded in a Label Layout to
make migration appear more complete. The default QR binding uses the canonical
backend-owned routes from the content contract, not a browser-supplied base URL.

The product may later remember safe per-user or per-installation print choices,
but that would be a separately versioned preference contract. It is not template
migration and cannot change an immutable Template Revision.

### The Compatibility Adapter

The Compatibility Adapter is the only module allowed to understand the old
request shape after the fixed renderer is retired. It:

1. validates the request with the last supported legacy schema;
2. resolves its subject and legacy override semantics once;
3. creates an immutable transient compatibility content snapshot;
4. maps the requested legacy size and field flags to a versioned transient
   compatibility layout;
5. maps density through the selected legacy printer behavior without presenting
   that mapping as a Production Profile;
6. renders or prints through the same backend compiler/rasterizer interface as
   the template path; and
7. returns the legacy response shape plus internal audit identity where the old
   interface permits it.

The transient inputs are bounded operational artifacts. They never enter the
template library, become defaults, appear in export, or satisfy new-path print
eligibility. Arbitrary legacy `base_url` and caller-provided content remain
confined to the deprecated adapter; no new interface accepts them.

Compatibility preserves supported request meaning, not known-unsafe driver
behavior. Malformed sizes, invalid density for the resolved device, too-wide
rasters, or renderer failures return explicit errors rather than depending on
firmware cropping, wrapping, or corruption. Such tightening is documented as a
safety correction and covered by legacy regression cases.

## Cross-repository landing and release order

### Phase 1 — backend foundation

The integration lands first on its architecture branch and can ship while old
cards remain installed. It includes:

- versioned storage, Factory Templates, migration/quarantine, and backup;
- capability discovery and catalogues;
- canonical validation, compiler, renderer, content snapshots, profiles, and
  diagnostics;
- preview, calibration, test-print, production, and batch interfaces;
- legacy endpoints unchanged at their public seam; and
- contract fixtures and golden renders consumable by the card repository.

The Template Capability remains unadvertised or explicitly incomplete until
the entire required v1 backend interface is present. Shipping dormant pieces is
safe; advertising a partial editor contract is not.

### Phase 2 — card adoption

The card lands after a released or otherwise installable compatible backend
exists. It:

- validates capability discovery before lazy-loading the editor;
- retains classic dialogs and request shapes for an old backend;
- consumes shared contract fixtures rather than redefining catalogues;
- exposes template management and test print only to administrators;
- exposes production printing to authenticated users only when backend
  eligibility allows it; and
- makes classic, provisional, stale, and production-verified states visibly
  distinct.

No card release may require an unreleased backend. A development/prerelease card
may exercise a prerelease backend in the matched workspace, but its stable
artifact must retain the mixed-version behavior in the table above.

### Phase 3 — production profile promotion

Profiles may land as provisional with automated raster evidence. A profile is
promoted to production only after its physical matrix is complete and the
evidence record is reviewed. Profile promotion changes the capability
generation and invalidates stale results; it does not require rewriting Label
Layouts.

Stable promotion of the complete feature occurs only after backend-first and
card-second prereleases pass the cross-repository release gates below. The
workspace specification and reproducible fixtures land before or with the
product changes that depend on them.

## Feature exposure and user-visible fallback

The template editor has no permanent user-facing experimental switch. Exposure
is derived from authorization and the complete negotiated capability:

| State | Editor | Preview | Administrator test print | Production print |
| --- | --- | --- | --- | --- |
| Old/no Template Capability | No; show classic dialogs | Classic approximation only | Classic only | Classic only |
| Complete capability, no compatible profile | Yes | Only when a provisional compatible profile can render | Only when backend eligibility allows | No |
| Provisional profile | Yes | Authoritative raster marked provisional | Yes | No |
| Product verified, calibration absent/stale | Yes | Authoritative raster | Calibration/test label | No |
| Production Profile, current calibration | Yes | Authoritative raster | Yes | Yes |

Classic printing is labeled as the compatibility workflow and must not use
“output-faithful,” “calibrated,” or equivalent language. It retains the current
user's ability to print during the compatibility window, but its presence never
turns a template error into a printable result.

## Initial hardware and Label Size scope

The upstream integration's device table is not the Growspace support matrix.
Nominal DPI or width cannot transfer evidence between models.

The first production release selects one exact physically available 203-dpi,
50-mm model: B1 or B21. Only the tested model/firmware is claimed. The other
model may be added after its own evidence record; matching nominal printhead
dimensions alone are insufficient.

All five existing Label Sizes remain canonical catalogue identities and receive
Factory Templates. For a profile to claim one of them for production, the exact
stock and supported orientation must pass the physical matrix. A size without
that evidence remains visible only where a compatible provisional profile can
render it; it cannot inherit support from another size.

- D11/D110-class devices remain on the Classic Path initially. New-path support
  requires a separate narrow-stock profile, compatible factory layout, physical
  evidence, and card acceptance at the narrow canvas aspect ratio.
- B1 Pro, B21 Pro, and other 300-dpi devices remain provisional or unavailable
  until exact profiles and evidence exist. The compiler may support 300-dpi
  arithmetic before the product claims any 300-dpi output.
- A newly discovered upstream printer is unsupported by default. Discovery
  identifies hardware; it does not certify it.

## Localization acceptance

V1's supported product language is English, matching the current card and
integration translation catalogues. The capability advertises supported print
locales explicitly; it does not claim every locale accepted by a browser or
Python runtime.

English regional locale variants may use their correct date formatting while
sharing reviewed English captions, stage names, plurals, and diagnostics. The
backend resolves and snapshots the exact supported BCP 47 locale. An unsupported
locale blocks preview/preflight with an actionable compatibility diagnostic; it
never silently changes printed language or falls back to the Home Assistant
server's process locale.

Every new user-visible string lives in the appropriate card or integration
catalogue. Stable diagnostic codes remain language independent and are localized
by the card; printable captions and domain values are localized by the backend.
Tests fail on:

- a missing English key or raw user-visible string;
- parameter or plural mismatch between producer and translation;
- unbounded expansion, clipping, or inaccessible names under a pseudo-locale;
- a locale change that fails to invalidate Render Context;
- unsupported locale fallback; or
- browser and backend formatting disagreement for the captured locale.

A later language ships only as a complete card/backend translation pair with
its representative fixtures, long strings, plural categories, date formats,
font glyph coverage, golden rasters, and physical readable-text evidence. A UI
translation without printable-language support is not advertised as a supported
print locale.

## Accessibility acceptance

WCAG 2.2 Level AA is a stable-release requirement for the entire editor,
diagnostic recovery flow, template lifecycle dialogs, calibration flow, single
print, and batch preflight. A known Level A or AA failure is release-blocking,
not backlog polish.

Automated card tests cover semantic roles and names, programmatic labels and
descriptions, state/value exposure, focus order and restoration, keyboard
commands, live-region behavior, modal containment, non-color diagnostic cues,
contrast tokens, reduced-motion behavior, and 44×44 CSS-pixel touch targets.
They run at the normal desktop surface and a 390 CSS-pixel touch viewport, and
exercise 200% text scaling without clipped controls, lost actions, or horizontal
page scrolling.

Manual acceptance covers what static assertions cannot prove:

- complete keyboard-only creation, editing, validation recovery, save, test
  print, single print, and batch preflight;
- screen-reader comprehension of canvas selection, element movement/resizing,
  exact controls, warnings, errors, stale preview, progress, and completion;
- logical focus after opening/closing workbenches, following a diagnostic,
  resolving the final blocker, and recovering from failure;
- high-contrast/forced-colors visibility and a diagnostic system that never
  relies on color alone;
- reduced-motion operation with equivalent state-change feedback;
- pointer and touch manipulation, including explicit touch multi-select and
  alternatives to precision dragging;
- 200% text and long pseudo-localized strings on desktop and the narrow-screen
  full-screen editor; and
- zoom, pan, guides, handles, and raster status that remain distinguishable
  without obscuring printable content.

The raster itself is not expected to become a semantic editor. The element list,
Selection inspector, status summary, and diagnostics expose the equivalent
structure and operations. Keyboard users can perform every precise edit without
dragging; screen-reader users can identify every element by stable type, binding,
position, size, rotation, and validation state.

## Automated regression topology

The implementation is accepted through the narrow public seams established by
the sibling decisions. Tests do not couple the card to private `imagespec`
payloads or recreate a second renderer.

| Layer | Required proof |
| --- | --- |
| Backend unit/property | Closed schemas, normalization, quantized geometry, migrations, content formatting, compiler rounding, diagnostic severity, compatibility mapping, idempotency |
| Backend golden raster | Every factory layout, Label Size/profile/orientation, element kind/rotation, density identity, locale fixture, and representative/long/missing content set |
| Backend integration | Authorization, lifecycle/store transactions, preview/print byte identity, calibration invalidation, single/batch/retry snapshots, Niimbot adapter failures, backup/restore |
| Shared contract fixtures | Capability envelope, catalogues, lifecycle responses, diagnostics, Render Results, batch results, incompatibilities, and every negotiated version |
| Card unit/browser | Capability gating, schemas, editor commands, drafts, stale-result rejection, diagnostics, localization, accessibility, responsive workbench, classic fallback |
| Cross-repository HA E2E | Strain, plant, and batch printing; factory and Named Templates; preview/test/production; warnings/errors; disconnect/reconnect; old/new combinations |
| Release/update | Backend-first install, card-first independent update, upgrade and rollback containment, HACS card update, factory/store migration, classic deprecation messages |
| Physical | Exact claimed model/firmware/stock/orientation/density output and repeatability |

Every automated dimension is crossed deliberately rather than as an unbounded
Cartesian product. Pairwise coverage may reduce redundant combinations only
when each invariant also has a focused exhaustive test. At minimum, every
shipped Label Size, orientation, element kind, source context, representative
fixture family, supported locale, schema version, and mixed-version pair appears
in CI.

Golden raster changes require a named compiler/renderer/asset identity change,
reviewed visual diff, and invalidation analysis. Regenerating fixtures merely to
make a test green is not acceptance evidence.

### Mixed-version contract suite

Release fixtures retain the last supported old backend and old card contract.
The suite proves:

1. new card plus old backend exposes only the Classic Path and sends no new
   command;
2. old card plus new backend receives the legacy response and can preview,
   strain-print, plant-print, and batch-print as before;
3. new card plus new backend rejects partial, stale, and unknown capability
   envelopes without classic fallback after an operation starts;
4. old requests through the Compatibility Adapter preserve supported legacy
   size, field, QR, density, subject, preview, and printer semantics;
5. new template/store data survives rollback unreadable and byte-preserved,
   with template mutation/printing disabled and a repair issue raised; and
6. rollback never resets the library, replaces defaults, or routes template
   documents through the classic renderer.

## Physical evidence and stable-release gates

CI can prove raster identity but cannot certify marks on paper. Each Claimed
Combination therefore has a reviewed Release Evidence Record containing:

- exact printer model, firmware, upstream Niimbot integration, driver,
  compiler, renderer, font/assets, profile, stock, orientation, calibration,
  and test-procedure identities;
- all four printable edges, origin, feed alignment, measured tolerances, and
  repeated placement results;
- every permitted 90-degree element rotation and stock orientation;
- every allowed font/style at readable floor and comfort threshold with short,
  typical, long, accented, supported RTL/CJK where applicable, and missing-glyph
  cases;
- shortest, typical, and maximum QR targets at every allowed QR size and
  semantic density, scanned with the declared representative phone set;
- high-contrast, grayscale, transparent, remote-origin, and embedded-origin
  logo inputs after canonical normalization;
- every semantic density at its profile-resolved device value;
- repeated single prints and a representative multi-record/multi-copy batch
  covering drift, first-page behavior, pacing, missing bands, and retry; and
- pass/fail measurements, operator, date, retained rasters, photographs/scans,
  and deviations rather than a prose-only assertion that output looked right.

Physical evidence is profile data, not a permanent global checkbox. A relevant
dependency change invalidates only the records that depend on it and returns the
affected profile to provisional. A stable release may include such a provisional
profile, but release notes and capability discovery must agree that production
printing is disabled.

The stable production feature is blocked by any of:

- incomplete capability or shared-contract fixtures;
- failing backend, card, E2E, release/update, migration, or mixed-version tests;
- raster drift without reviewed identity/version change;
- any known WCAG 2.2 A/AA failure in the feature;
- missing English or pseudo-localization acceptance;
- absent or stale physical evidence for a profile advertised as production;
- unresolved critical/high-severity data-loss, wrong-label, wrong-subject,
  authorization, print-eligibility, batch-order, or output-fidelity defect; or
- release notes that omit classic limitations, support scope, calibration, or
  rollback behavior.

## Retirement of the old rendering path

The fixed-coordinate implementation and the public legacy request contract have
different retirement clocks.

### Fixed renderer removal

The fixed renderer may be deleted only when all conditions hold:

1. the Compatibility Adapter covers every supported Classic Request field and
   entry point, including strain, plant, batch, and preview;
2. golden and contract tests prove the documented mapping, including error
   tightening for unsafe device/size/density combinations;
3. the adapter delegates to the canonical compiler/rasterizer rather than
   copying its own paint logic;
4. old-card/new-backend E2E passes against the release artifact;
5. compatibility calls remain observably classic and create no template state;
6. backup, upgrade, downgrade-containment, and timeout/retry cases pass;
7. the adapter has shipped enabled in at least two stable backend releases; and
8. no unresolved critical/high-severity compatibility defect remains.

Removal is an implementation deletion behind the same interface. It does not
authorize deleting the service/websocket registration or making old cards fail.

### Legacy request removal

After fixed-renderer removal, the public legacy request contract remains
deprecated for at least one additional stable backend release. It may be removed
only when:

- stable release notes and in-product warnings named the exact removal version;
- the minimum supported card version uses capability negotiation and the new
  path;
- migration and repair guidance covers dashboards, automations, scripts, and
  service callers, not only HACS card users;
- all advertised production hardware/stock paths have a supported replacement,
  or the project explicitly documents the dropped support;
- strain-library, plant, and batch entry points all use the replacement;
- no unresolved critical/high-severity migration issue remains; and
- removal is a deliberate breaking release, never an incidental cleanup in a
  renderer refactor.

Elapsed time or low observed use is not sufficient because a self-hosted Home
Assistant integration has no authoritative usage telemetry. If these conditions
cannot be demonstrated, the narrow Compatibility Adapter remains.

## Required acceptance cases for implementation

1. A new card against the last old backend offers the current classic strain,
   plant, and batch workflows and never displays template controls.
2. An old card against a new backend completes classic preview and printing
   without learning any new request field.
3. A partial or unknown Template Capability disables the new flow with one
   actionable message; a failed new operation never falls back to classic.
4. Changing a capability generation invalidates cached catalogues, previews,
   eligibility, and open choices without discarding a draft.
5. The negotiated contract identity is required on new commands and stale or
   unsupported identities produce structured incompatibility diagnostics.
6. First initialization creates exactly one stable Factory Template and valid
   fallback per existing Label Size and creates no Named Template.
7. Repeating initialization or restoring a backup does not duplicate factories,
   change defaults, or overwrite user state.
8. The five factory layouts preserve design intent without non-uniformly scaling
   one 400×240 pixel document.
9. Printer, density, QR route, subject, locale, orientation, calibration, and
   copy count remain outside immutable Label Layouts.
10. A Classic Request creates no revision, draft, default, export entry, or
    template audit provenance.
11. Compatibility preview and print use the same canonical rasterizer output;
    legacy response adaptation does not create a second paint implementation.
12. Every supported legacy field maps deterministically; unknown sizes retain
    their documented old default while unsafe resolved geometry fails clearly.
13. Arbitrary legacy content/base URLs remain confined to the deprecated
    adapter and cannot enter new templates or canonical QR bindings.
14. Backend foundation can ship with the old card before the Template Capability
    is complete or advertised.
15. Stable card installation never requires an unreleased backend and validates
    the complete capability before lazy-loading the editor.
16. Administrator, authenticated-user, provisional-profile, calibration, and
    production-profile exposure matches the feature table exactly.
17. Classic UI never claims raster or paper fidelity; provisional UI never
    enables production printing.
18. The first production profile names one exact tested B1 or B21 model and does
    not infer support for the other, D11/D110, or a 300-dpi model.
19. Every Factory Template is available for editing/preview where compatible,
    while each stock size remains production-disabled until its exact evidence
    passes.
20. Unsupported locale resolution blocks explicitly; English regional dates,
    captions, plurals, diagnostics, and raster glyphs remain consistent.
21. Pseudo-localized expansion, 200% text, and the 390-pixel workbench retain
    every control, status, diagnostic, and recovery action.
22. Keyboard and screen-reader users can select, move, resize, rotate, align,
    duplicate, delete, inspect, undo/redo, save, and recover without dragging.
23. Focus, live announcements, forced colors, reduced motion, non-color cues,
    and 44×44 touch targets pass the automated/manual accessibility matrix.
24. Strain, plant, and every batch record use immutable content, revision,
    locale/time, profile, calibration, and ordering identities across preview,
    print, retry, disconnect, and reconnect.
25. Golden rasters cover every shipped size, orientation, element kind, source
    context, representative fixture family, supported locale, and schema
    version without exposing `imagespec` to card tests.
26. One physical evidence record can certify only its exact dependencies; a
    firmware, stock, font, renderer, policy, or mapping change returns affected
    combinations to provisional.
27. A production-profile release retains measured artifacts for edges, text,
    QR, logos, densities, repetition, and batch behavior; automated green alone
    cannot promote it.
28. A newer store encountered after rollback remains byte-preserved, read-only,
    and repairable; valid non-template Growspace features continue where safely
    isolated.
29. Fixed-renderer deletion leaves the legacy interface and old-card E2E green
    through the single Compatibility Adapter for two stable releases.
30. Legacy request removal occurs only in the announced breaking release after
    the additional stable deprecation cycle and all replacement/support criteria
    pass.

## Rejected alternatives

### Require synchronized card and backend updates

Rejected because HACS card and integration updates are independently installed,
cached, and rolled back. Requiring lockstep turns an ordinary update ordering
into a blank or broken printing surface. Explicit capability negotiation makes
the combination deterministic.

### Detect support from release numbers or command presence

Rejected because version strings and one registered command cannot prove that
catalogues, lifecycle, renderer, profiles, diagnostics, and failure semantics
agree. One complete envelope keeps the interface small and testable.

### Convert every classic print into a saved template

Rejected because no saved user layout exists to migrate. It would manufacture
ownership, defaults, and history from transient choices and fill the shared
library with accidental revisions.

### Let a failed template operation fall back to classic printing

Rejected because fallback could print different content or geometry after the
user saw a blocker. Fallback is negotiated before entry; failures remain in the
chosen path.

### Claim a printer family from nominal DPI and width

Rejected because firmware, printhead pixels, blind zones, registration, density,
media, and protocol behavior affect safety and readability. Evidence belongs to
an exact Claimed Combination.

### Make physical printing part of every pull request

Rejected because unattended CI cannot load stock, measure placement, scan QR
codes, or observe thermal and feed behavior reproducibly. Deterministic raster
proof runs in CI; reviewed physical evidence gates profile promotion and stable
production claims.

### Ship accessibility and localization after the editor works

Rejected because direct manipulation, recovery, diagnostics, narrow-screen
layout, and printed language define the interface itself. Retrofitting them
would change commands, focus, messages, geometry, fixtures, and acceptance after
the architecture had already hardened.

### Remove the legacy interface with the old renderer

Rejected because implementation locality and caller compatibility are separate.
The Compatibility Adapter permits deletion of duplicate paint logic while old
cards and automations continue across the announced deprecation window.

## Evidence and completion boundary

Read against backend commit `baec20b3993c10baeabe929e30f46fa28c57ecce`
and card commit `0bd7af52a0a49a4da00a7b0b0d7273a92d93b201`, the evidence snapshots used by
the sibling decisions.

- The backend currently accepts one unversioned Classic Request, constructs a
  fixed 400×240-based payload, non-uniformly scales it to five canvases, maps
  density globally, and sends it directly to Niimbot.
- The card currently recreates Label Size, field, density, QR, and preview state
  on each dialog opening; there is no saved label preference or template to
  migrate.
- The current card and integration each have an English catalogue only.
- Current product documentation names D11/D110/B21, while research shows the
  presets assume a 203-dpi 50-mm canvas, exceed D110's printhead, differ from
  B1/B21 driver pixels, and use density values invalid for several named models.
- The sibling decisions already require immutable template/content identities,
  one backend renderer, exact Render Context matching, profile-specific
  physical proof, fail-closed schemas, and preservation of newer data. Rollout
  cannot relax those rules temporarily while calling the result output-faithful.

This document completes the remaining Wayfinder decision. The next artifact may
turn issues #201–#207 into an implementation-ready cross-repository
specification. Product code, physical profile evidence, release scheduling, and
the eventual legacy breaking release remain implementation work governed by
that specification.

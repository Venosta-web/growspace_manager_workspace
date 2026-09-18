# Preview fidelity and print-safety contract — issue #207

Decision agreed with the user on 2026-09-18. Part of the specification map
[#200](https://github.com/Venosta-web/growspace_manager_workspace/issues/200).
This document resolves
[#207](https://github.com/Venosta-web/growspace_manager_workspace/issues/207);
it specifies future implementation and changes no product code.

It builds on the canonical renderer seam in
[`label-layout-and-rendering-seam.md`](label-layout-and-rendering-seam.md), the
content rules in [`label-content-binding.md`](label-content-binding.md), the
Template lifecycle in
[`label-template-lifecycle.md`](label-template-lifecycle.md), the accepted
editor prototype from issue #201, and the Niimbot rendering-envelope research
from issue #204. It assigns severities and evidence requirements without
changing those earlier contracts.

## Answer in brief

“Instantly mirrors changes” is a two-stage promise. The card updates
non-printing geometry feedback in the same animation frame, marks the
authoritative preview as updating within 100 ms, and starts a debounced,
cancellable backend render within 150 ms. Only the latest backend monochrome
PNG whose complete Render Context matches the current state is settled. The
reference target is a settled result within one second; a slower or failed
result remains visibly stale and can never authorize printing.

A current Render Result is printable only when it has no blocking diagnostics,
uses a product-verified Capability Profile, and uses current local calibration
for the installed printer, stock, and orientation. Errors identify known
unsafe, incompatible, or unverifiable output. Warnings identify printable
outcomes that deserve inspection. Warnings do not require acknowledgement for
a single print; the content contract's batch preflight remains the deliberate
exception.

The preview can guarantee exact raster fidelity: it is the bitmap submitted to
the printer adapter. Paper fidelity is a narrower, evidence-backed claim about
measured placement and readability tolerances for a verified profile. It is
never a promise of literal pixel-for-dot paper identity.

## Terminology

- **Provisional Feedback** is card-drawn selection, frame, guide, snapping, or
  transform feedback. It contains no authoritative printable text, QR, logo,
  or density simulation.
- A **Settled Preview** is the latest successful authoritative Render Result
  whose complete request identity matches the current editor state.
- A **Stale Preview** is a previously valid Render Result whose inputs no
  longer match, or whose profile evidence is no longer current.
- The **Printable Area** is the calibrated region within which a profile can
  place ink without known mechanical clipping.
- The **Safe Area** is the more conservative recommended inset inside the
  Printable Area.
- A **Protected QR Area** is the generated matrix and its complete quiet zone.
- A **Product-verified Profile** is a versioned printer-class, stock,
  orientation, renderer, asset, and density contract that has passed the
  physical evidence matrix in this document.
- **Local Calibration** is the measured placement record for one installed
  printer using a product-verified profile and one stock/orientation.
- A **Provisional Profile** has enough known geometry to render and produce a
  calibration label, but lacks evidence required for production printing.
- **Print Eligibility** is the backend decision for one immutable Render
  Context and operation; it is not inferred by the card from warning counts.

## The fidelity promise

### Immediate and settled states

One edit produces these observable states:

1. In the same animation frame, the card updates only editor chrome and the
   affected millimetre frame. Keyboard, pointer, and touch manipulation must
   not wait for a network round trip.
2. Within 100 ms, the preview region identifies that its raster is updating.
   If an older raster remains visible, it is marked **Out of date** rather
   than being presented as the result of the new edit.
3. Within 150 ms of the last input in a burst, the card starts a backend render.
   New input cancels or supersedes pending work. A completed response whose
   request identity is not current is discarded without briefly painting it.
4. On the reference local Home Assistant environment, the target from last
   input to Settled Preview is one second. Crossing that target produces a
   **Taking longer than expected** state, not a false success or a frozen
   editor.
5. The backend enforces a bounded, configurable render timeout. Timeout and
   network failure preserve the draft and last successful raster, identify the
   raster as stale, expose retry, and keep printing disabled.

The timing targets are interaction and acceptance budgets, not permission to
replace the backend renderer with browser approximation. Automated performance
tests use declared reference hardware, dataset, and network conditions and
report percentile results; they do not claim that every remote Home Assistant
connection completes within one second.

### Complete request identity

A preview is current only when all of these match the editor and selected
operation:

- normalized layout digest and immutable Template Revision or Template Draft
  version where applicable;
- immutable Label Content Snapshot or versioned representative fixture;
- Label Size, printer, stock, orientation, and Capability Profile versions;
- local-calibration identity;
- locale, time zone, and captured `as_of` value;
- semantic density choice and its profile-resolved device value;
- compiler, adapter, renderer, and shaping/rasterizer versions;
- binding, style, font, QR, image-policy, and asset versions; and
- capability generation and operation kind.

Any change invalidates print eligibility immediately, even when it happens not
to change the raster bytes. Density is the obvious case: it changes a printer
command rather than the PNG, but the old Render Context still cannot authorize
the new request.

### What the preview may claim

The UI presents three distinct statements where applicable:

1. **Raster exact** — “This is the exact bitmap Growspace Manager will send to
   the printer.” This requires a current backend raster but no physical claim.
2. **Calibrated output** — “This profile passed physical tests within its
   recorded placement and readability tolerances.” This requires current
   product evidence and local calibration; the tolerances and evidence date
   remain inspectable.
3. **Physical variability** — “Media, heat, wear, firmware, and the individual
   device may still affect the result.” This limitation is never hidden behind
   a generic high-fidelity label.

The product never says that a screen pixel predicts one physical dot. Browser
scale, antialiasing, display density, thermal dot gain, feed movement, media,
and heat prevent that claim even when raster bytes are exact.

## Eligibility and severity model

### Operation matrix

| Operation | Required result |
| --- | --- |
| Draft autosave | Always allowed for recoverable data, including invalid and stale state |
| Candidate validation | Returns every attributable diagnostic; no authority is granted |
| Preview | May return a raster plus warnings/errors when rendering is possible; otherwise diagnostics only |
| Publish revision | All document and publication invariants pass; invalid dependencies never publish |
| Administrator test print | Immutable draft/revision snapshot, exact current result, no blockers, and a profile permitted for that test purpose |
| Production single print | Published revision, actual content snapshot, exact current result, no blockers, product-verified profile, current local calibration |
| Production batch | Every actual record preflighted under one immutable plan, no blockers, product-verified profile, current local calibration, and acknowledgement of the exact warning set |

An error blocks every operation named by its diagnostic metadata. A warning is
never silently removed from review or audit. A single print does not add a
ceremonial confirmation for warnings; the operator can inspect them and print.
A batch retains the already-settled explicit acknowledgement because one
action can create many labels the operator did not inspect individually. Any
changed batch input invalidates that acknowledgement.

### Geometry and physical regions

Every profile exposes three nested boundaries in the unrotated Label Size
coordinate system:

1. the physical stock boundary;
2. the calibrated Printable Area; and
3. the recommended Safe Area.

Element geometry outside the physical stock is a document error as specified
by issue #206. Compiled ink outside the Printable Area is a profile error.
Compiled ink inside the Printable Area but outside the Safe Area is a warning.
Frames themselves may cross the Safe Area when their resolved ink does not;
diagnostics describe the actual compiled outcome and the relevant frame so the
editor does not pretend the two are identical.

Calibration and compilation never clamp, translate, scale, or crop a layout to
make it eligible. Switching profile may change diagnostics and raster pixel
dimensions, but never the saved millimetre geometry.

### Overlap and clipping

Overlap is evaluated from compiled element geometry and per-element ink masks,
not merely browser rectangles. Paint order remains deterministic.

| Outcome | Severity |
| --- | --- |
| Any other ink enters a Protected QR Area | Error |
| QR matrix or quiet-zone ink is clipped by its frame or Printable Area | Error |
| A required strain-name element is completely occluded | Error |
| Any ink leaves the physical stock or Printable Area | Error |
| Other partial ink-to-ink overlap | Warning |
| Explicit text `clip` or `ellipsis` truncates content | Warning |
| `shrink_ellipsis` reaches truncation after shrinking | Warning |
| Text `shrink` cannot fit at its declared minimum | Error, as settled by the content contract |
| Logo or divider loses ink to its own frame | Warning |
| Non-QR ink leaves only the recommended Safe Area | Warning |

Complete occlusion is determined from the required element's resolved ink mask,
not only its frame. A required element with no resolved ink for another reason
is diagnosed by content, font, or rendering validation rather than mislabeled
as overlap.

### Text and fonts

Printable text uses exact backend-owned font files and an identified shaping
and rasterization toolchain. The Render Context carries the font and toolchain
versions and checksums required to reproduce the result. Browser fonts, system
fonts, a similarly named face, and an unversioned fallback are never eligible.

A non-empty resolved string containing a glyph unavailable from its selected
font is an error for that record. The renderer does not substitute a fallback
font or a replacement glyph. Unicode normalization and localization happen in
the versioned binding formatter before measurement; the renderer records the
normalized-value digest and never lets a browser normalization choice alter
the output.

Each product-verified profile owns an evidence-backed **readable floor** and
the more conservative **comfort threshold** for every permitted font/style.
Resolved text below the readable floor is an error. Successful fitting below
the comfort threshold is an aggressive-auto-fit warning. Ellipsis and clipping
remain warnings when the readable floor is satisfied. No global millimetre or
DPI-derived guess stands in for those measurements.

### QR codes

The profile owns the tested minimum dots per module, complete quiet-zone
requirement, allowed error-correction policies, and maximum supported encoded
length. These values are verified with the exact QR generator and printer
pipeline, longest supported targets, relevant densities, and representative
phone cameras.

Failure to construct the target, fit an integer module scale, preserve the
quiet zone, meet the calibrated module floor, or remain within the Printable
Area is an error for plant and batch records. QR images are never interpolated,
non-uniformly scaled, contrast-adjusted, or rescued by density. Rotation is
allowed only where the profile and compiler explicitly support the canonical
fixed-frame convention.

### Images and dividers

The profile owns evidence-backed minimum effective image resolution and any
contrast/monochrome-conversion thresholds. Falling below a quality threshold
warns because a logo is optional presentation in v1; decode failure for a
dynamic breeder logo warns and paints blank, as settled by the content
contract. A missing or invalid static asset is a dependency error and may
quarantine the saved template. No URL-versus-data representation selects a
different validation policy.

A normalized image that produces no meaningful ink warns. Transparency is
composited and conversion is performed exactly as the selected versioned token
specifies. A divider below a profile's reproducible thickness or losing ink to
its frame warns; a dimension or rotation unsupported by the compiler is a
structural/profile error rather than an approximation.

### Density and rotation

Density is a semantic, profile-relative printer setting. It resolves to a valid
device command and is part of Render Context identity, but it does not mutate
the authoritative monochrome PNG. V1 provides no CSS opacity, contrast filter,
or other visual density simulation. The preview labels the chosen density and
explains that its physical effect cannot be shown exactly on screen.

Element rotation remains the canonical clockwise 0/90/180/270 fixed-frame
operation from issue #206. Whole-stock orientation belongs to the profile.
Unsupported element rotation, orientation, printhead extent, density, or stock
combination is an error. The compiler never maps an unsupported angle or
device setting to the nearest available value.

## Capability evidence and local calibration

### Two independent proofs

Production eligibility requires both:

- **product verification**, which proves a device class, stock, orientation,
  renderer/toolchain, fonts, QR policy, image policy, and density mapping; and
- **local calibration**, which records where one installed printer places ink
  on that stock and orientation.

A local calibration cannot promote an unsupported device class, untested
stock, or provisional quality threshold into product support. Conversely,
product evidence cannot know one installed printer's lateral and feed offsets.

### Profile and calibration states

| State | Preview | Calibration/test label | Production |
| --- | --- | --- | --- |
| Unknown or incomplete device/profile | No authoritative render | No | No |
| Provisional profile with known hard geometry | Yes, marked provisional | Yes | No |
| Product-verified profile, local calibration absent or stale | Yes | Yes | No |
| Product-verified profile, local calibration current | Yes | Yes | Yes |

The calibration flow prints a standardized test label through the same renderer
and adapter, identifies the exact profile/context on the sheet, measures all
four printable offsets and feed alignment, validates the entered measurements,
and stores an immutable calibration record with actor and timestamp. Repeating
calibration appends a record; it does not rewrite past audit evidence.

Elapsed time alone does not revoke calibration. The UI may warn and recommend a
periodic check, especially after media or maintenance changes. Calibration
becomes stale when a relevant identity changes: installed device, stock,
orientation, DPI or printhead geometry, firmware behavior, compiler/adapter,
renderer, font/asset, QR/image policy, or density mapping. The invalidation
names the changed dependency and routes the administrator back to calibration.

### Physical evidence matrix

A combination becomes product verified only after recorded tests cover:

- all four printable edges, origin, feed alignment, and declared placement
  tolerances;
- every supported stock orientation and permitted 90-degree element rotation;
- every supplied font/style at its readable floor and comfort threshold using
  short, typical, long, accented, CJK/RTL, and missing-glyph cases supported by
  that font;
- shortest, typical, and maximum supported QR targets at each allowed size and
  density, scanned by a declared representative phone-camera set;
- high-contrast, grayscale, transparent, remote-origin, and embedded-origin
  images after identical normalization and monochrome conversion;
- every semantic density at its device-valid mapped value;
- repeated prints and a representative batch to expose drift, blank first
  labels, feed errors, missing bands, stale status, and pacing faults; and
- the exact device/firmware, media, integration, compiler, renderer, asset, and
  test-procedure identities needed to interpret or repeat the evidence.

Changing a dependency invalidates only evidence that depends on it. An untested
combination remains provisional rather than inheriting evidence from a device
with the same nominal DPI or stock width. Threshold values are outputs of this
matrix and live in the versioned profile; this specification does not invent
unverified global numbers.

## Staleness and failure containment

Four stale states remain distinct:

1. An out-of-order render response is discarded and never displayed.
2. A displayed Render Result whose input identity changed remains optionally
   visible as **Out of date**, cannot authorize print, and is replaced only by
   a matching result.
3. A Template Draft based on an older head remains editable, previewable, and
   eligible for administrator test print when its exact snapshot has no
   blockers. Ordinary Save remains disabled; lifecycle recovery is reload,
   manual reapplication to a fresh draft, or Save As.
4. A batch warning acknowledgement becomes stale after any covered input or
   diagnostic change and must be collected again after full preflight.

A missing versioned font, asset, binding, compiler, renderer, or profile is a
named incompatibility. Saved revisions follow the quarantine and repair rules
from issues #205 and #206; the runtime does not make them printable by
substitution. A newer unreadable document remains preserved and read-only.

Render timeout, backend disconnect, authorization change, and transport failure
remain separate diagnostic layers. A renderer failure is not reported as
“printer offline,” and a Bluetooth failure does not invalidate raster fidelity.
No failure clears an editor draft or overwrites the last successful result.

## User-visible recovery path

The editor preserves invalid drafts and provides one deterministic route back
to eligibility:

1. Show a persistent summary with errors before warnings, grouped by element or
   batch record and carrying the current preview status.
2. Mark affected canvas objects with icon/shape/text cues that do not rely on
   color. A raster-only issue is also represented in the diagnostic list.
3. Activating a diagnostic selects and focuses the relevant element or record,
   moves focus to the exact inspector control where a direct correction exists,
   and retains a route back to the diagnostic list.
4. Profile/device errors open profile selection or the guided calibration flow
   rather than sending the user searching through element controls.
5. Every edit preserves undo/redo and triggers the normal debounced rerender.
   The diagnostic remains until an authoritative matching result removes it.
6. Status changes are announced through a polite live region; a newly blocked
   print and successful return to eligibility are understandable with a screen
   reader and at 200% text scaling.
7. Print becomes enabled only from backend eligibility for the exact current
   result. Focus does not jump to Print automatically when the final error
   clears.

Messages name the problem, consequence, and available action. They do not
expose raw exception text, depend on color, collapse warnings into a count, or
copy sensitive resolved content into logs. Long localized text, keyboard-only
operation, touch workbench operation, high-contrast mode, and slow/offline
states are acceptance surfaces, not follow-up polish.

There is no generic **Fix all**, automatic frame movement, font substitution,
profile substitution, hidden scaling, clipping repair, destructive reset, or
warning dismissal. **Discard draft**, **Restore revision**, **Replace from
factory**, profile selection, calibration, and exact element corrections keep
their distinct consequences.

## Required Render Result additions

In addition to issue #206's fields, the authoritative result exposes:

- status `current | stale | failed` only as evaluated against the request the
  backend knows; the card still compares the returned identity with its newest
  local request;
- exact input and local-calibration identities;
- profile evidence state, measured tolerances, and invalidation reasons;
- Printable Area, Safe Area, and compiled per-element ink bounds/mask identity;
- structured overlap pairs and the affected protected/required regions;
- font/glyph, resolved size, comfort, readable-floor, and truncation outcomes;
- QR matrix/module/quiet-zone measurements and applicable calibrated limits;
- image effective-resolution/contrast outcomes and applicable limits;
- operation-specific eligibility for publish, test print, single print, and
  batch preflight; and
- stable diagnostic codes, severity, layer, affected paths/IDs, parameters,
  and recovery-action kind.

The response does not need to expose raw per-element bitmaps to the client.
Mask digests and structured bounds may support caching and audit while the
backend retains authoritative mask comparison.

## Required acceptance cases for implementation

1. A drag updates frame chrome within one animation frame while printable text
   remains the previous raster marked Out of date until the backend settles.
2. A burst of edits produces at most the debounced current render; late results
   never flash on screen or enable Print.
3. The reference performance test distinguishes the same-frame, 100 ms, 150 ms,
   and one-second targets and reports percentile results under declared
   conditions.
4. Timeout or disconnect preserves the draft and stale raster, offers retry,
   and leaves every print path disabled.
5. Changing density can leave raster bytes identical but invalidates the old
   Render Context and resolves through the selected profile's valid range.
6. Ink inside stock but outside the Printable Area blocks; ink inside the
   Printable Area but outside the Safe Area only warns.
7. A frame crossing the Safe Area whose resolved ink remains inside it is
   diagnosed from the compiled outcome rather than a browser bounding-box
   guess.
8. Ink entering any QR quiet-zone module blocks, regardless of paint order.
9. Complete occlusion of required strain-name ink blocks; partial ordinary
   overlap warns and renders in canonical paint order.
10. Text clipping, ellipsis, shrink failure, and shrink-ellipsis produce the
    exact settled severities and element/record identities.
11. Text below the profile comfort threshold warns; text below its calibrated
    readable floor blocks.
12. An unsupported glyph blocks that record without fallback; browser font
    installation does not change the result.
13. A geometrically square QR still blocks when its integer module scale or
    quiet zone misses the profile threshold.
14. A corrupt dynamic breeder logo warns and paints blank; a missing static
    asset blocks/quarantines; a low-quality valid image warns.
15. Density selection changes no preview contrast or opacity. The current
    semantic setting and physical-variability explanation remain visible.
16. Unsupported rotation, stock, printhead width, or density blocks rather than
    coercing to a nearby supported value.
17. A provisional profile previews and prints the standardized calibration
    label but cannot production-print.
18. A product-verified profile without current local calibration cannot
    production-print and routes the administrator to calibration.
19. Completing calibration stores all four offsets, feed alignment, exact
    dependencies, actor, and time, then enables production only for that exact
    combination.
20. Changing one calibration dependency names it, stales eligibility, preserves
    past evidence, and requires recalibration; elapsed time alone only warns.
21. A stale Template Draft remains previewable and can administrator test-print
    when otherwise eligible, but cannot ordinary-Save or production-print.
22. A single print with warnings remains available without acknowledgement; a
    batch with warnings requires acknowledgement bound to the immutable
    preflight identity.
23. The diagnostics summary orders errors before warnings, focuses the exact
    element/record/control, works by keyboard and touch, and conveys every mark
    without color.
24. Clearing the final error triggers a new render and accessible status
    announcement; Print enables only after that matching result settles.
25. Preview, test print, production print, retry, and a batch item with the same
    Render Context produce identical raster bytes.
26. Physical acceptance records tolerances and dependencies and never convert a
    nominal DPI match into support for an untested device/stock combination.
27. The UI can truthfully show raster-exact, calibrated-output, and
    physical-variability statements together without implying pixel-for-dot
    paper identity.
28. Unknown/newer templates and missing versioned dependencies remain
    recoverable or quarantined and are never silently downgraded or repaired.

## Rejected alternatives

### Treat browser drawing as an authoritative low-latency preview

Rejected because browser font, QR, image, and clipping behavior is not the
printer toolchain. Provisional geometry plus cancellable backend rendering
gives responsive editing without reviving the two-renderer fidelity defect.

### Allow printing from the last successful raster

Rejected because a visually identical image can carry stale content, density,
profile, calibration, or renderer identity. Eligibility belongs to the exact
current Render Context, not to whatever PNG is still on screen.

### Make every overlap or safe-area excursion an error

Rejected because intentional composition within the calibrated Printable Area
can be safe. Protected QR regions, required-content occlusion, and mechanical
printability create hard boundaries; other overlap and conservative Safe Area
guidance remain visible warnings.

### Guess global text, QR, and image minima from DPI

Rejected because printhead behavior, media, font weight, density, firmware,
camera, and thermal dot gain affect physical readability. Versioned profile
thresholds must come from recorded tests.

### Let local calibration certify a new device class

Rejected because one alignment label cannot establish readable fonts, QR
scanning, image conversion, density mapping, repeatability, or batch behavior.
Local measurement complements product evidence; it does not replace it.

### Simulate density with CSS

Rejected because density changes printer heat, not raster data. A contrast or
opacity effect would knowingly show a bitmap different from the one sent to the
driver while claiming fidelity.

### Automatically repair blocked layouts

Rejected because moving, shrinking, substituting, omitting, or clipping content
changes the design and can hide lost information. Actionable diagnostics,
undoable user edits, profile choice, and calibration are the recovery path.

## Evidence and sibling boundaries

The Niimbot research at commit
`03078ab24d3533506031428b501ab3e837f52636` establishes that upstream preview
returns the exact raster submitted for the payload, version, fonts, and backend
environment. It also establishes that actual origin, blind zones, registration,
minimum reliable QR modules, text legibility, logo conversion, density/media
effects, and repeated-print behavior need physical verification. Nominal DPI
and renderer success are not substitutes.

The current product still has an independent CSS preview, hard-coded backend
composition, globally mapped density values that are invalid for some devices,
and a websocket bridge that discards the upstream preview response. This
document specifies the replacement contract; it does not implement that work.

Issue #203 owns compatibility, migration, rollout, cross-repository release
ordering, and final regression topology. It must preserve this document's
identity, eligibility, evidence, and user-visible safety boundaries rather than
temporarily authorizing the legacy approximate preview as output-faithful.

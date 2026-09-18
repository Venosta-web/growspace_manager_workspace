# Canonical Label Layout and rendering seam — issue #206

Decision recorded on 2026-09-18. Part of the specification map
[#200](https://github.com/Venosta-web/growspace_manager_workspace/issues/200).
This document resolves
[#206](https://github.com/Venosta-web/growspace_manager_workspace/issues/206);
it specifies future implementation and changes no product code.

It builds on the Label Template lifecycle contract in
[`label-template-lifecycle.md`](label-template-lifecycle.md), the Niimbot
rendering-envelope research from issue #204, and the accepted editor prototype
from issue #201. Its binding placeholders are now defined by
[`label-content-binding.md`](label-content-binding.md). The hub glossary
deliberately excludes product-repository vocabulary, so the terms introduced
here remain local to this cross-repository specification rather than being
added to `CONTEXT.md`.

## Answer in brief

A Template Revision contains one **Label Layout document**. The document is a
versioned JSON value with a versioned Label Size reference and an ordered list
of stable Label Elements. It describes absolute element frames in physical
millimetres. It does not contain CSS, browser pixels, `imagespec` payloads,
printer DPI, density, device IDs, resolved plant data, or rendered images.

The Home Assistant integration owns a deep **Label Renderer module**. Its
interface accepts a validated layout snapshot, a resolved content snapshot, and
a printer/stock Capability Profile. It returns a monochrome raster and
structured diagnostics. The same implementation is used by preview, test
print, production print, retries, and batch items. The Niimbot payload is a
private adapter detail behind that seam.

The Lovelace card owns editor interaction, local command history, and an
optimistic geometry overlay. It never becomes a second print renderer. After a
move, resize, style, binding, or content change, the card requests a backend
preview and reconciles to the returned raster. The settled backend PNG is the
output-fidelity oracle.

## Terminology

- A **Label Layout** is the complete printable design stored in one Template
  Revision or Template Draft.
- An **Element Frame** is an element's axis-aligned physical rectangle on the
  unrotated label, expressed in millimetres.
- A **Content Binding** is a versioned symbolic request for content. It is not
  an expression language and does not contain resolved plant or strain data.
- A **Style Token** is a versioned backend-owned printable resource or policy,
  such as a font face or image thresholding rule.
- A **Capability Profile** is the versioned printer, stock, orientation, safe
  area, resolution, density, and physical-calibration contract selected for a
  render or print.
- A **Render Context** is one immutable combination of a Label Layout snapshot,
  resolved content snapshot, Capability Profile, compiler version, renderer
  version, and font/asset versions.
- A **Render Result** is the authoritative raster plus resolved pixel geometry,
  element outcomes, diagnostics, and Render Context identity.

The lifecycle meanings of Label Size, Label Element, Label Template, Template
Revision, Template Draft, and Factory Template remain those defined by issue
#205.

## The canonical document

The first supported document family is `growspace.label-layout` version `1`.
The logical shape is:

```json
{
  "schema": "growspace.label-layout",
  "version": 1,
  "label_size_id": "growspace.stock.50x30.v1",
  "elements": [
    {
      "id": "01K5E4T4A7TR4Y48TXW3TJ45CG",
      "kind": "text",
      "frame": { "x_mm": 3, "y_mm": 3, "width_mm": 31, "height_mm": 7 },
      "rotation": 0,
      "content": { "binding": "strain.name", "parameters": {} },
      "style": {
        "font": "growspace.sans.bold.v1",
        "font_size_mm": 4.2,
        "horizontal_align": "left",
        "vertical_align": "center",
        "line_spacing": "compact",
        "overflow": "shrink_ellipsis",
        "minimum_font_size_mm": 2.2,
        "maximum_lines": 2
      }
    },
    {
      "id": "01K5E4VJJXPY6P5B67YHSE49D7",
      "kind": "divider",
      "frame": { "x_mm": 3, "y_mm": 11, "width_mm": 31, "height_mm": 0.4 },
      "rotation": 0,
      "style": { "fill": "black" }
    },
    {
      "id": "01K5E4W69CWGY5BGFSYPQWZQ69",
      "kind": "qr",
      "frame": { "x_mm": 37, "y_mm": 5, "width_mm": 10, "height_mm": 10 },
      "rotation": 0,
      "content": { "binding": "plant.link", "parameters": { "target": "dashboard_url" } },
      "style": { "error_correction": "high", "quiet_zone_modules": 4 }
    }
  ]
}
```

The binding names and parameters are defined by the sibling
[`label-content-binding.md`](label-content-binding.md) contract. Changing or
extending that catalogue does not change the layout model.

### Closed v1 field set

The v1 schema is closed and uses these exact structural fields:

| Object | Required fields | Rules |
| --- | --- | --- |
| Document | `schema`, `version`, `label_size_id`, `elements` | `schema` and `version` are the constants above; `elements` is an ordered array |
| Element | `id`, `kind`, `frame`, `rotation`, plus the kind fields below | No display name, visibility flag, z-index, or arbitrary metadata |
| Frame | `x_mm`, `y_mm`, `width_mm`, `height_mm` | Quantized finite numbers; positive extent; wholly within the physical Label Size |
| Binding source | `binding`, `parameters` | `binding` is a catalogue ID and `parameters` is a closed object validated by that catalogue entry |
| Literal source | `literal` | A bounded Unicode string; allowed only where the binding catalogue/capabilities permit static text or QR content |
| Asset source | `asset_id` | An opaque integration-owned asset identity; allowed only for logos |

Exactly one source variant is present. A source cannot contain both a binding
and a literal/asset fallback: missing-value behavior belongs to the binding
contract and must remain visible to validation.

The kind-specific fields are:

| Kind | Required fields after common fields | Closed style fields |
| --- | --- | --- |
| `text` | `content`, `style` | `font`, `font_size_mm`, `horizontal_align`, `vertical_align`, `line_spacing`, `overflow`, `minimum_font_size_mm`, `maximum_lines` |
| `logo` | `content`, `style` | `monochrome`; the only v1 fit is implicit `contain` |
| `qr` | `content`, `style` | `error_correction`, `quiet_zone_modules` |
| `divider` | `style` | `fill`, whose only v1 value is `black` |

`content` is a compatible Binding, Literal, or Asset source as described for
each kind. Required enum values and numeric ranges are those described in the
variant sections and further narrowed by the returned capabilities. Fields that
always have one meaning—logo `contain` and divider black fill—are nevertheless
explicit where shown so the serialized output is self-describing and a future
version cannot reinterpret absence.

### What belongs outside the document

Template UUID, name, revision, provenance, default status, draft owner and
draft version belong to the lifecycle envelope from issue #205. They do not
appear inside the layout.

The following are selected or resolved at render time and are not saved as
layout state:

- printer device, stock instance, DPI, printhead width, paper type, orientation,
  physical calibration, safe area, density, copies, and batch pacing;
- plant, strain, batch item, current date, locale, time zone, URL base, logos,
  and other resolved content;
- browser viewport, zoom, selection, guides, snapping, workbench state,
  diagnostics-panel state, and undo/redo history;
- compiled `imagespec`, integer pixel coordinates, measured text, fitted font
  sizes, generated QR matrices, normalized bitmaps, and raster PNGs.

Keeping these values out is what lets one revision render on different
compatible printer profiles and in different browsers without changing the
saved design.

## Identity, geometry, and ordering

### Stable element identity

Every element has an opaque, non-empty `id`, unique within its Label Layout.
The ID is stable across moves, resizing, styling, drafts, publications, and
historical restore. Reordering never changes it. Duplicating an element within
one layout mints a new ID.

Element identity is scoped to its template lineage. Duplicate and Save As may
retain element IDs because the new template UUID provides the outer identity;
no caller may address an element with its ID alone. IDs have no semantic
meaning and cannot grant permissions or select a Content Binding.

### Millimetre coordinate space

The versioned Label Size is the sole source of physical width and height. A
layout does not repeat those values. Every `x_mm`, `y_mm`, `width_mm`,
`height_mm`, font size, inset, and stroke thickness is a finite JSON number in
millimetres, quantized to `0.01 mm` and normalized by the backend. Values with
greater precision are rejected rather than silently rounded on publication.

The physical label's unrotated top-left corner is `(0, 0)`. Positive `x` moves
right and positive `y` moves down. Coordinates are relative to the complete
stock, not the printer's safe area. This keeps a design stable when calibration
changes and lets the renderer diagnose, rather than rewrite, content outside a
profile's safe area.

`width_mm` and `height_mm` must be positive. An element's right and bottom
edges are `x + width` and `y + height`. The document model has no negative
sizes, percentages, viewport units, implicit margins, anchors, responsive
breakpoints, or auto-layout containers. `x` and `y` must be non-negative and
every frame must be wholly inside the physical Label Size for publication. An
invalid draft may retain off-stock geometry for recovery, but it cannot publish
or print.

The compiler converts edges, not independent widths:

```text
left   = round_half_up(x_mm * dpi / 25.4)
top    = round_half_up(y_mm * dpi / 25.4)
right  = round_half_up((x_mm + width_mm) * dpi / 25.4)
bottom = round_half_up((y_mm + height_mm) * dpi / 25.4)
```

Pixel width is `right - left` and pixel height is `bottom - top`. Converting
shared edges this way prevents adjacent frames from acquiring gaps or overlaps
because their widths were rounded independently. The backend is the only
authoritative compiler; this formula is specified so its golden tests are
portable, not so the card can issue printer payloads.

### Rotation

`rotation` is one of `0`, `90`, `180`, or `270`, measured clockwise. The Element
Frame is the post-rotation occupied and clipped rectangle and never changes
merely because rotation changes. Printable content is laid out in a logical
canvas of `width × height` for 0/180 degrees and `height × width` for 90/270,
rotated into the fixed frame, then clipped to that frame.

This rule makes rotation independent of an editor drag handle and avoids the
ambiguous question of which corner should move. The backend compiler implements
the tested rotating-group convention required by `imagespec`; its anchor math
does not leak into the document. Element kinds may narrow the allowed set—for
example, a divider needs only 0/90 and a square QR is visually invariant—but no
kind may invent free-angle semantics.

Whole-stock orientation belongs to the Capability Profile. It is not simulated
by rotating every saved element or by swapping the Label Size.

### Paint order

The `elements` array is back-to-front paint order. The first element paints
first and each later element may cover it. There is no separate `z_index`; two
ordering mechanisms would permit contradictory state. Bring forward, send
backward, duplicate, and paste are array-order edits.

Overlap is therefore deterministic, but not normally implicit. The validator
reports overlapping ink-capable frames as a warning and names both stable IDs.
Known destructive overlap may become an error under issue #207's safety rules.
No grouping or nested stacking is present in v1.

## Element variants

Version 1 has exactly four variants. Unknown kinds are never coerced to a known
kind or dropped.

### Text

A text element contains one Content Binding or an explicitly allowed literal
source, an Element Frame, rotation, and a constrained text style:

- a versioned backend font Style Token;
- requested and minimum font sizes in millimetres;
- horizontal `left | center | right` alignment;
- vertical `top | center | bottom` alignment;
- a versioned line-spacing token;
- `maximum_lines`; and
- an overflow policy from `clip`, `ellipsis`, `shrink`, or
  `shrink_ellipsis`.

The binding catalogue decides which bindings permit literals, parameters, and
localization options. The layout contains no HTML, Markdown, CSS, Jinja,
JavaScript, format string, arbitrary template expression, or caller-supplied
font path.

### Logo

A logo element contains one image-capable Content Binding or integration-owned
asset reference, a frame, rotation, a fixed template aspect ratio, `contain`
fitting, and a versioned monochrome-conversion Style Token. Content preserves
its natural aspect ratio inside the frame and is centered by default; it is
never stretched. Transparency is composited onto white before the selected
threshold/dither policy.

The editor keeps the frame's template aspect ratio while resizing. A dynamic
binding may resolve to source images with different natural ratios; `contain`
letterboxing is deterministic and does not modify the frame. Remote URLs and
data URLs are resolution inputs, not saved image syntax. The integration
normalizes and caches allowed assets before rendering.

### QR

A QR element contains one QR-capable Content Binding, a square frame, rotation,
an error-correction token, and an integer quiet-zone module count. Width and
height must be equal in canonical geometry. Resizing is aspect-locked.

The integration resolves the binding, creates the matrix, and selects the
largest integer pixels-per-module scale that fits the frame after the required
quiet zone. It reports the module count, module pixel size, used pixel box, and
unused inset in the Render Result. The document cannot specify an arbitrary
renderer `boxsize` or bypass the Capability Profile's calibrated minimum module
size.

### Divider

A divider is a black, axis-aligned rectangular mark. Its frame is its complete
inked extent; its only v1 style is the `black` fill token. It contains no
binding. The editor presents it as length and thickness and constrains rotation
to 0/90. Rounded corners, arbitrary shapes, borders, colors, and freehand marks
are outside v1.

## Content-binding seam

A Content Binding is stored as a symbolic `binding` ID plus a JSON object of
schema-validated `parameters`. Binding IDs and parameter meanings come from a
versioned backend catalogue returned with editor capabilities. A layout never
stores a resolved string, generated URL, current date, or image merely as a
cache for that binding.

Each catalogue entry declares:

- compatible element kinds;
- parameter schema and defaults;
- which print contexts—strain, plant, or batch item—it supports;
- whether missing content blocks, omits, or substitutes a localized value;
- whether it is required by a valid template;
- its output type and maximum supported input size; and
- the representative values available to an editor preview.

The backend rejects a binding used with the wrong element kind or context. A
client cannot weaken a required binding or its missing-value policy by adding a
field to the document. The sibling
[`label-content-binding.md`](label-content-binding.md) contract defines the
catalogue and its policies; this document fixes the seam through which that
catalogue participates in layout.

No v1 expression language combines arbitrary bindings. If the product needs a
composite value such as localized plant details, it is a named, tested binding
whose formatter is backend-owned. This keeps authorization, escaping,
localization, missing-value behavior, and output-length testing out of saved
user expressions.

## Style and capability tokens

Style Tokens are opaque, versioned IDs supplied by the integration. A token
resolves to immutable printable assets and rules, not to browser CSS. At
minimum the capability response describes allowed font tokens, line-spacing
tokens, monochrome image policies, QR policies, element limits, coordinate
quantum, and supported schema versions.

Removing or changing a token never silently changes an old Template Revision.
An updated definition receives a new token version. A missing token quarantines
the affected template or produces an incompatible-profile diagnostic; it is not
substituted with a browser default or a vaguely similar backend resource.

Raw font size remains geometry rather than a token because exact millimetre
controls are part of the accepted editor. Weight and face are encoded by the
font token so the selected backend font file and its checksum are deterministic.
V1 is monochrome: foreground is black, background is white, and density remains
a profile-relative print setting rather than a visual style.

## Constraints and intentional omissions

V1 uses absolute frames plus small per-kind invariants. It does not persist a
general constraint graph. Alignment, distribution, snapping, guide placement,
multi-selection, and keyboard nudging are editor commands that write final
millimetre frames. Aspect locking is an intrinsic logo/QR edit rule and schema
invariant, not a relationship between elements.

This deliberately excludes groups, parent-relative coordinates, responsive
layouts, auto-flow, equal-size links, arbitrary masks, rich-text runs, paths,
custom shapes, conditional visibility expressions, and free-angle rotation.
Those features would enlarge every caller's interface and make output and
migration less predictable without serving the agreed label workflow.

The deletion test for the Label Renderer module is decisive: deleting it would
force lifecycle commands, preview, strain print, plant print, batch print, test
print, and every future printer adapter to reimplement binding, validation,
measurement, pixel conversion, and diagnostics. It therefore earns a single
cross-repository seam rather than acting as a payload pass-through.

## Text measurement and auto-fit ownership

The backend renderer owns all printable text measurement, line breaking,
ellipsis, fitting, clipping, and resolved font size. It uses the exact font
asset and renderer environment that compilation and print will use. Browser
canvas metrics and CSS layout are never authoritative.

For each text element the Render Result records at least the resolved string
digest, line count, requested and resolved font sizes, resolved pixel bounds,
overflow outcome, and whether the minimum font size was reached. It must not
return sensitive resolved content where the caller is not authorized to read
it; digests and structured outcomes are sufficient for audit and cache keys.

`shrink` and `shrink_ellipsis` choose the largest supported renderer font size
at or below the requested size that satisfies the frame and line limit. Search
order and integer conversion are compiler-versioned. Falling below the
requested size is not itself failure; crossing issue #207's calibrated
legibility threshold is. Reaching the configured minimum or applying ellipsis
is an explicit outcome that can drive a warning.

The card may show an immediate, clearly provisional box or previous raster
during a drag. It must not claim that its local text drawing is the printed
result or use local measurement to enable printing. The settled state is the
latest Render Result whose request identity matches the current draft state.

## Validation boundaries

Validation is layered so errors are attributable and no approximate repair is
hidden inside rendering.

1. **Document validation** checks schema/version, known fields and variants,
   finite quantized geometry, unique IDs, frame positivity, permitted rotation,
   per-kind structure, binding/style references, Label Size compatibility, and
   required layout roles. It needs no printer or concrete record.
2. **Content validation** resolves one representative or real record under the
   selected print context, authorization, locale, and time snapshot. It reports
   missing/invalid bindings without mutating the layout.
3. **Profile compilation** verifies stock compatibility, safe area, printhead
   width, pixel geometry, calibrated text/QR minima, image quality, and compiler
   support before constructing a private adapter payload.
4. **Raster rendering** invokes the pinned renderer and turns font, asset,
   image, and renderer failures into structured diagnostics.
5. **Transport and paper validation** belongs after a valid raster: device
   availability and protocol errors are distinct from physical calibration and
   post-print quality uncertainty.

The backend is authoritative at every layer. The card mirrors document and
common policy checks for immediate feedback, but server results decide whether
a draft may publish, preview, test-print, or production-print. Invalid drafts
remain persistable as required by issue #205.

Diagnostics have stable machine-readable codes, severity, document paths,
element IDs, parameters, and the validation layer that produced them. They do
not consist only of localized prose. Neither validation nor compilation clamps
coordinates, changes rotation, reorders elements, shrinks frames, substitutes
tokens, removes unknown fields, or omits failing elements.

Issue #207 decides the final error-versus-warning policy for printable/safe
areas, overlap, clipping, aggressive auto-fit, QR size, image quality, and stale
results. The structural rule here is that errors block the relevant operation,
warnings remain visible and auditable, and all outcomes come from the same
backend pipeline used to print.

## Serialization and versioning

Label Layouts are UTF-8 JSON values. The logical document is compared after
backend normalization, not by incidental key order or whitespace. When a
stable byte representation is required for checksums, exports, cache keys, or
golden fixtures, the integration emits RFC 8785 JSON Canonicalization Scheme
bytes after validating millimetre quantization.

The layout schema version changes only when document meaning or shape changes.
It is independent of:

- the template-library store and portable-bundle format versions;
- the binding-catalogue and Style Token catalogue versions;
- the compiler and renderer versions;
- the Capability Profile version; and
- the card release.

A Render Context records each of those identities separately. Thus a profile,
font, compiler, or renderer update invalidates cached rasters without pretending
that the saved layout changed.

Supported older layout versions migrate in backend memory through explicit,
tested, deterministic steps. Publishing the migrated state creates a new
Template Revision; historical revisions remain byte-truthful. A newer layout
version, unknown element kind, unknown same-version field, unavailable token,
or impossible migration is preserved raw and quarantined under issue #205's
rules. It is never best-effort decoded, downgraded, or round-tripped through a
client that cannot understand it.

The v1 document has a closed schema. Extensions require a new version rather
than ad hoc `metadata` bags. Lifecycle envelopes may retain provenance and
audit metadata, but those values cannot affect rendering unless promoted into
a future canonical schema.

## The rendering interface

The external seam exposes capabilities and outcomes, never Niimbot internals.
Exact Home Assistant websocket command names remain an implementation choice,
but their responsibilities are fixed:

### Discover capabilities

Return supported layout versions, Label Sizes, element variants, binding and
Style Token catalogues, compatible Capability Profiles, coordinate quantum,
and operation limits. The response carries a capability-generation identity so
the editor can invalidate stale choices.

### Validate a candidate or snapshot

Accept either a transient candidate document for interactive feedback or a
server-owned immutable Template Revision/Template Draft version reference.
Return normalized-document identity and structured diagnostics. Candidate
validation grants no persistence or authority and cannot be substituted for a
snapshot reference in production printing.

### Render a preview

Accept a server-owned revision/draft snapshot, or an explicitly transient
candidate for editor preview; one representative or authorized real content
reference; locale/time snapshot; and Capability Profile reference. Return:

- the exact monochrome PNG produced by the backend renderer;
- raster width/height and content type;
- normalized layout digest and complete Render Context identity;
- compiled pixel frame and outcome for each stable element ID;
- structured diagnostics and print eligibility; and
- a cache identity safe to reuse only for the same immutable inputs.

Transient candidate previews are visibly unpublished and cannot be printed.
An administrator test print references a validated immutable draft version.
Production print references a published revision or resolves the Effective
Default to one revision before rendering.

### Print

Resolve one immutable Template Revision or eligible Template Draft version and
one immutable content snapshot, call the same internal render implementation,
then pass its exact raster-equivalent adapter payload to the selected printer.
A retry reuses the captured references and Render Context; it does not resolve
the current default, current record, current date, or current draft again.

The printer adapter may compile the Render Plan to `imagespec` and invoke
Niimbot preview/print, but that representation is private. No card command,
saved template, export, or lifecycle operation accepts arbitrary `imagespec`.
This allows another printer adapter only when it can satisfy the same validated
Render Plan and result semantics; the v1 work does not promise or implement a
second brand.

## Precise responsibility split

| Concern | Lovelace card | Home Assistant integration |
| --- | --- | --- |
| Editor gestures, selection, guides, snapping, alignment, distribution, zoom | Owns | Does not interpret |
| Undo/redo and optimistic interaction overlay | Owns current editing session | Persists debounced draft snapshots only |
| Canonical layout/document authority | Caches and edits | Owns schema, normalization, persistence, migration, and authorization |
| Binding/style/profile catalogues | Presents returned capabilities | Defines, versions, and validates |
| Immediate diagnostics | May mirror for responsiveness | Authoritative |
| Content resolution and localization | Requests representative/real context | Owns and snapshots |
| Text/QR/image measurement and fitting | Never authoritative | Owns |
| Millimetre-to-pixel compilation | May scale editor chrome only | Owns printable conversion |
| Raster preview | Displays returned PNG and overlays handles | Produces exact raster and outcomes |
| Print eligibility | Displays backend result | Decides |
| Printer payload, density mapping, transport | No knowledge | Owns through printer adapter |
| Revision/default/draft lifecycle | Drives commands | Owns transactions and immutable references |

The card may render non-printing canvas chrome from millimetre frames at any
viewport scale. That is geometry feedback, not an independent approximation of
printable text, logos, or QR content. When the latest authoritative raster is
pending, stale, or failed, the UI says so and cannot present it as current.

## Stress-tested scenarios and required acceptance cases

1. A 50×30 layout opened on desktop and a 390-pixel phone has identical saved
   frames and backend raster; only editor zoom and workbench layout differ.
2. A 30×80 layout needs no special `tall` mode. Its Label Size supplies the
   physical aspect ratio and the same element rules apply.
3. Dragging at 137% browser zoom changes quantized millimetre coordinates, not
   CSS pixels. Reopening on another viewport reproduces the same layout.
4. Two elements exchange paint order without changing IDs or geometry. The
   raster and overlap diagnostics change deterministically.
5. Rotating non-square text 90 degrees leaves its Element Frame fixed, swaps
   its logical content canvas, and produces golden-tested pixel anchoring.
6. Adjacent divider/text frames sharing one millimetre edge compile through
   edge rounding and do not gain a rounding gap at 203 or 300 dpi.
7. Long text is measured only with the backend font. The Render Result reports
   shrink/ellipsis and resolved size; browser font availability changes nothing.
8. Missing required content is a Content Binding error for that record. The
   layout is not rewritten, and another valid record may still render it.
9. Missing optional logo content follows its binding policy. No broken remote
   image placeholder reaches the raster.
10. A QR frame that fits geometrically but yields too few pixels per module for
    the selected profile is rejected before printing and names the QR element.
11. Moving an element partly outside the physical stock is a document error;
    moving it inside stock but outside a calibrated safe area is a profile
    diagnostic. Neither case clamps the frame.
12. Deliberate overlap paints in array order and remains explicit in the Render
    Result. A card preview cannot hide a backend overlap outcome.
13. A logo supplied once as a URL and once as equivalent uploaded content is
    normalized to the same monochrome policy; representation does not select a
    different rendering path.
14. A printer/profile change may alter pixel dimensions and safety diagnostics
    but cannot mutate the revision's millimetre frames or Style Tokens.
15. Density changes the profile-resolved printer command, not the authoritative
    monochrome PNG and not saved layout styling.
16. A preview request finishing after a newer draft edit is discarded by the
    card because its normalized layout/request identity is stale.
17. Preview, test print, production print, retry, and a batch item using the
    same immutable Render Context produce the same raster bytes.
18. A batch captures one revision but a distinct immutable content/time
    snapshot per item; saving a new template revision mid-batch changes none of
    the remaining items.
19. Unknown v2 data opened by a v1 backend is preserved and quarantined. A v1
    card cannot save it back as a lossy v1 document.
20. Missing font, binding, asset, or profile versions produce named structured
    incompatibility diagnostics. Defaults are never silently substituted.
21. The card never sends raw `imagespec`, pixel coordinates, HTML preview
    fragments, or an authoritative template document in a production print
    command.
22. Factory and Named Templates cross the same renderer interface; factory
    status creates no second rendering implementation.

## Rejected alternatives

### Save the HTML/CSS composition

Rejected because browser fonts, layout, QR generation, viewport units, and CSS
clipping are not the Niimbot renderer. It would preserve today's two-renderer
fidelity bug and couple templates to browser behavior.

### Save `imagespec` directly

Rejected because it exposes a broad third-party payload language, integer
device pixels, renderer-specific property inconsistencies, and Niimbot adapter
details. It cannot represent one physical design across 203/300 dpi profiles
without rewriting saved templates.

### Save a pre-rendered bitmap

Rejected because content bindings, localization, batch items, text fitting,
profile changes, accessibility in the editor, and future safe validation all
need structured elements. A bitmap is an output/cache artifact, not the design.

### Let the card compile and the backend print

Rejected because it makes a browser release part of the print toolchain,
duplicates font and fitting logic, weakens authorization and validation, and
cannot guarantee that retries or non-card callers use the same output.

### Persist responsive constraints or a general scene graph

Rejected because labels have a fixed physical size and the accepted workflow
needs only absolute placement plus editing commands. A general graph would be a
shallow, expansive interface for behaviors v1 does not need.

### Put printer/profile selection in every template

Rejected because a Label Template belongs to physical stock, while compatible
devices and calibrations vary by installation and over time. Render-time profile
selection keeps the layout portable and lets incompatibility fail explicitly.

## Evidence and remaining sibling decisions

Read against backend commit `baec20b3993c10baeabe929e30f46fa28c57ecce`
and card commit `0bd7af52a0a49a4da00a7b0b0d7273a92d93b201`, the same evidence snapshots used
by issue #205.

- Backend `services/strain_library.py` currently builds a fixed 400×240-style
  `imagespec` list, non-uniformly scales it into five hard-coded canvases, maps
  density globally, and calls Niimbot directly.
- Backend `websocket/plant.py` currently discards the upstream preview response.
- Card `label-preview.ts` independently draws CSS text, a browser-generated QR,
  logo, and density simulation with layout modes tied to its viewport.
- Card print dialogs and the backend separately enumerate the same five sizes.

The Label Renderer module, backend-owned capability catalogue, and Render Result
replace all four independent sources of output meaning.

The binding catalogue and record-level missing-content policy are defined by
[`label-content-binding.md`](label-content-binding.md). This issue deliberately
does not choose warning/error thresholds and responsiveness SLA (#207), physical
calibration and paper-fidelity test loop (#207), or rollout and old-client
compatibility sequence (#203). Those decisions must use the document and
rendering seam specified here rather than introducing another layout or
rendering path.

No runtime tests were run for this documentation-only decision; no product code
or bundles changed.

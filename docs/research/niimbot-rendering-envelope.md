# Niimbot rendering envelope

Research for [Establish the real Niimbot rendering envelope](https://github.com/Venosta-web/growspace_manager_workspace/issues/204), captured 2026-09-17.

## Answer in brief

The output-faithful seam is the **rendered monochrome bitmap**, not an HTML reconstruction of an `imagespec` payload. The Niimbot integration renders the payload once with `imagespec`, stores that PNG as the printer's last-label image, returns the same PNG for `preview: true`, and otherwise sends that rendered image to the printer. A faithful editor must therefore compile the canonical millimetre layout into a device-specific integer-pixel payload, ask the backend to render it, and display that returned raster. It must not independently reproduce font metrics, wrapping, QR sizing, image fitting, clipping, palette conversion, or rotation in CSS.

That makes the mathematical preview exact for the raster submitted to the driver, but not automatically exact for marks on paper. Printhead width, DPI, loaded stock, unimplemented margins/blind zones, feed registration, density, thermal media, firmware, and model-specific protocol behavior remain physical variables. They require a capability profile plus calibrated test prints.

The current Growspace implementation is outside that envelope in several ways: its browser preview is a separate CSS/SVG composition; its backend has a separate fixed-coordinate payload; some previewed fields are never printed; all size presets assume 203 dpi and a 400-pixel printhead; and its density values are invalid for several models the project says it supports.

## Evidence classification

This note uses three confidence classes:

- **Documented integration contract**: behavior explicitly documented by the owners of `hass-niimbot` or its pinned `imagespec` renderer. This is authoritative for those versions, but the printer protocol is reverse-engineered rather than a NIIMBOT vendor guarantee.
- **Code-derived fact**: behavior established by the exact source snapshots inspected, whether or not user-facing documentation promises it.
- **Physical verification required**: paper/firmware behavior that source code cannot guarantee, or a mismatch that the current stack does not validate.

The inspected upstream integration snapshot is `hass-niimbot` 3.1.3 at commit [`f2bed905`](https://github.com/eigger/hass-niimbot/tree/f2bed90599dfe4459a80079fd3430d93d26caf40), whose manifest pins `imagespec[datamatrix]==0.4.0` ([manifest](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/manifest.json#L55-L61)). The renderer was inspected at the corresponding `imagespec` 0.4.0 commit [`34c8bf21`](https://github.com/eigger/imagespec/tree/34c8bf2100fc3c6b04467e986491e679cddfdc81). No installed `custom_components/niimbot` copy was present under this workspace's `ha-dev` or `ha-test` configuration, so the exact version running on a user's Home Assistant instance remains a runtime precondition, not a fact established here.

## Rendering and coordinate contract

### Documented integration contract

- An `imagespec` payload is an ordered list of element dictionaries. Later elements paint over earlier elements. Coordinates are **integer pixels**, with `(0, 0)` at the top-left, positive `x` to the right, and positive `y` downward. Content outside the canvas is clipped rather than automatically resized ([authoring contract](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/docs/authoring.md#L15-L31), [overflow guidance](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/docs/authoring.md#L156-L164)).
- The Home Assistant service admits canvas widths and heights from 10 through 1600 pixels and whole-label rotations of 0, 90, 180, or 270 degrees ([service schema](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/services.yaml#L22-L45)). These are input bounds, not a promise that a chosen printer can physically print every admitted size.
- Niimbot uses `rotate_mode="image"`: 90/270-degree whole-label rotation rotates the rendered drawing and swaps output width and height; 0/180 retain the dimensions ([adapter](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/render.py#L45-L79), [renderer semantics](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/core.py#L24-L75)).
- Absolute placement, clipped `group` containers, and auto-layout `row`/`column`/`stack` containers are available. A group or stack may rotate its whole sub-layout by 90/180/270 degrees ([layout guidance](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/docs/authoring.md#L62-L109), [group implementation](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/layout.py#L1-L60)).

### Code-derived facts and constraints

- Element rotation is not a uniform primitive. `text` uses the key `rotation`; `dlimg` uses `rotate`; QR and rectangle elements have no direct rotation field. Wrapping an element in a rotating `group` is the consistent compiler strategy for canonical 90-degree element rotation ([text implementation](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/text.py#L49-L119), [image implementation](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/media.py#L226-L284)). Rotated-group anchoring and the expanded bounding box still need golden-render tests before becoming an editor contract.
- `imagespec` itself validates positive canvas dimensions and allowed whole-canvas rotation, but it does not reject overlaps or elements outside the canvas. Clipping is an output behavior, not a diagnostic ([render loop](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/core.py#L24-L112)). The editor must calculate bounds, overlap, safe-area, and minimum-size diagnostics itself.
- Millimetres are not accepted by the renderer. The canonical model can remain in millimetres, but compilation must select a device/stock profile and round every coordinate and extent to pixels. The integration's optional label-catalogue lookup uses `round(mm / 25.4 * dpi)` and swaps print width/height for catalogue rotations of 90/270 ([cloud conversion](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/cloud.py#L73-L79), [orientation conversion](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/cloud.py#L101-L150)).

## Resolution, printable size, and margins

### Documented integration contract

- Hardware is not uniformly 203 dpi. Supported models include 203- and 300-dpi families, and printheads range from 96 pixels on D110-class devices through hundreds of pixels on B1/B21-class devices. The integration documentation explicitly says the real per-row limit is `printheadPixels`, which may disagree with the nominal millimetre width ([device-table interpretation](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/devices.md#L9-L24), [D11/B21/D110/B1 rows](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/devices.md#L40-L75)). Examples relevant to Growspace are:

  | Model | DPI | documented max width | `printheadPixels` in driver | density range |
  | --- | ---: | ---: | ---: | ---: |
  | D110 | 203 | 15 mm | 96 px | 1–3 |
  | B21 | 203 | 50 mm | 384 px | 1–5 |
  | B1 | 203 | 50 mm | 384 px | 1–5 |
  | B1 Pro | 300 | 50 mm | 567 px | 1–5 |
  | B21 Pro | 300 | 50 mm | 591 px | 1–5 |

- The transport sends a one-bit bitmap row by row, most-significant bit first, with set bits meaning black. A row is `ceil(width / 8)` bytes and must not exceed the model printhead pixel count ([printing format](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/printing.md#L10-L22)).
- The integration documents that print margins are currently ignored even though the vendor catalogue exposes a per-stock `blindZone`; edge-to-edge content can therefore clip, particularly near the leading edge of black-mark media ([known limitations](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/printing.md#L239-L246)).

### Code-derived facts and constraints

- Growspace hard-codes `50x30 → 400×240`, `40x30 → 320×240`, `50x50 → 400×400`, `50x80 → 400×640`, and `50x15 → 400×120`, which is exactly 8 px/mm (203.2 dpi) in both axes. It always sends `rotate: 0`, and scales a single fixed 400×240 composition non-uniformly into every other shape ([Growspace payload and presets](https://github.com/Venosta-web/growspace_manager/blob/baec20b3993c10baeabe929e30f46fa28c57ecce/custom_components/growspace_manager/services/strain_library.py#L534-L675)).
- Those presets fit a 203-dpi 50-mm-class canvas conceptually, but do not fit the driver's 384-pixel B1/B21 printhead exactly and are categorically incompatible with the 96-pixel D110 printhead. The upstream transport uses the submitted image width to generate every row and uses model metadata only for row-counter encoding; no width-versus-printhead rejection appears before transfer ([model metadata use](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/niimprint/printer.py#L300-L343), [row transfer](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/niimprint/printer.py#L542-L674)). The editor must block an incompatible profile before invoking the driver; it cannot rely on the service selector or transport to do so.
- The optional upstream cloud catalogue can supply roll width, height, DPI, paper type, rotation, and a margin field, but only when the caller omits width/height/paper type. Growspace always supplies width and height, so catalogue dimensions cannot correct its presets ([catalogue contract](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/cloud.py#L1-L12), [service default selection](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/__init__.py#L269-L280)).

### Physical verification required

- Actual printable origin, leading/trailing blind zones, lateral offset, feed-axis registration, and whether a particular roll is truly the nominal dimensions.
- Behavior when a too-wide image is sent. The docs say it must not happen, but the current driver does not reject it. Cropping, wrapping, rejection, corruption, and apparent success are firmware-specific risks.
- The conversion profile for every supported printer/stock/orientation pair. Model ID alone is not always unique, and some driver `printheadPixels` values are explicitly estimates in the upstream model table.

## Text, fonts, wrapping, and auto-fit

### Documented integration contract

- Niimbot's adapter resolves font basenames first from `custom_components/niimbot/fonts/`, then from Home Assistant's `www/fonts/`, and uses `ppb.ttf` as its default ([font resolver](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/render.py#L9-L42)). `imagespec` then falls back from the host resolver to a bundled font of the requested basename and finally to its bundled default, otherwise raising `RenderError` ([font fallback](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/context.py#L70-L99)).
- `new_multiline` draws explicit newline-separated text. With `fit: true`, it measures the complete Pillow-rendered block and proportionally reduces font size and spacing until width and then height fit. It does **not** perform word wrapping ([implementation](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/text.py#L164-L245)).
- `text_fit` is the renderer's bounded, word-wrapping primitive. It supports `max_lines`, horizontal/vertical alignment, a minimum font size, and `shrink`, `ellipsis`, or `shrink_ellipsis` overflow policies ([implementation](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/text.py#L339-L439)). A single over-long word is ellipsized rather than hyphenated ([line fitting](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/text.py#L18-L46)).

### Code-derived facts and constraints

- Font names are server-side assets, not browser fonts. Output fidelity requires a small, versioned allowlist whose actual font files are available to the backend; the client cannot treat an arbitrary CSS font selection as printable.
- Pillow's font measurement and integer font-size conversion are part of the output contract. A browser implementation of the same nominal typeface is not a metric oracle.
- The current backend prints only strain name, phenotype/breeder/lineage, a breeder logo, QR, and the current date. The browser preview additionally shows start date, stage/age, and plant ID, but those values are never added as printable text elements. Conversely, the backend always prints its timestamp and the current preview has no equivalent element ([backend composition](https://github.com/Venosta-web/growspace_manager/blob/baec20b3993c10baeabe929e30f46fa28c57ecce/custom_components/growspace_manager/services/strain_library.py#L537-L641), [preview fields](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/0bd7af52a0a49a4da00a7b0b0d7273a92d93b201/src/features/shared/ui/label-preview.ts#L54-L75)).

## Images, QR codes, palette, and density

### Documented integration contract

- `dlimg` accepts HTTP(S) and `data:` URLs; local paths are disabled by the Niimbot context. It supports exact target pixel dimensions, stretch/contain/fill fitting, element rotation, and optional dithering ([image handler](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/media.py#L202-L284)).
- QR data determines the QR version. The renderer defaults to high error correction, a one-module border, and two pixels per module. The caller may instead supply a fixed pixel box; the renderer preserves square aspect, uses nearest-neighbor scaling, and only uses an integer scale factor when enlarging ([QR handler](https://github.com/eigger/imagespec/blob/34c8bf2100fc3c6b04467e986491e679cddfdc81/src/imagespec/elements/codes.py#L26-L79)).
- The Niimbot adapter renders to a black/white palette with whole-label dithering disabled ([adapter](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/render.py#L68-L78)). The transport then converts the raster to one-bit rows ([driver](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/niimprint/printer.py#L542-L557)).
- Density is a printer heat/quality command with model-specific ranges, not a rendering input. The service UI permits 1–20 globally, but the driver validates against the selected model's range before printing ([service field](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/services.yaml#L46-L53), [driver validation](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/niimprint/printer.py#L1087-L1096)).

### Code-derived facts and constraints

- Growspace maps Light/Normal/Dark to 3/5/8. `8` is invalid on D110, B1, B21, B1 Pro, and B21 Pro; `5` is also invalid on D110. This turns two friendly UI choices into guaranteed service failures on some advertised devices ([Growspace mapping](https://github.com/Venosta-web/growspace_manager/blob/baec20b3993c10baeabe929e30f46fa28c57ecce/custom_components/growspace_manager/services/strain_library.py#L642-L643), [model ranges](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/devices.md#L40-L75)). Friendly density choices must map through the selected printer profile, not to global integers.
- The card's current preview simulates density with CSS opacity and contrast, while the real renderer produces the same bitmap for every density and density only affects the printer command. That visual effect is illustrative, not output-faithful ([preview CSS](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/0bd7af52a0a49a4da00a7b0b0d7273a92d93b201/src/features/shared/ui/label-preview.ts#L81-L103), [service path](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/__init__.py#L277-L340)).
- A QR box can be mathematically rendered yet physically unscannable. Neither `imagespec` nor Growspace enforces a minimum printed module dimension or a stock/printer-specific quiet zone. Validation must derive module count from the actual data/error-correction setting and enforce a tested minimum dot/module size; density cannot repair undersized geometry.
- Growspace downscales base64 logos larger than 25,000 characters to at most 100×100 and may convert them to one-bit PNG, while remote URLs bypass that preprocessing ([logo preprocessing](https://github.com/Venosta-web/growspace_manager/blob/baec20b3993c10baeabe929e30f46fa28c57ecce/custom_components/growspace_manager/services/strain_library.py#L68-L110)). A canonical image contract should normalize both sources before validation so preview and print do not depend on URL-vs-data representation.

### Physical verification required

- Minimum reliable QR module size and quiet zone for each DPI/media/density combination, tested with the longest supported URLs and representative phone cameras.
- Small-text legibility thresholds for each allowed font/weight and printer class.
- How logo thresholding/dithering performs on real thermal media. The exact submitted bitmap can be previewed, but dot gain, heat, coating, ribbon, and media color cannot.
- The user-visible meaning of density presets. A preview may label density and optionally show a clearly marked simulation, but it must not present CSS contrast as the predicted printed bitmap.

## Preview facilities and present fidelity gap

### Documented integration contract

- Every print request is first rendered to a PNG. That PNG updates the integration's last-label image entity. With `preview: true`, the service returns it as a `data:image/png;base64,...` response before any Bluetooth lookup or print command; a real print returns the same image alongside its print result ([service implementation](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/__init__.py#L269-L346)). Therefore this response is the exact raster the driver would submit for that payload, version, fonts, and backend environment.

### Code-derived facts and constraints

- Growspace's service handler already requests and returns the Niimbot service response, but its websocket handler awaits the Growspace service and discards the return value ([service bridge](https://github.com/Venosta-web/growspace_manager/blob/baec20b3993c10baeabe929e30f46fa28c57ecce/custom_components/growspace_manager/services/strain_library.py#L667-L695), [websocket bridge](https://github.com/Venosta-web/growspace_manager/blob/baec20b3993c10baeabe929e30f46fa28c57ecce/custom_components/growspace_manager/websocket/plant.py#L685-L694)). The card cannot currently consume the authoritative preview through its normal command.
- The card instead uses a separate CSS flex layout, browser sans-serif font, independently generated SVG QR at error correction M, and approximate fixed display sizes ([preview implementation](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/0bd7af52a0a49a4da00a7b0b0d7273a92d93b201/src/features/shared/ui/label-preview.ts#L12-L48), [layout styles](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/0bd7af52a0a49a4da00a7b0b0d7273a92d93b201/src/features/shared/ui/label-preview.ts#L81-L217)). It cannot be made output-faithful by adding draggable CSS boxes alone.
- Batch printing calls `preview: true` as a supposed printer-session warm-up, but the upstream service returns before looking up Bluetooth when previewing. It cannot initialize a printer session on the inspected integration version ([batch call](https://github.com/Venosta-web/lovelace-growspace-manager-card/blob/0bd7af52a0a49a4da00a7b0b0d7273a92d93b201/src/dialogs/batch-print-label-dialog.ts#L162-L181), [upstream early return](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/custom_components/niimbot/__init__.py#L284-L320)). Whether the first real print is blank on particular hardware remains a separate physical/protocol issue; this preview call cannot be its remedy.

### The upstream visual editor is interaction reference, not a renderer

The Niimbot project links its own browser-based Payload Layout Editor. At inspected commit [`517349ae`](https://github.com/eigger/eigger.github.io/tree/517349ae04c9063f4fd6b6ed248570229e16572e), it already demonstrates drag, four-corner resize, duplicate/delete, z-order changes, numeric properties, pan/zoom, grid display, and YAML import/export ([interaction core](https://github.com/eigger/eigger.github.io/blob/517349ae04c9063f4fd6b6ed248570229e16572e/imagespec-editor/core.js#L159-L201), [editing operations](https://github.com/eigger/eigger.github.io/blob/517349ae04c9063f4fd6b6ed248570229e16572e/imagespec-editor/core.js#L634-L898)). It is useful evidence that these interactions fit the payload model.

It is explicitly unsuitable as the preview oracle: it uses browser `sans-serif`, abbreviates or omits `imagespec` fitting behavior, substitutes placeholders for images, and depicts QR with a symbolic finder pattern rather than encoding the payload data ([text/QR approximations](https://github.com/eigger/eigger.github.io/blob/517349ae04c9063f4fd6b6ed248570229e16572e/imagespec-editor/core.js#L360-L399), [image approximation](https://github.com/eigger/eigger.github.io/blob/517349ae04c9063f4fd6b6ed248570229e16572e/imagespec-editor/core.js#L470-L504), [text-fit approximation](https://github.com/eigger/eigger.github.io/blob/517349ae04c9063f4fd6b6ed248570229e16572e/imagespec-editor/core.js#L588-L605)). Its input handling is mouse-specific, and no undo/redo, snapping, or alignment-guide implementation was found. Growspace can borrow interaction ideas, but output fidelity still has to reconcile to the backend PNG.

## Observable failure modes

| Failure | Where it is observable | Classification |
| --- | --- | --- |
| Missing required element keys, malformed values, unavailable image URL/data, unknown barcode format, unresolved font with no fallback | Render call fails; Niimbot wraps it as Home Assistant `ServiceValidationError` before BLE | Documented/code-derived |
| Unsupported label type or out-of-range model density | Rejected locally before or during the print path and surfaced as Home Assistant error | Documented/code-derived |
| Printer absent from the Bluetooth network | Home Assistant error before printing | Code-derived |
| Out-of-canvas content | Silently clipped in the rendered PNG; no validation error | Documented |
| Element overlap | Later element paints over earlier; no validation error | Documented |
| Too-wide raster for the printhead | Not rejected by the inspected transfer code | Physical verification required; must be blocked by Growspace |
| Blind-zone / feed / stock mismatch | Preview looks valid but paper can clip or shift | Documented limitation plus physical verification |
| BLE congestion or dropped rows | Missing bands can occur; integration exposes pacing/batch controls | Documented protocol behavior ([throughput](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/printing.md#L221-L237)) |
| Wrong generation sequence / stale progress | Blank feed, repeated labels, aborted page, or timeout can occur even without an immediate protocol error | Documented reverse-engineered behavior ([sequences](https://github.com/eigger/hass-niimbot/blob/f2bed90599dfe4459a80079fd3430d93d26caf40/docs/printing.md#L113-L190)) |
| Render succeeds but QR/text is physically unreadable | No renderer or service error | Physical verification required |

The editor should therefore distinguish **render errors**, **layout-policy errors** (outside canvas, incompatible profile, unsafe QR/text size), **warnings** (overlap, likely clipping, aggressive auto-fit), **transport/printer errors**, and **post-print quality uncertainty**. A generic “printer offline” message cannot accurately cover this envelope.

## Constraints carried into later Wayfinder decisions

1. **Canonical millimetres need a selected capability profile to render.** The profile must contain at least model/DPI, `printheadPixels`, stock dimensions and orientation, allowed density range, paper type, and calibrated safe-area offsets. “203 dpi” is not a global property.
2. **Backend raster is the preview oracle.** The preview API should return the exact PNG plus resolved pixel geometry and structured diagnostics. The card may draw editor chrome and handles over it, but must not redraw printable content with browser layout rules.
3. **Instant feedback needs a render protocol, not a second renderer.** Debounced/cancellable preview requests and optimistic transform overlays can keep interaction immediate; the settled state must reconcile to the authoritative raster.
4. **Use a deliberately small compiler subset.** For the agreed first release, map text to `text_fit` (or a precisely specified `new_multiline` policy), logo to normalized `dlimg`, QR to fixed-box `qrcode`, divider to rectangle/line, and 90-degree element rotation through one tested group convention. Do not expose all 29 `imagespec` elements as the product model.
5. **Validation must be stricter than `imagespec`.** Block incompatible printer/stock geometry, off-canvas elements, unresolved fonts, and QR/text below calibrated minima. Report overlap, clipping, and auto-fit outcomes before print.
6. **Density is profile-relative and physically verified.** Store a semantic choice or normalized fraction, resolve it to the selected model's allowed integer range, and never mutate the authoritative raster merely to simulate heat.
7. **Preview fidelity has two acceptance levels.** Raster fidelity can be automated byte-for-byte against the backend render. Paper fidelity needs golden test labels per supported printer class/stock/orientation, scanned/measured for bounds, QR readability, small text, rotation, density, and repeatability.
8. **Compatibility must be versioned.** Template/render results depend on the Niimbot integration version, `imagespec` version, font asset versions, printer capability profile, and compiler version. Persist enough identity to invalidate stale previews and migrate templates safely.

## Physical test matrix still required

At minimum, run physical acceptance on each printer class the product actually claims—not merely every name in upstream's broad table:

- 203-dpi 50-mm class (B1 or B21), and any 300-dpi 50-mm class explicitly supported.
- 203-dpi 15-mm class (D11/D110) **only if** the product will retain that support; current Growspace label presets are incompatible and need a separate narrow-stock template/profile.
- Every shipped stock size and orientation, including edge-aligned registration marks to measure all four safe-area offsets.
- Light/default/dark semantic density at the resolved valid model values.
- Short, typical, and worst-case text in every allowed font; auto-fit at its minimum.
- Short and longest supported QR targets at every allowed QR size, scanned by representative phones.
- Logo inputs covering high contrast, grayscale, transparency, remote URL, and data URL.
- Repeated prints and batch prints to expose drift, blank first pages, dropped bands, stale status, and feed errors.

Until those results exist, the product can guarantee that the preview matches the bitmap sent to the driver; it cannot honestly guarantee pixel-for-dot placement on paper.

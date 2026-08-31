# Visual encoder and CPU inference runtime for `growspace_manager_vision`

Research resolution for [issue #61](https://github.com/Venosta-web/growspace_manager_workspace/issues/61),
under the constraints settled on map [#60](https://github.com/Venosta-web/growspace_manager_workspace/issues/60).

Date: 2026-08-31. Every number below is either quoted from a linked primary source or
measured on this host with the method in [Appendix A](#appendix-a--measurement-method).
Where a number could not be sourced or measured, it says so instead of estimating.

---

## Recommendation

**Encoder: DINOv2 ViT-S/14, int8 QDQ ONNX** — `onnx-community/dinov2-small`,
`onnx/model_int8.onnx`, 24.4 MB on disk, 384-d CLS embedding, Apache-2.0.

**Runtime: ONNX Runtime `CPUExecutionProvider`, one code path, both architectures.**
Official manylinux wheels exist for `x86_64` (23.1 MB) and `aarch64` (20.8 MB), MIT licence.

**Base image: an HA `base-debian` (glibc) image, not the default Alpine one.**
None of the three candidate runtimes publishes a musllinux wheel, so the default
Alpine base cannot run any of them from a wheel. HA documents `base-debian` for
exactly this: *"We prefer the Alpine based version because it's more IoT friendly.
In some case, you need a glibc system like this."*
([home-assistant/docker-base README](https://github.com/home-assistant/docker-base/blob/master/README.md))

**Runner-up: CLIP ViT-B/32 vision tower, int8 ONNX** — `Xenova/clip-vit-base-patch32`,
`onnx/vision_model_int8.onnx`, 88.6 MB, 512-d, MIT.

**OpenVINO: no.** It does not earn a second runtime path. Reasoning in
[§ OpenVINO verdict](#openvino-verdict).

### What separates the recommendation from the runner-up

CLIP ViT-B/32 is genuinely the *faster* candidate — 28.1 ms vs 69.5 ms per image at int8
on the mini-PC-class proxy, because patch-32 gives it 49 tokens against DINOv2's 256.
At 3 images/day/camera, that 41 ms is worth nothing. Four things separate them, all of
which matter more than latency at this workload:

1. **The selection criterion is embedding-distance quality, and the published evidence
   favours self-supervised features on fine-grained natural-species discrimination.**
   The DINOv2 paper reports DINOv2 beating OpenCLIP ViT-G/14 by **+8.6 / +9.7 points**
   on iNaturalist 2018 / 2021 — the closest published proxy for "tell one plant's
   appearance from another's" ([arXiv:2304.07193](https://arxiv.org/abs/2304.07193)).
   That is a species task, not a canopy-drift task, but it is evidence in the right
   direction, and no evidence points the other way.
2. **CLIP's objective is text alignment, i.e. semantic category.** Two snapshots of the
   same canopy on different days are the same *category* to CLIP by construction. The
   V1 design needs distance to track appearance drift *within* a category. DINOv2 is
   trained on image-to-image discrimination, which is the operation being performed.
3. **DINOv2 keeps its embedding geometry under int8 far better.** Measured on the two
   e2e canopy fixtures: DINOv2-S retains 95% of its within-image-vs-across-image
   separation margin after quantisation, CLIP retains 85%
   ([§ int8 fidelity](#int8-fidelity--does-quantisation-survive-the-distance-metric)).
4. **DINOv2-S is 4× smaller** — 22.1M vs 87.9M parameters, 24.4 MB vs 88.6 MB int8,
   120 MB vs 201 MB peak RSS. The App image and the aarch64 memory budget both care.

CLIP ViT-B/32 stays a credible runner-up precisely because it is fast, MIT-licensed,
has a first-class ONNX artifact, and its embedding space is the best-understood in the
field. If DINOv2 distances turn out to be dominated by lighting or camera pose in the
corpus validation, CLIP is the swap, and the swap is a file path plus an output-tensor
change, not a redesign.

---

## Measured results

All latency and RSS numbers in this section are measured here, not sourced.

Host: Intel Core i5-13600K, Linux 7.0.0-30-generic, Python 3.12,
`onnxruntime` 1.29.0, `openvino` 2026.3.1.

**amd64 mini-PC proxy.** Every run is pinned with `taskset -c 12-15` to **4 Gracemont
E-cores** with `intra_op_num_threads=4`. Gracemont is the same microarchitecture as the
Intel N100/N150 that HAOS mini-PCs actually ship, so this is a same-µarch proxy running
~15% faster on clock (E-core turbo 3.9 GHz vs N100's 3.4 GHz). It is a proxy, and it is
labelled as one — it is not an N100 measurement.

**aarch64 Pi-class: not measured and not sourced.** No aarch64 hardware was available,
and no published primary-source benchmark was found for any of these model/runtime
combinations on a Cortex-A76 or comparable part. Rather than estimate, this is left
open — see [§ Open](#open--must-be-measured-before-the-aarch64-resource-budget-is-set).

### Encoder candidates

Parameter counts are counted from the ONNX initializers of the exact downloaded
artifact; sizes are the exact byte size of that file.

| Artifact | Params | Size | Embedding | ORT median | Peak RSS | Licence |
|---|---|---|---|---|---|---|
| **dinov2-small int8** | 22.1M | **24.4 MB** | **384** (CLS) | **69.5 ms** | **120.2 MB** | Apache-2.0 |
| dinov2-small fp32 | 22.1M | 88.5 MB | 384 | 99.1 ms | 206.5 MB | Apache-2.0 |
| clip-vit-b32 vision int8 | 87.9M | 88.6 MB | 512 | 28.1 ms | 200.6 MB | MIT |
| clip-vit-b32 vision fp32 | 87.9M | 351.7 MB | 512 | 57.4 ms | 572.6 MB | MIT |
| siglip-base-p16 vision int8 | 92.9M | 94.1 MB | 768 | 108.6 ms | 235.8 MB | Apache-2.0 |
| siglip-base-p16 vision fp32 | 92.9M | 371.8 MB | 768 | 208.7 ms | 594.3 MB | Apache-2.0 |
| dinov2-with-registers-**base** fp32 | 86.6M | 346.6 MB | 768 | 310.4 ms | 635.6 MB | Apache-2.0 |
| mobilenetv3-large-100 fp32 | 5.5M | 21.9 MB | 1000 (logits) | 4.3 ms | 126.2 MB | Apache-2.0 |
| mobilenetv3-large-100 int8 | 5.5M | 5.7 MB | 1000 (logits) | 38.2 ms | 90.9 MB | Apache-2.0 |
| efficientnet-b0 fp32 | 5.3M | 21.1 MB | 1000 (logits) | 7.9 ms | 121.4 MB | Apache-2.0 |

Peak RSS is whole-process `ru_maxrss`, which includes the interpreter and the runtime.
Measured floors on the same host: bare Python + numpy **28.5 MB**, plus `onnxruntime`
**46.8 MB**, plus `openvino` **52.5 MB**. Subtract ~47 MB to get the model's own cost.

For reference, DINOv2-S on 6 P-cores of the same chip: fp32 **33.0 ms**, int8 **23.6 ms**.
The recommended configuration has roughly 3× headroom on a desktop-class host and
still lands inside the "fractions of a second" budget on the mini-PC proxy.

### Artifact provenance and licences

| Encoder | Artifact exists today? | Licence source |
|---|---|---|
| DINOv2 ViT-S/14 | **Yes** — fp32, fp16, int8, uint8, q4, bnb4 ONNX at [`onnx-community/dinov2-small`](https://huggingface.co/onnx-community/dinov2-small). Downloaded and run. | Apache-2.0 — [`facebookresearch/dinov2/LICENSE`](https://github.com/facebookresearch/dinov2/blob/main/LICENSE), and `license: apache-2.0` on [`facebook/dinov2-small`](https://huggingface.co/facebook/dinov2-small) |
| CLIP ViT-B/32 | **Yes** — separated `vision_model.onnx` + int8 at [`Xenova/clip-vit-base-patch32`](https://huggingface.co/Xenova/clip-vit-base-patch32). Downloaded and run. | MIT — [`openai/CLIP/LICENSE`](https://github.com/openai/CLIP/blob/main/LICENSE) |
| SigLIP base/16-224 | **Yes** — [`Xenova/siglip-base-patch16-224`](https://huggingface.co/Xenova/siglip-base-patch16-224). Note `onnx-community/siglip-base-patch16-224` and `onnx-community/siglip2-base-patch16-224` list **no** ONNX files. | Apache-2.0 — [`google/siglip-base-patch16-224`](https://huggingface.co/google/siglip-base-patch16-224) |
| MobileNetV3-Large | **Yes** — [`onnx-community/mobilenetv3_large_100.ra_in1k`](https://huggingface.co/onnx-community/mobilenetv3_large_100.ra_in1k). **Emits 1000-way logits, not an embedding.** | Apache-2.0 — [`timm/mobilenetv3_large_100.ra_in1k`](https://huggingface.co/timm/mobilenetv3_large_100.ra_in1k) |
| EfficientNet-B0 | **Yes** — [`onnxmodelzoo/efficientnet_b0_Opset17`](https://huggingface.co/onnxmodelzoo/efficientnet_b0_Opset17). **Emits 1000-way logits, not an embedding.** | Apache-2.0 |
| DINOv3 | Weights yes; **licence is the problem** | Custom [DINOv3 License](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md), not Apache-2.0 |
| PlantCLEF 2024 ViT-B/14+reg | **No ONNX today** — safetensors only | Conflicting: **CC-BY-NC-4.0** on the [HF mirror](https://huggingface.co/vincent-espitalier/dino-v2-reg4-with-plantclef2024-weights), **CC-BY-4.0** on the [Zenodo record](https://zenodo.org/records/10848263) |

Parameter counts corroborated where a second source exists: `facebook/dinov2-small`
safetensors metadata reports 22,056,576 parameters; `google/siglip-base-patch16-224`
reports 203,155,970 for the full two-tower model, of which the measured vision tower is
92.9M. timm model cards give MobileNetV3-Large-100 at **5.5M params / 0.2 GMACs** and
EfficientNet-B0 at **5.3M params / 0.4 GMACs**, both at 224×224.

### int8 fidelity — does quantisation survive the distance metric?

The whole V1 design rests on embedding distance, so a quantised artifact that saves disk
while flattening distances is worthless. Measured on the two canopy fixtures already in
this repo (`ha-dev/www/e2e-camera-assets/e2e_vision_{1,2}.jpg`), cosine on L2-normalised
embeddings, comparing a same-image perturbation (+0.15 brightness) against a
different-image pair:

| Encoder | fp32↔int8 agreement | separation margin, fp32 | separation margin, int8 | retained |
|---|---|---|---|---|
| **DINOv2-S** | **0.988** | 0.147 | **0.140** | **95%** |
| CLIP ViT-B/32 | 0.981 | 0.121 | 0.102 | 85% |
| SigLIP base/16 | 0.942 | 0.062 | **−0.041** | **collapsed** |

SigLIP's published int8 artifact **inverts** the ordering — a brightness-shifted view of
the same canopy scores *less* similar than a different canopy. Its fp32 pooler output is
also the weakest of the three on brightness invariance (0.934 vs DINOv2's 1.000).

This is a two-image smoke test on synthetic fixtures, not a quality benchmark. It is
strong enough to **reject** SigLIP's int8 artifact and to confirm DINOv2-S int8 is safe
to build on; it is not strong enough to rank DINOv2 above CLIP on its own. That ranking
rests on the published fine-grained evidence, and it is what the masked 30-day corpus
validation on map #60 exists to confirm.

---

## OpenVINO verdict

**No. It does not earn a second runtime code path.** Four independent reasons, in
descending order of how decisive they are.

### 1. It loses outright to the recommended configuration

Same host, same 4 Gracemont cores, same 4 threads:

| DINOv2-S configuration | median latency | peak RSS |
|---|---|---|
| **ORT, int8 QDQ ONNX** | **69.5 ms** | **120.2 MB** |
| OpenVINO, fp32 IR via `ovc` | 83.0 ms | 256.3 MB |
| OpenVINO, fp32 ONNX direct | 77.1 ms | 337.5 MB |
| ORT, fp32 ONNX | 99.1 ms | 206.5 MB |
| OpenVINO, int8 QDQ ONNX | 95.0 ms | 459.8 MB |

OpenVINO's fp32 advantage over ORT's fp32 is real but modest — 77–83 ms vs 99 ms,
16–22%. It is entirely erased by simply using the int8 artifact under ORT, which is free
and already exists. The best OpenVINO configuration is **11–16% slower** than the
recommendation while using **2–4× the memory**.

The int8 rows are the fairest available comparison of two published artifacts, not of
each runtime's best possible int8 path — OpenVINO's intended int8 route is NNCF
quantisation to IR with a calibration set, which is precisely the build complexity this
question is asking about. Even granting OpenVINO its best measured configuration (fp32
IR, 83.0 ms), it still loses.

Across all ten artifacts benchmarked, OpenVINO was slower than ORT on **7 of 10** and
used more peak RSS on **10 of 10**. Its three wins were DINOv2-S fp32, DINOv2-B fp32,
and MobileNetV3 int8 — none of them the recommended configuration.

### 2. There is no aarch64 int8 path at all

OpenVINO's own documentation lists `uINT8`/`INT8` as **Intel x86-64 only**, and states:

> *"Arm® platforms execute quantized models in simulation mode: the whole model,
> including quantization operations, is executed in floating-point precision."*

— [`cpu-device.rst`](https://github.com/openvinotoolkit/openvino/blob/master/docs/articles_en/openvino-workflow/running-inference/inference-devices-and-modes/cpu-device.rst)

So on the architecture where the CPU budget is *tightest*, OpenVINO cannot use the very
artifact the recommendation depends on, and quietly runs it as fp32 instead. ONNX
Runtime does have a real ARM int8 path — its quantization guide states that
"Arm®-based processors with dot-product instructions can get better performance in
general", and that the AVX2/AVX512 saturation issue does not apply on ARM
([ORT quantization docs](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)).
This does need verifying on the target part: Cortex-A72 (Pi 4) predates the dot-product
extension; Cortex-A76 (Pi 5) has it.

### 3. It costs real image size for nothing

| Wheel (linux, cp312) | x86_64 | aarch64 |
|---|---|---|
| `onnxruntime` 1.29.0 | 23.1 MB | 20.8 MB |
| `openvino` 2026.3.1 | 57.5 MB | 28.8 MB |
| `onnxruntime-openvino` 1.24.1 | **84.4 MB** | **does not exist** |

(sizes read from the PyPI JSON API for each project)

An Intel-only fast path via the ORT OpenVINO Execution Provider means shipping the
`onnxruntime-openvino` wheel, +61.3 MB over plain `onnxruntime`, on the amd64 image only
— so the two architectures no longer ship the same dependency set. It also pins ORT to
1.24.1 while plain `onnxruntime` is at 1.29.0. And `onnxruntime-openvino` publishes
**no aarch64 wheel at all**, so the second path is structurally amd64-only.

### 4. The workload does not want a speedup

3 captures/day/camera. Even a hypothetical 2× win saves ~70 ms three times a day. The
budget on map #60 is "fractions of a second to a few seconds" and the recommendation
already sits at 70 ms on the proxy. There is no latency problem to solve, and a second
runtime path is a permanent tax on every build, test matrix and bug report.

**Revisit only if** the design moves to per-sector embedding (16 crops per capture
instead of 1) *and* a measured aarch64 number turns out to be intolerable. Even then,
the first move is a smaller input resolution or fp16, not a second runtime.

---

## Rejected candidates, with the reason

- **SigLIP / SigLIP2** — slowest ViT measured (108.6 ms int8, 208.7 ms fp32), largest of
  the candidates, and its only published int8 ONNX artifact destroys the distance
  ordering the design depends on. `onnx-community` has no ONNX artifact for either
  SigLIP or SigLIP2 base at all. No compensating quality evidence for this task.
- **DINOv3** — Meta released it under a bespoke [DINOv3 License](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)
  rather than the Apache-2.0 that DINOv2 carries. It is a redistribution-with-agreement
  licence requiring the agreement to travel with the weights, which map #60's
  "weights bundled into the App image" constraint makes a distribution question, not a
  usage question. Rejected on licence risk for a HACS-distributed add-on, not on quality.
  DINOv2's Apache-2.0 has no such question.
- **PlantCLEF-derived encoders** — three separate blockers. (a) Licence is *contradictory*
  between the Zenodo record (CC-BY-4.0) and the HF mirror (CC-BY-NC-4.0); a
  non-commercial restriction is unresolvable for a publicly distributed add-on and the
  ambiguity alone disqualifies it. (b) No ONNX/TFLite/OpenVINO artifact exists — only
  safetensors, so shipping it means owning an export step *and* a PyTorch build
  dependency. (c) Architecture cost: it is ViT-B/14 with registers, measured here at
  **310.4 ms** fp32 — 4.5× the recommendation. And (d) it is a 7,806-species classifier
  for south-western European flora, fine-tuned *away* from general appearance features
  toward taxonomic identity — the opposite of what canopy-drift distance wants.
- **MobileNetV3-Large / EfficientNet-B0** — fastest by a wide margin (4.3 / 7.9 ms) and
  they would be the right answer if latency were the binding constraint. It is not;
  embedding quality is. Three concrete problems: (a) the published ONNX artifacts emit
  **1000-way ImageNet logits**, not embeddings, so using them as encoders requires a
  re-export with the classifier head removed — the 1280-d penultimate feature is not in
  the artifact that exists today; (b) ImageNet-supervised CNN features are
  category-discriminative, and DINOv2's paper is a direct argument that SSL features
  transfer better to fine-grained frozen-feature tasks; (c) MobileNetV3's published int8
  artifact is **9× slower than its fp32** under ORT (38.2 vs 4.3 ms) — QDQ quantisation
  of depthwise convolutions is pathological here, so the int8 size win is unusable.
  Worth keeping as a documented fallback if the aarch64 measurement rules out a ViT.
- **LiteRT/TFLite as the runtime** — not rejected on merit, rejected on path. Wheels
  exist for both architectures (`ai-edge-litert` 2.2.0: 21.3 MB x86_64, 14.1 MB aarch64,
  Apache-2.0) and it is the smallest runtime of the three. But **no TFLite artifact
  exists today** for any candidate encoder; producing one means `ai-edge-torch`, a
  PyTorch build dependency, and owning the conversion. That is real work bought for a
  ~7 MB image saving over ONNX Runtime, against ONNX Runtime's ready-made, verified,
  already-quantised artifacts. Revisit only if the image size ever becomes binding.

---

## Consequences for the V1 spec

1. **The App base image must be `base-debian`, not the default Alpine base.** No
   musllinux wheel exists for `onnxruntime`, `openvino`, or `ai-edge-litert` — every
   published Linux wheel is manylinux/glibc. `onnxruntime` needs glibc ≥ 2.28
   (`manylinux_2_28`); HA's `base-debian` is trixie, which is comfortably past that.
   ([docker-base Dockerfile](https://github.com/home-assistant/docker-base/blob/master/debian/Dockerfile),
   [docker-base README](https://github.com/home-assistant/docker-base/blob/master/README.md))
2. **Embedding contract: 384 floats.** The DINOv2 ONNX export exposes
   `last_hidden_state` shaped `[batch, floor(h/14)*floor(w/14)+1, 384]`; the embedding is
   token 0 (CLS). There is no `pooler_output` in this artifact — the service must slice
   token 0 itself. Fixing 384 in the API schema now is safe; CLIP-B/32 (512) and
   MobileNet (1280) would all differ, so the schema should carry the dimension
   explicitly alongside the model version rather than hard-coding it in the card.
3. **Input is dynamic, which is free optionality.** The exported graph accepts
   `[batch, 3, h, w]` with any multiple of 14, so the same artifact serves whole-image
   224px today and per-sector crops or a higher-resolution pass later with no re-export.
4. **The no-outbound-network invariant is satisfiable and cheap.** The recommended
   artifact is a single 24.4 MB file with no tokenizer, no text tower, no config
   download, and no runtime asset fetch. `onnxruntime` itself makes no network calls.
   The CI test asserting zero egress has nothing to fight.
5. **Total added image weight for the recommendation: ~48 MB** (23.1 MB wheel +
   24.4 MB model), plus numpy and the HTTP framework.
6. **Resource budget input for map #60's open item:** ~120 MB peak RSS for a single
   inference including the Python interpreter and ORT, of which ~47 MB is the floor.
   The aarch64 figure is still unmeasured.

## Open — must be measured before the aarch64 resource budget is set

- **aarch64 wall-clock latency for `dinov2s_int8.onnx` under ORT.** Not measured (no
  hardware) and not sourced (no published primary-source benchmark found for this
  model/runtime pair on Cortex-A76 or comparable). This is the one number the map's
  "Resource budget on aarch64" item still needs, and it is a 20-minute measurement on
  any Pi 5.
- **Whether the target aarch64 parts have the ARM dot-product extension.** ORT's int8
  advantage depends on it; Cortex-A72 (Pi 4) does not have it, Cortex-A76 (Pi 5) does.
  If Pi 4 is in scope, the fp32 artifact may be the better aarch64 default, and the
  service may need to pick its artifact per architecture.
- **Whether DINOv2 distances are dominated by lighting or camera pose** on the real
  masked corpus. This is the corpus-validation work already on map #60; it is the thing
  that would trigger the swap to the runner-up.

---

## Appendix A — measurement method

Reproducible, and deliberately boring. A throwaway venv (Python 3.12) with
`onnxruntime==1.29.0`, `openvino==2026.3.1`, `numpy`, `onnx`, `pillow`. Artifacts pulled
straight from the Hugging Face resolve endpoints listed above.

Per measurement: one model in one fresh subprocess, `[1,3,224,224]` float32 input,
5 warmup runs, then 25 timed runs, reporting the median. Peak RSS is
`resource.getrusage(RUSAGE_SELF).ru_maxrss` at process exit, so it includes the
interpreter and the runtime — the measured floors are given above so the model's own
cost can be recovered.

```python
# bench_one.py <model> <ort|ov> <threads>
if runtime == "ort":
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
elif runtime == "ov":
    core = ov.Core()
    core.set_property("CPU", {"INFERENCE_NUM_THREADS": threads})
    m = core.read_model(model)
    m.reshape({m.inputs[0].get_any_name(): [1, 3, 224, 224]})
    req = core.compile_model(m, "CPU").create_infer_request()
```

Invoked as `taskset -c 12-15 python bench_one.py <model> <runtime> 4` — CPUs 12-15 on an
i5-13600K are 4 of its 8 Gracemont E-cores. The OpenVINO IR variant was produced with
`ovc <model>.onnx --input "pixel_values[1,3,224,224]"`.

Parameter counts are the sum over `onnx.load(f).graph.initializer` dimension products,
so they describe the exact artifact benchmarked rather than an upstream checkpoint.

Caveats worth stating: the E-core pinning is a same-microarchitecture proxy for an
N100-class mini-PC, not a measurement of one, and it runs ~15% above N100 clock. Other
processes were running on the host's P-cores during measurement, but not on the pinned
E-cores. The int8 fidelity test uses two synthetic e2e fixtures and one perturbation
family; it is a smoke test.

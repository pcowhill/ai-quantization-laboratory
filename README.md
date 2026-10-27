# AI Quantization Laboratory

An interactive, offline-capable educational workbench. It shows how numbers are represented in computers, how quantization reduces numerical precision, and how the resulting errors affect matrix arithmetic and the predictions of small neural networks.

**Live application:** https://pcowhill.github.io/ai-quantization-laboratory/

Everything runs in your browser. There is no server-side component, no account and no analytics, and nothing you enter or import is uploaded. In browsers with service workers, the application also works offline once the first visit has finished storing its files; **Help → Offline use** shows when that is complete.

## What you can do

| Laboratory | Question | Highlights |
|---|---|---|
| **Number Inspector** | *How is this number represented?* | Exact decimal, fraction and hex-float input. Editable sign, exponent and mantissa bits. Exact stored value with absolute, relative and ULP error. Neighbours and spacing, special values (±0, subnormals, ±∞, NaN), all IEEE rounding modes plus seeded stochastic rounding, and saturating or non-saturating overflow. Side-by-side comparison of FP64, FP32, FP16, BF16, FP8 E4M3/E5M2, FP4 E2M1, INT8 and INT4. |
| **Quantization Workbench** | *What happens when I quantize it?* | Symmetric and asymmetric quantization; per-tensor, per-channel and per-group scales; min/max, percentile, MSE-search and MX-style power-of-two calibration; scale storage formats. Up to 8 variants compared on curated, generated, manual or imported (CSV/JSON) data. Error metrics, storage estimates, linked charts with table views, outlier analysis and an element inspector. |
| **Matrix Laboratory** | *How does that error affect matrix multiplication?* | Separate precision for storage, products, accumulation and output. Sequential, pairwise, blocked or Kahan summation. INT8×INT8 with an INT32 accumulator. A storage-versus-arithmetic error split, and step-by-step dot-product traces (such as FP16 accumulator stagnation). |
| **Neural Network Laboratory** | *How does it affect a network's predictions?* | Small trained MLPs (moons, circles, spiral, 8×8 digits) and hand-built networks. Per-layer weight, activation and arithmetic quantization, with dynamic or static calibration. Accuracy, agreement and prediction flips; decision-region maps; a neuron inspector; and per-layer error propagation. |

There are also eleven **guided lessons** that set up the real laboratories, and **experiments** you can save, snapshot, branch, compare, export and import (see [docs/EXPERIMENT_FORMAT.md](docs/EXPERIMENT_FORMAT.md)).

### How faithful is it?

- Number formats are simulated **exactly** on top of binary64: conversions, rounding modes and overflow rules follow the cited specifications (IEEE 754-2019, OCP OFP8 and MX v1.0). They are verified against independent references (ml_dtypes, NumPy, C `fesetround`, exact rationals); see [docs/NUMERICS.md](docs/NUMERICS.md).
- Arithmetic is simulated with explicit "round after every operation" rules. It is **not** a model of any particular GPU instruction or kernel. Accumulation order and internal precision of real hardware vary.
- The **MXFP4** and **MXFP8** presets implement the OCP MX v1.0 schemes as specified: blocks of 32, an E8M0 shared scale chosen by the §6.3 power-of-two rule, and saturating element conversion with RNE (verified by tests). They simulate the format's quantization numerically. They are not a model of any hardware's MX instructions. The **MXINT8-equivalent** preset folds MX INT8's implicit 2⁻⁶ into the scale, which is numerically equivalent. **NVFP4** (with its two-level scaling) is not implemented.
- Storage figures are estimates of the bits needed for elements and scales. They are **not** predictions of memory bandwidth, speed or energy.

## Getting started

Requires Node.js ≥ 20.19 (CI uses Node 22).

```bash
npm ci
npm run dev        # http://localhost:5173/ai-quantization-laboratory/
```

| Command | Purpose |
|---|---|
| `npm run build` | Typecheck and build static files into `dist/` |
| `npm run preview` | Serve the production build (including the service worker) |
| `npm run typecheck` | `vue-tsc` across the app, tests and configuration |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run test:unit` | Unit tests and numerical verification (`tests/unit`, `tests/numerics`) |
| `npm run test:component` | Vue component tests in jsdom (`tests/component`) |
| `npm run test:e2e` | Playwright tests against the production build (run `npm run build` first) |
| `npm run fixtures` | Regenerate the reference fixtures (needs Python with NumPy and ml_dtypes, and gcc) |

To serve the build under another path, set `BASE_PATH`, for example `BASE_PATH=/ npm run build`.

## Tests

| Suite | What it covers |
|---|---|
| **Numerical verification** (`tests/numerics`) | All decodings of the 4- and 8-bit formats, and of every FP16 and BF16 pattern; round-to-nearest-even and directed-rounding conversions; arithmetic; the PRNG; quantization; dot products. All are checked against fixtures from independent implementations ([tests/fixtures/README.md](tests/fixtures/README.md)). Also property-based tests (fast-check) for rounding, monotonicity, round-trips and metric identities, and network forward passes checked against a NumPy reference. |
| **Unit** (`tests/unit`) | State schema and validation (including NaN/∞/−0 round-trips), stores, chart-data fidelity, lesson solvability, and the numerical claims made in scenario and lesson text. |
| **Component** (`tests/component`) | Laboratories and panels mounted in jsdom: input handling, validation messages, experiment management, and undo/redo. |
| **End-to-end** (`e2e`) | User journeys at desktop, tablet and phone sizes. Includes an offline test (reload without a network and use every laboratory) and WCAG 2.1 A/AA audits with axe in light and dark themes, covering every laboratory, panel and tab. |

## Deployment

- Every push to `main` runs `.github/workflows/deploy.yml`, which checks, builds and publishes `dist/` to GitHub Pages using the official Pages actions.
- The repository's Pages source must be set to **GitHub Actions**.
- Pull requests run `.github/workflows/ci.yml` (quality checks plus end-to-end tests).

## Offline use and updates

A generated service worker (`build/serviceWorker.ts`) precaches every application file. Offline readiness is reported in **Help → Offline use** only after the worker confirms that every file is in its cache. When a new version is deployed, the application offers *Reload now*, saving the current experiment first. Experiments live in IndexedDB. In browsers or private windows without IndexedDB, they are kept in memory only, and the Experiments panel says so.

## Project structure

```
src/engine/      numerical engine (framework-free, fully tested)
src/labs/        pure state → results functions for each laboratory
src/state/       experiment schema, validation, persistence
src/stores/      Pinia stores (lab state, experiments, lessons, UI)
src/workers/     Web Worker compute tasks
src/components/  Vue components (laboratories, panels, shared controls)
src/ui/          chart builders, theme, formatting
src/lessons/     guided lessons
src/data/        curated datasets, network presets, scenarios
build/           Vite plugin that generates the service worker
scripts/         offline training of network presets and reference-fixture generation
docs/            architecture, numerical conventions, experiment file format
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how these pieces fit together.

## Limitations and future work

- **Formats.** Only the formats listed above are simulated. OCP MX element types other than FP4 E2M1, FP8 and INT8 (such as FP6) are not included. NVFP4's two-level scaling (an FP8 E4M3 block scale plus a per-tensor FP32 scale) is not implemented.
- **Arithmetic.** Arithmetic is simulated per operation. There are no fused multi-term instructions, no hardware accumulator widths beyond the chosen format, and no tensor-core internal ordering.
- **Networks.** Networks are small, fully connected and inference-only. Presets were trained offline with `scripts/train_network_presets.py`, and the application does not train. Activations are quantized at layer inputs; there is no quantization-aware training, no GPTQ/AWQ-style weight optimisation, and no KV-cache or attention models.
- **Data size.** Large tensors (up to 2²⁰ values) are supported, but very large inputs make the charts and the exact-trace views slower; heatmaps and scatter plots are down-sampled with a notice.
- **Future work.** FP6 and NVFP4 two-level scaling, GPTQ-style rounding, convolution layers, shareable experiment links, and per-element provenance in exports.

## Licence

`package.json` declares the MIT licence. Add a `LICENSE` file before redistributing.

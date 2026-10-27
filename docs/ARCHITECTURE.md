# Architecture

The AI Quantization Laboratory is a static single-page application with no backend. Every computation runs in the browser. Experiments are stored in the browser's IndexedDB, and a service worker makes the application available offline.

```
            ┌──────────────────────── UI (Vue 3 components) ────────────────────────┐
            │ AppHeader · Number Inspector · Quantization Workbench · Matrix Lab ·   │
            │ Neural Network Lab · Experiments panel · Lessons · Help                │
            └───────────────┬───────────────────────────────┬────────────────────────┘
                            │ reads/writes                  │ derived results
            ┌───────────────▼──────────────┐   ┌────────────▼─────────────────────────┐
            │ Pinia stores                 │   │ Lab modules (src/labs) — pure         │
            │ lab · experiments · lessons  │   │ functions: state → results            │
            │ · ui                         │   │ (inspect, evaluateVariants, …)        │
            └──────┬───────────────┬───────┘   └────────────┬─────────────────────────┘
                   │ JSON state    │                        │ heavy work
            ┌──────▼──────┐ ┌──────▼──────────┐   ┌─────────▼──────────────────────────┐
            │ validate.ts │ │ persistence.ts  │   │ Web Worker (src/workers) with an    │
            │ (schema)    │ │ IndexedDB       │   │ inline fallback; stale-result tokens│
            └─────────────┘ └─────────────────┘   └─────────┬──────────────────────────┘
                                                            │
                         ┌──────────────────────────────────▼───────────────────────────┐
                         │ Numerical engine (src/engine) — framework-free TypeScript    │
                         │ float · int · formats · rounding · quant · calibration ·     │
                         │ metrics · arith · nn · random · detmath · viz                │
                         └──────────────────────────────────────────────────────────────┘
```

## Layers

### Numerical engine (`src/engine`)
Plain TypeScript with no dependency on Vue or the DOM. It is unit-tested on its own.

| Module | Responsibility |
|---|---|
| `float/` | Bit access to binary64, an exact rounding kernel for any (exponent, mantissa) format, exact BigInt rational parsing (decimal, hex float, fractions), codecs (encode, decode, neighbours, enumeration) and exact decimal display. |
| `formats/` | Format registry: FP64, FP32, FP16, BF16, FP8 E4M3/E5M2 (plus FNUZ comparison variants), FP4 E2M1, INT8/INT4/UINT8, with their characteristics and specification references. |
| `int/` | Integer codecs. |
| `rounding.ts` | The rounding-mode definitions shared by floats and integers. |
| `quant/` | `QuantConfig`, block layout (tensor, channel, group), calibration, scale storage, affine and floating-point quantization, MX-style power-of-two scales, and storage estimates. |
| `calibration/` | Outlier analysis. |
| `metrics/` | Error metrics, all computed without overflow or underflow through power-of-two scaling. |
| `arith/` | `ArithMachine`: products and accumulation in chosen formats and reduction orders, with exact fallbacks. Matrix operations, dot-product traces, and integer kernels with INT32 accumulation. |
| `nn/` | MLP forward pass with per-layer weight, activation and arithmetic quantization, and dynamic or static activation calibration. |
| `random/`, `detmath/` | A seeded PRNG (xoshiro128\*\*), distributions, and deterministic elementary functions, so results are identical on every browser. |
| `viz/` | Histograms, CDFs and sampling for the charts. |

Numerical conventions, algorithms and verification are documented in [NUMERICS.md](NUMERICS.md).

### Laboratory modules (`src/labs`)
These are pure functions that turn one laboratory's state into everything that laboratory displays. Because they are pure, the same functions run on the main thread, in the worker, in tests and in the experiment comparison (`compare.ts`).

### State (`src/state`, `src/stores`)
- `schema.ts` defines `ExperimentState`, the complete, JSON-serialisable input of all four laboratories. Derived results are never stored.
- `validate.ts` is the runtime validator. It is used on import, on load and for undo history. It reports every error with its path, encodes NaN, ±∞ and −0 safely, and migrates older schema versions.
- `stores/lab.ts` holds the reactive current state.
- `stores/experiments.ts` manages experiments:
  - the experiment list, the current experiment, and debounced autosave to IndexedDB;
  - undo/redo history of serialised states;
  - snapshots, duplication and branching (the parent is recorded);
  - resets of one laboratory or all of them;
  - JSON import and export.
- `stores/lessons.ts` runs guided lessons. It suspends saving, replays each step's setup, and restores the user's state exactly on exit.

The file format is documented in [EXPERIMENT_FORMAT.md](EXPERIMENT_FORMAT.md).

### Compute (`src/workers`, `src/composables`)
Workbench evaluation, network evaluation and decision grids run in a module Web Worker (`compute.worker.ts`). If a worker cannot start, the same task code runs inline. The composables (`useWorkbench`, `useNetwork`) debounce requests and discard stale results using tokens. They publish data and results together, so the UI never mixes an old result with new data.

### UI (`src/components`, `src/ui`, `src/styles`)
- Vue 3 single-file components with `<script setup>`. Laboratories, panels and the chart library are loaded lazily.
- Chart builders (`src/ui/charts`) return `{ option, columns, rows }`. ECharts renders the option, and every chart offers the same rows as an accessible table. Chart-fidelity tests check the rows against the engine.
- Design tokens are in `styles/tokens.css`: light-first, with a separately tuned dark theme and a categorical palette validated for colour-vision deficiency.

### Offline support (`build/serviceWorker.ts`, `src/pwa`)
A small Vite plugin writes `sw.js` at build time. Its precache list contains every emitted file (except source maps) and every file in `public/`, and its version is a content hash of the whole build. Cache names include the scope, so deployments at different paths of one origin never interfere. The worker behaves as follows:
- On **install** it caches every file.
- On **activate** it keeps the most recent previous version's cache, so pages still running that version can finish loading their files, and deletes anything older.
- **Fetching** serves precached files by URL, cache-first. Navigations inside the app get the cached app shell.
- **Version changes:** every open tab that was running the previous version reloads as soon as the new worker takes control, after saving its current experiment.

Paths are relative to the worker scope, so the same build works under any base path. When a new deployment is detected, the page shows *Reload now / Later*. The current experiment is also saved whenever the page is hidden or closed.

The Help panel reports offline readiness only after the worker confirms that every precached file is actually in its cache. An end-to-end test checks offline behaviour by reloading without a network and using every laboratory.

## Build and deployment
- Vite builds static files into `dist/`, with `base` set to `/<repository>/` for GitHub Pages (override it with `BASE_PATH`). ECharts and Vue are split into long-lived vendor chunks.
- `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:
  - typecheck, lint, unit and numerical tests, component tests and the build;
  - Playwright end-to-end tests at desktop, tablet and phone sizes, including offline tests and accessibility (axe) audits.
- `.github/workflows/deploy.yml` deploys to GitHub Pages on pushes to `main`. It runs the checks, builds, adds a `404.html` fallback and publishes with the official Pages actions.

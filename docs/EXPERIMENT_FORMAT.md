# Experiment file format

Experiments are exported as UTF-8 JSON files (`*.aql.json`). One file holds one or more experiments, with all their snapshots. The same structure is stored locally in IndexedDB. The authoritative definitions are `src/state/schema.ts` (types) and `src/state/validate.ts` (runtime validator).

## Envelope

```json
{
  "format": "ai-quantization-laboratory/experiment",
  "schemaVersion": 1,
  "exportedAt": "2026-10-27T18:00:00.000Z",
  "experiments": [ /* Experiment, … */ ]
}
```

| Field | Meaning |
|---|---|
| `format` | Always `ai-quantization-laboratory/experiment`. Files with another value are rejected. |
| `schemaVersion` | Version of the state schema. Older versions are migrated on import (`migrate()` in `validate.ts`). Newer versions are rejected with a request to update the application. |
| `exportedAt` | ISO-8601 timestamp. Informational only. |
| `experiments` | A non-empty array of experiments. |

## Experiment

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique within the browser. An imported experiment whose id already exists gets a new id and the suffix "(imported)". |
| `name` | string (≤ 200 chars) | |
| `createdAt`, `updatedAt` | ISO-8601 strings | |
| `parentId` | string or `null` | The experiment this one was duplicated or branched from. |
| `notes` | string (≤ 20 000 chars) | Free text. |
| `state` | ExperimentState | Everything needed to reproduce every result. |
| `snapshots` | Snapshot[] | Named, read-only copies of `state` (`{ id, name, createdAt, state }`). |

## ExperimentState

An `ExperimentState` holds every input of all four laboratories. It is plain JSON, with no derived results: results are always recomputed from the state.

| Key | Contents |
|---|---|
| `schemaVersion`, `lab` | The schema version, and the laboratory shown when the experiment is opened. |
| `inspector` | Input text (decimal, hex float, fraction, `inf`, `nan`), format, rounding mode, overflow mode, flush-to-zero, stochastic seed, an optional edited bit pattern, the comparison formats, the integer scale and the neighbour count. |
| `workbench` | Data source (seeded generator, catalog entry, manual values or imported values) and the quantization variants (each a full `QuantConfig`: format, scaling, scheme, granularity, axis, group size, calibration and its parameters, scale storage format, rounding, overflow, flush-to-zero, seed). Also the selected element and the outlier and histogram settings. |
| `matrix` | The operation, operands A and B (row-major values), the scalar, storage quantization for each operand, arithmetic settings (product, accumulator and output formats, reduction order, block size, rounding, seed), the integer-kernel path and the INT accumulator, the selected cell and the preset. |
| `network` | The network definition (layer sizes, activations, all weights and biases), evaluation samples and optional labels, quantization variants (per layer: weight, input-activation and arithmetic settings), activation calibration (dynamic or static), and the selection. |

### Special numeric values

JSON cannot represent NaN, infinities or negative zero. Wherever a number is expected, these strings are used instead:

| Value | Encoding |
|---|---|
| NaN | `"NaN"` |
| +∞ | `"Infinity"` |
| −∞ | `"-Infinity"` |
| −0 | `"-0"` |

All other numbers are ordinary JSON numbers. The application writes them with full binary64 round-trip precision.

## Validation and limits

Imports are validated completely before anything is stored. An invalid file is rejected as a whole, and every problem is listed with its JSON path. Checks include:

- **Types, enums and ranges:** for example, formats must be known identifiers and seeds must be 32-bit unsigned integers.
- **Shapes:** the number of values must equal rows × cols; network weights must match the layer sizes; each sample must have `inputSize` values.
- **Semantic rules:**
  - A quantization axis must be valid for its tensor.
  - Activation per-channel scaling must use axis 1.
  - Every variant id referenced as active must exist.
  - A label is required for each sample.
- **Size limits:**
  - 2²⁰ data values per workbench tensor.
  - 4096 rows or columns, and 65 536 values, per matrix operand.
  - 2000 network samples.
  - At most 8 layers with 64 units each, and at most 64 network inputs.
  - Input strings of at most 5000 characters.
  - The import file itself may be at most 64 MB.

## Privacy

Files are read locally with the File API, and experiments are stored only in this browser's IndexedDB. Nothing is uploaded. If IndexedDB is unavailable, for example in some private-browsing modes, the application keeps experiments in memory only and shows a warning.

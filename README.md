# AI Quantization Laboratory

An interactive, offline-capable educational workbench for exploring how numbers are represented in computers, how quantization reduces numerical precision, and how the resulting errors affect matrix arithmetic and miniature neural networks.

> Work in progress. See the tracking issue for milestone status.

## Development

```bash
npm ci
npm run dev          # local dev server
npm run typecheck
npm run lint
npm run test:unit    # unit + numerical verification tests
npm run test:component
npm run build && npm run test:e2e
```

Numerical conventions are documented in [docs/NUMERICS.md](docs/NUMERICS.md). Fixture provenance is in [tests/fixtures/README.md](tests/fixtures/README.md).

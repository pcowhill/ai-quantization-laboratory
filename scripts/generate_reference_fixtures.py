#!/usr/bin/env python3
"""Generate independent numerical reference fixtures for the test-suite.

Sources (none of them share code with the TypeScript engine):
  * ml_dtypes (Google/JAX) for OCP FP8 E4M3/E5M2, FP4 E2M1, FNUZ variants and
    bfloat16: exhaustive decode tables and round-to-nearest-even conversions.
  * NumPy float16/float32 for IEEE binary16/binary32 conversions and arithmetic.
  * The C compiler/hardware (scripts/reference/ref.c, built with gcc) for
    binary32/binary16 conversions and binary32 arithmetic under all four IEEE
    rounding directions (fesetround), and for the xoshiro128** reference stream.
  * Python's fractions.Fraction for exact dot products.
  * NumPy for affine integer quantization and percentiles.

Usage: python3 -I scripts/generate_reference_fixtures.py
Requires: numpy, ml_dtypes, gcc. Output: tests/fixtures/*.json
"""
from __future__ import annotations

import base64
import json
import math
import os
import platform
import struct
import subprocess
import sys
import tempfile
from fractions import Fraction

import ml_dtypes as md
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures")
REF_C = os.path.join(ROOT, "scripts", "reference", "ref.c")


def h64(x: float) -> str:
    return struct.pack(">d", float(x)).hex()


def provenance(extra: str) -> dict:
    return {
        "generator": "scripts/generate_reference_fixtures.py",
        "python": platform.python_version(),
        "numpy": np.__version__,
        "ml_dtypes": md.__version__,
        "notes": extra,
    }


def write(name: str, payload: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")


SMALL = {
    "fp8_e4m3": md.float8_e4m3fn,
    "fp8_e5m2": md.float8_e5m2,
    "fp4_e2m1": md.float4_e2m1fn,
    "fp8_e4m3fnuz": md.float8_e4m3fnuz,
    "fp8_e5m2fnuz": md.float8_e5m2fnuz,
}
BITS = {"fp8_e4m3": 8, "fp8_e5m2": 8, "fp4_e2m1": 4, "fp8_e4m3fnuz": 8, "fp8_e5m2fnuz": 8}


def decode_tables() -> None:
    tables = {}
    for fid, t in SMALL.items():
        n = 1 << BITS[fid]
        if BITS[fid] == 8:
            vals = np.arange(n, dtype=np.uint8).view(t).astype(np.float64)
        else:
            # float4 values occupy the low 4 bits of a uint8 container in ml_dtypes.
            vals = np.arange(n, dtype=np.uint8).view(t).astype(np.float64)
        tables[fid] = [h64(v) for v in vals]
    # 16-bit formats: float32 bit patterns of every encoding, base64 little-endian.
    f16 = np.arange(65536, dtype=np.uint16).view(np.float16).astype(np.float32)
    bf16 = np.arange(65536, dtype=np.uint16).view(md.bfloat16).astype(np.float32)
    write(
        "decode-tables.json",
        {
            "provenance": provenance(
                "Exhaustive decode of every bit pattern. 8/4-bit formats: float64 bit patterns (hex). "
                "fp16 (numpy.float16) and bf16 (ml_dtypes.bfloat16): float32 values, base64 little-endian."
            ),
            "small": tables,
            "fp16_f32_b64": base64.b64encode(f16.tobytes()).decode(),
            "bf16_f32_b64": base64.b64encode(bf16.tobytes()).decode(),
        },
    )


def representable(t) -> np.ndarray:
    """Sorted finite values of a small format (both zero signs collapsed)."""
    if t in (md.float4_e2m1fn,):
        vals = np.arange(16, dtype=np.uint8).view(t).astype(np.float64)
    else:
        vals = np.arange(256, dtype=np.uint8).view(t).astype(np.float64)
    vals = vals[np.isfinite(vals)]
    return np.unique(vals)


def conversion_inputs(rng: np.random.Generator, grid: np.ndarray | None) -> np.ndarray:
    """float32-representable test inputs: grid points, midpoints, near-midpoints, random."""
    xs = [0.0, -0.0, 1.0, -1.0, 0.1, 1 / 3, math.pi, 1e-45, 1e30, -1e30, 65504.0, 65520.0, 65519.99]
    if grid is not None:
        g = grid.astype(np.float64)
        mids = (g[1:] + g[:-1]) / 2
        for v in np.concatenate([g, mids, mids * 1.0000001, mids * 0.9999999, g * 1.01, g * 0.99]):
            xs.append(float(v))
        xs.extend([float(g.max()) * k for k in (1.0625, 1.125, 1.5, 2.0, 4.0, 100.0)])
        xs.extend([-x for x in xs])
    mag = 10 ** rng.uniform(-12, 8, 3000)
    sign = np.where(rng.random(3000) < 0.5, -1.0, 1.0)
    xs.extend((mag * sign).tolist())
    arr = np.array(xs, dtype=np.float64).astype(np.float32).astype(np.float64)
    arr = arr[np.isfinite(arr)]
    return arr


def rne_conversions(rng: np.random.Generator) -> None:
    cases = {}
    for fid, t in SMALL.items():
        xs = conversion_inputs(rng, representable(t))
        # ml_dtypes converts float32 inputs with correct RNE rounding.
        ys = xs.astype(np.float32).astype(t).astype(np.float64)
        cases[fid] = [[h64(x), h64(y)] for x, y in zip(xs, ys)]
    xs = conversion_inputs(rng, None)
    cases["bf16"] = [[h64(x), h64(y)] for x, y in zip(xs, xs.astype(np.float32).astype(md.bfloat16).astype(np.float64))]
    # numpy converts float64 -> float16 directly with RNE.
    xs64 = np.concatenate([xs, 10 ** rng.uniform(-9, 5, 2000) * np.where(rng.random(2000) < 0.5, -1, 1)])
    cases["fp16"] = [[h64(x), h64(y)] for x, y in zip(xs64, xs64.astype(np.float16).astype(np.float64))]
    cases["fp32"] = [[h64(x), h64(y)] for x, y in zip(xs64, xs64.astype(np.float32).astype(np.float64))]
    write(
        "rne-conversions.json",
        {
            "provenance": provenance(
                "Round-to-nearest-even conversions. FP8/FP4/FNUZ/bf16 via ml_dtypes from float32-representable inputs "
                "(ml_dtypes rounds float64 inputs through float32, so float64-only inputs are excluded). fp16/fp32 via "
                "NumPy direct float64 conversion. Overflow behaviour is ml_dtypes' non-saturating behaviour "
                "(E4M3/FNUZ -> NaN, E5M2 -> Inf) except FP4 E2M1 which saturates."
            ),
            "cases": cases,
        },
    )


def run_ref(lines: list[str]) -> list[str]:
    exe = os.path.join(tempfile.mkdtemp(), "ref")
    subprocess.run(["gcc", "-O0", "-frounding-math", "-o", exe, REF_C, "-lm"], check=True)
    out = subprocess.run([exe], input="\n".join(lines) + "\n", capture_output=True, text=True, check=True)
    return out.stdout.strip().split("\n")


def directed(rng: np.random.Generator) -> None:
    xs = list(conversion_inputs(rng, None)) + (10 ** rng.uniform(-40, 38, 1500) * np.where(rng.random(1500) < 0.5, -1, 1)).tolist()
    # Add genuinely float64-only values (not float32-representable): the C path converts exactly.
    xs += (rng.standard_normal(1000) * 10 ** rng.uniform(-8, 6, 1000)).tolist()
    xs += [6.5504e4 + 16, 6.5504e4 + 15.999, 3.4028235677973366e38 * 1.0000001, -3.5e38, 1e-8, 5.960464477539063e-8 / 2]
    conv_out = run_ref([f"conv {h64(x)}" for x in xs])
    conv = []
    for x, line in zip(xs, conv_out):
        parts = [p.split(":") for p in line.split()]
        conv.append([h64(x), [p[0] for p in parts], [p[1] for p in parts]])
    pairs = []
    a = (rng.standard_normal(1500) * 10 ** rng.uniform(-6, 6, 1500)).astype(np.float32).astype(np.float64)
    b = (rng.standard_normal(1500) * 10 ** rng.uniform(-6, 6, 1500)).astype(np.float32).astype(np.float64)
    for x, y in zip(a, b):
        pairs.append((x, y))
    # Cancellation-heavy additions.
    for x in a[:300]:
        pairs.append((x, -x * (1 + 2.0 ** -20)))
    add_out = run_ref([f"add32 {h64(x)} {h64(y)}" for x, y in pairs])
    mul_out = run_ref([f"mul32 {h64(x)} {h64(y)}" for x, y in pairs])
    write(
        "directed-rounding.json",
        {
            "provenance": provenance(
                "C (gcc, x86-64 SSE + libgcc soft-fp for _Float16) conversions float64->float32 and float64->_Float16 "
                "under fesetround(FE_TONEAREST, FE_TOWARDZERO, FE_UPWARD, FE_DOWNWARD), and float32 add/mul under "
                "each mode. Mode order: [nearest-even, toward-zero, toward-positive, toward-negative]. "
                "Results are raw binary32 / binary16 bit patterns (hex)."
            ),
            "modes": ["nearest-even", "toward-zero", "toward-positive", "toward-negative"],
            "conversions": conv,
            "add32": [[h64(x), h64(y), line.split()] for (x, y), line in zip(pairs, add_out)],
            "mul32": [[h64(x), h64(y), line.split()] for (x, y), line in zip(pairs, mul_out)],
        },
    )


def prng() -> None:
    seeds = [0, 1, 42, 123456789, 4294967295]
    out = run_ref([f"rng {s} 16" for s in seeds])
    write(
        "prng.json",
        {
            "provenance": provenance("xoshiro128** 1.1 reference C implementation (Blackman & Vigna) seeded by SplitMix32."),
            "streams": {str(s): [int(v) for v in line.split()] for s, line in zip(seeds, out)},
        },
    )


def int_quant(rng: np.random.Generator) -> None:
    """Affine integer quantization implemented independently with NumPy (np.rint = ties-to-even)."""
    cases = []
    for (bits, narrow, scheme, gran) in [
        (8, False, "symmetric", "tensor"),
        (8, True, "symmetric", "channel"),
        (8, False, "asymmetric", "tensor"),
        (4, False, "asymmetric", "channel"),
        (4, True, "symmetric", "tensor"),
        (4, False, "symmetric", "group"),
    ]:
        rows, cols = 6, 16
        x = rng.standard_normal((rows, cols)) * rng.uniform(0.1, 3)
        x[1, 3] = 9.5  # outlier
        qmax = 2 ** (bits - 1) - 1
        qmin = -qmax if narrow else -(2 ** (bits - 1))
        if gran == "tensor":
            blocks = [np.ones((rows, cols), bool)]
        elif gran == "channel":
            blocks = []
            for r in range(rows):
                m = np.zeros((rows, cols), bool)
                m[r] = True
                blocks.append(m)
        else:
            blocks = []
            for r in range(rows):
                for g0 in range(0, cols, 4):
                    m = np.zeros((rows, cols), bool)
                    m[r, g0:g0 + 4] = True
                    blocks.append(m)
        q = np.zeros_like(x)
        recon = np.zeros_like(x)
        scales = []
        zps = []
        for m in blocks:
            v = x[m]
            if scheme == "symmetric":
                s = np.float64(np.abs(v).max()) / qmax
                s = np.float64(np.float32(s))  # fp32 scale storage
                z = 0
            else:
                lo = min(v.min(), 0.0)
                hi = max(v.max(), 0.0)
                s = np.float64(np.float32((hi - lo) / (qmax - qmin)))
                z = int(np.clip(np.rint(qmin - lo / s), qmin, qmax))
            qq = np.clip(np.rint(v / s) + z, qmin, qmax)
            q[m] = qq
            recon[m] = s * (qq - z)
            scales.append(float(s))
            zps.append(z)
        cases.append(
            {
                "bits": bits,
                "narrow": narrow,
                "scheme": scheme,
                "granularity": gran,
                "groupSize": 4,
                "shape": [rows, cols],
                "x": [h64(v) for v in x.ravel()],
                "q": q.ravel().astype(int).tolist(),
                "recon": [h64(v) for v in recon.ravel()],
                "scales": [h64(s) for s in scales],
                "zeroPoints": zps,
            }
        )
    pct = []
    for n in (1, 2, 7, 100, 1001):
        v = rng.standard_normal(n)
        ps = [0, 1, 25, 50, 90, 99, 99.9, 100]
        pct.append({"x": [h64(a) for a in v], "p": ps, "expected": [h64(np.percentile(v, p)) for p in ps]})
    write(
        "integer-quantization.json",
        {
            "provenance": provenance(
                "Independent NumPy implementation of q = clip(rint(x/s) + z, qmin, qmax), x_hat = s(q - z), with min/max "
                "calibration, FP32-rounded scales, zero-point = clip(rint(qmin - lo/s)); asymmetric ranges include 0. "
                "Percentiles: numpy.percentile (linear interpolation)."
            ),
            "cases": cases,
            "percentiles": pct,
        },
    )


def dots(rng: np.random.Generator) -> None:
    cases = []
    for n in (1, 3, 16, 100, 257):
        a = (rng.standard_normal(n) * 10 ** rng.uniform(-2, 2, n)).astype(np.float16)
        b = (rng.standard_normal(n) * 10 ** rng.uniform(-2, 2, n)).astype(np.float16)
        exact = sum((Fraction(float(x)) * Fraction(float(y)) for x, y in zip(a, b)), Fraction(0))
        # Sequential float32 accumulation of exact (fp16*fp16 fits in fp32) products.
        acc32 = np.float32(0)
        for x, y in zip(a.astype(np.float32), b.astype(np.float32)):
            acc32 = np.float32(acc32 + np.float32(x * y))
        # Sequential float16 accumulation with float16-rounded products.
        acc16 = np.float16(0)
        for x, y in zip(a, b):
            acc16 = np.float16(acc16 + np.float16(x * y))
        cases.append(
            {
                "a": [h64(float(x)) for x in a],
                "b": [h64(float(y)) for y in b],
                "exact": h64(float(exact)),
                "seqFp32": h64(float(acc32)),
                "seqFp16": h64(float(acc16)),
            }
        )
    write(
        "dot-products.json",
        {
            "provenance": provenance(
                "Exact dot products via fractions.Fraction (rounded once to float64 by Fraction.__float__, which is "
                "correctly rounded). Sequential accumulations with NumPy float32 / float16 scalars (NumPy float16 "
                "arithmetic computes in float32 and rounds, which is innocuous double rounding for + and x)."
            ),
            "cases": cases,
        },
    )


def main() -> int:
    rng = np.random.default_rng(20261027)
    decode_tables()
    rne_conversions(rng)
    directed(rng)
    prng()
    int_quant(rng)
    dots(rng)
    return 0


if __name__ == "__main__":
    sys.exit(main())

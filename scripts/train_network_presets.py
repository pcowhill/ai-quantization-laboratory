#!/usr/bin/env python3
"""Train the curated miniature networks shipped with the Neural Network Lab.

Training is done offline here (NumPy only, full-batch Adam, fixed seeds); the
application itself never trains. Weights are stored rounded to float32
precision. Datasets:
  * two moons / concentric circles: scikit-learn generators (BSD-3-Clause)
  * 3-class spiral: generated here
  * 8x8 handwritten digits: UCI Optical Recognition of Handwritten Digits
    (E. Alpaydin, C. Kaynak, 1998), CC BY 4.0, as bundled with scikit-learn.

Usage: python3 -I scripts/train_network_presets.py   (needs numpy, scikit-learn)
Output: src/data/networks/trained.json
"""
from __future__ import annotations

import json
import os

import numpy as np
import sklearn
from sklearn.datasets import load_digits, make_circles, make_moons

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "data", "networks", "trained.json")


def act(name, z):
    if name == "relu":
        return np.maximum(z, 0)
    if name == "tanh":
        return np.tanh(z)
    raise ValueError(name)


def dact(name, z, a):
    if name == "relu":
        return (z > 0).astype(z.dtype)
    if name == "tanh":
        return 1 - a * a
    raise ValueError(name)


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def train(x, y, sizes, acts, seed, epochs=3000, lr=0.01, l2=1e-4):
    rng = np.random.default_rng(seed)
    ws, bs = [], []
    fan = x.shape[1]
    for s, a in zip(sizes, acts + ["identity"]):
        gain = np.sqrt(2) if a == "relu" else 1.0
        ws.append(rng.standard_normal((s, fan)) * gain / np.sqrt(fan))
        bs.append(np.zeros(s))
        fan = s
    params = ws + bs
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    n_classes = sizes[-1]
    onehot = np.eye(n_classes)[y]
    for t in range(1, epochs + 1):
        # forward
        zs, as_ = [], [x]
        h = x
        for i, (w, b) in enumerate(zip(ws, bs)):
            z = h @ w.T + b
            zs.append(z)
            h = act(acts[i], z) if i < len(acts) else z
            as_.append(h)
        p = softmax(h)
        # backward
        grads_w = [None] * len(ws)
        grads_b = [None] * len(bs)
        d = (p - onehot) / x.shape[0]
        for i in reversed(range(len(ws))):
            grads_w[i] = d.T @ as_[i] + l2 * ws[i]
            grads_b[i] = d.sum(axis=0)
            if i > 0:
                d = (d @ ws[i]) * dact(acts[i - 1], zs[i - 1], as_[i])
        grads = grads_w + grads_b
        for k, (pk, g) in enumerate(zip(params, grads)):
            m[k] = 0.9 * m[k] + 0.1 * g
            v[k] = 0.999 * v[k] + 0.001 * g * g
            mh = m[k] / (1 - 0.9**t)
            vh = v[k] / (1 - 0.999**t)
            pk -= lr * mh / (np.sqrt(vh) + 1e-8)
    return ws, bs


def predict(x, ws, bs, acts):
    h = x
    for i, (w, b) in enumerate(zip(ws, bs)):
        z = h @ w.T + b
        h = act(acts[i], z) if i < len(acts) else z
    return h.argmax(axis=1)


def f32(a):
    return [float(v) for v in np.asarray(a, dtype=np.float32).astype(np.float64).ravel()]


def export(pid, name, description, x_train, y_train, x_eval, y_eval, sizes, acts, seed, input_names, output_names, **kw):
    ws, bs = train(x_train, y_train, sizes, acts, seed, **kw)
    # Round parameters to float32 precision so the stored values are exact.
    ws = [np.asarray(w, dtype=np.float32).astype(np.float64) for w in ws]
    bs = [np.asarray(b, dtype=np.float32).astype(np.float64) for b in bs]
    acc_train = float((predict(x_train, ws, bs, acts) == y_train).mean())
    acc_eval = float((predict(x_eval, ws, bs, acts) == y_eval).mean())
    layers = []
    for i, (w, b) in enumerate(zip(ws, bs)):
        layers.append({"units": int(w.shape[0]), "activation": acts[i] if i < len(acts) else "identity", "weights": f32(w), "bias": f32(b)})
    print(f"{pid}: train acc {acc_train:.3f}, eval acc {acc_eval:.3f}")
    return {
        "id": pid,
        "name": name,
        "description": description,
        "network": {"inputSize": int(x_train.shape[1]), "layers": layers, "output": "softmax", "inputNames": input_names, "outputNames": output_names},
        "samples": [f32(r) for r in x_eval],
        "labels": [int(v) for v in y_eval],
        "training": {"seed": seed, "trainAccuracy": acc_train, "evalAccuracy": acc_eval, "trainSize": int(x_train.shape[0])},
    }


def spiral(n_per, classes, seed):
    rng = np.random.default_rng(seed)
    xs, ys = [], []
    for c in range(classes):
        r = np.linspace(0.1, 1.0, n_per)
        t = np.linspace(c * 4.0, (c + 1) * 4.0, n_per) + rng.standard_normal(n_per) * 0.2
        xs.append(np.c_[r * np.sin(t), r * np.cos(t)])
        ys.append(np.full(n_per, c))
    return np.vstack(xs), np.concatenate(ys)


def main():
    presets = []
    xm, ym = make_moons(n_samples=600, noise=0.15, random_state=1)
    xm_e, ym_e = make_moons(n_samples=200, noise=0.15, random_state=2)
    presets.append(export("moons", "Two moons (ReLU 2-16-16-2)", "Binary classifier for the two-moons dataset.", xm, ym, xm_e, ym_e, [16, 16, 2], ["relu", "relu"], 11, ["x₁", "x₂"], ["class 0", "class 1"]))
    xc, yc = make_circles(n_samples=600, noise=0.08, factor=0.5, random_state=3)
    xc_e, yc_e = make_circles(n_samples=200, noise=0.08, factor=0.5, random_state=4)
    presets.append(export("circles", "Concentric circles (tanh 2-8-2)", "A narrow tanh network separating an inner disc from an outer ring.", xc, yc, xc_e, yc_e, [8, 2], ["tanh"], 12, ["x₁", "x₂"], ["outer", "inner"]))
    xs, ys = spiral(200, 3, 5)
    xs_e, ys_e = spiral(70, 3, 6)
    presets.append(export("spiral", "Three-arm spiral (ReLU 2-32-32-3)", "A tightly fitted 3-class spiral: decision boundaries depend on precise weights.", xs, ys, xs_e, ys_e, [32, 32, 3], ["relu", "relu"], 13, ["x₁", "x₂"], ["arm A", "arm B", "arm C"], epochs=6000, lr=0.01))
    d = load_digits()
    x = d.data / 16.0
    y = d.target
    rng = np.random.default_rng(7)
    idx = rng.permutation(len(y))
    tr, ev = idx[:1500], idx[1500:1700]
    presets.append(export("digits", "8×8 handwritten digits (ReLU 64-32-10)", "Classifies 8×8 grey-scale digit images (UCI digits, CC BY 4.0). Inputs are pixel intensities scaled to [0, 1].", x[tr], y[tr], x[ev], y[ev], [32, 10], ["relu"], 14, [f"px{r}{c}" for r in range(8) for c in range(8)], [str(k) for k in range(10)], epochs=800, lr=0.005))
    payload = {
        "provenance": {
            "generator": "scripts/train_network_presets.py",
            "numpy": np.__version__,
            "scikit-learn": sklearn.__version__,
            "notes": "Full-batch Adam with softmax cross-entropy and L2 1e-4; parameters rounded to float32 precision after training. Digits data: UCI Optical Recognition of Handwritten Digits (Alpaydin & Kaynak, 1998), CC BY 4.0.",
        },
        "presets": presets,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()

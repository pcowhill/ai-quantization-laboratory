/**
 * Display formatting. Displayed numbers are rounded for readability; exact
 * values are always available via the inspectors (exact decimal / bits).
 */

/** Compact numeric display with `digits` significant digits; keeps −0, NaN, ±∞ visible. */
export function fmt(v: number | null | undefined, digits = 6): string {
  if (v === null || v === undefined) return '—';
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return '+∞';
  if (v === -Infinity) return '−∞';
  if (v === 0) return Object.is(v, -0) ? '−0' : '0';
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e6 || a < 1e-4) s = v.toExponential(Math.max(0, digits - 1));
  else s = v.toPrecision(digits);
  // Trim trailing zeros in the mantissa
  if (s.includes('e')) {
    const [m, e] = s.split('e') as [string, string];
    const mm = m.includes('.') ? m.replace(/\.?0+$/, '') : m;
    s = `${mm}e${e.replace('+', '')}`;
  } else if (s.includes('.')) {
    s = s.replace(/\.?0+$/, '');
  }
  return s.replace(/^-/, '−');
}

/** Full-precision shortest round-trip (JS) representation of a double. */
export function full(v: number): string {
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function db(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === Infinity) return '∞ dB (exact)';
  if (v === -Infinity) return '−∞ dB';
  return `${v.toFixed(2)} dB`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

export function groupBits(bits: string, size = 4): string {
  const out: string[] = [];
  for (let i = bits.length; i > 0; i -= size) out.unshift(bits.slice(Math.max(0, i - size), i));
  return out.join(' ');
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

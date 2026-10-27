import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bitsToDouble, doubleToBits } from '@/engine/float/double';

export function loadFixture<T = unknown>(name: string): T {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function hexToDouble(h: string): number {
  return bitsToDouble(BigInt('0x' + h));
}

export function f32BitsToDouble(h: string): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, parseInt(h, 16));
  return dv.getFloat32(0);
}

export function f16BitsToDouble(h: string): number {
  const b = parseInt(h, 16);
  const sign = b >> 15 ? -1 : 1;
  const e = (b >> 10) & 0x1f;
  const f = b & 0x3ff;
  if (e === 31) return f ? NaN : sign * Infinity;
  if (e === 0) return sign * f * 2 ** -24;
  return sign * (1024 + f) * 2 ** (e - 25);
}

/** Bit-exact equality treating all NaNs as equal and distinguishing ±0. */
export function sameValue(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Object.is(a, b);
}

export function show(x: number): string {
  return `${Object.is(x, -0) ? '-0' : String(x)} [0x${doubleToBits(x).toString(16).padStart(16, '0')}]`;
}

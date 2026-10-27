import { describe, expect, it } from 'vitest';
import { empiricalCdf, finiteRange, histogram, sampleIndices, valueCounts } from '@/engine/viz/histogram';

describe('visualization data preparation', () => {
  it('histogram bins are half-open with the max in the last bin', () => {
    const h = histogram([0, 0.5, 1, 1.5, 2, NaN, 3], 0, 2, 4);
    expect(h.counts).toEqual([1, 1, 1, 2]);
    expect(h.excluded).toBe(2);
    expect(h.counts.reduce((a, b) => a + b, 0) + h.excluded).toBe(7);
  });
  it('degenerate range', () => {
    expect(histogram([5, 5, 5], 5, 5, 3).counts).toEqual([3, 0, 0]);
  });
  it('finite range and value counts merge ±0', () => {
    expect(finiteRange([1, NaN, -2], [Infinity, 7])).toEqual([-2, 7]);
    expect(finiteRange([NaN])).toBeNull();
    expect(valueCounts([0, -0, 1, 1, -3])).toEqual([{ value: -3, count: 1 }, { value: 0, count: 2 }, { value: 1, count: 2 }]);
  });
  it('CDF is monotone and ends at 1', () => {
    const c = empiricalCdf([3, 1, 2, 2, NaN], 10);
    expect(c.at(-1)).toEqual([3, 1]);
    for (let i = 1; i < c.length; i++) expect(c[i]![1]).toBeGreaterThanOrEqual(c[i - 1]![1]);
  });
  it('sampling keeps required indices', () => {
    const s = sampleIndices(1000, 10, [999, 3]);
    expect(s.stride).toBe(100);
    expect(s.indices).toContain(999);
    expect(s.indices).toContain(3);
    expect(s.indices.length).toBe(12);
  });
});

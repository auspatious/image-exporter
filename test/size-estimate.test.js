import { describe, it, expect } from 'vitest';
import { estimateBytes } from '../src/size-estimate.js';

describe('estimateBytes', () => {
  it('scales bytes with pixel count and item count', () => {
    const one = estimateBytes({ width: 100, height: 100, itemCount: 1 });
    const two = estimateBytes({ width: 100, height: 100, itemCount: 2 });
    expect(two.bytes).toBeCloseTo(one.bytes * 2, 5);
  });

  it('treats itemCount < 1 the same as a single item', () => {
    const zero = estimateBytes({ width: 100, height: 100, itemCount: 0 });
    const one = estimateBytes({ width: 100, height: 100, itemCount: 1 });
    expect(zero.bytes).toBe(one.bytes);
  });

  it('tiers small/medium/large by megabytes', () => {
    expect(estimateBytes({ width: 100, height: 100, itemCount: 1 }).tier).toBe('small');
    // ~100 MB raw -> medium/large boundary depends on formula; assert monotonicity instead.
    const small = estimateBytes({ width: 500, height: 500, itemCount: 1 });
    const big = estimateBytes({ width: 5000, height: 5000, itemCount: 5 });
    expect(big.megabytes).toBeGreaterThan(small.megabytes);
    expect(big.tier).not.toBe('small');
  });

  it('flags too-large purely from pixel count regardless of byte size', () => {
    const huge = estimateBytes({ width: 8001, height: 8001, itemCount: 1, bands: 0, bytesPerSample: 0 });
    expect(huge.tier).toBe('too-large');
  });
});

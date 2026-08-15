import { describe, it, expect } from 'vitest';
import { COLORMAPS, colormapLUT } from '../src/colormap.js';

describe('COLORMAPS', () => {
  it('lists 8 distinct colormaps with grayscale first', () => {
    expect(COLORMAPS).toHaveLength(8);
    expect(COLORMAPS[0].id).toBe('gray');
    expect(new Set(COLORMAPS.map((c) => c.id)).size).toBe(8);
  });
});

describe('colormapLUT', () => {
  it('returns null for grayscale and unknown ids (no colormap = plain stretch)', () => {
    expect(colormapLUT('gray')).toBeNull();
    expect(colormapLUT(undefined)).toBeNull();
    expect(colormapLUT('not-a-real-colormap')).toBeNull();
  });

  it('builds a 256-entry RGB lookup table anchored at its first/last stops', () => {
    const lut = colormapLUT('greens');
    expect(lut).toHaveLength(256 * 3);
    // First stop of ColorBrewer "Greens": #f7fcf5
    expect(lut[0]).toBe(0xf7);
    expect(lut[1]).toBe(0xfc);
    expect(lut[2]).toBe(0xf5);
    // Last stop: #00441b
    expect(lut[255 * 3]).toBe(0x00);
    expect(lut[255 * 3 + 1]).toBe(0x44);
    expect(lut[255 * 3 + 2]).toBe(0x1b);
  });

  it('caches the built LUT (same reference on repeat calls)', () => {
    expect(colormapLUT('viridis')).toBe(colormapLUT('viridis'));
  });

  it('every registered non-gray colormap builds without error', () => {
    for (const { id } of COLORMAPS) {
      if (id === 'gray') continue;
      expect(colormapLUT(id)).toHaveLength(256 * 3);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { boxMeters, nativePixelWidth, outputSize, sliderRange } from '../src/overviews.js';

// ~0.01 deg is about 1.1 km at the equator.
const SMALL_BOX = [0, 0, 0.01, 0.01];

describe('boxMeters', () => {
  it('returns roughly equal width/height for a near-square equatorial box', () => {
    const { widthMeters, heightMeters } = boxMeters(SMALL_BOX);
    expect(widthMeters).toBeGreaterThan(1000);
    expect(widthMeters).toBeLessThan(1200);
    expect(heightMeters).toBeCloseTo(widthMeters, -1);
  });
});

describe('nativePixelWidth', () => {
  it('returns 0 for a null bbox', () => {
    expect(nativePixelWidth(null, 10)).toBe(0);
  });

  it('divides ground width by GSD', () => {
    const { widthMeters } = boxMeters(SMALL_BOX);
    expect(nativePixelWidth(SMALL_BOX, 10)).toBe(Math.round(widthMeters / 10));
  });
});

describe('outputSize', () => {
  it('returns null for a null bbox', () => {
    expect(outputSize(null, 1000, 10)).toBeNull();
  });

  it('clamps requested width to the native pixel count', () => {
    const nativeWidth = nativePixelWidth(SMALL_BOX, 10);
    const size = outputSize(SMALL_BOX, nativeWidth * 10, 10);
    expect(size.width).toBe(nativeWidth);
  });

  it('preserves the box aspect ratio in the output height', () => {
    const wideBox = [0, 0, 0.02, 0.01]; // ~2:1 width:height
    const size = outputSize(wideBox, 200, 10);
    const { widthMeters, heightMeters } = boxMeters(wideBox);
    const expectedHeight = Math.round(size.width * (heightMeters / widthMeters));
    expect(size.height).toBe(expectedHeight);
    expect(size.width).toBeGreaterThan(size.height);
  });

  it('never returns less than 1 pixel in either dimension', () => {
    const size = outputSize(SMALL_BOX, 1, 10);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('sliderRange', () => {
  it('reproduces the reported bug case: max lands exactly on native resolution', () => {
    // 417px native max, 256 floor, 128 step — used to round max down to 384,
    // capping the slider a full step short of true 10 m/px.
    const { min, max, collapsed } = sliderRange(417, 256, 128);
    expect(max).toBe(417);
    expect((max - min) % 128).toBe(0);
    expect(collapsed).toBe(false);
  });

  it('not collapsed: (max - min) is an exact multiple of step, max is the true native width', () => {
    for (const nativeMax of [384, 417, 1000, 4999, 5000, 12345]) {
      const { min, max, collapsed } = sliderRange(nativeMax, 256, 128);
      expect(max).toBe(nativeMax);
      expect(collapsed).toBe(false);
      expect((max - min) % 128).toBe(0);
      expect(min).toBeGreaterThanOrEqual(256);
      expect(min).toBeLessThan(256 + 128); // shifted up, never down, by less than one step
    }
  });

  it('collapses (only one achievable size) whenever native max is at/below the floor, or clears it by less than one step', () => {
    // 145 and 256 are below/at the floor; 300 clears it by only 44px (< one 128 step).
    for (const nativeMax of [100, 145, 256, 300]) {
      const { min, max, collapsed } = sliderRange(nativeMax, 256, 128);
      expect(collapsed).toBe(true);
      expect(max).toBe(nativeMax); // max is always the true native width, never inflated to minWidth
      expect(min).toBe(max - 1); // one unit apart (not equal), so a slider thumb can render at 100%
    }
  });

  it('never lets min go below 1, even for a tiny native max', () => {
    const { min, max, collapsed } = sliderRange(1, 256, 128);
    expect(collapsed).toBe(true);
    expect(max).toBe(1);
    expect(min).toBeGreaterThanOrEqual(1);
  });
});

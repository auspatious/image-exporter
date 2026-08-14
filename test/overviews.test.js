import { describe, it, expect } from 'vitest';
import { boxMeters, nativePixelWidth, outputSize } from '../src/overviews.js';

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

import { describe, it, expect } from 'vitest';
import { utmProj, reprojectBbox, renderRGBA, cropToValid } from '../src/export.js';

describe('utmProj', () => {
  it('builds a north-zone proj4 string for EPSG:326xx', () => {
    expect(utmProj(32633)).toBe('+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');
  });

  it('builds a south-zone proj4 string for EPSG:327xx', () => {
    expect(utmProj(32756)).toBe('+proj=utm +zone=56 +south +datum=WGS84 +units=m +no_defs');
  });

  it('rejects non-UTM CRSs', () => {
    expect(() => utmProj(4326)).toThrow(/Unsupported CRS/);
  });
});

describe('reprojectBbox', () => {
  it('round-trips a small equatorial box through its UTM zone without distortion', () => {
    const bbox4326 = [10, 0.01, 10.01, 0.02]; // inside UTM zone 32N
    const [w, s, e, n] = reprojectBbox(bbox4326, 32632);
    expect(e).toBeGreaterThan(w);
    expect(n).toBeGreaterThan(s);
    // ~0.01 deg longitude at the equator is roughly 1.1 km.
    expect(e - w).toBeGreaterThan(900);
    expect(e - w).toBeLessThan(1300);
  });
});

describe('renderRGBA', () => {
  it('makes masked-out pixels fully transparent and masked-in pixels opaque', () => {
    const width = 2, height = 1;
    const arrays = {
      width, height,
      r: new Float32Array([3000, 0]),
      g: new Float32Array([3000, 0]),
      b: new Float32Array([3000, 0]),
      mask: new Uint8Array([1, 0]),
    };
    const img = renderRGBA(arrays, { vmin: 0, vmax: 3000, gamma: 1 });
    expect(img.data[3]).toBe(255); // pixel 0 alpha
    expect(img.data[0]).toBe(255); // pixel 0 red, stretched to max
    expect(img.data[7]).toBe(0);  // pixel 1 alpha (masked out)
  });

  it('clamps values below vmin to 0 and above vmax to 255', () => {
    const arrays = {
      width: 2, height: 1,
      r: new Float32Array([-100, 100000]),
      g: new Float32Array([0, 0]),
      b: new Float32Array([0, 0]),
      mask: new Uint8Array([1, 1]),
    };
    const img = renderRGBA(arrays, { vmin: 0, vmax: 3000, gamma: 1 });
    expect(img.data[0]).toBe(0);
    expect(img.data[4]).toBe(255);
  });
});

describe('cropToValid', () => {
  it('crops to the bounding box of masked-in pixels', () => {
    // 3x3 image, only the centre pixel (1,1) is valid.
    const width = 3, height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    const centre = (1 * width + 1) * 4;
    data[centre] = 200; data[centre + 3] = 255;
    const mask = new Uint8Array(width * height);
    mask[1 * width + 1] = 1;
    const img = { data, width, height };
    const cropped = cropToValid(img, mask);
    expect(cropped.width).toBe(1);
    expect(cropped.height).toBe(1);
    expect(cropped.data[0]).toBe(200);
  });

  it('returns the original image unchanged when nothing is masked in', () => {
    const width = 2, height = 2;
    const img = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height);
    expect(cropToValid(img, mask)).toBe(img);
  });

  it('returns the original image unchanged when everything is valid', () => {
    const width = 2, height = 2;
    const img = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);
    expect(cropToValid(img, mask)).toBe(img);
  });
});

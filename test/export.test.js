import { describe, it, expect } from 'vitest';
import { fromArrayBuffer } from 'geotiff';
import {
  utmProj, reprojectBbox, renderRGBA, cropToValid,
  cropBounds, bboxForCrop, normalizedDifference, mergeInto, toGeoTIFFBlob,
} from '../src/export.js';

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

  it('applies a colormap for single/index mode instead of the plain per-channel stretch', () => {
    const arrays = {
      width: 1, height: 1,
      r: new Float32Array([1]), g: new Float32Array([1]), b: new Float32Array([1]),
      mask: new Uint8Array([1]),
    };
    const viz = { vmin: 0, vmax: 1, gamma: 1, colormap: 'reds' };
    const img = renderRGBA(arrays, viz, 'index');
    // ColorBrewer "Reds" top stop is #67000d — nothing like plain white/gray.
    expect(img.data[0]).toBe(0x67);
    expect(img.data[1]).toBe(0x00);
    expect(img.data[2]).toBe(0x0d);
  });

  it('colormapReversed flips which end of the ramp a colormap uses', () => {
    const arrays = {
      width: 1, height: 1,
      r: new Float32Array([1]), g: new Float32Array([1]), b: new Float32Array([1]),
      mask: new Uint8Array([1]),
    };
    const viz = { vmin: 0, vmax: 1, gamma: 1, colormap: 'reds', colormapReversed: true };
    const img = renderRGBA(arrays, viz, 'index');
    // Reversed, so the max-stretched value gets "Reds"' *first* stop (#fff5f0), not its last.
    expect(img.data[0]).toBe(0xff);
    expect(img.data[1]).toBe(0xf5);
    expect(img.data[2]).toBe(0xf0);
  });

  it('colormapReversed also inverts plain grayscale (no LUT)', () => {
    const arrays = {
      width: 2, height: 1,
      r: new Float32Array([0, 3000]), g: new Float32Array([0, 3000]), b: new Float32Array([0, 3000]),
      mask: new Uint8Array([1, 1]),
    };
    const viz = { vmin: 0, vmax: 3000, gamma: 1, colormap: 'gray', colormapReversed: true };
    const img = renderRGBA(arrays, viz, 'single');
    expect(img.data[0]).toBe(255); // stretched-low value, reversed to bright
    expect(img.data[4]).toBe(0);   // stretched-high value, reversed to dark
  });

  it('ignores viz.colormap in rgb mode, even if one happens to be set', () => {
    const arrays = {
      width: 1, height: 1,
      r: new Float32Array([3000]), g: new Float32Array([0]), b: new Float32Array([1500]),
      mask: new Uint8Array([1]),
    };
    const viz = { vmin: 0, vmax: 3000, gamma: 1, colormap: 'reds' };
    const img = renderRGBA(arrays, viz, 'rgb');
    expect(img.data[0]).toBe(255); // r stretched on its own
    expect(img.data[1]).toBe(0);   // g stretched on its own
    expect(img.data[2]).toBe(128); // b stretched on its own (1500/3000 -> ~128)
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

describe('cropBounds', () => {
  it('finds the pixel bounding box of masked-in pixels', () => {
    const width = 4, height = 3;
    const mask = new Uint8Array(width * height);
    mask[1 * width + 1] = 1; // (x=1, y=1)
    mask[2 * width + 3] = 1; // (x=3, y=2)
    expect(cropBounds(mask, width, height)).toEqual({ x0: 1, y0: 1, x1: 3, y1: 2 });
  });

  it('returns null when nothing is valid', () => {
    expect(cropBounds(new Uint8Array(9), 3, 3)).toBeNull();
  });
});

describe('bboxForCrop', () => {
  it('maps a full-image crop back to the original bbox', () => {
    const bbox = [10, -10, 20, 0]; // [w, s, e, n]
    const bounds = { x0: 0, y0: 0, x1: 99, y1: 99 };
    const result = bboxForCrop(bbox, 100, 100, bounds);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(-10);
    expect(result[2]).toBeCloseTo(20);
    expect(result[3]).toBeCloseTo(0);
  });

  it('shrinks the bbox toward a sub-region of the image', () => {
    const bbox = [0, 0, 10, 10];
    // Crop to the top-left quadrant (rows 0-49 = north half, cols 0-49 = west half).
    const bounds = { x0: 0, y0: 0, x1: 49, y1: 49 };
    const [w, s, e, n] = bboxForCrop(bbox, 100, 100, bounds);
    expect(w).toBeCloseTo(0);
    expect(e).toBeCloseTo(5);
    expect(s).toBeCloseTo(5); // bottom of the north half is the vertical midpoint
    expect(n).toBeCloseTo(10);
  });
});

describe('normalizedDifference', () => {
  it('computes (a - b) / (a + b)', () => {
    const { value, valid } = normalizedDifference(
      new Float32Array([800, 100]),
      new Float32Array([200, 100]),
    );
    expect(value[0]).toBeCloseTo(0.6, 5); // (800-200)/(800+200)
    expect(value[1]).toBeCloseTo(0, 5);   // (100-100)/(100+100)
    expect(valid[0]).toBe(1);
    expect(valid[1]).toBe(1);
  });

  it('marks a pixel invalid (not silently 0) when either source band is nodata', () => {
    const { value, valid } = normalizedDifference(
      new Float32Array([0, 500]),
      new Float32Array([300, 0]),
    );
    expect(valid[0]).toBe(0);
    expect(valid[1]).toBe(0);
    expect(value[0]).toBe(0);
    expect(value[1]).toBe(0);
  });
});

describe('mergeInto', () => {
  function emptyArrays(width, height) {
    return {
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height),
      mask: new Uint8Array(width * height),
    };
  }

  it('places a part at its offset within the output canvas', () => {
    const arrays = emptyArrays(4, 4);
    const part = {
      r: new Float32Array([10]), g: new Float32Array([20]), b: new Float32Array([30]),
      width: 1, height: 1, offsetX: 2, offsetY: 1,
    };
    mergeInto(arrays, part, 4, 4);
    const idx = 1 * 4 + 2;
    expect(arrays.mask[idx]).toBe(1);
    expect(arrays.r[idx]).toBe(10);
    expect(arrays.g[idx]).toBe(20);
    expect(arrays.b[idx]).toBe(30);
    expect(arrays.mask[0]).toBe(0); // untouched elsewhere
  });

  it('prefers the brighter pixel on overlap', () => {
    const arrays = emptyArrays(1, 1);
    mergeInto(arrays, { r: [100], g: [0], b: [0], width: 1, height: 1, offsetX: 0, offsetY: 0 }, 1, 1);
    mergeInto(arrays, { r: [50], g: [0], b: [0], width: 1, height: 1, offsetX: 0, offsetY: 0 }, 1, 1);
    expect(arrays.r[0]).toBe(100); // dimmer second write loses
    mergeInto(arrays, { r: [200], g: [0], b: [0], width: 1, height: 1, offsetX: 0, offsetY: 0 }, 1, 1);
    expect(arrays.r[0]).toBe(200); // brighter write wins
  });

  it('skips all-zero pixels as nodata when no explicit valid array is given', () => {
    const arrays = emptyArrays(1, 1);
    mergeInto(arrays, { r: [0], g: [0], b: [0], width: 1, height: 1, offsetX: 0, offsetY: 0 }, 1, 1);
    expect(arrays.mask[0]).toBe(0);
  });

  it('honours an explicit valid array so a genuine index value of 0 is not treated as nodata', () => {
    const arrays = emptyArrays(1, 1);
    mergeInto(
      arrays,
      { r: [0], g: [0], b: [0], valid: new Uint8Array([1]), width: 1, height: 1, offsetX: 0, offsetY: 0 },
      1, 1,
    );
    expect(arrays.mask[0]).toBe(1);
  });

  it('clips parts that extend outside the output canvas', () => {
    const arrays = emptyArrays(2, 2);
    const part = {
      r: new Float32Array([1, 2, 3, 4]), g: new Float32Array(4), b: new Float32Array(4),
      width: 2, height: 2, offsetX: 1, offsetY: 1, // bottom-right 2x2 block, half off-canvas
    };
    expect(() => mergeInto(arrays, part, 2, 2)).not.toThrow();
    expect(arrays.mask[1 * 2 + 1]).toBe(1); // only the in-bounds corner is set
  });
});

describe('toGeoTIFFBlob', () => {
  it('writes raw (unstretched) uint16 values, cropped and georeferenced, for rgb mode', async () => {
    // 3x2 mosaic; only the right two columns are valid.
    const width = 3, height = 2;
    const mask = new Uint8Array([0, 1, 1, 0, 1, 1]);
    const arrays = {
      width, height, mask,
      r: new Float32Array([0, 1000, 2000, 0, 1000, 2000]),
      g: new Float32Array([0, 500, 600, 0, 500, 600]),
      b: new Float32Array([0, 50, 60, 0, 50, 60]),
    };
    const drawnBbox = [10, -10, 10.03, -9.98]; // [w, s, e, n]

    const { blob, width: cropW, height: cropH } = toGeoTIFFBlob(arrays, drawnBbox, 'rgb');
    expect(blob.type).toBe('image/tiff');
    expect(cropW).toBe(2); // cols 1-2 only
    expect(cropH).toBe(2);

    const tiff = await fromArrayBuffer(await blob.arrayBuffer());
    const image = await tiff.getImage(0);
    expect(image.getWidth()).toBe(2);
    expect(image.getHeight()).toBe(2);
    expect(image.getGDALNoData()).toBe(0); // rgb/single reuse raw DN's own 0-is-nodata convention
    expect(image.getSampleFormat()).toBe(1); // unsigned int, matching source Sentinel-2 COGs
    expect(image.getBitsPerSample()).toBe(16);

    const [w, , e] = image.getBoundingBox();
    expect(e - w).toBeCloseTo((10.03 - 10) * (2 / 3), 6); // 2/3 of the original width

    const raster = await image.readRasters();
    expect(raster.length).toBe(3); // R, G, B — raw values, not 0-255 stretched
    expect(raster[0][0]).toBe(1000);
    expect(raster[1][0]).toBe(500);
    expect(raster[2][0]).toBe(50);
  });

  it('rounds and clamps rgb/single values into uint16 range rather than truncating/wrapping', async () => {
    const arrays = {
      width: 2, height: 1,
      r: new Float32Array([1234.6, 70000]), // fractional, and over uint16 max
      g: new Float32Array([0, 0]), b: new Float32Array([0, 0]),
      mask: new Uint8Array([1, 1]),
    };
    const { blob } = toGeoTIFFBlob(arrays, [0, 0, 1, 1], 'single');
    const tiff = await fromArrayBuffer(await blob.arrayBuffer());
    const raster = await (await tiff.getImage(0)).readRasters();
    expect(raster[0][0]).toBe(1235); // rounded, not truncated
    expect(raster[0][1]).toBe(65535); // clamped, not wrapped
  });

  it('writes a single float32 band with real values for index mode', async () => {
    const width = 2, height = 1;
    const arrays = {
      width, height,
      r: new Float32Array([0.42, 0.42]), g: new Float32Array([0.42, 0.42]), b: new Float32Array([0.42, 0.42]),
      mask: new Uint8Array([1, 1]),
    };
    const { blob } = toGeoTIFFBlob(arrays, [0, 0, 1, 1], 'index');
    const tiff = await fromArrayBuffer(await blob.arrayBuffer());
    const image = await tiff.getImage(0);
    expect(image.getGDALNoData()).toBeNaN();
    const raster = await image.readRasters();
    expect(raster.length).toBe(1);
    expect(raster[0][0]).toBeCloseTo(0.42, 5);
  });

  it('writes NaN (not 0) for masked-out index pixels, since 0 is real index data', async () => {
    // L-shaped valid region so the bounding-box crop still contains one
    // masked-out pixel (top-right) inside it.
    const width = 2, height = 2;
    const arrays = {
      width, height,
      r: new Float32Array([10, 0, 30, 40]),
      g: new Float32Array(4), b: new Float32Array(4),
      mask: new Uint8Array([1, 0, 1, 1]),
    };
    const { blob } = toGeoTIFFBlob(arrays, [0, 0, 1, 1], 'index');
    const tiff = await fromArrayBuffer(await blob.arrayBuffer());
    const image = await tiff.getImage(0);
    const raster = await image.readRasters();
    expect(raster[0][0]).toBe(10);
    expect(raster[0][1]).toBeNaN(); // masked-out pixel, not silently 0
  });

  it('writes 0 (not NaN) for masked-out single-band pixels, matching raw DN nodata', async () => {
    const width = 2, height = 2;
    const arrays = {
      width, height,
      r: new Float32Array([10, 0, 30, 40]),
      g: new Float32Array(4), b: new Float32Array(4),
      mask: new Uint8Array([1, 0, 1, 1]),
    };
    const { blob } = toGeoTIFFBlob(arrays, [0, 0, 1, 1], 'single');
    const tiff = await fromArrayBuffer(await blob.arrayBuffer());
    const raster = await (await tiff.getImage(0)).readRasters();
    expect(raster[0][0]).toBe(10);
    expect(raster[0][1]).toBe(0);
  });
});

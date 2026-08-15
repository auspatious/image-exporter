import { fromUrl, Pool, writeArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import * as turf from '@turf/turf';
import { colormapLUT } from './colormap.js';

const pool = new Pool();

// Handle cache. Same COG re-opened many times → we open it once. Capped and
// LRU-evicted so a long session panning across many regions doesn't hold
// open handles for every COG it has ever touched.
const MAX_CACHED_ASSETS = 64;
const imageCache = new Map();
async function openAsset(href) {
  if (imageCache.has(href)) {
    const entry = imageCache.get(href);
    imageCache.delete(href); // re-insert to mark as most recently used
    imageCache.set(href, entry);
    return entry;
  }
  const entry = fromUrl(href, { cacheSize: 32 });
  imageCache.set(href, entry);
  if (imageCache.size > MAX_CACHED_ASSETS) {
    imageCache.delete(imageCache.keys().next().value);
  }
  return entry;
}

/* ── Coordinate transforms ────────────────────────────────────────────── */

export function utmProj(epsg) {
  const code = String(epsg);
  if (!code.startsWith('326') && !code.startsWith('327')) {
    throw new Error(`Unsupported CRS EPSG:${epsg} (only WGS84 UTM north/south)`);
  }
  const zone = parseInt(code.slice(3), 10);
  const south = code.startsWith('327');
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
}

export function reprojectBbox(bbox4326, epsg) {
  proj4.defs(`EPSG:${epsg}`, utmProj(epsg));
  const p = proj4('EPSG:4326', `EPSG:${epsg}`);
  const [w, s, e, n] = bbox4326;
  const c = [p.forward([w, s]), p.forward([e, s]), p.forward([e, n]), p.forward([w, n])];
  const xs = c.map((x) => x[0]);
  const ys = c.map((x) => x[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* ── Windowed COG read ────────────────────────────────────────────────── */

/**
 * Read the part of a COG that overlaps the drawn box, keeping proper
 * geographic alignment with the output mosaic. Returns pixels sized to
 * *only the overlap area*, plus the offset within the output where they
 * belong. This is what makes multi-tile mosaics render correctly — each
 * item's data lands at its true geographic position instead of being
 * stretched to fill the whole box.
 *
 * Returns `null` when the item doesn't intersect the drawn box.
 */
async function readWindow(href, bbox4326, outWidth, outHeight, itemEpsg, signal) {
  const tiff = await openAsset(href);
  const image = await tiff.getImage(0);
  const epsg = image.geoKeys?.ProjectedCSTypeGeoKey ?? itemEpsg;
  const dbn = reprojectBbox(bbox4326, epsg); // drawn box in item's CRS
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution(); // ry negative on north-up rasters
  const W = image.getWidth();
  const H = image.getHeight();

  // Image bbox in native CRS.
  const imgX0 = ox;
  const imgX1 = ox + W * rx;
  const imgY1 = oy;
  const imgY0 = oy + H * ry;

  // Intersection of drawn box and image bbox.
  const iX0 = Math.max(dbn[0], imgX0);
  const iX1 = Math.min(dbn[2], imgX1);
  const iY0 = Math.max(dbn[1], imgY0);
  const iY1 = Math.min(dbn[3], imgY1);
  if (iX1 <= iX0 || iY1 <= iY0) return null;

  // Pixel window on the image.
  const px0 = Math.max(0, Math.floor((iX0 - ox) / rx));
  const px1 = Math.min(W, Math.ceil((iX1 - ox) / rx));
  const py0 = Math.max(0, Math.floor((oy - iY1) / -ry));
  const py1 = Math.min(H, Math.ceil((oy - iY0) / -ry));

  // Where in the output canvas does this intersection land?
  const boxW = dbn[2] - dbn[0];
  const boxH = dbn[3] - dbn[1];
  const oX0 = Math.round(((iX0 - dbn[0]) / boxW) * outWidth);
  const oX1 = Math.round(((iX1 - dbn[0]) / boxW) * outWidth);
  const oY0 = Math.round(((dbn[3] - iY1) / boxH) * outHeight);
  const oY1 = Math.round(((dbn[3] - iY0) / boxH) * outHeight);
  const partW = Math.max(1, oX1 - oX0);
  const partH = Math.max(1, oY1 - oY0);

  const data = await image.readRasters({
    window: [px0, py0, px1, py1],
    width: partW,
    height: partH,
    samples: [0],
    resampleMethod: 'bilinear',
    pool,
    fillValue: 0,
    signal,
  });
  return {
    pixels: data[0],
    width: partW,
    height: partH,
    offsetX: oX0,
    offsetY: oY0,
  };
}

/* ── Per-item band read, by visualisation mode ───────────────────────── */

/**
 * Normalized difference of two same-shaped pixel arrays: (a - b) / (a + b).
 * Both source values must be non-zero for a pixel to count as valid —
 * unlike reflectance DN, a computed index can legitimately be exactly 0, so
 * the merge step's usual "all channels zero = nodata" heuristic doesn't
 * apply here.
 */
export function normalizedDifference(pixelsA, pixelsB) {
  const n = pixelsA.length;
  const value = new Float32Array(n);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const va = pixelsA[i], vb = pixelsB[i];
    if (va === 0 || vb === 0) continue;
    const denom = va + vb;
    value[i] = denom === 0 ? 0 : (va - vb) / denom;
    valid[i] = 1;
  }
  return { value, valid };
}

/**
 * Reads the bands one item contributes for the given mode and reduces them
 * to a single r/g/b-per-pixel part (all three channels equal for 'single'
 * and 'index', so the merge step below never needs to know the mode).
 * Returns `null` when the item doesn't intersect the box.
 */
async function readBandsForItem(item, mode, bands, drawnBbox, width, height, epsg, signal) {
  if (mode === 'single') {
    const W = await readWindow(item.assets[bands.band].href, drawnBbox, width, height, epsg, signal);
    if (!W) return null;
    return { r: W.pixels, g: W.pixels, b: W.pixels, width: W.width, height: W.height, offsetX: W.offsetX, offsetY: W.offsetY };
  }

  if (mode === 'index') {
    const [A, B] = await Promise.all([
      readWindow(item.assets[bands.a].href, drawnBbox, width, height, epsg, signal),
      readWindow(item.assets[bands.b].href, drawnBbox, width, height, epsg, signal),
    ]);
    if (!A || !B) return null;
    const { value, valid } = normalizedDifference(A.pixels, B.pixels);
    return { r: value, g: value, b: value, valid, width: A.width, height: A.height, offsetX: A.offsetX, offsetY: A.offsetY };
  }

  // 'rgb' (default)
  const [R, G, B] = await Promise.all([
    readWindow(item.assets[bands.r].href, drawnBbox, width, height, epsg, signal),
    readWindow(item.assets[bands.g].href, drawnBbox, width, height, epsg, signal),
    readWindow(item.assets[bands.b].href, drawnBbox, width, height, epsg, signal),
  ]);
  if (!R || !G || !B) return null;
  return { r: R.pixels, g: G.pixels, b: B.pixels, width: R.width, height: R.height, offsetX: R.offsetX, offsetY: R.offsetY };
}

/**
 * Place a part's pixels at their true offset within the output mosaic.
 * Where items overlap, the brighter pixel wins: bilinear resampling blends
 * nodata (0) into scene-edge pixels, darkening them, so preferring
 * brightness heals the seam with the neighbouring scene's clean data.
 */
export function mergeInto(arrays, part, outWidth, outHeight) {
  const { r: rp, g: gp, b: bp, valid, width: pw, height: ph, offsetX: ox, offsetY: oy } = part;
  const { r, g, b, mask } = arrays;
  for (let dy = 0; dy < ph; dy++) {
    const outRow = oy + dy;
    if (outRow < 0 || outRow >= outHeight) continue;
    const outRowBase = outRow * outWidth;
    const inRowBase = dy * pw;
    for (let dx = 0; dx < pw; dx++) {
      const outCol = ox + dx;
      if (outCol < 0 || outCol >= outWidth) continue;
      const outIdx = outRowBase + outCol;
      const inIdx = inRowBase + dx;
      const vr = rp[inIdx], vg = gp[inIdx], vb = bp[inIdx];
      const isValid = valid ? valid[inIdx] : !(vr === 0 && vg === 0 && vb === 0);
      if (!isValid) continue;
      if (mask[outIdx] && r[outIdx] + g[outIdx] + b[outIdx] >= vr + vg + vb) continue;
      r[outIdx] = vr; g[outIdx] = vg; b[outIdx] = vb; mask[outIdx] = 1;
    }
  }
}

/* ── Streaming composite ──────────────────────────────────────────────── */

/**
 * Fire all bands of all items in parallel; call onPartial after each item's
 * bands all arrive and are merged into the mosaic. Returns the same arrays
 * that were streamed — callers can use them for both preview and download.
 *
 * `bands` shape depends on `mode`: `{ r, g, b }` for 'rgb' (default),
 * `{ band }` for 'single', `{ a, b }` for 'index' (value = (a - b) / (a + b)).
 */
export async function streamComposite({ items, drawnBbox, mode = 'rgb', bands = { r: 'red', g: 'green', b: 'blue' }, width, height, onPartial, onLog, signal }) {
  const arrays = {
    r: new Float32Array(width * height),
    g: new Float32Array(width * height),
    b: new Float32Array(width * height),
    mask: new Uint8Array(width * height),
    width,
    height,
  };

  const drawnPoly = turf.bboxPolygon(drawnBbox);
  const contributing = items.filter((it) => turf.booleanIntersects(drawnPoly, it));

  await Promise.all(
    contributing.map(async (item, idx) => {
      const epsg = item.properties?.['proj:epsg'] ?? item.properties?.['proj:code'];
      try {
        const part = await readBandsForItem(item, mode, bands, drawnBbox, width, height, epsg, signal);
        if (part) mergeInto(arrays, part, width, height);
        onPartial?.(arrays, idx + 1, contributing.length);
      } catch (err) {
        // AbortError means the caller cancelled this fetch (e.g. the user
        // picked a different day/box) — expected, not a real failure.
        if (err.name !== 'AbortError') onLog?.(`Skipped ${item.id}: ${err.message}`);
      }
    }),
  );

  return arrays;
}

/* ── Stretch, gamma → ImageData ───────────────────────────────────────── */

/**
 * `mode` gates the colour-map path: it only ever applies to 'single'/'index'
 * data (where r === g === b, one real value per pixel) — 'rgb' mode always
 * uses the plain per-channel stretch, regardless of what `viz.colormap` (or
 * `viz.colormapReversed`) holds. `colormapReversed` flips which end of the
 * stretch maps to which end of the ramp — including for grayscale, since
 * that's just the colour-map path with no LUT applied.
 */
export function renderRGBA({ r, g, b, mask, width, height }, viz, mode = 'rgb') {
  const { vmin, vmax, gamma, colormap, colormapReversed } = viz;
  const rng = (vmax - vmin) || 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const useColormapPath = mode !== 'rgb';
  const lut = useColormapPath ? colormapLUT(colormap) : null;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) { rgba[i * 4 + 3] = 0; continue; }
    if (useColormapPath) {
      let t = stretchT(r[i], vmin, rng, gamma);
      if (colormapReversed) t = 1 - t;
      if (lut) {
        const li = Math.round(t * 255) * 3;
        rgba[i * 4]     = lut[li];
        rgba[i * 4 + 1] = lut[li + 1];
        rgba[i * 4 + 2] = lut[li + 2];
      } else {
        const v = Math.round(t * 255);
        rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v;
      }
    } else {
      rgba[i * 4]     = stretch(r[i], vmin, rng, gamma);
      rgba[i * 4 + 1] = stretch(g[i], vmin, rng, gamma);
      rgba[i * 4 + 2] = stretch(b[i], vmin, rng, gamma);
    }
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function stretchT(v, vmin, rng, gamma) {
  let x = (v - vmin) / rng;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (gamma !== 1) x = Math.pow(x, gamma);
  return x;
}

function stretch(v, vmin, rng, gamma) {
  return Math.round(stretchT(v, vmin, rng, gamma) * 255);
}

/* ── Crop to valid data ───────────────────────────────────────────────── */

/**
 * Bounding box (in pixel coordinates) of the masked-in pixels. Returns
 * `null` when nothing is valid.
 */
export function cropBounds(mask, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const base = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[base + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Crop an ImageData to the bounding box of valid (masked-in) pixels, so
 * downloads don't carry empty borders where no scene covered the box.
 * Returns the original image if everything (or nothing) is valid.
 */
export function cropToValid(img, mask) {
  const { width, height } = img;
  const bounds = cropBounds(mask, width, height);
  if (!bounds) return img; // no valid data — keep as-is
  const { x0, y0, x1, y1 } = bounds;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w === width && h === height) return img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * width + x0) * 4;
    out.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return new ImageData(out, w, h);
}

/**
 * The WGS-84 bbox that a pixel-space crop rectangle corresponds to, given
 * the full output canvas's bbox. Row 0 of the canvas is the box's north
 * edge (rasters are north-up), so y grows southward.
 */
export function bboxForCrop(bbox, width, height, bounds) {
  const [w, s, e, n] = bbox;
  const px = (e - w) / width;
  const py = (n - s) / height;
  return [
    w + bounds.x0 * px,
    n - (bounds.y1 + 1) * py,
    w + (bounds.x1 + 1) * px,
    n - bounds.y0 * py,
  ];
}

/* ── Encode ───────────────────────────────────────────────────────────── */

export async function toBlob(img, format = 'png', quality = 0.92) {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(img, 0, 0);
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  return canvas.convertToBlob({ type: mime, quality });
}

export async function toBlobURL(img, format = 'png') {
  return URL.createObjectURL(await toBlob(img, format));
}

/**
 * Encode the *raw, uncropped-stretch* mosaic arrays as a georeferenced
 * GeoTIFF — not the vmin/vmax/gamma/colormap-stretched display pixels
 * PNG/JPG save. One band for 'single'/'index' (r, since r === g === b
 * there), three for 'rgb'. Cropped to the same valid-data bounding box as
 * PNG/JPG.
 *
 * 'rgb'/'single' are reflectance DN — the same uint16 sample type the
 * source Sentinel-2 COGs use — with masked-out pixels written as `0` (the
 * same nodata convention already used for that raw DN elsewhere in the
 * app). 'index' values (e.g. NDVI's -1..1) can't be represented that way,
 * so it stays float32, with masked-out pixels as `NaN` — reusing `0`
 * there would be wrong, since an index value of exactly 0 is real data.
 */
export function toGeoTIFFBlob(arrays, drawnBbox, mode = 'rgb') {
  const { r, g, b, mask, width, height } = arrays;
  const bounds = cropBounds(mask, width, height);
  const x0 = bounds ? bounds.x0 : 0;
  const y0 = bounds ? bounds.y0 : 0;
  const cropW = bounds ? bounds.x1 - bounds.x0 + 1 : width;
  const cropH = bounds ? bounds.y1 - bounds.y0 + 1 : height;
  const bbox = bounds ? bboxForCrop(drawnBbox, width, height, bounds) : drawnBbox;

  const bands = mode === 'rgb' ? [r, g, b] : [r];
  const numBands = bands.length;
  const isIndex = mode === 'index';
  const interleaved = isIndex
    ? new Float32Array(cropW * cropH * numBands)
    : new Uint16Array(cropW * cropH * numBands);

  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const srcIdx = (y0 + y) * width + (x0 + x);
      const dstBase = (y * cropW + x) * numBands;
      const valid = mask[srcIdx];
      for (let bi = 0; bi < numBands; bi++) {
        if (!valid) {
          interleaved[dstBase + bi] = isIndex ? NaN : 0;
          continue;
        }
        // Uint16Array assignment truncates and wraps rather than rounding
        // and clamping, so do both explicitly first.
        interleaved[dstBase + bi] = isIndex ? bands[bi][srcIdx] : Math.max(0, Math.min(65535, Math.round(bands[bi][srcIdx])));
      }
    }
  }

  const [w, s, e, n] = bbox;
  const arrayBuffer = writeArrayBuffer(interleaved, {
    width: cropW,
    height: cropH,
    ModelPixelScale: [(e - w) / cropW, (n - s) / cropH, 0],
    ModelTiepoint: [0, 0, 0, w, n, 0],
    GeographicTypeGeoKey: 4326,
    GeogCitationGeoKey: 'WGS 84',
    GTModelTypeGeoKey: 2,
    GDAL_NODATA: isIndex ? 'nan' : '0',
  });
  return { blob: new Blob([arrayBuffer], { type: 'image/tiff' }), width: cropW, height: cropH };
}

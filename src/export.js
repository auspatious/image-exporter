import { fromUrl, Pool } from 'geotiff';
import proj4 from 'proj4';
import * as turf from '@turf/turf';

const pool = new Pool();

// Handle cache. Same COG re-opened many times → we open it once.
const imageCache = new Map();
async function openAsset(href) {
  if (!imageCache.has(href)) imageCache.set(href, fromUrl(href, { cacheSize: 32 }));
  return imageCache.get(href);
}

/* ── Coordinate transforms ────────────────────────────────────────────── */

function utmProj(epsg) {
  const code = String(epsg);
  if (!code.startsWith('326') && !code.startsWith('327')) {
    throw new Error(`Unsupported CRS EPSG:${epsg} (only WGS84 UTM north/south)`);
  }
  const zone = parseInt(code.slice(3), 10);
  const south = code.startsWith('327');
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
}

function reprojectBbox(bbox4326, epsg) {
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
async function readWindow(href, bbox4326, outWidth, outHeight, itemEpsg) {
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
  });
  return {
    pixels: data[0],
    width: partW,
    height: partH,
    offsetX: oX0,
    offsetY: oY0,
  };
}

/* ── Streaming composite ──────────────────────────────────────────────── */

/**
 * Fire all bands of all items in parallel; call onPartial after each item's
 * R+G+B all arrive and are merged into the mosaic. Returns the same arrays
 * that were streamed — callers can use them for both preview and download.
 */
export async function streamComposite({ items, drawnBbox, bands = { r: 'red', g: 'green', b: 'blue' }, width, height, onPartial, onLog }) {
  const r = new Float32Array(width * height);
  const g = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  const mask = new Uint8Array(width * height);
  const arrays = { r, g, b, mask, width, height };

  const drawnPoly = turf.bboxPolygon(drawnBbox);
  const contributing = items.filter((it) => turf.booleanIntersects(drawnPoly, it));

  await Promise.all(
    contributing.map(async (item, idx) => {
      const epsg = item.properties?.['proj:epsg'] ?? item.properties?.['proj:code'];
      try {
        const [R, G, B] = await Promise.all([
          readWindow(item.assets[bands.r].href, drawnBbox, width, height, epsg),
          readWindow(item.assets[bands.g].href, drawnBbox, width, height, epsg),
          readWindow(item.assets[bands.b].href, drawnBbox, width, height, epsg),
        ]);
        if (!R || !G || !B) {
          onPartial?.(arrays, idx + 1, contributing.length);
          return;
        }
        // Place the item's partial pixels at their true offset within the
        // output mosaic. Where items overlap, the brighter pixel wins:
        // bilinear resampling blends nodata (0) into scene-edge pixels,
        // darkening them, so preferring brightness heals the seam with the
        // neighbouring scene's clean data.
        const rp = R.pixels, gp = G.pixels, bp = B.pixels;
        const { width: pw, height: ph, offsetX: ox, offsetY: oy } = R;
        for (let dy = 0; dy < ph; dy++) {
          const outRow = oy + dy;
          if (outRow < 0 || outRow >= height) continue;
          const outRowBase = outRow * width;
          const inRowBase = dy * pw;
          for (let dx = 0; dx < pw; dx++) {
            const outCol = ox + dx;
            if (outCol < 0 || outCol >= width) continue;
            const outIdx = outRowBase + outCol;
            const inIdx = inRowBase + dx;
            const vr = rp[inIdx], vg = gp[inIdx], vb = bp[inIdx];
            if (vr === 0 && vg === 0 && vb === 0) continue;
            if (mask[outIdx] && r[outIdx] + g[outIdx] + b[outIdx] >= vr + vg + vb) continue;
            r[outIdx] = vr; g[outIdx] = vg; b[outIdx] = vb; mask[outIdx] = 1;
          }
        }
        onPartial?.(arrays, idx + 1, contributing.length);
      } catch (err) {
        onLog?.(`Skipped ${item.id}: ${err.message}`);
      }
    }),
  );

  return arrays;
}

/* ── Stretch, gamma → ImageData ───────────────────────────────────────── */

export function renderRGBA({ r, g, b, mask, width, height }, viz) {
  const { vmin, vmax, gamma } = viz;
  const rng = (vmax - vmin) || 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) { rgba[i * 4 + 3] = 0; continue; }
    rgba[i * 4]     = stretch(r[i], vmin, rng, gamma);
    rgba[i * 4 + 1] = stretch(g[i], vmin, rng, gamma);
    rgba[i * 4 + 2] = stretch(b[i], vmin, rng, gamma);
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function stretch(v, vmin, rng, gamma) {
  let x = (v - vmin) / rng;
  if (x <= 0) return 0;
  if (x >= 1) return 255;
  if (gamma !== 1) x = Math.pow(x, gamma);
  return Math.round(x * 255);
}

/* ── Crop to valid data ───────────────────────────────────────────────── */

/**
 * Crop an ImageData to the bounding box of valid (masked-in) pixels, so
 * downloads don't carry empty borders where no scene covered the box.
 * Returns the original image if everything (or nothing) is valid.
 */
export function cropToValid(img, mask) {
  const { width, height } = img;
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
  if (x1 < 0) return img; // no valid data — keep as-is
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

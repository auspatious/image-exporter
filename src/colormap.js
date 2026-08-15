/**
 * Colour ramps for 'single'/'index' vizMode ('rgb' mode ignores these — it
 * already has three real bands). Each is a handful of standard
 * (ColorBrewer / matplotlib) control-point colours, linearly interpolated
 * into a 256-entry lookup table on first use.
 */

const STOPS = {
  greens:  ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
  reds:    ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'],
  blues:   ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
  viridis: ['#440154', '#3b528b', '#21908d', '#5dc963', '#fde725'],
  rdylgn:  ['#a50026', '#f46d43', '#ffffbf', '#66bd63', '#006837'], // classic NDVI ramp
  rdbu:    ['#67001f', '#d6604d', '#f7f7f7', '#4393c3', '#053061'],
  brbg:    ['#543005', '#bf812d', '#f5f5f5', '#35978f', '#003c30'],
};

export const COLORMAPS = [
  { id: 'gray', label: 'Grayscale' },
  { id: 'greens', label: 'Greens' },
  { id: 'reds', label: 'Reds' },
  { id: 'blues', label: 'Blues' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'rdylgn', label: 'Red–Yellow–Green (diverging)' },
  { id: 'rdbu', label: 'Red–Blue (diverging)' },
  { id: 'brbg', label: 'Brown–Teal (diverging)' },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildLUT(stops) {
  const colors = stops.map(hexToRgb);
  const segments = colors.length - 1;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * segments;
    const seg = Math.min(segments - 1, Math.floor(t));
    const localT = t - seg;
    const [r0, g0, b0] = colors[seg];
    const [r1, g1, b1] = colors[seg + 1];
    lut[i * 3] = Math.round(r0 + (r1 - r0) * localT);
    lut[i * 3 + 1] = Math.round(g0 + (g1 - g0) * localT);
    lut[i * 3 + 2] = Math.round(b0 + (b1 - b0) * localT);
  }
  return lut;
}

const cache = new Map();

/**
 * A 256-entry RGB lookup table (flat Uint8Array, length 768) for the given
 * colormap id. Returns `null` for 'gray' (or an unknown id) — callers treat
 * that as "no colormap, use the plain per-channel stretch".
 */
export function colormapLUT(id) {
  if (!id || id === 'gray' || !STOPS[id]) return null;
  if (!cache.has(id)) cache.set(id, buildLUT(STOPS[id]));
  return cache.get(id);
}

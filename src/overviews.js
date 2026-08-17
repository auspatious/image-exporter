import { distance } from '@turf/distance';

/** Ground width and height (metres) of a WGS-84 bbox, using WGS-84 distances. */
export function boxMeters(bbox) {
  const [w, s, e, n] = bbox;
  const centreLat = (s + n) / 2;
  return {
    widthMeters: distance([w, centreLat], [e, centreLat], { units: 'meters' }),
    heightMeters: distance([w, s], [w, n], { units: 'meters' }),
  };
}

/**
 * Native pixel count of a bbox at the collection's native GSD.
 * The theoretical maximum a preview or download can carry — beyond this
 * we're just interpolating bytes that don't exist.
 */
export function nativePixelWidth(bbox, nativeGSD) {
  if (!bbox) return 0;
  return Math.round(boxMeters(bbox).widthMeters / nativeGSD);
}

/**
 * Output pixel size for a given bbox and requested width in pixels.
 * Height preserves the box aspect ratio. Width is clamped so we never
 * request more pixels than native.
 */
export function outputSize(bbox, targetWidth, nativeGSD) {
  if (!bbox) return null;
  const { widthMeters, heightMeters } = boxMeters(bbox);
  const nativeWidth = Math.round(widthMeters / nativeGSD);
  const width = Math.max(1, Math.min(nativeWidth, Math.round(targetWidth)));
  const height = Math.max(1, Math.round(width * (heightMeters / widthMeters)));
  return { width, height, widthMeters, heightMeters };
}

/**
 * min/max for the "output size" range slider: always reaches exactly
 * `nativeMax` at the top end, with `(max - min)` an exact multiple of
 * `step`. That divisibility matters — a range input can only actually be
 * dragged all the way to `max` if it's a legal step value; otherwise the
 * browser caps the reachable value (and the thumb's travel) at the largest
 * step below max, short-changing native resolution rather than reaching
 * it. Achieved by shifting `min` up (by less than one `step`) instead of
 * rounding `max` down.
 *
 * Sometimes there's no room for even one step below `minWidth` — either
 * because native resolution doesn't reach `minWidth` at all, or because it
 * clears it by less than one `step` (e.g. minWidth=256, step=128,
 * nativeMax=300: still only one achievable size, since `outputSize` always
 * clamps to native regardless of what's requested). `collapsed: true`
 * flags this; `min`/`max` are pinned one unit apart rather than equal, so
 * a range input's thumb renders at the right (100%) — the way browsers
 * tend to handle a truly zero-width (`min === max`) range instead defaults
 * the thumb to the left, which reads as "stuck at the minimum".
 */
export function sliderRange(nativeMax, minWidth, step) {
  const max = Math.max(1, nativeMax);
  const rawMin = max <= minWidth ? max : max - Math.floor((max - minWidth) / step) * step;
  const collapsed = rawMin >= max;
  return { min: collapsed ? Math.max(1, max - 1) : rawMin, max, collapsed };
}

import * as turf from '@turf/turf';

/** Ground width and height (metres) of a WGS-84 bbox, using WGS-84 distances. */
export function boxMeters(bbox) {
  const [w, s, e, n] = bbox;
  const centreLat = (s + n) / 2;
  return {
    widthMeters: turf.distance([w, centreLat], [e, centreLat], { units: 'meters' }),
    heightMeters: turf.distance([w, s], [w, n], { units: 'meters' }),
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

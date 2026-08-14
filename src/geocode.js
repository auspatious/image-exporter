/* Reverse geocoding for download file names.
   Uses the free OSM Nominatim API (no key). Failures are non-fatal:
   the caller just omits the place name. Results are cached per lookup
   point so repeated downloads don't re-query. */

const cache = new Map();

export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Returns a slugified place name for [lon, lat], or null. */
export async function placeName(lon, lat) {
  const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  let slug = null;
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const j = await res.json();
      const a = j.address || {};
      const name =
        a.city || a.town || a.village || a.municipality || a.county ||
        a.state_district || a.state || a.island || a.country || j.name;
      if (name) slug = slugify(name) || null;
    }
  } catch {
    /* offline, timeout, or blocked: fine, no place name */
  }
  cache.set(key, slug);
  return slug;
}

import * as turf from '@turf/turf';

/**
 * Group STAC items by solar day. For each day, filter to items intersecting
 * the drawn box (if any) and sort by cloud cover ascending.
 *
 * Returns a list of `{ day, items, meanCloud }` groups.
 */
export function groupByDay(items, drawnBbox) {
  const drawnPoly = drawnBbox ? turf.bboxPolygon(drawnBbox) : null;
  const groups = new Map();

  for (const item of items) {
    const dt = item.properties?.datetime;
    if (!dt) continue;
    const day = dt.slice(0, 10);
    let intersects = true;
    if (drawnPoly) {
      try {
        intersects = turf.booleanIntersects(drawnPoly, item);
      } catch {
        intersects = false;
      }
    }
    if (!intersects) continue;
    let g = groups.get(day);
    if (!g) {
      g = { day, items: [], meanCloud: 0 };
      groups.set(day, g);
    }
    g.items.push(item);
  }

  const out = [...groups.values()].map((g) => {
    const clouds = g.items
      .map((i) => i.properties?.['eo:cloud_cover'])
      .filter((c) => typeof c === 'number');
    g.meanCloud = clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : null;
    g.items.sort(
      (a, b) => (a.properties?.['eo:cloud_cover'] ?? 100) - (b.properties?.['eo:cloud_cover'] ?? 100),
    );
    return g;
  });

  out.sort((a, b) => (a.day < b.day ? 1 : -1));
  return out;
}

import { area } from '@turf/area';
import { bboxPolygon } from '@turf/bbox-polygon';
import { booleanIntersects } from '@turf/boolean-intersects';
import { featureCollection } from '@turf/helpers';
import { intersect } from '@turf/intersect';
import { union } from '@turf/union';

/**
 * Group STAC items by solar day. For each day, filter to items intersecting
 * the drawn box (if any) and sort by cloud cover ascending.
 *
 * Returns a list of `{ day, items, meanCloud, coverage }` groups, where
 * `coverage` is the % of the drawn box covered by the day's footprints
 * (null when no box is drawn).
 */
export function groupByDay(items, drawnBbox) {
  const drawnPoly = drawnBbox ? bboxPolygon(drawnBbox) : null;
  const groups = new Map();

  for (const item of items) {
    const dt = item.properties?.datetime;
    if (!dt) continue;
    const day = dt.slice(0, 10);
    let intersects = true;
    if (drawnPoly) {
      try {
        intersects = booleanIntersects(drawnPoly, item);
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
    g.coverage = coveragePct(g.items, drawnPoly);
    return g;
  });

  out.sort((a, b) => (a.day < b.day ? 1 : -1));
  return out;
}

/**
 * % of the drawn box covered by the union of the items' footprints.
 */
function coveragePct(items, drawnPoly) {
  if (!drawnPoly) return null;
  let covered = null;
  for (const item of items) {
    try {
      const clip = intersect(featureCollection([drawnPoly, item]));
      if (!clip) continue;
      covered = covered ? union(featureCollection([covered, clip])) : clip;
    } catch {
      // Skip items with geometry that turf can't process.
    }
  }
  if (!covered) return 0;
  return Math.min(100, (area(covered) / area(drawnPoly)) * 100);
}

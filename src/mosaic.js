import { area } from '@turf/area';
import { bboxPolygon } from '@turf/bbox-polygon';
import { booleanIntersects } from '@turf/boolean-intersects';
import { featureCollection } from '@turf/helpers';
import { intersect } from '@turf/intersect';
import { union } from '@turf/union';

/**
 * Group STAC items by solar day and sort each day's items by cloud cover
 * ascending. A day is only included if it has at least one item
 * intersecting the drawn box (if any) — but once included, `items` lists
 * *every* item found for that day (e.g. a scene the search's viewport
 * caught that doesn't actually overlap the drawn box), not just the
 * intersecting ones. `renderItems` is the intersecting subset actually
 * used for the mosaic/coverage/cloud-cover stats; `intersectingIds` (a
 * `Set`, or null with no drawn box) tells callers which of `items` that is,
 * e.g. to colour footprints differently.
 *
 * Returns a list of
 * `{ day, items, renderItems, intersectingIds, meanCloud, coverage }`
 * groups, where `coverage` is the % of the drawn box covered by
 * `renderItems`'s footprints (null when no box is drawn).
 */
export function groupByDay(items, drawnBbox) {
  const drawnPoly = drawnBbox ? bboxPolygon(drawnBbox) : null;
  const groups = new Map();

  for (const item of items) {
    const dt = item.properties?.datetime;
    if (!dt) continue;
    const day = dt.slice(0, 10);
    let g = groups.get(day);
    if (!g) {
      g = { day, items: [] };
      groups.set(day, g);
    }
    g.items.push(item);
  }

  const out = [...groups.values()]
    .map((g) => {
      let intersectingIds = null;
      let renderItems = g.items;
      if (drawnPoly) {
        intersectingIds = new Set();
        renderItems = g.items.filter((item) => {
          let hit;
          try {
            hit = booleanIntersects(drawnPoly, item);
          } catch {
            hit = false;
          }
          if (hit) intersectingIds.add(item.id);
          return hit;
        });
      }
      const clouds = renderItems
        .map((i) => i.properties?.['eo:cloud_cover'])
        .filter((c) => typeof c === 'number');
      const meanCloud = clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : null;
      const sortedItems = [...g.items].sort(
        (a, b) => (a.properties?.['eo:cloud_cover'] ?? 100) - (b.properties?.['eo:cloud_cover'] ?? 100),
      );
      const coverage = coveragePct(renderItems, drawnPoly);
      return { day: g.day, items: sortedItems, renderItems, intersectingIds, meanCloud, coverage };
    })
    .filter((g) => !drawnPoly || g.renderItems.length > 0);

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

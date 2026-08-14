/**
 * STAC client for Earth Search v1 (element84).
 * https://earth-search.aws.element84.com/v1/
 *
 * We POST /search with the current map bbox, requested date range, cloud cover
 * filter, and target collection. The response items are plain GeoJSON with
 * an `assets` dict that includes the RGB COGs.
 */

const SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';

export async function searchItems({
  bbox,
  dateFrom,
  dateTo,
  cloudCoverMax,
  collection,
  limit = 100,
  signal,
}) {
  const body = {
    collections: [collection],
    bbox,
    datetime: `${dateFrom}T00:00:00Z/${dateTo}T23:59:59Z`,
    limit,
    'query': {
      'eo:cloud_cover': { lte: cloudCoverMax },
    },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  };

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`STAC search failed: ${res.status} ${res.statusText}`);
  }

  const fc = await res.json();
  return fc.features ?? [];
}

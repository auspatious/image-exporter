/**
 * Adds the STAC footprint layer + selection highlight to the given map.
 */

const EMPTY = { type: 'FeatureCollection', features: [] };

export function addFootprintLayers(map) {
  map.addSource('stac-items', { type: 'geojson', data: EMPTY });
  map.addSource('stac-selected', { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'stac-items-fill',
    type: 'fill',
    source: 'stac-items',
    paint: {
      'fill-color': '#3474c7',
      'fill-opacity': 0.10,
    },
  });
  map.addLayer({
    id: 'stac-items-outline',
    type: 'line',
    source: 'stac-items',
    paint: {
      'line-color': '#3474c7',
      'line-width': 1,
      'line-opacity': 0.6,
    },
  });

  map.addLayer({
    id: 'stac-selected-fill',
    type: 'fill',
    source: 'stac-selected',
    paint: {
      'fill-color': '#fbc27b',
      'fill-opacity': 0.15,
    },
  });
  map.addLayer({
    id: 'stac-selected-outline',
    type: 'line',
    source: 'stac-selected',
    paint: {
      'line-color': '#fbc27b',
      'line-width': 3,
    },
  });
}

/**
 * Show all items' footprints. The selected-day layers draw on top.
 */
export function setFootprints(map, items) {
  map.getSource('stac-items')?.setData({ type: 'FeatureCollection', features: items ?? [] });
}

/**
 * Highlight the selected day's items on a dedicated (bolder, green) layer.
 */
export function setSelected(map, items) {
  map.getSource('stac-selected')?.setData({ type: 'FeatureCollection', features: items ?? [] });
}

import { Map, NavigationControl, ScaleControl, GeolocateControl, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

// maplibre v6 resolves its worker relative to import.meta.url, which breaks
// once Vite bundles it. ?worker&url makes Vite bundle the worker (with its
// maplibre-gl-shared.mjs dependency) and hand us the real production path.
setWorkerUrl(maplibreWorkerUrl);

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function createMap(container) {
  const map = new Map({
    container,
    style: OSM_STYLE,
    center: [0, 20],
    zoom: 1,
    hash: true,
  });

  map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }));
  map.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right');

  return map;
}

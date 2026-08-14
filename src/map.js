import { Map, NavigationControl, ScaleControl, GeolocateControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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
    center: [135, -28],
    zoom: 4,
    hash: true,
  });

  map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }));
  map.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right');

  return map;
}

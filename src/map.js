import { Map, NavigationControl, ScaleControl, GeolocateControl, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

// maplibre v6 resolves its worker relative to import.meta.url, which breaks
// once Vite bundles it. ?worker&url makes Vite bundle the worker (with its
// maplibre-gl-shared.mjs dependency) and hand us the real production path.
setWorkerUrl(maplibreWorkerUrl);

// Public client-side key, locked to allowed origins in the MapTiler dashboard.
const MAPTILER_KEY = 'ZUYgDOuttJIaWHdE632Y';
const MAPTILER_STYLE = `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`;
const MAPTILER_SATELLITE_STYLE = `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`;

const BASEMAPS = [
  { label: 'Map', short: 'MAP', style: MAPTILER_STYLE },
  { label: 'Satellite', short: 'SAT', style: MAPTILER_SATELLITE_STYLE },
];

// A single button that toggles between basemaps, showing the label of the
// one you'd switch *to* (the common convention for a 2-way toggle).
class BasemapToggleControl {
  constructor(styles) {
    this._styles = styles;
    this._index = 0;
  }

  onAdd(map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this._button = document.createElement('button');
    this._button.type = 'button';
    this._button.className = 'basemap-toggle-btn';
    this._button.addEventListener('click', () => {
      this._index = (this._index + 1) % this._styles.length;
      map.setStyle(this._styles[this._index].style);
      this._updateLabel();
    });
    this._container.appendChild(this._button);
    this._updateLabel();
    return this._container;
  }

  onRemove() {
    this._container.remove();
    this._map = undefined;
  }

  _updateLabel() {
    const next = this._styles[(this._index + 1) % this._styles.length];
    this._button.textContent = next.short;
    this._button.title = `Switch to ${next.label}`;
  }
}

// Fallback for origins the MapTiler key doesn't allow (e.g. local dev).
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
    style: MAPTILER_STYLE,
    center: [0, 20],
    zoom: 1,
    hash: true,
  });

  // If the style fails to load (key restricted on this origin), fall back to OSM.
  map.once('error', (e) => {
    if (map.isStyleLoaded()) return;
    console.warn('Basemap style failed, falling back to OSM:', e.error?.message);
    map.setStyle(OSM_STYLE);
  });

  map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }));
  map.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right');
  map.addControl(new BasemapToggleControl(BASEMAPS), 'top-right');

  return map;
}

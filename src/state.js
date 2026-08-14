/**
 * Minimal reactive state store. One `set` call, one round of listener fires,
 * no re-entrant updates from within subscribers.
 */

const listeners = new Set();

export const HARD_LIMIT_KM2 = 10000;

export const state = {
  // Search filters — default to the last 30 days.
  dateFrom: isoDate(new Date(Date.now() - 30 * 86400_000)),
  dateTo: isoDate(new Date()),
  cloudCoverMax: 20,
  collection: 'sentinel-2-l2a',
  minSearchZoom: 8,
  nativeGSD: 10, // Sentinel-2 red/green/blue

  // STAC results
  items: [],
  itemsByDay: [],

  // User selection
  drawnBbox: null,
  drawnAreaKm2: 0,
  selectedDay: null,

  // Band → asset-key mapping for the RGB composite (Earth Search asset names)
  bands: { r: 'red', g: 'green', b: 'blue' },

  // Output pixel width — governed by the "Area" panel (never exceeds the
  // box's native pixel count for the collection). Height is derived from
  // the box aspect ratio at fetch time.
  targetWidth: 1000,

  // Visualisation (drives renderRGBA only, never re-fetches)
  viz: {
    vmin: 0,
    vmax: 3000,
    gamma: 1.0,
    format: 'png',
  },

  // Live progress for the preview fetch
  loading: { active: false, done: 0, total: 0, message: '' },
};

export function set(patch) {
  Object.assign(state, patch);
  emit();
}

export function setViz(patch) {
  state.viz = { ...state.viz, ...patch };
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(state); }
    catch (err) { console.error('subscribe listener threw:', err); }
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Shareable app state lives in the URL's query string. The map's own
 * camera position already lives in the hash via MapLibre's `hash: true`,
 * so query params keep the two independent.
 *
 * Only fields that deviate from DEFAULT_STATE are written, and every value
 * uses characters (`-`, `.`, digits, letters) that application/x-www-form-
 * urlencoded never percent-encodes — so a shared URL stays plain text
 * instead of turning into %-escaped noise.
 *
 * Pure functions only — no `location`/`history` access here, so they're
 * plain to test. The caller (main.js) supplies the current search string
 * and applies the result / writes it back.
 */

import { DEFAULT_STATE, defaultDateRange } from './state.js';

/** Parses recognized params out of a query string (e.g. `location.search`). */
export function parseParams(search) {
  const params = new URLSearchParams(search);
  const out = {};

  const bbox = params.get('bbox');
  if (bbox) {
    const parts = bbox.split('_').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) out.bbox = parts;
  }

  const datetime = params.get('datetime');
  if (datetime) {
    const [from, to] = datetime.split('/');
    if (from) out.dateFrom = from;
    if (to) out.dateTo = to;
  }

  // Number(null) is 0, not NaN — check presence first so an absent param
  // isn't misread as an explicit 0.
  if (params.has('cloud_cover_max')) {
    const cloudCoverMax = Number(params.get('cloud_cover_max'));
    if (Number.isFinite(cloudCoverMax)) out.cloudCoverMax = cloudCoverMax;
  }

  const selectedDatetime = params.get('selected_datetime');
  if (selectedDatetime) out.selectedDatetime = selectedDatetime;

  const basemap = params.get('basemap');
  if (basemap) out.basemap = basemap;

  if (params.has('width')) {
    const width = Number(params.get('width'));
    if (Number.isFinite(width)) out.width = width;
  }

  const visualiseSettings = {};

  const preset = params.get('preset');
  if (preset) visualiseSettings.preset = preset;

  const vizMode = params.get('viz_mode');
  if (vizMode) visualiseSettings.vizMode = vizMode;

  const bands = params.get('bands');
  if (bands) {
    const [r, g, b] = bands.split('-');
    if (r && g && b) visualiseSettings.bands = { r, g, b };
  }

  const singleBand = params.get('single_band');
  if (singleBand) visualiseSettings.singleBand = singleBand;

  const indexBands = params.get('index_bands');
  if (indexBands) {
    const [a, b] = indexBands.split('-');
    if (a && b) visualiseSettings.indexBands = { a, b };
  }

  const viz = {};
  if (params.has('vmin')) {
    const v = Number(params.get('vmin'));
    if (Number.isFinite(v)) viz.vmin = v;
  }
  if (params.has('vmax')) {
    const v = Number(params.get('vmax'));
    if (Number.isFinite(v)) viz.vmax = v;
  }
  if (params.has('gamma')) {
    const v = Number(params.get('gamma'));
    if (Number.isFinite(v)) viz.gamma = v;
  }
  const format = params.get('format');
  if (format) viz.format = format;
  const colormap = params.get('colormap');
  if (colormap) viz.colormap = colormap;
  if (params.has('colormap_reversed')) viz.colormapReversed = params.get('colormap_reversed') === '1';
  if (Object.keys(viz).length) visualiseSettings.viz = viz;

  if (Object.keys(visualiseSettings).length) out.visualiseSettings = visualiseSettings;

  // Backward compat: links shared before the flat params above existed
  // carried one JSON blob instead. Only consulted when none of the flat
  // params supplied anything — the new format always wins.
  if (!out.visualiseSettings) {
    const legacy = params.get('visualise_settings');
    if (legacy) {
      try {
        out.visualiseSettings = JSON.parse(legacy);
      } catch {
        /* malformed/hand-edited param — ignore, fall back to defaults */
      }
    }
  }

  return out;
}

/**
 * Builds the query params for the current shareable state, preserving any
 * existing params this app doesn't know about (`currentSearch`). Only
 * fields that differ from DEFAULT_STATE are written.
 */
export function buildParams(state, currentSearch) {
  const params = new URLSearchParams(currentSearch);
  const setOrDelete = (key, value, isDefault) => {
    if (isDefault) params.delete(key);
    else params.set(key, value);
  };

  if (state.drawnBbox) params.set('bbox', state.drawnBbox.map((n) => +n.toFixed(5)).join('_'));
  else params.delete('bbox');

  // No fixed default to diff against (it's a rolling "last 30 days"), so
  // compare against what a fresh default would be right now. If the user
  // never touched the date filter this omits `datetime` entirely — on
  // reload, main.js falls back to a single-day window around
  // selected_datetime instead, which (unlike the rolling default) still
  // finds the shared item weeks or months later.
  const defaultRange = defaultDateRange();
  const isDefaultRange = state.dateFrom === defaultRange.dateFrom && state.dateTo === defaultRange.dateTo;
  if (!isDefaultRange) params.set('datetime', `${state.dateFrom}/${state.dateTo}`);
  else params.delete('datetime');

  setOrDelete('cloud_cover_max', String(state.cloudCoverMax), state.cloudCoverMax === DEFAULT_STATE.cloudCoverMax);

  if (state.selectedDay) params.set('selected_datetime', state.selectedDay);
  else params.delete('selected_datetime');

  setOrDelete('width', String(state.targetWidth), state.targetWidth === DEFAULT_STATE.targetWidth);
  setOrDelete('basemap', state.basemap, state.basemap === DEFAULT_STATE.basemap);
  setOrDelete('preset', state.preset, state.preset === DEFAULT_STATE.preset);
  setOrDelete('viz_mode', state.vizMode, state.vizMode === DEFAULT_STATE.vizMode);

  const b = state.bands, db = DEFAULT_STATE.bands;
  setOrDelete('bands', `${b.r}-${b.g}-${b.b}`, b.r === db.r && b.g === db.g && b.b === db.b);

  setOrDelete('single_band', state.singleBand, state.singleBand === DEFAULT_STATE.singleBand);

  const ib = state.indexBands, dib = DEFAULT_STATE.indexBands;
  setOrDelete('index_bands', `${ib.a}-${ib.b}`, ib.a === dib.a && ib.b === dib.b);

  const v = state.viz, dv = DEFAULT_STATE.viz;
  setOrDelete('vmin', String(v.vmin), v.vmin === dv.vmin);
  setOrDelete('vmax', String(v.vmax), v.vmax === dv.vmax);
  setOrDelete('gamma', String(v.gamma), v.gamma === dv.gamma);
  setOrDelete('format', v.format, v.format === dv.format);
  setOrDelete('colormap', v.colormap, v.colormap === dv.colormap);
  setOrDelete('colormap_reversed', v.colormapReversed ? '1' : '0', v.colormapReversed === dv.colormapReversed);

  // Superseded by the flat params above.
  params.delete('visualise_settings');

  return params;
}

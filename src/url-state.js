/**
 * Shareable app state lives in the URL's query string. The map's own
 * camera position already lives in the hash via MapLibre's `hash: true`,
 * so query params keep the two independent.
 *
 * Pure functions only — no `location`/`history` access here, so they're
 * plain to test. The caller (main.js) supplies the current search string
 * and applies the result / writes it back.
 */

/** Parses recognized params out of a query string (e.g. `location.search`). */
export function parseParams(search) {
  const params = new URLSearchParams(search);
  const out = {};

  const bbox = params.get('bbox');
  if (bbox) {
    const parts = bbox.split(',').map(Number);
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

  if (params.has('width')) {
    const width = Number(params.get('width'));
    if (Number.isFinite(width)) out.width = width;
  }

  const settings = params.get('visualise_settings');
  if (settings) {
    try {
      out.visualiseSettings = JSON.parse(settings);
    } catch {
      /* malformed/hand-edited param — ignore, fall back to defaults */
    }
  }

  return out;
}

/**
 * Builds the query params for the current shareable state, preserving any
 * existing params this app doesn't know about (`currentSearch`).
 */
export function buildParams(state, currentSearch) {
  const params = new URLSearchParams(currentSearch);

  if (state.drawnBbox) params.set('bbox', state.drawnBbox.map((n) => +n.toFixed(6)).join(','));
  else params.delete('bbox');

  params.set('datetime', `${state.dateFrom}/${state.dateTo}`);
  params.set('cloud_cover_max', String(state.cloudCoverMax));

  if (state.selectedDay) params.set('selected_datetime', state.selectedDay);
  else params.delete('selected_datetime');

  params.set('width', String(state.targetWidth));

  params.set('visualise_settings', JSON.stringify({
    preset: state.preset,
    vizMode: state.vizMode,
    bands: state.bands,
    singleBand: state.singleBand,
    indexBands: state.indexBands,
    viz: state.viz,
  }));

  return params;
}

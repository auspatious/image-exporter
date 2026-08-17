import { area } from '@turf/area';
import { bboxPolygon } from '@turf/bbox-polygon';
import { state, set, subscribe, HARD_LIMIT_KM2 } from './state.js';
import { createMap } from './map.js';
import { searchItems } from './stac.js';
import { addFootprintLayers, setFootprints, setSelected } from './footprint-layer.js';
import { createRectangleDraw } from './rectangle-draw.js';
import { groupByDay } from './mosaic.js';
import { streamComposite, renderRGBA, toBlob, toBlobURL, cropToValid, toGeoTIFFBlob } from './export.js';
import { outputSize } from './overviews.js';
import { placeName } from './geocode.js';
import { renderSearchPanel } from './ui/search-panel.js';
import { renderAreaPanel } from './ui/area-panel.js';
import { renderItemsPanel } from './ui/items-panel.js';
import { renderVisualisePanel } from './ui/visualise-panel.js';
import { renderExportPanel } from './ui/export-panel.js';
import { renderStatusPanel } from './ui/status-panel.js';
import { log } from './log.js';

/* ── Map + panels ─────────────────────────────────────────────────────── */

const map = createMap('map');
if (import.meta.env.DEV) {
  window.__map__ = map;
  window.__state__ = state;
  window.__set__ = set;
}

renderStatusPanel(document.getElementById('panel-status'));

// Surface otherwise-silent bugs in the Status panel instead of just the
// console, since that's the one place users can see when something broke.
window.addEventListener('error', (e) => log.err(`Unexpected error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => {
  log.err(`Unexpected error: ${e.reason?.message ?? e.reason}`);
});

renderSearchPanel(document.getElementById('panel-search'), { onChange: runSearch, map });
renderAreaPanel(document.getElementById('panel-area'), {
  onDraw: () => { log.info('Click-drag on the map to draw.'); draw.start(); },
  onClear: () => { draw.clear(); log.info('Cleared box.'); },
});
renderItemsPanel(document.getElementById('panel-items'), { onSelect: selectDay, map });
renderVisualisePanel(document.getElementById('panel-visualise'));
renderExportPanel(document.getElementById('panel-export'), { onDownload: download });

map.on('load', () => {
  addFootprintLayers(map);
  mapReady = true;
  log.ok('Ready. Draw a box, pick a day, tweak the look, download.');
  runSearch();
});
map.on('moveend', () => runSearch(true));

/* ── STAC search ──────────────────────────────────────────────────────── */

let mapReady = false;
let searchAbort = null;
let searchTimer = null;
async function runSearch(debounce = false) {
  if (debounce) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(false), 250);
    return;
  }
  if (!mapReady) return;
  if (map.getZoom() < state.minSearchZoom) {
    setFootprints(map, []);
    set({ items: [], itemsByDay: [] });
    return;
  }
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  try {
    const items = await searchItems({
      bbox,
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
      cloudCoverMax: state.cloudCoverMax,
      collection: state.collection,
      signal: searchAbort.signal,
    });
    const itemsByDay = groupByDay(items, state.drawnBbox);
    // If the selected day fell out of the new results (e.g. stricter cloud
    // filter), drop the selection and its preview.
    const dayGone = state.selectedDay && !itemsByDay.some((g) => g.day === state.selectedDay);
    set({ items, itemsByDay, ...(dayGone ? { selectedDay: null } : {}) });
    if (dayGone) invalidatePreview();
    syncFootprints();
    log.ok(`Search: ${items.length} item(s), ${itemsByDay.length} day(s).`);
  } catch (err) {
    if (err.name !== 'AbortError') log.err(`Search: ${err.message}`);
  }
}

/**
 * With a box drawn and a day picked, show only that day's footprints;
 * otherwise show everything from the current search.
 */
function syncFootprints() {
  const g = state.selectedDay ? state.itemsByDay.find((x) => x.day === state.selectedDay) : null;
  setSelected(map, g?.items ?? []);
  setFootprints(map, g && state.drawnBbox ? [] : state.items);
}

/* ── Rectangle draw ───────────────────────────────────────────────────── */

const draw = createRectangleDraw(map, ({ bbox }) => {
  if (!bbox) {
    set({ drawnBbox: null, drawnAreaKm2: 0, itemsByDay: groupByDay(state.items, null), selectedDay: null });
    syncFootprints();
    invalidatePreview();
    return;
  }
  const areaKm2 = area(bboxPolygon(bbox)) / 1_000_000;
  const itemsByDay = groupByDay(state.items, bbox);
  const stillValid = state.selectedDay && itemsByDay.some((g) => g.day === state.selectedDay);
  set({
    drawnBbox: bbox,
    drawnAreaKm2: areaKm2,
    itemsByDay,
    selectedDay: stillValid ? state.selectedDay : null,
  });
  syncFootprints();
  invalidatePreview();
  if (areaKm2 > HARD_LIMIT_KM2) log.err(`Box ${areaKm2.toFixed(0)} km² — over ${HARD_LIMIT_KM2} km² limit.`);
  else log.info(`Box: ${areaKm2.toFixed(1)} km²`);
  if (stillValid) startFetch();
});

/* ── Day selection ────────────────────────────────────────────────────── */

function selectDay(day) {
  set({ selectedDay: day });
  syncFootprints();
  invalidatePreview();
  if (!state.drawnBbox) {
    log.info(`Selected ${day}. Draw a rectangle to load a preview.`);
    return;
  }
  log.info(`Selected ${day}.`);
  startFetch();
}

/* ── Preview: fetch → cache → paint ───────────────────────────────────── */

let cache = null;         // { key, arrays }
let inFlightKey = null;   // string
let fetchAbort = null;    // AbortController for the in-flight COG reads
let overlayId = null;
let overlayURL = null;

// bands/singleBand/indexBands per vizMode → the fetch inputs for that mode.
function activeBands() {
  if (state.vizMode === 'single') return { band: state.singleBand };
  if (state.vizMode === 'index') return state.indexBands;
  return state.bands;
}

// Filename-friendly description of what's actually in the image, e.g.
// "rgb-red-green-blue", "single-nir", "index-nir-red".
function bandsSlug() {
  const b = activeBands();
  if (state.vizMode === 'single') return `single-${b.band}`;
  if (state.vizMode === 'index') return `index-${b.a}-${b.b}`;
  return `rgb-${b.r}-${b.g}-${b.b}`;
}

function sceneKey() {
  if (!state.drawnBbox || !state.selectedDay) return null;
  const g = state.itemsByDay.find((x) => x.day === state.selectedDay);
  if (!g) return null;
  // Item ids are part of the key so a cloud-filter change that adds or
  // removes scenes on the selected day triggers a re-fetch.
  const ids = g.items.map((i) => i.id).join(';');
  const bandsKey = Object.values(activeBands()).join(',');
  return `${state.selectedDay}|${state.drawnBbox.join(',')}|${state.targetWidth}|${state.vizMode}|${bandsKey}|${ids}`;
}

function invalidatePreview() {
  cache = null;
  inFlightKey = null;
  fetchAbort?.abort();
  fetchAbort = null;
  if (overlayId) {
    if (map.getLayer(overlayId)) map.removeLayer(overlayId);
    if (map.getSource(overlayId)) map.removeSource(overlayId);
    overlayId = null;
  }
  if (overlayURL) { URL.revokeObjectURL(overlayURL); overlayURL = null; }
}

async function startFetch() {
  const key = sceneKey();
  if (!key) return;
  if (state.drawnAreaKm2 > HARD_LIMIT_KM2) return;
  if (cache?.key === key) { schedulePaint(); return; }
  if (inFlightKey === key) return;

  const bbox = state.drawnBbox;
  const group = state.itemsByDay.find((g) => g.day === state.selectedDay);
  if (!group) return;

  const size = outputSize(bbox, state.targetWidth, state.nativeGSD);
  log.info(`Fetching ${group.items.length} item(s) → ${size.width}×${size.height} px`);

  inFlightKey = key;
  fetchAbort?.abort();
  fetchAbort = new AbortController();
  set({ loading: { active: true, done: 0, total: group.items.length, message: 'Preparing' } });
  showSpinner(true);

  try {
    await streamComposite({
      items: group.items,
      drawnBbox: bbox,
      mode: state.vizMode,
      bands: activeBands(),
      width: size.width,
      height: size.height,
      signal: fetchAbort.signal,
      onLog: log.info,
      onPartial: (arrays, itemIdx, itemCount) => {
        if (sceneKey() !== key) return;
        cache = { key, arrays };
        set({ loading: { active: true, done: itemIdx, total: itemCount, message: `Streaming ${itemIdx}/${itemCount}` } });
        schedulePaint();
      },
    });
    if (sceneKey() === key) {
      schedulePaint();
      log.ok('Preview ready.');
    }
  } catch (err) {
    log.err(`Preview failed: ${err.message}`);
  } finally {
    if (inFlightKey === key) inFlightKey = null;
    set({ loading: { active: false, done: 0, total: 0, message: '' } });
    showSpinner(false);
  }
}

/* ── Paint (rAF-throttled) ────────────────────────────────────────────── */

let paintScheduled = false;
function schedulePaint() {
  if (paintScheduled) return;
  paintScheduled = true;
  requestAnimationFrame(async () => {
    paintScheduled = false;
    if (!cache) return;
    const img = renderRGBA(cache.arrays, state.viz, state.vizMode);
    await paintOverlay(img, state.drawnBbox);
  });
}

async function paintOverlay(img, bbox) {
  const url = await toBlobURL(img, 'png');
  const [w, s, e, n] = bbox;
  const corners = [[w, n], [e, n], [e, s], [w, s]];
  if (overlayId && map.getSource(overlayId)) {
    // Update image and coordinates in one call — updateImage's image load is
    // async, so calling setCoordinates separately right after would apply
    // the new geometry to the still-old texture before the new pixels
    // arrive, then get redundantly recomputed once they do.
    map.getSource(overlayId).updateImage({ url, coordinates: corners });
  } else {
    overlayId = 'preview-overlay';
    map.addSource(overlayId, { type: 'image', url, coordinates: corners });
    // Insert below the drawn-box layers so the box outline always stays on
    // top of the preview image, not hidden underneath it.
    map.addLayer({ id: overlayId, type: 'raster', source: overlayId, paint: { 'raster-opacity': 1.0, 'raster-fade-duration': 0 } }, 'draw-box-fill');
  }
  const prev = overlayURL;
  overlayURL = url;
  if (prev) setTimeout(() => URL.revokeObjectURL(prev), 100);
}

/* ── Reactive glue: viz changes → repaint. size changes → refetch. ────── */

let lastViz = JSON.stringify(state.viz);
let lastSceneKey = sceneKey();
let refetchTimer = null;
subscribe((s) => {
  const viz = JSON.stringify(s.viz);
  if (viz !== lastViz) {
    lastViz = viz;
    if (cache?.key === sceneKey()) schedulePaint();
  }
  const key = sceneKey();
  if (key !== lastSceneKey) {
    lastSceneKey = key;
    if (key && cache?.key !== key && inFlightKey !== key) {
      // Debounce so dragging the size slider doesn't spawn many fetches.
      clearTimeout(refetchTimer);
      refetchTimer = setTimeout(startFetch, 300);
    }
  }
});

/* ── Download = save current preview data. No re-fetch. ───────────────── */

async function download() {
  if (!cache) return log.warn('No preview to save.');
  try {
    const fmt = state.viz.format;

    let blob, outWidth, outHeight;
    if (fmt === 'tif') {
      // TIF carries raw reflectance DN / index values, not the stretched
      // display pixels — no vmin/vmax/gamma/colormap baked in.
      ({ blob, width: outWidth, height: outHeight } = toGeoTIFFBlob(cache.arrays, state.drawnBbox, state.vizMode));
    } else {
      const rendered = renderRGBA(cache.arrays, state.viz, state.vizMode);
      const img = cropToValid(rendered, cache.arrays.mask);
      blob = await toBlob(img, fmt);
      outWidth = img.width;
      outHeight = img.height;
    }

    const [w, s, e, n] = state.drawnBbox;
    const place = await placeName((w + e) / 2, (s + n) / 2);
    const suffix = place ? `-${place}` : '';
    const ext = fmt === 'jpg' ? 'jpg' : fmt === 'tif' ? 'tif' : 'png';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cogniscient-${state.selectedDay}-${bandsSlug()}-${outWidth}px${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log.ok(`Saved ${outWidth}×${outHeight} px ${fmt.toUpperCase()}`);
  } catch (err) {
    log.err(`Save failed: ${err.message}`);
  }
}

/* ── Spinner over drawn box ───────────────────────────────────────────── */

const spinnerEl = document.getElementById('map-spinner');
function showSpinner(on) {
  if (!spinnerEl) return;
  spinnerEl.classList.toggle('on', on);
  if (on) positionSpinner();
}
function positionSpinner() {
  if (!spinnerEl || !state.drawnBbox) return;
  const [w, s, e, n] = state.drawnBbox;
  const p = map.project([(w + e) / 2, (s + n) / 2]);
  spinnerEl.style.left = `${p.x}px`;
  spinnerEl.style.top = `${p.y}px`;
}
map.on('render', () => { if (spinnerEl?.classList.contains('on')) positionSpinner(); });

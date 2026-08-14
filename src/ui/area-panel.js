import { state, set, subscribe, HARD_LIMIT_KM2 } from '../state.js';
import { nativePixelWidth, outputSize } from '../overviews.js';
import { estimateBytes } from '../size-estimate.js';

const MIN_WIDTH = 256;
const STEP = 128;

let lastPaintKey = null;

export function renderAreaPanel(el, { onDraw, onClear }) {
  subscribe(() => paint(el, onDraw, onClear));
}

function tierClass(tier) {
  return tier === 'small' ? 'ok' : tier === 'medium' ? 'warn' : 'danger';
}
function tierLabel(tier) {
  return tier === 'too-large' ? 'too large' : tier;
}
function sizeLabel(s) {
  const mPerPx = s.widthMeters / s.width;
  return `${s.width} × ${s.height} px at ${mPerPx.toFixed(1)} m/px`;
}

function paint(el, onDraw, onClear) {
  const bbox = state.drawnBbox;

  if (!bbox) {
    if (lastPaintKey === 'empty') return;
    lastPaintKey = 'empty';
    el.innerHTML = `
      <h2>Area</h2>
      <button id="draw-btn">Draw rectangle</button>
      <p class="hint">Click, then click-drag on the map to pick your area.</p>
    `;
    el.querySelector('#draw-btn').addEventListener('click', onDraw);
    return;
  }

  const nativeMax = nativePixelWidth(bbox, state.nativeGSD);
  const sliderMax = Math.max(MIN_WIDTH, Math.round(nativeMax / STEP) * STEP);
  const currentWidth = Math.min(state.targetWidth, sliderMax);
  const overLimit = state.drawnAreaKm2 > HARD_LIMIT_KM2;

  // Clamp state to slider range if needed (one clean write).
  if (state.targetWidth !== currentWidth) {
    set({ targetWidth: currentWidth });
    return; // subscribe will re-invoke paint with the clamped value
  }

  const itemCount = state.itemsByDay.find((g) => g.day === state.selectedDay)?.items.length ?? 1;
  const sizeNow = outputSize(bbox, currentWidth, state.nativeGSD);
  const estNow = estimateBytes({ width: sizeNow.width, height: sizeNow.height, itemCount });

  // Skip DOM rebuild when nothing this panel shows has changed — otherwise
  // unrelated state emits (e.g. loading progress) yank the slider mid-drag.
  const paintKey = `${bbox.join(',')}|${currentWidth}|${itemCount}|${overLimit}`;
  if (paintKey === lastPaintKey) return;
  lastPaintKey = paintKey;

  el.innerHTML = `
    <h2>Area <span class="badge">${overLimit ? 'too large' : 'ready'}</span></h2>
    <div class="row">
      <button id="draw-btn">Redraw</button>
      <button id="clear-btn" class="secondary">Clear</button>
    </div>
    <p class="hint">${state.drawnAreaKm2.toFixed(1)} km² · box native max <b>${nativeMax} px</b> at ${state.nativeGSD} m/px.</p>
    <div class="field">
      <label>Output size <span id="tw-val">${sizeLabel(sizeNow)}</span></label>
      <input id="tw" type="range" min="${MIN_WIDTH}" max="${sliderMax}" step="${STEP}" value="${currentWidth}" />
    </div>
    <div id="tw-badge"><span class="badge ${tierClass(estNow.tier)}">fetches ~${estNow.megabytes.toFixed(0)} MB · ${tierLabel(estNow.tier)}</span></div>
    ${overLimit ? `<p class="hint" style="color:var(--danger)">Exceeds ${HARD_LIMIT_KM2.toLocaleString()} km² hard limit — redraw smaller.</p>` : ''}
  `;

  el.querySelector('#draw-btn').addEventListener('click', onDraw);
  el.querySelector('#clear-btn').addEventListener('click', onClear);

  const tw = el.querySelector('#tw');
  const twVal = el.querySelector('#tw-val');
  const twBadge = el.querySelector('#tw-badge');

  // Live estimate while dragging (no state write, no refetch).
  tw.addEventListener('input', (e) => {
    const w = Number(e.target.value);
    const s = outputSize(bbox, w, state.nativeGSD);
    const est = estimateBytes({ width: s.width, height: s.height, itemCount });
    twVal.textContent = sizeLabel(s);
    twBadge.innerHTML = `<span class="badge ${tierClass(est.tier)}">fetches ~${est.megabytes.toFixed(0)} MB · ${tierLabel(est.tier)}</span>`;
  });

  // Commit on release → triggers refetch.
  tw.addEventListener('change', (e) => {
    set({ targetWidth: Number(e.target.value) });
  });
}

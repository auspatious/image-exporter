import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import { state, set } from '../state.js';

export function renderSearchPanel(el, { onChange, map }) {
  el.innerHTML = `
    <h2>Search</h2>
    <div class="field">
      <label for="date-range">Date range</label>
      <input id="date-range" type="text" readonly placeholder="Pick a range…" />
    </div>
    <div class="field">
      <label for="cloud">Max cloud cover: <span id="cloud-val">${state.cloudCoverMax}%</span></label>
      <input id="cloud" type="range" min="0" max="100" step="1" value="${state.cloudCoverMax}" />
    </div>
    <p class="hint" id="search-hint"></p>
  `;

  // Single date-range picker — one input, one dialog.
  flatpickr(el.querySelector('#date-range'), {
    mode: 'range',
    dateFormat: 'Y-m-d',
    defaultDate: [state.dateFrom, state.dateTo],
    maxDate: 'today',
    onChange: (dates) => {
      if (dates.length !== 2) return;
      const [from, to] = dates.map((d) => d.toISOString().slice(0, 10));
      if (from === state.dateFrom && to === state.dateTo) return;
      set({ dateFrom: from, dateTo: to });
      onChange();
    },
  });

  const cloud = el.querySelector('#cloud');
  const cloudVal = el.querySelector('#cloud-val');
  cloud.addEventListener('input', (e) => {
    cloudVal.textContent = `${e.target.value}%`;
  });
  cloud.addEventListener('change', (e) => {
    set({ cloudCoverMax: Number(e.target.value) });
    onChange();
  });

  // Dynamic hint tied to current zoom level. Updated on every map move.
  const hint = el.querySelector('#search-hint');
  const updateHint = () => {
    const zoomedIn = map.getZoom() >= state.minSearchZoom;
    hint.textContent = zoomedIn
      ? 'Footprints refresh as you pan and zoom.'
      : 'Zoom in closer to see scene footprints.';
  };
  updateHint();
  map.on('move', updateHint);
}

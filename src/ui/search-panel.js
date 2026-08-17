import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import { state, set } from '../state.js';
import { searchPlaces } from '../geocode.js';

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderSearchPanel(el, { onChange, map }) {
  el.innerHTML = `
    <h2>Search</h2>
    <div class="field place-field">
      <label for="place">Jump to a place</label>
      <div class="input-with-clear">
        <input id="place" type="text" placeholder="Search a place…" autocomplete="off" />
        <button type="button" id="place-clear" class="clear-btn" aria-label="Clear" title="Clear">×</button>
      </div>
      <ul id="place-results"></ul>
    </div>
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

  // Debounced autocomplete: type → search Nominatim → click, or arrow keys
  // + enter, to pan/zoom the map there (moveend already re-triggers the
  // STAC search).
  const placeInput = el.querySelector('#place');
  const placeResults = el.querySelector('#place-results');
  const placeClear = el.querySelector('#place-clear');
  let placeTimer = null;
  let placeAbort = null;
  let results = [];
  let activeIndex = -1;

  function clearPlace() {
    placeAbort?.abort();
    placeInput.value = '';
    results = [];
    activeIndex = -1;
    placeResults.innerHTML = '';
    placeInput.focus();
  }
  placeClear.addEventListener('click', clearPlace);

  function renderResults() {
    placeResults.innerHTML = results
      .map((r, i) => `<li data-i="${i}" class="${i === activeIndex ? 'active' : ''}">${escapeHtml(r.label)}</li>`)
      .join('');
    placeResults.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => chooseResult(Number(li.getAttribute('data-i'))));
    });
  }

  function chooseResult(i) {
    const r = results[i];
    if (!r) return;
    map.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: 40, maxZoom: 16 });
    placeInput.value = r.label;
    results = [];
    activeIndex = -1;
    placeResults.innerHTML = '';
  }

  placeInput.addEventListener('input', (e) => {
    clearTimeout(placeTimer);
    const query = e.target.value;
    activeIndex = -1;
    if (!query.trim()) { results = []; placeResults.innerHTML = ''; return; }
    placeTimer = setTimeout(async () => {
      placeAbort?.abort();
      placeAbort = new AbortController();
      results = await searchPlaces(query, placeAbort.signal);
      activeIndex = -1;
      renderResults();
    }, 300);
  });

  placeInput.addEventListener('keydown', (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % results.length;
      renderResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + results.length) % results.length;
      renderResults();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      chooseResult(activeIndex);
    }
  });

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

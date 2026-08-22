import { state, setViz, subscribe } from '../state.js';

export function renderExportPanel(el, { onDownload, onDownloadStac }) {
  let lastKey = null;
  subscribe(() => {
    const reason = !state.drawnBbox
      ? 'Draw a box first'
      : !state.selectedDay
        ? 'Choose a date first'
        : state.loading.active
          ? 'Preview is still loading…'
          : '';
    const canDl = !reason;

    const key = `${reason}|${state.viz.format}`;
    if (key === lastKey) return;
    lastKey = key;

    el.innerHTML = `
      <h2>Save</h2>
      <div class="row">
        <select id="fmt">
          <option value="png" ${state.viz.format === 'png' ? 'selected' : ''}>PNG</option>
          <option value="jpg" ${state.viz.format === 'jpg' ? 'selected' : ''}>JPG</option>
          <option value="tif" ${state.viz.format === 'tif' ? 'selected' : ''}>GeoTIFF</option>
        </select>
        <button id="dl-btn" ${canDl ? '' : 'disabled'} title="${reason || 'Save the current preview'}">Download</button>
        <button id="dl-stac-btn" ${canDl ? '' : 'disabled'} title="${reason || 'Save a STAC document describing how this export was produced'}">Metadata</button>
      </div>
      <p class="hint">${reason || 'Save the current preview.'}</p>
    `;
    el.querySelector('#fmt').addEventListener('change', (e) => setViz({ format: e.target.value }));
    el.querySelector('#dl-btn').addEventListener('click', onDownload);
    el.querySelector('#dl-stac-btn').addEventListener('click', onDownloadStac);
  });
}

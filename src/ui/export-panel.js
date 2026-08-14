import { state, setViz, subscribe } from '../state.js';

export function renderExportPanel(el, { onDownload }) {
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
        </select>
        <button id="dl-btn" ${canDl ? '' : 'disabled'} title="${reason || 'Save the current preview'}">Download</button>
      </div>
      <p class="hint">${reason || 'Saves the current preview — same pixels, no re-download.'}</p>
    `;
    el.querySelector('#fmt').addEventListener('change', (e) => setViz({ format: e.target.value }));
    el.querySelector('#dl-btn').addEventListener('click', onDownload);
  });
}

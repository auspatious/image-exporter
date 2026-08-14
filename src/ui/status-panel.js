import { attachStatus } from '../log.js';

export function renderStatusPanel(el) {
  el.innerHTML = `
    <h2>Status</h2>
    <div id="status-log" role="log"></div>
  `;
  attachStatus(el.querySelector('#status-log'));
}

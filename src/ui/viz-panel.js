import { state, setViz, subscribe } from '../state.js';

const KEYS = ['vmin', 'vmax', 'gamma'];

export function renderVizPanel(el) {
  el.innerHTML = `
    <h2>Look</h2>
    <p class="hint">Sliders re-tone the cached pixels instantly — no re-download.</p>
    ${field('vmin', 0, 15000, 50, state.viz.vmin)}
    ${field('vmax', 0, 15000, 50, state.viz.vmax)}
    ${field('gamma', 0.05, 2, 0.05, state.viz.gamma)}
  `;

  for (const key of KEYS) {
    const input = el.querySelector(`[data-input="${key}"]`);
    const label = el.querySelector(`[data-val="${key}"]`);
    input.addEventListener('input', (e) => {
      let v = Number(e.target.value);
      // Keep vmin < vmax — an inverted range silently breaks the stretch.
      if (key === 'vmin') v = Math.min(v, state.viz.vmax - 1);
      if (key === 'vmax') v = Math.max(v, state.viz.vmin + 1);
      if (v !== Number(e.target.value)) input.value = String(v);
      setViz({ [key]: v });
      label.textContent = format(key, v);
    });
  }

  // Sync from outside (auto-stretch on first partial). Don't overwrite a
  // focused slider — that would tug it out of the user's hand.
  let last = { ...state.viz };
  subscribe((s) => {
    for (const key of KEYS) {
      if (s.viz[key] === last[key]) continue;
      last[key] = s.viz[key];
      const input = el.querySelector(`[data-input="${key}"]`);
      const label = el.querySelector(`[data-val="${key}"]`);
      if (input && document.activeElement !== input) input.value = String(s.viz[key]);
      if (label) label.textContent = format(key, s.viz[key]);
    }
  });
}

function field(key, min, max, step, value) {
  return `
    <div class="field">
      <label>${key} <span data-val="${key}">${format(key, value)}</span></label>
      <input data-input="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>`;
}

function format(key, v) {
  if (key === 'gamma') return v.toFixed(2);
  return String(Math.round(v));
}

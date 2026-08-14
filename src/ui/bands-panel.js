import { state, set } from '../state.js';

// Sentinel-2 L2A bands as exposed by Earth Search asset keys.
const BANDS = [
  { key: 'coastal', label: 'Coastal' },
  { key: 'blue', label: 'Blue' },
  { key: 'green', label: 'Green' },
  { key: 'red', label: 'Red' },
  { key: 'rededge1', label: 'RedEdge1' },
  { key: 'rededge2', label: 'RedEdge2' },
  { key: 'rededge3', label: 'RedEdge3' },
  { key: 'nir', label: 'NIR' },
  { key: 'nir08', label: 'NIR narrow' },
  { key: 'nir09', label: 'WaterVap' },
  { key: 'swir16', label: 'SWIR1' },
  { key: 'swir22', label: 'SWIR2' },
];

const CHANNELS = ['r', 'g', 'b'];

export function renderBandsPanel(el) {
  el.innerHTML = `
    <h2>Bands</h2>
    <div class="row">
    ${CHANNELS.map((ch) => `
      <div class="field">
        <label for="band-${ch}">${ch.toUpperCase()}</label>
        <select id="band-${ch}">
          ${BANDS.map((b) => `<option value="${b.key}" ${state.bands[ch] === b.key ? 'selected' : ''}>${b.label}</option>`).join('')}
        </select>
      </div>`).join('')}
    </div>
  `;

  for (const ch of CHANNELS) {
    el.querySelector(`#band-${ch}`).addEventListener('change', (e) => {
      set({ bands: { ...state.bands, [ch]: e.target.value } });
    });
  }
}

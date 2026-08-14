import { state, subscribe } from '../state.js';

export function renderItemsPanel(el, { onSelect }) {
  subscribe(() => {
    const bbox = state.drawnBbox;
    const groups = state.itemsByDay;
    const selected = state.selectedDay;
    const loading = state.loading;

    let body;
    if (groups.length === 0) {
      body = bbox
        ? `<p class="hint">No Sentinel-2 acquisitions match this box. Widen the dates or raise cloud cover.</p>`
        : `<p class="hint">Zoom into an area to see available days.</p>`;
    } else {
      body = `<ul id="items-list">${groups
        .map((g) => {
          const isSel = selected === g.day ? 'selected' : '';
          const cloud = g.meanCloud == null ? '—' : `${g.meanCloud.toFixed(0)}% cloud`;
          const cover = g.coverage == null ? '' : ` · ${g.coverage.toFixed(0)}% coverage`;
          const mosaicNote = g.items.length > 1 ? ` · mosaic of ${g.items.length}` : '';
          return `<li class="${isSel}" data-day="${g.day}"><span>${g.day}<br><span class="hint">${cloud}${cover}${mosaicNote}</span></span><span class="badge">${g.items.length}</span></li>`;
        })
        .join('')}</ul>`;
    }

    let progressHtml = '';
    if (loading.active) {
      const pct = loading.total > 0 ? Math.min(100, (loading.done / loading.total) * 100) : 0;
      const indeterminate = loading.done === 0;
      progressHtml = `
        <div class="progress">
          <div>${loading.message || 'Loading…'}${loading.total ? ` (${loading.done}/${loading.total})` : ''}</div>
          <div class="bar${indeterminate ? ' indeterminate' : ''}"><span style="${indeterminate ? '' : `transform: scaleX(${pct / 100})`}"></span></div>
        </div>`;
    }

    const badge = groups.length === 0
      ? 'no days'
      : bbox
        ? `${groups.length} day(s) in box`
        : `${groups.length} day(s) in view`;

    el.innerHTML = `<h2>Days <span class="badge">${badge}</span></h2>${progressHtml}${body}`;

    el.querySelectorAll('#items-list li').forEach((li) => {
      li.addEventListener('click', () => onSelect?.(li.getAttribute('data-day')));
    });
  });
}

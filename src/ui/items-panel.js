import { state, subscribe } from '../state.js';
import { setHoverItem } from '../footprint-layer.js';

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Opens the item's canonical STAC JSON (its "self" link) in a new tab. Falls
// back to a blob of the item as fetched, on the rare item with no self link.
function openItemJSON(item) {
  const selfHref = item.links?.find((l) => l.rel === 'self')?.href;
  if (selfHref) {
    window.open(selfHref, '_blank', 'noopener');
    return;
  }
  const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function renderItemsPanel(el, { onSelect, onRedraw, isRedrawAvailable, map }) {
  // Which days have their per-scene dropdown open. UI-only state — not
  // part of the app store, so it survives repaints but not page reload.
  const expandedDays = new Set();

  function paint() {
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
          const day = escapeHtml(g.day);
          const cloud = g.meanCloud == null ? '—' : `${g.meanCloud.toFixed(0)}% cloud`;
          const cover = g.coverage == null ? '' : ` · ${g.coverage.toFixed(0)}% coverage`;
          const expanded = expandedDays.has(g.day);
          const itemRows = g.items
            .map((it, idx) => {
              const itCloud = typeof it.properties?.['eo:cloud_cover'] === 'number'
                ? `${it.properties['eo:cloud_cover'].toFixed(0)}%`
                : '—';
              // Every scene found for the day is listed, not just ones
              // intersecting the box — dim the ones that don't (found
              // nearby, not used in the mosaic).
              const outside = g.intersectingIds && !g.intersectingIds.has(it.id);
              return `<li class="stac-item-row${outside ? ' outside-box' : ''}" data-idx="${idx}" title="${outside ? 'Outside the drawn box, not used in the mosaic. ' : ''}Hover to highlight, click to open the original STAC item">
                <span>${escapeHtml(it.id)}</span>
                <span class="hint">${itCloud} cloud</span>
              </li>`;
            })
            .join('');

          // Fetch progress overlays the bottom edge of the day's own row
          // (absolutely positioned — see .day-progress in style.css), not
          // a separate block that adds height and bumps every row down.
          let progressHtml = '';
          if (loading.active && g.day === selected) {
            const pct = loading.total > 0 ? Math.min(100, (loading.done / loading.total) * 100) : 0;
            const indeterminate = loading.done === 0;
            progressHtml = `
              <div class="day-progress" title="${escapeHtml(loading.message || 'Loading…')}">
                <div class="bar${indeterminate ? ' indeterminate' : ''}"><span style="${indeterminate ? '' : `transform: scaleX(${pct / 100})`}"></span></div>
              </div>`;
          }

          // Panning can add/remove scenes for the selected day without
          // touching the rendered preview — offer a manual redraw instead
          // of jumping the image out from under the user.
          const redrawHtml = g.day === selected && !loading.active && isRedrawAvailable?.()
            ? `<button type="button" class="redraw-btn" data-redraw title="More/different scenes are now available for this day">Redraw</button>`
            : '';

          return `<li class="${isSel}" data-day="${day}">
            <div class="day-row">
              <span class="day-main" data-select>${day}<br><span class="hint">${cloud}${cover}</span></span>
              ${redrawHtml}
              <button type="button" class="expand-btn" data-toggle aria-expanded="${expanded}" title="${expanded ? 'Hide' : 'Show'} individual scenes">${g.items.length} ${expanded ? '▾' : '▸'}</button>
              ${progressHtml}
            </div>
            ${expanded ? `<ul class="stac-item-list">${itemRows}</ul>` : ''}
          </li>`;
        })
        .join('')}</ul>`;
    }

    const badge = groups.length === 0
      ? 'no days'
      : bbox
        ? `${groups.length} day(s) in box`
        : `${groups.length} day(s) in view`;

    // Re-rendering swaps in a fresh #items-list, which would otherwise reset
    // scroll to the top every time a dropdown is toggled — preserve it.
    const scrollTop = el.querySelector('#items-list')?.scrollTop ?? 0;
    el.innerHTML = `<h2>Days <span class="badge">${badge}</span></h2>${body}`;
    const newList = el.querySelector('#items-list');
    if (newList) newList.scrollTop = scrollTop;

    el.querySelectorAll('#items-list > li').forEach((li) => {
      const day = li.getAttribute('data-day');
      const group = groups.find((g) => g.day === day);
      if (!group) return;

      li.querySelector('.day-main')?.addEventListener('click', () => onSelect?.(day));

      li.querySelector('.redraw-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onRedraw?.();
      });

      const toggleBtn = li.querySelector('.expand-btn');
      toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expandedDays.has(day)) expandedDays.delete(day);
        else expandedDays.add(day);
        paint();
      });

      li.querySelectorAll('.stac-item-row').forEach((row) => {
        const item = group.items[Number(row.getAttribute('data-idx'))];
        if (!item) return;
        row.addEventListener('mouseenter', () => setHoverItem(map, item));
        row.addEventListener('mouseleave', () => setHoverItem(map, null));
        row.addEventListener('click', () => openItemJSON(item));
      });
    });
  }

  subscribe(paint);
}

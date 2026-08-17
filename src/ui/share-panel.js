import { log } from '../log.js';

// Static — the URL is already kept live by main.js's debounced sync to
// history, so there's nothing to react to here; just read location.href
// at click time.
export function renderSharePanel(el) {
  el.innerHTML = `
    <h2>Share</h2>
    <button id="share-btn" title="Copy share link">Share</button>
  `;
  const btn = el.querySelector('#share-btn');
  const label = btn.textContent;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Copied!';
      log.ok('Share link copied to clipboard.');
      setTimeout(() => { btn.textContent = label; }, 1500);
    } catch (err) {
      log.err(`Couldn't copy link: ${err.message}`);
    }
  });
}

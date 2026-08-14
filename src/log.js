/**
 * Small logging helper wired into the #status-log panel.
 */

let el = null;

export function attachStatus(target) {
  el = target;
}

function push(cls, msg) {
  if (!el) {
    console.log(`[${cls}]`, msg);
    return;
  }
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

export const log = {
  info: (m) => push('info', m),
  ok: (m) => push('ok', m),
  warn: (m) => push('warn', m),
  err: (m) => push('err', m),
};

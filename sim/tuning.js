// Backtick (`) panel: live FPS, render scale, and will-drive / break tuning. Values persist in localStorage.
import { WILL } from './willdrive.js';
import { BREAK } from './breakables.js';
import { PERF } from './perf.js';
import { settings, save } from '../settings.js';

const KEY = 'lantern.tuning.v1';
const SLIDERS = [
  [WILL, 'stiffness', 5, 120], [WILL, 'damping', 0.3, 2], [WILL, 'carryAccel', 10, 200], [WILL, 'pushForce', 0, 150000],
  [WILL, 'punchForce', 0, 400000], [WILL, 'angStiffness', 5, 120], [BREAK, 'crate', 1000, 40000], [BREAK, 'rail', 1000, 40000],
];
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved) SLIDERS.forEach(([o, k]) => { if (saved[k] != null) o[k] = saved[k]; }); } catch {}

const el = document.createElement('div');
el.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99;background:rgba(0,10,4,.82);color:#9f9;font:12px ui-monospace,monospace;padding:10px;border:1px solid #3dff6e55;border-radius:8px;display:none;width:280px';
const fps = document.createElement('div'); el.appendChild(fps);
const auto = document.createElement('label'); auto.innerHTML = `<input type="checkbox"${PERF.enabled ? ' checked' : ''}> auto quality`; auto.firstChild.onchange = (e) => { PERF.enabled = settings.autoQuality = e.target.checked; save(); }; el.appendChild(auto);
for (const [o, k, min, max] of SLIDERS) {
  const row = document.createElement('div'); row.style.marginTop = '6px';
  const v = document.createElement('span'); v.textContent = ` ${o[k]}`;
  const s = Object.assign(document.createElement('input'), { type: 'range', min, max, step: (max - min) / 200, value: o[k] }); s.style.width = '100%';
  s.oninput = () => { o[k] = +s.value; v.textContent = ` ${(+s.value).toFixed(2)}`; persist(); };
  row.append(k, v, s); el.appendChild(row);
}
document.body.appendChild(el);
function persist() { const d = {}; SLIDERS.forEach(([o, k]) => (d[k] = o[k])); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
addEventListener('keydown', (e) => { if (e.code === 'Backquote') el.style.display = el.style.display === 'none' ? 'block' : 'none'; });
export function updateTuning() { if (el.style.display !== 'none') fps.textContent = `${PERF.fps.toFixed(0)} fps · scale ${PERF.scale.toFixed(2)}`; }

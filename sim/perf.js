// Auto quality: watches frame time and trades resolution for smoothness before it ever stutters.
// Steps the render scale between 0.6x and the preset's pixel ratio. Shows FPS with the backtick panel.
import { renderer, _dbg } from '../gfx.js';
import { settings, save } from '../settings.js';

export const PERF = { target: 1 / 58, slack: 1 / 75, min: 0.6, step: 0.1, fps: 60, scale: 1, enabled: settings.autoQuality !== false };
let ema = 1 / 60, bad = 0, good = 0, maxRatio = null;

export function updatePerf(dt) {
  if (maxRatio === null) maxRatio = renderer.getPixelRatio();
  ema += (dt - ema) * 0.05; PERF.fps = 1 / ema;
  if (!PERF.enabled) return;
  if (ema > PERF.target) { bad += dt; good = 0; } else if (ema < PERF.slack) { good += dt; bad = 0; } else { bad = good = 0; }
  const r = renderer.getPixelRatio();
  if (bad > 1.0 && r > PERF.min + 1e-3) set(Math.max(PERF.min, r - PERF.step));
  else if (good > 4.0 && r < maxRatio - 1e-3) set(Math.min(maxRatio, r + PERF.step));
}
function set(r) {
  bad = good = 0;
  renderer.setPixelRatio(r);
  const c = _dbg.composer; c.setPixelRatio(r); c.setSize(innerWidth, innerHeight);
  PERF.scale = r;
}
// call after applyQuality() so the governor's ceiling follows the chosen preset
export function resetPerf() { maxRatio = null; bad = good = 0; }

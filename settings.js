// Settings, persisted in localStorage (per-browser; game works without it).
const KEY = 'lantern.v1';
const DEFAULT_SETTINGS = {
  master: 0.9, music: 0.6, haptics: 1, gyroSens: 1,
  invGyroX: false, invGyroY: false, invTilt: false,
  gyroLook: false, // user: gyro camera felt unstable → sticks only. Gyro kept for future fine-aim.
  hapticPair: '23', micGate: 0.04, quality: 'medium',
  touchInvY: false, // flip if what you draw comes out upside down
  drawScale: 2.2,   // metres per touchpad half-height: a full-pad drawing ≈ 8 m wide
  willDrive: true,  // force-capped spring steering (sim/willdrive.js); false = old velocity steer
  autoQuality: true, // sim/perf.js render-scale governor
};
let data = { settings: { ...DEFAULT_SETTINGS } };
try {
  const raw = JSON.parse(localStorage.getItem(KEY));
  if (raw) data = { settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
} catch {}

export const settings = data.settings;
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

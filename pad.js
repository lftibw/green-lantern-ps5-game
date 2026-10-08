// DualSense I/O layer: input snapshot, every output, gyro aim, and the audio/haptics/mic pipeline.
import { Dualsense, TriggerEffect, MuteLedMode, AudioOutput, InputId, findDualsenseAudioDevices } from 'dualsense-ts';
import { settings } from './settings.js';
import { Vector3 } from 'three';

export { TriggerEffect, MuteLedMode };

// ---------- Feature Dex ----------
export const FEATURES = {
  sticks: 'Sticks + face buttons (walk, fly, look)',
  touchDraw: 'Touchpad drawing (imagine a construct)',
  trigFeedback: 'R2 Feedback (push with your will)',
  trigWeapon: 'R2 Weapon (fist punch snap)',
  haptics: 'Voice-coil HD haptics',
  rumble: 'Classic rumble',
  speaker: 'Controller speaker (ring + Hal voice)',
  mic: 'Microphone (speak the oath)',
  muteLed: 'Mute LED (lantern nearby)',
  gyro: 'Gyroscope (fine aim)',
  thrust: 'Accelerometer thrust (throw)',
  lightbar: 'Lightbar (ring glow)',
  playerLeds: 'Player LEDs (ring charge)',
  battery: 'Battery level',
  headphone: 'Headphone jack',
  audio3d: '3D audio',
};
export const used = new Set();
let onUse = () => {};
export const setOnUse = (fn) => (onUse = fn);
export const mark = (f) => { if (!used.has(f)) { used.add(f); onUse(f); } };

// ---------- state ----------
export const pad = { ds: null, connected: false, wireless: false, hapticsHD: false, micOn: false, speakerOn: false, in: {}, prev: {} };
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Tab') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const kbAnalog = { l2: 0, r2: 0, t: 0 };

// ---------- connect ----------
// Must be called from a click: WebHID + mic permission both need a user gesture.
export async function connect() {
  const ds = new Dualsense();
  pad.ds = ds;
  await ds.hid.provider.getRequest()();
  await waitFor(() => ds.connection.state, 5000);
  pad.connected = ds.connection.state;
  pad.wireless = ds.wireless;
  await initAudio(true);
  if (pad.connected) {
    ds.audio.setOutput(AudioOutput.Speaker);
    ds.audio.setSpeakerVolume(0.9);
    ds.audio.setMicrophoneVolume(1);
    ds.orientation.reset();
    ds.hid.register(onReport);
  }
  return pad.connected;
}
const waitFor = (fn, ms) => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => (fn() || performance.now() - t0 > ms ? res() : setTimeout(tick, 50));
  tick();
});

// ---------- gyro aim ----------
// Integrates raw gyro rates per HID report (not per frame) in "player space":
// yaw = rotation around gravity, so it feels the same however the pad is held.
const GYRO_RAD = (2000 * Math.PI) / 180; // normalised ±1 == ±2000 dps
const gyro = { yaw: 0, pitch: 0, ts: 0, g: [0, 1, 0] };
function onReport(st) {
  const ts = st[InputId.SensorTimestamp];
  if (gyro.ts && ts) {
    const dt = (ts >= gyro.ts ? ts - gyro.ts : 0xffffffff - gyro.ts + ts + 1) / 1e6;
    if (dt > 0 && dt < 0.1) integrateGyro(st, dt);
  }
  gyro.ts = ts;
}
function integrateGyro(st, dt) {
  const gx = st[InputId.GyroX] * GYRO_RAD, gy = st[InputId.GyroY] * GYRO_RAD, gz = st[InputId.GyroZ] * GYRO_RAD;
  const a = [st[InputId.AccelX], st[InputId.AccelY], st[InputId.AccelZ]];
  const g = gyro.g;
  for (let k = 0; k < 3; k++) g[k] += (a[k] - g[k]) * 0.02; // low-pass gravity
  const gl = Math.hypot(...g) || 1;
  const gY = g[1] / gl, gZ = g[2] / gl;
  const worldYaw = (gy * gY + gz * gZ) * Math.sign(gY || 1);
  let yaw = Math.sign(worldYaw) * Math.min(Math.abs(worldYaw) * 1.41, Math.hypot(gy, gz));
  // soft deadzone kills resting drift without a "sticky" feel (~1.5°/s)
  const soft = (v) => { const dz = 0.026, m = Math.abs(v); return m < dz ? v * (m / dz) : v; };
  gyro.yaw += soft(yaw) * dt;
  gyro.pitch += soft(gx) * dt;
  // thrust = sharp linear acceleration (raw accel minus low-passed gravity), in units of |g| so scale-free
  const lin = Math.hypot(a[0] - g[0], a[1] - g[1], a[2] - g[2]) / gl;
  thrustCd -= dt;
  if (lin > THRUST_G && thrustCd <= 0) { thrustHit = true; thrustCd = 0.6; }
}
// ponytail: magnitude-only jab detector (any direction). Raise THRUST_G if normal play triggers it.
const THRUST_G = 1.3;
let thrustHit = false, thrustCd = 0;
export function takeThrust() { const t = thrustHit; thrustHit = false; if (t) mark('thrust'); return t; }
// radians turned since last call, already signed for the game (+yaw = turn left, +pitch = aim up)
export function takeGyro() {
  const s = settings.gyroSens;
  const r = { yaw: -gyro.yaw * s * (settings.invGyroX ? -1 : 1), pitch: gyro.pitch * s * (settings.invGyroY ? -1 : 1) };
  gyro.yaw = gyro.pitch = 0;
  if (Math.abs(r.yaw) + Math.abs(r.pitch) > 0.002) mark('gyro');
  return r;
}

// ---------- input snapshot ----------
export function read() {
  pad.prev = pad.in;
  const ds = pad.connected ? pad.ds : null;
  const k = (c) => keys.has(c);
  const kx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
  const ky = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
  const now = performance.now(), kdt = Math.min(0.1, (now - (kbAnalog.t || now)) / 1000); kbAnalog.t = now; // time-based, not per-frame
  kbAnalog.l2 = Math.max(0, Math.min(1, kbAnalog.l2 + (k('KeyQ') ? 2.4 : -4.8) * kdt));
  kbAnalog.r2 = Math.max(0, Math.min(1, kbAnalog.r2 + (k('KeyE') ? 2.4 : -12) * kdt));

  const i = {
    mx: kx, my: ky,
    cx: (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0),
    cy: (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0),
    cross: k('Space'), circle: k('KeyX'), square: k('KeyJ'), tri: k('KeyY'),
    l2: kbAnalog.l2, r2: kbAnalog.r2,
    l1: k('KeyZ'), r1: k('KeyC'), l3: k('ShiftLeft'), r3: k('KeyR'),
    options: k('Escape'), create: false, ps: false, touchClick: k('Tab'),
    touch: null, speak: k('KeyT') || k('KeyV') ? 0.8 : mic.level, // T = oath, V = voice surge (keyboard stand-ins for the mic)
  };
  if (!ds) return (pad.in = i);

  const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
  i.mx = dz(ds.left.analog.x.state) || i.mx;
  i.my = dz(ds.left.analog.y.state) || i.my;
  i.cx = dz(ds.right.analog.x.state) || i.cx;
  i.cy = dz(ds.right.analog.y.state) || i.cy;
  i.cross ||= ds.cross.state; i.circle ||= ds.circle.state; i.square ||= ds.square.state; i.tri ||= ds.triangle.state;
  i.l2 = Math.max(i.l2, ds.left.trigger.pressure);
  i.r2 = Math.max(i.r2, ds.right.trigger.pressure);
  i.l1 ||= ds.left.bumper.state; i.r1 ||= ds.right.bumper.state;
  i.l3 ||= ds.left.analog.button.state; i.r3 ||= ds.right.analog.button.state;
  i.options ||= ds.options.state; i.create = ds.create.state; i.ps = ds.ps.state;
  i.touchClick ||= ds.touchpad.button.state;
  i.muted = ds.mute.status.state;
  i.headphone = ds.headphone.state;
  const t = ds.touchpad.left;
  // x: -1 left … 1 right, y: +1 up (flip with settings.touchInvY)
  i.touch = { contact: t.contact.state, x: t.x.state, y: -t.y.state * (settings.touchInvY ? -1 : 1) };
  i.battery = ds.battery.level.state;
  if (i.mx || i.my || i.cx || i.cy || i.cross) mark('sticks');
  return (pad.in = i);
}
export const pressed = (n) => pad.in[n] && !pad.prev[n];

// ---------- outputs (sent only on change) ----------
const out = { light: '', leds: -1, mute: -1, trig: ['', ''] };
const rum = { l: 0, r: 0, sentL: -1, sentR: -1 };

export function light(r, g, b) {
  const key = `${r | 0},${g | 0},${b | 0}`;
  if (!pad.connected || key === out.light) return;
  out.light = key; pad.ds.lightbar.set({ r: r | 0, g: g | 0, b: b | 0 }); mark('lightbar');
}
export function leds(mask) {
  if (!pad.connected || mask === out.leds) return;
  out.leds = mask; pad.ds.playerLeds.set(mask); if (mask) mark('playerLeds');
}
export const ledCount = (n) => (1 << Math.max(0, Math.min(5, n))) - 1;
export function muteLed(mode) {
  if (!pad.connected || mode === out.mute) return;
  out.mute = mode; pad.ds.mute.setLed(mode); if (mode) mark('muteLed');
}
const TRIG_MARK = { feedback: 'trigFeedback', bow: 'trigBow', weapon: 'trigWeapon', vibration: 'trigVibration', galloping: 'trigGallop', machine: 'trigMachine' };
export function triggers(l, r) {
  if (!pad.connected) return;
  [l, r].forEach((cfg, s) => {
    cfg ||= { effect: TriggerEffect.Off };
    const key = JSON.stringify(cfg);
    if (key === out.trig[s]) return;
    out.trig[s] = key;
    (s ? pad.ds.right : pad.ds.left).trigger.feedback.set(cfg);
    if (TRIG_MARK[cfg.effect]) mark(TRIG_MARK[cfg.effect]);
  });
}
export function rumble(l, r = l) { rum.l = Math.max(rum.l, l); rum.r = Math.max(rum.r, r); }
export function flush(dt) {
  if (!pad.connected) return;
  const s = settings.haptics;
  const q = (v) => Math.round(Math.min(1, v * s) * 20) / 20;
  if (q(rum.l) !== rum.sentL) { rum.sentL = q(rum.l); pad.ds.left.rumble(rum.sentL); }
  if (q(rum.r) !== rum.sentR) { rum.sentR = q(rum.r); pad.ds.right.rumble(rum.sentR); }
  if (rum.l > 0.05 || rum.r > 0.05) mark('rumble');
  rum.l = Math.max(0, rum.l - dt * 4); rum.r = Math.max(0, rum.r - dt * 4);
}
export function resetOutputs() { triggers(null, null); rum.l = rum.r = 0; setHum(0); }
export function setHeadphoneRoute(on) {
  if (!pad.connected) return;
  pad.ds.audio.setOutput(on ? AudioOutput.Headphone : AudioOutput.Speaker);
  mark('headphone');
}

// ---------- audio: TV (default device) + controller (speaker ch1/2, haptics ch3/4) ----------
export const tv = new AudioContext();
const tvMaster = tv.createGain(); tvMaster.connect(tv.destination);
export const musicBus = tv.createGain(); musicBus.connect(tvMaster);
let padCtx = null, padSpk = null, hapL = null, hapR = null, merger = null, hum = null;
const mic = { analyser: null, buf: null, level: 0, rms: 0 };

export function applyVolumes() {
  tvMaster.gain.value = settings.master;
  musicBus.gain.value = settings.music;
  if (padSpk) padSpk.gain.value = settings.master;
}

async function initAudio(wantPad) {
  tv.resume(); applyVolumes();
  if (!wantPad) return;
  try {
    // permission first so enumerateDevices returns labels
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
    const { outputs, inputs } = await findDualsenseAudioDevices();
    if (outputs[0]) {
      padCtx = new AudioContext({ sinkId: outputs[0].deviceId, latencyHint: 'interactive' });
      const dest = padCtx.destination;
      const ch = Math.min(4, dest.maxChannelCount);
      dest.channelCount = ch; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete';
      merger = padCtx.createChannelMerger(ch);
      merger.connect(dest);
      padSpk = padCtx.createGain();
      padSpk.connect(merger, 0, 0); padSpk.connect(merger, 0, 1);
      pad.speakerOn = true;
      pad.hapticsHD = ch >= 4;
      hapL = padCtx.createGain(); hapR = padCtx.createGain();
      routeHaptics();
      const o = padCtx.createOscillator(); o.frequency.value = 85; o.type = 'triangle';
      hum = padCtx.createGain(); hum.gain.value = 0;
      o.connect(hum); hum.connect(hapL); hum.connect(hapR); o.start();
      applyVolumes();
    }
    if (inputs[0]) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: inputs[0].deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      mic.analyser = tv.createAnalyser(); mic.analyser.fftSize = 512;
      mic.buf = new Float32Array(mic.analyser.fftSize);
      tv.createMediaStreamSource(stream).connect(mic.analyser);
      pad.micOn = true;
    }
  } catch (e) { console.warn('DualSense audio unavailable:', e); }
}

// L/R haptic gains → merger channels. Pair from settings.hapticPair ("23" default = channels 3+4)
export function routeHaptics() {
  if (!pad.hapticsHD) return;
  const pair = settings.hapticPair.split('').map(Number);
  hapL.disconnect(); hapR.disconnect();
  hapL.connect(merger, 0, pair[0]); hapR.connect(merger, 0, pair[1]);
}

export function updateMic() {
  if (!mic.analyser) return;
  mic.analyser.getFloatTimeDomainData(mic.buf);
  let s = 0; for (const v of mic.buf) s += v * v;
  mic.rms = Math.sqrt(s / mic.buf.length);
  // ponytail: plain RMS gate (breath = loud broadband noise). Calibrate in Settings if room is noisy.
  const lvl = Math.max(0, Math.min(1, (mic.rms - settings.micGate) * 6));
  mic.level += (lvl - mic.level) * 0.3;
}
// listen for 2 s of "silence" and set the gate just above it
export async function calibrateMic() {
  if (!mic.analyser) return null;
  let peak = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 2000) { updateMic(); peak = Math.max(peak, mic.rms); await new Promise((r) => setTimeout(r, 30)); }
  return Math.min(0.3, peak * 1.6 + 0.01);
}

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf?.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// generic voice: osc or filtered noise with exp envelope
function voice(ctx, dest, { type = 'sine', f = 440, f1, dur = 0.1, amp = 0.3, at = 0, lp }) {
  if (!ctx || !dest) return;
  const t = ctx.currentTime + at;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src;
  if (type === 'noise') {
    src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp || f;
    src.connect(fl); fl.connect(g);
  } else {
    src = ctx.createOscillator(); src.type = type;
    src.frequency.setValueAtTime(f, t);
    if (f1) src.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(g);
  }
  g.connect(dest); src.start(t); src.stop(t + dur + 0.02);
}

export const sfx = (o) => voice(tv, tvMaster, o);
// positional (HRTF) sound on the TV/headphones — listener follows the camera via setListener()
export function sfx3d(o, pos) {
  const p = new PannerNode(tv, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2, rolloffFactor: 1.2, positionX: pos.x, positionY: pos.y, positionZ: pos.z });
  p.connect(tvMaster); voice(tv, p, o);
  setTimeout(() => p.disconnect(), ((o.at || 0) + (o.dur || 0.1)) * 1000 + 200);
  mark('audio3d');
}
export function setListener(cam) {
  const L = tv.listener, f = cam.getWorldDirection(_v), u = cam.up;
  if (L.positionX) {
    L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
    L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
  }
}
const _v = new Vector3();
// duck music (e.g. while listening): 1 = normal
export function duckMusic(k) { musicBus.gain.setTargetAtTime(settings.music * k, tv.currentTime, 0.15); }
export const music = (o) => voice(tv, musicBus, o);
// play a decoded voice clip on the controller speaker (TV fallback). Returns the source (onended for subtitles).
export function clip(buf, { rate = 1, gain = 1, tvToo = false } = {}) {
  const play = (ctx, dest) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(dest); s.start(); return s;
  };
  if (padCtx) { mark('speaker'); if (tvToo) play(tv, tvMaster); return play(padCtx, padSpk); }
  return play(tv, tvMaster);
}
// haptic waveform from a buffer (e.g. filtered noise) — continuous textures use setHum/loops instead
export const hapticsCtx = () => (pad.hapticsHD ? { ctx: padCtx, L: hapL, R: hapR } : null);
export function spk(o) {
  if (padCtx) { voice(padCtx, padSpk, o); mark('speaker'); } else sfx(o);
}
// voice-coil haptic; side 'L' | 'R' | 'B'. Falls back to rumble pulses (e.g. Bluetooth).
export function haptic(o, side = 'B') {
  o = { ...o, amp: (o.amp ?? 0.3) * settings.haptics };
  if (pad.hapticsHD) {
    if (side !== 'R') voice(padCtx, hapL, o);
    if (side !== 'L') voice(padCtx, hapR, o);
    mark('haptics');
  } else {
    const a = (o.amp ?? 0.3) * 0.8;
    rumble(side === 'R' ? 0 : a * 0.6, side === 'L' ? 0 : a);
  }
}
export function setHum(v) {
  v *= settings.haptics;
  if (hum) hum.gain.setTargetAtTime(v, padCtx.currentTime, 0.03);
  else if (v > 0.05) rumble(0, v * 0.4);
}

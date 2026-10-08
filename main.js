// Ring Test: game loop, ring charge, construct control, oath recharge, haptics/audio, tutorial, HUD.
import * as THREE from 'three';
import * as P from './pad.js';
import { TriggerEffect, MuteLedMode } from './pad.js';
import { camera, render, followSun } from './gfx.js';
import { stepPhysics, skyFollow, GU, LANTERN, lantern } from './world.js';
import { player, updatePlayer, ringTip, hand } from './player.js';
import * as C from './constructs.js';
import voText from './tools/vo.txt?raw';

const $ = (id) => document.getElementById(id);
const ring = { charge: 1, mode: 'play', oathChars: 0, refill: 0 };
const flags = {};

// ---------- voice lines (ids from tools/vo.txt; wavs from `npm run voices`) ----------
const VO = Object.fromEntries(voText.trim().split('\n').map((l) => { const [id, , , text] = l.split('|'); return [id, text]; }));
// ponytail: VOICE_AUDIO off (macOS `say` sounded robotic). Lines show as subtitles; flip on when real VO exists.
const VOICE_AUDIO = false;
const bufs = {};
if (VOICE_AUDIO) await Promise.all(Object.keys(VO).map(async (id) => {
  try { bufs[id] = await P.tv.decodeAudioData(await (await fetch(`/vo/${id}.wav`)).arrayBuffer()); } catch {}
}));
const vq = []; let speaking = false;
function say(id) { vq.push(id); if (!speaking) nextLine(); }
function nextLine() {
  const id = vq.shift();
  if (!id) { speaking = false; $('sub').innerHTML = ''; return; }
  speaking = true;
  const who = id.startsWith('hal') ? 'HAL' : 'RING';
  $('sub').innerHTML = `<b>${who}</b>${VO[id]}`;
  if (bufs[id]) P.clip(bufs[id], { gain: who === 'RING' ? 0.9 : 1 }).onended = () => setTimeout(nextLine, 250);
  else setTimeout(nextLine, 1800 + VO[id].length * 45); // reading time
}
const once = (k, fn) => { if (!flags[k]) { flags[k] = true; fn(); } };

// ---------- hint / tutorial ----------
const kb = () => !P.pad.connected;
const HINTS = {
  draw: () => (kb() ? 'Press G and draw anything with the mouse. Close the shape for a solid, leave it open for a rod.' : 'Draw anything on the touchpad. Lift your finger and the ring builds it.'),
  push: () => (kb() ? 'Hold E (R2) to push it with your will · Q pulls back · Z lets go · H throws' : 'Squeeze R2 to push it with your will · L2 pulls back · L1 lets go · jab the controller to throw'),
  fly: () => (kb() ? 'Hold Space to take off · X to descend · C to boost' : 'Hold ✕ to take off · ◯ descends · R1 boosts'),
  fist: () => (kb() ? 'J summons a fist. Tap E hard to punch.' : '□ summons a fist. Pull R2 through the click to punch.'),
  free: () => '',
};
let step = 'draw';
const setStep = (s) => { step = s; };

// ---------- audio: TV-side ambience + construct hum ----------
const tv = P.tv;
const amb = tv.createGain(); amb.gain.value = 0.5; amb.connect(P.musicBus);
const noiseBuf = (() => { const b = tv.createBuffer(1, tv.sampleRate * 2, tv.sampleRate), d = b.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1; return b; })();
function loopNoise(type, f, q, gain) {
  const s = tv.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = tv.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = tv.createGain(); g.gain.value = gain; s.connect(fl); fl.connect(g); g.connect(amb); s.start(); return { g, fl };
}
const wind = loopNoise('bandpass', 400, 0.6, 0);
const breeze = loopNoise('lowpass', 300, 0.5, 0.05);
const humO = tv.createOscillator(); humO.type = 'sawtooth'; humO.frequency.value = 55;
const humF = tv.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 300;
const humG = tv.createGain(); humG.gain.value = 0; humO.connect(humF); humF.connect(humG); humG.connect(amb); humO.start();
let cricketT = 0;
function crickets(dt) { // procedural night: a few chirp trains from random directions
  cricketT -= dt; if (cricketT > 0) return;
  cricketT = 0.4 + Math.random() * 1.6;
  const a = Math.random() * Math.PI * 2, pos = new THREE.Vector3(Math.cos(a) * 12, 0, Math.sin(a) * 12).add(player.pos);
  for (let k = 0; k < 3; k++) P.sfx3d({ type: 'sine', f: 4300 + Math.random() * 300, dur: 0.035, amp: 0.025, at: k * 0.06 }, pos);
}

// ---------- drawing input (touchpad or mouse) ----------
const sk = $('sketch'), skx = sk.getContext('2d');
let stroke = [], wasTouch = false;
function drawPreview(pts, cv = sk, cx = skx) {
  const W = cv.width, H = cv.height;
  cx.clearRect(0, 0, W, H);
  cx.strokeStyle = '#3dff6e'; cx.lineWidth = W / 90; cx.lineCap = cx.lineJoin = 'round'; cx.shadowColor = '#3dff6e'; cx.shadowBlur = 14;
  cx.beginPath(); pts.forEach((p, k) => { const x = (p.x * 0.5 + 0.5) * W, y = (0.5 - p.y * 0.5) * H; k ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.stroke();
}
function touchDraw(i) {
  const t = i.touch;
  if (t?.contact) {
    stroke.push({ x: t.x, y: t.y });
    if (stroke.length % 3 === 0) P.haptic({ type: 'sine', f: 260 + stroke.length, dur: 0.012, amp: 0.22 }, 'R');
    sk.classList.add('on'); drawPreview(stroke);
  } else if (wasTouch) { finishStroke(stroke); stroke = []; setTimeout(() => sk.classList.remove('on'), 400); }
  wasTouch = !!t?.contact;
}
// mouse sketch pad (keyboard mode / testing)
const big = $('big'), bcv = big.querySelector('canvas'), bcx = bcv.getContext('2d');
let mouseStroke = null;
addEventListener('keydown', (e) => { if (e.code === 'KeyG' && ring.mode === 'play') { big.classList.toggle('on'); bcx.clearRect(0, 0, bcv.width, bcv.height); } });
const toPad = (e) => { const r = bcv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 }; };
bcv.addEventListener('pointerdown', (e) => { mouseStroke = [toPad(e)]; bcv.setPointerCapture(e.pointerId); });
bcv.addEventListener('pointermove', (e) => { if (mouseStroke) { mouseStroke.push(toPad(e)); drawPreview(mouseStroke, bcv, bcx); } });
bcv.addEventListener('pointerup', () => { if (mouseStroke) { finishStroke(mouseStroke); mouseStroke = null; big.classList.remove('on'); } });

const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
function spawn(kind, sketch) {
  const radius = kind === 'fist' ? 1.6 : Math.max(sketch.w, sketch.h) / 2;
  const cost = kind === 'fist' ? 0.05 : THREE.MathUtils.clamp(0.03 + estVolume(sketch) * 0.006, 0.03, 0.4);
  if (ring.charge < cost) { fizzle(); once('lowAtDraw', () => say('ring_low')); return; }
  ring.charge -= cost;
  if (C.held) C.release();
  camera.getWorldDirection(fwd);
  const base = (kind === 'fist' ? 3.6 : 3 + radius * 1.7);
  const at = tmp.copy(camera.position).addScaledVector(fwd, base);
  const q = camera.quaternion.clone(); if (kind === 'fist') q.multiply(qFlip);
  const c = C.create(kind, sketch, at, q);
  c.base = base; c.flip = kind === 'fist';
  C.grab(c);
  // materialise: haptic crackle rising + TV whoosh
  for (let k = 0; k < 8; k++) P.haptic({ type: 'noise', f: 300 + k * 120, lp: 400 + k * 200, dur: 0.05, amp: 0.15 + k * 0.04, at: k * 0.04 }, k % 2 ? 'L' : 'R');
  P.haptic({ type: 'sine', f: 70, f1: 140, dur: 0.4, amp: 0.5 });
  P.sfx({ type: 'noise', f: 1200, lp: 2400, dur: 0.45, amp: 0.12 }); P.sfx({ type: 'sine', f: 90, f1: 220, dur: 0.5, amp: 0.2 });
  flashT = 0.3; P.mark('touchDraw');
  once('first', () => { say('hal_first'); setStep('push'); });
}
const estVolume = (s) => (s.closed ? s.w * s.h * 0.6 * Math.min(1.5, Math.min(s.w, s.h) * 0.35) : s.len * 0.05);
function fizzle() { P.haptic({ type: 'square', f: 70, dur: 0.15, amp: 0.4 }); P.sfx({ type: 'square', f: 180, f1: 90, dur: 0.18, amp: 0.06 }); }
function finishStroke(pts) { const s = C.analyse(pts); if (s) spawn('stroke', s); else if (pts.length > 2) fizzle(); }

// ---------- oath (John's own words, per the end of Lanterns) ----------
const OATH = 'I am afraid, and I fly anyway. What I build, I build to hold. Light the dark, guard the weak, carry the weight. My will is the ring, and the ring is my word.';
const oathEl = $('oath').querySelector('div');
oathEl.innerHTML = [...OATH].map((ch) => `<span>${ch}</span>`).join('');
const oathSpans = [...oathEl.children];
function oath(dt, i) {
  const voice = Math.max(i.speak, i.tri ? 0.5 : 0); // △ hold = fallback when there is no mic
  if (voice > 0.15) { ring.oathChars += dt * 16 * Math.min(1.5, 0.6 + voice); P.mark('mic'); }
  const n = Math.floor(ring.oathChars);
  oathSpans.forEach((s, k) => s.classList.toggle('lit', k < n));
  P.setHum(0.05 + (n / OATH.length) * 0.3);
  if (n >= OATH.length) {
    ring.mode = 'play'; $('oath').classList.remove('on'); ring.refill = 1;
    for (let k = 0; k < 10; k++) P.haptic({ type: 'sine', f: 60 + k * 25, dur: 0.12, amp: 0.2 + k * 0.05, at: k * 0.08 });
    P.sfx({ type: 'sine', f: 110, f1: 440, dur: 1.2, amp: 0.25 });
    say('ring_full'); say('hal_oath_done');
  }
}

// ---------- main loop ----------
let last = performance.now(), flashT = 0, prevR2 = 0, stepDist = 0, footSide = 0, windT = 0, ledBlink = 0;
const target = new THREE.Vector3(), targetQ = new THREE.Quaternion(), prevV = new THREE.Vector3();
let flyTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  GU.uTime.value = now / 1000;
  P.updateMic();
  const i = P.read();
  const g = P.takeGyro();
  const c = C.held;

  if (ring.mode === 'oath') { oath(dt, i); updatePlayer(dt, { ...i, mx: 0, my: 0, cross: false }, g, 0); }
  else {
    touchDraw(i);
    if (P.pressed('square')) { spawn('fist', null); once('fistUsed', () => setStep('free')); }
    updatePlayer(dt, i, g, c ? Math.max(i.r2, 0.35) : 0);
    // lantern
    const nearLantern = player.pos.distanceTo(tmp.set(LANTERN.x, LANTERN.y + 1.7, LANTERN.z)) < 6;
    if (nearLantern) {
      once('lanternSeen', () => say('ring_lantern'));
      if (P.pressed('tri')) { ring.mode = 'oath'; ring.oathChars = 0; $('oath').classList.add('on'); if (C.held) C.release(); }
    }
    P.muteLed(nearLantern ? MuteLedMode.Pulse : MuteLedMode.Off);
    $('hint').textContent = nearLantern ? (kb() ? 'Y: recite the oath' : '△ Recite the oath to recharge') : HINTS[step]();
  }

  // ---- held construct: will pushes (R2), fear... later. L2 pulls in for now ----
  if (C.held) {
    const h = C.held;
    if (h.kind === 'fist' && i.r2 > 0.62 && prevR2 <= 0.62) { h.punch = 0.38; P.sfx({ type: 'noise', f: 900, lp: 1600, dur: 0.25, amp: 0.15 }); P.haptic({ type: 'noise', lp: 500, dur: 0.12, amp: 0.6 }, 'R'); }
    h.punch = Math.max(0, h.punch - dt);
    const ext = h.kind === 'fist' ? (h.punch > 0.18 ? 16 : h.punch > 0 ? 8 : 0) : Math.pow(i.r2, 1.3) * 18;
    const dist = Math.max(1.4, h.base + ext - i.l2 * (h.base - 1.4));
    camera.getWorldDirection(fwd);
    target.copy(camera.position).addScaledVector(fwd, dist);
    targetQ.copy(camera.quaternion); if (h.flip) targetQ.multiply(qFlip);
    ring.charge -= dt * (0.006 + h.strain * 0.04 + i.r2 * 0.01);
    if (i.r2 > 0.5) once('pushed', () => setTimeout(() => { say('hal_throw'); }, 2500));
    if (h.strain > 0.6) once('strain', () => say('hal_strain'));
    const throwIt = P.takeThrust() || takeKbThrow();
    if (throwIt || P.pressed('l1') || ring.charge <= 0) {
      if (throwIt) { C.release(h, { x: fwd.x * 32, y: fwd.y * 32 + 3, z: fwd.z * 32 }); P.sfx({ type: 'noise', f: 700, lp: 1400, dur: 0.35, amp: 0.15 }); P.haptic({ type: 'sine', f: 90, f1: 40, dur: 0.25, amp: 0.7 }); }
      else C.release(h);
      once('released', () => setTimeout(() => { setStep('fly'); say('hal_fly'); }, 1200));
    }
    // impacts → thump in palms + TV, scaled by velocity change
    const v = h.body.linvel(); const dv = Math.hypot(v.x - prevV.x, v.y - prevV.y, v.z - prevV.z); prevV.set(v.x, v.y, v.z);
    if (dv > 9 && h.age > 0.4) { P.haptic({ type: 'sine', f: 55, dur: 0.12, amp: Math.min(1, dv / 30) }); P.rumble(Math.min(1, dv / 40)); P.sfx3d({ type: 'noise', lp: 300, dur: 0.2, amp: Math.min(0.4, dv / 60) }, h.mesh.position); }
  } else { P.takeThrust(); }
  prevR2 = i.r2;

  // physics: steer the held construct every fixed step
  stepPhysics(dt, () => C.steer(target, targetQ));
  C.update(dt);

  // wheat parts around you and your constructs
  GU.uPush.value[0].set(player.pos.x, player.pos.y - 1.75, player.pos.z, player.flying ? 2.5 + Math.max(0, 6 - (player.pos.y - 1.75 - 0)) * 0.3 : 0.8);
  [C.held, C.list.at(-1)].forEach((cc, k) => { const u = GU.uPush.value[k + 1]; if (cc) u.set(cc.mesh.position.x, cc.mesh.position.y - cc.size * 0.6, cc.mesh.position.z, cc.size * 1.2 + 0.6); else u.set(0, -99, 0, 0); });

  // ---- ring charge ----
  if (ring.refill > 0) { ring.charge = Math.min(1, ring.charge + dt * 0.6); if (ring.charge >= 1) ring.refill = 0; }
  ring.charge = Math.max(0, Math.min(1, ring.charge));
  if (ring.charge < 0.2) once('low', () => { say('ring_low'); say('hal_lantern'); });
  if (ring.charge > 0.5) delete flags.low;
  if (ring.charge <= 0) once('empty', () => say('ring_empty'));
  if (ring.charge > 0.05) delete flags.empty;

  // ---- feel: hum, flight wind, footsteps ----
  const strain = C.held?.strain ?? 0;
  P.setHum(ring.mode === 'oath' ? 0.15 : C.held ? 0.07 + strain * 0.35 + i.r2 * 0.08 : 0);
  humG.gain.setTargetAtTime(C.held ? 0.03 + strain * 0.06 : 0, tv.currentTime, 0.05); humF.frequency.setTargetAtTime(250 + strain * 900, tv.currentTime, 0.05);
  const sp = player.speed;
  wind.g.gain.setTargetAtTime(player.flying ? Math.min(0.5, sp / 60) : 0, tv.currentTime, 0.1); wind.fl.frequency.value = 300 + sp * 12;
  if (player.flying && sp > 4) { windT -= dt; if (windT <= 0) { windT = 0.07; P.haptic({ type: 'noise', lp: 120 + sp * 4, dur: 0.09, amp: Math.min(0.5, sp / 80) }, player.roll > 0.03 ? 'L' : player.roll < -0.03 ? 'R' : 'B'); } }
  if (player.flying) { flyTime += dt; if (flyTime > 5) once('flew', () => { setStep('fist'); say('hal_fist'); }); }
  if (!player.flying && player.grounded && sp > 0.5) {
    stepDist += sp * dt;
    if (stepDist > 0.8) { stepDist = 0; footSide ^= 1; P.haptic({ type: 'noise', lp: 260, dur: 0.07, amp: 0.25 }, footSide ? 'L' : 'R'); P.sfx({ type: 'noise', lp: 1800, dur: 0.08, amp: 0.03 }); }
  }
  crickets(dt);

  // ---- controller outputs ----
  flashT = Math.max(0, flashT - dt);
  const low = ring.charge < 0.2, pulse = 0.75 + 0.25 * Math.sin(now / (low ? 120 : 600));
  const k = (0.15 + ring.charge * 0.85) * pulse;
  P.light(40 * k + flashT * 400, 255 * Math.min(1, k + flashT * 2), 90 * k + flashT * 400);
  ledBlink += dt;
  const bars = Math.ceil(ring.charge * 5);
  P.leds(P.ledCount(low && ledBlink % 0.6 < 0.3 ? bars - 1 : bars));
  const strength = (v) => Math.round(Math.min(1, v) * 8) / 8;
  let r2;
  if (!C.held || ring.mode === 'oath') r2 = null;
  else if (C.held.kind === 'fist') r2 = { effect: TriggerEffect.Weapon, start: 0.3, end: 0.6, strength: 0.9 };
  else if (strain > 0.65) r2 = { effect: TriggerEffect.Vibration, position: 0.1, amplitude: strength(strain), frequency: 28 };
  else r2 = { effect: TriggerEffect.Feedback, position: 0.05, strength: strength(0.2 + Math.min(0.4, C.held.volume * 0.03) + strain * 0.5 + (1 - ring.charge) * 0.2) };
  P.triggers(C.held ? { effect: TriggerEffect.Feedback, position: 0.1, strength: 0.25 } : null, r2);
  P.flush(dt);
  if (P.pad.connected && i.headphone !== flags.hp) { flags.hp = i.headphone; P.setHeadphoneRoute(i.headphone); }

  // ---- visuals ----
  hand.userData.light.intensity = 0.4 + (C.held ? 1 + strain * 1.5 : 0) + flashT * 5;
  hand.userData.gem.material.color.setRGB(0.24, 1, 0.43).multiplyScalar(3 + ring.charge * 4 + flashT * 10);
  lantern.userData.light.intensity = 60 + (ring.mode === 'oath' ? 80 * (ring.oathChars / OATH.length) : 0) + ring.refill * 120;
  updateTether();
  skyFollow(camera); followSun(player.pos);
  $('ring').firstElementChild.style.width = `${ring.charge * 100}%`;
  $('pct').textContent = `${Math.round(ring.charge * 100)}%`;
  if (P.pad.connected && i.battery != null) $('batt').textContent = `🔋 ${Math.round(i.battery * 100)}%`;
  P.setListener(camera);
  render(dt);
}

// energy tether from the ring to the held construct
const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.004, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), C.hardLight());
tether.material.uniforms.uBuild.value = 1; tether.renderOrder = 3;
camera.parent.add(tether);
const tp = new THREE.Vector3();
function updateTether() {
  tether.visible = !!C.held;
  if (!C.held) return;
  ringTip.getWorldPosition(tp);
  tether.position.copy(tp); tether.lookAt(C.held.mesh.position);
  tether.scale.set(1, 1, tp.distanceTo(C.held.mesh.position));
  tether.material.uniforms.uPower.value = 0.35 + (C.held.strain ?? 0) * 0.6;
}

// ---------- start ----------
async function start(withPad) {
  if (withPad) {
    try { await P.connect(); } catch (e) { console.warn(e); }
  } else P.tv.resume();
  $('overlay').hidden = true;
  $('link').textContent = P.pad.connected ? `🎮 ${P.pad.wireless ? 'Bluetooth: no speaker/mic/HD haptics' : 'USB'}` : '⌨️ keyboard';
  say('ring_boot'); say('hal_intro');
}
$('connect').onclick = () => start(true);
$('keys').onclick = () => start(false);
let kbThrow = false;
const takeKbThrow = () => { const t = kbThrow; kbThrow = false; return t; };
addEventListener('keydown', (e) => { if (e.code === 'KeyH') kbThrow = true; });
camera.position.copy(player.pos);
requestAnimationFrame(frame);
window.dbg = { player, C, P, ring, finishStroke, spawn, setStep, camera };

// The transformation (movie-style): camera eases to third person, ring flares (bloom spike, lightbar, rising heartbeat,
// R2 tension), the suit grows outward from the ring over the body with an energy band + particles, the mask forms last,
// a shockwave shoves nearby props and flattens the grass, then the camera returns. Holding T plays it in reverse.
// No per-frame allocations: particles and scratch vectors are preallocated; audio nodes are created once per event.
import * as THREE from 'three';
import { scene, setBloomBoost } from '../gfx.js';
import { SU, suit } from './suit.js';
import * as P from '../pad.js';

const UP_T = 2.2, DOWN_T = 1.5, SHOCK_R = 12;
export const tf = { phase: 'idle', t: 0, light: 0, tension: 0, flatten: 0, shockDone: false };
const ease = (x) => x * x * (3 - 2 * x);
const span = (k, a, b) => THREE.MathUtils.clamp((k - a) / (b - a), 0, 1);

// ---------- energy particles at the leading edge ----------
const N = 320, pPos = new Float32Array(N * 3), pVel = new Float32Array(N * 3), pLife = new Float32Array(N);
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: new THREE.Color(0.25, 1, 0.45).multiplyScalar(5), size: 0.035, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
pts.frustumCulled = false; scene.add(pts);
for (let i = 0; i < N * 3; i += 3) pPos[i + 1] = -999;
let pNext = 0;
const _b = new THREE.Vector3(), _d = new THREE.Vector3();
function emitAtBand(r) {
  for (let k = 0; k < suit.bones.length; k++) {
    const bone = suit.bones[k]; bone.getWorldPosition(_b);
    if (Math.abs(_b.distanceTo(SU.uRing.value) - r) > 0.18 || Math.random() > 0.6) continue;
    const i = pNext; pNext = (pNext + 1) % N;
    pPos[i * 3] = _b.x + (Math.random() - 0.5) * 0.2; pPos[i * 3 + 1] = _b.y + (Math.random() - 0.5) * 0.2; pPos[i * 3 + 2] = _b.z + (Math.random() - 0.5) * 0.2;
    _d.subVectors(_b, SU.uRing.value).normalize();
    pVel[i * 3] = _d.x * 1.5 + (Math.random() - 0.5); pVel[i * 3 + 1] = _d.y * 1.5 + Math.random() * 0.8; pVel[i * 3 + 2] = _d.z * 1.5 + (Math.random() - 0.5);
    pLife[i] = 0.35 + Math.random() * 0.35;
  }
}

// ---------- shockwave ring ----------
const wave = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.45).multiplyScalar(4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
wave.visible = false; scene.add(wave);
let waveT = 0;

// ---------- synthesised audio (one-shot per event) ----------
function whoosh(up) {
  const ctx = P.tv, t0 = ctx.currentTime, dur = up ? 2.0 : 1.3;
  const src = ctx.createBufferSource(), buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(up ? 180 : 3200, t0); bp.frequency.exponentialRampToValueAtTime(up ? 3600 : 160, t0 + dur * 0.9);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(up ? 0.35 : 0.2, t0 + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(up ? 70 : 380, t0); o.frequency.exponentialRampToValueAtTime(up ? 420 : 60, t0 + dur * 0.85);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(up ? 0.09 : 0.05, t0 + dur * 0.8); og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
  src.connect(bp); bp.connect(g); g.connect(P.musicBus); o.connect(lp); lp.connect(og); og.connect(P.musicBus);
  src.start(t0); src.stop(t0 + dur); o.start(t0); o.stop(t0 + dur);
}

// ---------- control ----------
export const busy = () => tf.phase !== 'idle';
export function powerUp() { if (busy() || suit.suited) return false; tf.phase = 'up'; tf.t = 0; tf.shockDone = false; suit.tpForced = true; whoosh(true); return true; }
export function powerDown() { if (busy() || !suit.suited) return false; tf.phase = 'down'; tf.t = 0; suit.tpForced = true; whoosh(false); return true; }

// ctx: { ringPos (Vector3, world), player, bodies: [{ body }] props to shove, push: GU.uPush[0] }
let beatT = 0;
export function updateTransform(dt, ctx) {
  SU.uRing.value.copy(ctx.ringPos);
  // particles
  for (let i = 0; i < N; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt; if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true;
  if (waveT > 0) { waveT += dt; const k = waveT / 0.6; wave.scale.setScalar(1 + k * SHOCK_R); wave.material.opacity = 0.9 * (1 - k); if (k >= 1) { waveT = 0; wave.visible = false; } }
  tf.flatten = Math.max(0, tf.flatten - dt);
  if (tf.phase === 'idle') { tf.light = tf.tension = 0; setBloomBoost(0); return; }

  tf.t += dt;
  const max = SU.uFormMax.value;
  if (tf.phase === 'up') {
    const k = Math.min(1, tf.t / UP_T);
    // 1) camera out to a third-person orbit that swings round to the front · 2) ring flare
    suit.orbit = ease(span(k, 0.04, 0.38)) * (1 - ease(span(k, 0.86, 0.98)));
    const flare = span(k, 0.08, 0.2) * (1 - span(k, 0.28, 0.42)); // short spike as the ring ignites
    tf.light = Math.max(span(k, 0.05, 0.35), flare); tf.tension = span(k, 0.05, 0.6) * (1 - span(k, 0.86, 0.95));
    setBloomBoost(flare + (k > 0.87 && k < 0.93 ? 0.8 : 0)); // + a pop at the shockwave
    // heartbeat rising into a surge
    beatT -= dt;
    if (beatT <= 0 && k < 0.86) { beatT = THREE.MathUtils.lerp(0.55, 0.11, k); const a = 0.3 + k * 0.7; P.haptic({ type: 'sine', f: 46, dur: 0.08, amp: a }); P.haptic({ type: 'sine', f: 40, dur: 0.09, amp: a * 0.7, at: Math.max(0.05, beatT * 0.35) }); }
    // 3) suit grows from the ring outward over the body
    const r = ease(span(k, 0.25, 0.85)) * max;
    SU.uForm.value = r; if (r > 0.02 && r < max - 0.02) emitAtBand(r);
    // 4) mask last
    SU.uMask.value = ease(span(k, 0.8, 0.93));
    // 5) shockwave
    if (k >= 0.88 && !tf.shockDone) {
      tf.shockDone = true; waveT = 0.001; wave.visible = true; wave.position.copy(ctx.player.pos); wave.position.y -= 1.6;
      tf.flatten = 0.8;
      for (const p of ctx.bodies) {
        const b = p.body; if (!b.isValid() || !b.isDynamic()) continue; // shattered props are gone
        const t = b.translation(); _d.set(t.x - ctx.player.pos.x, 0, t.z - ctx.player.pos.z); const dist = _d.length();
        if (dist > SHOCK_R || dist < 0.01) continue;
        const s = b.mass() * 7 * (1 - dist / SHOCK_R) / dist;
        b.applyImpulse({ x: _d.x * s, y: b.mass() * 3 * (1 - dist / SHOCK_R), z: _d.z * s }, true);
      }
      P.haptic({ type: 'sine', f: 38, f1: 110, dur: 0.5, amp: 1 }); P.rumble(1, 1);
      P.sfx({ type: 'sine', f: 55, f1: 28, dur: 0.7, amp: 0.4 }); P.sfx({ type: 'noise', lp: 1800, dur: 0.5, amp: 0.25 });
    }
    // 6) camera back to first person
    if (k > 0.9) suit.tpForced = false;
    if (k >= 1) { tf.phase = 'idle'; suit.suited = true; SU.uForm.value = max; SU.uMask.value = 1; suit.orbit = 0; }
  } else {
    const k = Math.min(1, tf.t / DOWN_T);
    suit.orbit = ease(span(k, 0, 0.3)) * (1 - ease(span(k, 0.8, 0.98)));
    tf.light = 1 - k; tf.tension = 0; setBloomBoost(span(k, 0, 0.15) * (1 - span(k, 0.15, 0.35)));
    SU.uMask.value = 1 - ease(span(k, 0, 0.2));
    const r = (1 - ease(span(k, 0.15, 0.85))) * max;
    SU.uForm.value = r; if (r > 0.02 && r < max - 0.02) emitAtBand(r);
    if (k > 0.9) suit.tpForced = false;
    if (k >= 1) { tf.phase = 'idle'; suit.suited = false; SU.uForm.value = 0; SU.uMask.value = 0; suit.orbit = 0; }
  }
}

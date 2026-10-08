// Impacts: every tagged collider reports contact forces. We turn them into sound, haptics and dust.
// Materials: 'light' (constructs), 'wood', 'metal', 'hay', 'dirt'. Listeners get { a, b, force, s, pos }.
import * as THREE from 'three';
import { physics, RAPIER, events } from '../world.js';
import { scene } from '../gfx.js';

const tags = new Map(); // collider handle -> { mat, owner }
const listeners = [];
const MIN_FORCE = 1500; // N, per collider; below this nothing reports

export function tag(collider, mat, owner = null, threshold = MIN_FORCE) {
  collider.setActiveEvents(collider.activeEvents() | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
  collider.setContactForceEventThreshold(threshold);
  tags.set(collider.handle, { mat, owner });
}
export const untag = (collider) => tags.delete(collider.handle);
export const tagOf = (handle) => tags.get(handle);
export function tagBody(body, mat, owner = null, threshold) {
  for (let k = 0, n = body.numColliders(); k < n; k++) tag(body.collider(k), mat, owner, threshold);
}
export function untagBody(body) { for (let k = 0, n = body.numColliders(); k < n; k++) untag(body.collider(k)); }
export const onImpact = (fn) => listeners.push(fn);

// ---- pooled dust / spark puffs ----
const puffTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv);
})();
const PUFFS = 32, puffs = [];
for (let k = 0; k < PUFFS; k++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; s.renderOrder = 3; scene.add(s); puffs.push({ s, t: 0, life: 1, grow: 1 });
}
let puffI = 0;
const PUFF_COLOR = { light: 0x6dff8c, wood: 0xb89a70, metal: 0xffe0a0, hay: 0xd8c080, dirt: 0x9a8060 };
export function puff(pos, mat, s) {
  for (let n = 0; n < 1 + Math.round(s * 2); n++) {
    const p = puffs[puffI++ % PUFFS];
    p.s.position.set(pos.x + (Math.random() - 0.5) * s, pos.y + Math.random() * 0.3, pos.z + (Math.random() - 0.5) * s);
    p.s.material.color.setHex(PUFF_COLOR[mat] ?? 0xaaaaaa);
    p.s.material.blending = mat === 'light' || mat === 'metal' ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.t = 0; p.life = 0.6 + s * 0.8; p.grow = 0.6 + s * 2.2; p.s.visible = true;
  }
}

// ---- per-frame: drain the queue, debounce per pair, notify ----
const lastHit = new Map(); // pair key -> time
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pos = new THREE.Vector3();
const hit = { a: null, b: null, force: 0, s: 0, pos: _pos, ha: 0, hb: 0 };
export function updateImpacts(dt, now = performance.now() / 1000) {
  events.drainContactForceEvents((e) => {
    const h1 = e.collider1(), h2 = e.collider2();
    const t1 = tags.get(h1), t2 = tags.get(h2);
    if (!t1 && !t2) return;
    const key = h1 < h2 ? h1 * 100003 + h2 : h2 * 100003 + h1;
    if (now - (lastHit.get(key) ?? -1) < 0.15) return;
    lastHit.set(key, now);
    const c1 = physics.getCollider(h1), c2 = physics.getCollider(h2);
    if (!c1 || !c2) return;
    const a = c1.translation(), b = c2.translation();
    _pa.set(a.x, a.y, a.z); _pb.set(b.x, b.y, b.z);
    // contact point ≈ the nearer surface: lerp toward the smaller collider's centre
    _pos.lerpVectors(_pa, _pb, 0.5);
    const force = e.totalForceMagnitude();
    hit.a = t1?.mat ?? 'dirt'; hit.b = t2?.mat ?? 'dirt'; hit.ha = h1; hit.hb = h2; hit.force = force;
    hit.ownerA = t1?.owner ?? null; hit.ownerB = t2?.owner ?? null;
    hit.s = THREE.MathUtils.clamp(Math.log10(force / MIN_FORCE) / 2.2, 0, 1); // 0 tap .. 1 huge
    puff(_pos, hit.s > 0.5 && (hit.a === 'light' || hit.b === 'light') ? 'light' : (t2 ? hit.b : hit.a), hit.s);
    for (const fn of listeners) fn(hit);
  });
  if (lastHit.size > 512) lastHit.clear();
  for (const p of puffs) {
    if (!p.s.visible) continue;
    p.t += dt; const k = p.t / p.life;
    if (k >= 1) { p.s.visible = false; continue; }
    p.s.scale.setScalar(0.3 + p.grow * k); p.s.material.opacity = 0.55 * (1 - k); p.s.position.y += dt * 0.4;
  }
}

// sound recipe per material pair, for pad.js voice() objects
export function impactSound(h) {
  const m = h.a === 'light' ? h.b : h.a, amp = 0.05 + h.s * 0.35;
  switch (m) {
    case 'metal': return { type: 'square', f: 180 + Math.random() * 120, f1: 60, dur: 0.25 + h.s * 0.4, amp: amp * 0.6 };
    case 'wood': return { type: 'noise', lp: 900 + h.s * 800, dur: 0.12 + h.s * 0.2, amp };
    case 'hay': return { type: 'noise', lp: 500, dur: 0.2, amp: amp * 0.6 };
    case 'light': return { type: 'sine', f: 520 + Math.random() * 200, f1: 180, dur: 0.18 + h.s * 0.3, amp: amp * 0.7 };
    default: return { type: 'noise', lp: 300 + h.s * 300, dur: 0.18 + h.s * 0.25, amp };
  }
}

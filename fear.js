// FEAR: the Dread (a yellow smoke wraith), the fear meter, its effect on constructs and on the player, and the Will surge.
// Simulation runs in the fixed physics step (fixedStep); visuals/haptics run per frame (frame). No per-frame allocations.
import * as THREE from 'three';
import { scene, setFearGrade, softDot } from './gfx.js';
import { height, timeOfDay, LANTERN } from './world.js';
import * as C from './constructs.js';
import * as P from './pad.js';

export const fear = { level: 0, calmT: 0, surgeCd: 0, holdT: 0, voiceT: 0, hintT: 0, hinted: false, beatT: 0, surgeT: 0 };
export const SURGE_HINT = 'I am afraid, and I fly anyway. Squeeze R2.';
const HUNT_R = 40, TOUCH_R = 2.6, SURGE_COST = 0.15, SURGE_CD = 10;

// ---------- the Dread ----------
const PUFFS = 56, TRAIL = 64;
export const dread = {
  forced: false, active: false,
  pos: new THREE.Vector3(60, 0, -40), prev: new THREE.Vector3(60, 0, -40), vel: new THREE.Vector3(), knock: new THREE.Vector3(),
  goal: new THREE.Vector3(60, 0, -40), stunT: 0, hunting: false, touching: false, dist: 999, fade: 0,
};
const trail = new Float32Array(TRAIL * 3); let trailHead = 0, trailT = 0;
const smokeGeo = new THREE.BufferGeometry();
const sPos = new Float32Array(PUFFS * 3), sSize = new Float32Array(PUFFS), sAlpha = new Float32Array(PUFFS), sCol = new Float32Array(PUFFS * 3), seed = new Float32Array(PUFFS);
for (let k = 0; k < PUFFS; k++) {
  seed[k] = Math.random() * 100;
  const hot = Math.random();
  sCol[k * 3] = 1.0 * (0.55 + hot * 0.45); sCol[k * 3 + 1] = 0.82 * (0.5 + hot * 0.5); sCol[k * 3 + 2] = 0.1 + hot * 0.12; // sickly yellow → smoky ochre
}
smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
const smokeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: false, vertexColors: true,
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
  vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA; varying vec3 vC; varying float vS;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
      vA = aAlpha; vC = color; vS = aSize; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; varying float vA; varying vec3 vC; varying float vS;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      vec2 p = gl_PointCoord - 0.5; float r = length(p) * 2.;
      float wisp = n(p * 4. + vec2(uTime * 0.6, vS)) * 0.6 + n(p * 9. - uTime * 0.3) * 0.4;   // billowy edge
      float a = smoothstep(1., 0.15, r + (wisp - 0.5) * 0.55) * vA;
      if (a < 0.01) discard;
      float core = smoothstep(0.7, 0., r);
      gl_FragColor = vec4(vC * (0.9 + wisp * 0.7 + core * 0.9), a); // inner glow so it reads as Sinestro-yellow light, not dust
    }`,
});
const smoke = new THREE.Points(smokeGeo, smokeMat); smoke.frustumCulled = false; smoke.renderOrder = 4; scene.add(smoke);
// eyes: two hot points, additive (bloom picks them up)
const eyeGeo = new THREE.BufferGeometry(); const ePos = new Float32Array(6);
eyeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage));
const eyes = new THREE.Points(eyeGeo, new THREE.PointsMaterial({ map: softDot, color: new THREE.Color(1, 0.85, 0.2).multiplyScalar(6), size: 0.45, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
eyes.frustumCulled = false; eyes.renderOrder = 5; scene.add(eyes);
const dreadLight = new THREE.PointLight(0xffc830, 0, 16, 2); scene.add(dreadLight); // always in the scene → no shader recompiles

// ---------- shatter shards (pooled instanced burst) ----------
const SHARDS = 160;
const shardMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1, 0.35).multiplyScalar(4) }), SHARDS);
shardMesh.frustumCulled = false; scene.add(shardMesh);
const shP = new Float32Array(SHARDS * 3), shV = new Float32Array(SHARDS * 3), shL = new Float32Array(SHARDS), shR = new Float32Array(SHARDS * 3);
let shardNext = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
for (let k = 0; k < SHARDS; k++) { _m.makeScale(0, 0, 0); shardMesh.setMatrixAt(k, _m); }
function burst(at, radius, n = 60) {
  for (let j = 0; j < n; j++) {
    const k = shardNext; shardNext = (shardNext + 1) % SHARDS;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 4 + Math.random() * 9;
    shP[k * 3] = at.x + r * Math.cos(th) * radius * 0.5; shP[k * 3 + 1] = at.y + u * radius * 0.5; shP[k * 3 + 2] = at.z + r * Math.sin(th) * radius * 0.5;
    shV[k * 3] = r * Math.cos(th) * sp; shV[k * 3 + 1] = u * sp + 3; shV[k * 3 + 2] = r * Math.sin(th) * sp;
    shL[k] = 0.9 + Math.random() * 0.6; shR[k * 3] = Math.random() * 6; shR[k * 3 + 1] = Math.random() * 6; shR[k * 3 + 2] = Math.random() * 6;
  }
}

// ---------- will surge shockwave ----------
const wave = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1, 0.4).multiplyScalar(2.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
wave.visible = false; wave.renderOrder = 6; scene.add(wave);

// ---------- control ----------
export function toggleDread() { dread.forced = !dread.forced; if (dread.forced && dread.dist > 80) placeNear(); return dread.forced; }
let playerRef = null;
function placeNear() { // appear ~45 m away, across the field
  if (!playerRef) return;
  const a = Math.random() * Math.PI * 2;
  dread.pos.set(playerRef.x + Math.cos(a) * 45, 0, playerRef.z + Math.sin(a) * 45); dread.pos.y = height(dread.pos.x, dread.pos.z) + 2.5;
  dread.prev.copy(dread.pos); dread.goal.copy(dread.pos);
  for (let k = 0; k < TRAIL * 3; k += 3) { trail[k] = dread.pos.x; trail[k + 1] = dread.pos.y; trail[k + 2] = dread.pos.z; }
}

// ---------- fixed-step simulation (called from the physics loop) ----------
export function fixedStep(dt, player) {
  playerRef = player.pos;
  dread.active = dread.forced || timeOfDay === 'night';
  dread.prev.copy(dread.pos);
  // AI: wander the field, hunt within HUNT_R
  _v.subVectors(player.pos, dread.pos); _v.y = 0;
  dread.dist = _v.length();
  dread.stunT = Math.max(0, dread.stunT - dt);
  dread.hunting = dread.active && dread.dist < HUNT_R && dread.stunT <= 0; // reels after a Will surge
  if (dread.hunting) dread.goal.copy(player.pos);
  else if (dread.pos.distanceToSquared(dread.goal) < 9) dread.goal.set(dread.pos.x + (Math.random() - 0.5) * 60, 0, dread.pos.z + (Math.random() - 0.5) * 60);
  _w.subVectors(dread.goal, dread.pos); _w.y = 0;
  const gl = _w.length(), speed = dread.hunting ? 5.2 : 2.2;
  if (gl > 1.2) _w.multiplyScalar(speed / gl); else _w.set(0, 0, 0);
  dread.vel.lerp(_w, 1 - Math.exp(-dt * 1.5));
  dread.pos.addScaledVector(dread.vel, dt).addScaledVector(dread.knock, dt);
  dread.knock.multiplyScalar(Math.exp(-dt * 2.2));
  const ground = height(dread.pos.x, dread.pos.z) + 2.2;
  dread.pos.y += ((dread.hunting ? player.pos.y - 0.6 : ground) - dread.pos.y) * (1 - Math.exp(-dt * 1.2));
  dread.pos.y = Math.max(dread.pos.y, ground - 1.2);
  // thrown/held constructs that hit it shove it back
  for (let k = 0; k < C.list.length; k++) {
    const c = C.list[k], lv = c.body.linvel(), sp2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
    if (sp2 > 64 && c.mesh.position.distanceToSquared(dread.pos) < (c.size + 1.5) ** 2) dread.knock.set(lv.x, 0, lv.z).multiplyScalar(0.8);
  }
  dread.touching = dread.active && dread.pos.distanceTo(player.pos) < TOUCH_R;
  // shards
  for (let k = 0; k < SHARDS; k++) {
    if (shL[k] <= 0) continue;
    shL[k] -= dt; shV[k * 3 + 1] -= 9.8 * dt;
    shP[k * 3] += shV[k * 3] * dt; shP[k * 3 + 1] += shV[k * 3 + 1] * dt; shP[k * 3 + 2] += shV[k * 3 + 2] * dt;
  }
}

// ---------- per-frame: meter, construct integrity, player feedback, visuals ----------
// ctx: { i, ring, player, nearLantern, alpha, now }  → returns true on the frame a Will surge fires
export function frame(dt, ctx) {
  const { i, ring, player } = ctx, f = fear;
  // --- meter ---
  const prox = dread.active ? Math.pow(Math.max(0, 1 - dread.dist / HUNT_R), 1.5) : 0;
  const dark = timeOfDay === 'night' ? 1 : 0;
  const rise = prox * 0.32 + dark * 0.02 + Math.max(0, 0.3 - ring.charge) * 0.35 + (dread.touching ? 0.45 : 0);
  const fall = (dark ? 0.015 : 0.07) + (ctx.nearLantern ? 0.3 : 0) + (C.held ? 0.01 : 0); // light (day, lantern, your own construct) calms
  f.calmT = Math.max(0, f.calmT - dt);
  f.level = THREE.MathUtils.clamp(f.level + ((f.calmT > 0 ? 0 : rise) - fall * (1 - prox)) * dt, 0, 1); // courage window after a surge
  // --- constructs: fear eats integrity; the Dread's touch strains the held one ---
  for (let k = 0; k < C.list.length; k++) {
    const c = C.list[k];
    if (c === C.held) {
      c.integ -= dt * f.level * (0.09 + (dread.touching ? 0.25 : 0));
      c.extStrain = dread.touching ? 0.85 : f.level > 0.5 ? (f.level - 0.5) * 0.5 : 0;
      if (c.integ <= 0) { burst(c.mesh.position, c.size, 50 + Math.min(80, c.size * 25)); C.release(c); C.dissolve(c, 0.12); shatterFx(); }
    }
    c.mat.uniforms.uCrack.value = 1 - Math.max(0, c.integ);
    c.mat.uniforms.uFlick.value = c === C.held ? f.level : 0;
  }
  // --- will surge: R2 hard for 2 s while afraid, or your voice ---
  f.surgeCd = Math.max(0, f.surgeCd - dt);
  f.holdT = i.r2 > 0.85 && f.level > 0.6 ? f.holdT + dt : 0;
  f.voiceT = i.speak > 0.3 && f.level > 0.3 ? f.voiceT + dt : 0;
  if (f.level > 0.6 && !f.hinted) { f.hinted = true; f.hintT = 7; }
  f.hintT = Math.max(0, f.hintT - dt);
  let surged = false;
  if (f.surgeCd <= 0 && ring.charge >= SURGE_COST && (f.holdT >= 2 || f.voiceT >= 0.5)) {
    surged = true; f.surgeCd = SURGE_CD; f.holdT = f.voiceT = 0; f.hintT = 0;
    ring.charge -= SURGE_COST; f.level = Math.max(0, f.level - 0.5);
    _v.subVectors(dread.pos, player.pos); _v.y = 0; const d = Math.max(_v.length(), 0.1);
    dread.knock.copy(_v).multiplyScalar((40 * Math.max(0.35, 1 - d / 35)) / d); dread.stunT = 3; f.calmT = 3;
    if (C.held) C.held.integ = 1;
    wave.position.copy(player.pos); f.surgeT = 0.001; wave.visible = true;
    P.haptic({ type: 'sine', f: 40, f1: 120, dur: 0.6, amp: 1 }); P.rumble(1, 1);
    P.sfx({ type: 'sine', f: 70, f1: 260, dur: 0.9, amp: 0.35 }); P.sfx({ type: 'noise', lp: 2500, dur: 0.7, amp: 0.2 });
    P.mark('mic');
  }
  // --- heartbeat: lub-dub, faster with fear ---
  if (f.level > 0.08) {
    f.beatT -= dt;
    if (f.beatT <= 0) {
      f.beatT = THREE.MathUtils.lerp(1.15, 0.36, f.level);
      const a = 0.25 + f.level * 0.75;
      P.haptic({ type: 'sine', f: 48, dur: 0.09, amp: a }); P.haptic({ type: 'sine', f: 42, dur: 0.11, amp: a * 0.7, at: 0.16 });
    }
  } else f.beatT = 0;
  setFearGrade(f.level);
  // --- visuals ---
  visuals(dt, ctx);
  return surged;
}
function shatterFx() {
  P.haptic({ type: 'noise', lp: 3000, dur: 0.35, amp: 0.9 }); P.rumble(0.8, 1);
  P.sfx({ type: 'noise', f: 2500, lp: 5000, dur: 0.5, amp: 0.25 }); P.sfx({ type: 'square', f: 900, f1: 200, dur: 0.3, amp: 0.05 });
}

const _dp = new THREE.Vector3();
function visuals(dt, { alpha, now, player }) {
  const t = now / 1000;
  dread.fade += ((dread.active ? 1 : 0) - dread.fade) * (1 - Math.exp(-dt * 1.5));
  const vis = dread.fade > 0.01;
  smoke.visible = eyes.visible = vis;
  dreadLight.intensity = vis ? dread.fade * (timeOfDay === 'night' ? 22 : 6) : 0;
  if (vis) {
    _dp.lerpVectors(dread.prev, dread.pos, alpha);
    trailT += dt; if (trailT > 0.05) { trailT = 0; trailHead = (trailHead + 1) % TRAIL; trail[trailHead * 3] = _dp.x; trail[trailHead * 3 + 1] = _dp.y; trail[trailHead * 3 + 2] = _dp.z; }
    for (let k = 0; k < PUFFS; k++) {
      const s = seed[k], body = k < 22; // head/body cluster, the rest stream into a tail
      let x, y, z;
      if (body) {
        const a = t * (0.6 + (s % 1)) + s, r = 0.5 + (k % 5) * 0.22;
        x = _dp.x + Math.cos(a) * r; y = _dp.y + Math.sin(a * 1.3) * 0.5 + (k % 3) * 0.35 - 0.3; z = _dp.z + Math.sin(a) * r;
      } else {
        const back = Math.min(TRAIL - 1, (k - 22) * 1.6) | 0, idx = ((trailHead - back) % TRAIL + TRAIL) % TRAIL;
        const sw = Math.sin(t * 2 + s) * (0.2 + back * 0.03);
        x = trail[idx * 3] + sw; y = trail[idx * 3 + 1] - back * 0.04 + Math.cos(t * 1.7 + s) * 0.2; z = trail[idx * 3 + 2] + Math.cos(t * 2.3 + s) * (0.2 + back * 0.03);
      }
      sPos[k * 3] = x; sPos[k * 3 + 1] = y; sPos[k * 3 + 2] = z;
      const tail = body ? 0 : (k - 22) / (PUFFS - 22);
      sSize[k] = (body ? 2.8 + Math.sin(t * 3 + s) * 0.5 : 2.5 * (1 - tail * 0.7)) * (dread.touching ? 1.3 : 1);
      sAlpha[k] = dread.fade * (body ? 0.5 : 0.38 * (1 - tail));
    }
    smokeGeo.attributes.position.needsUpdate = smokeGeo.attributes.aSize.needsUpdate = smokeGeo.attributes.aAlpha.needsUpdate = true;
    smokeMat.uniforms.uTime.value = t;
    smokeMat.uniforms.uScale.value = innerHeight * 0.55;
    // eyes face the player
    _v.subVectors(player.pos, _dp); _v.y = 0; _v.normalize(); _w.set(-_v.z, 0, _v.x);
    for (let s = 0; s < 2; s++) { const o = s ? 0.22 : -0.22; ePos[s * 3] = _dp.x + _v.x * 0.7 + _w.x * o; ePos[s * 3 + 1] = _dp.y + 0.35; ePos[s * 3 + 2] = _dp.z + _v.z * 0.7 + _w.z * o; }
    eyeGeo.attributes.position.needsUpdate = true;
    eyes.material.opacity = dread.fade * (0.7 + 0.3 * Math.sin(t * 9));
    dreadLight.position.copy(_dp);
  }
  // shards
  for (let k = 0; k < SHARDS; k++) {
    if (shL[k] <= 0) { if (shL[k] > -1) { shL[k] = -2; _m.makeScale(0, 0, 0); shardMesh.setMatrixAt(k, _m); } continue; }
    const sc = Math.min(1, shL[k] * 1.5);
    _q.setFromEuler(_e.set(shR[k * 3] + t * 5, shR[k * 3 + 1] + t * 4, shR[k * 3 + 2]));
    _m.compose(_s.set(shP[k * 3], shP[k * 3 + 1], shP[k * 3 + 2]), _q, _v.set(sc, sc, sc)); shardMesh.setMatrixAt(k, _m);
  }
  shardMesh.instanceMatrix.needsUpdate = true;
  // shockwave
  if (fear.surgeT > 0) {
    fear.surgeT += dt; const k = fear.surgeT / 0.7;
    wave.scale.setScalar(1 + k * 30); wave.material.opacity = Math.max(0, 0.55 * (1 - k));
    if (k >= 1) { fear.surgeT = 0; wave.visible = false; }
  }
}
for (let k = 0; k < SHARDS; k++) shL[k] = -2;

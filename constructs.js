// Hard-light constructs: a touchpad sketch becomes a solid, glowing, physical object.
//  closed stroke → inflated slab (shape exactly as drawn)   open stroke → rod/whip tube   □ → classic fist
// Held constructs are dynamic bodies steered by velocity toward a target in front of the ring, so they really
// collide: push into something heavy and the target runs away from the body → "strain" → R2 stiffens.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { scene } from './gfx.js';
import { physics, RAPIER, GU, track, untrack } from './world.js';
import { settings } from './settings.js';
import { tagBody, untagBody } from './sim/impacts.js';
import { steerWeighty } from './sim/willdrive.js';

const GREEN = new THREE.Color(0.06, 1.0, 0.22);

// ---------- hard-light material ----------
const NOISE = `float h3(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
export function hardLight(color = GREEN) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: GU.uTime, uBuild: { value: 0 }, uColor: { value: color.clone() }, uPower: { value: 1 }, uStrain: { value: 0 }, uCrack: { value: 0 }, uFlick: { value: 0 } },
    vertexShader: `varying vec3 vN, vW, vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uBuild, uPower, uStrain, uCrack, uFlick; uniform vec3 uColor; varying vec3 vN, vW, vL; ${NOISE}
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(max(1. - abs(dot(normalize(vN), v)), 0.), 2.2);
        float flow = n3(vL * 2.2 + vec3(0., -uTime * 1.6, uTime * 0.4));
        float lines = smoothstep(0.975, 1., sin(vL.y * 9. + flow * 5. - uTime * 4.) * 0.5 + 0.5);
        float flick = 0.94 + 0.06 * sin(uTime * 37. + vL.x * 3.);
        flick *= 1. - uFlick * 0.55 * step(0.82, fract(sin(floor(uTime * 24.) * 12.9898) * 43758.5453)); // fear: stutters
        // fear cracks: yellow veins along noise ridges, spreading as integrity falls
        vec3 wq = vL * 3.2 + n3(vL * 1.3) * 1.6;                                   // warped → branching paths
        float ridge = max(1. - abs(n3(wq + 7.1) * 2. - 1.), 1. - abs(n3(wq * 2.3 - 3.7) * 2. - 1.));
        float vein = smoothstep(1. - (0.012 + uCrack * 0.05), 1., ridge) * step(0.001, uCrack); // thin lines that thicken as it fails
        // materialise: dissolve front sweeps in, its edge burns white-hot
        float d = n3(vL * 3.5) * 0.85 + 0.15 * (vL.y * 0.1 + 0.5);
        if (d > uBuild * 1.15) discard;
        float edge = 1. - smoothstep(0., 0.07, uBuild * 1.15 - d);
        float rim = pow(max(1. - abs(dot(normalize(vN), v)), 0.), 6.); // thin hot silhouette
        vec3 c = uColor * (0.035 + fres * 0.55 + rim * 4.5 + lines * 0.35 + flow * 0.03) * flick * uPower;
        c += vec3(0.6, 1., 0.6) * edge * 5. + vec3(1., 0.85, 0.3) * uStrain * rim * 1.5;
        c = mix(c, vec3(3.4, 2.3, 0.12) * (0.7 + 0.3 * flick), vein);
        gl_FragColor = vec4(max(c, 0.), 1.);
      }`,
  });
}
// faint solid core so constructs read as *hard* light, not a hologram (also casts a real shadow)
const coreMat = new THREE.MeshStandardMaterial({ color: 0x02120a, emissive: GREEN, emissiveIntensity: 0.12, transparent: true, opacity: 0.18, roughness: 0.2, metalness: 0, depthWrite: true });

// ---------- sketch → geometry ----------
function resample(pts, n) {
  const d = [0]; for (let k = 1; k < pts.length; k++) d.push(d[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  const L = d[d.length - 1], out = [];
  for (let j = 0, k = 1; j < n; j++) {
    const t = (j / (n - 1)) * L; while (k < d.length - 1 && d[k] < t) k++;
    const a = pts[k - 1], b = pts[k], f = (t - d[k - 1]) / (d[k] - d[k - 1] || 1);
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return { pts: out, len: L };
}
export function analyse(raw, minLen = 0.6) {
  if (raw.length < 3) return null;
  const s = settings.drawScale;
  const { pts, len } = resample(raw.map((p) => ({ x: p.x * 1.78 * s, y: p.y * s })), 48); // touchpad is ~16:9
  if (len < minLen) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const gap = Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y);
  const closed = gap < Math.max(0.5, 0.3 * Math.max(w, h)) && len > 2.2 * Math.max(w, h) * 0.9;
  return { pts, len, w, h, closed };
}

export function slab(pts) {
  const poly = pts.slice(0, -1).map((p) => new THREE.Vector2(p.x, p.y));
  if (THREE.ShapeUtils.isClockWise(poly)) poly.reverse();
  const A = Math.abs(THREE.ShapeUtils.area(poly));
  let P = 0; for (let k = 0; k < poly.length; k++) P += poly[k].distanceTo(poly[(k + 1) % poly.length]);
  const r = (2 * A) / P; // ≈ inradius: how "fat" the drawing is
  const bevel = Math.min(r * 0.55, 0.6), thick = THREE.MathUtils.clamp(r * 0.7, 0.12, 1.1);
  // ponytail: extrude + fat bevel ≈ Teddy-style inflation. Real inflation (distance-field heights) when shapes need to look sculpted.
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(poly), { depth: Math.max(0.02, thick * 0.6), bevelEnabled: true, bevelThickness: thick * 0.7, bevelSize: bevel, bevelSegments: 5, curveSegments: 1 });
  geo.translate(0, 0, -Math.max(0.02, thick * 0.6) / 2);
  const half = Math.max(0.02, thick * 0.6) / 2 + thick * 0.7;
  // exact concave collider: one convex prism per triangle of the drawn outline
  const tris = THREE.ShapeUtils.triangulateShape(poly, []);
  const colliders = tris.map(([a, b, c]) => {
    const v = new Float32Array(18);
    [a, b, c].forEach((ix, j) => { v.set([poly[ix].x, poly[ix].y, -half, poly[ix].x, poly[ix].y, half], j * 6); });
    return RAPIER.ColliderDesc.convexHull(v);
  }).filter(Boolean);
  return { geo, colliders, volume: A * half * 2 };
}
export function rod(pts, len) {
  const radius = THREE.MathUtils.clamp(len * 0.025, 0.09, 0.3);
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)));
  const parts = [new THREE.TubeGeometry(curve, 96, radius, 12, false)];
  for (const p of [pts[0], pts.at(-1)]) parts.push(new THREE.SphereGeometry(radius, 12, 8).translate(p.x, p.y, 0));
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  const colliders = [];
  for (let k = 1; k < pts.length; k += 2) { // capsule chain follows the curve exactly
    const a = pts[k - 1], b = pts[Math.min(k + 1, pts.length - 1)], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-3) continue;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize());
    colliders.push(RAPIER.ColliderDesc.capsule(L / 2, radius).setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2, 0).setRotation(q));
  }
  return { geo, colliders, volume: Math.PI * radius * radius * len };
}
export function fistGeo() {
  const parts = [new RoundedBoxGeometry(1.1, 1.0, 0.9, 3, 0.25)];
  for (let k = 0; k < 4; k++) { // curled fingers across the front
    const f = new THREE.CapsuleGeometry(0.17, 0.42, 6, 12); f.rotateZ(Math.PI / 2); f.scale(1, 1, 1.2);
    f.translate(0, 0.38 - k * 0.25, 0.48); parts.push(f);
  }
  const t = new THREE.CapsuleGeometry(0.15, 0.5, 6, 12); t.rotateZ(Math.PI / 2.4); t.translate(-0.45, -0.25, 0.42); parts.push(t);
  const wrist = new THREE.CylinderGeometry(0.42, 0.5, 0.7, 20); wrist.rotateX(Math.PI / 2); wrist.translate(0, -0.05, -0.75); parts.push(wrist);
  const g = mergeGeometries(parts.map((p) => { p = p.toNonIndexed(); for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k); return p; }));
  g.scale(1.5, 1.5, 1.5);
  return { geo: g, colliders: [RAPIER.ColliderDesc.cuboid(0.85, 0.8, 1.25).setTranslation(0, 0, -0.2)], volume: 2.4 };
}

// ---------- light pool (fixed count → no shader recompiles) ----------
const lights = Array.from({ length: 3 }, () => { const l = new THREE.PointLight(GREEN, 0, 14, 2); scene.add(l); return l; });

// ---------- construct lifecycle ----------
export const list = [];
export let held = null;
// g: { geo, colliders, volume, density?, name?, behavior?, qOff?, level? } from slab/rod/fistGeo/library
export function create(g, at, quat) {
  { // recentre on the construct's middle so it pivots around what you see
    const c = new THREE.Vector3(); g.geo.computeBoundingBox(); g.geo.boundingBox.getCenter(c);
    g.geo.translate(-c.x, -c.y, -c.z); g.colliders.forEach((d) => { const t = d.translation; d.setTranslation(t.x - c.x, t.y - c.y, t.z - c.z); });
  }
  g.geo.computeBoundingSphere();
  const mat = hardLight();
  const mesh = new THREE.Mesh(g.geo, mat);
  const core = new THREE.Mesh(g.geo, coreMat); core.scale.setScalar(0.94); core.castShadow = true; mesh.add(core);
  mesh.position.copy(at); mesh.quaternion.copy(quat); mesh.renderOrder = 2; scene.add(mesh);
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setRotation(quat)
    .setGravityScale(0).setLinearDamping(0.5).setAngularDamping(2).setCcdEnabled(true));
  track(body, mesh);
  g.colliders.forEach((d) => physics.createCollider(d.setDensity(g.density ?? 450).setFriction(0.8).setRestitution(0.1), body));
  const c = { kind: g.name ?? 'free', behavior: g.behavior, qOff: g.qOff ?? new THREE.Quaternion(), level: !!g.level, mesh, mat, body, size: g.geo.boundingSphere.radius, volume: g.volume, build: 0, age: 0, life: Infinity, strain: 0, extStrain: 0, integ: 1, push: 0, punch: 0 };
  tagBody(body, 'light', c);
  list.push(c);
  if (list.length > 6) dissolve(list.find((x) => x !== c && x !== held) ?? list[0], 0.4);
  return c;
}
export const grab = (c) => (held = c);
export function release(c = held, vel) {
  if (!c) return;
  if (held === c) held = null;
  if (c.behavior === 'static' && !vel) { c.body.setBodyType(RAPIER.RigidBodyType.Fixed, true); c.life = 40; return; }
  c.body.setGravityScale(c.behavior === 'glide' ? 0.25 : 1, true); c.body.setLinearDamping(c.behavior === 'glide' ? 0.15 : 0.05); c.body.setAngularDamping(c.behavior === 'roll' ? 0.05 : 0.3);
  if (vel) c.body.setLinvel(vel, true);
  c.life = Math.min(c.life, c.behavior === 'roll' ? 14 : 9);
}
export function dissolve(c, t = 0.6) { if (held === c) held = null; c.life = Math.min(c.life, t); c.dying = true; }

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Vector3();
// called every physics step: steer the held construct toward where your will puts it.
// Default: force-capped spring (sim/willdrive.js) so mass matters. settings.willDrive = false → old velocity steer.
export function steer(target, targetQ, r2 = 1, charge = 1, dt = 1 / 60) {
  if (!held) return;
  if (settings.willDrive !== false) return steerWeighty(held, target, targetQ, r2, charge, dt);
  const b = held.body, t = b.translation(), r = b.rotation();
  _p.set(target.x - t.x, target.y - t.y, target.z - t.z);
  const err = _p.length();
  const maxV = held.punch > 0 ? 60 : 28;
  // strain = we ask for speed toward the target but the body isn't getting there (something heavy is in the way)
  const lv = b.linvel(), want = Math.min(err * 12, maxV);
  const got = err > 1e-3 ? (lv.x * _p.x + lv.y * _p.y + lv.z * _p.z) / err : 0;
  const blocked = err > 0.4 ? THREE.MathUtils.clamp(1 - got / (want * 0.5), 0, 1) * THREE.MathUtils.clamp((err - 0.4) / 2, 0, 1) : 0;
  _p.multiplyScalar(Math.min(12, maxV / Math.max(err, 1e-3)));
  b.setLinvel({ x: _p.x, y: _p.y, z: _p.z }, true);
  _q.set(r.x, r.y, r.z, r.w).invert().premultiply(targetQ); // delta rotation
  if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
  const ang = 2 * Math.acos(Math.min(1, _q.w)), s = Math.sqrt(1 - _q.w * _q.w) || 1;
  _e.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang * 8);
  b.setAngvel({ x: _e.x, y: _e.y, z: _e.z }, true);
  held.strain += (Math.min(1, blocked + held.extStrain) - held.strain) * 0.1; // extStrain: the Dread leaning on it
}

export function update(dt) {
  let li = 0;
  for (let k = list.length - 1; k >= 0; k--) { // backwards: safe to remove while iterating, no array copy
    const c = list[k];
    c.age += dt; c.life -= dt;
    c.build = Math.min(1, c.build + dt * 2.6);
    c.mat.uniforms.uBuild.value = c.life < 0.6 ? Math.max(0, c.life / 0.6) : c.build;
    c.mat.uniforms.uStrain.value = c.strain;
    c.mat.uniforms.uPower.value = 0.9 + c.strain * 0.6 + (held === c ? 0.15 : 0);
    if (li < lights.length && c.life > 0) {
      const l = lights[li++]; l.position.copy(c.mesh.position);
      l.intensity = THREE.MathUtils.clamp(c.size * 9, 6, 40) * c.mat.uniforms.uBuild.value * (held === c ? 1.2 : 0.7) * (c.behavior === 'light' ? 5 : 1); l.distance = (8 + c.size * 4) * (c.behavior === 'light' ? 2.5 : 1);
    }
    if (c.life <= 0) {
      scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mat.dispose();
      untagBody(c.body); untrack(c.body); physics.removeRigidBody(c.body); list.splice(k, 1);
      if (held === c) held = null;
    }
  }
  for (; li < lights.length; li++) lights[li].intensity = 0;
}

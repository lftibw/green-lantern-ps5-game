// Breakables: crates, fence rails, shed boards split into chunks when hit hard enough.
// register(body, mesh, opts) once; call checkBreak(hit) from an impacts listener.
import * as THREE from 'three';
import { physics, RAPIER, track, untrack } from '../world.js';
import { scene } from '../gfx.js';
import { tagBody, untagBody } from './impacts.js';

const byHandle = new Map(); // collider handle -> entry
const debris = [];
export const BREAK = { crate: 9000, rail: 6000, board: 7000, debrisLife: 20, maxDebris: 60 };

export function register(body, mesh, { kind = 'crate', mat = 'wood', threshold = BREAK[kind] ?? 8000, pieces = kind === 'rail' ? 3 : 5 } = {}) {
  const e = { body, mesh, kind, mat, threshold, pieces, broken: false };
  tagBody(body, mat, e);
  for (let k = 0, n = body.numColliders(); k < n; k++) byHandle.set(body.collider(k).handle, e);
  return e;
}

export function checkBreak(hit) {
  for (const h of [hit.ha, hit.hb]) {
    const e = byHandle.get(h);
    if (e && !e.broken && hit.force > e.threshold) shatter(e, hit.force);
  }
}

const _box = new THREE.Box3(), _size = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
function shatter(e, force) {
  e.broken = true;
  const { body, mesh } = e;
  for (let k = 0, n = body.numColliders(); k < n; k++) byHandle.delete(body.collider(k).handle);
  untagBody(body);
  mesh.geometry.computeBoundingBox(); _box.copy(mesh.geometry.boundingBox); _box.getSize(_size).multiply(mesh.scale);
  const lv = body.linvel(), av = body.angvel(), t = body.translation(), r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  // split along the longest axis; cube-ish things also split once across
  const axes = [0, 1, 2].sort((a, b) => _size.getComponent(b) - _size.getComponent(a));
  const n0 = e.pieces, n1 = _size.getComponent(axes[1]) > 0.45 ? 2 : 1;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  for (let i = 0; i < n0; i++) for (let j = 0; j < n1; j++) {
    const sz = _size.clone(); sz.setComponent(axes[0], sz.getComponent(axes[0]) / n0 * (0.85 + Math.random() * 0.15)); sz.setComponent(axes[1], sz.getComponent(axes[1]) / n1 * 0.95);
    _c.set(0, 0, 0);
    _c.setComponent(axes[0], (-_size.getComponent(axes[0]) / 2) + (i + 0.5) * _size.getComponent(axes[0]) / n0);
    _c.setComponent(axes[1], (-_size.getComponent(axes[1]) / 2) + (j + 0.5) * _size.getComponent(axes[1]) / n1);
    _c.applyQuaternion(_q).add(t);
    const m = new THREE.Mesh(new THREE.BoxGeometry(sz.x, sz.y, sz.z), mat);
    m.position.copy(_c); m.quaternion.copy(_q); m.castShadow = true; scene.add(m);
    const kick = Math.min(6, force / 8000);
    const b = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(_c.x, _c.y, _c.z).setRotation(_q)
      .setLinvel(lv.x + (Math.random() - 0.5) * kick, lv.y + Math.random() * kick, lv.z + (Math.random() - 0.5) * kick)
      .setAngvel({ x: av.x + (Math.random() - 0.5) * 4, y: av.y + (Math.random() - 0.5) * 4, z: av.z + (Math.random() - 0.5) * 4 })
      .setLinearDamping(0.2).setAngularDamping(0.4));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(sz.x / 2, sz.y / 2, sz.z / 2).setDensity(400).setFriction(0.8), b);
    track(b, m);
    debris.push({ body: b, mesh: m, life: BREAK.debrisLife });
  }
  scene.remove(mesh); untrack(body); physics.removeRigidBody(body);
  while (debris.length > BREAK.maxDebris) removeDebris(0);
}
function removeDebris(k) {
  const d = debris[k]; scene.remove(d.mesh); d.mesh.geometry.dispose(); untrack(d.body); physics.removeRigidBody(d.body); debris.splice(k, 1);
}
export function updateBreakables(dt) {
  for (let k = debris.length - 1; k >= 0; k--) {
    const d = debris[k]; d.life -= dt;
    if (d.life < 1) d.mesh.scale.setScalar(Math.max(0.01, d.life)); // shrink out
    if (d.life <= 0) removeDebris(k);
  }
}

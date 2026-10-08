// Construct library: when the doodle is recognised, build a detailed hard-light version fitted to what was drawn.
// Models live in the drawing plane (x right, y up, +z toward the viewer). Elongated tools get their axis + head end
// from the ink itself, so a sword drawn diagonally comes out diagonal.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RAPIER } from './world.js';

const clamp = THREE.MathUtils.clamp;
const Y90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // local +x → forward (-z)

// ---------- tiny part assembler: geometry + matching collider per part ----------
function kit() {
  const geos = [], cols = []; let vol = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  return {
    // col: 'box' (default, from the part's bbox) | 'cyl' | 'ball' | 'none'
    add(geo, p = [0, 0, 0], r = [0, 0, 0], col = 'box') {
      q.setFromEuler(e.set(...r)); m.compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1));
      geo.computeBoundingBox(); const bb = geo.boundingBox, sz = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
      vol += sz.x * sz.y * sz.z * 0.6;
      if (col !== 'none') {
        const pr = geo.parameters ?? {};
        const d = col === 'ball' ? RAPIER.ColliderDesc.ball(pr.radius)
          : col === 'cyl' ? RAPIER.ColliderDesc.cylinder(pr.height / 2, Math.max(pr.radiusTop, pr.radiusBottom))
          : RAPIER.ColliderDesc.cuboid(Math.max(sz.x / 2, 0.02), Math.max(sz.y / 2, 0.02), Math.max(sz.z / 2, 0.02));
        const t = (col === 'box' ? ctr : new THREE.Vector3()).applyQuaternion(q).add(new THREE.Vector3(...p));
        cols.push(d.setTranslation(t.x, t.y, t.z).setRotation(q.clone()));
      }
      geo = geo.toNonIndexed(); for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geos.push(geo.applyMatrix4(m));
      return this;
    },
    done(extra = {}) { return { geo: mergeGeometries(geos), colliders: cols, volume: vol, ...extra }; },
  };
}
const box = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
const cyl = (r, h, rb = r, seg = 18) => new THREE.CylinderGeometry(r, rb, h, seg);
const extrude = (pts, depth) => {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: true, bevelThickness: depth * 0.3, bevelSize: depth * 0.25, bevelSegments: 3 });
  return g.translate(0, 0, -depth / 2);
};

// ---------- elongated tools: (L = length along axis, T = drawn width), head at +y ----------
const TOOLS = {
  hammer(L, T) {
    const r = clamp(L * 0.035, 0.05, 0.16), hw = clamp(T, L * 0.35, L * 0.7), hh = L * 0.2;
    return kit().add(cyl(r, L * 0.8), [0, -L * 0.1, 0], [0, 0, 0], 'cyl')
      .add(box(hw, hh, hh * 0.9, hh * 0.15), [0, L / 2 - hh / 2, 0])
      .add(cyl(hh * 0.42, hw * 0.12), [hw / 2 + hw * 0.05, L / 2 - hh / 2, 0], [0, 0, Math.PI / 2], 'cyl')
      .done({ density: 900 });
  },
  sword(L, T) {
    const bw = clamp(T * 0.22, L * 0.045, L * 0.09), bl = L * 0.7, gw = clamp(T, L * 0.2, L * 0.34);
    const blade = extrude([[-bw / 2, 0], [bw / 2, 0], [bw / 2, bl - bw * 1.6], [0, bl], [-bw / 2, bl - bw * 1.6]], bw * 0.18);
    return kit().add(blade, [0, -L / 2 + L * 0.27, 0])
      .add(box(gw, L * 0.035, L * 0.06, 0.02), [0, -L / 2 + L * 0.26, 0])
      .add(cyl(bw * 0.38, L * 0.2), [0, -L / 2 + L * 0.14, 0], [0, 0, 0], 'cyl')
      .add(new THREE.SphereGeometry(bw * 0.6, 14, 10), [0, -L / 2 + L * 0.03, 0], [0, 0, 0], 'ball')
      .done({ density: 700 });
  },
  axe(L, T) {
    const r = clamp(L * 0.032, 0.05, 0.15), bw = clamp(T * 0.9, L * 0.25, L * 0.5), bh = L * 0.32;
    const blade = extrude([[0, -bh * 0.25], [bw * 0.55, -bh * 0.5], [bw, -bh * 0.6], [bw * 0.92, 0], [bw, bh * 0.6], [bw * 0.55, bh * 0.5], [0, bh * 0.25]], Math.max(r * 0.7, 0.05));
    return kit().add(cyl(r, L * 0.95), [0, 0, 0], [0, 0, 0], 'cyl')
      .add(blade, [r * 0.6, L / 2 - bh * 0.55, 0])
      .add(box(r * 3, bh * 0.45, r * 2.6, 0.03), [-r * 0.3, L / 2 - bh * 0.55, 0])
      .done({ density: 800 });
  },
  'baseball bat'(L) {
    const prof = [[0, -0.5], [0.04, -0.5], [0.045, -0.48], [0.022, -0.45], [0.022, -0.1], [0.05, 0.25], [0.058, 0.44], [0.045, 0.5], [0, 0.5]];
    const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x * L, y * L)), 24);
    return kit().add(g, [0, 0, 0], [0, 0, 0], 'none').done({ colliders: [RAPIER.ColliderDesc.capsule(L * 0.42, L * 0.045)], density: 600 });
  },
  shovel(L, T) {
    const r = clamp(L * 0.025, 0.04, 0.12), bw = clamp(T, L * 0.18, L * 0.32), bl = L * 0.3;
    const blade = extrude([[-bw / 2, 0], [bw / 2, 0], [bw / 2, bl * 0.7], [0, bl], [-bw / 2, bl * 0.7]], Math.max(r * 0.35, 0.03));
    return kit().add(cyl(r, L * 0.68), [0, -L * 0.13, 0], [0, 0, 0], 'cyl')
      .add(new THREE.TorusGeometry(r * 3, r * 0.8, 8, 20), [0, -L / 2 + r * 3.5, 0])
      .add(blade, [0, L / 2 - bl, 0], [0, 0, 0])
      .done({ density: 700 });
  },
  key(L, T) {
    const R = clamp(T * 0.45, L * 0.14, L * 0.3), r = clamp(L * 0.05, 0.05, 0.2);
    const k = kit().add(new THREE.TorusGeometry(R, r * 0.9, 10, 28), [0, L / 2 - R, 0])
      .add(cyl(r, L - R * 2), [0, -R, 0], [0, 0, 0], 'cyl');
    for (let t = 0; t < 3; t++) k.add(box(r * (3 - t * 0.6), r * 1.3, r * 1.4, 0.02), [r * (1.5 - t * 0.3), -L / 2 + r * (1 + t * 2.4), 0]);
    return k.done({ density: 800 });
  },
};

// ---------- whole objects: (w, h) = drawn width/height ----------
const OBJECTS = {
  ladder(w, h) {
    const r = clamp(w * 0.05, 0.04, 0.12), x = w * 0.42, k = kit();
    k.add(cyl(r, h), [-x, 0, 0], [0, 0, 0], 'cyl').add(cyl(r, h), [x, 0, 0], [0, 0, 0], 'cyl');
    const n = Math.max(3, Math.round(h / 0.45));
    for (let i = 0; i < n; i++) k.add(cyl(r * 0.7, x * 2), [0, -h / 2 + (i + 0.5) * (h / n), 0], [0, 0, Math.PI / 2], 'cyl');
    return k.done({ density: 500 });
  },
  car(w, h) {
    const d = w * 0.45, wr = h * 0.22, k = kit()
      .add(box(w, h * 0.42, d, h * 0.12), [0, -h * 0.06, 0])
      .add(box(w * 0.55, h * 0.34, d * 0.88, h * 0.1), [-w * 0.04, h * 0.3, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(cyl(wr, wr * 0.7, wr, 20), [sx * w * 0.31, -h * 0.28, sz * d * 0.48], [Math.PI / 2, 0, 0], 'cyl');
    return k.done({ density: 350 });
  },
  airplane(w, h) {
    const L = Math.max(w, h * 1.4), r = L * 0.07;
    return kit().add(new THREE.CapsuleGeometry(r, L * 0.8, 8, 16), [0, 0, 0], [0, 0, Math.PI / 2])
      .add(box(L * 0.22, r * 0.4, L * 0.95, 0.04), [L * 0.05, 0, 0])
      .add(box(L * 0.1, r * 0.3, L * 0.35, 0.03), [-L * 0.42, r * 0.2, 0])
      .add(box(L * 0.12, L * 0.16, r * 0.3, 0.03), [-L * 0.42, L * 0.09, 0])
      .done({ density: 150, qOff: Y90.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)), behavior: 'glide' });
  },
  umbrella(w, h) { // a dome shield with a handle
    const R = Math.max(w * 0.55, 0.6), th = Math.PI / 3;
    const dome = new THREE.SphereGeometry(R, 32, 12, 0, Math.PI * 2, 0, th);
    const top = h / 2, dy = R * Math.cos(th);
    return kit().add(dome, [0, top - R, 0], [0, 0, 0], 'none')
      .add(cyl(R * 0.03, h * 0.75), [0, top - h * 0.4, 0], [0, 0, 0], 'cyl')
      .add(new THREE.TorusGeometry(R * 0.12, R * 0.03, 8, 16, Math.PI), [R * 0.12, -h / 2 + R * 0.1, 0], [0, 0, Math.PI])
      .done({ density: 200, extraColliders: [RAPIER.ColliderDesc.cuboid(R * Math.sin(th), (R - dy) / 2, R * Math.sin(th)).setTranslation(0, top - (R - dy) / 2, 0)] });
  },
  cannon(w, h) {
    const L = Math.max(w, h) * 0.8, r = L * 0.13;
    const k = kit().add(cyl(r * 0.85, L, r), [0, r * 0.6, 0], [0, 0, Math.PI / 2 - 0.25], 'cyl')
      .add(new THREE.TorusGeometry(r * 0.88, r * 0.15, 8, 20), [L * 0.48, r * 0.6 + L * 0.12, 0], [0, Math.PI / 2, 0.25], 'none')
      .add(box(L * 0.6, r * 0.9, r * 2.2, 0.05), [-L * 0.08, -r * 0.4, 0]);
    for (const s of [-1, 1]) k.add(cyl(r * 1.25, r * 0.4), [-L * 0.05, -r * 0.6, s * r * 1.3], [Math.PI / 2, 0, 0], 'cyl');
    return k.done({ density: 900, qOff: Y90.clone(), behavior: 'cannon', barrel: L });
  },
  hand(w, h) {
    const pw = w * 0.55, ph = h * 0.45, d = pw * 0.35, k = kit().add(box(pw, ph, d, d * 0.3), [0, -h * 0.2, 0]);
    for (let i = 0; i < 4; i++) { const fl = h * (0.36 + (i === 1 || i === 2 ? 0.06 : 0)); k.add(new THREE.CapsuleGeometry(pw * 0.1, fl, 6, 10), [-pw * 0.36 + i * pw * 0.24, -h * 0.2 + ph / 2 + fl / 2, 0], [0, 0, (i - 1.5) * -0.08]); }
    k.add(new THREE.CapsuleGeometry(pw * 0.11, h * 0.25, 6, 10), [pw * 0.62, -h * 0.18, 0], [0, 0, -0.9]);
    return k.done({ density: 400 });
  },
  anvil(w, h) {
    const p = [[-0.3, -0.5], [0.3, -0.5], [0.3, -0.38], [0.14, -0.3], [0.14, 0.15], [0.38, 0.25], [0.5, 0.45], [0.5, 0.5], [-0.25, 0.5], [-0.5, 0.3], [-0.14, 0.15], [-0.14, -0.3], [-0.3, -0.38]];
    return kit().add(extrude(p.map(([x, y]) => [x * w, y * h]), w * 0.32), [0, 0, 0], [0, 0, 0], 'none')
      .done({ density: 4000, extraColliders: [RAPIER.ColliderDesc.cuboid(w * 0.42, h * 0.13, w * 0.2).setTranslation(0, h * 0.37, 0), RAPIER.ColliderDesc.cuboid(w * 0.16, h * 0.3, w * 0.2).setTranslation(0, -h * 0.15, 0), RAPIER.ColliderDesc.cuboid(w * 0.3, h * 0.07, w * 0.2).setTranslation(0, -h * 0.44, 0)] });
  },
  bridge(w, h) { // laid flat, reaching away from you
    const L = Math.max(w, 3), dw = Math.max(1.6, L * 0.22), k = kit().add(box(L, 0.18, dw, 0.05), [0, 0, 0]);
    const arc = new THREE.CatmullRomCurve3([...Array(9)].map((_, i) => { const t = i / 8 - 0.5; return new THREE.Vector3(t * L, (0.25 - t * t) * L * 0.5, 0); }));
    for (const s of [-1, 1]) {
      k.add(new THREE.TubeGeometry(arc, 40, 0.07, 8), [0, 0.05, s * dw / 2], [0, 0, 0], 'none');
      for (let i = 1; i < 8; i++) { const t = i / 8 - 0.5, hh = (0.25 - t * t) * L * 0.5; k.add(cyl(0.025, hh), [t * L, hh / 2, s * dw / 2], [0, 0, 0], 'none'); }
    }
    return k.done({ density: 600, qOff: Y90.clone(), level: true, behavior: 'static' });
  },
  wheel(w, h) {
    const R = Math.min(w, h) / 2 * 0.85, tr = R * 0.16, k = kit().add(new THREE.TorusGeometry(R, tr, 12, 40), [0, 0, 0], [0, 0, 0], 'none')
      .add(cyl(R * 0.15, tr * 2.4), [0, 0, 0], [Math.PI / 2, 0, 0], 'none');
    for (let i = 0; i < 6; i++) k.add(box(R * 0.07, R * 0.95, tr * 0.6, 0.01), [Math.cos(i * Math.PI / 3 + Math.PI / 2) * R * 0.48, Math.sin(i * Math.PI / 3 + Math.PI / 2) * R * 0.48, 0], [0, 0, i * Math.PI / 3], 'none');
    return k.done({ density: 500, qOff: Y90.clone(), behavior: 'roll', extraColliders: [RAPIER.ColliderDesc.cylinder(tr, R + tr).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))] });
  },
  circle(w, h) { // a ball
    const R = (w + h) / 4;
    return kit().add(new THREE.SphereGeometry(R, 32, 20), [0, 0, 0], [0, 0, 0], 'ball').done({ density: 500, behavior: 'roll' });
  },
  chair(w, h) {
    const sw = w * 0.85, sd = sw * 0.9, legH = h * 0.45, t = Math.max(0.06, h * 0.05), k = kit()
      .add(box(sw, t, sd, t * 0.3), [0, -h / 2 + legH, 0])
      .add(box(sw, h - legH, t, t * 0.3), [0, -h / 2 + legH + (h - legH) / 2, -sd / 2]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(t, legH, t, t * 0.2), [sx * (sw / 2 - t), -h / 2 + legH / 2, sz * (sd / 2 - t)]);
    return k.done({ density: 400 });
  },
  lantern(w, h) {
    const r = Math.min(w * 0.4, h * 0.3), k = kit()
      .add(cyl(r * 1.2, h * 0.1, r * 1.35, 24), [0, -h * 0.45, 0], [0, 0, 0], 'cyl')
      .add(cyl(r, h * 0.55, r, 24), [0, -h * 0.1, 0], [0, 0, 0], 'cyl')
      .add(cyl(r * 1.3, h * 0.08, r * 1.1, 24), [0, h * 0.22, 0], [0, 0, 0], 'none')
      .add(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), [0, h * 0.26, 0], [0, 0, 0], 'none')
      .add(new THREE.TorusGeometry(r * 0.7, r * 0.08, 8, 20, Math.PI), [0, h * 0.26 + r, 0], [0, 0, 0], 'none');
    for (let i = 0; i < 8; i++) k.add(box(r * 0.08, h * 0.55, r * 0.08, 0.01), [Math.cos(i * Math.PI / 4) * r * 1.05, -h * 0.1, Math.sin(i * Math.PI / 4) * r * 1.05], [0, 0, 0], 'none');
    return k.done({ density: 600, behavior: 'light' });
  },
  fence(w, h) {
    const n = Math.max(3, Math.round(w / 1.2) + 1), t = Math.max(0.1, h * 0.08), k = kit();
    for (let i = 0; i < n; i++) k.add(box(t, h, t, 0.03), [-w / 2 + (i * w) / (n - 1), 0, 0]);
    for (const y of [0.28, -0.12]) k.add(box(w, t * 0.8, t * 0.5, 0.03), [0, y * h, t * 0.5]);
    return k.done({ density: 500 });
  },
};

export const KNOWN = new Set([...Object.keys(TOOLS), ...Object.keys(OBJECTS)]);

// strokes: [[{x,y}]] in metres (drawing plane). Returns a construct spec, or null if this class has no model.
export function build(name, strokes) {
  const pts = strokes.flat();
  if (OBJECTS[name]) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const w = Math.max(0.5, Math.max(...xs) - Math.min(...xs)), h = Math.max(0.5, Math.max(...ys) - Math.min(...ys));
    return finish(OBJECTS[name](w, h), name);
  }
  if (!TOOLS[name]) return null;
  // principal axis of the ink → tool axis; the wider end is the head
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = [Math.cos(ang), Math.sin(ang)];
  const along = pts.map((p) => (p.x - mx) * ax[0] + (p.y - my) * ax[1]), across = pts.map((p) => -(p.x - mx) * ax[1] + (p.y - my) * ax[0]);
  const a0 = Math.min(...along), a1 = Math.max(...along), L = Math.max(0.8, a1 - a0), T = Math.max(...across) - Math.min(...across);
  const spread = (lo, hi) => { const v = across.filter((_, i) => along[i] >= lo && along[i] <= hi); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  if (spread(a0, a0 + L * 0.3) > spread(a1 - L * 0.3, a1)) ang += Math.PI;
  const spec = TOOLS[name](L, T);
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang - Math.PI / 2);
  spec.geo.applyQuaternion(rot);
  spec.colliders.forEach((d) => { const t = new THREE.Vector3(d.translation.x, d.translation.y, d.translation.z).applyQuaternion(rot); d.setTranslation(t.x, t.y, t.z); d.setRotation(rot.clone().multiply(new THREE.Quaternion(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w))); });
  return finish(spec, name);
}
function finish(spec, name) {
  if (spec.extraColliders) spec.colliders.push(...spec.extraColliders);
  if (!spec.colliders.length) spec.colliders.push(RAPIER.ColliderDesc.ball(0.3));
  spec.name = name;
  return spec;
}

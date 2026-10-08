// Rushville, Nebraska: rolling farmland, wheat fields + pasture (veg.js), shelterbelt trees (EZ-Tree), photo-scanned
// PBR surfaces (Poly Haven, CC0), physical sky + cloud layer, day/night, Rapier props, the power battery.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tree } from '@dgreenheck/ez-tree';
import { scene, setSky, sun, renderer } from './gfx.js';
import { makeField, wheatTuft, grassTuft } from './veg.js';
import { settings } from './settings.js';
import { CITY } from './level.js';

await RAPIER.init();
export { RAPIER };
export const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
export const events = new RAPIER.EventQueue(false); // contact-force events, drained once per frame by sim/impacts.js
export const props = []; // { body, mesh, kind } dynamic world props (crate, rail, bale, truck) for sim/ to register
export const trunks = []; // fixed tree-trunk colliders
export const statics = []; // { collider, mat } other fixed colliders; main.js tags them via sim/impacts.js
export let terrainCollider = null;
const setTerrainCollider = (c) => (terrainCollider = c);
export const SPAWN = new THREE.Vector3(0, 0, 6); // where the player starts (the city picks a street)
export let city = null;
export const bodies = []; // { body, mesh, p0,q0,p1,q1 } — interpolated between physics steps when rendered
export const GU = { uTime: { value: 0 }, uPush: { value: [new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0)] } };
export const LANTERN = new THREE.Vector3(38, 0, -62);

// ---------- layout: where things grow ----------
const box = (x, z, x0, x1, z0, z1, e = 0.6) => Math.min(THREE.MathUtils.smoothstep(x, x0 - e, x0 + e), 1 - THREE.MathUtils.smoothstep(x, x1 - e, x1 + e), THREE.MathUtils.smoothstep(z, z0 - e, z0 + e), 1 - THREE.MathUtils.smoothstep(z, z1 - e, z1 + e));
const ROAD_X = 6.5;
export function road(x, z) { return 1 - THREE.MathUtils.smoothstep(Math.abs(x - ROAD_X), 1.3, 2.2); }
export function wheat(x, z) {
  let f = Math.max(box(x, z, 14, 175, -185, 30), box(x, z, -185, -60, -185, 12), box(x, z, -60, 14, -185, -100));
  f *= THREE.MathUtils.smoothstep(Math.hypot(x - LANTERN.x, z - LANTERN.z), 15, 18); // grassy knoll for the lantern
  return f * (1 - road(x, z));
}
const pasture = (x, z) => (1 - wheat(x, z)) * (1 - road(x, z)) * (1 - box(x, z, -47, -33, -80, -60, 2)); // no grass under the barn

// ---------- terrain ----------
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function height(x, z) {
  if (CITY) return 0; // Gurugram is flat; bridges/roofs are colliders
  let h = (vnoise(x * 0.012, z * 0.012) - 0.5) * 10 + (vnoise(x * 0.04, z * 0.04) - 0.5) * 2.2;
  const dl = Math.hypot(x - LANTERN.x, z - LANTERN.z);
  h += 9 * Math.exp(-(dl * dl) / 900); // the lantern's hill
  h *= Math.min(1, 0.25 + Math.hypot(x, z) / 60); // gentle around spawn
  h *= 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(z)), 220, 290); // flattens into the far plains
  return h - road(x, z) * 0.08;
}

const SIZE = 600, SEG = 240;
// baked map for the GPU fields: R height, G wheat, B pasture grass
const MAP_N = 512;
const growMap = CITY ? null : (() => {
  const d = new Uint16Array(MAP_N * MAP_N * 4), f = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < MAP_N; j++) for (let i = 0; i < MAP_N; i++) {
    const x = ((i + 0.5) / MAP_N - 0.5) * SIZE, z = ((j + 0.5) / MAP_N - 0.5) * SIZE, k = (j * MAP_N + i) * 4;
    d[k] = f(height(x, z)); d[k + 1] = f(wheat(x, z)); d[k + 2] = f(pasture(x, z) * (0.55 + 0.45 * vnoise(x * 0.3, z * 0.3))); d[k + 3] = f(1);
  }
  const t = new THREE.DataTexture(d, MAP_N, MAP_N, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
})();

// ---------- PBR textures (Poly Haven CC0) ----------
const loader = new THREE.TextureLoader(), maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = {}; // one image per file; each material gets its own clone (own repeat), re-uploaded when the image lands
function tex(path, srgb, repeat) {
  const c = (texCache[path] ||= { clones: [], tex: loader.load(path, () => c.clones.forEach((t) => (t.needsUpdate = true))) });
  const t = c.tex.clone(); c.clones.push(t);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (c.tex.image) t.needsUpdate = true; // otherwise the load callback flags it
  return t;
}
function pbr(id, repeat = 1, o = {}) {
  const arm = tex(`/tex/${id}/arm.jpg`, false, repeat);
  return new THREE.MeshStandardMaterial({ map: tex(`/tex/${id}/diff.jpg`, true, repeat), normalMap: tex(`/tex/${id}/nor.jpg`, false, repeat), roughnessMap: arm, metalnessMap: arm, aoMap: arm, metalness: 1, ...o });
}

if (!CITY) {
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv, mix = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k); p.setY(k, height(x, z));
    uv.setXY(k, x / 4, z / 4); // world-space UVs: one texture tile = 4 m
    mix[k * 3] = wheat(x, z); mix[k * 3 + 1] = pasture(x, z); mix[k * 3 + 2] = vnoise(x * 0.02, z * 0.02); // field, grass, macro
  }
  g.setAttribute('aMix', new THREE.BufferAttribute(mix, 3));
  g.computeVertexNormals();
  const mat = pbr('farm_soil', 1, { metalness: 0 });
  const grassMap = tex('/tex/grass_path_2/diff.jpg', true, 1);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrass = { value: grassMap };
    sh.vertexShader = 'attribute vec3 aMix; varying vec3 vMix;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = aMix;');
    sh.fragmentShader = 'uniform sampler2D tGrass; varying vec3 vMix;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      // anti-tiling: blend each texture with a rotated, larger-scale copy of itself + macro brightness noise
      vec2 u1 = vMapUv, u2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.29 + 0.37;
      vec3 soil = mix(texture2D(map, u1).rgb, texture2D(map, u2).rgb, 0.4);
      vec3 grass = mix(texture2D(tGrass, u1 * 1.3).rgb, texture2D(tGrass, u2).rgb, 0.4);
      float lum = dot(soil, vec3(0.333));
      vec3 straw = vec3(0.8, 0.64, 0.36) * (0.55 + lum * 1.3); // beyond the stalk ring the field still reads golden
      vec3 c = mix(soil, straw, vMix.x * 0.9);
      c = mix(c, grass * vec3(0.82, 1.0, 0.58) * 1.1, vMix.y);  // late-summer pasture: olive, not brown
      diffuseColor.rgb *= c * mix(0.82, 1.12, vMix.z);`);
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; scene.add(m);
  terrainCollider = physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(p.array), new Uint32Array(g.index.array)).setFriction(0.9));
  // far plains to the horizon (no collider, fogged)
  const far = new THREE.Mesh(new THREE.RingGeometry(250, 3000, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7650, roughness: 1 }));
  far.position.y = -0.05; far.receiveShadow = false; scene.add(far);
}

// ---------- fields that follow the player ----------
const fields = CITY ? [] : [
  makeField({ geo: wheatTuft, count: 300, S: 96, channel: 'g', map: { tex: growMap, size: SIZE }, GU, colorA: '1.0, 0.95, 0.85', colorB: '0.92, 0.9, 0.7', tipBoost: 0.3, bendK: 0.32 }),
  makeField({ geo: grassTuft, count: 260, S: 70, channel: 'b', map: { tex: growMap, size: SIZE }, GU, colorA: '1.0, 1.0, 1.0', colorB: '1.15, 1.0, 0.75', tipBoost: 0.2, bendK: 0.18 }),
];
export function updateFields(center) { fields.forEach((f) => f.update(center)); }

// ---------- static geometry merged per material (few draw calls) ----------
const merged = new Map();
function addStatic(geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  if (!merged.has(mat)) merged.set(mat, []);
  merged.get(mat).push(geo);
}
function flushStatic() {
  for (const [mat, geos] of merged) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = m.receiveShadow = true; scene.add(m); }
  merged.clear();
}
// box UVs in metres so textures keep real-world scale on any size
function boxM(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let k = 0; k < p.count; k++) { const ax = Math.abs(n.getX(k)), ay = Math.abs(n.getY(k)); uv.setXY(k, ax > 0.5 ? p.getZ(k) : p.getX(k), ay > 0.5 ? p.getZ(k) : p.getY(k)); }
  return g;
}
const fixedCol = (x, y, z, hx, hy, hz, ry = 0, mat = 'wood') => {
  const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0))));
  statics.push({ collider, mat }); return collider;
};

// ---------- materials ----------
const barnRed = pbr('distressed_painted_planks', 0.5, { color: 0xb8443a, metalness: 0 });
const woodMat = pbr('distressed_painted_planks', 0.5, { color: 0x9a7a58, metalness: 0 });
const roofMat = pbr('corrugated_iron', 0.35);
const rustMat = pbr('green_metal_rust', 0.4);
const tankMat = pbr('green_metal_rust', 0.15, { color: 0xd8dcd8 });
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
function hayTex() {
  const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n; const x = cv.getContext('2d');
  x.fillStyle = '#a88a52'; x.fillRect(0, 0, n, n);
  for (let k = 0; k < 2200; k++) { x.strokeStyle = `hsla(${38 + Math.random() * 10},${40 + Math.random() * 30}%,${35 + Math.random() * 35}%,0.6)`; x.lineWidth = 0.5 + Math.random() * 1.5; x.beginPath(); const y = Math.random() * n, x0 = Math.random() * n; x.moveTo(x0, y); x.lineTo(x0 + 10 + Math.random() * 30, y + (Math.random() - 0.5) * 6); x.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; return t;
}
const hayMat = std({ map: hayTex(), roughness: 0.95 });

// ---------- dynamic props ----------
function addBody(mesh, desc, colliders, kind = 'prop', parent = scene) {
  mesh.traverse((o) => { o.castShadow = o.receiveShadow = true; }); parent.add(mesh);
  const body = physics.createRigidBody(desc.setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation(mesh.quaternion));
  colliders.forEach((c) => physics.createCollider(c, body));
  track(body, mesh);
  props.push({ body, mesh, kind });
  return body;
}
const bale = (x, z, rotY = Math.random() * 3) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 28), hayMat);
  m.rotation.set(0, rotY, Math.PI / 2); m.position.set(x, height(x, z) + 0.78, z);
  addBody(m, RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.1).setAngularDamping(1.5).setSleeping(true), [RAPIER.ColliderDesc.cylinder(0.65, 0.75).setDensity(180).setFriction(0.8)], 'bale');
};
const crate = (x, y, z, s = 0.9) => {
  const m = new THREE.Mesh(boxM(s, s, s), woodMat); m.position.set(x, y, z);
  addBody(m, RAPIER.RigidBodyDesc.dynamic(), [RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(120).setFriction(0.7)], 'crate');
};
export const truck = new THREE.Group();
if (!CITY) {
for (let k = 0; k < 14; k++) { const a = k * 0.9; bale(-14 + Math.cos(a) * (8 + k), -26 + Math.sin(a) * 6 - k * 1.5); }
{ const bx = 11, bz = -18, y0 = height(bx, bz) + 0.45; for (let r = 0; r < 4; r++) for (let c = 0; c < 4 - r; c++) crate(bx + (c - (3 - r) / 2) * 0.92, y0 + 0.01 + r * 0.91, bz); } // 1 cm settle gaps: exact contact made spawn jolts break crates
// fence: posts static (merged), rails dynamic
for (let k = 0; k < 12; k++) {
  const z = -6 - k * 4, x = 9.5, y = height(x, z);
  addStatic(boxM(0.16, 1.4, 0.16), woodMat, x, y + 0.55, z); fixedCol(x, y + 0.55, z, 0.08, 0.7, 0.08);
  if (k < 11) { const m = new THREE.Mesh(boxM(0.07, 0.16, 4), woodMat); m.position.set(x, height(x, z - 2) + 1.0, z - 2); addBody(m, RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(0.035, 0.08, 1.9).setDensity(500)], 'rail'); } // nailed: fixed until a hit shatters it (sim/breakables.js); 1.9 half-length clears the posts
}
// old green pickup (rusted), heavy
{
  const x = 3, z = -36, body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 5), rustMat); body.position.y = 0.2;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.8), rustMat); cab.position.set(0, 1.05, 0.4);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.5, 1.4), std({ color: 0x0b1018, roughness: 0.05, metalness: 0.9 })); glass.position.set(0, 1.2, 0.4);
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xfff2c8, emissiveIntensity: 0 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.05), lamp); head.position.set(0, 0.35, 2.52);
  truck.add(body, cab, glass, head);
  for (const [wx, wz] of [[-0.95, 1.6], [0.95, 1.6], [-0.95, -1.6], [0.95, -1.6]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 20), std({ color: 0x151515 })); w.rotation.z = Math.PI / 2; w.position.set(wx, -0.3, wz); truck.add(w); }
  truck.position.set(x, height(x, z) + 0.75, z); truck.rotation.y = 0.3;
  addBody(truck, RAPIER.RigidBodyDesc.dynamic().setAngularDamping(0.5), [RAPIER.ColliderDesc.cuboid(1, 0.75, 2.5).setDensity(260).setFriction(0.9)], 'truck');
  const hl = new THREE.SpotLight(0xfff2c8, 0, 40, 0.5, 0.6); hl.position.set(0, 0.35, 2.5); hl.target.position.set(0, -0.5, 10); truck.add(hl, hl.target);
  truck.userData = { hl, lamp };
}

} // end Rushville props

// ---------- barn, water tower, poles (static, merged) ----------
const night = { lights: [] };
if (!CITY) {
  const x = -40, z = -70, y = height(x, z) - 0.2, ry = 0.2, c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  addStatic(boxM(14, 8, 20), barnRed, x, y + 4, z, ry); fixedCol(x, y + 4, z, 7, 4, 10, ry);
  const roof = new THREE.CylinderGeometry(8.5, 8.5, 20.6, 3); roof.rotateX(-Math.PI / 2); roof.scale(1, 0.55, 1);
  { const uv = roof.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 8, uv.getY(k) * 6); }
  addStatic(roof, roofMat, x, y + 10.3, z, ry);
  for (const [lx, lz, w, h] of [[7.05, 0, 0.12, 5], [7.05, -4.5, 0.12, 2.2]]) { const [px, pz] = at(lx, lz); addStatic(boxM(w, h, 4.2), woodMat, px, y + h / 2 + (h < 3 ? 5 : 0), pz, ry); } // doors + hayloft
  const [wx, wz] = at(7.08, 6);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0xffb35a, emissiveIntensity: 0, roughness: 0.2 }));
  win.position.set(wx, y + 4.5, wz); win.rotation.y = ry + Math.PI / 2; scene.add(win);
  const wl = new THREE.PointLight(0xffa04a, 0, 18, 2); wl.position.set(wx + 1.5, y + 4.5, wz); scene.add(wl);
  night.lights.push([wl, 30], [win.material, 4, 'emissiveIntensity']);
  // water tower
  const tx = -52, tz = -38, ty = height(tx, tz);
  for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { addStatic(new THREE.CylinderGeometry(0.16, 0.2, 14, 10), tankMat, tx + lx, ty + 7, tz + lz); fixedCol(tx + lx, ty + 7, tz + lz, 0.2, 7, 0.2, 0, 'metal'); }
  for (const yy of [4, 9]) for (const [a, b, r] of [[0, -2, 0], [0, 2, 0], [-2, 0, Math.PI / 2], [2, 0, Math.PI / 2]]) addStatic(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), tankMat, tx + a, ty + yy, tz + b, r, 0, Math.PI / 2);
  const tank = new THREE.CylinderGeometry(4.2, 4.2, 5, 40); { const uv = tank.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 8, uv.getY(k) * 1.5); }
  addStatic(tank, tankMat, tx, ty + 16.5, tz); addStatic(new THREE.ConeGeometry(4.4, 2, 40), roofMat, tx, ty + 20, tz);
  statics.push({ collider: physics.createCollider(RAPIER.ColliderDesc.cylinder(3.5, 4.2).setTranslation(tx, ty + 17.5, tz)), mat: 'metal' });
  const lbl = makeSign('RUSHVILLE'); lbl.position.set(tx, ty + 16.5, tz + 4.25); scene.add(lbl);
  // telephone poles + sagging wires along the road
  const wireMat = std({ color: 0x1a1a1a, roughness: 0.6 }), poleMat = woodMat;
  let prev = null;
  for (let pz = 40; pz > -260; pz -= 32) {
    const px = 3.2, py = height(px, pz);
    addStatic(new THREE.CylinderGeometry(0.13, 0.17, 9, 8), poleMat, px, py + 4.5, pz); addStatic(boxM(1.8, 0.12, 0.12), poleMat, px, py + 8.4, pz);
    fixedCol(px, py + 4.5, pz, 0.17, 4.5, 0.17);
    if (prev) for (const off of [-0.75, 0, 0.75]) {
      const a = new THREE.Vector3(px + off, py + 8.5, pz), b = new THREE.Vector3(px + off, prev.y + 8.5, prev.z), m = a.clone().lerp(b, 0.5); m.y -= 0.7;
      addStatic(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 12, 0.012, 4), wireMat, 0, 0, 0);
    }
    prev = { y: py, z: pz };
  }
  // grain elevator on the horizon: the town
  for (let k = 0; k < 4; k++) addStatic(new THREE.CylinderGeometry(4, 4, 34, 24), std({ color: 0xc9c2b4, roughness: 0.9 }), -140 + k * 8.2, 17, -420);
  addStatic(boxM(10, 46, 10), std({ color: 0xbdb5a5, roughness: 0.9 }), -150, 23, -420);
}
function makeSign(text) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const x = cv.getContext('2d');
  x.font = '900 72px Georgia, serif'; x.fillStyle = '#1d2a3a'; x.textAlign = 'center'; x.fillText(text, 256, 74);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.2), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8 }));
}

// ---------- trees: EZ-Tree variants, drawn instanced ----------
const trees = [];
if (!CITY) {
  const spots = { 'Ash Medium': [], 'Oak Medium': [], 'Aspen Medium': [] }, names = Object.keys(spots);
  let k = 0;
  for (let x = -175; x <= 170; x += 9 + Math.random() * 4) spots[names[k++ % 3]].push([x, -195 - Math.random() * 6]); // shelterbelt
  for (let z = -170; z <= 20; z += 11 + Math.random() * 4) spots[names[k++ % 3]].push([-192 - Math.random() * 5, z]);
  for (const [x, z] of [[-26, -56], [-56, -84], [-30, -88], [-58, -60], [-22, -76], [-64, -26]]) spots[names[k++ % 3]].push([x, z]); // farmstead
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const name of names) {
    const t = new Tree(); t.loadPreset(name); t.options.seed = 1000 + names.indexOf(name) * 77; t.generate();
    t.update(0); trees.push(t);
    const n = spots[name].length;
    // trunk size from the generated mesh: widest vertex in the bottom 1.5 m, trunk ≈ lower 40% of the tree
    let tr = 0.15, top = 0; { const pa = t.branchesMesh.geometry.attributes.position;
      for (let v = 0; v < pa.count; v++) { const y = pa.getY(v); top = Math.max(top, y); if (y < 1.5) tr = Math.max(tr, Math.hypot(pa.getX(v), pa.getZ(v))); } }
    tr = Math.min(tr, 0.8); const trunkH = Math.max(2, top * 0.4);
    // EZ-Tree presets aren't in metres (these are 65-79 units tall): scale each tree to a real 15-22 m
    let crownW = 0; { const pa = t.branchesMesh.geometry.attributes.position; for (let v = 0; v < pa.count; v++) crownW = Math.max(crownW, Math.hypot(pa.getX(v), pa.getZ(v))); }
    const scales = spots[name].map(() => (15 + Math.random() * 7) / top), rots = spots[name].map(() => Math.random() * 6.28); // shared by branches + leaves so they line up
    for (const part of [t.branchesMesh, t.leavesMesh]) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, n);
      spots[name].forEach(([x, z], i) => { q.setFromAxisAngle(up, rots[i]); const s = scales[i]; m4.compose(new THREE.Vector3(x, height(x, z) - 0.2, z), q, sc.set(s, s, s)); im.setMatrixAt(i, m4); });
      im.castShadow = im.receiveShadow = true;
      if (part === t.branchesMesh) spots[name].forEach(([x, z], i) => { const s = scales[i], hh = trunkH * s / 2, y = height(x, z) - 0.2;
        const r = Math.max(0.18, tr * s);
        trunks.push(physics.createCollider(RAPIER.ColliderDesc.capsule(Math.max(0.1, hh - r), r).setTranslation(x, y + hh, z).setFriction(0.9)));
        // crown: a ball around the main limbs so flying into the canopy stops you (leaves past it stay soft)
        trunks.push(physics.createCollider(RAPIER.ColliderDesc.ball(crownW * s * 0.42).setTranslation(x, y + top * s * 0.62, z).setFriction(0.6))); });
      if (part === t.leavesMesh) { // EZ-Tree's leaf wind shader replaces project_vertex and drops instanceMatrix: put it back
        const orig = part.material.onBeforeCompile;
        part.material.onBeforeCompile = (sh, r) => { orig(sh, r); sh.vertexShader = sh.vertexShader.replace('mvPosition = modelViewMatrix * mvPosition;', '#ifdef USE_INSTANCING\n mvPosition = instanceMatrix * mvPosition;\n#endif\n mvPosition = modelViewMatrix * mvPosition;'); };
        part.material.needsUpdate = true;
      }
      if (part === t.leavesMesh) im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: part.material.map, alphaTest: part.material.alphaTest });
      scene.add(im);
    }
  }
}

// ---------- Gurugram (?level=gurugram): real OSM city under one root group ----------
if (CITY) {
  const { buildCity } = await import('./city/osmcity.js');
  city = await buildCity({ physics, RAPIER, props, statics, LANTERN, SPAWN, setTerrainCollider, addBody: (m, d, c, k, parent) => addBody(m, d, c, k, parent),
    pbrTex: (id, repeat) => ({ map: tex(`/tex/${id}/diff.jpg`, true, repeat) }) });
}

// ---------- the power battery (lantern) on the knoll ----------
export const lantern = new THREE.Group();
{
  const y = height(LANTERN.x, LANTERN.z);
  lantern.position.set(LANTERN.x, y, LANTERN.z); LANTERN.y = y;
  const shell = std({ color: 0x1f3a26, metalness: 0.85, roughness: 0.35 });
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dff6e).multiplyScalar(6) });
  const parts = [];
  const add = (g, py, px = 0, pz = 0) => { g.translate(px, py, pz); parts.push(g); };
  add(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 24), 0.12);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; add(new THREE.BoxGeometry(0.07, 1.15, 0.07), 0.8, Math.cos(a) * 0.46, Math.sin(a) * 0.46); }
  add(new THREE.CylinderGeometry(0.62, 0.5, 0.2, 24), 1.45);
  add(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 1.55);
  add(new THREE.TorusGeometry(0.3, 0.04, 8, 24, Math.PI), 1.95);
  const strip = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; };
  const sm = new THREE.Mesh(mergeGeometries(parts.map(strip)), shell); sm.castShadow = true;
  const cm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 24).translate(0, 0.8, 0), core);
  lantern.add(sm, cm);
  const pl = new THREE.PointLight(0x3dff6e, 60, 28, 2); pl.position.y = 1.2; lantern.add(pl);
  lantern.userData.light = pl; lantern.userData.core = core;
  scene.add(lantern);
  statics.push({ collider: physics.createCollider(RAPIER.ColliderDesc.cylinder(1, 0.6).setTranslation(LANTERN.x, y + 1, LANTERN.z)), mat: 'metal' });
}
flushStatic();

// ---------- sky: physical sky + cloud layer; stars/moon at night ----------
const cloudMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
  uniforms: { uTime: GU.uTime, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uCover: { value: 0.5 }, uNight: { value: 0 } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
  fragmentShader: `uniform float uTime, uCover, uNight; uniform vec3 uSun, uSunCol, uShade; varying vec3 vD;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float a = .5, s = 0.; for (int k = 0; k < 6; k++){ s += a * n(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= .5; } return s; }
    float dens(vec2 uv){ float w = fbm(uv * 0.6); return smoothstep(uCover, uCover + 0.32, fbm(uv + w * 0.8)); }
    void main(){
      vec3 d = normalize(vD);
      if (d.y < 0.02) discard;
      vec2 uv = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
      float c = dens(uv);
      if (c < 0.01) discard;
      float toward = dens(uv + normalize(uSun.xz + 1e-4) * 0.12);
      float lit = clamp(1. - (toward - c) * 2.2 - toward * 0.35, 0., 1.);       // self-shadow: thick toward the sun = darker
      float silver = pow(max(dot(d, uSun), 0.), 10.) * (1. - c) * 2.5;          // bright rim around the sun
      vec3 col = mix(uShade, uSunCol, lit) + uSunCol * silver;
      float horizon = smoothstep(0.02, 0.22, d.y);
      gl_FragColor = vec4(col * (1. - uNight * 0.85), c * horizon * 0.95);
    }`,
});
const cloudDome = new THREE.Mesh(new THREE.SphereGeometry(880, 48, 24), cloudMat);
cloudDome.renderOrder = -1; cloudDome.frustumCulled = false; scene.add(cloudDome);

let stars, moon;
{
  const n = 3000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const u = Math.random(), th = Math.random() * Math.PI * 2, y = 0.05 + u * 0.95, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * r * 850, y * 850, Math.sin(th) * r * 850], k * 3);
    c.setHSL(0.6 - Math.random() * 0.5, 0.3, 0.6 + Math.random() * 0.4).multiplyScalar(Math.random() < 0.06 ? 4 : 1.2); col.set([c.r, c.g, c.b], k * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  stars.renderOrder = -2; scene.add(stars);
  moon = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8eeff).multiplyScalar(3.4), fog: false }));
  scene.add(moon);
}

// ---------- time of day ----------
const TIMES = {
  day: {
    sky: { sun: [38, 215], turbidity: 2, rayleigh: 2.5, mie: 0.004, fog: 0xb9cde6, fogDensity: 0.0024, sunColor: 0xfff0d8, sunIntensity: 3.6,
      hemiSky: 0xbcd6ff, hemiGround: 0x6e5c3c, hemiIntensity: 0.65, envIntensity: 1, exposure: 0.6, clouds: 0, sea: null, motes: null,
      grade: { tint: [1.02, 1, 0.97], sat: 1.06, vignette: 0.28, contrast: 1.05 } },
    cloud: { sun: 0xfff6ea, shade: 0x8f9bb3, cover: 0.52 }, night: 0, starVis: false,
  },
  night: {
    sky: { gradient: [0x030713, 0x0e1a36, 0x223a66], sun: [24, 210], fog: 0x0a1428, fogDensity: 0.0075, sunColor: 0xaecbff, sunIntensity: 2.2,
      hemiSky: 0x4a6aa0, hemiGround: 0x2a2014, hemiIntensity: 0.9, envIntensity: 0.8, exposure: 1.0, clouds: 0, sea: null, motes: 0xd6ff7a,
      grade: { tint: [0.95, 1, 1.08], sat: 1.05, vignette: 0.45, contrast: 1.08 } },
    cloud: { sun: 0x2a3550, shade: 0x0a0f1c, cover: 0.62 }, night: 1, starVis: true,
  },
};
// Gurugram: NCR haze (warm dusty fog, soft sun, hazy horizon); night = light-polluted orange-brown sky
const TIMES_CITY = {
  day: {
    sky: { sun: [40, 200], turbidity: 10, rayleigh: 0.55, mie: 0.035, fog: 0xc2b6a2, fogDensity: 0.0026, sunColor: 0xffdcae, sunIntensity: 2.3,
      hemiSky: 0xddd0b8, hemiGround: 0x6a5a48, hemiIntensity: 0.95, envIntensity: 0.85, exposure: 0.6, clouds: 0, sea: null, motes: null,
      grade: { tint: [1.06, 1.0, 0.9], sat: 0.84, vignette: 0.24, contrast: 0.95 } },
    cloud: { sun: 0xeee0c8, shade: 0xc0b19c, cover: 0.42 }, night: 0, starVis: false,
  },
  night: {
    sky: { gradient: [0x0a0b12, 0x2a2026, 0x6b4630], sun: [20, 200], fog: 0x2a2026, fogDensity: 0.0045, sunColor: 0x8a90b0, sunIntensity: 0.7,
      hemiSky: 0x5a4a5a, hemiGround: 0x3a2a20, hemiIntensity: 0.9, envIntensity: 0.6, exposure: 1.0, clouds: 0, sea: null, motes: null,
      grade: { tint: [1.04, 0.98, 0.94], sat: 1.05, vignette: 0.4, contrast: 1.08 } },
    cloud: { sun: 0x4a3a34, shade: 0x1a1416, cover: 0.55 }, night: 1, starVis: false,
  },
};
export let timeOfDay = 'day';
export function setTime(t) {
  timeOfDay = t; const T = (CITY ? TIMES_CITY : TIMES)[t];
  setSky(T.sky);
  cloudMat.uniforms.uSunCol.value.set(T.cloud.sun); cloudMat.uniforms.uShade.value.set(T.cloud.shade); cloudMat.uniforms.uCover.value = T.cloud.cover; cloudMat.uniforms.uNight.value = T.night;
  stars.visible = moon.visible = T.starVis;
  for (const [o, v, key = 'intensity'] of night.lights) o[key] = T.night ? v : 0;
  if (truck.userData.hl) { truck.userData.hl.intensity = T.night ? 40 : 0; truck.userData.lamp.emissiveIntensity = T.night ? 5 : 0; }
  city?.setNight(T.night);
  lantern.userData.light.distance = T.night ? 28 : 14;
}
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 220 }); sun.shadow.camera.updateProjectionMatrix();
setTime(settings.time ?? 'day');

export function skyFollow(cam) {
  stars.position.copy(cam.position); cloudDome.position.copy(cam.position);
  moon.position.setFromSphericalCoords(800, THREE.MathUtils.degToRad(66), THREE.MathUtils.degToRad(210)).add(cam.position); moon.lookAt(cam.position);
  cloudMat.uniforms.uSun.value.copy(sun.position).sub(sun.target.position).normalize();
}
export function updateWorld(t, center) { updateFields(center); for (const tr of trees) tr.update(t); city?.update(t); }

// ---------- fixed-step physics + interpolated mesh sync ----------
// Physics ticks at 60 Hz; meshes are drawn between the last two states, so motion stays smooth on 120 Hz displays.
export function track(body, mesh) {
  const t = body.translation(), r = body.rotation();
  const e = { body, mesh, p0: new THREE.Vector3(t.x, t.y, t.z), q0: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
  e.p1 = e.p0.clone(); e.q1 = e.q0.clone(); bodies.push(e); return e;
}
export const untrack = (body) => { const k = bodies.findIndex((b) => b.body === body); if (k >= 0) bodies.splice(k, 1); };
export const STEP = 1 / 60;
let acc = 0;
export let physAlpha = 0; // how far between the last two physics states this frame is drawn
export function stepPhysics(dt, beforeStep) {
  acc = Math.min(acc + dt, 0.1); // cap: no spiral of death after a hitch
  while (acc >= STEP) {
    beforeStep?.(STEP); physics.step(events); acc -= STEP;
    for (const b of bodies) {
      b.p0.copy(b.p1); b.q0.copy(b.q1);
      const t = b.body.translation(), r = b.body.rotation();
      b.p1.set(t.x, t.y, t.z); b.q1.set(r.x, r.y, r.z, r.w);
    }
  }
  const a = (physAlpha = acc / STEP);
  for (const b of bodies) { b.mesh.position.lerpVectors(b.p0, b.p1, a); b.mesh.quaternion.slerpQuaternions(b.q0, b.q1, a); }
}

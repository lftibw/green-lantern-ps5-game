// Rushville, Nebraska, night: rolling terrain, wind-blown wheat, moon + stars, farm props (Rapier bodies), the power battery.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, setSky, sun, Q } from './gfx.js';

await RAPIER.init();
export { RAPIER };
export const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
export const bodies = []; // { body, mesh } synced each step
export const GU = { uTime: { value: 0 }, uPush: { value: [new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0)] } };
export const LANTERN = new THREE.Vector3(38, 0, -62);

// ---------- terrain ----------
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function height(x, z) {
  let h = (vnoise(x * 0.012, z * 0.012) - 0.5) * 10 + (vnoise(x * 0.04, z * 0.04) - 0.5) * 2.2;
  const dl = Math.hypot(x - LANTERN.x, z - LANTERN.z);
  h += 9 * Math.exp(-(dl * dl) / 900); // the lantern's hill
  const ds = Math.hypot(x, z);
  return h * Math.min(1, 0.25 + ds / 60); // keep spawn gently flat
}

const SIZE = 600, SEG = 240;
{
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k); p.setY(k, height(x, z));
    const n = vnoise(x * 0.15, z * 0.15);
    c.setRGB(0.16 + n * 0.08, 0.13 + n * 0.06, 0.08); // dry soil / stubble
    col.set([c.r, c.g, c.b], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: noiseTex(512, [70, 58, 40], 40), }));
  m.material.map.repeat.set(80, 80);
  m.receiveShadow = true; scene.add(m);
  const idx = g.index.array;
  physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(p.array), new Uint32Array(idx)).setFriction(0.9));
}

function noiseTex(n, rgb, amp, streaks = 0) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const x = cv.getContext('2d'), img = x.createImageData(n, n);
  for (let k = 0; k < n * n; k++) {
    const v = (Math.random() - 0.5) * amp;
    img.data.set([rgb[0] + v, rgb[1] + v * 0.9, rgb[2] + v * 0.7, 255], k * 4);
  }
  x.putImageData(img, 0, 0);
  for (let k = 0; k < streaks; k++) { // straw / wood grain strokes
    x.strokeStyle = `rgba(${rgb[0] + 40},${rgb[1] + 30},${rgb[2]},${0.15 + Math.random() * 0.3})`;
    x.lineWidth = 1 + Math.random() * 2; x.beginPath();
    const y = Math.random() * n; x.moveTo(0, y); x.bezierCurveTo(n / 3, y + Math.random() * 20 - 10, n * 2 / 3, y + Math.random() * 20 - 10, n, y + Math.random() * 10 - 5); x.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------- wheat: instanced stalks + ears, wind + push-away from player/constructs ----------
{
  const stalk = new THREE.PlaneGeometry(0.03, 1.1, 1, 4); stalk.translate(0, 0.55, 0);
  const ear = new THREE.CylinderGeometry(0.018, 0.028, 0.16, 5, 1); ear.translate(0, 1.16, 0);
  const geo = mergeGeometries([stalk.toNonIndexed(), ear.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; }));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = GU.uTime; s.uniforms.uPush = GU.uPush;
    s.vertexShader = 'uniform float uTime; uniform vec4 uPush[3];\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp0 = instanceMatrix * vec4(0., 0., 0., 1.);
      float hgt = clamp(position.y / 1.2, 0., 1.); float bend = hgt * hgt;
      float gust = sin(uTime * 1.3 + wp0.x * 0.08 + wp0.z * 0.05) * 0.5 + sin(uTime * 3.1 + wp0.x * 0.4) * 0.15;
      vec3 off = vec3(gust * 0.35, 0., gust * 0.18) * bend;
      for (int k = 0; k < 3; k++) {
        vec2 d = wp0.xz - uPush[k].xz; float r = uPush[k].w; float dist = length(d);
        float near = 1. - smoothstep(r * 0.4, r, dist);
        float vert = 1. - smoothstep(0., r + 1.5, abs(wp0.y - uPush[k].y));
        off.xz += normalize(d + 0.001) * near * vert * bend * 0.9; off.y -= near * vert * bend * 0.35;
      }
      transformed += (inverse(mat3(modelMatrix * instanceMatrix)) * off);`);
  };
  const N = Math.round(Q().grass * 5000) || 30000; // high ≈ 110k stalks
  const im = new THREE.InstancedMesh(geo, mat, N);
  im.receiveShadow = true; im.castShadow = false; im.frustumCulled = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), c = new THREE.Color(), v = new THREE.Vector3();
  let k = 0;
  while (k < N) {
    const x = (Math.random() - 0.5) * 220, z = -Math.random() * 200 + 40;
    if (Math.abs(x - 6) < 2.5 || vnoise(x * 0.05, z * 0.05) < 0.3) continue; // dirt track + bare patches
    e.set((Math.random() - 0.5) * 0.25, Math.random() * Math.PI, (Math.random() - 0.5) * 0.25); q.setFromEuler(e);
    const s = 0.8 + Math.random() * 0.45; sc.set(s, s * (0.85 + Math.random() * 0.3), s);
    m4.compose(v.set(x, height(x, z) - 0.05, z), q, sc); im.setMatrixAt(k, m4);
    im.setColorAt(k, c.setHSL(0.11 + Math.random() * 0.03, 0.55, 0.42 + Math.random() * 0.15));
    k++;
  }
  scene.add(im);
}

let export_stars, export_moon;
// ---------- sky: moonlit night, stars, fireflies (gfx motes) ----------
setSky({
  gradient: [0x030713, 0x0e1a36, 0x223a66], sun: [24, 210], fog: 0x0a1428, fogDensity: 0.0075,
  sunColor: 0xaecbff, sunIntensity: 2.2, hemiSky: 0x4a6aa0, hemiGround: 0x2a2014, hemiIntensity: 0.9, envIntensity: 0.8,
  exposure: 1.5, clouds: 0, sea: null, motes: 0xd6ff7a, grade: { tint: [0.95, 1, 1.08], sat: 1.05, vignette: 0.45, contrast: 1.08 },
});
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
{
  const n = 3000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const u = Math.random(), th = Math.random() * Math.PI * 2, y = 0.05 + u * 0.95, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * r * 850, y * 850, Math.sin(th) * r * 850], k * 3);
    c.setHSL(0.6 - Math.random() * 0.5, 0.3, 0.6 + Math.random() * 0.4).multiplyScalar(Math.random() < 0.06 ? 4 : 1.2); col.set([c.r, c.g, c.b], k * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  stars.renderOrder = -2; scene.add(stars);
  export_stars = stars;
  const moon = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8eeff).multiplyScalar(3.4), fog: false }));
  moon.position.setFromSphericalCoords(800, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(210)); moon.lookAt(0, 0, 0);
  scene.add(moon); export_moon = moon;
}
export const skyFollow = (cam) => { export_stars.position.copy(cam.position); export_moon.position.setFromSphericalCoords(800, THREE.MathUtils.degToRad(66), THREE.MathUtils.degToRad(210)).add(cam.position); };

// ---------- props ----------
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
const hayMat = std({ map: noiseTex(256, [150, 118, 62], 50, 220), color: 0xb8a070 });
const hayEnd = std({ map: noiseTex(256, [130, 100, 55], 60, 0) });
const woodMat = std({ map: noiseTex(256, [92, 64, 40], 40, 120) });
const barnMat = std({ map: noiseTex(256, [110, 28, 22], 30, 160), roughness: 0.9 });
const metal = std({ color: 0x8a9096, roughness: 0.45, metalness: 0.8 });

function addBody(mesh, desc, colliders, dyn = true) {
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  const body = physics.createRigidBody(desc.setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation(mesh.quaternion));
  colliders.forEach((c) => physics.createCollider(c, body));
  if (dyn) bodies.push({ body, mesh });
  return body;
}
const groundY = (x, z) => height(x, z);

function bale(x, z, rotY = Math.random() * 3) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 28), [hayMat, hayEnd, hayEnd]);
  m.rotation.set(0, rotY, Math.PI / 2); m.position.set(x, groundY(x, z) + 0.78, z);
  addBody(m, RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.1).setAngularDamping(1.5).setSleeping(true), [RAPIER.ColliderDesc.cylinder(0.65, 0.75).setDensity(180).setFriction(0.8)]);
}
function crate(x, y, z, s = 0.9) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), woodMat);
  m.position.set(x, y, z);
  addBody(m, RAPIER.RigidBodyDesc.dynamic(), [RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(120).setFriction(0.7)]);
}
function fixedBox(x, y, z, w, h, d, mat, rotY = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = rotY;
  return addBody(m, RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)], false);
}

for (let k = 0; k < 14; k++) { const a = k * 0.9; bale(-14 + Math.cos(a) * (8 + k), -26 + Math.sin(a) * 6 - k * 1.5); }
// crate pyramid next to the track
{ const bx = 12, bz = -18, y0 = groundY(bx, bz) + 0.45; for (let r = 0; r < 4; r++) for (let c = 0; c < 4 - r; c++) crate(bx + (c - (3 - r) / 2) * 0.92, y0 + r * 0.9, bz); }
// fence along the track (dynamic rails, fixed posts)
for (let k = 0; k < 12; k++) {
  const z = -6 - k * 4, x = 9.5;
  fixedBox(x, groundY(x, z) + 0.6, z, 0.18, 1.3, 0.18, woodMat);
  if (k < 11) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 4), woodMat); m.position.set(x, groundY(x, z - 2) + 1.0, z - 2); addBody(m, RAPIER.RigidBodyDesc.dynamic(), [RAPIER.ColliderDesc.cuboid(0.04, 0.09, 2).setDensity(500)]); }
}
// old pickup: heavy (needs a big construct and real will)
{
  const x = 3, z = -36, g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 5), std({ color: 0x3d5a6e, roughness: 0.5, metalness: 0.6 })); body.position.y = 0.2;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.8), body.material); cab.position.set(0, 1.05, 0.4);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.5, 1.4), std({ color: 0x0b1018, roughness: 0.1, metalness: 0.9 })); glass.position.set(0, 1.2, 0.4);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2c8).multiplyScalar(5) })); head.position.set(0, 0.35, 2.52);
  g.add(body, cab, glass, head);
  for (const [wx, wz] of [[-0.95, 1.6], [0.95, 1.6], [-0.95, -1.6], [0.95, -1.6]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 20), std({ color: 0x111111 })); w.rotation.z = Math.PI / 2; w.position.set(wx, -0.3, wz); g.add(w);
  }
  g.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  g.position.set(x, groundY(x, z) + 0.75, z); g.rotation.y = 0.3;
  addBody(g, RAPIER.RigidBodyDesc.dynamic().setAngularDamping(0.5), [RAPIER.ColliderDesc.cuboid(1, 0.75, 2.5).setDensity(260).setFriction(0.9)]);
  const hl = new THREE.SpotLight(0xfff2c8, 40, 40, 0.5, 0.6); hl.position.set(0, 0.35, 2.5); hl.target.position.set(0, -0.5, 10); g.add(hl, hl.target);
}
// barn + water tower (static landmarks)
{
  const x = -40, z = -70, y = groundY(x, z);
  fixedBox(x, y + 4, z, 14, 8, 20, barnMat, 0.2);
  const rg = new THREE.Group(); rg.position.set(x, y, z); rg.rotation.y = 0.2; scene.add(rg);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 20.4, 3), std({ color: 0x2a2d31, metalness: 0.7, roughness: 0.5 }));
  roof.rotation.x = -Math.PI / 2; roof.scale.z = 0.55; roof.position.y = 10.3; roof.castShadow = true; rg.add(roof); // triangular prism, apex up
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb35a).multiplyScalar(4) }));
  win.position.set(7.02, 5, 3); win.rotation.y = Math.PI / 2; rg.add(win);
  const wl = new THREE.PointLight(0xffa04a, 30, 18, 2); wl.position.set(9, 5, 3); rg.add(wl);
  const tx = -60, tz = -40, ty = groundY(tx, tz);
  for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) fixedBox(tx + lx, ty + 7, tz + lz, 0.35, 14, 0.35, metal);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 5, 32), std({ color: 0xc9ccd0, metalness: 0.6, roughness: 0.4 }));
  tank.position.set(tx, ty + 16.5, tz); tank.castShadow = true; scene.add(tank);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2, 32), tank.material); cap.position.set(tx, ty + 20, tz); scene.add(cap);
  physics.createCollider(RAPIER.ColliderDesc.cylinder(3.5, 4.2).setTranslation(tx, ty + 17.5, tz));
  const lbl = makeSign('RUSHVILLE'); lbl.position.set(tx, ty + 16.5, tz + 4.25); scene.add(lbl);
}
function makeSign(text) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const x = cv.getContext('2d');
  x.font = '900 72px Georgia, serif'; x.fillStyle = '#1d2a3a'; x.textAlign = 'center'; x.fillText(text, 256, 74);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.2), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8 }));
}
// distant town lights on the horizon
{
  const n = 160, pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { const a = -0.6 + Math.random() * 0.9, r = 260 + Math.random() * 40; pos.set([Math.cos(a) * r - 40, 1 + Math.random() * 3, Math.sin(a) * r - 260], k * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(0xffc27a).multiplyScalar(3), size: 2.5, sizeAttenuation: false, fog: false })));
}

// ---------- the power battery (lantern) on the hill ----------
export const lantern = new THREE.Group();
{
  const y = groundY(LANTERN.x, LANTERN.z);
  lantern.position.set(LANTERN.x, y, LANTERN.z); LANTERN.y = y;
  const shell = std({ color: 0x1f3a26, metalness: 0.85, roughness: 0.35 });
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dff6e).multiplyScalar(6) });
  const add = (g, m, py) => { const o = new THREE.Mesh(g, m); o.position.y = py; o.castShadow = true; lantern.add(o); return o; };
  add(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 24), shell, 0.12);
  add(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 24), core, 0.8);
  for (let k = 0; k < 8; k++) { const b = add(new THREE.BoxGeometry(0.07, 1.15, 0.07), shell, 0.8); const a = (k / 8) * Math.PI * 2; b.position.x = Math.cos(a) * 0.46; b.position.z = Math.sin(a) * 0.46; }
  add(new THREE.CylinderGeometry(0.62, 0.5, 0.2, 24), shell, 1.45);
  add(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shell, 1.55);
  const h = add(new THREE.TorusGeometry(0.3, 0.04, 8, 24, Math.PI), shell, 1.95);
  const pl = new THREE.PointLight(0x3dff6e, 60, 28, 2); pl.position.y = 1.2; lantern.add(pl);
  lantern.userData.light = pl; lantern.userData.core = core;
  scene.add(lantern);
  physics.createCollider(RAPIER.ColliderDesc.cylinder(1, 0.6).setTranslation(LANTERN.x, y + 1, LANTERN.z));
}

// ---------- fixed-step physics + mesh sync ----------
let acc = 0;
export function stepPhysics(dt, beforeStep) {
  acc = Math.min(acc + dt, 0.1);
  while (acc >= 1 / 60) { beforeStep?.(1 / 60); physics.step(); acc -= 1 / 60; }
  for (const b of bodies) {
    const t = b.body.translation(), r = b.body.rotation();
    b.mesh.position.set(t.x, t.y, t.z); b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

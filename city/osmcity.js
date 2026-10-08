// Gurugram from real OpenStreetMap data (tools/bake-osm.mjs → public/osm/gurugram.json). © OpenStreetMap contributors.
// Everything lives under one root group (floating-origin ready). Buildings are merged per material into a 4×4 tile grid
// (frustum-culled per tile); everything repeated is instanced. No world.js import: physics/helpers arrive via ctx
// (world.js awaits this module, so importing world back would deadlock the load).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../gfx.js';

// ---------- small deterministic helpers ----------
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const lerp = THREE.MathUtils.lerp;
function ring(p) { const pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]); if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop(); return pts; }
function area(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; }
function centroid(pts) { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }
function inside(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
function obb(pts) { // min-area oriented box over the polygon's edge directions
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], a = Math.atan2(bz - az, bx - ax), c = Math.cos(a), s = Math.sin(a);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) { const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; best = { A, ang: a, hx: (u1 - u0) / 2, hz: (v1 - v0) / 2, cx: cu * c - cv * s, cz: cu * s + cv * c }; }
  }
  return best;
}
const shrink = (pts, k, [cx, cz]) => pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
function addAttr(g, name, v) { g.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; }
function clean(g) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aTone', 'aSeed', 'aKind', 'color'].includes(k)) g.deleteAttribute(k); return g; }
// extrude a footprint (x,z pts) from y0 to y1
function prism(pts, y0, y1) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}

// ---------- shared shader bits ----------
const NOISE = `float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }`;
export const CU = { uNight: { value: 0 }, uTime: { value: 0 } }; // city uniforms

// office glass curtain wall: mullion grid, spandrels, env reflection (PBR Fresnel), random lit windows at night
function glassMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.08, envMapIntensity: 1.2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = 'attribute float aTone; attribute float aSeed; varying float vTone; varying float vSeed; varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vTone = aTone; vSeed = aSeed; vWP = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `uniform float uNight; varying float vTone; varying float vSeed; varying vec3 vWP; varying vec3 vWN; ${NOISE}\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float roof = step(0.6, abs(vWN.y));
        vec2 t = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
        float u = dot(vWP.xz, t), v = vWP.y;
        vec2 cell = vec2(floor(u / 1.6), floor(v / 3.7));
        float mul = max(step(0.94, fract(u / 1.6)), step(0.9, fract(v / 3.7)));     // vertical + horizontal mullions
        float spandrel = step(fract(v / 3.7), 0.24);                                  // opaque floor band
        vec3 tint = mix(mix(vec3(0.26, 0.38, 0.42), vec3(0.32, 0.34, 0.36), step(0.4, vTone)), vec3(0.36, 0.3, 0.22), step(0.8, vTone));
        vec3 glass = tint * (0.55 + 0.15 * n2(cell * 0.7 + vSeed));
        vec3 frame = vec3(0.42, 0.44, 0.46);
        diffuseColor.rgb = roof > 0.5 ? vec3(0.32, 0.31, 0.3) * (0.7 + 0.3 * n2(vWP.xz * 0.4)) : mix(mix(glass, glass * 0.6, spandrel), frame, mul);
        float isGlass = (1. - roof) * (1. - mul) * (1. - spandrel);
        float lit = step(0.8, h2(cell + vSeed * 31.7)) * isGlass * uNight; // ~20% of office windows lit late`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.6, 0.06, isGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(0.35, 0.9, isGlass) * (1. - uNight * 0.5);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += lit * mix(vec3(1., 0.85, 0.6), vec3(0.75, 0.88, 1.), step(0.7, h2(cell * 1.7))) * (0.35 + 0.6 * h2(cell * 3.1));`);
  };
  return m;
}
// plaster/concrete: per-building tone, rain streaks, ground AO, punched windows, rooftop grime
function plasterMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, map });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = 'attribute float aTone; attribute float aSeed; varying float vTone; varying float vSeed; varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vTone = aTone; vSeed = aSeed; vWP = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `uniform float uNight; varying float vTone; varying float vSeed; varying vec3 vWP; varying vec3 vWN; ${NOISE}\n` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        float roof = step(0.6, abs(vWN.y));
        vec2 t = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
        float u = dot(vWP.xz, t), v = vWP.y;
        vec3 tones[5]; tones[0] = vec3(0.86, 0.8, 0.68); tones[1] = vec3(0.82, 0.74, 0.66); tones[2] = vec3(0.78, 0.78, 0.74); tones[3] = vec3(0.88, 0.86, 0.82); tones[4] = vec3(0.8, 0.66, 0.6);
        vec3 base = tones[int(vTone * 4.99)];
        vec3 tex = texture2D(map, vec2(u, v) * 0.12).rgb;
        float streak = n2(vec2(u * 0.7, v * 0.04 + vSeed)) * smoothstep(12., 2., fract(v / 13.) * 13.);   // rain streaks under ledges
        float ao = mix(0.55, 1., smoothstep(0., 2.5, v));
        vec2 cell = vec2(floor(u / 3.), floor(v / 3.3)), f = vec2(fract(u / 3.), fract(v / 3.3));
        float win = (1. - roof) * step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.78) * step(3.3, v) * step(0.25, h2(cell + vSeed));
        vec3 c = base * mix(vec3(1.), tex * 1.6, 0.5) * (1. - streak * 0.28) * ao;
        c = mix(c, vec3(0.08, 0.1, 0.12), win * 0.9);
        c = roof > 0.5 ? vec3(0.42, 0.4, 0.38) * (0.6 + 0.6 * n2(vWP.xz * 0.6)) : c;
        diffuseColor.rgb *= c;
        float lit = win * uNight * step(0.72, h2(cell * 1.3 + vSeed * 7.));`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += lit * vec3(1., 0.74, 0.42) * 0.75;');
  };
  return m;
}
// asphalt with wear + lane paint; footpath pavers; kerb paint (aKind: 0 road, 1 footpath/top, 2 kerb face)
function roadMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, map, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aKind; attribute float aTone; varying float vKind; varying float vLanes; varying vec2 vR; varying vec3 vWP2;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vKind = aKind; vLanes = aTone; vR = uv; vWP2 = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = `varying float vKind; varying float vLanes; varying vec2 vR; varying vec3 vWP2; ${NOISE}\n` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec3 tex = texture2D(map, vWP2.xz * 0.18).rgb;
      float wear = n2(vWP2.xz * 0.08) * 0.5 + n2(vWP2.xz * 0.9) * 0.3;
      vec3 asphalt = mix(vec3(0.16, 0.16, 0.17), vec3(0.3, 0.28, 0.26), wear) * (0.75 + tex * 0.5);
      float x = vR.x, along = vR.y;
      float edge = step(x, 0.04) + step(0.96, x);
      float lane = 0.;
      if (vLanes > 1.5) { float k = x * vLanes; float d = abs(fract(k + 0.5) - 0.5) / vLanes; lane = step(d, 0.012) * step(0.5, fract(along / 9.)) * step(0.06, x) * step(x, 0.94); }
      vec3 paint = vec3(0.86, 0.85, 0.8) * (0.7 + 0.3 * n2(vWP2.xz * 3.));
      vec3 roadC = mix(asphalt, paint, max(edge * step(1.5, vLanes), lane) * 0.85);
      vec2 pc = vWP2.xz / 0.45; vec2 pf = fract(pc);
      float grout = step(0.92, max(pf.x, pf.y));
      vec3 pavers = mix(vec3(0.6, 0.48, 0.44), vec3(0.5, 0.47, 0.45), h2(floor(pc))) * (0.75 + tex * 0.45) * (1. - grout * 0.45) * (0.85 + wear * 0.3);
      vec3 kerb = mix(vec3(0.95, 0.85, 0.1), vec3(0.08), step(0.5, fract(along / 1.2)));   // yellow-black painted kerb stones
      vec3 c = vKind < 0.5 ? roadC : vKind < 1.5 ? pavers : kerb;
      diffuseColor.rgb *= c;`);
  };
  return m;
}

// ---------- build ----------
export async function buildCity(ctx) {
  const { physics, RAPIER, props, statics, pbrTex, setTerrainCollider, LANTERN, SPAWN, addBody } = ctx;
  const data = await (await fetch('/osm/gurugram.json')).json();
  const root = new THREE.Group(); root.name = 'city'; scene.add(root);
  const stats = { buildings: 0, towers: 0, roads: 0, bridges: 0, rails: data.rails.length, trees: 0, lights: 0, cars: 0, autos: 0, barricades: 0 };

  // tile grid for culling: 4×4 over the baked extent
  const EXT = 1250, TILES = 4, tileOf = (x, z) => Math.max(0, Math.min(TILES - 1, Math.floor((x + EXT) / (2 * EXT / TILES)))) + TILES * Math.max(0, Math.min(TILES - 1, Math.floor((z + EXT) / (2 * EXT / TILES))));
  const tileGeos = (n) => Array.from({ length: n }, () => []);

  // ---------- ground ----------
  const dust = pbrTex('farm_soil', 1);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8a68a, roughness: 1, map: dust.map }));
  ground.material.map.repeat.set(1500, 1500); ground.receiveShadow = true; root.add(ground);
  const gc = physics.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0).setFriction(0.9));
  setTerrainCollider(gc);

  // land-use zones for building classification
  const zones = data.areas.map((a) => ({ k: a.k, pts: ring(a.p) }));
  const commercial = zones.filter((z) => /commercial|retail/.test(z.k)), residential = zones.filter((z) => /residential/.test(z.k));

  // ---------- parks, water ----------
  {
    const greens = [], water = [];
    for (const a of zones) {
      if (a.pts.length < 3) continue;
      const isGreen = /park|garden|pitch|grass|recreation|dog_park|n_wood|n_scrub/.test(a.k), isWater = /water/.test(a.k);
      if (!isGreen && !isWater) continue;
      const sh = new THREE.Shape(a.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, isWater ? 0.03 : 0.025, 0);
      (isWater ? water : greens).push(clean(g));
    }
    const grassTex = pbrTex('grass_path_2', 1);
    if (greens.length) { const m = new THREE.Mesh(mergeGeometries(greens), new THREE.MeshStandardMaterial({ color: 0x6f8f45, roughness: 0.95, map: grassTex.map, polygonOffset: true, polygonOffsetFactor: -1 })); m.material.map.repeat.set(0.25, 0.25); m.receiveShadow = true; root.add(m);
      // world-space UVs for the park texture
      const p = m.geometry.attributes.position, uv = m.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); }
    if (water.length) root.add(new THREE.Mesh(mergeGeometries(water), new THREE.MeshStandardMaterial({ color: 0x3d5550, roughness: 0.08, metalness: 0.4 })));
  }

  // ---------- buildings ----------
  const glassTiles = tileGeos(16), plasterTiles = tileGeos(16), roofItems = { tank: [], ac: [], dish: [], plant: [] };
  const plasterTex = pbrTex('farm_soil', 1).map; // fine grain for render texture (sampled in world space)
  for (const b of data.buildings) {
    let pts = ring(b.p); if (pts.length < 3) continue;
    const A = Math.abs(area(pts)); if (A < 12) continue;
    const [cx, cz] = centroid(pts), r = hash(cx, cz), r2 = hash(cz, cx);
    const inCom = commercial.some((z) => inside(z.pts, cx, cz)), inRes = residential.some((z) => inside(z.pts, cx, cz));
    const named = /tower|dlf|building|epitome|gateway|infinity|cyber|square|atria|minar/i.test(b.n ?? '');
    let h = b.h ?? (b.lv ? b.lv * 3.3 : 0), tower = false;
    if (!h) {
      if (A > 7000) h = lerp(18, 30, r);                                                              // malls / big boxes: low and wide
      else if (b.t === 'office' || b.t === 'commercial' || named || (inCom && A > 700)) { h = lerp(45, 110, r); tower = true; }
      else if (/house|detached|bungalow/.test(b.t)) h = lerp(6, 10, r);
      else if (inRes || /residential|apartments/.test(b.t)) h = A < 200 ? lerp(9, 15, r) : lerp(12, 30, r);
      else if (A < 150) h = lerp(4, 9, r);                                                            // small shops
      else if (A < 700) h = lerp(8, 16, r);
      else h = lerp(12, 25, r);
    } else tower = h > 35;
    const tone = r2, seed = hash(cx * 0.37, cz * 1.13) * 100, tile = tileOf(cx, cz), mh = b.mh ?? 0;
    const push = (g, glass) => { addAttr(addAttr(g, 'aTone', tone), 'aSeed', seed); (glass ? glassTiles : plasterTiles)[tile].push(clean(g)); };
    if (tower && A > 300) {
      // podium (plaster) + glass shaft set back from the street + a darker mechanical crown
      const pod = lerp(6, 14, r2);
      push(prism(pts, mh, pod), false);
      const shaft = shrink(pts, lerp(0.78, 0.9, r), [cx, cz]);
      push(prism(shaft, pod, h), true);
      push(prism(shrink(pts, 0.55, [cx, cz]), h, h + lerp(2.5, 5, r2)), false);
      stats.towers++;
    } else {
      push(prism(pts, mh, h), h > 35);
      // rooftop clutter on low/mid-rise flat roofs (Gurgaon: black water tanks, AC units, dish antennas)
      if (h < 40) {
        const n = Math.min(6, Math.max(1, Math.round(A / 140)));
        const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
        for (let k = 0, tries = 0; k < n && tries < 30; tries++) {
          const x = lerp(Math.min(...xs), Math.max(...xs), hash(cx + tries, cz - k)), z = lerp(Math.min(...zs), Math.max(...zs), hash(cz + tries * 3, cx + k));
          if (!inside(pts, x, z)) continue;
          const pick = hash(x, z); (pick < 0.45 ? roofItems.tank : pick < 0.8 ? roofItems.ac : roofItems.dish).push([x, h, z, hash(z, x) * 6.28]); k++;
        }
      } else roofItems.plant.push([cx, h, cz, r * 6.28]);
    }
    // physics: one static oriented box per building
    const o = obb(pts);
    if (o) statics.push({ collider: physics.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(o.hx, 0.5), Math.max(0.5, (h - mh) / 2), Math.max(o.hz, 0.5)).setTranslation(o.cx, (h + mh) / 2, o.cz).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -o.ang))), mat: 'concrete' });
    stats.buildings++;
  }
  const glassMat = glassMaterial(), plasterMat = plasterMaterial(plasterTex);
  for (let t = 0; t < 16; t++) for (const [geos, mat] of [[glassTiles[t], glassMat], [plasterTiles[t], plasterMat]]) {
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = m.receiveShadow = true; m.name = 'tile'; root.add(m);
  }
  // instanced rooftop clutter
  const inst = (geo, mat, list, place, shadow = true) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    list.forEach((it, i) => { place(it, v, q, s, up); m4.compose(v, q, s); im.setMatrixAt(i, m4); });
    im.castShadow = shadow; im.receiveShadow = true; root.add(im); return im;
  };
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }), grey = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.6, metalness: 0.3 });
  inst(new THREE.CylinderGeometry(0.62, 0.62, 1.3, 14).translate(0, 0.65, 0), dark, roofItems.tank, ([x, y, z, a], v, q, s, up) => { v.set(x, y, z); q.setFromAxisAngle(up, a); s.setScalar(0.8 + hash(x, z) * 0.5); });
  inst(new THREE.BoxGeometry(0.9, 0.62, 0.38).translate(0, 0.31, 0), grey, roofItems.ac, ([x, y, z, a], v, q, s, up) => { v.set(x, y, z); q.setFromAxisAngle(up, a); s.set(1, 1, 1); });
  inst(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, 1.1).rotateX(1.2).translate(0, 0.7, 0), grey, roofItems.dish, ([x, y, z, a], v, q, s, up) => { v.set(x, y, z); q.setFromAxisAngle(up, a); s.set(1, 1, 1); });
  inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), grey, roofItems.plant, ([x, y, z, a], v, q, s, up) => { v.set(x, y + 3, z); q.setFromAxisAngle(up, a); s.set(6, 2.5, 4); });

  // ---------- roads ----------
  const W = { motorway: 11, trunk: 11, primary: 12, secondary: 10, tertiary: 8, motorway_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6, residential: 6, unclassified: 6, living_street: 5, service: 4.2, pedestrian: 4, footway: 2.2, path: 1.8, steps: 2, construction: 6 };
  const PRI = { motorway: 9, trunk: 9, primary: 8, secondary: 7, tertiary: 6, motorway_link: 6, primary_link: 6, secondary_link: 5, tertiary_link: 5, residential: 4, unclassified: 4, living_street: 3, service: 2, pedestrian: 1, footway: 1, path: 1, steps: 1, construction: 2 };
  const roadGeos = [], deckGeos = [], pillarSpots = [], lightSpots = [], treeSpots = [], parkSpots = [], carSpots = [], autoSpots = [], barSpots = [];
  // ribbon: polyline (xz), half width, y(s) elevation, offset (lateral), kind, lanes; raised: top-height (kerb/median/footpath)
  function ribbon(pts, hw, yAt, { off = 0, kind = 0, lanes = 0, raise = 0, deckDepth = 0 } = {}) {
    const n = pts.length; if (n < 2) return null;
    const L = [0]; for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const pos = [], uv = [], nrm = [];
    const left = [], rightP = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const nx = -dz, nz = dx, y = yAt(L[i], L[n - 1]) + raise;
      left.push([pts[i][0] + nx * (off - hw), y, pts[i][1] + nz * (off - hw)]); rightP.push([pts[i][0] + nx * (off + hw), y, pts[i][1] + nz * (off + hw)]);
    }
    const quad = (p0, p1, p2, p3, u0, u1, v0, v1, ny) => { // p0 p1 bottom edge, p2 p3 top edge (along strip)
      pos.push(...p0, ...p1, ...p2, ...p1, ...p3, ...p2); uv.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
      for (let k = 0; k < 6; k++) nrm.push(...ny);
    };
    for (let i = 0; i < n - 1; i++) {
      quad(left[i], rightP[i], left[i + 1], rightP[i + 1], 0, 1, L[i], L[i + 1], [0, 1, 0]);
      const sideDepth = raise || deckDepth;
      if (sideDepth) for (const [S, flip] of [[left, -1], [rightP, 1]]) {
        const p0 = S[i], p1 = S[i + 1], b0 = [p0[0], p0[1] - sideDepth, p0[2]], b1 = [p1[0], p1[1] - sideDepth, p1[2]];
        const ex = p1[0] - p0[0], ez = p1[2] - p0[2], el = Math.hypot(ex, ez) || 1, sn = [-ez / el * flip, 0, ex / el * flip];
        quad(b0, b1, p0, p1, 0, 1, L[i], L[i + 1], sn);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    addAttr(g, 'aKind', kind); addAttr(g, 'aTone', lanes);
    return g;
  }
  const flatY = (base) => () => base;
  const bridgeY = (H, base) => (s, L) => { const ramp = Math.min(70, L / 3); return base + H * THREE.MathUtils.smoothstep(s, 0, ramp) * THREE.MathUtils.smoothstep(L - s, 0, ramp); };
  const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
  for (const r of data.roads) {
    const w = W[r.c]; if (!w) continue;
    const pts = ring(r.p).length >= 2 ? (() => { const a = []; for (let i = 0; i < r.p.length; i += 2) a.push([r.p[i], r.p[i + 1]]); return a; })() : null;
    if (!pts || pts.length < 2) continue;
    const pri = PRI[r.c] ?? 1, base = 0.02 + pri * 0.004, foot = /footway|path|steps|pedestrian/.test(r.c);
    const H = r.br ? 7 + Math.max(0, r.l - 1) * 6 : 0, yAt = r.br ? bridgeY(H, base) : flatY(base);
    const lanes = foot ? 0 : r.ln ?? Math.max(1, Math.round(w / 3.4));
    const g = ribbon(pts, w / 2, yAt, { kind: foot ? 1 : 0, lanes, deckDepth: r.br ? 1.3 : 0 });
    if (g) (r.br ? deckGeos : roadGeos).push(g);
    stats.roads++; if (r.br) stats.bridges++;
    // kerbs + footpaths beside proper streets
    const major = pri >= 4 && !r.br;
    if (major) for (const side of [-1, 1]) {
      roadGeos.push(ribbon(pts, 0.15, flatY(0), { off: side * (w / 2 + 0.15), kind: 2, raise: 0.16 }));
      if (pri >= 5) roadGeos.push(ribbon(pts, 1.4, flatY(0), { off: side * (w / 2 + 1.7), kind: 1, raise: 0.16 }));
    }
    // median on wide two-way roads
    if (!r.ow && !r.br && w >= 10 && pri >= 6) roadGeos.push(ribbon(pts, 0.6, flatY(0), { kind: 2, raise: 0.3 }));
    // walk the centreline for furniture, pillars and bridge colliders
    let acc = 0, accL = 0, accT = 0, accC = 0, idx = 0;
    const Ltot = (() => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; })();
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], sl = Math.hypot(bx - ax, bz - az); if (sl < 0.01) continue;
      const dx = (bx - ax) / sl, dz = (bz - az) / sl, nx = -dz, nz = dx;
      if (r.br) { // deck collider per segment (tilted along ramps)
        const y0 = yAt(acc, Ltot), y1 = yAt(acc + sl, Ltot), mx = (ax + bx) / 2, mz = (az + bz) / 2;
        qTmp.setFromEuler(eTmp.set(0, Math.atan2(-dz, dx), Math.atan2(y1 - y0, sl), 'YXZ'));
        physics.createCollider(RAPIER.ColliderDesc.cuboid(sl / 2, 0.65, w / 2).setTranslation(mx, (y0 + y1) / 2 - 0.65, mz).setRotation(qTmp));
      }
      for (let s = 0; s < sl; s += 2) {
        const x = ax + dx * s, z = az + dz * s, sAll = acc + s;
        if (r.br && sAll - accL > 24 && yAt(sAll, Ltot) > 2.5) { accL = sAll; pillarSpots.push([x, yAt(sAll, Ltot) - 1.3, z, Math.atan2(dz, dx), w]); }
        if (!r.br && pri >= 6 && sAll - accT > 32) { accT = sAll; const side = (idx++ % 2) ? 1 : -1; lightSpots.push([x + nx * side * (w / 2 + 0.6), z + nz * side * (w / 2 + 0.6), Math.atan2(-nz * side, -nx * side)]); }
        if (!r.br && !foot && pri >= 3 && pri <= 7 && sAll - accC > 15) {
          accC = sAll;
          for (const side of [-1, 1]) if (hash(x * side, z) > 0.45) treeSpots.push([x + nx * side * (w / 2 + (pri >= 5 ? 3 : 2)), z + nz * side * (w / 2 + (pri >= 5 ? 3 : 2))]);
          const roll = hash(z, x * 3);
          if ((r.c === 'residential' || r.c === 'service') && roll < 0.22) carSpots.push([x + nx * (w / 2 - 1.1), z + nz * (w / 2 - 1.1), Math.atan2(dx, dz)]);
          else if (pri >= 5 && roll > 0.93) autoSpots.push([x + nx * (w / 2 - 1), z + nz * (w / 2 - 1), Math.atan2(dx, dz)]);
          else if (pri >= 6 && roll > 0.88 && roll < 0.91) barSpots.push([x + nx * (w / 4), z + nz * (w / 4), Math.atan2(dx, dz)]);
        }
      }
      acc += sl;
    }
  }
  const asphaltTex = pbrTex('grass_path_2', 1).map;
  const roadMat = roadMaterial(asphaltTex);
  const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos.filter(Boolean).map(clean)), roadMat); roadMesh.receiveShadow = true; root.add(roadMesh);
  if (deckGeos.length) { const dm = new THREE.Mesh(mergeGeometries(deckGeos.map(clean)), roadMat); dm.castShadow = dm.receiveShadow = true; root.add(dm); }
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb5afa4, roughness: 0.9 });
  inst(new THREE.CylinderGeometry(0.9, 1.1, 1, 16).translate(0, 0.5, 0), concrete, pillarSpots, ([x, y, z, a, w], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, -a); s.set(1, y, 1); });
  pillarSpots.forEach(([x, y, z]) => statics.push({ collider: physics.createCollider(RAPIER.ColliderDesc.cylinder(y / 2, 1).setTranslation(x, y / 2, z)), mat: 'concrete' }));

  // ---------- Rapid Metro: elevated viaduct (box girder on hammerhead piers) ----------
  {
    const H = 12, girders = [], rails = [], piers = [];
    for (const r of data.rails) {
      const pts = []; for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
      if (pts.length < 2) continue;
      girders.push(ribbon(pts, 4.2, flatY(H), { kind: 2, deckDepth: 2.2 }));
      for (const o of [-1.6, -0.2, 0.2, 1.6]) rails.push(ribbon(pts, 0.05, flatY(H + 0.18), { off: o, kind: 2 }));
      let acc = 0, last = -99;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], sl = Math.hypot(bx - ax, bz - az); if (sl < 0.01) continue;
        const dx = (bx - ax) / sl, dz = (bz - az) / sl, mx = (ax + bx) / 2, mz = (az + bz) / 2;
        physics.createCollider(RAPIER.ColliderDesc.cuboid(sl / 2, 1.1, 4.2).setTranslation(mx, H - 1.1, mz).setRotation(qTmp.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx))));
        for (let s = 0; s < sl; s += 2) if (acc + s - last > 28) { last = acc + s; piers.push([ax + dx * s, az + dz * s, Math.atan2(dz, dx)]); }
        acc += sl;
      }
    }
    if (girders.length) {
      const gm = new THREE.Mesh(mergeGeometries(girders.filter(Boolean).map(clean)), new THREE.MeshStandardMaterial({ color: 0xc9c3b8, roughness: 0.85 })); gm.castShadow = gm.receiveShadow = true; root.add(gm);
      root.add(new THREE.Mesh(mergeGeometries(rails.filter(Boolean).map(clean)), new THREE.MeshStandardMaterial({ color: 0x6a6a6a, metalness: 0.9, roughness: 0.35 })));
      const pierGeo = mergeGeometries([new THREE.CylinderGeometry(1, 1.2, H - 2.2, 18).translate(0, (H - 2.2) / 2, 0), new THREE.BoxGeometry(2.6, 1.6, 8.6).translate(0, H - 3, 0)].map(clean));
      inst(pierGeo, concrete, piers, ([x, z, a], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, -a); s.set(1, 1, 1); });
      piers.forEach(([x, z]) => statics.push({ collider: physics.createCollider(RAPIER.ColliderDesc.cylinder((H - 2.2) / 2, 1.2).setTranslation(x, (H - 2.2) / 2, z)), mat: 'concrete' }));
    }
  }

  // ---------- street lights (sodium) + their light pools ----------
  const lampHeads = [];
  {
    const poleGeo = mergeGeometries([new THREE.CylinderGeometry(0.09, 0.14, 9, 8).translate(0, 4.5, 0), new THREE.BoxGeometry(0.08, 0.08, 2.2).translate(0, 8.9, 1.05)].map(clean));
    inst(poleGeo, new THREE.MeshStandardMaterial({ color: 0x5c615f, metalness: 0.6, roughness: 0.5 }), lightSpots, ([x, z, a], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, a); s.set(1, 1, 1); });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xff9a3c, emissiveIntensity: 0 });
    inst(new THREE.BoxGeometry(0.35, 0.12, 0.7).translate(0, 8.82, 2.05), headMat, lightSpots, ([x, z, a], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, a); s.set(1, 1, 1); }, false);
    lampHeads.push(headMat);
    // pools: additive radial quads on the road under each lamp (no real lights → no per-light cost)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x2 = cv.getContext('2d'), gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x2.fillStyle = gr; x2.fillRect(0, 0, 64, 64);
    const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: new THREE.Color(1, 0.55, 0.18), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const pool = inst(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2).translate(0, 0.08, 2.05), poolMat, lightSpots, ([x, z, a], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, a); s.set(1, 1, 1); }, false);
    if (pool) { pool.receiveShadow = false; pool.renderOrder = 1; }
    lampHeads.push(poolMat);
    stats.lights = lightSpots.length;
  }

  // ---------- trees (neem / peepal tones), instanced per tile; trunk colliders ----------
  {
    for (const a of zones) if (/park|garden|recreation|n_wood|grass/.test(a.k) && a.pts.length >= 3) {
      const A = Math.abs(area(a.pts)), n = Math.min(80, Math.round(A / 160)), xs = a.pts.map((p) => p[0]), zs = a.pts.map((p) => p[1]);
      for (let k = 0, t = 0; k < n && t < n * 4; t++) { const x = lerp(Math.min(...xs), Math.max(...xs), hash(t * 1.7, A)), z = lerp(Math.min(...zs), Math.max(...zs), hash(A, t * 2.3)); if (inside(a.pts, x, z)) { parkSpots.push([x, z]); k++; } }
    }
    const all = [...treeSpots, ...parkSpots].slice(0, 3200);
    const ico = (r, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 2); /* 320 tris per clump (detail 3 ≈ 4k tris per tree × 3200) */ const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.8 + hash(Math.round(p.getX(i) * 3), Math.round(p.getZ(i) * 3 + p.getY(i) * 2)) * 0.32; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); } g.computeVertexNormals(); return g.translate(x, y, z); };
    const colorize = (g, c) => { const col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3) { col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2]; } g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return clean(g); };
    const treeGeo = mergeGeometries([colorize(new THREE.CylinderGeometry(0.16, 0.28, 3.4, 7).translate(0, 1.7, 0), [0.32, 0.27, 0.22]), colorize(ico(2.3, 0, 4.6, 0), [0.24, 0.36, 0.16]), colorize(ico(1.8, 1.2, 5.6, 0.6), [0.27, 0.4, 0.18]), colorize(ico(1.7, -1, 5.3, -0.7), [0.22, 0.33, 0.15])]);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    treeMat.onBeforeCompile = (sh) => { sh.uniforms.uTime = CU.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 ip = instanceMatrix * vec4(0., 0., 0., 1.); float sway = smoothstep(2.5, 6., position.y) * (sin(uTime * 1.3 + ip.x * 0.2) * 0.12 + sin(uTime * 2.9 + ip.z * 0.5) * 0.05); transformed.x += sway; transformed.z += sway * 0.6;
      vLeaf = position * 2.2 + ip.xyz * 0.13; vTreeY = position.y;`).replace('void main() {', 'varying vec3 vLeaf; varying float vTreeY;\nvoid main() {');
      sh.fragmentShader = 'varying vec3 vLeaf; varying float vTreeY;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 q = vLeaf; float l = fract(sin(dot(floor(q * 3.), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float clump = smoothstep(0.2, 0.9, l);
        diffuseColor.rgb *= vTreeY > 3.3 ? mix(0.55, 1.15, clump) * mix(0.7, 1.05, smoothstep(3.6, 7.0, vTreeY)) : 1.;  // leaf clumps + darker underside`); };
    const byTile = tileGeos(16); all.forEach((t) => byTile[tileOf(t[0], t[1])].push(t));
    byTile.forEach((list) => {
      const im = inst(treeGeo, treeMat, list, ([x, z], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, hash(x, z) * 6.28); const k = 0.8 + hash(z, x) * 0.6; s.set(k, k * (0.9 + hash(x * 2, z) * 0.3), k); });
      if (!im) return;
      // tint variety: neem (dark, dense) vs peepal (lighter, glossier)
      const c = new THREE.Color(); list.forEach(([x, z], i) => im.setColorAt(i, c.setRGB(...(hash(x * 3, z) < 0.5 ? [0.85, 0.95, 0.8] : [1.1, 1.15, 0.95]))));
      im.computeBoundingSphere();
    });
    all.forEach(([x, z]) => statics.push({ collider: physics.createCollider(RAPIER.ColliderDesc.capsule(1.5, 0.25).setTranslation(x, 1.75, z)), mat: 'wood' }));
    stats.trees = all.length;
  }

  // ---------- parked cars, autos (dynamic, instanced), barricades (dynamic, breakable meshes) ----------
  const dyn = []; // { body, im, i } synced from physics while awake
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
  const vehicle = (spots, geo, colors, he, mass, kind, cap) => {
    spots = spots.slice(0, cap); if (!spots.length) return;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 }), spots.length);
    im.castShadow = im.receiveShadow = true; im.frustumCulled = false; root.add(im);
    const c = new THREE.Color();
    spots.forEach(([x, z, a], i) => {
      const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, he[1], z).setRotation(qTmp.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a)).setLinearDamping(0.3).setAngularDamping(0.8).setSleeping(true));
      physics.createCollider(RAPIER.ColliderDesc.cuboid(...he).setMass(mass).setFriction(0.9), body);
      im.setColorAt(i, c.setHex(colors[Math.floor(hash(x, z) * colors.length)]));
      dyn.push({ body, im, i }); props.push({ body, mesh: null, kind });
    });
    sync(true);
  };
  const box = (w, h, d, x = 0, y = 0, z = 0) => clean(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  vehicle(carSpots, mergeGeometries([box(1.75, 0.75, 4.2, 0, -0.15, 0), box(1.6, 0.6, 2.2, 0, 0.5, -0.2)]), [0xf2f2f2, 0xc8ccd0, 0x2a2d33, 0x8b0f14, 0x3a4f78, 0x9c9a90], [0.88, 0.75, 2.1], 1200, 'car', 90);
  vehicle(autoSpots, mergeGeometries([box(1.3, 1.1, 1.7, 0, 0.05, -0.3), box(1.25, 0.15, 2.6, 0, 0.65, 0), box(0.4, 0.5, 0.6, 0, -0.1, 1.05)]), [0x4c9a3a, 0xd9c21e], [0.68, 0.85, 1.3], 350, 'car', 40); // CNG autos: green body, yellow top
  stats.cars = Math.min(carSpots.length, 90); stats.autos = Math.min(autoSpots.length, 40);
  {
    const barMat = new THREE.MeshStandardMaterial({ roughness: 0.6, map: (() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const x = cv.getContext('2d'); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#111' : '#f2c81a'; x.fillRect(i * 8, 0, 8, 8); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })() });
    for (const [x, z, a] of barSpots.slice(0, 24)) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.18), barMat); m.position.set(x, 0.52, z); m.rotation.y = a + Math.PI / 2;
      addBody(m, RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.2).setSleeping(true), [RAPIER.ColliderDesc.cuboid(1.2, 0.5, 0.09).setDensity(250).setFriction(0.8)], 'barricade', root);
      stats.barricades++;
    }
  }
  function sync(force) {
    let dirty = null;
    for (const d of dyn) {
      if (!force && d.body.isSleeping()) continue;
      const t = d.body.translation(), r = d.body.rotation();
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s); d.im.setMatrixAt(d.i, _m);
      if (dirty !== d.im) { if (dirty) dirty.instanceMatrix.needsUpdate = true; dirty = d.im; }
    }
    if (dirty) dirty.instanceMatrix.needsUpdate = true;
    if (force) for (const d of dyn) { d.im.instanceMatrix.needsUpdate = true; if (d.im.instanceColor) d.im.instanceColor.needsUpdate = true; }
  }

  // ---------- Cyber Hub glow: neon signs + string lights around the restaurant cluster ----------
  const hubLights = [];
  {
    const food = data.amenities.filter((a) => /restaurant|cafe|bar|pub|fast_food/.test(a.t) && Math.hypot(a.p[0], a.p[1]) < 450);
    const hub = food.length ? food.reduce((s, a) => [s[0] + a.p[0] / food.length, s[1] + a.p[1] / food.length], [0, 0]) : [0, 0];
    const neon = [0xff3d7f, 0x3dd9ff, 0xffb13d, 0x9d5cff, 0x3dff8a];
    const signs = food.slice(0, 40).map((a, i) => [a.p[0], a.p[1], neon[i % neon.length]]);
    const signMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: false });
    const im = inst(new THREE.BoxGeometry(2.6, 0.6, 0.12).translate(0, 4.2, 0), signMat, signs, ([x, z], v, q, s, up) => { v.set(x, 0, z); q.setFromAxisAngle(up, hash(x, z) * 6.28); s.set(1, 1, 1); }, false);
    if (im) { const c = new THREE.Color(); signs.forEach(([, , col], i) => im.setColorAt(i, c.setHex(col))); }
    hubLights.push(signMat);
    // string lights
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 * 3, r = 18 + (i % 37), sag = Math.sin((i % 20) / 20 * Math.PI) * 0.8; pos.set([hub[0] + Math.cos(a) * r, 6.5 - sag, hub[1] + Math.sin(a) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({ color: new THREE.Color(1, 0.75, 0.4).multiplyScalar(4), size: 0.22, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    root.add(new THREE.Points(g, pm)); hubLights.push(pm);
    stats.hub = hub.map((v) => +v.toFixed(0));
  }

  // ---------- lantern in the nearest proper park; spawn on the nearest street ----------
  {
    const parks = zones.filter((z) => /park|garden|recreation/.test(z.k) && Math.abs(area(z.pts)) > 1500).map((z) => ({ c: centroid(z.pts), A: Math.abs(area(z.pts)) }));
    parks.sort((a, b) => Math.hypot(...a.c) - Math.hypot(...b.c));
    if (parks[0]) { LANTERN.set(parks[0].c[0], 0, parks[0].c[1]); }
    let best = null;
    for (const r of data.roads) if (/tertiary|secondary|residential/.test(r.c) && !r.br) for (let i = 0; i < r.p.length; i += 2) { const d = Math.hypot(r.p[i], r.p[i + 1]); if (!best || d < best.d) best = { d, x: r.p[i], z: r.p[i + 1] }; }
    if (best) SPAWN.set(best.x, 0, best.z);
  }

  // ---------- per-frame + day/night ----------
  function setNight(k) {
    CU.uNight.value = k;
    lampHeads[0].emissiveIntensity = 6 * k; if (lampHeads[1]) lampHeads[1].opacity = 0.55 * k;
    hubLights[0].emissiveIntensity = 5 * k; hubLights[1].opacity = k;
  }
  function update(t) { CU.uTime.value = t; sync(false); }
  return { root, stats, update, setNight };
}

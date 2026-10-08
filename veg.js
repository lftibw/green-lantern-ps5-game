// Wheat + pasture grass as camera-following GPU fields.
// A fixed pool of tufts lives on a square that wraps around the player (mod S), so the field looks endless and dense
// at a constant cost. Height + where-things-grow come from a baked map (R height, G wheat, B grass).
// Instances near the wrap edge shrink to nothing, so the seam is invisible.
import * as THREE from 'three';
import { scene, aoSkip, sun } from './gfx.js';

const WIND = `
  float gust(vec2 p, float t){ return sin(t * 1.3 + p.x * 0.08 + p.y * 0.05) * 0.5 + sin(t * 2.7 + p.x * 0.31 + p.y * 0.17) * 0.18 + sin(t * 0.37 + p.y * 0.02) * 0.35; }`;

// map: { tex (HalfFloat RGBA DataTexture), size (metres covered, centred on 0) }
export function makeField({ geo, count, S, channel, map, GU, colorA, colorB, tipBoost = 0.25, bendK = 0.35 }) {
  const ig = new THREE.InstancedBufferGeometry().copy(geo);
  ig.instanceCount = count * count;
  const inst = new Float32Array(count * count * 4);
  for (let i = 0, k = 0; i < count; i++) for (let j = 0; j < count; j++, k += 4) {
    inst[k] = ((i + Math.random()) / count) * S; inst[k + 1] = ((j + Math.random()) / count) * S;
    inst[k + 2] = Math.random() * Math.PI * 2; inst[k + 3] = 0.75 + Math.random() * 0.5;
  }
  ig.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const U = { uCenter: { value: new THREE.Vector2() }, uMap: { value: map.tex }, uSun: { value: new THREE.Vector3() } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uTime: GU.uTime, uPush: GU.uPush });
    sh.vertexShader = `uniform vec2 uCenter; uniform sampler2D uMap; uniform float uTime; uniform vec4 uPush[3]; uniform vec3 uSun;
      attribute vec4 aInst; varying float vH; varying float vBack; varying float vTint; ${WIND}
      ` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        float S = ${S.toFixed(1)};
        vec2 o = uCenter - S * 0.5;
        vec2 wp = o + mod(aInst.xy - o, S);
        vec4 hm = texture2D(uMap, wp / ${map.size.toFixed(1)} + 0.5);
        float grow = hm.${channel};
        float dist = length(wp - uCenter);
        float sc = aInst.w * grow * (1. - smoothstep(S * 0.36, S * 0.49, dist));
        float cy = cos(aInst.z), sy = sin(aInst.z);
        mat2 R = mat2(cy, -sy, sy, cy);
        vec3 objectNormal = normal; objectNormal.xz = R * objectNormal.xz;
        objectNormal = normalize(mix(objectNormal, vec3(0., 1., 0.), 0.55)); // soft, sky-facing shading like real fields
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position * sc; transformed.xz = R * transformed.xz;
        float h = clamp(uv.y, 0., 1.); float bend = h * h;
        float g = gust(wp, uTime);
        vec2 off = vec2(g * ${bendK.toFixed(2)}, g * ${(bendK * 0.5).toFixed(2)}) * bend * sc;
        for (int k = 0; k < 3; k++) {
          vec2 d = wp - uPush[k].xz; float r = uPush[k].w;
          float near = 1. - smoothstep(r * 0.4, r, length(d));
          float vert = 1. - smoothstep(0., r + 1.5, abs(hm.r - uPush[k].y));
          off += normalize(d + 0.001) * near * vert * bend * 0.9 * sc;
          transformed.y -= near * vert * bend * 0.35 * sc;
        }
        transformed.xz += off; transformed.y -= dot(off, off) * 0.4; // bending shortens the stalk
        transformed += vec3(wp.x, hm.r - 0.04, wp.y);
        vH = h;
        vTint = fract(sin(dot(floor(wp * 0.07), vec2(12.9898, 78.233))) * 43758.5453); // patchy variation
        vBack = pow(max(dot(normalize(transformed - cameraPosition), uSun), 0.), 3.) * h; // sun shining through
      `);
    sh.fragmentShader = `varying float vH; varying float vBack; varying float vTint; uniform vec3 uSun;\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(vec3(${colorA}), vec3(${colorB}), vTint) * mix(0.38, 1., vH) * (1. + vH * vH * ${tipBoost.toFixed(2)});`)
      .replace('#include <emissivevertex_fragment>', `#include <emissivevertex_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vBack * 0.9;`);
  };
  const mesh = new THREE.Mesh(ig, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  scene.add(mesh); aoSkip.add(mesh);
  return { mesh, U, update(center) { U.uCenter.value.set(center.x, center.z); U.uSun.value.copy(sun.position).sub(sun.target.position).normalize(); } };
}

// ---------- tuft geometries (uv.y = height fraction, vertex colour = base tint) ----------
function quad(pos, nrm, uv, col, x0, x1, y0, y1, z, c0, c1, h0, h1) {
  const v = [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
  for (const [x, y] of v) { pos.push(x, y, z); nrm.push(0, 0, 1); uv.push(0, y === y0 ? h0 : h1); const c = y === y0 ? c0 : c1; col.push(c[0], c[1], c[2]); }
}
const rot = (arr, from, a) => { const c = Math.cos(a), s = Math.sin(a); for (let i = from; i < arr.length; i += 3) { const x = arr[i], z = arr[i + 2]; arr[i] = x * c - z * s; arr[i + 2] = x * s + z * c; } };
function build(fn) {
  const pos = [], nrm = [], uv = [], col = []; fn(pos, nrm, uv, col);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
// wheat: 3 stalks, each a thin quad + two crossed ear quads (18 tris per tuft)
export const wheatTuft = build((pos, nrm, uv, col) => {
  const stem = [[0.55, 0.5, 0.28], [0.92, 0.78, 0.45]], ear = [[0.85, 0.66, 0.33], [1, 0.86, 0.52]];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4, r = 0.09, cx = Math.cos(a) * r, cz = Math.sin(a) * r, H = 0.95 + k * 0.08;
    let s = pos.length;
    quad(pos, nrm, uv, col, -0.012, 0.012, 0, H, 0, stem[0], stem[1], 0, H / 1.15);
    rot(pos, s, a * 1.7); for (let i = s; i < pos.length; i += 3) { pos[i] += cx; pos[i + 2] += cz; }
    for (let e = 0; e < 2; e++) {
      s = pos.length;
      quad(pos, nrm, uv, col, -0.026, 0.026, H - 0.02, H + 0.15, 0, ear[0], ear[1], H / 1.15, 1);
      rot(pos, s, a * 1.7 + e * Math.PI / 2); for (let i = s; i < pos.length; i += 3) { pos[i] += cx; pos[i + 2] += cz; }
    }
  }
});
// pasture grass: 4 tapered blades (triangle each with a mid vertex → 2 tris), short and green-gold
export const grassTuft = build((pos, nrm, uv, col) => {
  const base = [0.18, 0.24, 0.08], tip = [0.62, 0.66, 0.3];
  for (let k = 0; k < 4; k++) {
    const s = pos.length, H = 0.32 + Math.random() * 0.25, w = 0.03, lean = (Math.random() - 0.5) * 0.12;
    const P = [[-w, 0], [w, 0], [w * 0.5 + lean * 0.5, H * 0.55], [-w, 0], [w * 0.5 + lean * 0.5, H * 0.55], [-w * 0.5 + lean * 0.5, H * 0.55], [-w * 0.5 + lean * 0.5, H * 0.55], [w * 0.5 + lean * 0.5, H * 0.55], [lean, H]];
    for (const [x, y] of P) { pos.push(x, y, 0); nrm.push(0, 0, 1); uv.push(0, y / H); const c = y / H; col.push(base[0] + (tip[0] - base[0]) * c, base[1] + (tip[1] - base[1]) * c, base[2] + (tip[2] - base[2]) * c); }
    const a = Math.random() * Math.PI * 2; rot(pos, s, a);
    const ox = (Math.random() - 0.5) * 0.25, oz = (Math.random() - 0.5) * 0.25; for (let i = s; i < pos.length; i += 3) { pos[i] += ox; pos[i + 2] += oz; }
  }
});

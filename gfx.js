// Rendering pipeline: physical sky + image-based lighting, HDR composer (MSAA), GTAO, bloom, grading, quality presets.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { settings } from './settings.js';

// ---------- Sky-style height fog: mist pools below the islands, thins with altitude ----------
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\nvarying float vFogDepth; varying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\nvFogDepth = - mvPosition.z; vFogWorld = (inverse(viewMatrix) * mvPosition).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\nuniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear; uniform float fogFar;\n#endif\n#endif';
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  float hf = clamp(exp(-(vFogWorld.y + 4.0) * 0.25), 0., 1.) * (1. - exp(-vFogDepth * 0.02)); // low-lying haze
  fogFactor = max(fogFactor, hf * 0.45);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;

export const QUALITY = {
  low: { pixelRatio: 1, shadow: 1024, ao: false, bloom: false, grass: 0, samples: 0 },
  medium: { pixelRatio: 1.5, shadow: 2048, ao: false, bloom: true, grass: 10, samples: 4 },
  high: { pixelRatio: 2, shadow: 4096, ao: true, bloom: true, grass: 22, samples: 4 },
};
export const Q = () => QUALITY[settings.quality] || QUALITY.high;

export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // ACES washed the daytime sky to grey-white; Neutral keeps real blues
renderer.toneMappingExposure = 1;
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 1500);

// ---------- lights ----------
export const hemi = new THREE.HemisphereLight(0xffffff, 0x5d7f52, 0.6);
export const sun = new THREE.DirectionalLight(0xfff1dc, 3);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 120 });
scene.add(hemi, sun, sun.target);
const sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();

// keep the shadow map locked to texel grid → no shimmering as the camera follows
export function followSun(target) {
  const size = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  const t = target.clone();
  t.x = Math.round(t.x / size) * size; t.z = Math.round(t.z / size) * size;
  sun.target.position.copy(t);
  sun.position.copy(t).addScaledVector(sunDir, 60);
}

// ---------- sky + environment ----------
const sky = new Sky(); sky.scale.setScalar(1000); scene.add(sky);
const gradMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, glow: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: 'uniform vec3 top, bottom, glow; varying vec3 vp; void main(){ float h = clamp(vp.y*1.3+0.25,0.,1.); vec3 c = mix(bottom, top, h) + glow * pow(max(1.-abs(vp.y), 0.), 8.); gl_FragColor = vec4(c,1.); }',
});
const gradSky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), gradMat);
scene.add(gradSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const clouds = new THREE.Group(); scene.add(clouds);

// sea of clouds below the play space (two layers for parallax)
const seaMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { t: { value: 0 }, lit: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, fogC: { value: new THREE.Color() }, sunD: { value: new THREE.Vector3() }, off: { value: 0 } },
  vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position,1.); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform float t, off; uniform vec3 lit, shade, fogC, sunD; varying vec3 wp;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float a = .5, s = 0.; for (int k = 0; k < 5; k++){ s += a*n(p); p = p*2.02 + 3.1; a *= .5; } return s; }
    void main(){
      vec2 p = wp.xz * 0.035 + vec2(t * 0.01 + off, t * 0.004);
      float d = fbm(p), d2 = fbm(p + vec2(0.03, 0.02));
      float dens = smoothstep(0.35, 0.75, d);
      float light = clamp(0.55 + (d - d2) * 18. * sunD.x + d * 0.6, 0., 1.4); // fake self-shadowing toward sun
      vec3 c = mix(shade, lit, light);
      float dist = length(wp - cameraPosition);
      c = mix(c, fogC, smoothstep(60., 320., dist));
      gl_FragColor = vec4(c, dens * (1. - smoothstep(250., 420., dist)));
    }`,
});
const seas = [-7, -12].map((y, k) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), k ? seaMat.clone() : seaMat);
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = -1; m.material.uniforms.off.value = k * 7.3;
  scene.add(m); return m;
});

// drifting motes of light (Sky's ambient sparkle)
const moteTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
export const softDot = moteTex;
const MOTES = 500, motePos = new Float32Array(MOTES * 3), moteSeed = new Float32Array(MOTES);
for (let k = 0; k < MOTES; k++) { motePos.set([Math.random() * 50 - 25, Math.random() * 16 - 2, Math.random() * 50 - 25], k * 3); moteSeed[k] = Math.random() * 100; }
const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: moteTex, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
motes.frustumCulled = false; scene.add(motes);

/**
 * preset: { sun:[elevationDeg, azimuthDeg], turbidity, rayleigh, mie, gradient?:[top,bottom,glow],
 *           fog, fogDensity, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, envIntensity,
 *           exposure, clouds, cloudColor, grade:{ tint:[r,g,b], sat, vignette, contrast } }
 */
export function setSky(p) {
  const el = THREE.MathUtils.degToRad(90 - p.sun[0]), az = THREE.MathUtils.degToRad(p.sun[1]);
  sunDir.setFromSphericalCoords(1, el, az);
  const u = sky.material.uniforms;
  u.sunPosition.value.copy(sunDir);
  u.turbidity.value = p.turbidity ?? 3; u.rayleigh.value = p.rayleigh ?? 1.2;
  u.mieCoefficient.value = p.mie ?? 0.004; u.mieDirectionalG.value = 0.85;
  sky.visible = !p.gradient; gradSky.visible = !!p.gradient;
  if (p.gradient) { gradMat.uniforms.top.value.set(p.gradient[0]); gradMat.uniforms.bottom.value.set(p.gradient[1]); gradMat.uniforms.glow.value.set(p.gradient[2] ?? 0); }

  // environment map from just the sky
  const envScene = new THREE.Scene();
  envScene.add(p.gradient ? gradSky.clone() : sky.clone());
  envRT?.dispose();
  envRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = p.envIntensity ?? 1;

  scene.fog = new THREE.FogExp2(p.fog ?? 0xcfe3ff, p.fogDensity ?? 0.008);
  sun.color.set(p.sunColor ?? 0xfff1dc); sun.intensity = p.sunIntensity ?? 3;
  hemi.color.set(p.hemiSky ?? 0xbfdcff); hemi.groundColor.set(p.hemiGround ?? 0x5d7f52); hemi.intensity = p.hemiIntensity ?? 0.6;
  renderer.toneMappingExposure = p.exposure ?? 1;
  grade.uniforms.tint.value.set(...(p.grade?.tint ?? [1, 1, 1]));
  gradeBase.sat = grade.uniforms.sat.value = p.grade?.sat ?? 1.08;
  gradeBase.vig = grade.uniforms.vignette.value = p.grade?.vignette ?? 0.35;
  setFearGrade(gradeBase.fear);
  grade.uniforms.contrast.value = p.grade?.contrast ?? 1.05;
  buildClouds(p.clouds ?? 14, p.cloudColor ?? 0xffffff);
  const sea = p.sea; // { lit, shade } or null
  seas.forEach((m) => {
    m.visible = !!sea;
    if (!sea) return;
    const u = m.material.uniforms;
    u.lit.value.set(sea.lit); u.shade.value.set(sea.shade); u.fogC.value.set(p.fog ?? 0xcfe3ff); u.sunD.value.copy(sunDir);
  });
  motes.visible = p.motes != null; // fireflies/motes only where a preset asks for them
  if (motes.visible) motes.material.color.set(p.motes).multiplyScalar(2.5);
}

function buildClouds(n, color) {
  clouds.clear();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1, emissive: color, emissiveIntensity: 0.15, fog: false });
  const puff = new THREE.IcosahedronGeometry(1, 2);
  for (let k = 0; k < n; k++) {
    const c = new THREE.Group();
    const a = (k / n) * Math.PI * 2 + Math.random(), r = 140 + Math.random() * 160;
    c.position.set(Math.cos(a) * r, 25 + Math.random() * 45, Math.sin(a) * r - 50);
    for (let j = 0; j < 6; j++) {
      const s = new THREE.Mesh(puff, m);
      s.position.set((Math.random() - 0.5) * 22, Math.random() * 5, (Math.random() - 0.5) * 8);
      s.scale.setScalar(5 + Math.random() * 7); s.scale.y *= 0.6;
      c.add(s);
    }
    c.userData.v = 0.5 + Math.random();
    clouds.add(c);
  }
}

// ---------- post ----------
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, sat: { value: 1.08 }, vignette: { value: 0.35 }, contrast: { value: 1.05 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; uniform float sat, vignette, contrast; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * tint;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, sat);
      col = (col - 0.18) * contrast + 0.18;
      float d = distance(vUv, vec2(0.5)); col *= 1. - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(max(col, 0.), c.a);
    }`,
});

let composer, aoPass, bloomPass;
const gradeBase = { sat: 1.08, vig: 0.35, fear: 0 };
// fear drains colour and closes the edges in (applied on top of the time-of-day grade)
// transformation flare: brief bloom spike on top of the preset
export function setBloomBoost(k) { if (bloomPass) { bloomPass.strength = 0.55 * (1 + k * 1.6); bloomPass.threshold = 3.2 / (1 + k * 0.6); } }
export function setFearGrade(f) {
  gradeBase.fear = f;
  grade.uniforms.sat.value = gradeBase.sat * (1 - 0.6 * f);
  grade.uniforms.vignette.value = gradeBase.vig + 0.32 * f;
}
export const aoSkip = new Set();
export function applyQuality() {
  const q = Q();
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.samples });
  composer?.dispose();
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  if (q.ao) {
    aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
    aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 });
    aoPass.blendIntensity = 0.85;
    // perf: grass/wheat are skipped in the AO normal/depth pre-pass (half their cost; AO on blades is noise anyway)
    const r = aoPass.render.bind(aoPass);
    aoPass.render = (...a) => { aoSkip.forEach((o) => (o.visible = false)); r(...a); aoSkip.forEach((o) => (o.visible = true)); };
    composer.addPass(aoPass);
  }
  if (q.bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 3.2) // threshold in HDR: only true emitters glow;
    composer.addPass(bloomPass);
  }
  composer.addPass(grade);
  composer.addPass(new OutputPass());
}
applyQuality();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

export { sky };
export const _dbg = { sky, seas, motes, clouds, get composer() { return composer; } };
export function render(dt) {
  sky.position.copy(camera.position); gradSky.position.copy(camera.position);
  seas.forEach((m, k) => { m.material.uniforms.t.value += dt * (k ? 0.7 : 1); m.position.x = camera.position.x; m.position.z = camera.position.z; });
  // motes wrap around the camera so there are always some nearby
  const c = camera.position, t = performance.now() / 1000;
  for (let k = 0; k < MOTES; k++) {
    const i = k * 3, sd = moteSeed[k];
    motePos[i] += Math.sin(t * 0.3 + sd) * dt * 0.3; motePos[i + 1] += dt * (0.15 + (sd % 1) * 0.2); motePos[i + 2] += Math.cos(t * 0.25 + sd) * dt * 0.3;
    for (let a = 0; a < 3; a += 2) { const d = motePos[i + a] - c.getComponent(a); if (d > 25) motePos[i + a] -= 50; else if (d < -25) motePos[i + a] += 50; }
    if (motePos[i + 1] - c.y > 12) motePos[i + 1] -= 18;
  }
  moteGeo.attributes.position.needsUpdate = true;
  clouds.children.forEach((c) => { c.position.x += c.userData.v * dt; if (c.position.x > 320) c.position.x = -320; });
  composer.render(dt);
}

// The Lantern: Mixamo X Bot body (three.js examples) re-dressed with an original suit shader, civilian clothes that the
// transformation replaces, first-person suited forearms/hands with the ring on the right middle finger, and the
// third-person camera (V toggle; forced during the transformation). Ring position follows the ring bone in third person.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { scene, camera } from '../gfx.js';

export const SU = { // shared uniforms (body + first-person arms)
  uForm: { value: 0 }, uFormMax: { value: 2.6 }, uRing: { value: new THREE.Vector3() }, uMask: { value: 0 }, uTime: { value: 0 },
  uEmblem: { value: null }, uEyeL: { value: new THREE.Vector3(0.033, 1.676, 0.09) }, uEyeR: { value: new THREE.Vector3(-0.033, 1.676, 0.09) }, uChest: { value: new THREE.Vector3(0, 1.33, 0.12) },
};
export const suit = { boneBy: {}, hipsY: 1, model: '', orbit: 0, ready: false, body: null, mixer: null, actions: {}, ringBone: null, ringMesh: null, bones: [], tp: 0, tpWanted: false, tpForced: false, suited: false };

// ---------- the emblem: an original lantern sigil (ring + lantern bars), drawn on a canvas ----------
function emblemTexture() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s; const x = cv.getContext('2d');
  x.strokeStyle = x.fillStyle = '#fff'; x.lineWidth = 22;
  x.beginPath(); x.arc(s / 2, s / 2, 68, 0, Math.PI * 2); x.stroke();                // the ring
  x.fillRect(s / 2 - 108, s / 2 - 50, 50, 22); x.fillRect(s / 2 + 58, s / 2 - 50, 50, 22); // lantern bars
  x.fillRect(s / 2 - 108, s / 2 + 28, 50, 22); x.fillRect(s / 2 + 58, s / 2 + 28, 50, 22);
  x.fillRect(s / 2 - 11, s / 2 - 120, 22, 40); x.fillRect(s / 2 - 11, s / 2 + 80, 22, 40);  // handle + base
  const t = new THREE.CanvasTexture(cv); t.needsUpdate = true; return t;
}
SU.uEmblem.value = emblemTexture();

const SUIT_GLSL = `
  uniform float uForm, uFormMax, uMask, uTime; uniform vec3 uRing, uEyeL, uEyeR, uChest; uniform sampler2D uEmblem;
  varying vec3 vObj; varying vec3 vW;
  float hh(vec3 p){ p = fract(p * 0.3183 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float band(float v, float a, float b){ return min(v - a, b - v); }         // >0 inside [a,b], distance to nearest edge
  // panel field for the Lantern suit, in bind-pose metres (X Bot: T-pose, 1.81 m, facing +z)
  float panels(vec3 o, out float seam){
    float ax = abs(o.x), y = o.y, d = -1., s = 1.;
    float side = min(band(ax, 0.12, 0.2), band(y, 1.0, 1.42));              // torso side panels
    float yoke = min(band(y, 1.4, 1.5), band(ax, 0.0, 0.26)) ;               // shoulder yoke
    float armTop = min(band(o.y, 1.437, 1.6), band(ax, 0.2, 0.68));          // outer stripe along each arm
    float leg = min(band(ax, 0.19, 0.3), band(y, 0.34, 0.95));               // outer leg stripes
    float boot = band(y, -0.1, 0.22);                                        // boots
    float glove = mix(-1., band(ax, 0.66, 1.2), step(1.2, y));               // gloves (outside = -1, not 0: 0 reads as a seam)
    d = max(max(max(side, yoke), max(armTop, leg)), max(boot, glove));
    seam = 1. - smoothstep(0.0, 0.0045, abs(d));                             // thin line along every panel border
    return step(0., d);
  }
`;

function patchSuit(sh, skinned) {
  Object.assign(sh.uniforms, SU);
  sh.vertexShader = (skinned ? 'attribute vec3 aObj;\n' : '') + 'varying vec3 vObj; varying vec3 vW;\n' + sh.vertexShader.replace(skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>', `${skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>'}
    vObj = ${skinned ? 'aObj' : 'position'}; vW = (modelMatrix * vec4(transformed, 1.)).xyz;`);
  sh.fragmentShader = SUIT_GLSL + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 o = vObj; float ax = abs(o.x);
      // ---- civilian: John's olive henley, dark jeans, dark skin, short hair ----
      bool head = o.y > 1.52, hands = ax > 0.665, legs = o.y < 0.95;
      #ifdef CIV_TEX
        vec3 civ = diffuseColor.rgb;                      // John's own clothes and skin from the model texture
      #else
        vec3 civ = legs ? vec3(0.09, 0.13, 0.22) : vec3(0.15, 0.17, 0.12);
        if (head || hands) civ = vec3(0.24, 0.15, 0.1);
        if (o.y > 1.745) civ = vec3(0.03);
        if (o.y < 0.09) civ = vec3(0.05);
      #endif
      // ---- suit: matte black base, layered dark-green panels, the chest sigil ----
      float seam; float pan = panels(o, seam);
      vec3 suitC = mix(vec3(0.012, 0.014, 0.013), vec3(0.02, 0.17, 0.07), pan);
      #ifdef CIV_TEX
        if (head) suitC = civ;                                                  // his own face and hair stay (mask below)
      #else
        if (head && !(o.y > 1.745)) suitC = vec3(0.24, 0.15, 0.1);
        if (o.y > 1.745) suitC = vec3(0.03);
      #endif
      vec2 eu = vec2((o.x - uChest.x) / 0.19 + 0.5, (o.y - uChest.y) / 0.19 + 0.5);
      float emb = (o.z > 0.03 && eu.x > 0. && eu.x < 1. && eu.y > 0. && eu.y < 1.) ? texture2D(uEmblem, eu).r : 0.;
      // ---- domino mask + eyes (forms last, from the bridge of the nose outward) ----
      vec3 mid = (uEyeL + uEyeR) * 0.5;
      float maskReg = step(abs(o.y - mid.y), 0.032) * step(ax, abs(uEyeL.x - uEyeR.x) * 0.5 + 0.05) * step(0.04, o.z);
      float eye = max(step(length((o.xy - uEyeL.xy) / vec2(0.018, 0.0085)), 1.), step(length((o.xy - uEyeR.xy) / vec2(0.018, 0.0085)), 1.)) * maskReg;
      float maskOn = maskReg * step(hh(floor(o * 220.)) * 0.6 + length(o.xy - mid.xy) * 4., uMask * 1.6);
      // ---- transformation: suit grows outward from the ring over the body ----
      float d = distance(vW, uRing);
      float suited = 1. - step(uForm, d);
      vec3 col = mix(civ, suitC, suited);
      col = mix(col, vec3(0.005), maskOn * (1. - eye));
      diffuseColor.rgb = col;
      float edge = (1. - smoothstep(0.0, 0.09, abs(d - uForm))) * step(0.001, uForm) * step(uForm, uFormMax - 0.02);
      float lines = smoothstep(0.65, 1., sin(o.y * 160. + o.x * 70. - uTime * 30.) * 0.5 + 0.5);
      float spark = step(0.93, hh(floor(o * 160.) + floor(uTime * 18.))) * (1. - suited) * (1. - smoothstep(0., 0.25, d - uForm));`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 Vv = normalize(cameraPosition - vW);
      float rim = pow(max(1. - abs(dot(normalize(vNormal), normalize((viewMatrix * vec4(Vv, 0.)).xyz))), 0.), 3.);
      vec3 G = vec3(0.12, 1., 0.32);
      totalEmissiveRadiance += suited * (G * seam * 3.2 + G * rim * 0.5 + G * emb * 2.6);
      totalEmissiveRadiance += maskOn * eye * vec3(0.8, 1., 0.85) * 5.;
      totalEmissiveRadiance += edge * G * (0.8 + lines * 3.5) + spark * G * 3.;`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.85, 0.55, suited);');
}
export function suitMaterial(skinned, map = null) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05, map });
  if (map) m.defines = { CIV_TEX: '' };
  m.onBeforeCompile = (sh) => patchSuit(sh, skinned);
  m.customProgramCacheKey = () => 'suit' + skinned + !!map;
  return m;
}

// ---------- body: a realistic Mixamo-rigged man (three.js 'Soldier'); X Bot as fallback ----------
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
export const pivot = new THREE.Group(); // at the hips: yaw/pitch/roll for flight happen here
// John from Mixamo (public/models/john/: john.fbx 'With Skin' + idle/walk/run[/flying].fbx 'Without Skin'), else the three.js rigs
const JOHN = '/models/john/';
const MODELS = [
  { url: JOHN + 'john.fbx', fbx: true, facing: Math.PI, hide: null, anims: { idle: 'idle.fbx', walk: 'walk.fbx', run: 'run.fbx', fly: 'flying.fbx' } },
  { url: '/models/Soldier.glb', facing: 0, hide: /visor/i },
  { url: '/models/Xbot.glb', facing: Math.PI, hide: null },
];
const exists = async (u) => { try { const r = await fetch(u, { method: 'HEAD' }); return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'); } catch { return false; } };
async function loadModel(M) {
  if (!M.fbx) { const g = await new GLTFLoader().loadAsync(M.url); return { scene: g.scene, animations: g.animations }; }
  const fbx = new FBXLoader(), root = await fbx.loadAsync(M.url);
  root.scale.setScalar(0.01); // Mixamo FBX is in centimetres
  const animations = [];
  for (const [name, file] of Object.entries(M.anims)) {
    if (!(await exists(JOHN + file))) continue;
    const a = await fbx.loadAsync(JOHN + file); const clip = a.animations[0]; if (!clip) continue;
    clip.name = name; animations.push(clip);
  }
  return { scene: root, animations };
}
for (const M of MODELS) {
  try {
    if (M.fbx && !(await exists(M.url))) continue; // no Mixamo John yet → next model
    const gltf = await loadModel(M);
    const body = gltf.scene;
    body.updateMatrixWorld(true);
    // normalised bind-pose coords (metres, y up, +z front) for the suit regions: model space, turned to face +z
    const toNorm = new THREE.Matrix4().makeRotationY(M.facing === 0 ? Math.PI : 0);
    let hipsY = 1.0;
    body.traverse((o) => {
      if (o.isSkinnedMesh) {
        if (M.hide && M.hide.test(o.name)) { o.visible = false; return; }
        _m2.multiplyMatrices(toNorm, o.matrixWorld); // geometry → model (bind) → normalised
        const p = o.geometry.attributes.position, a = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(_m2); a[i * 3] = _v.x; a[i * 3 + 1] = _v.y; a[i * 3 + 2] = _v.z; }
        o.geometry.setAttribute('aObj', new THREE.BufferAttribute(a, 3));
        const src = Array.isArray(o.material) ? o.material[0] : o.material;
        o.material = suitMaterial(true, src.map ?? null); o.castShadow = true; o.frustumCulled = false;
      }
      if (o.isBone) { suit.bones.push(o); suit.boneBy[o.name.replace(/^mixamorig\d*:?/, '')] = o; }
      if (o.isBone && /RightHandMiddle1$/.test(o.name)) suit.ringBone = o; // GLTFLoader strips ':' from 'mixamorig:…'
    });
    // eyes + chest from bind-pose bones, in the same normalised space
    const sm = body.getObjectByProperty('type', 'SkinnedMesh'), sk = sm.skeleton;
    _m2.multiplyMatrices(toNorm, sm.matrixWorld);
    const bindPos = (name, out) => { const i = sk.bones.findIndex((b) => b.name.endsWith(name)); if (i < 0) return null; out.setFromMatrixPosition(_m.copy(sk.boneInverses[i]).invert()).applyMatrix4(_m2); return out; };
    const head = bindPos('Head', new THREE.Vector3()), hips = bindPos('Hips', new THREE.Vector3());
    if (hips) hipsY = hips.y;
    if (!bindPos('LeftEye', SU.uEyeL.value) && head) { SU.uEyeL.value.set(0.033, head.y + 0.085, head.z + 0.09); SU.uEyeR.value.set(-0.033, head.y + 0.085, head.z + 0.09); }
    else bindPos('RightEye', SU.uEyeR.value);
    if (bindPos('Spine2', SU.uChest.value)) { SU.uChest.value.y += 0.1; SU.uChest.value.z += 0.12; }
    if (suit.ringBone) {
      const k = 1 / suit.ringBone.getWorldScale(_v).x; // ring sized in metres whatever the rig's units
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0125 * k, 0.0035 * k, 8, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.24, 1, 0.43).multiplyScalar(6) }));
      ring.rotation.y = Math.PI / 2; suit.ringBone.add(ring); suit.ringMesh = ring;
    }
    suit.mixer = new THREE.AnimationMixer(body);
    for (const clip of gltf.animations) { const n = clip.name.toLowerCase(), a = suit.mixer.clipAction(clip); suit.actions[n] = a; if (/^(idle|walk|run|fly)$/.test(n)) { a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); } }
    body.rotation.y = M.facing; body.position.y = -hipsY; // the model hangs from the hips pivot
    pivot.add(body); pivot.visible = false; scene.add(pivot);
    suit.body = body; suit.hipsY = hipsY; suit.model = M.url; suit.ready = true;
    break;
  } catch (e) { console.warn('suit: could not load', M.url, '(run sh tools/fetch_models.sh)', e.message); }
}

// ---------- first person: suited forearms + both hands (re-dresses player.js's view model) ----------
export function dressViewmodel(hand, ringTip) {
  const fp = (isArm) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }); // DoubleSide: the left hand is a mirror
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, SU);
      sh.vertexShader = 'varying vec3 vO;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vO = position;');
      sh.fragmentShader = 'uniform float uForm; varying vec3 vO;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float suited = step(0.5, uForm);
          vec3 civ = ${isArm ? 'vec3(0.15, 0.17, 0.12)' : 'vec3(0.24, 0.15, 0.1)'};   // henley sleeve / skin
          vec3 sc = ${isArm ? 'vec3(0.012, 0.014, 0.013)' : 'vec3(0.02, 0.17, 0.07)'}; // black sleeve / green glove
          diffuseColor.rgb = mix(civ, sc, suited);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float seamL = ${isArm ? '1. - smoothstep(0., 0.004, abs(abs(vO.x) - 0.06))' : '0.'};       // two seams down the forearm
          totalEmissiveRadiance += step(0.5, uForm) * seamL * vec3(0.12, 1., 0.32) * 2.5;`);
    };
    m.customProgramCacheKey = () => 'fp' + isArm;
    return m;
  };
  const armMat = fp(true), handMat = fp(false);
  hand.traverse((o) => { if (o.isMesh && !o.userData.ring) o.material = o.position.z > 0.2 ? armMat : handMat; }); // forearm + piping sit behind the palm
  const left = hand.clone(true); // left hand: mirror of the right, without the ring
  left.traverse((o) => { if (o.userData.ring || o.isLight) o.visible = false; });
  left.scale.x = -1; left.position.x = -hand.position.x; left.rotation.y = -hand.rotation.y;
  hand.parent.add(left);
  suit.leftHand = left; suit.rightHand = hand;
  return left;
}

// ---------- per frame: body pose/anim, third-person camera, ring position ----------
const UP = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(), right = new THREE.Vector3(), eye = new THREE.Vector3(), want = new THREE.Vector3(), chest = new THREE.Vector3(), _mL = new THREE.Matrix4();
// raycast: (from, dir, maxDist) → hit distance or maxDist (passed in so suit.js stays physics-agnostic)
// aim a bone so it points from itself toward its child along `dir` (pivot space), blended by w. Allocation-free.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qi = new THREE.Quaternion();
function aim(name, child, dir, w) {
  const B = suit.boneBy[name], C = suit.boneBy[child]; if (!B || !C || w <= 0.001) return;
  B.getWorldPosition(_a); C.getWorldPosition(_b); _d.subVectors(_b, _a).normalize();
  _t.copy(dir).normalize().applyQuaternion(pivot.quaternion);
  _qa.setFromUnitVectors(_d, _t); _qa.slerp(_qi.identity(), 1 - w);
  B.getWorldQuaternion(_qw); _qw.premultiply(_qa);
  B.parent.getWorldQuaternion(_qp); B.quaternion.copy(_qp.invert().multiply(_qw));
  B.updateMatrixWorld(true);
}
const D = (x, y, z) => new THREE.Vector3(x, y, z);
const POSE = { // pivot-space directions (-z = where you're flying, +y = towards the head)
  cruise: [['RightArm', 'RightForeArm', D(0.05, 1, -0.25)], ['RightForeArm', 'RightHand', D(0.02, 1, -0.2)], ['LeftArm', 'LeftForeArm', D(0.12, -1, 0.18)], ['LeftForeArm', 'LeftHand', D(0.06, -1, 0.22)],
    ['RightUpLeg', 'RightLeg', D(-0.05, -1, 0.08)], ['RightLeg', 'RightFoot', D(-0.03, -1, 0.1)], ['LeftUpLeg', 'LeftLeg', D(0.06, -1, 0.04)], ['LeftLeg', 'LeftFoot', D(0.04, -1, 0.35)]],
  hover: [['RightArm', 'RightForeArm', D(-0.45, -1, 0.05)], ['LeftArm', 'LeftForeArm', D(0.45, -1, 0.05)], ['RightLeg', 'RightFoot', D(0, -1, 0.18)], ['LeftLeg', 'LeftFoot', D(0, -1, 0.05)]],
};
let animW = { idle: 1, walk: 0, run: 0 }, cruiseW = 0, hoverW = 0, bYaw = 0, bPitch = 0, bRoll = 0;
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), vdir = new THREE.Vector3();
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
// raycast: (from, dir, maxDist) → hit distance or maxDist (passed in so suit.js stays physics-agnostic)
export function updateSuit(dt, player, raycast) {
  const target = suit.tpForced || suit.tpWanted ? 1 : 0;
  suit.tp += (target - suit.tp) * (1 - Math.exp(-dt * (suit.tpForced ? 5 : 7)));
  SU.uTime.value += dt;
  if (!suit.ready) return;
  pivot.visible = suit.tp > 0.02;
  if (suit.leftHand) { const fp = suit.tp < 0.5; suit.leftHand.visible = suit.rightHand.visible = fp; }
  const hs = Math.hypot(player.vel.x, player.vel.z), sp = player.vel.length();
  // pose weights: cruising = horizontal superhero pose along the flight path; hovering = upright, arms loose
  const cK = player.flying ? THREE.MathUtils.smoothstep(sp, 7, 18) : 0;
  cruiseW += (cK - cruiseW) * (1 - Math.exp(-dt * 4));
  hoverW += ((player.flying ? 1 - cK : 0) - hoverW) * (1 - Math.exp(-dt * 4));
  // pivot at the hips; heading follows velocity when cruising, the camera otherwise
  if (sp > 1) vdir.copy(player.vel).normalize(); else vdir.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const velYaw = Math.atan2(-vdir.x, -vdir.z), wantYaw = cruiseW > 0.3 ? velYaw : player.yaw;
  const wantPitch = -(Math.PI / 2 - Math.asin(THREE.MathUtils.clamp(vdir.y, -1, 1))) * cruiseW - (player.flying ? Math.min(0.3, hs / 40) : 0) * (1 - cruiseW);
  const wantRoll = THREE.MathUtils.clamp(player.turnRate * 0.35, -0.9, 0.9) * cruiseW;
  const k = 1 - Math.exp(-dt * 6);
  bYaw = angLerp(bYaw, wantYaw, k); bPitch += (wantPitch - bPitch) * k; bRoll += (wantRoll - bRoll) * k;
  pivot.quaternion.setFromEuler(_e.set(bPitch, bYaw, bRoll));
  pivot.position.set(player.pos.x, player.pos.y - 1.75 + suit.hipsY, player.pos.z);
  const run = !player.flying && hs > 5.5, walk = !player.flying && hs > 0.6 && !run;
  const flyClip = !!suit.actions.fly && player.flying;
  for (const [n, on] of [['idle', !run && !walk && !flyClip], ['walk', walk], ['run', run], ['fly', flyClip]]) { animW[n] = animW[n] ?? 0; animW[n] += ((on ? 1 : 0) - animW[n]) * (1 - Math.exp(-dt * 8)); suit.actions[n]?.setEffectiveWeight(animW[n]); }
  if (pivot.visible) {
    suit.mixer.update(dt);
    pivot.updateMatrixWorld(true);
    for (const [bn, cn, d] of POSE.cruise) aim(bn, cn, d, cruiseW);
    for (const [bn, cn, d] of POSE.hover) aim(bn, cn, d, hoverW * 0.6);
  }
  // third-person camera: over-the-shoulder, pulled in if a wall is in the way
  if (suit.tp > 0.001) {
    camera.getWorldDirection(fwd); right.crossVectors(fwd, UP).normalize();
    eye.copy(player.pos);
    want.copy(fwd).multiplyScalar(-(5.2 + Math.min(4, sp * 0.06))).addScaledVector(UP, 0.45).addScaledVector(right, 0.6); // over the shoulder; chase camera pulls back at speed
    if (suit.orbit > 0) { want.applyAxisAngle(UP, suit.orbit * 2.6); want.multiplyScalar(1 - suit.orbit * 0.35); } // transformation: swing round to the front
    const len = want.length(); want.normalize();
    const d = raycast ? Math.max(0.6, raycast(eye, want, len) - 0.3) : len;
    const k = suit.tp * suit.tp * (3 - 2 * suit.tp);
    camera.position.copy(eye).addScaledVector(want, d * k);
    if (suit.orbit > 0) { // look at the chest while orbiting (blend from the normal look direction)
      chest.copy(player.pos); chest.y -= 0.5;
      _mL.lookAt(camera.position, chest, UP); _q.setFromRotationMatrix(_mL);
      camera.quaternion.slerp(_q, Math.min(1, suit.orbit * 1.5));
    }
  }
}
const _rp = new THREE.Vector3();
export function ringWorld(ringTip, out) {
  if (suit.tp > 0.5 && suit.ringMesh) return suit.ringMesh.getWorldPosition(out);
  return ringTip.getWorldPosition(out);
}

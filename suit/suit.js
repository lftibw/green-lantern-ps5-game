// The Lantern: Mixamo X Bot body (three.js examples) re-dressed with an original suit shader, civilian clothes that the
// transformation replaces, first-person suited forearms/hands with the ring on the right middle finger, and the
// third-person camera (V toggle; forced during the transformation). Ring position follows the ring bone in third person.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera } from '../gfx.js';

export const SU = { // shared uniforms (body + first-person arms)
  uForm: { value: 0 }, uFormMax: { value: 2.6 }, uRing: { value: new THREE.Vector3() }, uMask: { value: 0 }, uTime: { value: 0 },
  uEmblem: { value: null }, uEyeL: { value: new THREE.Vector3(0.033, 1.676, 0.09) }, uEyeR: { value: new THREE.Vector3(-0.033, 1.676, 0.09) }, uChest: { value: new THREE.Vector3(0, 1.33, 0.12) },
};
export const suit = { orbit: 0, ready: false, body: null, mixer: null, actions: {}, ringBone: null, ringMesh: null, bones: [], tp: 0, tpWanted: false, tpForced: false, suited: false };

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
  sh.vertexShader = 'varying vec3 vObj; varying vec3 vW;\n' + sh.vertexShader.replace(skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>', `${skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>'}
    vObj = position; vW = (modelMatrix * vec4(transformed, 1.)).xyz;`);
  sh.fragmentShader = SUIT_GLSL + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 o = vObj; float ax = abs(o.x);
      // ---- civilian: John's olive henley, dark jeans, dark skin, short hair ----
      bool head = o.y > 1.52, hands = ax > 0.665, legs = o.y < 0.95;
      vec3 civ = legs ? vec3(0.09, 0.13, 0.22) : vec3(0.15, 0.17, 0.12);
      if (head || hands) civ = vec3(0.24, 0.15, 0.1);
      if (o.y > 1.745) civ = vec3(0.03);
      if (o.y < 0.09) civ = vec3(0.05);
      // ---- suit: matte black base, layered dark-green panels, the chest sigil ----
      float seam; float pan = panels(o, seam);
      vec3 suitC = mix(vec3(0.012, 0.014, 0.013), vec3(0.02, 0.17, 0.07), pan);
      if (head && !(o.y > 1.745)) suitC = vec3(0.24, 0.15, 0.1);               // face stays John's (mask below)
      if (o.y > 1.745) suitC = vec3(0.03);
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
export function suitMaterial(skinned) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 });
  m.onBeforeCompile = (sh) => patchSuit(sh, skinned);
  m.customProgramCacheKey = () => 'suit' + skinned;
  return m;
}

// ---------- body ----------
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
try {
  const gltf = await new GLTFLoader().loadAsync('/models/Xbot.glb');
  const body = gltf.scene; body.visible = false;
  body.traverse((o) => {
    if (o.isSkinnedMesh) { o.material = suitMaterial(true); o.castShadow = true; o.frustumCulled = false; }
    if (o.isBone) suit.bones.push(o);
    if (o.isBone && /RightHandMiddle1$/.test(o.name)) suit.ringBone = o; // GLTFLoader strips ':' from 'mixamorig:…'
  });
  // eye + chest positions from the bind pose (bone world matrix = inverse of its bind inverse)
  const sk = body.getObjectByProperty('type', 'SkinnedMesh').skeleton;
  const bindPos = (name, out) => { const i = sk.bones.findIndex((b) => b.name.endsWith(name.split(':').pop())); if (i >= 0) out.setFromMatrixPosition(_m.copy(sk.boneInverses[i]).invert()); return out; };
  bindPos('mixamorig:LeftEye', SU.uEyeL.value); bindPos('mixamorig:RightEye', SU.uEyeR.value);
  bindPos('mixamorig:Spine2', SU.uChest.value); SU.uChest.value.y += 0.1;
  // ring on the right middle finger
  if (suit.ringBone) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0035, 8, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.24, 1, 0.43).multiplyScalar(6) }));
    ring.rotation.y = Math.PI / 2; suit.ringBone.add(ring); suit.ringMesh = ring;
  }
  suit.mixer = new THREE.AnimationMixer(body);
  for (const clip of gltf.animations) { const a = suit.mixer.clipAction(clip); suit.actions[clip.name] = a; if (/idle|walk|run/.test(clip.name)) { a.play(); a.setEffectiveWeight(clip.name === 'idle' ? 1 : 0); } }
  scene.add(body); suit.body = body; suit.ready = true;
} catch (e) { console.warn('suit: X Bot model missing (run sh tools/fetch_models.sh); third person disabled', e); }

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
let animW = { idle: 1, walk: 0, run: 0 };
// raycast: (from, dir, maxDist) → hit distance or maxDist (passed in so suit.js stays physics-agnostic)
export function updateSuit(dt, player, raycast) {
  const target = suit.tpForced || suit.tpWanted ? 1 : 0;
  suit.tp += (target - suit.tp) * (1 - Math.exp(-dt * (suit.tpForced ? 5 : 7)));
  SU.uTime.value += dt;
  if (!suit.ready) return;
  const b = suit.body;
  b.visible = suit.tp > 0.02;
  if (suit.leftHand) { const fp = suit.tp < 0.5; suit.leftHand.visible = suit.rightHand.visible = fp; }
  // body under the eye, facing where you look
  b.position.set(player.pos.x, player.pos.y - 1.75, player.pos.z);
  const hs = Math.hypot(player.vel.x, player.vel.z);
  b.rotation.set(player.flying ? -Math.min(1.25, hs / 30) : 0, player.yaw + Math.PI, 0, 'YXZ');
  if (player.flying) b.position.y += 0.6;
  const run = !player.flying && hs > 5.5, walk = !player.flying && hs > 0.6 && !run;
  for (const [k, on] of [['idle', !run && !walk], ['walk', walk], ['run', run]]) { animW[k] += ((on ? 1 : 0) - animW[k]) * (1 - Math.exp(-dt * 8)); suit.actions[k]?.setEffectiveWeight(animW[k]); }
  suit.mixer.update(b.visible ? dt : 0);
  // third-person camera: over-the-shoulder, pulled in if a wall is in the way
  if (suit.tp > 0.001) {
    camera.getWorldDirection(fwd); right.crossVectors(fwd, UP).normalize();
    eye.copy(player.pos);
    want.copy(fwd).multiplyScalar(-4.4).addScaledVector(UP, 0.7).addScaledVector(right, 0.55);
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

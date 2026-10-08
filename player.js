// First-person Lantern: walk, take off, fly. Ring hand view-model with a real light on the ring.
import * as THREE from 'three';
import { camera, scene } from './gfx.js';
import { height, SPAWN } from './world.js';
import { movePlayer, kcGrounded } from './sim/playerbody.js';

const EYE = 1.75, WALK = 5, RUN = 9;
// superhero flight: hover is responsive and camera-relative; above HOVER_MAX you cruise with momentum, carving turns
// toward where you look, gliding on when you let go. Tune live from the console: dbg.FLIGHT
export const FLIGHT = {
  hoverMax: 9, hoverSpeed: 11, hoverResp: 4.5, vert: 9,
  cruise: 32, boost: 80, accel: 20, boostAccel: 55,
  turn: 3.2, turnAtBoost: 1.1, glideDrag: 0.25, brake: 2.6,
  jump: 7.5, takeoffHold: 0.32,
  lookYaw: 3.4, lookPitch: 2.5, lookExpo: 1.7, lookResp: 14,
};
export const player = { pos: new THREE.Vector3(SPAWN.x, height(SPAWN.x, SPAWN.z) + EYE, SPAWN.z), vel: new THREE.Vector3(), yaw: 0, pitch: 0, flying: false, speed: 0, roll: 0, grounded: true,
  boosting: false, cruising: false, turnRate: 0, crossHeld: 0, airJump: false };
scene.add(camera);

// ---------- ring hand (glove + ring), parented to camera ----------
export const hand = new THREE.Group();
export const ringTip = new THREE.Object3D(); // where constructs and the tether start
{
  const suit = new THREE.MeshStandardMaterial({ color: 0x0b1410, roughness: 0.55, metalness: 0.2 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a2a12, emissive: 0x3dff6e, emissiveIntensity: 2.2, roughness: 0.3 });
  const add = (g, m, x, y, z, p = hand) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); p.add(o); return o; };
  const arm = add(new THREE.CapsuleGeometry(0.075, 0.5, 6, 16), suit, 0, -0.05, 0.32); arm.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.003, 0.02, 0.5), glow, 0.076, -0.03, 0.32); // suit piping
  const palm = add(new THREE.BoxGeometry(0.13, 0.1, 0.12), suit, 0, 0, 0);
  for (let k = 0; k < 4; k++) { // curled fingers
    const f = add(new THREE.CapsuleGeometry(0.024, 0.05, 4, 8), suit, -0.045 + k * 0.03, 0.02, -0.07); f.rotation.x = Math.PI / 2.4;
  }
  const thumb = add(new THREE.CapsuleGeometry(0.024, 0.05, 4, 8), suit, -0.07, -0.02, -0.03); thumb.rotation.z = 1.1;
  const ring = add(new THREE.TorusGeometry(0.028, 0.008, 8, 20), new THREE.MeshStandardMaterial({ color: 0x9fb8a8, metalness: 1, roughness: 0.25 }), -0.015, 0.045, -0.075); // middle finger
  ring.userData.ring = true;
  ring.rotation.x = Math.PI / 2.4;
  const gem = add(new THREE.BoxGeometry(0.03, 0.012, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dff6e).multiplyScalar(6) }), -0.015, 0.062, -0.075);
  gem.userData.ring = true;
  hand.userData.gem = gem;
  ringTip.position.set(-0.015, 0.08, -0.12); hand.add(ringTip);
  const l = new THREE.PointLight(0x3dff6e, 0.6, 6, 2); l.position.set(-0.04, 0.25, -0.9); hand.add(l); hand.userData.light = l; // ahead of the hand: lights the world, not the glove
  hand.position.set(0.24, -0.24, -0.42); hand.rotation.set(0.15, 0.25, 0);
  hand.traverse((o) => { o.castShadow = false; });
  camera.add(hand);
}

const _mv = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const look = new THREE.Vector3(), yawFwd = new THREE.Vector3(), _axis = new THREE.Vector3(), _q = new THREE.Quaternion(), _dir = new THREE.Vector3();
const lookVel = { yaw: 0, pitch: 0 };
const expo = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);
// i: input snapshot, g: gyro deltas {yaw,pitch}, aimHand: 0..1 (R2 raises the ring hand)
export function updatePlayer(dt, i, g, aimHand) {
  const F = FLIGHT;
  // ---- look: response curve (fine aim near centre, fast at full tilt) with a little smoothing, no twitch ----
  const wantYaw = -expo(i.cx, F.lookExpo) * F.lookYaw, wantPitch = expo(i.cy, F.lookExpo) * F.lookPitch;
  const kr = 1 - Math.exp(-dt * F.lookResp);
  lookVel.yaw += (wantYaw - lookVel.yaw) * kr; lookVel.pitch += (wantPitch - lookVel.pitch) * kr;
  player.yaw += lookVel.yaw * dt + g.yaw;
  player.pitch = THREE.MathUtils.clamp(player.pitch + lookVel.pitch * dt + g.pitch, -1.45, 1.45);
  camera.quaternion.setFromEuler(_e.set(player.pitch, player.yaw, player.roll));

  const ground = height(player.pos.x, player.pos.z) + EYE;
  // ---- ✕: jump on the ground; press again in the air (or hold ✕ on the ground) to take off ----
  const crossDown = i.cross && !player.prevCross;
  player.crossHeld = i.cross ? player.crossHeld + dt : 0;
  if (!player.flying) {
    if (crossDown && player.grounded) { player.vel.y = F.jump; player.airJump = true; }
    else if (crossDown && !player.grounded) { player.flying = true; player.vel.y = Math.max(player.vel.y, 3); }
    else if (player.crossHeld > F.takeoffHold) { player.flying = true; player.vel.y = Math.max(player.vel.y, 6); }
  }
  player.prevCross = i.cross;
  camera.getWorldDirection(look); yawFwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); right.set(-yawFwd.z, 0, yawFwd.x);

  if (player.flying) {
    const v = player.vel, speed = v.length();
    player.boosting = i.r1 && i.my > 0.2;
    player.cruising = speed > F.hoverMax;
    player.turnRate = 0;
    if (!player.cruising && !(i.my > 0.5 && speed > F.hoverMax * 0.6)) {
      // hover: responsive, camera-relative; ✕/◯ rise and sink
      want.copy(yawFwd).multiplyScalar(i.my * F.hoverSpeed).addScaledVector(right, i.mx * F.hoverSpeed * 0.8);
      want.addScaledVector(look, Math.max(0, i.my) * 4); // pushing forward while looking down/up dips/climbs
      want.y += ((i.cross ? 1 : 0) - (i.circle ? 1 : 0)) * F.vert;
      v.lerp(want, 1 - Math.exp(-dt * F.hoverResp));
      if (i.my > 0.5) v.addScaledVector(look, F.accel * i.my * dt); // keep pushing → break into a cruise
    } else {
      // cruise: momentum. Thrust along where you look; velocity carves toward the look direction.
      const target = (player.boosting ? F.boost : F.cruise) * Math.max(0, i.my);
      const acc = player.boosting ? F.boostAccel : F.accel;
      if (i.my > 0.1 && speed < target) v.addScaledVector(look, acc * dt);
      if (speed > 0.5) {
        _dir.copy(v).normalize();
        const ang = _dir.angleTo(look), rate = THREE.MathUtils.lerp(F.turn, F.turnAtBoost, THREE.MathUtils.clamp((speed - F.cruise) / (F.boost - F.cruise), 0, 1));
        if (ang > 1e-3 && i.my > -0.2) {
          const step = Math.min(ang, rate * dt);
          _axis.crossVectors(_dir, look).normalize();
          if (_axis.lengthSq() > 0.5) { _q.setFromAxisAngle(_axis, step); v.applyQuaternion(_q); player.turnRate = step / dt * Math.sign(_axis.y || 1); }
        }
      }
      v.addScaledVector(right, i.mx * F.accel * 0.5 * dt);                 // strafe nudges
      v.y += ((i.cross ? 1 : 0) - 0) * F.vert * 0.6 * dt;                   // ✕ climbs
      if (i.circle) v.multiplyScalar(Math.exp(-F.brake * dt));               // ◯ air-brakes into a hover
      else if (i.my <= 0.1) v.multiplyScalar(Math.exp(-F.glideDrag * dt));   // let go: glide on, slowly bleeding speed
      if (speed > target && i.my > 0.1) v.multiplyScalar(Math.exp(-0.6 * dt)); // ease down from boost
    }
    // land: touching down slowly while sinking, or ◯ on the ground / a roof
    const near = player.pos.y <= ground + 0.15 || kcGrounded();
    if (near && speed < 7 && (i.circle || v.y < -0.5)) player.flying = false;
  } else {
    player.boosting = player.cruising = false;
    const sp = i.l3 ? RUN : WALK;
    want.copy(yawFwd).multiplyScalar(i.my * sp).addScaledVector(right, i.mx * sp);
    player.vel.x += (want.x - player.vel.x) * (1 - Math.exp(-dt * 10));
    player.vel.z += (want.z - player.vel.z) * (1 - Math.exp(-dt * 10));
    player.vel.y -= 22 * dt;
  }
  const moved = movePlayer(player.pos, _mv.copy(player.vel).multiplyScalar(dt), EYE); // trees, walls and heavy props stop you; light props get shoved
  if (dt > 0) { player.vel.x = moved.x / dt; player.vel.z = moved.z / dt; if (player.flying) player.vel.y = moved.y / dt; } // hitting something kills your speed into it
  const onCollider = !player.flying && kcGrounded();
  player.grounded = player.pos.y <= ground || onCollider;
  if (player.pos.y <= ground) player.pos.y = ground;
  if (player.grounded && player.vel.y < 0) { player.vel.y = 0; player.airJump = false; }
  player.pos.y = Math.min(player.pos.y, 400);
  player.speed = player.vel.length();
  // feel: a subtle camera bank into carving turns (the body banks harder in third person); FOV opens with speed
  const bank = player.flying ? THREE.MathUtils.clamp(-player.turnRate * 0.05 - i.mx * 0.04, -0.09, 0.09) : 0;
  player.roll += (bank - player.roll) * (1 - Math.exp(-dt * 3));
  camera.fov += (60 + Math.min(22, player.speed * 0.28) + (player.boosting ? 6 : 0) - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix();
  camera.position.copy(player.pos);
  if (!player.flying && player.grounded) camera.position.y += Math.sin(performance.now() / 160) * Math.min(1, player.speed / WALK) * 0.03;
  if (player.boosting) camera.position.addScaledVector(right, (Math.random() - 0.5) * 0.015 * Math.min(1, player.speed / 60)); // buffeting at speed

  // hand: raise toward centre while projecting will
  hand.position.set(0.24 - aimHand * 0.1, -0.24 + aimHand * 0.08, -0.42 - aimHand * 0.06);
  hand.rotation.set(0.15 + aimHand * 0.25, 0.25 - aimHand * 0.2, 0);
}

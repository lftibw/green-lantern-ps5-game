// First-person Lantern: walk, take off, fly. Ring hand view-model with a real light on the ring.
import * as THREE from 'three';
import { camera, scene } from './gfx.js';
import { height } from './world.js';

const EYE = 1.75, WALK = 5, RUN = 9, FLY = 14, BOOST = 45;
export const player = { pos: new THREE.Vector3(0, height(0, 0) + EYE, 6), vel: new THREE.Vector3(), yaw: 0, pitch: 0, flying: false, speed: 0, roll: 0, grounded: true };
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
  const ring = add(new THREE.TorusGeometry(0.028, 0.008, 8, 20), new THREE.MeshStandardMaterial({ color: 0x9fb8a8, metalness: 1, roughness: 0.25 }), -0.045, 0.045, -0.075);
  ring.rotation.x = Math.PI / 2.4;
  const gem = add(new THREE.BoxGeometry(0.03, 0.012, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dff6e).multiplyScalar(6) }), -0.045, 0.062, -0.075);
  hand.userData.gem = gem;
  ringTip.position.set(-0.045, 0.08, -0.12); hand.add(ringTip);
  const l = new THREE.PointLight(0x3dff6e, 0.6, 6, 2); l.position.set(-0.04, 0.25, -0.9); hand.add(l); hand.userData.light = l; // ahead of the hand: lights the world, not the glove
  hand.position.set(0.24, -0.24, -0.42); hand.rotation.set(0.15, 0.25, 0);
  hand.traverse((o) => { o.castShadow = false; });
  camera.add(hand);
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
// i: input snapshot, g: gyro deltas {yaw,pitch}, aimHand: 0..1 (R2 raises the ring hand)
export function updatePlayer(dt, i, g, aimHand) {
  player.yaw += (-i.cx * 2.4 * dt) + g.yaw;
  player.pitch = THREE.MathUtils.clamp(player.pitch + i.cy * 1.8 * dt + g.pitch, -1.45, 1.45);
  camera.quaternion.setFromEuler(_e.set(player.pitch, player.yaw, player.roll));

  const ground = height(player.pos.x, player.pos.z) + EYE;
  if (!player.flying && i.cross && !player.prevCross) { player.flying = true; player.vel.y = Math.max(player.vel.y, 6); }
  player.prevCross = i.cross;

  if (player.flying) {
    camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize();
    const sp = i.r1 ? BOOST : FLY;
    want.copy(fwd).multiplyScalar(i.my * sp).addScaledVector(right, i.mx * sp * 0.7);
    want.y += ((i.cross ? 1 : 0) - (i.circle ? 1 : 0)) * 9;
    player.vel.lerp(want, 1 - Math.exp(-dt * (i.r1 ? 1.5 : 3)));
    player.vel.y += Math.sin(performance.now() / 600) * 0.02; // hover bob
    if (player.pos.y <= ground + 0.05 && i.circle) { player.flying = false; }
  } else {
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); right.set(-fwd.z, 0, fwd.x);
    const sp = i.l3 ? RUN : WALK;
    want.copy(fwd).multiplyScalar(i.my * sp).addScaledVector(right, i.mx * sp);
    player.vel.x += (want.x - player.vel.x) * (1 - Math.exp(-dt * 10));
    player.vel.z += (want.z - player.vel.z) * (1 - Math.exp(-dt * 10));
    player.vel.y -= 22 * dt;
  }
  player.pos.addScaledVector(player.vel, dt);
  player.grounded = player.pos.y <= ground;
  if (player.grounded) { player.pos.y = ground; if (player.vel.y < 0) player.vel.y = 0; }
  player.pos.y = Math.min(player.pos.y, 400);
  player.speed = player.vel.length();
  // feel: bank into strafes/turns, FOV opens with speed
  const bank = player.flying ? -i.mx * 0.12 - i.cx * 0.06 : 0;
  player.roll += (bank - player.roll) * (1 - Math.exp(-dt * 4));
  camera.fov += (60 + Math.min(18, player.speed * 0.3) - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix();
  camera.position.copy(player.pos);
  if (!player.flying && player.grounded) camera.position.y += Math.sin(performance.now() / 160) * Math.min(1, player.speed / WALK) * 0.03;

  // hand: raise toward centre while projecting will
  hand.position.set(0.24 - aimHand * 0.1, -0.24 + aimHand * 0.08, -0.42 - aimHand * 0.06);
  hand.rotation.set(0.15 + aimHand * 0.25, 0.25 - aimHand * 0.2, 0);
}

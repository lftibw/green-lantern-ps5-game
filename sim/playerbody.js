// Player body: a capsule moved by Rapier's kinematic character controller.
// You get stopped by trees, walls and heavy props, and you shove light props out of the way.
// Ground height still comes from world height() in player.js; terrain is excluded here.
import { physics, RAPIER, terrainCollider } from '../world.js';
import { tagOf } from './impacts.js';

const HALF = 0.55, RADIUS = 0.35; // ≈1.8 m tall
const cc = physics.createCharacterController(0.04);
cc.setApplyImpulsesToDynamicBodies(true);
cc.setCharacterMass(90);
cc.setSlideEnabled(true);
cc.setMaxSlopeClimbAngle(Math.PI / 3);
// sensor: the controller only needs the shape; as a solid it'd be an invisible wall your own constructs bump into
const col = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setTranslation(0, -100, 0).setSensor(true));
// hard light is yours: you pass through your own constructs; terrain handled by height()
const include = (c) => c.handle !== terrainCollider.handle && tagOf(c.handle)?.mat !== 'light';

const _d = { x: 0, y: 0, z: 0 };
// eyePos: THREE.Vector3 (mutated), delta: THREE.Vector3 desired move this frame, eye: eye height above feet
export const kcGrounded = () => cc.computedGrounded(); // standing on a collider (roof, bridge deck, viaduct)
export function movePlayer(eyePos, delta, eye) {
  const cy = eyePos.y - eye + HALF + RADIUS;
  col.setTranslation({ x: eyePos.x, y: cy, z: eyePos.z });
  _d.x = delta.x; _d.y = delta.y; _d.z = delta.z;
  cc.computeColliderMovement(col, _d, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, include);
  const m = cc.computedMovement();
  eyePos.x += m.x; eyePos.y += m.y; eyePos.z += m.z;
  col.setTranslation({ x: eyePos.x, y: eyePos.y - eye + HALF + RADIUS, z: eyePos.z });
  return m;
}

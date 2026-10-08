// Will drive: the held construct is pulled toward the aim point by a critically damped spring,
// applied as impulses with a force cap set by your will (R2) and ring charge.
// Light constructs snap to the aim; heavy ones lag and swing; a truck in the way really pushes back.
// Drop-in replacement for constructs.js steer(). Call every fixed physics step.
import * as THREE from 'three';

export const WILL = {
  stiffness: 45,       // spring k (1/s^2): how hard the aim point pulls
  damping: 1.0,        // 1 = critically damped (no wobble), <1 swings
  carryAccel: 4,       // m/s^2 you can always give your own construct, even with R2 released
  pushForce: 34000,    // extra N at full R2 + full charge. Tuned headless (tools/test_willdrive.mjs): 3.9 t truck moves 7.7 m in 4 s at full R2, ~0 at R2 0.6
  punchForce: 140000,  // burst during a fist punch
  angStiffness: 35,
  angCarry: 60,        // rad/s^2 always available
  pushTorque: 30000,   // extra N·m at full R2
};

const _d = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion();
const imp = { x: 0, y: 0, z: 0 };

// c: construct from constructs.js (needs body, strain, punch). r2: 0..1, charge: 0..1, dt: fixed step
// fear: 0..1 from fear.js; it saps the whole will, floor included
export function steerWeighty(c, target, targetQ, r2, charge, dt, fear = 0) {
  if (!c) return;
  const b = c.body, m = b.mass(), t = b.translation(), lv = b.linvel();
  const will = (0.12 + 0.88 * Math.pow(r2, 1.5)) * (0.25 + 0.75 * charge) * (1 - 0.5 * fear); // light squeeze = gentle, full squeeze = everything

  // ---- linear: desired accel = k*x - c*v ----
  const k = WILL.stiffness, cd = 2 * Math.sqrt(k) * WILL.damping;
  _d.set(target.x - t.x, target.y - t.y, target.z - t.z);
  const err = _d.length();
  _a.copy(_d).multiplyScalar(k).addScaledVector(_v.set(lv.x, lv.y, lv.z), -cd);
  const want = _a.length() * m;
  const cap = m * WILL.carryAccel + (c.punch > 0 ? WILL.punchForce : WILL.pushForce) * will;
  const sat = want > cap ? cap / want : 1;
  _a.multiplyScalar(m * sat * dt);
  imp.x = _a.x; imp.y = _a.y; imp.z = _a.z;
  b.applyImpulse(imp, true);

  // strain: will is maxed out AND the construct is barely making progress (something heavy is in the way)
  const got = err > 1e-3 ? (lv.x * _d.x + lv.y * _d.y + lv.z * _d.z) / err : 0;
  const stalled = THREE.MathUtils.clamp(1 - got / Math.max(1, Math.min(err * 2, 6)), 0, 1);
  const blocked = (sat < 0.98 ? 1 : 0) * stalled * THREE.MathUtils.clamp((err - 0.3) / 1.2, 0, 1);
  c.strain += (Math.min(1, blocked * 1.3 + (c.extStrain || 0)) - c.strain) * 0.1; // extStrain: the Dread leaning on it

  // ---- angular: same idea with a torque cap ----
  const r = b.rotation();
  _q.set(r.x, r.y, r.z, r.w).invert().premultiply(targetQ);
  if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
  const ang = 2 * Math.acos(Math.min(1, _q.w)), s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w)) || 1;
  const av = b.angvel(), I = b.principalInertia(), Ia = (I.x + I.y + I.z) / 3;
  const ka = WILL.angStiffness, ca = 2 * Math.sqrt(ka);
  _a.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang * ka).addScaledVector(_v.set(av.x, av.y, av.z), -ca).multiplyScalar(Ia);
  const T = _a.length(), tcap = Ia * WILL.angCarry + WILL.pushTorque * will;
  _a.multiplyScalar((T > tcap ? tcap / T : 1) * dt);
  imp.x = _a.x; imp.y = _a.y; imp.z = _a.z;
  b.applyTorqueImpulse(imp, true);
}

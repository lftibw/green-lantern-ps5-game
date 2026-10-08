// Headless check of sim/willdrive.js: a 1.5 t construct pushes the 3.9 t truck for 4 s at light vs full R2.
// Expect: light R2 barely moves it (cap < truck's ground friction), full R2 shoves it several metres.
// Run: node tools/test_willdrive.mjs
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { steerWeighty, WILL } from '../sim/willdrive.js';

await RAPIER.init();
const DT = 1 / 60;

function run(r2, { charge = 1, fear = 0, secs = 4 } = {}) {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.9)); // ground
  // truck exactly as in world.js: half extents 1 × 0.75 × 2.5, density 260 → 3900 kg, friction 0.9
  const truck = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.75, 0).setAngularDamping(0.5));
  w.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.75, 2.5).setDensity(260).setFriction(0.9), truck);
  // 1.5 t construct (density 450 like constructs.js), floating (gravity 0), touching the truck's rear
  const half = Math.cbrt(1500 / 450) / 2;
  const cb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.9, -2.5 - half - 0.02).setGravityScale(0).setLinearDamping(0.5).setAngularDamping(2).setCcdEnabled(true));
  w.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setDensity(450).setFriction(0.8).setRestitution(0.1), cb);
  for (let k = 0; k < 30; k++) w.step(); // settle
  const c = { body: cb, strain: 0, punch: 0, extStrain: 0 };
  const target = new THREE.Vector3(0, 0.9, 20), q = new THREE.Quaternion(); // aim far ahead, through the truck
  const t0 = truck.translation(), z0 = t0.z;
  let maxStrain = 0;
  for (let k = 0; k < secs / DT; k++) { steerWeighty(c, target, q, r2, charge, DT, fear); w.step(); maxStrain = Math.max(maxStrain, c.strain); }
  const t1 = truck.translation();
  return { r2, fear, truckMoved_m: +(t1.z - z0).toFixed(2), constructMass_kg: Math.round(cb.mass()), truckMass_kg: Math.round(truck.mass()), strainPeak: +maxStrain.toFixed(2) };
}

if (process.env.SWEEP) { // SWEEP=1 node tools/test_willdrive.mjs → tune WILL.pushForce
  for (const F of [30000, 34000, 38000, 42000, 46000, 50000, 70000]) {
    WILL.pushForce = F;
    console.log(String(F).padStart(6), [0.2, 0.6, 1].map((r) => `r2 ${r}: ${run(r).truckMoved_m} m`).join(' | '), `| r2 1 + fear 1: ${run(1, { fear: 1 }).truckMoved_m} m`);
  }
  process.exit(0);
}
const rows = [run(0.2), run(1.0), run(1.0, { fear: 1 })];
console.table(rows);
const [light, full] = rows;
const ok = light.truckMoved_m < 0.5 && full.truckMoved_m > 2;
console.log(ok ? 'PASS: light R2 barely moves the truck, full R2 shoves it' : 'FAIL: expected light < 0.5 m and full > 2 m');
process.exit(ok ? 0 : 1);

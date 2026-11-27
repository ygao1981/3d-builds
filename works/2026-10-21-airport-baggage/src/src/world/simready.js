import * as THREE from 'three';
import { BELT_TOP_HEIGHT } from '../sim/layout.js';
import { measureRollers } from '../simready-rollers.js';

const straight = 'conveyor_belt_a05';
const bend = 'conveyor_belt_a02';
const delta = new THREE.Quaternion();

// Geometry is in metres. The straight runs along native +Z; the bend is traversed
// from roller 01 toward roller 28. Both anchors are centre-line tangent points.
const fittings = {
  [straight]: { x: 0.5014, z: 0, yaw: Math.PI / 2 },
  [bend]: { x: 2, z: -1.5, yaw: Math.PI },
};

export function createSimReady(scenes) {
  const measured = new Map([straight, bend].map(id => [id, measureRollers(scenes[id])]));
  const drives = [];
  const placements = [];
  function placeConveyor(module, fallback) {
    const id = module.simready;
    const fitting = fittings[id];
    const source = scenes[id].clone(true);
    const rollers = measured.get(id);
    const drive = [];
    const assembly = new THREE.Group();
    assembly.rotation.y = fitting.yaw;
    source.position.set(-fitting.x, 0, -fitting.z);
    assembly.add(source);
    // Match the legacy 0.80 m handover while keeping feet at floor level.
    // Y-only installation calibration; the centre-line radius and plan dimensions stay in metres.
    assembly.scale.y = BELT_TOP_HEIGHT / rollers[0].top;
    for (const roller of rollers) {
      const node = source.getObjectByName(roller.name);
      // At the tangent this roller overlaps the last A05 roller by 13 mm centre-to-centre.
      if (id === bend && roller.name === 'sm_roller01_a02_obj_00') {
        node.visible = false;
        continue;
      }
      drive.push({ ...roller, node });
    }
    const lod = new THREE.LOD();
    // LOD distances are measured from the section inlet, within 2 m of its centre.
    lod.addLevel(assembly, 0);
    lod.addLevel(fallback, 34, 0.12);
    lod.name = module.unit;
    drives.push({ assembly, speed: module.belt.speed, drive });
    placements.push({ id, unit: module.unit, count: drive.length, object: assembly });
    return lod;
  }

  function addEquipment(root, units) {
    function add(id, unit, x, y, z, yaw) {
      const object = scenes[id].clone(true);
      object.name = unit;
      object.userData.unitId = unit;
      object.rotation.y = yaw;
      object.position.set(x, y, z);
      object.traverse(child => { if (child.isMesh) child.receiveShadow = true; });
      root.add(object);
      units.set(unit, object);
      placements.push({ id, unit, object });
    }
    add('computer_scanner_barcode_b01', 'counter-reader', -34.55, 2.53, 6.26, 0.55);
    add('cart_luggage_platform_a01', 'terminal-cart', -36.65, 1.5, 6.6, 0.35);
    for (let i = 0; i < 3; i++) {
      add('barrier_fence_metal_a02', 'service-barrier-' + (i + 1), 0.85 + i * 1.28, 0, 20.75, 0);
    }
  }

  function update(time) {
    for (const { assembly, speed, drive } of drives) {
      if (!assembly.visible) continue;
      for (const { node, rest, axis, radius } of drive) {
        delta.setFromAxisAngle(axis, (time * speed / radius) % (2 * Math.PI));
        node.quaternion.copy(rest).premultiply(delta);
      }
    }
  }
  return { placeConveyor, addEquipment, update, placements };
}

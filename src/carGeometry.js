// Car 3D models — simple box-based vehicles with wheels
import * as THREE from 'three';
import { getCarType } from './vehicleTypes.js';
import { getGroundVehicleType } from './vehicleTypes.js';

const _wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12);
const _wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });

function createWheel() {
  const wheel = new THREE.Mesh(_wheelGeo, _wheelMat);
  wheel.rotation.z = Math.PI / 2;
  return wheel;
}

export function buildCarModel(typeName) {
  const cfg = getCarType(typeName);
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.BoxGeometry(cfg.width, cfg.height * 0.5, cfg.length);
  const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = cfg.height * 0.35;
  body.receiveShadow = true;
  group.add(body);

  // Cabin (windowed upper portion) — set back from front to show hood
  const cabinW = cfg.width * 0.88;
  const cabinH = cfg.height * 0.42;
  const cabinL = cfg.length * 0.4;
  const cabinGeo = new THREE.BoxGeometry(cabinW, cabinH, cabinL);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x88bbdd, roughness: 0.1, metalness: 0.5, opacity: 0.7, transparent: true });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.y = cfg.height * 0.35 + cfg.height * 0.25 + cabinH * 0.5;
  cabin.position.z = cfg.length * 0.08; // Cabin sits toward rear, leaving visible hood in front
  group.add(cabin);

  // Wheels
  const wheelOffsetX = cfg.width * 0.5;
  const wheelOffsetZ = cfg.wheelBase * 0.5;
  const wheelY = 0.15;

  const positions = [
    [-wheelOffsetX, wheelY, wheelOffsetZ],
    [wheelOffsetX, wheelY, wheelOffsetZ],
    [-wheelOffsetX, wheelY, -wheelOffsetZ],
    [wheelOffsetX, wheelY, -wheelOffsetZ],
  ];

  const wheels = [];
  for (const [x, y, z] of positions) {
    const w = createWheel();
    w.position.set(x, y, z);
    group.add(w);
    wheels.push(w);
  }

  // Headlights (front = -Z)
  const headlightGeo = new THREE.SphereGeometry(0.12, 6, 6);
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 1.0 });
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat);
    hl.position.set(side * cfg.width * 0.35, cfg.height * 0.3, -cfg.length * 0.5);
    group.add(hl);
  }

  // Hood/bumper (front visual indicator)
  const bumperGeo = new THREE.BoxGeometry(cfg.width * 0.95, cfg.height * 0.15, 0.15);
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
  const bumper = new THREE.Mesh(bumperGeo, bumperMat);
  bumper.position.set(0, cfg.height * 0.15, -cfg.length * 0.5);
  group.add(bumper);

  // Tail lights (back = +Z) — red and visible
  const tailGeo = new THREE.SphereGeometry(0.1, 6, 6);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 0.5 });
  for (const side of [-1, 1]) {
    const tl = new THREE.Mesh(tailGeo, tailMat);
    tl.position.set(side * cfg.width * 0.35, cfg.height * 0.3, cfg.length * 0.5);
    group.add(tl);
  }

  return { group, wheels };
}

export function buildGroundVehicleModel(typeName) {
  const cfg = getGroundVehicleType(typeName);
  const group = new THREE.Group();

  // Simple box body
  const bodyGeo = new THREE.BoxGeometry(cfg.width, cfg.height * 0.6, cfg.length);
  const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.6, metalness: 0.2 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = cfg.height * 0.35;
  body.receiveShadow = true;
  group.add(body);

  // Cab
  const cabGeo = new THREE.BoxGeometry(cfg.width * 0.85, cfg.height * 0.35, cfg.length * 0.3);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x88bbdd, roughness: 0.2, metalness: 0.4, opacity: 0.6, transparent: true });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.y = cfg.height * 0.65;
  cab.position.z = -cfg.length * 0.3;
  group.add(cab);

  // Wheels (4 wheels)
  const wheelOffsetX = cfg.width * 0.5;
  const wheelOffsetZ = cfg.wheelBase * 0.5;
  const wheelY = 0.2;

  const positions = [
    [-wheelOffsetX, wheelY, wheelOffsetZ],
    [wheelOffsetX, wheelY, wheelOffsetZ],
    [-wheelOffsetX, wheelY, -wheelOffsetZ],
    [wheelOffsetX, wheelY, -wheelOffsetZ],
  ];

  for (const [x, y, z] of positions) {
    const w = createWheel();
    w.position.set(x, y, z);
    group.add(w);
  }

  // Warning beacon on top (for airport vehicles)
  const beaconGeo = new THREE.SphereGeometry(0.15, 8, 8);
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.8 });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.y = cfg.height * 0.65 + cfg.height * 0.175 + 0.2;
  beacon.position.z = -cfg.length * 0.3;
  // Special beacon for fire truck
  if (typeName === 'fire_truck') {
    beacon.material.color.setHex(0xff0000);
    beacon.material.emissive.setHex(0xff0000);
  }
  group.add(beacon);

  return { group, beacon };
}

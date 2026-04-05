// Highway traffic — AI vehicles driving along highway spline paths
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getHighwayPath } from './terrain.js';
import { getGroundLevel } from './terrain.js';

const MAX_VEHICLES = 40;
const SPAWN_INTERVAL = 1.5;
const VEHICLE_SPEED_MIN = 20;  // m/s (~72 km/h)
const VEHICLE_SPEED_MAX = 35;  // m/s (~126 km/h)

let sceneRef = null;
let spawnTimer = 0;
const vehicles = [];
let carMesh = null;
let truckMesh = null;
const dummy = new THREE.Object3D();

const CAR_COLORS = [0x3366cc, 0xcc3333, 0x33cc33, 0xcccc33, 0xffffff, 0x555555, 0x884422, 0x224488];
const TRUCK_COLORS = [0x444444, 0x886644, 0x666666, 0x553322];

function makeCarGeo() {
  // Body (lower, wider)
  const body = new THREE.BoxGeometry(1.8, 0.7, 4.2);
  body.translate(0, 0.35, 0);
  // Cabin (upper, narrower, set back for hood)
  const cabin = new THREE.BoxGeometry(1.6, 0.6, 2.2);
  cabin.translate(0, 0.95, 0.3);
  return mergeGeometries([body, cabin]);
}

function makeTruckGeo() {
  // Cab
  const cab = new THREE.BoxGeometry(2.2, 1.6, 2.5);
  cab.translate(0, 0.9, -2.2);
  // Cargo body
  const cargo = new THREE.BoxGeometry(2.4, 2.0, 5.5);
  cargo.translate(0, 1.1, 1.5);
  return mergeGeometries([cab, cargo]);
}

function createMeshes(scene) {
  const carGeo = makeCarGeo();
  const carMat = new THREE.MeshLambertMaterial();
  carMesh = new THREE.InstancedMesh(carGeo, carMat, MAX_VEHICLES);
  carMesh.castShadow = true;
  carMesh.count = 0;
  scene.add(carMesh);

  const truckGeo = makeTruckGeo();
  const truckMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  truckMesh = new THREE.InstancedMesh(truckGeo, truckMat, 15);
  truckMesh.castShadow = true;
  truckMesh.count = 0;
  scene.add(truckMesh);
}

function getHighwaySpline() {
  const path = getHighwayPath();
  if (!path) return null;
  return path.curve;
}

function spawnVehicle() {
  if (vehicles.length >= MAX_VEHICLES) return;

  const curve = getHighwaySpline();
  if (!curve) return;

  const isTruck = Math.random() < 0.2;
  const mesh = isTruck ? truckMesh : carMesh;
  if (!mesh) return;

  const direction = Math.random() < 0.5 ? 1 : -1;
  const t = direction === 1 ? 0.01 : 0.99;
  const speed = VEHICLE_SPEED_MIN + Math.random() * (VEHICLE_SPEED_MAX - VEHICLE_SPEED_MIN);
  const laneOffset = (direction === 1 ? 4 : -4) + (Math.random() - 0.5) * 1.5;

  const colors = isTruck ? TRUCK_COLORS : CAR_COLORS;
  const color = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);

  const idx = mesh.count;
  if (idx >= mesh.instanceMatrix.count) return;

  mesh.count++;
  mesh.setColorAt(idx, color);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  vehicles.push({
    t,
    speed: speed * (isTruck ? 0.7 : 1),
    direction,
    laneOffset,
    isTruck,
    meshIdx: idx,
    mesh,
    curve,
  });
}

export function initHighwayTraffic(scene) {
  sceneRef = scene;
  vehicles.length = 0;
  spawnTimer = 0;
  createMeshes(scene);

  // Initial batch
  for (let i = 0; i < 15; i++) {
    const curve = getHighwaySpline();
    if (!curve) break;
    const isTruck = Math.random() < 0.2;
    const mesh = isTruck ? truckMesh : carMesh;
    if (!mesh || mesh.count >= mesh.instanceMatrix.count) continue;

    const direction = Math.random() < 0.5 ? 1 : -1;
    const t = Math.random() * 0.9 + 0.05;
    const speed = VEHICLE_SPEED_MIN + Math.random() * (VEHICLE_SPEED_MAX - VEHICLE_SPEED_MIN);
    const laneOffset = (direction === 1 ? 4 : -4) + (Math.random() - 0.5) * 1.5;

    const colors = isTruck ? TRUCK_COLORS : CAR_COLORS;
    const color = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);

    const idx = mesh.count;
    mesh.count++;
    mesh.setColorAt(idx, color);

    vehicles.push({
      t,
      speed: speed * (isTruck ? 0.7 : 1),
      direction,
      laneOffset,
      isTruck,
      meshIdx: idx,
      mesh,
      curve,
    });
  }

  if (carMesh && carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
  if (truckMesh && truckMesh.instanceColor) truckMesh.instanceColor.needsUpdate = true;
}

export function updateHighwayTraffic(dt, nightActive) {
  if (!sceneRef || vehicles.length === 0) return;

  // Spawn new vehicles periodically
  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer = 0;
    spawnVehicle();
  }

  // Update vehicle positions
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];
    const curve = v.curve;
    if (!curve) { removeVehicle(i); continue; }

    const curveLen = curve.getLength();
    const tDelta = (v.speed * dt * v.direction) / curveLen;
    v.t += tDelta;

    // Remove if off the ends
    if (v.t < -0.02 || v.t > 1.02) {
      removeVehicle(i);
      continue;
    }

    const clampedT = Math.max(0.001, Math.min(0.999, v.t));
    const point = curve.getPointAt(clampedT);
    const tangent = curve.getTangentAt(clampedT);

    // Perpendicular for lane offset
    const perpX = -tangent.z;
    const perpZ = tangent.x;
    const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;

    const worldX = point.x + (perpX / len) * v.laneOffset;
    const worldZ = point.z + (perpZ / len) * v.laneOffset;
    const groundY = getGroundLevel(worldX, worldZ);

    const heading = Math.atan2(tangent.x, tangent.z) * (v.direction === 1 ? 1 : 1) + (v.direction === -1 ? Math.PI : 0);

    dummy.position.set(worldX, groundY + (v.isTruck ? 1.1 : 0.7), worldZ);
    dummy.rotation.set(0, heading, 0);
    dummy.updateMatrix();
    v.mesh.setMatrixAt(v.meshIdx, dummy.matrix);
  }

  if (carMesh) { carMesh.instanceMatrix.needsUpdate = true; }
  if (truckMesh) { truckMesh.instanceMatrix.needsUpdate = true; }
}

function removeVehicle(index) {
  const v = vehicles[index];
  // Move last instance into the freed slot
  const lastIdx = v.mesh.count - 1;
  if (v.meshIdx < lastIdx) {
    // Find the vehicle using lastIdx and reassign
    for (const other of vehicles) {
      if (other !== v && other.mesh === v.mesh && other.meshIdx === lastIdx) {
        other.meshIdx = v.meshIdx;
        break;
      }
    }
    // Copy last instance matrix/color to freed slot
    const mat = new THREE.Matrix4();
    v.mesh.getMatrixAt(lastIdx, mat);
    v.mesh.setMatrixAt(v.meshIdx, mat);
    if (v.mesh.instanceColor) {
      const col = new THREE.Color();
      v.mesh.getColorAt(lastIdx, col);
      v.mesh.setColorAt(v.meshIdx, col);
    }
  }
  v.mesh.count--;
  vehicles.splice(index, 1);
}

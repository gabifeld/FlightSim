// Night runway/taxiway lighting with InstancedMesh + light pooling
import * as THREE from 'three';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, AIRPORT2_X, AIRPORT2_Z } from './constants.js';
import { aircraftState } from './aircraft.js';

let lightPool = [];          // Reusable PointLights
let fixturePositions = [];   // All light fixture positions
let edgeInstanced = null;    // Runway edge InstancedMesh
let threshGreenInstanced = null;
let threshRedInstanced = null;
let taxiBlueInstanced = null;
let approachMeshes = [];     // ALS meshes for animation
let papiLights = [];         // PAPI fixtures with angle-dependent color
let nightMode = false;
let sceneRef = null;

const POOL_SIZE = 32;
const EDGE_SPACING = 60;

// Cached sort state - avoid sorting every frame
let sortedCache = null;
let lastSortX = 0;
let lastSortZ = 0;
let sortFrameCounter = 0;

function createLightFixtureMaterial(color, emissive) {
  return new THREE.MeshStandardMaterial({
    color: color,
    emissive: emissive,
    emissiveIntensity: 2.0,
    roughness: 0.2,
  });
}

function addAirportFixtures(scene, fixtureGeo, dummy, ox, oz) {
  const halfLen = RUNWAY_LENGTH / 2;
  const halfWid = RUNWAY_WIDTH / 2;

  // --- Runway edge lights (white) ---
  const edgeMat = createLightFixtureMaterial(0xffeedd, 0xffeedd);
  const edgeCount = Math.floor(RUNWAY_LENGTH / EDGE_SPACING) * 2 + 4;
  const edgeInst = new THREE.InstancedMesh(fixtureGeo, edgeMat, edgeCount);
  edgeInst.frustumCulled = false;

  let ei = 0;
  for (let z = -halfLen; z <= halfLen; z += EDGE_SPACING) {
    for (const side of [-1, 1]) {
      const px = ox + side * (halfWid + 2);
      const pz = oz + z;
      dummy.position.set(px, 0.3, pz);
      dummy.updateMatrix();
      edgeInst.setMatrixAt(ei, dummy.matrix);
      fixturePositions.push({ x: px, y: 0.3, z: pz, type: 'edge' });
      ei++;
    }
  }
  edgeInst.count = ei;
  scene.add(edgeInst);
  if (!edgeInstanced) edgeInstanced = edgeInst;

  // --- Threshold lights (green for approach end) ---
  const greenMat = createLightFixtureMaterial(0x00ff44, 0x00ff44);
  const threshCount = Math.floor(RUNWAY_WIDTH / 3) + 2;
  const greenInst = new THREE.InstancedMesh(fixtureGeo, greenMat, threshCount);
  greenInst.frustumCulled = false;

  let gi = 0;
  for (let x = -halfWid + 2; x <= halfWid - 2; x += 3) {
    const px = ox + x;
    const pz = oz - halfLen - 3;
    dummy.position.set(px, 0.25, pz);
    dummy.updateMatrix();
    greenInst.setMatrixAt(gi, dummy.matrix);
    fixturePositions.push({ x: px, y: 0.25, z: pz, type: 'threshold_green' });
    gi++;
  }
  greenInst.count = gi;
  scene.add(greenInst);
  if (!threshGreenInstanced) threshGreenInstanced = greenInst;

  // --- Threshold lights (red for departure end) ---
  const redMat = createLightFixtureMaterial(0xff2200, 0xff2200);
  const redInst = new THREE.InstancedMesh(fixtureGeo, redMat, threshCount);
  redInst.frustumCulled = false;

  let ri = 0;
  for (let x = -halfWid + 2; x <= halfWid - 2; x += 3) {
    const px = ox + x;
    const pz = oz + halfLen + 3;
    dummy.position.set(px, 0.25, pz);
    dummy.updateMatrix();
    redInst.setMatrixAt(ri, dummy.matrix);
    fixturePositions.push({ x: px, y: 0.25, z: pz, type: 'threshold_red' });
    ri++;
  }
  redInst.count = ri;
  scene.add(redInst);
  if (!threshRedInstanced) threshRedInstanced = redInst;

  // --- Taxiway blue edge lights ---
  const parallelTaxiX = ox + halfWid + 100;
  const blueMat = createLightFixtureMaterial(0x2244ff, 0x2244ff);
  const blueCount = Math.floor(RUNWAY_LENGTH / 30) * 2 + 10;
  const blueInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.25, 0.3, 0.25),
    blueMat,
    blueCount
  );
  blueInst.frustumCulled = false;

  let bi = 0;
  for (let z = -halfLen; z <= halfLen; z += 30) {
    for (const side of [-1, 1]) {
      const px = parallelTaxiX + side * 10.5;
      const pz = oz + z;
      dummy.position.set(px, 0.2, pz);
      dummy.updateMatrix();
      blueInst.setMatrixAt(bi, dummy.matrix);
      fixturePositions.push({ x: px, y: 0.2, z: pz, type: 'taxi_blue' });
      bi++;
    }
  }
  blueInst.count = bi;
  scene.add(blueInst);
  if (!taxiBlueInstanced) taxiBlueInstanced = blueInst;

  // --- Approach Light System (ALS) ---
  const alsWhiteMat = createLightFixtureMaterial(0xffffff, 0xffffff);
  for (let row = 1; row <= 8; row++) {
    const zPos = oz - halfLen - row * 30;
    const count = row <= 3 ? 3 : 1;
    const spacing = 4;
    for (let i = -Math.floor(count / 2); i <= Math.floor(count / 2); i++) {
      const mesh = new THREE.Mesh(fixtureGeo, alsWhiteMat.clone());
      mesh.position.set(ox + i * spacing, 0.2 + row * 0.1, zPos);
      scene.add(mesh);
      approachMeshes.push({ mesh, row, baseIntensity: 1.2 });
      fixturePositions.push({ x: ox + i * spacing, y: 0.2 + row * 0.1, z: zPos, type: 'als' });
    }
  }

  // --- PAPI lights (4 lights on each side of runway approach) ---
  const papiGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
  const papiZ = oz - halfLen + 300; // 300m from threshold
  const papiSpacing = 3; // spacing between PAPI units

  for (const side of [-1, 1]) {
    const papiBaseX = ox + side * (halfWid + 8);
    for (let i = 0; i < 4; i++) {
      const papiMat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.3,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(papiGeo, papiMat);
      const px = papiBaseX + i * papiSpacing * side;
      mesh.position.set(px, 0.3, papiZ);
      scene.add(mesh);
      papiLights.push({ mesh, x: px, y: 0.3, z: papiZ });
      fixturePositions.push({ x: px, y: 0.3, z: papiZ, type: 'papi' });
    }
  }
}

export function initAirportLights(scene) {
  sceneRef = scene;

  const fixtureGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
  const dummy = new THREE.Object3D();

  // Airport 1 at origin
  addAirportFixtures(scene, fixtureGeo, dummy, 0, 0);

  // Airport 2
  addAirportFixtures(scene, fixtureGeo, dummy, AIRPORT2_X, AIRPORT2_Z);

  // --- Light pool (reusable PointLights) ---
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffeedd, 0, 300);
    light.visible = false;
    scene.add(light);
    lightPool.push(light);
  }
}

export function setNightMode(isNight) {
  nightMode = isNight;
}

export function updateAirportLights(dt) {
  if (!sceneRef) return;

  const time = performance.now() * 0.001;

  // ALS rabbit strobe animation (sequenced flash far->near)
  if (nightMode) {
    const cycleTime = 1.5; // seconds per full sequence
    const phase = (time % cycleTime) / cycleTime;

    for (const als of approachMeshes) {
      const rowPhase = als.row / 10;
      const dist = Math.abs(phase - (1 - rowPhase)); // inverse: far fires first
      const flash = dist < 0.08 ? 8.0 : 5.0;
      als.mesh.material.emissiveIntensity = flash;
    }
  } else {
    for (const als of approachMeshes) {
      als.mesh.material.emissiveIntensity = 0.3;
    }
  }

  // Update emissive intensity based on night mode
  const emissiveMul = nightMode ? 5.0 : 0.3;
  if (edgeInstanced) edgeInstanced.material.emissiveIntensity = emissiveMul;
  if (threshGreenInstanced) threshGreenInstanced.material.emissiveIntensity = nightMode ? 6.0 : 0.3;
  if (threshRedInstanced) threshRedInstanced.material.emissiveIntensity = nightMode ? 6.0 : 0.3;
  if (taxiBlueInstanced) taxiBlueInstanced.material.emissiveIntensity = nightMode ? 4.0 : 0.3;

  // PAPI lights emissive update
  for (const papi of papiLights) {
    papi.mesh.material.emissiveIntensity = nightMode ? 6.0 : 0.3;
  }

  // Pool PointLights: position on nearest fixtures to aircraft
  if (nightMode) {
    const ax = aircraftState.position.x;
    const az = aircraftState.position.z;

    // Only re-sort when aircraft moves significantly or every 30 frames
    sortFrameCounter++;
    const dx = ax - lastSortX;
    const dz = az - lastSortZ;
    if (!sortedCache || sortFrameCounter >= 30 || dx * dx + dz * dz > 900) {
      sortFrameCounter = 0;
      lastSortX = ax;
      lastSortZ = az;

      // In-place distance computation + partial sort (only need top POOL_SIZE)
      // Use a simple selection approach instead of full sort
      const maxDistSq = 1500 * 1500;
      const candidates = [];
      for (let i = 0; i < fixturePositions.length; i++) {
        const f = fixturePositions[i];
        const distSq = (f.x - ax) * (f.x - ax) + (f.z - az) * (f.z - az);
        if (distSq < maxDistSq) {
          candidates.push({ idx: i, dist: distSq });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);
      sortedCache = candidates.slice(0, POOL_SIZE);
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lightPool[i];
      if (i < sortedCache.length) {
        const f = fixturePositions[sortedCache[i].idx];
        light.position.set(f.x, f.y + 1, f.z);
        light.visible = true;
        light.intensity = 12;
        light.distance = 300;

        // Color based on type
        if (f.type === 'threshold_green') light.color.setHex(0x00ff44);
        else if (f.type === 'threshold_red') light.color.setHex(0xff2200);
        else if (f.type === 'taxi_blue') light.color.setHex(0x2244ff);
        else if (f.type === 'papi') light.color.setHex(0xff0000);
        else light.color.setHex(0xffeedd);
      } else {
        light.visible = false;
      }
    }
  } else {
    for (const light of lightPool) {
      light.visible = false;
    }
  }
}

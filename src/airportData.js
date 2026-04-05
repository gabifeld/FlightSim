import * as THREE from 'three';
import { buildAirport, createPAPI, createWindsock, getRunwayTexture, registerGenericRunway } from './runway.js';
import { createAirportStructures } from './airportStructures.js';
import { createInternationalAirport, createIntlAirportLights } from './internationalAirport.js';
import {
  RUNWAY_LENGTH, RUNWAY_WIDTH,
  AIRPORT2_X, AIRPORT2_Z,
  INTL_AIRPORT_X, INTL_AIRPORT_Z, INTL_RUNWAY_LENGTH, INTL_RUNWAY_WIDTH,
} from './constants.js';

// ============================================================
// Airport Database
// ============================================================

export const AIRPORTS = [
  {
    icao: 'KFSA',
    name: 'Main Airport',
    x: 0,
    z: 0,
    elevation: 0,
    type: 'international',
    runways: [{ heading: 90, length: RUNWAY_LENGTH, width: RUNWAY_WIDTH, numbers: ['09', '27'] }],
    frequencies: { tower: 118.00, ground: 121.90, atis: 128.00 },
    vorFreq: 112.00,
    ilsFreq: 110.30,
    _existing: true, // flag: use legacy buildAirport path
  },
  {
    icao: 'KFSB',
    name: 'Regional Airport',
    x: AIRPORT2_X,
    z: AIRPORT2_Z,
    elevation: 0,
    type: 'regional',
    runways: [{ heading: 90, length: RUNWAY_LENGTH, width: RUNWAY_WIDTH, numbers: ['09', '27'] }],
    frequencies: { tower: 119.10, ground: 121.70, atis: 127.85 },
    vorFreq: 114.00,
    ilsFreq: 110.50,
    _existing: true,
  },
  {
    icao: 'KFSI',
    name: 'International Airport',
    x: INTL_AIRPORT_X,
    z: INTL_AIRPORT_Z,
    elevation: 0,
    type: 'international',
    runways: [{ heading: 90, length: INTL_RUNWAY_LENGTH, width: INTL_RUNWAY_WIDTH, numbers: ['09', '27'] }],
    frequencies: { tower: 120.50, ground: 121.60, atis: 126.45 },
    vorFreq: 116.00,
    ilsFreq: 109.10,
    _existing: true,
  },
  {
    icao: 'KFSM',
    name: 'Military Air Base',
    x: -5000,
    z: -10000,
    elevation: 0,
    type: 'military',
    runways: [{ heading: 90, length: 2500, width: 45, numbers: ['09', '27'] }],
    frequencies: { tower: 124.80, ground: 121.50, atis: 129.20 },
    vorFreq: 109.60,
    ilsFreq: 109.30,
    _existing: false,
  },
  {
    icao: 'KFSG',
    name: 'General Aviation Airfield',
    x: 5000,
    z: 12000,
    elevation: 0,
    type: 'ga',
    runways: [{ heading: 90, length: 1200, width: 30, numbers: ['09', '27'] }],
    // heading 90 → 0 rotation → runway along Z (N-S), same as existing airports
    frequencies: { tower: 122.80, ground: 0, atis: 0 },
    vorFreq: null,
    ilsFreq: null,
    _existing: false,
  },
  {
    icao: 'KFSC',
    name: 'Mountain Strip',
    x: -3000,
    z: -18000,
    elevation: 180,
    type: 'ga',
    runways: [{ heading: 90, length: 800, width: 25, numbers: ['09', '27'] }],
    frequencies: { tower: 0, ground: 0, atis: 0 },
    vorFreq: null,
    ilsFreq: null,
    _existing: false,
  },
];

// ---- Lookup helpers ----

/**
 * Find an airport by ICAO code. Returns the data object or null.
 */
export function getAirportByICAO(icao) {
  const upper = icao.toUpperCase();
  for (let i = 0; i < AIRPORTS.length; i++) {
    if (AIRPORTS[i].icao === upper) return AIRPORTS[i];
  }
  return null;
}

/**
 * Find the nearest airport to (x, z). Returns the data object.
 */
export function getNearestAirport(x, z) {
  let best = AIRPORTS[0];
  let bestD2 = Infinity;
  for (let i = 0; i < AIRPORTS.length; i++) {
    const a = AIRPORTS[i];
    const dx = a.x - x;
    const dz = a.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = a;
    }
  }
  return best;
}

// ============================================================
// Airport geometry generation
// ============================================================

/**
 * Build geometry for all airports in the database.
 * - Existing airports (1-3) delegate to legacy buildAirport / intl functions.
 * - New airports (4-6) use the simple runway factory.
 */
export function buildAllAirports(scene, getHeightAt) {
  for (const airport of AIRPORTS) {
    // Auto-detect elevation from terrain for non-existing airports
    if (!airport._existing && airport.elevation === 0 && getHeightAt) {
      airport.elevation = Math.max(0, getHeightAt(airport.x, airport.z));
    }
    if (airport._existing) {
      _buildExistingAirport(scene, airport);
    } else {
      createSimpleRunway(scene, airport);
    }
  }
}

// ---- Existing airport delegation ----

function _buildExistingAirport(scene, airport) {
  if (airport.icao === 'KFSA') {
    buildAirport(scene, {
      originX: airport.x,
      originZ: airport.z,
      includeApron: true,
      includeTerminal: true,
      includeExtras: true,
    });
    createAirportStructures(scene, airport.x, airport.z, true);
  } else if (airport.icao === 'KFSB') {
    buildAirport(scene, {
      originX: airport.x,
      originZ: airport.z,
      includeApron: true,
      includeTerminal: true,
      includeExtras: false,
    });
    createAirportStructures(scene, airport.x, airport.z, false);
  } else if (airport.icao === 'KFSI') {
    createInternationalAirport(scene);
    createIntlAirportLights(scene);
  }
}

// ============================================================
// Simple runway factory for new airports
// ============================================================

function createSimpleRunway(scene, airport) {
  const rwy = airport.runways[0];
  const rwyLength = rwy.length;
  const rwyWidth = rwy.width;
  // Heading 90 = east, runway long axis along X. Heading 360/0 = north, along Z.
  // PlaneGeometry(width, height) laid flat: width along X, height along Z after rotateX(-PI/2).
  // We rotate around Y by (heading - 90) to orient.
  const headingRad = ((rwy.heading - 90) * Math.PI) / 180;

  // Register this runway for landing detection
  registerGenericRunway(airport.x, airport.z, rwyLength / 2, rwyWidth / 2, headingRad);

  const group = new THREE.Group();
  group.position.set(airport.x, 0, airport.z);

  // ---- Runway surface (with texture) ----
  const rwyGeo = new THREE.PlaneGeometry(rwyWidth, rwyLength);
  rwyGeo.rotateX(-Math.PI / 2);
  const rwyMat = new THREE.MeshStandardMaterial({
    map: getRunwayTexture(),
    roughness: 0.85,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const rwyMesh = new THREE.Mesh(rwyGeo, rwyMat);
  rwyMesh.position.y = 0.05 + airport.elevation;
  rwyMesh.rotation.y = headingRad;
  rwyMesh.receiveShadow = true;
  group.add(rwyMesh);

  // ---- Center line (dashed white) ----
  const clGeo = new THREE.PlaneGeometry(0.6, rwyLength * 0.9);
  clGeo.rotateX(-Math.PI / 2);
  const clMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const clMesh = new THREE.Mesh(clGeo, clMat);
  clMesh.position.y = 0.06 + airport.elevation;
  clMesh.rotation.y = headingRad;
  group.add(clMesh);

  // ---- Threshold markings ----
  const threshMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const endSign of [-1, 1]) {
    const stripeCount = Math.min(6, Math.floor(rwyWidth / 6));
    const spacing = rwyWidth / (stripeCount + 1);
    for (let i = 1; i <= stripeCount; i++) {
      const sx = (i * spacing - rwyWidth / 2);
      const sz = endSign * (rwyLength / 2 - 15);
      const sGeo = new THREE.PlaneGeometry(3, 20);
      sGeo.rotateX(-Math.PI / 2);
      const sMesh = new THREE.Mesh(sGeo, threshMat);
      sMesh.position.set(sx, 0.06 + airport.elevation, sz);
      sMesh.rotation.y = headingRad;
      // Rotate position around origin by heading
      _rotatePoint(sMesh.position, headingRad);
      group.add(sMesh);
    }
  }

  // ---- Edge lights ----
  const halfLen = rwyLength / 2;
  const halfWid = rwyWidth / 2;
  const edgePositions = [];
  const lightSpacing = Math.max(30, rwyLength / 30);
  for (let t = -halfLen; t <= halfLen; t += lightSpacing) {
    for (const side of [-1, 1]) {
      const lx = side * (halfWid + 1.5);
      const lz = t;
      // Rotate by heading
      const rx = lx * Math.cos(headingRad) - lz * Math.sin(headingRad);
      const rz = lx * Math.sin(headingRad) + lz * Math.cos(headingRad);
      edgePositions.push(new THREE.Vector3(rx, 0.35 + airport.elevation, rz));
    }
  }

  if (edgePositions.length > 0) {
    const edgeLightMat = new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
    });
    const edgeGeo = new THREE.BoxGeometry(0.4, 0.6, 0.4);
    const edgeMesh = new THREE.InstancedMesh(edgeGeo, edgeLightMat, edgePositions.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < edgePositions.length; i++) {
      dummy.position.copy(edgePositions[i]);
      dummy.updateMatrix();
      edgeMesh.setMatrixAt(i, dummy.matrix);
    }
    edgeMesh.instanceMatrix.needsUpdate = true;
    group.add(edgeMesh);
  }

  // ---- Threshold lights (green one end, red other) ----
  const threshCount = Math.max(6, Math.floor(rwyWidth / 4));
  const threshSpacing = rwyWidth / (threshCount + 1);
  for (const endSign of [-1, 1]) {
    const positions = [];
    for (let i = 1; i <= threshCount; i++) {
      const tx = (i * threshSpacing - halfWid);
      const tz = endSign * (halfLen + 2);
      const rx = tx * Math.cos(headingRad) - tz * Math.sin(headingRad);
      const rz = tx * Math.sin(headingRad) + tz * Math.cos(headingRad);
      positions.push(new THREE.Vector3(rx, 0.25 + airport.elevation, rz));
    }
    const color = endSign === -1 ? 0x00ff00 : 0xff0000;
    const emissive = endSign === -1 ? 0x00cc00 : 0xcc0000;
    const tMat = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1.0 });
    const tGeo = new THREE.BoxGeometry(0.6, 0.4, 0.6);
    const tMesh = new THREE.InstancedMesh(tGeo, tMat, positions.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < positions.length; i++) {
      dummy.position.copy(positions[i]);
      dummy.updateMatrix();
      tMesh.setMatrixAt(i, dummy.matrix);
    }
    tMesh.instanceMatrix.needsUpdate = true;
    group.add(tMesh);
  }

  // ---- PAPI lights at each runway end ----
  for (const endSign of [-1, 1]) {
    const pz = endSign * (halfLen - rwyLength * 0.15);
    const px = -(halfWid + 15);
    const rpx = px * Math.cos(headingRad) - pz * Math.sin(headingRad);
    const rpz = px * Math.sin(headingRad) + pz * Math.cos(headingRad);
    createPAPI(group, rpx, rpz);
  }

  // ---- Windsock near runway midpoint ----
  {
    const wx = (halfWid + 25);
    const wz = -halfLen + 100;
    const rwx = wx * Math.cos(headingRad) - wz * Math.sin(headingRad);
    const rwz = wx * Math.sin(headingRad) + wz * Math.cos(headingRad);
    createWindsock(group, rwx, rwz);
  }

  // ---- Type-specific structures ----
  _addStructures(group, airport);

  scene.add(group);
}

/** Rotate a Vector3 position in XZ plane around the origin. */
function _rotatePoint(pos, angle) {
  const x = pos.x;
  const z = pos.z;
  pos.x = x * Math.cos(angle) - z * Math.sin(angle);
  pos.z = x * Math.sin(angle) + z * Math.cos(angle);
}

// ---- Type-specific airport structures ----

function _addStructures(group, airport) {
  const rwy = airport.runways[0];
  const halfLen = rwy.length / 2;
  const halfWid = rwy.width / 2;
  const headingRad = ((rwy.heading - 90) * Math.PI) / 180;

  // Runway runs along (sin(h), cos(h)). Perpendicular is (cos(h), -sin(h))
  const perpX = Math.cos(headingRad);
  const perpZ = -Math.sin(headingRad);
  const baseOffsetDist = halfWid + 120; // Keep all structures well clear of runway

  if (airport.type === 'military') {
    _createMilitaryStructures(group, airport, perpX, perpZ, baseOffsetDist);
  } else if (airport.type === 'ga') {
    _createGAStructures(group, airport, perpX, perpZ, baseOffsetDist);
  }
}

function _createMilitaryStructures(group, airport, perpX, perpZ, offset) {
  const elevation = airport.elevation;
  const rwy = airport.runways[0];
  const rwyLength = rwy.length;
  const rwyWidth = rwy.width;
  const headingRad = ((rwy.heading - 90) * Math.PI) / 180;
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x667755, roughness: 0.7, metalness: 0.2 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });

  // Parallel taxiway (15m wide, 80% runway length, well clear of runway)
  const taxiLen = rwyLength * 0.8;
  const taxiWidth = 15;
  const taxiOffsetDist = rwyWidth / 2 + 100; // 100m from runway edge
  const taxiGeo = new THREE.PlaneGeometry(taxiWidth, taxiLen);
  taxiGeo.rotateX(-Math.PI / 2);
  const taxiMesh = new THREE.Mesh(taxiGeo, concreteMat);
  taxiMesh.position.set(
    perpX * taxiOffsetDist,
    0.04 + elevation,
    perpZ * taxiOffsetDist
  );
  taxiMesh.rotation.y = headingRad;
  taxiMesh.receiveShadow = true;
  group.add(taxiMesh);

  // Connector taxiways — from runway EDGE to taxiway (not crossing runway)
  const rwyEdgeDist = rwyWidth / 2 + 5; // start just outside runway edge
  const connectorWidth = 12;
  const connectorLen = taxiOffsetDist - rwyEdgeDist; // span from edge to taxiway
  for (const frac of [-0.3, 0.3]) {
    const alongDist = frac * rwyLength;
    const connGeo = new THREE.PlaneGeometry(connectorLen, connectorWidth);
    connGeo.rotateX(-Math.PI / 2);
    const connMesh = new THREE.Mesh(connGeo, concreteMat);
    // Center between runway edge and taxiway
    const midDist = (rwyEdgeDist + taxiOffsetDist) / 2;
    const cx = perpX * midDist;
    const cz = perpZ * midDist;
    const alongX = alongDist * Math.cos(headingRad);
    const alongZ = alongDist * Math.sin(headingRad);
    connMesh.position.set(cx + alongX, 0.04 + elevation, cz + alongZ);
    connMesh.rotation.y = headingRad + Math.PI / 2;
    connMesh.receiveShadow = true;
    group.add(connMesh);
  }

  // Two large hangars — along runway direction, offset perpendicularly
  const alongX = Math.cos(headingRad);
  const alongZ = Math.sin(headingRad);
  for (let i = -1; i <= 1; i += 2) {
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(50, 14, 35), hangarMat);
    hangar.position.set(
      perpX * (offset + 30) + alongX * i * 80,
      7 + elevation,
      perpZ * (offset + 30) + alongZ * i * 80
    );
    hangar.rotation.y = headingRad;
    hangar.receiveShadow = true;
    group.add(hangar);
  }

  // Control tower — further from runway
  const towerDist = offset + 60;
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 4, 20, 8),
    concreteMat
  );
  tower.position.set(perpX * towerDist, 10 + elevation, perpZ * towerDist);
  group.add(tower);

  const cab = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 4, 8),
    new THREE.MeshStandardMaterial({
      color: 0x88ccee, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.5,
    })
  );
  cab.position.set(perpX * towerDist, 22 + elevation, perpZ * towerDist);
  group.add(cab);

  // Apron area
  const apronGeo = new THREE.PlaneGeometry(120, 80);
  apronGeo.rotateX(-Math.PI / 2);
  const apron = new THREE.Mesh(apronGeo, concreteMat);
  apron.position.set(perpX * (offset - 10), 0.03 + elevation, perpZ * (offset - 10));
  apron.receiveShadow = true;
  group.add(apron);
}

function _createGAStructures(group, airport, perpX, perpZ, offset) {
  const elevation = airport.elevation;
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0xccbbaa, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x885533, roughness: 0.6 });

  // Small FBO building
  const fbo = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 12), buildingMat);
  fbo.position.set(perpX * offset, 3 + elevation, perpZ * offset);
  fbo.receiveShadow = true;
  group.add(fbo);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 14), roofMat);
  roof.position.set(perpX * offset, 6.3 + elevation, perpZ * offset);
  group.add(roof);

  // Small hangar
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 });
  const hangar = new THREE.Mesh(new THREE.BoxGeometry(25, 8, 20), hangarMat);
  const hangarOffX = perpX * (offset + 30);
  const hangarOffZ = perpZ * (offset + 30);
  hangar.position.set(hangarOffX, 4 + elevation, hangarOffZ);
  hangar.receiveShadow = true;
  group.add(hangar);

  // Windsock
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 })
  );
  pole.position.set(perpX * (offset - 20), 3 + elevation, perpZ * (offset - 20));
  group.add(pole);

  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 2, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xff6600, side: THREE.DoubleSide })
  );
  sock.rotation.z = -Math.PI / 2;
  sock.position.set(
    perpX * (offset - 20) + 1,
    5.8 + elevation,
    perpZ * (offset - 20)
  );
  group.add(sock);

  // Tie-down spots (small concrete pads)
  const padMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8 });
  for (let i = -2; i <= 2; i++) {
    const padGeo = new THREE.PlaneGeometry(12, 12);
    padGeo.rotateX(-Math.PI / 2);
    const pad = new THREE.Mesh(padGeo, padMat);
    const along = i * 18; // spaced along the runway direction
    const headingRad = ((airport.runways[0].heading - 90) * Math.PI) / 180;
    pad.position.set(
      perpX * (offset - 5) + along * Math.cos(headingRad),
      0.03 + elevation,
      perpZ * (offset - 5) + along * Math.sin(headingRad)
    );
    pad.receiveShadow = true;
    group.add(pad);
  }
}

// ============================================================
// Terrain flatten zones
// ============================================================

/**
 * Returns flatten zone data for ALL airports, including existing ones.
 * Used by terrain generation to ensure flat ground under runways.
 */
export function getAirportFlattenZones() {
  const zones = [];

  for (const airport of AIRPORTS) {
    const rwy = airport.runways[0];

    // Use generous flatten widths matching existing airport pattern:
    // existing airports use halfWid = RUNWAY_WIDTH/2 + 350
    const extraWidth = airport.type === 'ga' ? 100 : 250;
    const extraLength = 200;

    zones.push({
      x: airport.x,
      z: airport.z,
      heading: rwy.heading,
      halfLength: rwy.length / 2 + extraLength,
      halfWidth: rwy.width / 2 + extraWidth,
      margin: airport.type === 'ga' ? 200 : 400,
      approachLength: airport.type === 'ga' ? 500 : 1500,
      elevation: airport.elevation,
    });
  }

  return zones;
}

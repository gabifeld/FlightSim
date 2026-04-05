import * as THREE from 'three';

// ============================================================
// Navigation Aid Database
// ============================================================

const NM_TO_M = 1852; // 1 nautical mile in meters

// Navaid types
export const NAV_VOR = 'VOR';
export const NAV_NDB = 'NDB';
export const NAV_DME = 'DME';
export const NAV_ILS = 'ILS';

// ---- Navaid Database ----
// Each entry: { id, name, type, freq, x, z, elevation, range (NM) }

const NAVAIDS = [
  // === Airport 1: KFSA - Main Airport (0, 0) ===
  { id: 'FSA', name: 'Main VOR',         type: NAV_VOR, freq: 112.00, x: 0,      z: 0,      elevation: 0,   range: 130 },
  { id: 'FSA', name: 'Main DME',         type: NAV_DME, freq: 112.00, x: 0,      z: 0,      elevation: 0,   range: 130 },
  { id: 'IFSA', name: 'Main ILS 09',     type: NAV_ILS, freq: 110.30, x: 0,      z: -1000,  elevation: 0,   range: 25 },

  // === Airport 2: KFSB - Regional Airport (8000, -8000) ===
  { id: 'FSB', name: 'Regional VOR',     type: NAV_VOR, freq: 114.00, x: 8000,   z: -8000,  elevation: 0,   range: 100 },
  { id: 'FSB', name: 'Regional DME',     type: NAV_DME, freq: 114.00, x: 8000,   z: -8000,  elevation: 0,   range: 100 },
  { id: 'IFSB', name: 'Regional ILS 09', type: NAV_ILS, freq: 110.50, x: 8000,   z: -9000,  elevation: 0,   range: 25 },

  // === Airport 3: KFSI - International (-8000, 8000) ===
  { id: 'FSI', name: 'Intl VOR',         type: NAV_VOR, freq: 116.00, x: -8000,  z: 8000,   elevation: 0,   range: 150 },
  { id: 'FSI', name: 'Intl DME',         type: NAV_DME, freq: 116.00, x: -8000,  z: 8000,   elevation: 0,   range: 150 },
  { id: 'IFSI', name: 'Intl ILS 09',     type: NAV_ILS, freq: 109.10, x: -8000,  z: 6500,   elevation: 0,   range: 25 },

  // === Airport 4: KFSM - Military Base (-5000, -10000) ===
  { id: 'FSM', name: 'Military VOR',     type: NAV_VOR, freq: 109.60, x: -5000,  z: -10000, elevation: 0,   range: 100 },
  { id: 'FSM', name: 'Military DME',     type: NAV_DME, freq: 109.60, x: -5000,  z: -10000, elevation: 0,   range: 100 },
  { id: 'IFSM', name: 'Military ILS 09', type: NAV_ILS, freq: 109.30, x: -5000,  z: -11250, elevation: 0,   range: 25 },

  // === Airport 5: KFSG - GA Airfield (15000, 5000) ===
  { id: 'FSG', name: 'GA NDB',           type: NAV_NDB, freq: 335,    x: 5000,   z: 12000,  elevation: 0,   range: 50 },

  // === Airport 6: KFSC - Mountain Strip (-3000, -18000) ===
  { id: 'FSC', name: 'Mountain NDB',     type: NAV_NDB, freq: 278,    x: -3000,  z: -18000, elevation: 180, range: 40 },

  // === En-route navaids ===
  { id: 'CTY', name: 'City VOR',         type: NAV_VOR, freq: 113.20, x: 4000,   z: -4000,  elevation: 0,   range: 120 },
  { id: 'CTY', name: 'City DME',         type: NAV_DME, freq: 113.20, x: 4000,   z: -4000,  elevation: 0,   range: 120 },
  { id: 'CST', name: 'Coastal NDB',      type: NAV_NDB, freq: 305,    x: 10000,  z: 0,      elevation: 0,   range: 60 },
  { id: 'MID', name: 'Midfield VOR',     type: NAV_VOR, freq: 115.40, x: -4000,  z: 0,      elevation: 0,   range: 100 },
  { id: 'MID', name: 'Midfield DME',     type: NAV_DME, freq: 115.40, x: -4000,  z: 0,      elevation: 0,   range: 100 },
  { id: 'SOU', name: 'Southern NDB',     type: NAV_NDB, freq: 245,    x: 0,      z: -14000, elevation: 0,   range: 60 },
];

// ---- Public query functions ----

/** Returns the full navaid array (read-only reference). */
export function getAllNavaids() {
  return NAVAIDS;
}

/**
 * Returns all navaids within the given range (nautical miles) of (x, z).
 * Uses squared-distance check to avoid sqrt per candidate.
 */
export function getNavaidsInRange(x, z, rangeNM) {
  const rangeM = rangeNM * NM_TO_M;
  const r2 = rangeM * rangeM;
  const results = [];
  for (let i = 0; i < NAVAIDS.length; i++) {
    const n = NAVAIDS[i];
    const dx = n.x - x;
    const dz = n.z - z;
    if (dx * dx + dz * dz <= r2) {
      results.push(n);
    }
  }
  return results;
}

/**
 * Find the nearest navaid of a given type (or any type if type is null).
 * Returns { navaid, distanceM } or null if none found.
 */
export function getNearestNavaid(x, z, type) {
  let best = null;
  let bestD2 = Infinity;
  for (let i = 0; i < NAVAIDS.length; i++) {
    const n = NAVAIDS[i];
    if (type && n.type !== type) continue;
    const dx = n.x - x;
    const dz = n.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best ? { navaid: best, distanceM: Math.sqrt(bestD2) } : null;
}

/**
 * Look up a navaid by frequency. Returns first match or null.
 * For VOR/DME frequencies, precision to 2 decimals. For NDB, integer kHz.
 */
export function getNavaidByFreq(freq) {
  // Round to 2 decimals to avoid floating-point mismatch
  const rounded = Math.round(freq * 100) / 100;
  for (let i = 0; i < NAVAIDS.length; i++) {
    if (Math.round(NAVAIDS[i].freq * 100) / 100 === rounded) {
      return NAVAIDS[i];
    }
  }
  return null;
}

/**
 * Look up all navaids matching a frequency. Returns array.
 */
export function getNavaidsByFreq(freq) {
  const rounded = Math.round(freq * 100) / 100;
  return NAVAIDS.filter(n => Math.round(n.freq * 100) / 100 === rounded);
}

// ---- Bearing & distance utilities ----

/**
 * Compute bearing from (fromX, fromZ) to (toX, toZ).
 * Returns degrees, 0 = north (negative Z), clockwise.
 * In the sim coordinate system: -Z is north, +X is east.
 */
export function computeBearing(fromX, fromZ, toX, toZ) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  // atan2(east, -south) -> atan2(dx, -dz) gives 0=north, CW positive
  let deg = Math.atan2(dx, -dz) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Distance in meters between two world-space points.
 */
export function computeDistance(fromX, fromZ, toX, toZ) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Distance in nautical miles between two world-space points.
 */
export function computeDistanceNM(fromX, fromZ, toX, toZ) {
  return computeDistance(fromX, fromZ, toX, toZ) / NM_TO_M;
}

// ---- 3D marker rendering ----

let _vorMesh = null;
let _ndbMesh = null;
let _ilsMesh = null;
let _markerGroup = null;

// Indices into the NAVAIDS array for each marker type
let _vorIndices = [];
let _ndbIndices = [];
let _ilsIndices = [];

const MARKER_VISIBLE_RANGE = 30000; // meters — hide markers beyond this

/**
 * Create small InstancedMesh markers in the scene for each navaid.
 * VOR = green octahedron, NDB = blue box, ILS = red narrow marker.
 * DME shares position with VOR so no separate marker is needed.
 */
export function initNavaidMarkers(scene) {
  _markerGroup = new THREE.Group();
  _markerGroup.name = 'navaidMarkers';

  // Partition navaids by visual type
  _vorIndices = [];
  _ndbIndices = [];
  _ilsIndices = [];

  for (let i = 0; i < NAVAIDS.length; i++) {
    const n = NAVAIDS[i];
    if (n.type === NAV_VOR) _vorIndices.push(i);
    else if (n.type === NAV_NDB) _ndbIndices.push(i);
    else if (n.type === NAV_ILS) _ilsIndices.push(i);
    // DME shares VOR position — no separate marker
  }

  // VOR markers — green octahedron
  if (_vorIndices.length > 0) {
    const vorGeo = new THREE.OctahedronGeometry(3, 0);
    const vorMat = new THREE.MeshStandardMaterial({
      color: 0x00cc44,
      emissive: 0x00aa33,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    });
    _vorMesh = new THREE.InstancedMesh(vorGeo, vorMat, _vorIndices.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < _vorIndices.length; i++) {
      const n = NAVAIDS[_vorIndices[i]];
      dummy.position.set(n.x, n.elevation + 2, n.z);
      dummy.updateMatrix();
      _vorMesh.setMatrixAt(i, dummy.matrix);
    }
    _vorMesh.instanceMatrix.needsUpdate = true;
    _markerGroup.add(_vorMesh);
  }

  // NDB markers — blue box
  if (_ndbIndices.length > 0) {
    const ndbGeo = new THREE.BoxGeometry(2, 4, 2);
    const ndbMat = new THREE.MeshStandardMaterial({
      color: 0x2266dd,
      emissive: 0x1144aa,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    });
    _ndbMesh = new THREE.InstancedMesh(ndbGeo, ndbMat, _ndbIndices.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < _ndbIndices.length; i++) {
      const n = NAVAIDS[_ndbIndices[i]];
      dummy.position.set(n.x, n.elevation + 2, n.z);
      dummy.updateMatrix();
      _ndbMesh.setMatrixAt(i, dummy.matrix);
    }
    _ndbMesh.instanceMatrix.needsUpdate = true;
    _markerGroup.add(_ndbMesh);
  }

  // ILS markers — red narrow marker (thin tall box)
  if (_ilsIndices.length > 0) {
    const ilsGeo = new THREE.BoxGeometry(1, 3, 1);
    const ilsMat = new THREE.MeshStandardMaterial({
      color: 0xdd2200,
      emissive: 0xcc1100,
      emissiveIntensity: 0.5,
      roughness: 0.5,
    });
    _ilsMesh = new THREE.InstancedMesh(ilsGeo, ilsMat, _ilsIndices.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < _ilsIndices.length; i++) {
      const n = NAVAIDS[_ilsIndices[i]];
      dummy.position.set(n.x, n.elevation + 1.5, n.z);
      dummy.updateMatrix();
      _ilsMesh.setMatrixAt(i, dummy.matrix);
    }
    _ilsMesh.instanceMatrix.needsUpdate = true;
    _markerGroup.add(_ilsMesh);
  }

  scene.add(_markerGroup);
}

/**
 * Optional LOD / visibility culling for navaid markers.
 * Hides markers that are very far from the camera to reduce draw calls.
 */
export function updateNavaidMarkers(cameraX, cameraZ) {
  if (!_markerGroup) return;

  const r2 = MARKER_VISIBLE_RANGE * MARKER_VISIBLE_RANGE;

  // Check if any navaid is within range — if so show the group, else hide
  let anyVisible = false;
  for (let i = 0; i < NAVAIDS.length; i++) {
    const n = NAVAIDS[i];
    const dx = n.x - cameraX;
    const dz = n.z - cameraZ;
    if (dx * dx + dz * dz < r2) {
      anyVisible = true;
      break;
    }
  }
  _markerGroup.visible = anyVisible;

  // Per-instance culling for VOR markers
  if (_vorMesh && _vorIndices.length > 0) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < _vorIndices.length; i++) {
      const n = NAVAIDS[_vorIndices[i]];
      const dx = n.x - cameraX;
      const dz = n.z - cameraZ;
      const visible = dx * dx + dz * dz < r2;
      dummy.position.set(n.x, visible ? n.elevation + 2 : -1000, n.z);
      dummy.updateMatrix();
      _vorMesh.setMatrixAt(i, dummy.matrix);
    }
    _vorMesh.instanceMatrix.needsUpdate = true;
  }

  // Per-instance culling for NDB markers
  if (_ndbMesh && _ndbIndices.length > 0) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < _ndbIndices.length; i++) {
      const n = NAVAIDS[_ndbIndices[i]];
      const dx = n.x - cameraX;
      const dz = n.z - cameraZ;
      const visible = dx * dx + dz * dz < r2;
      dummy.position.set(n.x, visible ? n.elevation + 2 : -1000, n.z);
      dummy.updateMatrix();
      _ndbMesh.setMatrixAt(i, dummy.matrix);
    }
    _ndbMesh.instanceMatrix.needsUpdate = true;
  }

  // Per-instance culling for ILS markers
  if (_ilsMesh && _ilsIndices.length > 0) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < _ilsIndices.length; i++) {
      const n = NAVAIDS[_ilsIndices[i]];
      const dx = n.x - cameraX;
      const dz = n.z - cameraZ;
      const visible = dx * dx + dz * dz < r2;
      dummy.position.set(n.x, visible ? n.elevation + 1.5 : -1000, n.z);
      dummy.updateMatrix();
      _ilsMesh.setMatrixAt(i, dummy.matrix);
    }
    _ilsMesh.instanceMatrix.needsUpdate = true;
  }
}

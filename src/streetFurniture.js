// ── Street Furniture ─────────────────────────────────────────────────
// Places all street infrastructure along roads: street lights, traffic
// lights, stop signs, bus stops, power lines, fire hydrants, benches,
// and construction zones. All geometry uses InstancedMesh for minimal
// draw calls.

import * as THREE from 'three';
import { getSignalPhase, assignSignalTypes, createSignalState, SIGNAL_TYPES } from './intersections.js';
import { getDistrictAt } from './cityData.js';

// ── Seeded PRNG ─────────────────────────────────────────────────────

let _seed = 98765;
function srand() {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed & 0x7fffffff) / 0x7fffffff;
}

// ── Module state ────────────────────────────────────────────────────

let _scene = null;
let _graph = null;

// Meshes
const _meshes = [];

// Street lights
let _streetLightPoleMesh = null;
let _streetLightLampMesh = null;
let _streetLightPositions = [];  // {x, y, z}[]
let _streetLightLampMat = null;
const _streetLightPoolLights = [];
const POOL_LIGHT_COUNT = 8;
let _lightsOn = false;
let _emissiveFade = 0; // 0 = off, 1 = full on

// Traffic lights
let _trafficPoleMesh = null;
let _trafficHousingMesh = null;
let _trafficRedMesh = null;
let _trafficYellowMesh = null;
let _trafficGreenMesh = null;
let _trafficRedMat = null;
let _trafficYellowMat = null;
let _trafficGreenMat = null;
let _trafficNodes = []; // {node, signal, index}[]
let _trafficUpdateTimer = 0;

// Stop signs
let _stopSignPoleMesh = null;
let _stopSignHeadMesh = null;

// Bus stops
let _busShelterMesh = null;
let _busBenchMesh = null;
let _busStopPositions = []; // {x, y, z}[]

// Power lines
let _powerPoleMesh = null;
let _powerCrossbarMesh = null;
let _powerWireMesh = null;
let _powerPolePositions = []; // {x, y, z}[]

// Fire hydrants
let _fireHydrantMesh = null;

// Benches
let _benchSeatMesh = null;
let _benchBackMesh = null;

// Construction zones
let _coneMesh = null;
let _barrierMesh = null;
let _constructionEdgeIds = [];
let _constructionTimer = 0;
let _constructionGroup = null;

// LOD groups
let _lodClose = null;   // < 500m: everything
let _lodMedium = null;  // 500-1500m: street lights + bus stops
let _lodFar = null;     // > 1500m: hidden

// ── Helpers ─────────────────────────────────────────────────────────

function getEdgeRoadTypes(graph, node) {
  const types = new Set();
  for (const eid of node.edges) {
    const e = graph.edges.get(eid);
    if (e) types.add(e.type || 'local');
  }
  return types;
}

function getHighestRoadTypes(graph, node) {
  const hierarchy = { expressway: 4, arterial: 3, collector: 2, local: 1, ramp: 0 };
  let best1 = null, best1Rank = -1;
  let best2 = null, best2Rank = -1;
  for (const eid of node.edges) {
    const e = graph.edges.get(eid);
    if (!e) continue;
    const t = e.type || 'local';
    const r = hierarchy[t] ?? 1;
    if (r > best1Rank) {
      best2 = best1; best2Rank = best1Rank;
      best1 = t; best1Rank = r;
    } else if (r > best2Rank) {
      best2 = t; best2Rank = r;
    }
  }
  return [best1 || 'local', best2 || best1 || 'local'];
}

function lerp(a, b, t) { return a + (b - a) * t; }

function edgeLength(graph, edge) {
  const nFrom = graph.nodes.get(edge.from);
  const nTo = graph.nodes.get(edge.to);
  if (!nFrom || !nTo) return 0;
  const dx = nTo.x - nFrom.x;
  const dz = (nTo.z ?? nTo.y) - (nFrom.z ?? nFrom.y);
  return Math.sqrt(dx * dx + dz * dz);
}

function edgeDirection(graph, edge) {
  const nFrom = graph.nodes.get(edge.from);
  const nTo = graph.nodes.get(edge.to);
  if (!nFrom || !nTo) return { dx: 1, dz: 0 };
  const fx = nFrom.x, fz = nFrom.z ?? nFrom.y;
  const tx = nTo.x, tz = nTo.z ?? nTo.y;
  const len = Math.sqrt((tx - fx) ** 2 + (tz - fz) ** 2) || 1;
  return { dx: (tx - fx) / len, dz: (tz - fz) / len };
}

function sampleEdge(graph, edge, t) {
  const nFrom = graph.nodes.get(edge.from);
  const nTo = graph.nodes.get(edge.to);
  if (!nFrom || !nTo) return { x: 0, y: 0, z: 0 };
  const fx = nFrom.x, fy = nFrom.y ?? 0, fz = nFrom.z ?? nFrom.y;
  const tx = nTo.x, ty = nTo.y ?? 0, tz = nTo.z ?? nTo.y;
  return {
    x: lerp(fx, tx, t),
    y: lerp(fy, ty, t),
    z: lerp(fz, tz, t),
  };
}

// ── Placement collectors ────────────────────────────────────────────

function collectStreetLightPositions(graph) {
  const positions = [];
  const intervals = { arterial: 40, collector: 60, local: 80 };
  const placed = new Set();

  for (const edge of graph.edges.values()) {
    const type = edge.type || 'local';
    if (type === 'expressway' || type === 'ramp') continue;
    const interval = intervals[type] || 80;
    const len = edgeLength(graph, edge);
    if (len < interval * 0.5) continue;

    const dir = edgeDirection(graph, edge);
    // Perpendicular offset to place lights on the side of the road
    const perpX = -dir.dz;
    const perpZ = dir.dx;
    const offset = (edge.width || 8) * 0.5 + 0.5;

    const steps = Math.floor(len / interval);
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const pos = sampleEdge(graph, edge, t);
      const px = Math.round((pos.x + perpX * offset) * 0.5) * 2;
      const pz = Math.round((pos.z + perpZ * offset) * 0.5) * 2;
      const key = `${px},${pz}`;
      if (placed.has(key)) continue;
      placed.add(key);
      positions.push({
        x: pos.x + perpX * offset,
        y: pos.y,
        z: pos.z + perpZ * offset,
      });
    }
  }

  return positions;
}

function collectTrafficLightNodes(graph) {
  const results = [];
  for (const node of graph.nodes.values()) {
    if (node.edges.length < 2) continue;
    const [t1, t2] = getHighestRoadTypes(graph, node);
    const sigType = assignSignalTypes(t1, t2);
    if (sigType === SIGNAL_TYPES.TRAFFIC_SIGNAL_FULL ||
        sigType === SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE) {
      const district = getDistrictAt(node.x, node.z ?? node.y);
      const distType = district ? district.type : 'residential';
      const signal = createSignalState(distType);
      // Offset timer by node position for variety
      signal.timer = (Math.abs(node.x) + Math.abs(node.z ?? node.y)) % 30;
      results.push({ node, signal });
    }
  }
  return results;
}

function collectStopSignNodes(graph) {
  const results = [];
  for (const node of graph.nodes.values()) {
    if (node.edges.length < 2) continue;
    const [t1, t2] = getHighestRoadTypes(graph, node);
    const sigType = assignSignalTypes(t1, t2);
    if (sigType === SIGNAL_TYPES.FOUR_WAY_STOP ||
        sigType === SIGNAL_TYPES.STOP_MINOR) {
      results.push(node);
    }
  }
  return results;
}

function collectBusStopPositions(graph) {
  const positions = [];
  const placed = new Set();
  const interval = 300;

  for (const edge of graph.edges.values()) {
    if (edge.type !== 'arterial') continue;
    const len = edgeLength(graph, edge);
    if (len < interval * 0.5) continue;

    const dir = edgeDirection(graph, edge);
    const perpX = -dir.dz;
    const perpZ = dir.dx;
    const offset = (edge.width || 16) * 0.5 + 2;

    const steps = Math.floor(len / interval);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const pos = sampleEdge(graph, edge, t);
      const px = Math.round(pos.x / 10) * 10;
      const pz = Math.round(pos.z / 10) * 10;
      const key = `bs_${px},${pz}`;
      if (placed.has(key)) continue;
      placed.add(key);

      const angle = Math.atan2(dir.dz, dir.dx);
      positions.push({
        x: pos.x + perpX * offset,
        y: pos.y,
        z: pos.z + perpZ * offset,
        rotation: angle,
      });
    }
  }

  return positions;
}

function collectPowerPolePositions(graph) {
  const positions = [];
  const placed = new Set();
  const interval = 60;

  for (const edge of graph.edges.values()) {
    const type = edge.type || 'local';
    if (type !== 'arterial' && type !== 'collector') continue;
    const len = edgeLength(graph, edge);
    if (len < interval * 0.5) continue;

    const dir = edgeDirection(graph, edge);
    const perpX = -dir.dz;
    const perpZ = dir.dx;
    const offset = (edge.width || 10) * 0.5 + 1.5;

    const steps = Math.floor(len / interval);
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0.5 : i / steps;
      const pos = sampleEdge(graph, edge, t);
      const px = Math.round(pos.x / 5) * 5;
      const pz = Math.round(pos.z / 5) * 5;
      const key = `pp_${px},${pz}`;
      if (placed.has(key)) continue;
      placed.add(key);
      positions.push({
        x: pos.x + perpX * offset,
        y: pos.y,
        z: pos.z + perpZ * offset,
        dx: dir.dx,
        dz: dir.dz,
      });
    }
  }

  return positions;
}

function collectFireHydrantPositions(graph) {
  const positions = [];
  const placed = new Set();
  const interval = 100;

  for (const edge of graph.edges.values()) {
    if (!edge.sidewalks) continue;
    const len = edgeLength(graph, edge);
    if (len < interval * 0.5) continue;

    const dir = edgeDirection(graph, edge);
    const perpX = -dir.dz;
    const perpZ = dir.dx;
    const offset = (edge.width || 8) * 0.5 + 0.8;

    const steps = Math.floor(len / interval);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const pos = sampleEdge(graph, edge, t);
      const px = Math.round(pos.x / 5) * 5;
      const pz = Math.round(pos.z / 5) * 5;
      const key = `fh_${px},${pz}`;
      if (placed.has(key)) continue;
      placed.add(key);
      positions.push({
        x: pos.x + perpX * offset,
        y: pos.y,
        z: pos.z + perpZ * offset,
      });
    }
  }

  return positions;
}

function collectBenchPositions(graph, busStopPositions) {
  const positions = [];

  // Near bus stops
  for (const bs of busStopPositions) {
    const angle = bs.rotation || 0;
    positions.push({
      x: bs.x + Math.cos(angle) * 2,
      y: bs.y,
      z: bs.z + Math.sin(angle) * 2,
      rotation: angle,
    });
  }

  // Sprinkle in waterfront/downtown districts
  _seed = 11111;
  for (const node of graph.nodes.values()) {
    const district = getDistrictAt(node.x, node.z ?? node.y);
    if (!district) continue;
    if (district.type !== 'waterfront' && district.type !== 'downtown') continue;
    if (srand() > 0.15) continue;
    if (node.edges.length < 2) continue;

    const eid = node.edges[0];
    const e = graph.edges.get(eid);
    if (!e) continue;
    const dir = edgeDirection(graph, e);
    const perpX = -dir.dz;
    const perpZ = dir.dx;
    const offset = (e.width || 8) * 0.5 + 1.5;

    positions.push({
      x: node.x + perpX * offset,
      y: node.y ?? 0,
      z: (node.z ?? node.y) + perpZ * offset,
      rotation: Math.atan2(dir.dz, dir.dx),
    });

    if (positions.length >= 100) break;
  }

  return positions.slice(0, 100);
}

// ── Construction zone ───────────────────────────────────────────────

function pickConstructionEdges(graph) {
  const edgeArr = [...graph.edges.values()].filter(e =>
    e.type === 'local' || e.type === 'collector'
  );
  if (edgeArr.length < 2) return [];

  _seed = 77777 + Math.floor(_constructionTimer / 600);
  const idx1 = Math.floor(srand() * edgeArr.length);
  let idx2 = Math.floor(srand() * (edgeArr.length - 1));
  if (idx2 >= idx1) idx2++;
  const picked = [edgeArr[idx1], edgeArr[idx2]];
  for (const e of picked) e.blockedLane = true;
  return picked.map(e => e.id);
}

function buildConstructionZone(graph, edgeIds, group) {
  // Clear old
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }

  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.8 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.7 });

  const coneGeo = new THREE.CylinderGeometry(0.02, 0.15, 0.6, 6);
  coneGeo.translate(0, 0.3, 0);
  const barrierGeo = new THREE.BoxGeometry(1.5, 0.8, 0.15);
  barrierGeo.translate(0, 0.4, 0);

  let coneCount = 0;
  let barrierCount = 0;

  // Count first
  for (const eid of edgeIds) {
    const edge = graph.edges.get(eid);
    if (!edge) continue;
    const len = edgeLength(graph, edge);
    coneCount += Math.floor(len / 5);
    barrierCount += Math.floor(len / 20) + 2;
  }

  if (coneCount === 0) return;

  const coneIM = new THREE.InstancedMesh(coneGeo, coneMat, coneCount);
  coneIM.receiveShadow = true;
  const barrierIM = new THREE.InstancedMesh(barrierGeo, barrierMat, barrierCount);
  barrierIM.receiveShadow = true;

  const mat4 = new THREE.Matrix4();
  let ci = 0, bi = 0;

  for (const eid of edgeIds) {
    const edge = graph.edges.get(eid);
    if (!edge) continue;
    const len = edgeLength(graph, edge);
    const dir = edgeDirection(graph, edge);
    const perpX = -dir.dz;
    const perpZ = dir.dx;
    const laneOffset = (edge.width || 8) * 0.25;
    const angle = Math.atan2(dir.dz, dir.dx);

    // Cones every 5m
    const coneSteps = Math.floor(len / 5);
    for (let i = 0; i < coneSteps && ci < coneCount; i++) {
      const t = (i + 0.5) / coneSteps;
      const pos = sampleEdge(graph, edge, t);
      mat4.makeRotationY(-angle);
      mat4.setPosition(
        pos.x + perpX * laneOffset,
        pos.y,
        pos.z + perpZ * laneOffset
      );
      coneIM.setMatrixAt(ci++, mat4);
    }

    // Barriers at start, end, and every 20m
    const barrierSteps = Math.floor(len / 20) + 2;
    for (let i = 0; i < barrierSteps && bi < barrierCount; i++) {
      const t = i / Math.max(1, barrierSteps - 1);
      const pos = sampleEdge(graph, edge, t);
      mat4.makeRotationY(-angle);
      mat4.setPosition(
        pos.x + perpX * laneOffset,
        pos.y,
        pos.z + perpZ * laneOffset
      );
      barrierIM.setMatrixAt(bi++, mat4);
    }
  }

  coneIM.instanceMatrix.needsUpdate = true;
  barrierIM.instanceMatrix.needsUpdate = true;
  coneIM.count = ci;
  barrierIM.count = bi;

  group.add(coneIM);
  group.add(barrierIM);
}

// ── Power wire geometry (merged catenary) ───────────────────────────

function buildPowerWires(positions) {
  if (positions.length < 2) return null;

  // Build consecutive pairs based on proximity
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < positions.length; i++) {
    if (used.has(i)) continue;
    let bestJ = -1, bestDist = 80; // max wire span 80m
    for (let j = i + 1; j < positions.length; j++) {
      if (used.has(j)) continue;
      const dx = positions[j].x - positions[i].x;
      const dz = positions[j].z - positions[i].z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      pairs.push([i, bestJ]);
      used.add(i);
      used.add(bestJ);
    }
  }

  if (pairs.length === 0) return null;

  // 3 points per wire (start, sag midpoint, end), 2 wires per span
  const verticesPerSpan = 3 * 2; // 2 wires (left + right offset on crossbar)
  const totalVerts = pairs.length * verticesPerSpan;
  const posArr = new Float32Array(totalVerts * 3);
  const indices = [];

  let vi = 0;
  let baseVert = 0;

  for (const [ai, bi] of pairs) {
    const a = positions[ai];
    const b = positions[bi];
    const wireHeight = 7.5; // top of pole + crossbar
    const sag = 1.2;

    // Direction for crossbar offset
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const perpX = -dz / len;
    const perpZ = dx / len;

    for (let w = 0; w < 2; w++) {
      const off = (w === 0 ? -1.2 : 1.2);
      const ox = perpX * off;
      const oz = perpZ * off;

      // Start
      posArr[vi++] = a.x + ox;
      posArr[vi++] = a.y + wireHeight;
      posArr[vi++] = a.z + oz;

      // Midpoint with sag
      posArr[vi++] = (a.x + b.x) * 0.5 + ox;
      posArr[vi++] = (a.y + b.y) * 0.5 + wireHeight - sag;
      posArr[vi++] = (a.z + b.z) * 0.5 + oz;

      // End
      posArr[vi++] = b.x + ox;
      posArr[vi++] = b.y + wireHeight;
      posArr[vi++] = b.z + oz;

      // Indices for line segments: start-mid, mid-end
      const v0 = baseVert;
      indices.push(v0, v0 + 1, v0 + 1, v0 + 2);
      baseVert += 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

  const mat = new THREE.LineBasicMaterial({ color: 0x222222 });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ── Main API ────────────────────────────────────────────────────────

export function createStreetFurniture(scene, graph) {
  _scene = scene;
  _graph = graph;
  _seed = 98765;

  // Create LOD groups
  _lodClose = new THREE.Group();
  _lodClose.name = 'streetFurniture_close';
  _lodMedium = new THREE.Group();
  _lodMedium.name = 'streetFurniture_medium';
  scene.add(_lodClose);
  scene.add(_lodMedium);

  const mat4 = new THREE.Matrix4();

  // ── 1. Street lights ────────────────────────────────────────────
  _streetLightPositions = collectStreetLightPositions(graph);
  const slCount = _streetLightPositions.length;

  if (slCount > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 6, 6);
    poleGeo.translate(0, 3, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.4 });
    _streetLightPoleMesh = new THREE.InstancedMesh(poleGeo, poleMat, slCount);
    _streetLightPoleMesh.receiveShadow = true;

    const lampGeo = new THREE.SphereGeometry(0.3, 8, 6);
    lampGeo.translate(0, 6.2, 0);
    _streetLightLampMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffaa44,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    _streetLightLampMesh = new THREE.InstancedMesh(lampGeo, _streetLightLampMat, slCount);
    _streetLightLampMesh.receiveShadow = true;

    for (let i = 0; i < slCount; i++) {
      const p = _streetLightPositions[i];
      mat4.makeTranslation(p.x, p.y, p.z);
      _streetLightPoleMesh.setMatrixAt(i, mat4);
      _streetLightLampMesh.setMatrixAt(i, mat4);
    }
    _streetLightPoleMesh.instanceMatrix.needsUpdate = true;
    _streetLightLampMesh.instanceMatrix.needsUpdate = true;

    _lodMedium.add(_streetLightPoleMesh);
    _lodMedium.add(_streetLightLampMesh);
    _meshes.push(_streetLightPoleMesh, _streetLightLampMesh);

    // Pooled point lights
    for (let i = 0; i < POOL_LIGHT_COUNT; i++) {
      const pl = new THREE.PointLight(0xffaa44, 0, 60);
      pl.visible = false;
      scene.add(pl);
      _streetLightPoolLights.push(pl);
    }
  }

  // ── 2. Traffic lights ───────────────────────────────────────────
  _trafficNodes = collectTrafficLightNodes(graph);
  const tlCount = _trafficNodes.length;

  if (tlCount > 0) {
    const tPoleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 6);
    tPoleGeo.translate(0, 2, 0);
    const tPoleMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.5 });
    _trafficPoleMesh = new THREE.InstancedMesh(tPoleGeo, tPoleMat, tlCount);
    _trafficPoleMesh.receiveShadow = true;

    const tHouseGeo = new THREE.BoxGeometry(0.4, 1.2, 0.3);
    tHouseGeo.translate(0, 4.6, 0);
    const tHouseMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
    _trafficHousingMesh = new THREE.InstancedMesh(tHouseGeo, tHouseMat, tlCount);
    _trafficHousingMesh.receiveShadow = true;

    // Red/Yellow/Green light spheres
    const lightSphereGeo = new THREE.SphereGeometry(0.12, 8, 6);

    _trafficRedMat = new THREE.MeshStandardMaterial({
      color: 0x330000, emissive: 0xff0000, emissiveIntensity: 0, roughness: 0.3,
    });
    _trafficYellowMat = new THREE.MeshStandardMaterial({
      color: 0x333300, emissive: 0xffff00, emissiveIntensity: 0, roughness: 0.3,
    });
    _trafficGreenMat = new THREE.MeshStandardMaterial({
      color: 0x003300, emissive: 0x00ff00, emissiveIntensity: 0, roughness: 0.3,
    });

    const redGeo = lightSphereGeo.clone();
    redGeo.translate(0, 5.0, 0.16);
    _trafficRedMesh = new THREE.InstancedMesh(redGeo, _trafficRedMat, tlCount);
    _trafficRedMesh.receiveShadow = true;

    const yellowGeo = lightSphereGeo.clone();
    yellowGeo.translate(0, 4.6, 0.16);
    _trafficYellowMesh = new THREE.InstancedMesh(yellowGeo, _trafficYellowMat, tlCount);
    _trafficYellowMesh.receiveShadow = true;

    const greenGeo = lightSphereGeo.clone();
    greenGeo.translate(0, 4.2, 0.16);
    _trafficGreenMesh = new THREE.InstancedMesh(greenGeo, _trafficGreenMat, tlCount);
    _trafficGreenMesh.receiveShadow = true;

    for (let i = 0; i < tlCount; i++) {
      const n = _trafficNodes[i].node;
      const nx = n.x;
      const ny = n.y ?? 0;
      const nz = n.z ?? n.y;
      mat4.makeTranslation(nx, ny, nz);
      _trafficPoleMesh.setMatrixAt(i, mat4);
      _trafficHousingMesh.setMatrixAt(i, mat4);
      _trafficRedMesh.setMatrixAt(i, mat4);
      _trafficYellowMesh.setMatrixAt(i, mat4);
      _trafficGreenMesh.setMatrixAt(i, mat4);
    }
    _trafficPoleMesh.instanceMatrix.needsUpdate = true;
    _trafficHousingMesh.instanceMatrix.needsUpdate = true;
    _trafficRedMesh.instanceMatrix.needsUpdate = true;
    _trafficYellowMesh.instanceMatrix.needsUpdate = true;
    _trafficGreenMesh.instanceMatrix.needsUpdate = true;

    _lodClose.add(_trafficPoleMesh);
    _lodClose.add(_trafficHousingMesh);
    _lodClose.add(_trafficRedMesh);
    _lodClose.add(_trafficYellowMesh);
    _lodClose.add(_trafficGreenMesh);
    _meshes.push(
      _trafficPoleMesh, _trafficHousingMesh,
      _trafficRedMesh, _trafficYellowMesh, _trafficGreenMesh
    );
  }

  // ── 3. Stop signs ──────────────────────────────────────────────
  const stopNodes = collectStopSignNodes(graph);
  const ssCount = stopNodes.length;

  if (ssCount > 0) {
    const ssPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6);
    ssPoleGeo.translate(0, 1.25, 0);
    const ssPoleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.4 });
    _stopSignPoleMesh = new THREE.InstancedMesh(ssPoleGeo, ssPoleMat, ssCount);
    _stopSignPoleMesh.receiveShadow = true;

    // Octagonal head
    const ssHeadGeo = new THREE.CircleGeometry(0.35, 8);
    ssHeadGeo.translate(0, 2.6, 0);
    const ssHeadMat = new THREE.MeshStandardMaterial({
      color: 0xcc0000, roughness: 0.6, side: THREE.DoubleSide,
    });
    _stopSignHeadMesh = new THREE.InstancedMesh(ssHeadGeo, ssHeadMat, ssCount);
    _stopSignHeadMesh.receiveShadow = true;

    for (let i = 0; i < ssCount; i++) {
      const n = stopNodes[i];
      const nx = n.x;
      const ny = n.y ?? 0;
      const nz = n.z ?? n.y;

      // Offset to side of road
      let offsetX = 0, offsetZ = 0;
      if (n.edges.length > 0) {
        const e = graph.edges.get(n.edges[0]);
        if (e) {
          const dir = edgeDirection(graph, e);
          offsetX = -dir.dz * 3;
          offsetZ = dir.dx * 3;
        }
      }

      mat4.makeTranslation(nx + offsetX, ny, nz + offsetZ);
      _stopSignPoleMesh.setMatrixAt(i, mat4);
      _stopSignHeadMesh.setMatrixAt(i, mat4);
    }
    _stopSignPoleMesh.instanceMatrix.needsUpdate = true;
    _stopSignHeadMesh.instanceMatrix.needsUpdate = true;

    _lodClose.add(_stopSignPoleMesh);
    _lodClose.add(_stopSignHeadMesh);
    _meshes.push(_stopSignPoleMesh, _stopSignHeadMesh);
  }

  // ── 4. Bus stops ───────────────────────────────────────────────
  _busStopPositions = collectBusStopPositions(graph);
  const bsCount = _busStopPositions.length;

  if (bsCount > 0) {
    const shelterGeo = new THREE.BoxGeometry(3, 2.5, 1.5);
    shelterGeo.translate(0, 1.25, 0);
    const shelterMat = new THREE.MeshStandardMaterial({
      color: 0x99aaaa, roughness: 0.5, transparent: true, opacity: 0.85,
    });
    _busShelterMesh = new THREE.InstancedMesh(shelterGeo, shelterMat, bsCount);
    _busShelterMesh.receiveShadow = true;

    const bbGeo = new THREE.BoxGeometry(2, 0.5, 0.4);
    bbGeo.translate(0, 0.45, -0.3);
    const bbMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 });
    _busBenchMesh = new THREE.InstancedMesh(bbGeo, bbMat, bsCount);
    _busBenchMesh.receiveShadow = true;

    for (let i = 0; i < bsCount; i++) {
      const p = _busStopPositions[i];
      mat4.makeRotationY(-(p.rotation || 0));
      mat4.setPosition(p.x, p.y, p.z);
      _busShelterMesh.setMatrixAt(i, mat4);
      _busBenchMesh.setMatrixAt(i, mat4);
    }
    _busShelterMesh.instanceMatrix.needsUpdate = true;
    _busBenchMesh.instanceMatrix.needsUpdate = true;

    _lodMedium.add(_busShelterMesh);
    _lodMedium.add(_busBenchMesh);
    _meshes.push(_busShelterMesh, _busBenchMesh);
  }

  // ── 5. Power line poles ────────────────────────────────────────
  _powerPolePositions = collectPowerPolePositions(graph);
  const ppCount = _powerPolePositions.length;

  if (ppCount > 0) {
    const ppPoleGeo = new THREE.CylinderGeometry(0.12, 0.15, 8, 6);
    ppPoleGeo.translate(0, 4, 0);
    const ppPoleMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 });
    _powerPoleMesh = new THREE.InstancedMesh(ppPoleGeo, ppPoleMat, ppCount);
    _powerPoleMesh.receiveShadow = true;

    const ppCrossGeo = new THREE.BoxGeometry(3, 0.1, 0.1);
    ppCrossGeo.translate(0, 7.8, 0);
    const ppCrossMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 });
    _powerCrossbarMesh = new THREE.InstancedMesh(ppCrossGeo, ppCrossMat, ppCount);
    _powerCrossbarMesh.receiveShadow = true;

    for (let i = 0; i < ppCount; i++) {
      const p = _powerPolePositions[i];
      const angle = Math.atan2(p.dz || 0, p.dx || 1);
      mat4.makeRotationY(-angle);
      mat4.setPosition(p.x, p.y, p.z);
      _powerPoleMesh.setMatrixAt(i, mat4);
      _powerCrossbarMesh.setMatrixAt(i, mat4);
    }
    _powerPoleMesh.instanceMatrix.needsUpdate = true;
    _powerCrossbarMesh.instanceMatrix.needsUpdate = true;

    _lodClose.add(_powerPoleMesh);
    _lodClose.add(_powerCrossbarMesh);
    _meshes.push(_powerPoleMesh, _powerCrossbarMesh);

    // Power wires (merged geometry)
    _powerWireMesh = buildPowerWires(_powerPolePositions);
    if (_powerWireMesh) {
      _lodClose.add(_powerWireMesh);
      _meshes.push(_powerWireMesh);
    }
  }

  // ── 6. Fire hydrants ──────────────────────────────────────────
  const hydrantPositions = collectFireHydrantPositions(graph);
  const fhCount = hydrantPositions.length;

  if (fhCount > 0) {
    const fhGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.6, 8);
    fhGeo.translate(0, 0.3, 0);
    const fhMat = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.6 });
    _fireHydrantMesh = new THREE.InstancedMesh(fhGeo, fhMat, fhCount);
    _fireHydrantMesh.receiveShadow = true;

    for (let i = 0; i < fhCount; i++) {
      const p = hydrantPositions[i];
      mat4.makeTranslation(p.x, p.y, p.z);
      _fireHydrantMesh.setMatrixAt(i, mat4);
    }
    _fireHydrantMesh.instanceMatrix.needsUpdate = true;

    _lodClose.add(_fireHydrantMesh);
    _meshes.push(_fireHydrantMesh);
  }

  // ── 7. Benches ────────────────────────────────────────────────
  const benchPositions = collectBenchPositions(graph, _busStopPositions);
  const bnCount = benchPositions.length;

  if (bnCount > 0) {
    const seatGeo = new THREE.BoxGeometry(1.5, 0.45, 0.5);
    seatGeo.translate(0, 0.45, 0);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7 });
    _benchSeatMesh = new THREE.InstancedMesh(seatGeo, seatMat, bnCount);
    _benchSeatMesh.receiveShadow = true;

    const backGeo = new THREE.BoxGeometry(1.5, 0.3, 0.05);
    backGeo.translate(0, 0.75, -0.22);
    const backMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7 });
    _benchBackMesh = new THREE.InstancedMesh(backGeo, backMat, bnCount);
    _benchBackMesh.receiveShadow = true;

    for (let i = 0; i < bnCount; i++) {
      const p = benchPositions[i];
      mat4.makeRotationY(-(p.rotation || 0));
      mat4.setPosition(p.x, p.y, p.z);
      _benchSeatMesh.setMatrixAt(i, mat4);
      _benchBackMesh.setMatrixAt(i, mat4);
    }
    _benchSeatMesh.instanceMatrix.needsUpdate = true;
    _benchBackMesh.instanceMatrix.needsUpdate = true;

    _lodClose.add(_benchSeatMesh);
    _lodClose.add(_benchBackMesh);
    _meshes.push(_benchSeatMesh, _benchBackMesh);
  }

  // ── 8. Construction zones ─────────────────────────────────────
  _constructionGroup = new THREE.Group();
  _constructionGroup.name = 'constructionZone';
  _lodClose.add(_constructionGroup);

  _constructionTimer = 0;
  _constructionEdgeIds = pickConstructionEdges(graph);
  if (_constructionEdgeIds.length > 0) {
    buildConstructionZone(graph, _constructionEdgeIds, _constructionGroup);
  }
}

// ── Update ──────────────────────────────────────────────────────────

export function updateStreetFurniture(dt, timeOfDay, cameraPos) {
  if (!_graph || !_lodClose) return;

  const camX = cameraPos ? cameraPos.x : 4000;
  const camZ = cameraPos ? cameraPos.z : -4000;

  // ── LOD: find distance to city center area ──────────────────────
  // Use distance to nearest furniture cluster (approximate via city center)
  const CITY_CX = 4000, CITY_CZ = -4000;
  const distToCity = Math.sqrt((camX - CITY_CX) ** 2 + (camZ - CITY_CZ) ** 2);

  if (distToCity > 1500) {
    _lodClose.visible = false;
    _lodMedium.visible = false;
    return;
  } else if (distToCity > 500) {
    _lodClose.visible = false;
    _lodMedium.visible = true;
  } else {
    _lodClose.visible = true;
    _lodMedium.visible = true;
  }

  // ── Street light on/off with 30s fade ───────────────────────────
  const hour = timeOfDay;
  const wantLights = (hour < 6 || hour > 18);

  if (wantLights && _emissiveFade < 1) {
    _emissiveFade = Math.min(1, _emissiveFade + dt / 30);
  } else if (!wantLights && _emissiveFade > 0) {
    _emissiveFade = Math.max(0, _emissiveFade - dt / 30);
  }

  if (_streetLightLampMat) {
    _streetLightLampMat.emissiveIntensity = _emissiveFade;
  }

  // ── Pooled street light PointLights ─────────────────────────────
  if (_streetLightPositions.length > 0 && _streetLightPoolLights.length > 0) {
    const intensity = _emissiveFade * 6;

    if (intensity < 0.01) {
      for (const pl of _streetLightPoolLights) {
        pl.visible = false;
      }
    } else {
      // Find 8 nearest street lights to camera
      const sorted = [];
      for (let i = 0; i < _streetLightPositions.length; i++) {
        const p = _streetLightPositions[i];
        const dx = p.x - camX;
        const dz = p.z - camZ;
        sorted.push({ idx: i, dist: dx * dx + dz * dz });
      }
      sorted.sort((a, b) => a.dist - b.dist);

      for (let i = 0; i < POOL_LIGHT_COUNT; i++) {
        const pl = _streetLightPoolLights[i];
        if (i < sorted.length && sorted[i].dist < 10000) { // 100m squared
          const p = _streetLightPositions[sorted[i].idx];
          pl.position.set(p.x, p.y + 6.2, p.z);
          pl.intensity = intensity;
          pl.visible = true;
        } else {
          pl.visible = false;
        }
      }
    }
  }

  // ── Traffic light color update at 1Hz ──────────────────────────
  _trafficUpdateTimer += dt;
  if (_trafficUpdateTimer >= 1.0 && _trafficNodes.length > 0) {
    _trafficUpdateTimer = 0;

    // Advance all traffic light signals
    for (const tl of _trafficNodes) {
      tl.signal.timer += 1.0;
      while (tl.signal.timer >= tl.signal.phases[tl.signal.currentPhase].duration) {
        tl.signal.timer -= tl.signal.phases[tl.signal.currentPhase].duration;
        tl.signal.currentPhase = (tl.signal.currentPhase + 1) % tl.signal.phases.length;
      }
    }

    // Determine dominant state across all traffic lights for shared materials
    // Count states
    let redCount = 0, yellowCount = 0, greenCount = 0;
    for (const tl of _trafficNodes) {
      const phase = getSignalPhase(tl.signal);
      // Use NS direction as the "facing camera" direction
      if (phase.nsState === 'red') redCount++;
      else if (phase.nsState === 'yellow') yellowCount++;
      else if (phase.nsState === 'green') greenCount++;
    }

    // Since we use shared materials per color, we set emission based on
    // whether that color is active for any signal. For a more realistic
    // approach with per-instance colors, we would need per-instance
    // color attributes, but shared materials keep draw calls minimal.
    // Instead, set all three always slightly on, with the active one bright.
    if (_trafficRedMat) {
      _trafficRedMat.emissiveIntensity = redCount > 0 ? 1.0 : 0.1;
    }
    if (_trafficYellowMat) {
      _trafficYellowMat.emissiveIntensity = yellowCount > 0 ? 1.0 : 0.1;
    }
    if (_trafficGreenMat) {
      _trafficGreenMat.emissiveIntensity = greenCount > 0 ? 1.0 : 0.1;
    }
  }

  // ── Construction zone rotation every 600s ─────────────────────
  _constructionTimer += dt;
  if (_constructionTimer >= 600 && _graph) {
    // Clear old blocked lanes
    for (const eid of _constructionEdgeIds) {
      const e = _graph.edges.get(eid);
      if (e) e.blockedLane = false;
    }

    _constructionEdgeIds = pickConstructionEdges(_graph);
    if (_constructionEdgeIds.length > 0) {
      buildConstructionZone(_graph, _constructionEdgeIds, _constructionGroup);
    }
    _constructionTimer = 0;
  }
}

// ── Dispose ─────────────────────────────────────────────────────────

export function disposeStreetFurniture() {
  // Remove pooled lights
  for (const pl of _streetLightPoolLights) {
    if (pl.parent) pl.parent.remove(pl);
    pl.dispose();
  }
  _streetLightPoolLights.length = 0;

  // Remove and dispose all meshes
  for (const mesh of _meshes) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }
  _meshes.length = 0;

  // Remove construction group
  if (_constructionGroup) {
    while (_constructionGroup.children.length > 0) {
      const child = _constructionGroup.children[0];
      _constructionGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  // Remove LOD groups
  if (_lodClose && _lodClose.parent) _lodClose.parent.remove(_lodClose);
  if (_lodMedium && _lodMedium.parent) _lodMedium.parent.remove(_lodMedium);

  // Reset state
  _scene = null;
  _graph = null;
  _streetLightPoleMesh = null;
  _streetLightLampMesh = null;
  _streetLightPositions = [];
  _streetLightLampMat = null;
  _lightsOn = false;
  _emissiveFade = 0;
  _trafficPoleMesh = null;
  _trafficHousingMesh = null;
  _trafficRedMesh = null;
  _trafficYellowMesh = null;
  _trafficGreenMesh = null;
  _trafficRedMat = null;
  _trafficYellowMat = null;
  _trafficGreenMat = null;
  _trafficNodes = [];
  _trafficUpdateTimer = 0;
  _stopSignPoleMesh = null;
  _stopSignHeadMesh = null;
  _busShelterMesh = null;
  _busBenchMesh = null;
  _busStopPositions = [];
  _powerPoleMesh = null;
  _powerCrossbarMesh = null;
  _powerWireMesh = null;
  _powerPolePositions = [];
  _fireHydrantMesh = null;
  _benchSeatMesh = null;
  _benchBackMesh = null;
  _coneMesh = null;
  _barrierMesh = null;
  _constructionEdgeIds = [];
  _constructionTimer = 0;
  _constructionGroup = null;
  _lodClose = null;
  _lodMedium = null;
}

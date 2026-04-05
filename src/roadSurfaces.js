// ── Road Surfaces ──────────────────────────────────────────────────
// Generates visible road geometry from roadGraph edges.
// Groups edges by type, merges into minimal draw calls (5 total).

import * as THREE from 'three';

// ── Module-level mesh tracking for disposal ───────────────────────
const roadMeshes = [];

// ── Materials ─────────────────────────────────────────────────────

// Local/collector — medium gray asphalt
const localMat = new THREE.MeshLambertMaterial({
  color: 0x555555,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

// Arterial — slightly darker
const arterialMat = new THREE.MeshLambertMaterial({
  color: 0x444444,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

// Expressway — darkest
const expresswayMat = new THREE.MeshLambertMaterial({
  color: 0x333333,
  polygonOffset: true,
  polygonOffsetFactor: -1.5,
  polygonOffsetUnits: -1.5,
});

// Sidewalk — light concrete
const sidewalkMat = new THREE.MeshLambertMaterial({
  color: 0x999999,
  polygonOffset: true,
  polygonOffsetFactor: -0.5,
  polygonOffsetUnits: -0.5,
});

// Road markings — white, no depth write, deep polygon offset
const markingMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

// ── Constants ─────────────────────────────────────────────────────

const Y_OFFSET       = 0.15;  // Road surface above terrain
const SIDEWALK_WIDTH  = 1.5;
const SIDEWALK_GAP    = 0.5;
const SIDEWALK_RAISE  = 0.1;  // Sidewalk above road surface

const MARKING_SPACING = 5;    // Dash every 5m (center-to-center)
const MARKING_LENGTH  = 3;    // Each dash is 3m long
const MARKING_WIDTH   = 0.15; // 15cm line width

const UV_REPEAT_M     = 20;   // UV V repeats every 20m

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Compute a perpendicular direction (in XZ plane) from edge direction.
 * Returns [px, pz] normalised.
 */
function perpendicular(dx, dz) {
  // Rotate edge direction 90 degrees in XZ plane
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len === 0) return [0, 0];
  return [-dz / len, dx / len];
}

/**
 * Build a quad strip (4 verts, 6 indices) for a road segment.
 * Pushes data into the provided arrays.
 *
 * @param {Object} fromNode  - { x, y, z }
 * @param {Object} toNode    - { x, y, z }
 * @param {number} width     - Full width of the strip
 * @param {number} yOffset   - Y offset above node elevation
 * @param {Float32Array|Array} positions
 * @param {Float32Array|Array} normals
 * @param {Float32Array|Array} uvs
 * @param {Uint32Array|Array} indices
 * @param {Object} counters  - { v: vertexCount, i: indexCount }
 */
function pushQuad(fromNode, toNode, width, yOffset, positions, normals, uvs, indices, counters) {
  const dx = toNode.x - fromNode.x;
  const dz = toNode.z - fromNode.z;
  const edgeLen = Math.sqrt(dx * dx + dz * dz);
  if (edgeLen === 0) return;

  const [px, pz] = perpendicular(dx, dz);
  const hw = width * 0.5;

  const fy = fromNode.y + yOffset;
  const ty = toNode.y + yOffset;

  const baseV = counters.v;

  // 4 vertices: from-left, from-right, to-left, to-right
  // v0: from - perp * hw
  positions.push(fromNode.x - px * hw, fy, fromNode.z - pz * hw);
  // v1: from + perp * hw
  positions.push(fromNode.x + px * hw, fy, fromNode.z + pz * hw);
  // v2: to - perp * hw
  positions.push(toNode.x - px * hw, ty, toNode.z - pz * hw);
  // v3: to + perp * hw
  positions.push(toNode.x + px * hw, ty, toNode.z + pz * hw);

  // Normals — all up
  for (let i = 0; i < 4; i++) {
    normals.push(0, 1, 0);
  }

  // UVs — U across width (0..1), V along length (repeating every UV_REPEAT_M)
  const vLen = edgeLen / UV_REPEAT_M;
  uvs.push(0, 0);       // v0
  uvs.push(1, 0);       // v1
  uvs.push(0, vLen);    // v2
  uvs.push(1, vLen);    // v3

  // 2 triangles: (v0, v2, v1) and (v1, v2, v3)
  indices.push(baseV, baseV + 2, baseV + 1);
  indices.push(baseV + 1, baseV + 2, baseV + 3);

  counters.v += 4;
  counters.i += 6;
}

/**
 * Build merged BufferGeometry from collected arrays.
 */
function buildGeometry(positions, normals, uvs, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Create a mesh, configure it, add to scene, and track for disposal.
 */
function addRoadMesh(scene, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // Roads span the whole city
  scene.add(mesh);
  roadMeshes.push(mesh);
  return mesh;
}

// ── Sidewalk generation ───────────────────────────────────────────

/**
 * For edges with sidewalks: true, generate two thin strips on either side.
 */
function buildSidewalkGeometry(graph, sidewalkEdges) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const counters = { v: 0, i: 0 };

  for (const edge of sidewalkEdges) {
    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;

    const dx = toNode.x - fromNode.x;
    const dz = toNode.z - fromNode.z;
    const edgeLen = Math.sqrt(dx * dx + dz * dz);
    if (edgeLen === 0) continue;

    const [px, pz] = perpendicular(dx, dz);
    const roadHW = edge.width * 0.5;
    const swOffset = roadHW + SIDEWALK_GAP;
    const swOuter = swOffset + SIDEWALK_WIDTH;
    const yOff = Y_OFFSET + SIDEWALK_RAISE;

    const fy = fromNode.y + yOff;
    const ty = toNode.y + yOff;
    const vLen = edgeLen / UV_REPEAT_M;

    // Left sidewalk strip
    const baseL = counters.v;
    // Inner edge (closer to road)
    positions.push(fromNode.x - px * swOffset, fy, fromNode.z - pz * swOffset);
    positions.push(fromNode.x - px * swOuter, fy, fromNode.z - pz * swOuter);
    positions.push(toNode.x - px * swOffset, ty, toNode.z - pz * swOffset);
    positions.push(toNode.x - px * swOuter, ty, toNode.z - pz * swOuter);
    for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
    uvs.push(0, 0, 1, 0, 0, vLen, 1, vLen);
    indices.push(baseL, baseL + 2, baseL + 1, baseL + 1, baseL + 2, baseL + 3);
    counters.v += 4;
    counters.i += 6;

    // Right sidewalk strip
    const baseR = counters.v;
    positions.push(fromNode.x + px * swOffset, fy, fromNode.z + pz * swOffset);
    positions.push(fromNode.x + px * swOuter, fy, fromNode.z + pz * swOuter);
    positions.push(toNode.x + px * swOffset, ty, toNode.z + pz * swOffset);
    positions.push(toNode.x + px * swOuter, ty, toNode.z + pz * swOuter);
    for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
    uvs.push(0, 0, 1, 0, 0, vLen, 1, vLen);
    indices.push(baseR, baseR + 2, baseR + 1, baseR + 1, baseR + 2, baseR + 3);
    counters.v += 4;
    counters.i += 6;
  }

  if (counters.v === 0) return null;
  return buildGeometry(positions, normals, uvs, indices);
}

// ── Road markings generation ──────────────────────────────────────

/**
 * Build center dashes on arterials and lane lines on expressways.
 * Simple white quads spaced every MARKING_SPACING meters, each
 * MARKING_LENGTH long x MARKING_WIDTH wide.
 */
function buildMarkingsGeometry(graph, arterialEdges, expresswayEdges) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const counters = { v: 0, i: 0 };

  const markingYOffset = Y_OFFSET + 0.02; // Just above road surface

  // Helper: generate dashes along an edge at a given lateral offset
  function generateDashes(edge, lateralOffset) {
    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);
    if (!fromNode || !toNode) return;

    const dx = toNode.x - fromNode.x;
    const dz = toNode.z - fromNode.z;
    const edgeLen = Math.sqrt(dx * dx + dz * dz);
    if (edgeLen < MARKING_SPACING) return;

    const dirX = dx / edgeLen;
    const dirZ = dz / edgeLen;
    const [px, pz] = perpendicular(dx, dz);

    const halfMarkLen = MARKING_LENGTH * 0.5;
    const halfMarkW = MARKING_WIDTH * 0.5;

    // Place dashes along the edge
    for (let d = MARKING_SPACING * 0.5; d + halfMarkLen < edgeLen; d += MARKING_SPACING) {
      const t = d / edgeLen;
      // Center position of this dash
      const cx = fromNode.x + dx * t + px * lateralOffset;
      const cz = fromNode.z + dz * t + pz * lateralOffset;
      const cy = fromNode.y + (toNode.y - fromNode.y) * t + markingYOffset;

      // 4 corners of the dash quad
      const baseV = counters.v;

      // Along edge: +/- halfMarkLen in dir direction
      // Across edge: +/- halfMarkW in perp direction
      positions.push(
        cx - dirX * halfMarkLen - px * halfMarkW, cy, cz - dirZ * halfMarkLen - pz * halfMarkW,
      );
      positions.push(
        cx - dirX * halfMarkLen + px * halfMarkW, cy, cz - dirZ * halfMarkLen + pz * halfMarkW,
      );
      positions.push(
        cx + dirX * halfMarkLen - px * halfMarkW, cy, cz + dirZ * halfMarkLen - pz * halfMarkW,
      );
      positions.push(
        cx + dirX * halfMarkLen + px * halfMarkW, cy, cz + dirZ * halfMarkLen + pz * halfMarkW,
      );

      for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      indices.push(baseV, baseV + 2, baseV + 1, baseV + 1, baseV + 2, baseV + 3);
      counters.v += 4;
      counters.i += 6;
    }
  }

  // Arterials: center dashes (lateral offset = 0)
  for (const edge of arterialEdges) {
    generateDashes(edge, 0);
  }

  // Expressways: lane lines
  // 6 lanes = 3 per side; lane width = edge.width / lanes
  // Lines between lanes at offsets from center
  for (const edge of expresswayEdges) {
    const laneW = edge.width / (edge.lanes || 6);
    const halfRoad = edge.width * 0.5;
    // Center line (median)
    generateDashes(edge, 0);
    // Lane dividers: at each lane boundary except the road edges and center
    for (let lane = 1; lane < (edge.lanes || 6); lane++) {
      if (lane === (edge.lanes || 6) / 2) continue; // Skip center, already drawn
      const offset = -halfRoad + lane * laneW;
      generateDashes(edge, offset);
    }
  }

  if (counters.v === 0) return null;
  return buildGeometry(positions, normals, uvs, indices);
}

// ── Main API ──────────────────────────────────────────────────────

/**
 * Generate road surface meshes from graph edges and add to scene.
 *
 * @param {THREE.Scene} scene
 * @param {Object} graph - Road graph from generateCityRoadGraph()
 */
export function createRoadSurfaces(scene, graph) {
  // Dispose any existing road meshes first
  disposeRoadSurfaces();

  if (!graph || !graph.edges) return;

  // ── 1. Group edges by type ──────────────────────────────────────

  const localCollectorEdges = [];
  const arterialEdges = [];
  const expresswayEdges = [];
  const sidewalkEdges = [];

  for (const edge of graph.edges.values()) {
    switch (edge.type) {
      case 'local':
      case 'collector':
      case 'ramp':
        localCollectorEdges.push(edge);
        break;
      case 'arterial':
        arterialEdges.push(edge);
        break;
      case 'expressway':
        expresswayEdges.push(edge);
        break;
      default:
        // Unknown type — treat as local
        localCollectorEdges.push(edge);
        break;
    }

    // Track edges with sidewalks
    if (edge.sidewalks) {
      sidewalkEdges.push(edge);
    }
  }

  // ── 2. Build merged geometry per group ──────────────────────────

  // Group 1: Local + Collector roads
  if (localCollectorEdges.length > 0) {
    const pos = [], nrm = [], uv = [], idx = [];
    const ctr = { v: 0, i: 0 };
    for (const edge of localCollectorEdges) {
      const fromNode = graph.nodes.get(edge.from);
      const toNode = graph.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      pushQuad(fromNode, toNode, edge.width, Y_OFFSET, pos, nrm, uv, idx, ctr);
    }
    if (ctr.v > 0) {
      const geo = buildGeometry(pos, nrm, uv, idx);
      addRoadMesh(scene, geo, localMat);
    }
  }

  // Group 2: Arterial roads
  if (arterialEdges.length > 0) {
    const pos = [], nrm = [], uv = [], idx = [];
    const ctr = { v: 0, i: 0 };
    for (const edge of arterialEdges) {
      const fromNode = graph.nodes.get(edge.from);
      const toNode = graph.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      pushQuad(fromNode, toNode, edge.width, Y_OFFSET, pos, nrm, uv, idx, ctr);
    }
    if (ctr.v > 0) {
      const geo = buildGeometry(pos, nrm, uv, idx);
      addRoadMesh(scene, geo, arterialMat);
    }
  }

  // Group 3: Expressway roads
  if (expresswayEdges.length > 0) {
    const pos = [], nrm = [], uv = [], idx = [];
    const ctr = { v: 0, i: 0 };
    for (const edge of expresswayEdges) {
      const fromNode = graph.nodes.get(edge.from);
      const toNode = graph.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      pushQuad(fromNode, toNode, edge.width, Y_OFFSET, pos, nrm, uv, idx, ctr);
    }
    if (ctr.v > 0) {
      const geo = buildGeometry(pos, nrm, uv, idx);
      addRoadMesh(scene, geo, expresswayMat);
    }
  }

  // Group 4: Sidewalks
  if (sidewalkEdges.length > 0) {
    const geo = buildSidewalkGeometry(graph, sidewalkEdges);
    if (geo) {
      addRoadMesh(scene, geo, sidewalkMat);
    }
  }

  // Group 5: Road markings
  if (arterialEdges.length > 0 || expresswayEdges.length > 0) {
    const geo = buildMarkingsGeometry(graph, arterialEdges, expresswayEdges);
    if (geo) {
      addRoadMesh(scene, geo, markingMat);
    }
  }
}

/**
 * Remove all road meshes from scene, dispose geometry and materials.
 */
export function disposeRoadSurfaces() {
  for (const mesh of roadMeshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.parent?.remove(mesh);
  }
  roadMeshes.length = 0;
}

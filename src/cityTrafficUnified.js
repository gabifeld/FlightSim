// ── Unified City Traffic System ──────────────────────────────────────
// Replaces cityTraffic.js + highwayTraffic.js with graph-driven vehicles.

import * as THREE from 'three';
import { getEdge, getNode, getEdgesFromNode, findPath, getCityGraph } from './roadGraph.js';
import { isGreenForDirection, createSignalState, updateSignals, assignSignalTypes } from './intersections.js';
import { VEHICLE_TYPES, getActivityMultiplier, MAX_ACTIVE_VEHICLES, getDistrictAt, CITY_BOUNDS } from './cityData.js';

// ── Helpers ─────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

/** Seeded PRNG — deterministic spawn patterns. */
let _seed = 77321;
function srand() { _seed = (_seed * 16807) % 2147483647; return (_seed & 0x7fffffff) / 0x7fffffff; }
function randRange(lo, hi) { return lo + srand() * (hi - lo); }
function pick(arr) { return arr[Math.floor(srand() * arr.length)]; }

// ── Constants ───────────────────────────────────────────────────────

const TICK_RATE = 1 / 30;
const SPAWN_INTERVAL = 0.5;          // seconds between spawn checks
const STUCK_TIMEOUT = 30;            // despawn after 30s stuck
const FOLLOWING_GAP = 2.0;           // seconds of following distance
const SIGNAL_APPROACH_T = 0.9;       // start checking signal when t > this
const DECEL_RATE = 5.0;              // m/s² deceleration for stops
const VEHICLE_Y_OFFSET = 0.3;        // raise vehicle above road surface

// ── InstancedMesh definitions ───────────────────────────────────────

const MESH_DEFS = {
  sedan:        { w: 4.5,  h: 1.4, d: 1.8, maxCount: 50, colors: [0x3366cc, 0xcc3333, 0x33cc33, 0xcccc33, 0xffffff] },
  suv:          { w: 5.0,  h: 1.6, d: 2.0, maxCount: 20, colors: [0x335577, 0x774433, 0x557733, 0x555555, 0xdddddd] },
  truck:        { w: 6.0,  h: 2.0, d: 2.2, maxCount: 15, colors: [0x886644] },
  semi:         { w: 12.0, h: 2.5, d: 2.5, maxCount: 10, colors: [0x444444] },
  bus:          { w: 12.0, h: 2.8, d: 2.5, maxCount: 5,  colors: [0xccaa00] },
  taxi:         { w: 4.5,  h: 1.4, d: 1.8, maxCount: 10, colors: [0xffcc00] },
  emergency:    { w: 5.5,  h: 1.8, d: 2.0, maxCount: 5,  colors: [0xcc0000] },
  construction: { w: 6.0,  h: 2.2, d: 2.5, maxCount: 5,  colors: [0xff8800] },
};

// ── Module state ────────────────────────────────────────────────────

let sceneRef = null;
let graphRef = null;
let accumulator = 0;
let spawnTimer = 0;
let nextVehicleId = 0;

const activeVehicles = [];                     // live vehicle state objects
const meshes = new Map();                      // type -> InstancedMesh
const freeSlots = new Map();                   // type -> [free instance indices]
const dummy = new THREE.Object3D();

// Intersection signal states, keyed by node id
const intersectionSignals = new Map();         // nodeId -> signal state

// Boundary edges (edges touching city border) for spawning
let boundaryEdges = [];

// Edge length cache
const edgeLengthCache = new Map();

// ── Edge helpers ────────────────────────────────────────────────────

function getEdgeLength(graph, edge) {
  let cached = edgeLengthCache.get(edge.id);
  if (cached !== undefined) return cached;

  const nFrom = getNode(graph, edge.from);
  const nTo = getNode(graph, edge.to);
  if (!nFrom || !nTo) { edgeLengthCache.set(edge.id, 0); return 0; }

  const dx = nTo.x - nFrom.x;
  const dz = nTo.z - nFrom.z;
  cached = Math.sqrt(dx * dx + dz * dz);
  edgeLengthCache.set(edge.id, cached);
  return cached;
}

function getPositionOnEdge(graph, edge, t) {
  const nFrom = getNode(graph, edge.from);
  const nTo = getNode(graph, edge.to);
  if (!nFrom || !nTo) return { x: 0, y: 0, z: 0 };

  const x = lerp(nFrom.x, nTo.x, t);
  const z = lerp(nFrom.z, nTo.z, t);

  // Y from edge elevation or node y
  let y;
  if (edge.elevation) {
    y = lerp(edge.elevation[0], edge.elevation[1], t);
  } else {
    y = lerp(nFrom.y ?? 0, nTo.y ?? 0, t);
  }

  return { x, y: y + VEHICLE_Y_OFFSET, z };
}

function getEdgeHeading(graph, edge) {
  const nFrom = getNode(graph, edge.from);
  const nTo = getNode(graph, edge.to);
  if (!nFrom || !nTo) return 0;
  return Math.atan2(nTo.x - nFrom.x, nTo.z - nFrom.z);
}

/**
 * Determines the approach direction for a vehicle entering an intersection.
 * Uses the edge direction to classify as 'ns' (roughly north-south) or 'ew' (east-west).
 */
function getApproachDirection(graph, edge) {
  const nFrom = getNode(graph, edge.from);
  const nTo = getNode(graph, edge.to);
  if (!nFrom || !nTo) return 'ns';

  const dx = Math.abs(nTo.x - nFrom.x);
  const dz = Math.abs(nTo.z - nFrom.z);
  // If the edge runs more along Z (north-south), classify as 'ns'
  return dz >= dx ? 'ns' : 'ew';
}

// ── Intersection signal management ──────────────────────────────────

function ensureIntersectionSignal(graph, nodeId) {
  if (intersectionSignals.has(nodeId)) return intersectionSignals.get(nodeId);

  const node = getNode(graph, nodeId);
  if (!node) return null;

  const edges = getEdgesFromNode(graph, nodeId);
  if (edges.length < 2) return null; // dead-end, no signal needed

  // Find the two highest-hierarchy road types meeting here
  const types = edges.map(e => e.type || 'local');
  const unique = [...new Set(types)];
  const type1 = unique[0] || 'local';
  const type2 = unique[1] || unique[0] || 'local';

  const signalType = assignSignalTypes(type1, type2);

  // Only create traffic signals for signalized intersections
  if (signalType !== 'signal_full' && signalType !== 'signal_simple') {
    return null;
  }

  const district = getDistrictAt(node.x, node.z);
  const districtType = district ? district.type : 'residential';
  const signal = createSignalState(districtType);
  signal.nodeId = nodeId;
  signal.signalType = signalType;

  // Randomize initial phase so not all signals are synchronized
  const totalDuration = signal.phases.reduce((sum, p) => sum + p.duration, 0);
  signal.timer = srand() * signal.phases[0].duration;
  let elapsed = srand() * totalDuration;
  while (elapsed > 0) {
    const phaseDur = signal.phases[signal.currentPhase].duration;
    if (elapsed < phaseDur) {
      signal.timer = elapsed;
      break;
    }
    elapsed -= phaseDur;
    signal.currentPhase = (signal.currentPhase + 1) % signal.phases.length;
  }

  intersectionSignals.set(nodeId, signal);
  return signal;
}

// ── Boundary edge detection ─────────────────────────────────────────

function findBoundaryEdges(graph) {
  const result = [];
  const margin = 50; // within 50m of city border

  for (const edge of graph.edges.values()) {
    const nFrom = getNode(graph, edge.from);
    const nTo = getNode(graph, edge.to);
    if (!nFrom || !nTo) continue;

    const isBorderFrom = nFrom.x <= CITY_BOUNDS.minX + margin ||
                          nFrom.x >= CITY_BOUNDS.maxX - margin ||
                          nFrom.z <= CITY_BOUNDS.minZ + margin ||
                          nFrom.z >= CITY_BOUNDS.maxZ - margin;
    const isBorderTo = nTo.x <= CITY_BOUNDS.minX + margin ||
                        nTo.x >= CITY_BOUNDS.maxX - margin ||
                        nTo.z <= CITY_BOUNDS.minZ + margin ||
                        nTo.z >= CITY_BOUNDS.maxZ - margin;

    if (isBorderFrom || isBorderTo) {
      result.push(edge);
    }
  }

  return result;
}

// ── Path helpers ────────────────────────────────────────────────────

/**
 * Converts a node-ID path from findPath() into an array of edge IDs.
 * For each consecutive pair of nodes, finds the connecting edge.
 */
function nodePathToEdges(graph, nodePath) {
  if (!nodePath || nodePath.length < 2) return [];

  const edgeIds = [];
  for (let i = 0; i < nodePath.length - 1; i++) {
    const fromId = nodePath[i];
    const toId = nodePath[i + 1];

    // Find edge connecting these two nodes
    const edges = getEdgesFromNode(graph, fromId);
    let found = null;
    for (const e of edges) {
      if ((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)) {
        found = e.id;
        break;
      }
    }
    if (found) edgeIds.push(found);
  }

  return edgeIds;
}

/**
 * Returns the direction a vehicle travels along an edge (which node is "from" and which is "to")
 * given the previous node in the path. Returns { startNodeId, endNodeId }.
 */
function getEdgeTraversalDirection(graph, edgeId, prevNodeId) {
  const edge = getEdge(graph, edgeId);
  if (!edge) return null;

  // If the edge's 'from' matches prevNodeId, we traverse from→to
  if (edge.from === prevNodeId) {
    return { startNodeId: edge.from, endNodeId: edge.to };
  }
  // Otherwise we go to→from
  return { startNodeId: edge.to, endNodeId: edge.from };
}

// ── Vehicle type selection ──────────────────────────────────────────

/**
 * Select a vehicle type weighted by district preference.
 */
function selectVehicleType(districtType) {
  const candidates = [];
  const weights = [];

  for (const [type, info] of Object.entries(VEHICLE_TYPES)) {
    const prefs = info.districtPrefs;
    let weight = 0.1; // base weight for any type
    if (prefs.includes(districtType)) {
      weight = 1.0;
    }
    candidates.push(type);
    weights.push(weight);
  }

  // Weighted random selection
  const total = weights.reduce((a, b) => a + b, 0);
  let r = srand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ── InstancedMesh management ────────────────────────────────────────

function createMeshes(scene) {
  for (const [type, def] of Object.entries(MESH_DEFS)) {
    const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
    const mat = new THREE.MeshLambertMaterial({ color: def.colors[0] });
    const mesh = new THREE.InstancedMesh(geo, mat, def.maxCount);

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    // Set per-instance colors if multiple color options
    if (def.colors.length > 1) {
      const color = new THREE.Color();
      for (let i = 0; i < def.maxCount; i++) {
        color.set(def.colors[i % def.colors.length]);
        mesh.setColorAt(i, color);
      }
      mesh.instanceColor.needsUpdate = true;
    }

    // Hide all instances initially (scale to zero)
    const hideMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < def.maxCount; i++) {
      mesh.setMatrixAt(i, hideMat);
    }
    mesh.instanceMatrix.needsUpdate = true;

    mesh.count = def.maxCount;
    scene.add(mesh);
    meshes.set(type, mesh);

    // Initialize free slot stack
    const slots = [];
    for (let i = def.maxCount - 1; i >= 0; i--) {
      slots.push(i);
    }
    freeSlots.set(type, slots);
  }
}

function allocateSlot(type) {
  const slots = freeSlots.get(type);
  if (!slots || slots.length === 0) return -1;
  return slots.pop();
}

function releaseSlot(type, index) {
  const slots = freeSlots.get(type);
  if (slots) slots.push(index);

  // Hide the instance
  const mesh = meshes.get(type);
  if (mesh) {
    const hideMat = new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(index, hideMat);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Vehicle spawning ────────────────────────────────────────────────

function spawnVehicle(graph, timeOfDay) {
  if (activeVehicles.length >= MAX_ACTIVE_VEHICLES) return null;
  if (boundaryEdges.length === 0) return null;

  // Pick a random boundary edge
  const spawnEdge = pick(boundaryEdges);
  if (!spawnEdge) return null;

  const nFrom = getNode(graph, spawnEdge.from);
  if (!nFrom) return null;

  // Determine district for spawn location
  const district = getDistrictAt(nFrom.x, nFrom.z);
  const districtType = district ? district.type : 'residential';

  // Check activity multiplier — lower activity = lower spawn chance
  const activity = getActivityMultiplier(districtType, timeOfDay);
  if (srand() > activity.trafficMultiplier) return null;

  // Select vehicle type
  const type = selectVehicleType(districtType);

  // Allocate InstancedMesh slot
  const slot = allocateSlot(type);
  if (slot < 0) return null;

  // Pick a random destination edge (different from spawn)
  const destEdge = pickDestinationEdge(graph, spawnEdge);
  if (!destEdge) {
    releaseSlot(type, slot);
    return null;
  }

  // Compute A* path (node IDs)
  const startNodeId = spawnEdge.from;
  const endNodeId = destEdge.to || destEdge.from;
  const nodePath = findPath(graph, startNodeId, endNodeId);
  if (!nodePath || nodePath.length < 2) {
    releaseSlot(type, slot);
    return null;
  }

  // Convert to edge IDs
  const pathEdges = nodePathToEdges(graph, nodePath);
  if (pathEdges.length === 0) {
    releaseSlot(type, slot);
    return null;
  }

  // Vehicle type config
  const vtConfig = VEHICLE_TYPES[type];
  const targetSpeed = randRange(vtConfig.speed.min, vtConfig.speed.max);

  // Initial position on first edge
  const firstEdge = getEdge(graph, pathEdges[0]);
  const pos = getPositionOnEdge(graph, firstEdge, 0);

  const vehicle = {
    id: nextVehicleId++,
    type,
    edgeId: pathEdges[0],
    t: 0,
    lane: 0,
    speed: targetSpeed * 0.5,     // start at half speed
    targetSpeed,
    pathEdges,
    pathIndex: 0,
    pathNodeIds: nodePath,         // keep node path for direction tracking
    x: pos.x,
    y: pos.y,
    z: pos.z,
    prevX: pos.x,
    prevY: pos.y,
    prevZ: pos.z,
    heading: getEdgeHeading(graph, firstEdge),
    state: 'moving',
    instanceIndex: slot,
    meshType: type,
    stuckTime: 0,
    spawnTime: 0,
  };

  activeVehicles.push(vehicle);
  return vehicle;
}

function pickDestinationEdge(graph, avoidEdge) {
  // Pick a boundary edge that isn't the spawn edge
  if (boundaryEdges.length <= 1) return null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const edge = pick(boundaryEdges);
    if (edge.id !== avoidEdge.id) return edge;
  }
  return null;
}

// ── Vehicle despawning ──────────────────────────────────────────────

function despawnVehicle(index) {
  const v = activeVehicles[index];
  releaseSlot(v.meshType, v.instanceIndex);
  // Swap-remove for O(1) deletion
  activeVehicles[index] = activeVehicles[activeVehicles.length - 1];
  activeVehicles.pop();
}

function checkDespawn(v, index) {
  // Left city boundary
  if (v.x < CITY_BOUNDS.minX - 100 || v.x > CITY_BOUNDS.maxX + 100 ||
      v.z < CITY_BOUNDS.minZ - 100 || v.z > CITY_BOUNDS.maxZ + 100) {
    return true;
  }

  // Reached end of path with no continuation
  if (v.pathIndex >= v.pathEdges.length) {
    return true;
  }

  // Stuck timeout
  if (v.stuckTime > STUCK_TIMEOUT) {
    return true;
  }

  return false;
}

// ── Physics tick ────────────────────────────────────────────────────

function tickPhysics(dt, timeOfDay) {
  const graph = graphRef;
  if (!graph) return;

  // Update intersection signals
  updateSignals([...intersectionSignals.values()], dt);

  // Process each vehicle
  for (let i = activeVehicles.length - 1; i >= 0; i--) {
    const v = activeVehicles[i];

    // Check despawn
    if (checkDespawn(v, i)) {
      despawnVehicle(i);
      continue;
    }

    const edge = getEdge(graph, v.edgeId);
    if (!edge) {
      despawnVehicle(i);
      continue;
    }

    const edgeLen = getEdgeLength(graph, edge);
    if (edgeLen <= 0) {
      despawnVehicle(i);
      continue;
    }

    // Determine current traversal direction
    const currentNodeIndex = v.pathIndex;
    const prevNodeId = v.pathNodeIds[currentNodeIndex];

    // ── Signal check ──────────────────────────────────────────
    let signalStop = false;
    if (v.t > SIGNAL_APPROACH_T) {
      // Find the node at the end of this edge in our traversal direction
      const dir = getEdgeTraversalDirection(graph, v.edgeId, prevNodeId);
      if (dir) {
        const endNodeId = dir.endNodeId;
        const signal = ensureIntersectionSignal(graph, endNodeId);
        if (signal) {
          const approach = getApproachDirection(graph, edge);
          if (!isGreenForDirection(signal, approach)) {
            signalStop = true;
          }
        }
      }
    }

    // ── Following distance ────────────────────────────────────
    let followingDecel = false;
    const lookAheadDist = v.speed * FOLLOWING_GAP;

    for (let j = 0; j < activeVehicles.length; j++) {
      if (i === j) continue;
      const other = activeVehicles[j];
      if (other.edgeId !== v.edgeId) continue;

      // Same direction check: other is ahead on same edge
      const otherDir = getEdgeTraversalDirection(graph, other.edgeId, other.pathNodeIds[other.pathIndex]);
      const myDir = getEdgeTraversalDirection(graph, v.edgeId, prevNodeId);
      if (!otherDir || !myDir) continue;
      if (otherDir.startNodeId !== myDir.startNodeId) continue; // different direction

      const dist = (other.t - v.t) * edgeLen;
      if (dist > 0 && dist < lookAheadDist) {
        followingDecel = true;
        // Match the other vehicle's speed or slow down
        v.targetSpeed = Math.min(v.targetSpeed, other.speed * 0.9);
        break;
      }
    }

    // ── Speed control ─────────────────────────────────────────
    const edgeSpeedLimit = (edge.speedLimit || 30) / 3.6; // km/h to m/s
    const vtConfig = VEHICLE_TYPES[v.type];
    const baseTargetSpeed = Math.min(
      randRange(vtConfig.speed.min, vtConfig.speed.max),
      edgeSpeedLimit
    );

    if (!followingDecel) {
      v.targetSpeed = baseTargetSpeed;
    }

    if (signalStop) {
      // Decelerate to stop before intersection
      const distToEnd = (1.0 - v.t) * edgeLen;
      const stopDist = Math.max(distToEnd - 2, 0); // stop 2m before end
      if (stopDist < 5) {
        v.speed = Math.max(0, v.speed - DECEL_RATE * dt);
        v.state = 'stopped';
      } else {
        // Gradual slowdown
        const desiredSpeed = Math.min(v.targetSpeed, Math.sqrt(2 * DECEL_RATE * stopDist));
        if (v.speed > desiredSpeed) {
          v.speed = Math.max(desiredSpeed, v.speed - DECEL_RATE * dt);
        }
        v.state = 'yielding';
      }
    } else if (followingDecel) {
      if (v.speed > v.targetSpeed) {
        v.speed = Math.max(v.targetSpeed, v.speed - DECEL_RATE * dt);
      } else {
        v.speed = Math.min(v.targetSpeed, v.speed + vtConfig.acceleration * dt);
      }
      v.state = 'yielding';
    } else {
      // Normal acceleration toward target speed
      if (v.speed < v.targetSpeed) {
        v.speed = Math.min(v.targetSpeed, v.speed + vtConfig.acceleration * dt);
      } else if (v.speed > v.targetSpeed) {
        v.speed = Math.max(v.targetSpeed, v.speed - DECEL_RATE * 0.5 * dt);
      }
      v.state = 'moving';
    }

    // ── Stuck detection ───────────────────────────────────────
    if (v.speed < 0.1) {
      v.stuckTime += dt;
    } else {
      v.stuckTime = 0;
    }

    // ── Advance along edge ────────────────────────────────────
    v.t += (v.speed * dt) / edgeLen;

    // ── Edge transition ───────────────────────────────────────
    if (v.t >= 1.0) {
      v.t = 0;
      v.pathIndex++;

      if (v.pathIndex < v.pathEdges.length) {
        // Move to next edge in precomputed path
        v.edgeId = v.pathEdges[v.pathIndex];
      } else {
        // End of path — pick random connected edge at the intersection
        const dir = getEdgeTraversalDirection(graph, v.edgeId, prevNodeId);
        if (dir) {
          const nodeId = dir.endNodeId;
          const connectedEdges = getEdgesFromNode(graph, nodeId);
          // Filter out the edge we just came from
          const candidates = connectedEdges.filter(e => e.id !== v.edgeId);

          if (candidates.length > 0) {
            const nextEdge = pick(candidates);
            v.edgeId = nextEdge.id;
            v.pathEdges.push(nextEdge.id);
            // Update node path tracking
            const nextEndNode = nextEdge.from === nodeId ? nextEdge.to : nextEdge.from;
            v.pathNodeIds.push(nextEndNode);
          }
          // If no candidates, checkDespawn will catch it next tick
        }
      }
    }

    // ── Update position ───────────────────────────────────────
    const currentEdge = getEdge(graph, v.edgeId);
    if (currentEdge) {
      const pos = getPositionOnEdge(graph, currentEdge, Math.min(v.t, 1.0));
      v.x = pos.x;
      v.y = pos.y;
      v.z = pos.z;

      // Heading from edge direction with traversal direction awareness
      const currentPrevNode = v.pathNodeIds[v.pathIndex];
      const dir = getEdgeTraversalDirection(graph, v.edgeId, currentPrevNode);
      if (dir) {
        const nStart = getNode(graph, dir.startNodeId);
        const nEnd = getNode(graph, dir.endNodeId);
        if (nStart && nEnd) {
          v.heading = Math.atan2(nEnd.x - nStart.x, nEnd.z - nStart.z);
        }
      }

      // Lane offset (perpendicular to heading)
      if (v.lane > 0 && edge.lanes && edge.lanes > 1) {
        const laneWidth = (edge.width || 8) / edge.lanes;
        const offset = v.lane * laneWidth;
        v.x += Math.cos(v.heading) * offset;
        v.z -= Math.sin(v.heading) * offset;
      }
    }
  }

  // ── Spawning ────────────────────────────────────────────────
  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer -= SPAWN_INTERVAL;

    // Try to spawn a few vehicles per check
    const spawnAttempts = Math.min(3, MAX_ACTIVE_VEHICLES - activeVehicles.length);
    for (let i = 0; i < spawnAttempts; i++) {
      spawnVehicle(graph, timeOfDay);
    }
  }
}

// ── Visual update (interpolation) ───────────────────────────────────

function updateVisuals(alpha) {
  // Track which meshes need matrix updates
  const dirtyMeshes = new Set();

  for (const v of activeVehicles) {
    const mesh = meshes.get(v.meshType);
    if (!mesh) continue;

    // Interpolate position
    const renderX = lerp(v.prevX, v.x, alpha);
    const renderY = lerp(v.prevY, v.y, alpha);
    const renderZ = lerp(v.prevZ, v.z, alpha);

    // Set transform
    dummy.position.set(renderX, renderY, renderZ);
    dummy.rotation.set(0, v.heading, 0);

    // Scale based on vehicle type dimensions for correct bounding
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();

    mesh.setMatrixAt(v.instanceIndex, dummy.matrix);
    dirtyMeshes.add(v.meshType);
  }

  // Mark dirty meshes for GPU upload
  for (const type of dirtyMeshes) {
    const mesh = meshes.get(type);
    if (mesh) mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Creates InstancedMesh per vehicle type, spawns initial vehicles.
 * @param {THREE.Scene} scene
 * @param {object} graph — road graph from roadGraph.js (optional, falls back to getCityGraph())
 */
export function initTraffic(scene, graph) {
  sceneRef = scene;
  graphRef = graph || getCityGraph();

  if (!graphRef) {
    console.warn('[cityTrafficUnified] No road graph available — traffic disabled.');
    return;
  }

  // Reset state
  accumulator = 0;
  spawnTimer = 0;
  nextVehicleId = 0;
  activeVehicles.length = 0;
  intersectionSignals.clear();
  edgeLengthCache.clear();
  _seed = 77321;

  // Create instanced meshes
  createMeshes(scene);

  // Find boundary edges for spawning
  boundaryEdges = findBoundaryEdges(graphRef);

  // If no boundary edges found, use all edges (fallback)
  if (boundaryEdges.length === 0) {
    boundaryEdges = [...graphRef.edges.values()];
  }

  // Pre-create intersection signals for key intersections
  for (const node of graphRef.nodes.values()) {
    const edges = getEdgesFromNode(graphRef, node.id);
    if (edges.length >= 3) {
      ensureIntersectionSignal(graphRef, node.id);
    }
  }

  // Spawn initial batch of vehicles
  const initialCount = Math.min(30, MAX_ACTIVE_VEHICLES);
  for (let i = 0; i < initialCount * 3; i++) {
    // Attempt more spawns than needed since some will fail
    if (activeVehicles.length >= initialCount) break;
    spawnVehicle(graphRef, 12); // noon default for initial spawn
  }
}

/**
 * Fixed 30Hz tick with 60fps interpolation.
 * @param {number} dt — frame delta time in seconds
 * @param {number} timeOfDay — hours in [0, 24)
 */
export function updateTraffic(dt, timeOfDay) {
  if (!graphRef || (activeVehicles.length === 0 && boundaryEdges.length === 0)) return;

  accumulator += Math.min(dt, 0.1); // cap to prevent spiral of death

  while (accumulator >= TICK_RATE) {
    // Store previous positions for interpolation
    for (const v of activeVehicles) {
      v.prevX = v.x;
      v.prevY = v.y;
      v.prevZ = v.z;
    }
    tickPhysics(TICK_RATE, timeOfDay);
    accumulator -= TICK_RATE;
  }

  const alpha = accumulator / TICK_RATE;
  updateVisuals(alpha);
}

/**
 * Cleanup — remove meshes, clear state.
 */
export function disposeTraffic() {
  // Remove meshes from scene and dispose geometry/material
  for (const [type, mesh] of meshes) {
    if (sceneRef) sceneRef.remove(mesh);
    mesh.geometry.dispose();
    if (mesh.material.dispose) mesh.material.dispose();
  }
  meshes.clear();
  freeSlots.clear();

  activeVehicles.length = 0;
  intersectionSignals.clear();
  edgeLengthCache.clear();
  boundaryEdges = [];

  sceneRef = null;
  graphRef = null;
  accumulator = 0;
  spawnTimer = 0;
}

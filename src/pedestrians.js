// ── Pedestrians — Billboard sprite pedestrian system ────────────────
// Pool-based InstancedMesh with procedural sprite atlas.
// Pedestrians walk along sidewalk edges, wait at signals, animate.

import * as THREE from 'three';
import { getEdge, getNode, getEdgesFromNode, getCityGraph } from './roadGraph.js';
import { getSignalPhase } from './intersections.js';
import { getActivityMultiplier, getDistrictAt, MAX_PEDESTRIANS } from './cityData.js';

// ── Constants ────────────────────────────────────────────────────────

const TICK_INTERVAL = 1 / 15;          // 15 Hz movement tick
const WALK_SPEED_MIN = 1.2;            // m/s
const WALK_SPEED_MAX = 1.5;
const ANIM_RATE = 3;                   // frame swaps per second
const FADE_NEAR = 150;                 // start fading at this distance
const FADE_FAR = 200;                  // fully invisible beyond this
const DESPAWN_BLOCKS_MIN = 2;
const DESPAWN_BLOCKS_MAX = 5;
const SIT_CHANCE = 0.05;               // 5% of spawns start sitting
const JAYWALK_CHANCE = 0.05;           // 5% chance to jaywalk at unsignaled intersections
const SIDEWALK_OFFSET = 0.8;           // offset from road centre-line to sidewalk (m)
const SPAWN_INTERVAL = 0.25;           // seconds between spawn attempts

// ── Seeded PRNG ──────────────────────────────────────────────────────

let _seed = 314159;
function sr() {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed & 0x7fffffff) / 0x7fffffff;
}
function ri(lo, hi) { return Math.floor(lo + sr() * (hi - lo + 1)); }
function rf(lo, hi) { return lo + sr() * (hi - lo); }

// ── Module state ─────────────────────────────────────────────────────

let _scene = null;
let _graph = null;
let _mesh = null;
let _material = null;
let _atlas = null;
let _uvOffsetAttr = null;

const _pool = [];              // array of pedestrian state objects
let _sidewalkEdgeIds = [];     // cached array of edges with sidewalks: true
let _tickAccum = 0;
let _spawnAccum = 0;

const _dummy = new THREE.Object3D();
const _tmpVec = new THREE.Vector3();

// ── Sprite Atlas Generation ──────────────────────────────────────────

const PALETTES = [
  { body: '#2c3e50', legs: '#1a252f', head: '#deb887' }, // dark suit
  { body: '#c0392b', legs: '#2c3e50', head: '#d2b48c' }, // red jacket
  { body: '#2980b9', legs: '#34495e', head: '#deb887' }, // blue shirt
  { body: '#27ae60', legs: '#2c3e50', head: '#d2b48c' }, // green coat
];

function drawSprite(ctx, ox, oy, size, pal, pose) {
  const cx = ox + size / 2;
  const headY = oy + size * 0.15;
  const bodyTop = oy + size * 0.3;
  const bodyBot = oy + size * 0.6;
  const legBot = oy + size * 0.9;

  // Head (circle)
  ctx.fillStyle = pal.head;
  ctx.beginPath();
  ctx.arc(cx, headY + 4, size * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Body (rectangle)
  ctx.fillStyle = pal.body;
  const bodyW = size * 0.2;
  ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyBot - bodyTop);

  // Legs
  ctx.fillStyle = pal.legs;
  const legW = size * 0.08;
  if (pose === 0) { // standing
    ctx.fillRect(cx - legW - 1, bodyBot, legW, legBot - bodyBot);
    ctx.fillRect(cx + 1, bodyBot, legW, legBot - bodyBot);
  } else if (pose === 1) { // walk frame 1
    ctx.fillRect(cx - legW - 3, bodyBot, legW, legBot - bodyBot);
    ctx.fillRect(cx + 3, bodyBot, legW, legBot - bodyBot);
  } else if (pose === 2) { // walk frame 2
    ctx.fillRect(cx + 1, bodyBot, legW, legBot - bodyBot);
    ctx.fillRect(cx - legW, bodyBot, legW, legBot - bodyBot);
  } else { // sitting
    ctx.fillRect(cx - bodyW / 2, bodyBot, bodyW, size * 0.1);
  }
}

function generatePedestrianAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const CELL = 64; // 4x4 grid of 64px sprites

  // 4 rows (palettes) x 4 cols (standing, walk1, walk2, sitting)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      drawSprite(ctx, col * CELL, row * CELL, CELL, PALETTES[row], col);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; // crisp pixels at close range
  return tex;
}

// ── Shader Material ──────────────────────────────────────────────────

function createPedestrianMaterial(atlas) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: atlas },
    },
    vertexShader: /* glsl */ `
      attribute vec2 uvOffset;
      varying vec2 vUv;
      void main() {
        vUv = uv * 0.25 + uvOffset; // 0.25 = 1/4 grid cells
        // Billboard: remove rotation from modelView matrix
        vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mvPosition.xy += position.xy * vec2(
          length(modelMatrix[0].xyz),
          length(modelMatrix[1].xyz)
        );
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(map, vUv);
        if (texel.a < 0.1) discard;
        gl_FragColor = texel;
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ── Edge Helpers ─────────────────────────────────────────────────────

/** Compute world position at parametric t along an edge, offset to sidewalk. */
function positionOnEdge(edge, t, outVec) {
  const nFrom = getNode(_graph, edge.from);
  const nTo = getNode(_graph, edge.to);
  if (!nFrom || !nTo) return false;

  const fx = nFrom.x, fz = nFrom.z, fy = nFrom.y ?? 0;
  const tx = nTo.x,   tz = nTo.z,   ty = nTo.y ?? 0;

  const dx = tx - fx;
  const dz = tz - fz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) return false;

  // Normalised perpendicular (to the right of from→to)
  const nx = -dz / len;
  const nz = dx / len;

  outVec.x = fx + dx * t + nx * SIDEWALK_OFFSET;
  outVec.y = (fy + (ty - fy) * t) + 0.9; // half pedestrian height above ground
  outVec.z = fz + dz * t + nz * SIDEWALK_OFFSET;
  return true;
}

/** Returns the length (metres) of an edge. */
function edgeLength(edge) {
  const nFrom = getNode(_graph, edge.from);
  const nTo = getNode(_graph, edge.to);
  if (!nFrom || !nTo) return 0;
  const dx = nTo.x - nFrom.x;
  const dz = nTo.z - nFrom.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Returns the node id at the 'end' of the edge (direction-dependent). */
function endNodeId(edge, direction) {
  return direction > 0 ? edge.to : edge.from;
}

// ── Pedestrian Pool ──────────────────────────────────────────────────

function createPedestrianSlot(index) {
  return {
    id: index,
    active: false,
    edgeId: null,
    t: 0,
    direction: 1,         // +1 from→to, -1 to→from
    speed: WALK_SPEED_MIN,
    x: 0, y: 0, z: 0,
    palette: 0,
    animFrame: 0,         // 0=stand, 1=walk1, 2=walk2, 3=sitting
    animTimer: 0,
    state: 'walking',     // 'walking' | 'waiting' | 'sitting'
    blocksWalked: 0,
    maxBlocks: DESPAWN_BLOCKS_MIN,
    instanceIndex: index,
  };
}

function deactivatePedestrian(ped) {
  ped.active = false;
  ped.state = 'walking';
  ped.blocksWalked = 0;
  // Hide by scaling to zero
  _dummy.position.set(0, -1000, 0);
  _dummy.scale.set(0, 0, 0);
  _dummy.updateMatrix();
  _mesh.setMatrixAt(ped.instanceIndex, _dummy.matrix);
}

function pickRandomSidewalkEdge() {
  if (_sidewalkEdgeIds.length === 0) return null;
  const idx = ri(0, _sidewalkEdgeIds.length - 1);
  return _sidewalkEdgeIds[idx];
}

/** Attempt to spawn a pedestrian into an inactive pool slot. */
function spawnPedestrian(timeOfDay) {
  // Find an inactive slot
  let slot = null;
  for (let i = 0; i < _pool.length; i++) {
    if (!_pool[i].active) { slot = _pool[i]; break; }
  }
  if (!slot) return null;

  const edgeId = pickRandomSidewalkEdge();
  if (!edgeId) return null;

  const edge = getEdge(_graph, edgeId);
  if (!edge) return null;

  // Check district density — limit spawning based on pedestrian activity
  const nFrom = getNode(_graph, edge.from);
  if (!nFrom) return null;

  const district = getDistrictAt(nFrom.x, nFrom.z);
  if (!district) return null;

  const activity = getActivityMultiplier(district.type, timeOfDay);
  // Only spawn if random roll beats the density threshold
  if (sr() > activity.pedestrianDensity) return null;

  const len = edgeLength(edge);
  if (len < 2) return null;

  slot.active = true;
  slot.edgeId = edgeId;
  slot.t = 0.1 + sr() * 0.8;
  slot.direction = sr() < 0.5 ? 1 : -1;
  slot.speed = rf(WALK_SPEED_MIN, WALK_SPEED_MAX);
  slot.palette = ri(0, 3);
  slot.animFrame = 0;
  slot.animTimer = 0;
  slot.blocksWalked = 0;
  slot.maxBlocks = ri(DESPAWN_BLOCKS_MIN, DESPAWN_BLOCKS_MAX);

  // Decide if this pedestrian is sitting (5% chance)
  if (sr() < SIT_CHANCE) {
    slot.state = 'sitting';
    slot.animFrame = 3;
  } else {
    slot.state = 'walking';
  }

  // Compute initial position
  positionOnEdge(edge, slot.t, _tmpVec);
  slot.x = _tmpVec.x;
  slot.y = _tmpVec.y;
  slot.z = _tmpVec.z;

  // Set UV offset for the initial sprite frame
  updateUVOffset(slot);

  return slot;
}

// ── UV / Instance Updates ────────────────────────────────────────────

function updateUVOffset(ped) {
  const col = ped.animFrame; // 0-3
  const row = ped.palette;   // 0-3
  const u = col * 0.25;
  const v = row * 0.25;
  _uvOffsetAttr.setXY(ped.instanceIndex, u, v);
}

function syncInstance(ped, scale) {
  _dummy.position.set(ped.x, ped.y, ped.z);
  _dummy.scale.set(scale, scale, scale);
  _dummy.rotation.set(0, 0, 0); // billboard shader handles facing
  _dummy.updateMatrix();
  _mesh.setMatrixAt(ped.instanceIndex, _dummy.matrix);
}

// ── Movement Logic ───────────────────────────────────────────────────

function tickPedestrian(ped, dt) {
  if (!ped.active) return;

  // Sitting pedestrians don't move
  if (ped.state === 'sitting') return;

  const edge = getEdge(_graph, ped.edgeId);
  if (!edge) { deactivatePedestrian(ped); return; }

  const len = edgeLength(edge);
  if (len < 0.01) { deactivatePedestrian(ped); return; }

  // Walk animation timer
  ped.animTimer += dt;
  if (ped.state === 'walking') {
    if (ped.animTimer >= 1 / ANIM_RATE) {
      ped.animTimer -= 1 / ANIM_RATE;
      // Alternate between frames 1 and 2
      ped.animFrame = ped.animFrame === 1 ? 2 : 1;
      updateUVOffset(ped);
    }
  }

  if (ped.state === 'waiting') {
    // Check if walk phase is active — try to resume
    const nodeId = endNodeId(edge, ped.direction);
    const node = getNode(_graph, nodeId);
    if (node && node.signal) {
      const phase = getSignalPhase(node.signal);
      if (phase && phase.walk) {
        ped.state = 'walking';
      }
    } else {
      // No signal data — resume after brief wait
      ped.animTimer += dt;
      if (ped.animTimer > 2.0) {
        ped.state = 'walking';
        ped.animTimer = 0;
      }
    }
    // Standing pose while waiting
    if (ped.state === 'waiting') {
      ped.animFrame = 0;
      updateUVOffset(ped);
    }
    return;
  }

  // Advance parametric position
  const step = (ped.speed * dt) / len;
  ped.t += step * ped.direction;

  // Reached end of edge?
  if (ped.t >= 1.0 || ped.t <= 0.0) {
    ped.t = Math.max(0, Math.min(1, ped.t));
    ped.blocksWalked++;

    // Despawn check
    if (ped.blocksWalked >= ped.maxBlocks) {
      deactivatePedestrian(ped);
      return;
    }

    // Transition to next edge
    const nodeId = endNodeId(edge, ped.direction);
    const node = getNode(_graph, nodeId);
    if (!node) { deactivatePedestrian(ped); return; }

    // Check for signal at this intersection
    if (node.signal) {
      const phase = getSignalPhase(node.signal);
      if (phase && !phase.walk) {
        ped.state = 'waiting';
        ped.animFrame = 0;
        ped.animTimer = 0;
        updateUVOffset(ped);
        return;
      }
    }

    // Pick a random next sidewalk edge
    const nextEdge = pickNextSidewalkEdge(nodeId, ped.edgeId);
    if (!nextEdge) {
      // Dead end or no sidewalk edges — despawn
      deactivatePedestrian(ped);
      return;
    }

    ped.edgeId = nextEdge.id;
    // Determine direction on the new edge
    if (nextEdge.from === nodeId) {
      ped.direction = 1;
      ped.t = 0.01;
    } else {
      ped.direction = -1;
      ped.t = 0.99;
    }
  }

  // Update world position
  const curEdge = getEdge(_graph, ped.edgeId);
  if (curEdge) {
    positionOnEdge(curEdge, ped.t, _tmpVec);
    ped.x = _tmpVec.x;
    ped.y = _tmpVec.y;
    ped.z = _tmpVec.z;
  }
}

/** Pick a random sidewalk edge from the node, excluding the current one. */
function pickNextSidewalkEdge(nodeId, currentEdgeId) {
  const edges = getEdgesFromNode(_graph, nodeId);
  const candidates = [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.id === currentEdgeId) continue;
    if (!e.sidewalks) continue;
    candidates.push(e);
  }

  if (candidates.length === 0) {
    // Jaywalk chance: consider non-sidewalk edges
    if (sr() < JAYWALK_CHANCE) {
      for (let i = 0; i < edges.length; i++) {
        if (edges[i].id !== currentEdgeId) candidates.push(edges[i]);
      }
    }
    if (candidates.length === 0) return null;
  }

  return candidates[ri(0, candidates.length - 1)];
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Initialise the pedestrian system.
 * @param {THREE.Scene} scene
 * @param {object} graph — the city road graph
 */
export function initPedestrians(scene, graph) {
  _scene = scene;
  _graph = graph;

  // Cache sidewalk edge IDs
  _sidewalkEdgeIds = [];
  for (const [id, edge] of graph.edges) {
    if (edge.sidewalks) {
      _sidewalkEdgeIds.push(id);
    }
  }

  if (_sidewalkEdgeIds.length === 0) {
    console.warn('[pedestrians] No sidewalk edges found in graph');
    return;
  }

  // Generate sprite atlas
  _atlas = generatePedestrianAtlas();

  // Create material
  _material = createPedestrianMaterial(_atlas);

  // Create geometry — 1m wide, 1.8m tall billboard plane
  const geo = new THREE.PlaneGeometry(1.0, 1.8);

  // Create InstancedMesh
  _mesh = new THREE.InstancedMesh(geo, _material, MAX_PEDESTRIANS);
  _mesh.frustumCulled = false; // billboard matrix tricks confuse culling
  _mesh.name = 'pedestrians';

  // Per-instance UV offset attribute
  const uvData = new Float32Array(MAX_PEDESTRIANS * 2);
  _uvOffsetAttr = new THREE.InstancedBufferAttribute(uvData, 2);
  _mesh.geometry.setAttribute('uvOffset', _uvOffsetAttr);

  // Initialise pool — all deactivated
  _pool.length = 0;
  for (let i = 0; i < MAX_PEDESTRIANS; i++) {
    const ped = createPedestrianSlot(i);
    _pool.push(ped);
    deactivatePedestrian(ped);
  }

  _mesh.instanceMatrix.needsUpdate = true;
  _uvOffsetAttr.needsUpdate = true;

  scene.add(_mesh);
}

/**
 * Update pedestrian movement, animation, LOD fade.
 * @param {number} dt — frame delta in seconds
 * @param {number} timeOfDay — hours [0, 24)
 * @param {THREE.Vector3} cameraPos — current camera position
 */
export function updatePedestrians(dt, timeOfDay, cameraPos) {
  if (!_mesh || !_graph || !cameraPos) return;

  // ── Spawn accumulator ──────────────────────────────────────────────
  _spawnAccum += dt;
  if (_spawnAccum >= SPAWN_INTERVAL) {
    _spawnAccum -= SPAWN_INTERVAL;
    // Count active pedestrians
    let activeCount = 0;
    for (let i = 0; i < _pool.length; i++) {
      if (_pool[i].active) activeCount++;
    }

    // Determine target from overall pedestrian density
    // Sample a few districts and average for target calculation
    let avgDensity = 0;
    let samples = 0;
    for (let i = 0; i < _sidewalkEdgeIds.length && samples < 10; i += Math.max(1, Math.floor(_sidewalkEdgeIds.length / 10))) {
      const edge = getEdge(_graph, _sidewalkEdgeIds[i]);
      if (!edge) continue;
      const nFrom = getNode(_graph, edge.from);
      if (!nFrom) continue;
      const district = getDistrictAt(nFrom.x, nFrom.z);
      if (!district) continue;
      const act = getActivityMultiplier(district.type, timeOfDay);
      avgDensity += act.pedestrianDensity;
      samples++;
    }
    if (samples > 0) avgDensity /= samples;

    const target = Math.floor(MAX_PEDESTRIANS * Math.min(1, avgDensity));

    // Spawn if below target
    if (activeCount < target) {
      spawnPedestrian(timeOfDay);
    }

    // Despawn excess (if time-of-day density dropped)
    if (activeCount > target + 10) {
      for (let i = _pool.length - 1; i >= 0 && activeCount > target; i--) {
        if (_pool[i].active && _pool[i].state !== 'sitting') {
          deactivatePedestrian(_pool[i]);
          activeCount--;
        }
      }
    }
  }

  // ── 15 Hz movement tick ────────────────────────────────────────────
  _tickAccum += dt;
  const ticked = _tickAccum >= TICK_INTERVAL;
  if (ticked) {
    const tickDt = _tickAccum;
    _tickAccum = 0;

    for (let i = 0; i < _pool.length; i++) {
      if (_pool[i].active) {
        tickPedestrian(_pool[i], tickDt);
      }
    }
  }

  // ── Update instance transforms & LOD fade ──────────────────────────
  let matrixDirty = false;
  for (let i = 0; i < _pool.length; i++) {
    const ped = _pool[i];
    if (!ped.active) continue;

    // Distance fade
    const dx = ped.x - cameraPos.x;
    const dz = ped.z - cameraPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let scale;
    if (dist > FADE_FAR) {
      scale = 0;
    } else if (dist > FADE_NEAR) {
      scale = 1.0 - (dist - FADE_NEAR) / (FADE_FAR - FADE_NEAR);
    } else {
      scale = 1.0;
    }

    syncInstance(ped, scale);
    matrixDirty = true;
  }

  if (matrixDirty) {
    _mesh.instanceMatrix.needsUpdate = true;
    _uvOffsetAttr.needsUpdate = true;
  }
}

/**
 * Dispose of all pedestrian resources.
 */
export function disposePedestrians() {
  if (_mesh) {
    if (_scene) _scene.remove(_mesh);
    _mesh.geometry.dispose();
    _mesh = null;
  }
  if (_material) {
    _material.dispose();
    _material = null;
  }
  if (_atlas) {
    _atlas.dispose();
    _atlas = null;
  }

  _pool.length = 0;
  _sidewalkEdgeIds = [];
  _uvOffsetAttr = null;
  _scene = null;
  _graph = null;
  _tickAccum = 0;
  _spawnAccum = 0;
}

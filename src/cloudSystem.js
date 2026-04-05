// cloudSystem.js — Layered billboard cloud system with fog, shadows, and time-of-day tinting
// Three altitude layers (cumulus, alto, cirrus) using InstancedMesh for performance.

import * as THREE from 'three';
import { getCamera } from './camera.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPREAD = 40000;          // clouds spread across 40k x 40k area
const HALF_SPREAD = SPREAD / 2;
const WORLD_BOUND = 25000;     // wrap boundary
const MIN_CUMULUS_SPACING = 500;
const SHADOW_Y = 0.5;          // shadow plane just above ground
const FOG_FALLOFF = 200;       // meters of smooth falloff at cloud boundary
const SPATIAL_CELL = 2000;     // grid cell size for fog spatial lookup

const QUALITY_BASE = { low: 80, medium: 160, high: 240 };

const WEATHER_MULTIPLIER = {
  clear: 0.3,
  overcast: 0.8,
  rain: 1.0,
  storm: 1.0,
};

// Layer definitions: fraction of budget, altitude range, size ranges
const LAYERS = {
  cumulus: {
    fraction: 0.60,
    altMin: 1200, altMax: 1800,
    wMin: 300, wMax: 800,
    hMin: 200, hMax: 500,
  },
  alto: {
    fraction: 0.25,
    altMin: 2800, altMax: 3500,
    wMin: 600, wMax: 1500,
    hMin: 50, hMax: 150,
  },
  cirrus: {
    fraction: 0.15,
    altMin: 5500, altMax: 6500,
    wMin: 800, wMax: 2000,
    hMin: 20, hMax: 60,
  },
};

// Time-of-day tint colors
const TINT_NIGHT   = new THREE.Color(0x445566);
const TINT_DAWN    = new THREE.Color(0xffaa77);
const TINT_DAY     = new THREE.Color(0xffffff);
const TINT_STORM   = new THREE.Color(0x666666);

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let sceneRef = null;
let quality = 'high';
let currentWeather = 'clear';

// Per-layer instanced meshes
let layerMeshes = {};    // { cumulus, alto, cirrus } -> THREE.InstancedMesh
let shadowMesh = null;   // InstancedMesh for cumulus ground shadows

// Cloud data arrays (parallel to instance indices)
// Each entry: { x, z, y, w, h, layer }
let cloudData = [];
let cumulusCount = 0;    // how many of cloudData are cumulus (always first N)

// Spatial grid for fog lookup (cumulus only)
let fogGrid = {};        // key -> [indices into cloudData]

// Shared textures
let cloudTexture = null;
let shadowTexture = null;

// Shared materials
let cloudMaterial = null;
let shadowMaterial = null;

// Reusable objects to avoid per-frame allocation
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();
const _targetColor = new THREE.Color();

// The dummy matrix used to read/write instance transforms
const _dummy = new THREE.Object3D();

// ---------------------------------------------------------------------------
// Procedural texture generation
// ---------------------------------------------------------------------------

function createRadialGradientTexture(size, softness) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0, `rgba(255,255,255,${softness})`);
  grad.addColorStop(0.4, `rgba(255,255,255,${softness * 0.7})`);
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createShadowGradientTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0, 'rgba(0,0,0,0.12)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Spatial grid helpers (for fog queries)
// ---------------------------------------------------------------------------

function cellKey(cx, cz) {
  return `${cx},${cz}`;
}

function buildFogGrid() {
  fogGrid = {};
  for (let i = 0; i < cumulusCount; i++) {
    const c = cloudData[i];
    const cx = Math.floor(c.x / SPATIAL_CELL);
    const cz = Math.floor(c.z / SPATIAL_CELL);
    // Insert into this cell and all neighbors (3x3) so boundary queries work
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = cellKey(cx + dx, cz + dz);
        if (!fogGrid[key]) fogGrid[key] = [];
        fogGrid[key].push(i);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cloud placement with rejection sampling for cumulus spacing
// ---------------------------------------------------------------------------

function generateCloudPositions(totalCount) {
  cloudData = [];
  cumulusCount = 0;

  const layerNames = ['cumulus', 'alto', 'cirrus'];
  const counts = {};
  let assigned = 0;
  for (let i = 0; i < layerNames.length; i++) {
    const name = layerNames[i];
    if (i === layerNames.length - 1) {
      counts[name] = totalCount - assigned;
    } else {
      counts[name] = Math.floor(totalCount * LAYERS[name].fraction);
      assigned += counts[name];
    }
  }

  // Cumulus with rejection sampling for minimum spacing
  const cumulusPositions = [];
  const maxAttempts = counts.cumulus * 20;
  let attempts = 0;
  while (cumulusPositions.length < counts.cumulus && attempts < maxAttempts) {
    attempts++;
    const x = (Math.random() - 0.5) * SPREAD;
    const z = (Math.random() - 0.5) * SPREAD;
    let tooClose = false;
    for (let j = 0; j < cumulusPositions.length; j++) {
      const dx = cumulusPositions[j].x - x;
      const dz = cumulusPositions[j].z - z;
      if (dx * dx + dz * dz < MIN_CUMULUS_SPACING * MIN_CUMULUS_SPACING) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const cfg = LAYERS.cumulus;
    const w = cfg.wMin + Math.random() * (cfg.wMax - cfg.wMin);
    const h = cfg.hMin + Math.random() * (cfg.hMax - cfg.hMin);
    const y = cfg.altMin + Math.random() * (cfg.altMax - cfg.altMin);
    const entry = { x, z, y, w, h, layer: 'cumulus', fogRadius: Math.min(w, h) * 0.35 };
    cumulusPositions.push(entry);
    cloudData.push(entry);
  }
  cumulusCount = cloudData.length;

  // Alto and cirrus — no spacing constraint needed
  for (const name of ['alto', 'cirrus']) {
    const cfg = LAYERS[name];
    for (let i = 0; i < counts[name]; i++) {
      const x = (Math.random() - 0.5) * SPREAD;
      const z = (Math.random() - 0.5) * SPREAD;
      const w = cfg.wMin + Math.random() * (cfg.wMax - cfg.wMin);
      const h = cfg.hMin + Math.random() * (cfg.hMax - cfg.hMin);
      const y = cfg.altMin + Math.random() * (cfg.altMax - cfg.altMin);
      cloudData.push({ x, z, y, w, h, layer: name, fogRadius: 0 });
    }
  }

  buildFogGrid();
}

// ---------------------------------------------------------------------------
// Visible count from weather
// ---------------------------------------------------------------------------

function getVisibleCount() {
  const base = QUALITY_BASE[quality] || QUALITY_BASE.high;
  const mult = WEATHER_MULTIPLIER[currentWeather] ?? 0.3;
  return Math.floor(base * mult);
}

// ---------------------------------------------------------------------------
// Create / recreate instanced meshes
// ---------------------------------------------------------------------------

function createMeshes() {
  // Dispose old meshes
  disposeMeshes();

  const totalCount = QUALITY_BASE[quality] || QUALITY_BASE.high;
  generateCloudPositions(totalCount);

  // Ensure textures exist
  if (!cloudTexture) cloudTexture = createRadialGradientTexture(128, 0.85);
  if (!shadowTexture) shadowTexture = createShadowGradientTexture(128);

  // Shared cloud material
  cloudMaterial = new THREE.MeshBasicMaterial({
    map: cloudTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: 0xffffff,
  });

  // Shadow material
  shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 1.0, // opacity baked into texture
  });

  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // Count per layer
  const layerCounts = { cumulus: 0, alto: 0, cirrus: 0 };
  for (const c of cloudData) layerCounts[c.layer]++;

  // Create one InstancedMesh per layer
  const layerStartIndex = { cumulus: 0, alto: 0, cirrus: 0 };
  layerMeshes = {};
  let runningIdx = 0;
  for (const name of ['cumulus', 'alto', 'cirrus']) {
    const count = layerCounts[name];
    if (count === 0) {
      layerMeshes[name] = null;
      continue;
    }
    const mesh = new THREE.InstancedMesh(planeGeo, cloudMaterial, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10; // render after opaque
    layerStartIndex[name] = runningIdx;
    layerMeshes[name] = mesh;

    // Set initial transforms (will be overwritten by billboard update)
    let localIdx = 0;
    for (let i = runningIdx; i < runningIdx + count; i++) {
      const c = cloudData[i];
      _dummy.position.set(c.x, c.y, c.z);
      _dummy.scale.set(c.w, c.h, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(localIdx, _dummy.matrix);
      localIdx++;
    }
    mesh.instanceMatrix.needsUpdate = true;

    sceneRef.add(mesh);
    runningIdx += count;
  }

  // Shadow mesh for cumulus clouds
  if (cumulusCount > 0) {
    shadowMesh = new THREE.InstancedMesh(planeGeo, shadowMaterial, cumulusCount);
    shadowMesh.frustumCulled = false;
    shadowMesh.renderOrder = 1;

    // Place shadow planes horizontally at ground level
    const shadowRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );
    for (let i = 0; i < cumulusCount; i++) {
      const c = cloudData[i];
      _dummy.position.set(c.x, SHADOW_Y, c.z);
      _dummy.quaternion.copy(shadowRotation);
      // Shadow size roughly matches cloud width
      _dummy.scale.set(c.w * 0.8, c.w * 0.8, 1);
      _dummy.updateMatrix();
      shadowMesh.setMatrixAt(i, _dummy.matrix);
    }
    shadowMesh.instanceMatrix.needsUpdate = true;
    sceneRef.add(shadowMesh);
  }

  // Apply initial visibility
  applyVisibility();
}

function disposeMeshes() {
  for (const name of ['cumulus', 'alto', 'cirrus']) {
    if (layerMeshes[name]) {
      sceneRef?.remove(layerMeshes[name]);
      layerMeshes[name].dispose();
      layerMeshes[name] = null;
    }
  }
  if (shadowMesh) {
    sceneRef?.remove(shadowMesh);
    shadowMesh.dispose();
    shadowMesh = null;
  }
}

// ---------------------------------------------------------------------------
// Visibility: hide excess instances by zeroing scale
// ---------------------------------------------------------------------------

function applyVisibility() {
  const visible = getVisibleCount();
  const total = cloudData.length;

  // Determine per-layer visible counts proportional to layer fraction
  let runningIdx = 0;
  for (const name of ['cumulus', 'alto', 'cirrus']) {
    const mesh = layerMeshes[name];
    if (!mesh) continue;

    const layerTotal = mesh.count;
    // Allocate visible slots proportionally
    const layerVisible = Math.min(layerTotal,
      Math.floor(visible * LAYERS[name].fraction / (LAYERS[name].fraction + 0.001)));
    const actualVisible = Math.min(layerTotal, Math.max(0,
      visible - (runningIdx > 0 ? runningIdx : 0)));

    // We use a simpler approach: visible count applies globally in order
    for (let i = 0; i < layerTotal; i++) {
      const globalIdx = runningIdx + i;
      mesh.getMatrixAt(i, _mat4);
      _mat4.decompose(_pos, _quat, _scale);

      if (globalIdx < visible) {
        const c = cloudData[globalIdx];
        _scale.set(c.w, c.h, 1);
      } else {
        _scale.set(0, 0, 0);
      }
      _mat4.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(i, _mat4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    runningIdx += layerTotal;
  }

  // Same for shadow mesh (cumulus only)
  if (shadowMesh) {
    const shadowRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );
    const visibleCumulus = Math.min(cumulusCount, visible);
    for (let i = 0; i < cumulusCount; i++) {
      shadowMesh.getMatrixAt(i, _mat4);
      _mat4.decompose(_pos, _quat, _scale);
      if (i < visibleCumulus) {
        const c = cloudData[i];
        _scale.set(c.w * 0.8, c.w * 0.8, 1);
      } else {
        _scale.set(0, 0, 0);
      }
      _mat4.compose(_pos, shadowRotation, _scale);
      shadowMesh.setMatrixAt(i, _mat4);
    }
    shadowMesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Sun elevation from timeOfDay (0-24 hours)
// Mirrors scene.js logic
// ---------------------------------------------------------------------------

function getSunElevation(timeOfDay) {
  if (timeOfDay >= 6 && timeOfDay <= 18) {
    return 90 * Math.sin(Math.PI * (timeOfDay - 6) / 12);
  }
  return -10;
}

// ---------------------------------------------------------------------------
// Time-of-day tint calculation
// ---------------------------------------------------------------------------

function computeTintColor(timeOfDay, weatherPreset) {
  const sunElev = getSunElevation(timeOfDay);

  // Storm override
  if (weatherPreset === 'storm' || weatherPreset === 'rain') {
    // Blend storm tint with time-based tint
    const stormFactor = weatherPreset === 'storm' ? 0.7 : 0.4;
    const baseColor = computeBaseTint(sunElev);
    _color.copy(baseColor).lerp(TINT_STORM, stormFactor);
    return _color;
  }

  return computeBaseTint(sunElev);
}

function computeBaseTint(sunElev) {
  if (sunElev > 10) {
    _color.copy(TINT_DAY);
  } else if (sunElev > 0) {
    // Dawn/dusk zone: 0-10 degrees
    const t = sunElev / 10;
    _color.copy(TINT_DAWN).lerp(TINT_DAY, t);
  } else if (sunElev > -5) {
    // Twilight
    const t = (sunElev + 5) / 5;
    _color.copy(TINT_NIGHT).lerp(TINT_DAWN, t);
  } else {
    _color.copy(TINT_NIGHT);
  }
  return _color;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the cloud system. Creates all layers, shadows, and textures.
 * @param {THREE.Scene} scene
 */
export function initCloudSystem(scene) {
  sceneRef = scene;
  createMeshes();
}

/**
 * Per-frame update: billboard facing, wind drift, tinting, shadow sync.
 * @param {number} dt - delta time in seconds
 * @param {number} windX - wind X component (m/s)
 * @param {number} windZ - wind Z component (m/s)
 * @param {number} timeOfDay - 0-24 hours
 * @param {string} weatherPreset - 'clear'|'overcast'|'rain'|'storm'
 */
export function updateCloudSystem(dt, windX, windZ, timeOfDay, weatherPreset) {
  if (cloudData.length === 0) return;

  const camera = getCamera();
  if (!camera) return;

  // Update weather if changed (affects visibility count)
  if (weatherPreset !== currentWeather) {
    currentWeather = weatherPreset || 'clear';
    applyVisibility();
  }

  // Wind drift at 50% of wind speed
  const driftX = windX * 0.5 * dt;
  const driftZ = windZ * 0.5 * dt;

  // Tint color for this frame
  const tint = computeTintColor(timeOfDay, currentWeather);
  cloudMaterial.color.copy(tint);

  const visible = getVisibleCount();

  // Billboard: make each cloud face the camera
  // We construct a billboard quaternion from camera direction (ignoring pitch for stability)
  const camPos = camera.position;

  // Shadow rotation (constant horizontal)
  const shadowQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );

  let runningIdx = 0;
  let gridDirty = false;

  for (const name of ['cumulus', 'alto', 'cirrus']) {
    const mesh = layerMeshes[name];
    if (!mesh) continue;

    const layerCount = mesh.count;
    let anyUpdated = false;

    for (let i = 0; i < layerCount; i++) {
      const globalIdx = runningIdx + i;
      if (globalIdx >= visible) break; // rest are hidden (scale=0)

      const c = cloudData[globalIdx];

      // Apply wind drift
      c.x += driftX;
      c.z += driftZ;

      // Wrap at world bounds
      if (c.x > WORLD_BOUND) { c.x -= SPREAD; gridDirty = true; }
      else if (c.x < -WORLD_BOUND) { c.x += SPREAD; gridDirty = true; }
      if (c.z > WORLD_BOUND) { c.z -= SPREAD; gridDirty = true; }
      else if (c.z < -WORLD_BOUND) { c.z += SPREAD; gridDirty = true; }

      // Billboard: orient plane to face camera
      _dummy.position.set(c.x, c.y, c.z);
      _dummy.scale.set(c.w, c.h, 1);
      _dummy.lookAt(camPos);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      anyUpdated = true;
    }

    if (anyUpdated) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    runningIdx += layerCount;
  }

  // Update shadow positions to track cumulus clouds
  if (shadowMesh) {
    const visibleCumulus = Math.min(cumulusCount, visible);
    for (let i = 0; i < visibleCumulus; i++) {
      const c = cloudData[i];
      _dummy.position.set(c.x, SHADOW_Y, c.z);
      _dummy.quaternion.copy(shadowQuat);
      _dummy.scale.set(c.w * 0.8, c.w * 0.8, 1);
      _dummy.updateMatrix();
      shadowMesh.setMatrixAt(i, _dummy.matrix);
    }
    shadowMesh.instanceMatrix.needsUpdate = true;
  }

  // Rebuild spatial grid if clouds wrapped
  if (gridDirty) {
    buildFogGrid();
  }
}

/**
 * Query cloud fog density at a world position.
 * Returns 0 (clear) to 1 (fully inside cloud). Smooth falloff over 200m.
 * Uses spatial bucketing for O(1) average lookup.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function getCloudFogFactor(x, y, z) {
  const cx = Math.floor(x / SPATIAL_CELL);
  const cz = Math.floor(z / SPATIAL_CELL);
  const key = cellKey(cx, cz);
  const bucket = fogGrid[key];
  if (!bucket) return 0;

  let maxFog = 0;
  for (let i = 0; i < bucket.length; i++) {
    const c = cloudData[bucket[i]];
    // Quick Y range check before computing horizontal distance
    const dy = Math.abs(y - c.y);
    const vertRadius = c.h * 0.5;
    const totalVertRadius = vertRadius + FOG_FALLOFF;
    if (dy > totalVertRadius) continue;

    const dx = x - c.x;
    const dz = z - c.z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const fogR = c.fogRadius;
    const outerR = fogR + FOG_FALLOFF;

    if (horizDist > outerR) continue;

    // Compute vertical factor
    let vertFactor;
    if (dy <= vertRadius) {
      vertFactor = 1.0;
    } else {
      vertFactor = 1.0 - (dy - vertRadius) / FOG_FALLOFF;
    }

    // Compute horizontal factor
    let horizFactor;
    if (horizDist <= fogR) {
      horizFactor = 1.0;
    } else {
      horizFactor = 1.0 - (horizDist - fogR) / FOG_FALLOFF;
    }

    const fog = Math.max(0, Math.min(1, vertFactor * horizFactor));
    if (fog > maxFog) maxFog = fog;
    if (maxFog >= 1.0) return 1.0; // early out
  }

  return maxFog;
}

/**
 * Change cloud quality. Recreates all instances.
 * @param {'low'|'medium'|'high'} level
 */
export function setCloudSystemQuality(level) {
  if (!QUALITY_BASE[level]) return;
  if (level === quality) return;
  quality = level;
  if (sceneRef) createMeshes();
}

/**
 * Dispose all cloud system resources.
 */
export function disposeCloudSystem() {
  disposeMeshes();

  if (cloudMaterial) {
    cloudMaterial.dispose();
    cloudMaterial = null;
  }
  if (shadowMaterial) {
    shadowMaterial.dispose();
    shadowMaterial = null;
  }
  if (cloudTexture) {
    cloudTexture.dispose();
    cloudTexture = null;
  }
  if (shadowTexture) {
    shadowTexture.dispose();
    shadowTexture = null;
  }

  cloudData = [];
  cumulusCount = 0;
  fogGrid = {};
  sceneRef = null;
}

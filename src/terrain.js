import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import {
  TERRAIN_SIZE,
  TERRAIN_SEGMENTS,
  TERRAIN_MAX_HEIGHT,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_FLATTEN_RADIUS,
  AIRPORT2_X,
  AIRPORT2_Z,
  CITY_CENTER_X,
  CITY_CENTER_Z,
  CITY_SIZE,
  COAST_LINE_X,
  OCEAN_DEPTH,
  COAST_MARGIN,
} from './constants.js';
import { smoothstep } from './utils.js';
import { getSunDirection } from './scene.js';
import { getSetting, isSettingExplicit } from './settings.js';

const simplex = new SimplexNoise();

// Module-level highway spline for external access
let highwayCurve = null;
let highwaySamplePoints = null;

// Highway corridor centerline (x, z pairs) for terrain flattening and road mesh
const HIGHWAY_CENTERLINE = [
  [0, -300],
  [-300, -900],
  [200, -1700],
  [1400, -2000],
  [2600, -2400],
  [3200, -3200],
  [CITY_CENTER_X, CITY_CENTER_Z],
  [5000, -4200],
  [6000, -5000],
  [6200, -6200],
  [7000, -7000],
  [7600, -7400],
  [AIRPORT2_X, AIRPORT2_Z + 200],
];

function sampleNoise(x, z) {
  let value = 0;
  let amplitude = 1;
  let frequency = 0.0004;
  for (let i = 0; i < 4; i++) {
    value += simplex.noise(x * frequency, z * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

function airportFlattenFactor(x, z, cx, cz) {
  const halfLen = RUNWAY_LENGTH / 2 + 200;
  const halfWid = RUNWAY_WIDTH / 2 + 350;
  const margin = RUNWAY_FLATTEN_RADIUS;

  const lx = x - cx;
  const lz = z - cz;

  const dx = Math.max(0, Math.abs(lx) - halfWid);
  const dz = Math.max(0, Math.abs(lz) - halfLen);
  const dist = Math.sqrt(dx * dx + dz * dz);

  const runwayFlat = 1 - smoothstep(0, margin, dist);

  // Extended approach corridor on -Z side (southern approach)
  const approachLen = 3500;
  const approachWidthBase = 500;
  const approachWidthEnd = 150;
  const approachMargin = 600;

  let approachFlat = 0;
  if (lz < -halfLen + margin) {
    const zPast = Math.max(0, -(lz + halfLen * 0.5));
    const t = Math.min(zPast / approachLen, 1);
    const corridorWidth = approachWidthBase * (1 - t) + approachWidthEnd * t;
    const xDist = Math.max(0, Math.abs(lx) - corridorWidth);
    approachFlat = (1 - smoothstep(0, approachMargin, xDist)) * (1 - t * t);
  }

  return Math.max(runwayFlat, approachFlat);
}

function cityFlattenFactor(x, z) {
  const halfSize = CITY_SIZE / 2;
  const margin = 500; // wide smooth transition so city doesn't cut into mountains
  const dx = Math.max(0, Math.abs(x - CITY_CENTER_X) - halfSize);
  const dz = Math.max(0, Math.abs(z - CITY_CENTER_Z) - halfSize);
  const dist = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(0, margin, dist);
}

function highwayFlattenFactor(x, z) {
  const roadHalfWidth = 20;
  const margin = 40;
  let minDist = Infinity;
  for (let i = 0; i < HIGHWAY_CENTERLINE.length - 1; i++) {
    const ax = HIGHWAY_CENTERLINE[i][0], az = HIGHWAY_CENTERLINE[i][1];
    const bx = HIGHWAY_CENTERLINE[i + 1][0], bz = HIGHWAY_CENTERLINE[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lenSq));
    const px = ax + t * dx, pz = az + t * dz;
    const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    if (dist < minDist) minDist = dist;
  }
  return (1 - smoothstep(0, margin, Math.max(0, minDist - roadHalfWidth))) * 0.7;
}

function runwayFlattenFactor(x, z) {
  // Airport 1 at origin
  const f1 = airportFlattenFactor(x, z, 0, 0);
  // Airport 2
  const f2 = airportFlattenFactor(x, z, AIRPORT2_X, AIRPORT2_Z);
  const f3 = cityFlattenFactor(x, z);
  const f4 = highwayFlattenFactor(x, z);
  return Math.max(f1, f2, f3, f4);
}

// Ocean depression — creates coastline along eastern edge of map
function oceanFactor(x, z) {
  // Wavy coastline using simplex noise for natural look
  const coastNoise = simplex.noise(z * 0.00025, 0.5) * 1200
    + simplex.noise(z * 0.0008, 1.7) * 400;
  const effectiveCoastX = COAST_LINE_X + coastNoise;

  // Smooth transition from land to ocean
  return smoothstep(effectiveCoastX - COAST_MARGIN / 2, effectiveCoastX + COAST_MARGIN / 2, x);
}

export function getTerrainHeight(x, z) {
  const noise = sampleNoise(x, z);
  const rawHeight = ((noise + 1) / 2) * TERRAIN_MAX_HEIGHT;
  const flatten = runwayFlattenFactor(x, z);
  const landHeight = rawHeight * (1 - flatten);

  // Apply ocean depression east of coastline
  const ocean = oceanFactor(x, z);
  if (ocean <= 0) return landHeight;
  return landHeight * (1 - ocean) - ocean * OCEAN_DEPTH;
}

export function isInOcean(x, z) {
  return oceanFactor(x, z) > 0.5;
}

// Ground level for physics — terrain or water surface, whichever is higher
const WATER_SURFACE_Y = -2;
export function getGroundLevel(x, z) {
  return Math.max(getTerrainHeight(x, z), WATER_SURFACE_Y);
}

function createGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base grass color
  ctx.fillStyle = '#4a7c35';
  ctx.fillRect(0, 0, 512, 512);

  // Large color patches for variation
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 20 + Math.random() * 60;
    const g = 90 + Math.random() * 50;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${40 + Math.random() * 30}, ${g}, ${25 + Math.random() * 20}, 0.25)`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
  }

  // Grass blade details
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const g = 70 + Math.random() * 80;
    ctx.fillStyle = `rgba(${25 + Math.random() * 35}, ${g}, ${15 + Math.random() * 25}, 0.35)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 5);
  }

  // Darker earthy spots
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 5 + Math.random() * 15;
    ctx.fillStyle = `rgba(${60 + Math.random() * 30}, ${50 + Math.random() * 20}, ${30 + Math.random() * 15}, 0.2)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(200, 200);
  return tex;
}

function createDirtTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#6f5b3d';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const tone = 70 + Math.random() * 70;
    ctx.fillStyle = `rgba(${tone + 10}, ${tone}, ${tone * 0.7}, ${0.08 + Math.random() * 0.2})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 8 + Math.random() * 26;
    const c = 55 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${c + 15}, ${c + 8}, ${c * 0.55}, 0.35)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(130, 130);
  return tex;
}

function createRockTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#676b70';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 22000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const tone = 80 + Math.random() * 90;
    const alpha = 0.1 + Math.random() * 0.22;
    ctx.fillStyle = `rgba(${tone}, ${tone + 4}, ${tone + 8}, ${alpha})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const w = 20 + Math.random() * 90;
    const h = 4 + Math.random() * 14;
    const a = Math.random() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const shade = 95 + Math.random() * 40;
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade + 8}, ${0.16 + Math.random() * 0.22})`;
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(85, 85);
  return tex;
}

function applyBiomeTerrainShader(material, dirtMap, rockMap) {
  material.customProgramCacheKey = () => 'terrain-biome-v3';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dirtMap = { value: dirtMap };
    shader.uniforms.rockMap = { value: rockMap };
    shader.uniforms.shoreLevel = { value: 2.4 };
    shader.uniforms.shoreFade = { value: 4.8 };
    shader.uniforms.biomeNoiseScale = { value: 0.0017 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vWorldPos = worldPosition.xyz;
vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D dirtMap;
uniform sampler2D rockMap;
uniform float shoreLevel;
uniform float shoreFade;
uniform float biomeNoiseScale;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.45);
  return fract(p.x * p.y);
}`
      )
      .replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = texture2D(map, vMapUv);
vec4 dirtColor = texture2D(dirtMap, vMapUv * 1.25);
vec4 rockColor = texture2D(rockMap, vMapUv * 1.65);

float h = vWorldPos.y;
float slope = clamp(1.0 - abs(vWorldNormal.y), 0.0, 1.0);
float shore = 1.0 - smoothstep(shoreLevel, shoreLevel + shoreFade, h);
float lowland = 1.0 - smoothstep(120.0, 250.0, h);
float highland = smoothstep(170.0, 300.0, h);
float steepRock = smoothstep(0.52, 0.90, slope);
float rockWeight = clamp(max(highland * 0.9, steepRock * 0.95), 0.0, 1.0);
float dirtWeight = clamp(smoothstep(0.28, 0.62, slope) * (1.0 - rockWeight * 0.75) + shore * 0.3, 0.0, 1.0);
float grassWeight = clamp(1.0 - rockWeight - dirtWeight, 0.0, 1.0);

float n = hash21(floor(vWorldPos.xz * biomeNoiseScale));
grassWeight *= mix(0.95, 1.18, n) * (0.9 + 0.22 * lowland);
dirtWeight *= mix(0.82, 1.05, 1.0 - n);
rockWeight *= mix(0.88, 1.12, n * n);
float total = max(0.001, grassWeight + dirtWeight + rockWeight);
grassWeight /= total;
dirtWeight /= total;
rockWeight /= total;

vec3 terrainColor = sampledDiffuseColor.rgb * grassWeight +
  dirtColor.rgb * dirtWeight +
  rockColor.rgb * rockWeight;

vec3 wetColor = terrainColor * vec3(0.72, 0.77, 0.81);
terrainColor = mix(terrainColor, wetColor, shore * 0.45);

float foamNoise = hash21(floor(vWorldPos.xz * 0.09 + vec2(17.0, 53.0)));
float foam = smoothstep(0.82, 1.0, shore) * (0.2 + 0.8 * foamNoise);
terrainColor = mix(terrainColor, vec3(0.88, 0.84, 0.73), foam * 0.08);

float greenBoost = lowland * 0.12;
terrainColor *= vec3(0.98 - greenBoost * 0.15, 1.0 + greenBoost, 0.97 - greenBoost * 0.2);

diffuseColor *= vec4(terrainColor, sampledDiffuseColor.a);`
      );
  };
}

// Generate terrain normal map from height data
function createTerrainNormalMap(repeat) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  const scale = TERRAIN_SIZE / size;
  const heightScale = 2.0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const worldX = (x / size - 0.5) * TERRAIN_SIZE;
      const worldZ = (y / size - 0.5) * TERRAIN_SIZE;

      const hL = getTerrainHeight(worldX - scale, worldZ);
      const hR = getTerrainHeight(worldX + scale, worldZ);
      const hU = getTerrainHeight(worldX, worldZ - scale);
      const hD = getTerrainHeight(worldX, worldZ + scale);

      let nx = (hL - hR) * heightScale;
      let nz = (hU - hD) * heightScale;
      let ny = 2.0 * scale;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      data[idx] = (nx * 0.5 + 0.5) * 255;
      data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat, repeat);
  return tex;
}

export function createTerrain() {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS
  );
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;

  // Set terrain heights
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const h = getTerrainHeight(x, z);
    posAttr.setY(i, h);
  }
  geometry.computeVertexNormals();

  const grassTex = createGrassTexture();
  const dirtTex = createDirtTexture();
  const rockTex = createRockTexture();
  const normalMap = createTerrainNormalMap(1);

  const material = new THREE.MeshStandardMaterial({
    map: grassTex,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.24, 0.24),
    roughness: 0.88,
    metalness: 0.0,
  });
  applyBiomeTerrainShader(material, dirtTex, rockTex);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function isNearAirport(x, z) {
  // Airport 1 at origin
  if (Math.abs(x) < 350 && Math.abs(z) < RUNWAY_LENGTH / 2 + 300) return true;
  // Airport 2
  if (Math.abs(x - AIRPORT2_X) < 350 && Math.abs(z - AIRPORT2_Z) < RUNWAY_LENGTH / 2 + 300) return true;
  return false;
}

function isInCityZone(x, z) {
  const halfSize = CITY_SIZE / 2 + 50;
  return Math.abs(x - CITY_CENTER_X) < halfSize && Math.abs(z - CITY_CENTER_Z) < halfSize;
}

// Check if position is near any road segment
function isNearRoad(x, z) {
  if (!highwaySamplePoints) return false;
  const roadCheckDist = 25; // stay 25m away from road center
  for (let i = 0; i < highwaySamplePoints.length; i += 3) {
    const dx = x - highwaySamplePoints[i].x;
    const dz = z - highwaySamplePoints[i].z;
    if (dx * dx + dz * dz < roadCheckDist * roadCheckDist) return true;
  }
  return false;
}

const TREE_COLOR_PALETTE = [
  new THREE.Color(0x2d6b1e),
  new THREE.Color(0x3a8c25),
  new THREE.Color(0x4a9a35),
  new THREE.Color(0x2a5c1a),
  new THREE.Color(0x557733),
  new THREE.Color(0x6b8e23),
  new THREE.Color(0x8faa3a),
  new THREE.Color(0x7a9a2e),
];

const VEGETATION_DENSITY_PROFILE = {
  low: { trees: 2500, bushes: 1600, deadTrees: 400, nearRadius: 900, midRadius: 2600, nearTreeCap: 700, nearBushCap: 450, nearDeadCap: 120, impostorCap: 1200 },
  medium: { trees: 4200, bushes: 2600, deadTrees: 700, nearRadius: 1150, midRadius: 3200, nearTreeCap: 1200, nearBushCap: 700, nearDeadCap: 200, impostorCap: 2100 },
  high: { trees: 6000, bushes: 4000, deadTrees: 1000, nearRadius: 1450, midRadius: 3900, nearTreeCap: 1800, nearBushCap: 1000, nearDeadCap: 320, impostorCap: 3200 },
};

const vegetationLodState = {
  enabled: false,
  nearRadius: 1200,
  midRadius: 3200,
  updateIntervalMs: 250,
  lastUpdateMs: 0,
  allTrees: [],
  conifers: [],
  deciduous: [],
  bushes: [],
  deadTrees: [],
  trunkMesh: null,
  coniferMesh: null,
  deciduousMesh: null,
  bushMesh: null,
  deadMesh: null,
  impostorPoints: null,
  impostorPositions: null,
  impostorColors: null,
  impostorCapacity: 0,
};

const _vegDummy = new THREE.Object3D();
const _treeImpostorColor = new THREE.Color(0x4b6542);
const _bushColor = new THREE.Color(0x425b38);
const _deadImpostorColor = new THREE.Color(0x675f50);

function createVegetationMesh(geometry, material, count, castShadow = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.userData.maxCount = Math.max(1, count);
  mesh.count = 0;
  mesh.castShadow = castShadow;
  mesh.frustumCulled = false;
  return mesh;
}

function commitInstancedMesh(mesh, count, usesColor = false) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (usesColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function updateImpostorBuffer(focusX, focusZ, nearRadiusSq, midRadiusSq) {
  const { allTrees, bushes, deadTrees, impostorPositions, impostorColors, impostorCapacity, impostorPoints } = vegetationLodState;
  if (!impostorPoints || !impostorPositions || !impostorColors) return;

  let count = 0;
  const writeImpostor = (x, y, z, color) => {
    if (count >= impostorCapacity) return;
    const idx = count * 3;
    impostorPositions[idx] = x;
    impostorPositions[idx + 1] = y;
    impostorPositions[idx + 2] = z;
    impostorColors[idx] = color.r;
    impostorColors[idx + 1] = color.g;
    impostorColors[idx + 2] = color.b;
    count++;
  };

  for (let i = 0; i < allTrees.length; i++) {
    const t = allTrees[i];
    const dx = t.x - focusX;
    const dz = t.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq <= nearRadiusSq || distSq > midRadiusSq) continue;
    writeImpostor(t.x, t.h + t.scale * 1.6, t.z, _treeImpostorColor);
    if (count >= impostorCapacity) break;
  }

  if (count < impostorCapacity) {
    for (let i = 0; i < bushes.length && count < impostorCapacity; i++) {
      const b = bushes[i];
      const dx = b.x - focusX;
      const dz = b.z - focusZ;
      const distSq = dx * dx + dz * dz;
      if (distSq <= nearRadiusSq || distSq > midRadiusSq) continue;
      writeImpostor(b.x, b.h + b.scale * 0.55, b.z, _bushColor);
    }
  }

  if (count < impostorCapacity) {
    for (let i = 0; i < deadTrees.length && count < impostorCapacity; i++) {
      const t = deadTrees[i];
      const dx = t.x - focusX;
      const dz = t.z - focusZ;
      const distSq = dx * dx + dz * dz;
      if (distSq <= nearRadiusSq || distSq > midRadiusSq) continue;
      writeImpostor(t.x, t.h + t.scale * 1.1, t.z, _deadImpostorColor);
    }
  }

  impostorPoints.geometry.setDrawRange(0, count);
  impostorPoints.geometry.attributes.position.needsUpdate = true;
  impostorPoints.geometry.attributes.color.needsUpdate = true;
}

export function updateVegetationLOD(focusX, focusZ) {
  if (!vegetationLodState.enabled) return;

  const now = performance.now();
  if (now - vegetationLodState.lastUpdateMs < vegetationLodState.updateIntervalMs) return;
  vegetationLodState.lastUpdateMs = now;

  const nearRadiusSq = vegetationLodState.nearRadius * vegetationLodState.nearRadius;
  const midRadiusSq = vegetationLodState.midRadius * vegetationLodState.midRadius;

  let trunkCount = 0;
  let coniferCount = 0;
  let deciduousCount = 0;
  const trunkCap = vegetationLodState.trunkMesh.userData.maxCount;
  const coniferCap = vegetationLodState.coniferMesh.userData.maxCount;
  const deciduousCap = vegetationLodState.deciduousMesh.userData.maxCount;

  for (let i = 0; i < vegetationLodState.allTrees.length; i++) {
    const t = vegetationLodState.allTrees[i];
    const dx = t.x - focusX;
    const dz = t.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > nearRadiusSq) continue;

    if (trunkCount < trunkCap) {
      _vegDummy.position.set(t.x, t.h + t.scale * 0.5, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.setScalar(t.scale * 0.4);
      _vegDummy.updateMatrix();
      vegetationLodState.trunkMesh.setMatrixAt(trunkCount, _vegDummy.matrix);
      trunkCount++;
    }

    if (t.type === 'conifer') {
      if (coniferCount >= coniferCap) continue;
      _vegDummy.position.set(t.x, t.h + t.scale * 1.8, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.setScalar(t.scale * 0.5);
      _vegDummy.updateMatrix();
      vegetationLodState.coniferMesh.setMatrixAt(coniferCount, _vegDummy.matrix);
      vegetationLodState.coniferMesh.setColorAt(coniferCount, t.color);
      coniferCount++;
    } else {
      if (deciduousCount >= deciduousCap) continue;
      _vegDummy.position.set(t.x, t.h + t.scale * 1.6, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.set(t.scale * 0.5, t.scale * 0.4, t.scale * 0.5);
      _vegDummy.updateMatrix();
      vegetationLodState.deciduousMesh.setMatrixAt(deciduousCount, _vegDummy.matrix);
      vegetationLodState.deciduousMesh.setColorAt(deciduousCount, t.color);
      deciduousCount++;
    }

    if (trunkCount >= trunkCap && coniferCount >= coniferCap && deciduousCount >= deciduousCap) {
      break;
    }
  }

  commitInstancedMesh(vegetationLodState.trunkMesh, trunkCount);
  commitInstancedMesh(vegetationLodState.coniferMesh, coniferCount, true);
  commitInstancedMesh(vegetationLodState.deciduousMesh, deciduousCount, true);

  let bushCount = 0;
  const bushCap = vegetationLodState.bushMesh.userData.maxCount;
  for (let i = 0; i < vegetationLodState.bushes.length; i++) {
    const b = vegetationLodState.bushes[i];
    const dx = b.x - focusX;
    const dz = b.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > nearRadiusSq) continue;

    _vegDummy.position.set(b.x, b.h + b.scale * 0.3, b.z);
    _vegDummy.rotation.set(0, 0, 0);
    _vegDummy.scale.set(b.scale, b.scale * 0.6, b.scale);
    _vegDummy.updateMatrix();
    vegetationLodState.bushMesh.setMatrixAt(bushCount, _vegDummy.matrix);
    bushCount++;
    if (bushCount >= bushCap) break;
  }
  commitInstancedMesh(vegetationLodState.bushMesh, bushCount);

  let deadCount = 0;
  const deadCap = vegetationLodState.deadMesh.userData.maxCount;
  for (let i = 0; i < vegetationLodState.deadTrees.length; i++) {
    const t = vegetationLodState.deadTrees[i];
    const dx = t.x - focusX;
    const dz = t.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > nearRadiusSq) continue;

    _vegDummy.position.set(t.x, t.h + t.scale * 1.0, t.z);
    _vegDummy.rotation.set(t.leanX, t.yaw, t.leanZ);
    _vegDummy.scale.setScalar(t.scale * 0.5);
    _vegDummy.updateMatrix();
    vegetationLodState.deadMesh.setMatrixAt(deadCount, _vegDummy.matrix);
    deadCount++;
    if (deadCount >= deadCap) break;
  }
  commitInstancedMesh(vegetationLodState.deadMesh, deadCount);

  updateImpostorBuffer(focusX, focusZ, nearRadiusSq, midRadiusSq);
}

// Use InstancedMesh with dynamic LOD around aircraft for better visual density at stable cost.
export function createVegetation(scene) {
  const densitySetting = isSettingExplicit('vegetationDensity') ? getSetting('vegetationDensity') : getSetting('graphicsQuality');
  const vegetationProfile = VEGETATION_DENSITY_PROFILE[densitySetting] || VEGETATION_DENSITY_PROFILE.high;
  const treePositions = [];

  for (let i = 0; i < 9000; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;

    const h = getTerrainHeight(x, z);
    if (h > 250 || h < 3) continue;

    const density = simplex.noise(x * 0.0008, z * 0.0008);
    if (Math.random() > (density + 1) * 0.45) continue;
    if (treePositions.length >= vegetationProfile.trees) break;

    const baseScale = 0.5 + Math.random() * 1.5;
    const sizeBoost = density > 0.3 ? 1.0 + (density - 0.3) * 0.5 : 1.0;
    const type = Math.random() > 0.4 ? 'conifer' : 'deciduous';
    const color = TREE_COLOR_PALETTE[Math.floor(Math.random() * TREE_COLOR_PALETTE.length)];
    treePositions.push({ x, z, h, scale: baseScale * sizeBoost, type, color });
  }

  const bushPositions = [];
  for (let i = 0; i < 6000; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h > TERRAIN_MAX_HEIGHT * 0.35 || h < 3) continue;
    if (bushPositions.length >= vegetationProfile.bushes) break;
    bushPositions.push({ x, z, h, scale: 0.5 + Math.random() * 1.0 });
  }

  const deadTreePositions = [];
  for (let i = 0; i < 1500; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h > TERRAIN_MAX_HEIGHT * 0.55 || h < 3) continue;
    if (deadTreePositions.length >= vegetationProfile.deadTrees) break;
    deadTreePositions.push({
      x,
      z,
      h,
      scale: 1.0 + Math.random() * 2.0,
      leanX: (Math.random() - 0.5) * 0.2,
      leanZ: (Math.random() - 0.5) * 0.2,
      yaw: Math.random() * Math.PI * 2,
    });
  }

  const conifers = treePositions.filter(t => t.type === 'conifer');
  const deciduous = treePositions.filter(t => t.type === 'deciduous');

  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
  const coneGeo = new THREE.ConeGeometry(1.5, 4, 6);
  const coniferMat = new THREE.MeshLambertMaterial({ color: 0x2d6b1e });
  const sphereGeo = new THREE.SphereGeometry(1.8, 6, 5);
  const deciduousMat = new THREE.MeshLambertMaterial({ color: 0x3a8c25 });
  const bushGeo = new THREE.SphereGeometry(1.0, 5, 4);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x3a7a20 });
  const deadTrunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 5, 5);
  const deadTrunkMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });

  const trunkInstanced = createVegetationMesh(trunkGeo, trunkMat, vegetationProfile.nearTreeCap);
  const coniferInstanced = createVegetationMesh(coneGeo, coniferMat, vegetationProfile.nearTreeCap);
  const deciduousInstanced = createVegetationMesh(sphereGeo, deciduousMat, vegetationProfile.nearTreeCap);
  const bushInstanced = createVegetationMesh(bushGeo, bushMat, vegetationProfile.nearBushCap);
  const deadInstanced = createVegetationMesh(deadTrunkGeo, deadTrunkMat, vegetationProfile.nearDeadCap);
  trunkInstanced.castShadow = true;
  coniferInstanced.castShadow = true;
  deciduousInstanced.castShadow = true;
  bushInstanced.castShadow = true;
  deadInstanced.castShadow = true;

  scene.add(trunkInstanced);
  scene.add(coniferInstanced);
  scene.add(deciduousInstanced);
  scene.add(bushInstanced);
  scene.add(deadInstanced);

  const impostorCapacity = vegetationProfile.impostorCap;
  const impostorGeo = new THREE.BufferGeometry();
  const impostorPositions = new Float32Array(impostorCapacity * 3);
  const impostorColors = new Float32Array(impostorCapacity * 3);
  impostorGeo.setAttribute('position', new THREE.BufferAttribute(impostorPositions, 3));
  impostorGeo.setAttribute('color', new THREE.BufferAttribute(impostorColors, 3));
  impostorGeo.setDrawRange(0, 0);

  const impostorMat = new THREE.PointsMaterial({
    size: densitySetting === 'low' ? 5 : (densitySetting === 'medium' ? 6.5 : 8),
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: true,
  });
  const impostorPoints = new THREE.Points(impostorGeo, impostorMat);
  impostorPoints.frustumCulled = false;
  scene.add(impostorPoints);

  vegetationLodState.enabled = true;
  vegetationLodState.nearRadius = vegetationProfile.nearRadius;
  vegetationLodState.midRadius = vegetationProfile.midRadius;
  vegetationLodState.lastUpdateMs = 0;
  vegetationLodState.allTrees = treePositions;
  vegetationLodState.conifers = conifers;
  vegetationLodState.deciduous = deciduous;
  vegetationLodState.bushes = bushPositions;
  vegetationLodState.deadTrees = deadTreePositions;
  vegetationLodState.trunkMesh = trunkInstanced;
  vegetationLodState.coniferMesh = coniferInstanced;
  vegetationLodState.deciduousMesh = deciduousInstanced;
  vegetationLodState.bushMesh = bushInstanced;
  vegetationLodState.deadMesh = deadInstanced;
  vegetationLodState.impostorPoints = impostorPoints;
  vegetationLodState.impostorPositions = impostorPositions;
  vegetationLodState.impostorColors = impostorColors;
  vegetationLodState.impostorCapacity = impostorCapacity;

  updateVegetationLOD(0, 0);
}

// Rural structures (farmhouses and barns) scattered across terrain
export function createRuralStructures(scene) {
  const dummy = new THREE.Object3D();

  // Farmhouse colors
  const farmhouseColors = [
    new THREE.Color(0xf5f5f0), // white
    new THREE.Color(0xf5e6c8), // cream
    new THREE.Color(0xc8d8e8), // light blue
    new THREE.Color(0xf0e68c), // yellow
  ];

  // Collect valid farmhouse positions
  const farmPositions = [];
  for (let i = 0; i < 3000 && farmPositions.length < 50; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 2 || h > TERRAIN_MAX_HEIGHT * 0.2) continue;
    farmPositions.push({
      x,
      z,
      h,
      heading: Math.random() * Math.PI * 2,
    });
  }

  // Farmhouses via InstancedMesh
  const farmGeo = new THREE.BoxGeometry(8, 5, 10);
  const farmMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const farmInstanced = new THREE.InstancedMesh(farmGeo, farmMat, farmPositions.length);
  farmInstanced.castShadow = true;
  farmInstanced.receiveShadow = true;
  for (let i = 0; i < farmPositions.length; i++) {
    const p = farmPositions[i];
    dummy.position.set(p.x, p.h + 2.5, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    farmInstanced.setMatrixAt(i, dummy.matrix);
    farmInstanced.setColorAt(i, farmhouseColors[Math.floor(Math.random() * farmhouseColors.length)]);
  }
  if (farmPositions.length > 0) farmInstanced.instanceColor.needsUpdate = true;
  scene.add(farmInstanced);

  // Farmhouse roof pass for stronger silhouette
  const roofGeo = new THREE.ConeGeometry(6.4, 2.6, 4);
  roofGeo.rotateY(Math.PI * 0.25);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x7b4f30 });
  const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, farmPositions.length);
  const roofBaseColor = new THREE.Color(0x7b4f30);
  const roofColor = new THREE.Color();
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  for (let i = 0; i < farmPositions.length; i++) {
    const p = farmPositions[i];
    dummy.position.set(p.x, p.h + 6.3, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.set(1.0, 0.9 + Math.random() * 0.25, 1.0);
    dummy.updateMatrix();
    roofMesh.setMatrixAt(i, dummy.matrix);
    roofColor.copy(roofBaseColor).multiplyScalar(0.85 + Math.random() * 0.3);
    roofMesh.setColorAt(i, roofColor);
  }
  if (farmPositions.length > 0) roofMesh.instanceColor.needsUpdate = true;
  scene.add(roofMesh);

  // Collect valid barn positions
  const barnPositions = [];
  for (let i = 0; i < 2000 && barnPositions.length < 25; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 2 || h > TERRAIN_MAX_HEIGHT * 0.2) continue;
    barnPositions.push({
      x,
      z,
      h,
      heading: Math.random() * Math.PI * 2,
    });
  }

  // Barns via InstancedMesh
  const barnGeo = new THREE.BoxGeometry(12, 6, 15);
  const barnMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
  const barnInstanced = new THREE.InstancedMesh(barnGeo, barnMat, barnPositions.length);
  barnInstanced.castShadow = true;
  barnInstanced.receiveShadow = true;
  const barnColor = new THREE.Color(0x8b4513);
  const barnTint = new THREE.Color();
  for (let i = 0; i < barnPositions.length; i++) {
    const p = barnPositions[i];
    dummy.position.set(p.x, p.h + 3, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    barnInstanced.setMatrixAt(i, dummy.matrix);
    barnTint.copy(barnColor).multiplyScalar(0.9 + Math.random() * 0.2);
    barnInstanced.setColorAt(i, barnTint);
  }
  if (barnPositions.length > 0) barnInstanced.instanceColor.needsUpdate = true;
  scene.add(barnInstanced);

  // Barn roofs
  const barnRoofGeo = new THREE.ConeGeometry(9.4, 3.0, 4);
  barnRoofGeo.rotateY(Math.PI * 0.25);
  const barnRoofMat = new THREE.MeshLambertMaterial({ color: 0x5f3020 });
  const barnRoofMesh = new THREE.InstancedMesh(barnRoofGeo, barnRoofMat, barnPositions.length);
  const barnRoofBase = new THREE.Color(0x5f3020);
  barnRoofMesh.castShadow = true;
  barnRoofMesh.receiveShadow = true;
  for (let i = 0; i < barnPositions.length; i++) {
    const p = barnPositions[i];
    dummy.position.set(p.x, p.h + 7.2, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.set(1.1, 0.85 + Math.random() * 0.25, 1.25);
    dummy.updateMatrix();
    barnRoofMesh.setMatrixAt(i, dummy.matrix);
    roofColor.copy(barnRoofBase).multiplyScalar(0.88 + Math.random() * 0.24);
    barnRoofMesh.setColorAt(i, roofColor);
  }
  if (barnPositions.length > 0) barnRoofMesh.instanceColor.needsUpdate = true;
  scene.add(barnRoofMesh);

  // Grain silos near a subset of farmhouses
  const siloPositions = [];
  for (let i = 0; i < farmPositions.length; i++) {
    if (Math.random() > 0.45) continue;
    const base = farmPositions[i];
    const dist = 10 + Math.random() * 8;
    const a = base.heading + (Math.random() > 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5);
    siloPositions.push({
      x: base.x + Math.cos(a) * dist,
      z: base.z + Math.sin(a) * dist,
      h: getTerrainHeight(base.x + Math.cos(a) * dist, base.z + Math.sin(a) * dist),
      scale: 0.9 + Math.random() * 0.35,
    });
  }

  if (siloPositions.length > 0) {
    const siloBodyGeo = new THREE.CylinderGeometry(1.4, 1.6, 9, 10);
    const siloBodyMat = new THREE.MeshLambertMaterial({ color: 0xb5b8bd });
    const siloBodyMesh = new THREE.InstancedMesh(siloBodyGeo, siloBodyMat, siloPositions.length);
    siloBodyMesh.castShadow = true;
    siloBodyMesh.receiveShadow = true;

    const siloCapGeo = new THREE.SphereGeometry(1.55, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const siloCapMat = new THREE.MeshLambertMaterial({ color: 0x8f949a });
    const siloCapMesh = new THREE.InstancedMesh(siloCapGeo, siloCapMat, siloPositions.length);
    siloCapMesh.castShadow = true;
    const siloBaseColor = new THREE.Color(0xb5b8bd);
    const siloCapBaseColor = new THREE.Color(0x8f949a);

    for (let i = 0; i < siloPositions.length; i++) {
      const s = siloPositions[i];
      dummy.position.set(s.x, s.h + 4.5 * s.scale, s.z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      siloBodyMesh.setMatrixAt(i, dummy.matrix);
      barnTint.copy(siloBaseColor).multiplyScalar(0.88 + Math.random() * 0.24);
      siloBodyMesh.setColorAt(i, barnTint);

      dummy.position.set(s.x, s.h + 9.0 * s.scale, s.z);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      siloCapMesh.setMatrixAt(i, dummy.matrix);
      roofColor.copy(siloCapBaseColor).multiplyScalar(0.9 + Math.random() * 0.2);
      siloCapMesh.setColorAt(i, roofColor);
    }

    siloBodyMesh.instanceColor.needsUpdate = true;
    siloCapMesh.instanceColor.needsUpdate = true;
    scene.add(siloBodyMesh);
    scene.add(siloCapMesh);
  }
}

// Highway connecting Airport 1 → City → Airport 2
export function createHighway(scene) {
  // Build winding control points from module-level centerline
  const controlPoints = HIGHWAY_CENTERLINE.map(([x, z]) => new THREE.Vector3(x, 0, z));

  // Sample terrain height for each control point
  for (const pt of controlPoints) {
    pt.y = getTerrainHeight(pt.x, pt.z) + 0.2;
  }

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.3);

  // Store the highway curve and sample points for external access
  highwayCurve = curve;
  const segments = 300;
  highwaySamplePoints = curve.getPoints(segments);

  // Wider road: 18m
  const roadWidth = 18;
  const points = highwaySamplePoints;

  // Create road texture with dashed center line and shoulder markings
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 256;
  texCanvas.height = 128;
  const texCtx = texCanvas.getContext('2d');

  // Darker asphalt base
  texCtx.fillStyle = '#252525';
  texCtx.fillRect(0, 0, 256, 128);

  // Subtle asphalt grain
  for (let i = 0; i < 2000; i++) {
    const gx = Math.random() * 256;
    const gy = Math.random() * 128;
    const brightness = 30 + Math.random() * 20;
    texCtx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.3)`;
    texCtx.fillRect(gx, gy, 1, 1);
  }

  // Shoulder markings (solid white lines near edges)
  texCtx.strokeStyle = '#cccccc';
  texCtx.lineWidth = 2;
  texCtx.setLineDash([]);
  texCtx.beginPath();
  texCtx.moveTo(0, 8);
  texCtx.lineTo(256, 8);
  texCtx.stroke();
  texCtx.beginPath();
  texCtx.moveTo(0, 120);
  texCtx.lineTo(256, 120);
  texCtx.stroke();

  // White dashed center line
  texCtx.strokeStyle = '#ffffff';
  texCtx.lineWidth = 2;
  texCtx.setLineDash([16, 12]);
  texCtx.beginPath();
  texCtx.moveTo(0, 64);
  texCtx.lineTo(256, 64);
  texCtx.stroke();

  // Edge lines (solid)
  texCtx.strokeStyle = '#666666';
  texCtx.lineWidth = 1;
  texCtx.setLineDash([]);
  texCtx.beginPath();
  texCtx.moveTo(0, 2);
  texCtx.lineTo(256, 2);
  texCtx.moveTo(0, 126);
  texCtx.lineTo(256, 126);
  texCtx.stroke();

  const roadTex = new THREE.CanvasTexture(texCanvas);
  roadTex.wrapS = THREE.RepeatWrapping;
  roadTex.wrapT = THREE.ClampToEdgeWrapping;
  roadTex.repeat.set(segments / 4, 1);

  // Build geometry
  const roadVertices = [];
  const roadUVs = [];
  const roadIndices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);

    // Get perpendicular direction (in XZ plane)
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    // Sample terrain height at road center
    const terrainH = getTerrainHeight(point.x, point.z) + 0.2;

    const left = new THREE.Vector3(
      point.x - perp.x * roadWidth * 0.5,
      terrainH,
      point.z - perp.z * roadWidth * 0.5
    );
    const right = new THREE.Vector3(
      point.x + perp.x * roadWidth * 0.5,
      terrainH,
      point.z + perp.z * roadWidth * 0.5
    );

    roadVertices.push(left.x, left.y, left.z);
    roadVertices.push(right.x, right.y, right.z);

    const u = t * (segments / 4);
    roadUVs.push(u, 0);
    roadUVs.push(u, 1);

    if (i < segments) {
      const idx = i * 2;
      roadIndices.push(idx, idx + 1, idx + 2);
      roadIndices.push(idx + 1, idx + 3, idx + 2);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();

  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.92,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);
}

// Export function to get the highway spline path
export function getHighwayPath() {
  if (!highwayCurve) return null;
  return {
    curve: highwayCurve,
    points: highwaySamplePoints,
  };
}

// Rock formations on mountain peaks
export function createRockFormations(scene) {
  const dummy = new THREE.Object3D();
  const rockPositions = [];

  for (let i = 0; i < 5000 && rockPositions.length < 100; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const h = getTerrainHeight(x, z);
    if (h < TERRAIN_MAX_HEIGHT * 0.4) continue;
    const scale = 2 + Math.random() * 6;
    rockPositions.push({ x, z, h, scale });
  }

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x7a7a72,
    roughness: 0.95,
    metalness: 0.05,
  });

  const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rockPositions.length);
  rockInstanced.castShadow = true;
  rockInstanced.receiveShadow = true;

  const rockColor = new THREE.Color(0x7a7a72);
  for (let i = 0; i < rockPositions.length; i++) {
    const r = rockPositions[i];
    // Partially embedded in terrain
    dummy.position.set(r.x, r.h - r.scale * 0.3, r.z);
    dummy.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI
    );
    dummy.scale.set(
      r.scale * (0.8 + Math.random() * 0.4),
      r.scale * (0.6 + Math.random() * 0.5),
      r.scale * (0.8 + Math.random() * 0.4)
    );
    dummy.updateMatrix();
    rockInstanced.setMatrixAt(i, dummy.matrix);
    // Slight color variation
    const variation = 0.85 + Math.random() * 0.3;
    rockInstanced.setColorAt(i, rockColor.clone().multiplyScalar(variation));
  }
  if (rockPositions.length > 0) rockInstanced.instanceColor.needsUpdate = true;
  scene.add(rockInstanced);
}

// Wildflower patches across low terrain meadows
export function createWildflowers(scene) {
  const densitySetting = isSettingExplicit('vegetationDensity') ? getSetting('vegetationDensity') : getSetting('graphicsQuality');
  const flowerTarget = densitySetting === 'low' ? 1200 : (densitySetting === 'medium' ? 2100 : 3000);
  const dummy = new THREE.Object3D();
  const flowerColors = [
    new THREE.Color(0xffe033), // vivid golden yellow
    new THREE.Color(0xffcc00), // deep gold
    new THREE.Color(0xdaa520), // golden amber
    new THREE.Color(0xf5b800), // amber
    new THREE.Color(0xcc44cc), // vivid purple
    new THREE.Color(0x9b30ff), // bright purple
    new THREE.Color(0xff2255), // vivid red-pink
    new THREE.Color(0xff6633), // bright orange
    new THREE.Color(0xffeeaa), // cream
    new THREE.Color(0xff88aa), // saturated pink
    new THREE.Color(0x4488ff), // cornflower blue
    new THREE.Color(0xff4444), // bright red
  ];

  const flowerPositions = [];
  for (let i = 0; i < 18000 && flowerPositions.length < flowerTarget; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 0.5 || h > TERRAIN_MAX_HEIGHT * 0.18) continue;
    flowerPositions.push({ x, z, h });
  }

  const flowerGeo = new THREE.PlaneGeometry(1.2, 1.2);
  const flowerMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7,
  });

  const flowerInstanced = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerPositions.length);
  for (let i = 0; i < flowerPositions.length; i++) {
    const f = flowerPositions[i];
    dummy.position.set(f.x, f.h + 0.1, f.z);
    // Lay flat on ground
    dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    // Slightly larger patches
    dummy.scale.set(0.6 + Math.random() * 0.5, 0.6 + Math.random() * 0.5, 1);
    dummy.updateMatrix();
    flowerInstanced.setMatrixAt(i, dummy.matrix);
    flowerInstanced.setColorAt(i, flowerColors[Math.floor(Math.random() * flowerColors.length)]);
  }
  if (flowerPositions.length > 0) flowerInstanced.instanceColor.needsUpdate = true;
  scene.add(flowerInstanced);
}

// ═══════════════════════════════════════════════════════════
// Volumetric Cluster Cloud System
// ═══════════════════════════════════════════════════════════
let cloudGroup;
let cloudClusters = [];
let cloudDensity = 'normal';
let cloudMaterials = [];
let cloudSceneRef = null;
let cloudQuality = 'high';
let weatherCloudProfile = { cloudCount: 180, cloudOpacity: 0.28 };
let cloudPuffTexture = null;
let cloudWispTexture = null;
let cloudCumulusMats = [];
let cloudCirrusMats = [];
let cloudShadowMats = [];

const CLOUD_QUALITY_CONFIG = {
  low: {
    cumulusCount: 380,
    cirrusCount: 90,
    cumulusPuffMin: 10,
    cumulusPuffMax: 15,
    cirrusWispMin: 3,
    cirrusWispMax: 5,
    area: 50000,
  },
  medium: {
    cumulusCount: 560,
    cirrusCount: 140,
    cumulusPuffMin: 12,
    cumulusPuffMax: 18,
    cirrusWispMin: 4,
    cirrusWispMax: 6,
    area: 52000,
  },
  high: {
    cumulusCount: 760,
    cirrusCount: 200,
    cumulusPuffMin: 14,
    cumulusPuffMax: 22,
    cirrusWispMin: 5,
    cirrusWispMax: 8,
    area: 56000,
  },
};
const CLOUD_DENSITY_ORDER = ['none', 'few', 'normal', 'many'];
const CLOUD_DENSITY_MULTIPLIER = { none: 0, few: 0.5, normal: 0.9, many: 1.18 };

// Create soft, organic cloud puff texture with multiple overlapping gradients
function createCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mid = size / 2;

  // Layer 1: large soft base
  const g1 = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  g1.addColorStop(0, 'rgba(255,255,255,1.0)');
  g1.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  g1.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g1.addColorStop(0.75, 'rgba(255,255,255,0.15)');
  g1.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, size, size);

  // Layer 2: off-center lumps for organic shape
  const offsets = [
    { x: mid * 0.7, y: mid * 0.8, r: mid * 0.6 },
    { x: mid * 1.3, y: mid * 0.9, r: mid * 0.55 },
    { x: mid * 0.9, y: mid * 1.2, r: mid * 0.5 },
  ];
  for (const o of offsets) {
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Create a wispy/cirrus cloud texture
function createWispTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mid = size / 2;

  // Elongated horizontal wisp
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  g.addColorStop(0, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createClouds(scene) {
  cloudSceneRef = scene;

  if (cloudGroup) {
    scene.remove(cloudGroup);
  }
  for (const mat of cloudMaterials) {
    mat.dispose();
  }

  cloudGroup = new THREE.Group();
  cloudClusters = [];
  cloudMaterials = [];
  cloudCumulusMats = [];
  cloudCirrusMats = [];
  cloudShadowMats = [];

  if (!cloudPuffTexture) cloudPuffTexture = createCloudTexture();
  if (!cloudWispTexture) cloudWispTexture = createWispTexture();
  const quality = CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high;
  const opacityBase = Math.max(0.16, Math.min(0.96, weatherCloudProfile.cloudOpacity || 0.28));

  const cumulusOpacities = [0.45, 0.55, 0.65, 0.75, 0.85];
  const cirrusOpacities = [0.24, 0.32, 0.42];
  const shadowOpacities = [0.12, 0.18, 0.24];

  for (let i = 0; i < cumulusOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudPuffTexture,
      transparent: true,
      opacity: Math.min(0.98, cumulusOpacities[i] * (0.7 + opacityBase * 0.95)),
      depthWrite: false,
      fog: false,
      color: 0xf0f3fa,
    });
    mat.userData.role = 'cumulus';
    cloudCumulusMats.push(mat);
    cloudMaterials.push(mat);
  }

  for (let i = 0; i < cirrusOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudWispTexture,
      transparent: true,
      opacity: Math.min(0.92, cirrusOpacities[i] * (0.72 + opacityBase * 0.92)),
      depthWrite: false,
      fog: false,
      color: 0xdce4f2,
    });
    mat.userData.role = 'cirrus';
    cloudCirrusMats.push(mat);
    cloudMaterials.push(mat);
  }

  for (let i = 0; i < shadowOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudPuffTexture,
      transparent: true,
      opacity: Math.min(0.4, shadowOpacities[i] * (0.65 + opacityBase * 0.8)),
      depthWrite: false,
      fog: false,
      color: 0x7f8594,
    });
    mat.userData.role = 'shadow';
    cloudShadowMats.push(mat);
    cloudMaterials.push(mat);
  }

  const area = quality.area;

  // Cumulus clusters
  for (let c = 0; c < quality.cumulusCount; c++) {
    const cluster = new THREE.Group();
    cluster.position.set(
      (Math.random() - 0.5) * area,
      520 + Math.random() * 520,
      (Math.random() - 0.5) * area
    );
    cluster.userData.type = 'cumulus';
    cluster.userData.drift = 0.8 + Math.random() * 0.5;

    const cloudW = 340 + Math.random() * 680;
    const cloudD = 240 + Math.random() * 460;
    const cloudH = 46 + Math.random() * 110;
    const puffCount = quality.cumulusPuffMin + Math.floor(Math.random() * (quality.cumulusPuffMax - quality.cumulusPuffMin + 1));

    for (let p = 0; p < puffCount; p++) {
      const isCore = p < puffCount * 0.42;
      const mat = isCore
        ? cloudCumulusMats[2 + Math.floor(Math.random() * 3)]
        : cloudCumulusMats[Math.floor(Math.random() * 3)];
      const sprite = new THREE.Sprite(mat);
      const s = isCore
        ? (240 + Math.random() * 320)
        : (150 + Math.random() * 230);
      sprite.scale.set(s, s * (0.42 + Math.random() * 0.26), 1);
      const spread = isCore ? 0.38 : 1.0;
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * spread,
        (Math.random() - 0.5) * cloudH + (isCore ? cloudH * 0.12 : 0),
        (Math.random() - 0.5) * cloudD * spread
      );
      cluster.add(sprite);
    }

    // Underside shading puffs
    const shadeCount = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < shadeCount; s++) {
      const mat = cloudShadowMats[Math.floor(Math.random() * cloudShadowMats.length)];
      const sprite = new THREE.Sprite(mat);
      const sz = 170 + Math.random() * 230;
      sprite.scale.set(sz, sz * 0.28, 1);
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * 0.65,
        -cloudH * 0.55 - Math.random() * 18,
        (Math.random() - 0.5) * cloudD * 0.65
      );
      cluster.add(sprite);
    }

    cloudGroup.add(cluster);
    cloudClusters.push(cluster);
  }

  // Cirrus clusters
  for (let c = 0; c < quality.cirrusCount; c++) {
    const cluster = new THREE.Group();
    cluster.position.set(
      (Math.random() - 0.5) * (area * 1.08),
      1700 + Math.random() * 1500,
      (Math.random() - 0.5) * (area * 1.08)
    );
    cluster.userData.type = 'cirrus';
    cluster.userData.drift = 1.35 + Math.random() * 0.85;

    const wispCount = quality.cirrusWispMin + Math.floor(Math.random() * (quality.cirrusWispMax - quality.cirrusWispMin + 1));
    for (let w = 0; w < wispCount; w++) {
      const mat = cloudCirrusMats[Math.floor(Math.random() * cloudCirrusMats.length)];
      const sprite = new THREE.Sprite(mat);
      const sw = 520 + Math.random() * 760;
      sprite.scale.set(sw, sw * (0.07 + Math.random() * 0.04), 1);
      sprite.position.set(
        (Math.random() - 0.5) * 700,
        (Math.random() - 0.5) * 26,
        (Math.random() - 0.5) * 420
      );
      cluster.add(sprite);
    }

    cloudGroup.add(cluster);
    cloudClusters.push(cluster);
  }

  scene.add(cloudGroup);
  applyCloudDensity();
  return cloudGroup;
}

export function updateClouds(dt, windVector, cameraY, focusX = 0, focusZ = 0) {
  if (!cloudGroup || !windVector) return;

  const driftX = windVector.x * dt * 0.32;
  const driftZ = windVector.z * dt * 0.32;
  const limit = getCloudActiveLimit();
  const wrapHalfSpan = (CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high).area * 0.52;
  const wrapSpan = wrapHalfSpan * 2;

  for (let i = 0; i < cloudClusters.length; i++) {
    const cluster = cloudClusters[i];
    const isActive = i < limit;

    if (!isActive) {
      cluster.visible = false;
      continue;
    }
    cluster.visible = true;

    const driftMul = cluster.userData.drift || 1.0;
    cluster.position.x += driftX * driftMul;
    cluster.position.z += driftZ * driftMul;

    if (cluster.position.x - focusX > wrapHalfSpan) cluster.position.x -= wrapSpan;
    if (cluster.position.x - focusX < -wrapHalfSpan) cluster.position.x += wrapSpan;
    if (cluster.position.z - focusZ > wrapHalfSpan) cluster.position.z -= wrapSpan;
    if (cluster.position.z - focusZ < -wrapHalfSpan) cluster.position.z += wrapSpan;
  }
}

// Update cloud colors based on time of day
export function updateCloudColors(sunElevation) {
  const cumulusColor = new THREE.Color();
  const cirrusColor = new THREE.Color();
  const shadowColor = new THREE.Color();

  if (sunElevation > 15) {
    // Daytime
    cumulusColor.setHex(0xf0f3fa);
    cirrusColor.setHex(0xdde4f2);
    shadowColor.setHex(0x7f8593);
  } else if (sunElevation > 0) {
    // Sunset/sunrise
    const t = sunElevation / 15;
    cumulusColor.setRGB(1.0, 0.78 + t * 0.18, 0.62 + t * 0.3);
    cirrusColor.setRGB(0.92, 0.72 + t * 0.2, 0.68 + t * 0.2);
    shadowColor.setRGB(0.56, 0.47 + t * 0.16, 0.44 + t * 0.2);
  } else if (sunElevation > -5) {
    // Twilight
    const t = (sunElevation + 5) / 5;
    cumulusColor.setRGB(0.55 + t * 0.34, 0.43 + t * 0.28, 0.66 + t * 0.16);
    cirrusColor.setRGB(0.44 + t * 0.3, 0.4 + t * 0.24, 0.66 + t * 0.12);
    shadowColor.setRGB(0.32 + t * 0.2, 0.3 + t * 0.2, 0.42 + t * 0.14);
  } else {
    // Night
    cumulusColor.setRGB(0.2, 0.21, 0.28);
    cirrusColor.setRGB(0.17, 0.19, 0.26);
    shadowColor.setRGB(0.13, 0.14, 0.18);
  }

  for (let i = 0; i < cloudMaterials.length; i++) {
    const mat = cloudMaterials[i];
    const role = mat.userData.role;
    if (role === 'cumulus') mat.color.copy(cumulusColor);
    else if (role === 'cirrus') mat.color.copy(cirrusColor);
    else mat.color.copy(shadowColor);
  }
}

function getCloudActiveLimit() {
  const quality = CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high;
  const baseCount = quality.cumulusCount + quality.cirrusCount;
  const weatherFactor = Math.max(0.45, Math.min(2.0, (weatherCloudProfile.cloudCount || 180) / 180));
  const densityFactor = CLOUD_DENSITY_MULTIPLIER[cloudDensity] ?? 1.0;
  return Math.floor(baseCount * weatherFactor * densityFactor);
}

function applyCloudDensity() {
  const limit = getCloudActiveLimit();
  for (let i = 0; i < cloudClusters.length; i++) {
    cloudClusters[i].visible = i < limit;
  }
}

export function cycleCloudDensity() {
  const idx = CLOUD_DENSITY_ORDER.indexOf(cloudDensity);
  cloudDensity = CLOUD_DENSITY_ORDER[(idx + 1) % CLOUD_DENSITY_ORDER.length];
  applyCloudDensity();
  return cloudDensity;
}

export function getCloudDensity() {
  return cloudDensity;
}

export function setCloudQuality(level) {
  if (!CLOUD_QUALITY_CONFIG[level]) return cloudQuality;
  if (cloudQuality === level) return cloudQuality;
  cloudQuality = level;
  if (cloudSceneRef) createClouds(cloudSceneRef);
  return cloudQuality;
}

export function applyWeatherCloudProfile(profile) {
  if (profile && typeof profile === 'object') {
    if (typeof profile.cloudCount === 'number') weatherCloudProfile.cloudCount = profile.cloudCount;
    if (typeof profile.cloudOpacity === 'number') weatherCloudProfile.cloudOpacity = profile.cloudOpacity;
  }

  const opacityBase = Math.max(0.16, Math.min(0.96, weatherCloudProfile.cloudOpacity || 0.28));
  for (let i = 0; i < cloudCumulusMats.length; i++) {
    const mat = cloudCumulusMats[i];
    const base = [0.45, 0.55, 0.65, 0.75, 0.85][i] || 0.65;
    mat.opacity = Math.min(0.98, base * (0.7 + opacityBase * 0.95));
  }
  for (let i = 0; i < cloudCirrusMats.length; i++) {
    const mat = cloudCirrusMats[i];
    const base = [0.24, 0.32, 0.42][i] || 0.3;
    mat.opacity = Math.min(0.92, base * (0.72 + opacityBase * 0.92));
  }
  for (let i = 0; i < cloudShadowMats.length; i++) {
    const mat = cloudShadowMats[i];
    const base = [0.12, 0.18, 0.24][i] || 0.18;
    mat.opacity = Math.min(0.4, base * (0.65 + opacityBase * 0.8));
  }

  applyCloudDensity();
}

// Water using Three.js Water addon
let water;

function createWaterNormalMap() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  // Generate a proper tangent-space normal map with multi-octave waves
  const step = 1.0 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x * step;
      const v = y * step;

      // Height function at (u,v) — 5 octaves of sine waves
      const h = (ux, uy) => {
        const a = ux * Math.PI * 8;
        const b = uy * Math.PI * 8;
        return Math.sin(a + b * 0.5) * 0.5
             + Math.sin(a * 2.3 - b * 1.7) * 0.3
             + Math.sin(a * 0.7 + b * 3.1) * 0.2
             + Math.sin(a * 3.7 + b * 0.9) * 0.15
             + Math.sin(a * 1.5 - b * 4.3) * 0.1;
      };

      // Finite difference normals
      const eps = step * 0.5;
      const dhdx = (h(u + eps, v) - h(u - eps, v)) / (2 * eps);
      const dhdy = (h(u, v + eps) - h(u, v - eps)) / (2 * eps);

      // Tangent-space normal: (-dhdx, -dhdy, 1) normalized, then mapped to [0,255]
      const scale = 0.08; // controls normal map strength
      const nx = -dhdx * scale;
      const ny = -dhdy * scale;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const idx = (y * size + x) * 4;
      data[idx]     = Math.floor(((nx / len) * 0.5 + 0.5) * 255); // R
      data[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255); // G
      data[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255); // B
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createWater(scene) {
  const waterGeometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);

  const waterNormals = createWaterNormalMap();

  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: waterNormals,
    sunDirection: getSunDirection(),
    sunColor: 0xffffff,
    waterColor: 0x001e0f,
    distortionScale: 3.7,
    fog: scene.fog !== undefined,
  });

  water.rotation.x = -Math.PI / 2;
  water.position.y = -2;
  scene.add(water);
  return water;
}

export function updateWater(dt, windVector) {
  if (!water) return;
  const windSpeed = windVector ? Math.hypot(windVector.x, windVector.z) : 0;
  const timeScale = 1.0 + Math.min(1.2, windSpeed * 0.04);
  water.material.uniforms['time'].value += dt * timeScale;
  water.material.uniforms['sunDirection'].value.copy(getSunDirection());
  water.material.uniforms['distortionScale'].value = 3.2 + Math.min(3.8, windSpeed * 0.24);
}

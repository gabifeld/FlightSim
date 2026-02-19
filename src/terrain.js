import * as THREE from 'three';
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
  CT_CENTER_X,
  CT_CENTER_Z,
  CT_SIZE_X,
  CT_SIZE_Z,
  TABLE_MTN_X,
  TABLE_MTN_Z,
  SIGNAL_HILL_X,
  SIGNAL_HILL_Z,
  INTL_AIRPORT_X,
  INTL_AIRPORT_Z,
  INTL_RUNWAY_LENGTH,
  INTL_RUNWAY_WIDTH,
} from './constants.js';
import { smoothstep } from './utils.js';
import { getSunDirection, scene as sceneRef } from './scene.js';
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

// Highway spur from inland city toward Cape Town
const HIGHWAY_SPUR_CT = [
  [CITY_CENTER_X + 1200, CITY_CENTER_Z + 1000],
  [6400, -1800],
  [7600, -800],
  [8600, -200],
  [9200, 0],
  [CT_CENTER_X, CT_CENTER_Z],
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

function segmentMinDist(x, z, segments) {
  let minDist = Infinity;
  for (let i = 0; i < segments.length - 1; i++) {
    const ax = segments[i][0], az = segments[i][1];
    const bx = segments[i + 1][0], bz = segments[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lenSq));
    const px = ax + t * dx, pz = az + t * dz;
    const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function highwayFlattenFactor(x, z) {
  const roadHalfWidth = 20;
  const margin = 40;
  const minDist = Math.min(
    segmentMinDist(x, z, HIGHWAY_CENTERLINE),
    segmentMinDist(x, z, HIGHWAY_SPUR_CT)
  );
  return (1 - smoothstep(0, margin, Math.max(0, minDist - roadHalfWidth))) * 0.7;
}

// Cape Town city flatten — full for CBD/east, partial in Bo-Kaap for hillside effect
function capeTownFlattenFactor(x, z) {
  const halfX = CT_SIZE_X / 2;
  const halfZ = CT_SIZE_Z / 2;
  const margin = 400;
  const dx = Math.max(0, Math.abs(x - CT_CENTER_X) - halfX);
  const dz = Math.max(0, Math.abs(z - CT_CENTER_Z) - halfZ);
  const dist = Math.sqrt(dx * dx + dz * dz);
  let f = 1 - smoothstep(0, margin, dist);
  // Reduce flattening in Bo-Kaap / western zone so terrain rises for hillside houses
  if (x < 9200 && f > 0) {
    const westFade = smoothstep(8000, 9200, x); // 0 at Table Mtn edge, 1 at CBD
    f *= 0.3 + 0.7 * westFade;
  }
  return f;
}

// Table Mountain — flat-topped mesa 1200x2000m at 280m
function tableMountainHeight(x, z) {
  const cx = TABLE_MTN_X, cz = TABLE_MTN_Z;
  const halfW = 600, halfD = 1000;
  const plateauH = 280;
  // Distance from plateau edge
  const edgeX = Math.max(0, Math.abs(x - cx) - halfW);
  const edgeZ = Math.max(0, Math.abs(z - cz) - halfD);

  // Steep cliffs on W, N, S (200m margin); gentler eastern slope (400m)
  const isEast = x > cx + halfW;
  const cliffMarginX = isEast ? 400 : 200;
  const cliffMarginZ = 200;

  const fx = 1 - smoothstep(0, cliffMarginX, edgeX);
  const fz = 1 - smoothstep(0, cliffMarginZ, edgeZ);
  return plateauH * fx * fz;
}

// Signal Hill — rounded hill r=400m, h=120m, gaussian falloff
function signalHillHeight(x, z) {
  const cx = SIGNAL_HILL_X, cz = SIGNAL_HILL_Z;
  const r = 400, h = 120;
  const dx = x - cx, dz = z - cz;
  const distSq = dx * dx + dz * dz;
  const rSq = r * r;
  if (distSq > rSq * 4) return 0; // early out
  return h * Math.exp(-distSq / (2 * rSq * 0.18));
}

// International airport flatten — large rectangular zone for E-W runways
function intlAirportFlattenFactor(x, z) {
  const halfW = 2000; // 4000m total width (E-W, along runway length)
  const halfD = 1000; // 2000m total depth (N-S, covers both runways + terminals)
  const margin = 400;
  const dx = Math.max(0, Math.abs(x - INTL_AIRPORT_X) - halfW);
  const dz = Math.max(0, Math.abs(z - INTL_AIRPORT_Z) - halfD);
  const dist = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(0, margin, dist);
}

function runwayFlattenFactor(x, z) {
  // Airport 1 at origin
  const f1 = airportFlattenFactor(x, z, 0, 0);
  // Airport 2
  const f2 = airportFlattenFactor(x, z, AIRPORT2_X, AIRPORT2_Z);
  const f3 = cityFlattenFactor(x, z);
  const f4 = highwayFlattenFactor(x, z);
  const f5 = capeTownFlattenFactor(x, z);
  // International airport
  const f6 = intlAirportFlattenFactor(x, z);
  return Math.max(f1, f2, f3, f4, f5, f6);
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

  // Add Table Mountain and Signal Hill
  const withMountains = Math.max(landHeight, tableMountainHeight(x, z), signalHillHeight(x, z));

  // Apply ocean depression east of coastline
  const ocean = oceanFactor(x, z);
  if (ocean <= 0) return withMountains;
  return withMountains * (1 - ocean) - ocean * OCEAN_DEPTH;
}

export function isInOcean(x, z) {
  return oceanFactor(x, z) > 0.5;
}

// ── Terrain height cache (Float32Array for fast bilinear lookups) ──
const CACHE_RES = TERRAIN_SEGMENTS; // 384x384 grid
let heightCache = null;

export function buildTerrainHeightCache() {
  heightCache = new Float32Array(CACHE_RES * CACHE_RES);
  const halfSize = TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / CACHE_RES;
  for (let row = 0; row < CACHE_RES; row++) {
    const z = -halfSize + (row + 0.5) * step;
    for (let col = 0; col < CACHE_RES; col++) {
      const x = -halfSize + (col + 0.5) * step;
      heightCache[row * CACHE_RES + col] = getTerrainHeight(x, z);
    }
  }
}

export function getTerrainHeightCached(x, z) {
  if (!heightCache) return getTerrainHeight(x, z);
  const halfSize = TERRAIN_SIZE / 2;
  // Convert world coords to grid coords (continuous)
  const gx = ((x + halfSize) / TERRAIN_SIZE) * CACHE_RES - 0.5;
  const gz = ((z + halfSize) / TERRAIN_SIZE) * CACHE_RES - 0.5;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  // Clamp to grid bounds
  const x0 = Math.max(0, Math.min(CACHE_RES - 1, ix));
  const x1 = Math.max(0, Math.min(CACHE_RES - 1, ix + 1));
  const z0 = Math.max(0, Math.min(CACHE_RES - 1, iz));
  const z1 = Math.max(0, Math.min(CACHE_RES - 1, iz + 1));
  // Bilinear interpolation
  const h00 = heightCache[z0 * CACHE_RES + x0];
  const h10 = heightCache[z0 * CACHE_RES + x1];
  const h01 = heightCache[z1 * CACHE_RES + x0];
  const h11 = heightCache[z1 * CACHE_RES + x1];
  return (h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) +
          h01 * (1 - fx) * fz + h11 * fx * fz);
}

// Ground level for physics — terrain or water surface, whichever is higher
const WATER_SURFACE_Y = -2;
export function getGroundLevel(x, z) {
  return Math.max(getTerrainHeightCached(x, z), WATER_SURFACE_Y);
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

function applyBiomeTerrainShader(material) {
  material.customProgramCacheKey = () => 'terrain-biome-v4-stepped';
  material.onBeforeCompile = (shader) => {
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
varying vec3 vWorldPos;
varying vec3 vWorldNormal;`
      )
      .replace(
        '#include <map_fragment>',
        `// Stylized stepped elevation bands
vec3 sandColor = vec3(0.76, 0.70, 0.50);
vec3 grassColor = vec3(0.40, 0.65, 0.30);
vec3 darkGrassColor = vec3(0.25, 0.45, 0.20);
vec3 rockColor = vec3(0.50, 0.48, 0.45);
vec3 snowColor = vec3(0.95, 0.95, 0.97);

float h = vWorldPos.y;
vec3 terrainColor = sandColor;
terrainColor = mix(terrainColor, grassColor, smoothstep(2.0, 8.0, h));
terrainColor = mix(terrainColor, darkGrassColor, smoothstep(40.0, 60.0, h));
terrainColor = mix(terrainColor, rockColor, smoothstep(120.0, 150.0, h));
terrainColor = mix(terrainColor, snowColor, smoothstep(300.0, 340.0, h));

// Steep slopes -> rock
float slope = 1.0 - vWorldNormal.y;
terrainColor = mix(terrainColor, rockColor, smoothstep(0.3, 0.6, slope));

// Shore wetness: darken near y=0
float shore = 1.0 - smoothstep(0.0, 5.0, h);
vec3 wetColor = terrainColor * vec3(0.7, 0.75, 0.8);
terrainColor = mix(terrainColor, wetColor, shore * 0.5);

diffuseColor = vec4(terrainColor, 1.0);`
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

  const normalMap = createTerrainNormalMap(1);

  const material = new THREE.MeshStandardMaterial({
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.24, 0.24),
    roughness: 0.88,
    metalness: 0.0,
  });
  applyBiomeTerrainShader(material);

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

function isInCapeTownZone(x, z) {
  const halfX = CT_SIZE_X / 2 + 100;
  const halfZ = CT_SIZE_Z / 2 + 100;
  return Math.abs(x - CT_CENTER_X) < halfX && Math.abs(z - CT_CENTER_Z) < halfZ;
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
  low: { trees: 1500, bushes: 600, deadTrees: 200, nearRadius: 900, midRadius: 2600, nearTreeCap: 500, nearBushCap: 300, nearDeadCap: 80, impostorCap: 800 },
  medium: { trees: 2800, bushes: 1000, deadTrees: 350, nearRadius: 1150, midRadius: 3200, nearTreeCap: 900, nearBushCap: 500, nearDeadCap: 140, impostorCap: 1500 },
  high: { trees: 4000, bushes: 1500, deadTrees: 500, nearRadius: 1450, midRadius: 3900, nearTreeCap: 1400, nearBushCap: 700, nearDeadCap: 200, impostorCap: 2400 },
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

function createVegetationMesh(geometry, material, count, castShadow = false) {
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
    if (isInCapeTownZone(x, z)) continue;
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
    if (isInCapeTownZone(x, z)) continue;
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
    if (isInCapeTownZone(x, z)) continue;
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
    if (isInCapeTownZone(x, z)) continue;
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
    if (isInCapeTownZone(x, z)) continue;
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
    siloBodyMesh.receiveShadow = true;

    const siloCapGeo = new THREE.SphereGeometry(1.55, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const siloCapMat = new THREE.MeshLambertMaterial({ color: 0x8f949a });
    const siloCapMesh = new THREE.InstancedMesh(siloCapGeo, siloCapMat, siloPositions.length);
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

  // ── Cape Town highway spur ──
  const spurControlPoints = HIGHWAY_SPUR_CT.map(([sx, sz]) => {
    const sy = getTerrainHeight(sx, sz) + 0.2;
    return new THREE.Vector3(sx, sy, sz);
  });
  const spurCurve = new THREE.CatmullRomCurve3(spurControlPoints, false, 'catmullrom', 0.3);
  const spurSegs = 150;
  const spurRoadTex = roadTex.clone();
  spurRoadTex.repeat.set(spurSegs / 4, 1);

  const spurVerts = [];
  const spurUVs = [];
  const spurIdx = [];
  for (let i = 0; i <= spurSegs; i++) {
    const t = i / spurSegs;
    const pt = spurCurve.getPointAt(t);
    const tan = spurCurve.getTangentAt(t);
    const perp = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const tH = getTerrainHeight(pt.x, pt.z) + 0.2;
    spurVerts.push(pt.x - perp.x * roadWidth * 0.5, tH, pt.z - perp.z * roadWidth * 0.5);
    spurVerts.push(pt.x + perp.x * roadWidth * 0.5, tH, pt.z + perp.z * roadWidth * 0.5);
    const u = t * (spurSegs / 4);
    spurUVs.push(u, 0);
    spurUVs.push(u, 1);
    if (i < spurSegs) {
      const si = i * 2;
      spurIdx.push(si, si + 1, si + 2, si + 1, si + 3, si + 2);
    }
  }
  const spurGeo = new THREE.BufferGeometry();
  spurGeo.setAttribute('position', new THREE.Float32BufferAttribute(spurVerts, 3));
  spurGeo.setAttribute('uv', new THREE.Float32BufferAttribute(spurUVs, 2));
  spurGeo.setIndex(spurIdx);
  spurGeo.computeVertexNormals();
  const spurMesh = new THREE.Mesh(spurGeo, roadMat.clone());
  spurMesh.material.map = spurRoadTex;
  spurMesh.receiveShadow = true;
  scene.add(spurMesh);

  // Add spur sample points to highway sample points for road-avoidance checks
  const spurSamples = spurCurve.getPoints(spurSegs);
  highwaySamplePoints = highwaySamplePoints.concat(spurSamples);
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
    if (isInCapeTownZone(x, z)) continue;
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
let cloudCumulusMats = [];
let cloudShadowMats = [];

const CLOUD_QUALITY_CONFIG = {
  low: {
    cumulusCount: 90,
    area: 50000,
  },
  medium: {
    cumulusCount: 190,
    area: 52000,
  },
  high: {
    cumulusCount: 320,
    area: 56000,
  },
};
const CLOUD_DENSITY_ORDER = ['none', 'few', 'normal', 'many'];
const CLOUD_DENSITY_MULTIPLIER = { none: 0, few: 0.5, normal: 0.9, many: 1.18 };

// Soft cotton-ball cloud puff texture (128px for stylized cartoon look)
function createCloudTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mid = size / 2;

  // Soft radial gradient with very gentle edges
  const g1 = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  g1.addColorStop(0, 'rgba(255,255,255,1.0)');
  g1.addColorStop(0.2, 'rgba(255,255,255,0.95)');
  g1.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g1.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g1.addColorStop(0.8, 'rgba(255,255,255,0.1)');
  g1.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, size, size);

  // Off-center lumps for organic cotton-ball shape
  const offsets = [
    { x: mid * 0.7, y: mid * 0.85, r: mid * 0.55 },
    { x: mid * 1.25, y: mid * 0.9, r: mid * 0.5 },
  ];
  for (const o of offsets) {
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    g.addColorStop(0, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

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
  cloudShadowMats = [];

  if (!cloudPuffTexture) cloudPuffTexture = createCloudTexture();
  const quality = CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high;
  const opacityBase = Math.max(0.16, Math.min(0.96, weatherCloudProfile.cloudOpacity || 0.28));

  const cumulusOpacities = [0.55, 0.65, 0.75, 0.85];
  const shadowOpacities = [0.15, 0.22];

  for (let i = 0; i < cumulusOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudPuffTexture,
      transparent: true,
      opacity: Math.min(0.98, cumulusOpacities[i] * (0.7 + opacityBase * 0.95)),
      depthWrite: false,
      fog: false,
      color: 0xffffff,
    });
    mat.userData.role = 'cumulus';
    cloudCumulusMats.push(mat);
    cloudMaterials.push(mat);
  }

  for (let i = 0; i < shadowOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudPuffTexture,
      transparent: true,
      opacity: Math.min(0.4, shadowOpacities[i] * (0.65 + opacityBase * 0.8)),
      depthWrite: false,
      fog: false,
      color: 0xcccccc,
    });
    mat.userData.role = 'shadow';
    cloudShadowMats.push(mat);
    cloudMaterials.push(mat);
  }

  const area = quality.area;
  const totalCount = quality.cumulusCount;

  // Cumulus-only clusters: 3-5 large puffs each, flat cartoon look
  for (let c = 0; c < totalCount; c++) {
    const cluster = new THREE.Group();
    cluster.position.set(
      (Math.random() - 0.5) * area,
      520 + Math.random() * 520,
      (Math.random() - 0.5) * area
    );
    cluster.userData.type = 'cumulus';
    cluster.userData.drift = 0.8 + Math.random() * 0.5;

    const cloudW = 500 + Math.random() * 600;
    const cloudD = 400 + Math.random() * 400;
    const cloudH = 30 + Math.random() * 40; // flatter arrangement
    const puffCount = 3 + Math.floor(Math.random() * 3); // 3-5 puffs

    for (let p = 0; p < puffCount; p++) {
      const mat = cloudCumulusMats[Math.floor(Math.random() * cloudCumulusMats.length)];
      const sprite = new THREE.Sprite(mat);
      // 2-3x scale for big puffy cartoon look
      const s = 400 + Math.random() * 500;
      sprite.scale.set(s, s * (0.45 + Math.random() * 0.2), 1);
      sprite.position.set(
        (Math.random() - 0.5) * cloudW,
        (Math.random() - 0.5) * cloudH,
        (Math.random() - 0.5) * cloudD
      );
      cluster.add(sprite);
    }

    // Underside shadow puff (1-2 per cluster)
    const shadeCount = 1 + Math.floor(Math.random() * 2);
    for (let s = 0; s < shadeCount; s++) {
      const mat = cloudShadowMats[Math.floor(Math.random() * cloudShadowMats.length)];
      const sprite = new THREE.Sprite(mat);
      const sz = 350 + Math.random() * 300;
      sprite.scale.set(sz, sz * 0.3, 1);
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * 0.5,
        -cloudH * 0.6 - Math.random() * 10,
        (Math.random() - 0.5) * cloudD * 0.5
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

// Cloud color palettes for direct assignment
const CLOUD_PALETTES = {
  day:   { base: new THREE.Color(0xffffff), shadow: new THREE.Color(0xcccccc) },
  dawn:  { base: new THREE.Color(0xffccaa), shadow: new THREE.Color(0xcc8866) },
  dusk:  { base: new THREE.Color(0xff9966), shadow: new THREE.Color(0x996644) },
  night: { base: new THREE.Color(0x334455), shadow: new THREE.Color(0x222233) },
};

const _cloudBaseColor = new THREE.Color();
const _cloudShadowColor = new THREE.Color();

// Update cloud colors based on time of day
export function updateCloudColors(sunElevation) {
  let baseColor, shadowColor;

  if (sunElevation > 15) {
    baseColor = CLOUD_PALETTES.day.base;
    shadowColor = CLOUD_PALETTES.day.shadow;
  } else if (sunElevation > 2) {
    const t = (sunElevation - 2) / 13;
    _cloudBaseColor.copy(CLOUD_PALETTES.dawn.base).lerp(CLOUD_PALETTES.day.base, t);
    _cloudShadowColor.copy(CLOUD_PALETTES.dawn.shadow).lerp(CLOUD_PALETTES.day.shadow, t);
    baseColor = _cloudBaseColor;
    shadowColor = _cloudShadowColor;
  } else if (sunElevation > -2) {
    const t = (sunElevation + 2) / 4;
    _cloudBaseColor.copy(CLOUD_PALETTES.dusk.base).lerp(CLOUD_PALETTES.dawn.base, t);
    _cloudShadowColor.copy(CLOUD_PALETTES.dusk.shadow).lerp(CLOUD_PALETTES.dawn.shadow, t);
    baseColor = _cloudBaseColor;
    shadowColor = _cloudShadowColor;
  } else if (sunElevation > -5) {
    const t = (sunElevation + 5) / 3;
    _cloudBaseColor.copy(CLOUD_PALETTES.night.base).lerp(CLOUD_PALETTES.dusk.base, t);
    _cloudShadowColor.copy(CLOUD_PALETTES.night.shadow).lerp(CLOUD_PALETTES.dusk.shadow, t);
    baseColor = _cloudBaseColor;
    shadowColor = _cloudShadowColor;
  } else {
    baseColor = CLOUD_PALETTES.night.base;
    shadowColor = CLOUD_PALETTES.night.shadow;
  }

  for (let i = 0; i < cloudMaterials.length; i++) {
    const mat = cloudMaterials[i];
    if (mat.userData.role === 'shadow') {
      mat.color.copy(shadowColor);
    } else {
      mat.color.copy(baseColor);
    }
  }
}

function getCloudActiveLimit() {
  const quality = CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high;
  const baseCount = quality.cumulusCount;
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
    const base = [0.55, 0.65, 0.75, 0.85][i] || 0.65;
    mat.opacity = Math.min(0.98, base * (0.7 + opacityBase * 0.95));
  }
  for (let i = 0; i < cloudShadowMats.length; i++) {
    const mat = cloudShadowMats[i];
    const base = [0.15, 0.22][i] || 0.18;
    mat.opacity = Math.min(0.4, base * (0.65 + opacityBase * 0.8));
  }

  applyCloudDensity();
}

// Stylized water with custom shader
let water;
let waterMat;

export function createWater(sceneRef) {
  const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128);
  waterGeo.rotateX(-Math.PI / 2);

  waterMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      shallowColor: { value: new THREE.Color(0.15, 0.65, 0.65) },
      deepColor: { value: new THREE.Color(0.05, 0.2, 0.4) },
      cameraPos: { value: new THREE.Vector3() },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0.00004 },
    },
    vertexShader: `
      uniform float time;
      varying vec3 vWorldPos;
      varying float vWaveHeight;
      void main() {
        vec3 pos = position;
        float wave = sin(pos.x * 0.02 + time) * cos(pos.z * 0.015 + time * 0.7) * 1.5;
        wave += sin(pos.x * 0.035 - time * 0.8) * cos(pos.z * 0.025 + time * 0.5) * 0.8;
        pos.y += wave;
        vWaveHeight = wave;
        vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 shallowColor, deepColor, cameraPos, fogColor;
      uniform float fogDensity;
      varying vec3 vWorldPos;
      varying float vWaveHeight;
      void main() {
        vec3 viewDir = normalize(cameraPos - vWorldPos);
        float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
        vec3 water = mix(shallowColor, deepColor, fresnel);
        // Foam highlights on wave peaks
        water += vec3(0.15) * smoothstep(0.3, 1.5, vWaveHeight);
        // Fog integration
        float dist = length(vWorldPos - cameraPos);
        float fogFactor = 1.0 - exp(-fogDensity * dist * dist);
        water = mix(water, fogColor, fogFactor);
        gl_FragColor = vec4(water, 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -2;
  sceneRef.add(water);
  return water;
}

export function updateWater(dt, windVector, camera) {
  if (!waterMat) return;
  const windSpeed = windVector ? Math.hypot(windVector.x, windVector.z) : 0;
  const timeScale = 0.5 + Math.min(0.6, windSpeed * 0.02);
  waterMat.uniforms.time.value += dt * timeScale;
  if (camera) {
    waterMat.uniforms.cameraPos.value.copy(camera.position);
  }
  if (sceneRef && sceneRef.fog) {
    waterMat.uniforms.fogColor.value.copy(sceneRef.fog.color);
  }
}

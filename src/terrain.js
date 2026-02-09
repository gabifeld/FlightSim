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
} from './constants.js';
import { smoothstep } from './utils.js';
import { getSunDirection } from './scene.js';

const simplex = new SimplexNoise();

// Module-level highway spline for external access
let highwayCurve = null;
let highwaySamplePoints = null;

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
  const halfWid = RUNWAY_WIDTH / 2 + 250;
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

function runwayFlattenFactor(x, z) {
  // Airport 1 at origin
  const f1 = airportFlattenFactor(x, z, 0, 0);
  // Airport 2
  const f2 = airportFlattenFactor(x, z, AIRPORT2_X, AIRPORT2_Z);
  const f3 = cityFlattenFactor(x, z);
  return Math.max(f1, f2, f3);
}

export function getTerrainHeight(x, z) {
  const noise = sampleNoise(x, z);
  const rawHeight = ((noise + 1) / 2) * TERRAIN_MAX_HEIGHT;
  const flatten = runwayFlattenFactor(x, z);

  return rawHeight * (1 - flatten);
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

  // Add vertex colors based on height
  const colors = new Float32Array(posAttr.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);

    if (y < 2) {
      // Beach/shore - sandy color
      color.setRGB(0.76, 0.70, 0.50);
    } else if (y < 25) {
      // Lowland - lush green
      const t = (y - 2) / 23;
      color.setRGB(
        0.25 - t * 0.05,
        0.50 + t * 0.05,
        0.20 - t * 0.02
      );
    } else if (y < 80) {
      // Midlands - forest green fading to olive
      const t = (y - 25) / 55;
      color.setRGB(
        0.20 + t * 0.15,
        0.45 - t * 0.08,
        0.18 + t * 0.05
      );
    } else if (y < 180) {
      // Highlands - brown/tan
      const t = (y - 80) / 100;
      color.setRGB(
        0.45 + t * 0.10,
        0.38 - t * 0.05,
        0.25 - t * 0.03
      );
    } else {
      // Mountain - gray rock (all high peaks)
      const t = Math.max(0, Math.min(1, (y - 180) / 220));
      color.setRGB(
        0.50 + t * 0.08,
        0.48 + t * 0.08,
        0.45 + t * 0.10
      );
    }

    // Add random variation for natural look
    const noise = (Math.random() - 0.5) * 0.07;
    colors[i * 3] = Math.max(0, Math.min(1, color.r + noise));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, color.g + noise));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, color.b + noise));
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const grassTex = createGrassTexture();
  const normalMap = createTerrainNormalMap(1);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: grassTex,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.85,
    metalness: 0.0,
  });

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

// Use InstancedMesh for much better tree performance
export function createVegetation(scene) {
  const treePositions = [];

  // Tree canopy color palette - 8 shades including autumn touches
  const treeColors = [
    new THREE.Color(0x2d6b1e), // dark forest green
    new THREE.Color(0x3a8c25), // standard green
    new THREE.Color(0x4a9a35), // bright green
    new THREE.Color(0x2a5c1a), // deep green
    new THREE.Color(0x557733), // olive green
    new THREE.Color(0x6b8e23), // yellow-green (olive drab)
    new THREE.Color(0x8faa3a), // lime-green / autumn touch
    new THREE.Color(0x7a9a2e), // golden-green / autumn touch
  ];

  // Gather valid positions for trees using noise-based clustering
  for (let i = 0; i < 9000; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;

    // Skip airport areas, city, and roads
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;

    const h = getTerrainHeight(x, z);
    // Trees avoid water (h > 3) and very high altitudes (h < 250)
    if (h > 250 || h < 3) continue;

    // Noise-based density for forest patches
    const density = simplex.noise(x * 0.0008, z * 0.0008);
    // Higher density = more likely to place a tree (creates forest patches)
    if (Math.random() > (density + 1) * 0.45) continue;

    if (treePositions.length >= 6000) break;

    // Dramatic size variation: 0.5x to 2.0x
    const scale = 0.5 + Math.random() * 1.5;
    // Density also influences size slightly (denser forests = taller trees)
    const sizeBoost = density > 0.3 ? 1.0 + (density - 0.3) * 0.5 : 1.0;
    const finalScale = scale * sizeBoost;

    const type = Math.random() > 0.4 ? 'conifer' : 'deciduous';
    treePositions.push({ x, z, h, scale: finalScale, type });
  }

  // Bush positions
  const bushPositions = [];
  for (let i = 0; i < 6000; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h > TERRAIN_MAX_HEIGHT * 0.35 || h < 3) continue;
    if (bushPositions.length >= 4000) break;
    bushPositions.push({ x, z, h, scale: 0.5 + Math.random() * 1.0 });
  }

  // Dead tree positions
  const deadTreePositions = [];
  for (let i = 0; i < 1500; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h > TERRAIN_MAX_HEIGHT * 0.55 || h < 3) continue;
    if (deadTreePositions.length >= 1000) break;
    deadTreePositions.push({ x, z, h, scale: 1.0 + Math.random() * 2.0 });
  }

  const conifers = treePositions.filter(t => t.type === 'conifer');
  const deciduous = treePositions.filter(t => t.type === 'deciduous');

  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });

  const coneGeo = new THREE.ConeGeometry(1.5, 4, 6);
  const coniferMat = new THREE.MeshLambertMaterial({ color: 0x2d6b1e });

  const sphereGeo = new THREE.SphereGeometry(1.8, 6, 5);
  const deciduousMat = new THREE.MeshLambertMaterial({ color: 0x3a8c25 });

  const allTrees = treePositions;
  const dummy = new THREE.Object3D();

  // Instanced trunk mesh
  const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, allTrees.length);
  trunkInstanced.castShadow = true;

  for (let i = 0; i < allTrees.length; i++) {
    const t = allTrees[i];
    dummy.position.set(t.x, t.h + t.scale * 0.5, t.z);
    dummy.scale.setScalar(t.scale * 0.4);
    dummy.updateMatrix();
    trunkInstanced.setMatrixAt(i, dummy.matrix);
  }
  scene.add(trunkInstanced);

  // Conifer canopy instances (with per-instance color)
  const coniferInstanced = new THREE.InstancedMesh(coneGeo, coniferMat, conifers.length);
  coniferInstanced.castShadow = true;
  for (let i = 0; i < conifers.length; i++) {
    const t = conifers[i];
    dummy.position.set(t.x, t.h + t.scale * 1.8, t.z);
    dummy.scale.setScalar(t.scale * 0.5);
    dummy.updateMatrix();
    coniferInstanced.setMatrixAt(i, dummy.matrix);
    coniferInstanced.setColorAt(i, treeColors[Math.floor(Math.random() * treeColors.length)]);
  }
  coniferInstanced.instanceColor.needsUpdate = true;
  scene.add(coniferInstanced);

  // Deciduous canopy instances (with per-instance color)
  const deciduousInstanced = new THREE.InstancedMesh(sphereGeo, deciduousMat, deciduous.length);
  deciduousInstanced.castShadow = true;
  for (let i = 0; i < deciduous.length; i++) {
    const t = deciduous[i];
    dummy.position.set(t.x, t.h + t.scale * 1.6, t.z);
    dummy.scale.set(t.scale * 0.5, t.scale * 0.4, t.scale * 0.5);
    dummy.updateMatrix();
    deciduousInstanced.setMatrixAt(i, dummy.matrix);
    deciduousInstanced.setColorAt(i, treeColors[Math.floor(Math.random() * treeColors.length)]);
  }
  deciduousInstanced.instanceColor.needsUpdate = true;
  scene.add(deciduousInstanced);

  // Bushes (low spheres)
  const bushGeo = new THREE.SphereGeometry(1.0, 5, 4);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x3a7a20 });
  const bushInstanced = new THREE.InstancedMesh(bushGeo, bushMat, bushPositions.length);
  bushInstanced.castShadow = true;
  for (let i = 0; i < bushPositions.length; i++) {
    const b = bushPositions[i];
    dummy.position.set(b.x, b.h + b.scale * 0.3, b.z);
    dummy.scale.set(b.scale, b.scale * 0.6, b.scale);
    dummy.updateMatrix();
    bushInstanced.setMatrixAt(i, dummy.matrix);
  }
  scene.add(bushInstanced);

  // Dead trees (trunk only)
  const deadTrunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 5, 5);
  const deadTrunkMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
  const deadInstanced = new THREE.InstancedMesh(deadTrunkGeo, deadTrunkMat, deadTreePositions.length);
  deadInstanced.castShadow = true;
  for (let i = 0; i < deadTreePositions.length; i++) {
    const t = deadTreePositions[i];
    dummy.position.set(t.x, t.h + t.scale * 1.0, t.z);
    dummy.scale.setScalar(t.scale * 0.5);
    // Slight random lean
    dummy.rotation.set(
      (Math.random() - 0.5) * 0.2,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.2
    );
    dummy.updateMatrix();
    deadInstanced.setMatrixAt(i, dummy.matrix);
  }
  scene.add(deadInstanced);
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
    farmPositions.push({ x, z, h });
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
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    farmInstanced.setMatrixAt(i, dummy.matrix);
    farmInstanced.setColorAt(i, farmhouseColors[Math.floor(Math.random() * farmhouseColors.length)]);
  }
  if (farmPositions.length > 0) farmInstanced.instanceColor.needsUpdate = true;
  scene.add(farmInstanced);

  // Collect valid barn positions
  const barnPositions = [];
  for (let i = 0; i < 2000 && barnPositions.length < 25; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 2 || h > TERRAIN_MAX_HEIGHT * 0.2) continue;
    barnPositions.push({ x, z, h });
  }

  // Barns via InstancedMesh
  const barnGeo = new THREE.BoxGeometry(12, 6, 15);
  const barnMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
  const barnInstanced = new THREE.InstancedMesh(barnGeo, barnMat, barnPositions.length);
  barnInstanced.castShadow = true;
  barnInstanced.receiveShadow = true;
  const barnColor = new THREE.Color(0x8b4513);
  for (let i = 0; i < barnPositions.length; i++) {
    const p = barnPositions[i];
    dummy.position.set(p.x, p.h + 3, p.z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    barnInstanced.setMatrixAt(i, dummy.matrix);
    // Slight color variation for barns
    const variation = 0.9 + Math.random() * 0.2;
    barnInstanced.setColorAt(i, barnColor.clone().multiplyScalar(variation));
  }
  if (barnPositions.length > 0) barnInstanced.instanceColor.needsUpdate = true;
  scene.add(barnInstanced);
}

// Highway connecting Airport 1 → City → Airport 2
export function createHighway(scene) {
  // Define control points for a natural winding road
  const controlPoints = [
    new THREE.Vector3(0, 0, -200),           // Near Airport 1 (south end)
    new THREE.Vector3(400, 0, -800),
    new THREE.Vector3(1200, 0, -1600),
    new THREE.Vector3(2000, 0, -2400),
    new THREE.Vector3(2800, 0, -3000),
    new THREE.Vector3(3600, 0, -3600),
    new THREE.Vector3(CITY_CENTER_X, 0, CITY_CENTER_Z), // City center
    new THREE.Vector3(4800, 0, -4800),
    new THREE.Vector3(5600, 0, -5600),
    new THREE.Vector3(6400, 0, -6400),
    new THREE.Vector3(7200, 0, -7200),
    new THREE.Vector3(AIRPORT2_X, 0, AIRPORT2_Z + 200), // Near Airport 2
  ];

  // Sample terrain height for each control point
  for (const pt of controlPoints) {
    pt.y = getTerrainHeight(pt.x, pt.z) + 0.2;
  }

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5);

  // Store the highway curve and sample points for external access
  highwayCurve = curve;
  const segments = 200;
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
  for (let i = 0; i < 18000 && flowerPositions.length < 3000; i++) {
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
// Volumetric Cloud System
// ═══════════════════════════════════════════════════════════
let cloudGroup;
let cloudClusters = [];
let cloudDensity = 'normal';
let cloudMaterials = []; // for time-of-day color updates

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
  cloudGroup = new THREE.Group();
  cloudClusters = [];
  cloudMaterials = [];

  const puffTex = createCloudTexture();
  const wispTex = createWispTexture();

  // ── Cumulus clouds (main fluffy clouds) ──
  // High opacity for strong visibility from any angle
  const cumulusMats = [0.55, 0.65, 0.75, 0.85, 0.95].map(op => {
    const m = new THREE.SpriteMaterial({
      map: puffTex, transparent: true, opacity: op,
      depthWrite: false, fog: false, color: 0xffffff,
    });
    cloudMaterials.push(m);
    return m;
  });

  // Cirrus materials (high wispy)
  const cirrusMats = [0.3, 0.45, 0.55].map(op => {
    const m = new THREE.SpriteMaterial({
      map: wispTex, transparent: true, opacity: op,
      depthWrite: false, fog: false, color: 0xf0f0ff,
    });
    cloudMaterials.push(m);
    return m;
  });

  // ── Generate cumulus clouds ──
  const cumulusCount = 500;
  for (let c = 0; c < cumulusCount; c++) {
    const cx = (Math.random() - 0.5) * 26000;
    const cz = (Math.random() - 0.5) * 26000;
    const cy = 550 + Math.random() * 350; // 550-900m altitude

    // Cloud dimensions — wide and relatively flat
    const cloudW = 300 + Math.random() * 500;
    const cloudD = 200 + Math.random() * 350;
    const cloudH = 30 + Math.random() * 60;

    // More puffs = more volume: 10-18 sprites per cloud
    const puffCount = 10 + Math.floor(Math.random() * 9);
    const cluster = new THREE.Group();
    cluster.position.set(cx, cy, cz);
    cluster.userData.type = 'cumulus';
    cluster.userData.baseY = cy;

    for (let p = 0; p < puffCount; p++) {
      // Core puffs are denser, edge puffs are lighter
      const isCore = p < puffCount * 0.4;
      const mat = isCore
        ? cumulusMats[3 + Math.floor(Math.random() * 2)] // higher opacity
        : cumulusMats[Math.floor(Math.random() * 3)];     // lower opacity

      const sprite = new THREE.Sprite(mat);

      // Core puffs are bigger, edge puffs smaller
      const s = isCore
        ? (200 + Math.random() * 250)
        : (100 + Math.random() * 200);

      sprite.scale.set(s, s * (0.45 + Math.random() * 0.25), 1);

      // Core puffs cluster near center, edge puffs spread out
      const spread = isCore ? 0.3 : 1.0;
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * spread,
        (Math.random() - 0.5) * cloudH + (isCore ? cloudH * 0.1 : 0),
        (Math.random() - 0.5) * cloudD * spread
      );

      cluster.add(sprite);
    }

    // Bottom shading sprites — darker puffs underneath for depth
    const shadowCount = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < shadowCount; s++) {
      const shadowMat = new THREE.SpriteMaterial({
        map: puffTex, transparent: true, opacity: 0.25,
        depthWrite: false, fog: false, color: 0x888899,
      });
      cloudMaterials.push(shadowMat);
      const sprite = new THREE.Sprite(shadowMat);
      const sz = 150 + Math.random() * 200;
      sprite.scale.set(sz, sz * 0.3, 1);
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * 0.6,
        -cloudH * 0.5 - Math.random() * 15,
        (Math.random() - 0.5) * cloudD * 0.6
      );
      cluster.add(sprite);
    }

    cloudGroup.add(cluster);
    cloudClusters.push(cluster);
  }

  // ── Generate cirrus clouds (high altitude wisps) ──
  const cirrusCount = 125;
  for (let c = 0; c < cirrusCount; c++) {
    const cx = (Math.random() - 0.5) * 28000;
    const cz = (Math.random() - 0.5) * 28000;
    const cy = 1800 + Math.random() * 1200; // 1800-3000m

    const cluster = new THREE.Group();
    cluster.position.set(cx, cy, cz);
    cluster.userData.type = 'cirrus';
    cluster.userData.baseY = cy;

    const wispCount = 3 + Math.floor(Math.random() * 4);
    for (let w = 0; w < wispCount; w++) {
      const mat = cirrusMats[Math.floor(Math.random() * cirrusMats.length)];
      const sprite = new THREE.Sprite(mat);
      // Cirrus are wide and thin
      const sw = 400 + Math.random() * 600;
      sprite.scale.set(sw, sw * 0.08, 1);
      sprite.position.set(
        (Math.random() - 0.5) * 500,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 300
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

export function updateClouds(dt, windVector, cameraY) {
  if (!cloudGroup || !windVector) return;

  const driftX = windVector.x * dt * 0.3;
  const driftZ = windVector.z * dt * 0.3;
  const limit = CLOUD_DENSITY_LIMITS[cloudDensity];

  for (let i = 0; i < cloudClusters.length; i++) {
    const cluster = cloudClusters[i];

    // Density limit check
    if (i >= limit) { cluster.visible = false; continue; }

    // Wind drift (always update position even if hidden)
    cluster.position.x += driftX;
    cluster.position.z += driftZ;

    // Cirrus drifts faster (jetstream)
    if (cluster.userData.type === 'cirrus') {
      cluster.position.x += driftX * 2;
    }

    // Wrap at world boundaries
    if (cluster.position.x > 15000) cluster.position.x -= 30000;
    if (cluster.position.x < -15000) cluster.position.x += 30000;
    if (cluster.position.z > 15000) cluster.position.z -= 30000;
    if (cluster.position.z < -15000) cluster.position.z += 30000;

    // Hide cumulus when camera is well above them
    if (cameraY !== undefined && cluster.userData.type === 'cumulus') {
      cluster.visible = cameraY <= cluster.userData.baseY + 500;
    } else {
      cluster.visible = true;
    }
  }
}

// Update cloud colors based on time of day
export function updateCloudColors(sunElevation) {
  if (!cloudMaterials.length) return;
  const color = new THREE.Color();

  if (sunElevation > 15) {
    // Daytime — bright white
    color.setHex(0xffffff);
  } else if (sunElevation > 0) {
    // Sunset/sunrise — warm golden to pink
    const t = sunElevation / 15;
    color.setRGB(1.0, 0.75 + t * 0.25, 0.5 + t * 0.5);
  } else if (sunElevation > -5) {
    // Twilight — purple/pink
    const t = (sunElevation + 5) / 5;
    color.setRGB(0.5 + t * 0.5, 0.3 + t * 0.45, 0.5);
  } else {
    // Night — dark blue-gray
    color.setRGB(0.15, 0.15, 0.2);
  }

  for (const mat of cloudMaterials) {
    mat.color.copy(color);
  }
}

const CLOUD_DENSITY_ORDER = ['none', 'few', 'normal', 'many'];
const CLOUD_DENSITY_LIMITS = { none: 0, few: 150, normal: 400, many: 625 };

function applyCloudDensity() {
  const limit = CLOUD_DENSITY_LIMITS[cloudDensity];
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

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 8;
      const v = y / size * Math.PI * 8;
      const wave = Math.sin(u + v * 0.5) * 0.5 + Math.sin(u * 2.3 - v * 1.7) * 0.3 + Math.sin(u * 0.7 + v * 3.1) * 0.2;

      const idx = (y * size + x) * 4;
      data[idx] = (wave * 0.5 + 0.5) * 255;
      data[idx + 1] = 128;
      data[idx + 2] = (wave * 0.5 + 0.5) * 255;
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

export function updateWater(dt) {
  if (!water) return;
  water.material.uniforms['time'].value += dt;
}

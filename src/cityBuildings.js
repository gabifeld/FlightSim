// ── City Buildings ──────────────────────────────────────────────────
// District-aware building generation with merged BufferGeometry.
// Driven by roadGraph lots + cityData building pools.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDING_POOLS, getActivityMultiplier, DISTRICTS } from './cityData.js';

// ── Module state ────────────────────────────────────────────────────

const buildingMeshes = [];
const districtMaterials = [];  // { district, material } entries for emissive updates
let parkedCarMesh = null;
let _cameraRef = null;         // set during creation for LOD checks
let _simplifiedMeshes = [];    // low-detail stand-ins beyond LOD distance

const LOD_DISTANCE = 3000;

// ── Seeded PRNG ─────────────────────────────────────────────────────

let _seed = 98765;
function sr() {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed & 0x7fffffff) / 0x7fffffff;
}
function rr(lo, hi) { return lo + sr() * (hi - lo); }
function pick(arr) { return arr[Math.floor(sr() * arr.length)]; }

// ── District center lookup ──────────────────────────────────────────

const _districtCenters = {};
for (const d of DISTRICTS) {
  _districtCenters[d.type] = { x: d.center[0], z: d.center[1], radius: d.radius };
}

// ── Style color palettes ────────────────────────────────────────────

const STYLE_COLORS = {
  glass:      [0x88aacc, 0x7799bb, 0x99bbdd],
  stone:      [0xaa9988, 0xbbaa99, 0x998877],
  storefront: [0xcc8844, 0xddaa66, 0xbbcc88],
  house:      [0xccaa88, 0xddbbaa, 0xaabb99, 0x99aacc],
  apartment:  [0xccbb99, 0xddccaa, 0xbbaa88],
  metal:      [0x666677, 0x555566, 0x777788],
  concrete:   [0x888888, 0x999999, 0x777777],
  nautical:   [0xaaccdd, 0xddeeee, 0xccddbb],
};

// ── Style material properties ───────────────────────────────────────

const STYLE_PROPS = {
  glass:      { metalness: 0.5,  roughness: 0.3 },
  stone:      { metalness: 0.05, roughness: 0.7 },
  storefront: { metalness: 0.05, roughness: 0.6 },
  house:      { metalness: 0.05, roughness: 0.7 },
  apartment:  { metalness: 0.05, roughness: 0.65 },
  metal:      { metalness: 0.3,  roughness: 0.8 },
  concrete:   { metalness: 0.05, roughness: 0.9 },
  nautical:   { metalness: 0.1,  roughness: 0.6 },
};

// ── District base tint ──────────────────────────────────────────────

const DISTRICT_TINTS = {
  downtown:    0x8899aa,
  commercial:  0xaa8866,
  residential: 0xbbaa88,
  industrial:  0x667077,
  waterfront:  0x99bbcc,
};

// ── District material properties ─────────────────────────────────────
// Maps each district to the dominant style's metalness/roughness.

const DISTRICT_MAT_PROPS = {
  downtown:    { metalness: 0.4,  roughness: 0.35 },  // glass towers
  commercial:  { metalness: 0.08, roughness: 0.6  },  // storefronts
  residential: { metalness: 0.05, roughness: 0.7  },  // houses/apartments
  industrial:  { metalness: 0.25, roughness: 0.85 },  // metal/concrete
  waterfront:  { metalness: 0.1,  roughness: 0.55 },  // nautical
};

// ── Procedural window texture ───────────────────────────────────────

function createWindowTexture(districtType) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Dark base — building wall
  const tint = DISTRICT_TINTS[districtType] || 0x888888;
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  const wallR = Math.floor(r * 0.4);
  const wallG = Math.floor(g * 0.4);
  const wallB = Math.floor(b * 0.4);
  ctx.fillStyle = `rgb(${wallR},${wallG},${wallB})`;
  ctx.fillRect(0, 0, 128, 64);

  // Window grid — 4 columns x 4 rows
  const cols = 4, rows = 4;
  const winW = 20, winH = 10;
  const padX = (128 - cols * winW) / (cols + 1);
  const padY = (64 - rows * winH) / (rows + 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // 30% chance window is off
      if (sr() < 0.3) continue;
      const wx = padX + col * (winW + padX);
      const wy = padY + row * (winH + padY);
      const bright = 140 + Math.floor(sr() * 80);
      ctx.fillStyle = `rgb(${bright},${bright - 10},${bright - 30})`;
      ctx.fillRect(wx, wy, winW, winH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  return tex;
}

// ── Geometry normalisation ────────────────────────────────────────
// Ensures every geometry has exactly {position, normal, uv} and is non-indexed.
// This prevents mergeGeometries failures when mixing BoxGeometry (indexed, has uv)
// with ExtrudeGeometry (indexed, has uv but sometimes different attribute counts)
// or any other geometry that may lack uv or carry extra attributes.

function normalizeGeometry(geo) {
  // 1. Convert to non-indexed
  let g = geo.index ? geo.toNonIndexed() : geo;

  // 2. Ensure 'normal' attribute exists
  if (!g.getAttribute('normal')) {
    g.computeVertexNormals();
  }

  // 3. Ensure 'uv' attribute exists — fill with zeros if missing
  if (!g.getAttribute('uv')) {
    const count = g.getAttribute('position').count;
    const uvs = new Float32Array(count * 2); // all zeros
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  // 4. Strip any extra attributes beyond position/normal/uv
  const allowed = new Set(['position', 'normal', 'uv']);
  const names = Object.keys(g.attributes);
  for (const name of names) {
    if (!allowed.has(name)) {
      g.deleteAttribute(name);
    }
  }

  return g;
}

// ── Building geometry builders ──────────────────────────────────────

function createBuildingGeometry(style, w, h, d) {
  if (style === 'house') {
    return createHouseGeometry(w, h, d);
  }
  if (style === 'storefront') {
    return createStorefrontGeometry(w, h, d);
  }
  // Default: simple box
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  return geo;
}

function createHouseGeometry(w, h, d) {
  // Box body + triangular prism roof
  const bodyH = h * 0.7;
  const roofH = h * 0.3;

  const body = new THREE.BoxGeometry(w, bodyH, d);
  body.translate(0, bodyH / 2, 0);

  // Triangular prism roof via ExtrudeGeometry
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2, 0);
  roofShape.lineTo(0, roofH);
  roofShape.lineTo(w / 2, 0);
  roofShape.closePath();

  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: d,
    bevelEnabled: false,
  });
  // Rotate so extrusion goes along Z, then position above body
  roofGeo.rotateX(-Math.PI / 2);
  roofGeo.translate(0, bodyH, d / 2);

  // Normalise both geometries to identical attribute sets before merging
  const bodyNorm = normalizeGeometry(body);
  const roofNorm = normalizeGeometry(roofGeo);
  const merged = mergeGeometries([bodyNorm, roofNorm]);
  if (merged) {
    body.dispose();
    roofGeo.dispose();
    if (bodyNorm !== body) bodyNorm.dispose();
    if (roofNorm !== roofGeo) roofNorm.dispose();
    return merged;
  }
  // Fallback: just the box body (roof merge failed)
  roofGeo.dispose();
  if (roofNorm !== roofGeo) roofNorm.dispose();
  if (bodyNorm !== body) bodyNorm.dispose();
  return body;
}

function createStorefrontGeometry(w, h, d) {
  // Slightly wider ground floor
  const groundH = Math.min(4, h * 0.35);
  const upperH = h - groundH;
  const groundW = w * 1.05;

  const ground = new THREE.BoxGeometry(groundW, groundH, d);
  ground.translate(0, groundH / 2, 0);

  if (upperH > 0.5) {
    const upper = new THREE.BoxGeometry(w, upperH, d);
    upper.translate(0, groundH + upperH / 2, 0);
    const merged = mergeGeometries([ground, upper]);
    if (merged) {
      ground.dispose();
      upper.dispose();
      return merged;
    }
    // Fallback: just ground floor
    upper.dispose();
    return ground;
  }

  return ground;
}

// ── Main creation ───────────────────────────────────────────────────

export function createCityBuildings(scene, graph, getHeightAt) {
  disposeCityBuildings();
  _seed = 98765;

  if (!graph || !graph.lots || graph.lots.length === 0) return;

  // Group lots by district
  const lotsByDistrict = {};
  for (const d of DISTRICTS) lotsByDistrict[d.type] = [];

  for (const lot of graph.lots) {
    const dt = lot.district;
    if (!lotsByDistrict[dt]) lotsByDistrict[dt] = [];
    lotsByDistrict[dt].push(lot);
  }

  // Per-district: collect geometries, build merged mesh
  const emptyLots = [];  // for parked cars

  for (const districtType of Object.keys(lotsByDistrict)) {
    const lots = lotsByDistrict[districtType];
    if (lots.length === 0) continue;

    const pool = BUILDING_POOLS[districtType];
    if (!pool || pool.length === 0) continue;

    const center = _districtCenters[districtType];
    const geos = [];

    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];

      // Skip some lots to create natural gaps (parks, yards, parking, empty space)
      // Downtown: dense, only skip ~10%
      // Residential: skip ~30% for yards and green space
      // Commercial/industrial: skip ~20% for parking lots
      // Waterfront: skip ~25% for open space
      const skipChance = districtType === 'downtown' ? 0.10
        : districtType === 'residential' ? 0.30
        : districtType === 'waterfront' ? 0.25
        : 0.20;
      if (sr() < skipChance) {
        emptyLots.push(lot);
        continue;
      }

      // Select building type from pool
      const entry = pick(pool);

      // Height: random within [minH, maxH], biased taller near district center
      let distToCenter = 1;
      if (center) {
        const dx = lot.x - center.x;
        const dz = lot.z - center.z;
        distToCenter = Math.sqrt(dx * dx + dz * dz) / Math.max(center.radius, 1);
      }
      const centerBias = Math.max(0, 1 - distToCenter * 0.8); // 1.0 at center, ~0.2 at edge
      const baseHeight = rr(entry.minH, entry.maxH);
      const height = baseHeight * (0.6 + 0.4 * centerBias);

      // Footprint with setback + gap between adjacent buildings
      const setback = entry.setback;
      const gap = 1.5; // 1.5m gap between buildings on all sides
      const fw = Math.max(2, lot.width - setback * 2 - gap * 2);
      const fd = Math.max(2, lot.depth - setback * 2 - gap * 2);

      // Terrain-sampled base
      const baseY = getHeightAt(lot.x, lot.z);

      // Build geometry
      const geo = createBuildingGeometry(entry.style, fw, height, fd);
      if (!geo) continue;

      // Apply lot rotation and position
      const rotMat = new THREE.Matrix4().makeRotationY(lot.rotation || 0);
      const posMat = new THREE.Matrix4().makeTranslation(lot.x, baseY, lot.z);
      const mat4 = posMat.multiply(rotMat);
      geo.applyMatrix4(mat4);

      geos.push(geo);
    }

    if (geos.length === 0) continue;

    // Normalise: ensure every geometry has identical attributes {position, normal, uv}
    // and is non-indexed, so mergeGeometries never fails on mixed geometry types
    const normGeos = geos.map(g => normalizeGeometry(g));

    // Merge all geometries for this district
    const mergedGeo = mergeGeometries(normGeos);
    // Dispose individual geometries
    for (const g of geos) g.dispose();
    for (const g of normGeos) { if (!geos.includes(g)) g.dispose(); }

    if (!mergedGeo) continue;

    // Create district material with window texture
    const windowTex = createWindowTexture(districtType);

    // Compute average UV repeat from typical building size
    windowTex.repeat.set(1, 1);

    const tint = DISTRICT_TINTS[districtType] || 0x888888;
    const matProps = DISTRICT_MAT_PROPS[districtType] || { metalness: 0.1, roughness: 0.7 };
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      map: windowTex,
      emissive: new THREE.Color(0xffcc66),
      emissiveIntensity: 0,   // starts off; updateBuildingEmissive activates at night
      roughness: matProps.roughness,
      metalness: matProps.metalness,
    });

    const mesh = new THREE.Mesh(mergedGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `buildings_${districtType}`;
    scene.add(mesh);

    buildingMeshes.push(mesh);
    districtMaterials.push({ district: districtType, material: mat });

    // Build simplified LOD mesh (bounding box stand-in)
    mergedGeo.computeBoundingBox();
    const bb = mergedGeo.boundingBox;
    if (bb) {
      const size = new THREE.Vector3();
      bb.getSize(size);
      const ctr = new THREE.Vector3();
      bb.getCenter(ctr);

      const simplGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
      const simplMat = new THREE.MeshLambertMaterial({ color: tint });
      const simplMesh = new THREE.Mesh(simplGeo, simplMat);
      simplMesh.position.copy(ctr);
      simplMesh.castShadow = true;
      simplMesh.receiveShadow = true;
      simplMesh.visible = false;
      simplMesh.name = `buildings_${districtType}_lod`;
      scene.add(simplMesh);

      buildingMeshes.push(simplMesh);
      _simplifiedMeshes.push({
        detailed: mesh,
        simplified: simplMesh,
        center: ctr.clone(),
      });
    }
  }

  // ── Parked cars on empty lots ───────────────────────────────────────
  createParkedCars(scene, emptyLots, getHeightAt);
}

// ── Parked cars ─────────────────────────────────────────────────────

const CAR_COLORS = [
  new THREE.Color(0x333344),
  new THREE.Color(0xcccccc),
  new THREE.Color(0x882222),
];
const MAX_PARKED_CARS = 300;

function createParkedCars(scene, emptyLots, getHeightAt) {
  if (emptyLots.length === 0) return;

  const carGeo = new THREE.BoxGeometry(4.5, 1.4, 1.8);
  carGeo.translate(0, 0.7, 0); // sit on ground
  const carMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  let totalCars = 0;
  const positions = [];  // { x, y, z, rot, colorIdx }

  for (const lot of emptyLots) {
    if (totalCars >= MAX_PARKED_CARS) break;
    const numCars = 3 + Math.floor(sr() * 6); // 3-8 cars
    const baseY = getHeightAt(lot.x, lot.z);
    const spacing = Math.min(lot.width / numCars, 5.5);

    for (let c = 0; c < numCars && totalCars < MAX_PARKED_CARS; c++) {
      const cx = lot.x + (c - numCars / 2) * spacing;
      const cz = lot.z + rr(-lot.depth * 0.2, lot.depth * 0.2);
      positions.push({
        x: cx, y: baseY, z: cz,
        rot: (lot.rotation || 0) + rr(-0.05, 0.05),
        colorIdx: Math.floor(sr() * CAR_COLORS.length),
      });
      totalCars++;
    }
  }

  if (positions.length === 0) return;

  parkedCarMesh = new THREE.InstancedMesh(carGeo, carMat, positions.length);
  parkedCarMesh.castShadow = true;
  parkedCarMesh.receiveShadow = true;
  parkedCarMesh.name = 'parked_cars';

  const dummy = new THREE.Object3D();

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.updateMatrix();
    parkedCarMesh.setMatrixAt(i, dummy.matrix);
    parkedCarMesh.setColorAt(i, CAR_COLORS[p.colorIdx]);
  }

  parkedCarMesh.instanceMatrix.needsUpdate = true;
  parkedCarMesh.instanceColor.needsUpdate = true;
  scene.add(parkedCarMesh);
  buildingMeshes.push(parkedCarMesh);
}

// ── Emissive update (call each frame) ───────────────────────────────

export function updateBuildingEmissive(timeOfDay, camera) {
  // Compute darkness factor: 0 during full daylight, 1 at full night.
  // Transition: sunset 17→19 (ramp up), sunrise 5→7 (ramp down).
  let darkness = 0;
  if (timeOfDay < 5) {
    darkness = 1;
  } else if (timeOfDay < 7) {
    darkness = 1 - (timeOfDay - 5) / 2; // fade out 5→7
  } else if (timeOfDay < 17) {
    darkness = 0;
  } else if (timeOfDay < 19) {
    darkness = (timeOfDay - 17) / 2;     // fade in 17→19
  } else {
    darkness = 1;
  }

  // Update window glow per district — only visible at night
  for (const entry of districtMaterials) {
    const activity = getActivityMultiplier(entry.district, timeOfDay);
    entry.material.emissiveIntensity = activity.windowEmissive * darkness * 0.6;
  }

  // LOD visibility toggle
  if (camera) {
    _cameraRef = camera;
  }
  if (_cameraRef) {
    for (const lod of _simplifiedMeshes) {
      const dx = _cameraRef.position.x - lod.center.x;
      const dz = _cameraRef.position.z - lod.center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const far = dist > LOD_DISTANCE;
      lod.detailed.visible = !far;
      lod.simplified.visible = far;
    }
  }
}

// ── Disposal ────────────────────────────────────────────────────────

export function disposeCityBuildings() {
  for (const mesh of buildingMeshes) {
    mesh.geometry?.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      } else {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
      }
    }
    mesh.parent?.remove(mesh);
  }
  buildingMeshes.length = 0;
  districtMaterials.length = 0;
  _simplifiedMeshes = [];
  parkedCarMesh = null;
  _cameraRef = null;
}

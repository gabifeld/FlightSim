import * as THREE from 'three';
import {
  CT_CENTER_X, CT_CENTER_Z, CT_SIZE_X, CT_SIZE_Z,
} from './constants.js';
import { getTerrainHeightCached as getTerrainHeight } from './terrain.js';

// ── Module state ──────────────────────────────────────────────────────
let streetBulbMesh = null;
let streetGlowMesh = null;
let buildingWindowMesh = null;
let obstructionLightMesh = null;
let stadiumFloodMesh = null;

// Seeded PRNG
let _seed = 77777;
function sr() {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed & 0x7fffffff) / 0x7fffffff;
}
function rr(lo, hi) { return lo + sr() * (hi - lo); }

// ── District boundaries (world coords) ────────────────────────────────
const DISTRICTS = {
  cbd:         { x0: 9200,  x1: 10400, z0: -800,  z1: 800 },
  bokaap:      { x0: 8400,  x1: 9200,  z0: 200,   z1: 1000 },
  waterfront:  { x0: 10800, x1: 11800, z0: -1000,  z1: 1000 },
  harbor:      { x0: 11800, x1: 12200, z0: -1200,  z1: 400 },
  residentialN:{ x0: 9000,  x1: 11000, z0: 1200,   z1: 2400 },
  residentialS:{ x0: 9000,  x1: 11000, z0: -2400,  z1: -1200 },
};

// ── Texture generators ────────────────────────────────────────────────

function createConcreteFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#C0B8B0';
  ctx.fillRect(0, 0, 128, 256);

  for (let i = 0; i < 500; i++) {
    const v = 160 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v},0.12)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }

  const cols = 4, rows = 8;
  const winW = 18, winH = 22;
  const padX = (128 - cols * winW) / (cols + 1);
  const padY = (256 - rows * winH) / (rows + 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * (winW + padX);
      const y = padY + r * (winH + padY);
      const lit = Math.random() > 0.3;
      if (lit) {
        ctx.fillStyle = `rgba(${200 + Math.floor(Math.random() * 55)}, ${190 + Math.floor(Math.random() * 40)}, ${150 + Math.floor(Math.random() * 50)}, 0.9)`;
      } else {
        ctx.fillStyle = 'rgba(40, 50, 60, 0.8)';
      }
      ctx.fillRect(x, y, winW, winH);
      ctx.strokeStyle = '#777';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, winW, winH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createGlassFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3a4550';
  ctx.fillRect(0, 0, 128, 256);

  const cols = 4, rows = 10;
  const frameW = 2;
  const panelW = (128 - (cols + 1) * frameW) / cols;
  const panelH = (256 - (rows + 1) * frameW) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = frameW + c * (panelW + frameW);
      const y = frameW + r * (panelH + frameW);
      const base = 140 + Math.floor(Math.random() * 40);
      const g = 160 + Math.floor(Math.random() * 35);
      const b = 190 + Math.floor(Math.random() * 50);
      ctx.fillStyle = `rgb(${base - 50}, ${g - 30}, ${b})`;
      ctx.fillRect(x, y, panelW, panelH);
      if (Math.random() > 0.6) {
        const grad = ctx.createLinearGradient(x, y, x + panelW, y + panelH);
        grad.addColorStop(0, 'rgba(180,210,240,0.25)');
        grad.addColorStop(1, 'rgba(100,130,160,0.05)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, panelW, panelH);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createBoKaapFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, 64, 64);

  // 2x3 windows + door
  const winW = 10, winH = 12;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const x = 10 + c * 22;
      const y = 6 + r * 22;
      ctx.fillStyle = 'rgba(60, 80, 100, 0.7)';
      ctx.fillRect(x, y, winW, winH);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, winW, winH);
    }
  }
  // Door
  ctx.fillStyle = 'rgba(50, 40, 30, 0.8)';
  ctx.fillRect(25, 46, 14, 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createHarborFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#6a6a6a';
  ctx.fillRect(0, 0, 128, 64);

  // Corrugated metal: horizontal lines
  for (let y = 0; y < 64; y += 4) {
    ctx.strokeStyle = y % 8 === 0 ? 'rgba(100,100,100,0.5)' : 'rgba(80,80,80,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeRoadTex(isMajor) {
  const c = document.createElement('canvas');
  const R = 256;
  c.width = R; c.height = R;
  const g = c.getContext('2d');

  g.fillStyle = '#2A2A2A';
  g.fillRect(0, 0, R, R);

  for (let i = 0; i < 3000; i++) {
    const v = 30 + Math.floor(Math.random() * 25);
    g.fillStyle = `rgba(${v},${v},${v},0.3)`;
    g.fillRect(Math.random() * R, Math.random() * R, 2, 1);
  }

  if (isMajor) {
    g.strokeStyle = '#D4AA20';
    g.lineWidth = 2.5;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(R / 2 - 3, 0); g.lineTo(R / 2 - 3, R);
    g.moveTo(R / 2 + 3, 0); g.lineTo(R / 2 + 3, R);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.setLineDash([18, 22]);
    g.beginPath();
    g.moveTo(R * 0.25, 0); g.lineTo(R * 0.25, R);
    g.moveTo(R * 0.75, 0); g.lineTo(R * 0.75, R);
    g.stroke();
  } else {
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 2;
    g.setLineDash([20, 16]);
    g.beginPath();
    g.moveTo(R / 2, 0); g.lineTo(R / 2, R);
    g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ── Color palettes ────────────────────────────────────────────────────

const BO_KAAP_COLORS = [
  new THREE.Color(0x2299DD), // Bright blue
  new THREE.Color(0xEE4466), // Bright pink
  new THREE.Color(0x44BB44), // Bright green
  new THREE.Color(0xFFCC22), // Bright yellow
  new THREE.Color(0xFF6633), // Orange
  new THREE.Color(0xAA33CC), // Purple
  new THREE.Color(0x33CCAA), // Teal
  new THREE.Color(0xFF88AA), // Rose
];

const CBD_CONCRETE_COLORS = [
  new THREE.Color(0xF5F0E8), new THREE.Color(0xEDE8DC),
  new THREE.Color(0xC0B8A8), new THREE.Color(0xB5ADA0),
  new THREE.Color(0xB8C8D8), new THREE.Color(0xA8BCD0),
  new THREE.Color(0xE8D5B5), new THREE.Color(0xDBC8A0),
];

const CBD_GLASS_COLORS = [
  new THREE.Color(0x385568), new THREE.Color(0x2A4A6A),
  new THREE.Color(0x2A6A6A), new THREE.Color(0x1A5A5A),
  new THREE.Color(0x8899AA), new THREE.Color(0x7A8B9C),
  new THREE.Color(0x3A6A50), new THREE.Color(0x2A5A40),
];

const WATERFRONT_COLORS = [
  new THREE.Color(0xF0E0C8), new THREE.Color(0xE8D0B0),
  new THREE.Color(0xD8C0A0), new THREE.Color(0xC8B090),
  new THREE.Color(0xE0D8C0), new THREE.Color(0xD0C8B0),
];

const RESIDENTIAL_COLORS = [
  new THREE.Color(0xF5F0E8), new THREE.Color(0xEDE8DC),
  new THREE.Color(0xE8D5B5), new THREE.Color(0xC8A898),
  new THREE.Color(0xB8C8D8), new THREE.Color(0xA8B8A0),
  new THREE.Color(0xD8B8B0), new THREE.Color(0xE8DDB0),
];

const HARBOR_COLORS = [
  new THREE.Color(0x7A7A72), new THREE.Color(0x6A6A62),
  new THREE.Color(0x8A7A6A), new THREE.Color(0x6A6A7A),
];

const CONTAINER_COLORS = [
  new THREE.Color(0xCC2222), // Red
  new THREE.Color(0x2255CC), // Blue
  new THREE.Color(0x22AA44), // Green
  new THREE.Color(0xDD8800), // Orange
  new THREE.Color(0xDDDD22), // Yellow
  new THREE.Color(0xF0F0F0), // White
];

// ── Building generation ───────────────────────────────────────────────
// shape: 'box' | 'setback' | 'cylinder' | 'wedge'
// setback = tower on wider base (2 stacked boxes rendered separately)

function generateBuildings() {
  const buildings = [];
  _seed = 88888;

  // CBD Core — dense towers packed on a block grid
  const cbd = DISTRICTS.cbd;
  const cbdGrid = 28;
  for (let x = cbd.x0 + 4; x < cbd.x1 - 4; x += cbdGrid) {
    for (let z = cbd.z0 + 4; z < cbd.z1 - 4; z += cbdGrid) {
      if (sr() < 0.02) continue;
      const cx = x + rr(2, cbdGrid - 6);
      const cz = z + rr(2, cbdGrid - 6);
      const distFromCenter = Math.sqrt((cx - 9800) ** 2 + cz * cz);
      const h = distFromCenter < 250 ? rr(70, 120) : (distFromCenter < 450 ? rr(40, 85) : rr(22, 55));
      const w = rr(14, 26);
      const d = rr(14, 26);
      const glass = sr() < 0.45;

      // Pick shape — tall towers get varied shapes
      let shape = 'box';
      if (h > 50) {
        const roll = sr();
        if (roll < 0.25) shape = 'setback';
        else if (roll < 0.35) shape = 'cylinder';
        else if (roll < 0.45) shape = 'wedge';
      }

      const yaw = sr() < 0.3 ? rr(-0.15, 0.15) : 0; // slight rotation variety
      buildings.push({ x: cx, z: cz, w, d, h, district: 'cbd', glass, shape, yaw });

      // Additional filler buildings in same cell for density
      if (sr() < 0.35) {
        const fx = x + rr(2, cbdGrid - 6);
        const fz = z + rr(2, cbdGrid - 6);
        const fh = rr(12, h * 0.5);
        buildings.push({ x: fx, z: fz, w: rr(10, 18), d: rr(10, 18), h: fh, district: 'cbd', glass: sr() < 0.3, shape: 'box', yaw: 0 });
      }
    }
  }

  // Bo-Kaap — tight row houses, 7m grid
  const bk = DISTRICTS.bokaap;
  for (let x = bk.x0 + 1; x < bk.x1 - 1; x += 7) {
    for (let z = bk.z0 + 1; z < bk.z1 - 1; z += 7) {
      if (sr() < 0.03) continue;
      const cx = x + rr(0.5, 4.5);
      const cz = z + rr(0.5, 4.5);
      const h = rr(4, 7);
      buildings.push({ x: cx, z: cz, w: rr(5, 6.5), d: rr(6, 8), h, district: 'bokaap', shape: 'box', yaw: 0 });
    }
  }

  // Waterfront — mid-rise hotels/shops, 30m grid
  const wf = DISTRICTS.waterfront;
  for (let x = wf.x0 + 6; x < wf.x1 - 6; x += 30) {
    for (let z = wf.z0 + 6; z < wf.z1 - 6; z += 30) {
      if (sr() < 0.05) continue;
      const cx = x + rr(3, 22);
      const cz = z + rr(3, 22);
      const h = rr(14, 38);
      const shape = h > 28 && sr() < 0.2 ? 'setback' : 'box';
      buildings.push({ x: cx, z: cz, w: rr(14, 26), d: rr(14, 26), h, district: 'waterfront', shape, glass: sr() < 0.2, yaw: 0 });
    }
  }

  // Harbor — warehouses, 35x45 grid
  const hb = DISTRICTS.harbor;
  for (let x = hb.x0 + 4; x < hb.x1 - 4; x += 35) {
    for (let z = hb.z0 + 4; z < hb.z1 - 4; z += 45) {
      if (sr() < 0.06) continue;
      const cx = x + rr(3, 18);
      const cz = z + rr(3, 22);
      buildings.push({ x: cx, z: cz, w: rr(18, 32), d: rr(22, 40), h: rr(6, 12), district: 'harbor', shape: 'box', yaw: 0 });
    }
  }

  // Residential areas — 18m grid
  function fillResidential(dist) {
    for (let x = dist.x0 + 3; x < dist.x1 - 3; x += 18) {
      for (let z = dist.z0 + 3; z < dist.z1 - 3; z += 18) {
        if (sr() < 0.03) continue;
        const cx = x + rr(1, 13);
        const cz = z + rr(1, 13);
        const distFromCBD = Math.sqrt((cx - CT_CENTER_X) ** 2 + (cz - CT_CENTER_Z) ** 2);
        const h = distFromCBD < 1200 ? rr(8, 20) : rr(4, 12);
        buildings.push({ x: cx, z: cz, w: rr(9, 16), d: rr(9, 16), h, district: 'residential', shape: 'box', yaw: 0 });
      }
    }
  }
  fillResidential(DISTRICTS.residentialN);
  fillResidential(DISTRICTS.residentialS);

  // Transition zones
  // CBD ↔ Waterfront (X: 10400–10800)
  for (let x = 10400; x < 10800; x += 24) {
    for (let z = -800; z < 800; z += 24) {
      if (sr() < 0.05) continue;
      buildings.push({ x: x + rr(2, 18), z: z + rr(2, 18), w: rr(12, 20), d: rr(12, 20), h: rr(14, 35), district: 'waterfront', shape: 'box', glass: sr() < 0.2, yaw: 0 });
    }
  }

  // CBD ↔ Residential (Z: ±800–1200)
  for (const zRange of [[800, 1200], [-1200, -800]]) {
    for (let x = 9200; x < 10800; x += 22) {
      for (let z = zRange[0]; z < zRange[1]; z += 22) {
        if (sr() < 0.05) continue;
        buildings.push({ x: x + rr(2, 16), z: z + rr(2, 16), w: rr(10, 18), d: rr(10, 18), h: rr(8, 25), district: 'residential', shape: 'box', yaw: 0 });
      }
    }
  }

  // Western suburbs (X: 8400–9000, Z: -1200 to 200)
  for (let x = 8400; x < 9000; x += 16) {
    for (let z = -1200; z < 200; z += 16) {
      if (sr() < 0.06) continue;
      buildings.push({ x: x + rr(1, 12), z: z + rr(1, 12), w: rr(7, 13), d: rr(7, 13), h: rr(4, 10), district: 'residential', shape: 'box', yaw: 0 });
    }
  }

  return buildings;
}

// ── Build buildings with multiple shape archetypes ────────────────────

function buildBuildings(scene, buildings) {
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // Geometries for different shapes
  const cylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  // Wedge: a box with one end narrower (approximate with tapered cylinder)
  const wedgeGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 4);

  // Separate buildings into rendering categories
  const categories = {
    cbdConcreteBox: [], cbdGlassBox: [],
    cbdConcreteCyl: [], cbdGlassCyl: [],
    cbdConcreteWedge: [], cbdGlassWedge: [],
    cbdSetbackBase: [], cbdSetbackTower: [],
    bokaap: [],
    waterfront: [], waterfrontGlass: [],
    harbor: [],
    residential: [],
  };

  for (const b of buildings) {
    if (b.district === 'cbd') {
      if (b.shape === 'setback') {
        // Base (wider, shorter)
        const baseH = b.h * rr(0.2, 0.35);
        categories.cbdSetbackBase.push({ ...b, h: baseH, w: b.w * 1.4, d: b.d * 1.4 });
        // Tower (narrower, taller)
        const towerH = b.h - baseH;
        const cat = b.glass ? 'cbdGlassBox' : 'cbdConcreteBox';
        categories[cat].push({ ...b, h: towerH, baseY: baseH });
      } else if (b.shape === 'cylinder') {
        const cat = b.glass ? 'cbdGlassCyl' : 'cbdConcreteCyl';
        categories[cat].push(b);
      } else if (b.shape === 'wedge') {
        const cat = b.glass ? 'cbdGlassWedge' : 'cbdConcreteWedge';
        categories[cat].push(b);
      } else {
        const cat = b.glass ? 'cbdGlassBox' : 'cbdConcreteBox';
        categories[cat].push(b);
      }
    } else if (b.district === 'bokaap') {
      categories.bokaap.push(b);
    } else if (b.district === 'waterfront') {
      if (b.glass) categories.waterfrontGlass.push(b);
      else categories.waterfront.push(b);
    } else if (b.district === 'harbor') {
      categories.harbor.push(b);
    } else {
      categories.residential.push(b);
    }
  }

  const concreteTex = createConcreteFacadeTexture();
  const glassTex = createGlassFacadeTexture();
  const bokaapTex = createBoKaapFacadeTexture();
  const harborTex = createHarborFacadeTexture();

  function placeInstanced(geo, mat, list, colors, getY) {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const y = getY ? getY(b) : (b.baseY || 0) + b.h / 2;
      dummy.position.set(b.x, y, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, b.yaw || 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (colors) mesh.setColorAt(i, colors[Math.floor(sr() * colors.length)]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colors && list.length > 0) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.85, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.1, metalness: 0.7 });
  const bokaapMat = new THREE.MeshStandardMaterial({ map: bokaapTex, roughness: 0.85, metalness: 0.02 });
  const harborMat = new THREE.MeshStandardMaterial({ map: harborTex, roughness: 0.9, metalness: 0.1 });
  const podiumMat = new THREE.MeshStandardMaterial({ color: 0x8A7A6A, roughness: 0.9, metalness: 0.05 });

  // CBD boxes (concrete & glass)
  placeInstanced(unitBox, concreteMat, categories.cbdConcreteBox, CBD_CONCRETE_COLORS);
  placeInstanced(unitBox, glassMat, categories.cbdGlassBox, CBD_GLASS_COLORS);

  // CBD cylinders
  placeInstanced(cylinderGeo, concreteMat.clone(), categories.cbdConcreteCyl, CBD_CONCRETE_COLORS);
  placeInstanced(cylinderGeo, glassMat.clone(), categories.cbdGlassCyl, CBD_GLASS_COLORS);

  // CBD wedges
  placeInstanced(wedgeGeo, concreteMat.clone(), categories.cbdConcreteWedge, CBD_CONCRETE_COLORS);
  placeInstanced(wedgeGeo, glassMat.clone(), categories.cbdGlassWedge, CBD_GLASS_COLORS);

  // CBD setback bases (wider podiums)
  placeInstanced(unitBox, podiumMat, categories.cbdSetbackBase, null);

  // Bo-Kaap bodies
  const bokaapGetY = (b) => getTerrainHeight(b.x, b.z) + b.h / 2;
  placeInstanced(unitBox, bokaapMat, categories.bokaap, BO_KAAP_COLORS, bokaapGetY);

  // Bo-Kaap pitched roofs (4-sided cone per house)
  if (categories.bokaap.length > 0) {
    const roofGeo = new THREE.ConeGeometry(0.72, 1, 4);
    roofGeo.rotateY(Math.PI * 0.25);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.85 });
    const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, categories.bokaap.length);
    const roofBaseColor = new THREE.Color(0x6a4a30);
    const roofColor = new THREE.Color();
    for (let i = 0; i < categories.bokaap.length; i++) {
      const b = categories.bokaap[i];
      const terrY = getTerrainHeight(b.x, b.z);
      dummy.position.set(b.x, terrY + b.h + b.d * 0.15, b.z);
      dummy.scale.set(b.w * 1.05, b.d * 0.32, b.d * 1.05);
      dummy.rotation.set(0, b.yaw || 0, 0);
      dummy.updateMatrix();
      roofMesh.setMatrixAt(i, dummy.matrix);
      roofColor.copy(roofBaseColor).multiplyScalar(0.8 + sr() * 0.4);
      roofMesh.setColorAt(i, roofColor);
    }
    roofMesh.instanceMatrix.needsUpdate = true;
    roofMesh.instanceColor.needsUpdate = true;
    scene.add(roofMesh);
  }

  // Waterfront
  placeInstanced(unitBox, concreteMat.clone(), categories.waterfront, WATERFRONT_COLORS);
  placeInstanced(unitBox, glassMat.clone(), categories.waterfrontGlass, CBD_GLASS_COLORS);

  // Harbor
  placeInstanced(unitBox, harborMat, categories.harbor, HARBOR_COLORS);

  // Residential
  placeInstanced(unitBox, concreteMat.clone(), categories.residential, RESIDENTIAL_COLORS);

  // ── Roof slabs on tall buildings (concrete overhang) ──
  const tallConcrete = buildings.filter(b => b.h > 18 && !b.glass && b.shape !== 'cylinder' && b.district !== 'bokaap' && b.district !== 'harbor');
  if (tallConcrete.length > 0) {
    const slabGeo = new THREE.BoxGeometry(1, 1, 1);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x999990, roughness: 0.9 });
    const slabMesh = new THREE.InstancedMesh(slabGeo, slabMat, tallConcrete.length);
    for (let i = 0; i < tallConcrete.length; i++) {
      const b = tallConcrete[i];
      const baseY = (b.baseY || 0);
      dummy.position.set(b.x, baseY + b.h + 0.15, b.z);
      dummy.scale.set(b.w + 1.0, 0.3, b.d + 1.0);
      dummy.rotation.set(0, b.yaw || 0, 0);
      dummy.updateMatrix();
      slabMesh.setMatrixAt(i, dummy.matrix);
    }
    slabMesh.instanceMatrix.needsUpdate = true;
    scene.add(slabMesh);
  }

  // ── Ground-level awnings on CBD/waterfront buildings ──
  const awningCandidates = buildings.filter(b => (b.district === 'cbd' || b.district === 'waterfront') && b.h > 12 && !b.glass && b.shape === 'box');
  const awningCount = Math.min(awningCandidates.length, 400);
  if (awningCount > 0) {
    const awningGeo = new THREE.BoxGeometry(1, 0.15, 1);
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    const awningMesh = new THREE.InstancedMesh(awningGeo, awningMat, awningCount);
    const awningColors = [
      new THREE.Color(0x884422), new THREE.Color(0x448844),
      new THREE.Color(0x224488), new THREE.Color(0x886644),
      new THREE.Color(0x664444), new THREE.Color(0x446666),
    ];
    for (let i = 0; i < awningCount; i++) {
      const b = awningCandidates[i];
      const side = sr() < 0.5 ? 1 : -1;
      const onX = sr() < 0.5;
      if (onX) {
        dummy.position.set(b.x + side * (b.w / 2 + 1.2), 3.5, b.z);
        dummy.scale.set(2.5, 1, b.d * 0.6);
      } else {
        dummy.position.set(b.x, 3.5, b.z + side * (b.d / 2 + 1.2));
        dummy.scale.set(b.w * 0.6, 1, 2.5);
      }
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      awningMesh.setMatrixAt(i, dummy.matrix);
      awningMesh.setColorAt(i, awningColors[Math.floor(sr() * awningColors.length)]);
    }
    awningMesh.instanceMatrix.needsUpdate = true;
    awningMesh.instanceColor.needsUpdate = true;
    scene.add(awningMesh);
  }

  // ── Building window glow (night-mode) ──
  const allBuildings = buildings.filter(b => b.shape !== 'setback' || !b.isPodium);
  let totalWindows = 0;
  for (const b of allBuildings) {
    const floors = Math.floor(b.h / 4);
    if (floors < 1) continue;
    totalWindows += Math.min(6, Math.max(2, Math.floor(floors * 0.7)));
  }
  totalWindows = Math.min(totalWindows, 3000);

  const winGeo = new THREE.PlaneGeometry(1.5, 1.0);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xFFDD88, emissiveIntensity: 0.8,
    transparent: true, opacity: 0.6, side: THREE.DoubleSide,
  });
  const winMesh = new THREE.InstancedMesh(winGeo, winMat, totalWindows);
  let winIdx = 0;

  for (const b of allBuildings) {
    if (winIdx >= totalWindows) break;
    const floors = Math.floor(b.h / 4);
    if (floors < 1) continue;
    const panels = Math.min(6, Math.max(2, Math.floor(floors * 0.7)));
    const baseY = b.district === 'bokaap' ? getTerrainHeight(b.x, b.z) : (b.baseY || 0);

    for (let p = 0; p < panels; p++) {
      if (winIdx >= totalWindows) break;
      const floorY = baseY + 2 + (p % floors) * 4;
      const onXFace = sr() < 0.5;
      if (onXFace) {
        const side = sr() < 0.5 ? -1 : 1;
        dummy.position.set(b.x + side * (b.w / 2 + 0.05), floorY, b.z + rr(-b.d / 3, b.d / 3));
        dummy.rotation.set(0, Math.PI / 2, 0);
      } else {
        const side = sr() < 0.5 ? -1 : 1;
        dummy.position.set(b.x + rr(-b.w / 3, b.w / 3), floorY, b.z + side * (b.d / 2 + 0.05));
        dummy.rotation.set(0, 0, 0);
      }
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      winMesh.setMatrixAt(winIdx++, dummy.matrix);
    }
  }

  winMesh.instanceMatrix.needsUpdate = true;
  winMesh.visible = false;
  scene.add(winMesh);
  buildingWindowMesh = winMesh;

  return allBuildings;
}

// ── Rooftop details (AC units, antennas, obstruction lights) ──────────

function buildRooftopDetails(scene, buildings) {
  const dummy = new THREE.Object3D();
  const roofAC = [];
  const roofAntennas = [];

  _seed = 99999;
  for (const b of buildings) {
    if (b.district === 'bokaap') continue; // Bo-Kaap has pitched roofs
    if (b.h < 8) continue;
    if (sr() < 0.35) {
      roofAC.push({ x: b.x + rr(-b.w / 4, b.w / 4), z: b.z + rr(-b.d / 4, b.d / 4), h: b.h + (b.baseY || 0), district: b.district });
    }
    // Second AC unit for tall buildings
    if (b.h > 30 && sr() < 0.4) {
      roofAC.push({ x: b.x + rr(-b.w / 4, b.w / 4), z: b.z + rr(-b.d / 4, b.d / 4), h: b.h + (b.baseY || 0), district: b.district });
    }
    if (b.h > 30 && sr() < 0.5) {
      roofAntennas.push({ x: b.x, z: b.z, h: b.h + (b.baseY || 0), district: b.district });
    }
  }

  if (roofAC.length > 0) {
    const acGeo = new THREE.BoxGeometry(1, 1, 1);
    const acMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    const acMesh = new THREE.InstancedMesh(acGeo, acMat, roofAC.length);
    for (let i = 0; i < roofAC.length; i++) {
      const a = roofAC[i];
      const s = 1.2 + sr() * 1.5;
      dummy.position.set(a.x, a.h + 0.5, a.z);
      dummy.scale.set(s, 1.0, s * 0.8);
      dummy.rotation.set(0, sr() * Math.PI, 0);
      dummy.updateMatrix();
      acMesh.setMatrixAt(i, dummy.matrix);
    }
    acMesh.instanceMatrix.needsUpdate = true;
    scene.add(acMesh);
  }

  if (roofAntennas.length > 0) {
    const antGeo = new THREE.CylinderGeometry(0.15, 0.15, 8, 4);
    const antMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.5, roughness: 0.3 });
    const antMesh = new THREE.InstancedMesh(antGeo, antMat, roofAntennas.length);
    for (let i = 0; i < roofAntennas.length; i++) {
      const a = roofAntennas[i];
      dummy.position.set(a.x, a.h + 4, a.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      antMesh.setMatrixAt(i, dummy.matrix);
    }
    antMesh.instanceMatrix.needsUpdate = true;
    scene.add(antMesh);
  }

  // Obstruction lights on tall buildings
  const tallBuildings = buildings.filter(b => b.h > 30);
  if (tallBuildings.length > 0) {
    const obGeo = new THREE.SphereGeometry(0.3, 6, 5);
    const obMat = new THREE.MeshStandardMaterial({
      color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0, roughness: 0.3,
    });
    const obMesh = new THREE.InstancedMesh(obGeo, obMat, tallBuildings.length);
    for (let i = 0; i < tallBuildings.length; i++) {
      const b = tallBuildings[i];
      dummy.position.set(b.x, (b.baseY || 0) + b.h + 0.5, b.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      obMesh.setMatrixAt(i, dummy.matrix);
    }
    obMesh.instanceMatrix.needsUpdate = true;
    scene.add(obMesh);
    obstructionLightMesh = obMesh;
  }
}

// ── Roads ─────────────────────────────────────────────────────────────

function buildRoads(scene) {
  const Y = 0.15;
  const dummy = new THREE.Object3D();

  // Major boulevards (14m wide)
  const majorRoads = [
    // Long St (NS) — X=9800
    { x: 9800, z0: -2400, z1: 2400, dir: 'ns' },
    // Adderley St (NS) — X=10200
    { x: 10200, z0: -2400, z1: 2400, dir: 'ns' },
    // Strand St (EW) — Z=-200
    { z: -200, x0: 8400, x1: 11800, dir: 'ew' },
    // Buitengracht (NS) — X=9200
    { x: 9200, z0: -1200, z1: 1200, dir: 'ns' },
    // Beach Rd (NS) — X=11800
    { x: 11800, z0: -1200, z1: 1000, dir: 'ns' },
  ];

  const majorW = 14;
  const majorTex = makeRoadTex(true);

  for (const road of majorRoads) {
    if (road.dir === 'ns') {
      const len = road.z1 - road.z0;
      const geo = new THREE.PlaneGeometry(majorW, len);
      geo.rotateX(-Math.PI / 2);
      majorTex.repeat.set(1, Math.max(1, Math.round(len / 20)));
      const mat = new THREE.MeshStandardMaterial({ map: majorTex.clone(), roughness: 0.92, metalness: 0 });
      mat.map.repeat.set(1, Math.max(1, Math.round(len / 20)));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(road.x, Y, (road.z0 + road.z1) / 2);
      mesh.receiveShadow = true;
      scene.add(mesh);
    } else {
      const len = road.x1 - road.x0;
      const geo = new THREE.PlaneGeometry(majorW, len);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ map: majorTex.clone(), roughness: 0.92, metalness: 0 });
      mat.map.repeat.set(1, Math.max(1, Math.round(len / 20)));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((road.x0 + road.x1) / 2, Y, road.z);
      mesh.rotation.y = Math.PI / 2;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // Secondary grid — CBD (120m spacing), residential (160m spacing)
  const minorW = 8;
  const minorPositions = [];

  // CBD secondary
  for (let x = DISTRICTS.cbd.x0 + 60; x < DISTRICTS.cbd.x1; x += 120) {
    if (Math.abs(x - 9800) < 20 || Math.abs(x - 10200) < 20 || Math.abs(x - 9200) < 20) continue;
    minorPositions.push({ x, z: (DISTRICTS.cbd.z0 + DISTRICTS.cbd.z1) / 2, len: DISTRICTS.cbd.z1 - DISTRICTS.cbd.z0, dir: 'ns' });
  }
  for (let z = DISTRICTS.cbd.z0 + 60; z < DISTRICTS.cbd.z1; z += 120) {
    if (Math.abs(z - (-200)) < 20) continue;
    minorPositions.push({ x: (DISTRICTS.cbd.x0 + DISTRICTS.cbd.x1) / 2, z, len: DISTRICTS.cbd.x1 - DISTRICTS.cbd.x0, dir: 'ew' });
  }

  // Residential secondary
  for (const dist of [DISTRICTS.residentialN, DISTRICTS.residentialS]) {
    for (let x = dist.x0 + 80; x < dist.x1; x += 160) {
      if (Math.abs(x - 9800) < 20 || Math.abs(x - 10200) < 20) continue;
      minorPositions.push({ x, z: (dist.z0 + dist.z1) / 2, len: dist.z1 - dist.z0, dir: 'ns' });
    }
    for (let z = dist.z0 + 80; z < dist.z1; z += 160) {
      minorPositions.push({ x: (dist.x0 + dist.x1) / 2, z, len: dist.x1 - dist.x0, dir: 'ew' });
    }
  }

  if (minorPositions.length > 0) {
    // Use one instanced mesh for all minor roads
    const maxMinorLen = 4800; // max possible length
    const minorGeo = new THREE.PlaneGeometry(minorW, 1);
    minorGeo.rotateX(-Math.PI / 2);
    const minorTex = makeRoadTex(false);
    const minorMat = new THREE.MeshStandardMaterial({ map: minorTex, roughness: 0.92, metalness: 0 });

    const minorMesh = new THREE.InstancedMesh(minorGeo, minorMat, minorPositions.length);
    minorMesh.receiveShadow = true;

    for (let i = 0; i < minorPositions.length; i++) {
      const r = minorPositions[i];
      if (r.dir === 'ns') {
        dummy.position.set(r.x, Y, r.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, r.len);
      } else {
        dummy.position.set(r.x, Y, r.z);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.set(1, 1, r.len);
      }
      dummy.updateMatrix();
      minorMesh.setMatrixAt(i, dummy.matrix);
    }
    minorMesh.instanceMatrix.needsUpdate = true;
    scene.add(minorMesh);
  }
}

// ── Sidewalks ─────────────────────────────────────────────────────────

function buildSidewalks(scene) {
  // One large sidewalk ground for the built-up area (CBD + near districts)
  const dummy = new THREE.Object3D();
  const sidewalkAreas = [
    { x: (DISTRICTS.cbd.x0 + DISTRICTS.cbd.x1) / 2, z: (DISTRICTS.cbd.z0 + DISTRICTS.cbd.z1) / 2,
      w: DISTRICTS.cbd.x1 - DISTRICTS.cbd.x0, d: DISTRICTS.cbd.z1 - DISTRICTS.cbd.z0 },
    { x: (DISTRICTS.waterfront.x0 + DISTRICTS.waterfront.x1) / 2, z: (DISTRICTS.waterfront.z0 + DISTRICTS.waterfront.z1) / 2,
      w: DISTRICTS.waterfront.x1 - DISTRICTS.waterfront.x0, d: DISTRICTS.waterfront.z1 - DISTRICTS.waterfront.z0 },
  ];

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, sidewalkAreas.length);
  mesh.receiveShadow = true;
  for (let i = 0; i < sidewalkAreas.length; i++) {
    const s = sidewalkAreas[i];
    dummy.position.set(s.x, 0.06, s.z);
    dummy.scale.set(s.w, 0.12, s.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// ── Stadium ───────────────────────────────────────────────────────────

function buildStadium(scene) {
  const sx = 10600, sz = -1800;
  const r = 140, h = 35;

  // Bowl shape via LatheGeometry
  const pts = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 0.5;
    const rx = r - 15 + 15 * Math.cos(angle);
    const ry = h * Math.sin(angle);
    pts.push(new THREE.Vector2(rx, ry));
  }
  // Inner wall
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const angle = t * Math.PI * 0.5;
    const rx = r - 25 + 10 * Math.cos(angle);
    const ry = h * Math.sin(angle);
    pts.push(new THREE.Vector2(rx, ry));
  }

  const bowlGeo = new THREE.LatheGeometry(pts, 32);
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0xDDDDDD, roughness: 0.7, metalness: 0.1 });
  const bowl = new THREE.Mesh(bowlGeo, bowlMat);
  bowl.position.set(sx, 0, sz);
  bowl.receiveShadow = true;
  scene.add(bowl);

  // Green field
  const fieldGeo = new THREE.CircleGeometry(r - 30, 32);
  fieldGeo.rotateX(-Math.PI / 2);
  const fieldMat = new THREE.MeshStandardMaterial({ color: 0x2a8a2a, roughness: 0.9 });
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.position.set(sx, 0.5, sz);
  field.receiveShadow = true;
  scene.add(field);

  // Stadium flood lights (4 tall poles)
  const floodGeo = new THREE.SphereGeometry(2, 6, 5);
  const floodMat = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, emissive: 0xFFEECC, emissiveIntensity: 0.5, roughness: 0.3,
  });
  const floodMesh = new THREE.InstancedMesh(floodGeo, floodMat, 4);
  const dummy = new THREE.Object3D();
  const floodAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  for (let i = 0; i < 4; i++) {
    const angle = floodAngles[i];
    const fx = sx + Math.cos(angle) * (r + 10);
    const fz = sz + Math.sin(angle) * (r + 10);
    dummy.position.set(fx, h + 10, fz);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    floodMesh.setMatrixAt(i, dummy.matrix);
  }
  floodMesh.instanceMatrix.needsUpdate = true;
  scene.add(floodMesh);
  stadiumFloodMesh = floodMesh;

  // Flood light poles
  const poleGeo = new THREE.CylinderGeometry(0.5, 0.8, h + 10, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.4 });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, 4);
  for (let i = 0; i < 4; i++) {
    const angle = floodAngles[i];
    const fx = sx + Math.cos(angle) * (r + 10);
    const fz = sz + Math.sin(angle) * (r + 10);
    dummy.position.set(fx, (h + 10) / 2, fz);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
  }
  poleMesh.instanceMatrix.needsUpdate = true;
  scene.add(poleMesh);
}

// ── Harbor: cranes, containers, dock ──────────────────────────────────

function buildHarbor(scene) {
  const dummy = new THREE.Object3D();

  // Dock platform
  const dockGeo = new THREE.BoxGeometry(400, 2, 800);
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x888880, roughness: 0.95 });
  const dock = new THREE.Mesh(dockGeo, dockMat);
  dock.position.set(12050, 1, -200);
  dock.receiveShadow = true;
  scene.add(dock);

  // Container cranes (6 red gantry cranes)
  const craneCount = 6;
  const craneLegGeo = new THREE.BoxGeometry(2, 40, 2);
  const craneBoomGeo = new THREE.BoxGeometry(2, 2, 40);
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xCC2222, roughness: 0.6, metalness: 0.3 });

  // Crane legs (4 legs per crane = 24)
  const legMesh = new THREE.InstancedMesh(craneLegGeo, craneMat, craneCount * 4);
  let legIdx = 0;

  // Crane booms (1 per crane = 6)
  const boomMesh = new THREE.InstancedMesh(craneBoomGeo, craneMat, craneCount);

  for (let i = 0; i < craneCount; i++) {
    const cx = 12000;
    const cz = -400 + i * 120;
    const craneH = 40;

    // 4 legs
    const offsets = [[-8, -5], [-8, 5], [8, -5], [8, 5]];
    for (const [ox, oz] of offsets) {
      dummy.position.set(cx + ox, craneH / 2, cz + oz);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      legMesh.setMatrixAt(legIdx++, dummy.matrix);
    }

    // Boom
    dummy.position.set(cx, craneH + 1, cz);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    boomMesh.setMatrixAt(i, dummy.matrix);
  }
  legMesh.instanceMatrix.needsUpdate = true;
  boomMesh.instanceMatrix.needsUpdate = true;
  scene.add(legMesh);
  scene.add(boomMesh);

  // Shipping containers (80 stacked)
  const containerGeo = new THREE.BoxGeometry(2.5, 2.5, 6);
  const containerMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 });
  const containerCount = 80;
  const containerMesh = new THREE.InstancedMesh(containerGeo, containerMat, containerCount);

  for (let i = 0; i < containerCount; i++) {
    const row = Math.floor(i / 10);
    const col = i % 10;
    const stack = Math.floor(sr() * 3);
    dummy.position.set(
      12020 + row * 5,
      1.25 + stack * 2.5 + 2,
      -500 + col * 8
    );
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    containerMesh.setMatrixAt(i, dummy.matrix);
    containerMesh.setColorAt(i, CONTAINER_COLORS[Math.floor(sr() * CONTAINER_COLORS.length)]);
  }
  containerMesh.instanceMatrix.needsUpdate = true;
  containerMesh.instanceColor.needsUpdate = true;
  scene.add(containerMesh);
}

// ── Waterfront features: Ferris wheel, clock tower, promenade ────────

function buildWaterfrontFeatures(scene) {
  const dummy = new THREE.Object3D();

  // Ferris Wheel at (11200, 400)
  const fwX = 11200, fwZ = 400, fwR = 20, fwH = 25;

  // Rim (torus)
  const rimGeo = new THREE.TorusGeometry(fwR, 0.5, 8, 32);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, roughness: 0.4, metalness: 0.6 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.set(fwX, fwH + fwR, fwZ);
  rim.rotation.y = Math.PI / 2;
  scene.add(rim);

  // Spokes (instanced cylinders)
  const spokeGeo = new THREE.CylinderGeometry(0.15, 0.15, fwR * 2, 4);
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0xAAAAAA, roughness: 0.4, metalness: 0.5 });
  const spokeCount = 12;
  const spokeMesh = new THREE.InstancedMesh(spokeGeo, spokeMat, spokeCount);
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI * 2;
    dummy.position.set(fwX, fwH + fwR, fwZ);
    dummy.rotation.set(0, 0, angle);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    spokeMesh.setMatrixAt(i, dummy.matrix);
  }
  spokeMesh.instanceMatrix.needsUpdate = true;
  scene.add(spokeMesh);

  // Support legs
  const legGeo = new THREE.CylinderGeometry(0.4, 0.6, fwH + fwR, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.4 });
  const leg1 = new THREE.Mesh(legGeo, legMat);
  leg1.position.set(fwX, (fwH + fwR) / 2, fwZ - 3);
  leg1.rotation.z = 0.08;
  scene.add(leg1);
  const leg2 = new THREE.Mesh(legGeo, legMat);
  leg2.position.set(fwX, (fwH + fwR) / 2, fwZ + 3);
  leg2.rotation.z = -0.08;
  scene.add(leg2);

  // Clock Tower at (11200, 0)
  const ctX = 11200, ctZ = 0, ctH = 25;
  const towerGeo = new THREE.BoxGeometry(3, ctH, 3);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xC8A888, roughness: 0.8 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.set(ctX, ctH / 2, ctZ);
  scene.add(tower);

  // Clock face (simple circle)
  const clockGeo = new THREE.CircleGeometry(1.5, 16);
  const clockMat = new THREE.MeshStandardMaterial({ color: 0xFFF8E0, emissive: 0xFFF8E0, emissiveIntensity: 0.3 });
  const clockFace1 = new THREE.Mesh(clockGeo, clockMat);
  clockFace1.position.set(ctX + 1.55, ctH - 3, ctZ);
  clockFace1.rotation.y = Math.PI / 2;
  scene.add(clockFace1);
  const clockFace2 = new THREE.Mesh(clockGeo, clockMat);
  clockFace2.position.set(ctX - 1.55, ctH - 3, ctZ);
  clockFace2.rotation.y = -Math.PI / 2;
  scene.add(clockFace2);

  // Promenade walkway along waterfront (X=11600, Z: -1000 to 1000)
  const promGeo = new THREE.BoxGeometry(8, 0.6, 2000);
  const promMat = new THREE.MeshStandardMaterial({ color: 0xA09888, roughness: 0.9 });
  const prom = new THREE.Mesh(promGeo, promMat);
  prom.position.set(11600, 0.3, 0);
  prom.receiveShadow = true;
  scene.add(prom);

  // Railing posts along promenade
  const railGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 4);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.6 });
  const railCount = 100;
  const railMesh = new THREE.InstancedMesh(railGeo, railMat, railCount);
  for (let i = 0; i < railCount; i++) {
    const rz = -1000 + (i / railCount) * 2000;
    dummy.position.set(11604, 1.2, rz);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    railMesh.setMatrixAt(i, dummy.matrix);
  }
  railMesh.instanceMatrix.needsUpdate = true;
  scene.add(railMesh);

  // Palm trees along promenade
  const palmCount = 30;
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 8, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B6B3D });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCount);

  const frondGeo = new THREE.ConeGeometry(3, 3, 6);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
  const frondMesh = new THREE.InstancedMesh(frondGeo, frondMat, palmCount);

  for (let i = 0; i < palmCount; i++) {
    const pz = -1000 + (i / palmCount) * 2000;
    const px = 11595 + (i % 2) * 2;
    dummy.position.set(px, 4, pz);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, (sr() - 0.5) * 0.15);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(px, 9, pz);
    dummy.scale.set(1, 0.8, 1);
    dummy.rotation.set(0, sr() * Math.PI * 2, 0);
    dummy.updateMatrix();
    frondMesh.setMatrixAt(i, dummy.matrix);
  }
  trunkMesh.instanceMatrix.needsUpdate = true;
  frondMesh.instanceMatrix.needsUpdate = true;
  scene.add(trunkMesh);
  scene.add(frondMesh);
}

// ── Parks and trees ───────────────────────────────────────────────────

function buildParksAndTrees(scene) {
  const dummy = new THREE.Object3D();

  // Park areas
  const parks = [
    { x: 10000, z: 1800, w: 200, d: 200 },  // Company's Garden
    { x: 9600, z: -1600, w: 160, d: 140 },   // Small park
  ];

  for (const p of parks) {
    const geo = new THREE.PlaneGeometry(p.w, p.d);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4CBB17, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, 0.08, p.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Street trees scattered through districts
  const treePositions = [];
  _seed = 55555;
  const treeDist = [DISTRICTS.cbd, DISTRICTS.waterfront, DISTRICTS.residentialN, DISTRICTS.residentialS];
  for (const dist of treeDist) {
    for (let i = 0; i < 30; i++) {
      const tx = rr(dist.x0 + 15, dist.x1 - 15);
      const tz = rr(dist.z0 + 15, dist.z1 - 15);
      treePositions.push({ x: tx, z: tz });
    }
  }
  // Park trees
  for (const p of parks) {
    for (let i = 0; i < 15; i++) {
      treePositions.push({
        x: p.x + rr(-p.w / 2 + 5, p.w / 2 - 5),
        z: p.z + rr(-p.d / 2 + 5, p.d / 2 - 5),
      });
    }
  }

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3.5, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);

    const canopyGeo = new THREE.SphereGeometry(2.2, 6, 5);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3a8c25 });
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, treePositions.length);

    const treeGreens = [
      new THREE.Color(0x2D8B2D), new THREE.Color(0x3A9A3A),
      new THREE.Color(0x4CAF50), new THREE.Color(0x228B22),
      new THREE.Color(0x5CB85C), new THREE.Color(0x8BC34A),
    ];

    for (let i = 0; i < treePositions.length; i++) {
      const t = treePositions[i];
      const scale = 0.8 + sr() * 0.5;
      dummy.position.set(t.x, 1.75 * scale, t.z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.set(0, sr() * Math.PI * 2, 0);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(t.x, 3.5 * scale + 0.5, t.z);
      dummy.scale.set(scale * (0.9 + sr() * 0.3), scale * (0.7 + sr() * 0.3), scale * (0.9 + sr() * 0.3));
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(i, dummy.matrix);
      canopyMesh.setColorAt(i, treeGreens[Math.floor(sr() * treeGreens.length)]);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceColor.needsUpdate = true;
    scene.add(trunkMesh);
    scene.add(canopyMesh);
  }
}

// ── Street lights ─────────────────────────────────────────────────────

function buildStreetLights(scene) {
  const dummy = new THREE.Object3D();
  const poleH = 7;
  const spacing = 50;
  const positions = [];

  // Along major roads
  const majorRoads = [
    { x: 9800, z0: -2400, z1: 2400, dir: 'ns' },
    { x: 10200, z0: -2400, z1: 2400, dir: 'ns' },
    { z: -200, x0: 8400, x1: 11800, dir: 'ew' },
    { x: 9200, z0: -1200, z1: 1200, dir: 'ns' },
    { x: 11800, z0: -1200, z1: 1000, dir: 'ns' },
  ];

  for (const road of majorRoads) {
    if (road.dir === 'ns') {
      for (let z = road.z0; z <= road.z1; z += spacing) {
        positions.push({ x: road.x + 9, z });
        positions.push({ x: road.x - 9, z });
      }
    } else {
      for (let x = road.x0; x <= road.x1; x += spacing) {
        positions.push({ x, z: road.z + 9 });
        positions.push({ x, z: road.z - 9 });
      }
    }
  }

  // Promenade lights
  for (let z = -1000; z <= 1000; z += 40) {
    positions.push({ x: 11596, z });
  }

  // Deduplicate close ones
  const filtered = [];
  for (const p of positions) {
    let tooClose = false;
    for (const f of filtered) {
      if ((f.x - p.x) ** 2 + (f.z - p.z) ** 2 < 15 * 15) { tooClose = true; break; }
    }
    if (!tooClose) filtered.push(p);
  }
  const lights = filtered.slice(0, 600);
  if (lights.length === 0) return;

  // Poles
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, poleH, 4);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.4 });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, lights.length);

  // Bulbs
  const bulbGeo = new THREE.SphereGeometry(0.35, 6, 5);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xFFE4B5, emissive: 0xFFCC88, emissiveIntensity: 1.2,
    roughness: 0.2, transparent: true, opacity: 0.95,
  });
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, lights.length);

  // Glow
  const glowGeo = new THREE.SphereGeometry(0.8, 6, 5);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xFFE4B5, transparent: true, opacity: 0.15, depthWrite: false,
  });
  const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, lights.length);

  for (let i = 0; i < lights.length; i++) {
    const p = lights[i];
    dummy.position.set(p.x, poleH / 2, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, poleH + 0.25, p.z);
    dummy.updateMatrix();
    bulbMesh.setMatrixAt(i, dummy.matrix);
    glowMesh.setMatrixAt(i, dummy.matrix);
  }

  poleMesh.instanceMatrix.needsUpdate = true;
  bulbMesh.instanceMatrix.needsUpdate = true;
  glowMesh.instanceMatrix.needsUpdate = true;
  scene.add(poleMesh);
  scene.add(bulbMesh);
  scene.add(glowMesh);

  streetBulbMesh = bulbMesh;
  streetGlowMesh = glowMesh;
}

// ── Ground plane ──────────────────────────────────────────────────────

function buildGroundPlane(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2A2A2A';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 3000; i++) {
    const v = 30 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgba(${v},${v},${v},0.2)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }

  // Radial fade-out at edges
  const cx = 256, cy = 256;
  const grad = ctx.createRadialGradient(cx, cy, 160, cx, cy, 256);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.95,
    metalness: 0,
    alphaTest: 0.01,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const geo = new THREE.PlaneGeometry(CT_SIZE_X + 400, CT_SIZE_Z + 400);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(CT_CENTER_X, 0.04, CT_CENTER_Z);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
}

// ── Public API ────────────────────────────────────────────────────────

export function createCapeTownCity(scene) {
  buildGroundPlane(scene);
  buildRoads(scene);
  buildSidewalks(scene);

  const buildings = generateBuildings();
  const allBuildings = buildBuildings(scene, buildings);
  buildRooftopDetails(scene, allBuildings);

  buildStadium(scene);
  buildHarbor(scene);
  buildWaterfrontFeatures(scene);
  buildParksAndTrees(scene);
  buildStreetLights(scene);

  const total = buildings.length;
  console.log(`[CapeTown] ${total} buildings, stadium, 6 cranes, Ferris wheel, clock tower`);
}

export function updateCapeTownNight(isNight) {
  if (streetBulbMesh) {
    streetBulbMesh.material.emissiveIntensity = isNight ? 2.5 : 0.3;
  }
  if (streetGlowMesh) {
    streetGlowMesh.visible = isNight;
  }
  if (buildingWindowMesh) {
    buildingWindowMesh.visible = isNight;
  }
  if (obstructionLightMesh) {
    obstructionLightMesh.material.emissiveIntensity = isNight ? 3.0 : 0.2;
  }
  if (stadiumFloodMesh) {
    stadiumFloodMesh.material.emissiveIntensity = isNight ? 3.0 : 0.5;
  }
}

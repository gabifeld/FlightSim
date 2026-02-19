import * as THREE from 'three';
import { CITY_CENTER_X, CITY_CENTER_Z, CITY_SIZE } from './constants.js';

// ── Module state ──────────────────────────────────────────────────────
const roadSegments = [];
const roadIntersections = [];
const HALF = CITY_SIZE / 2;
let roadNetworkCache = Object.freeze([]);
let roadIntersectionsCache = Object.freeze([]);

let streetBulbMesh = null;
let streetGlowMesh = null;
let buildingWindowMesh = null;
let obstructionLightMesh = null;

function rebuildRoadCaches() {
  roadNetworkCache = Object.freeze(roadSegments.map(seg => Object.freeze({
    start: Object.freeze({ x: seg.start.x, z: seg.start.z }),
    end: Object.freeze({ x: seg.end.x, z: seg.end.z }),
    width: seg.width,
    type: seg.type,
    direction: Math.atan2(seg.end.z - seg.start.z, seg.end.x - seg.start.x),
    lanes: seg.type === 'major' ? 4 : 2,
  })));

  roadIntersectionsCache = Object.freeze(roadIntersections.map(i => Object.freeze({
    x: i.x,
    z: i.z,
    type: i.type,
    nsRoadWidth: i.nsRoadWidth,
    ewRoadWidth: i.ewRoadWidth,
  })));
}

// Seeded PRNG for deterministic layout
let _seed = 12345;
function sr() {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed & 0x7fffffff) / 0x7fffffff;
}
function rr(lo, hi) { return lo + sr() * (hi - lo); }

// ── Configuration ─────────────────────────────────────────────────────
const GRID = 100;         // road spacing
const ROAD_MAJOR = 14;    // major avenue width
const ROAD_MINOR = 8;     // secondary street width
const SIDEWALK_M = 2.5;   // sidewalk margin inside block
const BLDG_GAP = 1.5;     // gap between adjacent buildings

// Parks (local coords relative to city center)
const PARKS = [
  { lx: 150, lz: -150, w: 190, d: 170 },  // Downtown park
  { lx: -350, lz: 300, w: 130, d: 110 },   // Neighborhood park
  { lx: 450, lz: 450, w: 90, d: 80 },      // Small park
];

// Height profile: dense downtown core → low suburban edge
function hMax(d) {
  if (d < 150) return 90;
  if (d < 300) return 65;
  if (d < 450) return 40;
  if (d < 650) return 22;
  return 12;
}
function hMin(d) {
  if (d < 200) return 25;
  if (d < 400) return 8;
  return 4;
}

function isInPark(lx, lz) {
  for (const p of PARKS) {
    if (lx > p.lx - p.w / 2 && lx < p.lx + p.w / 2 &&
        lz > p.lz - p.d / 2 && lz < p.lz + p.d / 2) return true;
  }
  return false;
}

// ── Vibrant building color palettes ──────────────────────────────────

// Concrete / residential buildings — warm, colorful, diverse
const BLDG_COLORS = [
  // Warm whites
  new THREE.Color(0xF5F0E8), new THREE.Color(0xEDE8DC),
  // Terracotta
  new THREE.Color(0xC67B5C), new THREE.Color(0xD4956B),
  // Cream / sand
  new THREE.Color(0xE8D5B5), new THREE.Color(0xDBC8A0),
  // Light blue
  new THREE.Color(0xB8C8D8), new THREE.Color(0xA8BCD0),
  // Warm gray
  new THREE.Color(0xC0B8A8), new THREE.Color(0xB5ADA0),
  // Sage green
  new THREE.Color(0xA8B8A0), new THREE.Color(0x96A890),
  // Blush pink
  new THREE.Color(0xD8B8B0), new THREE.Color(0xC8A8A0),
  // Soft yellow
  new THREE.Color(0xE8DDB0), new THREE.Color(0xD8CDA0),
  // Dusty rose
  new THREE.Color(0xC8A098), new THREE.Color(0xB89088),
  // Pale lavender
  new THREE.Color(0xC0B8C8), new THREE.Color(0xB0A8B8),
];

// Glass tower tint colors applied via instanceColor
const GLASS_COLORS = [
  // Deep blue glass
  new THREE.Color(0x385568), new THREE.Color(0x2A4A6A),
  // Teal glass
  new THREE.Color(0x2A6A6A), new THREE.Color(0x1A5A5A),
  // Silver glass
  new THREE.Color(0x8899AA), new THREE.Color(0x7A8B9C),
  // Gold-tinted glass
  new THREE.Color(0x8A7A5A), new THREE.Color(0x706040),
  // Emerald glass
  new THREE.Color(0x3A6A50), new THREE.Color(0x2A5A40),
  // Copper glass
  new THREE.Color(0x7A5A4A), new THREE.Color(0x6A4A3A),
];

// ── Building facade textures ─────────────────────────────────────────

function createBuildingFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Neutral facade base (color from instanceColor)
  ctx.fillStyle = '#C0B8B0';
  ctx.fillRect(0, 0, 128, 256);

  // Subtle concrete grain
  for (let i = 0; i < 500; i++) {
    const v = 160 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v},0.12)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }

  // Window grid (4 columns x 8 rows)
  const cols = 4, rows = 8;
  const winW = 18, winH = 22;
  const padX = (128 - cols * winW) / (cols + 1);
  const padY = (256 - rows * winH) / (rows + 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * (winW + padX);
      const y = padY + r * (winH + padY);

      // Window - mix of lit and dark
      const lit = Math.random() > 0.3;
      if (lit) {
        ctx.fillStyle = `rgba(${200 + Math.floor(Math.random() * 55)}, ${190 + Math.floor(Math.random() * 40)}, ${150 + Math.floor(Math.random() * 50)}, 0.9)`;
      } else {
        ctx.fillStyle = 'rgba(40, 50, 60, 0.8)';
      }
      ctx.fillRect(x, y, winW, winH);

      // Window frame
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

  // Dark steel frame base
  ctx.fillStyle = '#3a4550';
  ctx.fillRect(0, 0, 128, 256);

  // Glass panel grid (4 columns x 10 rows)
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

      // Subtle reflection highlight
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

// ── Road textures ─────────────────────────────────────────────────────

function makeRoadTex(width, isMajor) {
  const c = document.createElement('canvas');
  const R = 256;
  c.width = R; c.height = R;
  const g = c.getContext('2d');

  // Dark asphalt base (#2A2A2A)
  g.fillStyle = '#2A2A2A';
  g.fillRect(0, 0, R, R);

  // Grain noise for asphalt realism
  for (let i = 0; i < 3000; i++) {
    const v = 30 + Math.floor(Math.random() * 25);
    g.fillStyle = `rgba(${v},${v},${v},0.3)`;
    g.fillRect(Math.random() * R, Math.random() * R, 2, 1);
  }

  if (isMajor) {
    // Double yellow center line (solid)
    g.strokeStyle = '#D4AA20';
    g.lineWidth = 2.5;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(R / 2 - 3, 0); g.lineTo(R / 2 - 3, R);
    g.moveTo(R / 2 + 3, 0); g.lineTo(R / 2 + 3, R);
    g.stroke();

    // White dashed lane dividers
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.setLineDash([18, 22]);
    g.beginPath();
    g.moveTo(R * 0.25, 0); g.lineTo(R * 0.25, R);
    g.moveTo(R * 0.75, 0); g.lineTo(R * 0.75, R);
    g.stroke();

    // Yellow edge lines (solid)
    g.strokeStyle = '#C8A020';
    g.lineWidth = 2.5;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(5, 0); g.lineTo(5, R);
    g.moveTo(R - 5, 0); g.lineTo(R - 5, R);
    g.stroke();

    // Crosswalk markings at top and bottom (intersections)
    g.fillStyle = 'rgba(255,255,255,0.65)';
    const stripeW = (R - 20) / 7;
    for (let s = 0; s < 7; s += 2) {
      // Top crosswalk
      g.fillRect(10 + s * stripeW, 4, stripeW * 0.8, 16);
      // Bottom crosswalk
      g.fillRect(10 + s * stripeW, R - 20, stripeW * 0.8, 16);
    }
  } else {
    // White dashed center line
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 2;
    g.setLineDash([20, 16]);
    g.beginPath();
    g.moveTo(R / 2, 0); g.lineTo(R / 2, R);
    g.stroke();

    // Subtle white edge lines (solid)
    g.strokeStyle = 'rgba(200,200,200,0.4)';
    g.lineWidth = 1.5;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(4, 0); g.lineTo(4, R);
    g.moveTo(R - 4, 0); g.lineTo(R - 4, R);
    g.stroke();

    // Crosswalk markings at intersections
    g.fillStyle = 'rgba(255,255,255,0.5)';
    const stripeW = (R - 16) / 5;
    for (let s = 0; s < 5; s += 2) {
      g.fillRect(8 + s * stripeW, 4, stripeW * 0.7, 12);
      g.fillRect(8 + s * stripeW, R - 16, stripeW * 0.7, 12);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, Math.max(1, Math.round(CITY_SIZE / 20)));
  return t;
}

// ── Build roads ───────────────────────────────────────────────────────

function buildRoads(scene) {
  const Y = 0.15;
  const nsOffs = [];
  const ewOffs = [];

  // Major avenues through center
  nsOffs.push({ off: 0, w: ROAD_MAJOR });
  ewOffs.push({ off: 0, w: ROAD_MAJOR });

  // Secondary grid
  for (let d = -HALF + GRID; d < HALF; d += GRID) {
    if (Math.abs(d) < ROAD_MAJOR) continue;
    nsOffs.push({ off: d, w: ROAD_MINOR });
    ewOffs.push({ off: d, w: ROAD_MINOR });
  }

  nsOffs.sort((a, b) => a.off - b.off);
  ewOffs.sort((a, b) => a.off - b.off);

  // Store road segments with full data for car system
  roadSegments.length = 0;
  for (const r of nsOffs) {
    const isMajor = r.w > 10;
    roadSegments.push({
      start: { x: CITY_CENTER_X + r.off, z: CITY_CENTER_Z - HALF },
      end:   { x: CITY_CENTER_X + r.off, z: CITY_CENTER_Z + HALF },
      width: r.w,
      type: isMajor ? 'major' : 'minor',
    });
  }
  for (const r of ewOffs) {
    const isMajor = r.w > 10;
    roadSegments.push({
      start: { x: CITY_CENTER_X - HALF, z: CITY_CENTER_Z + r.off },
      end:   { x: CITY_CENTER_X + HALF, z: CITY_CENTER_Z + r.off },
      width: r.w,
      type: isMajor ? 'major' : 'minor',
    });
  }

  // Compute intersections (every NS road crossing every EW road)
  roadIntersections.length = 0;
  for (const ns of nsOffs) {
    for (const ew of ewOffs) {
      const ix = CITY_CENTER_X + ns.off;
      const iz = CITY_CENTER_Z + ew.off;
      const nsIsMajor = ns.w > 10;
      const ewIsMajor = ew.w > 10;
      roadIntersections.push({
        x: ix,
        z: iz,
        type: (nsIsMajor || ewIsMajor) ? 'major' : 'minor',
        nsRoadWidth: ns.w,
        ewRoadWidth: ew.w,
      });
    }
  }

  // ── Minor roads via InstancedMesh ──
  const nsMinor = nsOffs.filter(r => r.w === ROAD_MINOR);
  const ewMinor = ewOffs.filter(r => r.w === ROAD_MINOR);
  const totalMinor = nsMinor.length + ewMinor.length;

  if (totalMinor > 0) {
    const minorGeo = new THREE.PlaneGeometry(ROAD_MINOR, CITY_SIZE);
    minorGeo.rotateX(-Math.PI / 2);
    const minorTex = makeRoadTex(ROAD_MINOR, false);
    const minorMat = new THREE.MeshStandardMaterial({ map: minorTex, roughness: 0.92, metalness: 0 });

    const dummy = new THREE.Object3D();
    const minorMesh = new THREE.InstancedMesh(minorGeo, minorMat, totalMinor);
    minorMesh.receiveShadow = true;

    let idx = 0;
    for (const r of nsMinor) {
      dummy.position.set(CITY_CENTER_X + r.off, Y, CITY_CENTER_Z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      minorMesh.setMatrixAt(idx++, dummy.matrix);
    }
    for (const r of ewMinor) {
      dummy.position.set(CITY_CENTER_X, Y, CITY_CENTER_Z + r.off);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.updateMatrix();
      minorMesh.setMatrixAt(idx++, dummy.matrix);
    }
    minorMesh.instanceMatrix.needsUpdate = true;
    scene.add(minorMesh);
  }

  // ── Major roads (2 regular meshes) ──
  const majorGeo = new THREE.PlaneGeometry(ROAD_MAJOR, CITY_SIZE);
  majorGeo.rotateX(-Math.PI / 2);
  const majorTex = makeRoadTex(ROAD_MAJOR, true);
  const majorMat = new THREE.MeshStandardMaterial({ map: majorTex, roughness: 0.92, metalness: 0 });

  const nsMajor = new THREE.Mesh(majorGeo, majorMat);
  nsMajor.position.set(CITY_CENTER_X, Y, CITY_CENTER_Z);
  nsMajor.receiveShadow = true;
  scene.add(nsMajor);

  const ewMajor = new THREE.Mesh(majorGeo.clone(), majorMat.clone());
  ewMajor.position.set(CITY_CENTER_X, Y, CITY_CENTER_Z);
  ewMajor.rotation.y = Math.PI / 2;
  ewMajor.receiveShadow = true;
  scene.add(ewMajor);

  return { nsOffs, ewOffs };
}

// ── Generate all placements ───────────────────────────────────────────

function generatePlacements(roadInfo) {
  const { nsOffs, ewOffs } = roadInfo;

  const nsEdges = [{ off: -HALF, w: 0 }, ...nsOffs, { off: HALF, w: 0 }];
  const ewEdges = [{ off: -HALF, w: 0 }, ...ewOffs, { off: HALF, w: 0 }];

  const buildings = [];
  const podiums = [];
  const roofAC = [];
  const roofAntennas = [];
  const sidewalks = [];
  const parkBlocks = [];

  _seed = 54321;

  for (let ni = 0; ni < nsEdges.length - 1; ni++) {
    for (let ei = 0; ei < ewEdges.length - 1; ei++) {
      const left = nsEdges[ni].off + nsEdges[ni].w / 2;
      const right = nsEdges[ni + 1].off - nsEdges[ni + 1].w / 2;
      const top = ewEdges[ei].off + ewEdges[ei].w / 2;
      const bottom = ewEdges[ei + 1].off - ewEdges[ei + 1].w / 2;

      const bw = right - left;
      const bd = bottom - top;
      if (bw < 10 || bd < 10) continue;

      const bcx = (left + right) / 2;
      const bcz = (top + bottom) / 2;

      // Park blocks
      if (isInPark(bcx, bcz)) {
        parkBlocks.push({
          x: CITY_CENTER_X + bcx,
          z: CITY_CENTER_Z + bcz,
          w: bw, d: bd,
        });
        continue;
      }

      // Sidewalk
      sidewalks.push({
        x: CITY_CENTER_X + bcx,
        z: CITY_CENTER_Z + bcz,
        w: bw, d: bd,
      });

      const uw = bw - 2 * SIDEWALK_M;
      const ud = bd - 2 * SIDEWALK_M;
      if (uw < 8 || ud < 8) continue;

      const dist = Math.sqrt(bcx * bcx + bcz * bcz);
      const maxH = hMax(dist);
      const minH = hMin(dist);

      if (dist > 600 && sr() < 0.03) continue;

      const lotsX = Math.max(1, Math.round(uw / 28));
      const lotsZ = Math.max(1, Math.round(ud / 28));
      const lotW = uw / lotsX;
      const lotD = ud / lotsZ;

      for (let lx = 0; lx < lotsX; lx++) {
        for (let lz = 0; lz < lotsZ; lz++) {
          if (sr() < 0.04) continue;

          const cx = left + SIDEWALK_M + lx * lotW + lotW / 2;
          const cz = top + SIDEWALK_M + lz * lotD + lotD / 2;
          const wx = CITY_CENTER_X + cx;
          const wz = CITY_CENTER_Z + cz;

          let bldgW = lotW - BLDG_GAP;
          let bldgD = lotD - BLDG_GAP;
          let h = rr(minH, maxH);

          const isGlass = dist < 300 && h > 30 && sr() < 0.25;

          if (h > 28 && sr() < 0.4) {
            const podH = rr(6, Math.min(14, h * 0.3));
            podiums.push({ x: wx, z: wz, w: bldgW, d: bldgD, h: podH });

            const towerW = bldgW * rr(0.5, 0.75);
            const towerD = bldgD * rr(0.5, 0.75);
            buildings.push({ x: wx, z: wz, w: towerW, d: towerD, h, glass: isGlass });
          } else {
            buildings.push({ x: wx, z: wz, w: bldgW, d: bldgD, h, glass: isGlass });
          }

          if (sr() < 0.3) {
            roofAC.push({
              x: wx + rr(-bldgW / 4, bldgW / 4),
              z: wz + rr(-bldgD / 4, bldgD / 4),
              h,
            });
          }

          if (h > 40 && sr() < 0.5) {
            roofAntennas.push({ x: wx, z: wz, h });
          }
        }
      }
    }
  }

  return { buildings, podiums, roofAC, roofAntennas, sidewalks, parkBlocks };
}

// ── Build buildings (InstancedMesh) ───────────────────────────────────

function buildBuildings(scene, placements) {
  const { buildings, podiums } = placements;
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const concrete = buildings.filter(b => !b.glass);
  const glass = buildings.filter(b => b.glass);

  // ── Concrete buildings ──
  if (concrete.length > 0) {
    const facadeTex = createBuildingFacadeTexture();
    const mat = new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(unitBox, mat, concrete.length);
    mesh.receiveShadow = true;

    for (let i = 0; i < concrete.length; i++) {
      const b = concrete[i];
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Vibrant diverse color from palette
      mesh.setColorAt(i, BLDG_COLORS[Math.floor(sr() * BLDG_COLORS.length)]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  // ── Glass towers ──
  if (glass.length > 0) {
    const glassFacadeTex = createGlassFacadeTexture();
    const glassMat = new THREE.MeshStandardMaterial({
      map: glassFacadeTex,
      roughness: 0.1,
      metalness: 0.7,
    });
    const glassMesh = new THREE.InstancedMesh(unitBox, glassMat, glass.length);
    glassMesh.receiveShadow = true;

    for (let i = 0; i < glass.length; i++) {
      const b = glass[i];
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      glassMesh.setMatrixAt(i, dummy.matrix);
      // Tinted glass color from palette
      glassMesh.setColorAt(i, GLASS_COLORS[Math.floor(sr() * GLASS_COLORS.length)]);
    }
    glassMesh.instanceMatrix.needsUpdate = true;
    glassMesh.instanceColor.needsUpdate = true;
    scene.add(glassMesh);
  }

  // ── Podium bases ──
  if (podiums.length > 0) {
    const podMat = new THREE.MeshStandardMaterial({ color: 0x8A7A6A, roughness: 0.9, metalness: 0.05 });
    const podMesh = new THREE.InstancedMesh(unitBox, podMat, podiums.length);
    podMesh.receiveShadow = true;

    for (let i = 0; i < podiums.length; i++) {
      const p = podiums[i];
      dummy.position.set(p.x, p.h / 2, p.z);
      dummy.scale.set(p.w, p.h, p.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      podMesh.setMatrixAt(i, dummy.matrix);
    }
    podMesh.instanceMatrix.needsUpdate = true;
    scene.add(podMesh);
  }

  // ── Building window glow (night-mode) ──
  {
    const winGeo = new THREE.PlaneGeometry(1.5, 1.0);
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xFFDD88,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    // Pre-count window instances
    let totalWindows = 0;
    for (const b of buildings) {
      const floors = Math.floor(b.h / 4);
      if (floors < 1) continue;
      const panelsPerBuilding = Math.min(6, Math.max(2, Math.floor(floors * 0.8)));
      totalWindows += panelsPerBuilding;
    }
    totalWindows = Math.min(totalWindows, 2000);

    const winMesh = new THREE.InstancedMesh(winGeo, winMat, totalWindows);
    let winIdx = 0;

    for (const b of buildings) {
      if (winIdx >= totalWindows) break;
      const floors = Math.floor(b.h / 4);
      if (floors < 1) continue;
      const panelsPerBuilding = Math.min(6, Math.max(2, Math.floor(floors * 0.8)));

      for (let p = 0; p < panelsPerBuilding; p++) {
        if (winIdx >= totalWindows) break;
        const floorY = 2 + (p % floors) * 4;
        // Alternate between X-face and Z-face
        const onXFace = sr() < 0.5;
        if (onXFace) {
          const side = sr() < 0.5 ? -1 : 1;
          dummy.position.set(
            b.x + side * (b.w / 2 + 0.05),
            floorY,
            b.z + rr(-b.d / 3, b.d / 3)
          );
          dummy.rotation.set(0, Math.PI / 2, 0);
        } else {
          const side = sr() < 0.5 ? -1 : 1;
          dummy.position.set(
            b.x + rr(-b.w / 3, b.w / 3),
            floorY,
            b.z + side * (b.d / 2 + 0.05)
          );
          dummy.rotation.set(0, 0, 0);
        }
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        winMesh.setMatrixAt(winIdx++, dummy.matrix);
      }
    }

    winMesh.instanceMatrix.needsUpdate = true;
    winMesh.visible = false; // only shown at night
    scene.add(winMesh);
    buildingWindowMesh = winMesh;
  }
}

// ── Rooftop details ───────────────────────────────────────────────────

function buildRooftopDetails(scene, placements) {
  const { roofAC, roofAntennas } = placements;
  const dummy = new THREE.Object3D();

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

  // ── Obstruction lights on tall buildings ──
  {
    const tallBuildings = placements.buildings.filter(b => b.h > 30);
    if (tallBuildings.length > 0) {
      const obGeo = new THREE.SphereGeometry(0.3, 6, 5);
      const obMat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 2.0,
        roughness: 0.3,
      });
      const obMesh = new THREE.InstancedMesh(obGeo, obMat, tallBuildings.length);

      for (let i = 0; i < tallBuildings.length; i++) {
        const b = tallBuildings[i];
        dummy.position.set(b.x, b.h + 0.5, b.z);
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
}

// ── Sidewalks ─────────────────────────────────────────────────────────

function buildSidewalks(scene, placements) {
  const { sidewalks } = placements;
  if (sidewalks.length === 0) return;

  const dummy = new THREE.Object3D();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, sidewalks.length);
  mesh.receiveShadow = true;

  for (let i = 0; i < sidewalks.length; i++) {
    const s = sidewalks[i];
    dummy.position.set(s.x, 0.06, s.z);
    dummy.scale.set(s.w, 0.12, s.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// ── Parks with trees, flowers ─────────────────────────────────────────

function buildParks(scene, placements) {
  const { parkBlocks } = placements;
  if (parkBlocks.length === 0) return;

  const dummy = new THREE.Object3D();

  // Park ground planes — vibrant green
  for (const pb of parkBlocks) {
    const geo = new THREE.PlaneGeometry(pb.w, pb.d);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4CBB17, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pb.x, 0.08, pb.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Paths through parks
  for (const pb of parkBlocks) {
    const pathGeo = new THREE.PlaneGeometry(2.5, Math.min(pb.w, pb.d) * 0.9);
    pathGeo.rotateX(-Math.PI / 2);
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x9a9688, roughness: 0.9 });
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.position.set(pb.x, 0.09, pb.z);
    path.receiveShadow = true;
    scene.add(path);

    const path2 = path.clone();
    path2.rotation.y = Math.PI / 2;
    path2.position.set(pb.x, 0.09, pb.z);
    scene.add(path2);
  }

  // ── Flower patches in parks ──
  const flowerColors = [
    new THREE.Color(0xFF4060), // Red
    new THREE.Color(0xFF8040), // Orange
    new THREE.Color(0xFFDD00), // Yellow
    new THREE.Color(0xDD40FF), // Purple
    new THREE.Color(0xFF70A0), // Pink
    new THREE.Color(0x40A0FF), // Blue
    new THREE.Color(0xFFFFFF), // White
  ];

  const flowerPositions = [];
  for (const pb of parkBlocks) {
    const patchCount = 6 + Math.floor(sr() * 10);
    for (let p = 0; p < patchCount; p++) {
      const fx = pb.x + rr(-pb.w / 2 + 4, pb.w / 2 - 4);
      const fz = pb.z + rr(-pb.d / 2 + 4, pb.d / 2 - 4);
      // Skip if on path
      if (Math.abs(fx - pb.x) < 2.5 && Math.abs(fz - pb.z) < pb.d * 0.45) continue;
      if (Math.abs(fz - pb.z) < 2.5 && Math.abs(fx - pb.x) < pb.w * 0.45) continue;
      flowerPositions.push({ x: fx, z: fz, color: flowerColors[Math.floor(sr() * flowerColors.length)] });
    }
  }

  if (flowerPositions.length > 0) {
    const flowerGeo = new THREE.PlaneGeometry(1.8, 1.8);
    flowerGeo.rotateX(-Math.PI / 2);
    const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerPositions.length);
    flowerMesh.receiveShadow = true;

    for (let i = 0; i < flowerPositions.length; i++) {
      const f = flowerPositions[i];
      dummy.position.set(f.x, 0.10, f.z);
      dummy.scale.set(0.8 + sr() * 0.6, 1, 0.8 + sr() * 0.6);
      dummy.rotation.set(0, sr() * Math.PI * 2, 0);
      dummy.updateMatrix();
      flowerMesh.setMatrixAt(i, dummy.matrix);
      flowerMesh.setColorAt(i, f.color);
    }
    flowerMesh.instanceMatrix.needsUpdate = true;
    flowerMesh.instanceColor.needsUpdate = true;
    scene.add(flowerMesh);
  }

  // ── Trees via InstancedMesh ──
  const treePositions = [];
  for (const pb of parkBlocks) {
    const treesInPark = 15 + Math.floor(sr() * 20);
    for (let i = 0; i < treesInPark; i++) {
      const tx = pb.x + rr(-pb.w / 2 + 3, pb.w / 2 - 3);
      const tz = pb.z + rr(-pb.d / 2 + 3, pb.d / 2 - 3);
      if (Math.abs(tx - pb.x) < 2 && Math.abs(tz - pb.z) < pb.d * 0.45) continue;
      if (Math.abs(tz - pb.z) < 2 && Math.abs(tx - pb.x) < pb.w * 0.45) continue;
      treePositions.push({ x: tx, z: tz });
    }
  }

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3.5, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);

    const canopyGeo = new THREE.SphereGeometry(2.2, 6, 5);
    const canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, treePositions.length);
    canopyMesh.receiveShadow = true;

    // Varied greens + autumn touches
    const treeGreens = [
      new THREE.Color(0x2D8B2D), // Forest green
      new THREE.Color(0x3A9A3A), // Medium green
      new THREE.Color(0x4CAF50), // Bright green
      new THREE.Color(0x228B22), // Deep green
      new THREE.Color(0x5CB85C), // Light green
      new THREE.Color(0x8BC34A), // Lime green
      new THREE.Color(0xA5682A), // Autumn brown
      new THREE.Color(0xCC7722), // Autumn orange
      new THREE.Color(0xBB4444), // Autumn red
      new THREE.Color(0xDDAA33), // Autumn gold
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
      const csx = scale * (0.9 + sr() * 0.3);
      const csy = scale * (0.7 + sr() * 0.3);
      const csz = scale * (0.9 + sr() * 0.3);
      dummy.scale.set(csx, csy, csz);
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(i, dummy.matrix);
      // Mostly green, ~20% autumn
      const isAutumn = sr() < 0.2;
      if (isAutumn) {
        canopyMesh.setColorAt(i, treeGreens[6 + Math.floor(sr() * 4)]);
      } else {
        canopyMesh.setColorAt(i, treeGreens[Math.floor(sr() * 6)]);
      }
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
  const spacing = 40;
  const poleH = 7;

  const positions = [];
  for (const seg of roadSegments) {
    const dx = seg.end.x - seg.start.x;
    const dz = seg.end.z - seg.start.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const dirX = dx / length;
    const dirZ = dz / length;
    const normX = -dirZ;
    const normZ = dirX;
    const sideOff = seg.width / 2 + 1.5;
    const steps = Math.floor(length / spacing);

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = seg.start.x + dx * t;
      const cz = seg.start.z + dz * t;
      positions.push({ x: cx + normX * sideOff, z: cz + normZ * sideOff });
      positions.push({ x: cx - normX * sideOff, z: cz - normZ * sideOff });
    }
  }

  // Filter: inside city bounds, deduplicate close ones
  const filtered = [];
  for (const p of positions) {
    if (Math.abs(p.x - CITY_CENTER_X) > HALF + 5 ||
        Math.abs(p.z - CITY_CENTER_Z) > HALF + 5) continue;
    let tooClose = false;
    for (const f of filtered) {
      if ((f.x - p.x) ** 2 + (f.z - p.z) ** 2 < 12 * 12) { tooClose = true; break; }
    }
    if (!tooClose) filtered.push(p);
  }
  const lights = filtered.slice(0, 500);

  if (lights.length === 0) return;

  // Poles
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, poleH, 4);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.4 });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, lights.length);

  // Warm glow bulbs (#FFE4B5 = Moccasin warm)
  const bulbGeo = new THREE.SphereGeometry(0.35, 6, 5);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xFFE4B5,
    emissive: 0xFFCC88,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    transparent: true,
    opacity: 0.95,
  });
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, lights.length);

  // Glow halos around bulbs
  const glowGeo = new THREE.SphereGeometry(0.8, 6, 5);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xFFE4B5,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
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

// ── City ground plane ─────────────────────────────────────────────────

function buildGroundPlane(scene) {
  const size = CITY_SIZE + 400;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Dark asphalt base (#2A2A2A)
  ctx.fillStyle = '#2A2A2A';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle surface grain
  for (let i = 0; i < 3000; i++) {
    const v = 30 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgba(${v},${v},${v},0.2)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }

  // Radial gradient overlay: opaque center → transparent edges
  const cx = 256, cy = 256;
  const innerR = 160;
  const outerR = 256;
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
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
    depthWrite: false,        // prevent z-fighting with terrain
    polygonOffset: true,       // further prevent z-fighting
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(CITY_CENTER_X, 0.04, CITY_CENTER_Z);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
}

// ── Public API ────────────────────────────────────────────────────────

export function createCity(scene) {
  buildGroundPlane(scene);

  const roadInfo = buildRoads(scene);
  const placements = generatePlacements(roadInfo);

  buildSidewalks(scene, placements);
  buildBuildings(scene, placements);
  buildRooftopDetails(scene, placements);
  buildParks(scene, placements);
  buildStreetLights(scene);
  rebuildRoadCaches();

  const total = placements.buildings.length + placements.podiums.length;
  console.log(`[City] ${total} buildings, ${placements.podiums.length} podiums, ${roadSegments.length} roads, ${roadIntersections.length} intersections, ${placements.parkBlocks.length} parks`);
}

export function updateCityNight(isNight) {
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
}

/**
 * Returns the full road network for car/traffic systems.
 * Each segment includes start/end world coords, width, type, direction, and lane count.
 */
export function getRoadNetwork() {
  return roadNetworkCache;
}

/**
 * Returns intersection points where roads cross.
 * Each intersection has position, type, and the widths of crossing roads.
 */
export function getRoadIntersections() {
  return roadIntersectionsCache;
}

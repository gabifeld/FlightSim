// International mega-hub airport at (-8000, 8000)
// Two parallel E-W runways, three terminals, cargo, control tower, full taxiway network
import * as THREE from 'three';
import {
  INTL_AIRPORT_X, INTL_AIRPORT_Z,
  INTL_RUNWAY_LENGTH, INTL_RUNWAY_WIDTH,
} from './constants.js';

// ── Airport geometry constants ──────────────────────────────────────
const RWY_LEN  = INTL_RUNWAY_LENGTH; // 3000
const RWY_WID  = INTL_RUNWAY_WIDTH;  // 60
const RWY_HALF = RWY_LEN / 2;       // 1500
const RWY_HW   = RWY_WID / 2;       // 30
const RWY_SEP  = 300;               // separation between runway centerlines
const OX       = INTL_AIRPORT_X;    // -8000
const OZ       = INTL_AIRPORT_Z;    //  8000

// Runway centerline Z positions (runways run E-W, so they differ in Z)
const RWY_S_Z = OZ - RWY_SEP / 2;  // southern runway (09L/27R)
const RWY_N_Z = OZ + RWY_SEP / 2;  // northern runway (09R/27L)

// ── Shared materials ────────────────────────────────────────────────
let _concreteMat, _metalMat, _glassMat, _darkMetalMat, _whiteMat, _asphaltMat;

function ensureMaterials() {
  if (_concreteMat) return;
  _concreteMat  = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.8 });
  _metalMat     = new THREE.MeshStandardMaterial({ color: 0x889098, roughness: 0.4, metalness: 0.4 });
  _glassMat     = new THREE.MeshStandardMaterial({
    color: 0x88bbdd, roughness: 0.1, metalness: 0.6,
    transparent: true, opacity: 0.7,
  });
  _darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5, metalness: 0.3 });
  _whiteMat     = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 });
  _asphaltMat   = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
}

// ── Helper: InstancedMesh from position array ───────────────────────
const _dummy = new THREE.Object3D();

function addInstanced(scene, geo, mat, positions) {
  if (!positions.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    _dummy.position.set(p.x, p.y, p.z);
    _dummy.rotation.set(0, p.ry || 0, 0);
    _dummy.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// ── Runway texture (E-W orientation, canvas-rendered) ───────────────
let _runwayTexCache = null;

function createIntlRunwayTexture(num09, num27) {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // Asphalt base with noise
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 50000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const b = 25 + Math.random() * 20;
    ctx.fillStyle = `rgb(${b},${b},${b})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Edge lines (top and bottom)
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(0, 24); ctx.lineTo(w, 24);
  ctx.moveTo(0, h - 24); ctx.lineTo(w, h - 24);
  ctx.stroke();

  // Center dashed line
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 8;
  ctx.setLineDash([80, 60]);
  ctx.beginPath();
  ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Threshold markings at both ends
  ctx.fillStyle = '#dddddd';
  const stripes = 12;
  const sW = 180, sH = 40;
  const gap = (h - 80) / stripes;
  for (let end = 0; end < 2; end++) {
    const xBase = end === 0 ? 60 : w - sW - 60;
    for (let i = 0; i < stripes; i++) {
      ctx.fillRect(xBase, 50 + i * gap, sW, sH);
    }
  }

  // Touchdown zone markings
  for (let end = 0; end < 2; end++) {
    for (let pair = 0; pair < 3; pair++) {
      const offset = end === 0 ? 350 + pair * 200 : w - 350 - pair * 200 - 80;
      ctx.fillRect(offset, h * 0.3, 80, 60);
      ctx.fillRect(offset, h * 0.7 - 60, 80, 60);
    }
  }

  // Aiming points
  for (let end = 0; end < 2; end++) {
    const x = end === 0 ? 1000 : w - 1100;
    ctx.fillRect(x, h * 0.25, 100, 100);
    ctx.fillRect(x, h * 0.75 - 100, 100, 100);
  }

  // Runway numbers
  ctx.fillStyle = '#dddddd';
  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.translate(500, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(num09, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(w - 500, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(num27, 0, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 16;
  return tex;
}

function createAsphaltTex(size) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const b = 40 + Math.random() * 30;
    ctx.fillStyle = `rgb(${b},${b},${b})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 20, size / 20);
  return tex;
}

// ── Runway surface ──────────────────────────────────────────────────

function createRunways(group) {
  // Southern runway 09L/27R
  const tex1 = createIntlRunwayTexture('09L', '27R');
  const geo1 = new THREE.PlaneGeometry(RWY_LEN, RWY_WID);
  geo1.rotateX(-Math.PI / 2);
  const mat1 = new THREE.MeshStandardMaterial({ map: tex1, roughness: 0.85 });
  const rwy1 = new THREE.Mesh(geo1, mat1);
  rwy1.position.set(OX, 0.05, RWY_S_Z);
  rwy1.receiveShadow = true;
  group.add(rwy1);

  // Northern runway 09R/27L
  const tex2 = createIntlRunwayTexture('09R', '27L');
  const geo2 = new THREE.PlaneGeometry(RWY_LEN, RWY_WID);
  geo2.rotateX(-Math.PI / 2);
  const mat2 = new THREE.MeshStandardMaterial({ map: tex2, roughness: 0.85 });
  const rwy2 = new THREE.Mesh(geo2, mat2);
  rwy2.position.set(OX, 0.05, RWY_N_Z);
  rwy2.receiveShadow = true;
  group.add(rwy2);

  // Runway shoulders (grass strips)
  const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x5a8a3a, roughness: 0.95 });
  for (const rz of [RWY_S_Z, RWY_N_Z]) {
    for (const side of [-1, 1]) {
      const sGeo = new THREE.PlaneGeometry(RWY_LEN + 40, 15);
      sGeo.rotateX(-Math.PI / 2);
      const shoulder = new THREE.Mesh(sGeo, shoulderMat);
      shoulder.position.set(OX, 0.02, rz + side * (RWY_HW + 8.5));
      shoulder.receiveShadow = true;
      group.add(shoulder);
    }
  }
}

// ── Taxiway network geometry + markings ─────────────────────────────

function createTaxiways(group) {
  const taxiMat = new THREE.MeshStandardMaterial({
    map: createAsphaltTex(3000),
    roughness: 0.85,
  });
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xccaa00 });

  // Alpha taxiway: parallel south of southern runway
  const alphaZ = RWY_S_Z - RWY_HW - 80;
  const bravoZ = RWY_N_Z + RWY_HW + 80;
  const taxiLen = RWY_LEN + 400;
  const taxiWid = 35;

  for (const tz of [alphaZ, bravoZ]) {
    const geo = new THREE.PlaneGeometry(taxiLen, taxiWid);
    geo.rotateX(-Math.PI / 2);
    const tw = new THREE.Mesh(geo, taxiMat);
    tw.position.set(OX, 0.04, tz);
    tw.receiveShadow = true;
    group.add(tw);

    // Center line
    const lineGeo = new THREE.PlaneGeometry(taxiLen - 20, 0.6);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, yellowMat);
    line.position.set(OX, 0.06, tz);
    group.add(line);
  }

  // Cross-taxiways connecting alpha & bravo to runways (N-S connectors)
  const crossXPositions = [-1200, -600, 0, 600, 1200]; // relative to OX
  const crossLen = bravoZ - alphaZ; // full span from alpha to bravo

  for (const dx of crossXPositions) {
    const cx = OX + dx;
    const geo = new THREE.PlaneGeometry(taxiWid, crossLen);
    geo.rotateX(-Math.PI / 2);
    const cross = new THREE.Mesh(geo, taxiMat);
    cross.position.set(cx, 0.04, OZ);
    cross.receiveShadow = true;
    group.add(cross);

    // Center line
    const lineGeo = new THREE.PlaneGeometry(0.6, crossLen - 10);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, yellowMat);
    line.position.set(cx, 0.06, OZ);
    group.add(line);
  }

  // Apron pads
  // Terminal 1 apron (between runways, south side)
  const t1ApronGeo = new THREE.PlaneGeometry(400, 120);
  t1ApronGeo.rotateX(-Math.PI / 2);
  const t1Apron = new THREE.Mesh(t1ApronGeo, taxiMat);
  t1Apron.position.set(OX, 0.03, OZ - 30);
  t1Apron.receiveShadow = true;
  group.add(t1Apron);

  // Terminal 2 apron (north of northern runway)
  const t2ApronGeo = new THREE.PlaneGeometry(500, 140);
  t2ApronGeo.rotateX(-Math.PI / 2);
  const t2Apron = new THREE.Mesh(t2ApronGeo, taxiMat);
  t2Apron.position.set(OX + 100, 0.03, bravoZ + 90);
  t2Apron.receiveShadow = true;
  group.add(t2Apron);

  // Cargo apron (east end)
  const cargoApronGeo = new THREE.PlaneGeometry(200, 200);
  cargoApronGeo.rotateX(-Math.PI / 2);
  const cargoApron = new THREE.Mesh(cargoApronGeo, taxiMat);
  cargoApron.position.set(OX + RWY_HALF + 200, 0.03, OZ);
  cargoApron.receiveShadow = true;
  group.add(cargoApron);

  // Large central ramp between the two runways
  const centralRampGeo = new THREE.PlaneGeometry(2400, 300);
  centralRampGeo.rotateX(-Math.PI / 2);
  const centralRamp = new THREE.Mesh(centralRampGeo, taxiMat);
  centralRamp.position.set(OX, 0.025, OZ);
  centralRamp.receiveShadow = true;
  group.add(centralRamp);

  // Service road: fuel depot to hangars (west end)
  const serviceRoad1Geo = new THREE.PlaneGeometry(400, 20);
  serviceRoad1Geo.rotateX(-Math.PI / 2);
  const serviceRoad1 = new THREE.Mesh(serviceRoad1Geo, taxiMat);
  serviceRoad1.position.set(OX - RWY_HALF - 150, 0.025, OZ + 60);
  serviceRoad1.receiveShadow = true;
  group.add(serviceRoad1);

  // Service road: connecting fire station to main taxiway
  const serviceRoad2Geo = new THREE.PlaneGeometry(20, 250);
  serviceRoad2Geo.rotateX(-Math.PI / 2);
  const serviceRoad2 = new THREE.Mesh(serviceRoad2Geo, taxiMat);
  serviceRoad2.position.set(OX - RWY_HALF - 100, 0.025, OZ + 130);
  serviceRoad2.receiveShadow = true;
  group.add(serviceRoad2);
}

// ── Terminal 1 (Domestic) ───────────────────────────────────────────

function createTerminal1(group) {
  ensureMaterials();
  const tx = OX;
  const tz = OZ - 60; // between runways, south side

  // Main building
  const body = new THREE.Mesh(new THREE.BoxGeometry(200, 14, 40), _concreteMat);
  body.position.set(tx, 7, tz);
  body.receiveShadow = true;
  group.add(body);

  // Upper floor
  const upper = new THREE.Mesh(
    new THREE.BoxGeometry(180, 6, 35),
    new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.6 })
  );
  upper.position.set(tx, 17, tz);
  group.add(upper);

  // Glass facade (airside, facing north toward runway)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(198, 10), _glassMat);
  glass.position.set(tx, 8, tz + 20.1);
  glass.rotation.y = Math.PI;
  group.add(glass);

  // Upper glass
  const glass2 = new THREE.Mesh(new THREE.PlaneGeometry(178, 4), _glassMat);
  glass2.position.set(tx, 17, tz + 17.6);
  glass2.rotation.y = Math.PI;
  group.add(glass2);

  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(210, 0.8, 45), _darkMetalMat);
  roof.position.set(tx, 20.4, tz);
  group.add(roof);

  // 6 jet bridges (extending north toward runway)
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const bx = tx - 75 + i * 30;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4, 3.5, 25), bridgeMat);
    bridge.position.set(bx, 6, tz + 32);
    group.add(bridge);

    // Bridge glass
    const bGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2), _glassMat);
    bGlass.position.set(bx - 2.05, 6.5, tz + 32);
    bGlass.rotation.y = Math.PI / 2;
    group.add(bGlass);
  }

  // Gate signs
  const signMat = new THREE.MeshStandardMaterial({
    color: 0x1155aa, emissive: 0x0033aa, emissiveIntensity: 0.3,
  });
  for (let i = 0; i < 6; i++) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 0.2), signMat);
    sign.position.set(tx - 75 + i * 30, 12, tz + 20.2);
    group.add(sign);
  }
}

// ── Terminal 2 (International) ──────────────────────────────────────

function createTerminal2(group) {
  ensureMaterials();
  const tx = OX + 100;
  const tz = RWY_N_Z + RWY_HW + 80 + 90 + 80; // north of bravo taxiway + apron

  // Larger footprint
  const body = new THREE.Mesh(new THREE.BoxGeometry(280, 16, 50), _concreteMat);
  body.position.set(tx, 8, tz);
  body.receiveShadow = true;
  group.add(body);

  // Upper section
  const upper = new THREE.Mesh(
    new THREE.BoxGeometry(260, 7, 45),
    new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.6 })
  );
  upper.position.set(tx, 19.5, tz);
  group.add(upper);

  // Glass facade (south, toward runway)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(278, 12), _glassMat);
  glass.position.set(tx, 9, tz - 25.1);
  group.add(glass);

  // Upper glass
  const glass2 = new THREE.Mesh(new THREE.PlaneGeometry(258, 5), _glassMat);
  glass2.position.set(tx, 19.5, tz - 22.6);
  group.add(glass2);

  // Curved roof element
  const roofCurve = new THREE.Mesh(
    new THREE.CylinderGeometry(28, 28, 280, 16, 1, false, 0, Math.PI),
    _darkMetalMat
  );
  roofCurve.rotation.z = Math.PI / 2;
  roofCurve.rotation.y = Math.PI / 2;
  roofCurve.position.set(tx, 23, tz);
  group.add(roofCurve);

  // 8 jet bridges (extending south)
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const bx = tx - 105 + i * 30;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4, 3.5, 30), bridgeMat);
    bridge.position.set(bx, 6, tz - 40);
    group.add(bridge);

    const bGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2), _glassMat);
    bGlass.position.set(bx - 2.05, 6.5, tz - 40);
    bGlass.rotation.y = Math.PI / 2;
    group.add(bGlass);
  }

  // Entrance canopy (landside, north)
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(120, 0.4, 15),
    new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.5 })
  );
  canopy.position.set(tx, 5, tz + 32);
  group.add(canopy);

  // Canopy columns
  for (let i = -4; i <= 4; i++) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 5, 8),
      _metalMat
    );
    col.position.set(tx + i * 14, 2.5, tz + 39);
    group.add(col);
  }
}

// ── Terminal 3 (Cargo) ──────────────────────────────────────────────

function createCargoTerminal(group) {
  ensureMaterials();
  const cx = OX + RWY_HALF + 200;
  const cz = OZ;

  const corrugatedMat = new THREE.MeshStandardMaterial({ color: 0x889098, roughness: 0.5, metalness: 0.3 });
  const dockDoorMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.6 });

  // 4 cargo bays
  for (let i = 0; i < 4; i++) {
    const bz = cz - 75 + i * 50;

    // Warehouse
    const warehouse = new THREE.Mesh(new THREE.BoxGeometry(80, 12, 35), corrugatedMat);
    warehouse.position.set(cx + 60, 6, bz);
    warehouse.receiveShadow = true;
    group.add(warehouse);

    // Curved roof
    const roofC = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 18, 80, 12, 1, false, 0, Math.PI),
      _darkMetalMat
    );
    roofC.rotation.z = Math.PI / 2;
    roofC.rotation.y = Math.PI / 2;
    roofC.position.set(cx + 60, 12, bz);
    group.add(roofC);

    // Loading dock doors (west side, facing apron)
    for (let d = -1; d <= 1; d++) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 9), dockDoorMat);
      door.position.set(cx + 19.9, 4.5, bz + d * 10);
      door.rotation.y = Math.PI / 2;
      group.add(door);
    }

    // Loading dock overhang
    const overhang = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 35), corrugatedMat);
    overhang.position.set(cx + 17, 10, bz);
    group.add(overhang);
  }

  // Freight containers via InstancedMesh
  const containerGeo = new THREE.BoxGeometry(6, 2.5, 2.5);
  const containerMat = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.6 });
  const containerPositions = [];
  const colors = [0x336699, 0x993333, 0x339933, 0xcc8800, 0x666666];

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      containerPositions.push({
        x: cx + 10 - col * 7,
        y: 1.25 + (row < 2 ? 0 : 2.5),
        z: cz - 60 + (row % 2) * 100 + col * 3,
        ry: Math.random() * 0.1 - 0.05,
      });
    }
  }

  const containerInst = new THREE.InstancedMesh(containerGeo, containerMat, containerPositions.length);
  const color = new THREE.Color();
  for (let i = 0; i < containerPositions.length; i++) {
    const p = containerPositions[i];
    _dummy.position.set(p.x, p.y, p.z);
    _dummy.rotation.set(0, p.ry, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    containerInst.setMatrixAt(i, _dummy.matrix);
    color.setHex(colors[i % colors.length]);
    containerInst.setColorAt(i, color);
  }
  containerInst.instanceMatrix.needsUpdate = true;
  containerInst.instanceColor.needsUpdate = true;
  group.add(containerInst);
}

// ── Control Tower ───────────────────────────────────────────────────

function createIntlControlTower(group) {
  ensureMaterials();
  const tx = OX + 200;
  const tz = OZ;

  // Base
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 14), _concreteMat);
  base.position.set(tx, 5, tz);
  group.add(base);

  // Shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 5.5, 35, 12),
    new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.5 })
  );
  shaft.position.set(tx, 27.5, tz);
  group.add(shaft);

  // Deck
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 9, 2, 12),
    _darkMetalMat
  );
  deck.position.set(tx, 46, tz);
  group.add(deck);

  // Glass cab
  const cabMat = new THREE.MeshStandardMaterial({
    color: 0x88ccee, roughness: 0.1, metalness: 0.5,
    transparent: true, opacity: 0.5,
  });
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 6, 14), cabMat);
  cab.position.set(tx, 50, tz);
  group.add(cab);

  // Cap
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 10, 2, 12),
    new THREE.MeshStandardMaterial({ color: 0x444444 })
  );
  cap.position.set(tx, 54, tz);
  group.add(cap);

  // Antenna
  const antennaMat = new THREE.MeshBasicMaterial({ color: 0xcc0000 });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 4), antennaMat);
  antenna.position.set(tx, 61, tz);
  group.add(antenna);

  // Beacon
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.5,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), beaconMat);
  beacon.position.set(tx, 67.2, tz);
  group.add(beacon);

  // Railing posts
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 1.2, 4),
      _metalMat
    );
    post.position.set(tx + Math.cos(a) * 9.8, 48, tz + Math.sin(a) * 9.8);
    group.add(post);
  }
}

// ── Fuel depot, hangars, fire station (west end) ────────────────────

function createWestFacilities(group) {
  ensureMaterials();
  const wx = OX - RWY_HALF - 150;
  const wz = OZ;

  // Fuel depot - 4 tanks
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3, metalness: 0.4 });
  const tankGeo = new THREE.CylinderGeometry(6, 6, 12, 12);
  const tankPositions = [
    { x: wx - 20, y: 6, z: wz - 30 },
    { x: wx + 20, y: 6, z: wz - 30 },
    { x: wx - 20, y: 6, z: wz - 50 },
    { x: wx + 20, y: 6, z: wz - 50 },
  ];
  const tankInst = new THREE.InstancedMesh(tankGeo, tankMat, 4);
  for (let i = 0; i < 4; i++) {
    _dummy.position.set(tankPositions[i].x, tankPositions[i].y, tankPositions[i].z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    tankInst.setMatrixAt(i, _dummy.matrix);
  }
  tankInst.instanceMatrix.needsUpdate = true;
  group.add(tankInst);

  // Tank caps
  const capGeo = new THREE.SphereGeometry(6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const pos of tankPositions) {
    const cap = new THREE.Mesh(capGeo, tankMat);
    cap.position.set(pos.x, 12, pos.z);
    group.add(cap);
  }

  // Containment berm
  const bermMat = new THREE.MeshStandardMaterial({ color: 0x999988, roughness: 0.9 });
  const bermW = 60, bermD = 50;
  for (const [bx, bz, bw, bd] of [
    [wx, wz - 40 - bermD / 2, bermW, 0.5],
    [wx, wz - 40 + bermD / 2, bermW, 0.5],
    [wx - bermW / 2, wz - 40, 0.5, bermD],
    [wx + bermW / 2, wz - 40, 0.5, bermD],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(bw, 2, bd), bermMat);
    wall.position.set(bx, 1, bz);
    group.add(wall);
  }

  // 2 Hangars
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 });
  for (let i = 0; i < 2; i++) {
    const hz = wz + 40 + i * 80;
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(60, 14, 50), hangarMat);
    hangar.position.set(wx, 7, hz);
    hangar.receiveShadow = true;
    group.add(hangar);

    const roofC = new THREE.Mesh(
      new THREE.CylinderGeometry(26, 26, 60, 14, 1, false, 0, Math.PI),
      _darkMetalMat
    );
    roofC.rotation.z = Math.PI / 2;
    roofC.rotation.y = Math.PI / 2;
    roofC.position.set(wx, 14, hz);
    group.add(roofC);

    // Doors
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.6 });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(44, 12), doorMat);
    door.position.set(wx + 30.1, 6, hz);
    door.rotation.y = -Math.PI / 2;
    group.add(door);
  }

  // Fire station
  const brickMat = new THREE.MeshStandardMaterial({ color: 0xBB3333, roughness: 0.7 });
  const fireX = wx + 50;
  const fireZ = wz + 200;

  const fireBldg = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 20), brickMat);
  fireBldg.position.set(fireX, 4, fireZ);
  fireBldg.receiveShadow = true;
  group.add(fireBldg);

  const fireRoof = new THREE.Mesh(new THREE.BoxGeometry(32, 0.5, 22), _darkMetalMat);
  fireRoof.position.set(fireX, 8.25, fireZ);
  group.add(fireRoof);

  // 4 garage doors
  const garageDoorMat = new THREE.MeshStandardMaterial({ color: 0x992222, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 6), garageDoorMat);
    door.position.set(fireX + 15.1, 3, fireZ - 7.5 + i * 5);
    door.rotation.y = -Math.PI / 2;
    group.add(door);
  }
}

// ── Parking structures near Terminal 2 ──────────────────────────────

function createParkingStructures(group) {
  ensureMaterials();
  const px = OX + 100;
  const t2z = RWY_N_Z + RWY_HW + 80 + 90 + 80;
  const pz = t2z + 60;

  for (let g = 0; g < 2; g++) {
    const gx = px - 80 + g * 160;

    for (let level = 0; level < 4; level++) {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(50, 0.5, 30), _concreteMat);
      floor.position.set(gx, level * 4 + 0.25, pz);
      floor.receiveShadow = true;
      group.add(floor);

      for (let cx = -20; cx <= 20; cx += 10) {
        for (let cz = -12; cz <= 12; cz += 12) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), _concreteMat);
          col.position.set(gx + cx, level * 4 + 2.25, pz + cz);
          group.add(col);
        }
      }
    }

    // Roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(52, 0.5, 32), _concreteMat);
    roof.position.set(gx, 16.25, pz);
    group.add(roof);
  }
}

// ── Parked aircraft at gates ────────────────────────────────────────

function createParkedAircraft(group) {
  const fuselageMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.1 });
  const wingMat     = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.35, metalness: 0.2 });
  const engineMat   = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.5 });
  const tailMat     = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.4 });
  const noseMat     = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });

  const fuselageGeo = new THREE.CylinderGeometry(2.2, 2.2, 40, 10);
  fuselageGeo.rotateX(Math.PI / 2); // align along Z
  const wingGeo     = new THREE.BoxGeometry(0.3, 32, 5);
  const engineGeo   = new THREE.CylinderGeometry(1.0, 1.2, 5, 8);
  engineGeo.rotateX(Math.PI / 2);
  const tailVertGeo = new THREE.BoxGeometry(3, 7, 0.3);
  const tailHorizGeo= new THREE.BoxGeometry(0.2, 9, 2);
  const noseGeo     = new THREE.SphereGeometry(2.2, 8, 6, 0, Math.PI);

  // Terminal 1 gates (facing north, nose pointing toward runway)
  const t1z = OZ - 60 + 32 + 25; // jet bridge end + clearance
  for (let i = 0; i < 5; i++) {
    const ax = OX - 75 + i * 30;
    const ag = new THREE.Group();

    // Fuselage along Z
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    fuselage.position.set(ax, 2.8, t1z);
    ag.add(fuselage);

    // Nose
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(ax, 2.8, t1z - 20);
    ag.add(nose);

    // Wings
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(ax, 2.5, t1z + 2);
    ag.add(wing);

    // Engines
    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(engineGeo, engineMat);
      engine.position.set(ax + side * 8, 1.5, t1z + 0.5);
      ag.add(engine);
    }

    // Tail
    const tailV = new THREE.Mesh(tailVertGeo, tailMat);
    tailV.position.set(ax, 7, t1z + 18);
    ag.add(tailV);

    const tailH = new THREE.Mesh(tailHorizGeo, wingMat);
    tailH.position.set(ax, 6, t1z + 17);
    ag.add(tailH);

    group.add(ag);
  }

  // Terminal 2 gates (facing south) - wider-body aircraft
  const t2tz = RWY_N_Z + RWY_HW + 80 + 90 + 80;
  const t2z = t2tz - 40 - 25; // jet bridge end - clearance
  for (let i = 0; i < 6; i++) {
    const ax = OX + 100 - 105 + i * 30;
    if (i % 2 === 0) continue; // only park at half the gates for variety
    const ag = new THREE.Group();

    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    fuselage.position.set(ax, 2.8, t2z);
    ag.add(fuselage);

    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(ax, 2.8, t2z + 20);
    ag.add(nose);

    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(ax, 2.5, t2z - 2);
    ag.add(wing);

    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(engineGeo, engineMat);
      engine.position.set(ax + side * 8, 1.5, t2z - 0.5);
      ag.add(engine);
    }

    const tailV = new THREE.Mesh(tailVertGeo, tailMat);
    tailV.position.set(ax, 7, t2z - 18);
    ag.add(tailV);

    const tailH = new THREE.Mesh(tailHorizGeo, wingMat);
    tailH.position.set(ax, 6, t2z - 17);
    ag.add(tailH);

    group.add(ag);
  }
}

// ── Perimeter fence ─────────────────────────────────────────────────

function createPerimeter(group) {
  const spacing = 8;
  const margin = 100;
  const fenceMinX = OX - RWY_HALF - 250;
  const fenceMaxX = OX + RWY_HALF + 350;
  const fenceMinZ = RWY_S_Z - RWY_HW - 200;
  const fenceMaxZ = RWY_N_Z + RWY_HW + 400;

  const postPositions = [];
  // South & north
  for (let x = fenceMinX; x <= fenceMaxX; x += spacing) {
    postPositions.push({ x, y: 1.2, z: fenceMinZ });
    postPositions.push({ x, y: 1.2, z: fenceMaxZ });
  }
  // West & east
  for (let z = fenceMinZ + spacing; z < fenceMaxZ; z += spacing) {
    postPositions.push({ x: fenceMinX, y: 1.2, z });
    postPositions.push({ x: fenceMaxX, y: 1.2, z });
  }

  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.4 });
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
  for (let i = 0; i < postPositions.length; i++) {
    _dummy.position.set(postPositions[i].x, postPositions[i].y, postPositions[i].z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    postMesh.setMatrixAt(i, _dummy.matrix);
  }
  postMesh.instanceMatrix.needsUpdate = true;
  group.add(postMesh);

  // Panels
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa, transparent: true, opacity: 0.3,
    roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide,
  });
  const panelPositions = [];
  for (let x = fenceMinX; x < fenceMaxX; x += spacing) {
    panelPositions.push({ x: x + spacing / 2, y: 1.2, z: fenceMinZ, ry: 0, sx: spacing, sy: 2.2 });
    panelPositions.push({ x: x + spacing / 2, y: 1.2, z: fenceMaxZ, ry: 0, sx: spacing, sy: 2.2 });
  }
  for (let z = fenceMinZ; z < fenceMaxZ; z += spacing) {
    panelPositions.push({ x: fenceMinX, y: 1.2, z: z + spacing / 2, ry: Math.PI / 2, sx: spacing, sy: 2.2 });
    panelPositions.push({ x: fenceMaxX, y: 1.2, z: z + spacing / 2, ry: Math.PI / 2, sx: spacing, sy: 2.2 });
  }

  const basePanelGeo = new THREE.PlaneGeometry(1, 1);
  const panelMesh = new THREE.InstancedMesh(basePanelGeo, panelMat, panelPositions.length);
  for (let i = 0; i < panelPositions.length; i++) {
    const p = panelPositions[i];
    _dummy.position.set(p.x, p.y, p.z);
    _dummy.rotation.set(0, p.ry, 0);
    _dummy.scale.set(p.sx, p.sy, 1);
    _dummy.updateMatrix();
    panelMesh.setMatrixAt(i, _dummy.matrix);
  }
  panelMesh.instanceMatrix.needsUpdate = true;
  group.add(panelMesh);
}

// ── Windsocks ───────────────────────────────────────────────────────

function createWindsocks(group) {
  for (const [wx, wz] of [
    [OX - RWY_HALF + 100, RWY_S_Z - RWY_HW - 25],
    [OX + RWY_HALF - 100, RWY_N_Z + RWY_HW + 25],
  ]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 })
    );
    pole.position.set(wx, 4, wz);
    group.add(pole);

    const sockGeo = new THREE.ConeGeometry(0.8, 3, 8, 1, true);
    const sockMat = new THREE.MeshStandardMaterial({ color: 0xff6600, side: THREE.DoubleSide });
    const sock = new THREE.Mesh(sockGeo, sockMat);
    sock.rotation.z = -Math.PI / 2;
    sock.position.set(wx + 1.5, 7.8, wz);
    group.add(sock);
  }
}

// ══════════════════════════════════════════════════════════════════════
// TAXIWAY NETWORK (BFS pathfinding graph)
// ══════════════════════════════════════════════════════════════════════

// Node positions use world coords
const INTL_TAXI_NODES = [
  // Runway access points (on runway centerlines at key X positions)
  // Southern runway 09L/27R
  { id: 'intl_rwyS_w',   x: OX - 1200, z: RWY_S_Z },
  { id: 'intl_rwyS_wm',  x: OX - 600,  z: RWY_S_Z },
  { id: 'intl_rwyS_mid', x: OX,         z: RWY_S_Z },
  { id: 'intl_rwyS_em',  x: OX + 600,  z: RWY_S_Z },
  { id: 'intl_rwyS_e',   x: OX + 1200, z: RWY_S_Z },

  // Northern runway 09R/27L
  { id: 'intl_rwyN_w',   x: OX - 1200, z: RWY_N_Z },
  { id: 'intl_rwyN_wm',  x: OX - 600,  z: RWY_N_Z },
  { id: 'intl_rwyN_mid', x: OX,         z: RWY_N_Z },
  { id: 'intl_rwyN_em',  x: OX + 600,  z: RWY_N_Z },
  { id: 'intl_rwyN_e',   x: OX + 1200, z: RWY_N_Z },

  // Alpha taxiway (south of southern runway)
  { id: 'intl_alpha_w',   x: OX - 1200, z: RWY_S_Z - RWY_HW - 80 },
  { id: 'intl_alpha_wm',  x: OX - 600,  z: RWY_S_Z - RWY_HW - 80 },
  { id: 'intl_alpha_mid', x: OX,         z: RWY_S_Z - RWY_HW - 80 },
  { id: 'intl_alpha_em',  x: OX + 600,  z: RWY_S_Z - RWY_HW - 80 },
  { id: 'intl_alpha_e',   x: OX + 1200, z: RWY_S_Z - RWY_HW - 80 },

  // Bravo taxiway (north of northern runway)
  { id: 'intl_bravo_w',   x: OX - 1200, z: RWY_N_Z + RWY_HW + 80 },
  { id: 'intl_bravo_wm',  x: OX - 600,  z: RWY_N_Z + RWY_HW + 80 },
  { id: 'intl_bravo_mid', x: OX,         z: RWY_N_Z + RWY_HW + 80 },
  { id: 'intl_bravo_em',  x: OX + 600,  z: RWY_N_Z + RWY_HW + 80 },
  { id: 'intl_bravo_e',   x: OX + 1200, z: RWY_N_Z + RWY_HW + 80 },

  // Terminal 1 apron nodes (between runways)
  { id: 'intl_t1_w',   x: OX - 100, z: OZ - 30 },
  { id: 'intl_t1_mid', x: OX,        z: OZ - 30 },
  { id: 'intl_t1_e',   x: OX + 100, z: OZ - 30 },

  // Terminal 1 gates
  { id: 'intl_t1_g1', x: OX - 75,  z: OZ - 3 },
  { id: 'intl_t1_g2', x: OX - 45,  z: OZ - 3 },
  { id: 'intl_t1_g3', x: OX - 15,  z: OZ - 3 },
  { id: 'intl_t1_g4', x: OX + 15,  z: OZ - 3 },
  { id: 'intl_t1_g5', x: OX + 45,  z: OZ - 3 },
  { id: 'intl_t1_g6', x: OX + 75,  z: OZ - 3 },

  // Terminal 2 apron nodes (north of bravo)
  { id: 'intl_t2_w',   x: OX,       z: RWY_N_Z + RWY_HW + 80 + 90 },
  { id: 'intl_t2_mid', x: OX + 100, z: RWY_N_Z + RWY_HW + 80 + 90 },
  { id: 'intl_t2_e',   x: OX + 200, z: RWY_N_Z + RWY_HW + 80 + 90 },

  // Terminal 2 gates
  { id: 'intl_t2_g1', x: OX - 5,   z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g2', x: OX + 25,  z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g3', x: OX + 55,  z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g4', x: OX + 85,  z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g5', x: OX + 115, z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g6', x: OX + 145, z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g7', x: OX + 175, z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },
  { id: 'intl_t2_g8', x: OX + 205, z: RWY_N_Z + RWY_HW + 80 + 90 + 40 },

  // Cargo area nodes
  { id: 'intl_cargo_entry', x: OX + 1200, z: OZ },
  { id: 'intl_cargo_n',     x: OX + RWY_HALF + 200, z: OZ - 50 },
  { id: 'intl_cargo_s',     x: OX + RWY_HALF + 200, z: OZ + 50 },

  // Runway threshold hold points (for takeoff/landing)
  { id: 'intl_holdS_w', x: OX - RWY_HALF + 50, z: RWY_S_Z },
  { id: 'intl_holdS_e', x: OX + RWY_HALF - 50, z: RWY_S_Z },
  { id: 'intl_holdN_w', x: OX - RWY_HALF + 50, z: RWY_N_Z },
  { id: 'intl_holdN_e', x: OX + RWY_HALF - 50, z: RWY_N_Z },
];

const INTL_TAXI_EDGES = [
  // Alpha taxiway segments
  ['intl_alpha_w', 'intl_alpha_wm'],
  ['intl_alpha_wm', 'intl_alpha_mid'],
  ['intl_alpha_mid', 'intl_alpha_em'],
  ['intl_alpha_em', 'intl_alpha_e'],

  // Bravo taxiway segments
  ['intl_bravo_w', 'intl_bravo_wm'],
  ['intl_bravo_wm', 'intl_bravo_mid'],
  ['intl_bravo_mid', 'intl_bravo_em'],
  ['intl_bravo_em', 'intl_bravo_e'],

  // Southern runway segments
  ['intl_holdS_w', 'intl_rwyS_w'],
  ['intl_rwyS_w', 'intl_rwyS_wm'],
  ['intl_rwyS_wm', 'intl_rwyS_mid'],
  ['intl_rwyS_mid', 'intl_rwyS_em'],
  ['intl_rwyS_em', 'intl_rwyS_e'],
  ['intl_rwyS_e', 'intl_holdS_e'],

  // Northern runway segments
  ['intl_holdN_w', 'intl_rwyN_w'],
  ['intl_rwyN_w', 'intl_rwyN_wm'],
  ['intl_rwyN_wm', 'intl_rwyN_mid'],
  ['intl_rwyN_mid', 'intl_rwyN_em'],
  ['intl_rwyN_em', 'intl_rwyN_e'],
  ['intl_rwyN_e', 'intl_holdN_e'],

  // Cross-taxiways (alpha to southern runway)
  ['intl_alpha_w', 'intl_rwyS_w'],
  ['intl_alpha_wm', 'intl_rwyS_wm'],
  ['intl_alpha_mid', 'intl_rwyS_mid'],
  ['intl_alpha_em', 'intl_rwyS_em'],
  ['intl_alpha_e', 'intl_rwyS_e'],

  // Cross-taxiways (northern runway to bravo)
  ['intl_rwyN_w', 'intl_bravo_w'],
  ['intl_rwyN_wm', 'intl_bravo_wm'],
  ['intl_rwyN_mid', 'intl_bravo_mid'],
  ['intl_rwyN_em', 'intl_bravo_em'],
  ['intl_rwyN_e', 'intl_bravo_e'],

  // Cross-taxiways between runways (through terminal 1 area)
  ['intl_rwyS_wm', 'intl_t1_w'],
  ['intl_rwyS_mid', 'intl_t1_mid'],
  ['intl_rwyS_em', 'intl_t1_e'],
  ['intl_t1_w', 'intl_rwyN_wm'],
  ['intl_t1_mid', 'intl_rwyN_mid'],
  ['intl_t1_e', 'intl_rwyN_em'],

  // Terminal 1 apron
  ['intl_t1_w', 'intl_t1_mid'],
  ['intl_t1_mid', 'intl_t1_e'],

  // Terminal 1 gates
  ['intl_t1_w', 'intl_t1_g1'],
  ['intl_t1_w', 'intl_t1_g2'],
  ['intl_t1_mid', 'intl_t1_g3'],
  ['intl_t1_mid', 'intl_t1_g4'],
  ['intl_t1_e', 'intl_t1_g5'],
  ['intl_t1_e', 'intl_t1_g6'],

  // Terminal 2 apron (off bravo)
  ['intl_bravo_mid', 'intl_t2_w'],
  ['intl_bravo_em', 'intl_t2_mid'],
  ['intl_bravo_e', 'intl_t2_e'],
  ['intl_t2_w', 'intl_t2_mid'],
  ['intl_t2_mid', 'intl_t2_e'],

  // Terminal 2 gates
  ['intl_t2_w', 'intl_t2_g1'],
  ['intl_t2_w', 'intl_t2_g2'],
  ['intl_t2_mid', 'intl_t2_g3'],
  ['intl_t2_mid', 'intl_t2_g4'],
  ['intl_t2_mid', 'intl_t2_g5'],
  ['intl_t2_mid', 'intl_t2_g6'],
  ['intl_t2_e', 'intl_t2_g7'],
  ['intl_t2_e', 'intl_t2_g8'],

  // Cargo area
  ['intl_alpha_e', 'intl_cargo_entry'],
  ['intl_cargo_entry', 'intl_cargo_n'],
  ['intl_cargo_entry', 'intl_cargo_s'],
  ['intl_cargo_n', 'intl_cargo_s'],
];

// Build adjacency
const intlAdjacency = {};
const intlNodeMap = {};

function buildIntlNetwork() {
  for (const node of INTL_TAXI_NODES) {
    intlAdjacency[node.id] = [];
    intlNodeMap[node.id] = node;
  }
  for (const [a, b] of INTL_TAXI_EDGES) {
    if (intlAdjacency[a]) intlAdjacency[a].push(b);
    if (intlAdjacency[b]) intlAdjacency[b].push(a);
  }
}
buildIntlNetwork();

export function getIntlTaxiNetwork() {
  return { nodes: INTL_TAXI_NODES, edges: INTL_TAXI_EDGES, nodeMap: intlNodeMap };
}

// ══════════════════════════════════════════════════════════════════════
// AIRPORT LIGHTS (InstancedMesh fixtures + Points glow)
// ══════════════════════════════════════════════════════════════════════

let intlFixturePositions = [];
let intlEdgeInstanced = [];
let intlThreshGreenInstanced = [];
let intlThreshRedInstanced = [];
let intlTaxiBlueInstanced = [];
let intlApproachMeshes = [];
let intlGlowPoints = null;
let intlHaloPoints = null;
let intlNightMode = false;
let intlSceneRef = null;

function createFixtureMat(color) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 2.0, roughness: 0.2,
  });
}

function addRunwayLightsForEW(scene, fixtureGeo, rz) {
  // Runway edge lights along E-W runway
  const edgeMat = createFixtureMat(0xffeedd);
  const edgeSpacing = 60;
  const edgeCount = Math.floor(RWY_LEN / edgeSpacing) * 2 + 4;
  const edgeInst = new THREE.InstancedMesh(fixtureGeo, edgeMat, edgeCount);

  let ei = 0;
  for (let dx = -RWY_HALF; dx <= RWY_HALF; dx += edgeSpacing) {
    for (const side of [-1, 1]) {
      const px = OX + dx;
      const pz = rz + side * (RWY_HW + 2);
      _dummy.position.set(px, 0.3, pz);
      _dummy.updateMatrix();
      edgeInst.setMatrixAt(ei, _dummy.matrix);
      intlFixturePositions.push({ x: px, y: 0.3, z: pz, type: 'edge' });
      ei++;
    }
  }
  edgeInst.count = ei;
  scene.add(edgeInst);
  intlEdgeInstanced.push(edgeInst);

  // Threshold green (approach end = west, heading 09)
  const greenMat = createFixtureMat(0x00ff44);
  const threshCount = Math.floor(RWY_WID / 3) + 2;
  const greenInst = new THREE.InstancedMesh(fixtureGeo, greenMat, threshCount);
  let gi = 0;
  for (let dz = -RWY_HW + 2; dz <= RWY_HW - 2; dz += 3) {
    const px = OX - RWY_HALF - 3;
    const pz = rz + dz;
    _dummy.position.set(px, 0.25, pz);
    _dummy.updateMatrix();
    greenInst.setMatrixAt(gi, _dummy.matrix);
    intlFixturePositions.push({ x: px, y: 0.25, z: pz, type: 'threshold_green' });
    gi++;
  }
  greenInst.count = gi;
  scene.add(greenInst);
  intlThreshGreenInstanced.push(greenInst);

  // Threshold red (departure end = east)
  const redMat = createFixtureMat(0xff2200);
  const redInst = new THREE.InstancedMesh(fixtureGeo, redMat, threshCount);
  let ri = 0;
  for (let dz = -RWY_HW + 2; dz <= RWY_HW - 2; dz += 3) {
    const px = OX + RWY_HALF + 3;
    const pz = rz + dz;
    _dummy.position.set(px, 0.25, pz);
    _dummy.updateMatrix();
    redInst.setMatrixAt(ri, _dummy.matrix);
    intlFixturePositions.push({ x: px, y: 0.25, z: pz, type: 'threshold_red' });
    ri++;
  }
  redInst.count = ri;
  scene.add(redInst);
  intlThreshRedInstanced.push(redInst);

  // Approach Light System (west end, for 09 approach)
  const alsMat = createFixtureMat(0xffffff);
  for (let row = 1; row <= 8; row++) {
    const xPos = OX - RWY_HALF - row * 30;
    const count = row <= 3 ? 3 : 1;
    for (let i = -Math.floor(count / 2); i <= Math.floor(count / 2); i++) {
      const mesh = new THREE.Mesh(fixtureGeo, alsMat.clone());
      mesh.position.set(xPos, 0.2 + row * 0.1, rz + i * 4);
      scene.add(mesh);
      intlApproachMeshes.push({ mesh, row, baseIntensity: 1.2 });
      intlFixturePositions.push({ x: xPos, y: 0.2 + row * 0.1, z: rz + i * 4, type: 'als' });
    }
  }
}

function addTaxiwayLights(scene) {
  const fixtureGeo = new THREE.BoxGeometry(0.25, 0.3, 0.25);
  const blueMat = createFixtureMat(0x2244ff);
  const alphaZ = RWY_S_Z - RWY_HW - 80;
  const bravoZ = RWY_N_Z + RWY_HW + 80;

  const positions = [];

  // Alpha and bravo taxiway edge lights
  for (const tz of [alphaZ, bravoZ]) {
    for (let dx = -RWY_HALF - 200; dx <= RWY_HALF + 200; dx += 30) {
      for (const side of [-1, 1]) {
        positions.push({ x: OX + dx, y: 0.2, z: tz + side * 10.5 });
      }
    }
  }

  // Cross-taxiway lights
  const crossXPositions = [-1200, -600, 0, 600, 1200];
  for (const dx of crossXPositions) {
    for (let z = alphaZ; z <= bravoZ; z += 30) {
      for (const side of [-1, 1]) {
        positions.push({ x: OX + dx + side * 10.5, y: 0.2, z });
      }
    }
  }

  const blueInst = new THREE.InstancedMesh(fixtureGeo, blueMat, positions.length);
  for (let i = 0; i < positions.length; i++) {
    _dummy.position.set(positions[i].x, positions[i].y, positions[i].z);
    _dummy.updateMatrix();
    blueInst.setMatrixAt(i, _dummy.matrix);
    intlFixturePositions.push({ ...positions[i], type: 'taxi_blue' });
  }
  blueInst.count = positions.length;
  scene.add(blueInst);
  intlTaxiBlueInstanced.push(blueInst);
}

function buildIntlGlowPoints(scene) {
  const count = intlFixturePositions.length;
  if (count === 0) return;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  const colorMap = {
    edge: new THREE.Color(0xffeedd),
    threshold_green: new THREE.Color(0x00ff44),
    threshold_red: new THREE.Color(0xff2200),
    taxi_blue: new THREE.Color(0x4466ff),
    als: new THREE.Color(0xffffff),
  };

  for (let i = 0; i < count; i++) {
    const f = intlFixturePositions[i];
    positions[i * 3]     = f.x;
    positions[i * 3 + 1] = f.y + 0.5;
    positions[i * 3 + 2] = f.z;
    const c = colorMap[f.type] || colorMap.edge;
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 12, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  intlGlowPoints = new THREE.Points(geo, mat);
  intlGlowPoints.frustumCulled = false;
  intlGlowPoints.visible = false;
  scene.add(intlGlowPoints);

  // Halo layer — larger, softer glow
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  haloGeo.setAttribute('color', new THREE.BufferAttribute(colors.slice(), 3));

  const haloMat = new THREE.PointsMaterial({
    size: 24, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  intlHaloPoints = new THREE.Points(haloGeo, haloMat);
  intlHaloPoints.frustumCulled = false;
  intlHaloPoints.visible = false;
  scene.add(intlHaloPoints);
}

export function createIntlAirportLights(scene) {
  intlSceneRef = scene;
  const fixtureGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);

  // Runway lights for both runways
  addRunwayLightsForEW(scene, fixtureGeo, RWY_S_Z);
  addRunwayLightsForEW(scene, fixtureGeo, RWY_N_Z);

  // Taxiway lights
  addTaxiwayLights(scene);

  // Build glow points
  buildIntlGlowPoints(scene);
}

export function updateIntlAirportLights(dt) {
  if (!intlSceneRef) return;

  const time = performance.now() * 0.001;

  // Toggle glow + halo points
  if (intlGlowPoints) intlGlowPoints.visible = intlNightMode;
  if (intlHaloPoints) intlHaloPoints.visible = intlNightMode;

  // ALS strobe animation
  if (intlNightMode) {
    const cycleTime = 1.5;
    const phase = (time % cycleTime) / cycleTime;
    for (const als of intlApproachMeshes) {
      const rowPhase = als.row / 10;
      const dist = Math.abs(phase - (1 - rowPhase));
      als.mesh.material.emissiveIntensity = dist < 0.08 ? 8.0 : 5.0;
    }
  } else {
    for (const als of intlApproachMeshes) {
      als.mesh.material.emissiveIntensity = 0.8;
    }
  }

  // Emissive intensity
  const emissiveMul = intlNightMode ? 5.0 : 0.8;
  for (const inst of intlEdgeInstanced) inst.material.emissiveIntensity = emissiveMul;
  for (const inst of intlThreshGreenInstanced) inst.material.emissiveIntensity = intlNightMode ? 6.0 : 0.8;
  for (const inst of intlThreshRedInstanced) inst.material.emissiveIntensity = intlNightMode ? 6.0 : 0.8;
  for (const inst of intlTaxiBlueInstanced) inst.material.emissiveIntensity = intlNightMode ? 4.0 : 0.8;
}

export function setIntlNightMode(isNight) {
  intlNightMode = isNight;
}

// ── Airport Hotel & Conference Center (landside, north of Terminal 2) ─
function createAirportHotel(group) {
  ensureMaterials();
  const t2tz = RWY_N_Z + RWY_HW + 80 + 90 + 80;
  const hx = OX + 300;
  const hz = t2tz + 120;

  // Main tower
  const hotelMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.2 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(30, 50, 25), hotelMat);
  tower.position.set(hx, 25, hz);
  tower.receiveShadow = true;
  group.add(tower);

  // Glass facade on all sides
  for (let floor = 0; floor < 8; floor++) {
    const fy = 6 + floor * 5.5;
    for (const [fx, fz, ry, w] of [
      [hx, hz + 12.6, 0, 28],
      [hx, hz - 12.6, Math.PI, 28],
      [hx + 15.1, hz, Math.PI / 2, 23],
      [hx - 15.1, hz, -Math.PI / 2, 23],
    ]) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), _glassMat);
      stripe.position.set(fx, fy, fz);
      stripe.rotation.y = ry;
      group.add(stripe);
    }
  }

  // Conference wing (lower, wider)
  const confMat = new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.5 });
  const conf = new THREE.Mesh(new THREE.BoxGeometry(60, 12, 30), confMat);
  conf.position.set(hx - 45, 6, hz);
  group.add(conf);

  // Conference roof
  const confRoof = new THREE.Mesh(new THREE.BoxGeometry(62, 0.6, 32), _darkMetalMat);
  confRoof.position.set(hx - 45, 12.3, hz);
  group.add(confRoof);
}

// ── Radar / ILS facility (approach end of southern runway) ───────────
function createRadarFacility(group) {
  ensureMaterials();
  const rx = OX - RWY_HALF - 200;
  const rz = RWY_S_Z;

  // Equipment building
  const bldg = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 8), _concreteMat);
  bldg.position.set(rx, 2.5, rz);
  group.add(bldg);

  // Radar dish tower
  const radarPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.4, 15, 6),
    _metalMat
  );
  radarPole.position.set(rx, 12.5, rz);
  group.add(radarPole);

  // Dish
  const dishGeo = new THREE.SphereGeometry(3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const dish = new THREE.Mesh(dishGeo, _whiteMat);
  dish.position.set(rx, 20, rz);
  dish.rotation.x = Math.PI;
  group.add(dish);

  // Localizer antenna array (wide bar)
  const locBar = new THREE.Mesh(
    new THREE.BoxGeometry(40, 3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xcc4400, roughness: 0.6 })
  );
  locBar.position.set(rx + 30, 2, rz);
  group.add(locBar);
}

// ── Ground support equipment on aprons (instanced) ──────────────────
function createGroundEquipment(group) {
  const equipMat = new THREE.MeshStandardMaterial({ color: 0xddaa00, roughness: 0.6 });
  const truckGeo = new THREE.BoxGeometry(3, 2, 6);

  // Scatter small ground vehicles across Terminal 1 and Terminal 2 aprons
  const positions = [];
  // T1 apron area
  for (let i = 0; i < 8; i++) {
    positions.push({
      x: OX - 60 + i * 18,
      y: 1,
      z: OZ - 10 + (Math.random() - 0.5) * 20,
      ry: Math.random() * Math.PI * 2,
    });
  }
  // T2 apron area
  const bravoZ = RWY_N_Z + RWY_HW + 80;
  for (let i = 0; i < 10; i++) {
    positions.push({
      x: OX + i * 22 - 20,
      y: 1,
      z: bravoZ + 70 + (Math.random() - 0.5) * 30,
      ry: Math.random() * Math.PI * 2,
    });
  }
  // Cargo area
  for (let i = 0; i < 5; i++) {
    positions.push({
      x: OX + RWY_HALF + 160 + (Math.random() - 0.5) * 40,
      y: 1,
      z: OZ + (Math.random() - 0.5) * 80,
      ry: Math.random() * Math.PI * 2,
    });
  }

  const inst = new THREE.InstancedMesh(truckGeo, equipMat, positions.length);
  const color = new THREE.Color();
  const eqColors = [0xddaa00, 0x2266aa, 0xeeeeee, 0x44aa44];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    _dummy.position.set(p.x, p.y, p.z);
    _dummy.rotation.set(0, p.ry, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    inst.setMatrixAt(i, _dummy.matrix);
    color.setHex(eqColors[i % eqColors.length]);
    inst.setColorAt(i, color);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor.needsUpdate = true;
  group.add(inst);
}

// ── Taxiway identification signs ────────────────────────────────────
function createTaxiwaySigns(group) {
  const signBlackMat = new THREE.MeshStandardMaterial({
    color: 0x222222, emissive: 0x111111, emissiveIntensity: 0.3,
  });
  const signYellowMat = new THREE.MeshStandardMaterial({
    color: 0xccaa00, emissive: 0x665500, emissiveIntensity: 0.5,
  });
  const signGeo = new THREE.BoxGeometry(4, 1.5, 0.3);

  // Place signs at major taxiway intersections
  const alphaZ = RWY_S_Z - RWY_HW - 80;
  const bravoZ = RWY_N_Z + RWY_HW + 80;
  const crossXPositions = [-1200, -600, 0, 600, 1200];

  for (const dx of crossXPositions) {
    const x = OX + dx;
    // Alpha sign
    const sA = new THREE.Mesh(signGeo, signYellowMat);
    sA.position.set(x + 14, 1, alphaZ + 14);
    group.add(sA);
    // Bravo sign
    const sB = new THREE.Mesh(signGeo, signYellowMat);
    sB.position.set(x + 14, 1, bravoZ - 14);
    group.add(sB);
    // Runway crossing sign (red/white)
    const sR = new THREE.Mesh(signGeo, signBlackMat);
    sR.position.set(x + 14, 1, RWY_S_Z + RWY_HW + 5);
    group.add(sR);
  }
}

// ── VOR/DME antenna ─────────────────────────────────────────────────
function createNavAids(group) {
  ensureMaterials();
  // VOR located 500m south of southern runway
  const vx = OX + 300;
  const vz = RWY_S_Z - 500;

  // Checkered shed
  const shedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const shed = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), shedMat);
  shed.position.set(vx, 1.5, vz);
  group.add(shed);

  // VOR cone antenna
  const vorCone = new THREE.Mesh(
    new THREE.ConeGeometry(4, 2, 12),
    _whiteMat
  );
  vorCone.position.set(vx, 4, vz);
  group.add(vorCone);

  // DME antenna tower
  const dmePole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 8, 6),
    _metalMat
  );
  dmePole.position.set(vx + 10, 4, vz);
  group.add(dmePole);

  // Glideslope antenna (near runway touchdown zone)
  const gsX = OX - RWY_HALF + 300;
  const gsZ = RWY_S_Z - RWY_HW - 40;
  const gsMast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 6, 6),
    _metalMat
  );
  gsMast.position.set(gsX, 3, gsZ);
  group.add(gsMast);

  const gsArray = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 4, 1),
    new THREE.MeshStandardMaterial({ color: 0xcc4400, roughness: 0.6 })
  );
  gsArray.position.set(gsX, 5, gsZ);
  group.add(gsArray);
}

// ══════════════════════════════════════════════════════════════════════
// RUNWAY DETECTION (for physics / taxi system)
// ══════════════════════════════════════════════════════════════════════

export function isOnIntlRunway(x, z) {
  // E-W runways: length along X axis, width along Z axis
  for (const rz of [RWY_S_Z, RWY_N_Z]) {
    if (Math.abs(x - OX) < RWY_HALF && Math.abs(z - rz) < RWY_HW) return true;
  }
  return false;
}

export function isOnIntlTaxiway(x, z) {
  const alphaZ = RWY_S_Z - RWY_HW - 80;
  const bravoZ = RWY_N_Z + RWY_HW + 80;

  // Alpha taxiway
  if (Math.abs(z - alphaZ) < 12 && Math.abs(x - OX) < RWY_HALF + 220) return true;
  // Bravo taxiway
  if (Math.abs(z - bravoZ) < 12 && Math.abs(x - OX) < RWY_HALF + 220) return true;

  // Cross-taxiways
  for (const dx of [-1200, -600, 0, 600, 1200]) {
    if (Math.abs(x - (OX + dx)) < 12 && z >= alphaZ - 10 && z <= bravoZ + 10) return true;
  }

  // Aprons
  if (Math.abs(x - OX) < 200 && Math.abs(z - (OZ - 30)) < 80) return true; // T1
  const t2z = RWY_N_Z + RWY_HW + 80 + 90;
  if (Math.abs(x - (OX + 100)) < 260 && Math.abs(z - t2z) < 80) return true; // T2
  if (Math.abs(x - (OX + RWY_HALF + 200)) < 120 && Math.abs(z - OZ) < 120) return true; // Cargo

  return false;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════════════

export function createInternationalAirport(scene) {
  ensureMaterials();

  const group = new THREE.Group();

  createRunways(group);
  createTaxiways(group);
  createTerminal1(group);
  createTerminal2(group);
  createCargoTerminal(group);
  createIntlControlTower(group);
  createWestFacilities(group);
  createParkingStructures(group);
  createParkedAircraft(group);
  createAirportHotel(group);
  createRadarFacility(group);
  createGroundEquipment(group);
  createTaxiwaySigns(group);
  createNavAids(group);
  createPerimeter(group);
  createWindsocks(group);

  scene.add(group);
  return group;
}

import * as THREE from 'three';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, AIRPORT2_X, AIRPORT2_Z } from './constants.js';
import { createAirportStructures } from './airportStructures.js';

function createRunwayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 4096;
  const ctx = canvas.getContext('2d');

  const w = canvas.width;
  const h = canvas.height;

  // Darker asphalt base for high contrast
  ctx.fillStyle = 'rgb(50, 50, 55)';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const brightness = 40 + Math.random() * 25;
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness + 2})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Edge lines (50% wider)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.moveTo(24, 0);
  ctx.lineTo(24, h);
  ctx.moveTo(w - 24, 0);
  ctx.lineTo(w - 24, h);
  ctx.stroke();

  // Center dashed line (50% wider)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 12;
  ctx.setLineDash([80, 60]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Threshold markings (wider stripes, pure white)
  ctx.fillStyle = '#ffffff';
  const thresholdStripes = 12;
  const stripeW = 60;
  const stripeH = 220;
  const stripeGap = (w - 80) / thresholdStripes;
  for (let end = 0; end < 2; end++) {
    const yBase = end === 0 ? 60 : h - stripeH - 60;
    for (let i = 0; i < thresholdStripes; i++) {
      const x = 50 + i * stripeGap;
      ctx.fillRect(x, yBase, stripeW, stripeH);
    }
  }

  // Touchdown zone markings (wider)
  ctx.fillStyle = '#ffffff';
  for (let end = 0; end < 2; end++) {
    for (let pair = 0; pair < 3; pair++) {
      const offset = end === 0 ? 350 + pair * 200 : h - 350 - pair * 200 - 80;
      ctx.fillRect(w * 0.3, offset, 90, 80);
      ctx.fillRect(w * 0.7 - 90, offset, 90, 80);
    }
  }

  // Aiming point markings (wider)
  for (let end = 0; end < 2; end++) {
    const y = end === 0 ? 1000 : h - 1000 - 120;
    ctx.fillRect(w * 0.25, y, 120, 120);
    ctx.fillRect(w * 0.75 - 120, y, 120, 120);
  }

  // Runway numbers (larger, pure white)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 160px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.translate(w / 2, 500);
  ctx.fillText('09', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(w / 2, h - 500);
  ctx.rotate(Math.PI);
  ctx.fillText('27', 0, 0);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 16;
  return texture;
}

function createAsphaltTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const b = 40 + Math.random() * 30;
    ctx.fillStyle = `rgb(${b}, ${b}, ${b})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 20, size / 20);
  return tex;
}

let runwayTextureCache = null;
const asphaltTextureCache = new Map();

function getRunwayTexture() {
  if (!runwayTextureCache) runwayTextureCache = createRunwayTexture();
  return runwayTextureCache;
}

function getAsphaltTexture(size) {
  const key = Math.round(size);
  if (!asphaltTextureCache.has(key)) {
    asphaltTextureCache.set(key, createAsphaltTexture(size));
  }
  return asphaltTextureCache.get(key);
}

function addInstancedBoxes(scene, geometry, material, positions) {
  if (!positions.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry || 0, 0);
    dummy.scale.set(
      p.sx === undefined ? 1 : p.sx,
      p.sy === undefined ? 1 : p.sy,
      p.sz === undefined ? 1 : p.sz
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

export function isOnRunway(x, z) {
  // Airport 1 at origin
  if (Math.abs(x) < RUNWAY_WIDTH / 2 && Math.abs(z) < RUNWAY_LENGTH / 2) return true;
  // Airport 2
  if (Math.abs(x - AIRPORT2_X) < RUNWAY_WIDTH / 2 && Math.abs(z - AIRPORT2_Z) < RUNWAY_LENGTH / 2) return true;
  // International airport (E-W runways) — imported lazily to avoid circular deps
  if (_isOnIntlRunway && _isOnIntlRunway(x, z)) return true;
  return false;
}

let _isOnIntlRunway = null;
export function registerIntlRunwayCheck(fn) {
  _isOnIntlRunway = fn;
}

export function buildAirport(scene, {
  originX = 0,
  originZ = 0,
  includeApron = true,
  includeTerminal = true,
  includeExtras = true,
} = {}) {
  const ox = originX;
  const oz = originZ;
  const halfLen = RUNWAY_LENGTH / 2;
  const halfWid = RUNWAY_WIDTH / 2;

  // Main runway surface
  const runwayGeo = new THREE.PlaneGeometry(RUNWAY_WIDTH, RUNWAY_LENGTH);
  runwayGeo.rotateX(-Math.PI / 2);
  const runwayMat = new THREE.MeshStandardMaterial({
    map: getRunwayTexture(),
    roughness: 0.85,
    metalness: 0.0,
  });
  const runway = new THREE.Mesh(runwayGeo, runwayMat);
  runway.position.set(ox, 0.05, oz);
  runway.receiveShadow = true;
  scene.add(runway);

  // Parallel taxiway
  const parallelTaxiX = ox + halfWid + 100;
  const parallelTaxiLen = RUNWAY_LENGTH + 400;
  const taxiwayWid = 20;

  const parallelGeo = new THREE.PlaneGeometry(taxiwayWid, parallelTaxiLen);
  parallelGeo.rotateX(-Math.PI / 2);
  const taxiMat = new THREE.MeshStandardMaterial({
    map: getAsphaltTexture(parallelTaxiLen),
    roughness: 0.85,
    metalness: 0.0,
  });
  const parallelTaxiway = new THREE.Mesh(parallelGeo, taxiMat);
  parallelTaxiway.position.set(parallelTaxiX, 0.04, oz);
  parallelTaxiway.receiveShadow = true;
  scene.add(parallelTaxiway);

  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xccaa00 });
  const ptLineGeo = new THREE.PlaneGeometry(0.6, parallelTaxiLen - 20);
  ptLineGeo.rotateX(-Math.PI / 2);
  const ptLine = new THREE.Mesh(ptLineGeo, yellowMat);
  ptLine.position.set(parallelTaxiX, 0.06, oz);
  scene.add(ptLine);

  const exitZPositions = [-600, 0, 600];
  const exitLen = parallelTaxiX - (ox + halfWid);
  const taxiLightPositions = [];
  for (let z = -halfLen; z <= halfLen; z += 30) {
    taxiLightPositions.push({ x: parallelTaxiX, y: 0.08, z: oz + z });
  }

  for (const ez of exitZPositions) {
    const exitGeo = new THREE.PlaneGeometry(exitLen + 10, taxiwayWid);
    exitGeo.rotateX(-Math.PI / 2);
    const exitMesh = new THREE.Mesh(exitGeo, taxiMat);
    exitMesh.position.set(ox + halfWid + exitLen / 2, 0.04, oz + ez);
    exitMesh.receiveShadow = true;
    scene.add(exitMesh);

    const exitLineGeo = new THREE.PlaneGeometry(exitLen - 5, 0.6);
    exitLineGeo.rotateX(-Math.PI / 2);
    const exitLine = new THREE.Mesh(exitLineGeo, yellowMat);
    exitLine.position.set(ox + halfWid + exitLen / 2, 0.06, oz + ez);
    scene.add(exitLine);

    for (let x = ox + halfWid + 10; x < parallelTaxiX; x += 15) {
      taxiLightPositions.push({ x, y: 0.08, z: oz + ez });
    }
  }

  const taxiLightMat = new THREE.MeshStandardMaterial({
    color: 0x00cc00,
    emissive: 0x00aa00,
    emissiveIntensity: 1.2,
  });
  addInstancedBoxes(scene, new THREE.BoxGeometry(0.3, 0.15, 0.3), taxiLightMat, taxiLightPositions);

  if (includeApron) {
    createTaxiSign(scene, parallelTaxiX - 12, oz - 600, 'A1', 'green');
    createTaxiSign(scene, parallelTaxiX - 12, oz, 'A2', 'green');
    createTaxiSign(scene, parallelTaxiX - 12, oz + 600, 'A3', 'green');
    createTaxiSign(scene, parallelTaxiX + 12, oz - 300, 'A', 'yellow');
    createTaxiSign(scene, parallelTaxiX + 12, oz + 300, 'A', 'yellow');

    const taxiwayLen = 150;
    const connGeo = new THREE.PlaneGeometry(taxiwayLen, taxiwayWid);
    connGeo.rotateX(-Math.PI / 2);
    const connector = new THREE.Mesh(connGeo, taxiMat);
    connector.position.set(parallelTaxiX + taxiwayLen / 2, 0.04, oz);
    connector.receiveShadow = true;
    scene.add(connector);

    const connLineGeo = new THREE.PlaneGeometry(taxiwayLen - 10, 0.6);
    connLineGeo.rotateX(-Math.PI / 2);
    const connLine = new THREE.Mesh(connLineGeo, yellowMat);
    connLine.position.set(parallelTaxiX + taxiwayLen / 2, 0.06, oz);
    scene.add(connLine);

    const apronW = includeExtras ? 250 : 200;
    const apronH = includeExtras ? 200 : 150;
    const apronGeo = new THREE.PlaneGeometry(apronW, apronH);
    apronGeo.rotateX(-Math.PI / 2);
    const apronMat = new THREE.MeshStandardMaterial({
      map: getAsphaltTexture(apronW),
      roughness: 0.8,
      metalness: 0.0,
    });
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.set(parallelTaxiX + 130, 0.03, oz);
    apron.receiveShadow = true;
    scene.add(apron);

    if (includeTerminal) {
      const buildingBaseX = parallelTaxiX + 60;
      createTerminalBuilding(scene, buildingBaseX, oz - 30);
      createHangar(scene, buildingBaseX + 160, oz + 50);
      createHangar(scene, buildingBaseX + 160, oz - 50);
      createControlTower(scene, buildingBaseX + 80, oz + 80);

      if (includeExtras) {
        createFuelStation(scene, buildingBaseX + 30, oz + 55);
        createGroundVehicles(scene, buildingBaseX + 20, oz + 15);
        createParkingGarage(scene, buildingBaseX + 130, oz - 90);

        const gateLineMat = new THREE.MeshBasicMaterial({ color: 0xdddd00 });
        const gatePositions = [
          { x: ox + halfWid + 280, z: oz - 60, label: 'G1' },
          { x: ox + halfWid + 280, z: oz - 20, label: 'G2' },
          { x: ox + halfWid + 280, z: oz + 20, label: 'G3' },
          { x: ox + halfWid + 280, z: oz + 60, label: 'G4' },
        ];
        for (const gate of gatePositions) {
          const lineGeo = new THREE.PlaneGeometry(0.5, 20);
          lineGeo.rotateX(-Math.PI / 2);
          const guideLine = new THREE.Mesh(lineGeo, gateLineMat);
          guideLine.position.set(gate.x, 0.06, gate.z);
          scene.add(guideLine);

          const crossGeo = new THREE.PlaneGeometry(10, 0.5);
          crossGeo.rotateX(-Math.PI / 2);
          const crossLine = new THREE.Mesh(crossGeo, gateLineMat);
          crossLine.position.set(gate.x + 10, 0.06, gate.z);
          scene.add(crossLine);

          createTaxiSign(scene, gate.x + 12, gate.z, gate.label, 'blue');
        }
      }
    }
  }

  const edgePositions = [];
  for (let z = -halfLen; z <= halfLen; z += 60) {
    edgePositions.push({ x: ox - (halfWid + 1.5), y: 0.35, z: oz + z });
    edgePositions.push({ x: ox + (halfWid + 1.5), y: 0.35, z: oz + z });
  }
  const edgeLightMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.8,
  });
  addInstancedBoxes(scene, new THREE.BoxGeometry(0.4, 0.6, 0.4), edgeLightMat, edgePositions);

  const greenPositions = [];
  const redPositions = [];
  for (let x = -halfWid + 2; x <= halfWid - 2; x += 3) {
    greenPositions.push({ x: ox + x, y: 0.25, z: oz - halfLen - 2 });
    redPositions.push({ x: ox + x, y: 0.25, z: oz + halfLen + 2 });
  }
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00cc00, emissiveIntensity: 1.0 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xcc0000, emissiveIntensity: 1.0 });
  addInstancedBoxes(scene, new THREE.BoxGeometry(0.6, 0.4, 0.6), greenMat, greenPositions);
  addInstancedBoxes(scene, new THREE.BoxGeometry(0.6, 0.4, 0.6), redMat, redPositions);

  createPAPI(scene, ox - halfWid - 15, oz - halfLen + 300);
  createPAPI(scene, ox + halfWid + 15, oz + halfLen - 300);

  for (const side of [-1, 1]) {
    const shoulderGeo = new THREE.PlaneGeometry(15, RUNWAY_LENGTH + 40);
    shoulderGeo.rotateX(-Math.PI / 2);
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x5a8a3a, roughness: 0.95 });
    const shoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulder.position.set(ox + side * (halfWid + 8.5), 0.02, oz);
    shoulder.receiveShadow = true;
    scene.add(shoulder);
  }

  const ilsWhitePositions = [];
  const ilsRedPositions = [];
  for (let row = 1; row <= 10; row++) {
    const lightsInRow = row <= 3 ? 5 : 3;
    const spacing = row <= 3 ? 4 : 6;
    for (let i = -Math.floor(lightsInRow / 2); i <= Math.floor(lightsInRow / 2); i++) {
      const pSouth = { x: ox + i * spacing, y: 0.2 + row * 0.1, z: oz + halfLen + row * 30 };
      const pNorth = { x: ox + i * spacing, y: 0.2 + row * 0.1, z: oz - halfLen - row * 30 };
      if (row <= 2) {
        ilsRedPositions.push(pSouth, pNorth);
      } else {
        ilsWhitePositions.push(pSouth, pNorth);
      }
    }
  }
  const ilsWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
  const ilsRedMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 1.0 });
  addInstancedBoxes(scene, new THREE.BoxGeometry(0.5, 0.3, 0.5), ilsWhiteMat, ilsWhitePositions);
  addInstancedBoxes(scene, new THREE.BoxGeometry(0.5, 0.3, 0.5), ilsRedMat, ilsRedPositions);

  createWindsock(scene, ox + halfWid + 25, oz - halfLen + 100);
  return runway;
}

export function createRunway(scene) {
  const runway = buildAirport(scene, {
    originX: 0,
    originZ: 0,
    includeApron: true,
    includeTerminal: true,
    includeExtras: true,
  });
  buildAirport(scene, {
    originX: AIRPORT2_X,
    originZ: AIRPORT2_Z,
    includeApron: true,
    includeTerminal: true,
    includeExtras: false,
  });
  createAirportStructures(scene, 0, 0, true);
  createAirportStructures(scene, AIRPORT2_X, AIRPORT2_Z, false);
  return runway;
}

function createTerminalBuilding(scene, x, z) {
  const group = new THREE.Group();

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd4cfc4, roughness: 0.7 });
  const darkWallMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88bbdd,
    roughness: 0.1,
    metalness: 0.6,
    transparent: true,
    opacity: 0.7,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5 });
  const metalTrimMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.6 });

  // Main building - wider and taller
  const body = new THREE.Mesh(new THREE.BoxGeometry(80, 14, 35), wallMat);
  body.position.set(x, 7, z);
  body.receiveShadow = true;
  group.add(body);

  // Second floor section (recessed)
  const upperBody = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 30), darkWallMat);
  upperBody.position.set(x, 17, z);
  group.add(upperBody);

  // Glass facade - ground floor
  const glass1 = new THREE.Mesh(new THREE.PlaneGeometry(78, 10), glassMat);
  glass1.position.set(x, 8, z - 17.6);
  group.add(glass1);

  // Glass facade - upper floor
  const glass2 = new THREE.Mesh(new THREE.PlaneGeometry(68, 4), glassMat);
  glass2.position.set(x, 17, z - 15.1);
  group.add(glass2);

  // Roof with overhang
  const roof = new THREE.Mesh(new THREE.BoxGeometry(85, 0.8, 40), roofMat);
  roof.position.set(x, 20.4, z);
  group.add(roof);

  // Entrance canopy (extending toward runway)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 12), metalTrimMat);
  canopy.position.set(x, 5, z - 23);
  group.add(canopy);

  // Canopy support columns
  for (let i = -2; i <= 2; i++) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 5, 8),
      metalTrimMat
    );
    col.position.set(x + i * 7, 2.5, z - 29);
    group.add(col);
  }

  // Jet bridges (2 extending from terminal toward apron)
  for (let i = -1; i <= 1; i += 2) {
    const bridgeGroup = new THREE.Group();
    const bridgeBody = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3.5, 18),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5 })
    );
    bridgeBody.position.set(x + i * 25, 6, z - 35);
    bridgeGroup.add(bridgeBody);

    // Bridge windows
    const bridgeGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 2),
      glassMat
    );
    bridgeGlass.position.set(x + i * 25 - 2.05, 6.5, z - 35);
    bridgeGlass.rotation.y = Math.PI / 2;
    bridgeGroup.add(bridgeGlass);

    group.add(bridgeGroup);
  }

  // Gate number signs
  const signMat = new THREE.MeshStandardMaterial({
    color: 0x1155aa,
    emissive: 0x0033aa,
    emissiveIntensity: 0.3,
  });
  for (let i = -1; i <= 1; i++) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 0.2), signMat);
    sign.position.set(x + i * 20, 12, z - 17.7);
    group.add(sign);
  }

  scene.add(group);
}

function createHangar(scene, x, z) {
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 });
  const hangar = new THREE.Mesh(new THREE.BoxGeometry(50, 16, 40), hangarMat);
  hangar.position.set(x, 8, z);
  hangar.receiveShadow = true;
  scene.add(hangar);

  // Curved roof
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.4, metalness: 0.4 });
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(21, 21, 50, 16, 1, false, 0, Math.PI),
    roofMat
  );
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.position.set(x, 16, z);
  scene.add(roof);

  // Large sliding doors
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.6 });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(38, 14), doorMat);
  door.position.set(x, 7, z - 20.1);
  scene.add(door);

  // Door track rails
  const railMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5 });
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(46, 0.3, 0.3), railMat);
  topRail.position.set(x, 14.2, z - 20.2);
  scene.add(topRail);
  const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(46, 0.3, 0.3), railMat);
  bottomRail.position.set(x, 0.2, z - 20.2);
  scene.add(bottomRail);

  // Side ventilation panels
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 2),
      new THREE.MeshStandardMaterial({ color: 0x556677 })
    );
    vent.position.set(x + 25.1, 10 + i * 0, z - 15 + i * 12);
    vent.rotation.y = -Math.PI / 2;
    scene.add(vent);
  }
}

function createControlTower(scene, x, z) {
  const group = new THREE.Group();

  // Base structure - wider and more solid
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), baseMat);
  base.position.set(x, 4, z);
  group.add(base);

  // Tower shaft
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.5 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 22, 10), shaftMat);
  shaft.position.set(x, 19, z);
  group.add(shaft);

  // Observation deck floor (wider platform)
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 1.5, 10), deckMat);
  deck.position.set(x, 30, z);
  group.add(deck);

  // Glass observation cab
  const cabMat = new THREE.MeshStandardMaterial({
    color: 0x88ccee,
    roughness: 0.1,
    metalness: 0.5,
    transparent: true,
    opacity: 0.5,
  });
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 5, 12), cabMat);
  cab.position.set(x, 33.5, z);
  group.add(cab);

  // Observation deck railing posts
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 1.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    post.position.set(x + Math.cos(a) * 7.8, 31.4, z + Math.sin(a) * 7.8);
    group.add(post);
  }

  // Cap roof with slight overhang
  const capMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8, 1.5, 10), capMat);
  cap.position.set(x, 36.5, z);
  group.add(cap);

  // Antenna array
  const antennaMat = new THREE.MeshBasicMaterial({ color: 0xcc0000 });
  const mainAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 10, 4), antennaMat);
  mainAntenna.position.set(x, 42, z);
  group.add(mainAntenna);

  // Radar dish
  const radarMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6 });
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 4, 0, Math.PI), radarMat);
  dish.position.set(x + 1.5, 37.5, z);
  dish.rotation.z = Math.PI / 4;
  group.add(dish);

  // Beacon light on top
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 1.5,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), beaconMat);
  beacon.position.set(x, 47.2, z);
  group.add(beacon);

  scene.add(group);
}

function createFuelStation(scene, x, z) {
  const group = new THREE.Group();

  // Fuel tank (cylindrical, horizontal)
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3, metalness: 0.4 });
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 10, 12), tankMat);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(x, 3.5, z);
  group.add(tank);

  // Tank end caps
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8, 0, Math.PI), tankMat);
    cap.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    cap.position.set(x + side * 5, 3.5, z);
    group.add(cap);
  }

  // Tank support legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5 });
  for (const ox of [-3, 3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.4), legMat);
    leg.position.set(x + ox, 1.5, z - 2);
    group.add(leg);
    const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.4), legMat);
    leg2.position.set(x + ox, 1.5, z + 2);
    group.add(leg2);
  }

  // "FUEL" label stripe
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 5.1), stripeMat);
  stripe.position.set(x, 3.5, z);
  group.add(stripe);

  // Small pump shelter
  const shelterMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5 });
  const shelter = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), shelterMat);
  shelter.position.set(x + 8, 1.5, z);
  group.add(shelter);

  scene.add(group);
}

function createGroundVehicles(scene, x, z) {
  const group = new THREE.Group();

  // Fuel truck
  createTruck(group, x, z, 0xdddd44, 2.5);

  // Baggage tug + carts
  createTruck(group, x + 8, z + 5, 0x4488cc, 1.5);

  // Pushback tug
  createTruck(group, x - 5, z + 8, 0x44cc44, 1.8);

  // Baggage carts
  for (let i = 0; i < 3; i++) {
    const cart = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.8, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x666666 })
    );
    cart.position.set(x + 11 + i * 2.5, 0.5, z + 5);
    group.add(cart);
  }

  scene.add(group);
}

function createTruck(group, x, z, color, height) {
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

  // Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, height, 2.5), bodyMat);
  cab.position.set(x - 1.5, height / 2, z);
  group.add(cab);

  // Cargo body
  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(4, height * 0.8, 2.8),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 })
  );
  cargo.position.set(x + 1.5, height * 0.4, z);
  group.add(cargo);

  // Wheels
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const ox of [-2, 0.5, 2.5]) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x + ox, 0.3, z + side * 1.3);
      group.add(wheel);
    }
  }
}

function createParkingGarage(scene, x, z) {
  const group = new THREE.Group();

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.8 });

  // Multi-level structure
  for (let level = 0; level < 3; level++) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 25), concreteMat);
    floor.position.set(x, level * 4 + 0.25, z);
    floor.receiveShadow = true;
    group.add(floor);

    // Support columns
    for (let cx = -15; cx <= 15; cx += 10) {
      for (let cz = -10; cz <= 10; cz += 10) {
        const col = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 4, 0.6),
          concreteMat
        );
        col.position.set(x + cx, level * 4 + 2.25, z + cz);
        group.add(col);
      }
    }
  }

  // Top level roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(42, 0.5, 27), concreteMat);
  roof.position.set(x, 12.25, z);
  group.add(roof);

  // Ramp on the side
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.7 });
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 15), rampMat);
  ramp.position.set(x + 23, 2, z);
  ramp.rotation.z = -0.15;
  group.add(ramp);

  scene.add(group);
}

function createPAPI(scene, x, z) {
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.5,
  });
  const redPapiMat = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0xff2200,
    emissiveIntensity: 0.5,
  });

  for (let i = 0; i < 4; i++) {
    const mat = i < 2 ? redPapiMat : whiteMat;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), mat);
    box.position.set(x + i * 3, 0.3, z);
    scene.add(box);
  }
}

function createTaxiSign(scene, x, z, text, style) {
  const group = new THREE.Group();

  // Sign backgrounds
  let bgColor, textColor;
  if (style === 'yellow') {
    bgColor = 0x222222;
    textColor = '#dddd00';
  } else if (style === 'blue') {
    bgColor = 0x1144aa;
    textColor = '#ffffff';
  } else {
    // green (directional)
    bgColor = 0x006622;
    textColor = '#ffffff';
  }

  // Sign board
  const signMat = new THREE.MeshStandardMaterial({
    color: bgColor, roughness: 0.5,
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 0.3), signMat);
  sign.position.set(x, 1.8, z);
  group.add(sign);

  // Post
  const postMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.4 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2, 6), postMat);
  post.position.set(x, 1, z);
  group.add(post);

  // Text via canvas texture
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = style === 'yellow' ? '#222222' : (style === 'blue' ? '#1144aa' : '#006622');
  ctx.fillRect(0, 0, 128, 64);

  // Border
  ctx.strokeStyle = style === 'yellow' ? '#dddd00' : '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 124, 60);

  // Text
  ctx.fillStyle = textColor;
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const labelMat = new THREE.MeshBasicMaterial({ map: texture });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.3), labelMat);
  label.position.set(x, 1.8, z - 0.17);
  group.add(label);

  // Back face
  const labelBack = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.3), labelMat);
  labelBack.position.set(x, 1.8, z + 0.17);
  labelBack.rotation.y = Math.PI;
  group.add(labelBack);

  scene.add(group);
}

function createSecondAirport(scene) {
  return buildAirport(scene, {
    originX: AIRPORT2_X,
    originZ: AIRPORT2_Z,
    includeApron: true,
    includeTerminal: true,
    includeExtras: false,
  });
}

function createWindsock(scene, x, z) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 })
  );
  pole.position.set(x, 4, z);
  scene.add(pole);

  const sockGeo = new THREE.ConeGeometry(0.8, 3, 8, 1, true);
  const sockMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    side: THREE.DoubleSide,
  });
  const sock = new THREE.Mesh(sockGeo, sockMat);
  sock.rotation.z = -Math.PI / 2;
  sock.position.set(x + 1.5, 7.8, z);
  scene.add(sock);
}

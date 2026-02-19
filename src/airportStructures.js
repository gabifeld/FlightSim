import * as THREE from 'three';
import { RUNWAY_LENGTH, RUNWAY_WIDTH } from './constants.js';

const halfWid = RUNWAY_WIDTH / 2;

// Shared materials (created once)
let _concreteMat, _metalMat, _glassMat, _darkMetalMat, _whiteMat, _asphaltMat;

function ensureMaterials() {
  if (_concreteMat) return;
  _concreteMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb, roughness: 0.8 });
  _metalMat = new THREE.MeshLambertMaterial({ color: 0x889098, roughness: 0.4, metalness: 0.4 });
  _glassMat = new THREE.MeshLambertMaterial({
    color: 0x88bbdd, roughness: 0.1, metalness: 0.6,
    transparent: true, opacity: 0.7,
  });
  _darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x445566, roughness: 0.5, metalness: 0.3 });
  _whiteMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0, roughness: 0.5 });
  _asphaltMat = new THREE.MeshLambertMaterial({ color: 0x333333, roughness: 0.9 });
}

function addBox(group, geo, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.receiveShadow) mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// ═══════════════════════════════════════════════════════════════
// 1. Parked Aircraft at Gates
// ═══════════════════════════════════════════════════════════════

function createParkedAircraft(scene, ox, oz, count) {
  const gateZPositions = [-60, -20, 20]; // G1, G2, G3 (G4 at +60 left empty)
  const gateX = ox + halfWid + 295;

  const fuselageMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.1 });
  const wingMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, roughness: 0.35, metalness: 0.2 });
  const engineMat = new THREE.MeshLambertMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.5 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0x2255aa, roughness: 0.4 });
  const noseMat = new THREE.MeshLambertMaterial({ color: 0x333333, roughness: 0.5 });

  const fuselageGeo = new THREE.CylinderGeometry(1.8, 1.8, 35, 10);
  fuselageGeo.rotateZ(Math.PI / 2);
  const wingGeo = new THREE.BoxGeometry(28, 0.3, 4);
  const engineGeo = new THREE.CylinderGeometry(0.9, 1.1, 4, 8);
  engineGeo.rotateZ(Math.PI / 2);
  const tailVertGeo = new THREE.BoxGeometry(0.3, 6, 3);
  const tailHorizGeo = new THREE.BoxGeometry(8, 0.2, 2);
  const noseGeo = new THREE.SphereGeometry(1.8, 8, 6, 0, Math.PI);

  const n = Math.min(count, gateZPositions.length);
  for (let i = 0; i < n; i++) {
    const group = new THREE.Group();
    const gz = oz + gateZPositions[i];
    const gx = gateX;

    // Fuselage - aircraft faces -X (nose toward terminal)
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    fuselage.position.set(gx, 2.5, gz);
    group.add(fuselage);

    // Nose cone
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.y = Math.PI / 2;
    nose.position.set(gx - 17.5, 2.5, gz);
    group.add(nose);

    // Wings
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(gx + 2, 2.2, gz);
    group.add(wing);

    // Engines (under wings)
    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(engineGeo, engineMat);
      engine.position.set(gx + 0.5, 1.2, gz + side * 7);
      group.add(engine);
    }

    // Vertical tail
    const tailV = new THREE.Mesh(tailVertGeo, tailMat);
    tailV.position.set(gx + 16, 6, gz);
    group.add(tailV);

    // Horizontal stabilizer
    const tailH = new THREE.Mesh(tailHorizGeo, wingMat);
    tailH.position.set(gx + 15.5, 5, gz);
    group.add(tailH);

    scene.add(group);
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. Terminal Concourse Extension
// ═══════════════════════════════════════════════════════════════

function createConcourseExtension(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const cx = ox + 220;
  const cz = oz - 75;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xd4cfc4, roughness: 0.7 });

  // Main corridor running east-west
  const corridor = new THREE.Mesh(new THREE.BoxGeometry(55, 12, 10), wallMat);
  corridor.position.set(cx, 6, cz);
  corridor.receiveShadow = true;
  group.add(corridor);

  // Glass facade on corridor (south side)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(53, 8), _glassMat);
  glass.position.set(cx, 6, cz - 5.1);
  group.add(glass);

  // Roof overhang
  const roof = new THREE.Mesh(new THREE.BoxGeometry(58, 0.5, 13), _darkMetalMat);
  roof.position.set(cx, 12.3, cz);
  group.add(roof);

  // 2 jet bridges off the concourse
  const bridgeMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, roughness: 0.5 });
  for (let i = 0; i < 2; i++) {
    const bz = cz - 14;
    const bx = cx - 12 + i * 24;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4, 3.5, 14), bridgeMat);
    bridge.position.set(bx, 5, bz);
    group.add(bridge);

    // Bridge glass
    const bGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2), _glassMat);
    bGlass.position.set(bx - 2.05, 5.5, bz);
    bGlass.rotation.y = Math.PI / 2;
    group.add(bGlass);
  }

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 3. Cargo/Freight Area
// ═══════════════════════════════════════════════════════════════

function createCargoArea(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const cx = ox + 340;
  const cz = oz + 160;

  const corrugatedMat = new THREE.MeshLambertMaterial({ color: 0x889098, roughness: 0.5, metalness: 0.3 });
  const dockDoorMat = new THREE.MeshLambertMaterial({ color: 0x556677, roughness: 0.6 });

  // Main warehouse
  const warehouse = new THREE.Mesh(new THREE.BoxGeometry(60, 10, 25), corrugatedMat);
  warehouse.position.set(cx, 5, cz);
  warehouse.receiveShadow = true;
  group.add(warehouse);

  // Curved roof
  const warehouseRoof = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13, 60, 12, 1, false, 0, Math.PI),
    _darkMetalMat
  );
  warehouseRoof.rotation.z = Math.PI / 2;
  warehouseRoof.rotation.y = Math.PI / 2;
  warehouseRoof.position.set(cx, 10, cz);
  group.add(warehouseRoof);

  // Loading dock overhang
  const overhang = new THREE.Mesh(new THREE.BoxGeometry(40, 0.4, 6), corrugatedMat);
  overhang.position.set(cx, 8, cz - 15.5);
  group.add(overhang);

  // 3 dock doors
  for (let i = -1; i <= 1; i++) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(8, 7), dockDoorMat);
    door.position.set(cx + i * 12, 3.5, cz - 12.6);
    group.add(door);
  }

  // Secondary warehouse
  const warehouse2 = new THREE.Mesh(new THREE.BoxGeometry(35, 8, 18), corrugatedMat);
  warehouse2.position.set(cx + 15, 4, cz + 28);
  warehouse2.receiveShadow = true;
  group.add(warehouse2);

  // Concrete loading pad
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(65, 15),
    new THREE.MeshLambertMaterial({ color: 0x999999, roughness: 0.85 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(cx, 0.06, cz - 20);
  pad.receiveShadow = true;
  group.add(pad);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 4. Fire/Rescue Station
// ═══════════════════════════════════════════════════════════════

function createFireStation(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const fx = ox - 50;
  const fz = oz - 700;

  const brickMat = new THREE.MeshLambertMaterial({ color: 0xBB3333, roughness: 0.7 });
  const garageDoorMat = new THREE.MeshLambertMaterial({ color: 0x992222, roughness: 0.5 });

  // Main building
  const building = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 16), brickMat);
  building.position.set(fx, 3.5, fz);
  building.receiveShadow = true;
  group.add(building);

  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 18), _darkMetalMat);
  roof.position.set(fx, 7.25, fz);
  group.add(roof);

  // 3 garage doors (facing runway, +X side)
  for (let i = -1; i <= 1; i++) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 5.5), garageDoorMat);
    door.position.set(fx + 11.1, 2.75, fz + i * 5);
    door.rotation.y = -Math.PI / 2;
    group.add(door);
  }

  // Hose/drill tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), brickMat);
  tower.position.set(fx - 8, 6, fz + 5);
  group.add(tower);

  // Tower platform
  const platform = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 5), _darkMetalMat);
  platform.position.set(fx - 8, 12, fz + 5);
  group.add(platform);

  // Concrete parking pad
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 12),
    new THREE.MeshLambertMaterial({ color: 0x999999, roughness: 0.85 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(fx + 22, 0.06, fz);
  pad.receiveShadow = true;
  group.add(pad);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 5. Airport Perimeter Fence
// ═══════════════════════════════════════════════════════════════

function createPerimeterFence(scene, ox, oz) {
  const halfLen = RUNWAY_LENGTH / 2;
  const spacing = 8;

  // Fence rectangle bounds
  const fenceMinX = ox - 80;
  const fenceMaxX = ox + 420;
  const fenceMinZ = oz - halfLen - 150;
  const fenceMaxZ = oz + halfLen + 150;

  // Collect post positions along rectangle perimeter
  const postPositions = [];

  // South side (minZ)
  for (let x = fenceMinX; x <= fenceMaxX; x += spacing) {
    postPositions.push({ x, y: 1.2, z: fenceMinZ });
  }
  // North side (maxZ)
  for (let x = fenceMinX; x <= fenceMaxX; x += spacing) {
    postPositions.push({ x, y: 1.2, z: fenceMaxZ });
  }
  // West side (minX)
  for (let z = fenceMinZ + spacing; z < fenceMaxZ; z += spacing) {
    postPositions.push({ x: fenceMinX, y: 1.2, z });
  }
  // East side (maxX)
  for (let z = fenceMinZ + spacing; z < fenceMaxZ; z += spacing) {
    postPositions.push({ x: fenceMaxX, y: 1.2, z });
  }

  // Posts via InstancedMesh
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.4 });
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < postPositions.length; i++) {
    const p = postPositions[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
  }
  postMesh.instanceMatrix.needsUpdate = true;
  scene.add(postMesh);

  // Panel segments via InstancedMesh
  const panelMat = new THREE.MeshLambertMaterial({
    color: 0xaaaaaa,
    transparent: true,
    opacity: 0.3,
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });

  // Panels between adjacent posts
  const panelPositions = [];

  // South panels
  for (let x = fenceMinX; x < fenceMaxX; x += spacing) {
    panelPositions.push({ x: x + spacing / 2, y: 1.2, z: fenceMinZ, ry: 0, sx: spacing, sy: 2.2 });
  }
  // North panels
  for (let x = fenceMinX; x < fenceMaxX; x += spacing) {
    panelPositions.push({ x: x + spacing / 2, y: 1.2, z: fenceMaxZ, ry: 0, sx: spacing, sy: 2.2 });
  }
  // West panels
  for (let z = fenceMinZ; z < fenceMaxZ; z += spacing) {
    panelPositions.push({ x: fenceMinX, y: 1.2, z: z + spacing / 2, ry: Math.PI / 2, sx: spacing, sy: 2.2 });
  }
  // East panels
  for (let z = fenceMinZ; z < fenceMaxZ; z += spacing) {
    panelPositions.push({ x: fenceMaxX, y: 1.2, z: z + spacing / 2, ry: Math.PI / 2, sx: spacing, sy: 2.2 });
  }

  const basePanelGeo = new THREE.PlaneGeometry(1, 1);
  const panelMesh = new THREE.InstancedMesh(basePanelGeo, panelMat, panelPositions.length);

  for (let i = 0; i < panelPositions.length; i++) {
    const p = panelPositions[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry, 0);
    dummy.scale.set(p.sx, p.sy, 1);
    dummy.updateMatrix();
    panelMesh.setMatrixAt(i, dummy.matrix);
  }
  panelMesh.instanceMatrix.needsUpdate = true;
  scene.add(panelMesh);
}

// ═══════════════════════════════════════════════════════════════
// 6. Blast Fences
// ═══════════════════════════════════════════════════════════════

function createBlastFences(scene, ox, oz) {
  const halfLen = RUNWAY_LENGTH / 2;
  const blastMat = new THREE.MeshLambertMaterial({
    color: 0x667788, roughness: 0.5, metalness: 0.4,
    side: THREE.DoubleSide,
  });

  for (const endSign of [-1, 1]) {
    const group = new THREE.Group();
    const bz = oz + endSign * (halfLen - 50);
    const bx = ox + 30;

    // Main screen - angled slightly
    const screen = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 0.15), blastMat);
    screen.position.set(bx, 2.5, bz);
    screen.rotation.y = 0.15 * endSign;
    group.add(screen);

    // Support posts
    for (const side of [-5, 0, 5]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 5.5, 6),
        new THREE.MeshLambertMaterial({ color: 0x666666, metalness: 0.5 })
      );
      post.position.set(bx + side, 2.75, bz - 0.3 * endSign);
      group.add(post);
    }

    scene.add(group);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. Fuel Farm
// ═══════════════════════════════════════════════════════════════

function createFuelFarm(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const fx = ox + 380;
  const fz = oz + 120;

  const tankMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, roughness: 0.3, metalness: 0.4 });
  const bermMat = new THREE.MeshLambertMaterial({ color: 0x999988, roughness: 0.9 });

  // 4 upright cylindrical tanks in 2x2 grid
  const tankGeo = new THREE.CylinderGeometry(5, 5, 10, 12);
  const tankPositions = [
    { x: fx - 7, z: fz - 7 },
    { x: fx + 7, z: fz - 7 },
    { x: fx - 7, z: fz + 7 },
    { x: fx + 7, z: fz + 7 },
  ];

  const tankInstanced = new THREE.InstancedMesh(tankGeo, tankMat, 4);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 4; i++) {
    dummy.position.set(tankPositions[i].x, 5, tankPositions[i].z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    tankInstanced.setMatrixAt(i, dummy.matrix);
  }
  tankInstanced.instanceMatrix.needsUpdate = true;
  group.add(tankInstanced);

  // Tank caps
  const capGeo = new THREE.SphereGeometry(5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const pos of tankPositions) {
    const cap = new THREE.Mesh(capGeo, tankMat);
    cap.position.set(pos.x, 10, pos.z);
    group.add(cap);
  }

  // Containment berm (4 walls)
  const bermW = 38;
  const bermD = 38;
  const bermH = 1.5;
  for (const [bx, bz, bw, bd] of [
    [fx, fz - bermD / 2, bermW, 0.5],
    [fx, fz + bermD / 2, bermW, 0.5],
    [fx - bermW / 2, fz, 0.5, bermD],
    [fx + bermW / 2, fz, 0.5, bermD],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(bw, bermH, bd), bermMat);
    wall.position.set(bx, bermH / 2, bz);
    group.add(wall);
  }

  // Small pump house
  const pumpHouse = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), _concreteMat);
  pumpHouse.position.set(fx + bermW / 2 + 3, 1.5, fz);
  group.add(pumpHouse);

  // Piping between tanks (horizontal pipes)
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0x666666, metalness: 0.5 });
  const pipeGeo = new THREE.CylinderGeometry(0.2, 0.2, 14, 6);
  pipeGeo.rotateZ(Math.PI / 2);
  const pipe1 = new THREE.Mesh(pipeGeo, pipeMat);
  pipe1.position.set(fx, 2, fz - 7);
  group.add(pipe1);
  const pipe2 = new THREE.Mesh(pipeGeo, pipeMat);
  pipe2.position.set(fx, 2, fz + 7);
  group.add(pipe2);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 8. Water Tower
// ═══════════════════════════════════════════════════════════════

function createWaterTower(scene, ox, oz) {
  const group = new THREE.Group();
  const wx = ox + 400;
  const wz = oz - 100;

  const steelMat = new THREE.MeshLambertMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.6 });
  const tankColor = new THREE.MeshLambertMaterial({ color: 0xccccdd, roughness: 0.35, metalness: 0.3 });

  // Spherical tank
  const tank = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 10), tankColor);
  tank.position.set(wx, 22, wz);
  group.add(tank);

  // 4 legs
  const legGeo = new THREE.CylinderGeometry(0.25, 0.35, 22, 6);
  const legOffsets = [
    { x: -3, z: -3 },
    { x: 3, z: -3 },
    { x: -3, z: 3 },
    { x: 3, z: 3 },
  ];
  for (const lo of legOffsets) {
    const leg = new THREE.Mesh(legGeo, steelMat);
    leg.position.set(wx + lo.x, 11, wz + lo.z);
    group.add(leg);
  }

  // Cross-bracing between legs (X-braces on each face)
  const braceMat = new THREE.MeshLambertMaterial({ color: 0x777777, metalness: 0.5 });
  const braceGeo = new THREE.CylinderGeometry(0.06, 0.06, 10, 4);
  const bracePairs = [
    [legOffsets[0], legOffsets[1]],
    [legOffsets[2], legOffsets[3]],
    [legOffsets[0], legOffsets[2]],
    [legOffsets[1], legOffsets[3]],
  ];
  for (const [a, b] of bracePairs) {
    const brace = new THREE.Mesh(braceGeo, braceMat);
    brace.position.set(wx + (a.x + b.x) / 2, 10, wz + (a.z + b.z) / 2);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    brace.rotation.z = Math.PI / 6;
    brace.rotation.y = Math.atan2(dx, dz);
    group.add(brace);
  }

  // Red obstruction light on top
  const lightMat = new THREE.MeshLambertMaterial({
    color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.5,
  });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), lightMat);
  light.position.set(wx, 27, wz);
  group.add(light);

  // Short antenna on top
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 3, 4),
    steelMat
  );
  antenna.position.set(wx, 28, wz);
  group.add(antenna);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 9. Radar Dome / NAVAID
// ═══════════════════════════════════════════════════════════════

function createRadarDome(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const rx = ox - 60;
  const rz = oz + 400;

  // White hemisphere dome
  const domeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, roughness: 0.4 });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMat
  );
  dome.position.set(rx, 2, rz);
  group.add(dome);

  // Concrete base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 2, 10), _concreteMat);
  base.position.set(rx, 1, rz);
  group.add(base);

  // Equipment shelter
  const shelter = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), _concreteMat);
  shelter.position.set(rx + 7, 1.5, rz);
  group.add(shelter);

  // Antenna mast
  const mastMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, metalness: 0.5 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6, 4), mastMat);
  mast.position.set(rx, 8, rz);
  group.add(mast);

  // Small dish on mast
  const dishMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, metalness: 0.6 });
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 6, 4, 0, Math.PI),
    dishMat
  );
  dish.position.set(rx, 9.5, rz);
  dish.rotation.x = Math.PI / 4;
  group.add(dish);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 10. De-Icing Pad
// ═══════════════════════════════════════════════════════════════

function createDeIcingPad(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const dx = ox + 140;
  const dz = oz + 700;

  // Concrete pad
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 20),
    new THREE.MeshLambertMaterial({ color: 0xaaaaaa, roughness: 0.85 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(dx, 0.06, dz);
  pad.receiveShadow = true;
  group.add(pad);

  // Yellow boundary markings
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xccaa00 });
  const markings = [
    { x: dx - 12.5, z: dz, w: 0.3, h: 20 },
    { x: dx + 12.5, z: dz, w: 0.3, h: 20 },
    { x: dx, z: dz - 10, w: 25, h: 0.3 },
    { x: dx, z: dz + 10, w: 25, h: 0.3 },
  ];
  for (const m of markings) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(m.w, m.h), yellowMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(m.x, 0.08, m.z);
    group.add(line);
  }

  // Chemical tank on cradle (horizontal cylinder)
  const chemTankMat = new THREE.MeshLambertMaterial({ color: 0x448844, roughness: 0.5 });
  const chemTank = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 8, 10),
    chemTankMat
  );
  chemTank.rotation.z = Math.PI / 2;
  chemTank.position.set(dx + 8, 2, dz + 6);
  group.add(chemTank);

  // Cradle supports
  for (const side of [-2.5, 2.5]) {
    const cradle = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 2, 3.5),
      _concreteMat
    );
    cradle.position.set(dx + 8 + side, 1, dz + 6);
    group.add(cradle);
  }

  // Small operations building
  const opsBldg = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 5), _concreteMat);
  opsBldg.position.set(dx - 8, 1.5, dz + 6);
  group.add(opsBldg);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 11. Airport Hotel
// ═══════════════════════════════════════════════════════════════

function createHotelWindowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Warm beige facade
  ctx.fillStyle = '#d8cfc0';
  ctx.fillRect(0, 0, 128, 256);

  // Floor separator lines
  const floors = 6;
  const floorH = 256 / floors;
  ctx.strokeStyle = '#b8b0a0';
  ctx.lineWidth = 1;
  for (let f = 1; f < floors; f++) {
    ctx.beginPath();
    ctx.moveTo(0, f * floorH);
    ctx.lineTo(128, f * floorH);
    ctx.stroke();
  }

  // Windows (4 cols x 6 rows)
  const cols = 4;
  const winW = 18;
  const winH = 20;
  const padX = (128 - cols * winW) / (cols + 1);
  const padY = (floorH - winH) / 2;

  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * (winW + padX);
      const y = f * floorH + padY;
      const lit = Math.random() > 0.35;
      if (lit) {
        const warm = 180 + Math.floor(Math.random() * 75);
        ctx.fillStyle = `rgba(${warm}, ${warm - 20}, ${warm - 60}, 0.85)`;
      } else {
        ctx.fillStyle = 'rgba(30, 40, 55, 0.8)';
      }
      ctx.fillRect(x, y, winW, winH);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, winW, winH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createAirportHotel(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const hx = ox + 380;
  const hz = oz - 130;

  const hotelTex = createHotelWindowTexture();
  const hotelMat = new THREE.MeshLambertMaterial({
    map: hotelTex,
    roughness: 0.7,
  });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x555555, roughness: 0.5 });

  // Main building (6-story)
  const building = new THREE.Mesh(new THREE.BoxGeometry(28, 18, 22), hotelMat);
  building.position.set(hx, 9, hz);
  building.receiveShadow = true;
  group.add(building);

  // Flat roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 24), roofMat);
  roof.position.set(hx, 18.25, hz);
  group.add(roof);

  // Glass lobby extension
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 8), _glassMat);
  lobby.position.set(hx, 2.5, hz - 15);
  group.add(lobby);

  // Porte-cochere canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.3, 8),
    new THREE.MeshLambertMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.5 })
  );
  canopy.position.set(hx, 5, hz - 20);
  group.add(canopy);

  // Canopy support columns
  const colMat = new THREE.MeshLambertMaterial({ color: 0x888888, metalness: 0.4 });
  for (const cx of [-6, 6]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 5, 6), colMat);
    col.position.set(hx + cx, 2.5, hz - 24);
    group.add(col);
  }

  // Rooftop "HOTEL" sign (emissive)
  const signMat = new THREE.MeshLambertMaterial({
    color: 0xff8800,
    emissive: 0xff6600,
    emissiveIntensity: 0.8,
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 0.3), signMat);
  sign.position.set(hx, 20, hz - 11.2);
  group.add(sign);

  // Rooftop HVAC units
  for (let i = 0; i < 3; i++) {
    const hvac = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.5, 2),
      new THREE.MeshLambertMaterial({ color: 0x777777, metalness: 0.3 })
    );
    hvac.position.set(hx - 8 + i * 8, 19.25, hz + 5);
    group.add(hvac);
  }

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 12. Maintenance Workshop Area
// ═══════════════════════════════════════════════════════════════

function createMaintenanceHangars(scene, ox, oz) {
  ensureMaterials();
  const group = new THREE.Group();
  const mx = ox + 370;

  const hangarMat = new THREE.MeshLambertMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 });
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x445566, roughness: 0.6 });
  const equipMat = new THREE.MeshLambertMaterial({ color: 0x666666, roughness: 0.5 });

  for (const side of [-1, 1]) {
    const mz = oz + side * 20;

    // Hangar body
    const body = new THREE.Mesh(new THREE.BoxGeometry(25, 8, 18), hangarMat);
    body.position.set(mx, 4, mz);
    body.receiveShadow = true;
    group.add(body);

    // Curved roof
    const roofCurve = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 9.5, 25, 10, 1, false, 0, Math.PI),
      _darkMetalMat
    );
    roofCurve.rotation.z = Math.PI / 2;
    roofCurve.rotation.y = Math.PI / 2;
    roofCurve.position.set(mx, 8, mz);
    group.add(roofCurve);

    // Open front door (just the door frame opening - darker interior)
    const doorOpening = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 7),
      doorMat
    );
    doorOpening.position.set(mx, 3.5, mz - 9.1);
    group.add(doorOpening);

    // Interior equipment visible through open fronts
    for (let i = 0; i < 3; i++) {
      const equip = new THREE.Mesh(
        new THREE.BoxGeometry(2 + Math.random() * 2, 1.5 + Math.random(), 2 + Math.random() * 2),
        equipMat
      );
      equip.position.set(mx - 6 + i * 6, 1, mz);
      group.add(equip);
    }
  }

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// 13. Extra Ground Service Equipment
// ═══════════════════════════════════════════════════════════════

function createGSETruck(group, x, z, color, height, ry = 0) {
  const bodyMat = new THREE.MeshLambertMaterial({ color, roughness: 0.6 });

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, height, 2.5), bodyMat);
  cab.position.set(x - 1.5, height / 2, z);
  cab.rotation.y = ry;
  group.add(cab);

  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(4, height * 0.8, 2.8),
    new THREE.MeshLambertMaterial({ color: 0x888888, roughness: 0.5 })
  );
  cargo.position.set(x + 1.5, height * 0.4, z);
  cargo.rotation.y = ry;
  group.add(cargo);
}

function createExtraGSE(scene, ox, oz) {
  const group = new THREE.Group();
  const apronCenterX = ox + halfWid + 130;

  // 2 catering trucks (tall box trucks)
  createGSETruck(group, apronCenterX - 20, oz - 40, 0xdddddd, 2.8);
  createGSETruck(group, apronCenterX - 15, oz + 35, 0xdddddd, 2.8);

  // 2 belt loaders (low, angled)
  const beltMat = new THREE.MeshLambertMaterial({ color: 0xcc8800, roughness: 0.6 });
  for (let i = 0; i < 2; i++) {
    const bx = apronCenterX - 25 + i * 50;
    const bz = oz - 15 + i * 30;
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 2), beltMat);
    base.position.set(bx, 0.6, bz);
    group.add(base);

    // Conveyor belt (angled)
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.2, 1.5),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    belt.position.set(bx + 3, 2, bz);
    belt.rotation.z = -0.3;
    group.add(belt);
  }

  // 1 lavatory truck (blue)
  createGSETruck(group, apronCenterX + 10, oz + 45, 0x3366aa, 2.2);

  // 3 baggage carts scattered around apron
  const cartMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  const cartGeo = new THREE.BoxGeometry(1.5, 0.8, 2.5);
  const cartPositions = [
    { x: apronCenterX - 10, z: oz - 25 },
    { x: apronCenterX + 5, z: oz + 10 },
    { x: apronCenterX + 20, z: oz - 35 },
  ];
  for (const cp of cartPositions) {
    const cart = new THREE.Mesh(cartGeo, cartMat);
    cart.position.set(cp.x, 0.5, cp.z);
    group.add(cart);
  }

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

export function createAirportStructures(scene, ox, oz, isFull) {
  ensureMaterials();

  // Structures for both airports
  createBlastFences(scene, ox, oz);
  createPerimeterFence(scene, ox, oz);
  createRadarDome(scene, ox, oz);

  if (isFull) {
    createParkedAircraft(scene, ox, oz, 3);
    createConcourseExtension(scene, ox, oz);
    createCargoArea(scene, ox, oz);
    createFireStation(scene, ox, oz);
    createFuelFarm(scene, ox, oz);
    createWaterTower(scene, ox, oz);
    createDeIcingPad(scene, ox, oz);
    createAirportHotel(scene, ox, oz);
    createMaintenanceHangars(scene, ox, oz);
    createExtraGSE(scene, ox, oz);
  } else {
    createParkedAircraft(scene, ox, oz, 1);
  }
}

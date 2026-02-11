import * as THREE from 'three';
import {
  COAST_LINE_X,
  BEACH_CENTER_Z,
  SEAPLANE_X,
  SEAPLANE_Z,
} from './constants.js';

// ═══════════════════════════════════════════════════════════════
// Beach — sandy ground plane along the coastline
// ═══════════════════════════════════════════════════════════════

function createSandTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Sandy base
  ctx.fillStyle = '#d4c098';
  ctx.fillRect(0, 0, 512, 512);

  // Grain variation
  for (let i = 0; i < 20000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const tone = 180 + Math.random() * 50;
    ctx.fillStyle = `rgba(${tone + 10}, ${tone - 5}, ${tone - 40}, ${0.1 + Math.random() * 0.15})`;
    ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
  }

  // Darker wet patches near water
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 15 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(150, 130, 100, 0.15)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  return tex;
}

function createBeach(scene) {
  const beachX = COAST_LINE_X - 400;
  const beachZ = BEACH_CENTER_Z;
  const beachW = 1200;
  const beachL = 8000;

  // Sand ground plane
  const sandTex = createSandTexture();
  const sandMat = new THREE.MeshStandardMaterial({
    map: sandTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const sandGeo = new THREE.PlaneGeometry(beachW, beachL);
  sandGeo.rotateX(-Math.PI / 2);
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.position.set(beachX, 0.08, beachZ);
  sand.receiveShadow = true;
  scene.add(sand);

  // Scattered driftwood logs
  const driftwoodMat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.9 });
  const driftwoodGeo = new THREE.CylinderGeometry(0.15, 0.2, 4, 6);
  driftwoodGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 35; i++) {
    const dw = new THREE.Mesh(driftwoodGeo, driftwoodMat);
    dw.position.set(
      beachX - 400 + Math.random() * beachW,
      0.15,
      beachZ - beachL / 2 + Math.random() * beachL
    );
    dw.rotation.y = Math.random() * Math.PI;
    scene.add(dw);
  }

  // Beach rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x888880, roughness: 0.9 });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 50; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const s = 0.3 + Math.random() * 1.5;
    rock.scale.set(s, s * 0.6, s);
    rock.position.set(
      beachX - 400 + Math.random() * beachW,
      s * 0.2,
      beachZ - beachL / 2 + Math.random() * beachL
    );
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  }

  // Palm-like beach trees (simple cone + cylinder scattered along upper beach)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8b1e, roughness: 0.7 });
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 6, 6);
  const leafGeo = new THREE.ConeGeometry(2.5, 3, 6);
  for (let i = 0; i < 40; i++) {
    const tx = beachX - beachW / 2 + Math.random() * beachW * 0.6;
    const tz = beachZ - beachL / 2 + Math.random() * beachL;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(tx, 3, tz);
    trunk.rotation.z = (Math.random() - 0.5) * 0.3;
    scene.add(trunk);

    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(tx, 7, tz);
    scene.add(leaf);
  }
}

// ═══════════════════════════════════════════════════════════════
// Pier / Dock
// ═══════════════════════════════════════════════════════════════

function createPier(scene) {
  const group = new THREE.Group();
  const pierX = COAST_LINE_X + 50;
  const pierZ = BEACH_CENTER_Z;
  const pierLen = 120;
  const pierWid = 6;

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.85 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c4a1e, roughness: 0.9 });

  // Main deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(pierLen, 0.4, pierWid), woodMat);
  deck.position.set(pierX + pierLen / 2, 1.5, pierZ);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Support pilings
  const pilingGeo = new THREE.CylinderGeometry(0.2, 0.25, 5, 6);
  for (let x = 0; x < pierLen; x += 10) {
    for (const side of [-1, 1]) {
      const piling = new THREE.Mesh(pilingGeo, darkWoodMat);
      piling.position.set(pierX + x + 5, -0.5, pierZ + side * (pierWid / 2 - 0.3));
      group.add(piling);
    }
  }

  // Railing posts
  const railGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 4);
  for (let x = 0; x < pierLen; x += 4) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(railGeo, darkWoodMat);
      post.position.set(pierX + x + 2, 2.3, pierZ + side * (pierWid / 2 - 0.2));
      group.add(post);
    }
  }

  // Top rails
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(pierLen, 0.08, 0.08),
      darkWoodMat
    );
    rail.position.set(pierX + pierLen / 2, 2.9, pierZ + side * (pierWid / 2 - 0.2));
    group.add(rail);
  }

  // Mooring cleats
  const cleatMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.6 });
  for (let x = 20; x < pierLen; x += 30) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.8), cleatMat);
    cleat.position.set(pierX + x, 1.85, pierZ + pierWid / 2 - 0.5);
    group.add(cleat);
  }

  // Small dock building at shore end
  const shedMat = new THREE.MeshStandardMaterial({ color: 0xb8a880, roughness: 0.7 });
  const shed = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), shedMat);
  shed.position.set(pierX - 2, 2, pierZ);
  shed.castShadow = true;
  group.add(shed);

  const shedRoof = new THREE.Mesh(
    new THREE.ConeGeometry(4.5, 2, 4),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7 })
  );
  shedRoof.rotation.y = Math.PI / 4;
  shedRoof.position.set(pierX - 2, 5, pierZ);
  shedRoof.castShadow = true;
  group.add(shedRoof);

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// Seaplane — static float plane resting on water
// ═══════════════════════════════════════════════════════════════

function createSeaplane(scene) {
  const group = new THREE.Group();
  // Offset from player spawn point so they don't overlap
  const sx = SEAPLANE_X + 200;
  const sz = SEAPLANE_Z + 600;
  const waterY = -1.5; // slightly above water surface for visual clarity

  const fuselageMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.4 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.5 });
  const floatMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.5 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 });
  const propMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x88bbdd, roughness: 0.1, metalness: 0.5,
    transparent: true, opacity: 0.6,
  });

  // Fuselage — small bush plane proportions
  const fuselageGeo = new THREE.CylinderGeometry(0.7, 0.6, 8, 8);
  fuselageGeo.rotateZ(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
  fuselage.position.set(sx, waterY + 2.2, sz);
  group.add(fuselage);

  // Nose cone
  const noseGeo = new THREE.SphereGeometry(0.7, 8, 6, 0, Math.PI);
  const nose = new THREE.Mesh(noseGeo, fuselageMat);
  nose.rotation.y = Math.PI / 2;
  nose.position.set(sx - 4, waterY + 2.2, sz);
  group.add(nose);

  // Tail cone
  const tailGeo = new THREE.ConeGeometry(0.6, 3, 8);
  tailGeo.rotateZ(-Math.PI / 2);
  const tail = new THREE.Mesh(tailGeo, fuselageMat);
  tail.position.set(sx + 5.5, waterY + 2.2, sz);
  group.add(tail);

  // Accent stripe along fuselage
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 1.5), accentMat);
  stripe.position.set(sx, waterY + 2.2, sz);
  group.add(stripe);

  // Cockpit windows
  const windowGeo = new THREE.PlaneGeometry(2, 0.6);
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(windowGeo, windowMat);
    win.position.set(sx - 2.5, waterY + 2.7, sz + side * 0.71);
    win.rotation.y = side * Math.PI / 2;
    group.add(win);
  }

  // High-mounted wing (bush plane style — above fuselage)
  const wingGeo = new THREE.BoxGeometry(14, 0.15, 2);
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.position.set(sx - 0.5, waterY + 3.5, sz);
  group.add(wing);

  // Wing struts (connecting wing to fuselage)
  const strutGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 4);
  for (const side of [-1, 1]) {
    for (const xOff of [-2, 2]) {
      const strut = new THREE.Mesh(strutGeo, strutMat);
      strut.position.set(sx + xOff, waterY + 2.8, sz + side * 2.5);
      strut.rotation.z = side * 0.15;
      group.add(strut);
    }
  }

  // Horizontal stabilizer
  const hStabGeo = new THREE.BoxGeometry(5, 0.1, 1.2);
  const hStab = new THREE.Mesh(hStabGeo, wingMat);
  hStab.position.set(sx + 6.5, waterY + 2.5, sz);
  group.add(hStab);

  // Vertical tail
  const vTailGeo = new THREE.BoxGeometry(0.1, 2, 1.5);
  const vTail = new THREE.Mesh(vTailGeo, accentMat);
  vTail.position.set(sx + 6.5, waterY + 3.5, sz);
  group.add(vTail);

  // Engine cowling (front of fuselage)
  const cowlGeo = new THREE.CylinderGeometry(0.5, 0.7, 1.2, 8);
  cowlGeo.rotateZ(Math.PI / 2);
  const cowl = new THREE.Mesh(cowlGeo, engineMat);
  cowl.position.set(sx - 4.8, waterY + 2.2, sz);
  group.add(cowl);

  // Propeller
  const propGeo = new THREE.BoxGeometry(0.1, 3, 0.2);
  const prop = new THREE.Mesh(propGeo, propMat);
  prop.position.set(sx - 5.5, waterY + 2.2, sz);
  prop.rotation.x = 0.3; // slight angle to show it's stopped
  group.add(prop);

  // Spinner
  const spinnerGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
  spinnerGeo.rotateZ(Math.PI / 2);
  const spinner = new THREE.Mesh(spinnerGeo, engineMat);
  spinner.position.set(sx - 5.7, waterY + 2.2, sz);
  group.add(spinner);

  // ── Floats (pontoons) ──
  const floatLen = 7;
  const floatRadius = 0.4;
  const floatGeo = new THREE.CylinderGeometry(floatRadius, floatRadius * 0.8, floatLen, 8);
  floatGeo.rotateZ(Math.PI / 2);

  for (const side of [-1, 1]) {
    // Main float body
    const floatBody = new THREE.Mesh(floatGeo, floatMat);
    floatBody.position.set(sx - 0.5, waterY + 0.4, sz + side * 2);
    group.add(floatBody);

    // Float bow (front taper)
    const bowGeo = new THREE.ConeGeometry(floatRadius, 1.5, 8);
    bowGeo.rotateZ(Math.PI / 2);
    const bow = new THREE.Mesh(bowGeo, floatMat);
    bow.position.set(sx - 4.5, waterY + 0.4, sz + side * 2);
    group.add(bow);

    // Float stern (rear taper)
    const sternGeo = new THREE.ConeGeometry(floatRadius * 0.8, 1, 8);
    sternGeo.rotateZ(-Math.PI / 2);
    const stern = new THREE.Mesh(sternGeo, floatMat);
    stern.position.set(sx + 3.5, waterY + 0.4, sz + side * 2);
    group.add(stern);

    // Float struts connecting to fuselage
    for (const xOff of [-2, 1.5]) {
      const fStrut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.6, 4),
        strutMat
      );
      fStrut.position.set(sx + xOff, waterY + 1.3, sz + side * 2);
      group.add(fStrut);
    }

    // Cross-brace between struts
    const braceGeo = new THREE.CylinderGeometry(0.03, 0.03, 3.8, 4);
    braceGeo.rotateZ(Math.PI / 2);
    const brace = new THREE.Mesh(braceGeo, strutMat);
    brace.position.set(sx - 0.25, waterY + 1.0, sz + side * 2);
    group.add(brace);
  }

  // Cross-float brace (connecting the two floats)
  const crossBraceGeo = new THREE.CylinderGeometry(0.04, 0.04, 4, 4);
  const crossBrace = new THREE.Mesh(crossBraceGeo, strutMat);
  crossBrace.position.set(sx - 0.5, waterY + 0.7, sz);
  crossBrace.rotation.x = Math.PI / 2;
  group.add(crossBrace);

  // Slight yaw so it's not perfectly axis-aligned
  group.rotation.y = -0.2;

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// Lighthouse on a rocky point near the beach
// ═══════════════════════════════════════════════════════════════

function createLighthouse(scene) {
  const group = new THREE.Group();
  const lx = COAST_LINE_X - 50;
  const lz = BEACH_CENTER_Z + 1800;

  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.5 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });

  // Stone base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 3, 10), baseMat);
  base.position.set(lx, 1.5, lz);
  base.castShadow = true;
  group.add(base);

  // Tower body (white with red stripe)
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 18, 10), whiteMat);
  tower.position.set(lx, 12, lz);
  tower.castShadow = true;
  group.add(tower);

  // Red stripe band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.8, 2, 10), redMat);
  band.position.set(lx, 15, lz);
  group.add(band);

  // Observation gallery
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3, 1.5, 10), baseMat);
  gallery.position.set(lx, 21.5, lz);
  gallery.castShadow = true;
  group.add(gallery);

  // Lantern room (glass)
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xaaddff, roughness: 0.1, metalness: 0.4,
    transparent: true, opacity: 0.5,
  });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 3, 10), lanternMat);
  lantern.position.set(lx, 23.5, lz);
  group.add(lantern);

  // Dome cap
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    redMat
  );
  dome.position.set(lx, 25, lz);
  dome.castShadow = true;
  group.add(dome);

  // Light beacon (emissive)
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xffffcc, emissive: 0xffff88, emissiveIntensity: 2.0,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), beaconMat);
  beacon.position.set(lx, 23.5, lz);
  group.add(beacon);

  // Rocky outcrop around base
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a7a72, roughness: 0.95 });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const dist = 5 + Math.random() * 3;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const s = 1 + Math.random() * 2;
    rock.scale.set(s, s * 0.5, s);
    rock.position.set(
      lx + Math.cos(angle) * dist,
      s * 0.2,
      lz + Math.sin(angle) * dist
    );
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    group.add(rock);
  }

  scene.add(group);
}

// ═══════════════════════════════════════════════════════════════
// Buoys in the water near the coast
// ═══════════════════════════════════════════════════════════════

function createBuoys(scene) {
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.5 });
  const buoyGeo = new THREE.CylinderGeometry(0.4, 0.5, 1.5, 8);

  const positions = [
    { x: COAST_LINE_X + 200, z: BEACH_CENTER_Z - 400 },
    { x: COAST_LINE_X + 350, z: BEACH_CENTER_Z + 100 },
    { x: COAST_LINE_X + 500, z: BEACH_CENTER_Z - 800 },
    { x: COAST_LINE_X + 150, z: BEACH_CENTER_Z + 600 },
    { x: COAST_LINE_X + 400, z: BEACH_CENTER_Z + 900 },
    { x: COAST_LINE_X + 600, z: BEACH_CENTER_Z - 200 },
  ];

  for (const p of positions) {
    const buoy = new THREE.Mesh(buoyGeo, buoyMat);
    buoy.position.set(p.x, -1.0, p.z);
    scene.add(buoy);

    // Small light on top
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xffff00, emissive: 0xffaa00, emissiveIntensity: 0.8,
    });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), lightMat);
    light.position.set(p.x, -0.1, p.z);
    scene.add(light);
  }
}

// ═══════════════════════════════════════════════════════════════
// Sailboats anchored near the coast
// ═══════════════════════════════════════════════════════════════

function createSailboats(scene) {
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.4 });

  const boats = [
    { x: COAST_LINE_X + 300, z: BEACH_CENTER_Z + 200, ry: 0.5, hullColor: 0x2255aa },
    { x: COAST_LINE_X + 450, z: BEACH_CENTER_Z - 500, ry: -0.3, hullColor: 0xcc3333 },
    { x: COAST_LINE_X + 250, z: BEACH_CENTER_Z + 800, ry: 1.2, hullColor: 0x228833 },
  ];

  for (const b of boats) {
    const group = new THREE.Group();
    const hColor = new THREE.MeshStandardMaterial({ color: b.hullColor, roughness: 0.5 });

    // Hull (simple tapered shape)
    const hullGeo = new THREE.CylinderGeometry(0.6, 0.3, 6, 6);
    hullGeo.rotateZ(Math.PI / 2);
    const hull = new THREE.Mesh(hullGeo, hColor);
    hull.position.set(b.x, -1.5, b.z);
    hull.scale.set(1, 0.5, 1);
    group.add(hull);

    // Deck
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xddc090, roughness: 0.7 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 1), deckMat);
    deck.position.set(b.x, -1.2, b.z);
    group.add(deck);

    // Mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 6, 4),
      mastMat
    );
    mast.position.set(b.x - 0.5, 1.5, b.z);
    group.add(mast);

    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.6, 0.7),
      hullMat
    );
    cabin.position.set(b.x + 0.5, -0.85, b.z);
    group.add(cabin);

    group.rotation.y = b.ry;
    scene.add(group);
  }
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

export function createCoastal(scene) {
  createBeach(scene);
  createPier(scene);
  createSeaplane(scene);
  createLighthouse(scene);
  createBuoys(scene);
  createSailboats(scene);
}

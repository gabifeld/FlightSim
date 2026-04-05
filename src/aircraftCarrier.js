// Aircraft Carrier — Nimitz-class with AI fighter jets flying carrier patterns
import * as THREE from 'three';
import { registerGenericRunway } from './runway.js';

// ── Constants ────────────────────────────────────────────────────────────────
const WATER_SURFACE_Y = -2;
const CARRIER_X = 16000;
const CARRIER_Z = -4000;
const SCALE = 3; // 3x larger than Nimitz for gameplay fun
const DECK_Y = WATER_SURFACE_Y + 20 * SCALE; // flight deck height
const HULL_HEIGHT = 20 * SCALE;
const HULL_DRAFT = 10 * SCALE; // below waterline
const DECK_LENGTH = 330 * SCALE;
const DECK_WIDTH = 75 * SCALE;
const HULL_WIDTH = 40 * SCALE;
const ANGLED_DECK_DEG = 9;
const ANGLED_DECK_RAD = ANGLED_DECK_DEG * Math.PI / 180;

// AI jet pattern
const PATTERN_ALT = 400;
const PATTERN_LEG = 3000;
const PATTERN_SPEED_UPWIND = 95;
const PATTERN_SPEED_DOWNWIND = 85;
const PATTERN_SPEED_APPROACH = 75;
const DECK_PAUSE = 15; // seconds on deck before relaunch
const NUM_AI_JETS = 2;

// ── Module state ─────────────────────────────────────────────────────────────
let carrierGroup = null;
let deckLightsInstanced = null;
let deckLightsMaterial = null;
let greenLightsInstanced = null;
let greenLightsMaterial = null;
const aiJets = [];
let sceneRef = null;

// ── Carrier geometry builders ────────────────────────────────────────────────

function createHull() {
  const group = new THREE.Group();

  // Main hull body
  const hullGeo = new THREE.BoxGeometry(HULL_WIDTH, HULL_HEIGHT + HULL_DRAFT, DECK_LENGTH);
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });

  // Taper the bow: compress X vertices near +Z end (front of ship)
  const pos = hullGeo.attributes.position;
  const halfZ = DECK_LENGTH / 2;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const y = pos.getY(i);
    // Taper starts at 60% of the way to the bow
    if (z > halfZ * 0.4) {
      const t = (z - halfZ * 0.4) / (halfZ * 0.6);
      const taper = 1 - t * t * 0.6; // narrows to 40% width at bow
      pos.setX(i, pos.getX(i) * taper);
    }
    // Slight flare: widen at deck level
    if (y > 0) {
      const flare = 1 + (y / (HULL_HEIGHT + HULL_DRAFT)) * 0.15;
      pos.setX(i, pos.getX(i) * flare);
    }
  }
  pos.needsUpdate = true;
  hullGeo.computeVertexNormals();

  const hull = new THREE.Mesh(hullGeo, hullMat);
  // Position so TOP of hull aligns with bottom of flight deck
  // Hull center = DECK_Y - halfHeight, so top = DECK_Y
  hull.position.y = DECK_Y - (HULL_HEIGHT + HULL_DRAFT) / 2;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  return group;
}

function createFlightDeckTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 4096;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Dark deck surface
  ctx.fillStyle = '#444444';
  ctx.fillRect(0, 0, w, h);

  // Add asphalt noise
  for (let i = 0; i < 20000; i++) {
    const brightness = 55 + Math.random() * 25;
    ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  // White edge lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(10, h);
  ctx.moveTo(w - 10, 0); ctx.lineTo(w - 10, h);
  ctx.stroke();

  // White centerline on angled deck (offset left)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.setLineDash([60, 40]);
  ctx.beginPath();
  ctx.moveTo(w * 0.35, h * 0.3);
  ctx.lineTo(w * 0.35, h * 0.85);
  ctx.stroke();
  ctx.setLineDash([]);

  // Yellow catapult tracks at bow
  ctx.strokeStyle = '#ccaa00';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(w * 0.4, 0); ctx.lineTo(w * 0.4, h * 0.25);
  ctx.moveTo(w * 0.6, 0); ctx.lineTo(w * 0.6, h * 0.25);
  ctx.stroke();

  // Touchdown zone markings
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const yy = h * 0.55 + i * 80;
    ctx.fillRect(w * 0.25, yy, 60, 40);
    ctx.fillRect(w * 0.45, yy, 60, 40);
  }

  // Numbers "09" near landing area
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(w * 0.35, h * 0.45);
  ctx.rotate(-ANGLED_DECK_RAD);
  ctx.fillText('09', 0, 0);
  ctx.restore();

  // Threshold bars at landing area
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(w * 0.2 + i * 40, h * 0.8, 25, 120);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createFlightDeck() {
  const group = new THREE.Group();

  // Main flight deck
  const deckGeo = new THREE.BoxGeometry(DECK_WIDTH, 0.5, DECK_LENGTH);
  const deckTex = createFlightDeckTexture();
  const deckMat = new THREE.MeshLambertMaterial({ map: deckTex });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.y = DECK_Y;
  deck.receiveShadow = true;
  group.add(deck);

  // Angled deck overlay (landing area) — rotated 9 degrees
  const angledGeo = new THREE.PlaneGeometry(35, 200);
  const angledMat = new THREE.MeshLambertMaterial({
    color: 0x3d3d3d,
    transparent: true,
    opacity: 0.7,
  });
  const angled = new THREE.Mesh(angledGeo, angledMat);
  angled.rotation.x = -Math.PI / 2;
  angled.rotation.z = ANGLED_DECK_RAD;
  angled.position.set(-10, DECK_Y + 0.3, 30);
  group.add(angled);

  return group;
}

function createIsland() {
  const group = new THREE.Group();
  const islandMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0x88ccff,
    emissive: 0x112233,
    emissiveIntensity: 0.3,
  });

  // Main island block
  const mainGeo = new THREE.BoxGeometry(15, 25, 40);
  const main = new THREE.Mesh(mainGeo, islandMat);
  main.position.set(25, DECK_Y + 12.5, -20);
  main.castShadow = true;
  group.add(main);

  // Bridge windows
  const windowGeo = new THREE.BoxGeometry(16, 4, 42);
  const bridge = new THREE.Mesh(windowGeo, glassMat);
  bridge.position.set(25, DECK_Y + 27, -20);
  group.add(bridge);

  // Radar array 1
  const radar1Geo = new THREE.BoxGeometry(8, 1, 4);
  const radar1 = new THREE.Mesh(radar1Geo, darkMat);
  radar1.position.set(25, DECK_Y + 32, -25);
  radar1.rotation.y = 0.3;
  group.add(radar1);

  // Radar array 2
  const radar2 = new THREE.Mesh(radar1Geo.clone(), darkMat);
  radar2.position.set(25, DECK_Y + 35, -15);
  radar2.rotation.y = -0.2;
  group.add(radar2);

  // Mast
  const mastGeo = new THREE.CylinderGeometry(0.5, 0.3, 15, 6);
  const mast = new THREE.Mesh(mastGeo, darkMat);
  mast.position.set(25, DECK_Y + 38, -20);
  group.add(mast);

  // Funnel
  const funnelGeo = new THREE.CylinderGeometry(3, 3, 8, 8);
  const funnel = new THREE.Mesh(funnelGeo, darkMat);
  funnel.position.set(25, DECK_Y + 30, -35);
  group.add(funnel);

  // Antenna spars
  const antennaGeo = new THREE.CylinderGeometry(0.15, 0.15, 8, 4);
  const ant1 = new THREE.Mesh(antennaGeo, darkMat);
  ant1.position.set(25, DECK_Y + 46, -20);
  group.add(ant1);

  return group;
}

function createCatapults() {
  const group = new THREE.Group();
  const trackMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const deflectorMat = new THREE.MeshLambertMaterial({ color: 0x555555 });

  // 2 catapult tracks at bow
  for (let i = 0; i < 2; i++) {
    const xOff = (i - 0.5) * 12;
    const trackGeo = new THREE.BoxGeometry(1, 0.1, 80);
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.position.set(xOff, DECK_Y + 0.3, -DECK_LENGTH / 2 + 50);
    group.add(track);

    // Steam deflector panel behind catapult position
    const deflGeo = new THREE.BoxGeometry(4, 3, 0.3);
    const defl = new THREE.Mesh(deflGeo, deflectorMat);
    defl.position.set(xOff, DECK_Y + 1.5, -DECK_LENGTH / 2 + 90);
    defl.rotation.x = -0.3;
    group.add(defl);
  }

  return group;
}

function createArrestingWires() {
  const group = new THREE.Group();
  const wireMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

  // 4 wires across the angled deck landing area
  for (let i = 0; i < 4; i++) {
    const wireGeo = new THREE.CylinderGeometry(0.05, 0.05, 50, 4);
    wireGeo.rotateZ(Math.PI / 2);
    const wire = new THREE.Mesh(wireGeo, wireMat);
    // Position along angled deck, spaced 12m apart
    const zPos = 40 + i * 12;
    wire.position.set(-10, DECK_Y + 0.15, zPos);
    wire.rotation.y = ANGLED_DECK_RAD;
    group.add(wire);
  }

  return group;
}

function createParkedJetGeometry() {
  // Simplified F-16 style fighter for instanced rendering
  const group = new THREE.Group();
  // Military gray with dark accent — matches F-16 style
  const jetMat = new THREE.MeshLambertMaterial({ color: 0x8899aa });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0x556677 });
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x112244 });

  // Fuselage — tapered cylinder
  const fuseGeo = new THREE.CylinderGeometry(0.5, 0.7, 12, 8);
  fuseGeo.rotateX(Math.PI / 2);
  const fuse = new THREE.Mesh(fuseGeo, jetMat);
  group.add(fuse);

  // Wings — delta shape
  const wingGeo = new THREE.BoxGeometry(9, 0.12, 3.5);
  const wings = new THREE.Mesh(wingGeo, jetMat);
  wings.position.set(0, -0.1, 1);
  group.add(wings);

  // Vertical tail
  const tailGeo = new THREE.BoxGeometry(0.12, 2.8, 2.2);
  const tail = new THREE.Mesh(tailGeo, accentMat);
  tail.position.set(0, 1.4, 5);
  group.add(tail);

  // Horizontal stabilizers
  const hstabGeo = new THREE.BoxGeometry(4, 0.1, 1.5);
  const hstab = new THREE.Mesh(hstabGeo, jetMat);
  hstab.position.set(0, 0.3, 5);
  group.add(hstab);

  // Nose cone
  const noseGeo = new THREE.ConeGeometry(0.5, 2.5, 8);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, jetMat);
  nose.position.set(0, 0, -7.5);
  group.add(nose);

  // Canopy
  const canopyGeo = new THREE.SphereGeometry(0.45, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.4, -4);
  canopy.scale.set(1, 0.6, 1.8);
  group.add(canopy);

  return group;
}

function createParkedJets() {
  const group = new THREE.Group();

  // Merge a single jet into a BufferGeometry for instancing
  const jetTemplate = createParkedJetGeometry();
  const jetMat = new THREE.MeshLambertMaterial({ color: 0x777777 });

  // 8 parked jets along starboard deck edge
  const positions = [
    { x: 20, z: -100, rot: 0.1, folded: false },
    { x: 22, z: -70, rot: -0.05, folded: true },
    { x: 20, z: -40, rot: 0.15, folded: false },
    { x: 23, z: -10, rot: -0.1, folded: true },
    { x: 20, z: 20, rot: 0.05, folded: false },
    { x: 22, z: 50, rot: -0.15, folded: true },
    { x: 20, z: 80, rot: 0.1, folded: false },
    { x: 23, z: 110, rot: -0.05, folded: true },
  ];

  for (const p of positions) {
    const jet = createParkedJetGeometry();
    jet.position.set(p.x, DECK_Y + 1.2, p.z);
    jet.rotation.y = p.rot;

    // Fold wings on some jets (scale wings narrower)
    if (p.folded) {
      jet.children[1].scale.x = 0.4; // narrow wings
      jet.children[1].position.y = 0.8; // raise folded wings
    }

    group.add(jet);
  }

  return group;
}

function createDeckLights() {
  const group = new THREE.Group();

  // Amber deck edge lights
  const count = 60;
  const sphereGeo = new THREE.SphereGeometry(0.2, 4, 4);
  deckLightsMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
  deckLightsInstanced = new THREE.InstancedMesh(sphereGeo, deckLightsMaterial, count);
  const dummy = new THREE.Object3D();
  let idx = 0;

  // Port (left) edge
  for (let i = 0; i < 30; i++) {
    const z = -DECK_LENGTH / 2 + (i / 29) * DECK_LENGTH;
    dummy.position.set(-DECK_WIDTH / 2 + 1, DECK_Y + 0.5, z);
    dummy.updateMatrix();
    deckLightsInstanced.setMatrixAt(idx++, dummy.matrix);
  }
  // Starboard (right) edge
  for (let i = 0; i < 30; i++) {
    const z = -DECK_LENGTH / 2 + (i / 29) * DECK_LENGTH;
    dummy.position.set(DECK_WIDTH / 2 - 1, DECK_Y + 0.5, z);
    dummy.updateMatrix();
    deckLightsInstanced.setMatrixAt(idx++, dummy.matrix);
  }
  deckLightsInstanced.instanceMatrix.needsUpdate = true;
  group.add(deckLightsInstanced);

  // Green landing area lights along angled deck edges
  const greenCount = 20;
  greenLightsMaterial = new THREE.MeshBasicMaterial({ color: 0x33ff66 });
  greenLightsInstanced = new THREE.InstancedMesh(sphereGeo, greenLightsMaterial, greenCount);
  idx = 0;

  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const z = 20 + t * 120;
      const xOff = Math.sin(ANGLED_DECK_RAD) * (z - 20);
      const xBase = side === 0 ? -25 : 5;
      dummy.position.set(xBase - xOff, DECK_Y + 0.5, z);
      dummy.updateMatrix();
      greenLightsInstanced.setMatrixAt(idx++, dummy.matrix);
    }
  }
  greenLightsInstanced.instanceMatrix.needsUpdate = true;
  group.add(greenLightsInstanced);

  return group;
}

// ── AI Fighter Jets ──────────────────────────────────────────────────────────

// Pattern waypoints (relative to carrier, heading north = +Z forward)
// Upwind (north), crosswind turn right, downwind (south), base turn, final approach
function buildPatternWaypoints(offset) {
  // offset staggers the two jets
  const cx = CARRIER_X;
  const cz = CARRIER_Z;
  return [
    // Upwind (departing north from carrier)
    { x: cx, z: cz - DECK_LENGTH / 2 - 50, y: DECK_Y + 2, spd: 60, phase: 'launch' },
    { x: cx, z: cz - PATTERN_LEG, y: DECK_Y + PATTERN_ALT, spd: PATTERN_SPEED_UPWIND, phase: 'upwind' },
    // Crosswind turn right
    { x: cx + PATTERN_LEG * 0.7 + offset * 200, z: cz - PATTERN_LEG, y: DECK_Y + PATTERN_ALT, spd: PATTERN_SPEED_DOWNWIND, phase: 'crosswind' },
    // Downwind (heading south, parallel to carrier)
    { x: cx + PATTERN_LEG * 0.7 + offset * 200, z: cz + PATTERN_LEG * 0.5, y: DECK_Y + PATTERN_ALT, spd: PATTERN_SPEED_DOWNWIND, phase: 'downwind' },
    // Base turn
    { x: cx + PATTERN_LEG * 0.2, z: cz + PATTERN_LEG * 0.8, y: DECK_Y + PATTERN_ALT * 0.5, spd: PATTERN_SPEED_APPROACH, phase: 'base' },
    // Final approach (aligned with angled deck, approaching from south)
    { x: cx - 10, z: cz + DECK_LENGTH / 2 + 300, y: DECK_Y + 80, spd: PATTERN_SPEED_APPROACH, phase: 'final' },
    // Touchdown
    { x: cx - 10, z: cz + 60, y: DECK_Y + 2, spd: 65, phase: 'touchdown' },
  ];
}

function createAIJetMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x666666 });

  // Fuselage
  const bodyGeo = new THREE.CylinderGeometry(0.5, 0.7, 10, 6);
  bodyGeo.rotateX(Math.PI / 2);
  group.add(new THREE.Mesh(bodyGeo, mat));

  // Nose cone
  const noseGeo = new THREE.ConeGeometry(0.5, 2.5, 6);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, mat);
  nose.position.z = -6.25;
  group.add(nose);

  // Wings
  const wingGeo = new THREE.BoxGeometry(9, 0.12, 2.5);
  const wings = new THREE.Mesh(wingGeo, mat);
  wings.position.z = 1;
  group.add(wings);

  // Tail
  const tailGeo = new THREE.BoxGeometry(0.12, 2.2, 1.8);
  const tail = new THREE.Mesh(tailGeo, mat);
  tail.position.set(0, 1.1, 4.5);
  group.add(tail);

  // Horizontal stabilizers
  const stabGeo = new THREE.BoxGeometry(4, 0.1, 1.2);
  const stab = new THREE.Mesh(stabGeo, mat);
  stab.position.set(0, 0.2, 4.5);
  group.add(stab);

  return group;
}

function createAIJet(index) {
  const mesh = createAIJetMesh();
  const waypoints = buildPatternWaypoints(index);

  return {
    mesh,
    waypoints,
    wpIndex: 0,
    t: 0, // interpolation between waypoints
    onDeck: true,
    deckTimer: index * 8, // stagger launches
    speed: 0,
    bankAngle: 0,
  };
}

function updateAIJet(jet, dt) {
  if (jet.onDeck) {
    jet.deckTimer -= dt;
    // Sit on deck near bow catapult
    jet.mesh.position.set(
      CARRIER_X + (jet === aiJets[0] ? -6 : 6),
      DECK_Y + 1.2,
      CARRIER_Z - DECK_LENGTH / 2 + 30,
    );
    jet.mesh.rotation.set(0, 0, 0);
    jet.mesh.visible = true;

    if (jet.deckTimer <= 0) {
      jet.onDeck = false;
      jet.wpIndex = 0;
      jet.t = 0;
    }
    return;
  }

  const wp = jet.waypoints;
  const from = wp[jet.wpIndex];
  const to = wp[Math.min(jet.wpIndex + 1, wp.length - 1)];

  // Distance between waypoints
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Speed interpolation
  const currentSpeed = from.spd + (to.spd - from.spd) * jet.t;
  jet.speed = currentSpeed;

  // Advance t based on speed
  if (dist > 0.1) {
    jet.t += (currentSpeed * dt) / dist;
  } else {
    jet.t = 1;
  }

  if (jet.t >= 1) {
    jet.t = 0;
    jet.wpIndex++;

    if (jet.wpIndex >= wp.length - 1) {
      // Landed — reset to deck
      jet.onDeck = true;
      jet.deckTimer = DECK_PAUSE;
      jet.wpIndex = 0;
      jet.t = 0;
      jet.bankAngle = 0;
      return;
    }
  }

  // Interpolate position
  const t = jet.t;
  const smoothT = t * t * (3 - 2 * t); // smoothstep
  const px = from.x + dx * smoothT;
  const py = from.y + dy * smoothT;
  const pz = from.z + dz * smoothT;
  jet.mesh.position.set(px, py, pz);

  // Face direction of travel
  const lookDx = dx;
  const lookDz = dz;
  const heading = Math.atan2(lookDx, lookDz);
  jet.mesh.rotation.y = heading;

  // Pitch based on climb/descent
  const climbAngle = dist > 1 ? Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) : 0;
  jet.mesh.rotation.x = -climbAngle * 0.5;

  // Bank into turns
  const prevFrom = jet.wpIndex > 0 ? wp[jet.wpIndex - 1] : from;
  const prevHeading = Math.atan2(from.x - prevFrom.x, from.z - prevFrom.z);
  const nextHeading = heading;
  let headingDiff = nextHeading - prevHeading;
  while (headingDiff > Math.PI) headingDiff -= 2 * Math.PI;
  while (headingDiff < -Math.PI) headingDiff += 2 * Math.PI;

  const targetBank = -headingDiff * 0.8;
  const maxBank = 0.5; // ~30 degrees
  const clampedBank = Math.max(-maxBank, Math.min(maxBank, targetBank));
  jet.bankAngle += (clampedBank - jet.bankAngle) * Math.min(1, dt * 3);
  jet.mesh.rotation.z = jet.bankAngle;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initAircraftCarrier(scene) {
  sceneRef = scene;
  carrierGroup = new THREE.Group();
  carrierGroup.position.set(CARRIER_X, 0, CARRIER_Z);

  // Build carrier structure (positions are world-space, so offset by carrier center)
  const hull = createHull();
  const deck = createFlightDeck();
  const island = createIsland();
  const catapults = createCatapults();
  const wires = createArrestingWires();
  const parkedJets = createParkedJets();
  const deckLights = createDeckLights();

  // Children use local coordinates relative to the carrier center.
  // Group is positioned at (CARRIER_X, 0, CARRIER_Z) from line 570.

  carrierGroup.add(hull);
  carrierGroup.add(deck);
  carrierGroup.add(island);
  carrierGroup.add(catapults);
  carrierGroup.add(wires);
  carrierGroup.add(parkedJets);
  carrierGroup.add(deckLights);

  scene.add(carrierGroup);

  // Register carrier deck as a valid runway for landing detection
  // Heading 0 = north-south, deck at (CARRIER_X, CARRIER_Z)
  registerGenericRunway(CARRIER_X, CARRIER_Z, DECK_LENGTH / 2, DECK_WIDTH / 2, 0);

  // Create AI fighter jets (added directly to scene, not carrier group)
  for (let i = 0; i < NUM_AI_JETS; i++) {
    const jet = createAIJet(i);
    scene.add(jet.mesh);
    aiJets.push(jet);
  }
}

export function updateAircraftCarrier(dt, nightMode) {
  // Update AI jets
  for (const jet of aiJets) {
    updateAIJet(jet, dt);
  }

  // Night mode lighting adjustments
  if (deckLightsMaterial) {
    deckLightsMaterial.color.setHex(nightMode ? 0xffcc55 : 0xffaa33);
  }
  if (greenLightsMaterial) {
    greenLightsMaterial.color.setHex(nightMode ? 0x55ff88 : 0x33ff66);
  }
}

export function getCarrierPosition() {
  return { x: CARRIER_X, y: DECK_Y, z: CARRIER_Z };
}

/** Check if (x,z) is on the carrier deck. Returns deck Y if on carrier, null otherwise. */
export function getCarrierDeckHeight(x, z) {
  const dx = Math.abs(x - CARRIER_X);
  const dz = Math.abs(z - CARRIER_Z);
  if (dx < DECK_WIDTH / 2 + 5 && dz < DECK_LENGTH / 2 + 10) {
    return DECK_Y;
  }
  return null;
}

// Arresting wire toggle state
let arrestingWireArmed = true;

/** Toggle arresting wire on/off. Returns new state. */
export function toggleArrestingWire() {
  arrestingWireArmed = !arrestingWireArmed;
  return arrestingWireArmed;
}

export function isArrestingWireArmed() {
  return arrestingWireArmed;
}

/**
 * Carrier auto-land: if the aircraft is anywhere near the carrier deck height
 * and above the deck area, snap it onto the deck and decelerate to a stop.
 * This makes carrier landings easy and fun — just fly low over the deck.
 */
export function updateArrestingWire(vehicle, dt) {
  if (!arrestingWireArmed) return false;
  if (!vehicle) return false;
  // Don't catch during takeoff
  if (vehicle.throttle > 0.7) return false;

  const dx = Math.abs(vehicle.position.x - CARRIER_X);
  const dz = Math.abs(vehicle.position.z - CARRIER_Z);

  // Check if above the carrier deck area (generous bounds)
  if (dx > DECK_WIDTH / 2 + 20 || dz > DECK_LENGTH / 2 + 30) return false;

  // Check if close to deck height (within 15m above deck)
  const heightAboveDeck = vehicle.position.y - DECK_Y;
  if (heightAboveDeck < -5 || heightAboveDeck > 15) return false;

  // CATCH! Snap to deck and arrest
  vehicle.position.y = DECK_Y + 1.5; // wheel height
  vehicle.onGround = true;
  vehicle.velocity.y = 0;

  // Rapid deceleration — stop within ~2 seconds
  const decelRate = 40; // m/s²
  const speed = Math.sqrt(vehicle.velocity.x ** 2 + vehicle.velocity.z ** 2);
  if (speed > 1) {
    const factor = Math.max(0, 1 - (decelRate * dt) / speed);
    vehicle.velocity.x *= factor;
    vehicle.velocity.z *= factor;
  } else {
    vehicle.velocity.set(0, 0, 0);
  }
  return true;
}

export function resetCarrierAI() {
  for (let i = 0; i < aiJets.length; i++) {
    const jet = aiJets[i];
    jet.onDeck = true;
    jet.deckTimer = i * 8;
    jet.wpIndex = 0;
    jet.t = 0;
    jet.bankAngle = 0;
  }
}

// AI Aircraft — full lifecycle: taxi, takeoff, fly, land, taxi back
import * as THREE from 'three';
import { getTaxiwayNetwork } from './taxi.js';
import { getIntlTaxiNetwork } from './internationalAirport.js';
import { getGroundLevel } from './terrain.js';
import { getActiveVehicle } from './vehicleState.js';
import { clamp } from './utils.js';
import {
  AIRPORT2_X, AIRPORT2_Z,
  INTL_AIRPORT_X, INTL_AIRPORT_Z,
  INTL_RUNWAY_LENGTH, INTL_RUNWAY_WIDTH,
  RUNWAY_LENGTH, RUNWAY_WIDTH,
} from './constants.js';
import { getAudioContext } from './audio.js';

// ── States ──────────────────────────────────────────────────────────────────
const S = {
  PARKED: 0, TAXI_OUT: 1, HOLDING: 2, TAKEOFF_ROLL: 3,
  CLIMB: 4, CRUISE: 5, DESCENT: 6, APPROACH: 7,
  LANDING: 8, TAXI_IN: 9,
};

// ── Airport definitions ─────────────────────────────────────────────────────
const AIRPORTS = [
  {
    id: 'apt1',
    x: 0, z: 0,
    // Runway along Z axis, from z=-1000 to z=+1000
    runways: [{
      id: 'apt1_rwy',
      headingRad: 0, // along -Z (heading north)
      thresholdA: { x: 0, z: -1000 }, // north end
      thresholdB: { x: 0, z: 1000 },  // south end
      length: RUNWAY_LENGTH,
      width: RUNWAY_WIDTH,
      axis: 'z',
    }],
    gates: ['gate_1', 'gate_2', 'gate_3', 'gate_4'],
    holdNodes: { 'apt1_rwy': ['rwy_n', 'rwy_s'] },
    networkId: 'apt1',
  },
  {
    id: 'apt2',
    x: AIRPORT2_X, z: AIRPORT2_Z,
    runways: [{
      id: 'apt2_rwy',
      headingRad: 0,
      thresholdA: { x: AIRPORT2_X, z: AIRPORT2_Z - 1000 },
      thresholdB: { x: AIRPORT2_X, z: AIRPORT2_Z + 1000 },
      length: RUNWAY_LENGTH,
      width: RUNWAY_WIDTH,
      axis: 'z',
    }],
    gates: ['a2_gate_1', 'a2_gate_2', 'a2_gate_3', 'a2_gate_4'],
    holdNodes: { 'apt2_rwy': ['a2_rwy_n', 'a2_rwy_s'] },
    networkId: 'apt2',
  },
  {
    id: 'intl',
    x: INTL_AIRPORT_X, z: INTL_AIRPORT_Z,
    runways: [
      {
        id: 'intl_rwyS',
        headingRad: Math.PI / 2, // along X axis (east-west)
        thresholdA: { x: INTL_AIRPORT_X - 1500, z: INTL_AIRPORT_Z - 150 },
        thresholdB: { x: INTL_AIRPORT_X + 1500, z: INTL_AIRPORT_Z - 150 },
        length: INTL_RUNWAY_LENGTH,
        width: INTL_RUNWAY_WIDTH,
        axis: 'x',
      },
      {
        id: 'intl_rwyN',
        headingRad: Math.PI / 2,
        thresholdA: { x: INTL_AIRPORT_X - 1500, z: INTL_AIRPORT_Z + 150 },
        thresholdB: { x: INTL_AIRPORT_X + 1500, z: INTL_AIRPORT_Z + 150 },
        length: INTL_RUNWAY_LENGTH,
        width: INTL_RUNWAY_WIDTH,
        axis: 'x',
      },
    ],
    gates: [
      'intl_t1_g1', 'intl_t1_g2', 'intl_t1_g3', 'intl_t1_g4', 'intl_t1_g5', 'intl_t1_g6',
      'intl_t2_g1', 'intl_t2_g2', 'intl_t2_g3', 'intl_t2_g4',
    ],
    holdNodes: {
      'intl_rwyS': ['intl_holdS_w', 'intl_holdS_e'],
      'intl_rwyN': ['intl_holdN_w', 'intl_holdN_e'],
    },
    networkId: 'intl',
  },
];

// ── Runway occupation tracking ──────────────────────────────────────────────
const runwayOccupied = {}; // rwyId -> boolean
const pendingRunwayReleaseTimers = new Set();

function scheduleRunwayRelease(rwyId, delayMs = 5000) {
  if (!rwyId) return;
  const timer = setTimeout(() => {
    pendingRunwayReleaseTimers.delete(timer);
    runwayOccupied[rwyId] = false;
  }, delayMs);
  pendingRunwayReleaseTimers.add(timer);
}

function clearPendingRunwayReleaseTimers() {
  for (const timer of pendingRunwayReleaseTimers) {
    clearTimeout(timer);
  }
  pendingRunwayReleaseTimers.clear();
}

function disposePlaneModel(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (!obj.material) return;
    if (Array.isArray(obj.material)) {
      for (const mat of obj.material) mat.dispose();
    } else {
      obj.material.dispose();
    }
  });
}

// ── Taxi network helpers ────────────────────────────────────────────────────
const networkCache = {};

function getNetwork(airportId) {
  if (networkCache[airportId]) return networkCache[airportId];

  if (airportId === 'apt1') {
    const n = getTaxiwayNetwork();
    if (n) networkCache[airportId] = n;
    return n;
  }
  if (airportId === 'apt2') {
    // Clone airport 1 network offset to airport 2 position
    const src = getTaxiwayNetwork();
    if (!src) return null;
    const nodes = src.nodes.map(n => ({
      id: 'a2_' + n.id,
      x: n.x + AIRPORT2_X,
      z: n.z + AIRPORT2_Z,
    }));
    const edges = src.edges.map(([a, b]) => ['a2_' + a, 'a2_' + b]);
    const nodeMap = {};
    for (const n of nodes) nodeMap[n.id] = n;
    const net = { nodes, edges, nodeMap };
    networkCache[airportId] = net;
    return net;
  }
  if (airportId === 'intl') {
    const n = getIntlTaxiNetwork();
    if (n) networkCache[airportId] = n;
    return n;
  }
  return null;
}

// Adjacency built per network
const adjCache = {};
function getAdj(airportId) {
  if (adjCache[airportId]) return adjCache[airportId];
  const net = getNetwork(airportId);
  if (!net) return {};
  const adj = {};
  for (const n of net.nodes) adj[n.id] = [];
  for (const [a, b] of net.edges) {
    if (adj[a]) adj[a].push(b);
    if (adj[b]) adj[b].push(a);
  }
  adjCache[airportId] = adj;
  return adj;
}

function bfsPath(airportId, fromId, toId) {
  const adj = getAdj(airportId);
  if (!adj[fromId] || !adj[toId]) return null;
  const queue = [[fromId]];
  const visited = new Set([fromId]);
  while (queue.length > 0) {
    const path = queue.shift();
    const node = path[path.length - 1];
    if (node === toId) return path;
    for (const next of (adj[node] || [])) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

function nodePos(airportId, nodeId) {
  const net = getNetwork(airportId);
  if (!net || !net.nodeMap[nodeId]) return null;
  const n = net.nodeMap[nodeId];
  return new THREE.Vector3(n.x, 0, n.z);
}

// ── Simplified AI aircraft model builder ────────────────────────────────────
function buildAIAircraftModel(isLarge) {
  const group = new THREE.Group();

  const scale = isLarge ? 2.5 : 1.5;
  const bodyColor = isLarge ? 0xf0f0f0 : 0xeeeeee;
  const accentColor = isLarge ? 0x0055aa : 0x1144aa;

  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.3, roughness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.3, roughness: 0.5 });

  // Fuselage
  const fuseLen = isLarge ? 14 : 8;
  const fuseRad = isLarge ? 1.2 : 0.6;
  const fuseGeo = new THREE.CylinderGeometry(fuseRad * 0.3, fuseRad, fuseLen, 8);
  fuseGeo.rotateX(Math.PI / 2);
  const fuse = new THREE.Mesh(fuseGeo, bodyMat);
  group.add(fuse);

  // Wings
  const wingSpan = isLarge ? 14 : 10;
  const wingChord = isLarge ? 3 : 2;
  const wingGeo = new THREE.BoxGeometry(wingSpan, 0.15, wingChord);
  const wing = new THREE.Mesh(wingGeo, bodyMat);
  wing.position.set(0, 0, 1);
  group.add(wing);

  // Tail vertical stabilizer
  const tailGeo = new THREE.BoxGeometry(0.1, isLarge ? 3.5 : 2.5, isLarge ? 2.5 : 1.8);
  const tail = new THREE.Mesh(tailGeo, accentMat);
  tail.position.set(0, isLarge ? 1.8 : 1.2, fuseLen * 0.42);
  group.add(tail);

  // Horizontal stabilizer
  const hstabGeo = new THREE.BoxGeometry(isLarge ? 5 : 3.5, 0.1, isLarge ? 1.5 : 1);
  const hstab = new THREE.Mesh(hstabGeo, bodyMat);
  hstab.position.set(0, isLarge ? 0.3 : 0.2, fuseLen * 0.42);
  group.add(hstab);

  // Engines (for jets)
  if (isLarge) {
    for (const side of [-1, 1]) {
      const engGeo = new THREE.CylinderGeometry(0.55, 0.55, 2.5, 8);
      engGeo.rotateX(Math.PI / 2);
      const eng = new THREE.Mesh(engGeo, accentMat);
      eng.position.set(side * 4, -0.8, 0);
      group.add(eng);
    }
  }

  // Nav lights
  const navLeftMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const navRightMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const navGeo = new THREE.SphereGeometry(0.15, 4, 4);
  const navLeft = new THREE.Mesh(navGeo, navLeftMat);
  navLeft.position.set(-wingSpan / 2, 0, 1);
  group.add(navLeft);
  const navRight = new THREE.Mesh(navGeo, navRightMat);
  navRight.position.set(wingSpan / 2, 0, 1);
  group.add(navRight);

  // Beacon (red flashing) — top and bottom
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true });
  const beaconGeo = new THREE.SphereGeometry(0.2, 4, 4);
  const beaconTop = new THREE.Mesh(beaconGeo, beaconMat);
  beaconTop.position.set(0, fuseRad + 0.1, 0);
  group.add(beaconTop);
  const beaconBot = new THREE.Mesh(beaconGeo, beaconMat.clone());
  beaconBot.position.set(0, -fuseRad - 0.1, 0);
  group.add(beaconBot);

  group.scale.setScalar(scale);

  return { group, beaconTop, beaconBot, navLeft, navRight };
}

// ── AI Aircraft pool ────────────────────────────────────────────────────────
let sceneRef = null;
const aiPlanes = [];
const AI_COUNT = 8;
const _toTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _euler = new THREE.Euler();

// ── Audio ───────────────────────────────────────────────────────────────────
let audioCtx = null;
const aiSounds = new Map(); // aiPlane -> { osc, gain, filter }

function ensureAudio() {
  if (audioCtx) return true;
  audioCtx = getAudioContext();
  return !!audioCtx;
}

function createAIEngineSound() {
  if (!ensureAudio()) return null;
  try {
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.5;

    // Low rumble oscillator
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55 + Math.random() * 20;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();

    return { osc, gain, filter };
  } catch {
    return null;
  }
}

function updateAISound(plane, playerPos) {
  if (!ensureAudio()) return;

  const dist = playerPos.distanceTo(plane.position);
  const maxDist = 2000;

  if (dist < maxDist && plane.state >= S.TAKEOFF_ROLL && plane.state <= S.LANDING) {
    // Need sound
    if (!aiSounds.has(plane)) {
      const snd = createAIEngineSound();
      if (snd) aiSounds.set(plane, snd);
    }
    const snd = aiSounds.get(plane);
    if (snd) {
      const vol = Math.max(0, 1 - dist / maxDist) * 0.15;
      snd.gain.gain.value = vol;
      // Pitch varies with speed
      snd.osc.frequency.value = 55 + (plane.speed / 200) * 40;
      snd.filter.frequency.value = 200 + (plane.speed / 200) * 400;
    }
  } else {
    // Too far or on ground — kill sound
    const snd = aiSounds.get(plane);
    if (snd) {
      snd.gain.gain.value = 0;
    }
  }
}

// ── ATC chatter ─────────────────────────────────────────────────────────────
let lastATCTime = 0;
const atcCooldowns = new Map(); // plane -> lastCalloutTime

function bearingLabel(dx, dz) {
  const angle = ((Math.atan2(-dx, -dz) * 180 / Math.PI) + 360) % 360;
  if (angle < 22.5 || angle >= 337.5) return 'north';
  if (angle < 67.5) return 'north-east';
  if (angle < 112.5) return 'east';
  if (angle < 157.5) return 'south-east';
  if (angle < 202.5) return 'south';
  if (angle < 247.5) return 'south-west';
  if (angle < 292.5) return 'west';
  return 'north-west';
}

function tryATCCallout(plane, playerPos, now) {
  if (now - lastATCTime < 8000) return; // global cooldown 8s
  const cd = atcCooldowns.get(plane) || 0;
  if (now - cd < 30000) return; // per-plane 30s cooldown

  const dist = playerPos.distanceTo(plane.position);
  if (dist > 5000 || dist < 200) return;
  if (plane.state < S.CLIMB || plane.state > S.APPROACH) return;

  const miles = (dist / 1852).toFixed(0);
  const dx = plane.position.x - playerPos.x;
  const dz = plane.position.z - playerPos.z;
  const dir = bearingLabel(dx, dz);
  const alt = Math.round(plane.position.y * 3.28084 / 100) * 100;
  const msg = `Traffic, ${dir}, ${miles} miles, ${alt} feet`;

  if (typeof speechSynthesis !== 'undefined') {
    const utt = new SpeechSynthesisUtterance(msg);
    utt.rate = 1.1;
    utt.pitch = 0.9;
    utt.volume = 0.6;
    speechSynthesis.speak(utt);
    lastATCTime = now;
    atcCooldowns.set(plane, now);
  }
}

// ── Spawn & lifecycle ───────────────────────────────────────────────────────
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickDest(originId) {
  const others = AIRPORTS.filter(a => a.id !== originId);
  return pickRandom(others);
}

function pickRunway(airport) {
  const available = airport.runways.filter(r => !runwayOccupied[r.id]);
  return available.length > 0 ? pickRandom(available) : pickRandom(airport.runways);
}

function spawnAIPlane() {
  const origin = pickRandom(AIRPORTS);
  const dest = pickDest(origin.id);
  const isLarge = Math.random() > 0.4;
  const { group, beaconTop, beaconBot, navLeft, navRight } = buildAIAircraftModel(isLarge);

  // Pick a gate
  const gateId = pickRandom(origin.gates);
  const pos = nodePos(origin.networkId, gateId);
  if (!pos) {
    console.warn(`[AI] nodePos returned null for gate '${gateId}' in network '${origin.networkId}'`);
    return null;
  }
  const groundY = getGroundLevel(pos.x, pos.z);
  pos.y = groundY + 1.5;

  group.position.copy(pos);
  sceneRef.add(group);

  return {
    group,
    beaconTop,
    beaconBot,
    navLeft,
    navRight,
    position: pos.clone(),
    speed: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    altitude: pos.y,
    state: S.PARKED,
    origin,
    dest,
    isLarge,
    // Taxi state
    route: null,
    routeIdx: 0,
    targetPos: null,
    currentNode: gateId,
    // Timing
    waitTimer: 10 + Math.random() * 50,
    // Runway
    runway: null,
    holdNode: null,
    takeoffDir: 1,
    // Flight
    cruiseAlt: 1500 + Math.random() * 1500,
    departHeading: 0,
    targetAlt: 0,
    // Landing
    touchdownPoint: null,
    approachStarted: false,
  };
}

// ── State machine ───────────────────────────────────────────────────────────
function updateParked(plane, dt) {
  plane.waitTimer -= dt;
  if (plane.waitTimer <= 0) {
    // Transition to TAXI_OUT
    const rwy = pickRunway(plane.origin);
    plane.runway = rwy;

    // Find hold node closest to gate
    const holdNodes = plane.origin.holdNodes[rwy.id];
    if (!holdNodes || holdNodes.length === 0) {
      plane.waitTimer = 10;
      return;
    }
    // Pick the hold node
    plane.holdNode = pickRandom(holdNodes);

    const path = bfsPath(plane.origin.networkId, plane.currentNode, plane.holdNode);
    if (!path || path.length < 2) {
      // Track BFS failures — after 3, force teleport to hold node
      plane._bfsFailCount = (plane._bfsFailCount || 0) + 1;
      if (plane._bfsFailCount >= 3) {
        console.warn(`[AI] BFS failed 3 times for plane at '${plane.currentNode}' → '${plane.holdNode}', forcing teleport`);
        const holdPos = nodePos(plane.origin.networkId, plane.holdNode);
        if (holdPos) {
          plane.position.copy(holdPos);
          plane.position.y = getGroundLevel(holdPos.x, holdPos.z) + 1.5;
          plane.group.position.copy(plane.position);
          plane.currentNode = plane.holdNode;
          plane.state = S.HOLDING;
          plane.speed = 0;
          plane._bfsFailCount = 0;
        } else {
          plane.waitTimer = 10;
        }
      } else {
        plane.waitTimer = 10;
      }
      return;
    }

    plane._bfsFailCount = 0;
    plane.route = path;
    plane.routeIdx = 1;
    plane.targetPos = nodePos(plane.origin.networkId, path[1]);
    plane.state = S.TAXI_OUT;
  }
}

function updateTaxiGround(plane, dt, taxiSpeed) {
  if (!plane.targetPos) return false;

  _toTarget.subVectors(plane.targetPos, plane.position);
  _toTarget.y = 0;
  const dist = _toTarget.length();

  if (dist < 3) {
    plane.currentNode = plane.route[plane.routeIdx];
    plane.routeIdx++;
    if (plane.routeIdx >= plane.route.length) {
      plane.route = null;
      plane.speed = 0;
      return true; // route complete
    }
    plane.targetPos = nodePos(
      plane.state === S.TAXI_IN ? plane.dest.networkId : plane.origin.networkId,
      plane.route[plane.routeIdx]
    );
    return false;
  }

  // Steer
  const targetAngle = Math.atan2(-_toTarget.x, -_toTarget.z);
  let headingErr = targetAngle - plane.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;

  const maxTurn = 1.5 * dt;
  plane.heading += clamp(headingErr, -maxTurn, maxTurn);

  // Speed
  const turnSharpness = Math.abs(headingErr) / (Math.PI / 4);
  const targetSpeed = taxiSpeed * clamp(1 - turnSharpness * 0.6, 0.2, 1);
  const approachSlowdown = clamp(dist / 10, 0.3, 1);
  plane.speed += (targetSpeed * approachSlowdown - plane.speed) * clamp(3 * dt, 0, 1);
  plane.speed = clamp(plane.speed, 0, taxiSpeed);

  // Move
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);
  plane.position.y = getGroundLevel(plane.position.x, plane.position.z) + 1.5;
  plane.pitch = 0;
  plane.roll = 0;

  return false;
}

function updateTaxiOut(plane, dt) {
  const done = updateTaxiGround(plane, dt, 12);
  if (done) {
    plane.state = S.HOLDING;
    plane.speed = 0;
  }
}

function isRunwayClear(rwyId) {
  if (runwayOccupied[rwyId]) return false;
  // Check if any other AI is on takeoff roll or close approach on this runway
  for (const p of aiPlanes) {
    if (!p) continue;
    if (p.runway && p.runway.id === rwyId) {
      if (p.state === S.TAKEOFF_ROLL) return false;
      if (p.state === S.APPROACH || p.state === S.LANDING) return false;
    }
  }
  return true;
}

function updateHolding(plane, dt) {
  plane.speed = 0;
  if (isRunwayClear(plane.runway.id)) {
    // Line up on runway
    runwayOccupied[plane.runway.id] = true;
    plane.state = S.TAKEOFF_ROLL;

    // Determine takeoff direction and departure heading
    const rwy = plane.runway;
    if (rwy.axis === 'z') {
      // Z-axis runway — pick direction toward destination
      const dz = plane.dest.z - plane.origin.z;
      plane.takeoffDir = dz < 0 ? 1 : -1; // heading north (0) or south (PI)
      plane.heading = dz < 0 ? 0 : Math.PI;
      plane.departHeading = plane.heading + (Math.random() - 0.5) * 0.5;
      plane.position.x = rwy.thresholdA.x;
      plane.position.z = plane.takeoffDir > 0 ? rwy.thresholdB.z : rwy.thresholdA.z;
    } else {
      // X-axis runway (international) — pick direction
      const dx = plane.dest.x - plane.origin.x;
      plane.takeoffDir = dx > 0 ? 1 : -1;
      plane.heading = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
      plane.departHeading = plane.heading + (Math.random() - 0.5) * 0.5;
      plane.position.z = rwy.thresholdA.z;
      plane.position.x = plane.takeoffDir > 0 ? rwy.thresholdA.x : rwy.thresholdB.x;
    }
  }
}

function updateTakeoffRoll(plane, dt) {
  const rotateSpeed = 75;
  plane.speed += 30 * dt; // accelerate

  // Move along heading
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);
  plane.position.y = getGroundLevel(plane.position.x, plane.position.z) + 1.5;

  if (plane.speed >= rotateSpeed) {
    // Rotate and climb
    plane.pitch = -0.17; // ~10 degrees nose up
    plane.state = S.CLIMB;
    plane.targetAlt = plane.cruiseAlt;
    // Release runway after liftoff
    const runwayId = plane.runway ? plane.runway.id : null;
    scheduleRunwayRelease(runwayId, 5000);
  }
}

function updateClimb(plane, dt) {
  // Gradually turn toward departure heading
  let headingErr = plane.departHeading - plane.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;
  plane.heading += clamp(headingErr, -0.5 * dt, 0.5 * dt);
  plane.roll = clamp(-headingErr * 2, -0.4, 0.4);

  // Accelerate to cruise
  plane.speed += (150 - plane.speed) * dt * 0.5;
  plane.speed = clamp(plane.speed, 0, 180);

  // Climb
  const climbRate = 15; // m/s
  plane.position.y += climbRate * dt;
  plane.pitch = -0.12;

  // Move forward
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);

  if (plane.position.y >= plane.targetAlt) {
    plane.position.y = plane.targetAlt;
    plane.state = S.CRUISE;
    plane.pitch = 0;
    plane.roll = 0;

    // Compute heading to destination
    const dx = plane.dest.x - plane.position.x;
    const dz = plane.dest.z - plane.position.z;
    plane.departHeading = Math.atan2(-dx, -dz);
  }
}

function updateCruise(plane, dt) {
  // Head toward destination
  const dx = plane.dest.x - plane.position.x;
  const dz = plane.dest.z - plane.position.z;
  const distToDest = Math.sqrt(dx * dx + dz * dz);

  const targetHeading = Math.atan2(-dx, -dz);
  let headingErr = targetHeading - plane.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;
  plane.heading += clamp(headingErr, -0.3 * dt, 0.3 * dt);
  plane.roll = clamp(-headingErr * 1.5, -0.3, 0.3);

  // Cruise speed
  plane.speed += (170 - plane.speed) * dt * 0.3;

  // Move
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);

  // Hold altitude
  plane.position.y += (plane.targetAlt - plane.position.y) * dt;
  plane.pitch = 0;

  // Begin descent at ~8000m from destination
  if (distToDest < 8000) {
    plane.state = S.DESCENT;
    // Pick a runway at destination
    plane.runway = pickRunway(plane.dest);
  }
}

function updateDescent(plane, dt) {
  const dx = plane.dest.x - plane.position.x;
  const dz = plane.dest.z - plane.position.z;
  const distToDest = Math.sqrt(dx * dx + dz * dz);

  // Head toward destination
  const targetHeading = Math.atan2(-dx, -dz);
  let headingErr = targetHeading - plane.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;
  plane.heading += clamp(headingErr, -0.4 * dt, 0.4 * dt);
  plane.roll = clamp(-headingErr * 1.5, -0.3, 0.3);

  // Slow down
  const targetSpeed = 70 + (distToDest / 8000) * 100;
  plane.speed += (targetSpeed - plane.speed) * dt * 0.5;

  // Descend
  const groundLevel = getGroundLevel(plane.position.x, plane.position.z);
  const targetAlt = groundLevel + 200 + (distToDest / 8000) * (plane.cruiseAlt - 200);
  plane.position.y += (targetAlt - plane.position.y) * dt * 0.5;
  plane.pitch = 0.05; // slight nose down

  // Move
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);

  // Transition to approach at ~3000m
  if (distToDest < 3000) {
    plane.state = S.APPROACH;
    runwayOccupied[plane.runway.id] = true;

    // Determine approach direction
    const rwy = plane.runway;
    if (rwy.axis === 'z') {
      const dz2 = plane.position.z - rwy.thresholdA.z;
      plane.takeoffDir = dz2 > 0 ? 1 : -1;
      plane.touchdownPoint = plane.takeoffDir > 0
        ? new THREE.Vector3(rwy.thresholdA.x, 0, rwy.thresholdB.z)
        : new THREE.Vector3(rwy.thresholdA.x, 0, rwy.thresholdA.z);
    } else {
      const dx2 = plane.position.x - rwy.thresholdA.x;
      plane.takeoffDir = dx2 > 0 ? 1 : -1;
      plane.touchdownPoint = plane.takeoffDir > 0
        ? new THREE.Vector3(rwy.thresholdB.x, 0, rwy.thresholdA.z)
        : new THREE.Vector3(rwy.thresholdA.x, 0, rwy.thresholdA.z);
    }
  }
}

function updateApproach(plane, dt) {
  if (!plane.touchdownPoint) {
    plane.state = S.LANDING;
    return;
  }

  const dx = plane.touchdownPoint.x - plane.position.x;
  const dz = plane.touchdownPoint.z - plane.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Head toward touchdown
  const targetHeading = Math.atan2(-dx, -dz);
  let headingErr = targetHeading - plane.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;
  plane.heading += clamp(headingErr, -0.8 * dt, 0.8 * dt);
  plane.roll = clamp(-headingErr * 2, -0.25, 0.25);

  // Slow down
  const targetSpeed = clamp(50 + dist * 0.01, 50, 90);
  plane.speed += (targetSpeed - plane.speed) * dt * 0.8;

  // 3-degree glideslope
  const groundLevel = getGroundLevel(plane.touchdownPoint.x, plane.touchdownPoint.z);
  const glideSlopeAlt = groundLevel + 2 + dist * Math.tan(3 * Math.PI / 180);
  plane.position.y += (glideSlopeAlt - plane.position.y) * dt * 2;
  plane.pitch = 0.05;

  // Move
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);

  if (dist < 50) {
    plane.state = S.LANDING;
    const gl = getGroundLevel(plane.position.x, plane.position.z);
    plane.position.y = gl + 1.5;
  }
}

function updateLanding(plane, dt) {
  // On the ground, decelerate
  plane.position.y = getGroundLevel(plane.position.x, plane.position.z) + 1.5;
  plane.pitch = 0.03; // nose slightly up during rollout
  plane.roll = 0;

  // Decelerate
  plane.speed -= 20 * dt;
  if (plane.speed < 0) plane.speed = 0;

  // Move along heading
  _forward.set(-Math.sin(plane.heading), 0, -Math.cos(plane.heading));
  plane.position.addScaledVector(_forward, plane.speed * dt);

  if (plane.speed <= 2) {
    // Free the runway
    runwayOccupied[plane.runway.id] = false;
    plane.state = S.TAXI_IN;
    plane.speed = 0;

    // Find nearest node in dest network and pathfind to a gate
    const destNet = getNetwork(plane.dest.networkId);
    if (destNet) {
      // Find closest node
      let closestNode = null;
      let closestDist = Infinity;
      for (const n of destNet.nodes) {
        const d = (n.x - plane.position.x) ** 2 + (n.z - plane.position.z) ** 2;
        if (d < closestDist) { closestDist = d; closestNode = n.id; }
      }
      const gateId = pickRandom(plane.dest.gates);
      const path = bfsPath(plane.dest.networkId, closestNode, gateId);
      if (path && path.length > 1) {
        plane.currentNode = closestNode;
        plane.route = path;
        plane.routeIdx = 1;
        plane.targetPos = nodePos(plane.dest.networkId, path[1]);
      } else {
        // Can't pathfind — just reset
        resetPlane(plane);
      }
    } else {
      resetPlane(plane);
    }
  }
}

function updateTaxiIn(plane, dt) {
  const done = updateTaxiGround(plane, dt, 10);
  if (done) {
    // Parked at gate — restart cycle after delay
    resetPlane(plane);
  }
}

function resetPlane(plane) {
  // Pick new origin/dest and restart
  const newOrigin = pickRandom(AIRPORTS);
  const newDest = pickDest(newOrigin.id);
  const gateId = pickRandom(newOrigin.gates);
  const pos = nodePos(newOrigin.networkId, gateId);
  if (!pos) {
    // Fallback — put at airport center
    pos || plane.position.set(newOrigin.x, getGroundLevel(newOrigin.x, newOrigin.z) + 1.5, newOrigin.z);
  } else {
    plane.position.copy(pos);
    plane.position.y = getGroundLevel(pos.x, pos.z) + 1.5;
  }

  plane.origin = newOrigin;
  plane.dest = newDest;
  plane.state = S.PARKED;
  plane.speed = 0;
  plane.heading = 0;
  plane.pitch = 0;
  plane.roll = 0;
  plane.route = null;
  plane.routeIdx = 0;
  plane.targetPos = null;
  plane.currentNode = gateId;
  plane.waitTimer = 30 + Math.random() * 60;
  plane.runway = null;
  plane.holdNode = null;
  plane.touchdownPoint = null;
  plane.approachStarted = false;
  plane.cruiseAlt = 1500 + Math.random() * 1500;

  plane.group.position.copy(plane.position);
}

// ── Visual sync ─────────────────────────────────────────────────────────────
function syncVisuals(plane, dt) {
  plane.group.position.copy(plane.position);

  // Beacon flash
  const flash = Math.sin(performance.now() * 0.008) > 0.7 ? 1 : 0.1;
  if (plane.beaconTop) plane.beaconTop.material.opacity = flash;
  if (plane.beaconBot) plane.beaconBot.material.opacity = flash;

  // Orientation
  _euler.set(plane.pitch, -plane.heading, plane.roll, 'YXZ');
  plane.group.quaternion.setFromEuler(_euler);
}

// Spawn a plane already in cruise between two airports
function spawnInFlightPlane() {
  const origin = pickRandom(AIRPORTS);
  const dest = pickDest(origin.id);
  const isLarge = Math.random() > 0.3;
  const { group, beaconTop, beaconBot, navLeft, navRight } = buildAIAircraftModel(isLarge);

  // Position somewhere between origin and dest
  const t = 0.2 + Math.random() * 0.6;
  const px = origin.x + (dest.x - origin.x) * t;
  const pz = origin.z + (dest.z - origin.z) * t;
  const cruiseAlt = 1500 + Math.random() * 1500;
  const pos = new THREE.Vector3(px, cruiseAlt, pz);

  group.position.copy(pos);
  sceneRef.add(group);

  const heading = Math.atan2(-(dest.x - origin.x), -(dest.z - origin.z));

  return {
    group, beaconTop, beaconBot, navLeft, navRight,
    position: pos.clone(),
    speed: 150 + Math.random() * 30,
    heading,
    pitch: 0,
    roll: 0,
    altitude: cruiseAlt,
    state: S.CRUISE,
    origin, dest, isLarge,
    route: null, routeIdx: 0, targetPos: null,
    currentNode: null,
    waitTimer: 0,
    runway: null, holdNode: null, takeoffDir: 1,
    cruiseAlt,
    departHeading: heading,
    targetAlt: cruiseAlt,
    touchdownPoint: null, approachStarted: false,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
export function initAircraftAI(scene) {
  sceneRef = scene;

  // Initialize runway occupation
  for (const apt of AIRPORTS) {
    for (const rwy of apt.runways) {
      runwayOccupied[rwy.id] = false;
    }
  }

  // Spawn some planes already in-flight for immediate visibility
  for (let i = 0; i < 3; i++) {
    const plane = spawnInFlightPlane();
    if (plane) aiPlanes.push(plane);
  }

  // Spawn remaining planes at gates with staggered timers
  for (let i = 0; i < AI_COUNT - 3; i++) {
    const plane = spawnAIPlane();
    if (plane) {
      plane.waitTimer = 5 + i * 12 + Math.random() * 15;
      aiPlanes.push(plane);
    }
  }
}

export function updateAircraftAI(dt) {
  if (aiPlanes.length === 0) return;

  const player = getActiveVehicle();
  const playerPos = player ? player.position : new THREE.Vector3();
  const now = performance.now();

  for (const plane of aiPlanes) {
    if (!plane) continue;

    switch (plane.state) {
      case S.PARKED:       updateParked(plane, dt); break;
      case S.TAXI_OUT:     updateTaxiOut(plane, dt); break;
      case S.HOLDING:      updateHolding(plane, dt); break;
      case S.TAKEOFF_ROLL: updateTakeoffRoll(plane, dt); break;
      case S.CLIMB:        updateClimb(plane, dt); break;
      case S.CRUISE:       updateCruise(plane, dt); break;
      case S.DESCENT:      updateDescent(plane, dt); break;
      case S.APPROACH:     updateApproach(plane, dt); break;
      case S.LANDING:      updateLanding(plane, dt); break;
      case S.TAXI_IN:      updateTaxiIn(plane, dt); break;
    }

    syncVisuals(plane, dt);
    updateAISound(plane, playerPos);
    tryATCCallout(plane, playerPos, now);
  }
}

export function resetAircraftAI() {
  clearPendingRunwayReleaseTimers();

  // Remove all AI planes from scene
  for (const plane of aiPlanes) {
    if (plane && plane.group && sceneRef) {
      sceneRef.remove(plane.group);
    }
    if (plane && plane.group) {
      disposePlaneModel(plane.group);
    }
  }
  aiPlanes.length = 0;

  // Stop sounds
  for (const [, snd] of aiSounds) {
    try { snd.osc.stop(); } catch { /* ignore */ }
    try { snd.osc.disconnect(); } catch { /* ignore */ }
    try { snd.filter.disconnect(); } catch { /* ignore */ }
    try { snd.gain.disconnect(); } catch { /* ignore */ }
  }
  aiSounds.clear();

  // Clear caches
  Object.keys(networkCache).forEach(k => delete networkCache[k]);
  Object.keys(adjCache).forEach(k => delete adjCache[k]);

  // Clear runway occupation
  for (const k in runwayOccupied) runwayOccupied[k] = false;

  // Re-init if scene is available
  if (sceneRef) {
    initAircraftAI(sceneRef);
  }
}

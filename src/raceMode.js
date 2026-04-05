// Race Mode — checkpoint circuit race with lap timer
// Premium torus-ring gates with pulsing animation and guide lines
import * as THREE from 'three';
import { getActiveVehicle, isCar } from './vehicleState.js';
import { showMessage } from './hud.js';
import { saveBestScore, getBestScore } from './settings.js';
import { getGroundLevel } from './terrain.js';

// Race state
let raceActive = false;
let checkpoints = [];
let currentCP = 0;
let lap = 0;
let totalLaps = 3;
let lapTimer = 0;
let raceTimer = 0;
let bestLap = Infinity;
let lapTimes = [];

// 3D checkpoint gates
let sceneRef = null;
let gateGroup = null;
const gates = [];

// Guide line from player to next gate
let guideLine = null;
let guideLineMat = null;

// Finish flash overlay
let finishFlash = null;
let finishFlashTimer = 0;

const RACE_CIRCUITS = {
  airport: {
    name: 'Airport Circuit',
    points: [
      { x: 130, z: -400 },
      { x: 130, z: -100 },
      { x: 280, z: -40 },
      { x: 280, z: 40 },
      { x: 130, z: 100 },
      { x: 130, z: 400 },
    ],
  },
  city: {
    name: 'City Circuit',
    points: [
      { x: 3700, z: -3700 },
      { x: 4300, z: -3700 },
      { x: 4300, z: -4300 },
      { x: 3700, z: -4300 },
    ],
  },
  highway: {
    name: 'Highway Sprint',
    // Long straight highway run
    points: [
      { x: 650, z: -2000 },
      { x: 950, z: -2950 },
      { x: 1650, z: -3325 },
      { x: 2550, z: -3725 },
      { x: 3350, z: -4550 },
      { x: 4200, z: -5450 },
    ],
  },
};

// ---- Shared gate creation ----

/**
 * Create a torus ring gate at a world position.
 * @param {THREE.Scene} scene
 * @param {number} x
 * @param {number} z
 * @param {number} index       gate index (for numbering)
 * @param {number} total       total gates
 * @param {number} radius      torus major radius
 * @param {boolean} onGround   if true, orient ring flat on ground plane
 * @returns gate descriptor
 */
export function createRingGate(scene, x, z, index, total, radius, onGround) {
  const group = new THREE.Group();
  const groundY = getGroundLevel(x, z);

  // Torus ring
  const tubeRadius = Math.max(0.4, radius * 0.04);
  const torusGeo = new THREE.TorusGeometry(radius, tubeRadius, 16, 48);
  const torusMat = new THREE.MeshBasicMaterial({
    color: 0x4fc3f7,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const torusMesh = new THREE.Mesh(torusGeo, torusMat);

  if (onGround) {
    // Flat on the ground for ground-job waypoints
    torusMesh.rotation.x = -Math.PI / 2;
    torusMesh.position.y = 0.3;
  } else {
    // Upright ring you fly/drive through
    torusMesh.position.y = radius + 1;
  }
  group.add(torusMesh);

  // Inner glow ring (slightly smaller, brighter, for depth)
  const innerGeo = new THREE.TorusGeometry(radius * 0.92, tubeRadius * 0.5, 12, 48);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x4fc3f7,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.position.copy(torusMesh.position);
  innerMesh.rotation.copy(torusMesh.rotation);
  group.add(innerMesh);

  // Number sprite at center of the ring
  const numSprite = createNumberSprite(index + 1, radius);
  if (onGround) {
    numSprite.position.y = 1.5;
  } else {
    numSprite.position.y = torusMesh.position.y;
  }
  group.add(numSprite);

  group.position.set(x, groundY, z);
  scene.add(group);

  return {
    group,
    x, z,
    passed: false,
    torusMat,
    innerMat,
    torusMesh,
    innerMesh,
    numSprite,
    radius,
    onGround: !!onGround,
  };
}

function createNumberSprite(num, gateRadius) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Circular background
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 30, 60, 0.6)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.8)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Number text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.5}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), size / 2, size / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(spriteMat);
  const scale = Math.max(3, gateRadius * 0.25);
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

// ---- Gate visual state helpers ----

function setGateInactive(gate) {
  if (!gate.torusMat) return;
  gate.torusMat.color.setHex(0x4fc3f7);
  gate.torusMat.opacity = 0.3;
  gate.innerMat.color.setHex(0x4fc3f7);
  gate.innerMat.opacity = 0.15;
  if (gate.numSprite) gate.numSprite.material.opacity = 0.4;
}

function setGateActive(gate) {
  if (!gate.torusMat) return;
  gate.torusMat.color.setHex(0x4fc3f7);
  gate.torusMat.opacity = 0.8;
  gate.innerMat.color.setHex(0x4fc3f7);
  gate.innerMat.opacity = 0.5;
  if (gate.numSprite) gate.numSprite.material.opacity = 1.0;
}

function setGatePassed(gate) {
  if (!gate.torusMat) return;
  gate.torusMat.color.setHex(0x81c784);
  gate.torusMat.opacity = 0.2;
  gate.innerMat.color.setHex(0x81c784);
  gate.innerMat.opacity = 0.1;
  if (gate.numSprite) gate.numSprite.material.opacity = 0.3;
}

// ---- Guide line ----

function createGuideLine(scene) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  guideLineMat = new THREE.LineDashedMaterial({
    color: 0x4fc3f7,
    dashSize: 10,
    gapSize: 5,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  guideLine = new THREE.Line(geo, guideLineMat);
  guideLine.computeLineDistances();
  guideLine.frustumCulled = false;
  scene.add(guideLine);
}

function updateGuideLine(vehicle, gate) {
  if (!guideLine || !vehicle || !gate) return;
  const pos = guideLine.geometry.attributes.position;
  // Start: player position (slightly above ground)
  pos.setXYZ(0, vehicle.position.x, vehicle.position.y + 2, vehicle.position.z);
  // End: gate center
  const gy = getGroundLevel(gate.x, gate.z);
  const centerY = gate.onGround ? gy + 1 : gy + gate.radius + 1;
  pos.setXYZ(1, gate.x, centerY, gate.z);
  pos.needsUpdate = true;
  guideLine.computeLineDistances();
  guideLine.visible = true;
}

function hideGuideLine() {
  if (guideLine) guideLine.visible = false;
}

// ---- Finish flash ----

function triggerFinishFlash() {
  finishFlashTimer = 1.5; // seconds
}

// ---- Public API ----

export function initRaceMode(scene) {
  sceneRef = scene;
}

let currentCircuitName = 'airport';

export function startRace(circuitName) {
  if (!sceneRef) return;

  const circuit = RACE_CIRCUITS[circuitName || 'airport'];
  if (!circuit) return;

  // Clean up old gates
  resetRace();

  currentCircuitName = circuitName || 'airport';
  raceActive = true;
  currentCP = 0;
  lap = 0;
  totalLaps = circuitName === 'highway' ? 1 : 3;  // Highway is a sprint
  lapTimer = 0;
  raceTimer = 0;
  bestLap = Infinity;
  lapTimes = [];

  // Load best time
  const savedBest = getBestScore('race_' + circuitName);
  if (savedBest > 0) bestLap = (100000 - savedBest) / 1000;

  // Determine gate size based on vehicle type
  const v = getActiveVehicle();
  const isCarVehicle = isCar(v);
  const gateRadius = isCarVehicle ? 15 : 40;
  const triggerRadius = isCarVehicle ? 12 : 20;

  // Create checkpoint gates
  checkpoints = circuit.points.map((p, i) => {
    const gate = createRingGate(sceneRef, p.x, p.z, i, circuit.points.length, gateRadius, false);
    gates.push(gate);
    return { x: p.x, z: p.z, radius: triggerRadius };
  });

  // Orient gates to face the next checkpoint
  for (let i = 0; i < gates.length; i++) {
    const next = checkpoints[(i + 1) % checkpoints.length];
    const angle = Math.atan2(next.x - checkpoints[i].x, next.z - checkpoints[i].z);
    gates[i].group.rotation.y = angle;
  }

  // Create guide line
  createGuideLine(sceneRef);

  // Highlight first checkpoint
  highlightGate(0);

  showMessage(`RACE: ${circuit.name} -- ${totalLaps} lap${totalLaps > 1 ? 's' : ''} -- GO!`);
}

function highlightGate(index) {
  for (let i = 0; i < gates.length; i++) {
    if (i === index) {
      setGateActive(gates[i]);
    } else if (gates[i].passed) {
      setGatePassed(gates[i]);
    } else {
      setGateInactive(gates[i]);
    }
  }
}

export function updateRaceMode(dt) {
  if (!raceActive) return;

  const v = getActiveVehicle();
  if (!v) return;

  lapTimer += dt;
  raceTimer += dt;

  // Check if player passed current checkpoint
  const cp = checkpoints[currentCP];
  const dx = v.position.x - cp.x;
  const dz = v.position.z - cp.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < cp.radius) {
    gates[currentCP].passed = true;
    setGatePassed(gates[currentCP]);
    currentCP++;

    if (currentCP >= checkpoints.length) {
      // Lap complete
      currentCP = 0;
      lap++;

      const lapTime = lapTimer;
      lapTimes.push(lapTime);

      if (lapTime < bestLap) {
        bestLap = lapTime;
        showMessage(`LAP ${lap}/${totalLaps}: ${formatRaceTime(lapTime)} -- NEW BEST!`);
      } else {
        showMessage(`LAP ${lap}/${totalLaps}: ${formatRaceTime(lapTime)}`);
      }

      lapTimer = 0;

      if (lap >= totalLaps) {
        // Race complete!
        triggerFinishFlash();
        raceActive = false;
        const totalTime = raceTimer;
        const key = 'race_' + currentCircuitName;
        const invertedScore = Math.max(0, 100000 - Math.round(totalTime * 1000));
        saveBestScore(key, invertedScore);

        const avgLap = totalTime / totalLaps;
        showMessage(
          `RACE COMPLETE! Total: ${formatRaceTime(totalTime)} | ` +
          `Best Lap: ${formatRaceTime(bestLap)} | Avg: ${formatRaceTime(avgLap)}`
        );
        hideGuideLine();
        return;
      }

      // Reset passed state for next lap
      for (const g of gates) g.passed = false;
    }

    highlightGate(currentCP);
  }

  // Animate active gate (pulsing opacity)
  const activeGate = gates[currentCP];
  if (activeGate && activeGate.torusMat) {
    const t = performance.now() * 0.004;
    const pulse = 0.6 + Math.sin(t) * 0.4; // 0.2 -> 1.0
    activeGate.torusMat.opacity = pulse;
    activeGate.innerMat.opacity = pulse * 0.5;
    if (activeGate.numSprite) activeGate.numSprite.material.opacity = 0.6 + Math.sin(t) * 0.4;
  }

  // Update guide line to next gate
  updateGuideLine(v, activeGate);

  // Finish flash effect
  if (finishFlashTimer > 0) {
    finishFlashTimer -= dt;
  }
}

export function getRaceState() {
  return {
    active: raceActive,
    lap, totalLaps,
    currentCP,
    totalCPs: checkpoints.length,
    lapTimer,
    raceTimer,
    bestLap: bestLap === Infinity ? 0 : bestLap,
  };
}

export function isRaceActive() {
  return raceActive;
}

export function resetRace() {
  raceActive = false;
  currentCP = 0;
  lap = 0;
  lapTimer = 0;
  raceTimer = 0;
  lapTimes = [];
  finishFlashTimer = 0;

  // Remove gate meshes
  for (const gate of gates) {
    if (gate.group && sceneRef) {
      sceneRef.remove(gate.group);
      gate.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
    }
  }
  gates.length = 0;
  checkpoints = [];

  // Remove guide line
  if (guideLine && sceneRef) {
    sceneRef.remove(guideLine);
    if (guideLine.geometry) guideLine.geometry.dispose();
    if (guideLineMat) guideLineMat.dispose();
    guideLine = null;
    guideLineMat = null;
  }
}

export function formatRaceTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

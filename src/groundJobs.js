import * as THREE from 'three';
import { getActiveVehicle } from './vehicleState.js';
import { showMessage } from './hud.js';
import { getTaxiwayNetwork } from './taxi.js';
import { saveBestScore, getBestScore } from './settings.js';
import { getGroundLevel } from './terrain.js';
import { createRingGate } from './raceMode.js';

// Job state
let jobState = {
  active: false,
  type: null,
  phase: null,
  timer: 0,
  score: 0,
  targetPos: null,
};

let elapsed = 0;
let phaseTimer = 0;
let baggageIndex = 0;
let emergencyTarget = null;

const GATE_IDS = ['gate_1', 'gate_2', 'gate_3', 'gate_4'];
const BAGGAGE_DELIVERIES = ['gate_1', 'gate_2', 'gate_3'];

const _tmpVec = new THREE.Vector3();

let sceneRef = null;

// Torus ring waypoint marker (consistent with race gates)
let waypointGate = null;

// Guide line from player to waypoint
let guideLine = null;
let guideLineMat = null;

// ---- helpers ----

function getNodePos(nodeId) {
  const net = getTaxiwayNetwork();
  const node = net.nodeMap[nodeId];
  if (!node) return null;
  // Sample terrain height correctly
  const y = getGroundLevel(node.x, node.z);
  return new THREE.Vector3(node.x, y, node.z);
}

function randomGate() {
  return GATE_IDS[Math.floor(Math.random() * GATE_IDS.length)];
}

function distToTarget(vehicle, target) {
  if (!vehicle || !target) return Infinity;
  _tmpVec.set(vehicle.position.x, 0, vehicle.position.z);
  const flatTarget = _tmpVec.clone();
  flatTarget.set(target.x, 0, target.z);
  return _tmpVec.distanceTo(flatTarget);
}

function bearingToTarget(vehicle, target) {
  if (!vehicle || !target) return 0;
  const dx = target.x - vehicle.position.x;
  const dz = target.z - vehicle.position.z;
  let angle = Math.atan2(dx, dz) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

function gradeFromTime(timeSec) {
  if (timeSec < 20) return 'S';
  if (timeSec < 30) return 'A';
  if (timeSec < 45) return 'B';
  if (timeSec < 60) return 'C';
  if (timeSec < 90) return 'D';
  return 'F';
}

function completeJob() {
  const timeSec = elapsed;
  const grade = gradeFromTime(timeSec);
  const timeMs = timeSec * 1000;
  const invertedScore = Math.max(0, 100000 - timeMs);
  const key = 'job_' + jobState.type;
  const isNewBest = saveBestScore(key, invertedScore);
  const bestRaw = getBestScore(key);
  const bestTime = ((100000 - bestRaw) / 1000).toFixed(1);

  showMessage(
    `Job Complete! Time: ${timeSec.toFixed(1)}s  Grade: ${grade}` +
    (isNewBest ? '  NEW BEST!' : `  Best: ${bestTime}s`)
  );

  jobState.phase = 'complete';
  jobState.active = false;
  jobState.score = invertedScore;
  hideWaypointGate();
  hideGuideLine();
}

function compassDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function getPhaseHint(type, phase, dist) {
  if (type === 'refuel') {
    if (phase === 'drive_to_gate') return dist < 10 ? 'ALMOST THERE - SLOW DOWN' : 'DRIVE TO GATE';
    if (phase === 'refueling') return 'REFUELING... HOLD POSITION';
  }
  if (type === 'baggage') {
    if (phase.startsWith('pickup')) return 'PICK UP BAGS AT APRON';
    if (phase.startsWith('deliver')) return 'DELIVER BAGS TO GATE';
  }
  if (type === 'pushback_job') {
    if (phase === 'drive_to_gate') return dist < 5 ? 'PARK BEHIND AIRCRAFT' : 'DRIVE TO GATE';
    if (phase === 'connecting') return 'CONNECTING TO AIRCRAFT...';
    if (phase === 'pushing') return 'PUSHING AIRCRAFT BACK...';
  }
  if (type === 'emergency') {
    return dist < 20 ? 'ALMOST AT CRASH SITE' : 'RESPOND TO CRASH';
  }
  return phase.toUpperCase();
}

// ---- Waypoint gate (torus ring on ground) ----

function showWaypointGate(scene, x, z) {
  hideWaypointGate();
  waypointGate = createRingGate(scene, x, z, 0, 1, 8, true);
  // Set to active cyan style
  if (waypointGate.torusMat) {
    waypointGate.torusMat.color.setHex(0x4fc3f7);
    waypointGate.torusMat.opacity = 0.8;
  }
  if (waypointGate.innerMat) {
    waypointGate.innerMat.color.setHex(0x4fc3f7);
    waypointGate.innerMat.opacity = 0.5;
  }
  if (waypointGate.numSprite) {
    waypointGate.numSprite.visible = false; // no number needed for single waypoints
  }
}

function moveWaypointGate(x, z) {
  if (!waypointGate) return;
  const groundY = getGroundLevel(x, z);
  waypointGate.group.position.set(x, groundY, z);
  waypointGate.x = x;
  waypointGate.z = z;
}

function hideWaypointGate() {
  if (waypointGate && waypointGate.group && sceneRef) {
    sceneRef.remove(waypointGate.group);
    waypointGate.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    waypointGate = null;
  }
}

// ---- Guide line ----

function createJobGuideLine(scene) {
  if (guideLine) return;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  guideLineMat = new THREE.LineDashedMaterial({
    color: 0x4fc3f7,
    dashSize: 6,
    gapSize: 3,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  guideLine = new THREE.Line(geo, guideLineMat);
  guideLine.computeLineDistances();
  guideLine.frustumCulled = false;
  scene.add(guideLine);
}

function updateJobGuideLine(vehicle, target) {
  if (!guideLine || !vehicle || !target) return;
  const pos = guideLine.geometry.attributes.position;
  pos.setXYZ(0, vehicle.position.x, vehicle.position.y + 1.5, vehicle.position.z);
  const gy = getGroundLevel(target.x, target.z);
  pos.setXYZ(1, target.x, gy + 1.5, target.z);
  pos.needsUpdate = true;
  guideLine.computeLineDistances();
  guideLine.visible = true;
}

function hideGuideLine() {
  if (guideLine) guideLine.visible = false;
}

function cleanupGuideLine() {
  if (guideLine && sceneRef) {
    sceneRef.remove(guideLine);
    if (guideLine.geometry) guideLine.geometry.dispose();
    if (guideLineMat) guideLineMat.dispose();
    guideLine = null;
    guideLineMat = null;
  }
}

// ---- public API ----

export function initGroundJobs(scene) {
  if (scene) {
    sceneRef = scene;
  }
  jobState = {
    active: false,
    type: null,
    phase: null,
    timer: 0,
    score: 0,
    targetPos: null,
  };
  elapsed = 0;
  phaseTimer = 0;
  baggageIndex = 0;
  emergencyTarget = null;
  hideWaypointGate();
  hideGuideLine();
}

export function resetGroundJobs() {
  hideWaypointGate();
  cleanupGuideLine();
  initGroundJobs();
}

export function getJobState() {
  return {
    active: jobState.active,
    type: jobState.type,
    phase: jobState.phase,
    timer: jobState.timer,
    score: jobState.score,
    targetPos: jobState.targetPos,
  };
}

export function isJobActive() {
  return jobState.active;
}

export function setEmergencyTarget(pos) {
  emergencyTarget = pos ? new THREE.Vector3(pos.x, 0, pos.z) : null;
}

export function startJob(jobType) {
  initGroundJobs();
  // Re-mark active since initGroundJobs resets it
  jobState.active = true;
  jobState.type = jobType;

  switch (jobType) {
    case 'refuel': {
      const gateId = randomGate();
      jobState.phase = 'drive_to_gate';
      jobState.targetPos = getNodePos(gateId);
      showMessage(`Refuel Job: Drive to ${gateId.replace('_', ' ')}`);
      break;
    }
    case 'baggage': {
      baggageIndex = 0;
      jobState.phase = 'pickup_1';
      jobState.targetPos = getNodePos('apron_mid');
      showMessage('Baggage Job: Pick up bags at apron');
      break;
    }
    case 'pushback_job': {
      const gateId = randomGate();
      jobState.phase = 'drive_to_gate';
      jobState.targetPos = getNodePos(gateId);
      showMessage(`Pushback Job: Drive to ${gateId.replace('_', ' ')}`);
      break;
    }
    case 'emergency': {
      jobState.phase = 'responding';
      jobState.targetPos = emergencyTarget || new THREE.Vector3(0, 0, 0);
      showMessage('EMERGENCY: Respond to crash site!');
      break;
    }
    default:
      jobState.active = false;
      showMessage('Unknown job type');
      return;
  }

  // Show waypoint ring at target
  if (sceneRef && jobState.targetPos) {
    showWaypointGate(sceneRef, jobState.targetPos.x, jobState.targetPos.z);
    createJobGuideLine(sceneRef);
  }
}

export function updateGroundJobs(dt) {
  if (!jobState.active) return;

  elapsed += dt;
  jobState.timer = elapsed;

  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const dist = distToTarget(vehicle, jobState.targetPos);
  const bearing = bearingToTarget(vehicle, jobState.targetPos);

  // Animate waypoint gate pulse (active cyan ring)
  if (waypointGate && waypointGate.torusMat) {
    const t = performance.now() * 0.004;
    const pulse = 0.6 + Math.sin(t) * 0.4;
    waypointGate.torusMat.opacity = pulse;
    waypointGate.innerMat.opacity = pulse * 0.5;
  }

  // Update guide line
  if (jobState.targetPos) {
    updateJobGuideLine(vehicle, jobState.targetPos);
  }

  // HUD guidance with compass direction and action hint
  if (jobState.targetPos && jobState.phase !== 'complete') {
    const dir = compassDir(bearing);
    const phaseHint = getPhaseHint(jobState.type, jobState.phase, dist);
    showMessage(`${phaseHint} | ${dist.toFixed(0)}m ${dir} | W/S=Drive A/D=Steer | ${elapsed.toFixed(0)}s`);
  }

  switch (jobState.type) {
    case 'refuel':
      updateRefuel(dt, dist);
      break;
    case 'baggage':
      updateBaggage(dt, dist);
      break;
    case 'pushback_job':
      updatePushback(dt, dist);
      break;
    case 'emergency':
      updateEmergency(dt, dist);
      break;
  }
}

// ---- job-specific updates ----

function updateRefuel(dt, dist) {
  switch (jobState.phase) {
    case 'drive_to_gate':
      if (dist < 8) {
        jobState.phase = 'refueling';
        phaseTimer = 0;
        showMessage('Refueling in progress... hold position');
      }
      break;
    case 'refueling':
      phaseTimer += dt;
      jobState.timer = elapsed;
      if (phaseTimer >= 8) {
        completeJob();
      }
      break;
  }
}

function updateBaggage(dt, dist) {
  const phaseNum = Math.floor(baggageIndex);
  const isPickup = jobState.phase.startsWith('pickup');
  const isDeliver = jobState.phase.startsWith('deliver');

  if (dist < 8) {
    if (isPickup) {
      // Transition to deliver
      const deliveryGate = BAGGAGE_DELIVERIES[phaseNum];
      jobState.phase = `deliver_${phaseNum + 1}`;
      jobState.targetPos = getNodePos(deliveryGate);
      showMessage(`Deliver bags to ${deliveryGate.replace('_', ' ')}`);
      // Move waypoint gate to new target
      if (jobState.targetPos) {
        moveWaypointGate(jobState.targetPos.x, jobState.targetPos.z);
      }
    } else if (isDeliver) {
      baggageIndex++;
      if (baggageIndex >= 3) {
        completeJob();
      } else {
        jobState.phase = `pickup_${baggageIndex + 1}`;
        jobState.targetPos = getNodePos('apron_mid');
        showMessage('Pick up next load at apron');
        if (jobState.targetPos) {
          moveWaypointGate(jobState.targetPos.x, jobState.targetPos.z);
        }
      }
    }
  }
}

function updatePushback(dt, dist) {
  switch (jobState.phase) {
    case 'drive_to_gate':
      if (dist < 6) {
        jobState.phase = 'connecting';
        phaseTimer = 0;
        showMessage('Connecting to aircraft... hold position');
      }
      break;
    case 'connecting':
      phaseTimer += dt;
      if (phaseTimer >= 3) {
        jobState.phase = 'pushing';
        phaseTimer = 0;
        showMessage('Pushing back aircraft...');
      }
      break;
    case 'pushing':
      phaseTimer += dt;
      if (phaseTimer >= 6) {
        completeJob();
      }
      break;
  }
}

function updateEmergency(dt, dist) {
  if (jobState.phase === 'responding' && dist < 12) {
    completeJob();
  }
}

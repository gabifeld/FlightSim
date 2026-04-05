// Challenge modes: Crosswind, Daily, Engine Out, Speed Run, Full Circuit, Cargo Run, Emergency Landing,
// Touch-and-Go, Precision Approach, Progressive Difficulty, Stunt
import * as THREE from 'three';
import { setWind, setTurbulence } from './weather.js';
import { getActiveVehicle } from './vehicleState.js';
import { AIRPORT2_X, AIRPORT2_Z, RUNWAY_LENGTH, RUNWAY_WIDTH, M_TO_FEET } from './constants.js';
import { saveBestScore, getBestScore } from './settings.js';
import { getNavReceiver } from './radio.js';
import { showChallengeStart, showLevelUp } from './celebrations.js';
import { scene } from './scene.js';

// ── State ──
let activeChallenge = null; // 'crosswind' | 'daily' | 'engine_out' | 'speedrun' | 'full_circuit' | 'cargo_run' | 'emergency_landing' | 'touch_and_go' | 'precision_approach' | 'progressive'
let challengeLevel = null;  // crosswind level string
let engineFailed = false;
let failAltitude = 0;       // AGL in meters for engine failure trigger
let prevAltitudeAGL = 9999; // track previous AGL to detect descending through threshold
let speedrunTimer = 0;
let speedrunRunning = false;
let speedrunFinished = false;
let speedrunTookOff = false;
let dailyParams = null;
let speedrunCallback = null;
let circuitPhase = null; // 'pushback' | 'taxi' | 'takeoff' | 'pattern' | 'landing' | 'taxi_in' | 'complete'
let circuitTimer = 0;
let circuitViolations = 0;
let cargoRunTimer = 0;
let cargoRunStarted = false;
let cargoRunFinished = false;
let emergencyLandingActive = false;

// ── Crosswind gust state ──
let crosswindBaseSpeed = 0;
let crosswindGustActive = false;
let crosswindGustTimer = 0;
let crosswindGustCooldown = 0;
let crosswindGustDuration = 0;

// ── Engine out fire warning state ──
let engineFireWarningTimer = 0;
let engineFireWarningShown = false;

// ── Daily par score ──
let dailyParScore = 0;

// ── Speedrun split state ──
let speedrunSplits = [null, null, null]; // departure, midpoint, approach
let speedrunSplitShownIdx = -1;

// ── Full circuit phase scoring ──
let circuitPhaseScores = {};
let circuitPhaseMessage = '';
let circuitPhaseMessageTimer = 0;

// ── Touch-and-Go state ──
let tagCount = 0;           // completed touch-and-gos
let tagScores = [];          // scores for each landing
let tagTimer = 0;
let tagWasAirborne = false;
let tagMessage = '';
let tagMessageTimer = 0;
let tagPhase = 'approach';   // 'approach' | 'go' | 'complete'

// ── Precision Approach state ──
let precisionSamples = [];       // ILS deviation samples
let precisionSampleTimer = 0;
let precisionTracking = true;
let precisionApproachScore = 0;
let precisionMessage = '';

// ── Progressive Difficulty state ──
let progressiveLevel = 0;
let progressiveComplete = false;
let progressiveMessage = '';
let progressiveMessageTimer = 0;
let progressiveWasOnGround = false;
let progressiveLandedTimer = 0;

// ── Stunt Challenge state ──
let stuntCurrentGate = 0;
let stuntScore = 0;
let stuntTimer = 0;
let stuntComplete = false;
let stuntMessage = '';
let stuntMessageTimer = 0;
let stuntGateObjects = [];   // THREE.js objects for gates
let stuntGuideLine = null;   // guide line between gates

const STUNT_GATES = [
  { x: 0, y: 300, z: -500, rx: 0, ry: 0, rz: 0, type: 'normal' },
  { x: 0, y: 500, z: -1000, rx: 0, ry: 0, rz: 0, type: 'normal' },
  { x: 0, y: 700, z: -1200, rx: Math.PI / 2, ry: 0, rz: 0, type: 'normal' },
  { x: 0, y: 500, z: -900, rx: Math.PI, ry: 0, rz: 0, type: 'inverted' },
  { x: 300, y: 350, z: -600, rx: 0, ry: 0, rz: Math.PI / 4, type: 'banked' },
  { x: 500, y: 300, z: -300, rx: 0, ry: Math.PI / 2, rz: 0, type: 'normal' },
  { x: 500, y: 400, z: 0, rx: 0, ry: 0, rz: -Math.PI / 4, type: 'banked' },
  { x: 300, y: 500, z: 300, rx: 0, ry: 0, rz: 0, type: 'normal' },
  { x: 0, y: 600, z: 500, rx: Math.PI / 2, ry: 0, rz: 0, type: 'normal' },
  { x: -300, y: 400, z: 300, rx: 0, ry: 0, rz: 0, type: 'normal' },
  { x: -300, y: 300, z: 0, rx: 0, ry: -Math.PI / 2, rz: 0, type: 'inverted' },
  { x: 0, y: 250, z: -200, rx: 0, ry: 0, rz: 0, type: 'normal' },
];

const STUNT_GATE_COLORS = {
  normal: 0x4fc3f7,
  inverted: 0xff5252,
  banked: 0xffb74d,
};

const PROGRESSIVE_LEVELS = [
  { wind: 0, turbulence: 0, weather: 'clear', engineFail: false, label: 'LEVEL 1 -- CALM CONDITIONS' },
  { wind: 4.1, turbulence: 0.15, weather: 'clear', engineFail: false, label: 'LEVEL 2 -- CROSSWIND 8KT' },
  { wind: 7.7, turbulence: 0.3, weather: 'overcast', engineFail: false, label: 'LEVEL 3 -- CROSSWIND 15KT + OVERCAST' },
  { wind: 11.3, turbulence: 0.4, weather: 'rain', engineFail: false, label: 'LEVEL 4 -- CROSSWIND 22KT + RAIN' },
  { wind: 15.4, turbulence: 0.55, weather: 'storm', engineFail: true, label: 'LEVEL 5 -- 30KT + STORM + ENGINE OUT' },
];

// ── Getters ──
export function getActiveChallenge() { return activeChallenge; }
export function getChallengeState() {
  return {
    type: activeChallenge,
    level: challengeLevel,
    engineFailed,
    speedrunTimer,
    speedrunRunning,
    speedrunFinished,
    dailyParams,
    dailyParScore,
    circuitPhase,
    circuitTimer,
    circuitViolations,
    circuitPhaseScores,
    circuitPhaseMessage,
    circuitPhaseMessageTimer,
    cargoRunTimer,
    cargoRunFinished,
    emergencyLandingActive,
    speedrunSplits,
    // Touch-and-Go
    tagCount,
    tagScores,
    tagTimer,
    tagMessage,
    tagMessageTimer,
    tagPhase,
    // Precision Approach
    precisionApproachScore,
    precisionMessage,
    precisionTracking,
    precisionSamples,
    // Progressive
    progressiveLevel,
    progressiveComplete,
    progressiveMessage,
    progressiveMessageTimer,
    // Engine fire warning
    engineFireWarningShown,
    engineFireWarningTimer,
    // Crosswind gust
    crosswindGustActive,
    // Stunt
    stuntCurrentGate,
    stuntScore,
    stuntTimer,
    stuntComplete,
    stuntMessage,
    stuntMessageTimer,
    stuntTotalGates: STUNT_GATES.length,
  };
}
export function isEngineFailed() { return engineFailed; }

export function setSpeedrunCallback(cb) { speedrunCallback = cb; }

export function getTouchAndGoState() {
  return { count: tagCount, scores: tagScores, timer: tagTimer, phase: tagPhase, message: tagMessage };
}

export function getPrecisionApproachScore() {
  return precisionApproachScore;
}

export function getProgressiveLevel() {
  return progressiveLevel;
}

export function resetChallenge() {
  activeChallenge = null;
  challengeLevel = null;
  engineFailed = false;
  failAltitude = 0;
  prevAltitudeAGL = 9999;
  speedrunTimer = 0;
  speedrunRunning = false;
  speedrunFinished = false;
  speedrunTookOff = false;
  dailyParams = null;
  dailyParScore = 0;
  circuitPhase = null;
  circuitTimer = 0;
  circuitViolations = 0;
  circuitPhaseScores = {};
  circuitPhaseMessage = '';
  circuitPhaseMessageTimer = 0;
  cargoRunTimer = 0;
  cargoRunStarted = false;
  cargoRunFinished = false;
  emergencyLandingActive = false;
  crosswindBaseSpeed = 0;
  crosswindGustActive = false;
  crosswindGustTimer = 0;
  crosswindGustCooldown = 0;
  crosswindGustDuration = 0;
  engineFireWarningTimer = 0;
  engineFireWarningShown = false;
  speedrunSplits = [null, null, null];
  speedrunSplitShownIdx = -1;
  tagCount = 0;
  tagScores = [];
  tagTimer = 0;
  tagWasAirborne = false;
  tagMessage = '';
  tagMessageTimer = 0;
  tagPhase = 'approach';
  precisionSamples = [];
  precisionSampleTimer = 0;
  precisionTracking = true;
  precisionApproachScore = 0;
  precisionMessage = '';
  progressiveLevel = 0;
  progressiveComplete = false;
  progressiveMessage = '';
  progressiveMessageTimer = 0;
  progressiveWasOnGround = false;
  progressiveLandedTimer = 0;
  // Stunt cleanup
  stuntCurrentGate = 0;
  stuntScore = 0;
  stuntTimer = 0;
  stuntComplete = false;
  stuntMessage = '';
  stuntMessageTimer = 0;
  cleanupStuntGates();
}

// ── Crosswind Challenge ──
const CROSSWIND_LEVELS = {
  light:    { speed: 4.1,  turbulence: 0.15 },
  moderate: { speed: 9.3,  turbulence: 0.35 },
  strong:   { speed: 15.4, turbulence: 0.55 },
};

export function startCrosswind(level) {
  resetChallenge();
  activeChallenge = 'crosswind';
  challengeLevel = level;
  const cfg = CROSSWIND_LEVELS[level] || CROSSWIND_LEVELS.moderate;
  crosswindBaseSpeed = cfg.speed;
  // Perpendicular to runway (runway is along Z axis, so wind from +X or -X = 90 deg crosswind)
  const windDir = Math.PI / 2; // from east (perpendicular)
  setWind(windDir, cfg.speed);
  setTurbulence(cfg.turbulence);
  // Start gust cooldown for first gust
  crosswindGustCooldown = 10 + Math.random() * 5; // 10-15s until first gust
  const levelNames = { light: 'Light 8kt', moderate: 'Moderate 18kt', strong: 'Strong 30kt' };
  showChallengeStart('CROSSWIND CHALLENGE', levelNames[level] || level);
}

// ── Daily Challenge ──
// Seeded PRNG: mulberry32
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function getDailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const DAILY_AIRCRAFT = ['cessna_172', 'boeing_737', 'f16', 'airbus_a320'];
const DAILY_APPROACHES = ['short_final', 'long_final'];

export function startDaily() {
  resetChallenge();
  activeChallenge = 'daily';

  const rng = mulberry32(getDailySeed());
  const aircraft = DAILY_AIRCRAFT[Math.floor(rng() * DAILY_AIRCRAFT.length)];
  const approach = DAILY_APPROACHES[Math.floor(rng() * DAILY_APPROACHES.length)];
  const windSpeed = 2 + rng() * 14;  // 2-16 m/s
  const windDir = rng() * Math.PI * 2;
  const hasEmergency = rng() < 0.3;
  const weatherRoll = rng();
  const isStorm = weatherRoll < 0.15;
  const isRain = weatherRoll < 0.35;
  const failAlt = hasEmergency ? (60 + rng() * 90) : 0; // 60-150m AGL (~200-500ft)

  setWind(windDir, windSpeed);
  setTurbulence(0.1 + rng() * 0.4);

  if (hasEmergency) {
    engineFailed = false;
    failAltitude = failAlt;
  }

  // Calculate par score
  const windKnots = Math.round(windSpeed * 1.94384);
  dailyParScore = Math.round(85 - (windKnots * 1.5) - (isStorm ? 10 : isRain ? 5 : 0) - (hasEmergency ? 15 : 0));
  dailyParScore = Math.max(10, dailyParScore); // floor at 10

  dailyParams = {
    seed: getDailySeed(),
    aircraft,
    approach,
    windSpeed: windKnots, // knots for display
    windDir: Math.round((windDir * 180 / Math.PI + 360) % 360),
    emergency: hasEmergency,
    failAlt: hasEmergency ? Math.round(failAlt * M_TO_FEET) : 0,
    parScore: dailyParScore,
    isStorm,
    isRain,
  };

  return dailyParams;
}

// ── Engine Out Challenge ──
export function startEngineOut() {
  resetChallenge();
  activeChallenge = 'engine_out';
  engineFailed = false;
  engineFireWarningShown = false;
  engineFireWarningTimer = 0;
  failAltitude = 60 + Math.random() * 90; // 60-150m AGL (~200-500ft), always below short_final spawn (152m)
  showChallengeStart('ENGINE OUT', 'Engine failure on approach');
}

// ── Speed Run ──
export function startSpeedrun() {
  resetChallenge();
  activeChallenge = 'speedrun';
  speedrunTimer = 0;
  speedrunRunning = false;
  speedrunFinished = false;
  speedrunTookOff = false;
  speedrunSplits = [null, null, null];
  speedrunSplitShownIdx = -1;
  showChallengeStart('SPEED RUN', 'Airport 1 → Airport 2');
}

// ── Full Circuit ──
export function startFullCircuit() {
  resetChallenge();
  activeChallenge = 'full_circuit';
  circuitPhase = 'pushback';
  circuitTimer = 0;
  circuitViolations = 0;
  circuitPhaseScores = {};
  circuitPhaseMessage = '';
  circuitPhaseMessageTimer = 0;
  showChallengeStart('FULL CIRCUIT', 'Gate to Gate');
}

// ── Cargo Run ──
export function startCargoRun() {
  resetChallenge();
  activeChallenge = 'cargo_run';
  cargoRunTimer = 0;
  cargoRunStarted = false;
  cargoRunFinished = false;
}

// ── Emergency Landing ──
export function startEmergencyLanding() {
  resetChallenge();
  activeChallenge = 'emergency_landing';
  emergencyLandingActive = true;
}

// ── Touch-and-Go ──
export function startTouchAndGo() {
  resetChallenge();
  activeChallenge = 'touch_and_go';
  tagCount = 0;
  tagScores = [];
  tagTimer = 0;
  tagWasAirborne = true; // spawning on final, already airborne
  tagMessage = 'TOUCH & GO: LAND AND TAKE OFF 3 TIMES';
  tagMessageTimer = 4;
  tagPhase = 'approach';
  showChallengeStart('TOUCH & GO', '3 Landings — Average Score');
}

// ── Precision Approach ──
export function startPrecisionApproach() {
  resetChallenge();
  activeChallenge = 'precision_approach';
  precisionSamples = [];
  precisionSampleTimer = 0;
  precisionTracking = true;
  precisionApproachScore = 0;
  precisionMessage = 'ILS TRACKING: ---';
  showChallengeStart('PRECISION APPROACH', 'ILS Tracking Score');
}

// ── Progressive Difficulty ──
export function startProgressive() {
  resetChallenge();
  activeChallenge = 'progressive';
  progressiveLevel = 0;
  progressiveComplete = false;
  progressiveWasOnGround = false;
  progressiveLandedTimer = 0;
  applyProgressiveLevel();
  showChallengeStart('PROGRESSIVE DIFFICULTY', 'Level 1 — Calm Conditions');
}

function applyProgressiveLevel() {
  const lvl = PROGRESSIVE_LEVELS[progressiveLevel];
  if (!lvl) return;
  const windDir = Math.PI / 2; // perpendicular crosswind
  setWind(windDir, lvl.wind);
  setTurbulence(lvl.turbulence);
  engineFailed = false;
  progressiveMessage = lvl.label;
  progressiveMessageTimer = 4;
  progressiveWasOnGround = false;
  progressiveLandedTimer = 0;
  if (lvl.engineFail) {
    // Engine fails at 150ft AGL for progressive level 5
    failAltitude = 45; // ~150ft
  } else {
    failAltitude = 0;
  }
}

// ── Stunt Challenge ──
function cleanupStuntGates() {
  for (const obj of stuntGateObjects) {
    if (obj && scene) {
      scene.remove(obj);
      obj.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
  }
  stuntGateObjects = [];
  if (stuntGuideLine && scene) {
    scene.remove(stuntGuideLine);
    if (stuntGuideLine.geometry) stuntGuideLine.geometry.dispose();
    if (stuntGuideLine.material) stuntGuideLine.material.dispose();
    stuntGuideLine = null;
  }
}

function createStuntGate(gateDef, index) {
  const color = STUNT_GATE_COLORS[gateDef.type] || 0x4fc3f7;
  const group = new THREE.Group();

  // Torus ring
  const torusGeo = new THREE.TorusGeometry(30, 1.5, 12, 48);
  const torusMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.8,
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  group.add(torus);

  // Inner glow ring (thinner, brighter)
  const innerGeo = new THREE.TorusGeometry(28, 0.5, 8, 48);
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.4,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  group.add(inner);

  // Position and rotate
  group.position.set(gateDef.x, gateDef.y, gateDef.z);
  group.rotation.set(gateDef.rx, gateDef.ry, gateDef.rz);

  group.userData = { index, type: gateDef.type, torusMat, innerMat, color };
  return group;
}

function updateStuntGuideLine() {
  // Remove old guide line
  if (stuntGuideLine && scene) {
    scene.remove(stuntGuideLine);
    if (stuntGuideLine.geometry) stuntGuideLine.geometry.dispose();
    if (stuntGuideLine.material) stuntGuideLine.material.dispose();
    stuntGuideLine = null;
  }

  if (stuntComplete || stuntCurrentGate >= STUNT_GATES.length) return;

  const points = [];
  const cur = STUNT_GATES[stuntCurrentGate];
  points.push(new THREE.Vector3(cur.x, cur.y, cur.z));

  if (stuntCurrentGate + 1 < STUNT_GATES.length) {
    const next = STUNT_GATES[stuntCurrentGate + 1];
    points.push(new THREE.Vector3(next.x, next.y, next.z));
  }

  if (points.length >= 2) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({
      color: 0x4fc3f7,
      dashSize: 10,
      gapSize: 10,
      transparent: true,
      opacity: 0.4,
    });
    stuntGuideLine = new THREE.Line(geo, mat);
    stuntGuideLine.computeLineDistances();
    scene.add(stuntGuideLine);
  }
}

function highlightStuntGates() {
  for (const obj of stuntGateObjects) {
    const ud = obj.userData;
    const isActive = ud.index === stuntCurrentGate;
    const isPassed = ud.index < stuntCurrentGate;

    if (isPassed) {
      ud.torusMat.emissiveIntensity = 0.05;
      ud.torusMat.opacity = 0.2;
      ud.innerMat.opacity = 0.1;
    } else if (isActive) {
      ud.torusMat.emissiveIntensity = 1.0;
      ud.torusMat.opacity = 1.0;
      ud.innerMat.emissiveIntensity = 1.2;
      ud.innerMat.opacity = 0.7;
    } else {
      ud.torusMat.emissiveIntensity = 0.3;
      ud.torusMat.opacity = 0.6;
      ud.innerMat.opacity = 0.3;
    }
  }
}

export function startStunt() {
  resetChallenge();
  activeChallenge = 'stunt';
  stuntCurrentGate = 0;
  stuntScore = 0;
  stuntTimer = 0;
  stuntComplete = false;
  stuntMessage = 'FLY THROUGH ALL GATES -- BONUS FOR STYLE';
  stuntMessageTimer = 4;

  // Build gate visuals
  if (scene) {
    for (let i = 0; i < STUNT_GATES.length; i++) {
      const gate = createStuntGate(STUNT_GATES[i], i);
      scene.add(gate);
      stuntGateObjects.push(gate);
    }
    highlightStuntGates();
    updateStuntGuideLine();
  }

  showChallengeStart('STUNT CHALLENGE', '12 Gates -- Bonus for Style');
}

export function addCircuitViolation() {
  circuitViolations++;
}

// Determine which airport the position is near (1, 2, or 0 for neither)
function whichAirport(x, z) {
  const rwyHalf = RUNWAY_LENGTH / 2 + 200; // extra margin for rollout past runway end
  const rwyW = RUNWAY_WIDTH * 5; // generous lateral detection zone
  // Airport 1 at origin
  if (Math.abs(x) < rwyW && z > -rwyHalf && z < rwyHalf) return 1;
  // Airport 2
  if (Math.abs(x - AIRPORT2_X) < rwyW && (z - AIRPORT2_Z) > -rwyHalf && (z - AIRPORT2_Z) < rwyHalf) return 2;
  return 0;
}

// ── Format time as M:SS.s ──
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// ── Speedrun split markers ──
// Split 0: Airport 1 departure (z > RUNWAY_LENGTH/2 + 200, airborne)
// Split 1: Midpoint between airports (halfway between origin and APT2)
// Split 2: Airport 2 approach (within 3000m of APT2)
const MIDPOINT_X = AIRPORT2_X / 2;
const MIDPOINT_Z = AIRPORT2_Z / 2;

function checkSpeedrunSplits(state) {
  if (!speedrunRunning || speedrunFinished) return;

  // Split 0: Departed Airport 1 zone
  if (speedrunSplits[0] === null && !state.onGround) {
    const distFromOrigin = Math.sqrt(state.position.x * state.position.x + state.position.z * state.position.z);
    if (distFromOrigin > RUNWAY_LENGTH / 2 + 500) {
      speedrunSplits[0] = speedrunTimer;
    }
  }

  // Split 1: Passed midpoint
  if (speedrunSplits[0] !== null && speedrunSplits[1] === null) {
    const dx = state.position.x - MIDPOINT_X;
    const dz = state.position.z - MIDPOINT_Z;
    const distFromMid = Math.sqrt(dx * dx + dz * dz);
    if (distFromMid < 2000) {
      speedrunSplits[1] = speedrunTimer;
    }
  }

  // Split 2: Approaching Airport 2
  if (speedrunSplits[1] !== null && speedrunSplits[2] === null) {
    const dx = state.position.x - AIRPORT2_X;
    const dz = state.position.z - AIRPORT2_Z;
    const distFromApt2 = Math.sqrt(dx * dx + dz * dz);
    if (distFromApt2 < 3000) {
      speedrunSplits[2] = speedrunTimer;
    }
  }
}

// ── Full circuit phase scoring helpers ──
const CIRCUIT_PHASE_ORDER = ['pushback', 'taxi', 'takeoff', 'pattern', 'landing', 'taxi_in'];
const CIRCUIT_PHASE_LABELS = {
  pushback: 'PUSHBACK',
  taxi: 'TAXI OUT',
  takeoff: 'TAKEOFF',
  pattern: 'PATTERN',
  landing: 'LANDING',
  taxi_in: 'TAXI IN',
};
const CIRCUIT_PHASE_BONUS = 5; // bonus points per phase completed

function scoreCircuitPhase(phase, timer) {
  // Time-based scoring: faster = better, max 100 per phase
  const targets = { pushback: 15, taxi: 30, takeoff: 15, pattern: 60, landing: 20, taxi_in: 30 };
  const target = targets[phase] || 30;
  const score = Math.max(0, Math.round(100 - Math.max(0, timer - target) * 2));
  return score + CIRCUIT_PHASE_BONUS;
}

// ── Per-frame update ──
export function updateChallenge(dt) {
  if (!activeChallenge) return;

  const state = getActiveVehicle();

  // ── Crosswind gust logic ──
  if (activeChallenge === 'crosswind' && crosswindBaseSpeed > 0) {
    if (crosswindGustActive) {
      crosswindGustTimer -= dt;
      if (crosswindGustTimer <= 0) {
        // End gust, return to base speed
        crosswindGustActive = false;
        setWind(Math.PI / 2, crosswindBaseSpeed);
        crosswindGustCooldown = 10 + Math.random() * 5; // 10-15s until next gust
      }
    } else {
      crosswindGustCooldown -= dt;
      if (crosswindGustCooldown <= 0) {
        // Start a gust: +50% speed for 2-3 seconds
        crosswindGustActive = true;
        crosswindGustDuration = 2 + Math.random();
        crosswindGustTimer = crosswindGustDuration;
        const gustSpeed = crosswindBaseSpeed * 1.5;
        setWind(Math.PI / 2, gustSpeed);
        const gustTurb = (CROSSWIND_LEVELS[challengeLevel] || CROSSWIND_LEVELS.moderate).turbulence;
        setTurbulence(gustTurb * 1.3); // also bump turbulence during gust
      }
    }
  }

  // ── Engine failure trigger (daily + engine_out + progressive) ──
  // Engine out: show fire warning 2s before failure
  if (activeChallenge === 'engine_out' && !engineFailed && failAltitude > 0) {
    if (!state.onGround) {
      // Fire warning triggers slightly before the actual failure altitude (add ~20m buffer)
      const warningAlt = failAltitude + 20;
      if (!engineFireWarningShown && prevAltitudeAGL > warningAlt && state.altitudeAGL <= warningAlt) {
        engineFireWarningShown = true;
        engineFireWarningTimer = 2.0; // 2 second warning
      }
      if (engineFireWarningShown && engineFireWarningTimer > 0) {
        engineFireWarningTimer -= dt;
        if (engineFireWarningTimer <= 0) {
          // Now kill the engine
          engineFailed = true;
          state.throttle = 0;
          engineFireWarningTimer = 0;
        }
      }
    }
    prevAltitudeAGL = state.altitudeAGL;
  }

  // Daily challenge engine failure (no fire warning, direct fail)
  if (activeChallenge === 'daily' && !engineFailed && failAltitude > 0) {
    if (!state.onGround && prevAltitudeAGL > failAltitude && state.altitudeAGL <= failAltitude) {
      engineFailed = true;
      state.throttle = 0;
    }
    prevAltitudeAGL = state.altitudeAGL;
  }

  // Progressive engine failure
  if (activeChallenge === 'progressive' && !engineFailed && failAltitude > 0) {
    if (!state.onGround && prevAltitudeAGL > failAltitude && state.altitudeAGL <= failAltitude) {
      engineFailed = true;
      state.throttle = 0;
    }
    prevAltitudeAGL = state.altitudeAGL;
  }

  // ── Speedrun split message timer ──
  // (show split times briefly)
  if (activeChallenge === 'speedrun' && speedrunRunning) {
    checkSpeedrunSplits(state);
  }

  // Full circuit logic
  if (activeChallenge === 'full_circuit') {
    circuitTimer += dt;

    // Phase message timer
    if (circuitPhaseMessageTimer > 0) {
      circuitPhaseMessageTimer -= dt;
      if (circuitPhaseMessageTimer <= 0) {
        circuitPhaseMessage = '';
      }
    }

    const prevPhase = circuitPhase;

    // Phase auto-transitions based on state
    if (circuitPhase === 'pushback' && state.speed > 1) circuitPhase = 'taxi';
    if (circuitPhase === 'taxi' && !state.onGround) circuitPhase = 'takeoff';
    if (circuitPhase === 'takeoff' && state.altitude > 100) circuitPhase = 'pattern';
    if (circuitPhase === 'pattern' && state.onGround) circuitPhase = 'landing';
    if (circuitPhase === 'landing' && state.speed < 5) circuitPhase = 'taxi_in';

    // Score phase on transition
    if (prevPhase !== circuitPhase && prevPhase && prevPhase !== 'complete') {
      const phaseTime = circuitTimer; // cumulative, but we track per-phase via message
      const phaseScore = scoreCircuitPhase(prevPhase, circuitTimer);
      circuitPhaseScores[prevPhase] = phaseScore;
      const label = CIRCUIT_PHASE_LABELS[prevPhase] || prevPhase.toUpperCase();
      circuitPhaseMessage = `PHASE COMPLETE: ${label} \u2713 (+${phaseScore}pts)`;
      circuitPhaseMessageTimer = 3;
    }

    // Complete when near gate
    if (circuitPhase === 'taxi_in' && state.speed < 2) {
      if (state.position.x > 300 && Math.abs(state.position.z) < 100) {
        circuitPhase = 'complete';
        // Score final phase
        const finalScore = scoreCircuitPhase('taxi_in', circuitTimer);
        circuitPhaseScores['taxi_in'] = finalScore;
        const timePenalty = circuitViolations * 10;
        const finalTime = circuitTimer + timePenalty;
        const key = 'circuit_' + state.currentType;
        const invertedScore = Math.max(0, 100000 - Math.round(finalTime * 1000));
        saveBestScore(key, invertedScore);
        circuitPhaseMessage = 'CIRCUIT COMPLETE!';
        circuitPhaseMessageTimer = 10;
        if (speedrunCallback) speedrunCallback(finalTime);
      }
    }
  }

  // Cargo run logic
  if (activeChallenge === 'cargo_run') {
    if (!cargoRunStarted && !state.onGround) {
      cargoRunStarted = true;
    }
    if (cargoRunStarted && !cargoRunFinished) {
      cargoRunTimer += dt;
      // Detect landing at Airport 2
      if (state.onGround && state.speed < 5) {
        const apt = whichAirport(state.position.x, state.position.z);
        if (apt === 2) {
          cargoRunFinished = true;
          const key = 'cargo_run_' + state.currentType;
          const invertedScore = Math.max(0, 100000 - Math.round(cargoRunTimer * 1000));
          saveBestScore(key, invertedScore);
          if (speedrunCallback) speedrunCallback(cargoRunTimer);
        }
      }
    }
  }

  // Emergency landing logic
  if (activeChallenge === 'emergency_landing') {
    if (emergencyLandingActive && !state.onGround) {
      // Engine already failed (set at spawn)
      engineFailed = true;
      state.throttle = 0;
    }
    if (emergencyLandingActive && state.onGround && state.speed < 5) {
      emergencyLandingActive = false;
      // Check if on any runway
      const apt = whichAirport(state.position.x, state.position.z);
      if (apt > 0) {
        if (speedrunCallback) speedrunCallback(0); // survival is the score
      }
    }
  }

  // Speed run logic
  if (activeChallenge === 'speedrun') {
    // Detect takeoff from Airport 1
    if (!speedrunTookOff && !state.onGround) {
      speedrunTookOff = true;
      speedrunRunning = true;
    }

    // Timer
    if (speedrunRunning && !speedrunFinished) {
      speedrunTimer += dt;
    }

    // Detect landing at Airport 2
    if (speedrunTookOff && !speedrunFinished && state.onGround && state.speed < 5) {
      const apt = whichAirport(state.position.x, state.position.z);
      if (apt === 2) {
        speedrunFinished = true;
        speedrunRunning = false;
        // Save best time via saveBestScore (inverted: 100000 - ms so higher = faster = better)
        const timeMs = Math.round(speedrunTimer * 1000);
        const key = 'speedrun_' + state.currentType;
        const invertedScore = Math.max(0, 100000 - timeMs);
        saveBestScore(key, invertedScore);
        if (speedrunCallback) {
          speedrunCallback(speedrunTimer);
        }
      }
    }
  }

  // ── Touch-and-Go logic ──
  if (activeChallenge === 'touch_and_go') {
    tagTimer += dt;

    // Message timer
    if (tagMessageTimer > 0) {
      tagMessageTimer -= dt;
      if (tagMessageTimer <= 0) {
        tagMessage = '';
      }
    }

    if (tagPhase !== 'complete') {
      // Detect touchdown
      if (tagWasAirborne && state.onGround) {
        tagCount++;
        // Score this landing based on vertical speed
        const vs = Math.abs(state.velocity ? state.velocity.y : 0);
        const vsFPM = vs * 196.85; // MS_TO_FPM
        let score;
        if (vsFPM < 60) score = 100;
        else if (vsFPM < 120) score = 90;
        else if (vsFPM < 200) score = 75;
        else if (vsFPM < 350) score = 55;
        else score = 30;
        tagScores.push(score);

        if (tagCount >= 3) {
          tagPhase = 'complete';
          const avgScore = Math.round(tagScores.reduce((a, b) => a + b, 0) / tagScores.length);
          tagMessage = `TOUCH & GO COMPLETE! AVG SCORE: ${avgScore} | TIME: ${formatTime(tagTimer)}`;
          tagMessageTimer = 10;
          const key = 'touch_and_go_' + state.currentType;
          saveBestScore(key, avgScore);
          if (speedrunCallback) speedrunCallback(tagTimer);
        } else {
          tagPhase = 'go';
          tagMessage = `TOUCH ${tagCount}/3 -- GO! (Score: ${score})`;
          tagMessageTimer = 3;
        }
        tagWasAirborne = false;
      }

      // Detect becoming airborne again after go
      if (tagPhase === 'go' && !state.onGround) {
        tagWasAirborne = true;
        tagPhase = 'approach';
      }

      // Also track if airborne on approach phase
      if (tagPhase === 'approach' && !state.onGround) {
        tagWasAirborne = true;
      }
    }
  }

  // ── Precision Approach logic ──
  if (activeChallenge === 'precision_approach') {
    if (precisionTracking && !state.onGround) {
      const altFt = (state.altitudeAGL || 0) * M_TO_FEET;

      // Sample ILS deviation every second from 1000ft to touchdown
      if (altFt <= 1000 && altFt > 5) {
        precisionSampleTimer += dt;
        if (precisionSampleTimer >= 1.0) {
          precisionSampleTimer -= 1.0;
          // Get NAV1 receiver for ILS data
          const nav1 = getNavReceiver(0);
          if (nav1 && nav1.receiving && nav1.hasGlideslope) {
            const locDev = Math.abs(nav1.cdiDeflection); // 0-1 dots
            const gsDev = Math.abs(nav1.gsDeflection);   // 0-1 dots
            const totalDev = (locDev + gsDev) / 2;       // average deviation in dots
            precisionSamples.push(totalDev);
          }
        }
      }

      // Calculate running approach score for HUD display
      if (precisionSamples.length > 0) {
        const avgDev = precisionSamples.reduce((a, b) => a + b, 0) / precisionSamples.length;
        precisionApproachScore = Math.max(0, Math.round(100 - avgDev * 20));
        precisionMessage = `ILS TRACKING: ${precisionApproachScore}%`;
      } else {
        precisionMessage = 'ILS TRACKING: ---';
      }
    }

    // Detect landing
    if (precisionTracking && state.onGround && state.speed < 80) {
      precisionTracking = false;
      // Final approach score calculation
      if (precisionSamples.length > 0) {
        const avgDev = precisionSamples.reduce((a, b) => a + b, 0) / precisionSamples.length;
        precisionApproachScore = Math.max(0, Math.round(100 - avgDev * 20));
      }
      precisionMessage = `APPROACH SCORE: ${precisionApproachScore}% (${precisionSamples.length} samples)`;
    }
  }

  // ── Progressive Difficulty logic ──
  if (activeChallenge === 'progressive' && !progressiveComplete) {
    // Message timer
    if (progressiveMessageTimer > 0) {
      progressiveMessageTimer -= dt;
      if (progressiveMessageTimer <= 0 && !progressiveComplete) {
        progressiveMessage = PROGRESSIVE_LEVELS[progressiveLevel]
          ? PROGRESSIVE_LEVELS[progressiveLevel].label
          : '';
      }
    }

    // Detect successful landing
    if (!progressiveWasOnGround && state.onGround && state.speed < 30) {
      progressiveWasOnGround = true;
      progressiveLandedTimer = 0;
    }

    if (progressiveWasOnGround && state.onGround) {
      progressiveLandedTimer += dt;
      // Confirm landing after 2 seconds of being on ground below 5 m/s
      if (state.speed < 5 && progressiveLandedTimer > 1.5) {
        const apt = whichAirport(state.position.x, state.position.z);
        if (apt > 0) {
          progressiveLevel++;
          if (progressiveLevel >= PROGRESSIVE_LEVELS.length) {
            progressiveComplete = true;
            progressiveMessage = `ALL 5 LEVELS COMPLETE! CONGRATULATIONS!`;
            progressiveMessageTimer = 10;
            const key = 'progressive_' + state.currentType;
            saveBestScore(key, progressiveLevel * 20); // 100 points for all 5
            if (speedrunCallback) speedrunCallback(0);
          } else {
            // Apply next level conditions
            applyProgressiveLevel();
            const lvl = PROGRESSIVE_LEVELS[progressiveLevel];
            progressiveMessage = lvl.label;
            progressiveMessageTimer = 4;
            showLevelUp(progressiveLevel + 1, lvl.label);
            // Signal respawn on short final (handled by gameState/controls checking progressive state)
            progressiveWasOnGround = false;
            progressiveLandedTimer = 0;
          }
        }
      }
    }

    // Reset ground detection when airborne
    if (!state.onGround) {
      progressiveWasOnGround = false;
      progressiveLandedTimer = 0;
    }
  }

  // ── Stunt Challenge logic ──
  if (activeChallenge === 'stunt' && !stuntComplete) {
    stuntTimer += dt;

    // Message timer
    if (stuntMessageTimer > 0) {
      stuntMessageTimer -= dt;
      if (stuntMessageTimer <= 0) {
        stuntMessage = '';
      }
    }

    // Pulse the active gate
    if (stuntCurrentGate < stuntGateObjects.length) {
      const activeObj = stuntGateObjects[stuntCurrentGate];
      const pulse = 1.0 + Math.sin(performance.now() * 0.006) * 0.5;
      activeObj.userData.torusMat.emissiveIntensity = pulse;
    }

    // Check if aircraft is within gate radius
    if (stuntCurrentGate < STUNT_GATES.length && !state.onGround) {
      const gate = STUNT_GATES[stuntCurrentGate];
      const dx = state.position.x - gate.x;
      const dy = (state.altitude || state.position.y) - gate.y;
      const dz = state.position.z - gate.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < 30) {
        // Gate passed! Calculate score
        let gateScore = 100;
        let bonusText = '';

        // Check type compliance for bonus
        const roll = state.rotation ? state.rotation.z : 0;
        const absRoll = Math.abs(roll);

        if (gate.type === 'inverted') {
          // Must be roughly upside down (roll > 120 deg = 2.09 rad)
          if (absRoll > 2.09) {
            gateScore += 50;
            bonusText = ' +INVERTED BONUS!';
          }
        } else if (gate.type === 'banked') {
          // Must be banked > 45 deg = 0.785 rad
          if (absRoll > 0.785) {
            gateScore += 50;
            bonusText = ' +BANK BONUS!';
          }
        }

        stuntScore += gateScore;
        stuntCurrentGate++;

        if (stuntCurrentGate >= STUNT_GATES.length) {
          // All gates passed — complete!
          stuntComplete = true;
          // Time bonus
          let timeBonus = 0;
          if (stuntTimer < 90) {
            timeBonus = Math.round((90 - stuntTimer) * 2);
            stuntScore += timeBonus;
          }
          stuntMessage = `STUNT COMPLETE! SCORE: ${stuntScore} | TIME: ${formatTime(stuntTimer)}${timeBonus > 0 ? ' | TIME BONUS: +' + timeBonus : ''}`;
          stuntMessageTimer = 10;
          const key = 'stunt_' + state.currentType;
          saveBestScore(key, stuntScore);
          if (speedrunCallback) speedrunCallback(stuntTimer);
        } else {
          stuntMessage = `GATE ${stuntCurrentGate}/${STUNT_GATES.length} -- +${gateScore}${bonusText}`;
          stuntMessageTimer = 2;
          highlightStuntGates();
          updateStuntGuideLine();
        }
      }
    }
  }
}

// ── Score keys for challenge-specific leaderboards ──
export function getCrosswindScoreKey(aircraftType, level) {
  return 'crosswind_' + level + '_' + aircraftType;
}

export function getDailyScoreKey(aircraftType) {
  return 'daily_' + getDailySeed() + '_' + aircraftType;
}

export function getEngineOutScoreKey(aircraftType) {
  return 'engine_out_' + aircraftType;
}

export function getBestSpeedrunTime(aircraftType) {
  const inverted = getBestScore('speedrun_' + aircraftType);
  return inverted > 0 ? (100000 - inverted) / 1000 : 0;
}

// Challenge modes: Crosswind, Daily, Engine Out, Speed Run
import { setWind, setTurbulence } from './weather.js';
import { getActiveVehicle } from './vehicleState.js';
import { AIRPORT2_X, AIRPORT2_Z, RUNWAY_LENGTH, RUNWAY_WIDTH, M_TO_FEET } from './constants.js';
import { saveBestScore, getBestScore } from './settings.js';

// ── State ──
let activeChallenge = null; // 'crosswind' | 'daily' | 'engine_out' | 'speedrun'
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
  };
}
export function isEngineFailed() { return engineFailed; }

export function setSpeedrunCallback(cb) { speedrunCallback = cb; }

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
  // Perpendicular to runway (runway is along Z axis, so wind from +X or -X = 90 deg crosswind)
  const windDir = Math.PI / 2; // from east (perpendicular)
  setWind(windDir, cfg.speed);
  setTurbulence(cfg.turbulence);
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
  const failAlt = hasEmergency ? (30 + rng() * 90) : 0; // 30-120m AGL (~100-400ft), below spawn altitude

  setWind(windDir, windSpeed);
  setTurbulence(0.1 + rng() * 0.4);

  if (hasEmergency) {
    engineFailed = false;
    failAltitude = failAlt;
  }

  dailyParams = {
    seed: getDailySeed(),
    aircraft,
    approach,
    windSpeed: Math.round(windSpeed * 1.94384), // knots for display
    windDir: Math.round((windDir * 180 / Math.PI + 360) % 360),
    emergency: hasEmergency,
    failAlt: hasEmergency ? Math.round(failAlt * M_TO_FEET) : 0,
  };

  return dailyParams;
}

// ── Engine Out Challenge ──
export function startEngineOut() {
  resetChallenge();
  activeChallenge = 'engine_out';
  engineFailed = false;
  failAltitude = 30 + Math.random() * 90; // 30-120m AGL (~100-400ft), always below short_final spawn (152m)
}

// ── Speed Run ──
export function startSpeedrun() {
  resetChallenge();
  activeChallenge = 'speedrun';
  speedrunTimer = 0;
  speedrunRunning = false;
  speedrunFinished = false;
  speedrunTookOff = false;
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

// ── Per-frame update ──
export function updateChallenge(dt) {
  if (!activeChallenge) return;

  const state = getActiveVehicle();

  // Engine failure trigger (daily + engine_out)
  // Only triggers when descending through the threshold (was above, now at or below)
  if ((activeChallenge === 'engine_out' || activeChallenge === 'daily') && !engineFailed && failAltitude > 0) {
    if (!state.onGround && prevAltitudeAGL > failAltitude && state.altitudeAGL <= failAltitude) {
      engineFailed = true;
      state.throttle = 0;
    }
    prevAltitudeAGL = state.altitudeAGL;
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

import { resetAircraft, hideAircraftModel } from './aircraft.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { triggerCrash } from './crashFx.js';
import { startCrashCamera } from './camera.js';
import { isOnRunway } from './runway.js';
import { isInOcean } from './terrain.js';
import { showMessage, clearMessage, showLandingScore, hideLandingScore } from './hud.js';
import { preLandingVS } from './physics.js';
import { playTouchdownSound, playCrashSound, playExplosion } from './audio.js';
import { triggerLandingShake } from './camera.js';
import { triggerTireSmoke, triggerDustCloud } from './particles.js';
import {
  isLandingMode,
  recordTouchdown,
  resetLandingMode,
  disableLandingAssist,
} from './landing.js';
import {
  TAKEOFF_SPEED,
  MAX_LANDING_VS,
  MAX_LANDING_SPEED,
  MS_TO_FPM,
  MS_TO_KNOTS,
  RUNWAY_WIDTH,
} from './constants.js';
import { getActiveChallenge, getChallengeState, getCrosswindScoreKey, getDailyScoreKey, getEngineOutScoreKey, getPrecisionApproachScore } from './challenges.js';
import { triggerEmergencyResponse } from './groundVehicleAI.js';
import { saveBestScore, getBestScore } from './settings.js';
import { addXP, recordFlight, recordAirportVisit } from './career.js';
import { checkAchievement } from './achievements.js';
import { getCurrentPreset } from './weatherFx.js';
import { getTimeOfDay } from './scene.js';
import { showChallengeComplete, showRankUp, showMilestone } from './celebrations.js';
import { getCarrierDeckHeight } from './aircraftCarrier.js';

// Airport positions and runway orientations for landing detection
const AIRPORT_DATA = [
  { x: 0,      z: 0,      heading: 360 }, // KFSA
  { x: 8000,   z: -8000,  heading: 360 }, // KFSB
  { x: -8000,  z: 8000,   heading: 90  }, // KFSI (E-W)
  { x: -5000,  z: -10000, heading: 360 }, // KFSM
  { x: 15000,  z: 5000,   heading: 360 }, // KFSG
  { x: -3000,  z: -18000, heading: 90  }, // KFSC (E-W)
];

function isNearAnyAirport(x, z) {
  const AIRPORT_ZONE_RADIUS = 500;
  for (const ap of AIRPORT_DATA) {
    const dx = x - ap.x;
    const dz = z - ap.z;
    if (dx * dx + dz * dz < AIRPORT_ZONE_RADIUS * AIRPORT_ZONE_RADIUS) {
      return true;
    }
  }
  return false;
}

function getNearestRunwayCenterlineDev(x, z) {
  let minDev = Infinity;
  for (const ap of AIRPORT_DATA) {
    let dev;
    if (ap.heading === 90 || ap.heading === 270) {
      // E-W runway: deviation is distance from airport's Z axis
      dev = Math.abs(z - ap.z);
    } else {
      // N-S runway: deviation is distance from airport's X axis
      dev = Math.abs(x - ap.x);
    }
    if (dev < minDev) {
      minDev = dev;
    }
  }
  return minDev;
}

export const FlightState = {
  GROUNDED: 'GROUNDED',
  TAKEOFF_ROLL: 'TAKEOFF_ROLL',
  AIRBORNE: 'AIRBORNE',
  CRASHED: 'CRASHED',
};

let currentState = FlightState.GROUNDED;
let wasAirborne = false;
let airborneTime = 0; // how long we've been continuously airborne
let messageTimer = 0;
let landingProcessed = false; // one-shot flag: true after a landing is scored, reset on takeoff
let consecutiveLandings = 0;
let consecutiveButters = 0;

export function getCurrentState() {
  return currentState;
}

export function resetState() {
  resetAircraft();
  currentState = FlightState.GROUNDED;
  wasAirborne = false;
  airborneTime = 0;
  landingProcessed = false;
  messageTimer = 0;
  clearMessage();
  hideLandingScore();
  disableLandingAssist();

  if (isLandingMode()) {
    resetLandingMode();
    // If approach spawn, start airborne — but DON'T set wasAirborne here.
    // Let the normal AIRBORNE detection in updateGameState handle it after
    // the aircraft has been flying for at least 2 seconds.
    if (!getActiveVehicle().onGround) {
      currentState = FlightState.AIRBORNE;
    }
  }
}

export function updateGameState(dt) {
  const state = getActiveVehicle();

  // Clear timed messages
  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) {
      clearMessage();
    }
  }

  // Non-aircraft vehicles: always grounded, no crash/landing logic
  if (!isAircraft(state)) {
    currentState = FlightState.GROUNDED;
    return currentState;
  }

  if (currentState === FlightState.CRASHED) {
    return currentState;
  }

  // Track airborne time — only allow landing detection after being airborne for 2+ seconds
  if (!state.onGround) {
    airborneTime += dt;
  }

  // Check ground transitions — requires:
  // 1. wasAirborne (set after 2s of flight)
  // 2. Not already processed this landing
  // 3. Aircraft speed > 10 m/s (prevents scoring while stationary/taxiing)
  if (state.onGround && wasAirborne && !landingProcessed && state.speed > 10) {
    const vs = Math.abs(preLandingVS);
    const onRwy = isOnRunway(state.position.x, state.position.z);

    const onWater = isInOcean(state.position.x, state.position.z);
    const isSeaplane = state.config && state.config.isSeaplane;

    // Seaplane on water: always succeed — no crash possible
    if (onWater && isSeaplane) {
      currentState = FlightState.GROUNDED;
      playTouchdownSound(Math.min(vs, 2));
      triggerLandingShake(Math.min(vs, 1.5));
      showTimedMessage('WATER LANDING', 3);
      wasAirborne = false;

      // Career & achievement hooks for water landing
      consecutiveLandings++;
      recordFlight();
      addXP(50, 'landing'); // flat XP for water landings (no score object)
      checkAchievement('first_flight');
      checkAchievement('sea_legs');
      const tod = getTimeOfDay();
      if (tod > 22 || tod < 4) checkAchievement('night_owl');
      if (getCurrentPreset() === 'storm') checkAchievement('storm_rider');
      if (consecutiveLandings >= 10) checkAchievement('iron_pilot');

      return currentState;
    }

    if (!state.gear) {
      crash('GEAR UP LANDING - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(3);
      if (isLandingMode()) {
        recordTouchdown(preLandingVS, state.speed);
      }
    } else if (onWater && !isSeaplane && getCarrierDeckHeight(state.position.x, state.position.z) === null) {
      crash('WATER IMPACT - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(3);
    } else if (!onRwy && !onWater && !isNearAnyAirport(state.position.x, state.position.z) && getCarrierDeckHeight(state.position.x, state.position.z) === null) {
      crash('TERRAIN IMPACT - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(3);
    } else if ((vs > MAX_LANDING_VS || state.speed > MAX_LANDING_SPEED) && getCarrierDeckHeight(state.position.x, state.position.z) === null) {
      crash('HARD LANDING - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(vs);
      if (isLandingMode()) {
        recordTouchdown(preLandingVS, state.speed);
      }
    } else {
      // Successful landing
      const vsFPM = vs * MS_TO_FPM;
      currentState = FlightState.GROUNDED;
      playTouchdownSound(vs);
      triggerLandingShake(vs);

      // Particle effects on landing
      if (onRwy) {
        triggerTireSmoke(vs);
      } else {
        triggerDustCloud(vs);
      }

      if (isLandingMode()) {
        const score = recordTouchdown(preLandingVS, state.speed);
        if (score) {
          showLandingScore(score);
          showTimedMessage(`GRADE: ${score.overall.grade} - ${score.vs.grade}!`, 8);
          // Save challenge-specific scores
          const ch = getActiveChallenge();
          const cs = getChallengeState();
          if (ch === 'crosswind' && cs.level) {
            saveBestScore(getCrosswindScoreKey(state.currentType, cs.level), score.overall.score);
          } else if (ch === 'daily') {
            saveBestScore(getDailyScoreKey(state.currentType), score.overall.score);
          } else if (ch === 'engine_out') {
            saveBestScore(getEngineOutScoreKey(state.currentType), score.overall.score);
          } else if (ch === 'precision_approach') {
            // Combined score: 50% approach ILS tracking + 50% landing
            const approachScore = getPrecisionApproachScore();
            const combinedScore = Math.round(approachScore * 0.5 + score.overall.score * 0.5);
            saveBestScore('precision_approach_' + state.currentType, combinedScore);
          }
          // Career & achievement hooks
          handleLandingAchievements(score, state, false);
        }
      } else {
        // Free-flight landing scoring
        const score = scoreFreeFlightLanding(vs, state);
        showLandingScore(score);
        showTimedMessage(`${score.vs.grade}!`, 5);
        // Career & achievement hooks
        handleLandingAchievements(score, state, false);
      }
    }
    wasAirborne = false;
    airborneTime = 0;
    landingProcessed = true; // prevent re-scoring until next takeoff
  }

  if (currentState !== FlightState.CRASHED) {
    const takeoffSpd = state.config ? state.config.takeoffSpeed : TAKEOFF_SPEED;

    if (!state.onGround) {
      if (currentState !== FlightState.AIRBORNE) {
        // Transitioning to airborne (takeoff)
        const tod = getTimeOfDay();
        if (tod >= 4 && tod <= 6) checkAchievement('dawn_patrol');
        landingProcessed = false; // allow scoring for the next landing
      }
      currentState = FlightState.AIRBORNE;
      // Only mark wasAirborne after 2 seconds of continuous flight
      // This prevents false scoring on spawn or brief hops
      if (airborneTime > 2.0) {
        wasAirborne = true;
      }
    } else if (state.speed > 2 && state.throttle > 0.1) {
      currentState = FlightState.TAKEOFF_ROLL;

      if (state.speed > takeoffSpd * 0.9 && messageTimer <= 0) {
        showTimedMessage('ROTATE', 2);
      }
    } else if (state.speed < 2) {
      currentState = FlightState.GROUNDED;
    }
  }

  return currentState;
}

function handleLandingAchievements(score, state, isWaterSeaplane) {
  // Increment consecutive landing counters
  consecutiveLandings++;
  const isButter = score.vs.value < 60;
  if (isButter) {
    consecutiveButters++;
  } else {
    consecutiveButters = 0;
  }

  // Career XP and flight recording
  const xpResult = addXP(score.overall.score * 2, 'landing');
  recordFlight();

  // Rank up celebration
  if (xpResult && xpResult.promoted) {
    showRankUp(xpResult.newRank);
  }

  // Challenge complete celebration (for challenge modes)
  const ch = getActiveChallenge();
  if (ch) {
    const challengeNames = {
      crosswind: 'CROSSWIND CHALLENGE',
      daily: 'DAILY CHALLENGE',
      engine_out: 'ENGINE OUT',
      speedrun: 'SPEED RUN',
      full_circuit: 'FULL CIRCUIT',
      touch_and_go: 'TOUCH & GO',
      precision_approach: 'PRECISION APPROACH',
      progressive: 'PROGRESSIVE',
      cargo_run: 'CARGO RUN',
      emergency_landing: 'EMERGENCY LANDING',
    };
    showChallengeComplete(
      challengeNames[ch] || ch.toUpperCase(),
      score.overall.score,
      score.overall.grade,
      score.newBest || false
    );
  }

  // Milestone celebrations
  if (consecutiveLandings === 10) showMilestone('10 CONSECUTIVE LANDINGS!');
  if (consecutiveButters === 3) showMilestone('3 BUTTER LANDINGS IN A ROW!');

  // Achievement checks
  checkAchievement('first_flight');

  if (isButter) checkAchievement('butter');
  if (score.centerline.value < 1) checkAchievement('centerline');

  const tod = getTimeOfDay();
  if (tod > 22 || tod < 4) checkAchievement('night_owl');
  if (getCurrentPreset() === 'storm') checkAchievement('storm_rider');
  if (state.currentType === 'airbus_a320' && score.overall.score > 80) checkAchievement('heavy_metal');

  if (isWaterSeaplane) checkAchievement('sea_legs');

  if (consecutiveLandings >= 10) checkAchievement('iron_pilot');
  if (consecutiveButters >= 3) checkAchievement('greaser');
}

function crash(msg) {
  consecutiveLandings = 0;
  consecutiveButters = 0;
  currentState = FlightState.CRASHED;
  getActiveVehicle().velocity.set(0, 0, 0);
  getActiveVehicle().throttle = 0;
  showMessage(msg);

  // Crash flash overlay
  const flash = document.getElementById('crash-flash');
  if (flash) {
    flash.style.transition = 'none';
    flash.style.opacity = '0.6';
    requestAnimationFrame(() => {
      flash.style.transition = 'opacity 0.5s ease';
      flash.style.opacity = '0';
    });
  }

  // Crash FX
  const pos = getActiveVehicle().position;
  triggerCrash(pos);
  playExplosion();
  hideAircraftModel();
  startCrashCamera(pos);
  triggerEmergencyResponse(pos);
}

function showTimedMessage(msg, seconds) {
  showMessage(msg);
  messageTimer = seconds;
}

function scoreFreeFlightLanding(vs, state) {
  const vsFPM = Math.abs(vs * MS_TO_FPM);
  const centerlineDev = getNearestRunwayCenterlineDev(state.position.x, state.position.z);
  const gsKts = state.speed * MS_TO_KNOTS;

  // VS rating (50%)
  let vsScore, vsGrade;
  if (vsFPM < 60) { vsScore = 100; vsGrade = 'BUTTER'; }
  else if (vsFPM < 120) { vsScore = 90; vsGrade = 'EXCELLENT'; }
  else if (vsFPM < 200) { vsScore = 75; vsGrade = 'GOOD'; }
  else if (vsFPM < 350) { vsScore = 55; vsGrade = 'ACCEPTABLE'; }
  else if (vsFPM < 500) { vsScore = 30; vsGrade = 'FIRM'; }
  else { vsScore = 10; vsGrade = 'HARD'; }

  // Centerline bonus (25%)
  let clScore, clGrade;
  if (centerlineDev < 5) { clScore = 100; clGrade = 'PERFECT'; }
  else if (centerlineDev < 15) { clScore = 75; clGrade = 'GOOD'; }
  else if (centerlineDev < RUNWAY_WIDTH / 2) { clScore = 40; clGrade = 'OK'; }
  else { clScore = 10; clGrade = 'OFF CENTER'; }

  // Speed rating (25%) - lower is better for landing
  const refSpeed = (state.config && state.config.takeoffSpeed) || TAKEOFF_SPEED;
  const refKts = refSpeed * 0.75 * MS_TO_KNOTS; // Vref approx
  const spdDev = Math.abs(gsKts - refKts);
  let spdScore;
  if (spdDev < 10) spdScore = 100;
  else if (spdDev < 20) spdScore = 80;
  else if (spdDev < 35) spdScore = 55;
  else spdScore = 25;

  const overall = Math.round(vsScore * 0.50 + clScore * 0.25 + spdScore * 0.25);

  let overallGrade;
  if (overall >= 90) overallGrade = 'S';
  else if (overall >= 80) overallGrade = 'A';
  else if (overall >= 65) overallGrade = 'B';
  else if (overall >= 50) overallGrade = 'C';
  else if (overall >= 35) overallGrade = 'D';
  else overallGrade = 'F';

  const key = (state.currentType || 'unknown') + '_free';
  const isNewBest = saveBestScore(key, overall);
  const best = getBestScore(key);

  return {
    vs: { score: vsScore, grade: vsGrade, value: Math.round(vsFPM) },
    centerline: { score: clScore, grade: clGrade, value: centerlineDev.toFixed(1) },
    touchdownZone: { score: spdScore, grade: spdDev < 15 ? 'ON SPEED' : 'OFF SPEED', value: Math.round(gsKts) },
    speed: { value: Math.round(gsKts) },
    overall: { score: overall, grade: overallGrade },
    newBest: isNewBest,
    bestScore: best,
  };
}

import { resetAircraft } from './aircraft.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { isOnRunway } from './runway.js';
import { isInOcean } from './terrain.js';
import { showMessage, clearMessage, showLandingScore, hideLandingScore } from './hud.js';
import { preLandingVS } from './physics.js';
import { playTouchdownSound, playCrashSound } from './audio.js';
import { triggerLandingShake, freezeCamera } from './camera.js';
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
import { getActiveChallenge, getChallengeState, getCrosswindScoreKey, getDailyScoreKey, getEngineOutScoreKey } from './challenges.js';
import { saveBestScore, getBestScore } from './settings.js';

export const FlightState = {
  GROUNDED: 'GROUNDED',
  TAKEOFF_ROLL: 'TAKEOFF_ROLL',
  AIRBORNE: 'AIRBORNE',
  CRASHED: 'CRASHED',
};

let currentState = FlightState.GROUNDED;
let wasAirborne = false;
let messageTimer = 0;

export function getCurrentState() {
  return currentState;
}

export function resetState() {
  resetAircraft();
  currentState = FlightState.GROUNDED;
  wasAirborne = false;
  messageTimer = 0;
  clearMessage();
  hideLandingScore();
  disableLandingAssist();

  if (isLandingMode()) {
    resetLandingMode();
    // If approach spawn, start airborne
    if (!getActiveVehicle().onGround) {
      currentState = FlightState.AIRBORNE;
      wasAirborne = true;
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

  // Check ground transitions
  if (state.onGround && wasAirborne) {
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
      return currentState;
    }

    if (!state.gear) {
      crash('GEAR UP LANDING - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(3);
      if (isLandingMode()) {
        recordTouchdown(preLandingVS, state.speed);
      }
    } else if (onWater && !isSeaplane) {
      crash('WATER IMPACT - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(3);
    } else if (!onRwy && !onWater) {
      crash('TERRAIN IMPACT - PRESS R TO RETRY');
      playCrashSound();
      triggerLandingShake(3);
    } else if (vs > MAX_LANDING_VS || state.speed > MAX_LANDING_SPEED) {
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
          }
        }
      } else {
        // Free-flight landing scoring
        const score = scoreFreeFlightLanding(vs, state);
        showLandingScore(score);
        showTimedMessage(`${score.vs.grade}!`, 5);
      }
    }
    wasAirborne = false;
  }

  if (currentState !== FlightState.CRASHED) {
    const takeoffSpd = state.config ? state.config.takeoffSpeed : TAKEOFF_SPEED;

    if (!state.onGround) {
      currentState = FlightState.AIRBORNE;
      wasAirborne = true;
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

function crash(msg) {
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

  // Freeze camera briefly
  freezeCamera(0.5);
}

function showTimedMessage(msg, seconds) {
  showMessage(msg);
  messageTimer = seconds;
}

function scoreFreeFlightLanding(vs, state) {
  const vsFPM = Math.abs(vs * MS_TO_FPM);
  const centerlineDev = Math.abs(state.position.x);
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
  if (spdDev < 5) spdScore = 100;
  else if (spdDev < 15) spdScore = 75;
  else if (spdDev < 30) spdScore = 45;
  else spdScore = 15;

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

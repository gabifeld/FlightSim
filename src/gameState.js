import { resetAircraft } from './aircraft.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { isOnRunway } from './runway.js';
import { isInOcean } from './terrain.js';
import { showMessage, clearMessage, showLandingScore, hideLandingScore } from './hud.js';
import { preLandingVS } from './physics.js';
import { playTouchdownSound, playCrashSound } from './audio.js';
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
} from './constants.js';
import { getActiveChallenge, getChallengeState, getCrosswindScoreKey, getDailyScoreKey, getEngineOutScoreKey } from './challenges.js';
import { saveBestScore } from './settings.js';

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
        let quality;
        if (vsFPM < 100) quality = 'BUTTER! PERFECT LANDING';
        else if (vsFPM < 300) quality = 'GOOD LANDING';
        else quality = 'FIRM LANDING';
        showTimedMessage(quality, 4);
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
}

function showTimedMessage(msg, seconds) {
  showMessage(msg);
  messageTimer = seconds;
}

import * as THREE from 'three';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, MS_TO_KNOTS, MS_TO_FPM } from './constants.js';
import { saveBestScore, getBestScore } from './settings.js';
import { clamp } from './utils.js';

// Runway threshold (south end - approach heading north)
const THRESHOLD_Z = -RUNWAY_LENGTH / 2;
const TOUCHDOWN_ZONE_START = 150; // meters past threshold
const TOUCHDOWN_ZONE_END = 500;
const GLIDESLOPE_ANGLE = 3.0; // degrees
const GLIDESLOPE_RAD = GLIDESLOPE_ANGLE * Math.PI / 180;

export const APPROACH_CONFIGS = {
  short_final: {
    name: 'Short Final',
    description: '1.5nm / 500ft',
    distance: 2778,
    altitude: 152,
    gearDown: true,
    flapsDown: true,
    throttle: 0.25,
    speedFactor: 0.75, // Vref ~75% of takeoff speed (realistic approach speed)
  },
  long_final: {
    name: 'Long Final',
    description: '3nm / 1000ft',
    distance: 4500,
    altitude: 280,
    gearDown: false,
    flapsDown: false,
    throttle: 0.35,
    speedFactor: 0.9, // slightly above Vref, time to configure
  },
};

let landingModeActive = false;
let currentConfigName = null;
let touchdownRecorded = false;
let scoreData = null;
let scoreCallback = null;

// ── Landing Assist ──
let landingAssistActive = false;
let assistVsIntegral = 0;
let assistSpdIntegral = 0;
let assistLocIntegral = 0;

export function isLandingMode() {
  return landingModeActive;
}

export function setScoreCallback(cb) {
  scoreCallback = cb;
}

export function startLandingMode(configName) {
  if (!APPROACH_CONFIGS[configName]) return;
  currentConfigName = configName;
  landingModeActive = true;
  touchdownRecorded = false;
  scoreData = null;
}

export function resetLandingMode() {
  touchdownRecorded = false;
  scoreData = null;
}

export function exitLandingMode() {
  landingModeActive = false;
  currentConfigName = null;
  touchdownRecorded = false;
  scoreData = null;
}

export function getApproachSpawn(configName, aircraftConfig) {
  const config = APPROACH_CONFIGS[configName];
  if (!config) return null;

  const takeoffSpeed = aircraftConfig ? aircraftConfig.takeoffSpeed : 55;
  const approachSpeed = takeoffSpeed * config.speedFactor;

  return {
    x: 0,
    z: THRESHOLD_Z - config.distance,
    y: config.altitude,
    heading: 0,
    speed: approachSpeed,
    gearDown: config.gearDown,
    flapsDown: config.flapsDown,
    throttle: config.throttle,
    airborne: true,
  };
}

export function getCurrentConfigName() {
  return currentConfigName;
}

// Compute ILS guidance deviations
export function computeILSGuidance(state) {
  const pos = state.position;

  // Distance to threshold along approach path (positive = south of threshold)
  const distToThreshold = -(pos.z - THRESHOLD_Z);
  const distNM = distToThreshold / 1852;

  // Localizer: lateral offset from centerline
  const locDevMeters = pos.x;
  let locDots;
  if (distToThreshold > 100) {
    locDots = Math.atan2(pos.x, distToThreshold) * (180 / Math.PI) / 1.0;
  } else {
    locDots = pos.x / 30;
  }

  // Glideslope: vertical offset from 3-deg slope
  const idealAlt = Math.tan(GLIDESLOPE_RAD) * Math.max(distToThreshold, 0);
  const gsDeviation = pos.y - idealAlt;
  let gsDots;
  if (distToThreshold > 100) {
    const gsAngle = (Math.atan2(pos.y, distToThreshold) - GLIDESLOPE_RAD) * (180 / Math.PI);
    gsDots = gsAngle / 0.35;
  } else {
    gsDots = gsDeviation / 10;
  }

  return {
    locDots: Math.max(-2.5, Math.min(2.5, locDots)),
    gsDots: Math.max(-2.5, Math.min(2.5, gsDots)),
    distToThreshold,
    distNM: Math.max(0, distNM),
    onGlideslope: Math.abs(gsDots) < 1.0,
    onLocalizer: Math.abs(locDots) < 1.0,
    pastThreshold: distToThreshold < 0,
  };
}

// Record and score a touchdown
export function recordTouchdown(vs, groundSpeed) {
  if (touchdownRecorded) return null;
  touchdownRecorded = true;

  const pos = getActiveVehicle().position;
  const distPastThreshold = pos.z - THRESHOLD_Z;
  const centerlineDeviation = Math.abs(pos.x);
  const vsFPM = Math.abs(vs * MS_TO_FPM);
  const gsKts = groundSpeed * MS_TO_KNOTS;

  // VS rating (50% weight)
  let vsScore, vsGrade;
  if (vsFPM < 60) { vsScore = 100; vsGrade = 'BUTTER'; }
  else if (vsFPM < 120) { vsScore = 90; vsGrade = 'EXCELLENT'; }
  else if (vsFPM < 200) { vsScore = 75; vsGrade = 'GOOD'; }
  else if (vsFPM < 350) { vsScore = 55; vsGrade = 'ACCEPTABLE'; }
  else if (vsFPM < 500) { vsScore = 30; vsGrade = 'FIRM'; }
  else { vsScore = 10; vsGrade = 'HARD'; }

  // Centerline rating (25% weight)
  let clScore, clGrade;
  if (centerlineDeviation < 2) { clScore = 100; clGrade = 'PERFECT'; }
  else if (centerlineDeviation < 5) { clScore = 85; clGrade = 'EXCELLENT'; }
  else if (centerlineDeviation < 10) { clScore = 65; clGrade = 'GOOD'; }
  else if (centerlineDeviation < 20) { clScore = 40; clGrade = 'OK'; }
  else { clScore = 10; clGrade = 'OFF CENTER'; }

  // Touchdown zone rating (25% weight)
  let tzScore, tzGrade;
  if (distPastThreshold >= TOUCHDOWN_ZONE_START && distPastThreshold <= TOUCHDOWN_ZONE_END) {
    tzScore = 100; tzGrade = 'IN ZONE';
  } else if (distPastThreshold >= 50 && distPastThreshold <= 800) {
    tzScore = 55; tzGrade = 'ACCEPTABLE';
  } else if (distPastThreshold < 50) {
    tzScore = 15; tzGrade = 'SHORT';
  } else {
    tzScore = 15; tzGrade = 'LONG';
  }

  const overall = Math.round(vsScore * 0.50 + clScore * 0.25 + tzScore * 0.25);

  let overallGrade;
  if (overall >= 90) overallGrade = 'S';
  else if (overall >= 80) overallGrade = 'A';
  else if (overall >= 65) overallGrade = 'B';
  else if (overall >= 50) overallGrade = 'C';
  else if (overall >= 35) overallGrade = 'D';
  else overallGrade = 'F';

  scoreData = {
    vs: { score: vsScore, grade: vsGrade, value: Math.round(vsFPM) },
    centerline: { score: clScore, grade: clGrade, value: centerlineDeviation.toFixed(1) },
    touchdownZone: { score: tzScore, grade: tzGrade, value: Math.round(distPastThreshold) },
    speed: { value: Math.round(gsKts) },
    overall: { score: overall, grade: overallGrade },
  };

  // Track best score per aircraft (persistent via localStorage)
  const key = getActiveVehicle().currentType + '_' + (currentConfigName || 'free');
  const isNewBest = saveBestScore(key, overall);
  if (isNewBest) {
    scoreData.newBest = true;
  }
  scoreData.bestScore = getBestScore(key);

  if (scoreCallback) scoreCallback(scoreData);

  return scoreData;
}

// ── Landing Assist ──

export function toggleLandingAssist() {
  landingAssistActive = !landingAssistActive;
  assistVsIntegral = 0;
  assistSpdIntegral = 0;
  assistLocIntegral = 0;
}

export function isLandingAssistActive() {
  return landingAssistActive;
}

export function disableLandingAssist() {
  landingAssistActive = false;
  assistVsIntegral = 0;
  assistSpdIntegral = 0;
  assistLocIntegral = 0;
}

export function getApproachSpeedTarget(state, ils = null) {
  const takeoffSpd = state.config ? state.config.takeoffSpeed : 55;
  const type = state.config ? state.config.type : 'prop';

  let factor = type === 'prop' ? 0.82 : (type === 'fighter' ? 0.9 : 0.84);
  if (ils && ils.distNM > 6) factor += 0.08;
  else if (ils && ils.distNM > 3) factor += 0.04;
  if (!state.gear) factor += 0.04;
  if (!state.flaps) factor += 0.05;

  return clamp(takeoffSpd * factor, takeoffSpd * 0.68, takeoffSpd * 1.08);
}

export function getApproachTargetVS(state, ils) {
  const refSpeed = Math.max(state.speed, getApproachSpeedTarget(state, ils) * 0.95);
  const baseVs = -Math.tan(GLIDESLOPE_RAD) * refSpeed * MS_TO_FPM;
  let targetVs = baseVs - (ils ? ils.gsDots * 320 : 0);

  // Reduce sink rate in the flare window so assisted landings are controllable.
  if (state.altitudeAGL < 60) targetVs = Math.max(targetVs, -320);
  if (state.altitudeAGL < 25) targetVs = Math.max(targetVs, -160);

  return clamp(targetVs, -1800, 250);
}

/**
 * Landing assist: auto-manages pitch and throttle to follow the glideslope.
 * Player only steers left/right. Returns { pitchCommand, throttleCommand } or null.
 * Mirrors the autopilot APR mode logic but simplified.
 */
export function updateLandingAssist(dt) {
  if (!landingAssistActive) return null;

  const state = getActiveVehicle();

  // Auto-disable on ground
  if (state.onGround) {
    disableLandingAssist();
    return null;
  }

  const ils = computeILSGuidance(state);
  if (!ils || ils.pastThreshold) {
    disableLandingAssist();
    return null;
  }

  // Only useful within 10nm of threshold
  if (ils.distNM > 10) {
    return null;
  }

  const vrefSpeed = getApproachSpeedTarget(state, ils);
  const currentVsFpm = state.verticalSpeed * MS_TO_FPM;

  const targetVs = getApproachTargetVS(state, ils);

  // PI controller: VS error → pitch command
  // Matches autopilot vsPID gains: kp=0.003, ki=0.0005
  const vsErr = targetVs - currentVsFpm;
  assistVsIntegral += vsErr * dt;
  assistVsIntegral = clamp(assistVsIntegral, -2000, 2000);

  const pitchCommand = clamp(
    vsErr * 0.0024 + assistVsIntegral * 0.00025,
    -0.55, 0.55
  );

  // Localizer roll guidance. Keep it gentle and centered so the assist
  // will actually line the aircraft up instead of only chasing glideslope.
  const locErr = -ils.locDots;
  assistLocIntegral += locErr * dt;
  assistLocIntegral = clamp(assistLocIntegral, -20, 20);
  const rollCommand = clamp(
    locErr * 0.18 + assistLocIntegral * 0.015,
    -0.35, 0.35
  );

  // Auto-throttle: PI for speed hold
  const spdErr = vrefSpeed - state.speed;
  assistSpdIntegral += spdErr * dt;
  assistSpdIntegral = clamp(assistSpdIntegral, -20, 20);

  const throttleCommand = clamp(
    0.34 + spdErr * 0.03 + assistSpdIntegral * 0.008,
    0.08, 0.92
  );

  return { pitchCommand, rollCommand, throttleCommand };
}

export function getScoreData() {
  return scoreData;
}

export function hasTouchdown() {
  return touchdownRecorded;
}

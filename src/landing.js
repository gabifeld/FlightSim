import * as THREE from 'three';
import { aircraftState } from './aircraft.js';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, MS_TO_KNOTS, MS_TO_FPM } from './constants.js';
import { saveBestScore, getBestScore } from './settings.js';

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

  const pos = aircraftState.position;
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
  const key = aircraftState.currentType + '_' + (currentConfigName || 'free');
  const isNewBest = saveBestScore(key, overall);
  if (isNewBest) {
    scoreData.newBest = true;
  }
  scoreData.bestScore = getBestScore(key);

  if (scoreCallback) scoreCallback(scoreData);

  return scoreData;
}

export function getScoreData() {
  return scoreData;
}

export function hasTouchdown() {
  return touchdownRecorded;
}

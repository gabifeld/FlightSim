import * as THREE from 'three';
import {
  DEFAULT_WIND_SPEED,
  DEFAULT_WIND_DIRECTION,
  DEFAULT_TURBULENCE,
  GUST_MIN_INTERVAL,
  GUST_MAX_INTERVAL,
  GUST_DECAY_RATE,
} from './constants.js';

const state = {
  windDirection: DEFAULT_WIND_DIRECTION,
  windSpeed: DEFAULT_WIND_SPEED,
  gustIntensity: 0,
  turbulenceIntensity: DEFAULT_TURBULENCE,
  windVector: new THREE.Vector3(),
};

let gustTimer = 0;
let nextGustTime = 0;
let gustActive = 0;
let time = 0;

// Simple noise for turbulence (no dependency needed)
function pseudoNoise(t) {
  return Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1) * 0.3 + Math.sin(t * 7.3) * 0.2;
}

export function initWeather() {
  nextGustTime = GUST_MIN_INTERVAL + Math.random() * (GUST_MAX_INTERVAL - GUST_MIN_INTERVAL);
}

export function updateWeather(dt) {
  time += dt;

  // Gust events
  gustTimer += dt;
  if (gustTimer >= nextGustTime) {
    gustActive = 0.5 + Math.random() * 0.5; // gust strength 0.5-1.0
    gustTimer = 0;
    nextGustTime = GUST_MIN_INTERVAL + Math.random() * (GUST_MAX_INTERVAL - GUST_MIN_INTERVAL);
  }

  // Decay active gust
  if (gustActive > 0.01) {
    gustActive *= Math.exp(-GUST_DECAY_RATE * dt);
  } else {
    gustActive = 0;
  }

  state.gustIntensity = gustActive;

  // Compute wind vector from direction + speed + turbulence + gust
  const baseSpeed = state.windSpeed + gustActive * state.windSpeed * 0.5;
  const turbX = pseudoNoise(time * 2.3) * state.turbulenceIntensity * state.windSpeed;
  const turbZ = pseudoNoise(time * 1.7 + 100) * state.turbulenceIntensity * state.windSpeed;

  state.windVector.set(
    Math.sin(state.windDirection) * baseSpeed + turbX,
    pseudoNoise(time * 0.9 + 50) * state.turbulenceIntensity * state.windSpeed * 0.3,
    Math.cos(state.windDirection) * baseSpeed + turbZ
  );
}

export function getWeatherState() {
  return state;
}

export function setWind(direction, speed) {
  state.windDirection = direction;
  state.windSpeed = speed;
}

export function setTurbulence(intensity) {
  state.turbulenceIntensity = intensity;
}

export function applyWeatherPreset(preset) {
  if (preset.windSpeed !== undefined) state.windSpeed = preset.windSpeed;
  if (preset.turbulence !== undefined) state.turbulenceIntensity = preset.turbulence;
}

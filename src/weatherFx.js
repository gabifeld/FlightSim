// Weather visual effects: rain particles, lightning flashes, dynamic fog
import * as THREE from 'three';
import { getActiveVehicle } from './vehicleState.js';
import { applyWeatherPreset as applyWeatherPhysics, getWeatherState } from './weather.js';
import { playThunder } from './audio.js';
import { applyWeatherCloudProfile } from './terrain.js';

let rainSystem = null;
let lightningTimer = 0;
let lightningFlash = 0;
let lightningSprite = null;
let sceneRef = null;
let ambientRef = null;
let fogRef = null;
let originalAmbientIntensity = 0.7;
let currentAmbientBaseline = 0.7;

const RAIN_PARTICLE_COUNT = 1500;
const RAIN_AREA = 150; // meters cube around camera
const RAIN_SPEED_MIN = 8;
const RAIN_SPEED_MAX = 15;

// Weather presets
export const WEATHER_PRESETS = {
  clear: {
    fogDensity: 0.00004,
    cloudCount: 180,
    cloudOpacity: 0.28,
    rainIntensity: 0,
    windSpeed: 1.5,
    turbulence: 0.02,
    lightningChance: 0,
  },
  overcast: {
    fogDensity: 0.00008,
    cloudCount: 260,
    cloudOpacity: 0.38,
    rainIntensity: 0,
    windSpeed: 3.0,
    turbulence: 0.05,
    lightningChance: 0,
  },
  rain: {
    fogDensity: 0.00015,
    cloudCount: 320,
    cloudOpacity: 0.48,
    rainIntensity: 0.6,
    windSpeed: 5.0,
    turbulence: 0.1,
    lightningChance: 0,
  },
  storm: {
    fogDensity: 0.00025,
    cloudCount: 420,
    cloudOpacity: 0.62,
    rainIntensity: 1.0,
    windSpeed: 10.0,
    turbulence: 0.25,
    lightningChance: 0.04, // per second
  },
};

let currentPreset = 'clear';
let rainIntensity = 0;

function createRainSystem() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(RAIN_PARTICLE_COUNT * 3);
  const velocities = new Float32Array(RAIN_PARTICLE_COUNT);

  for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * RAIN_AREA;
    positions[i3 + 1] = Math.random() * RAIN_AREA;
    positions[i3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
    velocities[i] = RAIN_SPEED_MIN + Math.random() * (RAIN_SPEED_MAX - RAIN_SPEED_MIN);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xaaccee,
    size: 0.3,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;

  return { points, positions, velocities };
}

function createLightningSprite(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.3, 'rgba(200, 220, 255, 0.5)');
  gradient.addColorStop(1, 'rgba(150, 180, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(500, 500, 1);
  sprite.visible = false;
  scene.add(sprite);
  return sprite;
}

export function initWeatherFx(scene) {
  sceneRef = scene;
  rainSystem = createRainSystem();
  scene.add(rainSystem.points);
  lightningSprite = createLightningSprite(scene);

  // Store refs to scene lights for lightning flash
  scene.traverse((obj) => {
    if (obj.isAmbientLight) ambientRef = obj;
  });
  fogRef = scene.fog;

  // Apply default preset so cloud/fog/rain start in sync.
  setWeatherPreset(currentPreset);
}

export function setWeatherPreset(presetName) {
  const preset = WEATHER_PRESETS[presetName];
  if (!preset) return;
  currentPreset = presetName;
  rainIntensity = preset.rainIntensity;

  // Update fog
  if (fogRef) {
    fogRef.density = preset.fogDensity;
  }

  // Update rain visibility
  if (rainSystem) {
    rainSystem.points.visible = rainIntensity > 0;
    rainSystem.points.material.opacity = 0.2 + rainIntensity * 0.3;
  }

  // Sync wind/turbulence to weather physics
  applyWeatherPhysics(preset);

  // Sync cloud visual profile
  applyWeatherCloudProfile({
    cloudCount: preset.cloudCount,
    cloudOpacity: preset.cloudOpacity,
  });
}

export function getCurrentPreset() {
  return currentPreset;
}

export function cycleWeatherPreset() {
  const presets = Object.keys(WEATHER_PRESETS);
  const idx = presets.indexOf(currentPreset);
  const next = presets[(idx + 1) % presets.length];
  setWeatherPreset(next);
  return next;
}

export function updateWeatherFx(dt) {
  if (ambientRef && lightningFlash <= 0) {
    currentAmbientBaseline = ambientRef.intensity;
  }

  // Update rain particles
  if (rainSystem && rainIntensity > 0) {
    const posAttr = rainSystem.points.geometry.attributes.position;
    const positions = rainSystem.positions;
    const velocities = rainSystem.velocities;

    const camX = getActiveVehicle().position.x;
    const camY = getActiveVehicle().position.y;
    const camZ = getActiveVehicle().position.z;
    const halfArea = RAIN_AREA / 2;
    const belowY = camY - halfArea;
    const topY = camY + halfArea;

    const weather = getWeatherState();
    const wind = weather ? weather.windVector : null;
    const windDriftX = (wind ? wind.x : 0) * dt * (0.28 + rainIntensity * 0.22);
    const windDriftZ = (wind ? wind.z : 0) * dt * (0.28 + rainIntensity * 0.22);

    for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
      const i3 = i * 3;

      // Fall + wind drift
      positions[i3] += windDriftX;
      positions[i3 + 1] -= velocities[i] * dt;
      positions[i3 + 2] += windDriftZ;

      // Recycle particles that fall below or drift out of bounds
      if (positions[i3 + 1] < belowY ||
          positions[i3] - camX > halfArea || positions[i3] - camX < -halfArea ||
          positions[i3 + 2] - camZ > halfArea || positions[i3 + 2] - camZ < -halfArea) {
        positions[i3] = camX + (Math.random() - 0.5) * RAIN_AREA;
        positions[i3 + 1] = topY;
        positions[i3 + 2] = camZ + (Math.random() - 0.5) * RAIN_AREA;
      }
    }

    posAttr.needsUpdate = true;
  }

  // Lightning
  const preset = WEATHER_PRESETS[currentPreset];
  if (preset && preset.lightningChance > 0) {
    lightningTimer += dt;

    // Random lightning strike
    if (Math.random() < preset.lightningChance * dt) {
      lightningFlash = 1.0;
      playThunder();
      if (ambientRef) {
        currentAmbientBaseline = ambientRef.intensity;
      }

      // Position lightning on horizon
      if (lightningSprite) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 3000 + Math.random() * 2000;
        lightningSprite.position.set(
          getActiveVehicle().position.x + Math.cos(angle) * dist,
          600 + Math.random() * 400,
          getActiveVehicle().position.z + Math.sin(angle) * dist
        );
        lightningSprite.visible = true;
        lightningSprite.material.opacity = 1.0;
      }
    }
  }

  // Decay lightning flash
  if (lightningFlash > 0) {
    lightningFlash *= Math.exp(-15 * dt); // fast decay

    // Flash ambient light
    if (ambientRef) {
      ambientRef.intensity = currentAmbientBaseline + lightningFlash * 4.0;
    }

    if (lightningSprite) {
      lightningSprite.material.opacity = lightningFlash;
      if (lightningFlash < 0.01) {
        lightningSprite.visible = false;
      }
    }

    if (lightningFlash < 0.01) {
      lightningFlash = 0;
      if (ambientRef) {
        ambientRef.intensity = currentAmbientBaseline;
      }
    }
  }
}

export function setAmbientRef(light) {
  ambientRef = light;
  if (light) {
    originalAmbientIntensity = light.intensity;
    currentAmbientBaseline = light.intensity;
  }
}

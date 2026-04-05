// Weather visual effects: rain particles, lightning flashes, dynamic fog
import * as THREE from 'three';
import { getActiveVehicle } from './vehicleState.js';
import { applyWeatherPreset as applyWeatherPhysics, getWeatherState } from './weather.js';
import { playThunder } from './audio.js';
import { applyWeatherCloudProfile } from './terrain.js';

let rainSystem = null;
let lightningTimer = 0;
let lightningFlash = 0;
let sceneRef = null;
let ambientRef = null;
let fogRef = null;
let originalAmbientIntensity = 0.7;
let currentAmbientBaseline = 0.7;

// Active lightning bolts awaiting removal
let activeBolts = [];

const RAIN_PARTICLE_COUNT = 1500;
const RAIN_AREA = 150; // meters cube around camera
const RAIN_SPEED_MIN = 8;
const RAIN_SPEED_MAX = 15;

// Lightning bolt constants
const BOLT_CLOUD_BASE_Y = 2500;
const BOLT_VISIBLE_TIME = 0.15;
const BOLT_FADE_TIME = 0.1;
const BOLT_MIN_DIST = 2000;
const BOLT_MAX_DIST = 4000;
const THUNDER_SPEED = 343; // m/s speed of sound
const THUNDER_MAX_DELAY = 8; // seconds

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

/* ── Rain streak texture ─────────────────────────────────── */

function createRainStreakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  // Vertical gradient: transparent → bright white center → transparent
  const gradient = ctx.createLinearGradient(0, 0, 0, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

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

  const streakTexture = createRainStreakTexture();

  const material = new THREE.PointsMaterial({
    color: 0xaaccee,
    size: 4,
    sizeAttenuation: true,
    map: streakTexture,
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

/* ── Branching lightning bolt generation ──────────────────── */

function generateBoltPoints(start, end, levels, maxOffset) {
  // Returns array of [startVec3, endVec3] segment pairs
  if (levels <= 0) {
    return [[start.clone(), end.clone()]];
  }

  const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
  const segLen = start.distanceTo(end);
  const displacement = segLen * 0.3; // ±30% of segment length

  mid.x += (Math.random() - 0.5) * 2 * displacement;
  mid.z += (Math.random() - 0.5) * 2 * displacement;

  const left = generateBoltPoints(start, mid, levels - 1, maxOffset);
  const right = generateBoltPoints(mid, end, levels - 1, maxOffset);

  return left.concat(right);
}

function generateBranch(branchStart, mainEnd, lengthFraction, levels) {
  // Side branch veers off at an angle
  const dir = new THREE.Vector3().subVectors(mainEnd, branchStart).normalize();
  const branchLen = branchStart.distanceTo(mainEnd) * lengthFraction;

  // Rotate direction randomly for the branch
  const angle = (Math.random() - 0.5) * Math.PI * 0.6; // ±54 degrees
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const newDirX = dir.x * cosA - dir.z * sinA;
  const newDirZ = dir.x * sinA + dir.z * cosA;

  const branchEnd = new THREE.Vector3(
    branchStart.x + newDirX * branchLen,
    branchStart.y + dir.y * branchLen,
    branchStart.z + newDirZ * branchLen
  );

  return generateBoltPoints(branchStart, branchEnd, levels, branchLen * 0.3);
}

function createLightningBolt(camPos) {
  const angle = Math.random() * Math.PI * 2;
  const dist = BOLT_MIN_DIST + Math.random() * (BOLT_MAX_DIST - BOLT_MIN_DIST);
  const baseX = camPos.x + Math.cos(angle) * dist;
  const baseZ = camPos.z + Math.sin(angle) * dist;

  const start = new THREE.Vector3(baseX, BOLT_CLOUD_BASE_Y, baseZ);
  const end = new THREE.Vector3(baseX, 0, baseZ);

  // Main bolt: 4 levels of subdivision
  const segments = generateBoltPoints(start, end, 4, 0);

  // Add 2-3 side branches at random points along the main path
  const branchCount = 2 + Math.floor(Math.random() * 2); // 2 or 3
  for (let b = 0; b < branchCount; b++) {
    const t = 0.2 + Math.random() * 0.5; // branch from 20-70% down the bolt
    const branchOrigin = new THREE.Vector3().lerpVectors(start, end, t);
    // Displace origin slightly to match nearby bolt path
    branchOrigin.x += (Math.random() - 0.5) * 200;
    branchOrigin.z += (Math.random() - 0.5) * 200;

    const branchSegs = generateBranch(
      branchOrigin,
      end,
      0.3 + Math.random() * 0.2, // 30-50% length
      2 // 2 subdivision levels for branches
    );
    segments.push(...branchSegs);
  }

  // Build geometry from segments
  const vertices = [];
  for (const [s, e] of segments) {
    vertices.push(s.x, s.y, s.z);
    vertices.push(e.x, e.y, e.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
  });

  const bolt = new THREE.LineSegments(geometry, material);

  return {
    mesh: bolt,
    age: 0,
    basePos: end.clone(), // ground strike position for thunder delay
  };
}

/* ── Init ─────────────────────────────────────────────────── */

export function initWeatherFx(scene) {
  sceneRef = scene;
  rainSystem = createRainSystem();
  scene.add(rainSystem.points);

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

  // Darken ambient light for overcast/rain/storm (overcast feel)
  if (ambientRef) {
    const weatherDim = presetName === 'storm' ? 0.4
      : presetName === 'rain' ? 0.55
      : presetName === 'overcast' ? 0.75
      : 1.0;
    ambientRef._weatherDimFactor = weatherDim;
  }

  // Update rain visibility + size based on intensity
  if (rainSystem) {
    rainSystem.points.visible = rainIntensity > 0;
    rainSystem.points.material.opacity = 0.12 + rainIntensity * 0.15;
    rainSystem.points.material.size = 1.5 + rainIntensity * 1.0; // 1.5-2.5, subtle streaks
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

/* ── Lightning flash intensity accessor ───────────────────── */

export function getLightningFlashIntensity() {
  return lightningFlash;
}

/* ── Update loop ──────────────────────────────────────────── */

export function updateWeatherFx(dt) {
  // Apply weather dimming to ambient light (smooth lerp)
  if (ambientRef && ambientRef._weatherDimFactor !== undefined) {
    const dimTarget = ambientRef._weatherDimFactor;
    // Smoothly interpolate ambient intensity toward dimmed target
    if (lightningFlash <= 0) {
      const baseIntensity = ambientRef.intensity;
      // Scene updates ambient each frame via time-of-day; we scale it down for weather
      ambientRef.intensity *= dimTarget + (1.0 - dimTarget) * 0.05; // gentle pull toward dim
    }
  }
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

  // Lightning strike trigger
  const preset = WEATHER_PRESETS[currentPreset];
  if (preset && preset.lightningChance > 0) {
    lightningTimer += dt;

    // Random lightning strike
    if (Math.random() < preset.lightningChance * dt) {
      const vehicle = getActiveVehicle();
      const bolt = createLightningBolt(vehicle.position);
      sceneRef.add(bolt.mesh);
      activeBolts.push(bolt);

      // Flash
      lightningFlash = 1.0;
      if (ambientRef) {
        currentAmbientBaseline = ambientRef.intensity;
        ambientRef.intensity = currentAmbientBaseline * 3;
      }

      // Thunder delay based on distance
      const dx = bolt.basePos.x - vehicle.position.x;
      const dz = bolt.basePos.z - vehicle.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const delay = Math.min(distance / THUNDER_SPEED, THUNDER_MAX_DELAY);
      setTimeout(() => { playThunder(); }, delay * 1000);
    }
  }

  // Update active lightning bolts (fade + remove)
  for (let i = activeBolts.length - 1; i >= 0; i--) {
    const bolt = activeBolts[i];
    bolt.age += dt;

    if (bolt.age > BOLT_VISIBLE_TIME + BOLT_FADE_TIME) {
      // Remove bolt from scene
      sceneRef.remove(bolt.mesh);
      bolt.mesh.geometry.dispose();
      bolt.mesh.material.dispose();
      activeBolts.splice(i, 1);
    } else if (bolt.age > BOLT_VISIBLE_TIME) {
      // Fading phase
      const fadeProgress = (bolt.age - BOLT_VISIBLE_TIME) / BOLT_FADE_TIME;
      bolt.mesh.material.opacity = 1.0 - fadeProgress;
    }
  }

  // Decay lightning flash (ambient light)
  if (lightningFlash > 0) {
    lightningFlash *= Math.exp(-15 * dt); // fast exponential decay

    if (ambientRef) {
      ambientRef.intensity = currentAmbientBaseline + lightningFlash * (currentAmbientBaseline * 2);
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

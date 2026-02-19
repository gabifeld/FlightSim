import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { DEFAULT_TIME_OF_DAY, TIME_CYCLE_RATE, TERRAIN_SIZE, CAMERA_FAR } from './constants.js';
import { clamp, lerp } from './utils.js';

export let scene, renderer;
let _resizeCb = null;
export function setResizeCallback(fn) { _resizeCb = fn; }
export let sun;
export let ambientLight, hemiLight;

let sky;
let lensflare;
const sunPosition = new THREE.Vector3();
const sunDirection = new THREE.Vector3();
const _fogColor = new THREE.Color();

// Environment map for PBR reflections
let envMapRT = null;
let pmremGenerator = null;
let lastEnvMapSunElevation = null;

// Time of day system
let timeOfDay = DEFAULT_TIME_OF_DAY; // 0-24 hours
let autoCycleTime = false;

// Star field
let starField = null;

// Moon
let moonMesh = null;

const SHADOW_QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    enabled: false,
    mapSize: 1024,
    frustum: 200,
    bias: -0.0002,
    radius: 1,
  }),
  medium: Object.freeze({
    enabled: true,
    mapSize: 1536,
    frustum: 200,
    bias: -0.00018,
    radius: 2,
  }),
  high: Object.freeze({
    enabled: true,
    mapSize: 2048,
    frustum: 200,
    bias: -0.00014,
    radius: 3,
  }),
});

export function initScene(container) {
  scene = new THREE.Scene();
  // No fog — clean clear sky

  renderer = new THREE.WebGLRenderer({ antialias: false }); // SMAA replaces native AA
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.setClearColor(0x4a90d9);
  container.appendChild(renderer.domElement);

  // Atmospheric fog for depth and haze
  scene.fog = new THREE.FogExp2(0x8cb4de, 0.00004);

  // Ambient light (warm fill — boosted to compensate for lower exposure)
  ambientLight = new THREE.AmbientLight(0xd0d0d0, 1.0);
  scene.add(ambientLight);

  // Sun (directional)
  sun = new THREE.DirectionalLight(0xfffbe8, 3.5);
  sun.position.set(2000, 1500, 1000);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 5000;
  sun.shadow.camera.left = -200;
  sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200;
  sun.shadow.camera.bottom = -200;
  sun.shadow.bias = -0.0002;
  scene.add(sun);
  scene.add(sun.target);

  // Hemisphere light for sky/ground bounce
  hemiLight = new THREE.HemisphereLight(0xc0d8f0, 0x3d6b2e, 0.8);
  scene.add(hemiLight);

  // Sky addon with atmospheric scattering
  createSky();

  // Lensflare on sun
  createLensflare();

  // Stars
  createStarField();

  // Moon
  createMoon();

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    if (_resizeCb) _resizeCb(w, h);
  });

  return { scene, renderer };
}

// Sky color palettes for time-of-day
const SKY_PALETTES = {
  dawn:  { horizon: [0.9, 0.6, 0.4],   zenith: [0.3, 0.35, 0.6],  sun: [1, 0.7, 0.4] },
  day:   { horizon: [0.75, 0.82, 0.92], zenith: [0.3, 0.5, 0.85],  sun: [1, 0.95, 0.8] },
  dusk:  { horizon: [0.9, 0.5, 0.3],    zenith: [0.2, 0.2, 0.5],   sun: [1, 0.6, 0.3] },
  night: { horizon: [0.05, 0.05, 0.1],  zenith: [0.02, 0.02, 0.08], sun: [0.1, 0.1, 0.2] },
};

function lerpPalette(a, b, t) {
  return {
    horizon: a.horizon.map((v, i) => v + (b.horizon[i] - v) * t),
    zenith:  a.zenith.map((v, i) => v + (b.zenith[i] - v) * t),
    sun:     a.sun.map((v, i) => v + (b.sun[i] - v) * t),
  };
}

function getSkyPalette(sunElevation) {
  if (sunElevation > 15) return SKY_PALETTES.day;
  if (sunElevation > 0) {
    const t = sunElevation / 15;
    return lerpPalette(SKY_PALETTES.dawn, SKY_PALETTES.day, t);
  }
  if (sunElevation > -5) {
    const t = (sunElevation + 5) / 5;
    return lerpPalette(SKY_PALETTES.night, SKY_PALETTES.dusk, t);
  }
  return SKY_PALETTES.night;
}

function createSky() {
  const skyGeo = new THREE.SphereGeometry(CAMERA_FAR * 0.9, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      horizonColor: { value: new THREE.Color(0.75, 0.82, 0.92) },
      zenithColor:  { value: new THREE.Color(0.3, 0.5, 0.85) },
      sunColor:     { value: new THREE.Color(1.0, 0.95, 0.8) },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      sunSize:      { value: 0.03 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 horizonColor, zenithColor, sunColor, sunDirection;
      uniform float sunSize;
      varying vec3 vWorldDir;
      void main() {
        float y = max(vWorldDir.y, 0.0);
        vec3 sky = mix(horizonColor, zenithColor, pow(y, 0.6));
        // Below horizon: darken toward ground
        float belowH = max(-vWorldDir.y, 0.0);
        sky = mix(sky, horizonColor * 0.7, pow(belowH, 0.4));
        float sunDot = max(dot(normalize(vWorldDir), sunDirection), 0.0);
        sky += sunColor * pow(sunDot, 256.0) * 2.0; // sun disc
        sky += sunColor * pow(sunDot, 8.0) * 0.3;   // sun glow
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });

  sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  setSunPosition(45, 180);
}

// Generate environment map from SKY ONLY for PBR reflections on aircraft
// NOT applied to scene.environment (would wash out terrain colors)
export function generateEnvironmentMap() {
  if (!renderer || !sky) return;

  // Throttle: skip if sun elevation hasn't changed by more than 5 degrees
  const currentSunElev = (timeOfDay >= 6 && timeOfDay <= 18)
    ? 90 * Math.sin(Math.PI * (timeOfDay - 6) / 12)
    : -10;
  if (lastEnvMapSunElevation !== null && Math.abs(currentSunElev - lastEnvMapSunElevation) < 5) return;
  lastEnvMapSunElevation = currentSunElev;

  const skyScene = new THREE.Scene();
  const skyCopy = new THREE.Mesh(sky.geometry, sky.material);
  skyScene.add(skyCopy);

  if (!pmremGenerator) pmremGenerator = new THREE.PMREMGenerator(renderer);
  if (envMapRT) envMapRT.dispose();
  envMapRT = pmremGenerator.fromScene(skyScene, 0, 0.1, CAMERA_FAR);
  skyScene.remove(skyCopy);
}

export function getEnvironmentMap() {
  return envMapRT ? envMapRT.texture : null;
}

export function setSunPosition(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);

  sunPosition.setFromSphericalCoords(1, phi, theta);

  if (sky) {
    sky.material.uniforms.sunDirection.value.copy(sunPosition).normalize();
  }

  // Sync directional light with sky sun
  sun.position.copy(sunPosition).multiplyScalar(2000);

  // Fog color handled in updateTimeOfDayLighting
}

export function getSunDirection() {
  return sunDirection.copy(sunPosition).normalize();
}

export function configureShadowQuality(level = 'high') {
  const preset = SHADOW_QUALITY_PRESETS[level] || SHADOW_QUALITY_PRESETS.high;
  if (!renderer || !sun) return preset;

  renderer.shadowMap.enabled = preset.enabled;
  sun.castShadow = preset.enabled;
  sun.shadow.mapSize.set(preset.mapSize, preset.mapSize);
  sun.shadow.camera.left = -preset.frustum;
  sun.shadow.camera.right = preset.frustum;
  sun.shadow.camera.top = preset.frustum;
  sun.shadow.camera.bottom = -preset.frustum;
  sun.shadow.bias = preset.bias;
  sun.shadow.radius = preset.radius;
  sun.shadow.needsUpdate = true;

  // Force shadow map reallocation when quality changes.
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }

  return preset;
}

function createLensflare() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 255, 240, 1.0)');
  gradient.addColorStop(0.1, 'rgba(255, 240, 200, 0.8)');
  gradient.addColorStop(0.4, 'rgba(255, 200, 100, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 180, 60, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const flareTexture = new THREE.CanvasTexture(canvas);

  const canvas2 = document.createElement('canvas');
  canvas2.width = 128;
  canvas2.height = 128;
  const ctx2 = canvas2.getContext('2d');
  const gradient2 = ctx2.createRadialGradient(64, 64, 30, 64, 64, 64);
  gradient2.addColorStop(0, 'rgba(255, 255, 255, 0.0)');
  gradient2.addColorStop(0.7, 'rgba(180, 200, 255, 0.05)');
  gradient2.addColorStop(0.9, 'rgba(150, 180, 255, 0.1)');
  gradient2.addColorStop(1, 'rgba(100, 150, 255, 0.0)');
  ctx2.fillStyle = gradient2;
  ctx2.fillRect(0, 0, 128, 128);
  const flareTexture2 = new THREE.CanvasTexture(canvas2);

  lensflare = new Lensflare();
  lensflare.addElement(new LensflareElement(flareTexture, 400, 0, new THREE.Color(1, 0.95, 0.8)));
  lensflare.addElement(new LensflareElement(flareTexture2, 200, 0.1));
  lensflare.addElement(new LensflareElement(flareTexture2, 100, 0.3));

  sun.add(lensflare);
}

function createStarField() {
  const count = 2000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Random points on a sphere
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 8000;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)); // Only upper hemisphere
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 1 + Math.random() * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: false,
  });

  starField = new THREE.Points(geometry, material);
  starField.visible = false;
  scene.add(starField);
}

function createMoon() {
  const moonGeo = new THREE.SphereGeometry(50, 16, 12);
  const moonMat = new THREE.MeshStandardMaterial({
    color: 0xeeeeff,
    emissive: 0xaabbcc,
    emissiveIntensity: 0.5,
    roughness: 0.8,
  });
  moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.visible = false;
  scene.add(moonMesh);
}

// Time of day system
export function setTimeOfDay(hours) {
  timeOfDay = ((hours % 24) + 24) % 24;
  updateTimeOfDayLighting();
}

export function getTimeOfDay() {
  return timeOfDay;
}

export function toggleAutoCycleTime() {
  autoCycleTime = !autoCycleTime;
  return autoCycleTime;
}

export function isAutoCycling() {
  return autoCycleTime;
}

export function isNight() {
  return timeOfDay < 6 || timeOfDay > 19;
}

export function updateTimeOfDay(dt) {
  if (autoCycleTime) {
    timeOfDay += (TIME_CYCLE_RATE / 60) * dt; // hours per second
    timeOfDay = timeOfDay % 24;
  }
  updateTimeOfDayLighting();
}

function updateTimeOfDayLighting() {
  // Sun elevation based on time of day
  let sunElevation;
  if (timeOfDay >= 6 && timeOfDay <= 18) {
    // Daytime: sine curve, peak at noon
    sunElevation = 90 * Math.sin(Math.PI * (timeOfDay - 6) / 12);
  } else {
    // Night: sun below horizon
    sunElevation = -10;
  }

  // Sun azimuth: east at 6am, south at noon, west at 6pm
  const sunAzimuth = 90 + (timeOfDay - 6) * 15; // 15 degrees per hour

  setSunPosition(Math.max(sunElevation, -5), sunAzimuth);

  // Day factor: 1 at noon, 0 at night
  const dayFactor = clamp(sunElevation / 45, 0, 1);
  const duskFactor = clamp((sunElevation + 5) / 15, 0, 1); // transition zone

  // Sun intensity
  sun.intensity = lerp(0.0, 3.5, dayFactor);

  // Ambient light (boosted at night to compensate for removed PointLights)
  if (ambientLight) {
    ambientLight.intensity = lerp(0.25, 1.0, duskFactor);
    if (duskFactor < 0.3) {
      ambientLight.color.setHex(0x112244); // blue tint at night
    } else {
      ambientLight.color.setHex(0xd0d0d0);
    }
  }

  // Hemisphere light (blue sky tint at night)
  if (hemiLight) {
    hemiLight.intensity = lerp(0.15, 0.8, duskFactor);
    if (duskFactor < 0.3) {
      hemiLight.color.setHex(0x1a2a4a); // blue tint at night
    } else {
      hemiLight.color.setHex(0xc0d8f0);
    }
  }

  // Sky palette + fog color matched to horizon
  const skyPalette = getSkyPalette(sunElevation);
  if (sky) {
    sky.material.uniforms.horizonColor.value.setRGB(...skyPalette.horizon);
    sky.material.uniforms.zenithColor.value.setRGB(...skyPalette.zenith);
    sky.material.uniforms.sunColor.value.setRGB(...skyPalette.sun);
  }

  // Fog color matches sky horizon for seamless blending
  if (scene.fog) {
    _fogColor.setRGB(...skyPalette.horizon);
    scene.fog.color.copy(_fogColor);
    renderer.setClearColor(_fogColor);
  }

  // Tone mapping exposure
  renderer.toneMappingExposure = lerp(0.25, 0.75, duskFactor);

  // Stars visibility
  if (starField) {
    const starOpacity = clamp(1 - sunElevation / 10, 0, 0.8);
    starField.visible = starOpacity > 0.01;
    starField.material.opacity = starOpacity;
  }

  // Moon
  if (moonMesh) {
    const moonVisible = sunElevation < 5;
    moonMesh.visible = moonVisible;

    if (moonVisible) {
      // Moon opposite sun
      const moonAzRad = THREE.MathUtils.degToRad(sunAzimuth + 180);
      const moonElev = 30 + Math.sin(timeOfDay * 0.3) * 20;
      const moonDist = 5000;
      moonMesh.position.set(
        Math.sin(moonAzRad) * Math.cos(THREE.MathUtils.degToRad(moonElev)) * moonDist,
        Math.sin(THREE.MathUtils.degToRad(moonElev)) * moonDist,
        Math.cos(moonAzRad) * Math.cos(THREE.MathUtils.degToRad(moonElev)) * moonDist
      );
    }
  }

  // Lensflare visibility
  if (lensflare) {
    lensflare.visible = sunElevation > 0;
  }

}

export function updateSunTarget(target) {
  sun.target.position.copy(target);
}

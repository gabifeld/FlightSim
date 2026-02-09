import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { onResize } from './postprocessing.js';
import { DEFAULT_TIME_OF_DAY, TIME_CYCLE_RATE } from './constants.js';
import { clamp, lerp } from './utils.js';

export let scene, renderer;
export let sun;
export let ambientLight, hemiLight;

let sky;
let lensflare;
const sunPosition = new THREE.Vector3();

// Time of day system
let timeOfDay = DEFAULT_TIME_OF_DAY; // 0-24 hours
let autoCycleTime = false;

// Star field
let starField = null;

// Moon
let moonMesh = null;
let moonLight = null;

export function initScene(container) {
  scene = new THREE.Scene();
  // No fog — clean clear sky

  renderer = new THREE.WebGLRenderer({ antialias: false }); // SMAA replaces native AA
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.65;
  renderer.setClearColor(0x4a90d9);
  container.appendChild(renderer.domElement);

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
  sun.shadow.camera.left = -600;
  sun.shadow.camera.right = 600;
  sun.shadow.camera.top = 600;
  sun.shadow.camera.bottom = -600;
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
    onResize(w, h);
  });

  return { scene, renderer };
}

function createSky() {
  sky = new Sky();
  sky.scale.setScalar(30000);
  sky.material.fog = false;
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 0.3;
  skyUniforms['rayleigh'].value = 2.5;
  skyUniforms['mieCoefficient'].value = 0.0003;
  skyUniforms['mieDirectionalG'].value = 0.7;

  setSunPosition(45, 180);
}

export function setSunPosition(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);

  sunPosition.setFromSphericalCoords(1, phi, theta);

  if (sky) {
    sky.material.uniforms['sunPosition'].value.copy(sunPosition);
  }

  // Sync directional light with sky sun
  sun.position.copy(sunPosition).multiplyScalar(2000);

  // Sync fog color with sky (if fog enabled)
  if (scene.fog) {
    const fogColor = new THREE.Color();
    fogColor.setHSL(0.58, 0.35, 0.72 + elevationDeg * 0.001);
    scene.fog.color.copy(fogColor);
  }
}

export function getSunDirection() {
  return sunPosition.clone().normalize();
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

  moonLight = new THREE.PointLight(0x8899bb, 0, 5000);
  moonLight.visible = false;
  scene.add(moonLight);
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

  // Ambient light
  if (ambientLight) {
    ambientLight.intensity = lerp(0.08, 1.0, duskFactor);
    if (duskFactor < 0.3) {
      ambientLight.color.setHex(0x112244); // blue tint at night
    } else {
      ambientLight.color.setHex(0xd0d0d0);
    }
  }

  // Hemisphere light
  if (hemiLight) {
    hemiLight.intensity = lerp(0.15, 0.8, duskFactor);
  }

  // Fog density
  if (scene.fog) {
    scene.fog.density = lerp(0.000025, 0.000008, dayFactor);

    // Fog color: blue day -> orange sunset -> dark navy night
    const fogColor = new THREE.Color();
    if (sunElevation > 10) {
      fogColor.setHSL(0.57, 0.35, 0.76);
    } else if (sunElevation > 0) {
      // Sunset/sunrise: warm orange
      const t = sunElevation / 10;
      fogColor.setHSL(0.08 + t * 0.49, 0.65, 0.3 + t * 0.42);
    } else {
      fogColor.setHSL(0.62, 0.3, 0.08);
    }
    scene.fog.color.copy(fogColor);
  }

  // Tone mapping exposure
  renderer.toneMappingExposure = lerp(0.25, 0.65, duskFactor);

  // Stars visibility
  if (starField) {
    const starOpacity = clamp(1 - sunElevation / 10, 0, 0.8);
    starField.visible = starOpacity > 0.01;
    starField.material.opacity = starOpacity;
  }

  // Moon
  if (moonMesh && moonLight) {
    const moonVisible = sunElevation < 5;
    moonMesh.visible = moonVisible;
    moonLight.visible = moonVisible;

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
      moonLight.position.copy(moonMesh.position);
      moonLight.intensity = clamp(1 - sunElevation / 5, 0, 0.2);
    }
  }

  // Lensflare visibility
  if (lensflare) {
    lensflare.visible = sunElevation > 0;
  }

  // Sky parameters for sunrise/sunset
  if (sky) {
    const skyUniforms = sky.material.uniforms;
    if (sunElevation < 10 && sunElevation > -5) {
      // Sunset/sunrise: more turbidity for warm colors
      skyUniforms['turbidity'].value = lerp(6, 0.3, clamp(sunElevation / 10, 0, 1));
      skyUniforms['rayleigh'].value = lerp(2.0, 2.5, clamp(sunElevation / 10, 0, 1));
    } else if (sunElevation <= -5) {
      skyUniforms['turbidity'].value = 2;
      skyUniforms['rayleigh'].value = 0.5;
    } else {
      // Deep clear blue sky during day
      skyUniforms['turbidity'].value = 0.3;
      skyUniforms['rayleigh'].value = 2.5;
    }
  }
}

export function updateSunTarget(target) {
  sun.target.position.copy(target);
}

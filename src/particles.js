// GPU particle effects: tire smoke, dust, engine exhaust
import * as THREE from 'three';
import { aircraftState } from './aircraft.js';
import { getAircraftType } from './aircraftTypes.js';

// Particle system pools
let tireSmoke = null;
let dustCloud = null;
let exhaustLeft = null;
let exhaustRight = null;
let sceneRef = null;

const MAX_TIRE_PARTICLES = 200;
const MAX_DUST_PARTICLES = 100;
const MAX_EXHAUST_PARTICLES = 50;

// Pre-allocated vectors for exhaust calculations (avoid per-frame allocation)
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _basePos = new THREE.Vector3();
const _leftPos = new THREE.Vector3();
const _rightPos = new THREE.Vector3();

// Create soft radial gradient sprite texture
function createParticleTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;

  const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.15)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

function createParticleSystem(maxCount, color, size, opacity, blending) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxCount * 3);
  const velocities = new Float32Array(maxCount * 3);
  const lifetimes = new Float32Array(maxCount);    // total lifetime
  const ages = new Float32Array(maxCount);          // current age
  const active = new Uint8Array(maxCount);          // 0=inactive, 1=active
  const sizes = new Float32Array(maxCount);         // per-particle size

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const texture = createParticleTexture();

  const material = new THREE.PointsMaterial({
    color: color,
    size: size,
    map: texture,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    blending: blending || THREE.NormalBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    positions,
    velocities,
    lifetimes,
    ages,
    active,
    sizes,
    maxCount,
    baseSize: size,
    baseOpacity: opacity,
    nextIndex: 0,
  };
}

function emitParticles(system, count, posX, posY, posZ, velRange, lifetime, sizeRange) {
  for (let i = 0; i < count; i++) {
    const idx = system.nextIndex;
    system.nextIndex = (system.nextIndex + 1) % system.maxCount;

    const i3 = idx * 3;
    system.positions[i3] = posX + (Math.random() - 0.5) * 2;
    system.positions[i3 + 1] = posY + Math.random() * 0.5;
    system.positions[i3 + 2] = posZ + (Math.random() - 0.5) * 2;

    system.velocities[i3] = (Math.random() - 0.5) * velRange;
    system.velocities[i3 + 1] = Math.random() * velRange * 0.5;
    system.velocities[i3 + 2] = (Math.random() - 0.5) * velRange;

    system.lifetimes[idx] = lifetime + Math.random() * lifetime * 0.5;
    system.ages[idx] = 0;
    system.active[idx] = 1;
    system.sizes[idx] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
  }
}

function updateParticleSystem(system, dt) {
  let anyActive = false;
  const posAttr = system.points.geometry.attributes.position;
  const sizeAttr = system.points.geometry.attributes.size;

  for (let i = 0; i < system.maxCount; i++) {
    if (!system.active[i]) {
      // Hide inactive particles far away
      const i3 = i * 3;
      system.positions[i3 + 1] = -1000;
      sizeAttr.array[i] = 0;
      continue;
    }

    anyActive = true;
    system.ages[i] += dt;

    if (system.ages[i] >= system.lifetimes[i]) {
      system.active[i] = 0;
      const i3 = i * 3;
      system.positions[i3 + 1] = -1000;
      sizeAttr.array[i] = 0;
      continue;
    }

    const i3 = i * 3;
    const t = system.ages[i] / system.lifetimes[i]; // 0..1

    // Update position
    system.positions[i3] += system.velocities[i3] * dt;
    system.positions[i3 + 1] += system.velocities[i3 + 1] * dt;
    system.positions[i3 + 2] += system.velocities[i3 + 2] * dt;

    // Slow down velocity
    system.velocities[i3] *= 0.98;
    system.velocities[i3 + 1] *= 0.98;
    system.velocities[i3 + 2] *= 0.98;

    // Expand size over time
    sizeAttr.array[i] = system.sizes[i] * (1 + t * 3);
  }

  posAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;

  // Fade opacity based on active particle ratio
  system.points.visible = anyActive;
}

export function initParticles(scene) {
  sceneRef = scene;

  tireSmoke = createParticleSystem(MAX_TIRE_PARTICLES, 0xcccccc, 3, 0.5, THREE.NormalBlending);
  dustCloud = createParticleSystem(MAX_DUST_PARTICLES, 0xaa8855, 4, 0.4, THREE.NormalBlending);
  exhaustLeft = createParticleSystem(MAX_EXHAUST_PARTICLES, 0xff6600, 1.5, 0.3, THREE.AdditiveBlending);
  exhaustRight = createParticleSystem(MAX_EXHAUST_PARTICLES, 0xff6600, 1.5, 0.3, THREE.AdditiveBlending);

  scene.add(tireSmoke.points);
  scene.add(dustCloud.points);
  scene.add(exhaustLeft.points);
  scene.add(exhaustRight.points);
}

export function triggerTireSmoke(intensity) {
  if (!tireSmoke) return;
  const pos = aircraftState.position;
  const count = Math.min(Math.floor(intensity * 30), 50);
  emitParticles(tireSmoke, count, pos.x, pos.y - 1, pos.z, 3 + intensity * 2, 2.0, [1, 4]);
}

export function triggerDustCloud(intensity) {
  if (!dustCloud) return;
  const pos = aircraftState.position;
  const count = Math.min(Math.floor(intensity * 20), 30);
  emitParticles(dustCloud, count, pos.x, pos.y - 1, pos.z, 2 + intensity, 2.5, [2, 5]);
}

export function updateParticles(dt) {
  if (tireSmoke) updateParticleSystem(tireSmoke, dt);
  if (dustCloud) updateParticleSystem(dustCloud, dt);
  if (exhaustLeft) updateParticleSystem(exhaustLeft, dt);
  if (exhaustRight) updateParticleSystem(exhaustRight, dt);

  // Engine exhaust - continuous when throttle > 70%
  if (aircraftState.throttle > 0.7 && !aircraftState.onGround) {
    const type = getAircraftType(aircraftState.currentType);
    const pos = aircraftState.position;
    _fwd.set(0, 0, 1).applyQuaternion(aircraftState.quaternion);
    _right.set(1, 0, 0).applyQuaternion(aircraftState.quaternion);

    const exhaustOffset = type.fuselageLength * 0.5;
    _basePos.copy(pos).addScaledVector(_fwd, exhaustOffset);

    if (type.type === 'fighter') {
      // Single engine exhaust
      if (exhaustLeft) {
        emitParticles(exhaustLeft, 2, _basePos.x, _basePos.y, _basePos.z,
          2 + aircraftState.throttle * 3, 0.5, [0.5, 2]);
      }
    } else if (type.engineCount >= 2) {
      const nacSpacing = type.wingSpan * 0.28;
      _leftPos.copy(_basePos).addScaledVector(_right, -nacSpacing);
      _rightPos.copy(_basePos).addScaledVector(_right, nacSpacing);

      if (exhaustLeft) {
        emitParticles(exhaustLeft, 1, _leftPos.x, _leftPos.y, _leftPos.z,
          1 + aircraftState.throttle * 2, 0.4, [0.3, 1.5]);
      }
      if (exhaustRight) {
        emitParticles(exhaustRight, 1, _rightPos.x, _rightPos.y, _rightPos.z,
          1 + aircraftState.throttle * 2, 0.4, [0.3, 1.5]);
      }
    }
  }
}

// Crash effect systems: fireball particles, smoke particles, debris meshes, flash, shake
import * as THREE from 'three';
import { getGroundLevel } from './terrain.js';

let fireball = null;
let smoke = null;
let sceneRef = null;

// Debris mesh system
const debrisTemplates = [];
const DEBRIS_TEMPLATE_COUNT = 8;
const MAX_DEBRIS = 20;
let debrisFragments = []; // active debris mesh objects

// Impact flash
let flashIntensity = 0;

// Crash shake
let crashShakeIntensity = 0;
let crashShakeElapsed = 0;

const MAX_FIREBALL = 150;
const MAX_SMOKE = 150;

const GRAVITY = 9.8;

// Pre-allocated temp vectors
const _tmpVec = new THREE.Vector3();
const _tmpEuler = new THREE.Euler();

// Debris color palette (aircraft-like)
const DEBRIS_COLORS = [0xffffff, 0xcccccc, 0xc0c0c0, 0x666666, 0xffffff, 0xaaaaaa, 0xdddddd, 0x555555];

// Pre-allocated colors for fireball/smoke interpolation
const _fireColorStart = new THREE.Color(0xff8800);
const _fireColorEnd = new THREE.Color(0x661100);
const _smokeColorStart = new THREE.Color(0x333333);
const _smokeColorEnd = new THREE.Color(0x999999);
const _tmpColor = new THREE.Color();

// --- Local helpers (same pattern as particles.js) ---

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
  const lifetimes = new Float32Array(maxCount);
  const ages = new Float32Array(maxCount);
  const active = new Uint8Array(maxCount);
  const sizes = new Float32Array(maxCount);
  const colors = new Float32Array(maxCount * 3);

  const baseCol = new THREE.Color(color);
  for (let i = 0; i < maxCount; i++) {
    colors[i * 3] = baseCol.r;
    colors[i * 3 + 1] = baseCol.g;
    colors[i * 3 + 2] = baseCol.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const texture = createParticleTexture();

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: size,
    map: texture,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    blending: blending || THREE.NormalBlending,
    sizeAttenuation: true,
    vertexColors: true,
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
    colors,
    maxCount,
    baseSize: size,
    baseOpacity: opacity,
    baseColor: baseCol,
    nextIndex: 0,
  };
}

function emitParticles(system, count, posX, posY, posZ, velRange, lifetimeMin, lifetimeMax, sizeRange) {
  for (let i = 0; i < count; i++) {
    const idx = system.nextIndex;
    system.nextIndex = (system.nextIndex + 1) % system.maxCount;

    const i3 = idx * 3;
    system.positions[i3] = posX + (Math.random() - 0.5) * 2;
    system.positions[i3 + 1] = posY + Math.random() * 0.5;
    system.positions[i3 + 2] = posZ + (Math.random() - 0.5) * 2;

    system.velocities[i3] = (Math.random() - 0.5) * 2 * velRange;
    system.velocities[i3 + 1] = Math.random() * velRange;
    system.velocities[i3 + 2] = (Math.random() - 0.5) * 2 * velRange;

    system.lifetimes[idx] = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);
    system.ages[idx] = 0;
    system.active[idx] = 1;
    system.sizes[idx] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);

    // Reset per-particle color to base
    system.colors[i3] = system.baseColor.r;
    system.colors[i3 + 1] = system.baseColor.g;
    system.colors[i3 + 2] = system.baseColor.b;
  }
}

// --- Debris template creation ---

function createDebrisTemplates() {
  debrisTemplates.length = 0;
  for (let t = 0; t < DEBRIS_TEMPLATE_COUNT; t++) {
    const sx = 0.5 + Math.random() * 1.5;
    const sy = 0.5 + Math.random() * 1.5;
    const sz = 0.5 + Math.random() * 1.5;
    const geo = new THREE.BoxGeometry(sx, sy, sz, 2, 2, 2);

    // Randomize vertices for angular shard look
    const posAttr = geo.attributes.position;
    for (let v = 0; v < posAttr.count; v++) {
      posAttr.setX(v, posAttr.getX(v) + (Math.random() - 0.5) * sx * 0.3);
      posAttr.setY(v, posAttr.getY(v) + (Math.random() - 0.5) * sy * 0.3);
      posAttr.setZ(v, posAttr.getZ(v) + (Math.random() - 0.5) * sz * 0.3);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      color: DEBRIS_COLORS[t],
      transparent: true,
      opacity: 1.0,
    });

    debrisTemplates.push({ geometry: geo, material: mat });
  }
}

function spawnDebrisFragments(px, py, pz) {
  for (let i = 0; i < MAX_DEBRIS; i++) {
    const tmpl = debrisTemplates[Math.floor(Math.random() * DEBRIS_TEMPLATE_COUNT)];
    const mesh = new THREE.Mesh(tmpl.geometry.clone(), tmpl.material.clone());
    mesh.position.set(
      px + (Math.random() - 0.5) * 3,
      py + Math.random() * 1.5,
      pz + (Math.random() - 0.5) * 3
    );

    // Random outward velocity 10-30 m/s
    const speed = 10 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.4; // mostly upward-outward
    const vx = Math.sin(theta) * Math.cos(phi) * speed;
    const vy = Math.abs(Math.sin(phi)) * speed * 0.5 + Math.random() * 10;
    const vz = Math.cos(theta) * Math.cos(phi) * speed;

    // Random angular velocity 2-8 rad/s per axis
    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * 2 * (2 + Math.random() * 6),
      (Math.random() - 0.5) * 2 * (2 + Math.random() * 6),
      (Math.random() - 0.5) * 2 * (2 + Math.random() * 6)
    );

    // Random initial rotation
    mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    sceneRef.add(mesh);

    debrisFragments.push({
      mesh,
      velocity: new THREE.Vector3(vx, vy, vz),
      angularVelocity: angVel,
      age: 0,
      grounded: false,
      totalLife: 15, // visible 12s, then fade over 3s
    });
  }
}

function updateDebrisFragments(dt) {
  for (let i = debrisFragments.length - 1; i >= 0; i--) {
    const frag = debrisFragments[i];
    frag.age += dt;

    // Remove after total lifetime
    if (frag.age >= frag.totalLife) {
      sceneRef.remove(frag.mesh);
      frag.mesh.geometry.dispose();
      frag.mesh.material.dispose();
      debrisFragments.splice(i, 1);
      continue;
    }

    // Fade: visible for 12s at full opacity, then fade 1→0 over 3s
    if (frag.age > 12) {
      const fadeT = (frag.age - 12) / 3;
      frag.mesh.material.opacity = Math.max(0, 1 - fadeT);
    }

    if (!frag.grounded) {
      // Apply gravity
      frag.velocity.y -= GRAVITY * dt;

      // Update position
      frag.mesh.position.x += frag.velocity.x * dt;
      frag.mesh.position.y += frag.velocity.y * dt;
      frag.mesh.position.z += frag.velocity.z * dt;

      // Tumble rotation
      frag.mesh.rotation.x += frag.angularVelocity.x * dt;
      frag.mesh.rotation.y += frag.angularVelocity.y * dt;
      frag.mesh.rotation.z += frag.angularVelocity.z * dt;

      // Ground collision check
      const groundY = getGroundLevel(frag.mesh.position.x, frag.mesh.position.z);
      if (frag.mesh.position.y <= groundY + 0.2) {
        frag.mesh.position.y = groundY + 0.2;
        frag.grounded = true;
        frag.velocity.set(0, 0, 0);
        frag.angularVelocity.set(0, 0, 0);
      }

      // Air drag
      frag.velocity.x *= 0.995;
      frag.velocity.z *= 0.995;
    }
  }
}

function removeAllDebris() {
  for (let i = 0; i < debrisFragments.length; i++) {
    const frag = debrisFragments[i];
    sceneRef.remove(frag.mesh);
    frag.mesh.geometry.dispose();
    frag.mesh.material.dispose();
  }
  debrisFragments.length = 0;
}

// --- Exported API ---

export function initCrashFx(scene) {
  sceneRef = scene;

  fireball = createParticleSystem(MAX_FIREBALL, 0xff8800, 10, 0.9, THREE.AdditiveBlending);
  smoke = createParticleSystem(MAX_SMOKE, 0x333333, 15, 0.6, THREE.NormalBlending);

  scene.add(fireball.points);
  scene.add(smoke.points);

  // Create reusable debris mesh templates
  createDebrisTemplates();
}

export function triggerCrash(position) {
  if (!fireball || !smoke) return;

  const px = position.x;
  const py = position.y;
  const pz = position.z;

  // Fireball: 150 particles, burst outward, short-lived
  emitParticles(fireball, MAX_FIREBALL, px, py, pz, 15, 0.3, 0.8, [12, 22]);

  // Smoke: 150 particles, slow spread, rises, long-lived (6-10s)
  emitParticles(smoke, MAX_SMOKE, px, py, pz, 3, 6, 10, [10, 20]);

  // Debris: spawn 20 mesh fragments
  spawnDebrisFragments(px, py, pz);

  // Impact flash
  flashIntensity = 1.0;

  // Crash shake
  crashShakeIntensity = 1.0;
  crashShakeElapsed = 0;
}

export function updateCrashFx(dt) {
  if (!fireball || !smoke) return;

  updateSystem(fireball, dt, 'fireball');
  updateSystem(smoke, dt, 'smoke');
  updateDebrisFragments(dt);

  // Decay flash: 1→0 over 0.1s
  if (flashIntensity > 0) {
    flashIntensity = Math.max(0, flashIntensity - dt / 0.1);
  }

  // Decay shake: exp(-elapsed * 5) over ~0.8s
  if (crashShakeIntensity > 0) {
    crashShakeElapsed += dt;
    crashShakeIntensity = Math.exp(-crashShakeElapsed * 5);
    if (crashShakeIntensity < 0.001) {
      crashShakeIntensity = 0;
    }
  }
}

function updateSystem(system, dt, type) {
  let anyActive = false;
  const posAttr = system.points.geometry.attributes.position;
  const sizeAttr = system.points.geometry.attributes.size;
  const colorAttr = system.points.geometry.attributes.color;

  for (let i = 0; i < system.maxCount; i++) {
    if (!system.active[i]) {
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

    // Apply rising effect to smoke with buoyancy 3.0
    if (type === 'smoke') {
      system.velocities[i3 + 1] += 3.0 * dt;
    }

    // Update positions from velocities
    system.positions[i3] += system.velocities[i3] * dt;
    system.positions[i3 + 1] += system.velocities[i3 + 1] * dt;
    system.positions[i3 + 2] += system.velocities[i3 + 2] * dt;

    // Slow down velocities (drag)
    if (type === 'fireball') {
      system.velocities[i3] *= 0.95;
      system.velocities[i3 + 1] *= 0.95;
      system.velocities[i3 + 2] *= 0.95;
    } else if (type === 'smoke') {
      system.velocities[i3] *= 0.98;
      system.velocities[i3 + 2] *= 0.98;
    }

    // Size evolution
    if (type === 'fireball') {
      // Fireball expands then fades
      sizeAttr.array[i] = system.sizes[i] * (1 + t * 2) * (1 - t);
    } else if (type === 'smoke') {
      // Smoke expands over time
      sizeAttr.array[i] = system.sizes[i] * (1 + t * 3);
    }

    // Per-particle color shift over lifetime
    if (type === 'fireball') {
      // Orange-yellow → dark red
      _tmpColor.copy(_fireColorStart).lerp(_fireColorEnd, t);
      const fade = 1 - t;
      colorAttr.array[i3] = _tmpColor.r * fade;
      colorAttr.array[i3 + 1] = _tmpColor.g * fade;
      colorAttr.array[i3 + 2] = _tmpColor.b * fade;
    } else if (type === 'smoke') {
      // Dark gray → light gray
      _tmpColor.copy(_smokeColorStart).lerp(_smokeColorEnd, t);
      const fade = 1 - t * 0.5; // smoke fades slower
      colorAttr.array[i3] = _tmpColor.r * fade;
      colorAttr.array[i3 + 1] = _tmpColor.g * fade;
      colorAttr.array[i3 + 2] = _tmpColor.b * fade;
    }
  }

  posAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;

  // Fade material opacity based on age for fireball
  if (type === 'fireball') {
    system.points.material.opacity = system.baseOpacity;
  }

  system.points.visible = anyActive;
}

export function resetCrashFx() {
  const systems = [fireball, smoke];
  for (const system of systems) {
    if (!system) continue;
    for (let i = 0; i < system.maxCount; i++) {
      system.active[i] = 0;
      const i3 = i * 3;
      system.positions[i3 + 1] = -1000;
      system.sizes[i] = 0;
    }
    system.points.geometry.attributes.position.needsUpdate = true;
    system.points.geometry.attributes.size.needsUpdate = true;
    system.points.visible = false;
    system.nextIndex = 0;
  }

  // Remove all debris meshes and dispose resources
  removeAllDebris();

  // Reset flash and shake
  flashIntensity = 0;
  crashShakeIntensity = 0;
  crashShakeElapsed = 0;
}

// --- New exports ---

export function getFlashIntensity() {
  return flashIntensity;
}

export function getCrashShakeIntensity() {
  return crashShakeIntensity;
}

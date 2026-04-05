// Missile system for fighter aircraft
import * as THREE from 'three';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { getAircraftType } from './aircraftTypes.js';
import { playExplosion } from './audio.js';

let sceneRef = null;
const missiles = [];
const explosions = [];
const MAX_MISSILES = 6;
const MAX_EXPLOSIONS = 6;
const MISSILE_SPEED = 400; // m/s
const MISSILE_ACCEL = 200; // m/s² boost phase
const MISSILE_LIFETIME = 8; // seconds
const MISSILE_COOLDOWN = 0.5; // seconds between shots
const EXPLOSION_DURATION = 1.5; // seconds
let lastFireTime = 0;
let ammoCount = MAX_MISSILES;

// Reusable vectors
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

// Shared geometries & materials (created once)
let missileBodyGeo, missileNoseGeo, missileFinGeo;
let missileMat, noseMat, flameMat, trailMat;
let smokeTexture;

function createSmokeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(200,200,200,0.6)');
  gradient.addColorStop(1, 'rgba(150,150,150,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function initSharedAssets() {
  if (missileBodyGeo) return;

  missileBodyGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.0, 8);
  missileBodyGeo.rotateX(Math.PI / 2);

  missileNoseGeo = new THREE.ConeGeometry(0.08, 0.3, 8);
  missileNoseGeo.rotateX(-Math.PI / 2);

  missileFinGeo = new THREE.BoxGeometry(0.35, 0.02, 0.2);

  missileMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8e0,
    roughness: 0.4,
    metalness: 0.3,
  });

  noseMat = new THREE.MeshStandardMaterial({
    color: 0x444444,
    roughness: 0.6,
    metalness: 0.2,
  });

  flameMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main() {
        float axial = vUv.y;
        float radial = abs(vUv.x - 0.5) * 2.0;
        float flame = (1.0 - axial) * (1.0 - radial * 0.8);
        flame = pow(flame, 0.5);
        float flicker = 0.85 + 0.15 * hash(vec2(uTime * 30.0, axial));
        vec3 col = mix(vec3(1.0, 0.9, 0.7), vec3(1.0, 0.4, 0.05), axial);
        float alpha = flame * uIntensity * flicker * 0.9;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });

  smokeTexture = createSmokeTexture();

  trailMat = new THREE.PointsMaterial({
    color: 0xcccccc,
    size: 1.5,
    map: smokeTexture,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });
}

function createMissile() {
  const group = new THREE.Group();

  // Body
  const body = new THREE.Mesh(missileBodyGeo, missileMat);
  group.add(body);

  // Nose cone
  const nose = new THREE.Mesh(missileNoseGeo, noseMat);
  nose.position.z = -1.15;
  group.add(nose);

  // 4 fins (cross pattern)
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(missileFinGeo, missileMat);
    fin.position.z = 0.8;
    fin.rotation.z = (i * Math.PI) / 2;
    if (i % 2 === 0) {
      fin.position.y = 0;
    }
    group.add(fin);
  }

  // Exhaust flame (cone behind missile)
  const flameGeo = new THREE.ConeGeometry(0.06, 0.8, 8);
  flameGeo.rotateX(Math.PI / 2);
  const flame = new THREE.Mesh(flameGeo, flameMat.clone());
  flame.position.z = 1.4;
  group.add(flame);

  // Point light for glow
  const light = new THREE.PointLight(0xff6622, 2, 15);
  light.position.z = 1.2;
  group.add(light);

  // Smoke trail (ring buffer of points)
  const trailCount = 60;
  const trailPositions = new Float32Array(trailCount * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trail = new THREE.Points(trailGeo, trailMat.clone());
  trail.frustumCulled = false;

  return {
    group,
    flame,
    light,
    trail,
    trailPositions,
    trailIndex: 0,
    trailCount,
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    age: 0,
    active: false,
    speed: 0,
  };
}

export function initMissiles(scene) {
  sceneRef = scene;
  initSharedAssets();

  // Pre-create missile pool
  for (let i = 0; i < MAX_MISSILES; i++) {
    const m = createMissile();
    m.group.visible = false;
    m.trail.visible = false;
    scene.add(m.group);
    scene.add(m.trail);
    missiles.push(m);
  }
}

export function fireMissile() {
  const v = getActiveVehicle();
  if (!isAircraft(v)) return false;
  const type = getAircraftType(v.currentType);
  if (!type || type.type !== 'fighter') return false;

  const now = performance.now() * 0.001;
  if (now - lastFireTime < MISSILE_COOLDOWN) return false;
  if (ammoCount <= 0) return false;

  // Find inactive missile
  const m = missiles.find(m => !m.active);
  if (!m) return false;

  lastFireTime = now;
  ammoCount--;

  // Get aircraft forward direction and wing positions
  _fwd.set(0, 0, -1).applyQuaternion(v.quaternion);
  _right.set(1, 0, 0).applyQuaternion(v.quaternion);
  _up.set(0, 1, 0).applyQuaternion(v.quaternion);

  // Launch from under wing (alternate sides)
  const side = (MAX_MISSILES - ammoCount) % 2 === 0 ? 1 : -1;
  const wingOffset = (type.wingSpan || 10) * 0.25;

  m.group.position.copy(v.position);
  m.group.position.addScaledVector(_right, side * wingOffset);
  m.group.position.addScaledVector(_up, -0.5);

  // Orient along aircraft heading
  m.group.quaternion.copy(v.quaternion);

  // Initial velocity = aircraft speed + launch boost
  m.direction.copy(_fwd);
  m.speed = v.speed + 50;
  m.velocity.copy(_fwd).multiplyScalar(m.speed);
  m.age = 0;
  m.active = true;
  m.group.visible = true;
  m.trail.visible = true;

  // Reset trail
  for (let i = 0; i < m.trailCount * 3; i++) {
    m.trailPositions[i] = m.group.position.x + (i % 3 === 0 ? 0 : i % 3 === 1 ? -1000 : 0);
  }
  m.trailPositions[1] = -1000; // hide initially
  m.trailIndex = 0;

  // Reset flame
  if (m.flame.material.uniforms) {
    m.flame.material.uniforms.uIntensity.value = 1;
  }

  return true;
}

export function updateMissiles(dt) {
  updateExplosions(dt);
  const t = performance.now() * 0.001;

  for (const m of missiles) {
    if (!m.active) continue;

    m.age += dt;

    if (m.age > MISSILE_LIFETIME) {
      deactivateMissile(m, false); // fizzle, no explosion
      continue;
    }

    // Accelerate during boost phase (first 3 seconds)
    if (m.age < 3.0) {
      m.speed += MISSILE_ACCEL * dt;
      if (m.speed > MISSILE_SPEED) m.speed = MISSILE_SPEED;
    }

    // Update velocity
    m.velocity.copy(m.direction).multiplyScalar(m.speed);

    // Slight gravity
    m.velocity.y -= 2.0 * dt;

    // Move
    m.group.position.addScaledVector(m.velocity, dt);

    // Orient to velocity
    const lookTarget = m.group.position.clone().add(m.velocity);
    m.group.lookAt(lookTarget);

    // Ground collision
    if (m.group.position.y < 0) {
      deactivateMissile(m);
      continue;
    }

    // Animate flame
    if (m.flame.material.uniforms) {
      m.flame.material.uniforms.uTime.value = t;
      const boostFade = m.age < 3 ? 1.0 : Math.max(0, 1.0 - (m.age - 3) * 0.5);
      m.flame.material.uniforms.uIntensity.value = boostFade;
      m.light.intensity = boostFade * 3;
    }

    // Flame scale flicker
    const flicker = 0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 73);
    m.flame.scale.set(flicker, flicker, 0.8 + flicker * 0.4);

    // Update smoke trail
    const ti = m.trailIndex * 3;
    m.trailPositions[ti] = m.group.position.x + (Math.random() - 0.5) * 0.2;
    m.trailPositions[ti + 1] = m.group.position.y + (Math.random() - 0.5) * 0.2;
    m.trailPositions[ti + 2] = m.group.position.z + (Math.random() - 0.5) * 0.2;
    m.trailIndex = (m.trailIndex + 1) % m.trailCount;
    m.trail.geometry.attributes.position.needsUpdate = true;
  }
}

function createExplosion() {
  const group = new THREE.Group();

  // Fireball — bright expanding sphere
  const fireballGeo = new THREE.SphereGeometry(1, 8, 6);
  const fireballMat = new THREE.MeshBasicMaterial({
    color: 0xff8800,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fireball = new THREE.Mesh(fireballGeo, fireballMat);
  group.add(fireball);

  // Inner white-hot core
  const coreGeo = new THREE.SphereGeometry(0.5, 6, 4);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffcc,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Smoke ring — darker expanding ring
  const smokeGeo = new THREE.SphereGeometry(1, 8, 6);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x333333,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const smoke = new THREE.Mesh(smokeGeo, smokeMat);
  group.add(smoke);

  // Point light for illumination
  const light = new THREE.PointLight(0xff6600, 8, 50);
  group.add(light);

  // Debris particles (small points flying outward)
  const debrisCount = 20;
  const debrisPositions = new Float32Array(debrisCount * 3);
  const debrisVelocities = new Float32Array(debrisCount * 3);
  const debrisGeo = new THREE.BufferGeometry();
  debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
  const debrisMat = new THREE.PointsMaterial({
    color: 0xffaa44,
    size: 0.8,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const debris = new THREE.Points(debrisGeo, debrisMat);
  debris.frustumCulled = false;

  return {
    group,
    fireball,
    fireballMat,
    core,
    coreMat,
    smoke,
    smokeMat,
    light,
    debris,
    debrisPositions,
    debrisVelocities,
    debrisCount,
    age: 0,
    active: false,
  };
}

function spawnExplosion(x, y, z) {
  if (!sceneRef) return;

  let exp = explosions.find(e => !e.active);
  if (!exp) {
    if (explosions.length >= MAX_EXPLOSIONS) {
      exp = explosions[0]; // reuse oldest
    } else {
      exp = createExplosion();
      sceneRef.add(exp.group);
      sceneRef.add(exp.debris);
      explosions.push(exp);
    }
  }

  exp.group.position.set(x, Math.max(y, 0.5), z);
  exp.group.visible = true;
  exp.debris.visible = true;
  exp.age = 0;
  exp.active = true;

  // Reset scales
  exp.fireball.scale.setScalar(1);
  exp.core.scale.setScalar(1);
  exp.smoke.scale.setScalar(0.5);
  exp.fireballMat.opacity = 0.9;
  exp.coreMat.opacity = 1.0;
  exp.smokeMat.opacity = 0.6;
  exp.light.intensity = 8;

  // Initialize debris outward velocities
  for (let i = 0; i < exp.debrisCount; i++) {
    const i3 = i * 3;
    exp.debrisPositions[i3] = x;
    exp.debrisPositions[i3 + 1] = Math.max(y, 0.5);
    exp.debrisPositions[i3 + 2] = z;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = 15 + Math.random() * 25;
    exp.debrisVelocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
    exp.debrisVelocities[i3 + 1] = Math.abs(Math.cos(phi)) * speed * 0.8;
    exp.debrisVelocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
  }
}

function updateExplosions(dt) {
  for (const exp of explosions) {
    if (!exp.active) continue;

    exp.age += dt;
    const t = exp.age / EXPLOSION_DURATION; // 0 to 1

    if (t >= 1) {
      exp.active = false;
      exp.group.visible = false;
      exp.debris.visible = false;
      continue;
    }

    // Fireball: expand fast then slow, fade out
    const fireScale = 2 + t * 8;
    exp.fireball.scale.setScalar(fireScale);
    exp.fireballMat.opacity = 0.9 * (1 - t * t);

    // Core: smaller, fades fast
    const coreScale = 1 + t * 3;
    exp.core.scale.setScalar(coreScale);
    exp.coreMat.opacity = Math.max(0, 1.0 - t * 3);

    // Smoke: expands slower, lingers longer
    const smokeScale = 1 + t * 12;
    exp.smoke.scale.setScalar(smokeScale);
    exp.smokeMat.opacity = 0.5 * (1 - t);
    // Smoke rises
    exp.smoke.position.y += dt * 3;

    // Light fades
    exp.light.intensity = 8 * (1 - t * t);

    // Debris particles fly outward and fall
    for (let i = 0; i < exp.debrisCount; i++) {
      const i3 = i * 3;
      exp.debrisPositions[i3] += exp.debrisVelocities[i3] * dt;
      exp.debrisPositions[i3 + 1] += exp.debrisVelocities[i3 + 1] * dt;
      exp.debrisPositions[i3 + 2] += exp.debrisVelocities[i3 + 2] * dt;
      // Gravity on debris
      exp.debrisVelocities[i3 + 1] -= 20 * dt;
      // Drag
      exp.debrisVelocities[i3] *= 0.98;
      exp.debrisVelocities[i3 + 2] *= 0.98;
    }
    exp.debris.geometry.attributes.position.needsUpdate = true;

    // Fade debris
    exp.debris.material.opacity = Math.max(0, 0.9 * (1 - t));
  }
}

function deactivateMissile(m, explode = true) {
  if (explode) {
    spawnExplosion(m.group.position.x, m.group.position.y, m.group.position.z);
    playExplosion();
  }
  m.active = false;
  m.group.visible = false;
  m.trail.visible = false;
}

export function getAmmoCount() {
  return ammoCount;
}

export function reloadMissiles() {
  ammoCount = MAX_MISSILES;
  for (const m of missiles) {
    deactivateMissile(m, false);
  }
  for (const e of explosions) {
    e.active = false;
    e.group.visible = false;
    e.debris.visible = false;
  }
}

export function resetMissiles() {
  reloadMissiles();
  lastFireTime = 0;
}

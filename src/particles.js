// GPU particle effects: tire smoke, dust, engine exhaust
import * as THREE from 'three';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { getAircraftType } from './aircraftTypes.js';

// Particle system pools
let tireSmoke = null;
let dustCloud = null;
let exhaustLeft = null;
let exhaustRight = null;
let wingVapor = null;
let contrails = null;
let afterburner = null;
let sceneRef = null;

const MAX_TIRE_PARTICLES = 200;
const MAX_DUST_PARTICLES = 100;
const MAX_EXHAUST_PARTICLES = 80;
const MAX_WING_VAPOR = 150;
const MAX_CONTRAIL_PARTICLES = 200;
const MAX_AFTERBURNER_PARTICLES = 120;

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

function createParticleSystem(maxCount, color, size, opacity, blending, opts) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxCount * 3);
  const velocities = new Float32Array(maxCount * 3);
  const lifetimes = new Float32Array(maxCount);    // total lifetime
  const ages = new Float32Array(maxCount);          // current age
  const active = new Uint8Array(maxCount);          // 0=inactive, 1=active
  const sizes = new Float32Array(maxCount);         // per-particle size
  const colors = new Float32Array(maxCount * 3);    // per-particle RGB
  const startOpacities = new Float32Array(maxCount); // per-particle start opacity

  // Fill default color
  const baseCol = new THREE.Color(color);
  for (let i = 0; i < maxCount; i++) {
    colors[i * 3] = baseCol.r;
    colors[i * 3 + 1] = baseCol.g;
    colors[i * 3 + 2] = baseCol.b;
    startOpacities[i] = opacity;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const texture = createParticleTexture();

  const material = new THREE.PointsMaterial({
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

  // Growth mode: 'expand' (default), 'widen' (contrails grow width over time)
  const growthMode = (opts && opts.growthMode) || 'expand';
  // Fade mode: 'uniform' (default), 'tail' (slow fade then rapid drop at end)
  const fadeMode = (opts && opts.fadeMode) || 'uniform';

  return {
    points,
    positions,
    velocities,
    lifetimes,
    ages,
    active,
    sizes,
    colors,
    startOpacities,
    maxCount,
    baseSize: size,
    baseOpacity: opacity,
    baseColor: baseCol,
    nextIndex: 0,
    growthMode,
    fadeMode,
  };
}

// emitOpts: { color: THREE.Color, opacity: number, spread: number, velBias: [x,y,z] }
function emitParticles(system, count, posX, posY, posZ, velRange, lifetime, sizeRange, emitOpts) {
  const spread = (emitOpts && emitOpts.spread !== undefined) ? emitOpts.spread : 2;
  const biasX = (emitOpts && emitOpts.velBias) ? emitOpts.velBias[0] : 0;
  const biasY = (emitOpts && emitOpts.velBias) ? emitOpts.velBias[1] : 0;
  const biasZ = (emitOpts && emitOpts.velBias) ? emitOpts.velBias[2] : 0;
  const col = (emitOpts && emitOpts.color) ? emitOpts.color : null;
  const opac = (emitOpts && emitOpts.opacity !== undefined) ? emitOpts.opacity : null;

  for (let i = 0; i < count; i++) {
    const idx = system.nextIndex;
    system.nextIndex = (system.nextIndex + 1) % system.maxCount;

    const i3 = idx * 3;
    system.positions[i3] = posX + (Math.random() - 0.5) * spread;
    system.positions[i3 + 1] = posY + Math.random() * 0.5;
    system.positions[i3 + 2] = posZ + (Math.random() - 0.5) * spread;

    system.velocities[i3] = (Math.random() - 0.5) * velRange + biasX;
    system.velocities[i3 + 1] = Math.random() * velRange * 0.5 + biasY;
    system.velocities[i3 + 2] = (Math.random() - 0.5) * velRange + biasZ;

    system.lifetimes[idx] = lifetime + Math.random() * lifetime * 0.5;
    system.ages[idx] = 0;
    system.active[idx] = 1;
    system.sizes[idx] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);

    // Per-particle color override
    if (col) {
      system.colors[i3] = col.r;
      system.colors[i3 + 1] = col.g;
      system.colors[i3 + 2] = col.b;
    } else {
      system.colors[i3] = system.baseColor.r;
      system.colors[i3 + 1] = system.baseColor.g;
      system.colors[i3 + 2] = system.baseColor.b;
    }
    system.startOpacities[idx] = (opac !== null) ? opac : system.baseOpacity;
  }
}

function updateParticleSystem(system, dt) {
  let anyActive = false;
  const posAttr = system.points.geometry.attributes.position;
  const sizeAttr = system.points.geometry.attributes.size;
  const colorAttr = system.points.geometry.attributes.color;

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

    // Size growth depends on mode
    if (system.growthMode === 'widen') {
      // Contrails: start thin, widen steadily, then stop growing
      const widenT = Math.min(t * 2.5, 1.0); // reaches max width at 40% of life
      sizeAttr.array[i] = system.sizes[i] * (0.3 + widenT * 3.0);
    } else {
      // Default: expand over time
      sizeAttr.array[i] = system.sizes[i] * (1 + t * 3);
    }

    // Per-particle opacity fade via color brightness attenuation
    let fadeFactor;
    if (system.fadeMode === 'tail') {
      // Slow fade for first 70%, then rapid drop (contrail-style tail fade)
      fadeFactor = t < 0.7 ? (1.0 - t * 0.3) : Math.max(0, 1.0 - ((t - 0.7) / 0.3) * 1.0);
    } else {
      // Uniform linear fade
      fadeFactor = 1.0 - t;
    }
    // Modulate color brightness for fade (since PointsMaterial uses global opacity)
    const baseR = system.colors[i3];
    const baseG = system.colors[i3 + 1];
    const baseB = system.colors[i3 + 2];
    colorAttr.array[i3] = baseR * fadeFactor;
    colorAttr.array[i3 + 1] = baseG * fadeFactor;
    colorAttr.array[i3 + 2] = baseB * fadeFactor;
  }

  posAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;

  // Fade opacity based on active particle ratio
  system.points.visible = anyActive;
}

export function initParticles(scene) {
  sceneRef = scene;

  tireSmoke = createParticleSystem(MAX_TIRE_PARTICLES, 0xcccccc, 3, 0.5, THREE.NormalBlending);
  dustCloud = createParticleSystem(MAX_DUST_PARTICLES, 0xaa8855, 6, 0.4, THREE.NormalBlending);
  exhaustLeft = createParticleSystem(MAX_EXHAUST_PARTICLES, 0x999999, 2.5, 0.5, THREE.NormalBlending);
  exhaustRight = createParticleSystem(MAX_EXHAUST_PARTICLES, 0x999999, 2.5, 0.5, THREE.NormalBlending);
  wingVapor = createParticleSystem(MAX_WING_VAPOR, 0xffffff, 3, 0.6, THREE.NormalBlending);
  contrails = createParticleSystem(MAX_CONTRAIL_PARTICLES, 0xe8eeff, 2, 0.55, THREE.NormalBlending,
    { growthMode: 'widen', fadeMode: 'tail' });
  afterburner = createParticleSystem(MAX_AFTERBURNER_PARTICLES, 0xff6600, 4, 0.8, THREE.AdditiveBlending);

  scene.add(tireSmoke.points);
  scene.add(dustCloud.points);
  scene.add(exhaustLeft.points);
  scene.add(exhaustRight.points);
  scene.add(wingVapor.points);
  scene.add(contrails.points);
  scene.add(afterburner.points);
}

export function triggerTireSmoke(intensity) {
  if (!tireSmoke) return;
  const pos = getActiveVehicle().position;
  const count = Math.min(Math.floor(intensity * 30), 50);
  emitParticles(tireSmoke, count, pos.x, pos.y - 1, pos.z, 3 + intensity * 2, 2.0, [1, 4]);
}

export function triggerDustCloud(intensity) {
  if (!dustCloud) return;
  const v = getActiveVehicle();
  const pos = v.position;
  const type = getAircraftType(v.currentType);
  const spread = type ? type.wingSpan * 0.3 : 5;
  const count = Math.min(Math.floor(intensity * 25), 30);
  // Spread particles across aircraft width
  for (let i = 0; i < count; i++) {
    const ox = (Math.random() - 0.5) * spread * 2;
    emitParticles(dustCloud, 1, pos.x + ox, pos.y - 1, pos.z, 3 + intensity * 2, 1.0, [5, 8]);
  }
}

// Pre-allocated colors for exhaust types (avoid per-frame allocation)
const _tireSmokeGray = new THREE.Color(0xbbbbbb);           // ground-roll tire smoke
const _exhaustColorPiston = new THREE.Color(0xff8833);      // original orange
const _exhaustColorPistonDark = new THREE.Color(0xff8833);  // original orange
const _exhaustColorJetIdle = new THREE.Color(0xff8833);     // original orange
const _exhaustColorJetMid = new THREE.Color(0xff8833);      // original orange
const _exhaustColorJetHigh = new THREE.Color(0xff8833);     // original orange
const _exhaustColorFighterDark = new THREE.Color(0xff8833); // original orange
const _abColorOrange = new THREE.Color(0xff6600);           // AB orange glow
const _abColorBlueWhite = new THREE.Color(0x99bbff);        // AB blue-white at max
const _abColorMix = new THREE.Color();                       // reusable for lerp
const _abCoreBase = new THREE.Color(0xffffff);              // reusable for AB core
const _abCoreColor = new THREE.Color();                      // reusable for AB core lerp
const _contrailWhite = new THREE.Color(0xe8eeff);           // base contrail
const _contrailBlueTint = new THREE.Color(0xc0d0ff);        // high altitude blue-white
const _contrailColor = new THREE.Color();                    // reusable
const _wingVaporColor = new THREE.Color(0xeeeeff);          // bright white vapor

export function updateParticles(dt) {
  if (tireSmoke) updateParticleSystem(tireSmoke, dt);
  if (dustCloud) updateParticleSystem(dustCloud, dt);
  if (exhaustLeft) updateParticleSystem(exhaustLeft, dt);
  if (exhaustRight) updateParticleSystem(exhaustRight, dt);
  if (wingVapor) updateParticleSystem(wingVapor, dt);
  if (contrails) updateParticleSystem(contrails, dt);
  if (afterburner) updateParticleSystem(afterburner, dt);

  const v = getActiveVehicle();
  if (!isAircraft(v)) return;

  const type = getAircraftType(v.currentType);
  const pos = v.position;
  _fwd.set(0, 0, 1).applyQuaternion(v.quaternion);
  _right.set(1, 0, 0).applyQuaternion(v.quaternion);

  // --- Tire smoke on fast ground roll (speed > 40 knots = ~20.6 m/s) ---
  if (tireSmoke && v.onGround && v.speed > 20.6) {
    const rollIntensity = Math.min((v.speed - 20.6) / 30, 1.0); // 0..1 from 40kt to ~100kt
    const count = Math.max(1, Math.floor(rollIntensity * 4));
    // Sideways drift bias from crosswind or steering
    const driftX = (Math.random() - 0.5) * 2;
    emitParticles(tireSmoke, count, pos.x, pos.y - 1, pos.z,
      1.5 + rollIntensity * 1.5, 1.5, [0.8, 2.5], {
        color: _tireSmokeGray,
        opacity: 0.25 + rollIntensity * 0.15,
        spread: 3,
        velBias: [driftX, 0.3, 0],
      });
  }

  // --- Per-engine-type exhaust ---
  const exhaustOffset = type.fuselageLength * 0.5;
  _basePos.copy(pos).addScaledVector(_fwd, exhaustOffset);

  if (type.type === 'prop' || type.audioType === 'piston') {
    // PISTON: gray-blue thin exhaust stream, always visible when engine running
    if (v.throttle > 0.05) {
      const intensity = Math.min(v.throttle, 1.0);
      const count = intensity > 0.5 ? 2 : 1;
      // Darken slightly at low throttle (startup smoke)
      const col = intensity < 0.3 ? _exhaustColorPistonDark : _exhaustColorPiston;
      if (exhaustLeft) {
        emitParticles(exhaustLeft, count, _basePos.x, _basePos.y, _basePos.z,
          0.5 + intensity * 1.5, 0.6 + intensity * 0.4, [0.3, 1.0], {
            color: col,
            opacity: 0.2 + intensity * 0.15,
            spread: 0.5,
          });
      }
    }
  } else if (type.type === 'fighter') {
    // FIGHTER: subtle exhaust shimmer
    if (v.throttle > 0.3 && exhaustLeft) {
      const thrustFrac = Math.min((v.throttle - 0.3) / 0.7, 1.0);
      emitParticles(exhaustLeft, 1, _basePos.x, _basePos.y, _basePos.z,
        1.0 + thrustFrac * 2, 0.2 + thrustFrac * 0.3, [0.5, 1.5], {
          color: _exhaustColorFighterDark,
          opacity: 0.1 + thrustFrac * 0.15,
          spread: 0.4,
        });
    }

    // AFTERBURNER: compact orange glow at >85% throttle
    if (type.hasAfterburner && v.throttle > 0.85 && afterburner) {
      const abT = Math.min((v.throttle - 0.85) / 0.15, 1.0);
      _abColorMix.copy(_abColorOrange).lerp(_abColorBlueWhite, abT);
      emitParticles(afterburner, 2 + Math.floor(abT * 2),
        _basePos.x, _basePos.y, _basePos.z,
        0.5 + abT * 0.8, 0.08 + abT * 0.05, [1.5, 3.0], {
          color: _abColorMix,
          opacity: 0.5 + abT * 0.3,
          spread: 0.25,
        });
    }
  } else {
    // JET (737, A340 etc): hot shimmer at idle, darkening with thrust
    if (v.throttle > 0.1) {
      const thrustFrac = Math.min((v.throttle - 0.1) / 0.9, 1.0);

      // Color darkens with thrust: faint gray at idle -> darker gray at high thrust
      const col = thrustFrac < 0.3 ? _exhaustColorJetIdle
        : (thrustFrac < 0.6 ? _exhaustColorJetMid : _exhaustColorJetHigh);

      if (type.engineCount >= 2) {
        const nacSpacing = type.wingSpan * 0.28;
        _leftPos.copy(_basePos).addScaledVector(_right, -nacSpacing);
        _rightPos.copy(_basePos).addScaledVector(_right, nacSpacing);
        const count = thrustFrac > 0.5 ? 3 : 1;

        if (exhaustLeft) {
          emitParticles(exhaustLeft, count, _leftPos.x, _leftPos.y, _leftPos.z,
            0.8 + thrustFrac * 3, 0.4 + thrustFrac * 0.4, [0.5, 2.0], {
              color: col,
              opacity: 0.15 + thrustFrac * 0.25,
              spread: 0.8,
            });
        }
        if (exhaustRight) {
          emitParticles(exhaustRight, count, _rightPos.x, _rightPos.y, _rightPos.z,
            0.8 + thrustFrac * 3, 0.4 + thrustFrac * 0.4, [0.5, 2.0], {
              color: col,
              opacity: 0.15 + thrustFrac * 0.25,
              spread: 0.8,
            });
        }

        // 4-engine aircraft: inner pair of engines
        if (type.engineCount >= 4) {
          const innerSpacing = type.wingSpan * 0.14;
          _leftPos.copy(_basePos).addScaledVector(_right, -innerSpacing);
          _rightPos.copy(_basePos).addScaledVector(_right, innerSpacing);
          if (exhaustLeft) {
            emitParticles(exhaustLeft, count, _leftPos.x, _leftPos.y, _leftPos.z,
              0.8 + thrustFrac * 3, 0.4 + thrustFrac * 0.4, [0.5, 2.0], {
                color: col,
                opacity: 0.15 + thrustFrac * 0.25,
                spread: 0.8,
              });
          }
          if (exhaustRight) {
            emitParticles(exhaustRight, count, _rightPos.x, _rightPos.y, _rightPos.z,
              0.8 + thrustFrac * 3, 0.4 + thrustFrac * 0.4, [0.5, 2.0], {
                color: col,
                opacity: 0.15 + thrustFrac * 0.25,
                spread: 0.8,
              });
          }
        }
      }
    }
  }

  // --- Wing vapor: emit from wingtips when |gForce| > 1.5 (lowered from 2.0) ---
  if (wingVapor && Math.abs(v.gForce) > 1.5 && !v.onGround) {
    const gExcess = Math.abs(v.gForce) - 1.5;
    const vaporIntensity = Math.min(gExcess / 2.0, 1.0); // ramp up from 1.5G to 3.5G
    const wingHalf = type.wingSpan * 0.5;
    _leftPos.copy(pos).addScaledVector(_right, -wingHalf);
    _rightPos.copy(pos).addScaledVector(_right, wingHalf);

    const count = 2 + Math.floor(vaporIntensity * 3); // 2-5 particles per tip
    emitParticles(wingVapor, count, _leftPos.x, _leftPos.y, _leftPos.z,
      0.4 + vaporIntensity * 0.6, 0.4 + vaporIntensity * 0.3, [2.0, 4.0], {
        color: _wingVaporColor,
        opacity: 0.4 + vaporIntensity * 0.25,
        spread: 0.8,
      });
    emitParticles(wingVapor, count, _rightPos.x, _rightPos.y, _rightPos.z,
      0.4 + vaporIntensity * 0.6, 0.4 + vaporIntensity * 0.3, [2.0, 4.0], {
        color: _wingVaporColor,
        opacity: 0.4 + vaporIntensity * 0.25,
        spread: 0.8,
      });
  }

  // --- Contrails: persist 8-10 sec, widen over time, blue-white tint at high altitude ---
  if (contrails && pos.y > 2000 && !v.onGround) {
    const wingHalf = type.wingSpan * 0.45;
    _leftPos.copy(pos).addScaledVector(_right, -wingHalf).addScaledVector(_fwd, type.fuselageLength * 0.3);
    _rightPos.copy(pos).addScaledVector(_right, wingHalf).addScaledVector(_fwd, type.fuselageLength * 0.3);

    const rate = Math.min((pos.y - 2000) / 3000, 1.0);
    // Blue-white tint intensifies with altitude (above 4000m fully blue-tinted)
    const altFrac = Math.min((pos.y - 2000) / 5000, 1.0);
    _contrailColor.copy(_contrailWhite).lerp(_contrailBlueTint, altFrac * 0.6);

    // Lifetime 8-10 seconds (was 2s)
    const lifetime = 8.0 + altFrac * 2.0;

    if (Math.random() < rate) {
      // Start thin (sizes 1.5-3) and the 'widen' growth mode handles expansion
      emitParticles(contrails, 1, _leftPos.x, _leftPos.y, _leftPos.z,
        0.15, lifetime, [1.5, 3.0], {
          color: _contrailColor,
          opacity: 0.45 + altFrac * 0.15,
          spread: 0.3,
        });
      emitParticles(contrails, 1, _rightPos.x, _rightPos.y, _rightPos.z,
        0.15, lifetime, [1.5, 3.0], {
          color: _contrailColor,
          opacity: 0.45 + altFrac * 0.15,
          spread: 0.3,
        });
    }
  }
}

// Reset all particle systems — clears every particle instantly
function resetSystem(system) {
  if (!system) return;
  for (let i = 0; i < system.maxCount; i++) {
    system.active[i] = 0;
    system.ages[i] = 0;
    const i3 = i * 3;
    system.positions[i3 + 1] = -1000;
  }
  system.nextIndex = 0;
  system.points.geometry.attributes.position.needsUpdate = true;
  system.points.visible = false;
}

export function resetParticles() {
  resetSystem(tireSmoke);
  resetSystem(dustCloud);
  resetSystem(exhaustLeft);
  resetSystem(exhaustRight);
  resetSystem(wingVapor);
  resetSystem(contrails);
  resetSystem(afterburner);
}

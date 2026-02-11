// Arcade car physics — grip-based model with momentum
// Car has heading (where wheels point) and velocity (where car moves).
// Tire grip redirects momentum from velocity toward heading.
import * as THREE from 'three';
import { getGroundLevel } from './terrain.js';
import { clamp } from './utils.js';

const _yAxis = new THREE.Vector3(0, 1, 0);

export function updateCarPhysics(state, keys, dt) {
  const cfg = state.config;
  if (!cfg) return;

  // ── Input (WASD + arrows) ──
  let throttle = 0, steer = 0, brake = 0;

  if (keys['w'] || keys['arrowup'] || keys['shift']) throttle = 1;
  if (keys['s'] || keys['arrowdown']) brake = 1;
  if (keys['a'] || keys['arrowleft']) steer = -1;
  if (keys['d'] || keys['arrowright']) steer = 1;
  if (keys[' ']) brake = 1;

  // Reverse: hold brake when nearly stopped
  let reversing = false;
  if (state.speed < 0.5 && state.speed > -0.1 && brake > 0 && throttle === 0) {
    throttle = -0.5;
    brake = 0;
    reversing = true;
  }

  // ── Steering → heading change ──
  const speedAbs = Math.abs(state.speed);
  // Strong turning at low-medium speed, reduced at high speed
  const highSpeedFactor = clamp(1.0 - (speedAbs / cfg.maxSpeed) * 0.55, 0.3, 1.0);

  if (speedAbs > 0.3) {
    const turnRate = cfg.turnDegPerSec * highSpeedFactor;
    const headingDelta = steer * turnRate * dt;
    state.heading += state.speed >= 0 ? headingDelta : -headingDelta;
    state.heading = ((state.heading % 360) + 360) % 360;
  }

  // ── Forward/right vectors from heading ──
  const headRad = state.heading * (Math.PI / 180);
  const fwdX = -Math.sin(headRad);
  const fwdZ = -Math.cos(headRad);
  const rightX = fwdZ;
  const rightZ = -fwdX;

  // ── Engine force (applied along heading) ──
  if (throttle > 0) {
    const headroom = clamp(1.0 - state.speed / cfg.maxSpeed, 0, 1);
    state.velocity.x += fwdX * cfg.acceleration * throttle * headroom * dt;
    state.velocity.z += fwdZ * cfg.acceleration * throttle * headroom * dt;
  } else if (throttle < 0) {
    state.velocity.x += fwdX * cfg.acceleration * throttle * dt;
    state.velocity.z += fwdZ * cfg.acceleration * throttle * dt;
  }

  // ── Braking (opposes velocity direction) ──
  if (brake > 0) {
    const spd = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);
    if (spd > 0.2) {
      const brakeDelta = Math.min(cfg.brakeForce * dt, spd);
      state.velocity.x -= (state.velocity.x / spd) * brakeDelta;
      state.velocity.z -= (state.velocity.z / spd) * brakeDelta;
    }
  }

  // ── Tire grip: redirect momentum toward heading ──
  // Decompose velocity into forward and lateral components
  const fwdSpeed = state.velocity.x * fwdX + state.velocity.z * fwdZ;
  const latSpeed = state.velocity.x * rightX + state.velocity.z * rightZ;

  // Kill lateral velocity — high grip = tight cornering, no sliding
  // Frame-rate independent: gripFactor per second
  const gripKill = 1.0 - Math.pow(1.0 - cfg.grip, dt * 60);
  const newLat = latSpeed * (1.0 - gripKill);

  // Rebuild velocity from components
  state.velocity.x = fwdX * fwdSpeed + rightX * newLat;
  state.velocity.z = fwdZ * fwdSpeed + rightZ * newLat;

  // ── Drag when coasting ──
  if (throttle === 0 && brake === 0) {
    const spd = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);
    if (spd > 0.1) {
      // Engine braking + air drag
      const decel = Math.min((2.5 + 0.001 * spd * spd) * dt, spd);
      const factor = (spd - decel) / spd;
      state.velocity.x *= factor;
      state.velocity.z *= factor;
    }
  }

  // ── Speed (signed scalar along heading) ──
  state.speed = state.velocity.x * fwdX + state.velocity.z * fwdZ;

  // Full stop at very low speed
  const spd2d = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);
  if (spd2d < 0.3 && throttle === 0 && !reversing) {
    state.velocity.x *= 0.8;
    state.velocity.z *= 0.8;
    state.speed *= 0.8;
    if (spd2d < 0.05) {
      state.velocity.set(0, 0, 0);
      state.speed = 0;
    }
  }

  // Speed clamp
  if (spd2d > cfg.maxSpeed) {
    const s = cfg.maxSpeed / spd2d;
    state.velocity.x *= s;
    state.velocity.z *= s;
  }
  state.speed = clamp(state.speed, -cfg.maxSpeed * 0.3, cfg.maxSpeed);

  // ── Position update ──
  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;

  // Ground following
  const groundH = getGroundLevel(state.position.x, state.position.z);
  state.position.y = groundH + 0.4;

  // ── Quaternion from heading ──
  state.quaternion.setFromAxisAngle(_yAxis, -headRad);

  // ── Derived ──
  state.altitude = state.position.y;
  state.altitudeAGL = state.position.y - groundH;
  state.onGround = true;
  state.throttle = Math.abs(throttle);
  state.euler.setFromQuaternion(state.quaternion, 'YXZ');
}

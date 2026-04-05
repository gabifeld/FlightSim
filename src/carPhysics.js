// Arcade car physics inspired by Cannon.js RaycastVehicle principles:
// - Steering turns front wheels, car body follows with inertia
// - Car has mass/momentum — doesn't instantly snap to new direction
// - Friction/grip pulls velocity toward heading over time
// - 3D model faces velocity direction (not steering heading) for natural visuals

import * as THREE from 'three';
import { getGroundLevel } from './terrain.js';
import { clamp, lerp } from './utils.js';

const _yAxis = new THREE.Vector3(0, 1, 0);
const _tmpVec = new THREE.Vector3();
const _quat = new THREE.Quaternion();

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function getCarDynamics(state) {
  if (!state._carDynamics) {
    state._carDynamics = {
      rideHeight: 0.38,
      bodyPitch: 0,
      bodyRoll: 0,
      velX: 0,
      velZ: 0,
      // Internal physics heading — where the "wheels" point.
      // Separate from state.heading which is used for visuals/camera.
      physHeading: state.heading || 0,
    };
  }
  return state._carDynamics;
}

export function updateCarPhysics(state, keys, dt) {
  const cfg = state.config;
  if (!cfg) return;

  const dyn = getCarDynamics(state);

  // ── Input ────────────────────────────────────────────────────────────────
  let gasInput = 0;
  let brakeInput = 0;
  let steerInput = 0;

  if (keys['w'] || keys['arrowup'] || keys['shift']) gasInput = 1;
  if (keys['s'] || keys['arrowdown']) brakeInput = 1;
  // Space bar is dedicated brake (overrides gas for clean braking)
  if (keys[' ']) { brakeInput = 1; gasInput = 0; }
  if (keys['a'] || keys['arrowleft']) steerInput = 1;
  if (keys['d'] || keys['arrowright']) steerInput = -1;

  // ── Physics heading — where the tires point ──────────────────────────────
  const physRad = dyn.physHeading * DEG2RAD;
  const fwdX = -Math.sin(physRad);
  const fwdZ = -Math.cos(physRad);

  // Decompose velocity into forward/lateral relative to physics heading
  let forwardSpeed = dyn.velX * fwdX + dyn.velZ * fwdZ;
  if (!Number.isFinite(forwardSpeed)) forwardSpeed = 0;

  // ── Engine force / braking ───────────────────────────────────────────────
  if (brakeInput > 0 && forwardSpeed > 0.05) {
    // Brake always works — strong deceleration
    forwardSpeed = Math.max(0, forwardSpeed - cfg.brakeForce * 1.2 * dt);
  } else if (gasInput > 0 && forwardSpeed >= 0) {
    const headroom = 1 - clamp(forwardSpeed / cfg.maxSpeed, 0, 1);
    forwardSpeed += cfg.acceleration * headroom * dt;
  } else if (brakeInput > 0 && gasInput === 0 && forwardSpeed <= 0.05) {
    // Reverse when braking from standstill (S key only, not Space)
    const maxReverse = cfg.maxSpeed * 0.25;
    forwardSpeed = Math.max(-maxReverse, forwardSpeed - cfg.acceleration * 0.3 * dt);
  } else if (gasInput > 0 && forwardSpeed < 0) {
    forwardSpeed = Math.min(0, forwardSpeed + cfg.brakeForce * 0.65 * dt);
  }

  if (gasInput === 0 && brakeInput === 0) {
    const drag = (1.5 + Math.abs(forwardSpeed) * 0.04 + forwardSpeed * forwardSpeed * 0.0015) * dt;
    if (Math.abs(forwardSpeed) <= drag) forwardSpeed = 0;
    else forwardSpeed -= Math.sign(forwardSpeed) * drag;
  }

  // ── Steering: rotate physics heading ─────────────────────────────────────
  if (steerInput !== 0 && Math.abs(forwardSpeed) > 0.2) {
    const maxTurnDeg = cfg.maxSteerDeg || 35;
    const absSpeed = Math.abs(forwardSpeed);
    const speedRatio = clamp(absSpeed / cfg.maxSpeed, 0, 1);
    const turnDegPerSec = maxTurnDeg * 3.2 * Math.min(speedRatio * 6, 1) * lerp(1.0, 0.35, speedRatio);
    const reverseSign = forwardSpeed < 0 ? -1 : 1;
    dyn.physHeading += steerInput * turnDegPerSec * reverseSign * dt;
    dyn.physHeading = ((dyn.physHeading % 360) + 360) % 360;
  }

  // ── Grip: align velocity toward physics heading ──────────────────────────
  const newPhysRad = dyn.physHeading * DEG2RAD;
  const newFwdX = -Math.sin(newPhysRad);
  const newFwdZ = -Math.cos(newPhysRad);

  const newLateral = dyn.velX * newFwdZ + dyn.velZ * (-newFwdX);
  const speedRatio = clamp(Math.abs(forwardSpeed) / cfg.maxSpeed, 0, 1);
  const gripStrength = lerp(20, 8, speedRatio);
  const lateralAfterGrip = newLateral * Math.exp(-gripStrength * dt);

  const rightX = newFwdZ;
  const rightZ = -newFwdX;
  dyn.velX = newFwdX * forwardSpeed + rightX * lateralAfterGrip;
  dyn.velZ = newFwdZ * forwardSpeed + rightZ * lateralAfterGrip;

  // ── Update position ──────────────────────────────────────────────────────
  state.position.x += dyn.velX * dt;
  state.position.z += dyn.velZ * dt;

  state.velocity.set(dyn.velX, 0, dyn.velZ);
  state.speed = forwardSpeed;
  state.steering = steerInput;

  // ── Ground following ─────────────────────────────────────────────────────
  const groundH = getGroundLevel(state.position.x, state.position.z);
  const suspLerp = 1 - Math.exp(-16 * dt);
  dyn.rideHeight = lerp(dyn.rideHeight, 0.4, suspLerp);
  const targetY = groundH + dyn.rideHeight;
  if (Math.abs(state.position.y - targetY) > 1.3) state.position.y = targetY;
  else state.position.y = lerp(state.position.y, targetY, suspLerp);

  // ── Visual heading: use physics heading directly ───────────────────────
  // The grip system aligns velocity toward physHeading, so the car
  // moves in the direction it faces. No separate visual heading needed.
  state.heading = dyn.physHeading;

  // ── Body tilt ────────────────────────────────────────────────────────────
  const visualRad = state.heading * DEG2RAD;
  const visFwdX = -Math.sin(visualRad);
  const visFwdZ = -Math.cos(visualRad);
  const visRightX = visFwdZ;
  const visRightZ = -visFwdX;

  const wheelBase = cfg.wheelBase || 2.6;
  const probeF = Math.max(2.0, wheelBase * 0.82);
  const probeL = Math.max(1.15, (cfg.width || 1.8) * 0.75);
  const hF = getGroundLevel(state.position.x + visFwdX * probeF, state.position.z + visFwdZ * probeF);
  const hB = getGroundLevel(state.position.x - visFwdX * probeF, state.position.z - visFwdZ * probeF);
  const hR = getGroundLevel(state.position.x + visRightX * probeL, state.position.z + visRightZ * probeL);
  const hL = getGroundLevel(state.position.x - visRightX * probeL, state.position.z - visRightZ * probeL);

  const terrainPitch = clamp(Math.atan2(hB - hF, probeF * 2) * 0.48, -0.11, 0.11);
  const terrainRoll = clamp(Math.atan2(hR - hL, probeL * 2) * 0.55, -0.09, 0.09);
  const cornerRoll = clamp(steerInput * Math.abs(forwardSpeed) * 0.004, -0.07, 0.07);

  dyn.bodyPitch = lerp(dyn.bodyPitch, terrainPitch, 1 - Math.exp(-7 * dt));
  dyn.bodyRoll = lerp(dyn.bodyRoll, terrainRoll + cornerRoll, 1 - Math.exp(-8 * dt));

  // ── Quaternion from visual heading ───────────────────────────────────────
  state.quaternion.setFromAxisAngle(_yAxis, visualRad);
  _quat.setFromAxisAngle(_tmpVec.set(1, 0, 0), dyn.bodyPitch);
  state.quaternion.multiply(_quat);
  _quat.setFromAxisAngle(_tmpVec.set(0, 0, 1), dyn.bodyRoll);
  state.quaternion.multiply(_quat);

  state.altitude = state.position.y;
  state.altitudeAGL = state.position.y - groundH;
  state.onGround = true;
  state.throttle = gasInput;
  state.brake = brakeInput;
  state.euler.setFromQuaternion(state.quaternion, 'YXZ');
}

import * as THREE from 'three';
import { aircraftState } from './aircraft.js';
import { getKeys } from './controls.js';
import { getTerrainHeight } from './terrain.js';
import { getWeatherState } from './weather.js';
import { clamp } from './utils.js';
import { getGamepadState, isGamepadConnected } from './gamepad.js';
import { getMobileState, isMobileActive } from './mobile.js';
import { isAPEngaged, getAPState, updateAutopilot } from './autopilot.js';
import {
  GRAVITY,
  AIR_DENSITY,
  WING_AREA,
  MASS,
  MAX_THRUST,
  CL_BASE,
  CL_SLOPE,
  CL_FLAP_BONUS,
  CD_PARASITIC,
  CD_INDUCED_FACTOR,
  CD_GEAR_PENALTY,
  CD_FLAP_PENALTY,
  CD_SPEEDBRAKE_PENALTY,
  STALL_AOA,
  PITCH_RATE,
  ROLL_RATE,
  YAW_RATE,
  TAKEOFF_SPEED,
  GROUND_FRICTION,
  BRAKE_FRICTION,
  BANK_TO_YAW,
  ADVERSE_YAW,
  YAW_DAMPING,
  ROLL_DAMPING,
  PITCH_DAMPING,
  STALL_SEVERITY,
  STALL_ROLL_RATE,
  TURN_DRAG_FACTOR,
  GROUND_EFFECT_WINGSPAN,
  GROUND_EFFECT_DRAG_REDUCTION,
  GROUND_EFFECT_LIFT_BONUS,
} from './constants.js';

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tempQ = new THREE.Quaternion();
const _worldUp = new THREE.Vector3(0, 1, 0);

function getLocalAxes(quat) {
  _forward.set(0, 0, -1).applyQuaternion(quat).normalize();
  _up.set(0, 1, 0).applyQuaternion(quat).normalize();
  _right.set(1, 0, 0).applyQuaternion(quat).normalize();
}

// Read physics constant from per-aircraft config or fall back to global constant
function cfg(key, fallback) {
  const c = aircraftState.config;
  if (c && c[key] !== undefined) return c[key];
  return fallback;
}

let smoothedAoa = 0;

export let preLandingVS = 0;

export function updatePhysics(dt) {
  const state = aircraftState;
  const keys = getKeys();
  const weather = getWeatherState();

  getLocalAxes(state.quaternion);

  // Use relative airspeed (velocity - wind) for aerodynamic calculations
  const relativeVelocity = state.velocity.clone().sub(weather.windVector);
  const speed = relativeVelocity.length();
  state.speed = state.velocity.length(); // groundspeed for display

  const mass = cfg('mass', MASS);
  const maxThrust = cfg('maxThrust', MAX_THRUST);
  const wingArea = cfg('wingArea', WING_AREA);
  const pRate = cfg('pitchRate', PITCH_RATE);
  const rRate = cfg('rollRate', ROLL_RATE);
  const yRate = cfg('yawRate', YAW_RATE);
  const stallAoa = cfg('stallAoa', STALL_AOA);
  const takeoffSpd = cfg('takeoffSpeed', TAKEOFF_SPEED);

  // Control authority: ramps from 0 at rest to 1 at takeoff speed
  const authority = clamp(speed / takeoffSpd, 0, 1);

  // Control inputs (keyboard)
  let pitchInput = 0;
  let rollInput = 0;
  let yawInput = 0;

  if (keys['w']) pitchInput -= 1;
  if (keys['s']) pitchInput += 1;
  if (keys['a']) rollInput -= 1;
  if (keys['d']) rollInput += 1;
  if (keys['q']) yawInput -= 1;
  if (keys['e']) yawInput += 1;

  // Merge gamepad analog inputs
  if (isGamepadConnected()) {
    const gp = getGamepadState();
    pitchInput = clamp(pitchInput + gp.pitchInput, -1, 1);
    rollInput = clamp(rollInput + gp.rollInput, -1, 1);
    yawInput = clamp(yawInput + gp.yawInput, -1, 1);
    // Gamepad throttle (absolute positioning)
    if (gp.throttleInput > -0.9) {
      state.throttle = clamp((gp.throttleInput + 1) / 2, 0, 1);
    }
  }

  // Merge mobile tilt/touch inputs
  if (isMobileActive()) {
    const mob = getMobileState();
    pitchInput = clamp(pitchInput + mob.pitchInput, -1, 1);
    rollInput = clamp(rollInput + mob.rollInput, -1, 1);
    yawInput = clamp(yawInput + mob.yawInput, -1, 1);
    if (mob.throttleInput >= 0) {
      state.throttle = clamp(mob.throttleInput, 0, 1);
    }
  }

  // Autopilot override
  updateAutopilot(dt);
  if (isAPEngaged()) {
    const apState = getAPState();
    pitchInput = apState.pitchCommand;
    rollInput = apState.rollCommand;
    // Auto-throttle
    if (apState.throttleCommand >= 0) {
      state.throttle = apState.throttleCommand;
    }
  }

  // Stall detection
  const isStalling = Math.abs(state.aoa) > stallAoa && speed > takeoffSpd * 0.4;
  const stallFactor = isStalling
    ? clamp((Math.abs(state.aoa) - stallAoa) / (stallAoa * 0.5), 0, 1)
    : 0;

  // Apply rotations
  if (state.onGround) {
    const pitchDelta = pitchInput * pRate * authority * dt;
    _tempQ.setFromAxisAngle(_right, pitchDelta);
    state.quaternion.premultiply(_tempQ);

    // Yaw steering (enhanced on taxiway at low speed)
    if (speed > 0.5) {
      const steeringMul = speed < 15 ? 1.0 : 0.5; // better steering at taxi speeds
      const yawDelta = yawInput * yRate * steeringMul * dt;
      _tempQ.setFromAxisAngle(_worldUp, -yawDelta);
      state.quaternion.premultiply(_tempQ);
    }

    state.quaternion.normalize();

    const euler = new THREE.Euler().setFromQuaternion(state.quaternion, 'YXZ');
    euler.z *= Math.max(0, 1 - 10 * dt);
    euler.x = clamp(euler.x, -0.25, 0.08);
    state.quaternion.setFromEuler(euler);
  } else {
    const euler = new THREE.Euler().setFromQuaternion(state.quaternion, 'YXZ');

    const stallControlPenalty = 1 - stallFactor * 0.6;

    const pitchDelta = pitchInput * pRate * authority * stallControlPenalty * dt;
    const rollDelta = rollInput * rRate * authority * stallControlPenalty * dt;
    let yawDelta = yawInput * yRate * authority * stallControlPenalty * dt;

    const speedFactor = clamp(speed / takeoffSpd, 0.2, 1.5);
    yawDelta -= Math.sin(euler.z) * BANK_TO_YAW * speedFactor * authority * dt;
    yawDelta += rollInput * ADVERSE_YAW * authority * dt;

    // Stall effects
    if (isStalling) {
      const stallRoll = (Math.sin(performance.now() * 0.007) * 0.6 + 0.4) *
        STALL_ROLL_RATE * stallFactor * dt;
      _tempQ.setFromAxisAngle(_forward, stallRoll);
      state.quaternion.premultiply(_tempQ);

      const stallPitch = stallFactor * 0.3 * dt;
      _tempQ.setFromAxisAngle(_right, stallPitch);
      state.quaternion.premultiply(_tempQ);
    }

    // Turbulence perturbations
    if (weather.turbulenceIntensity > 0.01) {
      const turbScale = weather.turbulenceIntensity * 0.03 * dt;
      const turbPitch = Math.sin(performance.now() * 0.011) * turbScale;
      const turbRoll = Math.sin(performance.now() * 0.017 + 2) * turbScale;
      _tempQ.setFromAxisAngle(_right, turbPitch);
      state.quaternion.premultiply(_tempQ);
      _tempQ.setFromAxisAngle(_forward, turbRoll);
      state.quaternion.premultiply(_tempQ);
    }

    _tempQ.setFromAxisAngle(_right, pitchDelta);
    state.quaternion.premultiply(_tempQ);

    _tempQ.setFromAxisAngle(_forward, rollDelta);
    state.quaternion.premultiply(_tempQ);

    _tempQ.setFromAxisAngle(_worldUp, -yawDelta);
    state.quaternion.premultiply(_tempQ);

    if (pitchInput === 0) {
      const pitchDamp = -euler.x * PITCH_DAMPING * authority * dt;
      _tempQ.setFromAxisAngle(_right, clamp(pitchDamp, -0.05, 0.05));
      state.quaternion.premultiply(_tempQ);
    }
    if (rollInput === 0 && !isStalling) {
      const rollDamp = -euler.z * ROLL_DAMPING * authority * dt;
      _tempQ.setFromAxisAngle(_forward, clamp(rollDamp, -0.05, 0.05));
      state.quaternion.premultiply(_tempQ);
    }

    // Weathervane / sideslip damping - vertical stabilizer aligns nose with velocity
    // This eliminates the "drifting" feel in turns
    if (speed > 5) {
      const velDir = relativeVelocity.clone().normalize();
      const sideSlip = _right.dot(velDir);
      const slipCorrection = sideSlip * YAW_DAMPING * authority * dt;
      _tempQ.setFromAxisAngle(_worldUp, -slipCorrection);
      state.quaternion.premultiply(_tempQ);
    }

    state.quaternion.normalize();
  }

  getLocalAxes(state.quaternion);

  // Angle of Attack (relative to airspeed, not groundspeed)
  let rawAoa = 0;
  if (speed > 1) {
    const velDir = relativeVelocity.clone().normalize();
    const dotFwd = _forward.dot(velDir);
    const dotUp = _up.dot(velDir);
    rawAoa = Math.atan2(-dotUp, dotFwd);
  }
  // Smooth AoA to prevent brief turbulence/input spikes from triggering stalls
  const aoaSmoothRate = 2.5; // how fast AoA adjusts (lower = more damped, more forgiving in turns)
  smoothedAoa += (rawAoa - smoothedAoa) * Math.min(1, aoaSmoothRate * dt);
  const aoa = smoothedAoa;
  state.aoa = aoa;

  // Aerodynamic forces (computed with airspeed)
  const dynamicPressure = 0.5 * AIR_DENSITY * speed * speed;

  let Cl = CL_BASE + CL_SLOPE * aoa;
  if (state.flaps) Cl += CL_FLAP_BONUS;

  if (Math.abs(aoa) > stallAoa) {
    const overStall = (Math.abs(aoa) - stallAoa) / stallAoa;
    const dropoff = Math.exp(-overStall * STALL_SEVERITY);
    Cl *= Math.max(0.35, dropoff);
  }

  // Ground effect
  const wingspan = cfg('wingspan', GROUND_EFFECT_WINGSPAN);
  let groundEffectLift = 1.0;
  let groundEffectDrag = 1.0;
  if (state.altitudeAGL < wingspan && !state.onGround) {
    const geFactor = 1 - state.altitudeAGL / wingspan;
    groundEffectLift = 1 + GROUND_EFFECT_LIFT_BONUS * geFactor;
    groundEffectDrag = 1 - GROUND_EFFECT_DRAG_REDUCTION * geFactor;
  }

  const liftMag = dynamicPressure * wingArea * Cl * groundEffectLift;
  const lift = _up.clone().multiplyScalar(liftMag);

  // Drag
  let Cd = CD_PARASITIC + CD_INDUCED_FACTOR * Cl * Cl * groundEffectDrag;
  if (state.gear) Cd += CD_GEAR_PENALTY;
  if (state.flaps) Cd += CD_FLAP_PENALTY;
  if (state.speedbrake) Cd += CD_SPEEDBRAKE_PENALTY;

  const euler = new THREE.Euler().setFromQuaternion(state.quaternion, 'YXZ');
  const bankAngle = Math.abs(euler.z);
  if (bankAngle > 0.05 && !state.onGround) {
    const loadFactor = 1 / Math.max(Math.cos(bankAngle), 0.3);
    const turnDrag = (loadFactor - 1) * TURN_DRAG_FACTOR * CD_PARASITIC;
    Cd += turnDrag;
  }

  if (isStalling) {
    Cd += stallFactor * 0.08;
  }

  const dragMag = dynamicPressure * wingArea * Cd;
  const drag = speed > 0.1
    ? relativeVelocity.clone().normalize().multiplyScalar(-dragMag)
    : new THREE.Vector3();

  // Thrust
  const thrustMag = state.throttle * maxThrust;
  const thrust = _forward.clone().multiplyScalar(thrustMag);

  // Gravity
  const gravity = new THREE.Vector3(0, -GRAVITY * mass, 0);

  // Total force
  const totalForce = new THREE.Vector3();
  totalForce.add(thrust).add(drag).add(lift).add(gravity);

  // Ground friction
  if (state.onGround) {
    const isBraking = keys[' '] || (isMobileActive() && getMobileState().brakeActive);
    if (state.speed > 0.1) {
      const frictionCoeff = isBraking ? BRAKE_FRICTION : GROUND_FRICTION;
      const frictionMag = frictionCoeff * mass * GRAVITY;
      const friction = state.velocity.clone().normalize().multiplyScalar(-frictionMag);
      totalForce.add(friction);
    }

    if (totalForce.y < 0) {
      totalForce.y = 0;
    }
  }

  // Integration
  const accel = totalForce.clone().divideScalar(mass);

  // G-force calculation
  state.gForce = 1 + accel.dot(_up) / GRAVITY;

  state.velocity.addScaledVector(accel, dt);
  state.position.addScaledVector(state.velocity, dt);

  preLandingVS = state.velocity.y;

  // Ground collision
  const groundHeight = getTerrainHeight(state.position.x, state.position.z);
  const wheelHeight = 1.5;
  const groundLevel = groundHeight + wheelHeight;

  if (state.position.y <= groundLevel) {
    state.position.y = groundLevel;

    if (!state.onGround) {
      state.onGround = true;
    }

    if (state.velocity.y < 0) {
      state.velocity.y = 0;
    }

    const groundForward = _forward.clone();
    groundForward.y = 0;
    if (groundForward.lengthSq() > 0.001) {
      groundForward.normalize();
      const fwdSpeed = state.velocity.dot(groundForward);
      const vertSpeed = state.velocity.y;

      if (Math.abs(fwdSpeed) < 0.05 && state.throttle < 0.01 && vertSpeed <= 0) {
        state.velocity.set(0, 0, 0);
      } else {
        state.velocity.copy(groundForward).multiplyScalar(fwdSpeed);
        state.velocity.y = Math.max(vertSpeed, 0);
      }
    }
  } else {
    state.onGround = false;
  }

  // Derived state
  state.altitude = state.position.y;
  state.altitudeAGL = state.position.y - groundHeight;
  state.verticalSpeed = state.velocity.y;

  const headingForward = _forward.clone();
  headingForward.y = 0;
  if (headingForward.lengthSq() > 0.001) {
    headingForward.normalize();
    state.heading = ((Math.atan2(-headingForward.x, -headingForward.z) * 180) / Math.PI + 360) % 360;
  }

  state.euler.setFromQuaternion(state.quaternion, 'YXZ');
}

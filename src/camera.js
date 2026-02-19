import * as THREE from 'three';
import { setCockpitVisible } from './aircraft.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { getWeatherState } from './weather.js';
import {
  CHASE_DISTANCE,
  CHASE_HEIGHT,
  CHASE_LERP_SPEED,
  COCKPIT_OFFSET_Y,
  COCKPIT_OFFSET_Z,
  CAMERA_FAR,
  RUNWAY_LENGTH,
  TURBULENCE_SHAKE_INTENSITY,
  LANDING_SHAKE_DECAY_RATE,
  CAMERA_TRANSITION_DURATION,
  CHASE_SPRING_STIFFNESS,
  CHASE_SPRING_DAMPING,
} from './constants.js';
import { lerp, clamp, smoothstep } from './utils.js';
import { getAircraftType } from './aircraftTypes.js';

let camera;
let mode = 'chase'; // 'chase' | 'cockpit' | 'orbit'
let replayMode = false;
const _targetPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();

// Orbit camera state
let orbitYaw = 0;
let orbitPitch = 0.3;
let orbitDist = 35;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let orbitReturnTimer = 0;

// Smooth transition state
let transitioning = false;
let transitionTime = 0;
let transitionFrom = new THREE.Vector3();
let transitionTarget = new THREE.Vector3();
let prevMode = 'chase';

// Spring-damper chase camera velocity
const cameraVelocity = new THREE.Vector3();
const _springDisplacement = new THREE.Vector3();
const _springForce = new THREE.Vector3();

// Shake state
let landingShakeIntensity = 0;
const shakeOffset = new THREE.Vector3();

// Freeze camera (crash effect)
let freezeTimer = 0;

export function initCamera() {
  camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.5,
    CAMERA_FAR
  );

  const startZ = RUNWAY_LENGTH / 2 - 100;
  camera.position.set(0, 1.5 + CHASE_HEIGHT, startZ + CHASE_DISTANCE);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const canvas = document.getElementById('app');

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    orbitReturnTimer = 0;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (mode !== 'orbit') {
      // Restore near clip plane if leaving cockpit mode
      if (mode === 'cockpit') {
        camera.near = 0.5;
        camera.updateProjectionMatrix();
        setCockpitVisible(false);
      }
      mode = 'orbit';
      const dx = camera.position.x - getActiveVehicle().position.x;
      const dz = camera.position.z - getActiveVehicle().position.z;
      orbitYaw = Math.atan2(dx, dz);
      orbitPitch = 0.3;
      orbitDist = isAircraft(getActiveVehicle()) ? CHASE_DISTANCE : 8;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    orbitYaw += dx * 0.005;
    orbitPitch = clamp(orbitPitch + dy * 0.005, -0.2, 1.3);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    if (!replayMode) orbitReturnTimer = 2.0;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (mode !== 'orbit') {
      // Restore near clip plane if leaving cockpit mode
      if (mode === 'cockpit') {
        camera.near = 0.5;
        camera.updateProjectionMatrix();
        setCockpitVisible(false);
      }
      mode = 'orbit';
      const dx = camera.position.x - getActiveVehicle().position.x;
      const dz = camera.position.z - getActiveVehicle().position.z;
      orbitYaw = Math.atan2(dx, dz);
      orbitPitch = 0.3;
      orbitDist = isAircraft(getActiveVehicle()) ? CHASE_DISTANCE : 8;
    }
    orbitDist = clamp(orbitDist + e.deltaY * 0.05, 3, 120);
    orbitReturnTimer = 3.0;
  }, { passive: false });

  return camera;
}

export function getCamera() {
  return camera;
}

export function getCameraMode() {
  return mode;
}

export function toggleCamera() {
  const oldMode = mode;
  if (mode === 'chase') {
    mode = 'cockpit';
  } else if (mode === 'cockpit') {
    mode = 'chase';
  } else {
    mode = 'chase';
  }

  // Start smooth transition
  if (oldMode !== mode) {
    transitioning = true;
    transitionTime = 0;
    transitionFrom.copy(camera.position);
    cameraVelocity.set(0, 0, 0);
    setCockpitVisible(mode === 'cockpit');

    // Adjust near clip plane for cockpit geometry visibility
    if (mode === 'cockpit') {
      camera.near = 0.1;
    } else {
      camera.near = 0.5;
    }
    camera.updateProjectionMatrix();
  }
}

export function triggerLandingShake(intensity) {
  landingShakeIntensity = Math.min(intensity * 0.5, 2.0);
}

export function freezeCamera(duration) {
  freezeTimer = duration;
}

export function updateCamera(dt) {
  if (!camera) return;

  // Freeze camera for crash effect
  if (freezeTimer > 0) {
    freezeTimer -= dt;
    return;
  }

  const state = getActiveVehicle();
  _forward.set(0, 0, -1).applyQuaternion(state.quaternion).normalize();

  // Decay landing shake
  if (landingShakeIntensity > 0.01) {
    landingShakeIntensity *= Math.exp(-LANDING_SHAKE_DECAY_RATE * dt);
  } else {
    landingShakeIntensity = 0;
  }

  // Compute shake offset (turbulence + landing)
  shakeOffset.set(0, 0, 0);
  if (!state.onGround) {
    const weather = getWeatherState();
    if (weather.turbulenceIntensity > 0.01) {
      const t = performance.now() * 0.001;
      const intensity = weather.turbulenceIntensity * TURBULENCE_SHAKE_INTENSITY;
      shakeOffset.set(
        Math.sin(t * 13.7) * intensity,
        Math.sin(t * 17.3) * intensity,
        Math.sin(t * 11.1) * intensity
      );
    }
  }
  if (landingShakeIntensity > 0) {
    const t = performance.now() * 0.001;
    shakeOffset.x += Math.sin(t * 25) * landingShakeIntensity * 0.3;
    shakeOffset.y += Math.sin(t * 30) * landingShakeIntensity * 0.5;
    shakeOffset.z += Math.sin(t * 20) * landingShakeIntensity * 0.2;
  }

  // Auto-return from orbit (disabled during replay)
  if (mode === 'orbit' && !isDragging && !replayMode) {
    orbitReturnTimer -= dt;
    if (orbitReturnTimer <= 0) {
      mode = 'chase';
      transitioning = true;
      transitionTime = 0;
      transitionFrom.copy(camera.position);
      cameraVelocity.set(0, 0, 0);
      // Restore near clip plane when leaving orbit (which could have been cockpit before)
      camera.near = 0.5;
      camera.updateProjectionMatrix();
    }
  }

  // Handle smooth transition
  if (transitioning) {
    transitionTime += dt;
    const t = clamp(transitionTime / CAMERA_TRANSITION_DURATION, 0, 1);
    const st = smoothstep(0, 1, t);

    // Compute where the target mode wants the camera
    computeModePosition(mode, state);
    transitionTarget.copy(_targetPos);

    // Interpolate position
    camera.position.lerpVectors(transitionFrom, transitionTarget, st);
    camera.position.add(shakeOffset);

    // Look at aircraft
    _lookTarget.copy(state.position).addScaledVector(_forward, 20);
    camera.lookAt(_lookTarget);

    if (t >= 1) {
      transitioning = false;
    }
    return;
  }

  if (mode === 'chase') {
    // Vehicle-specific chase parameters
    const isPlane = isAircraft(state);
    const chaseDist = isPlane ? CHASE_DISTANCE : 6;
    const chaseHeight = isPlane ? CHASE_HEIGHT : 2.5;
    const lookAhead = isPlane ? 30 : 15;

    // Camera follows behind and slightly above the vehicle
    _up.set(0, 1, 0).applyQuaternion(state.quaternion).normalize();
    _targetPos.copy(state.position);
    _targetPos.addScaledVector(_forward, -chaseDist);
    if (isPlane) {
      // Blend between world-up offset and aircraft-up offset (30% pitch follow)
      _targetPos.y = state.position.y + chaseHeight * 0.7;
      _targetPos.addScaledVector(_up, chaseHeight * 0.3);
    } else {
      _targetPos.y = state.position.y + chaseHeight;
    }

    if (isPlane) {
      // Spring-damper: F = -k*(pos - target) - c*velocity
      _springDisplacement.subVectors(camera.position, _targetPos);
      _springForce.copy(_springDisplacement).multiplyScalar(-CHASE_SPRING_STIFFNESS);
      _springForce.addScaledVector(cameraVelocity, -CHASE_SPRING_DAMPING);
      cameraVelocity.addScaledVector(_springForce, dt);
      camera.position.addScaledVector(cameraVelocity, dt);
    } else {
      // Cars: very tight lerp (almost locked, slight give for feel)
      const t = 1 - Math.exp(-60.0 * dt);
      camera.position.x = lerp(camera.position.x, _targetPos.x, t);
      camera.position.y = lerp(camera.position.y, _targetPos.y, t);
      camera.position.z = lerp(camera.position.z, _targetPos.z, t);
    }

    camera.position.add(shakeOffset);

    _lookTarget.copy(state.position).addScaledVector(_forward, lookAhead);
    camera.lookAt(_lookTarget);

  } else if (mode === 'cockpit') {
    const type = getAircraftType(state.currentType);
    const cpY = type.cockpitY || COCKPIT_OFFSET_Y;
    const cpZ = type.cockpitZ || COCKPIT_OFFSET_Z;
    _targetPos.set(0, cpY, cpZ);
    _targetPos.applyQuaternion(state.quaternion);
    _targetPos.add(state.position);
    camera.position.copy(_targetPos);
    camera.position.add(shakeOffset);

    _lookTarget.copy(state.position).addScaledVector(_forward, 100);
    camera.lookAt(_lookTarget);

  } else if (mode === 'orbit') {
    const cosP = Math.cos(orbitPitch);
    const sinP = Math.sin(orbitPitch);
    const cosY = Math.cos(orbitYaw);
    const sinY = Math.sin(orbitYaw);

    _targetPos.set(
      state.position.x + sinY * cosP * orbitDist,
      state.position.y + sinP * orbitDist + 3,
      state.position.z + cosY * cosP * orbitDist
    );

    const t = 1 - Math.exp(-6 * dt);
    camera.position.x = lerp(camera.position.x, _targetPos.x, t);
    camera.position.y = lerp(camera.position.y, _targetPos.y, t);
    camera.position.z = lerp(camera.position.z, _targetPos.z, t);

    camera.position.add(shakeOffset);
    camera.lookAt(state.position);
  }
}

export function setReplayCameraMode(enabled) {
  replayMode = enabled;
  if (enabled) {
    // Switch to orbit mode for free camera
    mode = 'orbit';
    orbitReturnTimer = 0;
    const state = getActiveVehicle();
    const dx = camera.position.x - state.position.x;
    const dz = camera.position.z - state.position.z;
    orbitYaw = Math.atan2(dx, dz);
    orbitPitch = 0.3;
    orbitDist = CHASE_DISTANCE * 1.5;
    // Restore near clip plane when entering replay (orbit mode)
    camera.near = 0.5;
    camera.updateProjectionMatrix();
  } else {
    mode = 'chase';
    transitioning = true;
    transitionTime = 0;
    transitionFrom.copy(camera.position);
    cameraVelocity.set(0, 0, 0);
    camera.near = 0.5;
    camera.updateProjectionMatrix();
  }
}

function computeModePosition(mode, state) {
  _forward.set(0, 0, -1).applyQuaternion(state.quaternion).normalize();

  if (mode === 'chase') {
    const isPlane = isAircraft(state);
    const chaseDist = isPlane ? CHASE_DISTANCE : 6;
    const chaseHeight = isPlane ? CHASE_HEIGHT : 2.5;
    _targetPos.copy(state.position);
    _targetPos.addScaledVector(_forward, -chaseDist);
    _targetPos.y = state.position.y + chaseHeight;
  } else if (mode === 'cockpit') {
    const type = getAircraftType(state.currentType);
    const cpY = type.cockpitY || COCKPIT_OFFSET_Y;
    const cpZ = type.cockpitZ || COCKPIT_OFFSET_Z;
    _targetPos.set(0, cpY, cpZ);
    _targetPos.applyQuaternion(state.quaternion);
    _targetPos.add(state.position);
  } else {
    _targetPos.copy(camera.position);
  }
}

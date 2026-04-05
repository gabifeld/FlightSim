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
let mode = 'chase'; // 'chase' | 'cockpit' | 'orbit' | 'flyby' | 'tower'
let replayMode = false;
const _targetPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _cockpitLookDir = new THREE.Vector3(0, 0, -1);
const _cockpitLookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

// Orbit camera state
let orbitYaw = 0;
let orbitPitch = 0.3;
let orbitDist = 35;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let orbitReturnTimer = 0;
let cockpitLookYaw = 0;
let cockpitLookPitch = 0;
let cockpitDragging = false;

const COCKPIT_LOOK_MAX_YAW = THREE.MathUtils.degToRad(100);
const COCKPIT_LOOK_MAX_PITCH = THREE.MathUtils.degToRad(60);
const COCKPIT_DRAG_SENS = 0.0035;
const COCKPIT_TRACKPAD_SENS = 0.0014;

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

// Crash camera state
const crashPos = new THREE.Vector3();
let crashCameraActive = false;
let crashCameraTimer = 0;

// Chase camera roll lag state
let cameraRoll = 0; // current camera roll angle (rad)

// Chase camera speed-dependent distance
let currentChaseDist = CHASE_DISTANCE;

// Flyby camera state
const flybyPos = new THREE.Vector3();
const flybyLookCurrent = new THREE.Vector3();
let flybySide = 1; // alternates +1 / -1

// Tower camera state
const TOWER_POSITIONS = [
  { x: 0, z: 0 },
  { x: 8000, z: -8000 },
  { x: -8000, z: 8000 },
  { x: -5000, z: -10000 },
  { x: 15000, z: 5000 },
  { x: -3000, z: -18000 },
];
const TOWER_HEIGHT = 30;
const towerPos = new THREE.Vector3();
const towerLookCurrent = new THREE.Vector3();
let towerFOV = 65;

// Mode cycle order
const MODE_CYCLE = ['chase', 'cockpit', 'orbit', 'flyby', 'tower'];

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
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // In cockpit mode, drag pans the pilot head view instead of switching camera mode.
    if (mode === 'cockpit') {
      cockpitDragging = true;
      return;
    }

    // Don't switch to orbit from flyby/tower (those are passive watch modes)
    if (mode === 'flyby' || mode === 'tower') return;

    orbitReturnTimer = 0;
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

    if (mode === 'cockpit' && cockpitDragging) {
      cockpitLookYaw = clamp(cockpitLookYaw - dx * COCKPIT_DRAG_SENS, -COCKPIT_LOOK_MAX_YAW, COCKPIT_LOOK_MAX_YAW);
      cockpitLookPitch = clamp(cockpitLookPitch + dy * COCKPIT_DRAG_SENS, -COCKPIT_LOOK_MAX_PITCH, COCKPIT_LOOK_MAX_PITCH);
      return;
    }

    if (mode === 'flyby' || mode === 'tower') return;

    orbitYaw += dx * 0.005;
    orbitPitch = clamp(orbitPitch + dy * 0.005, -0.2, 1.3);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    cockpitDragging = false;
    if (!replayMode && mode === 'orbit') orbitReturnTimer = 8.0;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    // Trackpad two-finger gesture in cockpit: look around.
    if (mode === 'cockpit') {
      cockpitLookYaw = clamp(
        cockpitLookYaw - e.deltaX * COCKPIT_TRACKPAD_SENS,
        -COCKPIT_LOOK_MAX_YAW,
        COCKPIT_LOOK_MAX_YAW
      );
      cockpitLookPitch = clamp(
        cockpitLookPitch + e.deltaY * COCKPIT_TRACKPAD_SENS,
        -COCKPIT_LOOK_MAX_PITCH,
        COCKPIT_LOOK_MAX_PITCH
      );
      return;
    }

    // Don't switch to orbit from flyby/tower
    if (mode === 'flyby' || mode === 'tower') return;

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
    orbitReturnTimer = 8.0;
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

  // Cycle: chase -> cockpit -> orbit -> flyby -> tower -> chase
  const idx = MODE_CYCLE.indexOf(mode);
  if (idx >= 0) {
    mode = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
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
    cockpitDragging = false;

    // Adjust near clip plane for cockpit geometry visibility
    if (mode === 'cockpit') {
      cockpitLookYaw = 0;
      cockpitLookPitch = 0;
      camera.near = 0.1;
    } else {
      camera.near = 0.5;
    }

    // Set orbit timer when entering orbit via toggle (prevent instant auto-return)
    if (mode === 'orbit') {
      orbitReturnTimer = 8.0;
    }

    // Initialize flyby camera when entering flyby mode
    if (mode === 'flyby') {
      initFlybyPosition(getActiveVehicle());
    }

    // Initialize tower camera when entering tower mode
    if (mode === 'tower') {
      initTowerPosition(getActiveVehicle());
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

export function startCrashCamera(pos) {
  crashPos.copy(pos);
  crashCameraActive = true;
  crashCameraTimer = 0;
  landingShakeIntensity = 3.0;
}

export function resetCrashCamera() {
  crashCameraActive = false;
  crashCameraTimer = 0;
}

// ── Flyby helpers ──────────────────────────────────────────────────────────

function initFlybyPosition(state) {
  _forward.set(0, 0, -1).applyQuaternion(state.quaternion).normalize();

  // Place camera to the SIDE of the flight path, slightly ahead
  // Aircraft flies past — classic flyby shot
  flybySide = -flybySide;
  const right = new THREE.Vector3().crossVectors(_forward, new THREE.Vector3(0, 1, 0)).normalize();

  flybyPos.copy(state.position);
  flybyPos.addScaledVector(_forward, 100);   // slightly ahead
  flybyPos.addScaledVector(right, 150 * flybySide); // well off to the side
  flybyPos.y = Math.max(state.position.y - 10, 15); // slightly below or at altitude, min 15m

  // Initialize look target to current aircraft position
  flybyLookCurrent.copy(state.position);
}

// ── Tower helpers ──────────────────────────────────────────────────────────

function initTowerPosition(state) {
  // Find nearest tower to the aircraft
  let minDist = Infinity;
  let nearest = TOWER_POSITIONS[0];
  for (const tp of TOWER_POSITIONS) {
    const dx = state.position.x - tp.x;
    const dz = state.position.z - tp.z;
    const d = dx * dx + dz * dz;
    if (d < minDist) {
      minDist = d;
      nearest = tp;
    }
  }

  towerPos.set(nearest.x, TOWER_HEIGHT, nearest.z);
  towerLookCurrent.copy(state.position);
  towerFOV = 65;
}

export function updateCamera(dt) {
  if (!camera) return;

  // Crash camera: dramatic pull-back with shake
  if (crashCameraActive) {
    crashCameraTimer += dt;
    if (crashCameraTimer < 3.0) {
      // Pull back from crash site over 3 seconds
      const t = crashCameraTimer / 3.0;
      const dist = 10 + t * 60; // 10m to 70m away
      const height = 5 + t * 40; // rising up
      const angle = t * 1.2; // slow orbit
      camera.position.set(
        crashPos.x + Math.sin(angle) * dist,
        crashPos.y + height,
        crashPos.z + Math.cos(angle) * dist
      );
      camera.lookAt(crashPos);
      // Decaying shake
      const shakeI = 2.0 * Math.exp(-crashCameraTimer * 1.5);
      const now = performance.now() * 0.001;
      camera.position.x += Math.sin(now * 25) * shakeI * 0.3;
      camera.position.y += Math.sin(now * 30) * shakeI * 0.5;
      camera.updateProjectionMatrix();
      return;
    }
    // After 3s, stay at final position looking at crash
    camera.lookAt(crashPos);
    camera.updateProjectionMatrix();
    return;
  }

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

  // Compute shake offset (turbulence + landing) for external cameras only.
  shakeOffset.set(0, 0, 0);
  if (mode !== 'cockpit') {
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
  }

  // Auto-return from orbit after 8s of no interaction (disabled during replay)
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

  // Flyby auto-switch: if aircraft is 500m+ away from flyby point, return to chase
  if (mode === 'flyby' && !transitioning) {
    const dx = state.position.x - flybyPos.x;
    const dy = state.position.y - flybyPos.y;
    const dz = state.position.z - flybyPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > 1000 * 1000) {
      mode = 'chase';
      transitioning = true;
      transitionTime = 0;
      transitionFrom.copy(camera.position);
      cameraVelocity.set(0, 0, 0);
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

    // Restore FOV during transition to tower (lerp toward tower FOV)
    if (mode === 'tower') {
      const dist = camera.position.distanceTo(state.position);
      const targetFOV = computeTowerFOV(dist);
      towerFOV = lerp(65, targetFOV, st);
      camera.fov = towerFOV;
    }

    if (t >= 1) {
      transitioning = false;
      // Initialize look trackers after transition completes
      if (mode === 'flyby') {
        flybyLookCurrent.copy(state.position);
      }
      if (mode === 'tower') {
        towerLookCurrent.copy(state.position);
      }
    }
    camera.updateProjectionMatrix();
    return;
  }

  if (mode === 'chase') {
    // Vehicle-specific chase parameters
    const isPlane = isAircraft(state);
    const lookAhead = isPlane ? 30 : 20;

    // Camera follows behind and slightly above the vehicle
    _up.set(0, 1, 0).applyQuaternion(state.quaternion).normalize();

    if (isPlane) {
      // Speed-dependent chase distance: CHASE_DISTANCE at 0 m/s -> CHASE_DISTANCE * 1.6 at 250 m/s
      const speedFactor = clamp((state.speed || 0) / 250, 0, 1);
      const targetChaseDist = CHASE_DISTANCE * (1 + 0.6 * speedFactor);
      currentChaseDist = lerp(currentChaseDist, targetChaseDist, 1 - Math.exp(-2 * dt));

      const chaseHeight = CHASE_HEIGHT;
      _targetPos.copy(state.position);
      _targetPos.addScaledVector(_forward, -currentChaseDist);
      // Blend between world-up offset and aircraft-up offset (30% pitch follow)
      _targetPos.y = state.position.y + chaseHeight * 0.7;
      _targetPos.addScaledVector(_up, chaseHeight * 0.3);

      // Spring-damper: F = -k*(pos - target) - c*velocity
      _springDisplacement.subVectors(camera.position, _targetPos);
      _springForce.copy(_springDisplacement).multiplyScalar(-CHASE_SPRING_STIFFNESS);
      _springForce.addScaledVector(cameraVelocity, -CHASE_SPRING_DAMPING);
      cameraVelocity.addScaledVector(_springForce, dt);
      camera.position.addScaledVector(cameraVelocity, dt);
    } else {
      // Cars: use flat heading vector (not quaternion-derived _forward which has pitch/roll)
      const headRad = (state.heading || 0) * (Math.PI / 180);
      const flatFwdX = -Math.sin(headRad);
      const flatFwdZ = -Math.cos(headRad);

      const speedRatio = Math.min(Math.abs(state.speed || 0) / (state.config ? state.config.maxSpeed : 50), 1);
      const chaseDist = 8 + speedRatio * 3;
      const chaseHeight = 3.0 + speedRatio * 1.2;

      _targetPos.set(
        state.position.x - flatFwdX * chaseDist,
        state.position.y + chaseHeight,
        state.position.z - flatFwdZ * chaseDist
      );

      const posSmooth = 1 - Math.exp(-6.0 * dt);
      const ySmooth = 1 - Math.exp(-4.0 * dt);
      camera.position.x = lerp(camera.position.x, _targetPos.x, posSmooth);
      camera.position.z = lerp(camera.position.z, _targetPos.z, posSmooth);
      camera.position.y = lerp(camera.position.y, _targetPos.y, ySmooth);
    }

    camera.position.add(shakeOffset);

    if (isPlane) {
      _lookTarget.copy(state.position).addScaledVector(_forward, lookAhead);
    } else {
      // Cars: look ahead along flat heading
      const hRad = (state.heading || 0) * (Math.PI / 180);
      _lookTarget.set(
        state.position.x + (-Math.sin(hRad)) * lookAhead,
        state.position.y + 0.8,
        state.position.z + (-Math.cos(hRad)) * lookAhead
      );
    }
    camera.lookAt(_lookTarget);

    // Roll lag: camera roll follows aircraft roll with ~0.2s delay
    if (isPlane) {
      // Extract aircraft roll from its up vector projected against world up
      const aircraftUp = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
      const cameraForward = new THREE.Vector3();
      camera.getWorldDirection(cameraForward);
      const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
      // Aircraft roll component in camera's view = dot of aircraft up with camera right
      const targetRoll = -Math.asin(clamp(aircraftUp.dot(cameraRight), -1, 1));
      // Exponential lerp with ~0.2s time constant
      const rollLerp = 1 - Math.exp(-dt / 0.2);
      cameraRoll = lerp(cameraRoll, targetRoll * 0.4, rollLerp); // 40% of actual roll for subtlety
      // Apply roll to camera up vector
      const rollQuat = new THREE.Quaternion().setFromAxisAngle(cameraForward, cameraRoll);
      const rolledUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rollQuat);
      camera.up.copy(rolledUp);
    } else {
      camera.up.set(0, 1, 0);
      cameraRoll = 0;
    }

  } else if (mode === 'cockpit') {
    const type = getAircraftType(state.currentType);
    const cpY = type.cockpitY || COCKPIT_OFFSET_Y;
    const cpZ = type.cockpitZ || COCKPIT_OFFSET_Z;
    _targetPos.set(0, cpY, cpZ);
    _targetPos.applyQuaternion(state.quaternion);
    _targetPos.add(state.position);
    camera.position.copy(_targetPos);

    // Engine vibration: subtle 2-3Hz micro-shake
    const now = performance.now() * 0.001;
    const throttle = state.throttle || 0;
    // 0.3mm at idle, 0.5mm at full throttle (lerp between them)
    const vibeAmplitude = lerp(0.0003, 0.0005, throttle);
    // Incommensurate frequencies for natural-feeling vibration
    const vibeX = Math.sin(now * 15) * vibeAmplitude;
    const vibeY = Math.cos(now * 19) * vibeAmplitude;
    camera.position.x += vibeX;
    camera.position.y += vibeY;

    _cockpitLookEuler.set(cockpitLookPitch, cockpitLookYaw, 0);
    _cockpitLookDir.set(0, 0, -1).applyEuler(_cockpitLookEuler).applyQuaternion(state.quaternion).normalize();
    _lookTarget.copy(camera.position).addScaledVector(_cockpitLookDir, 100);
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

  } else if (mode === 'flyby') {
    // Camera stays at fixed world position, smoothly tracks aircraft
    camera.position.copy(flybyPos);
    camera.position.add(shakeOffset);

    // Smooth lookAt: lerp the look target toward aircraft position
    const lerpFactor = 1 - Math.exp(-0.05 / (dt || 0.016) * dt * 60); // ~0.05 per frame at 60fps
    flybyLookCurrent.lerp(state.position, clamp(lerpFactor, 0, 1));
    camera.lookAt(flybyLookCurrent);

  } else if (mode === 'tower') {
    // Camera at tower position, smooth tracking with dynamic FOV
    camera.position.copy(towerPos);
    camera.position.add(shakeOffset);

    // Smooth lookAt with lerp 0.08
    const towerLerp = 1 - Math.exp(-0.08 / (dt || 0.016) * dt * 60);
    towerLookCurrent.lerp(state.position, clamp(towerLerp, 0, 1));
    camera.lookAt(towerLookCurrent);

    // Dynamic FOV based on distance: 65 deg at 200m, 30 deg at 2000m+
    const dist = camera.position.distanceTo(state.position);
    const targetFOV = computeTowerFOV(dist);
    towerFOV = lerp(towerFOV, targetFOV, 1 - Math.exp(-3 * dt));
    camera.fov = towerFOV;
  }

  // Reset camera up for non-chase modes (chase sets its own rolled up vector)
  if (mode !== 'chase') {
    camera.up.set(0, 1, 0);
    cameraRoll = 0;
  }

  // G-force FOV compression (aircraft only, not in tower mode which has its own FOV)
  if (isAircraft(state) && mode !== 'tower') {
    const gForce = state.gForce || 1.0;
    const baseFOV = 65;
    const gFovOffset = (gForce - 1.0) * -2.0;
    camera.fov = clamp(baseFOV + gFovOffset, 50, 85);

    // Stall buffet camera shake
    const stallAngle = (state.config && state.config.stallAoa) || 0.38;
    if (mode !== 'cockpit' && state.aoa > stallAngle * 0.85 && state.speed > 5) {
      const intensity = clamp((state.aoa - stallAngle * 0.85) / (stallAngle * 0.15), 0, 1);
      const time = performance.now() * 0.001;
      const buffetY = Math.sin(time * 37) * Math.cos(time * 53) * intensity * 0.3;
      const buffetX = Math.sin(time * 43) * Math.cos(time * 31) * intensity * 0.15;
      camera.position.y += buffetY;
      camera.position.x += buffetX;
    }
  }

  // Dynamic near plane — scale with altitude to reduce z-fighting
  // Must stay well below camera-to-aircraft distance (~15m chase, ~3m orbit min)
  if (mode !== 'cockpit') {
    const alt = camera.position.y;
    const nearTarget = alt > 50 ? clamp(alt * 0.003, 0.5, 2) : 0.5;
    camera.near += (nearTarget - camera.near) * clamp(dt * 4, 0, 1);
  }

  camera.updateProjectionMatrix();
}

export function setReplayCameraMode(enabled) {
  replayMode = enabled;
  cockpitDragging = false;
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

function computeTowerFOV(dist) {
  // 65 deg at 200m, 30 deg at 2000m+, linearly interpolated
  const t = clamp((dist - 200) / (2000 - 200), 0, 1);
  return lerp(65, 30, t);
}

function computeModePosition(mode, state) {
  _forward.set(0, 0, -1).applyQuaternion(state.quaternion).normalize();

  if (mode === 'chase') {
    const isPlane = isAircraft(state);
    const chaseDist = isPlane ? currentChaseDist : 8;
    const chaseHeight = isPlane ? CHASE_HEIGHT : 3.2;
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
  } else if (mode === 'flyby') {
    _targetPos.copy(flybyPos);
  } else if (mode === 'tower') {
    _targetPos.copy(towerPos);
  } else {
    _targetPos.copy(camera.position);
  }
}

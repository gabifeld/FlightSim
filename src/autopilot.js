// Autopilot system with PID controllers
// Modes: HDG, ALT, VS, SPD, APR

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { computeILSGuidance } from './landing.js';
import { clamp } from './utils.js';
import { MS_TO_FPM, M_TO_FEET } from './constants.js';

// PID controller
class PID {
  constructor(kp, ki, kd, min, max) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.min = min;
    this.max = max;
    this.integral = 0;
    this.lastError = 0;
    this.lastTime = 0;
  }

  update(error, dt) {
    // Proportional
    const p = this.kp * error;

    // Integral with anti-windup
    this.integral += error * dt;
    const maxIntegral = (this.max - this.min) / (2 * Math.max(this.ki, 0.001));
    this.integral = clamp(this.integral, -maxIntegral, maxIntegral);
    const i = this.ki * this.integral;

    // Derivative
    const derivative = (error - this.lastError) / Math.max(dt, 0.001);
    const d = this.kd * derivative;
    this.lastError = error;

    return clamp(p + i + d, this.min, this.max);
  }

  reset() {
    this.integral = 0;
    this.lastError = 0;
  }
}

// Autopilot state
const ap = {
  engaged: false,
  hdgHold: false,
  altHold: false,
  vsMode: false,
  spdHold: false,
  aprMode: false,

  targetHeading: 0,
  targetAltitude: 0,
  targetVS: 0,       // ft/min
  targetSpeed: 0,    // m/s

  // APR capture state
  locCaptured: false,
  gsCaptured: false,

  // Output commands
  pitchCommand: 0,
  rollCommand: 0,
  throttleCommand: -1, // -1 = not controlling

  disconnectReason: '',
};

// PID controllers
const hdgPID = new PID(0.03, 0.001, 0.01, -1, 1);       // roll output
const altPID = new PID(0.8, 0.05, 0.2, -1500, 1500);     // VS target output (fpm)
const vsPID = new PID(0.003, 0.0005, 0.001, -1, 1);      // pitch output
const spdPID = new PID(0.15, 0.02, 0.05, -0.2, 0.2);     // throttle delta/sec
const locPID = new PID(0.04, 0.002, 0.015, -1, 1);        // roll output from localizer
const gsPID = new PID(0.6, 0.03, 0.15, -800, 800);        // VS output from glideslope

// Normalize heading difference to -180..180
function headingError(target, current) {
  let err = target - current;
  while (err > 180) err -= 360;
  while (err < -180) err += 360;
  return err;
}

export function initAutopilot() {
  // Reset all state
  ap.engaged = false;
  ap.hdgHold = false;
  ap.altHold = false;
  ap.vsMode = false;
  ap.spdHold = false;
  ap.aprMode = false;
  ap.locCaptured = false;
  ap.gsCaptured = false;
  ap.pitchCommand = 0;
  ap.rollCommand = 0;
  ap.throttleCommand = -1;
}

export function isAPEngaged() {
  return ap.engaged;
}

export function getAPState() {
  return { ...ap };
}

export function toggleAPMaster() {
  if (ap.engaged) {
    disconnectAP('MANUAL DISCONNECT');
  } else {
    ap.engaged = true;
    ap.disconnectReason = '';
    // Capture current values as targets if no modes active
    ap.targetHeading = Math.round(getActiveVehicle().heading);
    ap.targetAltitude = Math.round(getActiveVehicle().altitude * M_TO_FEET);
    ap.targetSpeed = getActiveVehicle().speed;
  }
}

export function toggleHDGHold() {
  if (!ap.engaged) return;
  ap.hdgHold = !ap.hdgHold;
  if (ap.hdgHold) {
    ap.targetHeading = Math.round(getActiveVehicle().heading);
    ap.aprMode = false;
    hdgPID.reset();
  }
}

export function toggleALTHold() {
  if (!ap.engaged) return;
  ap.altHold = !ap.altHold;
  if (ap.altHold) {
    ap.targetAltitude = Math.round(getActiveVehicle().altitude * M_TO_FEET);
    ap.vsMode = false;
    altPID.reset();
    vsPID.reset();
  }
}

export function toggleVSMode() {
  if (!ap.engaged) return;
  ap.vsMode = !ap.vsMode;
  if (ap.vsMode) {
    ap.targetVS = Math.round(getActiveVehicle().verticalSpeed * MS_TO_FPM / 100) * 100;
    ap.altHold = false;
    vsPID.reset();
  }
}

export function toggleSPDHold() {
  if (!ap.engaged) return;
  ap.spdHold = !ap.spdHold;
  if (ap.spdHold) {
    ap.targetSpeed = getActiveVehicle().speed;
    spdPID.reset();
  }
}

export function toggleAPRMode() {
  if (!ap.engaged) return;
  ap.aprMode = !ap.aprMode;
  if (ap.aprMode) {
    ap.hdgHold = false;
    ap.altHold = false;
    ap.vsMode = false;
    ap.locCaptured = false;
    ap.gsCaptured = false;
    locPID.reset();
    gsPID.reset();
  }
}

export function adjustTargetHeading(delta) {
  ap.targetHeading = ((ap.targetHeading + delta) % 360 + 360) % 360;
}

export function adjustTargetAltitude(delta) {
  ap.targetAltitude = Math.max(0, ap.targetAltitude + delta);
}

export function adjustTargetVS(delta) {
  ap.targetVS = clamp(ap.targetVS + delta, -3000, 3000);
}

function disconnectAP(reason) {
  ap.engaged = false;
  ap.hdgHold = false;
  ap.altHold = false;
  ap.vsMode = false;
  ap.spdHold = false;
  ap.aprMode = false;
  ap.locCaptured = false;
  ap.gsCaptured = false;
  ap.pitchCommand = 0;
  ap.rollCommand = 0;
  ap.throttleCommand = -1;
  ap.disconnectReason = reason || '';

  // Reset all PIDs
  hdgPID.reset();
  altPID.reset();
  vsPID.reset();
  spdPID.reset();
  locPID.reset();
  gsPID.reset();
}

export function updateAutopilot(dt) {
  if (!ap.engaged) {
    ap.pitchCommand = 0;
    ap.rollCommand = 0;
    ap.throttleCommand = -1;
    return;
  }

  const state = getActiveVehicle();

  // Auto-disconnect conditions
  if (state.onGround) {
    disconnectAP('ON GROUND');
    return;
  }

  const altFt = state.altitude * M_TO_FEET;
  const vsFPM = state.verticalSpeed * MS_TO_FPM;

  // Stall protection - disconnect
  const stallAoa = state.config ? state.config.stallAoa : 0.38;
  if (Math.abs(state.aoa) > stallAoa * 0.9) {
    disconnectAP('STALL PROTECTION');
    return;
  }

  // Heading hold
  if (ap.hdgHold) {
    const hErr = headingError(ap.targetHeading, state.heading);
    ap.rollCommand = hdgPID.update(hErr, dt);
    // Bank limit 25 degrees
    ap.rollCommand = clamp(ap.rollCommand, -0.44, 0.44);
  }

  // Approach mode
  if (ap.aprMode) {
    const ils = computeILSGuidance(state);
    if (ils && !ils.pastThreshold) {
      // Localizer tracking
      const locErr = -ils.locDots; // negative because roll right corrects left deviation
      ap.rollCommand = locPID.update(locErr, dt);
      ap.rollCommand = clamp(ap.rollCommand, -0.35, 0.35);

      if (Math.abs(ils.locDots) < 0.5) ap.locCaptured = true;

      // Glideslope tracking
      if (ils.distNM < 8) {
        const gsTargetVS = gsPID.update(-ils.gsDots, dt);
        const vsErr = gsTargetVS - vsFPM;
        ap.pitchCommand = vsPID.update(vsErr, dt);

        if (Math.abs(ils.gsDots) < 0.5) ap.gsCaptured = true;
      }

      // Auto-disconnect at minimums (200ft AGL)
      if (state.altitudeAGL * M_TO_FEET < 200 && ap.gsCaptured) {
        disconnectAP('MINIMUMS');
        return;
      }
    }
  }

  // Altitude hold (computes target VS, then uses VS PID)
  if (ap.altHold && !ap.aprMode) {
    const altErr = ap.targetAltitude - altFt;
    const targetVS = altPID.update(altErr, dt);
    const vsErr = targetVS - vsFPM;
    ap.pitchCommand = vsPID.update(vsErr, dt);
  }

  // VS mode
  if (ap.vsMode && !ap.aprMode) {
    const vsErr = ap.targetVS - vsFPM;
    ap.pitchCommand = vsPID.update(vsErr, dt);
  }

  // Speed hold (auto-throttle)
  if (ap.spdHold) {
    const spdErr = ap.targetSpeed - state.speed;
    const throttleDelta = spdPID.update(spdErr, dt);
    ap.throttleCommand = clamp(state.throttle + throttleDelta * dt, 0, 1);
  } else {
    ap.throttleCommand = -1;
  }
}

export { disconnectAP };

// Advanced flight dynamics module
// Stall/spin state machine, engine-out yaw, G-force onset, density altitude, crosswind handling.
// Pure logic -- no Three.js rendering. Called from physics.js each frame.

// ---- Stall state enum ----
export const STALL_STATES = Object.freeze({
  NORMAL:         0,
  BUFFET:         1,
  STALL:          2,
  INCIPIENT_SPIN: 3,
  DEVELOPED_SPIN: 4,
});

// ---- Constants ----

const G_ONSET_RATE         = 1.5;   // seconds -- time constant for sustained-G tracking
const BUFFET_MARGIN_RAD    = 3 * (Math.PI / 180);  // buffet starts 3 deg before stall AOA
const BUFFET_FREQ          = 8;     // Hz
const BUFFET_PITCH_AMP     = 0.01;  // rad peak
const BUFFET_ROLL_AMP      = 0.02;  // rad peak
const WING_DROP_RATE        = 0.3;  // rad/s base (full realism)
const WING_DROP_YAW_COUPLE  = 0.4;  // fraction of roll that couples into yaw

const SPIN_ENTRY_TIME       = 1.0;  // seconds of pro-spin inputs before spin entry
const SPIN_ROLL_RATE        = 1.5;  // rad/s autorotation
const SPIN_PITCH_DOWN       = 0.8;  // rad/s nose-down tendency in spin
const SPIN_YAW_RATE         = 1.0;  // rad/s yaw in spin direction
const SPIN_DEVELOPED_TIME   = 2.0;  // seconds from incipient to developed

const RECOVERY_THROTTLE_MAX = 0.1;  // throttle must be below this
const RECOVERY_STICK_FWD    = -0.3; // pitch input must be below (forward stick)
const RECOVERY_RUDDER_MIN   = 0.3;  // opposing rudder must exceed this magnitude

// ---- Public API ----

/**
 * Create a fresh flight-model state object.
 */
export function createFlightModelState() {
  return {
    stallState:     STALL_STATES.NORMAL,
    stallTimer:     0,       // time spent in current stall sub-state
    spinDirection:  0,       // +1 or -1 once spin begins
    spinTimer:      0,       // time in spin (for incipient -> developed transition)
    gOnset:         1.0,     // sustained-G tracker (starts at 1G level flight)
    buffetPhase:    0,       // continuous phase for buffet oscillation
    wingDropSeed:   0,       // +1 or -1, randomised per stall event
    wingDropActive: false,
    engineOutYaw:   0,       // last computed engine-out yaw torque
    crosswindYaw:   0,       // last computed crosswind yaw
    recoveryTimer:  0,       // tracks correct recovery inputs duration
    autoRecoverTimer: 0,     // sim-lite auto-recovery countdown
  };
}

// Aliases used in the plan's test signatures
export const initFlightModel  = createFlightModelState;
export function resetFlightModel() { return createFlightModelState(); }

/**
 * Main per-frame update.
 *
 * @param {object} fms   - mutable flight-model state (from createFlightModelState)
 * @param {object} input - current aircraft/physics snapshot:
 *   { aoa, isStalling, stallAoa, onGround, gForce, speed, throttle,
 *     pitchInput, rollInput, yawInput, engineFailed[], engineArms[], dt }
 * @param {object} realism - thresholds from realism.js profile:
 *   { spinAutoRecovery, spinRecoveryTime, wingDropIntensity, vmcEnabled, ... }
 */
export function updateFlightModel(fms, input, realism) {
  const {
    aoa, isStalling, stallAoa, onGround, gForce, speed,
    throttle, pitchInput, rollInput, yawInput,
    engineFailed, engineArms, dt,
  } = input;

  // ---- G-force onset model ----
  // Exponential first-order lag: tracks sustained G with a 1.5 s time constant.
  fms.gOnset += (gForce - fms.gOnset) * (1 - Math.exp(-dt / G_ONSET_RATE));

  // ---- On ground: no stall/spin processing ----
  if (onGround) {
    if (fms.stallState !== STALL_STATES.NORMAL) {
      _resetStallState(fms);
    }
    _updateEngineOutYaw(fms, input, realism);
    return;
  }

  // ---- Stall / spin state machine ----
  const absAoa       = Math.abs(aoa);
  const buffetOnset  = stallAoa - BUFFET_MARGIN_RAD;
  const inBuffetZone = absAoa >= buffetOnset && absAoa < stallAoa && speed > 5;

  switch (fms.stallState) {

    // ---- NORMAL ----
    case STALL_STATES.NORMAL:
      if (isStalling) {
        _enterStall(fms);
      } else if (inBuffetZone) {
        fms.stallState = STALL_STATES.BUFFET;
        fms.stallTimer = 0;
      }
      break;

    // ---- BUFFET ----
    case STALL_STATES.BUFFET:
      fms.stallTimer += dt;
      if (isStalling) {
        _enterStall(fms);
      } else if (!inBuffetZone) {
        _resetStallState(fms);
      }
      // Advance buffet oscillation phase
      fms.buffetPhase += dt * BUFFET_FREQ * Math.PI * 2;
      break;

    // ---- STALL ----
    case STALL_STATES.STALL:
      fms.stallTimer += dt;
      // Advance buffet phase (buffet persists through stall)
      fms.buffetPhase += dt * BUFFET_FREQ * Math.PI * 2;

      // Check for recovery (AOA below stall)
      if (!isStalling) {
        // Drop back to buffet or normal depending on AOA
        fms.stallState = inBuffetZone ? STALL_STATES.BUFFET : STALL_STATES.NORMAL;
        fms.stallTimer = 0;
        fms.wingDropActive = false;
        break;
      }

      // Check for spin entry: pro-spin inputs held for SPIN_ENTRY_TIME
      if (_isProSpinInput(fms, pitchInput, yawInput, rollInput)) {
        fms.spinTimer += dt;
        if (fms.spinTimer >= SPIN_ENTRY_TIME) {
          fms.stallState = STALL_STATES.INCIPIENT_SPIN;
          fms.spinTimer  = 0;
          // Lock spin direction from wing drop or yaw input
          if (fms.spinDirection === 0) {
            fms.spinDirection = yawInput >= 0 ? 1 : -1;
          }
        }
      } else {
        fms.spinTimer = Math.max(0, fms.spinTimer - dt); // relax toward zero
      }
      break;

    // ---- INCIPIENT SPIN ----
    case STALL_STATES.INCIPIENT_SPIN:
      fms.stallTimer += dt;
      fms.spinTimer  += dt;
      fms.buffetPhase += dt * BUFFET_FREQ * Math.PI * 2;

      // Transition to developed spin after SPIN_DEVELOPED_TIME
      if (fms.spinTimer >= SPIN_DEVELOPED_TIME) {
        fms.stallState = STALL_STATES.DEVELOPED_SPIN;
        fms.spinTimer  = 0;
      }

      // Check for recovery inputs
      if (_isRecoveryInput(fms, throttle, pitchInput, yawInput)) {
        fms.recoveryTimer += dt;
        if (fms.recoveryTimer >= 0.5) {
          // Successful recovery -- back to stall, pilot must still reduce AOA
          fms.stallState    = STALL_STATES.STALL;
          fms.spinTimer     = 0;
          fms.recoveryTimer = 0;
        }
      } else {
        fms.recoveryTimer = 0;
      }

      // Sim-lite auto-recovery
      if (realism.spinAutoRecovery) {
        fms.autoRecoverTimer += dt;
        if (fms.autoRecoverTimer >= (realism.spinRecoveryTime || 3)) {
          _resetStallState(fms);
        }
      }
      break;

    // ---- DEVELOPED SPIN ----
    case STALL_STATES.DEVELOPED_SPIN:
      fms.stallTimer += dt;
      fms.spinTimer  += dt;
      fms.buffetPhase += dt * BUFFET_FREQ * Math.PI * 2;

      // Only correct recovery procedure exits
      if (_isRecoveryInput(fms, throttle, pitchInput, yawInput)) {
        fms.recoveryTimer += dt;
        if (fms.recoveryTimer >= 1.0) {
          // Transition back through incipient -> stall
          fms.stallState    = STALL_STATES.INCIPIENT_SPIN;
          fms.spinTimer     = 0;
          fms.recoveryTimer = 0;
        }
      } else {
        fms.recoveryTimer = 0;
      }

      // Sim-lite auto-recovery
      if (realism.spinAutoRecovery) {
        fms.autoRecoverTimer += dt;
        if (fms.autoRecoverTimer >= (realism.spinRecoveryTime || 3)) {
          _resetStallState(fms);
        }
      }
      break;
  }

  // ---- Engine-out yaw ----
  _updateEngineOutYaw(fms, input, realism);
}

// ---- Getters (pure reads from fms) ----

export function getStallState(fms) {
  return fms.stallState;
}

export function getGOnset(fms) {
  return fms.gOnset;
}

/**
 * ISA barometric density ratio.
 * Returns 1.0 at sea level, ~0.74 at 3000 m, ~0.53 at 6000 m, min 0.1.
 */
export function getDensityRatio(altitudeMeters) {
  return Math.max(0.1, Math.pow(1 - 0.0000226 * altitudeMeters, 4.256));
}

/**
 * Returns buffet perturbation torques { pitch, roll } in radians.
 * Zero outside buffet/stall states.
 */
export function getBuffetPerturbation(fms) {
  if (fms.stallState < STALL_STATES.BUFFET) {
    return { pitch: 0, roll: 0 };
  }

  // Intensity ramps from 0 at buffet onset to 1 at full stall
  let intensity;
  if (fms.stallState === STALL_STATES.BUFFET) {
    // Partial intensity during pre-stall buffet
    // stallTimer isn't capped but buffet is bounded by AOA range -- use a gentle ramp
    intensity = Math.min(fms.stallTimer * 2, 0.5); // up to 50 % amplitude in buffet
  } else {
    intensity = 1.0; // full amplitude once stalled or in spin
  }

  const pitch = Math.sin(fms.buffetPhase) * BUFFET_PITCH_AMP * intensity;
  const roll  = Math.sin(fms.buffetPhase + 1.5) * BUFFET_ROLL_AMP * intensity;
  return { pitch, roll };
}

/**
 * Returns torques for spin states { pitch, roll, yaw } in rad/s.
 * Includes wing-drop roll during plain stall state.
 * Caller multiplies by dt before applying as quaternion deltas.
 */
export function getSpinTorques(fms) {
  const out = { pitch: 0, roll: 0, yaw: 0 };

  // Wing-drop during stall (asymmetric lift loss)
  if (fms.stallState === STALL_STATES.STALL && fms.wingDropActive) {
    out.roll = fms.wingDropSeed * WING_DROP_RATE;
    out.yaw  = fms.wingDropSeed * WING_DROP_RATE * WING_DROP_YAW_COUPLE;
  }

  // Incipient spin: ramping autorotation
  if (fms.stallState === STALL_STATES.INCIPIENT_SPIN) {
    const ramp = Math.min(fms.spinTimer / SPIN_DEVELOPED_TIME, 1);
    out.roll  = fms.spinDirection * SPIN_ROLL_RATE * ramp;
    out.pitch = SPIN_PITCH_DOWN * ramp;
    out.yaw   = fms.spinDirection * SPIN_YAW_RATE * ramp;
  }

  // Developed spin: full autorotation
  if (fms.stallState === STALL_STATES.DEVELOPED_SPIN) {
    out.roll  = fms.spinDirection * SPIN_ROLL_RATE;
    out.pitch = SPIN_PITCH_DOWN;
    out.yaw   = fms.spinDirection * SPIN_YAW_RATE;
  }

  return out;
}

/**
 * Returns engine-out yaw torque (rad/s) from asymmetric thrust.
 * Positive = yaw right, negative = yaw left.
 */
export function getEngineOutYaw(fms) {
  return fms.engineOutYaw;
}

/**
 * Returns the full flight-model snapshot for consumers (HUD, camera effects, etc.).
 */
export function getFlightModelState(fms) {
  return {
    stallState:    fms.stallState,
    gOnset:        fms.gOnset,
    spinDirection: fms.spinDirection,
    engineOutYaw:  fms.engineOutYaw,
    crosswindYaw:  fms.crosswindYaw,
    wingDropActive: fms.wingDropActive,
    buffetIntensity: fms.stallState >= STALL_STATES.BUFFET
      ? (fms.stallState === STALL_STATES.BUFFET ? Math.min(fms.stallTimer * 2, 0.5) : 1.0)
      : 0,
  };
}

// ---- Internal helpers ----

function _resetStallState(fms) {
  fms.stallState      = STALL_STATES.NORMAL;
  fms.stallTimer      = 0;
  fms.spinDirection   = 0;
  fms.spinTimer       = 0;
  fms.buffetPhase     = 0;
  fms.wingDropSeed    = 0;
  fms.wingDropActive  = false;
  fms.recoveryTimer   = 0;
  fms.autoRecoverTimer = 0;
}

function _enterStall(fms) {
  fms.stallState = STALL_STATES.STALL;
  fms.stallTimer = 0;
  fms.spinTimer  = 0;
  fms.autoRecoverTimer = 0;

  // Seed asymmetric wing drop direction (randomised once per stall event)
  if (!fms.wingDropActive) {
    fms.wingDropSeed   = Math.random() > 0.5 ? 1 : -1;
    fms.wingDropActive = true;
    // Set initial spin direction from wing drop (may be overridden by yaw input later)
    fms.spinDirection  = fms.wingDropSeed;
  }
}

/**
 * Detect pro-spin inputs: full back stick AND rudder in the direction of roll/spin.
 */
function _isProSpinInput(fms, pitchInput, yawInput, rollInput) {
  const backStick = pitchInput > 0.5;
  const dir       = fms.wingDropSeed || fms.spinDirection;
  // Rudder in same direction as the developing spin
  const proRudder = dir !== 0 ? (yawInput * dir > 0.3) : Math.abs(yawInput) > 0.3;
  return backStick && proRudder;
}

/**
 * Detect correct spin recovery inputs:
 *   1. Throttle idle
 *   2. Opposite rudder (against spin direction)
 *   3. Forward stick (break AOA)
 */
function _isRecoveryInput(fms, throttle, pitchInput, yawInput) {
  if (throttle > RECOVERY_THROTTLE_MAX) return false;
  if (pitchInput > RECOVERY_STICK_FWD) return false; // need forward stick (negative pitch)
  // Rudder must oppose the spin direction
  const dir = fms.spinDirection;
  if (dir === 0) return false;
  const opposingRudder = -yawInput * dir; // positive when rudder opposes spin
  if (opposingRudder < RECOVERY_RUDDER_MIN) return false;
  return true;
}

/**
 * Compute asymmetric thrust yaw from failed engines.
 * engineFailed: boolean[] per engine index (true = dead)
 * engineArms:   number[] per engine, signed distance from centerline (negative = left)
 * throttle:     current throttle [0,1]
 * speed:        airspeed for Vmc check
 */
function _updateEngineOutYaw(fms, input, realism) {
  const { engineFailed, engineArms, throttle, speed } = input;

  if (!engineFailed || !engineArms || engineArms.length === 0) {
    fms.engineOutYaw = 0;
    return;
  }

  const numEngines = engineArms.length;
  if (numEngines <= 1) {
    // Single-engine aircraft: no asymmetric thrust possible
    fms.engineOutYaw = 0;
    return;
  }

  // Compute net yaw moment from asymmetric thrust.
  // Each running engine produces thrust proportional to throttle.
  // The net moment is sum(thrust_i * arm_i) for running engines only.
  // With symmetric arms and all engines running, net moment is zero.
  const thrustPerEngine = throttle / numEngines; // normalised thrust share
  let netMoment = 0;

  for (let i = 0; i < numEngines; i++) {
    const arm     = i < engineArms.length ? engineArms[i] : 0;
    const failed  = i < engineFailed.length ? engineFailed[i] : false;
    if (!failed) {
      netMoment += thrustPerEngine * arm;
    }
  }

  // Scale: yaw rate produced by the moment.  Tune factor converts dimensionless
  // moment into a yaw rate (rad/s).  Higher throttle = more asymmetry.
  const yawTorqueScale = 0.15; // tuning constant
  let yawRate = netMoment * yawTorqueScale;

  // Vmc gate (study mode only): below minimum control speed, rudder cannot
  // compensate -- the asymmetric yaw is amplified.
  if (realism.vmcEnabled && speed > 0) {
    const vmc = 35; // m/s (~68 kt), representative twin Vmc
    if (speed < vmc) {
      const vmcFactor = 1 + 2 * (1 - speed / vmc); // amplify up to 3x at zero speed
      yawRate *= vmcFactor;
    }
  }

  fms.engineOutYaw = yawRate;
}

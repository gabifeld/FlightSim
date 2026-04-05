// Camera visual stress effects — FOV compression, G-vignette, blackout/redout, speed shake,
// barrel distortion, desaturation, blackout brightness dim.
//
// PURE module: computes values but never touches the camera or post-processing
// directly. The caller reads outputs and applies them.

import { clamp, lerp } from './utils.js';
import { getRealism } from './realism.js';
import { getSetting } from './settings.js';

// ── Internal state ──────────────────────────────────────────────────────────

let camera = null;

// FOV
let currentFOV = 65;         // current smoothed FOV (degrees)
const BASE_FOV = 65;         // default resting FOV
const MIN_FOV = 55;          // narrowest at extreme speed
const FOV_SPEED_LOW = 80;    // m/s — FOV compression begins
const FOV_SPEED_HIGH = 250;  // m/s — FOV compression maxes out
const FOV_MAX_REDUCTION = 10; // degrees removed at max speed
const FOV_LERP_TAU = 2.0;   // seconds — smoothing time constant

// Vignette / blackout / redout
let vignetteIntensity = 0;   // 0-1, smoothed
let vignetteRaw = 0;         // 0-1, instant target
let vignetteIsRedout = false; // true when negative-G redout
let blackoutFactor = 0;      // 0-1, 0=normal 1=full blackout
let blackoutRaw = 0;         // target
let highGTimer = 0;          // seconds spent above blackout threshold continuously
const VIGNETTE_ONSET_TAU = 1.5;  // seconds — onset smoothing
const VIGNETTE_OFFSET_TAU = 1.0; // seconds — offset smoothing
const BLACKOUT_HOLD_TIME = 1.0;  // seconds above threshold before blackout starts
const BLACKOUT_FADE_IN = 1.0;    // seconds to go from dim to black
const BLACKOUT_DISABLED_DUR = 3.0; // seconds controls disabled
const BLACKOUT_FADE_OUT = 2.0;   // seconds to recover vision
let blackoutPhase = 'none';  // 'none' | 'onset' | 'disabled' | 'recovery'
let blackoutPhaseTimer = 0;

// Speed shake
let shakeX = 0;
let shakeY = 0;
let shakeZ = 0;
const SHAKE_SPEED_LOW = 80;   // m/s — shake begins
const SHAKE_SPEED_HIGH = 300;  // m/s — shake maxes out
const SHAKE_MAX_AMP = 0.015;   // meters — max per-axis amplitude at full intensity

// Barrel distortion (tunnel vision effect)
let barrelDistortion = 0;      // 0-0.02, smoothed
let barrelDistortionRaw = 0;   // target

// Desaturation (gray-out)
let desaturation = 0;          // 0-1, smoothed
let desaturationRaw = 0;       // target

// Blackout brightness dim
let blackoutDim = 0;           // 0-0.3, smoothed
let blackoutDimRaw = 0;        // target

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Store camera reference (read-only — we never mutate it).
 */
export function initCameraEffects(cam) {
  camera = cam;
  resetCameraEffects();
}

/**
 * Main per-frame update.
 *
 * @param {object} state  - active vehicle state (position, speed, gForce, etc.)
 * @param {number} dt     - frame delta in seconds
 * @param {number} gOnset - sustained G-onset value (from flight model / physics)
 */
export function updateCameraEffects(state, dt, gOnset) {
  if (dt <= 0) return;

  const realism = getRealism();
  const shakeScale = getSetting('cameraShakeScale');
  const isStudy = getSetting('realism') === 'study';

  // ── Realism-dependent thresholds ─────────────────────────────────────
  // Vignette onset/tunnel thresholds come from realism profile already.
  // Barrel distortion, desaturation, and blackout dim use new thresholds.
  const barrelLow  = isStudy ? 4.5 : 7.5;
  const barrelHigh = isStudy ? 6.0 : 9.0;
  const desatLow   = isStudy ? 6.0 : 9.0;
  const desatHigh  = isStudy ? 7.5 : 11.0;
  const dimLow     = isStudy ? 7.5 : 11.0;
  const dimHigh    = isStudy ? 9.0 : 13.0;

  // Override vignette/blackout/redout thresholds per realism setting.
  // The realism profile already contains the correct values from realism.js,
  // but the spec asks for specific adjustments:
  //   Study vignette onset: 4.0G, sim-lite: 7.0G
  //   Study blackout: 9.0G, sim-lite: never (99G)
  //   Study redout: -2.5G, sim-lite: -5.0G
  const vigOnset = isStudy ? 4.0 : 7.0;
  const vigTunnel = realism.gTunnelVision; // keep existing tunnel vision endpoint
  const blackoutThreshold = isStudy ? 9.0 : 99.0;
  const redoutThreshold = isStudy ? -2.5 : -5.0;

  // ── FOV compression ───────────────────────────────────────────────────
  const speed = state.speed || 0;
  const speedFactor = clamp((speed - FOV_SPEED_LOW) / (FOV_SPEED_HIGH - FOV_SPEED_LOW), 0, 1);
  const targetFOV = BASE_FOV - speedFactor * FOV_MAX_REDUCTION;
  // Exponential smoothing toward target
  currentFOV = lerp(currentFOV, targetFOV, 1 - Math.exp(-dt / FOV_LERP_TAU));

  // ── G-force vignette ──────────────────────────────────────────────────
  // gOnset is absolute: 1.0 = level flight. Positive G = pulling, negative G = pushing.
  if (gOnset > vigOnset) {
    // Positive G — vignette toward tunnel vision (black)
    vignetteRaw = clamp(
      (gOnset - vigOnset) / (vigTunnel - vigOnset),
      0, 1
    );
    vignetteIsRedout = false;
  } else if (gOnset < redoutThreshold) {
    // Negative G — redout (red tint)
    vignetteRaw = clamp(
      (redoutThreshold - gOnset) / 2,
      0, 1
    );
    vignetteIsRedout = true;
  } else {
    vignetteRaw = 0;
    // Keep redout flag stable during fade-out so color doesn't snap
  }

  // Smooth vignette with asymmetric onset/offset
  const isIncreasing = vignetteRaw > vignetteIntensity;
  const tau = isIncreasing ? VIGNETTE_ONSET_TAU : VIGNETTE_OFFSET_TAU;
  vignetteIntensity = lerp(vignetteIntensity, vignetteRaw, 1 - Math.exp(-dt / tau));
  // Clamp very small values to zero for clean idle
  if (vignetteIntensity < 0.001) {
    vignetteIntensity = 0;
  }

  // ── Barrel distortion (tunnel vision) ─────────────────────────────────
  if (gOnset > barrelLow) {
    barrelDistortionRaw = clamp(
      (gOnset - barrelLow) / (barrelHigh - barrelLow),
      0, 1
    ) * 0.02;
  } else {
    barrelDistortionRaw = 0;
  }
  {
    const bIsIncreasing = barrelDistortionRaw > barrelDistortion;
    const bTau = bIsIncreasing ? VIGNETTE_ONSET_TAU : VIGNETTE_OFFSET_TAU;
    barrelDistortion = lerp(barrelDistortion, barrelDistortionRaw, 1 - Math.exp(-dt / bTau));
    if (barrelDistortion < 0.0001) barrelDistortion = 0;
  }

  // ── Desaturation (gray-out) ───────────────────────────────────────────
  if (gOnset > desatLow) {
    desaturationRaw = clamp(
      (gOnset - desatLow) / (desatHigh - desatLow),
      0, 1
    );
  } else {
    desaturationRaw = 0;
  }
  {
    const dIsIncreasing = desaturationRaw > desaturation;
    const dTau = dIsIncreasing ? VIGNETTE_ONSET_TAU : VIGNETTE_OFFSET_TAU;
    desaturation = lerp(desaturation, desaturationRaw, 1 - Math.exp(-dt / dTau));
    if (desaturation < 0.001) desaturation = 0;
  }

  // ── Blackout brightness dim ───────────────────────────────────────────
  if (gOnset > dimLow) {
    blackoutDimRaw = clamp(
      (gOnset - dimLow) / (dimHigh - dimLow),
      0, 1
    ) * 0.3;
  } else {
    blackoutDimRaw = 0;
  }
  {
    const bdIsIncreasing = blackoutDimRaw > blackoutDim;
    const bdTau = bdIsIncreasing ? VIGNETTE_ONSET_TAU : VIGNETTE_OFFSET_TAU;
    blackoutDim = lerp(blackoutDim, blackoutDimRaw, 1 - Math.exp(-dt / bdTau));
    if (blackoutDim < 0.0001) blackoutDim = 0;
  }

  // ── Blackout / redout full-screen ─────────────────────────────────────
  updateBlackout(gOnset, dt, { ...realism, gBlackoutThreshold: blackoutThreshold });

  // ── Speed shake ───────────────────────────────────────────────────────
  if (shakeScale > 0 && speed > SHAKE_SPEED_LOW) {
    const shakeFactor = clamp(
      (speed - SHAKE_SPEED_LOW) / (SHAKE_SPEED_HIGH - SHAKE_SPEED_LOW),
      0, 1
    );
    const amp = SHAKE_MAX_AMP * shakeFactor * shakeScale * realism.cameraShakeScale;
    // Pseudo-random noise via incommensurate sine frequencies (same pattern as camera.js)
    const t = performance.now() * 0.001;
    shakeX = Math.sin(t * 13.7 + 1.3) * Math.cos(t * 7.1) * amp;
    shakeY = Math.sin(t * 17.3 + 2.7) * Math.cos(t * 11.3) * amp;
    shakeZ = Math.sin(t * 11.1 + 0.9) * Math.cos(t * 5.7) * amp * 0.6;
  } else {
    shakeX = 0;
    shakeY = 0;
    shakeZ = 0;
  }
}

/**
 * Returns the current smoothed FOV value (degrees).
 * The caller should set camera.fov to this value.
 */
export function getEffectFOV() {
  return currentFOV;
}

/**
 * Returns 0-1 vignette intensity for post-processing.
 * 0 = no vignette, 1 = full tunnel vision.
 */
export function getVignetteIntensity() {
  return vignetteIntensity;
}

/**
 * Returns whether the current vignette is a redout (negative G, red tint).
 * When false, vignette is blackout (positive G, black).
 */
export function isRedout() {
  return vignetteIsRedout;
}

/**
 * Returns vignette color as [r, g, b] (0-1 range).
 * Black for positive G, red for negative G.
 */
export function getVignetteColor() {
  return vignetteIsRedout ? [0.8, 0.0, 0.0] : [0.0, 0.0, 0.0];
}

/**
 * Returns 0-1 blackout factor.
 * 0 = normal vision, 1 = fully blacked out.
 * Caller uses this to fade the entire screen to black.
 */
export function getBlackoutFactor() {
  return blackoutFactor;
}

/**
 * Returns true when blackout has disabled pilot controls.
 */
export function areControlsDisabledByBlackout() {
  return blackoutPhase === 'disabled';
}

/**
 * Returns the speed-shake offset as { x, y, z } in meters.
 * Caller adds this to camera position.
 */
export function getShakeOffset() {
  return { x: shakeX, y: shakeY, z: shakeZ };
}

/**
 * Returns 0-0.02 barrel distortion intensity for tunnel vision effect.
 * Driven by sustained G-onset. 0 = no distortion.
 */
export function getBarrelDistortion() {
  return barrelDistortion;
}

/**
 * Returns 0-1 desaturation amount for gray-out effect.
 * 0 = full color, 1 = fully desaturated (grayscale).
 */
export function getDesaturation() {
  return desaturation;
}

/**
 * Returns 0-0.3 brightness dim amount for pre-blackout dimming.
 * 0 = no dim, 0.3 = 30% brightness reduction.
 */
export function getBlackoutDim() {
  return blackoutDim;
}

/**
 * Reset all effects to defaults (new flight, respawn, etc.).
 */
export function resetCameraEffects() {
  currentFOV = BASE_FOV;
  vignetteIntensity = 0;
  vignetteRaw = 0;
  vignetteIsRedout = false;
  blackoutFactor = 0;
  blackoutRaw = 0;
  highGTimer = 0;
  blackoutPhase = 'none';
  blackoutPhaseTimer = 0;
  shakeX = 0;
  shakeY = 0;
  shakeZ = 0;
  barrelDistortion = 0;
  barrelDistortionRaw = 0;
  desaturation = 0;
  desaturationRaw = 0;
  blackoutDim = 0;
  blackoutDimRaw = 0;
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * Blackout state machine.
 * Phases: none → onset → disabled → recovery → none
 *
 * - onset:    screen fades to black over BLACKOUT_FADE_IN seconds
 * - disabled: fully black, controls locked for BLACKOUT_DISABLED_DUR seconds
 * - recovery: fades back in over BLACKOUT_FADE_OUT seconds
 */
function updateBlackout(gOnset, dt, realism) {
  const threshold = realism.gBlackoutThreshold;

  // Track time spent above blackout threshold
  if (gOnset > threshold && isFinite(threshold)) {
    highGTimer += dt;
  } else {
    highGTimer = Math.max(0, highGTimer - dt * 2); // decay faster than accumulation
  }

  switch (blackoutPhase) {
    case 'none':
      // Enter onset if G held above threshold long enough
      if (highGTimer >= BLACKOUT_HOLD_TIME && isFinite(threshold)) {
        blackoutPhase = 'onset';
        blackoutPhaseTimer = 0;
      }
      blackoutFactor = 0;
      break;

    case 'onset':
      blackoutPhaseTimer += dt;
      blackoutFactor = clamp(blackoutPhaseTimer / BLACKOUT_FADE_IN, 0, 1);
      if (blackoutFactor >= 1) {
        blackoutPhase = 'disabled';
        blackoutPhaseTimer = 0;
        blackoutFactor = 1;
      }
      // Allow abort if G drops before full blackout
      if (highGTimer <= 0) {
        blackoutPhase = 'recovery';
        blackoutPhaseTimer = 0;
      }
      break;

    case 'disabled':
      blackoutPhaseTimer += dt;
      blackoutFactor = 1;
      if (blackoutPhaseTimer >= BLACKOUT_DISABLED_DUR) {
        blackoutPhase = 'recovery';
        blackoutPhaseTimer = 0;
      }
      break;

    case 'recovery':
      blackoutPhaseTimer += dt;
      blackoutFactor = clamp(1 - blackoutPhaseTimer / BLACKOUT_FADE_OUT, 0, 1);
      if (blackoutFactor <= 0) {
        blackoutPhase = 'none';
        blackoutPhaseTimer = 0;
        blackoutFactor = 0;
        highGTimer = 0;
      }
      break;
  }
}

// Mobile touch & tilt controls — mirrors gamepad.js pattern

import { aircraftState } from './aircraft.js';
import { playGearSound, playFlapSound } from './audio.js';
import { togglePause } from './menu.js';
import { toggleCamera } from './camera.js';

const TILT_DEADZONE = 8;   // degrees
const TILT_MAX = 35;       // degrees for full deflection
const SMOOTH_RATE = 8;     // how fast inputs smooth (higher = snappier)

const state = {
  active: false,
  pitchInput: 0,
  rollInput: 0,
  yawInput: 0,
  throttleInput: -1,  // -1 = not controlling
  brakeActive: false,
};

let overlay = null;
let calibrationBeta = 0;
let calibrationGamma = 0;
let tiltPermissionGranted = false;
let rawPitch = 0;
let rawRoll = 0;
let throttleValue = 0.0; // 0-1

// Button edge detection
const buttonState = {};
const prevButtonState = {};
const BUTTONS = ['gear', 'flaps', 'camera', 'pause', 'yawLeft', 'yawRight'];

// ── Detection ──

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// ── Tilt processing ──

function applyTiltDeadzone(value) {
  if (Math.abs(value) < TILT_DEADZONE) return 0;
  const sign = value > 0 ? 1 : -1;
  const magnitude = (Math.abs(value) - TILT_DEADZONE) / (TILT_MAX - TILT_DEADZONE);
  return sign * Math.min(magnitude, 1);
}

function onDeviceOrientation(e) {
  if (e.beta === null || e.gamma === null) return;
  rawPitch = (e.beta - calibrationBeta);   // front-back
  rawRoll = (e.gamma - calibrationGamma);  // left-right
}

function calibrateTilt() {
  calibrationBeta = rawPitch + calibrationBeta;
  calibrationGamma = rawRoll + calibrationGamma;
  rawPitch = 0;
  rawRoll = 0;
}

async function requestTiltPermission() {
  if (tiltPermissionGranted) return;

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      if (response === 'granted') {
        tiltPermissionGranted = true;
        window.addEventListener('deviceorientation', onDeviceOrientation);
        calibrateTilt();
        hideTiltPrompt();
      }
    } catch {
      // Permission denied
    }
  } else {
    // Android / non-iOS — just listen
    tiltPermissionGranted = true;
    window.addEventListener('deviceorientation', onDeviceOrientation);
    setTimeout(calibrateTilt, 500);
    hideTiltPrompt();
  }
}

// ── Touch overlay DOM ──

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function createOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'mobile-controls';

  // Throttle slider
  const thrTrack = el('div', 'mob-throttle-track');
  thrTrack.appendChild(el('div', 'mob-throttle-fill'));
  thrTrack.appendChild(el('div', 'mob-throttle-knob'));
  thrTrack.appendChild(el('div', 'mob-throttle-label', 'THR'));
  overlay.appendChild(thrTrack);

  // Buttons
  const btnDefs = [
    ['mob-btn mob-btn-brake', 'brake', 'BRK'],
    ['mob-btn mob-btn-yaw-left', 'yawLeft', '\u2190'],
    ['mob-btn mob-btn-yaw-right', 'yawRight', '\u2192'],
    ['mob-btn mob-btn-action mob-btn-cam', 'camera', 'CAM'],
    ['mob-btn mob-btn-action mob-btn-gear', 'gear', 'GEAR'],
    ['mob-btn mob-btn-action mob-btn-flaps', 'flaps', 'FLAP'],
    ['mob-btn mob-btn-pause', 'pause', '| |'],
  ];
  for (const [cls, btnName, label] of btnDefs) {
    const b = el('div', cls, label);
    b.dataset.btn = btnName;
    overlay.appendChild(b);
  }

  // Tilt prompt (iOS)
  const prompt = el('div', 'mob-tilt-prompt', 'TAP TO ENABLE TILT CONTROLS');
  overlay.appendChild(prompt);

  document.body.appendChild(overlay);

  setupThrottleSlider();
  setupButtons();
  setupTiltPrompt();
  setupDoubleTapCalibrate();
}

function setupThrottleSlider() {
  const track = overlay.querySelector('.mob-throttle-track');
  const knob = overlay.querySelector('.mob-throttle-knob');
  const fill = overlay.querySelector('.mob-throttle-fill');
  let dragging = false;
  let trackRect = null;

  function updateThrottleVisual() {
    const pct = throttleValue * 100;
    knob.style.bottom = pct + '%';
    fill.style.height = pct + '%';
  }

  function handleMove(clientY) {
    if (!trackRect) trackRect = track.getBoundingClientRect();
    const y = trackRect.bottom - clientY;
    const ratio = Math.max(0, Math.min(1, y / trackRect.height));
    throttleValue = ratio;
    state.throttleInput = ratio;
    updateThrottleVisual();
  }

  track.addEventListener('touchstart', (e) => {
    e.preventDefault();
    dragging = true;
    trackRect = track.getBoundingClientRect();
    handleMove(e.touches[0].clientY);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    for (let i = 0; i < e.touches.length; i++) {
      handleMove(e.touches[i].clientY);
    }
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (!dragging) return;
    let stillTouching = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (trackRect) {
        const t = e.touches[i];
        if (t.clientX >= trackRect.left - 20 && t.clientX <= trackRect.right + 20) {
          stillTouching = true;
        }
      }
    }
    if (!stillTouching) {
      dragging = false;
      trackRect = null;
    }
  });

  updateThrottleVisual();
}

function setupButtons() {
  const holdButtons = ['brake', 'yawLeft', 'yawRight'];

  overlay.querySelectorAll('.mob-btn').forEach((btn) => {
    const name = btn.dataset.btn;
    if (!name) return;

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      buttonState[name] = true;
      btn.classList.add('mob-btn-held');

      if (name === 'brake') state.brakeActive = true;
      if (name === 'yawLeft') state.yawInput = -1;
      if (name === 'yawRight') state.yawInput = 1;
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      buttonState[name] = false;
      btn.classList.remove('mob-btn-held');

      if (name === 'brake') state.brakeActive = false;
      if (name === 'yawLeft') state.yawInput = 0;
      if (name === 'yawRight') state.yawInput = 0;
    }, { passive: false });

    btn.addEventListener('touchcancel', () => {
      buttonState[name] = false;
      btn.classList.remove('mob-btn-held');
      if (name === 'brake') state.brakeActive = false;
      if (name === 'yawLeft' || name === 'yawRight') state.yawInput = 0;
    });
  });
}

function setupTiltPrompt() {
  const prompt = overlay.querySelector('.mob-tilt-prompt');
  if (!prompt) return;

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    prompt.style.display = 'block';
    prompt.addEventListener('touchstart', (e) => {
      e.preventDefault();
      requestTiltPermission();
    }, { passive: false });
  } else {
    prompt.style.display = 'none';
    requestTiltPermission();
  }
}

function hideTiltPrompt() {
  if (!overlay) return;
  const prompt = overlay.querySelector('.mob-tilt-prompt');
  if (prompt) prompt.style.display = 'none';
}

function setupDoubleTapCalibrate() {
  let lastTap = 0;
  overlay.addEventListener('touchstart', (e) => {
    if (e.target !== overlay) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      calibrateTilt();
      showCalibrationFeedback();
    }
    lastTap = now;
  });
}

function showCalibrationFeedback() {
  const fb = el('div', 'mob-calibration-msg', 'TILT CALIBRATED');
  overlay.appendChild(fb);
  setTimeout(() => fb.remove(), 1200);
}

// ── Toggle state visual update ──

function updateToggleVisuals() {
  if (!overlay) return;
  const gearBtn = overlay.querySelector('.mob-btn-gear');
  const flapBtn = overlay.querySelector('.mob-btn-flaps');
  if (gearBtn) gearBtn.classList.toggle('mob-btn-on', aircraftState.gear);
  if (flapBtn) flapBtn.classList.toggle('mob-btn-on', aircraftState.flaps);
}

// ── Exports ──

export function initMobile() {
  if (!isTouchDevice()) return;
  state.active = true;
  createOverlay();
}

export function updateMobile(dt) {
  if (!state.active) return;

  // Smooth tilt to state
  const targetPitch = applyTiltDeadzone(rawPitch);
  const targetRoll = applyTiltDeadzone(rawRoll);
  const s = Math.min(1, SMOOTH_RATE * dt);
  state.pitchInput += (targetPitch - state.pitchInput) * s;
  state.rollInput += (targetRoll - state.rollInput) * s;

  // Edge-detect toggle buttons
  for (const name of BUTTONS) {
    const cur = !!buttonState[name];
    const prev = !!prevButtonState[name];

    if (cur && !prev) {
      if (name === 'gear') {
        aircraftState.gear = !aircraftState.gear;
        playGearSound();
      }
      if (name === 'flaps') {
        aircraftState.flaps = !aircraftState.flaps;
        playFlapSound();
      }
      if (name === 'camera') {
        toggleCamera();
      }
      if (name === 'pause') {
        togglePause();
      }
    }
    prevButtonState[name] = cur;
  }

  updateToggleVisuals();
}

export function getMobileState() {
  return state;
}

export function isMobileActive() {
  return state.active;
}

export function getMobileButtonJustPressed(name) {
  return !!buttonState[name] && !prevButtonState[name];
}

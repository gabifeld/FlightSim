// Mobile touch controls — virtual joystick + buttons (no tilt)

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { playGearSound, playFlapSound } from './audio.js';
import { togglePause, isMenuOpen } from './menu.js';
import { toggleCamera } from './camera.js';
import { toggleILS } from './hud.js';
import { toggleLandingAssist, isLandingAssistActive } from './landing.js';

const JOYSTICK_RADIUS = 50; // max drag distance in px
const SMOOTH_RATE = 12;

const state = {
  active: false,
  pitchInput: 0,
  rollInput: 0,
  yawInput: 0,
  throttleInput: -1,
  brakeActive: false,
};

let overlay = null;
let throttleValue = 0.0;

// Joystick state
let joyBase = null;
let joyKnob = null;
let joyTouchId = null;
let joyOriginX = 0;
let joyOriginY = 0;
let joyRawX = 0;
let joyRawY = 0;

// Button edge detection
const buttonState = {};
const prevButtonState = {};
const BUTTONS = ['gear', 'flaps', 'camera', 'pause', 'yawLeft', 'yawRight', 'ils', 'assist'];

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// ── DOM helper ──

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// ── Overlay ──

function createOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'mobile-controls';

  // Throttle slider (left)
  const thrTrack = el('div', 'mob-throttle-track');
  thrTrack.appendChild(el('div', 'mob-throttle-fill'));
  thrTrack.appendChild(el('div', 'mob-throttle-knob'));
  overlay.appendChild(thrTrack);

  // Virtual joystick zone (right side)
  joyBase = el('div', 'mob-joy-base');
  joyKnob = el('div', 'mob-joy-knob');
  joyBase.appendChild(joyKnob);
  overlay.appendChild(joyBase);

  // Buttons
  const btnDefs = [
    ['mob-btn mob-btn-brake', 'brake', 'BRK'],
    ['mob-btn mob-btn-yaw-left', 'yawLeft', '\u25C0'],
    ['mob-btn mob-btn-yaw-right', 'yawRight', '\u25B6'],
    ['mob-btn mob-btn-action mob-btn-gear', 'gear', 'GR'],
    ['mob-btn mob-btn-action mob-btn-flaps', 'flaps', 'FL'],
    ['mob-btn mob-btn-action mob-btn-cam', 'camera', 'CAM'],
    ['mob-btn mob-btn-action mob-btn-ils', 'ils', 'ILS'],
    ['mob-btn mob-btn-action mob-btn-assist', 'assist', 'LND'],
    ['mob-btn mob-btn-pause', 'pause', '\u275A\u275A'],
  ];
  for (const [cls, btnName, label] of btnDefs) {
    const b = el('div', cls, label);
    b.dataset.btn = btnName;
    overlay.appendChild(b);
  }

  document.body.appendChild(overlay);

  setupThrottleSlider();
  setupJoystick();
  setupButtons();
}

// ── Throttle slider ──

function setupThrottleSlider() {
  const track = overlay.querySelector('.mob-throttle-track');
  const knob = overlay.querySelector('.mob-throttle-knob');
  const fill = overlay.querySelector('.mob-throttle-fill');
  let dragging = false;
  let trackRect = null;

  function updateVisual() {
    const pct = throttleValue * 100;
    knob.style.bottom = pct + '%';
    fill.style.height = pct + '%';
  }

  function handleMove(clientY) {
    if (!trackRect) trackRect = track.getBoundingClientRect();
    const y = trackRect.bottom - clientY;
    throttleValue = Math.max(0, Math.min(1, y / trackRect.height));
    state.throttleInput = throttleValue;
    updateVisual();
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
    let still = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (trackRect) {
        const t = e.touches[i];
        if (t.clientX >= trackRect.left - 20 && t.clientX <= trackRect.right + 20) {
          still = true;
        }
      }
    }
    if (!still) { dragging = false; trackRect = null; }
  });

  updateVisual();
}

// ── Virtual joystick ──

function setupJoystick() {
  const zone = joyBase;

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joyTouchId !== null) return;
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    const rect = zone.getBoundingClientRect();
    joyOriginX = rect.left + rect.width / 2;
    joyOriginY = rect.top + rect.height / 2;
    updateJoystickFromTouch(t);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (joyTouchId === null) return;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === joyTouchId) {
        updateJoystickFromTouch(e.touches[i]);
        return;
      }
    }
  }, { passive: true });

  const endJoy = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchId) {
        joyTouchId = null;
        joyRawX = 0;
        joyRawY = 0;
        joyKnob.style.transform = 'translate(-50%, -50%)';
        return;
      }
    }
  };
  window.addEventListener('touchend', endJoy);
  window.addEventListener('touchcancel', endJoy);
}

function updateJoystickFromTouch(touch) {
  let dx = touch.clientX - joyOriginX;
  let dy = touch.clientY - joyOriginY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > JOYSTICK_RADIUS) {
    dx = dx / dist * JOYSTICK_RADIUS;
    dy = dy / dist * JOYSTICK_RADIUS;
  }
  joyRawX = dx / JOYSTICK_RADIUS;  // -1 to 1 (roll)
  joyRawY = dy / JOYSTICK_RADIUS;  // -1 to 1 (pitch: down = pull up)

  joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

// ── Buttons ──

function setupButtons() {
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

// ── Toggle visuals ──

function updateToggleVisuals() {
  if (!overlay) return;
  const gearBtn = overlay.querySelector('.mob-btn-gear');
  const flapBtn = overlay.querySelector('.mob-btn-flaps');
  const assistBtn = overlay.querySelector('.mob-btn-assist');
  if (gearBtn) gearBtn.classList.toggle('mob-btn-on', getActiveVehicle().gear);
  if (flapBtn) flapBtn.classList.toggle('mob-btn-on', getActiveVehicle().flaps);
  if (assistBtn) assistBtn.classList.toggle('mob-btn-on', isLandingAssistActive());
}

// ── Exports ──

export function initMobile() {
  if (!isTouchDevice()) return;
  state.active = true;
  createOverlay();
}

export function updateMobile(dt) {
  if (!state.active) return;

  if (overlay) {
    overlay.classList.toggle('mob-hidden', isMenuOpen());
  }

  // Smooth joystick → state
  const s = Math.min(1, SMOOTH_RATE * dt);
  state.pitchInput += (joyRawY - state.pitchInput) * s;
  state.rollInput += (joyRawX - state.rollInput) * s;

  // Edge-detect toggle buttons
  for (const name of BUTTONS) {
    const cur = !!buttonState[name];
    const prev = !!prevButtonState[name];
    if (cur && !prev) {
      if (name === 'gear') { getActiveVehicle().gear = !getActiveVehicle().gear; playGearSound(); }
      if (name === 'flaps') { getActiveVehicle().flaps = !getActiveVehicle().flaps; playFlapSound(); }
      if (name === 'camera') toggleCamera();
      if (name === 'ils') toggleILS();
      if (name === 'assist') toggleLandingAssist();
      if (name === 'pause') togglePause();
    }
    prevButtonState[name] = cur;
  }

  updateToggleVisuals();
}

export function getMobileState() { return state; }
export function isMobileActive() { return state.active; }
export function getMobileButtonJustPressed(name) {
  return !!buttonState[name] && !prevButtonState[name];
}

// Gamepad API analog input handling

const DEAD_ZONE = 0.1;
const state = {
  connected: false,
  pitchInput: 0,
  rollInput: 0,
  yawInput: 0,
  throttleInput: -1, // -1 = not controlling (triggers start at 0)
  buttons: {},
};

let prevButtons = {};
let gamepadIndex = -1;

function applyDeadzone(value) {
  if (Math.abs(value) < DEAD_ZONE) return 0;
  const sign = value > 0 ? 1 : -1;
  return sign * (Math.abs(value) - DEAD_ZONE) / (1 - DEAD_ZONE);
}

export function initGamepad() {
  window.addEventListener('gamepadconnected', (e) => {
    gamepadIndex = e.gamepad.index;
    state.connected = true;
  });

  window.addEventListener('gamepaddisconnected', () => {
    gamepadIndex = -1;
    state.connected = false;
    state.pitchInput = 0;
    state.rollInput = 0;
    state.yawInput = 0;
    state.throttleInput = -1;
  });
}

export function updateGamepad() {
  if (gamepadIndex < 0) return state;

  const gamepads = navigator.getGamepads();
  const gp = gamepads[gamepadIndex];
  if (!gp) return state;

  // Xbox layout:
  // Left stick: axes[0] = X (roll), axes[1] = Y (pitch, inverted)
  // Right stick: axes[2] = X (yaw), axes[3] = Y (unused or camera)
  // Triggers: buttons[6] = LT (brake/reverse), buttons[7] = RT (throttle)

  // Left stick -> pitch/roll
  state.rollInput = applyDeadzone(gp.axes[0] || 0);
  state.pitchInput = applyDeadzone(gp.axes[1] || 0); // Push forward = nose down

  // Right stick -> yaw
  state.yawInput = applyDeadzone(gp.axes[2] || 0);

  // Triggers -> throttle (RT = increase, LT = decrease)
  const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
  const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
  if (rt > 0.05 || lt > 0.05) {
    state.throttleInput = rt - lt; // -1 to 1
  } else {
    state.throttleInput = -1; // not controlling
  }

  // Button edge detection for toggles
  const currentButtons = {};
  for (let i = 0; i < gp.buttons.length; i++) {
    currentButtons[i] = gp.buttons[i].pressed;
  }

  state.buttons = {};
  for (const [idx, pressed] of Object.entries(currentButtons)) {
    if (pressed && !prevButtons[idx]) {
      state.buttons[idx] = true; // just pressed
    }
  }
  prevButtons = currentButtons;

  return state;
}

export function getGamepadState() {
  return state;
}

// Button mappings (Xbox):
// 0 = A (gear)
// 1 = B (flaps)
// 2 = X (speedbrake)
// 3 = Y (camera toggle)
// 4 = LB (prev view)
// 5 = RB (next view)
export function getButtonJustPressed(buttonIndex) {
  return state.buttons[buttonIndex] || false;
}

export function isGamepadConnected() {
  return state.connected;
}

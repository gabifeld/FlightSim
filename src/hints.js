// Contextual hints system — shows one-time hints per flight
import { isAircraft } from './vehicleState.js';
import { RUNWAY_LENGTH, AIRPORT2_X, AIRPORT2_Z } from './constants.js';
import { getSetting } from './settings.js';

const HINTS = {
  firstFlight: {
    text: 'W/S: THROTTLE  |  ARROWS: PITCH/ROLL  |  G: GEAR  |  F: FLAPS',
    check: (vehicle, state, elapsed) => elapsed < 10 && isAircraft(vehicle),
  },
  approaching: {
    text: 'GEAR: G  |  FLAPS: F  |  BRAKE: SPACE',
    check: (vehicle) => {
      if (!isAircraft(vehicle) || vehicle.onGround) return false;
      const alt = vehicle.position.y;
      if (alt > 300 || alt < 5) return false;
      // Near airport 1 or airport 2
      const x = vehicle.position.x;
      const z = vehicle.position.z;
      const nearApt1 = Math.abs(x) < 500 && Math.abs(z) < RUNWAY_LENGTH;
      const nearApt2 = Math.abs(x - AIRPORT2_X) < 500 && Math.abs(z - AIRPORT2_Z) < RUNWAY_LENGTH;
      return nearApt1 || nearApt2;
    },
  },
  stalling: {
    text: 'PUSH NOSE DOWN — INCREASE SPEED',
    check: (vehicle) => {
      if (!isAircraft(vehicle) || vehicle.onGround) return false;
      const stallAoa = (vehicle.config && vehicle.config.stallAoa) || 0.38;
      return Math.abs(vehicle.aoa) > stallAoa * 0.8 && vehicle.speed > 5;
    },
  },
  lowFuel: {
    text: 'LOW FUEL — LAND SOON',
    check: (vehicle) => {
      if (!isAircraft(vehicle)) return false;
      return vehicle.fuel !== undefined && vehicle.fuel < 0.15 && !getSetting('unlimitedFuel');
    },
  },
};

let shown = new Set();
let hintTimer = 0;
let elapsedTime = 0;
let overlayEl = null;

export function initHints() {
  overlayEl = document.getElementById('hint-overlay');
  resetHints();
}

export function resetHints() {
  shown = new Set();
  hintTimer = 0;
  elapsedTime = 0;
  if (overlayEl) {
    overlayEl.classList.remove('hint-visible');
    overlayEl.textContent = '';
  }
}

export function updateHints(vehicle, gameState, dt) {
  if (!overlayEl) return;

  elapsedTime += dt;

  // Count down active hint
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) {
      overlayEl.classList.remove('hint-visible');
    }
    return;
  }

  // Check for new hints to show
  for (const [key, hint] of Object.entries(HINTS)) {
    if (shown.has(key)) continue;
    if (hint.check(vehicle, gameState, elapsedTime)) {
      shown.add(key);
      overlayEl.textContent = hint.text;
      overlayEl.classList.add('hint-visible');
      hintTimer = 4;
      break;
    }
  }
}

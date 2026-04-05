// Failure system: engine, electrical, instrument, and hydraulic failures
// Three modes: off, realistic (probability-based), training (manual trigger)

import { setEngineFailed, getEngineState, isAnyEngineRunning, getEngineCount } from './systemsEngine.js';
import { setFuelLeak } from './fuelSystem.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';

// ── Failure Catalog ───────────────────────────────────────────────────
const FAILURE_TYPES = {
  engine_1:    { name: 'Engine 1 Failure',       category: 'engine' },
  engine_2:    { name: 'Engine 2 Failure',       category: 'engine' },
  engine_3:    { name: 'Engine 3 Failure',       category: 'engine' },
  engine_4:    { name: 'Engine 4 Failure',       category: 'engine' },
  alternator:  { name: 'Alternator Failure',     category: 'electrical' },
  pitot:       { name: 'Pitot Tube Blockage',    category: 'instruments' },
  nav1:        { name: 'NAV1 Receiver Failure',  category: 'avionics' },
  fuel_leak:   { name: 'Fuel Leak',              category: 'fuel' },
  hydraulic:   { name: 'Hydraulic Pump Failure', category: 'hydraulic' },
  flap_jam:    { name: 'Flap Actuator Jam',      category: 'hydraulic' },
};

// Probability per flight-hour in realistic mode
const PROBABILITIES = {
  engine_1:   0.001,
  engine_2:   0.001,
  engine_3:   0.001,
  engine_4:   0.001,
  alternator: 0.0005,
  pitot:      0.0005,
  nav1:       0.0005,
  fuel_leak:  0.0005,
  hydraulic:  0.0005,
  flap_jam:   0.0005,
};

// ── State ─────────────────────────────────────────────────────────────
const state = {
  mode: 'off',               // 'off' | 'realistic' | 'training'
  activeFailures: new Set(),
  pitotFrozenSpeed: null,    // saved airspeed when pitot fails
  alternatorFailed: false,
};

// ── Init ──────────────────────────────────────────────────────────────
export function initFailures() {
  state.mode = 'off';
  state.activeFailures.clear();
  state.pitotFrozenSpeed = null;
  state.alternatorFailed = false;
}

// ── Mode control ──────────────────────────────────────────────────────
export function setFailureMode(mode) {
  if (mode === 'off' || mode === 'realistic' || mode === 'training') {
    state.mode = mode;
    if (mode === 'off') clearAllFailures();
  }
}

export function getFailureMode() {
  return state.mode;
}

// ── Update (called each frame) ────────────────────────────────────────
export function updateFailures(dt) {
  if (state.mode === 'off') return;
  if (!isAircraft(getActiveVehicle())) return;

  // In realistic mode, check probabilities
  if (state.mode === 'realistic') {
    // Convert per-flight-hour probability to per-tick probability
    // dt is in seconds, there are 3600 seconds per hour
    const dtHours = dt / 3600;

    for (const type of Object.keys(FAILURE_TYPES)) {
      if (state.activeFailures.has(type)) continue;

      // Skip engine failures for engines that don't exist
      if (type.startsWith('engine_')) {
        const idx = parseInt(type.split('_')[1]) - 1;
        if (idx >= getEngineCount()) continue;
      }

      const prob = PROBABILITIES[type] || 0.0005;
      if (Math.random() < prob * dtHours) {
        activateFailure(type);
      }
    }
  }

  // Update pitot erratic behavior
  if (state.activeFailures.has('pitot')) {
    updatePitotErratic(dt);
  }
}

// ── Trigger / Clear ───────────────────────────────────────────────────
export function triggerFailure(type) {
  if (!FAILURE_TYPES[type]) return;
  if (state.activeFailures.has(type)) return;
  activateFailure(type);
}

export function clearFailure(type) {
  if (!state.activeFailures.has(type)) return;
  deactivateFailure(type);
}

export function clearAllFailures() {
  const types = [...state.activeFailures];
  for (const type of types) {
    deactivateFailure(type);
  }
}

// ── Internal: Activate / Deactivate ───────────────────────────────────
function activateFailure(type) {
  state.activeFailures.add(type);

  // Apply cascading effects
  if (type.startsWith('engine_')) {
    const idx = parseInt(type.split('_')[1]) - 1;
    setEngineFailed(idx, true);

    // If all engines fail, alternator dies too
    let allDown = true;
    const count = getEngineCount();
    for (let i = 0; i < count; i++) {
      const eng = getEngineState(i);
      if (eng && !eng.failed) { allDown = false; break; }
    }
    if (allDown && !state.activeFailures.has('alternator')) {
      activateFailure('alternator');
    }
  }

  if (type === 'alternator') {
    state.alternatorFailed = true;
  }

  if (type === 'pitot') {
    // Freeze current airspeed
    const v = getActiveVehicle();
    if (v) {
      const MS_TO_KNOTS = 1.94384;
      state.pitotFrozenSpeed = (v.speed || 0) * MS_TO_KNOTS;
    }
  }

  if (type === 'fuel_leak') {
    setFuelLeak(0, true);
  }

  console.warn(`[FAILURE] ${FAILURE_TYPES[type].name} activated`);
}

function deactivateFailure(type) {
  state.activeFailures.delete(type);

  if (type.startsWith('engine_')) {
    const idx = parseInt(type.split('_')[1]) - 1;
    setEngineFailed(idx, false);
  }

  if (type === 'alternator') {
    state.alternatorFailed = false;
  }

  if (type === 'pitot') {
    state.pitotFrozenSpeed = null;
  }

  if (type === 'fuel_leak') {
    setFuelLeak(0, false);
  }
}

// ── Pitot erratic simulation ──────────────────────────────────────────
let pitotJitter = 0;
let pitotJitterTimer = 0;

function updatePitotErratic(dt) {
  pitotJitterTimer += dt;
  if (pitotJitterTimer > 0.5) {
    pitotJitterTimer = 0;
    // Add random jitter to frozen speed
    pitotJitter = (Math.random() - 0.5) * 15;
  }
}

// ── Query exports ─────────────────────────────────────────────────────
export function isFailureActive(type) {
  return state.activeFailures.has(type);
}

export function getActiveFailures() {
  return [...state.activeFailures];
}

export function isPitotBlocked() {
  return state.activeFailures.has('pitot');
}

export function getPitotAirspeed() {
  if (!state.activeFailures.has('pitot')) return null;
  if (state.pitotFrozenSpeed === null) return null;
  return state.pitotFrozenSpeed + pitotJitter;
}

export function isNav1Failed() {
  return state.activeFailures.has('nav1');
}

export function isHydraulicFailed() {
  return state.activeFailures.has('hydraulic');
}

export function isFlapsJammed() {
  return state.activeFailures.has('flap_jam');
}

export function isAlternatorFailed() {
  return state.alternatorFailed;
}

export function getFailureTypes() {
  return FAILURE_TYPES;
}

// Per-engine simulation with startup sequence and spool dynamics
// Each engine has N1/N2/EGT/oil parameters and a realistic startup sequence

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { isBatteryOn } from './electrical.js';
import { clamp } from './utils.js';

// Engine type configs
const ENGINE_CONFIGS = {
  prop: {
    spoolRate: 50,        // fast, ~2s
    idleN1: 22,
    idleEGT: 500,
    maxEGT: 700,
    oilPressureTarget: 55,
    oilTempTarget: 85,
  },
  jet: {
    spoolRate: 20,        // medium, 4-5s
    idleN1: 25,
    idleEGT: 350,
    maxEGT: 900,
    oilPressureTarget: 60,
    oilTempTarget: 90,
  },
  fighter: {
    spoolRate: 25,        // military, 3-4s
    idleN1: 28,
    idleEGT: 380,
    maxEGT: 950,
    oilPressureTarget: 65,
    oilTempTarget: 95,
  },
};

function getEngineConfig() {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.config) return ENGINE_CONFIGS.prop;
  const type = vehicle.config.type || 'prop';
  return ENGINE_CONFIGS[type] || ENGINE_CONFIGS.prop;
}

function getMaxThrustPerEngine() {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.config) return 16000;
  const count = vehicle.config.engineCount || 1;
  return (vehicle.config.maxThrust || 16000) / count;
}

function getConfiguredEngineCount() {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.config) return 1;
  return vehicle.config.engineCount || 1;
}

function getFuelBurnRatePerEngine() {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.config) return 40;
  const count = vehicle.config.engineCount || 1;
  return (vehicle.config.fuelBurnRate || 40) / count;
}

// --- Engine state ---

function createEngineState() {
  return {
    running: false,
    n1: 0,
    n2: 0,
    egt: 0,
    oilPressure: 0,
    oilTemp: 20,       // ambient
    fuelFlow: 0,        // L/hr this engine
    starterEngaged: false,
    ignition: false,
    startTimer: 0,
    failed: false,
  };
}

let engines = [];
let engineCount = 1;
let engineStatesDirty = true;
let cachedEngineStates = [];

// --- Init ---

export function initSystems() {
  engineCount = getConfiguredEngineCount();
  engines = [];
  for (let i = 0; i < engineCount; i++) {
    engines.push(createEngineState());
  }

  engineStatesDirty = true;

  // Auto-start all engines after a brief delay so electrical is ready
  setTimeout(() => {
    startAllEngines();
  }, 100);
}

// --- Update ---

export function updateSystems(dt) {
  const vehicle = getActiveVehicle();
  if (!vehicle || !isAircraft(vehicle)) return;

  const ecfg = getEngineConfig();
  const maxThrustPerEngine = getMaxThrustPerEngine();
  const burnRatePerEngine = getFuelBurnRatePerEngine();

  // Ensure engine array matches expected count (aircraft change)
  const expectedCount = getConfiguredEngineCount();
  if (engines.length !== expectedCount) {
    engineCount = expectedCount;
    engines = [];
    for (let i = 0; i < engineCount; i++) {
      engines.push(createEngineState());
    }
    startAllEngines();
    return;
  }

  const throttle = vehicle.throttle || 0;

  for (let i = 0; i < engines.length; i++) {
    const eng = engines[i];

    if (eng.failed) {
      // Failed engine winds down
      eng.n1 = Math.max(0, eng.n1 - 15 * dt);
      eng.n2 = Math.max(0, eng.n2 - 12 * dt);
      eng.egt = Math.max(20, eng.egt - 50 * dt);
      eng.oilPressure = Math.max(0, eng.oilPressure - 10 * dt);
      eng.fuelFlow = 0;
      eng.running = false;
      eng.starterEngaged = false;
      eng.ignition = false;
      continue;
    }

    // --- Startup sequence ---
    if (eng.starterEngaged && !eng.running) {
      eng.startTimer += dt;

      // Phase 1: N2 spools from 0 to ~25% over 3s
      if (eng.n2 < 25) {
        eng.n2 += (25 / 3) * dt;
        eng.n2 = Math.min(eng.n2, 25);
      }

      // Phase 2: At N2 >= 20%, ignition fires
      if (eng.n2 >= 20 && !eng.ignition) {
        eng.ignition = true;
      }

      // Phase 3: With ignition, EGT rises, fuel flow starts, N2 continues to idle
      if (eng.ignition) {
        eng.egt += (ecfg.idleEGT - eng.egt) * 2 * dt;
        eng.fuelFlow = burnRatePerEngine * 0.3; // starter fuel flow

        // N2 continues to idle N1 threshold
        const idleTarget = ecfg.idleN1;
        eng.n2 += (idleTarget - eng.n2) * 1.0 * dt;

        // N1 starts rising once ignition is active
        eng.n1 += (idleTarget - eng.n1) * 0.8 * dt;
      }

      // Engine considered running when N1 exceeds idle threshold
      if (eng.n1 >= ecfg.idleN1 * 0.9) {
        eng.running = true;
        eng.starterEngaged = false;
        eng.ignition = false;
        eng.startTimer = 0;
      }

      // Timeout: if startup takes > 10s, something is wrong
      if (eng.startTimer > 10) {
        eng.starterEngaged = false;
        eng.ignition = false;
        eng.startTimer = 0;
        eng.n1 = 0;
        eng.n2 = 0;
        eng.egt = 0;
        eng.fuelFlow = 0;
      }

      continue;
    }

    // --- Running engine ---
    if (eng.running) {
      // Target N1 from throttle
      const targetN1 = clamp(throttle * 100, ecfg.idleN1, 100);
      eng.n1 += (targetN1 - eng.n1) * (ecfg.spoolRate / 100) * dt;
      eng.n1 = clamp(eng.n1, 0, 100);

      // N2 tracks slightly above N1
      const targetN2 = clamp(eng.n1 * 1.05, ecfg.idleN1, 105);
      eng.n2 += (targetN2 - eng.n2) * (ecfg.spoolRate / 100) * dt;
      eng.n2 = clamp(eng.n2, 0, 105);

      // EGT model
      const egtTarget = ecfg.idleEGT + (ecfg.maxEGT - ecfg.idleEGT) * (eng.n1 / 100);
      eng.egt += (egtTarget - eng.egt) * 2 * dt;

      // Fuel flow proportional to N1
      const n1Fraction = eng.n1 / 100;
      eng.fuelFlow = burnRatePerEngine * n1Fraction;

      // Oil pressure: ramps to target when running
      const opTarget = ecfg.oilPressureTarget;
      eng.oilPressure += (opTarget - eng.oilPressure) * 1.5 * dt;
      eng.oilPressure = clamp(eng.oilPressure, 0, 75);

      // Oil temp: slowly rises to target
      eng.oilTemp += (ecfg.oilTempTarget - eng.oilTemp) * 0.05 * dt;
      eng.oilTemp = clamp(eng.oilTemp, 20, 120);
    } else {
      // Engine off — cool down
      eng.n1 = Math.max(0, eng.n1 - 5 * dt);
      eng.n2 = Math.max(0, eng.n2 - 4 * dt);
      eng.egt = Math.max(20, eng.egt - 30 * dt);
      eng.oilPressure = Math.max(0, eng.oilPressure - 5 * dt);
      eng.oilTemp += (20 - eng.oilTemp) * 0.02 * dt;
      eng.fuelFlow = 0;
    }
  }

  engineStatesDirty = true;
}

// --- Queries ---

export function getEngineState(index) {
  if (index < 0 || index >= engines.length) return null;
  return { ...engines[index] };
}

export function getEngineCount() {
  return engines.length;
}

export function getAllEngineStates() {
  if (!engineStatesDirty) return cachedEngineStates;
  cachedEngineStates = engines.map(e => ({ ...e }));
  engineStatesDirty = false;
  return cachedEngineStates;
}

export function getTotalThrust() {
  const maxThrustPerEngine = getMaxThrustPerEngine();
  let total = 0;
  for (const eng of engines) {
    if (eng.running && !eng.failed) {
      const n1Frac = eng.n1 / 100;
      total += n1Frac * n1Frac * maxThrustPerEngine;
    }
  }
  return total;
}

export function getTotalFuelFlow() {
  let total = 0;
  for (const eng of engines) {
    total += eng.fuelFlow;
  }
  return total; // L/hr
}

export function isAnyEngineRunning() {
  return engines.some(e => e.running && !e.failed);
}

export function areAllEnginesRunning() {
  return engines.length > 0 && engines.every(e => e.running && !e.failed);
}

// --- Commands ---

export function startEngine(index) {
  if (index < 0 || index >= engines.length) return;
  const eng = engines[index];
  if (eng.running || eng.starterEngaged || eng.failed) return;

  // Battery must be on
  if (!isBatteryOn()) return;

  eng.starterEngaged = true;
  eng.startTimer = 0;
  eng.ignition = false;
  engineStatesDirty = true;
}

export function startAllEngines() {
  for (let i = 0; i < engines.length; i++) {
    startEngine(i);
  }
}

export function shutdownEngine(index) {
  if (index < 0 || index >= engines.length) return;
  const eng = engines[index];
  eng.running = false;
  eng.starterEngaged = false;
  eng.ignition = false;
  eng.startTimer = 0;
  engineStatesDirty = true;
}

export function shutdownAllEngines() {
  for (let i = 0; i < engines.length; i++) {
    shutdownEngine(i);
  }
}

export function setEngineFailed(index, failed) {
  if (index < 0 || index >= engines.length) return;
  engines[index].failed = failed;
  if (failed) {
    engines[index].running = false;
    engines[index].starterEngaged = false;
    engines[index].ignition = false;
  }
  engineStatesDirty = true;
}

export function isEngineStarting(index) {
  if (index < 0 || index >= engines.length) return false;
  return engines[index].starterEngaged;
}

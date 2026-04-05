// Electrical system: battery, alternator, bus voltage
// Manages power distribution for avionics and instruments

import { clamp } from './utils.js';

// Late-bound import to avoid circular dependency with systemsEngine
let _isAnyEngineRunning = null;
function isAnyEngineRunningLazy() {
  if (!_isAnyEngineRunning) {
    import('./systemsEngine.js').then(m => { _isAnyEngineRunning = m.isAnyEngineRunning; });
    return false;
  }
  return _isAnyEngineRunning();
}

// Late-bound import for autopilot disconnect
let _disconnectAP = null;
function disconnectAPLazy(reason) {
  if (!_disconnectAP) {
    import('./autopilot.js').then(m => { _disconnectAP = m.disconnectAP; });
    return;
  }
  _disconnectAP(reason);
}

// Electrical state
const state = {
  batteryOn: false,
  alternatorOn: false,
  batteryCharge: 1.0, // 0-1, full = ~30 min without alternator
  busVoltage: 0,      // 0 or ~28V
  avionicsBus: false,  // powered by battery/alternator
  essentialBus: false,  // basic instruments
};

// Drain/charge rates
const BATTERY_DRAIN_RATE = 1 / (30 * 60);  // ~30 min to drain
const BATTERY_CHARGE_RATE = 1 / (20 * 60); // ~20 min to charge

// Track previous avionics state for cascade detection
let prevAvionicsPowered = false;

export function initElectrical() {
  state.batteryOn = true;
  state.alternatorOn = true;
  state.batteryCharge = 1.0;
  state.busVoltage = 28;
  state.avionicsBus = true;
  state.essentialBus = true;
  prevAvionicsPowered = true;

  // Eagerly resolve lazy imports
  import('./systemsEngine.js').then(m => { _isAnyEngineRunning = m.isAnyEngineRunning; });
  import('./autopilot.js').then(m => { _disconnectAP = m.disconnectAP; });
}

export function updateElectrical(dt) {
  const engineRunning = isAnyEngineRunningLazy();
  const alternatorProviding = state.alternatorOn && engineRunning;

  // Battery drain / charge
  if (state.batteryOn && state.batteryCharge > 0) {
    if (alternatorProviding) {
      // Alternator charges the battery
      state.batteryCharge = clamp(state.batteryCharge + BATTERY_CHARGE_RATE * dt, 0, 1);
    } else {
      // Battery drains when it is the sole power source
      state.batteryCharge = clamp(state.batteryCharge - BATTERY_DRAIN_RATE * dt, 0, 1);
    }
  }

  // Bus voltage computation
  const batteryPower = state.batteryOn && state.batteryCharge > 0;
  if (alternatorProviding) {
    state.busVoltage = 28;
  } else if (batteryPower) {
    // Voltage sags as charge drops
    state.busVoltage = 14 + 14 * state.batteryCharge;
  } else {
    state.busVoltage = 0;
  }

  // Bus states
  state.avionicsBus = state.busVoltage > 20;
  state.essentialBus = state.busVoltage > 10;

  // Power loss cascade: avionics lost → disconnect AP
  if (prevAvionicsPowered && !state.avionicsBus) {
    disconnectAPLazy('ELEC FAIL');
  }
  prevAvionicsPowered = state.avionicsBus;
}

// --- Exports ---

export function isBatteryOn() {
  return state.batteryOn;
}

export function isAlternatorOn() {
  return state.alternatorOn;
}

export function toggleBattery() {
  state.batteryOn = !state.batteryOn;
}

export function toggleAlternator() {
  state.alternatorOn = !state.alternatorOn;
}

export function getBatteryCharge() {
  return state.batteryCharge;
}

export function getBusVoltage() {
  return state.busVoltage;
}

export function isAvionicsPowered() {
  return state.avionicsBus;
}

export function isInstrumentsPowered() {
  return state.essentialBus;
}

export function getElectricalState() {
  return { ...state };
}

export function setBatteryCharge(charge) {
  state.batteryCharge = clamp(charge, 0, 1);
}

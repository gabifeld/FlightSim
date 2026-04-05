// Multi-tank fuel system with per-aircraft tank configurations
// Manages fuel consumption, tank selection, and fuel pressure

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { getSetting } from './settings.js';
import { clamp } from './utils.js';

// Late-bound imports to avoid circular dependency with systemsEngine
let _getTotalFuelFlow = null;
let _setEngineFailed = null;

function resolveLazyImports() {
  if (!_getTotalFuelFlow) {
    import('./systemsEngine.js').then(m => {
      _getTotalFuelFlow = m.getTotalFuelFlow;
      _setEngineFailed = m.setEngineFailed;
    });
  }
}

// Tank configurations by aircraft type key
const TANK_CONFIGS = {
  cessna_172: [
    { name: 'left', capacity: 106 },
    { name: 'right', capacity: 106 },
  ],
  boeing_737: [
    { name: 'left', capacity: 8667 },
    { name: 'right', capacity: 8667 },
    { name: 'center', capacity: 8666 },
  ],
  f16: [
    { name: 'left', capacity: 1600 },
    { name: 'right', capacity: 1600 },
  ],
  airbus_a320: [
    { name: 'left', capacity: 6000 },
    { name: 'right', capacity: 6000 },
    { name: 'center', capacity: 12000 },
  ],
  dhc2_beaver: [
    { name: 'left', capacity: 170 },
    { name: 'right', capacity: 170 },
  ],
};

// Default tank config for unknown aircraft
const DEFAULT_TANKS = [
  { name: 'left', capacity: 250 },
  { name: 'right', capacity: 250 },
];

// Fuel system state
const state = {
  tanks: [],
  selectedTank: 'both',   // 'left' | 'right' | 'both' | 'center'
  crossfeedOpen: false,
  totalFuel: 1.0,          // normalized 0-1 for backward compat
  fuelPressure: true,
};

// Per-tank leak flags
let tankLeaks = [];

// Timer for fuel pressure loss → engine failure cascade
let pressureLossTimer = 0;
const PRESSURE_LOSS_DELAY = 5; // seconds before engine flame-out

function getTankConfig() {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.currentType) return DEFAULT_TANKS;
  return TANK_CONFIGS[vehicle.currentType] || DEFAULT_TANKS;
}

function getTotalCapacity() {
  let total = 0;
  for (const tank of state.tanks) {
    total += tank.capacity;
  }
  return total;
}

// --- Init ---

export function initFuelSystem() {
  resolveLazyImports();

  const config = getTankConfig();
  state.tanks = config.map(tc => ({
    name: tc.name,
    fuel: tc.capacity,  // start full
    capacity: tc.capacity,
  }));
  state.selectedTank = 'both';
  state.crossfeedOpen = false;
  state.fuelPressure = true;
  state.totalFuel = 1.0;
  tankLeaks = new Array(state.tanks.length).fill(false);
  pressureLossTimer = 0;

  // Sync backward compat
  const vehicle = getActiveVehicle();
  if (vehicle) {
    vehicle.fuel = 1.0;
  }
}

// --- Update ---

export function updateFuelSystem(dt) {
  const vehicle = getActiveVehicle();
  if (!vehicle || !isAircraft(vehicle)) return;

  resolveLazyImports();

  const unlimited = getSetting('unlimitedFuel');

  // Get total fuel flow from engine systems (L/hr)
  const totalFlowLph = _getTotalFuelFlow ? _getTotalFuelFlow() : 0;

  // Consume fuel
  if (!unlimited && totalFlowLph > 0) {
    consumeFuel(totalFlowLph, dt);
  }

  // Apply tank leaks (10x drain rate for leaking tanks)
  if (!unlimited) {
    for (let i = 0; i < state.tanks.length; i++) {
      if (tankLeaks[i] && state.tanks[i].fuel > 0) {
        const leakRate = 500; // 500 L/hr leak
        state.tanks[i].fuel = Math.max(0, state.tanks[i].fuel - (leakRate / 3600) * dt);
      }
    }
  }

  // Compute total fuel normalized
  const totalCapacity = getTotalCapacity();
  let totalFuelLiters = 0;
  for (const tank of state.tanks) {
    totalFuelLiters += tank.fuel;
  }
  state.totalFuel = totalCapacity > 0 ? totalFuelLiters / totalCapacity : 0;

  // Update backward compat
  vehicle.fuel = state.totalFuel;

  // Fuel pressure check
  const hasSelectedFuel = checkSelectedTanksFuel();
  if (!hasSelectedFuel && !unlimited) {
    pressureLossTimer += dt;
    if (pressureLossTimer >= PRESSURE_LOSS_DELAY) {
      state.fuelPressure = false;
      // Engine flame-out for engines fed by empty tanks
      if (_setEngineFailed) {
        const engineCount = state.tanks.length; // approximate
        for (let i = 0; i < engineCount; i++) {
          _setEngineFailed(i, true);
        }
      }
    }
  } else {
    pressureLossTimer = 0;
    state.fuelPressure = true;
  }
}

// Check if currently selected tanks have fuel
function checkSelectedTanksFuel() {
  const sel = state.selectedTank;
  if (sel === 'both') {
    return state.tanks.some(t => t.fuel > 0);
  }
  if (sel === 'center') {
    const center = state.tanks.find(t => t.name === 'center');
    return center ? center.fuel > 0 : false;
  }
  const tank = state.tanks.find(t => t.name === sel);
  return tank ? tank.fuel > 0 : false;
}

// --- Fuel consumption ---

export function consumeFuel(flowRateLph, dt) {
  if (getSetting('unlimitedFuel')) return;

  const consumeAmount = (flowRateLph / 3600) * dt; // liters this frame
  if (consumeAmount <= 0) return;

  const sel = state.selectedTank;

  if (sel === 'both') {
    // Drain center first (if present), then equally from left/right
    const center = state.tanks.find(t => t.name === 'center');
    if (center && center.fuel > 0) {
      const drained = Math.min(center.fuel, consumeAmount);
      center.fuel -= drained;
      const remainder = consumeAmount - drained;
      if (remainder > 0) {
        drainLeftRight(remainder);
      }
    } else {
      drainLeftRight(consumeAmount);
    }
  } else {
    // Single tank selected
    const tank = state.tanks.find(t => t.name === sel);
    if (tank && tank.fuel > 0) {
      tank.fuel = Math.max(0, tank.fuel - consumeAmount);
    }
    // If crossfeed is open and selected tank is empty, draw from others
    if (state.crossfeedOpen && tank && tank.fuel <= 0) {
      const others = state.tanks.filter(t => t.name !== sel && t.fuel > 0);
      if (others.length > 0) {
        const perTank = consumeAmount / others.length;
        for (const ot of others) {
          ot.fuel = Math.max(0, ot.fuel - perTank);
        }
      }
    }
  }
}

function drainLeftRight(amount) {
  const left = state.tanks.find(t => t.name === 'left');
  const right = state.tanks.find(t => t.name === 'right');
  if (!left && !right) return;

  const perSide = amount / 2;
  if (left && right) {
    if (left.fuel > 0 && right.fuel > 0) {
      left.fuel = Math.max(0, left.fuel - perSide);
      right.fuel = Math.max(0, right.fuel - perSide);
    } else if (left.fuel > 0) {
      left.fuel = Math.max(0, left.fuel - amount);
    } else if (right.fuel > 0) {
      right.fuel = Math.max(0, right.fuel - amount);
    }
  } else if (left) {
    left.fuel = Math.max(0, left.fuel - amount);
  } else if (right) {
    right.fuel = Math.max(0, right.fuel - amount);
  }
}

// --- Queries ---

export function getTotalFuel() {
  return state.totalFuel;
}

export function getTotalFuelLiters() {
  let total = 0;
  for (const tank of state.tanks) {
    total += tank.fuel;
  }
  return total;
}

export function getFuelState() {
  return {
    tanks: state.tanks.map(t => ({ ...t })),
    selectedTank: state.selectedTank,
    crossfeedOpen: state.crossfeedOpen,
    totalFuel: state.totalFuel,
    fuelPressure: state.fuelPressure,
  };
}

export function getTanks() {
  return state.tanks.map(t => ({ ...t }));
}

export function isFuelPressureOK() {
  return state.fuelPressure;
}

// --- Commands ---

export function selectTank(tankName) {
  const validNames = state.tanks.map(t => t.name);
  if (tankName === 'both' || validNames.includes(tankName)) {
    state.selectedTank = tankName;
  }
}

export function toggleCrossfeed() {
  state.crossfeedOpen = !state.crossfeedOpen;
}

export function setFuelLeak(tankIndex, leaking) {
  if (tankIndex >= 0 && tankIndex < tankLeaks.length) {
    tankLeaks[tankIndex] = leaking;
  }
}

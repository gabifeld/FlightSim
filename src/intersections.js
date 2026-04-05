// intersections.js — Traffic signal state machine logic

export const SIGNAL_TYPES = {
  TRAFFIC_SIGNAL_FULL: 'signal_full',     // arterial x arterial
  TRAFFIC_SIGNAL_SIMPLE: 'signal_simple', // arterial x collector
  FOUR_WAY_STOP: 'stop_4way',            // collector x collector
  STOP_MINOR: 'stop_minor',              // collector x local
  YIELD: 'yield',                         // local x local
  YIELD_MERGE: 'yield_merge',            // ramp merge
};

const HIERARCHY = {
  expressway: 4,
  arterial: 3,
  collector: 2,
  local: 1,
  ramp: 0,
};

const GREEN_DURATIONS = {
  downtown: 35,
  commercial: 25,
  residential: 15,
  industrial: 20,
  waterfront: 20,
};

const YELLOW_DURATION = 4;
const ALL_RED_DURATION = 2;

/**
 * Determines signal type from the two highest-hierarchy road types
 * meeting at an intersection.
 */
export function assignSignalTypes(roadType1, roadType2) {
  const h1 = HIERARCHY[roadType1] ?? 1;
  const h2 = HIERARCHY[roadType2] ?? 1;

  // Order so that high >= low
  const high = Math.max(h1, h2);
  const low = Math.min(h1, h2);

  // ramp + anything
  if (h1 === 0 || h2 === 0) {
    return SIGNAL_TYPES.YIELD_MERGE;
  }

  // arterial (3) + arterial (3)
  if (high === 3 && low === 3) {
    return SIGNAL_TYPES.TRAFFIC_SIGNAL_FULL;
  }

  // arterial (3) + collector (2) or arterial (3) + local (1)
  if (high === 3) {
    return SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE;
  }

  // collector (2) + collector (2)
  if (high === 2 && low === 2) {
    return SIGNAL_TYPES.FOUR_WAY_STOP;
  }

  // collector (2) + local (1)
  if (high === 2 && low === 1) {
    return SIGNAL_TYPES.STOP_MINOR;
  }

  // local (1) + local (1)
  return SIGNAL_TYPES.YIELD;
}

/**
 * Creates a signal state machine for a given district type.
 */
export function createSignalState(districtType) {
  const green = GREEN_DURATIONS[districtType] ?? 20;

  const phases = [
    { duration: green, nsState: 'green', ewState: 'red', walk: true },
    { duration: YELLOW_DURATION, nsState: 'yellow', ewState: 'red', walk: false },
    { duration: ALL_RED_DURATION, nsState: 'red', ewState: 'red', walk: false },
    { duration: green, nsState: 'red', ewState: 'green', walk: true },
    { duration: YELLOW_DURATION, nsState: 'red', ewState: 'yellow', walk: false },
    { duration: ALL_RED_DURATION, nsState: 'red', ewState: 'red', walk: false },
  ];

  return { phases, currentPhase: 0, timer: 0 };
}

/**
 * Advances all signal timers, wrapping phases as needed.
 */
export function updateSignals(signals, dt) {
  for (const sig of signals) {
    sig.timer += dt;
    while (sig.timer >= sig.phases[sig.currentPhase].duration) {
      sig.timer -= sig.phases[sig.currentPhase].duration;
      sig.currentPhase = (sig.currentPhase + 1) % sig.phases.length;
    }
  }
}

/**
 * Returns the current phase object for a signal.
 */
export function getSignalPhase(signal) {
  return signal.phases[signal.currentPhase];
}

/**
 * Checks if a given direction ('ns' or 'ew') has a green light.
 * Returns true for green, false for yellow/red.
 */
export function isGreenForDirection(signal, direction) {
  const phase = getSignalPhase(signal);
  if (direction === 'ns') {
    return phase.nsState === 'green';
  }
  if (direction === 'ew') {
    return phase.ewState === 'green';
  }
  return false;
}

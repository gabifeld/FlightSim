import { describe, it, expect } from 'vitest';
import {
  SIGNAL_TYPES,
  assignSignalTypes,
  createSignalState,
  updateSignals,
  getSignalPhase,
  isGreenForDirection,
} from '../src/intersections.js';

describe('assignSignalTypes', () => {
  it('returns correct type for each road combination', () => {
    expect(assignSignalTypes('arterial', 'arterial')).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_FULL);
    expect(assignSignalTypes('arterial', 'collector')).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE);
    expect(assignSignalTypes('collector', 'arterial')).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE);
    expect(assignSignalTypes('arterial', 'local')).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE);
    expect(assignSignalTypes('local', 'arterial')).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE);
    expect(assignSignalTypes('collector', 'collector')).toBe(SIGNAL_TYPES.FOUR_WAY_STOP);
    expect(assignSignalTypes('collector', 'local')).toBe(SIGNAL_TYPES.STOP_MINOR);
    expect(assignSignalTypes('local', 'collector')).toBe(SIGNAL_TYPES.STOP_MINOR);
    expect(assignSignalTypes('local', 'local')).toBe(SIGNAL_TYPES.YIELD);
    expect(assignSignalTypes('ramp', 'arterial')).toBe(SIGNAL_TYPES.YIELD_MERGE);
    expect(assignSignalTypes('ramp', 'local')).toBe(SIGNAL_TYPES.YIELD_MERGE);
    expect(assignSignalTypes('expressway', 'ramp')).toBe(SIGNAL_TYPES.YIELD_MERGE);
  });
});

describe('createSignalState', () => {
  it('starts at phase 0 with timer 0', () => {
    const sig = createSignalState('downtown');
    expect(sig.currentPhase).toBe(0);
    expect(sig.timer).toBe(0);
  });

  it('downtown signal has 35s green phase', () => {
    const sig = createSignalState('downtown');
    expect(sig.phases[0].duration).toBe(35);
    expect(sig.phases[3].duration).toBe(35);
  });

  it('residential signal has 15s green phase', () => {
    const sig = createSignalState('residential');
    expect(sig.phases[0].duration).toBe(15);
    expect(sig.phases[3].duration).toBe(15);
  });
});

describe('updateSignals', () => {
  it('advances past green into yellow', () => {
    const sig = createSignalState('residential');
    // Green is 15s, advance 16s to land in yellow phase
    updateSignals([sig], 16);
    expect(sig.currentPhase).toBe(1);
    expect(getSignalPhase(sig).nsState).toBe('yellow');
    expect(sig.timer).toBeCloseTo(1, 5);
  });

  it('full cycle wraps back to phase 0 (residential: 15+4+2+15+4+2=42s)', () => {
    const sig = createSignalState('residential');
    updateSignals([sig], 42);
    expect(sig.currentPhase).toBe(0);
    expect(sig.timer).toBeCloseTo(0, 5);
  });
});

describe('getSignalPhase', () => {
  it('returns correct nsState/ewState for current phase', () => {
    const sig = createSignalState('commercial');
    const phase = getSignalPhase(sig);
    expect(phase.nsState).toBe('green');
    expect(phase.ewState).toBe('red');
  });

  it('phase 0 is NS green, EW red', () => {
    const sig = createSignalState('downtown');
    sig.currentPhase = 0;
    const phase = getSignalPhase(sig);
    expect(phase.nsState).toBe('green');
    expect(phase.ewState).toBe('red');
  });

  it('phase 3 is NS red, EW green', () => {
    const sig = createSignalState('downtown');
    sig.currentPhase = 3;
    const phase = getSignalPhase(sig);
    expect(phase.nsState).toBe('red');
    expect(phase.ewState).toBe('green');
  });
});

describe('isGreenForDirection', () => {
  it('returns true for ns when phase is NS green', () => {
    const sig = createSignalState('downtown');
    sig.currentPhase = 0;
    expect(isGreenForDirection(sig, 'ns')).toBe(true);
    expect(isGreenForDirection(sig, 'ew')).toBe(false);
  });

  it('returns true for ew when phase is EW green', () => {
    const sig = createSignalState('downtown');
    sig.currentPhase = 3;
    expect(isGreenForDirection(sig, 'ns')).toBe(false);
    expect(isGreenForDirection(sig, 'ew')).toBe(true);
  });

  it('returns false for both during yellow/all-red', () => {
    const sig = createSignalState('downtown');
    sig.currentPhase = 1; // NS yellow
    expect(isGreenForDirection(sig, 'ns')).toBe(false);
    expect(isGreenForDirection(sig, 'ew')).toBe(false);

    sig.currentPhase = 2; // all-red
    expect(isGreenForDirection(sig, 'ns')).toBe(false);
    expect(isGreenForDirection(sig, 'ew')).toBe(false);
  });
});

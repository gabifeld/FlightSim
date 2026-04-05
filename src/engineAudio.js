// Engine audio synthesis — three distinct voices: piston, turbofan, fighter
// Pure Web Audio API synthesis, no external audio files.

import { getAllEngineStates } from './systemsEngine.js';

let audioCtx = null;
let masterOut = null;
let currentController = null;
let fadingControllers = [];

// Shared white noise buffer (2s, reused across all engines)
let sharedNoiseBuffer = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safe(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function safeSet(param, value, now, timeConstant = 0.15) {
  const v = safe(value);
  param.setTargetAtTime(v, now, Math.max(safe(timeConstant, 0.15), 0.001));
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(Math.max(t, 0), 1);
}

function getNoiseBuffer(ctx) {
  if (!sharedNoiseBuffer || sharedNoiseBuffer.sampleRate !== ctx.sampleRate) {
    const sr = ctx.sampleRate;
    const len = sr * 2;
    sharedNoiseBuffer = ctx.createBuffer(1, len, sr);
    const data = sharedNoiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return sharedNoiseBuffer;
}

function createLoopedNoise(ctx) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  return src;
}

// Stereo pan values for multi-engine layouts
function getPanForEngine(index, count) {
  if (count === 1) return 0;
  if (count === 2) return index === 0 ? -0.3 : 0.3;
  if (count === 4) return [-0.5, -0.2, 0.2, 0.5][index] || 0;
  // Generic: spread evenly from -0.5 to 0.5
  return count > 1 ? -0.5 + (index / (count - 1)) : 0;
}

// ---------------------------------------------------------------------------
// PISTON ENGINE (Cessna 172, DHC-2 Beaver)
// Triangle fundamental + 4 sawtooth harmonics + exhaust crackle + prop wash
// ---------------------------------------------------------------------------

function createPistonEngine(ctx, output) {
  const TC = 0.15;

  // Fundamental: triangle wave
  const fundamental = ctx.createOscillator();
  fundamental.type = 'triangle';
  fundamental.frequency.value = 80;
  const fundGain = ctx.createGain();
  fundGain.gain.value = 0.3;
  fundamental.connect(fundGain).connect(output);
  fundamental.start();

  // 4 harmonics: sawtooth at 2x, 3x, 4x, 6x with decreasing amplitude
  const harmonicMults = [2, 3, 4, 6];
  const harmonicAmps = [0.4, 0.25, 0.12, 0.06];
  const harmonics = [];
  const harmonicGains = [];

  for (let i = 0; i < harmonicMults.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 80 * harmonicMults[i];
    const g = ctx.createGain();
    g.gain.value = harmonicAmps[i] * 0.3;
    osc.connect(g).connect(output);
    osc.start();
    harmonics.push(osc);
    harmonicGains.push(g);
  }

  // Prop wash: bandpass noise (200-800Hz), volume and freq scale with throttle
  const propWashSrc = createLoopedNoise(ctx);
  const propWashFilter = ctx.createBiquadFilter();
  propWashFilter.type = 'bandpass';
  propWashFilter.frequency.value = 200;
  propWashFilter.Q.value = 1.5;
  const propWashGain = ctx.createGain();
  propWashGain.gain.value = 0;
  propWashSrc.connect(propWashFilter).connect(propWashGain).connect(output);
  propWashSrc.start();

  // Exhaust crackle system: periodic noise bursts at idle
  // Uses a looped noise source gated by a gain node that we pulse
  const crackleSrc = createLoopedNoise(ctx);
  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'bandpass';
  crackleFilter.frequency.value = 250;
  crackleFilter.Q.value = 1.0;
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0;
  crackleSrc.connect(crackleFilter).connect(crackleGain).connect(output);
  crackleSrc.start();

  // Crackle timing state
  let nextCrackleTime = 0;
  let crackleActive = false;

  function scheduleCrackle(now, throttle) {
    if (throttle > 0.2) {
      // No crackle above 20% throttle
      if (crackleActive) {
        crackleGain.gain.setTargetAtTime(0, now, 0.01);
        crackleActive = false;
      }
      return;
    }

    if (now >= nextCrackleTime) {
      // Fire a 20ms burst
      const burstVol = 0.08 + Math.random() * 0.06;
      crackleGain.gain.setValueAtTime(burstVol, now);
      crackleGain.gain.setTargetAtTime(0, now + 0.02, 0.005);
      crackleFilter.frequency.setValueAtTime(150 + Math.random() * 250, now);
      crackleActive = true;

      // Next burst: random interval 125-333ms (3-8 bursts/sec)
      nextCrackleTime = now + 0.125 + Math.random() * 0.208;
    }
  }

  return {
    type: 'piston',
    nodes: [fundamental, ...harmonics, propWashSrc, crackleSrc],
    gains: [fundGain, ...harmonicGains, propWashGain, crackleGain],
    filters: [propWashFilter, crackleFilter],

    update(n1, _n2, throttle, now) {
      const rpm = safe(n1, 0) / 100; // 0-1
      const thr = safe(throttle, 0);
      // Frequency: 80Hz idle to 180Hz full
      const freq = 80 + rpm * 100;

      safeSet(fundamental.frequency, freq, now, TC);
      safeSet(fundGain.gain, 0.15 + thr * 0.15, now, TC);

      for (let i = 0; i < harmonics.length; i++) {
        safeSet(harmonics[i].frequency, freq * harmonicMults[i], now, TC);
        safeSet(harmonicGains[i].gain, harmonicAmps[i] * (0.15 + thr * 0.15), now, TC);
      }

      // Prop wash: center freq 200-800Hz, volume scales with throttle
      safeSet(propWashFilter.frequency, 200 + thr * 600, now, TC);
      safeSet(propWashGain.gain, thr * 0.1, now, TC);

      // Exhaust crackle at idle
      scheduleCrackle(now, thr);
    },

    dispose() {
      [fundamental, ...harmonics, propWashSrc, crackleSrc].forEach(n => {
        try { n.stop(); } catch (_) { /* */ }
        try { n.disconnect(); } catch (_) { /* */ }
      });
      [fundGain, ...harmonicGains, propWashGain, crackleGain].forEach(n => {
        try { n.disconnect(); } catch (_) { /* */ }
      });
      [propWashFilter, crackleFilter].forEach(n => {
        try { n.disconnect(); } catch (_) { /* */ }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// TURBOFAN ENGINE (Boeing 737, Airbus A340)
// Core rumble + compressor whine + bypass rush + spool sweep
// ---------------------------------------------------------------------------

function createTurbofanEngine(ctx, output) {
  const TC = 0.15;

  // Core rumble: sine wave, 100-300Hz, tracks N1
  const coreOsc = ctx.createOscillator();
  coreOsc.type = 'sine';
  coreOsc.frequency.value = 100;
  const coreGain = ctx.createGain();
  coreGain.gain.value = 0.25;
  coreOsc.connect(coreGain).connect(output);
  coreOsc.start();

  // Compressor whine: sine wave, 2000-4000Hz, tracks N2, high-pass filtered
  const compOsc = ctx.createOscillator();
  compOsc.type = 'sine';
  compOsc.frequency.value = 2000;
  const compHP = ctx.createBiquadFilter();
  compHP.type = 'highpass';
  compHP.frequency.value = 1800;
  compHP.Q.value = 0.7;
  const compGain = ctx.createGain();
  compGain.gain.value = 0.06;
  compOsc.connect(compHP).connect(compGain).connect(output);
  compOsc.start();

  // Bypass rush: bandpass noise, 300-1500Hz Q=0.8, volume tracks N1
  const bypassSrc = createLoopedNoise(ctx);
  const bypassFilter = ctx.createBiquadFilter();
  bypassFilter.type = 'bandpass';
  bypassFilter.frequency.value = 300;
  bypassFilter.Q.value = 0.8;
  const bypassGain = ctx.createGain();
  bypassGain.gain.value = 0;
  bypassSrc.connect(bypassFilter).connect(bypassGain).connect(output);
  bypassSrc.start();

  // Spool sweep state: track last throttle for detecting changes
  let lastThrottle = 0;
  let spoolSweepTarget = 2000;

  return {
    type: 'turbofan',
    nodes: [coreOsc, compOsc, bypassSrc],
    gains: [coreGain, compGain, bypassGain],
    filters: [compHP, bypassFilter],

    update(n1, n2, throttle, now) {
      const n1pct = safe(n1, 0) / 100;
      const n2pct = safe(n2, n1 ? n1 * 0.95 : 0) / 100;
      const thr = safe(throttle, 0);

      // Core rumble: freq 100-300Hz tracks N1, volume 0.25 base
      safeSet(coreOsc.frequency, 100 + n1pct * 200, now, TC);
      safeSet(coreGain.gain, 0.1 + n1pct * 0.15, now, TC);

      // Compressor whine: freq 2000-4000Hz tracks N2
      const compFreqTarget = 2000 + n2pct * 2000;

      // Spool sweep: on throttle change > 10%, use faster sweep (0.5s)
      const throttleDelta = Math.abs(thr - lastThrottle);
      const sweepTC = throttleDelta > 0.1 ? 0.5 : TC;
      lastThrottle = thr;

      safeSet(compOsc.frequency, compFreqTarget, now, sweepTC);
      // At idle: compressor whine relatively prominent; at high thrust: same level
      const compVol = 0.03 + n2pct * 0.04;
      safeSet(compGain.gain, compVol, now, TC);

      // Bypass rush: louder at high thrust, bandpass center shifts up
      safeSet(bypassFilter.frequency, 300 + n1pct * 1200, now, TC);
      const bypassVol = n1pct * n1pct * 0.12; // quadratic for quiet at idle
      safeSet(bypassGain.gain, bypassVol, now, TC);
    },

    dispose() {
      [coreOsc, compOsc, bypassSrc].forEach(n => {
        try { n.stop(); } catch (_) { /* */ }
        try { n.disconnect(); } catch (_) { /* */ }
      });
      [coreGain, compGain, bypassGain].forEach(n => {
        try { n.disconnect(); } catch (_) { /* */ }
      });
      [compHP, bypassFilter].forEach(n => {
        try { n.disconnect(); } catch (_) { /* */ }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// FIGHTER ENGINE (F-16)
// Core roar (sawtooth) + compressor scream + afterburner
// ---------------------------------------------------------------------------

function createFighterEngine(ctx, output, hasAfterburner) {
  const TC = 0.15;

  // Core roar: sawtooth, 150-500Hz, aggressive
  const coreOsc = ctx.createOscillator();
  coreOsc.type = 'sawtooth';
  coreOsc.frequency.value = 150;
  const coreGain = ctx.createGain();
  coreGain.gain.value = 0.4;
  coreOsc.connect(coreGain).connect(output);
  coreOsc.start();

  // Compressor scream: sine, 3000-6000Hz, thin and aggressive
  const compOsc = ctx.createOscillator();
  compOsc.type = 'sine';
  compOsc.frequency.value = 3000;
  const compGain = ctx.createGain();
  compGain.gain.value = 0.08;
  compOsc.connect(compGain).connect(output);
  compOsc.start();

  // Afterburner broadband noise (unfiltered)
  let abNoiseSrc = null;
  let abNoiseGain = null;
  // Afterburner deep rumble (sine 30-60Hz)
  let abRumbleOsc = null;
  let abRumbleGain = null;
  // AB state
  let abActive = false;

  if (hasAfterburner) {
    abNoiseSrc = createLoopedNoise(ctx);
    abNoiseGain = ctx.createGain();
    abNoiseGain.gain.value = 0;
    abNoiseSrc.connect(abNoiseGain).connect(output);
    abNoiseSrc.start();

    abRumbleOsc = ctx.createOscillator();
    abRumbleOsc.type = 'sine';
    abRumbleOsc.frequency.value = 30;
    abRumbleGain = ctx.createGain();
    abRumbleGain.gain.value = 0;
    abRumbleOsc.connect(abRumbleGain).connect(output);
    abRumbleOsc.start();
  }

  return {
    type: 'fighter',
    nodes: [coreOsc, compOsc, abNoiseSrc, abRumbleOsc].filter(Boolean),
    gains: [coreGain, compGain, abNoiseGain, abRumbleGain].filter(Boolean),
    filters: [],

    update(n1, n2, throttle, now) {
      const n1pct = safe(n1, 0) / 100;
      const thr = safe(throttle, 0);

      // Core roar: 150-500Hz, vol 0.4 max
      safeSet(coreOsc.frequency, 150 + n1pct * 350, now, TC);
      safeSet(coreGain.gain, 0.15 + n1pct * 0.25, now, TC);

      // Compressor scream: 3000-6000Hz
      safeSet(compOsc.frequency, 3000 + n1pct * 3000, now, TC);
      safeSet(compGain.gain, 0.03 + n1pct * 0.05, now, TC);

      // Afterburner: engages above 90% throttle
      if (hasAfterburner && abNoiseGain && abRumbleGain) {
        const abShouldBeActive = thr > 0.9;

        if (abShouldBeActive && !abActive) {
          // Light-off: 0.3s activation with thump
          abActive = true;
          // Thump: quick noise burst via the AB noise gain
          abNoiseGain.gain.setValueAtTime(0.35, now);
          abNoiseGain.gain.setTargetAtTime(0.2, now + 0.05, 0.1);
          abRumbleGain.gain.setTargetAtTime(0.3, now, 0.3);
          // Deep rumble freq tracks thrust
          safeSet(abRumbleOsc.frequency, 30 + thr * 30, now, TC);
        } else if (abShouldBeActive && abActive) {
          // Sustain
          safeSet(abNoiseGain.gain, 0.2, now, TC);
          safeSet(abRumbleGain.gain, 0.3, now, TC);
          safeSet(abRumbleOsc.frequency, 30 + thr * 30, now, TC);
        } else if (!abShouldBeActive && abActive) {
          // Deactivate
          abActive = false;
          safeSet(abNoiseGain.gain, 0, now, TC);
          safeSet(abRumbleGain.gain, 0, now, TC);
        }
      }
    },

    dispose() {
      [coreOsc, compOsc, abNoiseSrc, abRumbleOsc].filter(Boolean).forEach(n => {
        try { n.stop(); } catch (_) { /* */ }
        try { n.disconnect(); } catch (_) { /* */ }
      });
      [coreGain, compGain, abNoiseGain, abRumbleGain].filter(Boolean).forEach(n => {
        try { n.disconnect(); } catch (_) { /* */ }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

function createEngineForType(ctx, output, type, hasAfterburner) {
  switch (type) {
    case 'piston':   return createPistonEngine(ctx, output);
    case 'jet':      return createTurbofanEngine(ctx, output);
    case 'fighter':  return createFighterEngine(ctx, output, hasAfterburner);
    default:         return createPistonEngine(ctx, output);
  }
}

// ---------------------------------------------------------------------------
// Controller: manages N independent engines with stereo panning
// ---------------------------------------------------------------------------

function createController(ctx, master, type, engineCount, hasAfterburner) {
  const count = Math.max(1, engineCount || 1);
  const volumePerEngine = 1.0 / Math.sqrt(count);

  const outputGain = ctx.createGain();
  outputGain.gain.value = 1.0;
  outputGain.connect(master);

  const engines = [];

  for (let i = 0; i < count; i++) {
    // Per-engine gain for volume control and failure fade
    const engGain = ctx.createGain();
    engGain.gain.value = volumePerEngine;

    // Stereo panner
    const panner = ctx.createStereoPanner();
    panner.pan.value = getPanForEngine(i, count);

    engGain.connect(panner).connect(outputGain);

    const engine = createEngineForType(ctx, engGain, type, hasAfterburner);
    engines.push({ engine, gain: engGain, panner, failed: false });
  }

  return {
    engines,
    outputGain,
    type,
    engineCount: count,
    hasAfterburner: !!hasAfterburner,
    volumePerEngine,
  };
}

function disposeController(ctrl) {
  if (!ctrl) return;
  for (const entry of ctrl.engines) {
    try { entry.engine.dispose(); } catch (_) { /* */ }
    try { entry.gain.disconnect(); } catch (_) { /* */ }
    try { entry.panner.disconnect(); } catch (_) { /* */ }
  }
  try { ctrl.outputGain.disconnect(); } catch (_) { /* */ }
  ctrl.engines.length = 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the engine audio system. Creates oscillator/noise node stacks
 * matching the given engine type. Call once after AudioContext is created.
 *
 * @param {AudioContext} ctx - the shared AudioContext
 * @param {AudioNode} destination - node to connect to (e.g. ctx.destination)
 * @param {string} engineType - 'piston' | 'jet' | 'fighter'
 * @param {number} engineCount - number of engines
 * @param {boolean} hasAfterburner - whether afterburner is available
 */
export function initEngineAudio(ctx, destination, engineType, engineCount, hasAfterburner) {
  audioCtx = ctx;
  masterOut = destination || ctx.destination;

  // Clean up any existing controller
  if (currentController) {
    disposeController(currentController);
    currentController = null;
  }

  currentController = createController(
    audioCtx,
    masterOut,
    engineType || 'piston',
    engineCount || 1,
    !!hasAfterburner,
  );

  return currentController;
}

/**
 * Update engine audio each frame. Reads vehicle throttle and per-engine state
 * (n1, n2, running, failed) from systemsEngine if not provided.
 *
 * @param {object} vehicle - vehicle state with .throttle
 * @param {Array|null} engineStates - optional array of { n1, n2, running, failed }
 * @param {number} dt - delta time in seconds
 */
export function updateEngineAudio(vehicle, engineStates, dt) {
  if (!audioCtx || audioCtx.state === 'suspended' || !currentController) return;

  const now = audioCtx.currentTime;
  const throttle = safe(vehicle && vehicle.throttle, 0);
  const ctrl = currentController;

  // Get engine states: use provided array, or pull from systemsEngine
  let states = engineStates;
  if (!states) {
    try { states = getAllEngineStates(); } catch (_) { states = null; }
  }

  for (let i = 0; i < ctrl.engines.length; i++) {
    const entry = ctrl.engines[i];
    const eng = states && states[i];

    if (eng && eng.running && !eng.failed) {
      // Engine running normally
      const n1 = safe(eng.n1, 0);
      const n2 = safe(eng.n2, n1);
      entry.engine.update(n1, n2, throttle, now);

      // Restore volume if was previously faded
      if (entry.failed) {
        entry.failed = false;
      }
      safeSet(entry.gain.gain, ctrl.volumePerEngine, now, 0.15);

    } else if (eng && eng.failed && !entry.failed) {
      // Engine just failed: fade to 0 over 2s
      entry.failed = true;
      safeSet(entry.gain.gain, 0, now, 2.0);
      // Update frequencies to spool down
      const n1 = safe(eng.n1, 0);
      const n2 = safe(eng.n2, n1);
      entry.engine.update(n1, n2, 0, now);

    } else if (eng && eng.failed) {
      // Engine already failed, keep updating with decaying n1/n2
      const n1 = safe(eng.n1, 0);
      const n2 = safe(eng.n2, n1);
      entry.engine.update(n1, n2, 0, now);

    } else if (eng && !eng.running && (safe(eng.n1, 0) > 1 || safe(eng.n2, 0) > 1)) {
      // Engine spooling (starting or shutting down)
      const n1 = safe(eng.n1, 0);
      const n2 = safe(eng.n2, n1);
      entry.engine.update(n1, n2, throttle, now);
      const fadeFactor = Math.min(n1 / 20, 1.0);
      safeSet(entry.gain.gain, fadeFactor * ctrl.volumePerEngine, now, 0.3);

    } else if (!states) {
      // No engine states available (systemsEngine not initialized)
      // Drive from throttle directly as a fallback
      const pseudoN1 = 20 + throttle * 80;
      entry.engine.update(pseudoN1, pseudoN1 * 0.95, throttle, now);
      safeSet(entry.gain.gain, ctrl.volumePerEngine, now, 0.15);

    } else {
      // Engine off: silence
      safeSet(entry.gain.gain, 0, now, 0.3);
      entry.engine.update(0, 0, 0, now);
    }
  }
}

/**
 * Crossfade to a new engine sound when switching aircraft.
 * 0.5s fade out -> 0.2s silence -> 0.5s fade in.
 *
 * @param {string} newType - 'piston' | 'jet' | 'fighter'
 * @param {number} newCount - number of engines
 * @param {boolean} hasAB - whether afterburner is available
 */
export function switchEngineAudio(newType, newCount, hasAB) {
  if (!audioCtx || !masterOut) return;

  // Support legacy call with config object
  let type, count, ab;
  if (typeof newType === 'object' && newType !== null) {
    const config = newType;
    type = config.engineAudio || config.audioType || 'piston';
    count = config.engineCount || 1;
    ab = !!config.hasAfterburner;
  } else {
    type = newType || 'piston';
    count = newCount || 1;
    ab = !!hasAB;
  }

  // If type/count match, skip
  if (
    currentController &&
    currentController.type === type &&
    currentController.engineCount === count &&
    currentController.hasAfterburner === ab
  ) {
    return;
  }

  const now = audioCtx.currentTime;

  // Fade out current controller over 0.5s
  if (currentController) {
    const dying = currentController;
    dying.outputGain.gain.setTargetAtTime(0, now, 0.15); // ~0.5s to near-zero
    fadingControllers.push(dying);
    // Dispose after fade out + silence gap
    setTimeout(() => {
      disposeController(dying);
      const idx = fadingControllers.indexOf(dying);
      if (idx !== -1) fadingControllers.splice(idx, 1);
    }, 1200); // 0.5s fade + 0.2s silence + margin
  }

  // Create new controller after 0.7s (fade out + silence)
  setTimeout(() => {
    if (!audioCtx || !masterOut) return;
    currentController = createController(audioCtx, masterOut, type, count, ab);
    // Start silent, fade in over 0.5s
    currentController.outputGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    currentController.outputGain.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.15);
  }, 700);

  // Clear current reference during crossfade
  currentController = null;
}

/**
 * Dispose all engine audio nodes and clean up.
 */
export function disposeEngineAudio() {
  if (currentController) {
    disposeController(currentController);
    currentController = null;
  }
  for (const ctrl of fadingControllers) {
    disposeController(ctrl);
  }
  fadingControllers.length = 0;
  audioCtx = null;
  masterOut = null;
  sharedNoiseBuffer = null;
}

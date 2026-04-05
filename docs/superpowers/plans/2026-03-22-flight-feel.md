# Flight Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flying feel incredible through advanced stall/spin physics, distinct per-aircraft audio synthesis, and a polished camera system with 5 new modes and visual stress effects.

**Architecture:** Three new pure-logic modules (flightModel.js, engineAudio.js, cameraEffects.js) extend the existing physics/audio/camera systems without replacing them. A thin realism.js config module controls adaptive difficulty. Integration is surgical — existing files gain imports and call sites, not rewrites.

**Tech Stack:** Three.js (ShaderPass, Web Audio API oscillators/filters/gains), vitest

**Spec:** `docs/superpowers/specs/2026-03-22-flight-feel-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/realism.js` | Adaptive difficulty profiles (lite/study), threshold config, `getRealism()` |
| `src/flightModel.js` | Stall/spin state machine, engine-out yaw, G-force onset model, density altitude, crosswind ground handling |
| `src/engineAudio.js` | Piston/turboprop/jet synthesis models, per-engine oscillator stacks, aircraft switch crossfade |
| `src/effectsAudio.js` | Procedural one-shot effects (wheel squeal, gear motor, flap motor, stall buffet, Doppler, cockpit ambiance, touch thump) |
| `src/cameraEffects.js` | FOV compression, G-vignette uniforms, blackout state, screen shake (position-only) |
| `tests/realism.test.js` | Tests for realism profiles |
| `tests/flightModel.test.js` | Tests for stall/spin state machine, G-onset, density altitude |

### Modified Files
| File | Changes |
|------|---------|
| `src/physics.js` | Import flightModel, call before integration step, use density-adjusted air density |
| `src/audio.js` | Import engineAudio + effectsAudio, replace generic oscillators, wire aircraft switch lifecycle |
| `src/camera.js` | Mode registry with F-key modes, terrain collision fix, per-aircraft cockpit offsets, 5 new modes |
| `src/controls.js` | Add F1-F5 to SIM_KEYS, add camera mode key handlers |
| `src/aircraftTypes.js` | Add engineAudio, hasAfterburner, cockpitOffset, lookLimits per type |
| `src/postprocessing.js` | Add vignette ShaderPass before OutputPass, export setVignetteUniforms() |
| `src/settings.js` | Add realism and cameraShakeScale settings |
| `src/missiles.js` | Add isMissileActive(), getActiveMissileState() exports |
| `src/aircraftAI.js` | Add getAIAircraftList() export |

---

## Task 1: Realism Module

**Files:**
- Create: `src/realism.js`
- Create: `tests/realism.test.js`
- Modify: `src/settings.js`

Tiny config module — the foundation everything else queries for thresholds.

- [ ] **Step 1: Add realism setting to settings.js**

In `src/settings.js`, add to the defaults object:
```javascript
realism: 'lite',
cameraShakeScale: 1.0,
```

- [ ] **Step 2: Write tests for realism module**

Create `tests/realism.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { getRealism, REALISM_PROFILES } from '../src/realism.js';

describe('Realism profiles', () => {
  it('has lite and study profiles', () => {
    expect(REALISM_PROFILES.lite).toBeDefined();
    expect(REALISM_PROFILES.study).toBeDefined();
  });

  it('lite has auto spin recovery', () => {
    expect(REALISM_PROFILES.lite.spinAutoRecovery).toBe(true);
  });

  it('study requires manual spin recovery', () => {
    expect(REALISM_PROFILES.study.spinAutoRecovery).toBe(false);
  });

  it('lite never blacks out', () => {
    expect(REALISM_PROFILES.lite.gBlackoutThreshold).toBe(Infinity);
  });

  it('study blacks out at 9G', () => {
    expect(REALISM_PROFILES.study.gBlackoutThreshold).toBe(9);
  });

  it('getRealism returns a profile object', () => {
    const r = getRealism();
    expect(r).toHaveProperty('spinAutoRecovery');
    expect(r).toHaveProperty('gLimitStructural');
    expect(r).toHaveProperty('cameraShakeScale');
  });
});
```

- [ ] **Step 3: Implement realism.js**

Create `src/realism.js`:
```javascript
import { getSetting } from './settings.js';

export const REALISM_PROFILES = {
  lite: {
    spinAutoRecovery: true,
    spinRecoveryTime: 3.0,
    wingDropIntensity: 0.5,
    vmcEnabled: false,
    gLimitStructural: 15,
    gBlackoutThreshold: Infinity,
    gVignetteOnset: 7,
    gTunnelVision: 9,
    gRedoutThreshold: -4,
    cameraShakeScale: 0.5,
  },
  study: {
    spinAutoRecovery: false,
    spinRecoveryTime: Infinity,
    wingDropIntensity: 1.0,
    vmcEnabled: true,
    gLimitStructural: 9,
    gBlackoutThreshold: 9,
    gVignetteOnset: 4.5,
    gTunnelVision: 6,
    gRedoutThreshold: -2.5,
    cameraShakeScale: 1.0,
  },
};

export function getRealism() {
  const mode = getSetting('realism') || 'lite';
  return REALISM_PROFILES[mode] || REALISM_PROFILES.lite;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/realism.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/realism.js tests/realism.test.js src/settings.js
git commit -m "feat: add adaptive realism module with lite/study profiles"
```

---

## Task 2: Flight Model — Stall/Spin & G-Force

**Files:**
- Create: `src/flightModel.js`
- Create: `tests/flightModel.test.js`

The core advanced aerodynamics module. Pure logic — no Three.js rendering.

- [ ] **Step 1: Write tests**

Create `tests/flightModel.test.js`:
```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFlightModelState,
  updateFlightModel,
  getStallState,
  getGOnset,
  getDensityRatio,
  STALL_STATES,
} from '../src/flightModel.js';

describe('Stall state machine', () => {
  let fms;
  beforeEach(() => { fms = createFlightModelState(); });

  it('starts in normal state', () => {
    expect(getStallState(fms)).toBe(STALL_STATES.NORMAL);
  });

  it('transitions to buffet near stall AOA', () => {
    // Simulate approaching stall: AOA = stallAOA - 2 degrees
    const stallAoa = 0.5; // ~28 degrees
    updateFlightModel(fms, { aoa: stallAoa - 0.04, isStalling: false, stallAoa, onGround: false, gForce: 1, speed: 50, throttle: 0.5, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [], engineArms: [], dt: 0.016 }, { spinAutoRecovery: true, wingDropIntensity: 0.5 });
    expect(getStallState(fms)).toBe(STALL_STATES.BUFFET);
  });

  it('transitions to stall when stalling', () => {
    const stallAoa = 0.5;
    // Push past stall
    updateFlightModel(fms, { aoa: stallAoa + 0.05, isStalling: true, stallAoa, onGround: false, gForce: 1, speed: 50, throttle: 0.5, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [], engineArms: [], dt: 0.016 }, { spinAutoRecovery: true, wingDropIntensity: 0.5 });
    expect(getStallState(fms)).toBe(STALL_STATES.STALL);
  });
});

describe('G-force onset', () => {
  let fms;
  beforeEach(() => { fms = createFlightModelState(); });

  it('starts at 1G', () => {
    expect(getGOnset(fms)).toBeCloseTo(1.0, 0.5);
  });

  it('onset increases under sustained high G', () => {
    for (let i = 0; i < 60; i++) { // 1 second at 60fps
      updateFlightModel(fms, { aoa: 0.1, isStalling: false, stallAoa: 0.5, onGround: false, gForce: 6, speed: 100, throttle: 0.8, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [], engineArms: [], dt: 1/60 }, { spinAutoRecovery: true, wingDropIntensity: 0.5 });
    }
    expect(getGOnset(fms)).toBeGreaterThan(3);
  });

  it('onset decays back toward 1G', () => {
    // First push to high G
    for (let i = 0; i < 60; i++) {
      updateFlightModel(fms, { aoa: 0.1, isStalling: false, stallAoa: 0.5, onGround: false, gForce: 6, speed: 100, throttle: 0.8, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [], engineArms: [], dt: 1/60 }, { spinAutoRecovery: true, wingDropIntensity: 0.5 });
    }
    const peakG = getGOnset(fms);
    // Then relax to 1G
    for (let i = 0; i < 120; i++) {
      updateFlightModel(fms, { aoa: 0.1, isStalling: false, stallAoa: 0.5, onGround: false, gForce: 1, speed: 100, throttle: 0.5, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [], engineArms: [], dt: 1/60 }, { spinAutoRecovery: true, wingDropIntensity: 0.5 });
    }
    expect(getGOnset(fms)).toBeLessThan(peakG);
  });
});

describe('Density altitude', () => {
  it('returns 1.0 at sea level', () => {
    expect(getDensityRatio(0)).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.74 at 3000m', () => {
    expect(getDensityRatio(3000)).toBeCloseTo(0.74, 0.1);
  });

  it('returns ~0.53 at 6000m', () => {
    expect(getDensityRatio(6000)).toBeCloseTo(0.53, 0.1);
  });

  it('never goes below 0.1', () => {
    expect(getDensityRatio(50000)).toBeGreaterThanOrEqual(0.1);
  });
});

describe('Engine-out yaw', () => {
  let fms;
  beforeEach(() => { fms = createFlightModelState(); });

  it('returns zero yaw with no failed engines', () => {
    updateFlightModel(fms, { aoa: 0.1, isStalling: false, stallAoa: 0.5, onGround: false, gForce: 1, speed: 80, throttle: 0.8, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [], engineArms: [], dt: 0.016 }, { spinAutoRecovery: true, wingDropIntensity: 0.5, vmcEnabled: true });
    expect(fms.engineOutYaw).toBeCloseTo(0);
  });

  it('returns nonzero yaw with one engine failed', () => {
    updateFlightModel(fms, { aoa: 0.1, isStalling: false, stallAoa: 0.5, onGround: false, gForce: 1, speed: 80, throttle: 0.8, pitchInput: 0, rollInput: 0, yawInput: 0, engineFailed: [true, false], engineArms: [-5, 5], dt: 0.016 }, { spinAutoRecovery: true, wingDropIntensity: 0.5, vmcEnabled: true });
    expect(Math.abs(fms.engineOutYaw)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/flightModel.test.js
```

- [ ] **Step 3: Implement flightModel.js**

Create `src/flightModel.js` — exports:

- `createFlightModelState()` — returns initial state: `{ stallState, stallTimer, spinDirection, gOnset, buffetPhase, wingDropSeed, engineOutYaw, crosswindYaw }`
- `updateFlightModel(fms, input, realism)` — main update. Input object: `{ aoa, isStalling, stallAoa, onGround, gForce, speed, throttle, pitchInput, rollInput, yawInput, engineFailed, engineArms, dt }`
- `getStallState(fms)`, `getGOnset(fms)`, `getDensityRatio(altitudeMeters)`
- `getBuffetPerturbation(fms)` — returns `{ pitch, roll }` offsets for camera/physics
- `getSpinTorques(fms)` — returns `{ pitch, roll, yaw }` torques for physics integration
- `getEngineOutYaw(fms)` — returns yaw torque from asymmetric thrust
- `STALL_STATES` enum: `{ NORMAL, BUFFET, STALL, INCIPIENT_SPIN, DEVELOPED_SPIN }`

Implementation details:
- **Stall state machine:** buffet when AOA within 3° of stall, stall on isStalling, spin after 1s of pro-spin inputs
- **Buffet:** `pitch = sin(t * 8 * 2PI) * 0.01 * intensity`, `roll = sin(t * 8 * 2PI + 1.5) * 0.02 * intensity`
- **Wing drop:** random direction seeded per stall event, `rollRate = ±0.3 * realism.wingDropIntensity`
- **Spin:** autorotation `rollRate = 1.5 rad/s * spinDirection`, `pitchRate` nose-down
- **Recovery:** check throttle < 0.1, rudder opposing spin, stick forward. Transition back through states.
- **G-onset:** `gOnset += (gForce - gOnset) * (1 - exp(-dt / 1.5))`
- **Density:** `densityRatio = max(0.1, pow(1 - 0.0000226 * altMeters, 4.256))`
- **Engine-out:** sum `thrust * arm` for all working engines to get net yaw moment
- **Crosswind ground handling:** weathervane yaw proportional to crosswind component

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/flightModel.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/flightModel.js tests/flightModel.test.js
git commit -m "feat: advanced flight model with stall/spin, G-force, density altitude, engine-out"
```

---

## Task 3: Physics Integration

**Files:**
- Modify: `src/physics.js`

Wire flightModel into the existing physics step.

- [ ] **Step 1: Add imports to physics.js**

At top of `src/physics.js` (after existing imports):
```javascript
import { createFlightModelState, updateFlightModel, getBuffetPerturbation, getSpinTorques, getEngineOutYaw, getDensityRatio, getGOnset, getStallState, STALL_STATES } from './flightModel.js';
import { getRealism } from './realism.js';
```

Add module-level state:
```javascript
let flightModelState = createFlightModelState();
```

- [ ] **Step 2: Add density altitude to dynamic pressure**

Find where `AIR_DENSITY` is used in lift/drag computation (~line 288). Replace:
```javascript
// Before: const q = 0.5 * AIR_DENSITY * speed * speed;
const densityRatio = getDensityRatio(state.position.y);
const effectiveDensity = AIR_DENSITY * densityRatio;
const q = 0.5 * effectiveDensity * speed * speed;
```

Also apply density to thrust:
```javascript
// Where thrust is computed:
const thrustMag = totalThrust * densityRatio;
```

- [ ] **Step 3: Call flightModel before integration**

Before the existing stall effects block (~line 216), add:
```javascript
// Advanced flight model (before integration)
const realism = getRealism();
updateFlightModel(flightModelState, {
  aoa: state.aoa, isStalling, stallAoa: cfg('stallAoa', STALL_AOA),
  onGround, gForce: state.gForce, speed, throttle: state.throttle,
  pitchInput, rollInput, yawInput,
  engineFailed: state.engineStatus?.map(e => !e.running) || [],
  engineArms: getEngineArms(state),
  dt,
}, realism);

// Apply buffet perturbations
const buffet = getBuffetPerturbation(flightModelState);
if (buffet.pitch !== 0 || buffet.roll !== 0) {
  _tempQ.setFromAxisAngle(_right, buffet.pitch);
  state.quaternion.premultiply(_tempQ);
  _tempQ.setFromAxisAngle(_forward, buffet.roll);
  state.quaternion.premultiply(_tempQ);
}

// Apply spin torques (overrides normal stall if in spin)
const stallState = getStallState(flightModelState);
if (stallState >= STALL_STATES.INCIPIENT_SPIN) {
  const spin = getSpinTorques(flightModelState);
  _tempQ.setFromAxisAngle(_right, spin.pitch * dt);
  state.quaternion.premultiply(_tempQ);
  _tempQ.setFromAxisAngle(_forward, spin.roll * dt);
  state.quaternion.premultiply(_tempQ);
  _tempQ.setFromAxisAngle(_worldUp, spin.yaw * dt);
  state.quaternion.premultiply(_tempQ);
}

// Engine-out yaw
const engineYaw = getEngineOutYaw(flightModelState);
if (Math.abs(engineYaw) > 0.001) {
  _tempQ.setFromAxisAngle(_worldUp, -engineYaw * dt);
  state.quaternion.premultiply(_tempQ);
}

// Store G-onset for camera effects
state.gOnset = getGOnset(flightModelState);
state.stallState = stallState;
```

Add helper function:
```javascript
function getEngineArms(state) {
  const cfg = getAircraftType(state.aircraftType);
  if (!cfg || cfg.engineCount <= 1) return [];
  // Symmetric engine placement
  const arms = [];
  if (cfg.engineCount === 2) { arms.push(-5, 5); }
  else if (cfg.engineCount === 4) { arms.push(-12, -6, 6, 12); }
  return arms;
}
```

- [ ] **Step 4: Reset flight model state on aircraft reset**

In the reset/init section of physics, add:
```javascript
flightModelState = createFlightModelState();
```

- [ ] **Step 5: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/physics.js
git commit -m "feat: integrate advanced flight model into physics step"
```

---

## Task 4: Aircraft Type Config Extensions

**Files:**
- Modify: `src/aircraftTypes.js`

Add audio and cockpit config fields to each aircraft type.

- [ ] **Step 1: Add new fields to each aircraft type**

For each aircraft in `AIRCRAFT_TYPES`, add these fields:

**cessna_172:**
```javascript
engineAudio: 'piston',
hasAfterburner: false,
cockpitOffset: { y: 1.2, z: -0.5, fov: 70 },
lookYawMax: 80,
lookPitchMax: 60,
engineArmDistance: 0,
```

**boeing_737:**
```javascript
engineAudio: 'jet',
hasAfterburner: false,
cockpitOffset: { y: 2.5, z: -2.0, fov: 65 },
lookYawMax: 70,
lookPitchMax: 50,
engineArmDistance: 5,
```

**f16:**
```javascript
engineAudio: 'jet',
hasAfterburner: true,
cockpitOffset: { y: 1.5, z: -0.3, fov: 75 },
lookYawMax: 100,
lookPitchMax: 70,
engineArmDistance: 0,
```

**airbus_a320:**
```javascript
engineAudio: 'jet',
hasAfterburner: false,
cockpitOffset: { y: 2.8, z: -2.5, fov: 65 },
lookYawMax: 70,
lookPitchMax: 50,
engineArmDistance: 6,  // inner engines; outer at 12m handled in flightModel
```

**dhc2_beaver:**
```javascript
engineAudio: 'piston',
hasAfterburner: false,
cockpitOffset: { y: 1.0, z: -0.4, fov: 72 },
lookYawMax: 85,
lookPitchMax: 60,
engineArmDistance: 0,
```

- [ ] **Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/aircraftTypes.js
git commit -m "feat: add audio and cockpit config to aircraft types"
```

---

## Task 5: Engine Audio Synthesis

**Files:**
- Create: `src/engineAudio.js`

Three distinct procedural synthesis models with per-engine independence.

- [ ] **Step 1: Implement engineAudio.js**

Create `src/engineAudio.js` — exports:
- `createEngineAudio(audioCtx, masterGain, type, engineCount, hasAfterburner)` — creates oscillator stacks, returns engine audio controller object
- `updateEngineAudio(controller, engines, throttle, dt)` — updates frequencies/gains based on engine state (N1, N2, running)
- `switchEngineAudio(audioCtx, masterGain, newType, newCount, hasAfterburner)` — crossfades to new engine type over 0.3s
- `disposeEngineAudio(controller)` — disconnect and release all nodes

**Piston model:**
```javascript
function createPistonStack(ctx, output) {
  const fundamental = ctx.createOscillator();
  fundamental.type = 'triangle';
  fundamental.frequency.value = 45;

  const harmonic2 = ctx.createOscillator();
  harmonic2.type = 'sawtooth';
  harmonic2.frequency.value = 90;

  const harmonic3 = ctx.createOscillator();
  harmonic3.type = 'sine';
  harmonic3.frequency.value = 135;

  const gain1 = ctx.createGain(); gain1.gain.value = 0.3;
  const gain2 = ctx.createGain(); gain2.gain.value = 0.12;
  const gain3 = ctx.createGain(); gain3.gain.value = 0.05;

  fundamental.connect(gain1).connect(output);
  harmonic2.connect(gain2).connect(output);
  harmonic3.connect(gain3).connect(output);

  fundamental.start(); harmonic2.start(); harmonic3.start();

  return {
    type: 'piston',
    update(n1, throttle) {
      const rpm = n1 / 100;
      const freq = 45 + rpm * 45;
      fundamental.frequency.value = freq;
      harmonic2.frequency.value = freq * 2;
      harmonic3.frequency.value = freq * 3;
      gain1.gain.value = 0.15 + throttle * 0.15;
    },
    dispose() {
      fundamental.stop(); harmonic2.stop(); harmonic3.stop();
      fundamental.disconnect(); harmonic2.disconnect(); harmonic3.disconnect();
    },
  };
}
```

**Jet model:**
```javascript
function createJetStack(ctx, output, hasAfterburner) {
  const noiseBuffer = createNoiseBuffer(ctx, 2);

  // Core roar: bandpass-filtered noise
  const coreSource = ctx.createBufferSource();
  coreSource.buffer = noiseBuffer; coreSource.loop = true;
  const coreBP = ctx.createBiquadFilter();
  coreBP.type = 'bandpass'; coreBP.frequency.value = 400; coreBP.Q.value = 1.5;
  const coreGain = ctx.createGain(); coreGain.gain.value = 0.2;

  // Fan whine: sine oscillator
  const fanOsc = ctx.createOscillator();
  fanOsc.type = 'sine'; fanOsc.frequency.value = 600;
  const fanGain = ctx.createGain(); fanGain.gain.value = 0.08;

  // Bypass rush: low-pass noise
  const bypassSource = ctx.createBufferSource();
  bypassSource.buffer = noiseBuffer; bypassSource.loop = true;
  const bypassLP = ctx.createBiquadFilter();
  bypassLP.type = 'lowpass'; bypassLP.frequency.value = 400;
  const bypassGain = ctx.createGain(); bypassGain.gain.value = 0.05;

  coreSource.connect(coreBP).connect(coreGain).connect(output);
  fanOsc.connect(fanGain).connect(output);
  bypassSource.connect(bypassLP).connect(bypassGain).connect(output);
  coreSource.start(); fanOsc.start(); bypassSource.start();

  // Afterburner (optional)
  let abSource, abLP, abGain;
  if (hasAfterburner) {
    abSource = ctx.createBufferSource();
    abSource.buffer = noiseBuffer; abSource.loop = true;
    abLP = ctx.createBiquadFilter();
    abLP.type = 'lowpass'; abLP.frequency.value = 80;
    abGain = ctx.createGain(); abGain.gain.value = 0;
    abSource.connect(abLP).connect(abGain).connect(output);
    abSource.start();
  }

  return {
    type: 'jet',
    update(n1, n2, throttle) {
      coreBP.frequency.value = 200 + (n2 / 100) * 800;
      coreGain.gain.value = 0.1 + (n2 / 100) * 0.15;
      fanOsc.frequency.value = 400 + (n1 / 100) * 2000;
      fanGain.gain.value = (n1 / 100) * 0.12;
      bypassGain.gain.value = throttle * 0.08;
      if (hasAfterburner && abGain) {
        const abTarget = throttle > 0.9 ? 0.3 : 0;
        abGain.gain.value += (abTarget - abGain.gain.value) * 0.05;
      }
    },
    dispose() { /* stop and disconnect all */ },
  };
}
```

**Turboprop model:** Similar structure with prop wash noise + turbine whine sine. Built but may not have active consumers yet.

**Per-engine independence:**
```javascript
export function createEngineAudio(ctx, masterGain, type, engineCount, hasAfterburner) {
  const stacks = [];
  for (let i = 0; i < engineCount; i++) {
    const engineGain = ctx.createGain();
    engineGain.connect(masterGain);
    const stack = type === 'piston' ? createPistonStack(ctx, engineGain)
                : type === 'turboprop' ? createTurbopropStack(ctx, engineGain)
                : createJetStack(ctx, engineGain, hasAfterburner);
    stacks.push({ stack, gain: engineGain });
  }
  return { stacks, type };
}
```

**Aircraft switch crossfade:**
```javascript
export function switchEngineAudio(ctx, masterGain, newType, newCount, hasAfterburner) {
  // Fade out current over 0.3s, then dispose
  // Create new stacks, fade in over 0.3s
}
```

- [ ] **Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/engineAudio.js
git commit -m "feat: per-aircraft engine audio synthesis (piston, turboprop, jet)"
```

---

## Task 6: Effects Audio

**Files:**
- Create: `src/effectsAudio.js`

Procedural one-shot sound effects and camera-aware mixing.

- [ ] **Step 1: Implement effectsAudio.js**

Create `src/effectsAudio.js` — exports:
- `initEffectsAudio(audioCtx, masterGain)` — create reusable nodes
- `updateEffectsAudio(state, dt, cameraMode)` — update wind rush, stall buffet rumble, cockpit ambiance
- `playWheelSqueal(intensity)` — bandpass noise burst 0.3s
- `playGearMotor()` — sine sweep 200→400Hz over 2s
- `playFlapMotor()` — sine 150Hz + noise, 1.5s
- `playTouchThump()` — single 50Hz cycle, 0.1s
- `playStallBuffet(intensity)` — low-freq rumble 15-25Hz
- `updateDoppler(aiAircraftList, playerPos)` — pitch shift for nearest AI
- `setCameraMode(mode)` — toggle cockpit ambiance on/off

Key implementation:
- **Wind rush:** `gain = max(0, (IAS - 10) / 200)²`, highpass cutoff drops with speed
- **Cockpit ambiance:** 60Hz hum + filtered noise, only in cockpit view, 0.3s fade on switch
- **Doppler:** find nearest AI within 500m, compute `pitchShift = 1 / (1 - relVel/343)`, apply to a dedicated oscillator

- [ ] **Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/effectsAudio.js
git commit -m "feat: procedural effects audio with Doppler, wind rush, cockpit ambiance"
```

---

## Task 7: Audio Integration

**Files:**
- Modify: `src/audio.js`

Replace generic engine oscillators with per-type engine audio. Wire effects.

- [ ] **Step 1: Add imports**

At top of `src/audio.js`:
```javascript
import { createEngineAudio, updateEngineAudio, switchEngineAudio, disposeEngineAudio } from './engineAudio.js';
import { initEffectsAudio, updateEffectsAudio, setCameraMode as setAudioCameraMode } from './effectsAudio.js';
import { getAircraftType } from './aircraftTypes.js';
```

- [ ] **Step 2: Replace engine oscillator setup**

In `initAudio()`, after creating masterGain, replace the existing 3 sine/triangle oscillators (the `engineOscs` array setup) with:
```javascript
// Get current aircraft config
const acType = getAircraftType(state?.aircraftType);
engineController = createEngineAudio(ctx, engineGain, acType.engineAudio || 'piston', acType.engineCount || 1, acType.hasAfterburner || false);

// Effects audio
initEffectsAudio(ctx, masterGain);
```

Keep `engineGain` node as the sub-master for engine audio.

- [ ] **Step 3: Update the updateAudio function**

In `updateAudio(state, dt, cameraMode)`:
- Replace frequency/gain updates on old oscillators with `updateEngineAudio(engineController, state, dt)`
- Add `updateEffectsAudio(state, dt, cameraMode)` call
- Add `setAudioCameraMode(cameraMode)` call
- Remove the old `cockpitHumOsc` code (now in effectsAudio)
- Fix wind rush: replace linear scaling with quadratic `max(0, (speed - 10) / 200)²`

- [ ] **Step 4: Add aircraft switch handler**

Export a new function from audio.js:
```javascript
export function onAircraftSwitch(newType) {
  if (!initialized || !ctx) return;
  const cfg = getAircraftType(newType);
  engineController = switchEngineAudio(ctx, engineGain, cfg.engineAudio || 'piston', cfg.engineCount || 1, cfg.hasAfterburner || false);
}
```

Wire this in main.js where aircraft selection happens.

- [ ] **Step 5: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/audio.js
git commit -m "feat: wire per-aircraft engine audio and effects into audio system"
```

---

## Task 8: Camera Effects

**Files:**
- Create: `src/cameraEffects.js`
- Modify: `src/postprocessing.js`

G-vignette, FOV compression, blackout, screen shake.

- [ ] **Step 1: Add vignette ShaderPass to postprocessing.js**

In `src/postprocessing.js`, after the existing passes and before OutputPass:
```javascript
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const vignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignetteIntensity: { value: 0 },
    vignetteColor: { value: new THREE.Vector3(0, 0, 0) },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignetteIntensity;
    uniform vec3 vignetteColor;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float vignette = smoothstep(0.3, 0.8, dist) * vignetteIntensity;
      gl_FragColor = vec4(mix(texel.rgb, vignetteColor, vignette), texel.a);
    }
  `,
};
let vignettePass = null;
// Insert before OutputPass in initPostProcessing
```

Export:
```javascript
export function setVignetteUniforms(intensity, colorR, colorG, colorB) {
  if (!vignettePass) return;
  vignettePass.uniforms.vignetteIntensity.value = intensity;
  vignettePass.uniforms.vignetteColor.value.set(colorR, colorG, colorB);
}
```

- [ ] **Step 2: Implement cameraEffects.js**

Create `src/cameraEffects.js` — exports:
- `initCameraEffects()` — initialize state
- `updateCameraEffects(dt, gOnset, speed, stallState, realism, camera)` — returns `{ fov, shakeOffset: {x,y,z}, blackoutActive }`
- `triggerLandingShakeEffect(intensity)` — impulse
- `triggerTurbulenceShake(intensity)` — sustained

Implementation:
- **FOV:** `targetFOV = baseFOV - clamp((speed-80)/170, 0, 1) * 10`, lerp 2s
- **Vignette:** call `setVignetteUniforms()` based on G-onset vs realism thresholds
- **Blackout:** when gOnset > threshold for 1s: fade to black over 1s, disable controls 3s, fade back 2s
- **Shake:** sine combinations (no Perlin), position-only, amplitudes per spec:
  - Stall: ±0.03m at 8Hz
  - Landing: ±0.04m impulse, exp decay τ=0.15s
  - Turbulence: ±0.02m, exp decay
  - High G: ±0.01m
- All scaled by `realism.cameraShakeScale * getSetting('cameraShakeScale')`

- [ ] **Step 3: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/cameraEffects.js src/postprocessing.js
git commit -m "feat: camera effects with G-vignette, FOV compression, screen shake"
```

---

## Task 9: API Additions (missiles.js + aircraftAI.js)

**Files:**
- Modify: `src/missiles.js`
- Modify: `src/aircraftAI.js`

Add exports needed by camera and audio systems.

- [ ] **Step 1: Add missile state exports**

Read `src/missiles.js` to find the missile pool/state structure. Add:
```javascript
export function isMissileActive() {
  return missiles.some(m => m.active);
}

export function getActiveMissileState() {
  const m = missiles.find(m => m.active);
  if (!m) return null;
  return { position: m.mesh.position.clone(), velocity: m.velocity.clone() };
}
```

- [ ] **Step 2: Add AI aircraft list export**

Read `src/aircraftAI.js` to find the AI planes array. Add:
```javascript
export function getAIAircraftList() {
  return aiPlanes.filter(p => p.active).map(p => ({
    position: p.mesh.position.clone(),
    velocity: p.velocity ? p.velocity.clone() : new THREE.Vector3(),
    type: p.type || 'unknown',
  }));
}
```

- [ ] **Step 3: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/missiles.js src/aircraftAI.js
git commit -m "feat: add missile state and AI aircraft list exports for camera/audio"
```

---

## Task 10: Camera System Overhaul

**Files:**
- Modify: `src/camera.js`

Mode registry, terrain collision, per-aircraft cockpit offsets, 5 new modes.

- [ ] **Step 1: Read current camera.js thoroughly**

Understand: mode switching (toggleCamera), chase/cockpit/orbit update functions, transition system, shake system.

- [ ] **Step 2: Add imports**

```javascript
import { getGroundLevel } from './terrain.js';
import { isMissileActive, getActiveMissileState } from './missiles.js';
import { getAIAircraftList } from './aircraftAI.js';
import { updateCameraEffects, triggerLandingShakeEffect } from './cameraEffects.js';
import { getRealism } from './realism.js';
```

- [ ] **Step 3: Per-aircraft cockpit offsets**

In the cockpit update section, replace hardcoded `COCKPIT_OFFSET_Y/Z`:
```javascript
const acfg = getAircraftType(av.aircraftType);
const cockpitY = acfg.cockpitOffset?.y ?? COCKPIT_OFFSET_Y;
const cockpitZ = acfg.cockpitOffset?.z ?? COCKPIT_OFFSET_Z;
const cockpitFOV = acfg.cockpitOffset?.fov ?? 65;
const maxYaw = THREE.MathUtils.degToRad(acfg.lookYawMax ?? 100);
const maxPitch = THREE.MathUtils.degToRad(acfg.lookPitchMax ?? 60);
```

- [ ] **Step 4: Chase cam terrain collision**

In the chase cam update, after computing camera position:
```javascript
const groundY = getGroundLevel(camera.position.x, camera.position.z);
const minCamY = groundY + 3;
if (camera.position.y < minCamY) {
  camera.position.y = lerp(camera.position.y, minCamY, 0.15);
}
```

- [ ] **Step 5: Remove orbit auto-return**

Remove or comment out the `orbitReturnTimer` countdown logic.

- [ ] **Step 6: Add mode registry and new modes**

Add mode implementations:
- `updateTower(dt, av)` — position at nearest airport, track aircraft
- `updateFlyby(dt, av)` — fixed position, jump ahead when passed
- `updatePadlock(dt, av)` — cockpit position, track nearest AI
- `updateTail(dt, av)` — behind/above tail, look forward
- `updateWeapon(dt)` — missile position, look along velocity

Add F-key handling in the key event listener to switch modes.

- [ ] **Step 7: Wire camera effects into updateCamera**

At end of `updateCamera(dt)`:
```javascript
const av = getActiveVehicle();
if (isAircraft(av)) {
  const effects = updateCameraEffects(dt, av.gOnset || 1, av.speed, av.stallState || 0, getRealism(), camera);
  if (effects.shakeOffset) {
    camera.position.x += effects.shakeOffset.x;
    camera.position.y += effects.shakeOffset.y;
    camera.position.z += effects.shakeOffset.z;
  }
  if (effects.fov && mode !== 'orbit') {
    camera.fov = effects.fov;
    camera.updateProjectionMatrix();
  }
}
```

- [ ] **Step 8: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 9: Commit**

```bash
git add src/camera.js
git commit -m "feat: camera overhaul with 5 new modes, terrain collision, per-aircraft cockpit"
```

---

## Task 11: Controls — F-Key Bindings

**Files:**
- Modify: `src/controls.js`

- [ ] **Step 1: Add F-keys to SIM_KEYS**

Find the `SIM_KEYS` set and add:
```javascript
'f1', 'f2', 'f3', 'f4', 'f5'
```

- [ ] **Step 2: Add camera mode key handlers**

In the keydown handler, add:
```javascript
if (key === 'f1') setCameraMode('tower');
if (key === 'f2') setCameraMode('flyby');
if (key === 'f3') setCameraMode('padlock');
if (key === 'f4') setCameraMode('tail');
if (key === 'f5') setCameraMode('weapon');
```

Import `setCameraMode` from camera.js (may need to export it).

- [ ] **Step 3: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/controls.js
git commit -m "feat: add F1-F5 camera mode key bindings"
```

---

## Task 12: Final Wiring & Verification

**Files:**
- Modify: `src/main.js` (minor)

- [ ] **Step 1: Wire audio aircraft switch**

In main.js where aircraft selection happens (onGameStart or the aircraft select callback), add:
```javascript
import { onAircraftSwitch } from './audio.js';
// After aircraft type changes:
onAircraftSwitch(newAircraftType);
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```
All tests must pass.

- [ ] **Step 3: Run full build**

```bash
npx vite build 2>&1 | tail -5
```
Must succeed.

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```
Verify:
- [ ] Piston aircraft (Cessna) sounds different from jet (737)
- [ ] Stall has buffet → wing drop → spin progression
- [ ] G-force vignette appears during hard turns
- [ ] Chase cam doesn't clip through terrain
- [ ] F1-F5 camera modes work
- [ ] Tower view tracks aircraft from airport
- [ ] Cockpit ambiance muted in exterior views
- [ ] FOV compresses at high speed
- [ ] Screen shake is gentle, not jarring

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: wire audio aircraft switch and finalize flight feel integration"
```

---

## Task Dependencies

```
Task 1 (realism)     ─┐
Task 4 (aircraftTypes)─┤
                       ├─→ Task 2 (flightModel) ─→ Task 3 (physics integration)
                       ├─→ Task 5 (engineAudio) ─┐
                       ├─→ Task 6 (effectsAudio)─┼─→ Task 7 (audio integration)
                       ├─→ Task 8 (cameraEffects + postprocessing)
                       └─→ Task 9 (missile/AI API)
                            ├─→ Task 10 (camera overhaul)
                            └─→ Task 11 (controls F-keys)
                                 └─→ Task 12 (final wiring)
```

Tasks 1, 4, 9 are independent and can be parallelized.
Tasks 2, 5, 6, 8 are independent of each other (after 1+4) and can be parallelized.
Tasks 3, 7, 10, 11, 12 are sequential.

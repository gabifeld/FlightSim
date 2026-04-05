# Sub-Project B: Flight Feel — Design Spec

## Overview

Make flying itself feel incredible through advanced physics, distinct per-aircraft audio, and a polished camera system with visual stress effects. Adaptive realism lets players choose between forgiving sim-lite and demanding study-level flight.

## Goals

1. Progressive stall/spin dynamics, engine-out asymmetric thrust, G-force model with visual effects
2. Three distinct procedural engine synthesis models (piston, turboprop, jet) with per-engine independence
3. Polish existing 3 camera modes + add 5 new modes (tower, flyby, padlock, tail, weapon)
4. Adaptive realism setting (sim-lite vs study-level) sharing the same physics engine
5. All effects smooth and gradual — nothing jarring

## Non-Goals

- External audio files (stay fully procedural)
- Full CFD simulation (we're approximating, not simulating every airfoil point)
- VR camera support
- Multiplayer spectator cameras

---

## 1. Advanced Flight Model (`src/flightModel.js`)

### Stall & Spin Dynamics

**State machine:**
```
normal → buffet → stall → incipient_spin → developed_spin
```

**Buffet onset:** 2-3 degrees AOA before critical stall angle. Random pitch (±0.01 rad) and roll (±0.02 rad) perturbations at 8Hz. Amplitude increases as AOA approaches stall. Serves as a natural warning.

**Stall:** Full lift collapse (existing behavior preserved). Additionally: asymmetric wing drop — one wing stalls before the other, creating a roll moment (±0.3 rad/s) and coupled yaw. Which wing drops first is seeded from aircraft state (slight randomness per stall event).

**Incipient spin:** If pro-spin inputs held for > 1s after stall (full back stick + rudder in roll direction), transition to autorotation. Pitch locked nose-down (~30° below horizon), roll rate increases to 1.5 rad/s, altitude loss ~300 ft/turn.

**Developed spin:** Sustained autorotation. Aircraft descends in corkscrew. Only correct recovery procedure exits:
1. Throttle idle
2. Opposite rudder (against spin direction)
3. Forward stick (break AOA)
4. Level wings after rotation stops

**Sim-lite behavior:** Auto-recovery after 3s in spin. Buffet and stall exist but spin is short and self-correcting. Wing drop reduced to ±0.15 rad/s.

**Study behavior:** Manual recovery required. Incorrect inputs deepen the spin. No auto-recovery. Full wing drop intensity.

### Engine-Out Asymmetric Thrust

For multi-engine aircraft (737: 2 engines, A340: 4 engines):

**Yaw moment:** When an engine fails, apply continuous yaw torque:
```
yawMoment = thrustPerEngine × engineArmDistance × (1 / yawInertia)
```
- 737 engine arm: ~5m from centerline
- A340 inner engine: ~6m, outer: ~12m
- Outer engine failure creates stronger yaw (longer arm)

**Minimum control speed (Vmc):** Below this speed, rudder authority cannot counteract asymmetric thrust. Aircraft yaws uncontrollably.
- Sim-lite: Vmc = 0 (always controllable)
- Study: Vmc computed from rudder authority vs yaw moment. Typically ~60-80 kt for twins.

**Pilot workload:** Maintaining heading with one engine requires constant rudder input + rudder trim. Untrimmed, the aircraft slowly yaws toward the dead engine.

### G-Force Model

**G-force computation:** Already tracked in the codebase (`av.gForce`). Extend with sustained G onset model:
```javascript
// Sustained G tracking for physiological effects
// Note: gForce in this codebase is absolute (1.0 = level flight, 0 = freefall)
// Physiological effects key off deviation from 1G baseline
gOnset += (instantG - gOnset) * (1 - Math.exp(-dt / G_ONSET_RATE));
// G_ONSET_RATE = 1.5s (takes time to feel sustained G)

// For vignette/blackout thresholds: compare gOnset directly (thresholds are absolute G)
// Positive G effects: gOnset > 4.5 (study) = pulling 4.5G
// Negative G effects: gOnset < -0.5 (study) = pushing negative G beyond -0.5G
```

**Thresholds:**

| Condition | Sim-lite | Study |
|-----------|----------|-------|
| HUD G indicator | Always | Always |
| Screen shake onset | 5G | 4G |
| Peripheral dim (vignette) | 7G | 4.5G |
| Tunnel vision | 9G | 6G |
| Gray-out | 11G | 7.5G |
| Blackout (controls disabled 3s) | Never | 9G |
| Structural failure (crash) | 15G | 9G sustained 2s |
| Red-out (negative G) | -4G | -2.5G |

**Onset/offset rates:** All effects lerp over 1.5s onset, 1.0s offset. Never instant. Smooth transitions always.

### Density Altitude

**Density ratio (ISA barometric formula):**
```javascript
// ISA standard atmosphere approximation
const altitudeMeters = altitude; // already in meters in the codebase
const densityRatio = Math.max(0.1, Math.pow(1 - 0.0000226 * altitudeMeters, 4.256));
// At sea level: 1.0, at 3000m: ~0.74, at 6000m: ~0.53, at 12000m: ~0.26
```

**Thrust reduction:**
```javascript
effectiveThrust = maxThrust * densityRatio * throttle;
```

**Dynamic pressure correction:** `physics.js` currently uses hardcoded `AIR_DENSITY = 1.225`. This must be replaced with:
```javascript
const effectiveDensity = AIR_DENSITY * densityRatio;
const dynamicPressure = 0.5 * effectiveDensity * TAS * TAS;
```
This affects both lift AND drag, so aircraft performance naturally degrades at altitude.

**IAS vs TAS:** `TAS = IAS / Math.sqrt(densityRatio)`. Lift computed from TAS × density gives same indicated behavior but true performance divergence at altitude.

**Impact:** Aircraft needs higher TAS for same lift at altitude. Takeoff rolls longer at high-altitude airports. Service ceiling naturally emerges where thrust = drag.

### Crosswind Ground Handling

**Weathervane effect:** On ground, crosswind creates yaw moment toward wind:
```javascript
if (onGround && crosswindComponent > 0) {
  weathervaneYaw = crosswindComponent * WEATHERVANE_FACTOR * dt;
  // WEATHERVANE_FACTOR tuned per aircraft (larger tail = more weathervane)
}
```

**Crab angle on approach:** In air, aircraft crabs into wind naturally (existing wind model handles this). The visual improvement: HUD shows crab angle, and on flare the pilot must kick straight with rudder.

**Differential braking:** At low speed on ground, rudder alone may not hold heading in strong crosswind. Differential braking (already exists in carPhysics) extended to aircraft ground handling.

---

## 2. Adaptive Realism (`src/realism.js`)

Tiny module — just configuration and a getter.

```javascript
const PROFILES = {
  lite: {
    spinAutoRecovery: true,
    spinRecoveryTime: 3.0,        // seconds
    wingDropIntensity: 0.5,       // multiplier
    vmcEnabled: false,
    gLimitStructural: 15,
    gBlackoutThreshold: Infinity, // never
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
```

Stored in `settings.js` as `realism` setting. Default: `'lite'`.

Export: `getRealism()` returns the current profile object. All physics and effects modules query this.

---

## 3. Per-Aircraft Engine Audio (`src/engineAudio.js`)

### Three Synthesis Models

**Piston engine** (cessna_172, dhc2_beaver):
```
Oscillators:
  - Fundamental: triangle wave, freq = 45 + (RPM/maxRPM) * 45 Hz
  - 2nd harmonic: sawtooth, freq = fundamental × 2, gain = 0.4
  - 3rd harmonic: sine, freq = fundamental × 3, gain = 0.15

Exhaust pulse modulation:
  - Amplitude envelope at cylinder firing rate: (RPM × cylinders / 2) / 60 Hz
  - Creates rhythmic "chug" at low RPM, smooth at high RPM

Character: rough, mechanical, warm
```

**Turboprop** (no current aircraft — built for future types, e.g., Dash 8):
```
Oscillators:
  - Prop wash: white noise → bandpass filter centered at 100 + (N1/100) * 200 Hz, Q=2
  - Turbine whine: sine at 120 + (N1/100) * 400 Hz, gain = 0.3
  - High-freq hiss: white noise → highpass 2000Hz, gain = N2/100 * 0.1

Beta range (ground, reverse):
  - Prop frequency drops below idle pitch
  - Distinctive "whomp" sound when transitioning through flat pitch

Character: smooth drone with rising whine
```

**Jet engine** (boeing_737, airbus_a320, f16):
```
Oscillators:
  - Core roar: white noise → bandpass at 200 + (N2/100) * 800 Hz, Q=1.5
  - Fan whine: sine at 400 + (N1/100) * 2000 Hz, gain = 0.25
  - Bypass rush: white noise → lowpass at 400Hz, gain = thrust * 0.3

Afterburner (F-16, SR-71 when throttle > 0.9):
  - Add: white noise → lowpass 80Hz, gain = 0.6 (deep rumble)
  - Boost overall gain × 2.0
  - 0.5s onset ramp when afterburner lights

Character: whisper at idle → roar at full power → thunder with AB
```

### Per-Engine Independence

Each engine gets its own oscillator stack instance. For a 737 (2 engines):
- Engine 1 left: full piston/turboprop/jet stack
- Engine 2 right: full stack, independent gain/frequency

When an engine fails, its stack spools down over 3s (frequency drops, gain fades). Creates audible asymmetry — you can hear which engine died.

### Engine Type Assignment

Read from `aircraftTypes.js` config. Add `engineAudio` field per existing aircraft type:
```javascript
cessna_172:  { engineAudio: 'piston', engineCount: 1 },
dhc2_beaver: { engineAudio: 'piston', engineCount: 1 },
boeing_737:  { engineAudio: 'jet',    engineCount: 2 },
airbus_a320: { engineAudio: 'jet',    engineCount: 4 },  // Note: key is a320 but config describes A340
f16:         { engineAudio: 'jet',    engineCount: 1, hasAfterburner: true },
```

Note: The turboprop synthesis model is built but has no consumer among current aircraft types. It will be used when turboprop aircraft are added in future. The `airbus_a320` type key describes an A340 in the codebase (4 engines, 65000kg mass) — we use the key as-is to avoid breaking changes, but engine arm distances for engine-out yaw match A340 geometry.

---

## 4. Effects Audio (`src/effectsAudio.js`)

### Procedural One-Shot Effects

**Wheel squeal:**
- Trigger: touchdown with vertical speed > 1 m/s
- Synthesis: bandpass-filtered noise burst, center freq 800-2000Hz (random), duration 0.3s
- Amplitude: proportional to `Math.min(verticalSpeed / 3, 1.0)` — harder landing = louder squeal

**Gear motor:**
- Trigger: gear extend/retract command
- Synthesis: sine sweep 200→400Hz over 2s + bandpass noise at 300Hz (grinding character)
- Plays for full duration regardless of other inputs

**Flap motor:**
- Trigger: flap setting change
- Synthesis: sine at 150Hz + low-pass noise, 1.5s duration
- Quieter than gear motor (0.3 gain vs 0.5)

**Wind rush (improved):**
- Current: always audible. New: silent below 10 m/s IAS
- Scaling: `gain = Math.max(0, (IAS - 10) / 200)²` — quadratic, so rapid increase at speed
- Filter: existing high-pass, but cutoff frequency drops with speed (more low-freq content at high speed = deeper rush)

**Stall buffet rumble:**
- Trigger: AOA within 3° of stall angle
- Synthesis: low-frequency noise (15-25Hz bandpass), amplitude = `(AOA - buffetOnset) / (stallAOA - buffetOnset)`
- Builds gradually, peaks at stall, drops if AOA reduced
- Mixes with visual buffet for multi-sensory stall warning

**Doppler flyby (AI aircraft):**
- For each AI aircraft within 500m of player
- Compute relative velocity along line-of-sight
- Apply pitch shift: `playbackRate = 1 / (1 - relVel / 343)` (speed of sound = 343 m/s)
- Only one AI aircraft Doppler active at a time (nearest)
- Use separate oscillator stack for the AI aircraft's engine type at reduced fidelity (1 oscillator, not full stack)

**Cockpit ambiance:**
- Existing 60Hz hum + filtered noise
- NEW: Only plays in cockpit camera mode. Muted when switching to chase/orbit/tower/etc.
- Fade over 0.3s on camera switch (not instant cut)

**Touch-and-go thump:**
- Trigger: any touchdown event
- Synthesis: single cycle of 50Hz sine wave, 0.1s duration, sharp attack, fast decay
- Subtle but adds physical impact feeling

### Camera-Aware Mixing

`effectsAudio.js` receives current camera mode each frame:
- **Cockpit:** engine volume × 0.6 (muffled by fuselage), cockpit ambiance ON, full effects
- **Exterior (chase/orbit/tower/flyby/tail):** engine volume × 1.0, cockpit ambiance OFF, Doppler active for AI
- **Weapon cam:** missile engine sound (simple sine + noise), player engine attenuated

---

## 5. Camera Modes & Effects

### Existing Mode Fixes

**Chase cam:**
- Terrain collision: each frame, sample `getGroundLevel(camX, camZ)`. If camera Y < groundY + 3m, push camera up to groundY + 3m. Smooth the push with lerp (no sudden jump).
- Speed-adaptive spring: `springStiffness = lerp(4, 8, speed / 200)`. Stiffer at speed = less lag.
- Partial roll compensation: camera rolls at 50% of aircraft roll. `camRoll = aircraftRoll * 0.5`. Keeps horizon more stable.

**Cockpit cam:**
- Per-aircraft offset: read `cockpitOffset: { y, z, fov }` from aircraftTypes.js config:
  - Cessna: `{ y: 1.2, z: -0.5, fov: 70 }` (low, close to panel)
  - 737: `{ y: 2.5, z: -2.0, fov: 65 }` (high, set back)
  - F-16: `{ y: 1.5, z: -0.3, fov: 75 }` (bubble canopy, wide FOV)
- Look limits from config: `lookYawMax`, `lookPitchMax` per type
- Near-clip transition: lerp near clip plane from 0.5 to 0.1 over 0.2s when entering cockpit (prevents pop)

**Orbit cam:**
- Remove 2s auto-return timer. Orbit stays until user presses another mode key.
- Add scroll-wheel zoom: distance range 5m to 200m from aircraft

### New Modes

**Tower view (key: F1):**
```
Position: nearest airport tower within 5km
  - Use airport positions from airportData.js (via getNearestAirport() helper)
  - Tower height: 20m above airport elevation
Tracking: smooth lerp toward aircraft position (lerpFactor = 2 * dt)
Fallback: if no airport within 5km, fall back to chase cam
FOV: 50° (telephoto feel for distant aircraft)
```

**Flyby cam (key: F2):**
```
Position: 50-200m perpendicular to flight path, 500m ahead of aircraft
  - Perpendicular direction alternates left/right each jump
  - Height: aircraft altitude - 10m (looking slightly up = dramatic)
Behavior: camera stays fixed while aircraft flies past
  - When aircraft passes camera, jump 500m ahead on projected path
  - Smooth jump transition over 0.5s
Tracking: always looks at aircraft with slight lead
FOV: 45° (cinematic compression)
```

**Padlock view (key: F3):**
```
Position: player aircraft cockpit position
Tracking: rotates to keep nearest AI aircraft centered
Target selection: nearest AI aircraft within 3km (via getNearestAI() helper)
  - If no target, show "NO TARGET" on HUD, fall back to cockpit forward view
  - If target exceeds 3km, break lock, revert to cockpit
Visual: target diamond overlay at tracked position
```

**Tail cam (key: F4):**
```
Position: aircraft position + offset (0, +3, +8) in aircraft local space
  - Sits behind and above the tail
Looking at: point 20m ahead of aircraft nose
Character: stable platform showing runway during approach
No roll compensation: follows aircraft roll fully (you're "on" the aircraft)
```

**Weapon cam (key: F5):**
```
Activation: only when a missile is in flight (check missiles.js state via isMissileActive())
Position: missile position (via getActiveMissileState())
Looking along: missile velocity vector
FOV: 60° (wide for tracking)
When missile expires/hits: auto-revert to previous camera mode
If no missile active: key press ignored
```

**Key binding rationale:** Number keys 1-5 are already used for aircraft selection in controls.js. F-keys avoid all conflicts (Shift = throttle, Ctrl = engine starts). F-keys must be added to `SIM_KEYS` set in controls.js with `preventDefault` to block browser defaults.

### Required API Additions

New exports needed from existing modules to support camera modes:

**missiles.js** — add:
- `isMissileActive()` — returns boolean, true if any missile is in flight
- `getActiveMissileState()` — returns `{ position: Vector3, velocity: Vector3 }` or null

**aircraftAI.js** — add:
- `getAIAircraftList()` — returns array of `{ position: Vector3, velocity: Vector3, type: string }` for all active AI aircraft

**airportData.js** (or new helper in camera.js):
- `getNearestAirport(x, z, maxDist)` — returns nearest airport position within maxDist, or null. Uses existing AIRPORTS array.
- `getNearestAI(x, z, maxDist)` — uses `getAIAircraftList()` to find nearest AI within range

### Mode Registry

```javascript
const MODES = {
  chase:   { key: 'v',  update: updateChase, available: () => true },
  cockpit: { key: 'v',  update: updateCockpit, available: () => true },
  orbit:   { key: 'v',  update: updateOrbit, available: () => true },
  tower:   { key: 'f1', update: updateTower, available: () => getNearestAirport(5000) !== null },
  flyby:   { key: 'f2', update: updateFlyby, available: () => true },
  padlock: { key: 'f3', update: updatePadlock, available: () => getNearestAI(3000) !== null },
  tail:    { key: 'f4', update: updateTail, available: () => true },
  weapon:  { key: 'f5', update: updateWeapon, available: () => isMissileActive() },
};
```

Note: Chase/cockpit/orbit cycle via `v` key (existing behavior preserved). New modes are direct-access via F-keys. All mode switches are smooth (0.3s position lerp transition).

### Camera Effects (`src/cameraEffects.js`)

**FOV compression:**
```javascript
const speedFactor = clamp((speed - 80) / 170, 0, 1); // 0 at 80 m/s, 1 at 250 m/s
targetFOV = baseFOV - speedFactor * 10; // 65° → 55°
currentFOV = lerp(currentFOV, targetFOV, 1 - Math.exp(-dt / 2)); // 2s lerp
```

**G-force vignette:**
- New ShaderPass added to the EffectComposer, inserted immediately before OutputPass (after SMAA — vignette doesn't need AA)
- Uniform: `vignetteIntensity` (0 = none, 1 = full tunnel vision)
- Uniform: `vignetteColor` (vec3: black for positive G, red for negative G)
- Computation:
```javascript
const realism = getRealism();
const gAbs = Math.abs(gOnset);
if (gOnset > 0) {
  vignetteIntensity = clamp((gAbs - realism.gVignetteOnset) / (realism.gTunnelVision - realism.gVignetteOnset), 0, 1);
  vignetteColor = [0, 0, 0]; // black
} else {
  vignetteIntensity = clamp((-gOnset - Math.abs(realism.gRedoutThreshold)) / 2, 0, 1);
  vignetteColor = [0.8, 0, 0]; // red
}
```
- Onset: 1.5s lerp. Offset: 1.0s lerp. Never instant.

**Blackout (study mode only):**
- When `gOnset > realism.gBlackoutThreshold` for > 1s continuous:
  - Screen fades to black over 1s
  - Controls disabled for 3s
  - Then 2s fade back in
  - Total recovery: 6s
- Global `blackoutActive` flag prevents other camera switches during blackout

**Screen shake:**
- Global scale: `CAMERA_SHAKE_SCALE` multiplier (default 1.0, user-adjustable in settings)
- Per-source amplitudes (already multiplied by realism.cameraShakeScale):
  - Stall buffet: ±0.03m at 8Hz, onset proportional to stall proximity
  - Hard landing: single impulse ±0.04m, exponential decay τ=0.15s
  - Turbulence: ±0.02m, smoothed through exponential decay
  - High G (>4G): ±0.01m vibration
- Implementation: pseudo-random noise via sine combinations (matching existing camera.js shake pattern, no external dependency)
- Applied as position offset to camera, NOT rotation (rotation shake is nausea-inducing)

**Vignette shader (GLSL):**
```glsl
uniform float vignetteIntensity;
uniform vec3 vignetteColor;

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec2 center = vUv - 0.5;
  float dist = length(center);
  float vignette = smoothstep(0.3, 0.8, dist) * vignetteIntensity;
  gl_FragColor = vec4(mix(texel.rgb, vignetteColor, vignette), texel.a);
}
```

---

## 6. Integration Points

### physics.js Changes

- Import `updateFlightModel(state, dt, keys)` from `flightModel.js`
- Call `flightModel` BEFORE the integration step (same pattern as existing stall effects at lines 216-225) — it applies additional forces/torques that get integrated alongside the existing aerodynamics. NOT as a post-integration pass.
- `flightModel.js` reads current aircraft state, computes additional forces (engine-out yaw, spin torques, density altitude thrust reduction), and writes them back to the state object before `physics.js` integrates.
- Density altitude: replace `AIR_DENSITY` constant usage in dynamic pressure computation with `AIR_DENSITY * densityRatio` from `flightModel.js`
- Existing stall behavior stays as the base — `flightModel.js` extends it with buffet/spin state machine
- G-force computation already exists, just needs to feed into the G-onset model

### audio.js Changes

- Import `createEngineAudio(type, count)` from `engineAudio.js`
- Import `updateEffectsAudio(state, dt, cameraMode)` from `effectsAudio.js`
- Replace current generic oscillator setup with `createEngineAudio()` call
- Keep existing audio context management, just swap the sound sources
- Pass camera mode to effects audio for cockpit-aware mixing
- **Aircraft switch lifecycle:** When player switches aircraft (keys 1-5), `audio.js` must call `switchEngineAudio(newType, newCount)` from `engineAudio.js`. This crossfades from old oscillator stack to new over 0.3s, then disconnects/releases old nodes. Prevents audio glitches on switch.

### camera.js Changes

- Import mode update functions from new camera modules
- Replace hardcoded mode switch with mode registry
- Import `updateCameraEffects()` from `cameraEffects.js`
- Add per-aircraft cockpit config reading from aircraftTypes.js

### controls.js Changes

- Add key bindings for new camera modes (F1-F5)
- Add F1-F5 to the `SIM_KEYS` set with `preventDefault` to block browser defaults
- These are direct-access camera mode switches (unlike v which cycles chase/cockpit/orbit)

### aircraftTypes.js Changes

- Add `engineAudio`, `engineCount`, `hasAfterburner` fields per aircraft type
- Add `cockpitOffset: { y, z, fov }`, `lookYawMax`, `lookPitchMax` per aircraft type

### postprocessing.js Changes

- Add vignette ShaderPass to the EffectComposer chain (immediately before OutputPass)
- Export `setVignetteUniforms(intensity, color)` for `cameraEffects.js` to call — avoids exposing the pass object directly

### missiles.js Changes

- Add `isMissileActive()` — returns true if any missile is in flight
- Add `getActiveMissileState()` — returns `{ position: Vector3, velocity: Vector3 }` of first active missile, or null

### aircraftAI.js Changes

- Add `getAIAircraftList()` — returns array of `{ position: Vector3, velocity: Vector3, type: string }` for all active AI aircraft. Used by Doppler audio and padlock camera.

### settings.js Changes

- Add `realism` setting ('lite' | 'study'), default 'lite'
- Add `cameraShakeScale` setting (0.0 to 1.0), default 1.0

---

## 7. Smoothness Guarantees

Every effect in this spec follows these rules:

1. **No instant transitions.** All effects lerp with minimum 0.2s duration. Most use 1-2s.
2. **Position shake only.** Camera shake offsets position, never rotation. Rotation shake causes motion sickness.
3. **Conservative amplitudes.** Max shake: ±0.04m (landing impulse). Sustained effects: ±0.02m max.
4. **Exponential decay.** All impulse effects decay exponentially, never linearly (linear feels robotic).
5. **Global kill switch.** `CAMERA_SHAKE_SCALE = 0` disables all shake instantly.
6. **Frequency limits.** No shake above 15Hz. Stall buffet at 8Hz. Below human nausea threshold.

---

## Files Modified/Created

### New Files
- `src/flightModel.js` — stall/spin state machine, engine-out yaw, G-force model, density altitude, crosswind handling
- `src/realism.js` — adaptive difficulty profiles (lite/study), threshold config
- `src/engineAudio.js` — piston/turboprop/jet synthesis models, per-engine independence
- `src/effectsAudio.js` — procedural one-shot effects, Doppler, camera-aware mixing
- `src/cameraEffects.js` — FOV compression, G-vignette, blackout, screen shake, vignette shader

### Modified Files
- `src/physics.js` — call flightModel.js after physics step
- `src/audio.js` — swap generic oscillators for per-type engine audio, wire effects audio
- `src/camera.js` — mode registry, terrain collision fix, per-aircraft cockpit offsets, new mode implementations
- `src/controls.js` — key bindings for camera modes 5-9
- `src/aircraftTypes.js` — add engineAudio, cockpitOffset, lookLimits per aircraft
- `src/postprocessing.js` — add vignette ShaderPass, expose uniforms
- `src/settings.js` — add realism and cameraShakeScale settings

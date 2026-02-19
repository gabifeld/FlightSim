# Core Experience Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform FlightSim into the best browser-based flight sim with 60fps performance on mid-range laptops, a stylized clean aesthetic, and satisfying gameplay feel.

**Architecture:** Incremental improvement across 4 pillars — Performance first (unlock frame budget), then Visual Polish (stylized look), then Gameplay Feel (juice/feedback), then Quick Wins (polish). Each task is self-contained and testable. No new dependencies; all work uses Three.js + Web Audio API.

**Tech Stack:** Three.js (r170+), Web Audio API, Vite, vanilla JS modules

---

## Phase 1: Performance (Target: 60fps)

### Task 1: Kill All PointLights

PointLights are the #1 GPU cost. Replace all 13 PointLights (6 in airportLights.js, 6 in internationalAirport.js, 1 moon in scene.js) with emissive materials + sprite glow.

**Files:**
- Modify: `src/airportLights.js`
- Modify: `src/internationalAirport.js`
- Modify: `src/scene.js`

**Step 1: Replace airport PointLight pool with larger glow sprites**

In `src/airportLights.js`:
- Remove the `POOL_SIZE = 6` PointLight pool entirely (the `for` loop creating `new THREE.PointLight`)
- Remove `updateNearestLights()` function and all sort/throttle logic
- Keep the existing `glowPoints` system (already has AdditiveBlending + vertex colors)
- Increase glow sprite size from 8 to 12 for night, add a second `Points` layer at size 24 with lower opacity (0.3) for bloom halo effect
- Make fixture InstancedMesh emissive: set `emissiveIntensity` to 2.0 at night (via `setNightMode`)
- ALS strobe: keep animation but use emissive pulse instead of light intensity

**Step 2: Replace international airport PointLight pool**

In `src/internationalAirport.js`:
- Same pattern as Step 1: remove `INTL_POOL_SIZE = 6` PointLight pool
- Remove `updateIntlNearestLights()` and sort logic
- Boost existing glow Points size, add halo layer
- Set fixture emissiveIntensity to 2.0 at night

**Step 3: Remove moon PointLight**

In `src/scene.js`:
- Remove `moonLight = new THREE.PointLight(0x8899bb, ...)` creation and updates
- Increase `ambientLight` intensity slightly at night (0.15 → 0.25) to compensate
- Optionally add a dim blue tint to the hemisphere light's sky color at night

**Step 4: Verify no PointLights remain**

Run dev server, open browser console:
```js
scene.traverse(o => { if (o.isPointLight) console.warn('POINTLIGHT:', o) })
```
Expected: zero results.

**Step 5: Commit**
```
git add src/airportLights.js src/internationalAirport.js src/scene.js
git commit -m "perf: kill all PointLights, use emissive + sprite glow"
```

---

### Task 2: Shadow Budget

Only the player aircraft should cast shadows. Everything else uses flat stylized lighting.

**Files:**
- Modify: `src/scene.js`
- Modify: `src/terrain.js`
- Modify: `src/internationalAirport.js`
- Modify: `src/airportStructures.js` (if exists)
- Modify: `src/city.js`
- Modify: `src/capeTownCity.js`
- Modify: `src/coastal.js`

**Step 1: Audit and remove castShadow from all non-aircraft objects**

Search all files for `castShadow = true` and remove from:
- All building/structure meshes in city.js, capeTownCity.js, internationalAirport.js, coastal.js
- All vegetation InstancedMesh in terrain.js
- All runway/taxiway meshes
- Keep `castShadow = true` ONLY on the player aircraft group in aircraft.js

**Step 2: Tighten shadow frustum**

In `src/scene.js` shadow quality presets:
- Reduce frustum size from 600/680 to 200 (just needs to cover the aircraft shadow on ground)
- This dramatically improves shadow map texel density

**Step 3: Verify**

Visual check: aircraft casts shadow on ground, nothing else does. FPS should improve noticeably.

**Step 4: Commit**
```
git commit -m "perf: shadow budget — only player aircraft casts shadows"
```

---

### Task 3: Post-Processing Quality Tiers

Current post-fx only runs bloom+SMAA on high. Add medium tier with quarter-res bloom.

**Files:**
- Modify: `src/postprocessing.js`

**Step 1: Implement 3-tier post-processing**

```javascript
// Low: skip composer entirely, render directly
// Medium: RenderPass → UnrealBloomPass (half-res) → OutputPass
// High: RenderPass → UnrealBloomPass (full-res) → SMAAPass → OutputPass
```

In `initPostProcessing`:
- Read `postFxQuality` from settings
- If `'low'`: store `useComposer = false`, skip all pass creation
- If `'medium'`: create bloom at `resolution = new Vector2(w/2, h/2)`, skip SMAA
- If `'high'`: current behavior (bloom + SMAA)

In `renderFrame`:
- If `!useComposer`: call `renderer.render(scene, camera)` directly
- Else: `composer.render()`

**Step 2: Enable medium-quality bloom to also respond to day/night**

Keep existing `updatePostProcessing` night bloom logic, ensure it works for medium tier too.

**Step 3: Commit**
```
git commit -m "perf: 3-tier post-processing (none / bloom / bloom+SMAA)"
```

---

### Task 4: Auto-Detect Graphics Quality

Run a quick GPU benchmark on first load to auto-select Low/Med/High.

**Files:**
- Modify: `src/graphics.js`
- Modify: `src/main.js`
- Modify: `src/settings.js`

**Step 1: Add benchmark function to graphics.js**

```javascript
export function runBenchmark(renderer, scene, camera) {
  const start = performance.now();
  const frames = 120; // render 120 frames
  for (let i = 0; i < frames; i++) {
    renderer.render(scene, camera);
  }
  const elapsed = performance.now() - start;
  const fps = (frames / elapsed) * 1000;
  if (fps >= 50) return 'high';
  if (fps >= 30) return 'medium';
  return 'low';
}
```

**Step 2: Run benchmark on first load in main.js**

Only run if `getSetting('graphicsQuality')` has never been explicitly set by user:
```javascript
if (!isSettingExplicit('graphicsQuality')) {
  const detected = runBenchmark(renderer, scene, camera);
  applyGraphicsQuality(detected);
  // Store so we don't re-benchmark
  setSetting('graphicsQuality', detected);
}
```

**Step 3: Commit**
```
git commit -m "perf: auto-detect graphics quality on first load"
```

---

### Task 5: Vegetation & Cloud Caps

Cap vegetation at 6K total. Cap clouds at 500 max. Bigger clouds for same density.

**Files:**
- Modify: `src/terrain.js`

**Step 1: Cap vegetation instances**

In `createVegetation`, enforce hard caps:
- Trees (all types combined): max 4000
- Bushes: max 1500
- Dead trees: max 500
- Total: 6000

Add distance-based alpha fade in the vegetation shader (use `onBeforeCompile` to inject):
```glsl
float dist = length(vWorldPosition.xz - cameraPosition.xz);
float fade = 1.0 - smoothstep(fadeStart, fadeEnd, dist);
gl_FragColor.a *= fade;
```
Set `transparent: true` and `alphaTest: 0.01` on vegetation materials.

**Step 2: Cap clouds and make them bigger**

In `CLOUD_QUALITY_CONFIG`:
- High: 400 clouds (was higher), puffScale 2.0
- Medium: 250 clouds, puffScale 2.5
- Low: 120 clouds, puffScale 3.0

Increase individual sprite scale by `puffScale` factor so fewer sprites fill the same sky area.

**Step 3: Commit**
```
git commit -m "perf: cap vegetation 6K, clouds 500, bigger puffier clouds"
```

---

## Phase 2: Visual Polish (Stylized Clean)

### Task 6: Stylized Terrain Shader

Replace the current complex biome shader with a clean stepped color palette.

**Files:**
- Modify: `src/terrain.js` (the `onBeforeCompile` terrain shader)

**Step 1: Rewrite terrain fragment shader**

Replace current biome logic with stepped elevation bands:
```glsl
// 5 elevation bands with hard-ish transitions
vec3 sandColor = vec3(0.76, 0.70, 0.50);
vec3 grassColor = vec3(0.40, 0.65, 0.30);
vec3 darkGrassColor = vec3(0.25, 0.45, 0.20);
vec3 rockColor = vec3(0.50, 0.48, 0.45);
vec3 snowColor = vec3(0.95, 0.95, 0.97);

float h = vWorldPosition.y;
vec3 terrainColor = sandColor;
terrainColor = mix(terrainColor, grassColor, smoothstep(2.0, 8.0, h));
terrainColor = mix(terrainColor, darkGrassColor, smoothstep(40.0, 60.0, h));
terrainColor = mix(terrainColor, rockColor, smoothstep(120.0, 150.0, h));
terrainColor = mix(terrainColor, snowColor, smoothstep(300.0, 340.0, h));

// Steep slopes → rock
float slope = 1.0 - vNormal.y;
terrainColor = mix(terrainColor, rockColor, smoothstep(0.3, 0.6, slope));
```

Keep shore wetness (darken near y=0) and ocean floor drop. Remove noise-based biome variation — the stepped look IS the style.

**Step 2: Test from altitude**

Fly high and verify terrain reads cleanly with distinct color bands. No noisy texture — clean, map-like readability.

**Step 3: Commit**
```
git commit -m "visual: stylized stepped terrain shader with 5 elevation bands"
```

---

### Task 7: Stylized Sky Shader

Replace Three.js Sky addon with a cheap custom gradient.

**Files:**
- Modify: `src/scene.js`

**Step 1: Create custom sky shader material**

Replace `Sky` addon with a `ShaderMaterial` on a large sphere:
```javascript
const skyGeo = new THREE.SphereGeometry(CAMERA_FAR * 0.9, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    horizonColor: { value: new THREE.Color(0.85, 0.75, 0.65) },
    zenithColor: { value: new THREE.Color(0.35, 0.55, 0.85) },
    sunColor: { value: new THREE.Color(1.0, 0.9, 0.7) },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunSize: { value: 0.03 },
  },
  vertexShader: `
    varying vec3 vWorldDir;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldDir = normalize(worldPos.xyz - cameraPosition);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 horizonColor, zenithColor, sunColor, sunDirection;
    uniform float sunSize;
    varying vec3 vWorldDir;
    void main() {
      float y = max(vWorldDir.y, 0.0);
      vec3 sky = mix(horizonColor, zenithColor, pow(y, 0.6));
      float sunDot = max(dot(normalize(vWorldDir), sunDirection), 0.0);
      sky += sunColor * pow(sunDot, 256.0) * 2.0; // sun disc
      sky += sunColor * pow(sunDot, 8.0) * 0.3; // sun glow
      gl_FragColor = vec4(sky, 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
});
```

**Step 2: Add time-of-day color palettes**

Define explicit color sets for dawn/day/dusk/night:
```javascript
const SKY_PALETTES = {
  dawn:  { horizon: [0.9, 0.6, 0.4], zenith: [0.3, 0.35, 0.6], sun: [1, 0.7, 0.4] },
  day:   { horizon: [0.75, 0.82, 0.92], zenith: [0.3, 0.5, 0.85], sun: [1, 0.95, 0.8] },
  dusk:  { horizon: [0.9, 0.5, 0.3], zenith: [0.2, 0.2, 0.5], sun: [1, 0.6, 0.3] },
  night: { horizon: [0.05, 0.05, 0.1], zenith: [0.02, 0.02, 0.08], sun: [0.1, 0.1, 0.2] },
};
```

Lerp between palettes based on `getTimeOfDay()` in `updateTimeOfDay`.

**Step 3: Update fog color to match horizon**

Set `scene.fog.color` to match the sky horizon color each frame.

**Step 4: Remove Sky addon import**

Delete the `import { Sky } from 'three/addons/objects/Sky.js'` and all Sky setup code.

**Step 5: Commit**
```
git commit -m "visual: custom gradient sky shader replacing Sky addon"
```

---

### Task 8: Simplified Stylized Water

Replace heavy Water addon with a lightweight stylized water plane.

**Files:**
- Modify: `src/terrain.js` (water section)

**Step 1: Replace Water addon with custom ShaderMaterial**

Remove `import { Water }` and replace with:
```javascript
const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
waterGeo.rotateX(-Math.PI / 2);
const waterMat = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0 },
    shallowColor: { value: new THREE.Color(0.15, 0.65, 0.65) },
    deepColor: { value: new THREE.Color(0.05, 0.2, 0.4) },
    cameraPos: { value: new THREE.Vector3() },
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 0.00004 },
  },
  vertexShader: `
    uniform float time;
    varying vec3 vWorldPos;
    varying float vWaveHeight;
    void main() {
      vec3 pos = position;
      float wave = sin(pos.x * 0.02 + time) * cos(pos.z * 0.015 + time * 0.7) * 1.5;
      pos.y += wave;
      vWaveHeight = wave;
      vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 shallowColor, deepColor, cameraPos, fogColor;
    uniform float fogDensity;
    varying vec3 vWorldPos;
    varying float vWaveHeight;
    void main() {
      vec3 viewDir = normalize(cameraPos - vWorldPos);
      float fresnel = pow(1.0 - max(dot(viewDir, vec3(0,1,0)), 0.0), 3.0);
      vec3 water = mix(shallowColor, deepColor, fresnel);
      water += vec3(0.15) * smoothstep(0.3, 1.5, vWaveHeight); // foam highlights
      // Fog
      float dist = length(vWorldPos - cameraPos);
      float fogFactor = 1.0 - exp(-fogDensity * dist * dist);
      water = mix(water, fogColor, fogFactor);
      gl_FragColor = vec4(water, 0.9);
    }
  `,
  transparent: true,
  depthWrite: false,
});
```

**Step 2: Update water uniforms in updateWater**

```javascript
export function updateWater(dt) {
  waterMat.uniforms.time.value += dt * 0.5;
  waterMat.uniforms.cameraPos.value.copy(camera.position);
  waterMat.uniforms.fogColor.value.copy(scene.fog.color);
}
```

Remove all Water addon reflection/refraction logic.

**Step 3: Commit**
```
git commit -m "visual: stylized flat water shader replacing Water addon"
```

---

### Task 9: Stylized Clouds

Bigger, puffier, cartoon cumulus with direct color assignment.

**Files:**
- Modify: `src/terrain.js` (cloud section)

**Step 1: Revise cloud sprite texture**

Replace current canvas-generated texture with a softer, larger puff:
- Increase canvas size from 64 to 128
- Use wider radial gradient with softer edges (more cotton-ball, less sharp circle)
- Remove cirrus/wisp type entirely (cleaner look)

**Step 2: Fewer clouds, bigger sprites**

Each cloud cluster: 3-5 sprites (was more) at 2-3x the scale. Position sprites in a flatter arrangement (less vertical stacking). This gives cartoon cumulus look.

**Step 3: Direct color assignment**

In `updateCloudColors`, replace gradient computation with direct palette:
```javascript
const cloudPalettes = {
  day: { base: 0xffffff, shadow: 0xcccccc },
  dawn: { base: 0xffccaa, shadow: 0xcc8866 },
  dusk: { base: 0xff9966, shadow: 0x996644 },
  night: { base: 0x334455, shadow: 0x222233 },
};
```

Determine palette from `sunElevation` thresholds, lerp between adjacent palettes.

**Step 4: Commit**
```
git commit -m "visual: bigger puffier cartoon clouds with palette colors"
```

---

### Task 10: Aircraft Toon Outlines

Add inverted-normal outline pass to player aircraft for stylized pop.

**Files:**
- Modify: `src/aircraftGeometry.js`

**Step 1: Create outline helper**

After building the aircraft group, clone each mesh and add an outline shell:
```javascript
function addOutline(mesh, thickness = 0.04) {
  const outlineGeo = mesh.geometry.clone();
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x222222,
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(outlineGeo, outlineMat);
  outline.scale.multiplyScalar(1 + thickness);
  mesh.add(outline);
}
```

Apply to fuselage, wings, tail — skip small parts (wheels, props) to avoid visual clutter.

**Step 2: Test with multiple aircraft types**

Verify outlines look good on Cessna, fighter, airliner, bush plane. Adjust thickness per type if needed (config in aircraftTypes.js).

**Step 3: Commit**
```
git commit -m "visual: toon outlines on player aircraft via inverted normals"
```

---

### Task 11: Flat Materials for Buildings

Shift city/airport buildings from MeshStandardMaterial to MeshLambertMaterial.

**Files:**
- Modify: `src/city.js`
- Modify: `src/capeTownCity.js`
- Modify: `src/internationalAirport.js`
- Modify: `src/airportStructures.js`
- Modify: `src/coastal.js`

**Step 1: Bulk replace MeshStandardMaterial → MeshLambertMaterial**

For all building/structure meshes, replace:
```javascript
// Before:
new THREE.MeshStandardMaterial({ color: 0xaabbcc })
// After:
new THREE.MeshLambertMaterial({ color: 0xaabbcc })
```

Keep `emissive` and `emissiveIntensity` properties where they exist (Lambert supports these). Remove `roughness`, `metalness` properties (not supported by Lambert).

**Step 2: Verify visual quality**

Buildings should look cleaner and flatter — which matches the stylized aesthetic. Night emissive should still work.

**Step 3: Commit**
```
git commit -m "visual: flat Lambert materials for all buildings and structures"
```

---

### Task 12: Bold Runway Markings

Higher contrast, bolder runway markings for clean readability.

**Files:**
- Modify: `src/runway.js`

**Step 1: Update runway texture generation**

In the canvas-drawn runway markings:
- Increase line width for centerline dashes by 50%
- Make threshold markings wider
- Increase contrast: pure white (255,255,255) on darker asphalt (50,50,55)
- Add touchdown zone markings (parallel bars) if not already present
- Make number designators larger

**Step 2: Also update international airport runway markings**

Same changes in `src/internationalAirport.js` runway texture generation.

**Step 3: Commit**
```
git commit -m "visual: bolder high-contrast runway markings"
```

---

## Phase 3: Gameplay Feel

### Task 13: Spring-Damper Chase Camera

Replace exponential lerp with a spring-damper model for organic overshoot.

**Files:**
- Modify: `src/camera.js`
- Modify: `src/constants.js`

**Step 1: Add spring-damper constants**

In `constants.js`:
```javascript
export const CHASE_SPRING_STIFFNESS = 25.0;  // k - how snappy
export const CHASE_SPRING_DAMPING = 8.0;      // c - how quickly oscillation dies
```

**Step 2: Implement spring-damper in camera.js**

Replace the exponential lerp in chase mode with:
```javascript
// Spring-damper: F = -k*(pos - target) - c*velocity
const displacement = new THREE.Vector3().subVectors(currentPos, targetPos);
const springForce = displacement.multiplyScalar(-CHASE_SPRING_STIFFNESS);
const dampingForce = cameraVelocity.clone().multiplyScalar(-CHASE_SPRING_DAMPING);
cameraVelocity.add(springForce.add(dampingForce).multiplyScalar(dt));
currentPos.add(cameraVelocity.clone().multiplyScalar(dt));
```

Add `cameraVelocity = new THREE.Vector3()` as module state. Reset on camera mode switch.

**Step 3: Tune for feel**

The camera should smoothly follow but slightly overshoot on sudden turns, giving a cinematic trailing feel. Adjust k/c until it feels right.

**Step 4: Commit**
```
git commit -m "feel: spring-damper chase camera with natural overshoot"
```

---

### Task 14: Speed Lines Overlay

Subtle radial streaks at high speed for sense of velocity.

**Files:**
- Create: `src/speedLines.js`
- Modify: `src/main.js`

**Step 1: Create speed lines system**

```javascript
// speedLines.js
// Screen-space speed lines using a fullscreen quad with custom shader
// Lines radiate from center, opacity scales with airspeed
// Only visible above 150 knots in chase/orbit camera

export function initSpeedLines(scene, camera) { ... }
export function updateSpeedLines(speed, cameraMode) { ... }
```

Use a `THREE.Mesh` with `PlaneGeometry(2,2)` and a `ShaderMaterial`:
- Vertex shader: pass UV
- Fragment shader: compute angle from center, create radial lines via `sin(angle * lineCount)`, mask to edges (distance from center > 0.6), multiply by speed factor

**Step 2: Wire into main.js**

```javascript
import { initSpeedLines, updateSpeedLines } from './speedLines.js';
// In init:
initSpeedLines(scene, camera);
// In game loop:
updateSpeedLines(activeVehicle.speed, getCameraMode());
```

**Step 3: Commit**
```
git commit -m "feel: radial speed lines overlay above 150kt"
```

---

### Task 15: G-Force Camera Effects

Camera lag and FOV compression on hard maneuvers.

**Files:**
- Modify: `src/camera.js`

**Step 1: Add G-force FOV compression**

Read G-force from active vehicle state. Compress FOV under positive G, expand under negative:
```javascript
const gForce = activeVehicle.gForce || 1.0;
const baseFOV = 75;
const gFovOffset = (gForce - 1.0) * -2.0; // +2G → FOV narrows by 2°
camera.fov = baseFOV + gFovOffset;
camera.updateProjectionMatrix();
```

**Step 2: Add stall buffet camera shake**

When near stall angle (AoA > critical * 0.85), add irregular shake:
```javascript
if (isAircraft(v) && v.aoa > v.stallAngle * 0.85) {
  const intensity = (v.aoa - v.stallAngle * 0.85) / (v.stallAngle * 0.15);
  const buffet = Math.sin(time * 37) * Math.cos(time * 53) * intensity * 0.3;
  camera.position.y += buffet;
}
```

**Step 3: Commit**
```
git commit -m "feel: G-force FOV compression and stall buffet shake"
```

---

### Task 16: Enhanced Audio

Add wind rush, gear thunk, flap whine, touchdown chirp, structural creak, cockpit ambiance.

**Files:**
- Modify: `src/audio.js`

**Step 1: Add wind rush**

```javascript
// Bandpass-filtered noise, frequency and volume scale with airspeed
let windRushGain, windRushFilter;
// In initAudio:
const windRushBuf = createNoiseBuffer(2);
windRushSource = ctx.createBufferSource();
windRushSource.buffer = windRushBuf;
windRushSource.loop = true;
windRushFilter = ctx.createBiquadFilter();
windRushFilter.type = 'bandpass';
windRushGain = ctx.createGain();
windRushGain.gain.value = 0;
windRushSource.connect(windRushFilter).connect(windRushGain).connect(masterGain);
windRushSource.start();

// In updateAudio:
const speedFactor = Math.min(v.speed / 250, 1.0);
windRushFilter.frequency.setTargetAtTime(200 + speedFactor * 2000, ctx.currentTime, 0.1);
windRushGain.gain.setTargetAtTime(speedFactor * 0.12, ctx.currentTime, 0.15);
```

**Step 2: Improve gear/flap/touchdown sounds**

Enhance existing `playGearSound`, `playFlapSound`, `playTouchdownSound`:
- Gear: add low "thunk" (60Hz sine burst, 0.1s) + mechanical clunk (noise burst, 0.05s)
- Flap: add servo whine (rising 400→800Hz sine, 0.3s duration)
- Touchdown: add tire chirp (short high-pass noise burst 2000Hz, 0.15s) layered with existing

**Step 3: Add structural creak**

```javascript
export function playCreakSound() {
  // Groaning metallic sound at high G
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 80 + Math.random() * 40;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 200;
  filter.Q.value = 5;
  osc.connect(filter).connect(gain).connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
}
```

Call from game loop when `Math.abs(gForce) > 3.0` (throttle to once per 2 seconds).

**Step 4: Add cockpit ambiance**

Low 60Hz hum + filtered noise at very low volume, audible only in cockpit camera mode:
```javascript
let cockpitGain;
// Init: 60Hz sine + low noise, always running, gain 0
// Update: cockpitGain.gain.value = (cameraMode === 'cockpit') ? 0.03 : 0;
```

**Step 5: Commit**
```
git commit -m "feel: wind rush, enhanced gear/flap/touchdown, creak, cockpit ambiance"
```

---

### Task 17: Enhanced Particle Effects

Wing vapor, contrails improvements, dust kick-up, gear compression visual.

**Files:**
- Modify: `src/particles.js`

**Step 1: Add wing vapor system**

New particle pool for wingtip vortices at high G:
```javascript
// wingVapor: 100 particles, white, small, short-lived
// Emit from wingtip positions when |G| > 2.0
// Particles drift backward and fade quickly (0.3s lifetime)
```

**Step 2: Improve contrails**

Make contrails thicker and more visible:
- Increase contrail particle size by 2x
- Increase emission rate at altitude
- White color, longer lifetime (2s vs current)

**Step 3: Enhance dust kick-up on touchdown**

Bigger brown sprite burst: 30 particles, size 5-8, spread wider (matching aircraft width), 1s lifetime.

**Step 4: Commit**
```
git commit -m "feel: wing vapor, thicker contrails, better dust kick-up"
```

---

### Task 18: HUD Improvements

Speed tape, animated landing score, minimalist mode.

**Files:**
- Modify: `src/hud.js`
- Modify: `index.html` (add HUD elements)
- Modify: `style.css` (HUD styling)

**Step 1: Add speed tape**

Create a scrolling speed indicator in the HUD:
- Vertical strip on the left side
- Numbers scroll smoothly with current speed
- Current speed highlighted with a pointer/arrow
- Tick marks every 10 knots

Implementation: CSS-driven div with `transform: translateY()` based on speed. No canvas needed.

**Step 2: Animated landing score**

When landing score appears:
- Grade letter flies in from right (CSS `@keyframes slideIn`)
- Rating bars fill sequentially (0.3s each, CSS `transition`)
- "NEW BEST" text pulses if applicable (CSS `@keyframes pulse`)

**Step 3: Minimalist HUD mode**

Add toggle (key `V`):
- Full: all instruments visible (current)
- Minimal: only speed, altitude, heading, and state message
- Off: hide everything except critical warnings

Store preference in settings.js.

**Step 4: Commit**
```
git commit -m "feel: speed tape, animated landing score, minimalist HUD toggle"
```

---

## Phase 4: Quick Wins

### Task 19: Loading Screen

Branded splash with progress indication during init.

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/main.js`

**Step 1: Add loading screen HTML/CSS**

```html
<div id="loading-screen">
  <div class="loading-title">FLIGHTSIM</div>
  <div class="loading-bar-container">
    <div class="loading-bar" id="loading-progress"></div>
  </div>
  <div class="loading-text" id="loading-text">Initializing...</div>
</div>
```

CSS: centered, dark background, white text, clean sans-serif. Bar fills left-to-right.

**Step 2: Add progress updates to main.js init**

After each major init step, update progress:
```javascript
function setLoadProgress(pct, text) {
  const bar = document.getElementById('loading-progress');
  const label = document.getElementById('loading-text');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = text;
}

setLoadProgress(10, 'Creating terrain...');
const terrain = createTerrain();
setLoadProgress(30, 'Growing vegetation...');
createVegetation(scene);
// ... etc
setLoadProgress(100, 'Ready!');

// Fade out loading screen
setTimeout(() => {
  document.getElementById('loading-screen').classList.add('fade-out');
}, 300);
```

**Step 3: Commit**
```
git commit -m "polish: branded loading screen with progress bar"
```

---

### Task 20: Menu Transitions

Fade in/out between menu panels and gameplay.

**Files:**
- Modify: `src/menu.js`
- Modify: `style.css`

**Step 1: Add CSS transitions**

```css
#game-overlay {
  transition: opacity 0.3s ease;
}
#game-overlay.fade-out {
  opacity: 0;
  pointer-events: none;
}
```

**Step 2: Animate panel switches in menu.js**

When switching panels or starting gameplay:
```javascript
function transitionTo(panel) {
  overlay.classList.add('fade-out');
  setTimeout(() => {
    showPanel(panel);
    overlay.classList.remove('fade-out');
  }, 300);
}
```

**Step 3: Commit**
```
git commit -m "polish: smooth fade transitions between menu panels"
```

---

### Task 21: Crash Feedback

Screen flash, crunch sound, camera freeze on crash.

**Files:**
- Modify: `src/gameState.js`
- Modify: `src/camera.js`
- Modify: `src/audio.js`
- Modify: `style.css`

**Step 1: Add screen flash overlay**

When crash state entered:
```javascript
// In gameState.js crash handler:
import { playCrashSound } from './audio.js';
import { freezeCamera } from './camera.js';

// Show red flash overlay
const flash = document.getElementById('crash-flash');
flash.style.opacity = '0.6';
setTimeout(() => flash.style.opacity = '0', 500);

playCrashSound();
freezeCamera(0.5); // freeze camera for 0.5s
```

**Step 2: Enhance crash sound**

In `audio.js`, improve `playCrashSound`:
- Louder (gain 0.4)
- Layer: low rumble (40Hz, 0.3s) + metal crunch (noise burst, highpass 1000Hz, 0.2s) + glass tinkle (high sine burst 3000Hz, 0.1s)

**Step 3: Camera freeze**

In `camera.js`, add `freezeCamera(duration)`:
```javascript
let freezeTimer = 0;
export function freezeCamera(duration) { freezeTimer = duration; }
// In updateCamera: if (freezeTimer > 0) { freezeTimer -= dt; return; }
```

**Step 4: Commit**
```
git commit -m "polish: crash screen flash, enhanced crunch sound, camera freeze"
```

---

### Task 22: Contextual Hints

Show helpful control hints at appropriate moments.

**Files:**
- Create: `src/hints.js`
- Modify: `src/main.js`

**Step 1: Create hints system**

```javascript
// hints.js
const HINTS = {
  approaching: { text: 'GEAR: G | FLAPS: F | BRAKE: B', trigger: 'nearRunway' },
  stalling: { text: 'PUSH NOSE DOWN ↓', trigger: 'highAoA' },
  firstFlight: { text: 'THROTTLE: W/S | PITCH: ↑/↓ | ROLL: ←/→', trigger: 'startup' },
  lowFuel: { text: 'LOW FUEL — LAND SOON', trigger: 'fuelLow' },
};

let shownHints = new Set();
let currentHint = null;
let hintTimer = 0;

export function initHints() { ... }
export function updateHints(vehicleState, gameState, dt) {
  // Check triggers, show hint via HUD overlay, auto-dismiss after 4s
  // Each hint shows only once per flight (tracked in shownHints)
  // Reset shownHints on flight reset
}
export function resetHints() { shownHints.clear(); }
```

**Step 2: Wire into main.js game loop and reset**

**Step 3: Commit**
```
git commit -m "polish: contextual control hints (gear, stall, first flight)"
```

---

### Task 23: Final Integration Test & Cleanup

Verify everything works together, fix any issues.

**Files:**
- All modified files

**Step 1: Full flight test**

Run through complete workflow:
1. Load game → loading screen appears with progress
2. Select aircraft → menu fades to gameplay
3. Take off → speed lines appear at high speed
4. Fly at altitude → contrails visible, clouds look puffy
5. Hard turn → camera overshoots, G-force FOV narrows, wing vapor
6. Approach runway → contextual hints appear
7. Land → touchdown chirp + dust + shake + landing score animation
8. Crash test → screen flash + crunch + camera freeze
9. Night flight → no PointLights, emissive glow looks good
10. Toggle HUD modes → minimalist works

**Step 2: Performance verification**

Open DevTools → Performance tab:
- Fly around for 30s at each quality level
- Low: should be 60fps on any hardware
- Medium: should be 60fps on mid-range laptop
- High: should be 45+ fps on mid-range laptop

**Step 3: Fix any issues found**

**Step 4: Final commit**
```
git commit -m "polish: final integration testing and fixes"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1. Performance | 1-5 | Kill PointLights, shadow budget, post-fx tiers, auto-quality, caps |
| 2. Visual Polish | 6-12 | Terrain shader, sky, water, clouds, outlines, flat materials, runways |
| 3. Gameplay Feel | 13-18 | Spring camera, speed lines, G-force, audio, particles, HUD |
| 4. Quick Wins | 19-23 | Loading screen, transitions, crash feedback, hints, integration |

**Estimated tasks:** 23
**New files:** 2 (speedLines.js, hints.js)
**Modified files:** ~20

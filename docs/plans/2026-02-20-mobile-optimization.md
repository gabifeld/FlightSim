# Mobile Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve mobile graphics quality (sharpness) without hurting FPS, and make portrait mode work properly.

**Architecture:** Add a dedicated `mobile` graphics preset that trades shadows/post-fx for higher pixel ratio. Add `isMobileDevice()` detection to skip the unreliable benchmark on mobile. Add portrait-orientation CSS media queries for touch controls and HUD.

**Tech Stack:** Three.js, CSS media queries, vanilla JS

---

### Task 1: Add `isMobileDevice()` to mobile.js

**Files:**
- Modify: `src/mobile.js:39-41`

**Step 1: Add the exported function**

Add after the existing `isTouchDevice()` function (line 41):

```js
export function isMobileDevice() {
  return isTouchDevice() && window.matchMedia('(pointer: coarse)').matches;
}
```

This checks both touch capability and coarse pointer (excludes laptops with touchscreens that also have a mouse).

**Step 2: Verify no build errors**

Run: `npx vite build`
Expected: Build succeeds

**Step 3: Commit**

```
git add src/mobile.js
git commit -m "feat: add isMobileDevice() detection export"
```

---

### Task 2: Add `mobile` graphics preset

**Files:**
- Modify: `src/graphics.js:5-36`

**Step 1: Add mobile preset to GRAPHICS_QUALITY_PRESETS**

Insert after the `high` preset (before the closing `});` on line 36):

```js
  mobile: Object.freeze({
    pixelRatioCap: 2.0,
    shadowMapEnabled: false,
    shadowType: THREE.PCFShadowMap,
    shadowQuality: 'low',
    cloudQuality: 'low',
    postFxQuality: 'mobile',
    vegetationDensity: 'low',
    assetQuality: 'low',
  }),
```

**Step 2: Verify no build errors**

Run: `npx vite build`
Expected: Build succeeds

**Step 3: Commit**

```
git add src/graphics.js
git commit -m "feat: add mobile graphics preset with high DPR, no shadows"
```

---

### Task 3: Handle `'mobile'` postFxQuality tier

**Files:**
- Modify: `src/postprocessing.js:26-32`

**Step 1: Add mobile quality handling**

Change the early-return block at lines 26-32 from:

```js
  // Low quality: skip composer entirely, render direct
  if (postFxQuality === 'low') {
    useComposer = false;
    composer = null;
    bloomPass = null;
    return null;
  }
```

To:

```js
  // Low quality: skip composer entirely, render direct
  if (postFxQuality === 'low') {
    useComposer = false;
    composer = null;
    bloomPass = null;
    return null;
  }

  // Mobile quality: minimal composer — RenderPass + OutputPass only (tone mapping, no bloom/SMAA)
  if (postFxQuality === 'mobile') {
    useComposer = true;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new OutputPass());
    bloomPass = null;
    return composer;
  }
```

This gives mobile proper tone mapping (sky colors, lighting look correct) without the expensive bloom and SMAA passes.

**Step 2: Verify no build errors**

Run: `npx vite build`
Expected: Build succeeds

**Step 3: Commit**

```
git add src/postprocessing.js
git commit -m "feat: add mobile postFx tier with tone mapping only"
```

---

### Task 4: Skip benchmark on mobile, apply mobile preset

**Files:**
- Modify: `src/main.js:70-78`

**Step 1: Import isMobileDevice**

At the top of main.js, the existing import from mobile.js (line 31) is:

```js
import { initMobile, updateMobile } from './mobile.js';
```

Change to:

```js
import { initMobile, updateMobile, isMobileDevice } from './mobile.js';
```

**Step 2: Modify the quality detection block**

Replace lines 70-78:

```js
// Auto-detect graphics quality if user never explicitly set it
let detectedQuality = getSetting('graphicsQuality');
if (!isSettingExplicit('graphicsQuality')) {
  detectedQuality = runBenchmark(renderer, scene, camera);
  setSetting('graphicsQuality', detectedQuality);
}
const graphicsPreset = applyGraphicsQuality(detectedQuality);
setCloudQuality(isSettingExplicit('cloudQuality') ? getSetting('cloudQuality') : graphicsPreset.cloudQuality);
configureShadowQuality(isSettingExplicit('shadowQuality') ? getSetting('shadowQuality') : graphicsPreset.shadowQuality);
```

With:

```js
// Auto-detect graphics quality if user never explicitly set it
let detectedQuality = getSetting('graphicsQuality');
if (!isSettingExplicit('graphicsQuality')) {
  if (isMobileDevice()) {
    // Skip benchmark on mobile (unreliable due to thermal throttling)
    // Use dedicated mobile preset: high DPR + no shadows = sharp & fast
    detectedQuality = 'mobile';
  } else {
    detectedQuality = runBenchmark(renderer, scene, camera);
  }
  setSetting('graphicsQuality', detectedQuality);
}
const graphicsPreset = applyGraphicsQuality(detectedQuality);
setCloudQuality(isSettingExplicit('cloudQuality') ? getSetting('cloudQuality') : graphicsPreset.cloudQuality);
configureShadowQuality(isSettingExplicit('shadowQuality') ? getSetting('shadowQuality') : graphicsPreset.shadowQuality);
```

**Step 3: Verify no build errors**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Commit**

```
git add src/main.js
git commit -m "feat: skip benchmark on mobile, apply mobile preset"
```

---

### Task 5: Portrait-adaptive CSS for touch controls

**Files:**
- Modify: `style.css` (append after line 1686, before the Challenge Modes section)

**Step 1: Add portrait orientation media queries**

Insert the following CSS block after the `/* Extra small phones */` section (after line 1686) and before the `/* CHALLENGE MODES */` comment:

```css
/* ─── Portrait mode (touch devices) ─── */
@media (pointer: coarse) and (orientation: portrait) {
  /* Throttle: responsive height, push up from bottom */
  .mob-throttle-track {
    height: 20vh;
    bottom: 28vh;
    left: 3vw;
    width: 8vw;
    max-width: 36px;
    min-height: 100px;
  }

  /* Joystick: responsive, centered-right */
  .mob-joy-base {
    width: 26vw;
    height: 26vw;
    max-width: 120px;
    max-height: 120px;
    right: 4vw;
    bottom: 4vh;
  }

  .mob-joy-knob {
    width: 10vw;
    height: 10vw;
    max-width: 44px;
    max-height: 44px;
  }

  /* Action buttons: horizontal row above joystick */
  .mob-btn {
    width: 9vw;
    height: 9vw;
    max-width: 42px;
    max-height: 42px;
    font-size: 8px;
  }

  .mob-btn-gear {
    right: 4vw;
    bottom: calc(4vh + 28vw);
  }

  .mob-btn-flaps {
    right: calc(4vw + 10vw);
    bottom: calc(4vh + 28vw);
  }

  .mob-btn-cam {
    right: calc(4vw + 20vw);
    bottom: calc(4vh + 28vw);
  }

  .mob-btn-ils {
    right: calc(4vw + 30vw);
    bottom: calc(4vh + 28vw);
  }

  .mob-btn-assist {
    right: calc(4vw + 40vw);
    bottom: calc(4vh + 28vw);
  }

  /* Brake: left of throttle */
  .mob-btn-brake {
    left: calc(3vw + 10vw);
    bottom: 28vh;
  }

  /* Yaw: flanking bottom */
  .mob-btn-yaw-left {
    left: 3vw;
    bottom: 4vh;
  }

  .mob-btn-yaw-right {
    right: calc(4vw + 28vw);
    bottom: 4vh;
  }

  /* PFD: compact at top-left */
  #pfd {
    left: 3vw;
    bottom: auto;
    top: 36px;
    padding: 4px 6px;
    border-radius: 6px;
  }

  .pfd-tape {
    min-width: 32px;
    padding: 0 4px;
  }

  .tape-value { font-size: 14px; }
  .tape-label { font-size: 6px; }
  .tape-unit { font-size: 5px; }

  /* Hide VS, AoA, G-force in portrait — keep speed, alt, heading */
  .pfd-tape:nth-child(n+5) { display: none; }
  .pfd-divider:nth-child(n+4) { display: none; }

  /* Attitude: smaller, top center */
  #attitude-panel {
    top: 4px;
    padding: 4px;
  }

  #attitude-indicator {
    width: 60px;
    height: 60px;
  }

  /* AP panel */
  #ap-panel {
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    right: auto;
    padding: 3px 6px;
  }

  .ap-label { font-size: 6px; }
  .ap-mode { font-size: 7px; padding: 1px 2px; }
  .ap-target { font-size: 6px; }

  /* State bar */
  #state-bar {
    bottom: 2vh;
  }

  .state-label { font-size: 7px; letter-spacing: 1.5px; }
  .state-message { font-size: 10px; }

  /* Aircraft name / time repositioned */
  .aircraft-name-display { font-size: 8px; top: 4px; left: 6px; }
  .time-display { font-size: 7px; top: 14px; left: 6px; }

  /* Warnings scaled */
  .stall-warning { font-size: 22px; letter-spacing: 3px; }
  .gpws-warning { font-size: 16px; }

  /* Landing score / panels */
  #landing-score-panel { padding: 12px 16px; min-width: 180px; }
  .score-grade { font-size: 32px; }
  .score-total { font-size: 12px; }

  /* ILS panel */
  #ils-panel { margin-bottom: 30px; padding: 4px 6px; }
  .ils-crosshair { width: 60px; height: 60px; }
  .ils-dme { font-size: 9px; }

  /* Menu panels — slightly smaller titles */
  .menu-title { font-size: 36px; letter-spacing: 8px; }
  .menu-title-accent { font-size: 36px; }
  .menu-subtitle { font-size: 9px; letter-spacing: 4px; }
}
```

**Step 2: Verify no build errors**

Run: `npx vite build`
Expected: Build succeeds

**Step 3: Commit**

```
git add style.css
git commit -m "feat: portrait-adaptive CSS for mobile touch controls and HUD"
```

---

### Task 6: Manual testing on mobile / DevTools

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test in Chrome DevTools mobile emulation**

- Open DevTools → Toggle Device Toolbar
- Select iPhone 14 Pro (portrait)
- Verify: Touch controls visible, joystick bottom-right, throttle bottom-left
- Verify: Action buttons in horizontal row above joystick
- Verify: PFD at top-left, compact
- Verify: Attitude indicator smaller
- Rotate to landscape → verify layout reverts to standard touch layout

**Step 3: Test graphics preset**

- Clear localStorage: `localStorage.removeItem('flightsim_settings')`
- Reload in mobile emulation
- Open console: `localStorage.getItem('flightsim_settings')` → should show `"mobile"` for graphicsQuality
- Verify: No shadows visible, sky colors look correct (tone mapping working)
- Verify FPS overlay shows reasonable frame rate

**Step 4: Test explicit settings override**

- In settings menu, change graphics to "High"
- Reload → should stay on High (user's explicit choice respected)

**Step 5: Final commit**

```
git add -A
git commit -m "mobile: smart mobile preset + portrait-adaptive layout"
```

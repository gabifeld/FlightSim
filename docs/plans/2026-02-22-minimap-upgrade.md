# Minimap Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the canvas minimap to show all world features, add a fullscreen world-centered overlay mode, and support tap-to-place waypoints with bearing/distance on HUD.

**Architecture:** All changes in hud.js (minimap rendering), style.css (fullscreen overlay), and index.html (overlay div). The existing `updateMinimap()` canvas drawing is extended with new feature layers. A fullscreen mode renders the same features to a larger canvas. Waypoints are a simple array in module state.

**Tech Stack:** Canvas 2D API, CSS, vanilla JS

---

### Task 1: Import Missing Constants and Exports

**Files:**
- Modify: `src/hud.js:14-23`

**Step 1: Add missing constants to the import from constants.js**

Change the constants import (lines 14-19) from:

```js
import {
  MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM, STALL_AOA,
  RUNWAY_WIDTH, RUNWAY_LENGTH, TAXI_SPEED_LIMIT,
  AIRPORT2_X, AIRPORT2_Z,
  CITY_CENTER_X, CITY_CENTER_Z, CITY_SIZE,
} from './constants.js';
```

To:

```js
import {
  MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM, STALL_AOA,
  RUNWAY_WIDTH, RUNWAY_LENGTH, TAXI_SPEED_LIMIT,
  AIRPORT2_X, AIRPORT2_Z,
  CITY_CENTER_X, CITY_CENTER_Z, CITY_SIZE,
  INTL_AIRPORT_X, INTL_AIRPORT_Z, INTL_RUNWAY_LENGTH, INTL_RUNWAY_WIDTH,
  CT_CENTER_X, CT_CENTER_Z, CT_SIZE_X, CT_SIZE_Z,
  COAST_LINE_X,
} from './constants.js';
```

**Step 2: Add highway path import from terrain.js**

Change line 21 from:

```js
import { getTerrainHeightCached, getCloudDensity } from './terrain.js';
```

To:

```js
import { getTerrainHeightCached, getCloudDensity, getHighwayPath } from './terrain.js';
```

**Step 3: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Commit**

```
git add src/hud.js
git commit -m "feat(minimap): import constants for all world features"
```

---

### Task 2: Draw All World Features on Minimap

**Files:**
- Modify: `src/hud.js` — inside `updateMinimap()` function (after the Airport 2 runway block at ~line 779, before the Aircraft dot block at ~line 830)

**Step 1: Add international airport, second city, coastline, highway, and beach markers**

After the existing Airport 2 runway drawing (after the line `ctx.fillRect(toX(AIRPORT2_X) - rw1/2, toY(AIRPORT2_Z - RUNWAY_LENGTH/2), rw1, rl1);`), add:

```js
  // ── International Airport runway ──
  const intlRw = INTL_RUNWAY_WIDTH * scale;
  const intlRl = INTL_RUNWAY_LENGTH * scale;
  ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
  ctx.fillRect(toX(INTL_AIRPORT_X) - intlRw/2, toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2), intlRw, intlRl);

  // ── Second city (Bayview) zone ──
  const ct2X = toX(CT_CENTER_X - CT_SIZE_X / 2);
  const ct2Y = toY(CT_CENTER_Z - CT_SIZE_Z / 2);
  const ct2W = CT_SIZE_X * scale;
  const ct2H = CT_SIZE_Z * scale;
  ctx.fillStyle = 'rgba(60, 60, 80, 0.4)';
  ctx.fillRect(ct2X, ct2Y, ct2W, ct2H);

  // ── Coastline ──
  const coastX = toX(COAST_LINE_X);
  if (coastX > -10 && coastX < w + 10) {
    ctx.strokeStyle = 'rgba(40, 120, 200, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(coastX, 0);
    ctx.lineTo(coastX, h);
    ctx.stroke();
  }

  // ── Highway ──
  const hwPath = getHighwayPath();
  if (hwPath && hwPath.points) {
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.5)';
    ctx.lineWidth = Math.max(1, 12 * scale);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < hwPath.points.length; i += 5) {
      const pt = hwPath.points[i];
      const sx = toX(pt.x);
      const sy = toY(pt.z);
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // ── Beach / Lighthouse markers ──
  const lighthouseX = toX(13000);
  const lighthouseY = toY(-200);
  if (lighthouseX > 0 && lighthouseX < w && lighthouseY > 0 && lighthouseY < h) {
    ctx.fillStyle = 'rgba(255, 220, 100, 0.8)';
    ctx.beginPath();
    ctx.arc(lighthouseX, lighthouseY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
```

**Step 2: Update the labels section**

In the labels section (after "APT2" label), add:

```js
  // INTL label
  ctx.fillStyle = 'rgba(200, 200, 255, 0.8)';
  ctx.fillText('INTL', toX(INTL_AIRPORT_X), toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2 - 80));

  // BAYVIEW label (second city)
  ctx.fillStyle = 'rgba(200, 180, 140, 0.8)';
  ctx.fillText('BAYVIEW', toX(CT_CENTER_X), toY(CT_CENTER_Z - CT_SIZE_Z/2 - 40));
```

**Step 3: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Commit**

```
git add src/hud.js
git commit -m "feat(minimap): draw all world features — intl airport, coastline, highway, second city"
```

---

### Task 3: Waypoint State and Drawing

**Files:**
- Modify: `src/hud.js` — module-level state + drawing in `updateMinimap()`

**Step 1: Add waypoint state at module level**

Near the top of hud.js (after line 31 `let lastMinimapUpdateMs = 0;`), add:

```js
// Waypoints
const waypoints = [];
const MAX_WAYPOINTS = 5;
let activeWaypointIdx = 0;
```

**Step 2: Add waypoint drawing in updateMinimap()**

After the beach/lighthouse markers block and before the Labels section, add:

```js
  // ── Waypoints ──
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const wpx = toX(wp.x);
    const wpy = toY(wp.z);
    if (wpx < -10 || wpx > w + 10 || wpy < -10 || wpy > h + 10) continue;

    const isActive = i === activeWaypointIdx;
    const size = isActive ? 5 : 4;

    // Diamond shape
    ctx.fillStyle = isActive ? '#ff6644' : 'rgba(255, 100, 68, 0.6)';
    ctx.beginPath();
    ctx.moveTo(wpx, wpy - size);
    ctx.lineTo(wpx + size, wpy);
    ctx.lineTo(wpx, wpy + size);
    ctx.lineTo(wpx - size, wpy);
    ctx.closePath();
    ctx.fill();

    // Label
    ctx.fillStyle = isActive ? '#ffaa88' : 'rgba(255, 170, 136, 0.7)';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(wp.label, wpx, wpy - size - 3);
  }

  // ── Dashed line to active waypoint ──
  if (waypoints.length > 0 && activeWaypointIdx < waypoints.length) {
    const awp = waypoints[activeWaypointIdx];
    const awpx = toX(awp.x);
    const awpy = toY(awp.z);
    ctx.strokeStyle = 'rgba(255, 100, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(awpx, awpy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
```

**Step 3: Add waypoint helper functions**

After the `updateMinimap()` function, add:

```js
function addWaypoint(worldX, worldZ) {
  if (waypoints.length >= MAX_WAYPOINTS) return;
  waypoints.push({ x: worldX, z: worldZ, label: 'WPT' + (waypoints.length + 1) });
  activeWaypointIdx = waypoints.length - 1;
}

function removeWaypointAt(worldX, worldZ, hitRadius) {
  for (let i = waypoints.length - 1; i >= 0; i--) {
    const dx = waypoints[i].x - worldX;
    const dz = waypoints[i].z - worldZ;
    if (Math.sqrt(dx * dx + dz * dz) < hitRadius) {
      waypoints.splice(i, 1);
      if (activeWaypointIdx >= waypoints.length) activeWaypointIdx = Math.max(0, waypoints.length - 1);
      return true;
    }
  }
  return false;
}

function getActiveWaypoint() {
  return waypoints.length > 0 ? waypoints[activeWaypointIdx] : null;
}
```

**Step 4: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 5: Commit**

```
git add src/hud.js
git commit -m "feat(minimap): waypoint state, drawing, and helper functions"
```

---

### Task 4: Waypoint Bearing/Distance on HUD

**Files:**
- Modify: `src/hud.js` — inside `updateHUD()`
- Modify: `index.html` — add waypoint HUD element

**Step 1: Add waypoint HUD element to index.html**

After the time display line (`<div id="hud-time" ...>`), add:

```html
      <!-- Waypoint indicator -->
      <div id="hud-waypoint" class="waypoint-display" style="display: none;">WPT1 → 045° 3.2nm</div>
```

**Step 2: Add CSS for waypoint display in style.css**

After the `.time-display` CSS rules, add:

```css
.waypoint-display {
  position: absolute;
  top: 40px;
  right: 240px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  color: #ff8866;
  letter-spacing: 0.5px;
  pointer-events: none;
}

@media (pointer: coarse) {
  .waypoint-display { top: 32px; right: auto; left: 50%; transform: translateX(-50%); font-size: 10px; }
}

@media (pointer: coarse) and (orientation: portrait) {
  .waypoint-display { top: 26px; font-size: 9px; }
}
```

**Step 3: Register the element in initHUD()**

In the `els = { ... }` block in `initHUD()`, add:

```js
    waypoint: document.getElementById('hud-waypoint'),
```

**Step 4: Update waypoint bearing/distance in updateHUD()**

At the end of `updateHUD()` (before the closing brace), add:

```js
  // Waypoint bearing/distance
  const awp = getActiveWaypoint();
  if (awp && els.waypoint) {
    const dx = awp.x - v.position.x;
    const dz = awp.z - v.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const bearingRad = Math.atan2(-dx, -dz);
    let bearingDeg = bearingRad * 180 / Math.PI;
    if (bearingDeg < 0) bearingDeg += 360;
    const distNm = (dist / 1852).toFixed(1);
    els.waypoint.textContent = `${awp.label} → ${Math.round(bearingDeg).toString().padStart(3, '0')}° ${distNm}nm`;
    els.waypoint.style.display = '';
  } else if (els.waypoint) {
    els.waypoint.style.display = 'none';
  }
```

**Step 5: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 6: Commit**

```
git add src/hud.js index.html style.css
git commit -m "feat(minimap): waypoint bearing/distance display on HUD"
```

---

### Task 5: Fullscreen Map Overlay — HTML/CSS

**Files:**
- Modify: `index.html` — add fullscreen overlay div
- Modify: `style.css` — fullscreen overlay styling

**Step 1: Add fullscreen overlay to index.html**

After the minimap panel closing `</div>` (after `</div>` for `#minimap-panel`), add:

```html
      <!-- Fullscreen Map Overlay -->
      <div id="minimap-fullscreen" class="minimap-fullscreen" style="display: none;">
        <canvas id="fullmap-canvas" width="600" height="600"></canvas>
        <div class="fullmap-close">&times;</div>
        <div class="fullmap-hint">TAP TO PLACE WAYPOINT</div>
      </div>
      <div id="fullmap-backdrop" class="fullmap-backdrop" style="display: none;"></div>
```

**Step 2: Add fullscreen CSS in style.css**

After the `#minimap-canvas` rules (after line 576), add:

```css
.fullmap-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 18;
}

.minimap-fullscreen {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 19;
  background: rgba(8, 12, 20, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(120, 180, 255, 0.15);
  border-radius: 12px;
  padding: 12px;
  pointer-events: auto;
}

#fullmap-canvas {
  display: block;
  border-radius: 8px;
  width: 80vmin;
  height: 80vmin;
  max-width: 600px;
  max-height: 600px;
}

.fullmap-close {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 22px;
  color: rgba(200, 220, 255, 0.7);
  cursor: pointer;
  line-height: 1;
  pointer-events: auto;
}

.fullmap-close:hover {
  color: #ffffff;
}

.fullmap-hint {
  text-align: center;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 2px;
  color: rgba(160, 200, 255, 0.4);
  margin-top: 6px;
}
```

**Step 3: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Commit**

```
git add index.html style.css
git commit -m "feat(minimap): fullscreen map overlay HTML/CSS"
```

---

### Task 6: Fullscreen Map Logic — Rendering and Interaction

**Files:**
- Modify: `src/hud.js` — fullscreen canvas rendering, open/close, tap-to-place waypoints

**Step 1: Add fullscreen state and canvas refs**

Near the existing minimap state (around line 27), add:

```js
let fullmapCtx = null;
let fullmapCanvas = null;
let minimapMode = 'local'; // 'local' | 'overview' | 'fullscreen'
```

And change the existing `let minimapZoom = 'local';` line to be removed (we're replacing it with `minimapMode`).

**Step 2: Update initHUD() to set up fullscreen canvas and events**

At the end of `initHUD()` (after the existing minimap click listener), add:

```js
  fullmapCanvas = document.getElementById('fullmap-canvas');
  if (fullmapCanvas) {
    fullmapCtx = fullmapCanvas.getContext('2d');
    // Set actual resolution to match CSS display size
    const rect = fullmapCanvas.getBoundingClientRect();
    fullmapCanvas.width = rect.width * (window.devicePixelRatio || 1);
    fullmapCanvas.height = rect.height * (window.devicePixelRatio || 1);
  }

  // Minimap click: open fullscreen instead of toggling zoom
  // Replace the existing click listener on minimapCanvas
```

Actually — the existing minimap click listener (line 116-118) toggles between local/overview. We need to change this to cycle through local → overview → fullscreen → local.

**Replace the existing minimap click handler** (the block at lines 116-118):

```js
    minimapCanvas.addEventListener('click', () => {
      minimapZoom = minimapZoom === 'local' ? 'overview' : 'local';
    });
```

With:

```js
    minimapCanvas.addEventListener('click', () => {
      if (minimapMode === 'local') {
        minimapMode = 'overview';
      } else if (minimapMode === 'overview') {
        openFullscreenMap();
      } else {
        minimapMode = 'local';
      }
    });
```

**Step 3: Add fullscreen open/close functions and tap handler**

After the `getActiveWaypoint()` function, add:

```js
function openFullscreenMap() {
  minimapMode = 'fullscreen';
  const overlay = document.getElementById('minimap-fullscreen');
  const backdrop = document.getElementById('fullmap-backdrop');
  if (overlay) overlay.style.display = '';
  if (backdrop) backdrop.style.display = '';

  // Size canvas to actual pixel resolution
  if (fullmapCanvas) {
    const rect = fullmapCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    fullmapCanvas.width = Math.round(rect.width * dpr);
    fullmapCanvas.height = Math.round(rect.height * dpr);
    if (fullmapCtx) fullmapCtx.scale(dpr, dpr);
  }

  // Close button
  const closeBtn = document.querySelector('.fullmap-close');
  if (closeBtn) closeBtn.onclick = closeFullscreenMap;

  // Backdrop click to close
  if (backdrop) backdrop.onclick = closeFullscreenMap;

  // Tap on canvas to place/remove waypoint
  if (fullmapCanvas) {
    fullmapCanvas.onclick = (e) => {
      const rect = fullmapCanvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const cssW = rect.width;
      const cssH = rect.height;

      // Convert canvas coords to world coords (world-centered map)
      const fullViewRange = 28000;
      const worldX = (cx / cssW - 0.5) * fullViewRange;
      const worldZ = (cy / cssH - 0.5) * fullViewRange;

      // Try to remove an existing waypoint first (hit radius in world units)
      const hitRadius = fullViewRange / cssW * 20; // ~20px hit zone
      if (!removeWaypointAt(worldX, worldZ, hitRadius)) {
        addWaypoint(worldX, worldZ);
      }
    };
  }
}

function closeFullscreenMap() {
  minimapMode = 'local';
  const overlay = document.getElementById('minimap-fullscreen');
  const backdrop = document.getElementById('fullmap-backdrop');
  if (overlay) overlay.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
}
```

**Step 4: Add Escape key listener for closing**

In `initHUD()`, add:

```js
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && minimapMode === 'fullscreen') {
      closeFullscreenMap();
    }
  });
```

**Step 5: Update all references from `minimapZoom` to `minimapMode`**

In `updateMinimap()`, replace all occurrences of `minimapZoom` with `minimapMode`. There are 4 occurrences:
- Line ~701: `const refreshInterval = minimapMode === 'local' ? 100 : 250;`
- Line ~713: `const viewRange = minimapMode === 'local' ? 4000 : 20000;`
- Line ~717: `if (minimapMode === 'overview' && terrainImage) {`
- Line ~863: `ctx.fillText(minimapMode === 'local' ? 'LOCAL' : 'OVERVIEW', w - 4, h - 3);`

**Step 6: Add fullscreen map rendering**

Add a new function after `updateMinimap()`:

```js
function updateFullscreenMap() {
  if (minimapMode !== 'fullscreen' || !fullmapCtx || !fullmapCanvas) return;

  const ctx = fullmapCtx;
  const dpr = window.devicePixelRatio || 1;
  const cssW = fullmapCanvas.width / dpr;
  const cssH = fullmapCanvas.height / dpr;
  const w = cssW;
  const h = cssH;

  const fullViewRange = 28000;
  const scale = w / fullViewRange;

  // World-centered: (0,0) is center of the map
  const centerX = 0;
  const centerZ = 0;

  // Background terrain
  if (terrainImage) {
    // Terrain image covers 20000m centered at origin; fullscreen covers 28000m
    const terrainPx = (20000 / fullViewRange) * w;
    const offset = (w - terrainPx) / 2;
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(terrainImage, offset, offset, terrainPx, terrainPx);
    ctx.fillStyle = 'rgba(0, 8, 20, 0.25)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, w, h);
  }

  // Ocean east of coastline
  const coastPx = (COAST_LINE_X / fullViewRange + 0.5) * w;
  if (coastPx < w) {
    ctx.fillStyle = 'rgba(15, 30, 60, 0.5)';
    ctx.fillRect(coastPx, 0, w - coastPx, h);
    ctx.strokeStyle = 'rgba(40, 120, 200, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(coastPx, 0);
    ctx.lineTo(coastPx, h);
    ctx.stroke();
  }

  const toX = (wx) => (wx / fullViewRange + 0.5) * w;
  const toY = (wz) => (wz / fullViewRange + 0.5) * h;

  // Grid
  ctx.strokeStyle = 'rgba(120, 180, 255, 0.06)';
  ctx.lineWidth = 0.5;
  const gridStep = 2000;
  for (let g = -14000; g <= 14000; g += gridStep) {
    const sx = toX(g);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    const sy = toY(g);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }

  // Airport 1 runway
  const rw1 = RUNWAY_WIDTH * scale;
  const rl1 = RUNWAY_LENGTH * scale;
  ctx.fillStyle = 'rgba(140, 140, 140, 0.8)';
  ctx.fillRect(toX(0) - rw1/2, toY(-RUNWAY_LENGTH/2), rw1, rl1);

  // Airport 2 runway
  ctx.fillRect(toX(AIRPORT2_X) - rw1/2, toY(AIRPORT2_Z - RUNWAY_LENGTH/2), rw1, rl1);

  // International airport runway
  const intlRw = INTL_RUNWAY_WIDTH * scale;
  const intlRl = INTL_RUNWAY_LENGTH * scale;
  ctx.fillRect(toX(INTL_AIRPORT_X) - intlRw/2, toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2), intlRw, intlRl);

  // City zones
  ctx.fillStyle = 'rgba(60, 60, 80, 0.4)';
  const cityHalf = CITY_SIZE / 2;
  ctx.fillRect(toX(CITY_CENTER_X - cityHalf), toY(CITY_CENTER_Z - cityHalf), CITY_SIZE * scale, CITY_SIZE * scale);
  ctx.fillRect(toX(CT_CENTER_X - CT_SIZE_X/2), toY(CT_CENTER_Z - CT_SIZE_Z/2), CT_SIZE_X * scale, CT_SIZE_Z * scale);

  // Highway
  const hwPath = getHighwayPath();
  if (hwPath && hwPath.points) {
    ctx.strokeStyle = 'rgba(140, 140, 140, 0.5)';
    ctx.lineWidth = Math.max(1, 14 * scale);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < hwPath.points.length; i += 3) {
      const pt = hwPath.points[i];
      const sx = toX(pt.x);
      const sy = toY(pt.z);
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // Lighthouse
  ctx.fillStyle = 'rgba(255, 220, 100, 0.8)';
  ctx.beginPath();
  ctx.arc(toX(13000), toY(-200), 3, 0, Math.PI * 2);
  ctx.fill();

  // Waypoints
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const wpx = toX(wp.x);
    const wpy = toY(wp.z);
    const isActive = i === activeWaypointIdx;
    const size = isActive ? 7 : 5;
    ctx.fillStyle = isActive ? '#ff6644' : 'rgba(255, 100, 68, 0.6)';
    ctx.beginPath();
    ctx.moveTo(wpx, wpy - size);
    ctx.lineTo(wpx + size, wpy);
    ctx.lineTo(wpx, wpy + size);
    ctx.lineTo(wpx - size, wpy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = isActive ? '#ffaa88' : 'rgba(255, 170, 136, 0.7)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(wp.label, wpx, wpy - size - 4);
  }

  // Dashed line to active waypoint from aircraft
  const v = getActiveVehicle();
  if (waypoints.length > 0 && activeWaypointIdx < waypoints.length) {
    const awp = waypoints[activeWaypointIdx];
    ctx.strokeStyle = 'rgba(255, 100, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(v.position.x), toY(v.position.z));
    ctx.lineTo(toX(awp.x), toY(awp.z));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Aircraft dot
  const acx = toX(v.position.x);
  const acy = toY(v.position.z);
  ctx.fillStyle = '#44ff66';
  ctx.beginPath();
  ctx.arc(acx, acy, 4, 0, Math.PI * 2);
  ctx.fill();

  // Heading line
  const hdgRad = (v.heading * Math.PI) / 180;
  ctx.strokeStyle = '#44ff66';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(acx, acy);
  ctx.lineTo(acx - Math.sin(hdgRad) * 20, acy - Math.cos(hdgRad) * 20);
  ctx.stroke();

  // Labels
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200, 200, 255, 0.9)';
  ctx.fillText('APT1', toX(0), toY(-RUNWAY_LENGTH/2 - 120));
  ctx.fillText('APT2', toX(AIRPORT2_X), toY(AIRPORT2_Z - RUNWAY_LENGTH/2 - 120));
  ctx.fillText('INTL', toX(INTL_AIRPORT_X), toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2 - 120));
  ctx.fillStyle = 'rgba(200, 180, 140, 0.9)';
  ctx.fillText('CITY', toX(CITY_CENTER_X), toY(CITY_CENTER_Z - cityHalf - 60));
  ctx.fillText('BAYVIEW', toX(CT_CENTER_X), toY(CT_CENTER_Z - CT_SIZE_Z/2 - 60));

  // Compass
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
  ctx.fillText('N', w / 2, 14);
  ctx.fillStyle = 'rgba(180, 180, 220, 0.5)';
  ctx.fillText('S', w / 2, h - 6);
  ctx.fillText('W', 10, h / 2 + 4);
  ctx.fillText('E', w - 10, h / 2 + 4);

  // Scale bar
  const scaleBarM = 5000;
  const scaleBarPx = scaleBarM * scale;
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, h - 20);
  ctx.lineTo(12 + scaleBarPx, h - 20);
  ctx.stroke();
  ctx.fillStyle = 'rgba(160, 200, 255, 0.5)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('5km', 12, h - 10);
}
```

**Step 7: Call `updateFullscreenMap()` from `updateHUD()`**

At the end of `updateHUD()`, add:

```js
  updateFullscreenMap();
```

**Step 8: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 9: Commit**

```
git add src/hud.js
git commit -m "feat(minimap): fullscreen world-centered map with waypoint placement"
```

---

### Task 7: Show Minimap on Mobile + Final Polish

**Files:**
- Modify: `style.css` — remove the mobile minimap hide rule

**Step 1: Show minimap on touch devices**

The current CSS at line 1577 hides the minimap on mobile:

```css
  #minimap-panel { display: none; }
```

Change this to show it but make it smaller:

```css
  #minimap-panel {
    top: auto;
    bottom: 8px;
    right: 8px;
    padding: 4px;
  }

  #minimap-canvas {
    width: 100px;
    height: 100px;
  }
```

**Step 2: Add portrait minimap positioning**

In the existing portrait media query, add:

```css
  #minimap-panel {
    top: auto;
    bottom: calc(4vh + 30vw);
    left: 3vw;
    right: auto;
    padding: 3px;
  }

  #minimap-canvas {
    width: 80px;
    height: 80px;
  }
```

**Step 3: Verify build**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Commit**

```
git add style.css
git commit -m "feat(minimap): show minimap on mobile, responsive sizing"
```

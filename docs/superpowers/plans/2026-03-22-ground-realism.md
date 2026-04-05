# Ground Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded flat city grid and inconsistent vehicle systems with a data-driven city model where districts drive road layout, buildings, traffic, pedestrians, and day/night behavior.

**Architecture:** District definitions generate a 3D road graph with elevation. Buildings, intersections, traffic, pedestrians, and street furniture all derive from this graph. One unified vehicle system replaces three inconsistent ones. A spatial grid hash makes road elevation queries O(1) for the hot physics path.

**Tech Stack:** Three.js (InstancedMesh, BufferGeometry, CanvasTexture), Vite, vitest (new — for logic modules)

**Spec:** `docs/superpowers/specs/2026-03-22-ground-realism-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/cityData.js` | District definitions, building pools, activity multiplier schedules |
| `src/roadGraph.js` | Road graph generation, node/edge schemas, spatial grid index, A* pathfinding, `getRoadNetwork()` compat |
| `src/intersections.js` | Traffic signal state machine, signal type assignment per intersection |
| `src/cityBuildings.js` | District-aware building generation, merged BufferGeometry, LOD, window emissive |
| `src/streetFurniture.js` | Street lights, signs, bus stops, power lines, furniture placement + InstancedMesh |
| `src/cityTrafficUnified.js` | Unified vehicle traffic: movement, lanes, signals, spawning, fixed timestep interpolation |
| `src/pedestrians.js` | Pedestrian sprite atlas, billboard rendering, sidewalk/crosswalk behavior |
| `tests/cityData.test.js` | Tests for district logic, activity multipliers |
| `tests/roadGraph.test.js` | Tests for graph generation, spatial index, elevation queries, pathfinding |
| `tests/intersections.test.js` | Tests for signal state machine, phase transitions |
| `vitest.config.js` | Vitest configuration |

### Modified Files
| File | Changes |
|------|---------|
| `src/city.js` | Gut `buildRoads()`, `generatePlacements()`, building generation. Rewire to orchestrate new modules. Re-export `getRoadNetwork()` from roadGraph.js. Add `disposeCity()`. |
| `src/terrain.js` | Update `getGroundLevel()` to query road graph spatial index for city roads. Keep highway corridor check for non-city areas. |
| `src/carPhysics.js` | No code changes needed — already uses `getGroundLevel()` which will be updated in terrain.js. |
| `src/carSpawn.js` | Update spawn location to pick from road graph edge instead of hardcoded position. |
| `src/hud.js` | No code changes needed — imports `getRoadNetwork()` from city.js which will re-export from roadGraph.js with compatible format. |
| `src/main.js` | Update imports (add new modules, remove cityTraffic/highwayTraffic), update init order, update game loop. |
| `package.json` | Add vitest dev dependency. |

### Deleted Files
| File | Replaced By |
|------|-------------|
| `src/cityTraffic.js` | `src/cityTrafficUnified.js` |
| `src/highwayTraffic.js` | `src/cityTrafficUnified.js` |

---

## Task 1: Add Test Framework

**Files:**
- Create: `vitest.config.js`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.js`:
```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

```bash
npx vitest run
```
Expected: "No test files found" (success — framework works, no tests yet).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js package.json package-lock.json
git commit -m "chore: add vitest test framework"
```

---

## Task 2: City Data Module

**Files:**
- Create: `src/cityData.js`
- Create: `tests/cityData.test.js`

This is the foundation — district definitions, building pools, and the activity multiplier that drives day/night behavior. Pure data + logic, no rendering.

- [ ] **Step 1: Write tests for district data and activity multiplier**

Create `tests/cityData.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import {
  DISTRICTS,
  getDistrictAt,
  getActivityMultiplier,
  BUILDING_POOLS,
} from '../src/cityData.js';

describe('DISTRICTS', () => {
  it('has 5 districts', () => {
    expect(DISTRICTS).toHaveLength(5);
  });

  it('each district has required fields', () => {
    for (const d of DISTRICTS) {
      expect(d).toHaveProperty('type');
      expect(d).toHaveProperty('center');
      expect(d).toHaveProperty('radius');
      expect(d).toHaveProperty('priority');
      expect(d).toHaveProperty('density');
      expect(d).toHaveProperty('maxHeight');
      expect(d).toHaveProperty('traffic');
      expect(d).toHaveProperty('pedestrians');
    }
  });

  it('priorities are unique', () => {
    const priorities = DISTRICTS.map(d => d.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe('getDistrictAt', () => {
  it('returns downtown at city center', () => {
    const d = getDistrictAt(4000, -4000);
    expect(d.type).toBe('downtown');
  });

  it('returns residential at residential center', () => {
    const d = getDistrictAt(3500, -4300);
    expect(d.type).toBe('residential');
  });

  it('higher priority district wins in overlap zone', () => {
    // Downtown (priority 1) should win over residential (priority 5)
    // if a point is within both radii
    const d = getDistrictAt(3700, -4100); // between downtown and residential
    expect(d.priority).toBeLessThanOrEqual(5);
  });

  it('defaults to residential for uncovered areas', () => {
    // Far corner of city footprint, likely not covered by any circle
    const d = getDistrictAt(3050, -3050);
    expect(d.type).toBe('residential');
  });

  it('returns null outside city footprint', () => {
    const d = getDistrictAt(0, 0);
    expect(d).toBeNull();
  });
});

describe('getActivityMultiplier', () => {
  it('downtown has heavy traffic at midday', () => {
    const m = getActivityMultiplier('downtown', 12);
    expect(m.trafficMultiplier).toBeGreaterThan(0.5);
    expect(m.pedestrianDensity).toBeGreaterThan(0);
  });

  it('residential has low traffic at night', () => {
    const m = getActivityMultiplier('residential', 2);
    expect(m.trafficMultiplier).toBeLessThan(0.3);
    expect(m.pedestrianDensity).toBeLessThan(5);
  });

  it('returns windowEmissive between 0 and 1', () => {
    const m = getActivityMultiplier('downtown', 22);
    expect(m.windowEmissive).toBeGreaterThanOrEqual(0);
    expect(m.windowEmissive).toBeLessThanOrEqual(1);
  });

  it('morning rush has high inbound multiplier', () => {
    const m = getActivityMultiplier('downtown', 8);
    expect(m.inboundMultiplier).toBeGreaterThan(1);
  });
});

describe('BUILDING_POOLS', () => {
  it('has a pool for every district type', () => {
    for (const d of DISTRICTS) {
      expect(BUILDING_POOLS[d.type]).toBeDefined();
      expect(BUILDING_POOLS[d.type].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/cityData.test.js
```
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement cityData.js**

Create `src/cityData.js`:
```javascript
// ── City Data Model ─────────────────────────────────────────────────
// District definitions, building pools, and activity schedules.
// Pure data + logic — no Three.js rendering code.

const CITY_MIN_X = 3000, CITY_MAX_X = 5000;
const CITY_MIN_Z = -5000, CITY_MAX_Z = -3000;

export const DISTRICTS = [
  { type: 'downtown',    center: [4000, -4000], radius: 600,  priority: 1, density: 1.0, maxHeight: 90, traffic: 'heavy',       pedestrians: 'heavy',  blockSize: 80  },
  { type: 'commercial',  center: [4400, -3600], radius: 400,  priority: 2, density: 0.7, maxHeight: 45, traffic: 'medium',      pedestrians: 'medium', blockSize: 100 },
  { type: 'waterfront',  center: [4800, -3800], radius: 300,  priority: 3, density: 0.3, maxHeight: 12, traffic: 'light',       pedestrians: 'heavy',  blockSize: 120 },
  { type: 'industrial',  center: [4600, -4600], radius: 400,  priority: 4, density: 0.5, maxHeight: 20, traffic: 'heavy_truck', pedestrians: 'sparse', blockSize: 200 },
  { type: 'residential', center: [3500, -4300], radius: 600,  priority: 5, density: 0.4, maxHeight: 15, traffic: 'light',       pedestrians: 'light',  blockSize: 140 },
];

const DEFAULT_DISTRICT = {
  type: 'residential', center: [4000, -4000], radius: 9999,
  priority: 99, density: 0.2, maxHeight: 10, traffic: 'light',
  pedestrians: 'sparse', blockSize: 160,
};

export function isInCityBounds(x, z) {
  return x >= CITY_MIN_X && x <= CITY_MAX_X && z >= CITY_MIN_Z && z <= CITY_MAX_Z;
}

export function getDistrictAt(x, z) {
  if (!isInCityBounds(x, z)) return null;

  let best = null;
  for (const d of DISTRICTS) {
    const dx = x - d.center[0];
    const dz = z - d.center[1];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= d.radius) {
      if (!best || d.priority < best.priority) best = d;
    }
  }
  return best || DEFAULT_DISTRICT;
}

// ── Building Pools ──────────────────────────────────────────────────

export const BUILDING_POOLS = {
  downtown: [
    { name: 'office_tower',  minH: 40, maxH: 90, style: 'glass',     setback: 0 },
    { name: 'hotel',         minH: 30, maxH: 70, style: 'glass',     setback: 0 },
    { name: 'bank',          minH: 25, maxH: 50, style: 'stone',     setback: 0 },
    { name: 'mixed_use',     minH: 20, maxH: 60, style: 'glass',     setback: 0 },
  ],
  commercial: [
    { name: 'retail',        minH: 8,  maxH: 15, style: 'storefront', setback: 1 },
    { name: 'restaurant',    minH: 6,  maxH: 10, style: 'storefront', setback: 1 },
    { name: 'parking_garage',minH: 12, maxH: 30, style: 'concrete',  setback: 0 },
    { name: 'mall',          minH: 10, maxH: 20, style: 'storefront', setback: 2 },
  ],
  residential: [
    { name: 'house',         minH: 6,  maxH: 9,  style: 'house',     setback: 4 },
    { name: 'apartment',     minH: 10, maxH: 15, style: 'apartment', setback: 2 },
    { name: 'condo',         minH: 8,  maxH: 12, style: 'apartment', setback: 3 },
  ],
  industrial: [
    { name: 'warehouse',     minH: 8,  maxH: 14, style: 'metal',     setback: 2 },
    { name: 'factory',       minH: 10, maxH: 18, style: 'metal',     setback: 1 },
    { name: 'silo',          minH: 12, maxH: 20, style: 'concrete',  setback: 2 },
    { name: 'loading_dock',  minH: 6,  maxH: 10, style: 'metal',     setback: 0 },
  ],
  waterfront: [
    { name: 'cafe',          minH: 4,  maxH: 8,  style: 'nautical',  setback: 1 },
    { name: 'marina_office', minH: 6,  maxH: 10, style: 'nautical',  setback: 2 },
    { name: 'boardwalk_shop',minH: 4,  maxH: 7,  style: 'nautical',  setback: 0 },
  ],
};

// ── Activity Schedules ──────────────────────────────────────────────
// Returns multipliers for traffic, pedestrians, window emissive based on
// district type and time of day (0-24 float).

const ACTIVITY = {
  downtown: {
    traffic:     [0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.8, 1.0, 0.9, 0.8, 0.8, 0.7, 0.8, 0.8, 0.9, 1.0, 0.8, 0.5, 0.3, 0.2, 0.15, 0.1, 0.1],
    pedestrians: [3,   2,   2,   2,   2,   5,   10,  20,  30,  28,  25,  25,  20,  25,  25,  28,  30,  25,  15,  8,   5,   3,    3,   3  ],
    windows:     [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.6, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.7, 0.5, 0.3, 0.2, 0.15, 0.1],
    inbound:     [1,   1,   1,   1,   1,   1.2, 1.5, 2.5, 3.0, 2.0, 1.2, 1.0, 1.0, 1.0, 1.0, 1.2, 0.5, 0.5, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
  commercial: {
    traffic:     [0.05,0.05,0.05,0.05,0.05,0.1, 0.2, 0.4, 0.6, 0.7, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8, 0.7, 0.6, 0.7, 0.8, 0.6, 0.3, 0.1, 0.05],
    pedestrians: [2,   2,   2,   2,   2,   3,   5,   10,  15,  18,  20,  20,  18,  20,  20,  20,  18,  20,  25,  25,  15,  8,   3,   2  ],
    windows:     [0.05,0.05,0.05,0.05,0.05,0.05,0.1, 0.3, 0.7, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.5, 0.2, 0.1, 0.05],
    inbound:     [1,   1,   1,   1,   1,   1,   1.2, 1.5, 1.5, 1.2, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.2, 1.5, 1.5, 1.2, 1.0, 1.0, 1.0, 1.0],
  },
  residential: {
    traffic:     [0.05,0.05,0.05,0.05,0.05,0.1, 0.3, 0.6, 0.4, 0.2, 0.15,0.15,0.15,0.15,0.15,0.2, 0.4, 0.6, 0.4, 0.2, 0.1, 0.08, 0.05, 0.05],
    pedestrians: [2,   2,   2,   2,   2,   3,   5,   8,   6,   5,   5,   5,   5,   5,   5,   6,   8,   12,  12,  8,   5,   3,   2,   2  ],
    windows:     [0.05,0.05,0.05,0.05,0.05,0.1, 0.2, 0.3, 0.15,0.1, 0.05,0.05,0.05,0.05,0.05,0.1, 0.2, 0.4, 0.6, 0.8, 0.7, 0.5, 0.2, 0.1],
    inbound:     [1,   1,   1,   1,   1,   1,   0.5, 0.3, 0.5, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 2.5, 1.5, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
  industrial: {
    traffic:     [0.05,0.05,0.05,0.05,0.05,0.2, 0.5, 0.8, 0.9, 0.9, 0.8, 0.8, 0.7, 0.8, 0.8, 0.7, 0.5, 0.2, 0.1, 0.05,0.05,0.05,0.05,0.05],
    pedestrians: [1,   1,   1,   1,   1,   3,   8,   10,  10,  10,  10,  10,  8,   10,  10,  10,  5,   2,   1,   1,   1,   1,   1,   1  ],
    windows:     [0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.5, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    inbound:     [1,   1,   1,   1,   1,   1.5, 2.0, 2.0, 1.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.5, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
  waterfront: {
    traffic:     [0.05,0.05,0.05,0.05,0.05,0.05,0.1, 0.15,0.2, 0.25,0.3, 0.3, 0.3, 0.3, 0.3, 0.35,0.4, 0.5, 0.6, 0.5, 0.3, 0.15,0.08,0.05],
    pedestrians: [2,   2,   2,   2,   2,   3,   5,   8,   10,  12,  15,  15,  12,  15,  15,  15,  18,  20,  20,  15,  8,   4,   2,   2  ],
    windows:     [0.05,0.05,0.05,0.05,0.05,0.05,0.1, 0.2, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.8, 0.7, 0.4, 0.2, 0.1, 0.05],
    inbound:     [1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1.2, 1.5, 1.5, 1.2, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
};

function lerpSchedule(arr, hour) {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const f = h - i;
  return arr[i] * (1 - f) + arr[(i + 1) % 24] * f;
}

export function getActivityMultiplier(districtType, timeOfDay) {
  const sched = ACTIVITY[districtType];
  if (!sched) return { trafficMultiplier: 0.1, pedestrianDensity: 1, windowEmissive: 0, inboundMultiplier: 1 };

  return {
    trafficMultiplier: lerpSchedule(sched.traffic, timeOfDay),
    pedestrianDensity: Math.round(lerpSchedule(sched.pedestrians, timeOfDay)),
    windowEmissive: lerpSchedule(sched.windows, timeOfDay),
    inboundMultiplier: lerpSchedule(sched.inbound, timeOfDay),
  };
}

// ── Vehicle Type Definitions ────────────────────────────────────────

export const VEHICLE_TYPES = {
  sedan:        { speed: [30, 60],  accel: 3.0, brakeDecel: 6.0, length: 4.5, width: 1.8, height: 0.5, districts: null },
  suv:          { speed: [30, 60],  accel: 2.5, brakeDecel: 5.5, length: 5.0, width: 2.0, height: 0.6, districts: ['residential', 'commercial'] },
  truck:        { speed: [25, 50],  accel: 1.5, brakeDecel: 4.0, length: 6.0, width: 2.2, height: 0.8, districts: ['industrial'] },
  semi:         { speed: [40, 80],  accel: 1.0, brakeDecel: 3.0, length: 12,  width: 2.5, height: 1.0, districts: ['industrial'], highwayOnly: false, preferRight: true },
  bus:          { speed: [20, 40],  accel: 1.5, brakeDecel: 4.5, length: 12,  width: 2.5, height: 1.0, districts: null, stopsAtBusStops: true },
  taxi:         { speed: [30, 50],  accel: 3.0, brakeDecel: 6.0, length: 4.5, width: 1.8, height: 0.5, districts: ['downtown', 'commercial'], curbStops: true },
  emergency:    { speed: [40, 100], accel: 4.0, brakeDecel: 8.0, length: 5.5, width: 2.0, height: 0.7, districts: null, runsRedLights: true, hasSiren: true },
  construction: { speed: [15, 30],  accel: 1.0, brakeDecel: 3.0, length: 6.0, width: 2.5, height: 1.2, districts: null, hasFlashers: true },
};

// ── Constants ───────────────────────────────────────────────────────

export const CITY_BOUNDS = { minX: CITY_MIN_X, maxX: CITY_MAX_X, minZ: CITY_MIN_Z, maxZ: CITY_MAX_Z };
export const MAX_ACTIVE_VEHICLES = 120;
export const MAX_PEDESTRIANS = 100;
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/cityData.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cityData.js tests/cityData.test.js
git commit -m "feat: add city data model with districts, building pools, and activity schedules"
```

---

## Task 3: Road Graph — Core Data Structures & Spatial Index

**Files:**
- Create: `src/roadGraph.js`
- Create: `tests/roadGraph.test.js`

Build the graph data structure, spatial grid hash, and elevation query. No generation algorithm yet — just the container and query infrastructure.

- [ ] **Step 1: Write tests for core graph operations and spatial index**

Create `tests/roadGraph.test.js`:
```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGraph,
  addNode,
  addEdge,
  getNode,
  getEdge,
  getEdgesFromNode,
  buildSpatialIndex,
  queryRoadElevation,
  getNodesInArea,
} from '../src/roadGraph.js';

describe('Graph core', () => {
  let g;
  beforeEach(() => { g = createGraph(); });

  it('adds and retrieves nodes', () => {
    addNode(g, { id: 0, x: 4000, y: 5, z: -4000 });
    const n = getNode(g, 0);
    expect(n.x).toBe(4000);
    expect(n.y).toBe(5);
  });

  it('adds edges between nodes', () => {
    addNode(g, { id: 0, x: 4000, y: 5, z: -4000 });
    addNode(g, { id: 1, x: 4100, y: 6, z: -4000 });
    addEdge(g, { id: 0, from: 0, to: 1, lanes: 2, width: 8, type: 'local', speedLimit: 30, sidewalks: true, parking: 'none', district: 'downtown' });
    expect(getEdge(g, 0).from).toBe(0);
    expect(getEdge(g, 0).to).toBe(1);
  });

  it('finds edges from a node', () => {
    addNode(g, { id: 0, x: 4000, y: 5, z: -4000 });
    addNode(g, { id: 1, x: 4100, y: 6, z: -4000 });
    addNode(g, { id: 2, x: 4000, y: 5, z: -3900 });
    addEdge(g, { id: 0, from: 0, to: 1, lanes: 2, width: 8, type: 'local', speedLimit: 30, sidewalks: true, parking: 'none', district: 'downtown' });
    addEdge(g, { id: 1, from: 0, to: 2, lanes: 2, width: 8, type: 'local', speedLimit: 30, sidewalks: true, parking: 'none', district: 'downtown' });
    const edges = getEdgesFromNode(g, 0);
    expect(edges).toHaveLength(2);
  });
});

describe('Spatial index', () => {
  let g;
  beforeEach(() => {
    g = createGraph();
    // Two nodes forming a road edge at known positions
    addNode(g, { id: 0, x: 4000, y: 5.0, z: -4000 });
    addNode(g, { id: 1, x: 4100, y: 7.0, z: -4000 });
    addEdge(g, { id: 0, from: 0, to: 1, lanes: 2, width: 10, type: 'arterial', speedLimit: 50, sidewalks: true, parking: 'none', district: 'downtown' });
    buildSpatialIndex(g);
  });

  it('returns elevation on road centerline', () => {
    const result = queryRoadElevation(g, 4050, -4000);
    expect(result).not.toBeNull();
    // Midpoint: lerp(5.0, 7.0, 0.5) = 6.0
    expect(result.elevation).toBeCloseTo(6.0, 0.5);
  });

  it('returns null far from any road', () => {
    const result = queryRoadElevation(g, 3000, -3000);
    expect(result).toBeNull();
  });

  it('returns null outside city bounds', () => {
    const result = queryRoadElevation(g, 0, 0);
    expect(result).toBeNull();
  });

  it('returns edge info for point near road', () => {
    const result = queryRoadElevation(g, 4050, -3997); // 3m off centerline, within 10m width
    expect(result).not.toBeNull();
    expect(result.edgeId).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/roadGraph.test.js
```
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement roadGraph.js core**

Create `src/roadGraph.js` with the following exports:
- `createGraph()` — returns `{ nodes: Map, edges: Map, adjacency: Map, spatialGrid: null }`
- `addNode(graph, node)` — adds node to graph.nodes and graph.adjacency. Initializes `node.edges = []` if not present.
- `addEdge(graph, edge)` — adds edge to graph.edges, updates adjacency for both from/to, AND pushes `edge.id` onto `graph.nodes.get(edge.from).edges` and `graph.nodes.get(edge.to).edges` so each node tracks its connected edges directly
- `getNode(graph, id)`, `getEdge(graph, id)`, `getEdgesFromNode(graph, nodeId)`
- `buildSpatialIndex(graph)` — rasterizes all edges into 20m grid cells covering city bounds (3000→5000 X, -5000→-3000 Z)
- `queryRoadElevation(graph, x, z)` — O(1) lookup: hash → cell → check 1-3 edges → closest within half-width → interpolate elevation. Returns `{ elevation, edgeId, t }` or `null`.
- `getNodesInArea(graph, minX, maxX, minZ, maxZ)` — returns all nodes within bounds

Key implementation details for spatial index:
```javascript
const CELL_SIZE = 20;
const GRID_ORIGIN_X = 3000;
const GRID_ORIGIN_Z = -5000;
const GRID_COLS = 100; // (5000 - 3000) / 20
const GRID_ROWS = 100; // (-3000 - -5000) / 20

function cellKey(cx, cz) { return cz * GRID_COLS + cx; }

function rasterizeEdge(graph, edge) {
  const nFrom = graph.nodes.get(edge.from);
  const nTo = graph.nodes.get(edge.to);
  // Walk along edge in CELL_SIZE/2 steps, mark each cell
  const dx = nTo.x - nFrom.x, dz = nTo.z - nFrom.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(len / (CELL_SIZE * 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = nFrom.x + dx * t;
    const z = nFrom.z + dz * t;
    const cx = Math.floor((x - GRID_ORIGIN_X) / CELL_SIZE);
    const cz = Math.floor((z - GRID_ORIGIN_Z) / CELL_SIZE);
    if (cx >= 0 && cx < GRID_COLS && cz >= 0 && cz < GRID_ROWS) {
      const key = cellKey(cx, cz);
      if (!graph.spatialGrid.has(key)) graph.spatialGrid.set(key, []);
      const arr = graph.spatialGrid.get(key);
      if (!arr.includes(edge.id)) arr.push(edge.id);
    }
  }
}
```

For `queryRoadElevation`:
```javascript
export function queryRoadElevation(graph, x, z) {
  if (!graph.spatialGrid) return null;
  if (x < GRID_ORIGIN_X || x > GRID_ORIGIN_X + GRID_COLS * CELL_SIZE) return null;
  if (z < GRID_ORIGIN_Z || z > GRID_ORIGIN_Z + GRID_ROWS * CELL_SIZE) return null;

  const cx = Math.floor((x - GRID_ORIGIN_X) / CELL_SIZE);
  const cz = Math.floor((z - GRID_ORIGIN_Z) / CELL_SIZE);
  const key = cellKey(cx, cz);
  const edgeIds = graph.spatialGrid.get(key);
  if (!edgeIds || edgeIds.length === 0) return null;

  let bestDist = Infinity, bestResult = null;
  for (const eid of edgeIds) {
    const edge = graph.edges.get(eid);
    const nFrom = graph.nodes.get(edge.from);
    const nTo = graph.nodes.get(edge.to);
    // Project point onto edge segment
    const ex = nTo.x - nFrom.x, ez = nTo.z - nFrom.z;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - nFrom.x) * ex + (z - nFrom.z) * ez) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = nFrom.x + ex * t, pz = nFrom.z + ez * t;
    const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    if (dist < edge.width * 0.5 && dist < bestDist) {
      bestDist = dist;
      const elevation = nFrom.y + (nTo.y - nFrom.y) * t;
      bestResult = { elevation, edgeId: eid, t, dist };
    }
  }
  return bestResult;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/roadGraph.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/roadGraph.js tests/roadGraph.test.js
git commit -m "feat: road graph core with spatial index and elevation queries"
```

---

## Task 4: Road Graph — Generation Algorithm

**Files:**
- Modify: `src/roadGraph.js`
- Modify: `tests/roadGraph.test.js`

Implement the district-driven road generation: Delaunay arterials, block grids, collector promotion, lot subdivision.

- [ ] **Step 1: Write tests for road generation**

Add to `tests/roadGraph.test.js`:
```javascript
import { generateCityRoadGraph } from '../src/roadGraph.js';

// Mock height function for testing (flat terrain at y=5)
const flatHeight = () => 5;

describe('Road generation', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('generates nodes', () => {
    expect(g.nodes.size).toBeGreaterThan(50);
  });

  it('generates edges', () => {
    expect(g.edges.size).toBeGreaterThan(50);
  });

  it('has arterial edges connecting district centers', () => {
    const arterials = [...g.edges.values()].filter(e => e.type === 'arterial');
    expect(arterials.length).toBeGreaterThan(3);
  });

  it('has local roads within districts', () => {
    const locals = [...g.edges.values()].filter(e => e.type === 'local');
    expect(locals.length).toBeGreaterThan(20);
  });

  it('has collector roads', () => {
    const collectors = [...g.edges.values()].filter(e => e.type === 'collector');
    expect(collectors.length).toBeGreaterThan(5);
  });

  it('all nodes are within city bounds', () => {
    for (const [, n] of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(3000);
      expect(n.x).toBeLessThanOrEqual(5000);
      expect(n.z).toBeGreaterThanOrEqual(-5000);
      expect(n.z).toBeLessThanOrEqual(-3000);
    }
  });

  it('all nodes have elevation sampled from height function', () => {
    for (const [, n] of g.nodes) {
      expect(n.y).toBe(5); // flatHeight returns 5
    }
  });

  it('generates building lots', () => {
    expect(g.lots).toBeDefined();
    expect(g.lots.length).toBeGreaterThan(50);
  });

  it('each lot has position, size, and district', () => {
    for (const lot of g.lots.slice(0, 10)) {
      expect(lot).toHaveProperty('x');
      expect(lot).toHaveProperty('z');
      expect(lot).toHaveProperty('width');
      expect(lot).toHaveProperty('depth');
      expect(lot).toHaveProperty('district');
    }
  });

  it('builds spatial index automatically', () => {
    expect(g.spatialGrid).not.toBeNull();
    expect(g.spatialGrid.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/roadGraph.test.js
```
Expected: FAIL — `generateCityRoadGraph` not defined.

- [ ] **Step 3: Implement generateCityRoadGraph**

Add to `src/roadGraph.js`:

`generateCityRoadGraph(getHeightAt)` — the main generation function:
1. Create empty graph
2. **Arterials**: Compute Delaunay triangulation of 5 district centers (simple — for 5 points, just compute all 10 pairwise connections, prune any > 1500m, deduplicate shared edges). For each arterial edge:
   - Sample terrain height at both endpoints via `getHeightAt(x, z)`
   - Add nodes at endpoints (dedup if already exists within 20m of existing node)
   - Add edge with `type: 'arterial'`, `lanes: 4`, `width: 16`, `speedLimit: 50`
3. **Block grids**: For each district, overlay a grid aligned to the nearest arterial direction:
   - Grid spacing = `district.blockSize`
   - Clip grid to district radius AND city bounds
   - At each grid intersection, add a node (sampled height)
   - Connect adjacent grid nodes with edges: `type: 'local'`, `lanes: 2`, `width: 8`, `speedLimit: 30`
4. **Collectors**: Every 2-3 block rows/cols, promote local edges to `type: 'collector'`, `lanes: 2`, `width: 10`, `speedLimit: 40`. Connect collectors to nearest arterial nodes.
5. **Lots**: For each block (rectangle between 4 grid nodes), subdivide into lots based on district type. Each lot: `{ x, z, width, depth, district, nearArterial }`. Store on `graph.lots`.
6. Build spatial index with `buildSpatialIndex(graph)`.
7. Return graph.

Seeded PRNG for deterministic generation (reuse the same seed pattern from existing `city.js`):
```javascript
let _seed = 54321;
function srand() { _seed = (_seed * 16807) % 2147483647; return (_seed & 0x7fffffff) / 0x7fffffff; }
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/roadGraph.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/roadGraph.js tests/roadGraph.test.js
git commit -m "feat: district-driven road graph generation with arterials, blocks, collectors, and lots"
```

---

## Task 5: Road Graph — Highway Expressway Edges

**Files:**
- Modify: `src/roadGraph.js`
- Modify: `tests/roadGraph.test.js`

Add expressway edges for the 3 highway routes, with on/off ramps.

- [ ] **Step 1: Write tests for expressway generation**

Add to `tests/roadGraph.test.js`:
```javascript
describe('Expressway edges', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('has expressway edges', () => {
    const expressways = [...g.edges.values()].filter(e => e.type === 'expressway');
    expect(expressways.length).toBeGreaterThan(5);
  });

  it('expressway edges have 6 lanes and 24m width', () => {
    const expressways = [...g.edges.values()].filter(e => e.type === 'expressway');
    for (const e of expressways) {
      expect(e.lanes).toBe(6);
      expect(e.width).toBe(24);
    }
  });

  it('has ramp edges connecting expressway to arterials', () => {
    const ramps = [...g.edges.values()].filter(e => e.type === 'ramp');
    expect(ramps.length).toBeGreaterThan(2);
  });

  it('ramp edges are single lane', () => {
    const ramps = [...g.edges.values()].filter(e => e.type === 'ramp');
    for (const r of ramps) {
      expect(r.lanes).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/roadGraph.test.js
```

- [ ] **Step 3: Implement expressway generation**

Add to `generateCityRoadGraph()` after step 4 (collectors):

5. **Expressways**: For each of the 3 highway routes (H1, H2, H3), convert the existing spline control points (from `terrain.js` constants) into graph nodes + edges:
   - Sample the spline at regular intervals (120m spacing)
   - For each sample: create node at `(x, getHeightAt(x, z) + 0.3, z)`
   - Connect consecutive nodes as expressway edges: `type: 'expressway'`, `lanes: 6`, `width: 24`, `speedLimit: 100`
   - Apply grade limiting: if slope between consecutive nodes exceeds 12%, adjust intermediate node heights
   - Clip expressway nodes to city footprint + 500m buffer (highways extend slightly beyond city)
   - For H2 (Cape Town spur): terminate at city boundary with `externalSpline: true` flag on the last node

6. **Ramps**: For each district, find the nearest expressway edge and the nearest arterial node. Create a ramp pair:
   - Off-ramp: new node on expressway → new node at arterial intersection. `type: 'ramp'`, `lanes: 1`, `width: 5`, `speedLimit: 40`
   - On-ramp: arterial intersection → expressway merge point. `type: 'ramp'`, `lanes: 1`, `width: 5`, `speedLimit: 40`, `merge: true`

Highway control points to use (import from constants or inline):
```javascript
const H1_POINTS = [[650,-2000],[250,-2300],[950,-2950],[1650,-3325],[2550,-3725],[3350,-4550],[4200,-5450]];
const H2_POINTS = [[4200,-5450],[5400,-6200],[6500,-5850],[7600,-5400]]; // terminates at city boundary
const H3_POINTS = [[4000,-4000],[3600,-3600],[3000,-3200],[2400,-2800],[1800,-2400]]; // toward intl airport
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/roadGraph.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/roadGraph.js tests/roadGraph.test.js
git commit -m "feat: add expressway edges and on/off ramps to road graph"
```

---

## Task 6: Road Graph — A* Pathfinding & Compatibility Export

**Files:**
- Modify: `src/roadGraph.js`
- Modify: `tests/roadGraph.test.js`

Add A* pathfinding (for vehicle routing) and the `getRoadNetwork()` compatibility export (for HUD map).

- [ ] **Step 1: Write tests**

Add to `tests/roadGraph.test.js`:
```javascript
import { findPath, getRoadNetworkCompat } from '../src/roadGraph.js';

describe('A* pathfinding', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('finds a path between two connected nodes', () => {
    const nodeIds = [...g.nodes.keys()];
    // Pick two nodes that should be connected
    const start = nodeIds[0];
    const end = nodeIds[Math.min(10, nodeIds.length - 1)];
    const path = findPath(g, start, end);
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(end);
  });

  it('returns null for unreachable nodes', () => {
    // Add isolated node
    addNode(g, { id: 99999, x: 0, y: 0, z: 0 });
    const path = findPath(g, 0, 99999);
    expect(path).toBeNull();
  });
});

describe('getRoadNetworkCompat', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('returns array of segments with start/end/width/type', () => {
    const segs = getRoadNetworkCompat(g);
    expect(segs.length).toBeGreaterThan(0);
    const seg = segs[0];
    expect(seg).toHaveProperty('start');
    expect(seg.start).toHaveProperty('x');
    expect(seg.start).toHaveProperty('z');
    expect(seg).toHaveProperty('end');
    expect(seg).toHaveProperty('width');
    expect(seg).toHaveProperty('type');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement A* and compatibility export**

A* implementation in `src/roadGraph.js`:
```javascript
export function findPath(graph, startId, endId) {
  const endNode = graph.nodes.get(endId);
  if (!endNode) return null;

  const open = new Map();   // nodeId -> { f, g, parent }
  const closed = new Map(); // nodeId -> parentId (preserves parent for path reconstruction)

  const startNode = graph.nodes.get(startId);
  if (!startNode) return null;

  const h = (n) => Math.sqrt((n.x - endNode.x) ** 2 + (n.z - endNode.z) ** 2);

  open.set(startId, { f: h(startNode), g: 0, parent: null });

  while (open.size > 0) {
    // Find lowest f in open set
    let currentId = null, currentF = Infinity;
    for (const [id, data] of open) {
      if (data.f < currentF) { currentF = data.f; currentId = id; }
    }
    if (currentId === endId) {
      // Reconstruct path through both open and closed maps
      const path = [];
      let id = endId;
      while (id !== null) {
        path.unshift(id);
        const openData = open.get(id);
        id = openData ? openData.parent : (closed.get(id) ?? null);
      }
      return path;
    }

    const currentData = open.get(currentId);
    open.delete(currentId);
    closed.set(currentId, currentData.parent); // store parent in closed map

    const edges = getEdgesFromNode(graph, currentId);
    for (const edge of edges) {
      const neighborId = edge.from === currentId ? edge.to : edge.from;
      if (closed.has(neighborId)) continue;

      const neighbor = graph.nodes.get(neighborId);
      const dx = neighbor.x - graph.nodes.get(currentId).x;
      const dz = neighbor.z - graph.nodes.get(currentId).z;
      const edgeCost = Math.sqrt(dx * dx + dz * dz);
      const gNew = currentData.g + edgeCost;

      const existing = open.get(neighborId);
      if (!existing || gNew < existing.g) {
        open.set(neighborId, { f: gNew + h(neighbor), g: gNew, parent: currentId });
      }
    }
  }
  return null; // unreachable
}
```

Compatibility export:
```javascript
let _roadNetworkCache = null;

export function getRoadNetworkCompat(graph) {
  if (_roadNetworkCache) return _roadNetworkCache;
  _roadNetworkCache = [...graph.edges.values()].map(e => {
    const nFrom = graph.nodes.get(e.from);
    const nTo = graph.nodes.get(e.to);
    return {
      start: { x: nFrom.x, z: nFrom.z },
      end: { x: nTo.x, z: nTo.z },
      width: e.width,
      type: e.type,
      direction: Math.atan2(nTo.z - nFrom.z, nTo.x - nFrom.x),
      lanes: e.lanes,
    };
  });
  return _roadNetworkCache;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/roadGraph.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/roadGraph.js tests/roadGraph.test.js
git commit -m "feat: add A* pathfinding and HUD-compatible road network export"
```

---

## Task 7: Intersection System

**Files:**
- Create: `src/intersections.js`
- Create: `tests/intersections.test.js`

Traffic signal state machine and signal type assignment.

- [ ] **Step 1: Write tests**

Create `tests/intersections.test.js`:
```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  assignSignalTypes,
  createSignalState,
  updateSignals,
  getSignalPhase,
  SIGNAL_TYPES,
} from '../src/intersections.js';

describe('Signal type assignment', () => {
  it('assigns traffic signal at arterial x arterial', () => {
    const type = assignSignalTypes('arterial', 'arterial');
    expect(type).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_FULL);
  });

  it('assigns simple signal at arterial x collector', () => {
    const type = assignSignalTypes('arterial', 'collector');
    expect(type).toBe(SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE);
  });

  it('assigns 4-way stop at collector x collector', () => {
    const type = assignSignalTypes('collector', 'collector');
    expect(type).toBe(SIGNAL_TYPES.FOUR_WAY_STOP);
  });

  it('assigns yield at local x local', () => {
    const type = assignSignalTypes('local', 'local');
    expect(type).toBe(SIGNAL_TYPES.YIELD);
  });
});

describe('Signal state machine', () => {
  it('starts at phase 0', () => {
    const signal = createSignalState('downtown');
    expect(signal.currentPhase).toBe(0);
  });

  it('advances phases over time', () => {
    const signal = createSignalState('downtown');
    // Downtown green phase = 35s
    updateSignals([signal], 36);
    expect(signal.currentPhase).toBeGreaterThan(0);
  });

  it('cycles back to phase 0', () => {
    const signal = createSignalState('residential');
    // Full residential cycle = 15+4+2+15+4+2 = 42s
    updateSignals([signal], 43);
    expect(signal.currentPhase).toBe(0);
  });

  it('reports correct direction state', () => {
    const signal = createSignalState('downtown');
    const phase = getSignalPhase(signal);
    // Phase 0 = NS green
    expect(phase.nsState).toBe('green');
    expect(phase.ewState).toBe('red');
  });

  it('yellow phase shows yellow', () => {
    const signal = createSignalState('downtown');
    // Advance past green (35s) into yellow
    updateSignals([signal], 35.5);
    const phase = getSignalPhase(signal);
    expect(phase.nsState).toBe('yellow');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement intersections.js**

Create `src/intersections.js`:
```javascript
export const SIGNAL_TYPES = {
  TRAFFIC_SIGNAL_FULL: 'signal_full',
  TRAFFIC_SIGNAL_SIMPLE: 'signal_simple',
  FOUR_WAY_STOP: 'stop_4way',
  STOP_MINOR: 'stop_minor',
  YIELD: 'yield',
  YIELD_MERGE: 'yield_merge',
};

const GREEN_DURATIONS = {
  downtown: 35, commercial: 25, residential: 15,
  industrial: 20, waterfront: 20,
};
const YELLOW = 4, ALL_RED = 2, LEFT_TURN = 8;

export function assignSignalTypes(roadType1, roadType2) {
  // Sort so higher hierarchy is first
  const hierarchy = { expressway: 4, arterial: 3, collector: 2, local: 1, ramp: 0 };
  const [a, b] = [roadType1, roadType2].sort((x, y) => hierarchy[y] - hierarchy[x]);

  if (a === 'ramp') return SIGNAL_TYPES.YIELD_MERGE;
  if (a === 'arterial' && b === 'arterial') return SIGNAL_TYPES.TRAFFIC_SIGNAL_FULL;
  if (a === 'arterial') return SIGNAL_TYPES.TRAFFIC_SIGNAL_SIMPLE;
  if (a === 'collector' && b === 'collector') return SIGNAL_TYPES.FOUR_WAY_STOP;
  if (a === 'collector') return SIGNAL_TYPES.STOP_MINOR;
  return SIGNAL_TYPES.YIELD;
}

export function createSignalState(districtType) {
  const green = GREEN_DURATIONS[districtType] || 25;
  const phases = [
    { duration: green, nsState: 'green', ewState: 'red', walk: true },
    { duration: YELLOW, nsState: 'yellow', ewState: 'red', walk: false },
    { duration: ALL_RED, nsState: 'red', ewState: 'red', walk: false },
    { duration: green, nsState: 'red', ewState: 'green', walk: true },
    { duration: YELLOW, nsState: 'red', ewState: 'yellow', walk: false },
    { duration: ALL_RED, nsState: 'red', ewState: 'red', walk: false },
  ];
  return { phases, currentPhase: 0, timer: 0 };
}

export function updateSignals(signals, dt) {
  for (const sig of signals) {
    sig.timer += dt;
    while (sig.timer >= sig.phases[sig.currentPhase].duration) {
      sig.timer -= sig.phases[sig.currentPhase].duration;
      sig.currentPhase = (sig.currentPhase + 1) % sig.phases.length;
    }
  }
}

export function getSignalPhase(signal) {
  return signal.phases[signal.currentPhase];
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/intersections.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/intersections.js tests/intersections.test.js
git commit -m "feat: traffic signal state machine with district-aware timing"
```

---

## Task 8: Terrain Integration — Update getGroundLevel()

**Files:**
- Modify: `src/terrain.js`

Wire the road graph spatial index into the existing `getGroundLevel()` function so all consumers (physics, vehicles, AI) automatically get correct road elevations.

- [ ] **Step 1: Read current getGroundLevel() implementation**

File: `src/terrain.js:580-592`. Current code checks highway corridors only. We add a city road check before it.

- [ ] **Step 2: Add import and integration point**

At top of `src/terrain.js`, add:
```javascript
import { queryRoadElevation as queryCityRoadElevation } from './roadGraph.js';
```

Modify `getGroundLevel()` at line 580:
```javascript
export function getGroundLevel(x, z) {
  const terrainH = Math.max(getTerrainHeightCached(x, z), WATER_SURFACE_Y);

  // Check city road graph first (O(1) spatial index lookup)
  const cityRoad = queryCityRoadElevation(null, x, z); // null = use module-level graph
  if (cityRoad && cityRoad.elevation !== null) {
    return Math.max(cityRoad.elevation + 0.2, terrainH);
  }

  // Fall back to highway corridor check for non-city areas
  ensureRoadProfiles();
  const road = getRoadCorridorInfo(x, z);
  if (road.factor > 0.5 && Number.isFinite(road.elevation)) {
    return Math.max(road.elevation + 0.2, terrainH);
  }

  return terrainH;
}
```

Note: `queryRoadElevation` needs a way to access the generated graph without passing it each time. Modify `roadGraph.js` to store the generated graph at module level:
```javascript
let _cityGraph = null;
export function setCityGraph(graph) { _cityGraph = graph; }
export function getCityGraph() { return _cityGraph; }

// Update queryRoadElevation to accept null graph (use module-level):
export function queryRoadElevation(graph, x, z) {
  const g = graph || _cityGraph;
  if (!g || !g.spatialGrid) return null;
  // ... rest unchanged
}
```

- [ ] **Step 3: Verify the project still builds**

```bash
cd /Users/gavrielfeldman/Developer/FlightSim && npx vite build 2>&1 | tail -5
```
Expected: Build succeeds (the import won't break because roadGraph.js exists from Task 3). The module-level graph will be null until city init runs, which means `getGroundLevel()` falls through to the existing highway check — safe.

- [ ] **Step 4: Commit**

```bash
git add src/terrain.js src/roadGraph.js
git commit -m "feat: integrate road graph spatial index into getGroundLevel()"
```

---

## Task 8b: Road Surface Rendering

**Files:**
- Create: `src/roadSurfaces.js`

Generate the visible road geometry. Without this, the spatial index returns correct elevations but there are no rendered roads — vehicles would appear to drive on bare terrain.

- [ ] **Step 1: Implement roadSurfaces.js**

Create `src/roadSurfaces.js`:

Key exports:
- `createRoadSurfaces(scene, graph)` — generates road geometry from graph edges
- `disposeRoadSurfaces()` — cleanup

Implementation:
1. Group edges by type: `local+collector`, `arterial`, `expressway`, `sidewalk`
2. For each group, build a merged `BufferGeometry`:
   - Per edge: extrude a quad strip along the edge from node to node
   - Quad width = `edge.width`, Y = interpolated node elevations + 0.15 (above terrain to avoid z-fight)
   - UV mapping: U across width (0→1), V along length (repeating every 20m)
3. Materials per road type:
   - Local/collector: medium gray asphalt (`MeshLambertMaterial`, `color: 0x555555`)
   - Arterial: slightly darker (`color: 0x444444`), yellow center line texture
   - Expressway: darkest (`color: 0x333333`), white lane dashes, shoulder rumble texture
   - Sidewalk: light concrete (`color: 0x999999`)
4. All materials use `polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1` (matches current city.js road approach)
5. One merged `BufferGeometry` per type = 4 draw calls for road surfaces
6. Road markings (crosswalks, stop lines, lane arrows): one additional merged geometry with `depthWrite: false` and deeper polygon offset

Total: 5 draw calls (4 surfaces + 1 markings), matching the spec's instancing budget.

Track all meshes in `roadMeshes[]` for disposal.

- [ ] **Step 2: Verify builds**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/roadSurfaces.js
git commit -m "feat: road surface rendering with per-type materials and lane markings"
```

---

## Task 9: City Buildings

**Files:**
- Create: `src/cityBuildings.js`

District-aware building generation with merged BufferGeometry per district, terrain-sampled placement, window emissive for day/night.

- [ ] **Step 1: Implement cityBuildings.js**

Create `src/cityBuildings.js`:

Key exports:
- `createCityBuildings(scene, graph, getHeightAt)` — generates buildings from `graph.lots`, groups by district, creates merged BufferGeometry per district
- `updateBuildingEmissive(timeOfDay)` — updates window glow uniform based on activity schedule
- `disposeCityBuildings()` — cleanup

Implementation approach:
1. For each lot in `graph.lots`:
   - Select building from `BUILDING_POOLS[lot.district]` using seeded PRNG
   - Height = random within pool's [minH, maxH], biased taller near district center
   - Base Y = `getHeightAt(lot.x, lot.z)`
   - Create box geometry with window UVs on facades
2. Per district: merge all building geometries into one `BufferGeometry` using `BufferGeometryUtils.mergeGeometries()`
3. Material per district style:
   - Downtown: glass-like (MeshStandardMaterial, metalness: 0.6, roughness: 0.3)
   - Residential: warm matte (MeshLambertMaterial, varied hue)
   - Industrial: dark matte (MeshLambertMaterial, gray)
   - Window emissive: `emissiveIntensity` uniform controlled by `updateBuildingEmissive()`
4. Add parked cars on empty lots: single `InstancedMesh`, position sampled from lot data
5. Track all meshes in `buildingMeshes[]` for disposal

LOD: At distance > 3000m, swap to simplified box mesh (pre-built at init, toggled by visibility). Handled in the update function based on camera distance.

- [ ] **Step 2: Verify builds**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cityBuildings.js
git commit -m "feat: district-aware building generation with merged geometry and LOD"
```

---

## Task 10: Street Furniture

**Files:**
- Create: `src/streetFurniture.js`

Street lights, traffic light poles, stop signs, bus stops, power lines, hydrants, benches, gas stations, construction zones.

- [ ] **Step 1: Implement streetFurniture.js**

Create `src/streetFurniture.js`:

Key exports:
- `createStreetFurniture(scene, graph)` — places all furniture based on road graph
- `updateStreetFurniture(dt, timeOfDay, cameraPos)` — street light on/off, construction zone rotation, LOD culling
- `disposeStreetFurniture()` — cleanup

Implementation:
1. **Street lights**: Walk each road edge, place every 40m (arterial) / 60m (collector) / 80m (residential). InstancedMesh with pole geometry (cylinder + sphere cap). 8 pooled PointLights assigned to nearest-to-camera lights.
2. **Traffic light poles**: At each signalized intersection node (from road graph). InstancedMesh. 3 small sphere children for R/Y/G (emissive material, swap which is lit based on signal state from `intersections.js`).
3. **Stop signs**: At stop-controlled intersections. InstancedMesh (octagon + pole).
4. **Bus stops**: Every 300m on arterials. InstancedMesh shelter geometry (box with open front + bench).
5. **Power line poles**: Every 60m along arterials/collectors. InstancedMesh (tall cylinder). Wires: single merged `BufferGeometry` with catenary curves between consecutive poles.
6. **Fire hydrants**: Every 100m on sidewalked roads. InstancedMesh (small red cylinder).
7. **Benches**: Near bus stops and in waterfront district. InstancedMesh.
8. **Gas stations**: 3 total (2 on highway, 1 in commercial). Compound mesh: flat canopy, pump boxes, tall sign.
9. **Construction zones**: 1-2 random road edges. Cones + barriers InstancedMesh. Lane closure flag on edge. Rotates every 10min.

LOD: Furniture visible < 500m. Street lights + bus stops < 1500m. Nothing beyond 1500m.

- [ ] **Step 2: Verify builds**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/streetFurniture.js
git commit -m "feat: street furniture with instanced rendering and distance LOD"
```

---

## Task 11: Unified Vehicle Traffic

**Files:**
- Create: `src/cityTrafficUnified.js`

Single vehicle traffic system replacing `cityTraffic.js` and `highwayTraffic.js`. Fixed timestep with visual interpolation.

- [ ] **Step 1: Implement cityTrafficUnified.js**

Create `src/cityTrafficUnified.js`:

Key exports:
- `initTraffic(scene, graph)` — creates InstancedMesh per vehicle type, spawns initial vehicles
- `updateTraffic(dt, timeOfDay)` — fixed 30Hz tick with 60fps interpolation, signal compliance, spawning/despawning
- `disposeTraffic()` — cleanup

Vehicle state structure:
```javascript
{
  id, type,              // vehicle type key from VEHICLE_TYPES
  edgeId, t,             // current road edge and parametric position
  lane,                  // lane index (0 = rightmost)
  speed,                 // current speed m/s
  targetSpeed,           // desired speed based on road + ahead conditions
  pathEdges,             // precomputed A* path as edge IDs
  pathIndex,             // current position in path
  x, y, z,              // current world position
  prevX, prevY, prevZ,   // previous tick position (for interpolation)
  heading,               // facing direction
  state,                 // 'moving' | 'stopped' | 'yielding' | 'parking'
  instanceIndex,         // index in InstancedMesh
}
```

Fixed timestep loop:
```javascript
const TICK_RATE = 1 / 30;
let accumulator = 0;

export function updateTraffic(dt, timeOfDay) {
  accumulator += Math.min(dt, 0.1); // cap to prevent spiral
  while (accumulator >= TICK_RATE) {
    for (const v of activeVehicles) {
      v.prevX = v.x; v.prevY = v.y; v.prevZ = v.z;
    }
    tickPhysics(TICK_RATE, timeOfDay);
    accumulator -= TICK_RATE;
  }
  const alpha = accumulator / TICK_RATE;
  updateVisuals(alpha);
}
```

`tickPhysics(dt, timeOfDay)`:
1. For each vehicle: advance `t` along current edge by `speed * dt / edgeLength`
2. If `t >= 1`: move to next edge in path (or pick new random path at intersections)
3. Before entering intersection: check signal state. If red → decelerate to stop at stop line
4. Following distance: if vehicle ahead within 2s gap → match speed
5. Lane changes: check if blocked, signal intent, smooth lateral interpolation
6. Speed: accelerate toward `targetSpeed` (road speedLimit × traffic conditions)
7. Compute world position: interpolate between edge endpoints
8. Spawning: every 0.5s, check if under budget → spawn at district boundary roads
9. Despawning: remove if past city boundary or at dead-end

`updateVisuals(alpha)`:
1. For each vehicle: `renderX = lerp(prevX, x, alpha)`, same for Y, Z
2. Update InstancedMesh matrices

- [ ] **Step 2: Verify builds**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cityTrafficUnified.js
git commit -m "feat: unified vehicle traffic with fixed timestep and signal compliance"
```

---

## Task 12: Pedestrian System

**Files:**
- Create: `src/pedestrians.js`

Billboard sprite pedestrians with procedural texture atlas.

- [ ] **Step 1: Implement pedestrians.js**

Create `src/pedestrians.js`:

Key exports:
- `initPedestrians(scene, graph)` — generates sprite atlas, creates InstancedMesh, spawns initial pedestrians
- `updatePedestrians(dt, timeOfDay, cameraPos)` — movement, crosswalk behavior, LOD fade, animation
- `disposePedestrians()` — cleanup

Sprite atlas generation:
```javascript
function generatePedestrianAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const CELL = 64;
  const PALETTES = [
    { body: '#2c3e50', legs: '#1a252f' }, // dark suit
    { body: '#c0392b', legs: '#2c3e50' }, // red jacket
    { body: '#2980b9', legs: '#34495e' }, // blue shirt
    { body: '#27ae60', legs: '#2c3e50' }, // green coat
  ];
  // 4 rows (palettes) x 4 cols (standing, walk1, walk2, sitting)
  for (let row = 0; row < 4; row++) {
    const pal = PALETTES[row];
    for (let col = 0; col < 4; col++) {
      const ox = col * CELL, oy = row * CELL;
      drawPedestrianSprite(ctx, ox, oy, CELL, pal, col);
    }
  }
  return new THREE.CanvasTexture(canvas);
}
```

InstancedMesh setup:
- PlaneGeometry (1m wide, 1.8m tall) with billboard shader (always faces camera)
- Custom ShaderMaterial that reads UV offset per instance for animation frame + palette
- Instance attribute: `uvOffset` (vec2) — selects sprite from atlas

Movement at 15Hz tick:
- Walk along sidewalk edges at 1.2-1.5 m/s
- At intersections: check crosswalk + signal state, wait if red
- Pick random next sidewalk edge at intersections
- 5% jaywalking on local roads
- Spawn at building entrances, despawn after 2-5 blocks

Distance fade: alpha → 0 above 200m from camera.

- [ ] **Step 2: Verify builds**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/pedestrians.js
git commit -m "feat: pedestrian system with billboard sprites and crosswalk behavior"
```

---

## Task 13: Rewire city.js

**Files:**
- Modify: `src/city.js`

Gut the old generation code, wire in new modules, add disposal, re-export `getRoadNetwork()`.

- [ ] **Step 1: Read current city.js exports and consumers**

Consumers of `city.js`:
- `main.js`: `createCity(scene)`, `updateCityNight(isNight)`
- `hud.js`: `getRoadNetwork()`
- `cityTraffic.js`: `getRoadNetwork()`, `getRoadIntersections()` (being deleted)

- [ ] **Step 2: Rewrite city.js**

Keep the same export signatures. Replace internals:

```javascript
import { DISTRICTS, getDistrictAt, getActivityMultiplier } from './cityData.js';
import { generateCityRoadGraph, setCityGraph, getRoadNetworkCompat } from './roadGraph.js';
import { createCityBuildings, updateBuildingEmissive, disposeCityBuildings } from './cityBuildings.js';
import { createStreetFurniture, updateStreetFurniture, disposeStreetFurniture } from './streetFurniture.js';
import { createRoadSurfaces, disposeRoadSurfaces } from './roadSurfaces.js';
import { createSignalState, assignSignalTypes, updateSignals } from './intersections.js';
import { initTraffic, updateTraffic, disposeTraffic } from './cityTrafficUnified.js';
import { initPedestrians, updatePedestrians, disposePedestrians } from './pedestrians.js';
import { getTerrainHeightCached } from './terrain.js';
import { getTimeOfDay } from './scene.js';

let cityGraph = null;
let signals = [];

export function createCity(scene) {
  disposeCity();

  // Generate road graph (samples terrain height at each node)
  cityGraph = generateCityRoadGraph(getTerrainHeightCached);
  setCityGraph(cityGraph);

  // Create intersection signals
  signals = [];
  for (const [, node] of cityGraph.nodes) {
    if (node.edges && node.edges.length >= 3) {
      // Determine highest-hierarchy roads meeting here
      const edgeTypes = node.edges.map(eid => cityGraph.edges.get(eid)?.type || 'local');
      const hierarchy = { expressway: 4, arterial: 3, collector: 2, local: 1, ramp: 0 };
      edgeTypes.sort((a, b) => (hierarchy[b] || 0) - (hierarchy[a] || 0));
      const signalType = assignSignalTypes(edgeTypes[0], edgeTypes[1] || edgeTypes[0]);
      if (signalType.startsWith('signal')) {
        const district = getDistrictAt(node.x, node.z);
        node.signal = createSignalState(district?.type || 'residential');
        signals.push(node.signal);
      }
    }
  }

  // Build visual layers
  createCityBuildings(scene, cityGraph, getTerrainHeightCached);
  createStreetFurniture(scene, cityGraph);
  initTraffic(scene, cityGraph);
  initPedestrians(scene, cityGraph);

  // Generate road surface meshes
  createRoadSurfaces(scene, cityGraph);
}

// Visual-only updates — called OUTSIDE pause guard (line 475 in main.js)
// so night/day transitions keep working even when paused
export function updateCityNight(isNight) {
  const tod = getTimeOfDay();
  updateBuildingEmissive(tod);
  // Street light on/off and traffic light visual state (purely visual, no sim logic)
  updateStreetFurniture(0, tod, null); // dt=0 skips construction rotation, null cameraPos skips LOD
}

// Simulation updates — called INSIDE pause guard (after updateGroundVehicleAI in main.js)
export function updateCity(dt, cameraPos) {
  const tod = getTimeOfDay();
  updateSignals(signals, dt);
  updateTraffic(dt, tod);
  updatePedestrians(dt, tod, cameraPos);
  // Street furniture LOD + construction zone rotation (simulation-dependent)
  updateStreetFurniture(dt, tod, cameraPos);
}

export function getRoadNetwork() {
  if (!cityGraph) return [];
  return getRoadNetworkCompat(cityGraph);
}

export function getRoadIntersections() {
  if (!cityGraph) return [];
  return [...cityGraph.nodes.values()]
    .filter(n => n.edges && n.edges.length >= 3)
    .map(n => ({ x: n.x, z: n.z, type: n.signal ? 'signal' : 'minor' }));
}

function disposeCity() {
  disposeCityBuildings();
  disposeStreetFurniture();
  disposeRoadSurfaces();
  disposeTraffic();
  disposePedestrians();
  cityGraph = null;
  signals = [];
}
// Note: createRoadSurfaces is now imported from roadSurfaces.js (Task 8b)
```

- [ ] **Step 3: Verify builds**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/city.js
git commit -m "refactor: rewire city.js to orchestrate new district-driven modules"
```

---

## Task 14: main.js Integration

**Files:**
- Modify: `src/main.js`

Update imports, init order, and game loop.

- [ ] **Step 1: Update imports (lines 35-43)**

Replace:
```javascript
import { createCity, updateCityNight } from './city.js';
import { initCityTraffic, updateCityTraffic } from './cityTraffic.js';
// ...
import { initHighwayTraffic, updateHighwayTraffic } from './highwayTraffic.js';
```

With:
```javascript
import { createCity, updateCityNight, updateCity } from './city.js';
```

Remove `initCityTraffic`, `updateCityTraffic`, `initHighwayTraffic`, `updateHighwayTraffic` imports entirely.

- [ ] **Step 2: Update init order (lines 114-136)**

Change:
```javascript
createHighway(scene);
initHighwayTraffic(scene);
// ...
createCity(scene);
initCityTraffic(scene);
```

To:
```javascript
createHighway(scene);
// Highway traffic now handled by unified system inside createCity
// ...
createCity(scene);
// City traffic, pedestrians, furniture all initialized inside createCity
```

Remove `initHighwayTraffic(scene)` and `initCityTraffic(scene)` calls.

- [ ] **Step 3: Update game loop (lines 429-476)**

Remove:
```javascript
updateCityTraffic(dt, nightActive);
updateHighwayTraffic(dt, nightActive);
```

Add (after `updateGroundVehicleAI(dt)`):
```javascript
updateCity(dt, { x: av.position.x, y: av.position.y, z: av.position.z });
```

Keep `updateCityNight(nightActive)` as-is (it now calls `updateBuildingEmissive` internally).

- [ ] **Step 4: Update carSpawn.js spawn location**

In `src/carSpawn.js`, update the spawn logic to query the road graph for a suitable starting edge instead of using a hardcoded position. Import `getCityGraph` from `roadGraph.js`, pick a random arterial/collector edge, and place the car at `t=0.5` along it.

- [ ] **Step 5: Verify the project builds and loads**

```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Manual visual verification**

```bash
npm run dev
```
Open browser. Verify:
- [ ] City renders with district-appropriate buildings
- [ ] Roads follow terrain elevation (no floating, no clipping)
- [ ] Vehicles drive on roads, stop at signals
- [ ] Pedestrians walk on sidewalks
- [ ] Street lights turn on at night
- [ ] Highway has on/off ramps
- [ ] Player car drives correctly on city roads
- [ ] HUD minimap shows roads
- [ ] No console errors

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/carSpawn.js
git commit -m "feat: integrate unified city system into main game loop"
```

---

## Task 15: Delete Old Files & Cleanup

**Files:**
- Delete: `src/cityTraffic.js`
- Delete: `src/highwayTraffic.js`

- [ ] **Step 1: Verify no remaining imports of deleted modules**

Search the codebase:
```bash
grep -r "cityTraffic" src/ --include="*.js" -l
grep -r "highwayTraffic" src/ --include="*.js" -l
```
Expected: No files reference these modules (all imports removed in Task 14).

- [ ] **Step 2: Delete the files**

```bash
git rm src/cityTraffic.js src/highwayTraffic.js
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 4: Final build verification**

```bash
npx vite build 2>&1 | tail -5
```
Expected: Clean build, no warnings about missing modules.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "cleanup: remove old cityTraffic.js and highwayTraffic.js"
```

---

## Task Dependencies

```
Task 1 (vitest)
  └─→ Task 2 (cityData)
       └─→ Task 3 (roadGraph core)
            ├─→ Task 4 (road generation)
            │    └─→ Task 5 (highways)
            │         └─→ Task 6 (pathfinding + compat)
            └─→ Task 7 (intersections)
                 └─→ Task 8 (terrain integration)
                      ├─→ Task 8b (road surfaces)
                      ├─→ Task 9 (buildings)
                      ├─→ Task 10 (furniture)
                      ├─→ Task 11 (traffic — depends on Task 6 for A*)
                      └─→ Task 12 (pedestrians)
                           └─→ Task 13 (city.js rewire)
                                └─→ Task 14 (main.js integration)
                                     └─→ Task 15 (cleanup)
```

Tasks 8b, 9, 10, 11, 12 are independent of each other and can be parallelized (Task 11 also needs Task 6's A* but that's already complete by this point).

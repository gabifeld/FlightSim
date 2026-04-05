a# Sub-Project A: Ground Realism — Design Spec

## Overview

Replace the current hardcoded city grid and inconsistent vehicle systems with a data-driven city model where districts drive road layout, building types, traffic density, pedestrian activity, and day/night behavior. Fix all floating car, choppy road, and terrain-clipping bugs structurally.

## Goals

1. Fix structural bugs: floating cars, hardcoded road Y, missing elevation data, inconsistent height functions
2. Create a living city that looks and behaves realistically from both cockpit altitude and ground level
3. Maintain 60fps on M1 MacBook Pro with < 40 draw calls for the city
4. Replace three inconsistent vehicle traffic systems with one unified system

## Non-Goals

- SimCity-level economic simulation
- Interior building rendering
- Multiplayer ground interactions
- Destructible buildings
- Cape Town city overhaul (stays as-is; highway spur H2 terminates at the city boundary where the old spline takes over)

## Scope Boundary: Cape Town

`capeTownCity.js` is **out of scope** for this sub-project. The Cape Town city remains unchanged. Highway H2 (City -> Cape Town) is built as expressway graph edges from the main city outward. At the city boundary (~2km from Cape Town), the expressway graph terminates and the existing `HIGHWAY_SPUR_CT` spline takes over for the final stretch. The handoff point is a graph node at the boundary with a flag `{ externalSpline: true }` — the unified traffic system despawns highway vehicles at this node rather than trying to route them onto the old spline.

---

## 1. City Data Model

### Districts

Five district types within the existing city footprint (center: 4000, -4000, size: 2000m):

```javascript
const DISTRICTS = [
  {
    type: "downtown",
    center: [4000, -4000],
    radius: 600,
    priority: 1,
    density: 1.0,
    maxHeight: 90,
    traffic: "heavy",
    pedestrians: "heavy",
  },
  {
    type: "commercial",
    center: [4400, -3600],
    radius: 400,
    priority: 2,
    density: 0.7,
    maxHeight: 45,
    traffic: "medium",
    pedestrians: "medium",
  },
  {
    type: "waterfront",
    center: [4800, -3800],
    radius: 300,
    priority: 3,
    density: 0.3,
    maxHeight: 12,
    traffic: "light",
    pedestrians: "heavy",
  },
  {
    type: "industrial",
    center: [4600, -4600],
    radius: 400,
    priority: 4,
    density: 0.5,
    maxHeight: 20,
    traffic: "heavy_truck",
    pedestrians: "sparse",
  },
  {
    type: "residential",
    center: [3500, -4300],
    radius: 600,
    priority: 5,
    density: 0.4,
    maxHeight: 15,
    traffic: "light",
    pedestrians: "light",
  },
];
```

**District overlap resolution:** Where districts overlap, the lower `priority` number wins (downtown > commercial > waterfront > industrial > residential). Any area within the city footprint not covered by any district circle defaults to `residential` with reduced density (0.2).

**Boundary clamping:** District generation is clipped to the city footprint bounds (3000→5000 on X, -5000→-3000 on Z). No geometry is generated outside these bounds regardless of district radius.

### What Districts Generate

Each district produces:

- A **block grid** subdivided into **lots** (building footprints)
- Road network edges connecting blocks (road type/width driven by district density)
- Building pool selection (skyscrapers downtown, houses in residential, warehouses in industrial)
- Traffic volume rules (cars/min spawned per road segment)
- Pedestrian density (people/block)
- Activity schedule (downtown busy 8am-6pm, waterfront busy evenings/weekends, industrial busy 6am-4pm)

### District Boundary Road Rules

- Borders between districts get **arterial roads** (4 lanes, 16m wide)
- Interior district roads are **collectors** (2 lanes, 10m) or **local** (2 lanes, 8m)
- Highways connect districts to airports via **expressway** edges (6 lanes, 24m, grade-separated)

---

## 2. Road Network Generation

Roads emerge from district rules rather than a hardcoded grid.

### Generation Algorithm

1. **Lay arterials first** — for each pair of district centers, generate a direct road segment between them. Segments are straight lines with optional single midpoint deflection to avoid overlapping a third district center. These segments become arterial edges in the graph. No pathfinding needed — the district centers are the nodes, the connections are deterministic based on adjacency (Delaunay triangulation of district centers, then prune edges longer than 1500m).
2. **Fill blocks** — within each district, overlay a rotated grid aligned to the nearest arterial. Grid spacing driven by density (downtown: 80m blocks, residential: 140m blocks, industrial: 200m blocks). Grid nodes become intersection nodes; grid edges become local road edges.
3. **Add collectors** — every 2-3 blocks, promote a local road to collector width. These connect arterials to the interior grid.
4. **Generate lots** — each block interior is subdivided into building lots based on district type (downtown: full-block lots, residential: 20x30m lots with setbacks).

### Road Edge Schema

```javascript
{
  from: nodeId,
  to: nodeId,
  lanes: 2-6,
  width: 8-24,           // meters
  type: "local" | "collector" | "arterial" | "expressway",
  speedLimit: 30-100,    // km/h
  elevation: [y0, y1],   // sampled from terrain at each node
  sidewalks: true|false,
  parking: "none" | "street" | "angled",
  district: "downtown" | "residential" | "commercial" | "industrial" | "waterfront"
}
```

### Intersection Node Schema

```javascript
{
  id: number,
  x: number, y: number, z: number,  // y = terrain-sampled elevation
  edges: [...],                       // connected road edge IDs
  signal: null | { phases: [...], currentPhase: number, timer: number },
  crosswalks: [...],                  // which approaches have pedestrian crossings
  type: "signal" | "stop" | "yield" | "roundabout"
}
```

### Elevation Integration

Every node samples `getGroundLevel()` at creation. Road edges interpolate elevation between nodes. All vehicles, road meshes, and street furniture use these elevations. No hardcoded Y values anywhere.

### Spatial Index for Road Queries

`getGroundLevel()` is on the hottest code path (called 50+ times/frame by physics, AI, vehicles). The road graph query must be O(1), not O(n).

**Approach: uniform grid hash.** At road graph creation time, rasterize all road edges into a 2D grid covering the city footprint (3000→5000 X, -5000→-3000 Z). Cell size = 20m (100x100 = 10,000 cells). Each cell stores a list of edge IDs that pass through it.

```javascript
// At init time:
const CELL_SIZE = 20;
const gridCells = new Map(); // "cellX,cellZ" -> [edgeId, ...]
for (const edge of allEdges) rasterizeEdgeIntoCells(edge, gridCells);

// At query time (called from getGroundLevel):
function queryRoadElevation(x, z) {
  const cellKey = `${Math.floor((x - 3000) / CELL_SIZE)},${Math.floor((z + 5000) / CELL_SIZE)}`;
  const edges = gridCells.get(cellKey);
  if (!edges) return null; // not on any road
  // Check 1-3 edges in this cell, find closest, interpolate elevation
  return closestEdgeElevation(edges, x, z);
}
```

Average edges per cell: 3000 edges / 10000 cells = 0.3. Most cells empty, road cells have 1-2 edges. Query cost: one hash lookup + 1-2 distance checks. Negligible.

**Boundary safety:** The grid only covers the city footprint. Queries outside it (airports, open terrain) skip the road check entirely and fall through to the existing highway corridor check + raw terrain. This ensures `groundVehicleAI.js` airport vehicles are unaffected.

### What This Replaces

- `city.js` `buildRoads()` (flat grid at Y=0.15) -> generated from district rules
- `city.js` `getRoadNetwork()` (2D segments with no height) -> full 3D graph
- `terrain.js` highway centerlines -> expressway edges in the same graph

### What Stays

The terrain height system (`getGroundLevel`, `getTerrainHeightCached`, road corridor blending) — it works well, we just make sure everything actually uses it.

---

## 3. Building Generation

### Building Pools Per District

| District    | Types                                       | Height | Style                                          |
| ----------- | ------------------------------------------- | ------ | ---------------------------------------------- |
| Downtown    | Office towers, hotels, banks, mixed-use     | 40-90m | Glass curtain walls, angular tops, lit lobbies |
| Commercial  | Retail, restaurants, parking garages, malls | 8-30m  | Storefronts, signage, awnings, flat roofs      |
| Residential | Houses, apartment blocks, condos            | 6-15m  | Pitched roofs, balconies, yards, varied color  |
| Industrial  | Warehouses, factories, silos, loading docks | 8-20m  | Corrugated metal, roll-up doors, smokestacks   |
| Waterfront  | Cafes, marina office, boardwalk shops       | 4-12m  | Open facades, deck seating, nautical palette   |

### Generation Rules

- Each lot in a block gets a building selected from the district's pool
- Building footprint fills the lot with district-appropriate setback (downtown: 0m, residential: 4m for front yard)
- Height is randomized within district range, with taller buildings closer to district center
- Every building's Y position = terrain height at its lot center (no more clipping underground)
- Buildings adjacent to arterials get commercial ground floors regardless of district (mixed-use realism)

### Visual Details Per Type

- **Windows** — grid pattern on facades, emissive at night (random per-floor on/off pattern for occupancy feel)
- **Rooftops** — AC units on commercial, water tanks on older buildings, helipads on tallest downtown towers
- **Ground level** — awnings on retail, garage doors on industrial, porches on residential
- **Parking lots** — generated on empty lots in commercial/industrial districts, filled with parked car instances

### Rendering

- Geometry built with merged `BufferGeometry` per district (one draw call per district, not per building)
- Window emissive controlled by a time-of-day uniform — no per-window logic at runtime
- Parked cars as `InstancedMesh` (one mesh, hundreds of instances)
- LOD: buildings beyond 3000m rendered as simplified boxes, beyond 6000m as flat sprites

---

## 4. Intersection & Traffic Signal System

### Signal Types By Road Hierarchy

- **Arterial x Arterial** — full traffic signal with left-turn phases
- **Arterial x Collector** — traffic signal, simpler 2-phase
- **Collector x Collector** — 4-way stop signs
- **Collector x Local** — stop sign on local road only
- **Local x Local** — yield (no signs)
- **Expressway ramps** — yield on merge, signal at ramp terminus if it meets an arterial

### Traffic Signal State Machine

```
Phase 1: N-S green + pedestrian walk (25s)
Phase 2: N-S yellow (4s)
Phase 3: All red (2s)
Phase 4: E-W green + pedestrian walk (25s)
Phase 5: E-W yellow (4s)
Phase 6: All red (2s)
-> repeat
```

Downtown intersections get longer cycles (35s green). Residential gets shorter (15s). Left-turn phases added on arterials only — 8s protected left, then permissive.

### Visual Elements

- **Traffic lights** — pole mesh + 3 emissive spheres (red/yellow/green), state-driven. `InstancedMesh` for poles, uniform swap for light color.
- **Stop signs** — octagon on pole at stop-line distance from intersection center
- **Crosswalk markings** — white stripe texture on road surface at signalized intersections
- **Stop lines** — white bar across approach lane before crosswalk
- **Turn lane markings** — arrow decals on arterial approaches

### Vehicle Interaction With Signals

- AI vehicles query the intersection node ahead on their path
- If signal is red/yellow for their approach direction -> decelerate to stop at stop-line position
- On green -> proceed, yielding to crossing pedestrians
- Stop signs -> full stop for 1-2s, then proceed if intersection is clear
- Right-on-red permitted at signals (unless pedestrians crossing)

### Performance

Signals are pure state (phase + timer). Visual update is just swapping which of 3 emissive spheres is lit. All signal poles share one `InstancedMesh`. Signal logic ticks at 1Hz.

---

## 5. Unified Vehicle Traffic System

One system replaces the three separate, inconsistent ones (`cityTraffic.js`, `highwayTraffic.js`, drivable car height path).

### Core Principle

Every vehicle in the world uses the same road graph and the same height function. No more hardcoded Y values.

### Vehicle Types

| Type         | Speed       | Where                   | Behavior                                      |
| ------------ | ----------- | ----------------------- | --------------------------------------------- |
| Sedan        | 30-60 km/h  | Everywhere              | Standard lane following                       |
| SUV          | 30-60 km/h  | Residential, commercial | Same as sedan, wider model                    |
| Truck        | 25-50 km/h  | Industrial, highways    | Slower acceleration, wider turns              |
| Semi         | 40-80 km/h  | Highways, industrial    | Stays in right lane, long braking distance    |
| Bus          | 20-40 km/h  | Arterials, collectors   | Stops at bus stops for 5-10s, fixed routes    |
| Taxi         | 30-50 km/h  | Downtown, commercial    | Occasionally stops at curb for 3-8s           |
| Emergency    | 40-100 km/h | Anywhere                | Sirens, other vehicles yield, runs red lights |
| Construction | 15-30 km/h  | Random road segments    | Slow, flashers on, creates lane closures      |

### Shared Movement Model

```
1. Query current road edge from graph
2. Interpolate position along edge (parametric t = 0->1)
3. Y = lerp(edge.elevation[0], edge.elevation[1], t) + vehicleHeight
4. At edge end -> query intersection signal state
5. If clear -> pick next edge from path (A* precomputed)
6. If blocked -> decelerate to stop, wait
7. Following distance: maintain 2s gap to vehicle ahead
```

### Lane Behavior

- Multi-lane roads: vehicles pick lanes. Slow vehicles right, passing left.
- Lane changes: signal intent (blinker visual), check gap, smooth lateral interpolation over 2s
- Near intersections: merge to correct lane for upcoming turn 100m in advance

### Spawning & Despawning

- Vehicles spawn at district boundary roads, density driven by district traffic level and time of day
- Downtown at noon: ~40 active vehicles. Residential at 2am: ~5.
- Despawn when leaving city boundary or reaching a dead-end lot (parked)
- Total budget: 120 active vehicles max (InstancedMesh per vehicle type)

### What Gets Deleted

- `cityTraffic.js` — replaced entirely
- `highwayTraffic.js` — replaced entirely

### What Gets Kept

- `carPhysics.js` — still handles the player-drivable car, reads from same road graph for surface height
- `carGeometry.js` — vehicle meshes reused as instanced templates
- `groundVehicleAI.js` — airport ground vehicles stay separate (taxi network, not road graph)

---

## 6. Pedestrian System

### Behavior Model

- Walk on sidewalks (road edges with `sidewalks: true`) at 1.2-1.5 m/s
- At intersections with crosswalks, wait for walk signal, then cross
- Occasional stops: window shopping (3-5s near commercial buildings), waiting at bus stops, sitting on benches
- Jaywalking: 5% chance to cross mid-block on local roads

### Density By District and Time

| District    | Day (8am-6pm) | Evening (6pm-10pm) | Night (10pm-6am) |
| ----------- | ------------- | ------------------ | ---------------- |
| Downtown    | 30            | 15                 | 3                |
| Commercial  | 20            | 25                 | 5                |
| Residential | 8             | 12                 | 2                |
| Industrial  | 10            | 2                  | 1                |
| Waterfront  | 15            | 20                 | 2                |

Total budget: ~100 max active pedestrians.

### Rendering

- **Billboard sprites**, not 3D models
- 4 sprite variants (standing, walking frame 1, walking frame 2, sitting) x 4 color palettes = 16 sprites on texture atlas
- One `InstancedMesh` with always-face-camera behavior
- Walk animation: alternate 2 frames at 3Hz via UV offset
- Fade out above 200m camera distance

### Spawn/Despawn

- Spawn at building entrances within active districts
- Walk 2-5 blocks, then enter another building (despawn)
- Pool recycled — same 100 instances reused continuously

---

## 7. Street Furniture & Infrastructure

### Placement Rules

| Element        | Rule                                                 | Rendering                                         |
| -------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Street lights  | Every 40m arterials, 60m collectors, 80m residential | InstancedMesh + 8 pooled PointLights (nearest)    |
| Traffic lights | At signalized intersections                          | InstancedMesh poles, emissive state swap          |
| Stop signs     | At stop-controlled intersections                     | InstancedMesh                                     |
| Bus stops      | Every 300m on arterials                              | InstancedMesh shelter template                    |
| Power lines    | Along arterials and collectors, poles every 60m      | InstancedMesh poles + catenary Line geometry      |
| Fire hydrants  | Every 100m on sidewalks                              | InstancedMesh                                     |
| Benches        | Near bus stops, in parks, on waterfront              | InstancedMesh                                     |
| Dumpsters      | Behind commercial/industrial buildings               | InstancedMesh                                     |
| Gas stations   | 2 on highways, 1 per commercial district             | Custom compound mesh (canopy + pumps + sign)      |
| Construction   | 1-2 random road segments, rotating every 10min       | Cones + barriers InstancedMesh, lane closure flag |
| Parking meters | Along streets with `parking: "street"`               | InstancedMesh                                     |

### Street Light Behavior

- Off during day, on at night (scene sunElevation < 5 degrees)
- Orange sodium-vapor color (2200K)
- 8 PointLights shared, assigned to 8 nearest to camera. Others emissive-only glow.
- 30s fade transition at dusk/dawn

### Construction Zones

- Pick 1-2 road edges, set `blocked_lane` flag
- Traffic AI: lane reduction -> merge, slow down
- Visual: orange cones, barriers, parked construction vehicle with flashers
- Rotates every 10 minutes game time

### LOD

- < 500m: full detail, all elements
- 500-1500m: street lights and bus stops only
- > 1500m: nothing

---

## 8. Highway System Overhaul

### Current Problems Being Fixed

- 3 separate spline centerlines with excessive smoothing
- No on/off ramps
- Bridge/tunnel classification but no visual bridge geometry
- Traffic uses wrong height function (`getTerrainHeightCached` instead of `getGroundLevel`)

### Grade Separation

- Expressway edges carry `elevation_offset` of 6m above surface roads
- Where highway crosses arterial: bridge deck with support columns and guard rails
- Bridge geometry auto-generated at crossing points

### On/Off Ramps

Each district gets 1-2 highway access points:

- **Off-ramp**: single-lane, 200m long, 80->40 km/h decel, ends at arterial intersection with signal
- **On-ramp**: single-lane, 200m long, merge flag, entering vehicles yield and accelerate to match

### Highway Routes

3 highways rebuilt as graph expressway edges:

- **H1**: Airport 1 -> City (along current HIGHWAY_CENTERLINE, which runs from airport origin toward city center)
- **H2**: City -> Cape Town (along current HIGHWAY_SPUR_CT, which runs northeast from south of city toward Cape Town at ~10000,0). Terminates at city boundary with `{ externalSpline: true }` handoff to the existing spline for the final stretch.
- **H3**: City -> Airport 3 International (new route northwest toward -8000, 8000)

Note: There is no existing highway connecting to Airport 2 (8000, -8000). Airport 2 access remains via the HIGHWAY_CENTERLINE which passes relatively near it. A dedicated Airport 2 spur could be added as a future enhancement but is not in scope.

Each: 3 lanes/direction, 24m width, median barrier, 100 km/h limit (trucks 80 km/h right lane).

### Highway Traffic Behavior

- Enter via on-ramps, cruise right/center, exit via off-ramps
- Lane discipline: slow right, pass left, merge back after
- Trucks rightmost lane only
- Following distance: 3s gap (vs 2s in city)

### Visual Improvements

- Darker asphalt texture, lane dashes, shoulder rumble strips
- Guard rails on elevated sections and ramps
- Green highway signs at off-ramps ("Airport 2 ->", "Downtown <-")
- Sound barriers along residential district borders

### Terrain Integration

- Highway nodes sample terrain like all other nodes
- Grade limiting (12% max) applied during graph generation
- Cuts: embankment walls visible. Fills: support columns.

---

## 9. Day/Night Activity Cycles

### Time Periods

| Period       | Hours    | Character                                             |
| ------------ | -------- | ----------------------------------------------------- |
| Dawn         | 5am-7am  | Lights turning off, early commuters, delivery trucks  |
| Morning rush | 7am-9am  | Heavy inbound traffic on arterials/highways           |
| Midday       | 9am-4pm  | Steady traffic, full pedestrians, construction active |
| Evening rush | 4pm-6pm  | Heavy outbound from downtown toward residential       |
| Evening      | 6pm-10pm | Commercial/waterfront busy, residential quiet         |
| Night        | 10pm-5am | Minimal traffic, street lights dominant               |

### What Changes Per Period

- **Traffic volume**: directional multipliers (morning rush: inbound 3x, outbound 0.5x)
- **Building windows**: emissive intensity by schedule per district type
- **Street lights**: fade on at dusk, off at dawn (30s transition)
- **Pedestrians**: density table keyed to period
- **Special vehicles**: garbage trucks 5-7am residential, delivery trucks 6-9am commercial, emergency vehicles more frequent at night

### Implementation

One `getActivityMultiplier(districtType, timeOfDay, direction)` function returns spawn rates, pedestrian density, window emissive values. Every system queries it. Time-of-day already exists in scene.

---

## 10. Performance & LOD Strategy

### Targets

- 60fps on M1 MacBook Pro (minimum target)
- Total city draw calls: < 40
- Total active moving entities: 240 (120 cars + 10 trucks + 5 buses + 5 emergency + 100 pedestrians)

### Instancing Budget

See **Appendix: Instancing Budget (Revised)** for the full draw call breakdown. Total: **~31 draw calls**, well under the 40 draw call target.

### Distance LOD Tiers

| Distance  | Visible                                                    |
| --------- | ---------------------------------------------------------- |
| 0-200m    | Everything — full detail, pedestrians, furniture, vehicles |
| 200-500m  | Buildings, vehicles, street lights, bus stops              |
| 500-1500m | Buildings, vehicles as dots, street lights at night only   |
| 1500m+    | Building silhouettes only (fog handles the rest)           |

### Tick Rate Separation

- Vehicle movement: 30Hz (interpolate visuals at 60fps)
- Traffic signals: 1Hz
- Pedestrian movement: 15Hz
- Activity multiplier: 0.1Hz
- Spawn/despawn checks: 2Hz
- LOD distance checks: 1Hz per group

### Spatial Culling

Buildings grouped into quadrants (N/S/E/W) as separate InstancedMesh objects for bulk frustum culling.

### Memory Budget

- Road graph (~2000 nodes, ~3000 edges): ~500KB
- Vehicle state (240 x 64B): ~15KB
- Building data (800 x 128B): ~100KB
- Total new memory: < 1MB

---

## 11. Initialization Order & Disposal

### Init Sequence

The new systems must initialize in this order (respecting data dependencies):

```
1. createTerrain()              — terrain mesh + height cache (existing)
2. buildTerrainHeightCache()    — populates height grid (existing)
3. generateRoadGraph()          — needs height cache for node elevation sampling
4. createHighway()              — refactored to consume expressway edges from road graph
                                  (old spline generation removed, terrain corridor flattening
                                  now driven by expressway edge positions)
5. createCityBuildings()        — needs road graph for lot positions + terrain height
6. createStreetFurniture()      — needs road graph nodes for placement
7. createIntersections()        — needs road graph for signal assignment
8. initCityTrafficUnified()     — needs road graph + intersections
9. initPedestrians()            — needs road graph + buildings
```

`capeTownCity` init remains unchanged, called separately in main.js.

### Disposal of Old City Geometry

`city.js` currently adds ~31 meshes to the scene. The refactored `city.js` will:

1. Call `disposeCity()` before generating new geometry (or on first load, skip)
2. `disposeCity()` traverses all meshes added by the old system, calls `.geometry.dispose()`, `.material.dispose()`, and `scene.remove(mesh)` on each
3. Track all added meshes in a module-level array `cityMeshes[]` for clean disposal
4. New modules (`cityBuildings.js`, `streetFurniture.js`, etc.) each maintain their own `meshes[]` array with a `dispose()` export for the same purpose

This prevents GPU memory leaks during hot-reload in dev and if city regeneration is ever triggered at runtime.

### HUD Map Integration

`hud.js` imports `getRoadNetwork()` from `city.js` to draw roads on the fullscreen map. The new system must maintain this export with a compatible interface:

```javascript
// roadGraph.js exports:
export function getRoadNetwork() {
  // Returns array compatible with existing HUD consumer:
  // [{ start: {x, z}, end: {x, z}, width, type }]
  // Generated by flattening graph edges into the old segment format
  return allEdges.map((e) => ({
    start: { x: nodes[e.from].x, z: nodes[e.from].z },
    end: { x: nodes[e.to].x, z: nodes[e.to].z },
    width: e.width,
    type: e.type,
  }));
}
```

`city.js` re-exports this from `roadGraph.js` so `hud.js` import path doesn't change. The HUD map gains road hierarchy coloring for free (arterials thicker than locals).

---

## 12. Vehicle Movement Interpolation

### Fixed Timestep with Visual Interpolation

Vehicle physics ticks at 30Hz (33.3ms steps). Visual rendering at 60fps interpolates between ticks to prevent stuttering.

```javascript
let accumulator = 0;
const TICK_RATE = 1 / 30;

function updateTraffic(dt) {
  accumulator += dt;
  while (accumulator >= TICK_RATE) {
    // Store previous positions
    for (const v of vehicles) {
      v.prevX = v.x;
      v.prevZ = v.z;
      v.prevY = v.y;
    }
    // Tick physics
    tickVehiclePhysics(TICK_RATE);
    accumulator -= TICK_RATE;
  }
  // Interpolate for rendering
  const alpha = accumulator / TICK_RATE;
  for (const v of vehicles) {
    v.renderX = lerp(v.prevX, v.x, alpha);
    v.renderY = lerp(v.prevY, v.y, alpha);
    v.renderZ = lerp(v.prevZ, v.z, alpha);
  }
}
```

This is the same pattern used by game engines (Gaffer on Games "Fix Your Timestep"). Prevents the jitter that would occur if vehicles only moved at 30Hz without interpolation.

---

## 13. Pedestrian Texture Atlas

### Procedural Canvas Generation

Consistent with the project's zero-external-assets approach, the pedestrian sprite atlas is generated via canvas at init time:

- Atlas size: 256x256 canvas
- 4x4 grid = 16 sprites at 64x64 each
- Rows: 4 color palettes (dark suit, red jacket, blue shirt, green coat)
- Columns: standing, walk frame 1, walk frame 2, sitting
- Each sprite is drawn procedurally: circle head, rectangle torso, line legs (stick figure at this resolution reads fine as a billboard)
- UV offset per instance selects palette + animation frame

Total cost: one 256x256 canvas texture, generated once at init.

---

## Files Modified/Created

### New Files

- `src/cityData.js` — district definitions, building pools, activity schedules, `getActivityMultiplier()`
- `src/roadGraph.js` — road network graph generation, node/edge schemas, spatial grid index, A\* pathfinding, `getRoadNetwork()` compatibility export, `queryRoadElevation()`
- `src/intersections.js` — traffic signal state machine, signal type assignment, visual state
- `src/cityTrafficUnified.js` — unified vehicle traffic system (replaces cityTraffic.js + highwayTraffic.js), fixed-timestep with interpolation
- `src/pedestrians.js` — pedestrian system, sprite atlas generation, crosswalk behavior
- `src/streetFurniture.js` — infrastructure placement, LOD, street light pooling
- `src/cityBuildings.js` — district-aware building generation, LOD, merged geometry, disposal

### Modified Files

- `src/city.js` — gutted and rewired to orchestrate cityData + roadGraph + cityBuildings + streetFurniture; re-exports `getRoadNetwork()` from roadGraph.js for HUD compatibility; disposal of old geometry
- `src/terrain.js` — `getGroundLevel()` updated to query road graph spatial index for city roads; highway spline generation refactored to consume expressway edges from road graph; existing corridor flattening preserved for non-city highways
- `src/carPhysics.js` — reads surface height from road graph elevation data via `getGroundLevel()` (same function, now correct)
- `src/carSpawn.js` — player car spawn location picks a road graph edge for initial placement instead of hardcoded position
- `src/hud.js` — fullscreen map draws roads from `getRoadNetwork()` (interface preserved, gains road hierarchy coloring)
- `src/scene.js` — wire up new city systems in init and update loops
- `src/main.js` — register new modules in update cycle, updated init order per Section 11

### Deleted Files

- `src/cityTraffic.js` — replaced by cityTrafficUnified.js
- `src/highwayTraffic.js` — replaced by cityTrafficUnified.js

---

## Appendix: Traffic Signal Timing Defaults

| Intersection context | Green phase duration | Full cycle time |
| -------------------- | -------------------- | --------------- |
| Downtown arterial    | 35s                  | 82s             |
| Standard arterial    | 25s                  | 62s             |
| Collector            | 20s                  | 52s             |
| Residential          | 15s                  | 42s             |

All signals: yellow = 4s, all-red = 2s. Left-turn phase (arterials only): 8s protected.

---

## Appendix: Instancing Budget (Revised)

| Category                  | Draw calls | Max instances                                                           |
| ------------------------- | ---------- | ----------------------------------------------------------------------- |
| Vehicle types (8)         | 8          | 140                                                                     |
| Pedestrian sprites        | 1          | 100                                                                     |
| Street lights             | 1          | 400                                                                     |
| Traffic light poles       | 1          | 80                                                                      |
| Stop signs                | 1          | 60                                                                      |
| Bus stops                 | 1          | 20                                                                      |
| Power line poles          | 1          | 200                                                                     |
| Power line wires (merged) | 1          | n/a (1 BufferGeometry)                                                  |
| Fire hydrants             | 1          | 150                                                                     |
| Highway guard rails       | 1          | 300                                                                     |
| Benches/misc              | 1          | 100                                                                     |
| Parked cars               | 2          | 300                                                                     |
| Buildings (5 districts)   | 5          | ~800 (merged BufferGeometry per district)                               |
| Road surfaces             | 4          | n/a (local+collector, arterial, expressway, sidewalk — merged per type) |
| Road markings/decals      | 1          | n/a (merged)                                                            |
| **Total**                 | **~31**    |                                                                         |

Note: Buildings use merged BufferGeometry (all buildings in a district baked into one geometry), not InstancedMesh. This allows varied shapes per building. Vehicle types use InstancedMesh (same shape, many instances). Power line wires are a single merged BufferGeometry of catenary curves, not individual Line objects (avoids per-wire draw calls).

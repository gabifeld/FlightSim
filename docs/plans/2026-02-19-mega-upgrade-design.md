# FlightSim Mega Upgrade Design

## Overview
Major feature expansion: international mega-hub airport, full-lifecycle AI aircraft, fuel system, code review fixes, and gameplay enhancements.

## 1. International Airport (-8000, 8000)

**Layout:**
- 2 parallel runways (09L/27R, 09R/27L): 3000m × 60m, 300m apart, E-W orientation
- Terminal 1 (Domestic): 6 gates, south side between runways
- Terminal 2 (International): 8 gates, north side
- Terminal 3 (Cargo): 4 bays, east end
- Control tower between terminals
- Fuel depot, hangars, fire station (west end)
- Taxiway network: Alpha + Bravo parallel, cross-taxiways, ~40 nodes
- Approach lighting on all runway ends

**Module:** `internationalAirport.js` — exports `createInternationalAirport(scene)`, `getIntlTaxiNetwork()`

**Terrain:** 4000m × 2000m flatten zone. New constants: `INTL_AIRPORT_X = -8000`, `INTL_AIRPORT_Z = 8000`

## 2. AI Aircraft System

**Module:** `aircraftAI.js`

**Count:** 4-6 active AI planes

**State machine:**
PARKED → TAXI_OUT → HOLDING → TAKEOFF_ROLL → CLIMB → CRUISE → DESCENT → APPROACH → LANDING → TAXI_IN → PARKED

**Routes:** Random assignments between 3 airports (origin, 8000/-8000, -8000/8000)

**Physics:** Simplified — position interpolation along route with altitude/speed profiles. No full aero model.

**Visuals:** Simplified 737/A320 models via aircraftGeometry.js. Nav lights + beacon.

**Deconfliction:** Runway occupied flag per runway. Others hold short.

**Sound:** Distant jet drone within 2000m of player.

## 3. Fuel System

- `unlimitedFuel: true` default in settings.js
- Fuel property on vehicle state, burns at `throttle × burnRate`
- When unlimited: stays 100%. When limited: depletes, thrust → 0 at empty
- HUD fuel gauge (percentage bar)
- Toggle: `U` key + settings menu

## 4. Code Review Fixes

1. Hoist THREE.Color in scene.js:358
2. Throttle generateEnvironmentMap() — only on 5°+ sun elevation change
3. Cache getActiveVehicle() in game loop
4. Add '5' to SIM_KEYS
5. Extract resetFlight() in main.js
6. Pre-create landing assist HUD element
7. Cache DOM lookups in hud.js
8. Remove redundant ternary in gpws.js
9. Remove redundant traverse in weatherFx.js
10. Pre-allocate thunder buffer in audio.js

## 5. Enhancements

- **Landing scoring:** Rate touchdowns (butter/firm/hard/crash) on VS + centerline
- **ATC chatter:** SpeechSynthesis traffic advisories for AI planes
- **Ground effect:** Enhanced model in physics.js
- **Terrain height cache:** Cache 384×384 grid, bilinear interpolation for runtime
- **Wake turbulence:** Particle trails from AI wingtips

## Implementation Strategy

Use parallel agent teams:
- Team A: International airport (geometry, taxi network, lights, terrain flattening)
- Team B: AI aircraft system (state machine, routes, visuals, sound)
- Team C: Code fixes + fuel + enhancements (quick wins, fuel system, scoring, ATC)

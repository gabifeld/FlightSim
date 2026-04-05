# Spectacular Upgrade — Design Spec

## Overview

Turn the flight simulator into something jaw-dropping across four dimensions: visual spectacle, flight feel, living world, and depth — in that order. Smoothness, fun, and consistency with the existing stylized aesthetic are the top priorities throughout.

## Design Principles

1. **Stylized, not photorealistic** — the sim has a strong identity (toon outlines, flat Lambert materials, cartoon clouds, stepped terrain, gradient sky). All upgrades amplify this style. Think Studio Ghibli meets flight sim.
2. **Smooth always** — every transition lerps. No pops, no hard cuts, no instant state changes. Minimum 0.3s for UI, 1-2s for environmental changes.
3. **Fun over realism** — sim-lite defaults are generous. Punishing mechanics exist but are opt-in (study mode). A new player should feel competent within 30 seconds.
4. **60fps on M1 MacBook Pro** — every effect has quality tiers or graceful degradation. Performance is a feature.
5. **Preserve existing layouts** — cities, airports, terrain stay where they are. Improve what exists, don't rebuild.

## Non-Goals

- Photorealistic PBR material overhaul
- Volumetric raymarched clouds (too expensive for browser)
- Server-side infrastructure (leaderboards, accounts)
- Rebuilding city grid layout or road positions
- VR support
- Multiplayer

---

## Phase 1: Visual Wow + Polish Foundation

### 1.0 — Smoothness & Consistency Pass

Fix every hitch, pop, snap, and inconsistency before building new features.

#### Bug Fixes

- **Floating cars / terrain clipping**: ensure all vehicles and buildings sample `getGroundLevel()` correctly. No hardcoded Y values for any moving entity.
- **Choppy vehicle movement**: add fixed-timestep (30Hz) + visual interpolation (lerp at 60fps) for all city and highway traffic. Store previous position each tick, interpolate for rendering.
- **Audio pop on first interaction**: add 0.1s gain ramp on first AudioContext resume. No click/pop on first throttle-up.
- **Particle cleanup on reset**: flush all particle pools (tire smoke, dust, exhaust, vapor, contrails, afterburner) on aircraft switch or reset. No lingering particles from previous flight.
- **Post-processing transition flash**: buffer quality tier changes behind a 1-frame delay. No white flash when changing graphics settings mid-flight.
- **HUD jitter at low speed**: add deadband smoothing on speed tape and attitude indicator below 5 knots. Values hold steady when nearly stationary.
- **Camera snap on mode switch**: interpolate position, rotation, and FOV over 0.3s when switching between chase/cockpit/orbit. Never a hard cut.
- **Stall warning residual hum**: verify direct gain toggle produces zero output at zero throttle. No audible tone when it shouldn't be active.

#### Consistency Audit

- **Time-of-day sync**: verify ALL visual systems respond to the same time uniform — sky, fog, building windows, street lights, cloud colors, water tint, ambient light. All must lerp smoothly. No system should pop or lag behind others.
- **Reset completeness**: on R key or main menu return, audit every `reset*()` function. Particles, camera shake, vignette, crash state, ATC, challenges, replay, autopilot, G-force onset — all must fully clear.
- **Spawn/despawn consistency**: all dynamic entities (traffic, AI aircraft, ground vehicles) use opacity fade for spawn (0→1 over 1s) and despawn (1→0 over 1s). No popping.

---

### 1.1 — Cloud Overhaul

**Current state:** Puffier cartoon clouds using sphere clusters. No aircraft interaction.

**Upgrade:**

- **Three altitude bands**: cumulus (1500m), alto (3000m), cirrus (6000m). Each band has distinct visual style — cumulus are fat and fluffy, alto are flat sheets, cirrus are thin wisps.
- **Fly-through fog**: when aircraft center is inside a cloud bounding volume, apply localized exponential fog (density 0.005) + dampen audio master gain to 70% + reduce sun intensity to 40%. Smooth 1s fade in/out on enter/exit. Never a hard edge.
- **Cloud shadows on terrain**: for each cumulus cloud, project a soft circular shadow onto the terrain below. Use a shadow plane mesh at ground level with alpha based on cloud position. Shadows drift with wind vector. Subtle opacity (0.15) — felt not seen.
- **Weather-driven density**: clear=20% of cloud budget, overcast=80% as solid layer, storm=100% with darker albedo and taller vertical extent.
- **Rendering**: billboard sprites with soft radial gradient edges on InstancedMesh. Current sphere-cluster approach stays for close clouds, billboard imposters for distant ones (>3000m from camera). Quality tiers: low=50% count, medium=75%, high=100%.
- **Wind drift**: clouds move with wind vector at 50% wind speed. Wrapping at world boundaries.

---

### 1.2 — Water Overhaul

**Current state:** Custom flat shader replacing Three.js Water. No waves, no reflections.

**Upgrade:**

- **Gerstner wave vertex displacement**: 3 wave components with different frequencies, amplitudes, and directions. Visible undulation from cockpit altitude. Amplitude scales with weather (calm=0.3m, storm=2m).
- **Stylized water shader**:
  - Base color: deep blue-green, tinted by sky color (environment map sample)
  - Specular: cel-shaded hard-edge sun reflection (step function, not smooth). Bold white band, consistent with flat material style.
  - Foam: white lines at wave peaks using a noise threshold on wave height derivative
  - Fresnel: shallow viewing angle = more sky reflection, steep = more depth color
- **Shore foam**: screen-space depth comparison between water surface and terrain. Where depth difference < 2m, blend in white foam texture. Scrolls with wave direction.
- **Seaplane wake**: V-shaped foam trail behind Beaver when on water. Two line geometries diverging from hull, scrolling foam texture. Fade out over 3s behind aircraft.
- **Performance**: waves computed in vertex shader (GPU). No CPU-side wave simulation. Foam is fragment shader only. One draw call for entire ocean.

---

### 1.3 — Atmospheric Depth

**Current state:** Gradient sky shader, FogExp2 for distance. Distant objects fade to uniform fog.

**Upgrade:**

- **Aerial perspective**: in terrain and building fragment shaders, mix fragment color toward sky horizon color based on camera distance. Factor: `1.0 - exp(-distance * 0.00008)`. Distant mountains go blue-purple, not gray.
- **Fog color sync**: fog color now samples from sky shader's horizon band per time-of-day. Warm gold at sunset, cool blue at dawn, dark blue-gray at night. Updated every frame via uniform.
- **Horizon glow**: at sunset/sunrise (sun elevation 0-10°), add a 1D gaussian bloom to the bottom 15% of the post-processing output. Warm tint matching sun color. Intensity peaks at sun elevation 3°.
- **Transition smoothness**: all atmospheric uniforms (fog density, fog color, aerial perspective strength, horizon glow) lerp with 3s time constant. Time-of-day slider changes feel gradual and natural.

---

### 1.4 — Crash Effects Overhaul

**Current state:** Fireball + smoke + debris, all using spheres. Functional.

**Upgrade:**

- **Debris geometry**: create 6-8 procedural fragment meshes at init (angular shard shapes using ConvexGeometry from random point sets). On crash, spawn 15-25 fragments with random selection from the pool. Each fragment gets angular velocity (random axis, 2-8 rad/s) and tumbles as it flies. Affected by gravity. Fragments use aircraft body material color.
- **Impact sequence** (timed):
  - T+0.00s: screen flash (white overlay, 0→0.8→0 opacity over 0.1s)
  - T+0.00s: heavy camera shake burst (amplitude 3x normal, decay over 0.8s)
  - T+0.05s: fireball bloom (existing, but increase bloom intensity spike 2x for 0.3s)
  - T+0.05s: shockwave ring — expanding torus in post-processing. Screen-space UV distortion radiating from impact point. Radius 0→0.4 screen units over 0.3s, opacity 0.3→0.
  - T+0.10s: debris scatter begins (fragments fly outward with velocity 10-30 m/s)
  - T+0.50s: smoke column rises (existing, increase lifetime to 8s)
- **Persistent wreckage**: debris fragments come to rest on terrain (damped bounce), stay visible for 15s, then fade over 3s. Smoke column persists 8s.
- **Sound sync**: existing 4-layer crash sound aligns — impact thump at T+0, crunch at T+0.05, glass tinkle at T+0.3, rumble sustain under smoke.

---

### 1.5 — Weather Effects Upgrade

**Current state:** 1500 rain particles, flat lightning sprite, uniform fog.

**Upgrade:**

- **Rain streaks**: elongate rain particles along their velocity vector. Length = `speed * 0.02` (faster aircraft = longer streaks). Gives strong speed-in-rain sensation. Particle color slightly bluish-white.
- **Windshield rain** (cockpit camera only): 2D canvas overlay (256x256). Procedural raindrop blobs spawn at random positions, then streak downward + sideways based on aircraft velocity vector projected onto screen plane. 20-40 active drops. Each drop leaves a wet trail that fades over 2s. Overlay composited in post-processing at 0.3 opacity. Disabled in chase/orbit camera.
- **Branching lightning**:
  - Generate bolt as L-system: start point at cloud base, end point on terrain. 3-4 recursion levels with random angular deviation (±30°) at each branch point. 2-3 side branches per main bolt.
  - Render as LineSegments geometry with emissive white material, additive blending.
  - Visible for 0.15s, afterglow at 30% opacity for 0.1s.
  - On strike: spike ambient light intensity by 2x for 0.1s (illuminates everything briefly). Cloud layer flashes white from below.
- **Fog layers**: replace single FogExp2 with altitude-banded fog via fragment shader uniform. Three bands:
  - Ground fog (0-200m AGL): density 3x base
  - Mid-level (200-2000m): density 1x base (current behavior)
  - High altitude (>2000m): density 0.3x base (clearer above weather)
  - Smooth interpolation between bands. Aircraft descending into ground fog = gradual visibility loss.
- **Rain audio**: layer on top of existing wind rush. Bandpass noise (1000-4000 Hz) with metallic resonance filter (Q=3 at 2500 Hz) simulating rain on fuselage skin. Volume scales linearly with rain intensity. Fade in/out over 1s when entering/leaving rain.
- **Thunder enhancement**: on lightning strike, queue thunder sound with delay = `distance_to_bolt / 343` seconds (speed of sound). Max delay 8s. Existing thunder synthesis is fine, just add the delay.

---

## Phase 2: Flight Feel

### 2.1 — Engine Audio Overhaul

**Current state:** 3 sine/triangle oscillators at 45/90/135 Hz for all aircraft types. Generic hum.

**Upgrade — three distinct engine voices:**

#### Piston Engine (Cessna 172, DHC-2 Beaver)

- **Fundamental**: RPM-driven (80 Hz idle → 180 Hz full throttle). Triangle wave for warmth.
- **Harmonics**: 4 overtones at 2x, 3x, 4x, 6x fundamental. Each with decreasing amplitude (0.5, 0.3, 0.15, 0.08). Sawtooth waves for grit.
- **Cylinder firing**: amplitude modulation at crankshaft frequency / 2 (simulates 4-stroke). Subtle pulsing that increases at low RPM, smooths out at high RPM.
- **Exhaust crackle at idle**: short noise bursts (20ms, bandpass 150-400 Hz) triggered at random intervals (3-8 per second) when throttle < 20%. Creates the characteristic pop-pop-pop of a piston engine at idle.
- **Prop wash**: bandpass noise (200-800 Hz, Q=1.5), volume and center frequency scale with RPM. Provides the air-cutting whoosh.
- **Startup sound**: cranking noise (filtered sawtooth at 15 Hz for 1.5s) → catch (frequency jump to idle RPM) → settle (0.5s RPM oscillation then stable).

#### Turbofan (Boeing 737, Airbus A340)

- **Core rumble**: low sine (100-300 Hz), frequency tracks N1. Volume 0.3.
- **Compressor whine**: thin sine (2000-4000 Hz), frequency tracks N2. Volume 0.08. High-pass filtered to sound whistle-like.
- **Bypass rush**: bandpass noise (300-1500 Hz, Q=0.8), volume tracks N1 (louder at high thrust). The dominant sound.
- **Spool sweep**: on throttle advance, a 0.5s upward frequency sweep on the compressor whine (sounds like winding up). On throttle retard, 1s downward sweep.
- **Idle characteristic**: at idle, core rumble and bypass rush are quiet, compressor whine is relatively prominent. Creates the high-pitched idle whine characteristic of parked jets.

#### Fighter Engine (F-16)

- **Core roar**: aggressive sawtooth (150-500 Hz), louder than civil engines. Volume 0.5.
- **Afterburner**: activates above 90% throttle. Adds: crackling hash noise (broadband, unfiltered, volume 0.3) + deep rumble (sine at 30-60 Hz, volume 0.4). 0.3s activation delay with a "light-off" thump (single noise burst at activation).
- **Compressor scream**: high sine (3000-6000 Hz), thin and aggressive. Louder than civil compressor whine.

#### Multi-Engine Audio

- Each engine gets its own set of oscillator/noise nodes.
- Stereo panning: engine 1 panned -0.3 (left), engine 2 panned +0.3 (right). 4-engine aircraft: -0.5, -0.2, +0.2, +0.5.
- On engine failure: that engine's audio group fades to silence over 2s (spool-down). Remaining engines continue. Asymmetric sound creates strong spatial cue.
- Volume per engine: `1 / sqrt(numEngines)` to maintain consistent total level.

#### Transitions

- Aircraft switch: 0.5s fade out old engine → 0.2s silence → 0.5s fade in new engine. All frequency ramps use `setTargetAtTime` with 0.15s time constant for smoothness.

---

### 2.2 — Camera System Polish

**Current state:** 3 modes (chase, cockpit, orbit). Chase has spring-damper. Hard cuts between modes.

#### Smooth Mode Transitions

- On mode switch, capture current camera world position/quaternion/FOV. Capture target mode's initial position/quaternion/FOV. Spherical-lerp rotation and linear-lerp position/FOV over 0.5s. During transition, disable camera update logic; just interpolate. Resume target mode's update logic at transition end.

#### Chase Camera Improvements

- **Speed-dependent lag**: spring damper distance increases from 15m at 0 m/s to 25m at 250 m/s. Camera falls further behind during acceleration (feels fast), catches up during deceleration.
- **Roll lag**: when aircraft banks, camera follows with 0.2s delay. Implemented as exponential lerp on camera roll toward aircraft roll. Makes banking feel dynamic and weighty.
- **Pitch lag**: slight delay on pitch following (0.15s). Pulling up, you see more sky before camera catches up.

#### New Camera Modes

- **Flyby camera**: on activation, place camera at a fixed world position 200m ahead of aircraft's velocity vector and 50m to the side, 20m above ground level. Camera tracks aircraft smoothly (lookAt with 0.05s lerp). As aircraft passes, camera holds position and tracks the retreating aircraft. After aircraft is 500m past, auto-switch back to chase. Great for dramatic passes.
- **Tower camera**: place camera at nearest airport's tower position (30m AGL at airport center). Smooth tracking (lookAt with 0.1s lerp). Zoom FOV based on distance to aircraft (nearer = wider, farther = narrower). Shows scale.
- **Cinematic replay camera**: during replay playback only. Auto-cycles between chase/flyby/tower every 6s. Each cut uses the 0.5s smooth transition. Selects the mode that provides the most dramatic angle (e.g., flyby when aircraft is fast, tower when near airport).

#### Cockpit Camera Refinement

- **Engine vibration**: 2-3 Hz micro-shake, 0.3mm amplitude. Uses existing shake system at low intensity. Increases with throttle (idle=0.1mm, full=0.5mm). Felt as subtle aliveness.
- **Turbulence response**: turbulence perturbations (from weather) drive camera shake at 0.3x the physics perturbation amplitude. Separate from engine vibration, adds on top.
- **G-force head movement**: under sustained G > 2, camera drifts down slightly (0.5° per G above 2, max 3°). Recovers over 1s when G decreases. Simulates head droop.

---

### 2.3 — G-Force Visual Chain

**Current state:** FOV compression and vignette exist. Blackout/redout state machine exists but visuals are incomplete.

#### Progressive Chain (Positive G)

All effects use `gOnset` (the smoothed sustained G value, 1.5s time constant, already in flightModel.js).

| gOnset | Effect | Implementation |
|--------|--------|----------------|
| 1.0-3.0 | Normal | No effects |
| 3.0-4.5 | Peripheral dim | Vignette radius shrinks: `radius = 1.0 - (gOnset - 3.0) * 0.2` |
| 4.5-6.0 | Tunnel vision | Vignette continues + barrel distortion uniform ramps 0→0.02 |
| 6.0-7.5 | Gray-out | Color grading saturation lerps from 1.0→0.0 |
| 7.5-9.0 | Near-blackout | Vignette radius < 0.3, saturation 0, brightness dims 30% |
| 9.0+ | Blackout (study only) | Full black vignette, controls disabled 3s, then 2s recovery |

#### Negative G (Redout)

| gOnset | Effect | Implementation |
|--------|--------|----------------|
| 1.0 to -0.5 | Normal | No effects |
| -0.5 to -2.0 | Red tint | Red color overlay, opacity `(|gOnset| - 0.5) * 0.3` |
| -2.0 to -3.0 | Red vignette | Red-tinted vignette from edges |
| -3.0+ | Redout (study only) | Full red overlay, controls disabled 2s |

#### Sim-Lite vs Study Thresholds

- **Sim-lite**: all thresholds shifted +3G (peripheral dim starts at 6G, blackout never). Negative G redout starts at -4G. Most players never see any effects.
- **Study**: thresholds as listed above. Demanding but fair.

#### Smoothness

- All effects onset over 1.5s, offset over 1.0s. Never instant.
- Transitions between adjacent levels are continuous (no stepping).
- FOV compression (existing) remains active independently.

---

### 2.4 — Stall/Spin Dynamics

**Current state:** State machine in flightModel.js. Basic implementation of buffet → stall → spin.

#### Buffet Zone

- Begins 3° AOA before critical stall angle.
- Random pitch perturbations: ±0.01 rad at 8 Hz, amplitude increases linearly as AOA approaches stall.
- Random roll perturbations: ±0.02 rad at 6 Hz (different frequency prevents predictable pattern).
- Camera shake: driven by buffet intensity at 0.5x physics amplitude. Cockpit view only.
- Audio: airframe rattle — bandpass noise (80-150 Hz, Q=3), amplitude tracks buffet intensity. Sounds like structure flexing. Fade in over 0.5s as buffet begins.

#### Stall

- Full lift collapse (existing behavior preserved).
- **Asymmetric wing drop**: on stall entry, randomly select left or right wing (seeded from frame timestamp). Apply roll moment: ±0.3 rad/s (study) or ±0.15 rad/s (sim-lite). Roll moment builds over 0.5s, not instant.
- Coupled yaw: wing drop induces yaw toward dropped wing at 0.5x roll rate.
- Camera: additional roll shake, 1.5x buffet amplitude.

#### Spin Entry

- **Trigger**: pro-spin inputs held > 1s after stall (back stick + rudder in roll direction).
- **Incipient spin** (0-2s): pitch gradually locks nose-down to 30° below horizon. Roll rate increases from wing-drop rate to 1.5 rad/s. Altitude loss begins (~150 ft/s).
- **Developed spin** (>2s): sustained autorotation. Corkscrew descent. Aircraft descends at ~300 ft/turn.
- Camera: rotation lag of 0.3s — world spins, camera follows with delay. Disorienting but smooth.

#### Recovery

Correct procedure:
1. Throttle idle
2. Opposite rudder (against spin direction)
3. Forward stick (break AOA)
4. Level wings after rotation stops

Spin decelerates over 1-2s after correct inputs. Roll rate smoothly decreases. Nose comes up gradually. Not an instant stop.

#### Sim-Lite Behavior

- Auto-recovery after 3s in spin. Aircraft self-corrects with gentle roll damping.
- Wing drop is halved (±0.15 rad/s).
- Spin is short — 1 turn max before auto-recovery.
- Player learns what a stall feels like without punishment.

---

### 2.5 — Wind & Turbulence Feel

**Current state:** Wind vector in physics, turbulence as pseudo-noise. Effects exist but aren't visceral.

#### Wind Audio

- **Headwind/tailwind**: wind rush volume scales with headwind component (dot product of wind vector and aircraft forward vector). Headwind = louder, tailwind = quieter. Smooth 0.5s transitions.
- **Crosswind whoosh**: crosswind component (perpendicular to aircraft) drives a separate bandpass noise (400-1200 Hz). Stereo-panned based on wind direction relative to aircraft heading. Wind from left = sound panned left.

#### Turbulence Camera Response

- Physics turbulence perturbations (already applied to aircraft) also drive camera shake at 0.3x intensity. This means you see the bumps in the view, not just feel them in the flight path.
- Shake frequency matches turbulence frequency (different from engine vibration). Layered on top.

#### Gust Audio

- On gust events (already generated in weather.js as sudden wind spikes): play a 0.2s noise burst, bandpass 200-800 Hz, with sharp attack and 0.3s decay. Volume proportional to gust magnitude. Sounds like a sudden buffet of wind hitting the airframe.

#### Control Perturbations

- In turbulence, add random input-like perturbations to pitch and roll: ±0.02 (sim-lite) or ±0.05 (study). Applied as additive offsets after player input, before physics. Aircraft feels like it's being pushed around by air.
- Perturbation frequency: 2-4 Hz (slow enough to feel organic, fast enough to notice).

---

## Phase 3: Living World

### Design Principle

Make the existing city feel alive without changing its layout. Add traffic, pedestrians, signals, lighting, and furniture to the existing road grid and building placements.

### 3.1 — Existing City Polish

#### Vehicle Traffic on Existing Roads

- Use the existing road network from `city.js` (`getRoadNetwork()` segments).
- Spawn AI vehicles on road segments. Vehicles follow the segment direction, interpolate position along the segment, U-turn or pick a connecting segment at intersections.
- **Fixed-timestep movement** (30Hz) with visual interpolation at render rate. Same pattern as Section 1.0.
- **Height sampling**: every vehicle samples `getGroundLevel()` each physics tick. No hardcoded Y. Fixes floating cars.
- **Vehicle types**: sedan, SUV, truck, bus. Use existing `carGeometry.js` templates as InstancedMesh. 4 vehicle types = 4 draw calls.
- **Budget**: 60 active vehicles max in the city. Spawn near camera, despawn when >1500m away. Fade in/out over 1s.
- **Behavior**: follow road at 30-50 km/h. Maintain 2s following distance. Slow for intersections. No lane changes needed (existing roads are mostly single-lane per direction).

#### Highway Traffic Fix

- Existing `highwayTraffic.js` vehicles get the same interpolation treatment.
- Height sampling from `getGroundLevel()` instead of any hardcoded values.
- Spawn/despawn with 1s opacity fade.

#### Traffic Signals

- At major intersections in the existing city grid, place traffic signal meshes.
- Simple 2-phase state machine: N-S green (25s) → yellow (4s) → all-red (2s) → E-W green (25s) → yellow (4s) → all-red (2s).
- Visual: InstancedMesh pole (one draw call) + 3 emissive spheres per signal. Swap which sphere is emissive based on phase. ~20 signals total.
- AI vehicles query the signal ahead and decelerate to stop on red. Resume on green.
- Performance: signal logic ticks at 1Hz. Visual update is just emissive material swap.

#### Pedestrians

- Billboard sprite system. 4 sprite variants × 4 color palettes = 16 on a 256×256 procedural canvas atlas (circle head, rectangle torso, line legs — reads fine as billboard at distance).
- One InstancedMesh, always-face-camera. Budget: 60 active pedestrians.
- Spawn near sidewalks (offset 3m from road center), walk along road direction at 1.3 m/s.
- At intersections: pause 2-5s, then continue or turn.
- Fade out beyond 200m camera distance. Fade in on spawn (1s).
- Walk animation: alternate 2 UV frames at 3Hz (UV offset per instance).

#### Street Furniture

Place along existing roads using road segment positions:

| Element | Spacing | Rendering | Budget |
|---------|---------|-----------|--------|
| Street lights | Every 50m on major roads | InstancedMesh pole + emissive sphere | ~80 |
| Traffic lights | At signalized intersections | InstancedMesh (shared with signals) | ~20 |
| Benches | Every 200m on sidewalks | InstancedMesh | ~40 |
| Bus stops | Every 300m on major roads | InstancedMesh shelter | ~10 |

- Street lights: off during day, on at night (sun elevation < 5°). 30s fade transition. Orange sodium-vapor color (2200K). Emissive only — no PointLights per lamp (too expensive). 4 pooled PointLights assigned to the 4 nearest street lights to camera for actual light casting.
- Total additional draw calls: ~6 (one InstancedMesh per furniture type).

#### Building Night Lighting

- Window emissive patterns on existing buildings driven by time-of-day uniform.
- Each building gets a deterministic random seed (based on position). Seed determines which windows are lit.
- Occupancy schedule: downtown 80% lit at 8pm, 30% at 2am. Residential: 60% at 8pm, 10% at 2am.
- Window emissive color: warm amber (2700K). Applied as emissive property on existing MeshLambertMaterial.
- Transition: windows fade on/off individually over 2-5 minutes (staggered by seed). Creates natural "lights turning on/off" effect at dusk/dawn.

### 3.2 — Driving Mode Polish

- Player-drivable car reads surface height from `getGroundLevel()` consistently — no bouncing on road transitions.
- City traffic responds to same signals as AI vehicles. Player can run reds but traffic won't.
- Car engine audio: separate from aircraft engine audio. Low rumble (60-120 Hz) + exhaust note (200-400 Hz) scaling with speed. Distinct from any aircraft sound.
- Race mode city circuit benefits from traffic — dodge AI vehicles adds fun challenge.

---

## Phase 4: Depth & Replayability

### 4.1 — Pilot Career System

- **Ranks**: Student Pilot → Private Pilot → Commercial Pilot → ATP → Captain
- **XP sources**:
  - Landing score: score × 2 XP (perfect butter = 200 XP)
  - Challenge completion: 100-500 XP based on difficulty
  - Flight hours: 10 XP per minute airborne (capped at 50 XP per flight to prevent AFK farming)
  - First visits: 200 XP for first landing at each airport
  - Aircraft mastery: 150 XP for first flight in each aircraft type
- **Rank thresholds**: Student=0, Private=1000, Commercial=5000, ATP=15000, Captain=30000
- **Unlocks per rank**:
  - Private: study mode available, crosswind challenges unlocked
  - Commercial: engine-out challenge, daily challenges
  - ATP: advanced failures, icing weather
  - Captain: all livery tints, bragging rights
- **Storage**: localStorage object `pilotCareer: { xp, rank, achievements, firstVisits, firstAircraft }`
- **Display**: career panel in main menu — rank badge, XP progress bar, next unlock preview

### 4.2 — Statistics Dashboard

- New menu panel: "PILOT LOG"
- **Lifetime stats**:
  - Total flight time (hours:minutes)
  - Total landings / total crashes / landing success rate
  - Average landing score
  - Favorite aircraft (most hours)
  - Longest flight
- **Per-aircraft stats**: hours, landings, best landing score, crashes
- **Per-airport stats**: total visits, best landing score
- **Current streak**: consecutive successful landings without crash
- **Storage**: localStorage, updated after each flight/landing
- **UI**: grid layout matching existing settings panel style. Clean, monospace numbers.

### 4.3 — Achievement System

20 achievements at launch:

| Badge | Condition | XP Bonus |
|-------|-----------|----------|
| First Flight | Complete first flight | 50 |
| Butter | Land with < 60 fpm VS | 100 |
| Centerline King | Land within 1m of centerline | 100 |
| Crosswind Warrior | Land in 18kt+ crosswind | 200 |
| Crosswind Master | Land in 30kt+ crosswind | 300 |
| Iron Pilot | 10 consecutive landings without crash | 500 |
| Explorer | Land at all 6 airports | 300 |
| Night Owl | Land at night (after 10pm) | 150 |
| Dawn Patrol | Take off before 6am | 100 |
| Mayday Mayday | Recover from engine failure and land safely | 300 |
| Speed Demon | Complete speedrun under 3 minutes | 200 |
| Full Circuit | Complete gate-to-gate flight | 250 |
| Multi-Type | Fly all 5 aircraft types | 200 |
| Sea Legs | Land seaplane on water | 150 |
| Storm Rider | Land in storm weather | 200 |
| Greaser | 3 consecutive "butter" landings | 300 |
| Heavy Metal | Land the A340 with score > 80 | 250 |
| Top Gun | Fire all 6 missiles in one flight (F-16) | 100 |
| Road Trip | Complete a race circuit | 150 |
| Captain | Reach Captain rank | 0 (rank is the reward) |

- **Toast notification**: on unlock, slide-in panel from top-right. Badge icon + name + XP earned. Visible 3s, then slide out. Non-intrusive during flight.
- **Gallery**: achievement grid in menu. Earned badges are bright, unearned are dimmed with hint text.

### 4.4 — Procedural Challenge Generator

- **"Quick Challenge" button** in aircraft selection menu
- Generates random parameters:
  - Aircraft: random from unlocked types
  - Airport: random from 6
  - Runway: random valid runway at that airport
  - Wind: 0-25 kt from random direction
  - Weather: weighted random (60% clear, 20% overcast, 15% rain, 5% storm)
  - Time of day: random 0-24
  - Failure: 15% chance of engine failure on approach
- **Difficulty rating**: 1-5 stars computed from parameter combination (crosswind + weather + failure + aircraft difficulty)
- **Seed**: all parameters encoded in a 6-character alphanumeric seed. Displayed on screen. Can be shared — entering same seed reproduces exact conditions.
- **Scoring**: same landing score system + difficulty multiplier (1x-3x based on stars)

### 4.5 — Enhanced ATC

#### Clearance Flow

State machine per flight:

```
PARKED → [F1: request pushback] → PUSHBACK → [auto: pushback complete]
→ TAXI_OUT → [F1: ready for takeoff] → HOLD_SHORT → [ATC: cleared for takeoff]
→ TAKEOFF → [ATC: radar contact, climb and maintain FL030]
→ ENROUTE → [approaching destination] → [ATC: descend to 2000, cleared ILS approach]
→ APPROACH → [ATC: cleared to land runway 36]
→ LANDED → [ATC: exit runway, contact ground]
→ TAXI_IN → [ATC: taxi to gate] → PARKED
```

- Each transition triggered by F1 (player request) or automatically (ATC initiates).
- **Player can ignore ATC entirely** — no penalties in sim-lite. In study mode, violations are tracked as statistics (not fail states).
- ATC messages displayed as text in existing ATC HUD panel + optional speech synthesis (existing GPWS speech synthesis API).

#### Background Chatter

- Every 15-30s, generate a fake ATC call to a procedural callsign ("November-7-2-4-Bravo, turn left heading 270, descend and maintain 4000").
- Plays as quiet background audio (volume 0.05) when COM radio is tuned. Adds immersion.
- 20 pre-written templates with randomized callsigns, headings, altitudes.

#### ATIS

- Auto-generated from current weather state: wind, visibility, altimeter, active runway, weather condition.
- Displayed as scrolling text when tuned to ATIS frequency (existing radio system supports frequency tuning).
- Updates every time weather changes.

### 4.6 — Advanced Failures & Weather

#### Engine Fire

- **Trigger**: random in realistic mode (0.0005 per flight-hour), or manual in training mode.
- **Visual**: orange-red emissive glow on engine nacelle mesh. Smoke particles (existing system, brown-tinted) emitting from engine position. 10 particles/second, rising.
- **Audio**: fire alarm tone (alternating 800/1200 Hz, 0.5s cycle). Separate from stall warning.
- **Cascade**: if not handled within 30s (throttle idle on affected engine), spreads to hydraulic failure (flap response degrades) → electrical (10% battery drain increase).
- **Resolution**: throttle to idle + engine shutdown on affected engine. Fire extinguishes over 5s. Smoke fades over 10s.

#### Icing

- **Conditions**: active when temperature < 0°C (altitude-based: ~2°C per 1000ft lapse rate) AND visible moisture (in clouds or rain).
- **Windshield ice**: frost texture overlay (canvas-drawn crystalline pattern), opacity grows from 0→0.6 over 5 minutes in icing conditions. Starts from edges, progresses inward. Reduces visibility progressively.
- **Airframe ice**: drag coefficient increases by up to 30% over 10 minutes. Stall AOA decreases by 3°. Weight increases by up to 5%.
- **Pitot ice**: if pitot heat is off, airspeed freezes at current value after 2 minutes of icing. Adds ±5 kt jitter. Pitot heat toggle (new keybinding) prevents/clears.
- **De-ice**: toggle keybind. Clears windshield ice over 30s (wipe pattern). Prevents further accumulation while active. Increases electrical load (battery drains 2x faster with de-ice on).
- **Sim-lite**: icing effects are 50% strength and 2x slower to accumulate. Auto de-ice warning at 30% ice level.

#### Windshear

- **Trigger**: 5% chance per approach in storm weather. Occurs between 500-200ft AGL.
- **Effect**: sudden 15 kt headwind loss + 10 kt downdraft over 3 seconds. Causes rapid altitude loss and airspeed decay.
- **Warning**: GPWS calls "WINDSHEAR, WINDSHEAR" (speech synthesis). Red text overlay on HUD.
- **Recovery**: full throttle + 15° pitch up. If altitude recovered, continue approach or go around.
- **Sim-lite**: windshear effects are 50% strength. Auto-throttle engages if player doesn't react within 3s.

---

## Performance Budget

| Phase | Additional Draw Calls | Additional Entities | GPU Impact |
|-------|----------------------|--------------------|----|
| 1.0 (Polish) | 0 | 0 | Slight improvement (fewer wasted draws) |
| 1.1 (Clouds) | +1-3 (InstancedMesh per layer) | 200-400 billboards | Low (billboards are cheap) |
| 1.2 (Water) | 0 (replaces existing) | 0 | Low (vertex shader waves) |
| 1.3 (Atmosphere) | 0 (shader uniforms) | 0 | Negligible |
| 1.4 (Crash FX) | +1 (debris InstancedMesh) | 25 fragments (temp) | Negligible (only on crash) |
| 1.5 (Weather) | +1 (lightning lines) | 0 | Low (temporary geometry) |
| 2.1 (Audio) | 0 | 0 | 0 (CPU: Web Audio) |
| 2.2 (Camera) | 0 | 0 | 0 |
| 2.3-2.5 (Feel) | 0 (shader uniforms) | 0 | Negligible |
| 3.1 (City life) | +6 (furniture) +4 (vehicles) +1 (pedestrians) | 60 vehicles + 60 peds | Medium |
| 3.2 (Driving) | 0 | 0 | 0 |
| 4.x (Depth) | +0-1 (UI only) | 0 | 0 |

**Total additional draw calls**: ~17. Well within 60fps budget on M1.

---

## Files Modified/Created

### Phase 1

**Modified:**
- `src/main.js` — wire up new systems, fix reset completeness
- `src/scene.js` — fog color sync, atmospheric uniforms
- `src/terrain.js` — aerial perspective in terrain shader, cloud shadow plane
- `src/particles.js` — flush on reset, rain streak elongation
- `src/postprocessing.js` — shockwave pass, horizon bloom, barrel distortion uniform, windshield rain composite
- `src/crashFx.js` — debris geometry, impact sequence timing, persistent wreckage
- `src/weatherFx.js` — branching lightning, fog layers, rain audio, thunder delay
- `src/audio.js` — rain audio layer, first-interaction fade-in, gust audio
- `src/camera.js` — smooth mode transitions, interpolation on switch
- `src/hud.js` — deadband smoothing at low speeds
- `src/city.js` — vehicle height fix, spawn/despawn fading
- `src/highwayTraffic.js` — interpolation, height fix
- `src/cameraEffects.js` — ensure smooth lerps on all effects

**New:**
- `src/cloudSystem.js` — layered clouds, fly-through fog, cloud shadows, wind drift
- `src/waterShader.js` — Gerstner waves, stylized shader, shore foam, wake

### Phase 2

**Modified:**
- `src/engineAudio.js` — complete rewrite of synthesis (piston/jet/fighter voices)
- `src/camera.js` — new modes (flyby, tower, cinematic), chase improvements, cockpit refinement
- `src/cameraEffects.js` — full G-force visual chain, barrel distortion, desaturation
- `src/flightModel.js` — stall/spin dynamics enhancement, buffet audio trigger
- `src/physics.js` — control perturbations from turbulence
- `src/audio.js` — wind audio (headwind/crosswind/gust), airframe rattle
- `src/postprocessing.js` — barrel distortion uniform for G-effects

### Phase 3

**Modified:**
- `src/city.js` — traffic signal placement, night lighting uniforms, pedestrian init
- `src/cityBuildings.js` — window emissive time-of-day scheduling
- `src/carPhysics.js` — consistent height from getGroundLevel()
- `src/carGeometry.js` — vehicle templates for AI traffic InstancedMesh
- `src/hud.js` — traffic/pedestrian count in debug overlay

**New:**
- `src/cityTraffic.js` — AI vehicle traffic on existing road network (or modify existing)
- `src/pedestrians.js` — billboard pedestrian system
- `src/streetFurniture.js` — street lights, benches, bus stops (or modify existing)
- `src/intersections.js` — traffic signal state machine (or modify existing)

### Phase 4

**Modified:**
- `src/menu.js` — career panel, stats panel, achievement gallery, quick challenge button
- `src/gameState.js` — XP tracking, rank computation, achievement checks
- `src/challenges.js` — procedural challenge generator, seed encoding/decoding
- `src/atc.js` — clearance state machine, background chatter, ATIS
- `src/failures.js` — engine fire, icing, windshear
- `src/settings.js` — de-ice toggle, pitot heat, new keybindings
- `src/controls.js` — new keybindings for de-ice, pitot heat

**New:**
- `src/career.js` — pilot career state, XP, ranks, persistence
- `src/achievements.js` — achievement definitions, condition checking, toast UI
- `src/icing.js` — icing accumulation model, windshield frost overlay, de-ice system

### Notes on Existing Files

- Several Phase 3 files (`pedestrians.js`, `streetFurniture.js`, `intersections.js`, `cityTrafficUnified.js`) already exist in the repo from the ground realism spec work. During implementation, inspect each file to determine if it can be adapted to accept the existing `getRoadNetwork()` segment format, or if it's too tightly coupled to the road graph system from the ground realism spec. If tightly coupled, write new simplified versions that work with the existing city layout. If adaptable, modify to accept road segments as input. Decision is per-file at implementation time.

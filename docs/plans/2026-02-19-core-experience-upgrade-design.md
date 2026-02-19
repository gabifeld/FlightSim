# Core Experience Upgrade Design

Target: Best browser-based flight sim. Mid-range laptop (integrated GPU). Stylized clean aesthetic.

## 1. Performance (Target: 60fps)

**Auto-detect quality**: Run 2-second benchmark on first load. Auto-select Low/Med/High.

**Shadow budget**: Only player aircraft + sun directional cast shadows. Remove all building/structure castShadow. Stylized look benefits from flat lighting.

**Kill PointLights**: Replace ALL PointLights with emissive materials + Points sprites (glow dots). PointLights are the #1 perf killer. Night airports use sun directional + emissive + sprite glow only.

**Post-processing tiers**:
- Low: None (direct render)
- Med: Bloom only (quarter-res)
- High: Bloom + SMAA

**Vegetation cap**: Max 6K instances (down from 11K). Distance-based alpha fade instead of hard pop-in.

**Cloud cap**: Max 500 at any quality. Bigger, fewer clouds for same visual density.

**Instanced mesh merging**: Merge international airport static geometry into fewer draw calls.

## 2. Visual Polish (Stylized Clean)

**Terrain**: Stepped color palette — 4-5 elevation bands (sand, grass, dark grass, rock, snow) with hard-ish transitions. Clean, readable from altitude.

**Water**: Flat animated plane with subtle wave displacement, clean teal/blue gradient. Fake fresnel (environment color lerp by view angle). Remove heavy reflection computation.

**Sky**: Custom 3-color gradient shader (horizon warm, zenith cool, sun glow). Replace physical Sky addon. Cheaper and more stylized.

**Clouds**: Bigger, puffier, fewer sprites per cloud. Cartoon cumulus. Direct color assignment by time-of-day (white/orange/grey), not physically computed.

**Fog**: Distance fog fading terrain to sky color. Hides LOD transitions. Cheap (fog uniform in fragment shaders).

**Aircraft outlines**: Second pass with inverted normals + solid dark material (toon outline). Very cheap, big visual impact.

**Flat materials**: Shift buildings from MeshStandardMaterial (PBR) to MeshToonMaterial/MeshLambertMaterial where appropriate.

**Runway markings**: Bolder, thicker markings. Higher contrast for clean aesthetic.

**Lighting**: Single directional light only. Emissive night glow via materials + sprites. Explicit time-of-day color palettes (dawn/day/dusk/night) instead of computed sun colors.

## 3. Gameplay Feel

### Camera & Motion
- **Speed lines**: Subtle radial streaks >150kt. Faint lines near screen edges via shader overlay.
- **G-force camera**: Camera lags behind and compresses FOV on hard maneuvers.
- **Touchdown shake**: Brief shake proportional to VS. Butter = none, hard = big jolt.
- **Stall buffet**: Irregular camera shake near stall angle.
- **Chase camera spring**: Spring-damper model instead of linear lerp. Overshoot on rapid maneuvers.

### Audio (Web Audio synthesis)
- **Wind rush**: Continuous noise filtered by airspeed. Louder/higher at speed. Quiet in cockpit, loud in chase.
- **Gear thunk**: Short percussive on deploy/retract.
- **Flap motor whine**: Brief servo sound on flap changes.
- **Touchdown chirp**: Tire screech burst on landing.
- **Structural creak**: Subtle groaning at high G (>3G).
- **Cockpit ambiance**: Low hum in cockpit view.

### Flight Model Juice
- **Contrails**: Thicker, more visible at altitude. Stylized white ribbons.
- **Gear compression**: Landing gear dips on touchdown, springs back.
- **Engine exhaust**: Distortion sprite trail behind engines.
- **Dust kick-up**: Brown sprite burst on touchdown, fades.
- **Wing vapor**: Brief white wisps from wingtips at high G.

### HUD
- **Speed tape**: Smooth scrolling speed indicator.
- **Animated landing score**: Grade flies in, bars fill, "NEW BEST" pulses.
- **Minimalist mode**: Toggle to hide all but critical instruments.
- **Challenge countdown**: 3-2-1 before challenge starts.

## 4. Quick Wins

- **Loading screen**: Branded splash + progress bar during init.
- **Menu transitions**: Fade in/out between menu and gameplay.
- **Crash feedback**: Screen flash + crunch sound + 0.5s camera freeze before reset prompt.
- **Minimap**: Show runways, heading line, AI traffic dots.
- **Contextual hints**: Flash "GEAR: G | FLAPS: F" when approaching runway, "PUSH NOSE DOWN" when stalling.
- **Aircraft preview**: Rotating 3D model in aircraft select menu.

## Out of Scope (Future)

Career progression, mission system, leaderboards, multiplayer, new aircraft models. These build on the polished core.

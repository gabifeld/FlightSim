# Minimap Upgrade Design

## Problem
Current minimap only shows APT1, APT2, one city, and taxi network. Missing: international airport, second city, coastline, highway, beach features. No fullscreen view. No waypoints.

## Approach: Enhanced Canvas Minimap
Upgrade existing canvas-based minimap in hud.js with all world features, a fullscreen overlay mode, and tap-to-place waypoints.

## Section 1: World Features
Draw all missing features in `updateMinimap()`:
- International airport runway + "INTL" label (INTL_AIRPORT_X/Z constants)
- Second city zone + label (fictional name, e.g. "BAYVIEW" — not Cape Town)
- Coastline at COAST_LINE_X as blue boundary line
- Highway following HIGHWAY_CENTERLINE points as thin grey polyline
- Beach/pier/lighthouse markers near coast

All use existing constants from constants.js, overlaid on the terrain image.

## Section 2: Fullscreen Overlay
- **Trigger**: Tap minimap panel → opens fullscreen canvas overlay (80vmin square, centered, dark backdrop)
- **Close**: Tap outside map, X button, or Escape
- **View**: World-centered (fixed), shows entire world (~25000m range), aircraft is a moving green dot
- **State**: `minimapMode`: 'local' | 'overview' | 'fullscreen'
- **Rendering**: Same drawing logic as minimap, larger canvas (600x600 or viewport-scaled)
- **CSS**: New `#minimap-fullscreen` overlay, z-index 20, glass-panel aesthetic

## Section 3: Waypoints
- **Placement**: Tap on fullscreen map → converts canvas coords to world coords → places waypoint
- **Display**: Diamond markers with labels (WPT1, WPT2, ...) on minimap + fullscreen
- **Removal**: Tap existing waypoint on fullscreen map (20px hit radius)
- **HUD**: Nearest waypoint shows bearing + distance near heading display: "WPT1 → 045° 3.2nm"
- **Flight line**: Dashed line from aircraft to active waypoint on both views
- **Limit**: Max 5 waypoints, session-only (no localStorage)
- **Data**: Array `[{x, z, label}]` in hud.js module state

## Files Changed
| File | Change |
|------|--------|
| src/hud.js | All minimap logic: features, fullscreen, waypoints, HUD bearing display |
| style.css | Fullscreen overlay CSS |
| index.html | Add #minimap-fullscreen overlay div |

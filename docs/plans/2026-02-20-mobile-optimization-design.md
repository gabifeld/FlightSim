# Mobile Optimization Design

## Problem
Mobile experience has three issues: low resolution (DPR capped at 1.0 on low quality), bare visuals, and portrait layout not adapting controls/HUD properly.

## Approach: Smart Mobile Preset
Dedicated `mobile` graphics preset that prioritizes pixel ratio (sharpness) over shadows and post-fx. Portrait-adaptive CSS for touch controls and HUD.

## Mobile Preset (graphics.js)
```
mobile: {
  pixelRatioCap: 2.0,        // Sharp on Retina — biggest visual win
  shadowMapEnabled: false,    // Biggest GPU saver
  shadowQuality: 'low',
  cloudQuality: 'low',
  postFxQuality: 'mobile',   // Tone mapping only, no bloom/SMAA
  vegetationDensity: 'low',
  assetQuality: 'low',
}
```

## Post-Processing (postprocessing.js)
New `'mobile'` tier: RenderPass + OutputPass only. No bloom, no SMAA. Tone mapping preserved for correct sky/lighting appearance.

## Mobile Detection (mobile.js)
Export `isMobileDevice()` using `(pointer: coarse)` + touch support check. Used in main.js to skip benchmark and apply mobile preset.

## Startup Flow (main.js)
- If `isMobileDevice()` and user hasn't explicitly set quality: skip benchmark, apply `'mobile'` preset
- User can still override in settings menu

## Portrait Layout (style.css)
`@media (pointer: coarse) and (orientation: portrait)` rules:
- Joystick/throttle/buttons: same positions, responsive sizing (vw/vh units)
- Action buttons: reflow from vertical stack to horizontal row above joystick
- PFD: compact, repositioned to top-left
- Attitude indicator: smaller, centered
- Menu titles: slightly reduced font sizes

## Files Changed
| File | Change |
|------|--------|
| src/graphics.js | Add `mobile` preset |
| src/postprocessing.js | Handle `'mobile'` postFxQuality |
| src/mobile.js | Export `isMobileDevice()` |
| src/main.js | Skip benchmark on mobile, apply mobile preset |
| style.css | Portrait orientation media queries |

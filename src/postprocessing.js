import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { getTimeOfDay, getSunDirection, getHorizonColor } from './scene.js';
import { getSetting, isSettingExplicit } from './settings.js';
import { getSunElevation } from './utils.js';
import { createHeatHazePass } from './heatHaze.js';

let composer;
let bloomPass;
let godRaysPass;
let colorGradePass;
let vignettePass;
let postFxQuality = 'high';
let useComposer = true;
let _renderer = null;
let _scene = null;
let _camera = null;

// ── God Rays (Crepuscular Rays) Shader ─────────────────────────────────────

const GodRaysShader = {
  uniforms: {
    tDiffuse:     { value: null },
    uSunScreenPos:{ value: new THREE.Vector2(0.5, 0.5) },
    uIntensity:   { value: 0.0 },
    uDecay:       { value: 0.96 },
    uDensity:     { value: 0.8 },
    uWeight:      { value: 0.15 },
    uSamples:     { value: 20 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSunScreenPos;
    uniform float uIntensity;
    uniform float uDecay;
    uniform float uDensity;
    uniform float uWeight;
    uniform int uSamples;
    varying vec2 vUv;

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);

      if (uIntensity < 0.001) {
        gl_FragColor = baseColor;
        return;
      }

      // Direction from pixel toward sun in screen space
      vec2 deltaUV = (vUv - uSunScreenPos) * (1.0 / float(uSamples)) * uDensity;
      vec2 sampleUV = vUv;
      float illumination = 1.0;
      vec3 rays = vec3(0.0);

      for (int i = 0; i < 20; i++) {
        sampleUV -= deltaUV;
        // Clamp to screen bounds to prevent edge artifacts
        vec2 clampedUV = clamp(sampleUV, 0.0, 1.0);
        vec3 sampleColor = texture2D(tDiffuse, clampedUV).rgb;
        // Use luminance to pick up only bright regions (bloom output)
        float lum = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
        rays += sampleColor * lum * illumination * uWeight;
        illumination *= uDecay;
      }

      // Additive blend with warm golden tint
      vec3 rayColor = rays * uIntensity * vec3(1.0, 0.9, 0.7);
      gl_FragColor = vec4(baseColor.rgb + rayColor, baseColor.a);
    }
  `,
};

// ── Color Grading Shader ────────────────────────────────────────────────────

const ColorGradeShader = {
  uniforms: {
    tDiffuse:       { value: null },
    uLift:          { value: new THREE.Vector3(0.0, 0.0, 0.0) },   // shadows shift
    uGamma:         { value: new THREE.Vector3(1.0, 1.0, 1.0) },   // midtone power
    uGain:          { value: new THREE.Vector3(1.0, 1.0, 1.0) },   // highlight mult
    uSaturation:    { value: 1.0 },
    uContrast:      { value: 1.0 },
    uHorizonGlow:   { value: 0.0 },                                 // 0-1 glow intensity
    uHorizonColor:  { value: new THREE.Vector3(1.0, 0.8, 0.5) },   // glow tint
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uHorizonGlow;
    uniform vec3 uHorizonColor;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      // Lift / Gamma / Gain
      c = c * uGain + uLift * (1.0 - c);

      // Gamma: power curve on midtones
      c = pow(max(c, vec3(0.0)), 1.0 / uGamma);

      // Saturation
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(lum), c, uSaturation);

      // Contrast around midpoint 0.5
      c = (c - 0.5) * uContrast + 0.5;

      // Horizon glow: warm additive glow in bottom 20% of screen during golden hour
      if (uHorizonGlow > 0.001) {
        float horizonBand = smoothstep(0.35, 0.15, vUv.y); // strongest at bottom
        c += uHorizonColor * horizonBand * uHorizonGlow * 0.15;
      }

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

// ── Vignette Shader ─────────────────────────────────────────────────────────

const VignetteShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uIntensity:  { value: 0.15 },
    uSmoothness: { value: 0.45 },
    uColor:      { value: new THREE.Vector3(0.0, 0.0, 0.0) },  // black default
    uFlash:      { value: 0.0 },  // screen flash overlay (crash impact, lightning)
    uFlashColor: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uSmoothness;
    uniform vec3 uColor;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);

      // Radial distance from center (0 at center, ~1 at corners)
      vec2 centered = vUv - 0.5;
      float dist = length(centered) * 2.0;

      // Smooth falloff: inner radius → outer radius
      float innerRadius = 1.0 - uSmoothness;
      float vignette = smoothstep(innerRadius, 1.0 + uSmoothness * 0.5, dist);

      // Apply vignette as mix toward tint color
      vec3 result = mix(tex.rgb, uColor, vignette * uIntensity);

      // Screen flash overlay (additive)
      if (uFlash > 0.001) {
        result = mix(result, uFlashColor, uFlash * 0.8);
      }

      gl_FragColor = vec4(clamp(result, 0.0, 1.0), tex.a);
    }
  `,
};

// ── Exported setter for vignette (called by cameraEffects / main loop) ──────

/**
 * Update vignette uniforms from external systems (G-force effects, etc.)
 * @param {number} intensity  - 0..1 vignette strength (added to base 0.15)
 * @param {boolean} isRedout  - true for red tint (negative G), false for black
 */
/**
 * Set screen flash overlay (crash impact, lightning)
 * @param {number} intensity - 0..1 flash strength
 */
export function setFlashOverlay(intensity) {
  if (!vignettePass) return;
  vignettePass.uniforms.uFlash.value = Math.max(0, Math.min(1, intensity));
}

/**
 * Apply G-force desaturation and brightness dim on top of color grading
 * @param {number} desaturation - 0..1 (0=normal, 1=fully gray)
 * @param {number} dim - 0..0.3 brightness reduction
 */
export function setGForceColorOverrides(desaturation, dim) {
  if (!colorGradePass) return;
  // Reduce saturation for gray-out
  if (desaturation > 0.01) {
    const baseSat = colorGradePass.uniforms.uSaturation.value;
    colorGradePass.uniforms.uSaturation.value = baseSat * (1.0 - desaturation);
  }
  // Dim brightness via gain reduction
  if (dim > 0.01) {
    const scale = 1.0 - dim;
    const g = colorGradePass.uniforms.uGain.value;
    g.set(g.x * scale, g.y * scale, g.z * scale);
  }
}

export function setVignetteUniforms(intensity, isRedout) {
  if (!vignettePass) return;
  // Base vignette is always black. Only tint red when G-force intensity > 0
  const total = 0.12 + intensity * 0.3;
  vignettePass.uniforms.uIntensity.value = Math.min(total, 0.55);
  if (isRedout && intensity > 0.01) {
    vignettePass.uniforms.uColor.value.set(0.5, 0.0, 0.0);
  } else {
    vignettePass.uniforms.uColor.value.set(0.0, 0.0, 0.0);
  }
}

// ── Initialization ──────────────────────────────────────────────────────────

export function initPostProcessing(renderer, scene, camera) {
  _renderer = renderer;
  _scene = scene;
  _camera = camera;

  const size = renderer.getSize(new THREE.Vector2());
  postFxQuality = isSettingExplicit('postFxQuality') ? getSetting('postFxQuality') : getSetting('graphicsQuality');

  // Low quality: skip composer entirely, render direct
  if (postFxQuality === 'low') {
    useComposer = false;
    composer = null;
    bloomPass = null;
    godRaysPass = null;
    colorGradePass = null;
    vignettePass = null;
    return null;
  }

  // Mobile quality: minimal composer — RenderPass + OutputPass only (tone mapping, no bloom/SMAA)
  if (postFxQuality === 'mobile') {
    useComposer = true;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new OutputPass());
    bloomPass = null;
    godRaysPass = null;
    colorGradePass = null;
    vignettePass = null;
    return composer;
  }

  useComposer = true;
  composer = new EffectComposer(renderer);

  // 1. Base render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. Bloom — medium and high
  if (postFxQuality === 'medium' || postFxQuality === 'high') {
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(size.x / 2), Math.floor(size.y / 2)),
      0.15,
      0.4,
      10.0
    );
    composer.addPass(bloomPass);
  }

  // 3. Heat haze distortion — medium and high
  if (postFxQuality === 'medium' || postFxQuality === 'high') {
    const hazePass = createHeatHazePass(camera);
    composer.addPass(hazePass);
  }

  // 4. God Rays — high quality only (expensive)
  if (postFxQuality === 'high') {
    godRaysPass = new ShaderPass(GodRaysShader);
    composer.addPass(godRaysPass);
  }

  // 5. Color Grading — high only
  if (postFxQuality === 'high') {
    colorGradePass = new ShaderPass(ColorGradeShader);
    composer.addPass(colorGradePass);
  }

  // 6. Vignette — high only
  if (postFxQuality === 'high') {
    vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.uIntensity.value = 0.15;
    composer.addPass(vignettePass);
  }

  // 7. SMAA anti-aliasing — only on high quality
  if (postFxQuality === 'high') {
    const smaaPass = new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
    composer.addPass(smaaPass);
  }

  // 8. Output (tone mapping)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return composer;
}

// ── Per-frame update ────────────────────────────────────────────────────────

// Pre-allocated vectors for sun projection
const _sunWorld = new THREE.Vector3();
const _sunNDC = new THREE.Vector3();

export function updatePostProcessing() {
  const t = getTimeOfDay();
  const sunElev = getSunElevation(t);

  // ── Bloom ─────────────────────────────────────────────────────────────
  if (bloomPass) {
    if (sunElev < 0) {
      // Night — bloom only for actual light sources (emissives), not aircraft surfaces
      bloomPass.strength = 0.2;
      bloomPass.threshold = 0.9;
      bloomPass.radius = 0.35;
    } else if (sunElev < 15) {
      // Golden hour
      const f = sunElev / 15;
      bloomPass.strength = 0.2 * (1 - f) + 0.1 * f;
      bloomPass.threshold = 0.9 + (0.94 - 0.9) * f;
      bloomPass.radius = 0.35 * (1 - f) + 0.25 * f;
    } else {
      // Day — very subtle
      bloomPass.strength = 0.1;
      bloomPass.threshold = 0.94;
      bloomPass.radius = 0.25;
    }
  }

  // ── God Rays ──────────────────────────────────────────────────────────
  if (godRaysPass && _camera) {
    // Only active when sun is near horizon (0-15 degrees elevation)
    if (sunElev > 0 && sunElev < 15) {
      // Project sun position to screen space
      const sunDir = getSunDirection();
      _sunWorld.copy(sunDir).multiplyScalar(5000).add(_camera.position);
      _sunNDC.copy(_sunWorld).project(_camera);

      // Convert NDC (-1..1) to UV (0..1)
      const sx = (_sunNDC.x + 1) * 0.5;
      const sy = (_sunNDC.y + 1) * 0.5;

      godRaysPass.uniforms.uSunScreenPos.value.set(sx, sy);

      // Intensity peaks at ~3 degrees and fades at 0 and 15
      // Bell curve: strongest at low elevation, fading at edges
      const normalized = sunElev / 15; // 0..1
      const bellIntensity = Math.sin(normalized * Math.PI);
      // Scale down if sun is behind camera (z > 1 means behind)
      const behindFade = _sunNDC.z < 1 ? 1.0 : 0.0;
      godRaysPass.uniforms.uIntensity.value = bellIntensity * 0.12 * behindFade;
    } else {
      godRaysPass.uniforms.uIntensity.value = 0;
    }
  }

  // ── Color Grading ─────────────────────────────────────────────────────
  if (colorGradePass) {
    if (sunElev < -2) {
      // Night: cool blue tint, slight desaturation
      colorGradePass.uniforms.uLift.value.set(0.0, 0.0, 0.06);       // blue shadows
      colorGradePass.uniforms.uGamma.value.set(0.95, 0.95, 1.08);    // blue midtones
      colorGradePass.uniforms.uGain.value.set(0.92, 0.94, 1.0);      // cool highlights
      colorGradePass.uniforms.uSaturation.value = 0.8;
      colorGradePass.uniforms.uContrast.value = 0.95;
    } else if (sunElev < 15) {
      // Dawn/dusk: warm orange tint, golden midtones
      // Blend from night to golden hour to day
      const f = Math.max(0, (sunElev + 2) / 17); // -2..15 mapped to 0..1
      // Golden hour color grading (strongest at ~5 degrees)
      const goldenStrength = Math.sin(f * Math.PI) * 0.35;

      colorGradePass.uniforms.uLift.value.set(
        0.04 * goldenStrength,    // warm shadows
        0.01 * goldenStrength,
        -0.02 * goldenStrength    // reduce blue in shadows
      );
      colorGradePass.uniforms.uGamma.value.set(
        1.0 + 0.06 * goldenStrength,   // warm midtones
        1.0 + 0.02 * goldenStrength,
        1.0 - 0.04 * goldenStrength
      );
      colorGradePass.uniforms.uGain.value.set(
        1.0 + 0.05 * goldenStrength,   // warm highlights
        1.0,
        1.0 - 0.03 * goldenStrength
      );
      colorGradePass.uniforms.uSaturation.value = 1.0 + 0.12 * goldenStrength;
      colorGradePass.uniforms.uContrast.value = 1.0 + 0.05 * goldenStrength;
    } else {
      // Day: neutral with slight contrast boost
      colorGradePass.uniforms.uLift.value.set(0.0, 0.0, 0.0);
      colorGradePass.uniforms.uGamma.value.set(1.0, 1.0, 1.0);
      colorGradePass.uniforms.uGain.value.set(1.0, 1.0, 1.0);
      colorGradePass.uniforms.uSaturation.value = 1.0;
      colorGradePass.uniforms.uContrast.value = 1.05;
    }

    // Horizon glow: peaks at sun elevation ~3°, fades at 0° and 10°
    if (sunElev > 0 && sunElev < 10) {
      const glowNorm = sunElev / 10; // 0..1
      const glowIntensity = Math.sin(glowNorm * Math.PI); // bell curve, peaks at 5°
      colorGradePass.uniforms.uHorizonGlow.value = glowIntensity;
      const hc = getHorizonColor();
      colorGradePass.uniforms.uHorizonColor.value.set(hc.r, hc.g, hc.b);
    } else {
      colorGradePass.uniforms.uHorizonGlow.value = 0;
    }
  }

  // ── Vignette base (G-force overlay handled via setVignetteUniforms) ───
  // If nobody calls setVignetteUniforms this frame, ensure base intensity
  if (vignettePass) {
    // Base intensity is set to 0.15 at init and preserved unless
    // setVignetteUniforms overrides it. We don't reset here so that
    // cameraEffects can drive it each frame.
  }
}

// ── Render / Resize ─────────────────────────────────────────────────────────

export function renderFrame() {
  if (useComposer && composer) {
    composer.render();
  } else if (_renderer && _scene && _camera) {
    _renderer.render(_scene, _camera);
  }
}

export function onResize(w, h) {
  if (composer) {
    composer.setSize(w, h);
  }
}

import * as THREE from 'three';
import { setCloudQuality } from './terrain.js';
import { renderer, configureShadowQuality } from './scene.js';

export const GRAPHICS_QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    pixelRatioCap: 1.0,
    shadowMapEnabled: false,
    shadowType: THREE.PCFShadowMap,
    shadowQuality: 'low',
    cloudQuality: 'low',
    postFxQuality: 'low',
    vegetationDensity: 'low',
    assetQuality: 'low',
  }),
  medium: Object.freeze({
    pixelRatioCap: 1.5,
    shadowMapEnabled: true,
    shadowType: THREE.PCFSoftShadowMap,
    shadowQuality: 'medium',
    cloudQuality: 'medium',
    postFxQuality: 'medium',
    vegetationDensity: 'medium',
    assetQuality: 'medium',
  }),
  high: Object.freeze({
    pixelRatioCap: 2.0,
    shadowMapEnabled: true,
    shadowType: THREE.PCFSoftShadowMap,
    shadowQuality: 'high',
    cloudQuality: 'high',
    postFxQuality: 'high',
    vegetationDensity: 'high',
    assetQuality: 'high',
  }),
});

/**
 * Run a quick GPU benchmark: render 120 frames and measure average FPS.
 * Returns 'high', 'medium', or 'low'.
 */
export function runBenchmark(renderer, scene, camera) {
  const FRAMES = 120;
  const start = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    renderer.render(scene, camera);
  }
  renderer.getContext().finish(); // force GPU sync
  const elapsed = performance.now() - start;
  const avgFps = (FRAMES / elapsed) * 1000;

  if (avgFps >= 55) return 'high';
  if (avgFps >= 30) return 'medium';
  return 'low';
}

export function applyGraphicsQuality(level) {
  const quality = GRAPHICS_QUALITY_PRESETS[level] ? level : 'high';
  const preset = GRAPHICS_QUALITY_PRESETS[quality];

  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
    renderer.shadowMap.enabled = preset.shadowMapEnabled;
    renderer.shadowMap.type = preset.shadowType;
  }

  // Apply shadow quality through scene.js
  configureShadowQuality(preset.shadowQuality);

  setCloudQuality(preset.cloudQuality);
  document.documentElement.dataset.graphicsQuality = quality;
  document.documentElement.dataset.shadowQuality = preset.shadowQuality;
  document.documentElement.dataset.vegetationDensity = preset.vegetationDensity;
  document.documentElement.dataset.assetQuality = preset.assetQuality;
  return preset;
}

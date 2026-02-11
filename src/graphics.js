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

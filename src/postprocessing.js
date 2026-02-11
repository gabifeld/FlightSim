import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { isNight } from './scene.js';
import { getSetting, isSettingExplicit } from './settings.js';

let composer;
let bloomPass;
let postFxQuality = 'high';

export function initPostProcessing(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  postFxQuality = isSettingExplicit('postFxQuality') ? getSetting('postFxQuality') : getSetting('graphicsQuality');
  composer = new EffectComposer(renderer);

  // 1. Base render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. Bloom — only on high quality; use half-res for performance
  if (postFxQuality === 'high') {
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(size.x / 2), Math.floor(size.y / 2)),
      0.15,
      0.4,
      10.0
    );
    composer.addPass(bloomPass);
  }

  // 3. SMAA anti-aliasing — only on high quality
  if (postFxQuality === 'high') {
    const smaaPass = new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
    composer.addPass(smaaPass);
  }

  // 4. Output (tone mapping)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return composer;
}

export function updatePostProcessing() {
  if (bloomPass) {
    const night = isNight();
    bloomPass.strength = night ? 0.6 : 0.0;
    bloomPass.threshold = night ? 0.75 : 10.0;
  }
}

export function renderFrame() {
  if (!composer) return;
  composer.render();
}

export function onResize(w, h) {
  if (composer) {
    composer.setSize(w, h);
  }
}

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
let useComposer = true;
let _renderer = null;
let _scene = null;
let _camera = null;

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
    return null;
  }

  // Mobile quality: minimal composer — RenderPass + OutputPass only (tone mapping, no bloom/SMAA)
  if (postFxQuality === 'mobile') {
    useComposer = true;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new OutputPass());
    bloomPass = null;
    return composer;
  }

  useComposer = true;
  composer = new EffectComposer(renderer);

  // 1. Base render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. Bloom — medium uses half-res, high uses half-res too
  if (postFxQuality === 'medium' || postFxQuality === 'high') {
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

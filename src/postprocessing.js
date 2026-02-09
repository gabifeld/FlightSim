import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { isNight } from './scene.js';

let composer;
let bloomPass;

// Film grain shader
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    intensity: { value: 0.035 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float grain = rand(vUv + time) * intensity;
      color.rgb += grain - intensity * 0.5;
      gl_FragColor = color;
    }
  `,
};

// Vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.1 },
    darkness: { value: 0.5 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      float vignette = 1.0 - dot(uv, uv);
      color.rgb *= mix(1.0, vignette, darkness);
      gl_FragColor = color;
    }
  `,
};

let filmPass;

export function initPostProcessing(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  composer = new EffectComposer(renderer);

  // 1. Base render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. Bloom (night mode only — high threshold prevents sky washout)
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.15, // strength (subtle)
    0.4,  // radius
    10.0  // threshold (very high — only emissive lights bloom, never the sky)
  );
  composer.addPass(bloomPass);

  // 4. SMAA anti-aliasing
  const smaaPass = new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
  composer.addPass(smaaPass);

  // 5. Output (tone mapping)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return composer;
}

export function updatePostProcessing() {
  // Dynamic bloom for night mode
  if (bloomPass) {
    const night = isNight();
    bloomPass.strength = night ? 0.6 : 0.0;
    bloomPass.threshold = night ? 0.8 : 10.0;
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

// Screen-space speed lines using a fullscreen quad with custom shader
// Lines radiate from center, opacity scales with airspeed
// Only visible above 150 knots in chase/orbit camera
import * as THREE from 'three';
import { MS_TO_KNOTS } from './constants.js';

let mesh = null;
let material = null;

export function initSpeedLines(camera) {
  material = new THREE.ShaderMaterial({
    uniforms: {
      opacity: { value: 0.0 },
      time: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      uniform float time;
      varying vec2 vUv;

      void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        float angle = atan(center.y, center.x);

        // Radial lines
        float lines = pow(abs(sin(angle * 40.0 + time * 2.0)), 16.0);

        // Mask to edges only (distance from center > 0.6)
        float edgeMask = smoothstep(0.35, 0.55, dist);

        // Fade at very edge to avoid hard cutoff
        float outerFade = 1.0 - smoothstep(0.48, 0.52, dist);

        float alpha = lines * edgeMask * outerFade * opacity;
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;

  // Add as camera child so it's always in front
  camera.add(mesh);
  mesh.position.set(0, 0, -1);
}

export function updateSpeedLines(speed, cameraMode, dt) {
  if (!material) return;

  material.uniforms.time.value += dt;

  const knots = speed * MS_TO_KNOTS;
  const isChaseOrOrbit = cameraMode === 'chase' || cameraMode === 'orbit';

  if (isChaseOrOrbit && knots > 150) {
    const targetOpacity = Math.min((knots - 150) / 100, 0.35);
    material.uniforms.opacity.value += (targetOpacity - material.uniforms.opacity.value) * Math.min(dt * 3, 1);
  } else {
    material.uniforms.opacity.value *= Math.max(1 - dt * 5, 0);
  }

  if (mesh) {
    mesh.visible = material.uniforms.opacity.value > 0.001;
  }
}

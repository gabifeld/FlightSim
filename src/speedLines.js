// Screen-space high-speed airflow streaks.
// Kept subtle and peripheral to avoid the anime-like radial burst look.
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

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float dist = length(p);
        float angle = atan(p.y, p.x);

        // Peripheral mask keeps the center clear.
        float peripheral = smoothstep(0.45, 0.9, dist) * (1.0 - smoothstep(0.98, 1.08, dist));

        // Long, sparse streaks with soft breakup.
        float spokes = pow(abs(sin(angle * 22.0 + time * 1.4)), 14.0);
        float breakup = 0.72 + hash(vUv * 420.0 + vec2(time * 3.0, time * 5.0)) * 0.28;

        float alpha = spokes * breakup * peripheral * opacity;
        vec3 tint = vec3(0.90, 0.94, 1.0);
        gl_FragColor = vec4(tint, alpha);
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

  if (isChaseOrOrbit && knots > 220) {
    const targetOpacity = Math.min((knots - 220) / 220, 0.12);
    material.uniforms.opacity.value += (targetOpacity - material.uniforms.opacity.value) * Math.min(dt * 2.2, 1);
  } else {
    material.uniforms.opacity.value *= Math.max(1 - dt * 4, 0);
  }

  if (mesh) {
    mesh.visible = material.uniforms.opacity.value > 0.001;
  }
}

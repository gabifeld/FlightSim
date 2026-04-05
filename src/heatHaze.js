// Heat haze distortion effect — screen-space refraction behind hot engines
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';

let hazePass = null;
let _camera = null;

const HeatHazeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uHazeCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uHazeIntensity: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
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
    uniform float uTime;
    uniform vec2 uHazeCenter;
    uniform float uHazeIntensity;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      vec2 uv = vUv;

      if (uHazeIntensity > 0.01) {
        // Distance from haze source (engine exhaust projected to screen)
        vec2 delta = uv - uHazeCenter;
        float dist = length(delta);

        // Haze region: elliptical, taller than wide (rises upward from exhaust)
        float hazeRadius = 0.08;
        float falloff = smoothstep(hazeRadius, 0.0, dist);

        // Animated distortion using layered noise
        float t = uTime;
        vec2 noiseCoord = uv * 8.0 + vec2(t * 0.5, t * -2.0); // rises upward
        float n1 = noise(noiseCoord);
        float n2 = noise(noiseCoord * 2.3 + 17.0);

        vec2 distortion = vec2(
          (n1 - 0.5) * 2.0,
          (n2 - 0.5) * 2.0 - 0.3  // bias upward
        );

        // Apply distortion scaled by intensity and falloff
        float strength = uHazeIntensity * falloff * 0.002;
        uv += distortion * strength;
      }

      gl_FragColor = texture2D(tDiffuse, uv);
    }
  `,
};

// Pre-allocated vector for projection
const _screenPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function createHeatHazePass(camera) {
  _camera = camera;
  hazePass = new ShaderPass(HeatHazeShader);
  hazePass.enabled = true;
  return hazePass;
}

export function updateHeatHaze(dt) {
  if (!hazePass || !_camera) return;

  const v = getActiveVehicle();
  if (!isAircraft(v) || v.throttle < 0.5) {
    hazePass.uniforms.uHazeIntensity.value *= 0.9; // fade out smoothly
    if (hazePass.uniforms.uHazeIntensity.value < 0.01) {
      hazePass.uniforms.uHazeIntensity.value = 0;
    }
    return;
  }

  const intensity = (v.throttle - 0.5) * 2.0;

  // Project engine exhaust position to screen space
  _fwd.set(0, 0, 1).applyQuaternion(v.quaternion);
  _screenPos.copy(v.position).addScaledVector(_fwd, 8); // behind the aircraft
  _screenPos.project(_camera);

  // Convert from NDC (-1..1) to UV (0..1)
  const sx = (_screenPos.x + 1) * 0.5;
  const sy = (_screenPos.y + 1) * 0.5;

  // Only apply if exhaust is roughly on screen
  if (sx > -0.2 && sx < 1.2 && sy > -0.2 && sy < 1.2 && _screenPos.z < 1) {
    hazePass.uniforms.uHazeCenter.value.set(sx, sy);
    // Smooth intensity transition
    const target = intensity;
    const current = hazePass.uniforms.uHazeIntensity.value;
    hazePass.uniforms.uHazeIntensity.value = current + (target - current) * 0.1;
  } else {
    hazePass.uniforms.uHazeIntensity.value *= 0.95;
  }

  hazePass.uniforms.uTime.value = performance.now() * 0.001;
}

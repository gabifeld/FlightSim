// ============================================================
//  src/waterShader.js — Stylized Wind-Waker-style ocean shader
//  Gerstner waves, cel-shaded specular, animated foam
// ============================================================

import * as THREE from 'three';

const WATER_SURFACE_Y = -2;

let waterMesh = null;
let waterMaterial = null;

// ── Vertex Shader ──────────────────────────────────────────

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uWaveAmplitude;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFoamMask;

// Gerstner wave helper — returns displacement (xyz) for a single component.
// Q = steepness (0-1), A = amplitude, D = direction (normalised xz),
// w = angular frequency, phi = phase speed.
vec3 gerstnerWave(vec2 D, float A, float Q, float w, float phi, vec2 xz, float t) {
  float phase = dot(D, xz) * w + t * phi;
  float s = sin(phase);
  float c = cos(phase);
  return vec3(
    Q * A * D.x * c,
    A * s,
    Q * A * D.y * c
  );
}

void main() {
  vec3 pos = position;
  vec2 xz = pos.xz;

  // Three Gerstner wave components — varying direction, frequency, amplitude.
  // Amplitudes are scaled by the uWaveAmplitude uniform (0.3 calm → 2.0 storm).
  float amp = uWaveAmplitude;

  // Wave 1 — broad swell
  vec2 d1 = normalize(vec2(0.6, 0.8));
  float a1 = 0.65 * amp;
  float w1 = 0.08;
  float p1 = 1.2;
  float q1 = 0.45;

  // Wave 2 — medium chop
  vec2 d2 = normalize(vec2(-0.4, 0.7));
  float a2 = 0.35 * amp;
  float w2 = 0.15;
  float p2 = 1.8;
  float q2 = 0.35;

  // Wave 3 — small detail ripple
  vec2 d3 = normalize(vec2(0.9, -0.3));
  float a3 = 0.18 * amp;
  float w3 = 0.28;
  float p3 = 2.5;
  float q3 = 0.25;

  vec3 g1 = gerstnerWave(d1, a1, q1, w1, p1, xz, uTime);
  vec3 g2 = gerstnerWave(d2, a2, q2, w2, p2, xz, uTime);
  vec3 g3 = gerstnerWave(d3, a3, q3, w3, p3, xz, uTime);

  vec3 displacement = g1 + g2 + g3;
  pos += displacement;

  // Compute analytical normal from Gerstner wave partial derivatives.
  // For each wave: dP/dx and dP/dz contribute to tangent/bitangent.
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 bitangent = vec3(0.0, 0.0, 1.0);

  // Accumulate tangent frame perturbation per wave.
  // dP/dx_tangent  = -D.x * D.x * Q * A * w * sin,  dy/dx = D.x * A * w * cos
  // dP/dz_bitangent = -D.y * D.y * Q * A * w * sin,  dy/dz = D.y * A * w * cos
  float phase1 = dot(d1, xz) * w1 + uTime * p1;
  float phase2 = dot(d2, xz) * w2 + uTime * p2;
  float phase3 = dot(d3, xz) * w3 + uTime * p3;

  float s1 = sin(phase1), c1 = cos(phase1);
  float s2 = sin(phase2), c2 = cos(phase2);
  float s3 = sin(phase3), c3 = cos(phase3);

  // Tangent (along x)
  tangent.x -= (d1.x * d1.x * q1 * a1 * w1 * s1 +
                d2.x * d2.x * q2 * a2 * w2 * s2 +
                d3.x * d3.x * q3 * a3 * w3 * s3);
  tangent.y += (d1.x * a1 * w1 * c1 +
                d2.x * a2 * w2 * c2 +
                d3.x * a3 * w3 * c3);
  tangent.z -= (d1.x * d1.y * q1 * a1 * w1 * s1 +
                d2.x * d2.y * q2 * a2 * w2 * s2 +
                d3.x * d3.y * q3 * a3 * w3 * s3);

  // Bitangent (along z)
  bitangent.x -= (d1.x * d1.y * q1 * a1 * w1 * s1 +
                  d2.x * d2.y * q2 * a2 * w2 * s2 +
                  d3.x * d3.y * q3 * a3 * w3 * s3);
  bitangent.y += (d1.y * a1 * w1 * c1 +
                  d2.y * a2 * w2 * c2 +
                  d3.y * a3 * w3 * c3);
  bitangent.z -= (d1.y * d1.y * q1 * a1 * w1 * s1 +
                  d2.y * d2.y * q2 * a2 * w2 * s2 +
                  d3.y * d3.y * q3 * a3 * w3 * s3);

  vec3 normal = normalize(cross(bitangent, tangent));

  // Foam mask — steeper wave gradients produce foam.
  // Use combined y component of displacement as proxy for gradient magnitude.
  float waveGrad = abs(tangent.y) + abs(bitangent.y);
  vFoamMask = smoothstep(0.25, 0.6, waveGrad);

  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// ── Fragment Shader ────────────────────────────────────────

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform vec3 uSkyColor;
uniform vec3 uCameraPosition;
uniform float uWaveAmplitude;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFoamMask;

// Simple hash-based noise for shore foam scrolling.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Layered noise for foam pattern.
float foamNoise(vec2 uv, float t) {
  float n = 0.0;
  n += noise2D(uv * 3.0 + vec2(t * 0.4, t * 0.3)) * 0.5;
  n += noise2D(uv * 7.0 - vec2(t * 0.2, t * 0.5)) * 0.3;
  n += noise2D(uv * 15.0 + vec2(t * 0.6, -t * 0.4)) * 0.2;
  return n;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCameraPosition - vWorldPos);
  vec3 L = normalize(uSunDirection);

  // ── Base colour — deep teal-blue, tinted by sky ──
  vec3 baseColor = vec3(0.1, 0.42, 0.48);
  vec3 depthColor = vec3(0.04, 0.15, 0.28);
  baseColor = mix(baseColor, uSkyColor * 0.4, 0.15);

  // ── Fresnel — shallow angles pick up sky, steep show depth ──
  float fresnel = pow(1.0 - max(dot(V, N), 0.0), 3.0);
  vec3 waterColor = mix(depthColor, baseColor, 1.0 - fresnel);
  waterColor = mix(waterColor, uSkyColor * 0.55, fresnel * 0.6);

  // ── Cel-shaded diffuse band ──
  float NdotL = dot(N, L);
  float diffuseBand = smoothstep(-0.02, 0.02, NdotL);
  waterColor *= 0.7 + 0.3 * diffuseBand;

  // ── Cel-shaded specular — hard-edge sun reflection (Wind Waker style) ──
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float specPower = pow(NdotH, 120.0);
  // Hard step for cartoon specular highlight
  float specMask = step(0.92, specPower);
  // Secondary softer ring around the highlight
  float specRing = smoothstep(0.5, 0.92, specPower) * 0.15;
  vec3 specColor = vec3(1.0, 0.97, 0.9) * (specMask + specRing);
  // Only show specular when sun is above horizon
  specColor *= smoothstep(-0.05, 0.1, L.y);

  waterColor += specColor;

  // ── Wave-peak foam (from vertex gradient) ──
  float peakFoam = vFoamMask * smoothstep(0.3, 0.7, vFoamMask);
  // Add subtle noise breakup to foam lines
  vec2 foamUV = vWorldPos.xz * 0.005;
  float foamBreakup = foamNoise(foamUV, uTime * 0.3);
  peakFoam *= smoothstep(0.25, 0.55, foamBreakup);
  waterColor = mix(waterColor, vec3(0.9, 0.95, 1.0), peakFoam * 0.7);

  // ── Shore foam — where displaced surface approaches y=0 (shore proximity) ──
  // The water plane sits at WATER_SURFACE_Y = -2. Displaced vertices near
  // the shore will have world Y close to the surface. We treat world Y
  // proximity to WATER_SURFACE_Y as a shore cue (wave height ~ 0 means
  // vertex is near the mesh edge / shallow water).
  float shoreProximity = 1.0 - smoothstep(-2.5, -0.5, vWorldPos.y);
  // Animated scrolling foam noise
  vec2 shoreUV = vWorldPos.xz * 0.012;
  float scrollT = uTime * 0.5;
  float shoreFoam = foamNoise(shoreUV + vec2(scrollT * 0.3, scrollT * 0.2), scrollT);
  shoreFoam = smoothstep(0.35, 0.65, shoreFoam);
  // Combine with proximity mask
  float shoreMask = shoreProximity * shoreFoam;
  waterColor = mix(waterColor, vec3(0.92, 0.96, 1.0), shoreMask * 0.6);

  // ── Colour banding — discrete tonal bands for cartoon look ──
  float luminance = dot(waterColor, vec3(0.299, 0.587, 0.114));
  float bandedLum = floor(luminance * 5.0 + 0.5) / 5.0;
  float bandInfluence = 0.12;
  waterColor = mix(waterColor, waterColor * (bandedLum / max(luminance, 0.001)), bandInfluence);

  // ── Distance fog (match scene fog) ──
  float dist = length(vWorldPos - uCameraPosition);
  float fogFactor = 1.0 - exp(-0.00004 * dist * dist);
  vec3 fogColor = uSkyColor * 0.8;
  waterColor = mix(waterColor, fogColor, fogFactor);

  gl_FragColor = vec4(waterColor, 0.92);
}
`;

// ── Public API ─────────────────────────────────────────────

/**
 * Create the stylised water mesh and add it to the scene.
 */
export function initWaterShader(scene) {
  if (waterMesh) return waterMesh;

  const geometry = new THREE.PlaneGeometry(60000, 60000, 128, 128);
  geometry.rotateX(-Math.PI / 2);

  waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime:           { value: 0 },
      uWaveAmplitude:  { value: 0.3 },
      uSunDirection:   { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      uSkyColor:       { value: new THREE.Color(0.5, 0.7, 0.9) },
      uCameraPosition: { value: new THREE.Vector3() },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  waterMesh = new THREE.Mesh(geometry, waterMaterial);
  waterMesh.position.y = WATER_SURFACE_Y;
  waterMesh.frustumCulled = false;

  scene.add(waterMesh);
  return waterMesh;
}

/**
 * Per-frame uniform update. Call from your main loop.
 *
 * @param {number} dt           — delta time in seconds
 * @param {THREE.Vector3} sunDir — normalised sun direction (from getSunDirection)
 * @param {THREE.Color|THREE.Vector3} skyColor — current sky colour
 * @param {THREE.Vector3} cameraPos — camera world position
 * @param {number} waveAmplitude — 0.3 (calm) to 2.0 (storm)
 */
export function updateWaterShader(dt, sunDir, skyColor, cameraPos, waveAmplitude) {
  if (!waterMaterial) return;

  const u = waterMaterial.uniforms;
  u.uTime.value += dt;

  if (sunDir) {
    u.uSunDirection.value.set(sunDir.x, sunDir.y, sunDir.z);
  }

  if (skyColor) {
    if (skyColor.isColor) {
      u.uSkyColor.value.set(skyColor.r, skyColor.g, skyColor.b);
    } else {
      u.uSkyColor.value.set(skyColor.x, skyColor.y, skyColor.z);
    }
  }

  if (cameraPos) {
    u.uCameraPosition.value.copy(cameraPos);
  }

  if (waveAmplitude !== undefined) {
    u.uWaveAmplitude.value = waveAmplitude;
  }
}

/**
 * Dispose of GPU resources.
 */
export function disposeWaterShader() {
  if (waterMesh) {
    if (waterMesh.parent) waterMesh.parent.remove(waterMesh);
    waterMesh.geometry.dispose();
    waterMesh = null;
  }
  if (waterMaterial) {
    waterMaterial.dispose();
    waterMaterial = null;
  }
}

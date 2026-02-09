export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function degToRad(degrees) {
  return degrees * (Math.PI / 180);
}

export function radToDeg(radians) {
  return radians * (180 / Math.PI);
}

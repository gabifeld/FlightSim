import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import {
  TERRAIN_SIZE,
  TERRAIN_SEGMENTS,
  TERRAIN_MAX_HEIGHT,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_FLATTEN_RADIUS,
  AIRPORT2_X,
  AIRPORT2_Z,
  CITY_CENTER_X,
  CITY_CENTER_Z,
  CITY_SIZE,
  COAST_LINE_X,
  OCEAN_DEPTH,
  COAST_MARGIN,
  CT_CENTER_X,
  CT_CENTER_Z,
  CT_SIZE_X,
  CT_SIZE_Z,
  TABLE_MTN_X,
  TABLE_MTN_Z,
  SIGNAL_HILL_X,
  SIGNAL_HILL_Z,
  INTL_AIRPORT_X,
  INTL_AIRPORT_Z,
  INTL_RUNWAY_LENGTH,
  INTL_RUNWAY_WIDTH,
} from './constants.js';
import { clamp, smoothstep, getSunElevation } from './utils.js';
import { getAirportFlattenZones } from './airportData.js';
import { getSunDirection, getTimeOfDay, scene as sceneRef } from './scene.js';
import { getSetting, isSettingExplicit } from './settings.js';
import { queryRoadElevation as queryCityRoadElevation } from './roadGraph.js';

const simplex = new SimplexNoise();

// Module-level terrain shader reference for per-frame uniform updates
let terrainShaderRef = null;
let terrainShaderTime = 0;

// Module-level highway spline for external access
let highwayCurve = null;
let highwaySamplePoints = null;

// ── Highway routing — terrain-aware path generation ──
// Instead of fixed waypoints through mountains, the router finds valley paths
// between anchor points by sampling terrain and choosing low-elevation corridors.

// Anchor points — only define START, END, and mandatory waypoints (junctions).
// The router fills in the path between them through valleys.
const HIGHWAY_ANCHORS = [
  [600, -1800],       // Near Airport 1
  [4000, -5800],      // South of city center (mandatory pass-through)
  [5600, -6100],      // CT spur junction
  [8400, -8600],      // Near Airport 2
];

const CITY_SPUR_ANCHORS = [
  null,               // Will be filled with branch point from main highway
  [4000, -5150],      // City south edge
];

const CT_SPUR_ANCHORS = [
  null,               // Will be filled with junction point from main highway
  [12650, -3000],     // Cape Town approach
];

// Route between two points, sampling terrain to find valley path
function routeThroughValleys(startX, startZ, endX, endZ, stepSize = 150) {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const totalDist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(6, Math.ceil(totalDist / stepSize));
  const points = [[startX, startZ]];

  const perpX = -dz / totalDist;
  const perpZ = dx / totalDist;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const baseX = startX + dx * t;
    const baseZ = startZ + dz * t;

    // Previous point for continuity bias
    const prev = points[points.length - 1];

    // Search very wide (1200m each side), dense samples (21)
    const searchWidth = 1200;
    const samples = 21;
    let bestX = baseX, bestZ = baseZ;
    let bestCost = Infinity;

    for (let s = -Math.floor(samples / 2); s <= Math.floor(samples / 2); s++) {
      const offset = (s / Math.floor(samples / 2)) * searchWidth;
      const sx = baseX + perpX * offset;
      const sz = baseZ + perpZ * offset;

      // Avoid city zone
      if (sx >= 2600 && sx <= 5400 && sz >= -5400 && sz <= -2600) continue;

      const h = getLandHeightWithoutRoads(sx, sz);
      // Height is heavily penalized — mountains are very expensive
      // Deviation penalty is low so the router freely detours around mountains
      const devPenalty = Math.abs(offset) * 0.01;
      const jumpPenalty = Math.hypot(sx - prev[0], sz - prev[1]) * 0.005;
      const cost = h * 5 + devPenalty + jumpPenalty; // Height STRONGLY dominates

      if (cost < bestCost) {
        bestCost = cost;
        bestX = sx;
        bestZ = sz;
      }
    }

    points.push([bestX, bestZ]);
  }

  points.push([endX, endZ]);

  // Heavy smoothing — 6 passes to remove zigzags while keeping valley alignment
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < points.length - 1; i++) {
      points[i][0] = points[i - 1][0] * 0.25 + points[i][0] * 0.5 + points[i + 1][0] * 0.25;
      points[i][1] = points[i - 1][1] * 0.25 + points[i][1] * 0.5 + points[i + 1][1] * 0.25;
    }
  }

  return points;
}

// Build full highway centerline by routing through valleys between anchors
let HIGHWAY_CENTERLINE = null;
let HIGHWAY_SPUR_CT = null;
let HIGHWAY_SPUR_CITY = null;

function generateHighwayRoutes() {
  // Main highway: route between each pair of anchors
  const mainRoute = [];
  for (let i = 0; i < HIGHWAY_ANCHORS.length - 1; i++) {
    const [sx, sz] = HIGHWAY_ANCHORS[i];
    const [ex, ez] = HIGHWAY_ANCHORS[i + 1];
    const segment = routeThroughValleys(sx, sz, ex, ez);
    // Skip first point of subsequent segments (shared with previous end)
    const start = i === 0 ? 0 : 1;
    for (let j = start; j < segment.length; j++) {
      mainRoute.push(segment[j]);
    }
  }
  HIGHWAY_CENTERLINE = mainRoute;

  // Find closest point on main highway to branch the city spur
  const cityTarget = [4000, -5800]; // Near anchor 1 (south of city)
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < mainRoute.length; i++) {
    const d = Math.hypot(mainRoute[i][0] - cityTarget[0], mainRoute[i][1] - cityTarget[1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  const cityBranch = mainRoute[bestIdx];

  // City spur: short ramp from highway to city edge
  HIGHWAY_SPUR_CITY = [
    [cityBranch[0], cityBranch[1]],
    [cityBranch[0] * 0.7 + 4000 * 0.3, cityBranch[1] * 0.7 + (-5150) * 0.3],
    [cityBranch[0] * 0.4 + 4000 * 0.6, cityBranch[1] * 0.4 + (-5150) * 0.6],
    [4000, -5150],
  ];

  // Find closest point for CT spur junction
  const ctTarget = [5600, -6100]; // Near anchor 2
  bestIdx = 0; bestDist = Infinity;
  for (let i = 0; i < mainRoute.length; i++) {
    const d = Math.hypot(mainRoute[i][0] - ctTarget[0], mainRoute[i][1] - ctTarget[1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  const ctBranch = mainRoute[bestIdx];

  // CT spur: route through valleys to Cape Town
  const ctSegment = routeThroughValleys(ctBranch[0], ctBranch[1], 12650, -3000, 300);
  HIGHWAY_SPUR_CT = ctSegment;
}

const HIGHWAY_ROAD_HALF_WIDTH = 24; // widened to ensure terrain vertices are caught
const HIGHWAY_ROAD_MARGIN = 250;
const HIGHWAY_MAX_GRADE = 0.035;   // 3.5% — gentler grade forces road to stay lower, avoiding mountains
const HIGHWAY_VIADUCT_CLEARANCE = 3;
const HIGHWAY_RAMP_FRACTION = 0.08;
const HIGHWAY_BRIDGE_CLEARANCE = 3;
const HIGHWAY_BRIDGE_MIN_SPAN = 3;
const HIGHWAY_TUNNEL_COVER = 12;
const HIGHWAY_TUNNEL_MIN_SPAN = 4;
const HIGHWAY_PROFILE_SAMPLE_SPACING = 30;
let highwayRoadProfile = null;
let highwaySpurProfile = null;
let highwayCityProfile = null;
const WATER_SURFACE_Y = -2;

// Domain warping — displaces sample coordinates for more organic shapes
function warp(x, z, strength) {
  const wx = simplex.noise(x * 0.00015, z * 0.00015 + 7.7) * strength;
  const wz = simplex.noise(x * 0.00015 + 3.3, z * 0.00015) * strength;
  return [x + wx, z + wz];
}

// Ridged noise — abs(noise) inverted to create sharp ridges
function ridgedNoise(x, z, freq) {
  const n = simplex.noise(x * freq, z * freq);
  return 1.0 - Math.abs(n);
}

function sampleNoise(x, z) {
  // Domain warp for organic, non-repetitive shapes
  const [wx, wz] = warp(x, z, 2500);

  // Base terrain: 6 octaves of fBm for broad shapes + fine detail
  let value = 0;
  let amplitude = 1;
  let frequency = 0.00025;
  for (let i = 0; i < 6; i++) {
    value += simplex.noise(wx * frequency, wz * frequency) * amplitude;
    amplitude *= 0.48;
    frequency *= 2.1;
  }

  // Ridge overlay: sharp mountain ridges in higher areas
  const ridgeFreq = 0.0003;
  const r1 = ridgedNoise(wx, wz, ridgeFreq);
  const r2 = ridgedNoise(wx, wz, ridgeFreq * 2.3);
  const ridgeValue = r1 * r2; // multiplied ridges create sharper peaks

  // Blend ridges into base — stronger at higher elevations
  const baseHeight = (value + 1) / 2; // 0-1
  const ridgeStrength = smoothstep(0.35, 0.7, baseHeight) * 0.6;
  value += ridgeValue * ridgeStrength * 1.5;

  // Valley carving: deepen low areas for more contrast
  if (value < -0.2) {
    value *= 1.0 + (Math.abs(value + 0.2)) * 0.4;
  }

  return value;
}

function airportFlattenFactor(x, z, cx, cz) {
  const halfLen = RUNWAY_LENGTH / 2 + 200;
  const halfWid = RUNWAY_WIDTH / 2 + 350;
  const margin = RUNWAY_FLATTEN_RADIUS;

  const lx = x - cx;
  const lz = z - cz;

  const dx = Math.max(0, Math.abs(lx) - halfWid);
  const dz = Math.max(0, Math.abs(lz) - halfLen);
  const dist = Math.sqrt(dx * dx + dz * dz);

  const runwayFlat = 1 - smoothstep(0, margin, dist);

  // Extended approach corridor on -Z side (southern approach)
  const approachLen = 3500;
  const approachWidthBase = 500;
  const approachWidthEnd = 150;
  const approachMargin = 600;

  let approachFlat = 0;
  if (lz < -halfLen + margin) {
    const zPast = Math.max(0, -(lz + halfLen * 0.5));
    const t = Math.min(zPast / approachLen, 1);
    const corridorWidth = approachWidthBase * (1 - t) + approachWidthEnd * t;
    const xDist = Math.max(0, Math.abs(lx) - corridorWidth);
    approachFlat = (1 - smoothstep(0, approachMargin, xDist)) * (1 - t * t);
  }

  return Math.max(runwayFlat, approachFlat);
}

function cityFlattenFactor(x, z) {
  const halfSize = CITY_SIZE / 2 + 100; // Extend flatten zone 100m past city edge
  const margin = 800; // Very wide transition so mountains don't encroach on buildings
  const dx = Math.max(0, Math.abs(x - CITY_CENTER_X) - halfSize);
  const dz = Math.max(0, Math.abs(z - CITY_CENTER_Z) - halfSize);
  const dist = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(0, margin, dist);
}

function segmentMinDist(x, z, segments) {
  let minDist = Infinity;
  for (let i = 0; i < segments.length - 1; i++) {
    const ax = segments[i][0], az = segments[i][1];
    const bx = segments[i + 1][0], bz = segments[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lenSq));
    const px = ax + t * dx, pz = az + t * dz;
    const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function buildRoadProfile(centerline) {
  const planCurve = new THREE.CatmullRomCurve3(
    centerline.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal'
  );
  const planPoints = planCurve.getPoints(Math.max(
    centerline.length * 10,
    Math.ceil(planCurve.getLength() / HIGHWAY_PROFILE_SAMPLE_SPACING)
  ));
  const profile = planPoints.map((point) => ({
    x: point.x,
    z: point.z,
    y: getLandHeightWithoutRoads(point.x, point.z),
  }));

  // Step 1: Heavy smoothing — 20 passes of 5-tap filter
  // At 30m spacing, 20 passes smooths over ~1000m of terrain
  for (let pass = 0; pass < 20; pass++) {
    for (let i = 2; i < profile.length - 2; i++) {
      profile[i].y = (
        profile[i - 2].y * 0.1 +
        profile[i - 1].y * 0.2 +
        profile[i].y * 0.4 +
        profile[i + 1].y * 0.2 +
        profile[i + 2].y * 0.1
      );
    }
  }

  // Step 2: Grade limiting — 12 passes bidirectional for full convergence
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 1; i < profile.length; i++) {
      const dx = profile[i].x - profile[i - 1].x;
      const dz = profile[i].z - profile[i - 1].z;
      const maxDelta = Math.hypot(dx, dz) * HIGHWAY_MAX_GRADE;
      profile[i].y = clamp(profile[i].y, profile[i - 1].y - maxDelta, profile[i - 1].y + maxDelta);
    }
    for (let i = profile.length - 2; i >= 0; i--) {
      const dx = profile[i + 1].x - profile[i].x;
      const dz = profile[i + 1].z - profile[i].z;
      const maxDelta = Math.hypot(dx, dz) * HIGHWAY_MAX_GRADE;
      profile[i].y = clamp(profile[i].y, profile[i + 1].y - maxDelta, profile[i + 1].y + maxDelta);
    }
  }

  // Step 3: Keep road well above terrain — this is the key to preventing clipping
  for (let i = 0; i < profile.length; i++) {
    const surfH = getLandHeightWithoutRoads(profile[i].x, profile[i].z);
    profile[i].y = Math.max(profile[i].y, surfH + 1.5);
  }
  // Re-smooth after terrain push-up (only upward to prevent sinking)
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 2; i < profile.length - 2; i++) {
      const avg = profile[i - 2].y * 0.1 + profile[i - 1].y * 0.2 +
        profile[i].y * 0.4 + profile[i + 1].y * 0.2 + profile[i + 2].y * 0.1;
      profile[i].y = Math.max(profile[i].y, avg);
    }
  }
  // Final terrain clamp — generous clearance
  for (let i = 0; i < profile.length; i++) {
    const surfH = getLandHeightWithoutRoads(profile[i].x, profile[i].z);
    profile[i].y = Math.max(profile[i].y, surfH + 1.5);
  }

  // Step 4: Classify structure
  for (let i = 0; i < profile.length; i++) {
    const point = profile[i];
    point.surfaceY = getNaturalSurfaceHeight(point.x, point.z);
    const t = profile.length <= 1 ? 0 : i / (profile.length - 1);
    const rampBlend = smoothstep(0.02, HIGHWAY_RAMP_FRACTION, Math.min(t, 1 - t));
    const viaductClearance = HIGHWAY_VIADUCT_CLEARANCE * rampBlend;
    point.y = Math.max(point.y, point.surfaceY + viaductClearance);
    point.structure = classifyRoadPoint(point);
  }

  smoothRoadStructures(profile);
  return profile;
}

function ensureRoadProfiles() {
  if (!HIGHWAY_CENTERLINE) generateHighwayRoutes();
  if (!highwayRoadProfile) highwayRoadProfile = buildRoadProfile(HIGHWAY_CENTERLINE);
  if (!highwaySpurProfile) highwaySpurProfile = buildRoadProfile(HIGHWAY_SPUR_CT);
  if (!highwayCityProfile) highwayCityProfile = buildRoadProfile(HIGHWAY_SPUR_CITY);
}

function sampleRoadProfile(profile, x, z) {
  let minDist = Infinity;
  let elevation = 0;
  let structure = 'open';

  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-4) continue;

    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / lenSq, 0, 1);
    const px = a.x + t * dx;
    const pz = a.z + t * dz;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < minDist) {
      minDist = dist;
      elevation = THREE.MathUtils.lerp(a.y, b.y, t);
      structure = resolveRoadSegmentStructure(a, b);
    }
  }

  return { dist: minDist, elevation, structure };
}

function getRoadCorridorInfo(x, z) {
  ensureRoadProfiles();
  const main = sampleRoadProfile(highwayRoadProfile, x, z);
  const spur = sampleRoadProfile(highwaySpurProfile, x, z);
  const city = sampleRoadProfile(highwayCityProfile, x, z);
  const best = main.dist < spur.dist
    ? (main.dist < city.dist ? main : city)
    : (spur.dist < city.dist ? spur : city);
  if (!Number.isFinite(best.dist)) return { factor: 0, elevation: 0 };

  let factor = 1 - smoothstep(
    HIGHWAY_ROAD_HALF_WIDTH,
    HIGHWAY_ROAD_HALF_WIDTH + HIGHWAY_ROAD_MARGIN,
    best.dist
  );
  if (best.structure === 'tunnel') factor = 0;
  factor *= 1 - getRoadCorridorSuppression(x, z);
  if (factor < 1e-3) return { factor: 0, elevation: best.elevation };
  return { factor, elevation: best.elevation };
}

function sampleRoadSurfaceHeight(profile, x, z) {
  const sample = sampleRoadProfile(profile, x, z);
  if (Number.isFinite(sample.elevation)) return sample.elevation;
  return getTerrainHeight(x, z);
}

function rectZoneInfluence(x, z, cx, cz, halfX, halfZ, margin) {
  const dx = Math.max(0, Math.abs(x - cx) - halfX);
  const dz = Math.max(0, Math.abs(z - cz) - halfZ);
  return 1 - smoothstep(0, margin, Math.hypot(dx, dz));
}

function getRoadCorridorSuppression(x, z) {
  const airport1 = rectZoneInfluence(x, z, 0, 0, RUNWAY_WIDTH / 2 + 520, RUNWAY_LENGTH / 2 + 1450, 420);
  const airport2 = rectZoneInfluence(x, z, AIRPORT2_X, AIRPORT2_Z, RUNWAY_WIDTH / 2 + 520, RUNWAY_LENGTH / 2 + 1450, 420);
  const city = rectZoneInfluence(x, z, CITY_CENTER_X, CITY_CENTER_Z, CITY_SIZE / 2 + 220, CITY_SIZE / 2 + 220, 380);
  const capeTown = rectZoneInfluence(x, z, CT_CENTER_X, CT_CENTER_Z, CT_SIZE_X / 2 + 180, CT_SIZE_Z / 2 + 180, 420);
  const intl = rectZoneInfluence(x, z, INTL_AIRPORT_X, INTL_AIRPORT_Z, 2500, 1500, 500);
  const generic = smoothstep(0.12, 0.7, genericAirportFlatten(x, z).factor);
  return Math.max(airport1, airport2, city, capeTown, intl, generic);
}

function classifyRoadPoint(point) {
  const suppression = getRoadCorridorSuppression(point.x, point.z);
  if (suppression > 0.02) return 'open';
  const cover = point.surfaceY - point.y;
  const clearance = point.y - point.surfaceY;
  if (cover > HIGHWAY_TUNNEL_COVER) return 'tunnel';
  if (clearance > HIGHWAY_BRIDGE_CLEARANCE) return 'bridge';
  return 'open';
}

function resolveRoadSegmentStructure(a, b) {
  if (a.structure === 'tunnel' || b.structure === 'tunnel') return 'tunnel';
  if (a.structure === 'bridge' || b.structure === 'bridge') return 'bridge';
  return 'open';
}

function smoothRoadStructures(profile) {
  const smoothed = profile.map((point, idx) => {
    let tunnelVotes = 0;
    let bridgeVotes = 0;
    for (let j = Math.max(0, idx - 2); j <= Math.min(profile.length - 1, idx + 2); j++) {
      if (profile[j].structure === 'tunnel') tunnelVotes++;
      if (profile[j].structure === 'bridge') bridgeVotes++;
    }
    if (tunnelVotes >= 3) return 'tunnel';
    if (bridgeVotes >= 3) return 'bridge';
    return 'open';
  });

  for (let i = 0; i < profile.length; i++) profile[i].structure = smoothed[i];

  const mergeShortSpans = (kind, minSpan) => {
    let start = -1;
    for (let i = 0; i <= profile.length; i++) {
      const matches = i < profile.length && profile[i].structure === kind;
      if (matches && start < 0) start = i;
      if ((!matches || i === profile.length) && start >= 0) {
        const spanLen = i - start;
        if (spanLen < minSpan) {
          for (let j = start; j < i; j++) profile[j].structure = 'open';
        }
        start = -1;
      }
    }
  };

  mergeShortSpans('tunnel', HIGHWAY_TUNNEL_MIN_SPAN);
  mergeShortSpans('bridge', HIGHWAY_BRIDGE_MIN_SPAN);
}

// Cape Town city flatten — full for CBD/east, partial in Bo-Kaap for hillside effect
function capeTownFlattenFactor(x, z) {
  const halfX = CT_SIZE_X / 2;
  const halfZ = CT_SIZE_Z / 2;
  const margin = 400;
  const dx = Math.max(0, Math.abs(x - CT_CENTER_X) - halfX);
  const dz = Math.max(0, Math.abs(z - CT_CENTER_Z) - halfZ);
  const dist = Math.sqrt(dx * dx + dz * dz);
  let f = 1 - smoothstep(0, margin, dist);
  // Reduce flattening in Bo-Kaap / western zone so terrain rises for hillside houses
  if (x < 9200 && f > 0) {
    const westFade = smoothstep(8000, 9200, x); // 0 at Table Mtn edge, 1 at CBD
    f *= 0.3 + 0.7 * westFade;
  }
  return f;
}

// Table Mountain — flat-topped mesa 1200x2000m at 280m
function tableMountainHeight(x, z) {
  const cx = TABLE_MTN_X, cz = TABLE_MTN_Z;
  const halfW = 600, halfD = 1000;
  const plateauH = 280;
  // Distance from plateau edge
  const edgeX = Math.max(0, Math.abs(x - cx) - halfW);
  const edgeZ = Math.max(0, Math.abs(z - cz) - halfD);

  // Steep cliffs on W, N, S (200m margin); gentler eastern slope (400m)
  const isEast = x > cx + halfW;
  const cliffMarginX = isEast ? 400 : 200;
  const cliffMarginZ = 200;

  const fx = 1 - smoothstep(0, cliffMarginX, edgeX);
  const fz = 1 - smoothstep(0, cliffMarginZ, edgeZ);
  return plateauH * fx * fz;
}

// Signal Hill — rounded hill r=400m, h=120m, gaussian falloff
function signalHillHeight(x, z) {
  const cx = SIGNAL_HILL_X, cz = SIGNAL_HILL_Z;
  const r = 400, h = 120;
  const dx = x - cx, dz = z - cz;
  const distSq = dx * dx + dz * dz;
  const rSq = r * r;
  if (distSq > rSq * 4) return 0; // early out
  return h * Math.exp(-distSq / (2 * rSq * 0.18));
}

// International airport flatten — large rectangular zone for E-W runways
function intlAirportFlattenFactor(x, z) {
  const halfW = 2000; // 4000m total width (E-W, along runway length)
  const halfD = 1000; // 2000m total depth (N-S, covers both runways + terminals)
  const margin = 400;
  const dx = Math.max(0, Math.abs(x - INTL_AIRPORT_X) - halfW);
  const dz = Math.max(0, Math.abs(z - INTL_AIRPORT_Z) - halfD);
  const dist = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(0, margin, dist);
}

// Generic flatten for data-driven airports (supports arbitrary heading)
let _extraFlattenZones = null;
function getExtraFlattenZones() {
  if (!_extraFlattenZones) {
    // Get only the NEW airports (not the first 3 which are handled by existing code)
    const allZones = getAirportFlattenZones();
    _extraFlattenZones = allZones.filter((_, i) => i >= 3);
  }
  return _extraFlattenZones;
}

// Returns { factor, elevation } — factor is 0-1 flatten strength, elevation is target height
function genericAirportFlatten(x, z) {
  const zones = getExtraFlattenZones();
  let maxF = 0;
  let targetElev = 0;
  for (const zone of zones) {
    // Transform to local coords rotated by runway heading
    const dx = x - zone.x;
    const dz = z - zone.z;
    // Rotate world offset into runway-local frame
    // Game convention: heading 90 = 0 rotation = runway along Z (N-S)
    const rotY = (zone.heading - 90) * Math.PI / 180;
    const cosR = Math.cos(rotY);
    const sinR = Math.sin(rotY);
    // After rotation: lx = across runway (width), lz = along runway (length)
    // Inverse of the mesh rotation to go from world → local
    const lx = dx * cosR + dz * sinR;
    const lz = -dx * sinR + dz * cosR;

    const edgeX = Math.max(0, Math.abs(lx) - zone.halfWidth);
    const edgeZ = Math.max(0, Math.abs(lz) - zone.halfLength);
    const dist = Math.sqrt(edgeX * edgeX + edgeZ * edgeZ);
    const f = 1 - smoothstep(0, zone.margin, dist);
    if (f > maxF) {
      maxF = f;
      targetElev = zone.elevation;
    }
  }
  return { factor: maxF, elevation: targetElev };
}

function infrastructureFlattenFactor(x, z) {
  // Airport 1 at origin
  const f1 = airportFlattenFactor(x, z, 0, 0);
  // Airport 2
  const f2 = airportFlattenFactor(x, z, AIRPORT2_X, AIRPORT2_Z);
  const f3 = cityFlattenFactor(x, z);
  const f5 = capeTownFlattenFactor(x, z);
  // International airport
  const f6 = intlAirportFlattenFactor(x, z);
  return Math.max(f1, f2, f3, f5, f6);
}

function getLandHeightWithoutRoads(x, z) {
  const noise = sampleNoise(x, z);
  const rawHeight = ((noise + 1) / 2) * TERRAIN_MAX_HEIGHT;
  const flatten = infrastructureFlattenFactor(x, z);
  let landHeight = rawHeight * (1 - flatten);

  const aptFlatten = genericAirportFlatten(x, z);
  if (aptFlatten.factor > 0) {
    const blended = landHeight * (1 - aptFlatten.factor) + aptFlatten.elevation * aptFlatten.factor;
    landHeight = aptFlatten.factor > 0.5 ? blended : Math.min(landHeight, blended);
  }

  return Math.max(landHeight, tableMountainHeight(x, z), signalHillHeight(x, z));
}

// Ocean depression — creates coastline along eastern edge of map
function oceanFactor(x, z) {
  // Wavy coastline using simplex noise for natural look
  const coastNoise = simplex.noise(z * 0.00025, 0.5) * 1200
    + simplex.noise(z * 0.0008, 1.7) * 400;
  const effectiveCoastX = COAST_LINE_X + coastNoise;

  // Smooth transition from land to ocean
  return smoothstep(effectiveCoastX - COAST_MARGIN / 2, effectiveCoastX + COAST_MARGIN / 2, x);
}

export function getTerrainHeight(x, z) {
  let withMountains = getLandHeightWithoutRoads(x, z);

  // Cut/fill terrain corridor for highway — wide enough to cover terrain grid cells.
  // Inner zone: fully flattened to road elevation.
  // Outer zone: smooth transition back to natural terrain.
  const road = getRoadCorridorInfo(x, z);
  if (road.factor > 0) {
    // Aggressively flatten terrain to road elevation — sharper inner zone
    const boosted = clamp((road.factor - 0.05) / 0.4, 0, 1);
    const sharpFactor = boosted * boosted * (3 - 2 * boosted);
    withMountains = withMountains * (1 - sharpFactor) + road.elevation * sharpFactor;
  }

  // Apply ocean depression east of coastline
  const ocean = oceanFactor(x, z);
  if (ocean <= 0) return withMountains;
  return withMountains * (1 - ocean) - ocean * OCEAN_DEPTH;
}

export function isInOcean(x, z) {
  return oceanFactor(x, z) > 0.5;
}

// ── Terrain height cache (Float32Array for fast bilinear lookups) ──
const CACHE_RES = TERRAIN_SEGMENTS; // 384x384 grid
let heightCache = null;

export function buildTerrainHeightCache() {
  heightCache = new Float32Array(CACHE_RES * CACHE_RES);
  const halfSize = TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / CACHE_RES;
  for (let row = 0; row < CACHE_RES; row++) {
    const z = -halfSize + (row + 0.5) * step;
    for (let col = 0; col < CACHE_RES; col++) {
      const x = -halfSize + (col + 0.5) * step;
      heightCache[row * CACHE_RES + col] = getTerrainHeight(x, z);
    }
  }
}

export function getTerrainHeightCached(x, z) {
  if (!heightCache) return getTerrainHeight(x, z);
  const halfSize = TERRAIN_SIZE / 2;
  // Convert world coords to grid coords (continuous)
  const gx = ((x + halfSize) / TERRAIN_SIZE) * CACHE_RES - 0.5;
  const gz = ((z + halfSize) / TERRAIN_SIZE) * CACHE_RES - 0.5;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  // Clamp to grid bounds
  const x0 = Math.max(0, Math.min(CACHE_RES - 1, ix));
  const x1 = Math.max(0, Math.min(CACHE_RES - 1, ix + 1));
  const z0 = Math.max(0, Math.min(CACHE_RES - 1, iz));
  const z1 = Math.max(0, Math.min(CACHE_RES - 1, iz + 1));
  // Bilinear interpolation
  const h00 = heightCache[z0 * CACHE_RES + x0];
  const h10 = heightCache[z0 * CACHE_RES + x1];
  const h01 = heightCache[z1 * CACHE_RES + x0];
  const h11 = heightCache[z1 * CACHE_RES + x1];
  return (h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) +
          h01 * (1 - fx) * fz + h11 * fx * fz);
}

export function getGroundLevel(x, z) {
  const terrainH = Math.max(getTerrainHeightCached(x, z), WATER_SURFACE_Y);

  // Aircraft carrier deck (solid surface over ocean)
  if (_carrierDeckCheck) {
    const deckH = _carrierDeckCheck(x, z);
    if (deckH !== null) return deckH;
  }

  // Check city road graph for city road elevations
  const cityRoad = queryCityRoadElevation(null, x, z);
  if (cityRoad && Number.isFinite(cityRoad.elevation)) {
    return Math.max(cityRoad.elevation + 0.2, terrainH);
  }

  // Highway corridor
  ensureRoadProfiles();
  const road = getRoadCorridorInfo(x, z);
  if (road.factor > 0.5 && Number.isFinite(road.elevation)) {
    return Math.max(road.elevation + 0.2, terrainH);
  }

  return terrainH;
}

// Carrier deck height callback — set by main.js to avoid circular imports
let _carrierDeckCheck = null;
export function setCarrierDeckCheck(fn) { _carrierDeckCheck = fn; }

function getNaturalSurfaceHeight(x, z) {
  let height = getLandHeightWithoutRoads(x, z);
  const ocean = oceanFactor(x, z);
  if (ocean > 0) height = height * (1 - ocean) - ocean * OCEAN_DEPTH;
  return Math.max(height, WATER_SURFACE_Y);
}

function addBridgeStructures(scene, points, roadWidth) {
  if (!points || points.length < 2) return;

  const spans = [];
  let spanStart = -1;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const structure = a.roadStructure === 'bridge' && b.roadStructure === 'bridge';
    const midX = (a.x + b.x) * 0.5;
    const midZ = (a.z + b.z) * 0.5;
    const deckY = (a.y + b.y) * 0.5;
    const groundA = getNaturalSurfaceHeight(a.x, a.z);
    const groundB = getNaturalSurfaceHeight(b.x, b.z);
    const groundY = getNaturalSurfaceHeight(midX, midZ);
    const protectedZone = getRoadCorridorSuppression(midX, midZ) > 0.02
      || isNearAirport(midX, midZ)
      || isInCityZone(midX, midZ)
      || isInCapeTownZone(midX, midZ);
    const clearanceMid = deckY - groundY;
    const clearanceA = a.y - groundA;
    const clearanceB = b.y - groundB;
    const isBridge = structure
      && !protectedZone
      && clearanceMid > HIGHWAY_BRIDGE_CLEARANCE
      && clearanceA > HIGHWAY_BRIDGE_CLEARANCE * 0.45
      && clearanceB > HIGHWAY_BRIDGE_CLEARANCE * 0.45;

    if (isBridge) {
      if (spanStart < 0) spanStart = i;
    } else if (spanStart >= 0) {
      if (i - spanStart >= HIGHWAY_BRIDGE_MIN_SPAN) spans.push([spanStart, i - 1]);
      spanStart = -1;
    }
  }

  if (spanStart >= 0 && points.length - 1 - spanStart >= HIGHWAY_BRIDGE_MIN_SPAN) {
    spans.push([spanStart, points.length - 2]);
  }
  if (spans.length === 0) return;

  let deckCount = 0;
  let railCount = 0;
  const pillarRefs = [];

  for (const [start, end] of spans) {
    let accumulated = 0;
    let nextPillar = 0;
    for (let i = start; i <= end; i++) {
      const a = points[i];
      const b = points[i + 1];
      const segLen = a.distanceTo(b);
      deckCount += 1;
      railCount += 2;

      if (i === start) {
        pillarRefs.push({ point: a });
        nextPillar = 82;
      }
      accumulated += segLen;
      if (accumulated >= nextPillar || i === end) {
        pillarRefs.push({ point: b });
        nextPillar += 82;
      }
    }
  }

  if (deckCount === 0) return;

  const deckMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(roadWidth + 1.5, 0.4, 1),
    new THREE.MeshStandardMaterial({ color: 0x7a7c82, roughness: 0.9, metalness: 0.08 }),
    deckCount
  );
  const railMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.15, 0.7, 1),
    new THREE.MeshStandardMaterial({ color: 0xb8bcc3, roughness: 0.72, metalness: 0.18 }),
    railCount
  );
  const pillarMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.94, metalness: 0.04 }),
    pillarRefs.length
  );
  const dummy = new THREE.Object3D();

  let deckIndex = 0;
  let railIndex = 0;
  for (const [start, end] of spans) {
    for (let i = start; i <= end; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen = Math.max(1, Math.hypot(dx, dz));
      const heading = Math.atan2(dx, dz);
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const midZ = (a.z + b.z) * 0.5;

      dummy.position.set(midX, midY - 0.3, midZ);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(1, 1, segLen);
      dummy.updateMatrix();
      deckMesh.setMatrixAt(deckIndex++, dummy.matrix);

      const sideX = -dz / segLen;
      const sideZ = dx / segLen;
      for (const side of [-1, 1]) {
        dummy.position.set(
          midX + sideX * side * (roadWidth * 0.5 + 0.85),
          midY + 0.25,
          midZ + sideZ * side * (roadWidth * 0.5 + 0.85)
        );
        dummy.rotation.set(0, heading, 0);
        dummy.scale.set(1, 1, segLen);
        dummy.updateMatrix();
        railMesh.setMatrixAt(railIndex++, dummy.matrix);
      }
    }
  }

  for (let i = 0; i < pillarRefs.length; i++) {
    const { point } = pillarRefs[i];
    const groundY = getNaturalSurfaceHeight(point.x, point.z);
    const height = Math.max(1, point.y - groundY - 0.3);
    dummy.position.set(point.x, groundY + height * 0.5, point.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    pillarMesh.setMatrixAt(i, dummy.matrix);
  }

  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;
  pillarMesh.castShadow = true;
  pillarMesh.receiveShadow = true;
  scene.add(deckMesh);
  scene.add(railMesh);
  scene.add(pillarMesh);
}

function addTunnelStructures(scene, points, roadWidth) {
  if (!points || points.length < 2) return;

  const spans = [];
  let spanStart = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const isTunnel = points[i].roadStructure === 'tunnel' && points[i + 1].roadStructure === 'tunnel';
    if (isTunnel) {
      if (spanStart < 0) spanStart = i;
    } else if (spanStart >= 0) {
      if (i - spanStart >= HIGHWAY_TUNNEL_MIN_SPAN) spans.push([spanStart, i - 1]);
      spanStart = -1;
    }
  }
  if (spanStart >= 0 && points.length - 1 - spanStart >= HIGHWAY_TUNNEL_MIN_SPAN) {
    spans.push([spanStart, points.length - 2]);
  }
  if (spans.length === 0) return;

  let linerCount = 0;
  for (const [start, end] of spans) linerCount += end - start + 1;

  const linerMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(roadWidth + 7, 6.8, 1),
    new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.96, metalness: 0.06, side: THREE.DoubleSide }),
    linerCount
  );
  const portalColumnMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 7.2, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x7f8388, roughness: 0.92, metalness: 0.05 }),
    spans.length * 4
  );
  const portalLintelMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(roadWidth + 7, 1.4, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x8c9094, roughness: 0.9, metalness: 0.05 }),
    spans.length * 2
  );
  const dummy = new THREE.Object3D();

  let linerIndex = 0;
  let colIndex = 0;
  let lintelIndex = 0;

  const placePortal = (point, nextPoint) => {
    const dx = nextPoint.x - point.x;
    const dz = nextPoint.z - point.z;
    const segLen = Math.max(1, Math.hypot(dx, dz));
    const heading = Math.atan2(dx, dz);
    const sideX = -dz / segLen;
    const sideZ = dx / segLen;
    const inset = 4;

    for (const side of [-1, 1]) {
      dummy.position.set(
        point.x + sideX * side * (roadWidth * 0.5 + 1.9) + (dx / segLen) * inset,
        point.y + 2.4,
        point.z + sideZ * side * (roadWidth * 0.5 + 1.9) + (dz / segLen) * inset
      );
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      portalColumnMesh.setMatrixAt(colIndex++, dummy.matrix);
    }

    dummy.position.set(
      point.x + (dx / segLen) * inset,
      point.y + 6.2,
      point.z + (dz / segLen) * inset
    );
    dummy.rotation.set(0, heading, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    portalLintelMesh.setMatrixAt(lintelIndex++, dummy.matrix);
  };

  for (const [start, end] of spans) {
    for (let i = start; i <= end; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen = Math.max(1, Math.hypot(dx, dz));
      const heading = Math.atan2(dx, dz);
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5 + 2.8;
      const midZ = (a.z + b.z) * 0.5;

      dummy.position.set(midX, midY, midZ);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(1, 1, segLen);
      dummy.updateMatrix();
      linerMesh.setMatrixAt(linerIndex++, dummy.matrix);
    }

    const entry = points[start];
    const entryNext = points[start + 1];
    const exit = points[end + 1];
    const exitPrev = points[end];
    placePortal(entry, entryNext);
    placePortal(exit, exitPrev);
  }

  linerMesh.castShadow = true;
  linerMesh.receiveShadow = true;
  portalColumnMesh.castShadow = true;
  portalColumnMesh.receiveShadow = true;
  portalLintelMesh.castShadow = true;
  portalLintelMesh.receiveShadow = true;
  scene.add(linerMesh);
  scene.add(portalColumnMesh);
  scene.add(portalLintelMesh);
}

function createGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base grass color
  ctx.fillStyle = '#4a7c35';
  ctx.fillRect(0, 0, 512, 512);

  // Large color patches for variation
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 20 + Math.random() * 60;
    const g = 90 + Math.random() * 50;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${40 + Math.random() * 30}, ${g}, ${25 + Math.random() * 20}, 0.25)`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
  }

  // Grass blade details
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const g = 70 + Math.random() * 80;
    ctx.fillStyle = `rgba(${25 + Math.random() * 35}, ${g}, ${15 + Math.random() * 25}, 0.35)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 5);
  }

  // Darker earthy spots
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 5 + Math.random() * 15;
    ctx.fillStyle = `rgba(${60 + Math.random() * 30}, ${50 + Math.random() * 20}, ${30 + Math.random() * 15}, 0.2)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(200, 200);
  return tex;
}

function createDirtTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#6f5b3d';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const tone = 70 + Math.random() * 70;
    ctx.fillStyle = `rgba(${tone + 10}, ${tone}, ${tone * 0.7}, ${0.08 + Math.random() * 0.2})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 8 + Math.random() * 26;
    const c = 55 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${c + 15}, ${c + 8}, ${c * 0.55}, 0.35)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(130, 130);
  return tex;
}

function createRockTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#676b70';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 22000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const tone = 80 + Math.random() * 90;
    const alpha = 0.1 + Math.random() * 0.22;
    ctx.fillStyle = `rgba(${tone}, ${tone + 4}, ${tone + 8}, ${alpha})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const w = 20 + Math.random() * 90;
    const h = 4 + Math.random() * 14;
    const a = Math.random() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const shade = 95 + Math.random() * 40;
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade + 8}, ${0.16 + Math.random() * 0.22})`;
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(85, 85);
  return tex;
}

function applyBiomeTerrainShader(material) {
  material.customProgramCacheKey = () => 'terrain-biome-v5-haze-clouds';
  material.onBeforeCompile = (shader) => {
    // --- Custom uniforms for atmospheric haze + cloud shadows ---
    shader.uniforms.uTime = { value: 0.0 };
    shader.uniforms.uSunDirection = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uSunElevation = { value: 45.0 };
    shader.uniforms.uWindOffset = { value: new THREE.Vector2(0, 0) };
    shader.uniforms.uHazeColor = { value: new THREE.Vector3(0.62, 0.73, 0.87) };
    shader.uniforms.uCloudShadows = { value: getSetting('graphicsQuality') === 'high' ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vWorldPos = worldPosition.xyz;
vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

uniform float uTime;
uniform vec3 uSunDirection;
uniform float uSunElevation;
uniform vec2 uWindOffset;
uniform vec3 uHazeColor;
uniform float uCloudShadows;

// --- Simplex-like 2D noise for cloud shadows ---
vec3 _mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 _mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _permute(vec3 x) { return _mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = _mod289v2(i);
  vec3 p = _permute(_permute(i.y + vec3(0.0, i1.y, 1.0))
                              + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                           dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
  vec3 ht = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + ht * ht);
  vec3 g;
  g.x = a0.x * x0.x + ht.x * x0.y;
  g.yz = a0.yz * x12.xz + ht.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Single-octave noise for cloud shadows (cheap)
float cloudFbm(vec2 p) {
  return snoise(p) * 0.6 + snoise(p * 2.5) * 0.25;
}`
      )
      .replace(
        '#include <map_fragment>',
        `// --- Rich terrain biome shader ---
// Noise for color variation (cheap hash from world position)
float px = vWorldPos.x * 0.002;
float pz = vWorldPos.z * 0.002;
float scatter = fract(sin(px * 127.1 + pz * 311.7) * 43758.5453);
float scatter2 = fract(sin(px * 269.5 + pz * 183.3) * 28615.2137);
float fineNoise = fract(sin(vWorldPos.x * 0.07 + vWorldPos.z * 0.09) * 12345.6789) * 0.06 - 0.03;

float h = vWorldPos.y + fineNoise * 20.0; // jitter height bands
float slope = 1.0 - vWorldNormal.y;

// --- Color palette ---
vec3 wetSand    = vec3(0.55, 0.50, 0.38);
vec3 drySand    = vec3(0.72, 0.65, 0.48);
vec3 lightGrass = vec3(0.42, 0.62, 0.28);
vec3 richGrass  = vec3(0.30, 0.55, 0.18);
vec3 darkForest = vec3(0.15, 0.32, 0.12);
vec3 scrub      = vec3(0.50, 0.48, 0.32);
vec3 dirtBrown  = vec3(0.45, 0.35, 0.25);
vec3 grayRock   = vec3(0.52, 0.50, 0.48);
vec3 darkRock   = vec3(0.35, 0.33, 0.32);
vec3 warmRock   = vec3(0.58, 0.50, 0.42);
vec3 snow       = vec3(0.94, 0.95, 0.98);
vec3 iceBlue    = vec3(0.82, 0.88, 0.95);

// --- Elevation-based base color ---
vec3 terrainColor = wetSand;

// Beach / low ground
terrainColor = mix(terrainColor, drySand, smoothstep(1.0, 5.0, h));

// Grassland — with scatter variation between light and rich
vec3 grassBlend = mix(lightGrass, richGrass, scatter);
terrainColor = mix(terrainColor, grassBlend, smoothstep(5.0, 15.0, h));

// Forest belt — patchy via scatter2
vec3 forestBlend = mix(richGrass, darkForest, scatter2 * 0.7 + 0.3);
terrainColor = mix(terrainColor, forestBlend, smoothstep(25.0, 50.0, h));

// Transition scrubland
terrainColor = mix(terrainColor, scrub, smoothstep(55.0, 80.0, h) * (0.5 + scatter * 0.5));

// Alpine / exposed dirt
terrainColor = mix(terrainColor, dirtBrown, smoothstep(80.0, 110.0, h));

// Rocky highlands — varied rock tones
vec3 rockBlend = mix(grayRock, warmRock, scatter);
terrainColor = mix(terrainColor, rockBlend, smoothstep(120.0, 170.0, h));

// High peaks — dark rock to snow transition
terrainColor = mix(terrainColor, darkRock, smoothstep(200.0, 250.0, h));
terrainColor = mix(terrainColor, iceBlue, smoothstep(270.0, 300.0, h) * 0.4);
terrainColor = mix(terrainColor, snow, smoothstep(300.0, 350.0, h));

// --- Slope effects ---
// Steep slopes -> exposed rock (variable tones)
vec3 slopeRock = mix(darkRock, warmRock, scatter * 0.6);
terrainColor = mix(terrainColor, slopeRock, smoothstep(0.25, 0.55, slope));

// Very steep cliff faces -> dark crevice look
terrainColor = mix(terrainColor, darkRock * 0.6, smoothstep(0.6, 0.85, slope));

// --- Shore wetness ---
float shore = 1.0 - smoothstep(0.0, 4.0, h);
terrainColor = mix(terrainColor, terrainColor * vec3(0.65, 0.70, 0.78), shore * 0.6);

// --- Subtle ambient occlusion from slope ---
float ao = 1.0 - slope * 0.15;
terrainColor *= ao;

// --- Cloud shadows on terrain (high quality only) ---
if (uCloudShadows > 0.5) {
  vec2 shadowUV = (vWorldPos.xz + uWindOffset) * 0.003;
  float cloudNoise = cloudFbm(shadowUV);
  float shadowMask = smoothstep(0.05, 0.25, cloudNoise);
  float shadowDarken = mix(0.78, 1.0, shadowMask);
  terrainColor *= shadowDarken;
}

// --- Improved atmospheric haze ---
float distToCamera = length(vWorldPos - cameraPosition);

// Exponential distance haze (replaces old linear fade)
float distHaze = 1.0 - exp(-distToCamera * 0.00008);

// Height-based valley fog: terrain below 50m gets extra haze
float valleyFog = (1.0 - smoothstep(0.0, 50.0, vWorldPos.y)) * 0.2;
float hazeFactor = clamp(distHaze + valleyFog * distHaze, 0.0, 0.85);

// Sky-aware haze color from uniform (updated per-frame to match sky)
vec3 computedHaze = uHazeColor;

// Sunset/sunrise warm tint: when sun is near horizon, blend warm orange-pink
float sunsetFactor = 1.0 - smoothstep(0.0, 15.0, uSunElevation);
vec3 sunsetTint = vec3(1.0, 0.55, 0.35);
computedHaze = mix(computedHaze, sunsetTint, sunsetFactor * 0.55);

// At very low sun, add deeper pink
float deepSunset = 1.0 - smoothstep(-2.0, 5.0, uSunElevation);
vec3 deepPink = vec3(0.9, 0.4, 0.45);
computedHaze = mix(computedHaze, deepPink, deepSunset * 0.3);

terrainColor = mix(terrainColor, computedHaze, hazeFactor);

diffuseColor = vec4(terrainColor, 1.0);`
      );

    // Store shader reference for per-frame uniform updates
    terrainShaderRef = shader;
  };
}

// Generate terrain normal map from height data
function createTerrainNormalMap(repeat) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  const scale = TERRAIN_SIZE / size;
  const heightScale = 2.0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const worldX = (x / size - 0.5) * TERRAIN_SIZE;
      const worldZ = (y / size - 0.5) * TERRAIN_SIZE;

      const hL = getTerrainHeight(worldX - scale, worldZ);
      const hR = getTerrainHeight(worldX + scale, worldZ);
      const hU = getTerrainHeight(worldX, worldZ - scale);
      const hD = getTerrainHeight(worldX, worldZ + scale);

      let nx = (hL - hR) * heightScale;
      let nz = (hU - hD) * heightScale;
      let ny = 2.0 * scale;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      data[idx] = (nx * 0.5 + 0.5) * 255;
      data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat, repeat);
  return tex;
}

export function createTerrain() {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS
  );
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;

  // Set terrain heights
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const h = getTerrainHeight(x, z);
    posAttr.setY(i, h);
  }
  geometry.computeVertexNormals();

  const normalMap = createTerrainNormalMap(1);

  const material = new THREE.MeshStandardMaterial({
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.85,
    metalness: 0.02,
  });
  applyBiomeTerrainShader(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function isNearAirport(x, z) {
  // Airport 1 at origin
  if (Math.abs(x) < 350 && Math.abs(z) < RUNWAY_LENGTH / 2 + 300) return true;
  // Airport 2
  if (Math.abs(x - AIRPORT2_X) < 350 && Math.abs(z - AIRPORT2_Z) < RUNWAY_LENGTH / 2 + 300) return true;
  return false;
}

function isInCityZone(x, z) {
  const halfSize = CITY_SIZE / 2 + 50;
  return Math.abs(x - CITY_CENTER_X) < halfSize && Math.abs(z - CITY_CENTER_Z) < halfSize;
}

function isInCapeTownZone(x, z) {
  const halfX = CT_SIZE_X / 2 + 100;
  const halfZ = CT_SIZE_Z / 2 + 100;
  return Math.abs(x - CT_CENTER_X) < halfX && Math.abs(z - CT_CENTER_Z) < halfZ;
}

// Check if position is near any road segment
function isNearRoad(x, z) {
  if (!highwaySamplePoints) return false;
  const roadCheckDist = 25; // stay 25m away from road center
  for (let i = 0; i < highwaySamplePoints.length; i += 3) {
    const dx = x - highwaySamplePoints[i].x;
    const dz = z - highwaySamplePoints[i].z;
    if (dx * dx + dz * dz < roadCheckDist * roadCheckDist) return true;
  }
  return false;
}

const TREE_COLOR_PALETTE = [
  new THREE.Color(0x2d6b1e),
  new THREE.Color(0x3a8c25),
  new THREE.Color(0x4a9a35),
  new THREE.Color(0x2a5c1a),
  new THREE.Color(0x557733),
  new THREE.Color(0x6b8e23),
  new THREE.Color(0x8faa3a),
  new THREE.Color(0x7a9a2e),
];

const VEGETATION_DENSITY_PROFILE = {
  low: { trees: 2500, bushes: 1000, deadTrees: 300, nearRadius: 1000, midRadius: 3000, nearTreeCap: 800, nearBushCap: 500, nearDeadCap: 120, impostorCap: 1200 },
  medium: { trees: 5000, bushes: 2500, deadTrees: 600, nearRadius: 1400, midRadius: 4000, nearTreeCap: 1600, nearBushCap: 900, nearDeadCap: 250, impostorCap: 2800 },
  high: { trees: 8000, bushes: 4000, deadTrees: 1000, nearRadius: 1800, midRadius: 5000, nearTreeCap: 2500, nearBushCap: 1200, nearDeadCap: 400, impostorCap: 4000 },
};

const vegetationLodState = {
  enabled: false,
  nearRadius: 1200,
  midRadius: 3200,
  updateIntervalMs: 250,
  lastUpdateMs: 0,
  allTrees: [],
  conifers: [],
  deciduous: [],
  tallPines: [],
  wideOaks: [],
  bushes: [],
  deadTrees: [],
  trunkMesh: null,
  coniferMesh: null,
  deciduousMesh: null,
  tallPineMesh: null,
  tallPineTrunkMesh: null,
  wideOakMesh: null,
  bushMesh: null,
  deadMesh: null,
  impostorPoints: null,
  impostorPositions: null,
  impostorColors: null,
  impostorCapacity: 0,
};

const _vegDummy = new THREE.Object3D();
const _autumnColor = new THREE.Color(0.7, 0.45, 0.15);
const _treeImpostorColor = new THREE.Color(0x4b6542);
const _bushColor = new THREE.Color(0x425b38);
const _deadImpostorColor = new THREE.Color(0x675f50);

function createVegetationMesh(geometry, material, count, castShadow = false) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.userData.maxCount = Math.max(1, count);
  mesh.count = 0;
  mesh.castShadow = castShadow;
  mesh.frustumCulled = false;
  return mesh;
}

function commitInstancedMesh(mesh, count, usesColor = false) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (usesColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function updateImpostorBuffer(focusX, focusZ, nearRadiusSq, midRadiusSq) {
  const { allTrees, bushes, deadTrees, impostorPositions, impostorColors, impostorCapacity, impostorPoints } = vegetationLodState;
  if (!impostorPoints || !impostorPositions || !impostorColors) return;

  let count = 0;
  const writeImpostor = (x, y, z, color) => {
    if (count >= impostorCapacity) return;
    const idx = count * 3;
    impostorPositions[idx] = x;
    impostorPositions[idx + 1] = y;
    impostorPositions[idx + 2] = z;
    impostorColors[idx] = color.r;
    impostorColors[idx + 1] = color.g;
    impostorColors[idx + 2] = color.b;
    count++;
  };

  for (let i = 0; i < allTrees.length; i++) {
    const t = allTrees[i];
    const dx = t.x - focusX;
    const dz = t.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq <= nearRadiusSq || distSq > midRadiusSq) continue;
    writeImpostor(t.x, t.h + t.scale * 1.6, t.z, _treeImpostorColor);
    if (count >= impostorCapacity) break;
  }

  if (count < impostorCapacity) {
    for (let i = 0; i < bushes.length && count < impostorCapacity; i++) {
      const b = bushes[i];
      const dx = b.x - focusX;
      const dz = b.z - focusZ;
      const distSq = dx * dx + dz * dz;
      if (distSq <= nearRadiusSq || distSq > midRadiusSq) continue;
      writeImpostor(b.x, b.h + b.scale * 0.55, b.z, _bushColor);
    }
  }

  if (count < impostorCapacity) {
    for (let i = 0; i < deadTrees.length && count < impostorCapacity; i++) {
      const t = deadTrees[i];
      const dx = t.x - focusX;
      const dz = t.z - focusZ;
      const distSq = dx * dx + dz * dz;
      if (distSq <= nearRadiusSq || distSq > midRadiusSq) continue;
      writeImpostor(t.x, t.h + t.scale * 1.1, t.z, _deadImpostorColor);
    }
  }

  impostorPoints.geometry.setDrawRange(0, count);
  impostorPoints.geometry.attributes.position.needsUpdate = true;
  impostorPoints.geometry.attributes.color.needsUpdate = true;
}

export function updateVegetationLOD(focusX, focusZ) {
  if (!vegetationLodState.enabled) return;

  const now = performance.now();
  if (now - vegetationLodState.lastUpdateMs < vegetationLodState.updateIntervalMs) return;
  vegetationLodState.lastUpdateMs = now;

  const nearRadiusSq = vegetationLodState.nearRadius * vegetationLodState.nearRadius;
  const midRadiusSq = vegetationLodState.midRadius * vegetationLodState.midRadius;

  let trunkCount = 0;
  let coniferCount = 0;
  let deciduousCount = 0;
  let tallPineCount = 0;
  let tallPineTrunkCount = 0;
  let wideOakCount = 0;
  const trunkCap = vegetationLodState.trunkMesh.userData.maxCount;
  const coniferCap = vegetationLodState.coniferMesh.userData.maxCount;
  const deciduousCap = vegetationLodState.deciduousMesh.userData.maxCount;
  const tallPineCap = vegetationLodState.tallPineMesh.userData.maxCount;
  const wideOakCap = vegetationLodState.wideOakMesh.userData.maxCount;

  for (let i = 0; i < vegetationLodState.allTrees.length; i++) {
    const t = vegetationLodState.allTrees[i];
    const dx = t.x - focusX;
    const dz = t.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > nearRadiusSq) continue;

    if (t.type === 'conifer') {
      if (coniferCount >= coniferCap) continue;
      // Trunk
      if (trunkCount < trunkCap) {
        _vegDummy.position.set(t.x, t.h + t.scale * 0.5, t.z);
        _vegDummy.rotation.set(0, 0, 0);
        _vegDummy.scale.setScalar(t.scale * 0.4);
        _vegDummy.updateMatrix();
        vegetationLodState.trunkMesh.setMatrixAt(trunkCount, _vegDummy.matrix);
        trunkCount++;
      }
      _vegDummy.position.set(t.x, t.h + t.scale * 1.8, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.setScalar(t.scale * 0.5);
      _vegDummy.updateMatrix();
      vegetationLodState.coniferMesh.setMatrixAt(coniferCount, _vegDummy.matrix);
      vegetationLodState.coniferMesh.setColorAt(coniferCount, t.color);
      coniferCount++;
    } else if (t.type === 'deciduous') {
      if (deciduousCount >= deciduousCap) continue;
      if (trunkCount < trunkCap) {
        _vegDummy.position.set(t.x, t.h + t.scale * 0.5, t.z);
        _vegDummy.rotation.set(0, 0, 0);
        _vegDummy.scale.setScalar(t.scale * 0.4);
        _vegDummy.updateMatrix();
        vegetationLodState.trunkMesh.setMatrixAt(trunkCount, _vegDummy.matrix);
        trunkCount++;
      }
      _vegDummy.position.set(t.x, t.h + t.scale * 1.6, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.set(t.scale * 0.5, t.scale * 0.4, t.scale * 0.5);
      _vegDummy.updateMatrix();
      vegetationLodState.deciduousMesh.setMatrixAt(deciduousCount, _vegDummy.matrix);
      vegetationLodState.deciduousMesh.setColorAt(deciduousCount, t.color);
      deciduousCount++;
    } else if (t.type === 'tallPine') {
      if (tallPineCount >= tallPineCap) continue;
      // Taller trunk for tall pine
      if (tallPineTrunkCount < trunkCap) {
        _vegDummy.position.set(t.x, t.h + t.scale * 0.8, t.z);
        _vegDummy.rotation.set(0, 0, 0);
        _vegDummy.scale.setScalar(t.scale * 0.4);
        _vegDummy.updateMatrix();
        vegetationLodState.tallPineTrunkMesh.setMatrixAt(tallPineTrunkCount, _vegDummy.matrix);
        tallPineTrunkCount++;
      }
      _vegDummy.position.set(t.x, t.h + t.scale * 2.4, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.setScalar(t.scale * 0.5);
      _vegDummy.updateMatrix();
      vegetationLodState.tallPineMesh.setMatrixAt(tallPineCount, _vegDummy.matrix);
      vegetationLodState.tallPineMesh.setColorAt(tallPineCount, t.color);
      tallPineCount++;
    } else if (t.type === 'wideOak') {
      if (wideOakCount >= wideOakCap) continue;
      if (trunkCount < trunkCap) {
        _vegDummy.position.set(t.x, t.h + t.scale * 0.5, t.z);
        _vegDummy.rotation.set(0, 0, 0);
        _vegDummy.scale.setScalar(t.scale * 0.5);
        _vegDummy.updateMatrix();
        vegetationLodState.trunkMesh.setMatrixAt(trunkCount, _vegDummy.matrix);
        trunkCount++;
      }
      _vegDummy.position.set(t.x, t.h + t.scale * 1.4, t.z);
      _vegDummy.rotation.set(0, 0, 0);
      _vegDummy.scale.set(t.scale * 0.55, t.scale * 0.35, t.scale * 0.55);
      _vegDummy.updateMatrix();
      vegetationLodState.wideOakMesh.setMatrixAt(wideOakCount, _vegDummy.matrix);
      vegetationLodState.wideOakMesh.setColorAt(wideOakCount, t.color);
      wideOakCount++;
    }
  }

  commitInstancedMesh(vegetationLodState.trunkMesh, trunkCount);
  commitInstancedMesh(vegetationLodState.coniferMesh, coniferCount, true);
  commitInstancedMesh(vegetationLodState.deciduousMesh, deciduousCount, true);
  commitInstancedMesh(vegetationLodState.tallPineMesh, tallPineCount, true);
  commitInstancedMesh(vegetationLodState.tallPineTrunkMesh, tallPineTrunkCount);
  commitInstancedMesh(vegetationLodState.wideOakMesh, wideOakCount, true);

  let bushCount = 0;
  const bushCap = vegetationLodState.bushMesh.userData.maxCount;
  for (let i = 0; i < vegetationLodState.bushes.length; i++) {
    const b = vegetationLodState.bushes[i];
    const dx = b.x - focusX;
    const dz = b.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > nearRadiusSq) continue;

    _vegDummy.position.set(b.x, b.h + b.scale * 0.3, b.z);
    _vegDummy.rotation.set(0, 0, 0);
    _vegDummy.scale.set(b.scale, b.scale * 0.6, b.scale);
    _vegDummy.updateMatrix();
    vegetationLodState.bushMesh.setMatrixAt(bushCount, _vegDummy.matrix);
    bushCount++;
    if (bushCount >= bushCap) break;
  }
  commitInstancedMesh(vegetationLodState.bushMesh, bushCount);

  let deadCount = 0;
  const deadCap = vegetationLodState.deadMesh.userData.maxCount;
  for (let i = 0; i < vegetationLodState.deadTrees.length; i++) {
    const t = vegetationLodState.deadTrees[i];
    const dx = t.x - focusX;
    const dz = t.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > nearRadiusSq) continue;

    _vegDummy.position.set(t.x, t.h + t.scale * 1.0, t.z);
    _vegDummy.rotation.set(t.leanX, t.yaw, t.leanZ);
    _vegDummy.scale.setScalar(t.scale * 0.5);
    _vegDummy.updateMatrix();
    vegetationLodState.deadMesh.setMatrixAt(deadCount, _vegDummy.matrix);
    deadCount++;
    if (deadCount >= deadCap) break;
  }
  commitInstancedMesh(vegetationLodState.deadMesh, deadCount);

  updateImpostorBuffer(focusX, focusZ, nearRadiusSq, midRadiusSq);
}

// Use InstancedMesh with dynamic LOD around aircraft for better visual density at stable cost.
export function createVegetation(scene) {
  const densitySetting = isSettingExplicit('vegetationDensity') ? getSetting('vegetationDensity') : getSetting('graphicsQuality');
  const vegetationProfile = VEGETATION_DENSITY_PROFILE[densitySetting] || VEGETATION_DENSITY_PROFILE.high;
  const treePositions = [];

  for (let i = 0; i < 9000; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;

    const h = getTerrainHeight(x, z);
    if (h > 250 || h < 3) continue;

    const density = simplex.noise(x * 0.0008, z * 0.0008);
    if (Math.random() > (density + 1) * 0.45) continue;
    if (treePositions.length >= vegetationProfile.trees) break;

    const baseScale = 0.5 + Math.random() * 1.5;
    const sizeBoost = density > 0.3 ? 1.0 + (density - 0.3) * 0.5 : 1.0;
    // Distribution: 35% conifer, 25% deciduous, 20% tall pine, 20% wide oak
    const typeRoll = Math.random();
    const type = typeRoll < 0.35 ? 'conifer' : typeRoll < 0.60 ? 'deciduous' : typeRoll < 0.80 ? 'tallPine' : 'wideOak';
    const color = TREE_COLOR_PALETTE[Math.floor(Math.random() * TREE_COLOR_PALETTE.length)];
    // Position-based color variation
    if (x > 10000) {
      // Near coast: darker greens
      color.multiplyScalar(0.7 + Math.random() * 0.3);
    }
    if (h > 80) {
      // High altitude: autumn tint
      const autumnT = Math.min((h - 80) / 120, 1.0);
      color.lerp(_autumnColor, autumnT * 0.5);
    }
    treePositions.push({ x, z, h, scale: baseScale * sizeBoost, type, color });
  }

  const bushPositions = [];
  for (let i = 0; i < 6000; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h > TERRAIN_MAX_HEIGHT * 0.35 || h < 3) continue;
    if (bushPositions.length >= vegetationProfile.bushes) break;
    bushPositions.push({ x, z, h, scale: 0.5 + Math.random() * 1.0 });
  }

  const deadTreePositions = [];
  for (let i = 0; i < 1500; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h > TERRAIN_MAX_HEIGHT * 0.55 || h < 3) continue;
    if (deadTreePositions.length >= vegetationProfile.deadTrees) break;
    deadTreePositions.push({
      x,
      z,
      h,
      scale: 1.0 + Math.random() * 2.0,
      leanX: (Math.random() - 0.5) * 0.2,
      leanZ: (Math.random() - 0.5) * 0.2,
      yaw: Math.random() * Math.PI * 2,
    });
  }

  const conifers = treePositions.filter(t => t.type === 'conifer');
  const deciduous = treePositions.filter(t => t.type === 'deciduous');
  const tallPines = treePositions.filter(t => t.type === 'tallPine');
  const wideOaks = treePositions.filter(t => t.type === 'wideOak');

  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
  // Conifer (cone) — 35% of trees
  const coneGeo = new THREE.ConeGeometry(1.5, 4, 6);
  const coniferMat = new THREE.MeshLambertMaterial({ color: 0x2d6b1e });
  // Deciduous (sphere) — 25% of trees
  const sphereGeo = new THREE.SphereGeometry(1.8, 6, 5);
  const deciduousMat = new THREE.MeshLambertMaterial({ color: 0x3a8c25 });
  // Tall pine — 20% of trees
  const tallPineGeo = new THREE.ConeGeometry(1.0, 6, 6);
  const tallPineMat = new THREE.MeshLambertMaterial({ color: 0x1a5c12 });
  const tallPineTrunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 6, 6);
  // Wide oak — 20% of trees
  const wideOakGeo = new THREE.SphereGeometry(2.2, 6, 5);
  wideOakGeo.scale(1, 0.6, 1);
  const wideOakMat = new THREE.MeshLambertMaterial({ color: 0x4a8a30 });
  const bushGeo = new THREE.SphereGeometry(1.0, 5, 4);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x3a7a20 });
  const deadTrunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 5, 5);
  const deadTrunkMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });

  const trunkInstanced = createVegetationMesh(trunkGeo, trunkMat, vegetationProfile.nearTreeCap);
  const coniferInstanced = createVegetationMesh(coneGeo, coniferMat, vegetationProfile.nearTreeCap);
  const deciduousInstanced = createVegetationMesh(sphereGeo, deciduousMat, vegetationProfile.nearTreeCap);
  const tallPineInstanced = createVegetationMesh(tallPineGeo, tallPineMat, vegetationProfile.nearTreeCap);
  const tallPineTrunkInstanced = createVegetationMesh(tallPineTrunkGeo, trunkMat, vegetationProfile.nearTreeCap);
  const wideOakInstanced = createVegetationMesh(wideOakGeo, wideOakMat, vegetationProfile.nearTreeCap);
  const bushInstanced = createVegetationMesh(bushGeo, bushMat, vegetationProfile.nearBushCap);
  const deadInstanced = createVegetationMesh(deadTrunkGeo, deadTrunkMat, vegetationProfile.nearDeadCap);

  scene.add(trunkInstanced);
  scene.add(coniferInstanced);
  scene.add(deciduousInstanced);
  scene.add(tallPineInstanced);
  scene.add(tallPineTrunkInstanced);
  scene.add(wideOakInstanced);
  scene.add(bushInstanced);
  scene.add(deadInstanced);

  const impostorCapacity = vegetationProfile.impostorCap;
  const impostorGeo = new THREE.BufferGeometry();
  const impostorPositions = new Float32Array(impostorCapacity * 3);
  const impostorColors = new Float32Array(impostorCapacity * 3);
  impostorGeo.setAttribute('position', new THREE.BufferAttribute(impostorPositions, 3));
  impostorGeo.setAttribute('color', new THREE.BufferAttribute(impostorColors, 3));
  impostorGeo.setDrawRange(0, 0);

  const impostorMat = new THREE.PointsMaterial({
    size: densitySetting === 'low' ? 5 : (densitySetting === 'medium' ? 6.5 : 8),
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: true,
  });
  const impostorPoints = new THREE.Points(impostorGeo, impostorMat);
  impostorPoints.frustumCulled = false;
  scene.add(impostorPoints);

  vegetationLodState.enabled = true;
  vegetationLodState.nearRadius = vegetationProfile.nearRadius;
  vegetationLodState.midRadius = vegetationProfile.midRadius;
  vegetationLodState.lastUpdateMs = 0;
  vegetationLodState.allTrees = treePositions;
  vegetationLodState.conifers = conifers;
  vegetationLodState.deciduous = deciduous;
  vegetationLodState.tallPines = tallPines;
  vegetationLodState.wideOaks = wideOaks;
  vegetationLodState.bushes = bushPositions;
  vegetationLodState.deadTrees = deadTreePositions;
  vegetationLodState.trunkMesh = trunkInstanced;
  vegetationLodState.coniferMesh = coniferInstanced;
  vegetationLodState.deciduousMesh = deciduousInstanced;
  vegetationLodState.tallPineMesh = tallPineInstanced;
  vegetationLodState.tallPineTrunkMesh = tallPineTrunkInstanced;
  vegetationLodState.wideOakMesh = wideOakInstanced;
  vegetationLodState.bushMesh = bushInstanced;
  vegetationLodState.deadMesh = deadInstanced;
  vegetationLodState.impostorPoints = impostorPoints;
  vegetationLodState.impostorPositions = impostorPositions;
  vegetationLodState.impostorColors = impostorColors;
  vegetationLodState.impostorCapacity = impostorCapacity;

  updateVegetationLOD(0, 0);
}

// Rural structures (farmhouses and barns) scattered across terrain
export function createRuralStructures(scene) {
  const dummy = new THREE.Object3D();

  // Farmhouse colors
  const farmhouseColors = [
    new THREE.Color(0xf5f5f0), // white
    new THREE.Color(0xf5e6c8), // cream
    new THREE.Color(0xc8d8e8), // light blue
    new THREE.Color(0xf0e68c), // yellow
  ];

  // Collect valid farmhouse positions
  const farmPositions = [];
  for (let i = 0; i < 3000 && farmPositions.length < 50; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 2 || h > TERRAIN_MAX_HEIGHT * 0.2) continue;
    farmPositions.push({
      x,
      z,
      h,
      heading: Math.random() * Math.PI * 2,
    });
  }

  // Farmhouses via InstancedMesh
  const farmGeo = new THREE.BoxGeometry(8, 5, 10);
  const farmMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const farmInstanced = new THREE.InstancedMesh(farmGeo, farmMat, farmPositions.length);
  farmInstanced.receiveShadow = true;
  for (let i = 0; i < farmPositions.length; i++) {
    const p = farmPositions[i];
    dummy.position.set(p.x, p.h + 2.5, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    farmInstanced.setMatrixAt(i, dummy.matrix);
    farmInstanced.setColorAt(i, farmhouseColors[Math.floor(Math.random() * farmhouseColors.length)]);
  }
  if (farmPositions.length > 0) farmInstanced.instanceColor.needsUpdate = true;
  scene.add(farmInstanced);

  // Farmhouse roof pass for stronger silhouette
  const roofGeo = new THREE.ConeGeometry(6.4, 2.6, 4);
  roofGeo.rotateY(Math.PI * 0.25);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x7b4f30 });
  const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, farmPositions.length);
  const roofBaseColor = new THREE.Color(0x7b4f30);
  const roofColor = new THREE.Color();
  roofMesh.receiveShadow = true;
  for (let i = 0; i < farmPositions.length; i++) {
    const p = farmPositions[i];
    dummy.position.set(p.x, p.h + 6.3, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.set(1.0, 0.9 + Math.random() * 0.25, 1.0);
    dummy.updateMatrix();
    roofMesh.setMatrixAt(i, dummy.matrix);
    roofColor.copy(roofBaseColor).multiplyScalar(0.85 + Math.random() * 0.3);
    roofMesh.setColorAt(i, roofColor);
  }
  if (farmPositions.length > 0) roofMesh.instanceColor.needsUpdate = true;
  scene.add(roofMesh);

  // Collect valid barn positions
  const barnPositions = [];
  for (let i = 0; i < 2000 && barnPositions.length < 25; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 2 || h > TERRAIN_MAX_HEIGHT * 0.2) continue;
    barnPositions.push({
      x,
      z,
      h,
      heading: Math.random() * Math.PI * 2,
    });
  }

  // Barns via InstancedMesh
  const barnGeo = new THREE.BoxGeometry(12, 6, 15);
  const barnMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
  const barnInstanced = new THREE.InstancedMesh(barnGeo, barnMat, barnPositions.length);
  barnInstanced.receiveShadow = true;
  const barnColor = new THREE.Color(0x8b4513);
  const barnTint = new THREE.Color();
  for (let i = 0; i < barnPositions.length; i++) {
    const p = barnPositions[i];
    dummy.position.set(p.x, p.h + 3, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    barnInstanced.setMatrixAt(i, dummy.matrix);
    barnTint.copy(barnColor).multiplyScalar(0.9 + Math.random() * 0.2);
    barnInstanced.setColorAt(i, barnTint);
  }
  if (barnPositions.length > 0) barnInstanced.instanceColor.needsUpdate = true;
  scene.add(barnInstanced);

  // Barn roofs
  const barnRoofGeo = new THREE.ConeGeometry(9.4, 3.0, 4);
  barnRoofGeo.rotateY(Math.PI * 0.25);
  const barnRoofMat = new THREE.MeshLambertMaterial({ color: 0x5f3020 });
  const barnRoofMesh = new THREE.InstancedMesh(barnRoofGeo, barnRoofMat, barnPositions.length);
  const barnRoofBase = new THREE.Color(0x5f3020);
  barnRoofMesh.receiveShadow = true;
  for (let i = 0; i < barnPositions.length; i++) {
    const p = barnPositions[i];
    dummy.position.set(p.x, p.h + 7.2, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.set(1.1, 0.85 + Math.random() * 0.25, 1.25);
    dummy.updateMatrix();
    barnRoofMesh.setMatrixAt(i, dummy.matrix);
    roofColor.copy(barnRoofBase).multiplyScalar(0.88 + Math.random() * 0.24);
    barnRoofMesh.setColorAt(i, roofColor);
  }
  if (barnPositions.length > 0) barnRoofMesh.instanceColor.needsUpdate = true;
  scene.add(barnRoofMesh);

  // Grain silos near a subset of farmhouses
  const siloPositions = [];
  for (let i = 0; i < farmPositions.length; i++) {
    if (Math.random() > 0.45) continue;
    const base = farmPositions[i];
    const dist = 10 + Math.random() * 8;
    const a = base.heading + (Math.random() > 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5);
    siloPositions.push({
      x: base.x + Math.cos(a) * dist,
      z: base.z + Math.sin(a) * dist,
      h: getTerrainHeight(base.x + Math.cos(a) * dist, base.z + Math.sin(a) * dist),
      scale: 0.9 + Math.random() * 0.35,
    });
  }

  if (siloPositions.length > 0) {
    const siloBodyGeo = new THREE.CylinderGeometry(1.4, 1.6, 9, 10);
    const siloBodyMat = new THREE.MeshLambertMaterial({ color: 0xb5b8bd });
    const siloBodyMesh = new THREE.InstancedMesh(siloBodyGeo, siloBodyMat, siloPositions.length);
    siloBodyMesh.receiveShadow = true;

    const siloCapGeo = new THREE.SphereGeometry(1.55, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const siloCapMat = new THREE.MeshLambertMaterial({ color: 0x8f949a });
    const siloCapMesh = new THREE.InstancedMesh(siloCapGeo, siloCapMat, siloPositions.length);
    const siloBaseColor = new THREE.Color(0xb5b8bd);
    const siloCapBaseColor = new THREE.Color(0x8f949a);

    for (let i = 0; i < siloPositions.length; i++) {
      const s = siloPositions[i];
      dummy.position.set(s.x, s.h + 4.5 * s.scale, s.z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      siloBodyMesh.setMatrixAt(i, dummy.matrix);
      barnTint.copy(siloBaseColor).multiplyScalar(0.88 + Math.random() * 0.24);
      siloBodyMesh.setColorAt(i, barnTint);

      dummy.position.set(s.x, s.h + 9.0 * s.scale, s.z);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      siloCapMesh.setMatrixAt(i, dummy.matrix);
      roofColor.copy(siloCapBaseColor).multiplyScalar(0.9 + Math.random() * 0.2);
      siloCapMesh.setColorAt(i, roofColor);
    }

    siloBodyMesh.instanceColor.needsUpdate = true;
    siloCapMesh.instanceColor.needsUpdate = true;
    scene.add(siloBodyMesh);
    scene.add(siloCapMesh);
  }
}

// Highway connecting Airport 1 → City → Airport 2
export function createHighway(scene) {
  ensureRoadProfiles();

  // Build the spline from the smoothed road profile so the mesh follows the
  // same flattened corridor as the terrain.
  const controlPoints = highwayRoadProfile.map(({ x, y, z }) => new THREE.Vector3(x, y + 0.2, z));

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');

  // Store the highway curve and sample points for external access
  highwayCurve = curve;
  const segments = 800;
  highwaySamplePoints = curve.getPoints(segments).map((point) => {
    const sample = sampleRoadProfile(highwayRoadProfile, point.x, point.z);
    point.y = sample.elevation + 0.2;
    point.roadStructure = sample.structure;
    return point;
  });

  // Wider road: 18m
  const roadWidth = 18;
  // Create road texture with dashed center line and shoulder markings
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 256;
  texCanvas.height = 128;
  const texCtx = texCanvas.getContext('2d');

  // Asphalt base
  texCtx.fillStyle = '#3a3a3a';
  texCtx.fillRect(0, 0, 256, 128);

  // Asphalt grain
  for (let i = 0; i < 1500; i++) {
    const gx = Math.random() * 256;
    const gy = Math.random() * 128;
    const brightness = 40 + Math.random() * 30;
    texCtx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.25)`;
    texCtx.fillRect(gx, gy, 2, 1);
  }

  // Solid white edge lines (road shoulders)
  texCtx.strokeStyle = '#ffffff';
  texCtx.lineWidth = 4;
  texCtx.setLineDash([]);
  texCtx.beginPath();
  texCtx.moveTo(0, 6); texCtx.lineTo(256, 6);
  texCtx.stroke();
  texCtx.beginPath();
  texCtx.moveTo(0, 122); texCtx.lineTo(256, 122);
  texCtx.stroke();

  // Yellow dashed center line (double line for highway)
  texCtx.strokeStyle = '#ffcc00';
  texCtx.lineWidth = 3;
  texCtx.setLineDash([20, 14]);
  texCtx.beginPath();
  texCtx.moveTo(0, 62); texCtx.lineTo(256, 62);
  texCtx.stroke();
  texCtx.beginPath();
  texCtx.moveTo(0, 66); texCtx.lineTo(256, 66);
  texCtx.stroke();

  // Lane divider dashes (white, thinner)
  texCtx.strokeStyle = '#dddddd';
  texCtx.lineWidth = 2;
  texCtx.setLineDash([12, 18]);
  texCtx.beginPath();
  texCtx.moveTo(0, 34); texCtx.lineTo(256, 34);
  texCtx.stroke();
  texCtx.beginPath();
  texCtx.moveTo(0, 94); texCtx.lineTo(256, 94);
  texCtx.stroke();

  const roadTex = new THREE.CanvasTexture(texCanvas);
  roadTex.wrapS = THREE.RepeatWrapping;
  roadTex.wrapT = THREE.ClampToEdgeWrapping;
  roadTex.repeat.set(1, 1); // UVs already handle repeating

  // Build geometry
  const roadVertices = [];
  const roadUVs = [];
  const roadIndices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);

    // Get perpendicular direction (in XZ plane)
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    // Sample road profile AND actual terrain — always stay above both
    const profileH = sampleRoadSurfaceHeight(highwayRoadProfile, point.x, point.z);
    const actualTerrainH = getLandHeightWithoutRoads(point.x, point.z);
    let terrainH = Math.max(profileH, actualTerrainH) + 0.35;

    // Hide road mesh inside airport/protected zones by sinking it underground
    if (getRoadCorridorSuppression(point.x, point.z) > 0.3) {
      terrainH = getLandHeightWithoutRoads(point.x, point.z) - 5;
    }

    const left = new THREE.Vector3(
      point.x - perp.x * roadWidth * 0.5,
      terrainH,
      point.z - perp.z * roadWidth * 0.5
    );
    const right = new THREE.Vector3(
      point.x + perp.x * roadWidth * 0.5,
      terrainH,
      point.z + perp.z * roadWidth * 0.5
    );

    roadVertices.push(left.x, left.y, left.z);
    roadVertices.push(right.x, right.y, right.z);

    const u = t * (segments / 4);
    roadUVs.push(u, 0);
    roadUVs.push(u, 1);

    if (i < segments) {
      const idx = i * 2;
      roadIndices.push(idx, idx + 1, idx + 2);
      roadIndices.push(idx + 1, idx + 3, idx + 2);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();

  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex, color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);
  addBridgeStructures(scene, highwaySamplePoints, roadWidth);
  addTunnelStructures(scene, highwaySamplePoints, roadWidth);

  // ── Cape Town highway spur ──
  const spurControlPoints = highwaySpurProfile.map(({ x, y, z }) => new THREE.Vector3(x, y + 0.2, z));
  const spurCurve = new THREE.CatmullRomCurve3(spurControlPoints, false, 'centripetal');
  const spurSegs = 400;
  const spurRoadTex = roadTex.clone();
  spurRoadTex.repeat.set(1, 1);

  const spurVerts = [];
  const spurUVs = [];
  const spurIdx = [];
  for (let i = 0; i <= spurSegs; i++) {
    const t = i / spurSegs;
    const pt = spurCurve.getPointAt(t);
    const tan = spurCurve.getTangentAt(t);
    const perp = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    let tH = Math.max(sampleRoadSurfaceHeight(highwaySpurProfile, pt.x, pt.z), getLandHeightWithoutRoads(pt.x, pt.z)) + 0.35;
    if (getRoadCorridorSuppression(pt.x, pt.z) > 0.3) {
      tH = getLandHeightWithoutRoads(pt.x, pt.z) - 5;
    }
    spurVerts.push(pt.x - perp.x * roadWidth * 0.5, tH, pt.z - perp.z * roadWidth * 0.5);
    spurVerts.push(pt.x + perp.x * roadWidth * 0.5, tH, pt.z + perp.z * roadWidth * 0.5);
    const u = t * (spurSegs / 4);
    spurUVs.push(u, 0);
    spurUVs.push(u, 1);
    if (i < spurSegs) {
      const si = i * 2;
      spurIdx.push(si, si + 1, si + 2, si + 1, si + 3, si + 2);
    }
  }
  const spurGeo = new THREE.BufferGeometry();
  spurGeo.setAttribute('position', new THREE.Float32BufferAttribute(spurVerts, 3));
  spurGeo.setAttribute('uv', new THREE.Float32BufferAttribute(spurUVs, 2));
  spurGeo.setIndex(spurIdx);
  spurGeo.computeVertexNormals();
  const spurMesh = new THREE.Mesh(spurGeo, roadMat.clone());
  spurMesh.material.map = spurRoadTex;
  spurMesh.receiveShadow = true;
  scene.add(spurMesh);

  // Add spur sample points to highway sample points for road-avoidance checks
  const spurSamples = spurCurve.getPoints(spurSegs).map((point) => {
    const sample = sampleRoadProfile(highwaySpurProfile, point.x, point.z);
    point.y = sample.elevation + 0.2;
    point.roadStructure = sample.structure;
    return point;
  });
  addBridgeStructures(scene, spurSamples, roadWidth);
  addTunnelStructures(scene, spurSamples, roadWidth);
  highwaySamplePoints = highwaySamplePoints.concat(spurSamples);

  // ── City spur highway (connects main highway to city center) ──
  const cityControlPoints = highwayCityProfile.map(({ x, y, z }) => new THREE.Vector3(x, y + 0.2, z));
  const cityCurve = new THREE.CatmullRomCurve3(cityControlPoints, false, 'centripetal');
  const citySegs = 300;
  const cityRoadTex = roadTex.clone();
  cityRoadTex.repeat.set(1, 1);

  const cityVerts = [];
  const cityUVs = [];
  const cityIdx = [];
  for (let i = 0; i <= citySegs; i++) {
    const t = i / citySegs;
    const pt = cityCurve.getPointAt(t);
    const tan = cityCurve.getTangentAt(t);
    const perp = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    let cH = Math.max(sampleRoadSurfaceHeight(highwayCityProfile, pt.x, pt.z), getLandHeightWithoutRoads(pt.x, pt.z)) + 0.35;
    if (getRoadCorridorSuppression(pt.x, pt.z) > 0.3) {
      cH = getLandHeightWithoutRoads(pt.x, pt.z) - 5;
    }
    cityVerts.push(pt.x - perp.x * roadWidth * 0.5, cH, pt.z - perp.z * roadWidth * 0.5);
    cityVerts.push(pt.x + perp.x * roadWidth * 0.5, cH, pt.z + perp.z * roadWidth * 0.5);
    const u = t * (citySegs / 4);
    cityUVs.push(u, 0);
    cityUVs.push(u, 1);
    if (i < citySegs) {
      const ci = i * 2;
      cityIdx.push(ci, ci + 1, ci + 2, ci + 1, ci + 3, ci + 2);
    }
  }
  const cityGeo = new THREE.BufferGeometry();
  cityGeo.setAttribute('position', new THREE.Float32BufferAttribute(cityVerts, 3));
  cityGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cityUVs, 2));
  cityGeo.setIndex(cityIdx);
  cityGeo.computeVertexNormals();
  const cityMesh = new THREE.Mesh(cityGeo, roadMat.clone());
  cityMesh.material.map = cityRoadTex;
  cityMesh.receiveShadow = true;
  scene.add(cityMesh);

  // Add city spur samples for road-avoidance and bridge structures
  const citySamples = cityCurve.getPoints(citySegs).map((point) => {
    const sample = sampleRoadProfile(highwayCityProfile, point.x, point.z);
    point.y = sample.elevation + 0.2;
    point.roadStructure = sample.structure;
    return point;
  });
  addBridgeStructures(scene, citySamples, roadWidth);
  addTunnelStructures(scene, citySamples, roadWidth);
  highwaySamplePoints = highwaySamplePoints.concat(citySamples);
}

// Export function to get the highway spline path
export function getHighwayPath() {
  if (!highwayCurve) return null;
  return {
    curve: highwayCurve,
    points: highwaySamplePoints,
  };
}

// Rock formations on mountain peaks
export function createRockFormations(scene) {
  const dummy = new THREE.Object3D();
  const rockPositions = [];

  for (let i = 0; i < 5000 && rockPositions.length < 100; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const h = getTerrainHeight(x, z);
    if (h < TERRAIN_MAX_HEIGHT * 0.4) continue;
    const scale = 2 + Math.random() * 6;
    rockPositions.push({ x, z, h, scale });
  }

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x7a7a72,
    roughness: 0.95,
    metalness: 0.05,
  });

  const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rockPositions.length);
  rockInstanced.receiveShadow = true;

  const rockColor = new THREE.Color(0x7a7a72);
  for (let i = 0; i < rockPositions.length; i++) {
    const r = rockPositions[i];
    // Partially embedded in terrain
    dummy.position.set(r.x, r.h - r.scale * 0.3, r.z);
    dummy.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI
    );
    dummy.scale.set(
      r.scale * (0.8 + Math.random() * 0.4),
      r.scale * (0.6 + Math.random() * 0.5),
      r.scale * (0.8 + Math.random() * 0.4)
    );
    dummy.updateMatrix();
    rockInstanced.setMatrixAt(i, dummy.matrix);
    // Slight color variation
    const variation = 0.85 + Math.random() * 0.3;
    rockInstanced.setColorAt(i, rockColor.clone().multiplyScalar(variation));
  }
  if (rockPositions.length > 0) rockInstanced.instanceColor.needsUpdate = true;
  scene.add(rockInstanced);
}

// Wildflower patches across low terrain meadows
export function createWildflowers(scene) {
  const densitySetting = isSettingExplicit('vegetationDensity') ? getSetting('vegetationDensity') : getSetting('graphicsQuality');
  const flowerTarget = densitySetting === 'low' ? 1200 : (densitySetting === 'medium' ? 2100 : 3000);
  const dummy = new THREE.Object3D();
  const flowerColors = [
    new THREE.Color(0xffe033), // vivid golden yellow
    new THREE.Color(0xffcc00), // deep gold
    new THREE.Color(0xdaa520), // golden amber
    new THREE.Color(0xf5b800), // amber
    new THREE.Color(0xcc44cc), // vivid purple
    new THREE.Color(0x9b30ff), // bright purple
    new THREE.Color(0xff2255), // vivid red-pink
    new THREE.Color(0xff6633), // bright orange
    new THREE.Color(0xffeeaa), // cream
    new THREE.Color(0xff88aa), // saturated pink
    new THREE.Color(0x4488ff), // cornflower blue
    new THREE.Color(0xff4444), // bright red
  ];

  const flowerPositions = [];
  for (let i = 0; i < 18000 && flowerPositions.length < flowerTarget; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 0.5 || h > TERRAIN_MAX_HEIGHT * 0.18) continue;
    flowerPositions.push({ x, z, h });
  }

  const flowerGeo = new THREE.PlaneGeometry(1.2, 1.2);
  const flowerMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7,
  });

  const flowerInstanced = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerPositions.length);
  for (let i = 0; i < flowerPositions.length; i++) {
    const f = flowerPositions[i];
    dummy.position.set(f.x, f.h + 0.1, f.z);
    // Lay flat on ground
    dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    // Slightly larger patches
    dummy.scale.set(0.6 + Math.random() * 0.5, 0.6 + Math.random() * 0.5, 1);
    dummy.updateMatrix();
    flowerInstanced.setMatrixAt(i, dummy.matrix);
    flowerInstanced.setColorAt(i, flowerColors[Math.floor(Math.random() * flowerColors.length)]);
  }
  if (flowerPositions.length > 0) flowerInstanced.instanceColor.needsUpdate = true;
  scene.add(flowerInstanced);
}

// ═══════════════════════════════════════════════════════════
// Volumetric Cluster Cloud System
// ═══════════════════════════════════════════════════════════
let cloudGroup;
let cloudClusters = [];
let cloudDensity = 'normal';
let cloudMaterials = [];
let cloudSceneRef = null;
let cloudQuality = 'high';
let weatherCloudProfile = { cloudCount: 180, cloudOpacity: 0.28 };
let cloudPuffTexture = null;
let cloudCumulusMats = [];
let cloudShadowMats = [];

const CLOUD_QUALITY_CONFIG = {
  low: {
    cumulusCount: 90,
    area: 50000,
  },
  medium: {
    cumulusCount: 190,
    area: 52000,
  },
  high: {
    cumulusCount: 320,
    area: 56000,
  },
};
const CLOUD_DENSITY_ORDER = ['none', 'few', 'normal', 'many'];
const CLOUD_DENSITY_MULTIPLIER = { none: 0, few: 0.5, normal: 0.9, many: 1.18 };

// Soft volumetric cloud puff texture.
function createCloudTexture() {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mid = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Build up a cloud volume from multiple overlapping soft blobs.
  for (let i = 0; i < 18; i++) {
    const r = size * (0.12 + Math.random() * 0.26);
    const x = mid + (Math.random() - 0.5) * size * 0.42;
    const y = mid + (Math.random() - 0.5) * size * 0.32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.36)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // Broad center mass and soft edge falloff.
  const mass = ctx.createRadialGradient(mid, mid, size * 0.08, mid, mid, size * 0.56);
  mass.addColorStop(0, 'rgba(255,255,255,0.92)');
  mass.addColorStop(0.38, 'rgba(255,255,255,0.62)');
  mass.addColorStop(0.72, 'rgba(255,255,255,0.2)');
  mass.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mass;
  ctx.fillRect(0, 0, size, size);

  // Underside shadow tint for depth.
  const shadow = ctx.createLinearGradient(0, size * 0.45, 0, size);
  shadow.addColorStop(0, 'rgba(90,105,125,0)');
  shadow.addColorStop(1, 'rgba(75,90,115,0.28)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createClouds(scene) {
  cloudSceneRef = scene;

  if (cloudGroup) {
    scene.remove(cloudGroup);
  }
  for (const mat of cloudMaterials) {
    mat.dispose();
  }

  cloudGroup = new THREE.Group();
  cloudClusters = [];
  cloudMaterials = [];
  cloudCumulusMats = [];
  cloudShadowMats = [];

  if (!cloudPuffTexture) cloudPuffTexture = createCloudTexture();
  const quality = CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high;
  const opacityBase = Math.max(0.16, Math.min(0.96, weatherCloudProfile.cloudOpacity || 0.28));

  const cumulusOpacities = [0.55, 0.65, 0.75, 0.85];
  const shadowOpacities = [0.15, 0.22];

  for (let i = 0; i < cumulusOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudPuffTexture,
      transparent: true,
      opacity: Math.min(0.8, cumulusOpacities[i] * (0.55 + opacityBase * 0.72)),
      depthWrite: false,
      fog: false,
      color: 0xf2f6ff,
    });
    mat.userData.role = 'cumulus';
    cloudCumulusMats.push(mat);
    cloudMaterials.push(mat);
  }

  for (let i = 0; i < shadowOpacities.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudPuffTexture,
      transparent: true,
      opacity: Math.min(0.3, shadowOpacities[i] * (0.55 + opacityBase * 0.62)),
      depthWrite: false,
      fog: false,
      color: 0xaebbd0,
    });
    mat.userData.role = 'shadow';
    cloudShadowMats.push(mat);
    cloudMaterials.push(mat);
  }

  const area = quality.area;
  const totalCount = quality.cumulusCount;

  // Cumulus cloud clusters.
  for (let c = 0; c < totalCount; c++) {
    const cluster = new THREE.Group();
    cluster.position.set(
      (Math.random() - 0.5) * area,
      520 + Math.random() * 520,
      (Math.random() - 0.5) * area
    );
    cluster.userData.type = 'cumulus';
    cluster.userData.drift = 0.8 + Math.random() * 0.5;

    const cloudW = 620 + Math.random() * 850;
    const cloudD = 520 + Math.random() * 760;
    const cloudH = 70 + Math.random() * 120;
    const puffCount = 5 + Math.floor(Math.random() * 5);

    for (let p = 0; p < puffCount; p++) {
      const mat = cloudCumulusMats[Math.floor(Math.random() * cloudCumulusMats.length)];
      const sprite = new THREE.Sprite(mat);
      const s = 280 + Math.random() * 420;
      sprite.scale.set(s, s * (0.5 + Math.random() * 0.24), 1);
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * (0.75 + Math.random() * 0.35),
        (Math.random() - 0.5) * cloudH,
        (Math.random() - 0.5) * cloudD * (0.75 + Math.random() * 0.35)
      );
      cluster.add(sprite);
    }

    // Underside shadow puff
    const shadeCount = 2 + Math.floor(Math.random() * 2);
    for (let s = 0; s < shadeCount; s++) {
      const mat = cloudShadowMats[Math.floor(Math.random() * cloudShadowMats.length)];
      const sprite = new THREE.Sprite(mat);
      const sz = 280 + Math.random() * 380;
      sprite.scale.set(sz, sz * 0.32, 1);
      sprite.position.set(
        (Math.random() - 0.5) * cloudW * 0.55,
        -cloudH * 0.55 - Math.random() * 14,
        (Math.random() - 0.5) * cloudD * 0.55
      );
      cluster.add(sprite);
    }

    cloudGroup.add(cluster);
    cloudClusters.push(cluster);
  }

  scene.add(cloudGroup);
  applyCloudDensity();
  return cloudGroup;
}

export function updateClouds(dt, windVector, cameraY, focusX = 0, focusZ = 0) {
  if (!cloudGroup || !windVector) return;

  const driftX = windVector.x * dt * 0.32;
  const driftZ = windVector.z * dt * 0.32;
  const limit = getCloudActiveLimit();
  const wrapHalfSpan = (CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high).area * 0.52;
  const wrapSpan = wrapHalfSpan * 2;

  for (let i = 0; i < cloudClusters.length; i++) {
    const cluster = cloudClusters[i];
    const isActive = i < limit;

    if (!isActive) {
      cluster.visible = false;
      continue;
    }
    cluster.visible = true;

    const driftMul = cluster.userData.drift || 1.0;
    cluster.position.x += driftX * driftMul;
    cluster.position.z += driftZ * driftMul;

    if (cluster.position.x - focusX > wrapHalfSpan) cluster.position.x -= wrapSpan;
    if (cluster.position.x - focusX < -wrapHalfSpan) cluster.position.x += wrapSpan;
    if (cluster.position.z - focusZ > wrapHalfSpan) cluster.position.z -= wrapSpan;
    if (cluster.position.z - focusZ < -wrapHalfSpan) cluster.position.z += wrapSpan;
  }
}

// Cloud color palettes for direct assignment
const CLOUD_PALETTES = {
  day:   { base: new THREE.Color(0xffffff), shadow: new THREE.Color(0xcccccc) },
  dawn:  { base: new THREE.Color(0xffccaa), shadow: new THREE.Color(0xcc8866) },
  dusk:  { base: new THREE.Color(0xff9966), shadow: new THREE.Color(0x996644) },
  night: { base: new THREE.Color(0x334455), shadow: new THREE.Color(0x222233) },
};

const _cloudBaseColor = new THREE.Color();
const _cloudShadowColor = new THREE.Color();

// Update cloud colors based on time of day
export function updateCloudColors(sunElevation) {
  let baseColor, shadowColor;

  if (sunElevation > 15) {
    baseColor = CLOUD_PALETTES.day.base;
    shadowColor = CLOUD_PALETTES.day.shadow;
  } else if (sunElevation > 2) {
    const t = (sunElevation - 2) / 13;
    _cloudBaseColor.copy(CLOUD_PALETTES.dawn.base).lerp(CLOUD_PALETTES.day.base, t);
    _cloudShadowColor.copy(CLOUD_PALETTES.dawn.shadow).lerp(CLOUD_PALETTES.day.shadow, t);
    baseColor = _cloudBaseColor;
    shadowColor = _cloudShadowColor;
  } else if (sunElevation > -2) {
    const t = (sunElevation + 2) / 4;
    _cloudBaseColor.copy(CLOUD_PALETTES.dusk.base).lerp(CLOUD_PALETTES.dawn.base, t);
    _cloudShadowColor.copy(CLOUD_PALETTES.dusk.shadow).lerp(CLOUD_PALETTES.dawn.shadow, t);
    baseColor = _cloudBaseColor;
    shadowColor = _cloudShadowColor;
  } else if (sunElevation > -5) {
    const t = (sunElevation + 5) / 3;
    _cloudBaseColor.copy(CLOUD_PALETTES.night.base).lerp(CLOUD_PALETTES.dusk.base, t);
    _cloudShadowColor.copy(CLOUD_PALETTES.night.shadow).lerp(CLOUD_PALETTES.dusk.shadow, t);
    baseColor = _cloudBaseColor;
    shadowColor = _cloudShadowColor;
  } else {
    baseColor = CLOUD_PALETTES.night.base;
    shadowColor = CLOUD_PALETTES.night.shadow;
  }

  for (let i = 0; i < cloudMaterials.length; i++) {
    const mat = cloudMaterials[i];
    if (mat.userData.role === 'shadow') {
      mat.color.copy(shadowColor);
    } else {
      mat.color.copy(baseColor);
    }
  }
}

function getCloudActiveLimit() {
  const quality = CLOUD_QUALITY_CONFIG[cloudQuality] || CLOUD_QUALITY_CONFIG.high;
  const baseCount = quality.cumulusCount;
  const weatherFactor = Math.max(0.3, Math.min(1.4, (weatherCloudProfile.cloudCount || 180) / 320));
  const densityFactor = CLOUD_DENSITY_MULTIPLIER[cloudDensity] ?? 1.0;
  return Math.floor(baseCount * weatherFactor * densityFactor);
}

function applyCloudDensity() {
  const limit = getCloudActiveLimit();
  for (let i = 0; i < cloudClusters.length; i++) {
    cloudClusters[i].visible = i < limit;
  }
}

export function cycleCloudDensity() {
  const idx = CLOUD_DENSITY_ORDER.indexOf(cloudDensity);
  cloudDensity = CLOUD_DENSITY_ORDER[(idx + 1) % CLOUD_DENSITY_ORDER.length];
  applyCloudDensity();
  return cloudDensity;
}

export function getCloudDensity() {
  return cloudDensity;
}

export function setCloudQuality(level) {
  if (!CLOUD_QUALITY_CONFIG[level]) return cloudQuality;
  if (cloudQuality === level) return cloudQuality;
  cloudQuality = level;
  if (cloudSceneRef) createClouds(cloudSceneRef);
  return cloudQuality;
}

export function applyWeatherCloudProfile(profile) {
  if (profile && typeof profile === 'object') {
    if (typeof profile.cloudCount === 'number') weatherCloudProfile.cloudCount = profile.cloudCount;
    if (typeof profile.cloudOpacity === 'number') weatherCloudProfile.cloudOpacity = profile.cloudOpacity;
  }

  const opacityBase = Math.max(0.16, Math.min(0.96, weatherCloudProfile.cloudOpacity || 0.28));
  for (let i = 0; i < cloudCumulusMats.length; i++) {
    const mat = cloudCumulusMats[i];
    const base = [0.55, 0.65, 0.75, 0.85][i] || 0.65;
    mat.opacity = Math.min(0.8, base * (0.55 + opacityBase * 0.72));
  }
  for (let i = 0; i < cloudShadowMats.length; i++) {
    const mat = cloudShadowMats[i];
    const base = [0.15, 0.22][i] || 0.18;
    mat.opacity = Math.min(0.3, base * (0.55 + opacityBase * 0.62));
  }

  applyCloudDensity();
}

// Stylized water with custom shader
let water;
let waterMat;

export function createWater(sceneRef) {
  const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128);
  waterGeo.rotateX(-Math.PI / 2);

  waterMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      shallowColor: { value: new THREE.Color(0.15, 0.65, 0.65) },
      deepColor: { value: new THREE.Color(0.05, 0.2, 0.4) },
      cameraPos: { value: new THREE.Vector3() },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0.00004 },
    },
    vertexShader: `
      uniform float time;
      varying vec3 vWorldPos;
      varying float vWaveHeight;
      void main() {
        vec3 pos = position;
        float wave = sin(pos.x * 0.02 + time) * cos(pos.z * 0.015 + time * 0.7) * 1.5;
        wave += sin(pos.x * 0.035 - time * 0.8) * cos(pos.z * 0.025 + time * 0.5) * 0.8;
        pos.y += wave;
        vWaveHeight = wave;
        vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 shallowColor, deepColor, cameraPos, fogColor;
      uniform float fogDensity;
      varying vec3 vWorldPos;
      varying float vWaveHeight;
      void main() {
        vec3 viewDir = normalize(cameraPos - vWorldPos);
        float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
        vec3 water = mix(shallowColor, deepColor, fresnel);
        // Foam highlights on wave peaks
        water += vec3(0.15) * smoothstep(0.3, 1.5, vWaveHeight);
        // Fog integration
        float dist = length(vWorldPos - cameraPos);
        float fogFactor = 1.0 - exp(-fogDensity * dist * dist);
        water = mix(water, fogColor, fogFactor);
        gl_FragColor = vec4(water, 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -2;
  sceneRef.add(water);
  return water;
}

export function updateWater(dt, windVector, camera) {
  if (!waterMat) return;
  const windSpeed = windVector ? Math.hypot(windVector.x, windVector.z) : 0;
  const timeScale = 0.5 + Math.min(0.6, windSpeed * 0.02);
  waterMat.uniforms.time.value += dt * timeScale;
  if (camera) {
    waterMat.uniforms.cameraPos.value.copy(camera.position);
  }
  if (sceneRef && sceneRef.fog) {
    waterMat.uniforms.fogColor.value.copy(sceneRef.fog.color);
  }
}

// ── Terrain shader per-frame update (haze + cloud shadows) ──
const _terrainSunDir = new THREE.Vector3();

export function updateTerrainShader(dt, windVector) {
  if (!terrainShaderRef) return;
  const u = terrainShaderRef.uniforms;

  // Accumulate time for cloud shadow drift
  terrainShaderTime += dt;
  u.uTime.value = terrainShaderTime;

  // Wind offset for cloud shadow movement (accumulated drift)
  const wx = windVector ? windVector.x * 0.32 : 0;
  const wz = windVector ? windVector.z * 0.32 : 0;
  u.uWindOffset.value.x += wx * dt;
  u.uWindOffset.value.y += wz * dt;

  // Sun direction and elevation
  _terrainSunDir.copy(getSunDirection());
  u.uSunDirection.value.copy(_terrainSunDir);

  const tod = getTimeOfDay();
  const sunElev = getSunElevation(tod);
  u.uSunElevation.value = sunElev;

  // Compute haze color to match current sky horizon
  const haze = u.uHazeColor.value;
  if (sunElev > 15) {
    // Day: blue-white horizon haze
    haze.set(0.62, 0.73, 0.87);
  } else if (sunElev > 2) {
    // Golden hour transition
    const t = (sunElev - 2) / 13;
    haze.set(
      0.85 + (0.62 - 0.85) * t,
      0.60 + (0.73 - 0.60) * t,
      0.45 + (0.87 - 0.45) * t
    );
  } else if (sunElev > -2) {
    // Sunset/sunrise: warm orange
    const t = (sunElev + 2) / 4;
    haze.set(
      0.55 + (0.85 - 0.55) * t,
      0.35 + (0.60 - 0.35) * t,
      0.35 + (0.45 - 0.35) * t
    );
  } else {
    // Night: dark blue-grey
    haze.set(0.12, 0.14, 0.22);
  }
}

// ── 3A. Power Lines Along Highway ──
export function createPowerLines(scene) {
  if (!highwaySamplePoints || highwaySamplePoints.length < 2) return;

  const dummy = new THREE.Object3D();
  const poleHeight = 12;
  const offset = 15; // meters from road center

  // Collect pole positions every ~80m along highway samples
  const polePositions = [];
  const step = Math.max(1, Math.round(80 / (highwaySamplePoints.length > 1
    ? highwaySamplePoints[0].distanceTo(highwaySamplePoints[1]) : 1)));

  for (let i = 0; i < highwaySamplePoints.length - 1; i += step) {
    const pt = highwaySamplePoints[i];
    const next = highwaySamplePoints[Math.min(i + step, highwaySamplePoints.length - 1)];
    if (pt.roadStructure !== 'open' || next.roadStructure !== 'open') continue;

    if (isNearAirport(pt.x, pt.z)) continue;
    if (isInCityZone(pt.x, pt.z)) continue;
    if (isInCapeTownZone(pt.x, pt.z)) continue;

    // Perpendicular direction (offset to one side)
    const dx = next.x - pt.x;
    const dz = next.z - pt.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const perpX = -dz / len;
    const perpZ = dx / len;

    const px = pt.x + perpX * offset;
    const pz = pt.z + perpZ * offset;
    // Use road-flattened height so poles follow the road, not raw mountains
    const h = getTerrainHeight(px, pz);

    polePositions.push({
      x: px, z: pz, h,
      topY: h + poleHeight,
      heading: Math.atan2(dx, dz),
    });
  }

  if (polePositions.length === 0) return;

  // Pole cylinders (InstancedMesh)
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, poleHeight, 5);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, polePositions.length);

  // Cross-arm boxes (InstancedMesh)
  const armGeo = new THREE.BoxGeometry(3, 0.15, 0.15);
  const armMesh = new THREE.InstancedMesh(armGeo, poleMat, polePositions.length);

  for (let i = 0; i < polePositions.length; i++) {
    const p = polePositions[i];
    // Pole
    dummy.position.set(p.x, p.h + poleHeight / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
    // Cross-arm at top
    dummy.position.set(p.x, p.topY, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.updateMatrix();
    armMesh.setMatrixAt(i, dummy.matrix);
  }

  scene.add(poleMesh);
  scene.add(armMesh);

  // Wires: 3 wires per span with catenary sag via LineSegments
  const wireVerts = [];
  const wireMat = new THREE.LineBasicMaterial({ color: 0x555555 });
  const wireOffsets = [-1, 0, 1]; // left/center/right on cross-arm
  const sag = 0.5;

  for (let i = 0; i < polePositions.length - 1; i++) {
    const a = polePositions[i];
    const b = polePositions[i + 1];
    // Skip if poles are too far apart or too different in elevation
    const spanDist = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
    if (spanDist > 200) continue;
    if (Math.abs(a.topY - b.topY) > 15) continue; // skip steep diagonal wires

    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    const midY = (a.topY + b.topY) / 2 - sag;

    for (const wo of wireOffsets) {
      // Offset along cross-arm direction
      const sinH = Math.sin(a.heading);
      const cosH = Math.cos(a.heading);
      const ox = sinH * wo;
      const oz = cosH * wo;

      // Pole A → midpoint
      wireVerts.push(a.x + ox, a.topY, a.z + oz);
      wireVerts.push(midX + ox, midY, midZ + oz);
      // Midpoint → Pole B
      wireVerts.push(midX + ox, midY, midZ + oz);
      wireVerts.push(b.x + ox, b.topY, b.z + oz);
    }
  }

  if (wireVerts.length > 0) {
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wireVerts, 3));
    const wireLines = new THREE.LineSegments(wireGeo, wireMat);
    scene.add(wireLines);
  }
}

// ── 3B. Cell Towers on Hilltops ──
export function createCellTowers(scene) {
  const dummy = new THREE.Object3D();
  const towerHeight = 25;
  const positions = [];

  for (let i = 0; i < 5000 && positions.length < 10; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 100) continue;
    // Ensure spacing from other towers
    let tooClose = false;
    for (const p of positions) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < 2000 * 2000) { tooClose = true; break; }
    }
    if (tooClose) continue;
    positions.push({ x, z, h });
  }

  if (positions.length === 0) return;

  // Tower cylinders
  const towerGeo = new THREE.CylinderGeometry(0.3, 0.3, towerHeight, 6);
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const towerMesh = new THREE.InstancedMesh(towerGeo, towerMat, positions.length);

  // Platforms (3 per tower)
  const platGeo = new THREE.BoxGeometry(3, 0.3, 3);
  const platMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  const platMesh = new THREE.InstancedMesh(platGeo, platMat, positions.length * 3);

  // Red obstruction lights
  const lightGeo = new THREE.SphereGeometry(0.4, 6, 4);
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.8 });
  const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, positions.length);

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    // Tower shaft
    dummy.position.set(p.x, p.h + towerHeight / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    towerMesh.setMatrixAt(i, dummy.matrix);

    // 3 platforms at 40%, 65%, 90% height
    const platHeights = [0.4, 0.65, 0.9];
    for (let j = 0; j < 3; j++) {
      dummy.position.set(p.x, p.h + towerHeight * platHeights[j], p.z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.updateMatrix();
      platMesh.setMatrixAt(i * 3 + j, dummy.matrix);
    }

    // Red light at top
    dummy.position.set(p.x, p.h + towerHeight + 0.4, p.z);
    dummy.updateMatrix();
    lightMesh.setMatrixAt(i, dummy.matrix);
  }

  scene.add(towerMesh);
  scene.add(platMesh);
  scene.add(lightMesh);
}

// ── 3C. Rest Stops Along Highway ──
export function createRestStops(scene) {
  if (!highwaySamplePoints || highwaySamplePoints.length < 20) return;

  const dummy = new THREE.Object3D();
  const positions = [];
  const candidateIndices = [Math.floor(highwaySamplePoints.length * 0.18), Math.floor(highwaySamplePoints.length * 0.42), Math.floor(highwaySamplePoints.length * 0.68)];

  for (const index of candidateIndices) {
    let pt = null;
    let next = null;
    for (let offset = 0; offset < 20 && !pt; offset++) {
      const a = highwaySamplePoints[Math.min(highwaySamplePoints.length - 2, index + offset)];
      const b = highwaySamplePoints[Math.min(highwaySamplePoints.length - 1, index + offset + 1)];
      if (a && b && a.roadStructure === 'open' && b.roadStructure === 'open') {
        pt = a;
        next = b;
      }
    }
    if (!pt || !next) continue;

    // Skip if near airport or city zones
    if (isNearAirport(pt.x, pt.z)) continue;
    if (isInCityZone(pt.x, pt.z)) continue;
    if (isInCapeTownZone(pt.x, pt.z)) continue;

    // Perpendicular offset (30m from road center)
    const tanX = next.x - pt.x;
    const tanZ = next.z - pt.z;
    const perpX = -tanZ;
    const perpZ = tanX;
    const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;
    const ox = (perpX / len) * 30;
    const oz = (perpZ / len) * 30;
    const x = pt.x + ox;
    const z = pt.z + oz;

    // Also check the offset position
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;

    const h = getTerrainHeight(x, z);
    const heading = Math.atan2(tanX, tanZ);
    positions.push({ x, z, h, heading });
  }

  if (positions.length === 0) return;

  // Building (10x4x8m)
  const bldgGeo = new THREE.BoxGeometry(10, 4, 8);
  const bldgMat = new THREE.MeshLambertMaterial({ color: 0xccccbb });
  const bldgMesh = new THREE.InstancedMesh(bldgGeo, bldgMat, positions.length);

  // Canopy (12x0.3x15m)
  const canopyGeo = new THREE.BoxGeometry(12, 0.3, 15);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, positions.length);

  // Canopy pillars (4 per stop)
  const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 3.5, 6);
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const pillarMesh = new THREE.InstancedMesh(pillarGeo, pillarMat, positions.length * 4);

  // Parking area
  const parkGeo = new THREE.PlaneGeometry(20, 18);
  const parkMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];

    // Building
    dummy.position.set(p.x, p.h + 2, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    bldgMesh.setMatrixAt(i, dummy.matrix);

    // Canopy offset from building
    const sinH = Math.sin(p.heading);
    const cosH = Math.cos(p.heading);
    const canopyOffX = sinH * 12;
    const canopyOffZ = cosH * 12;
    dummy.position.set(p.x + canopyOffX, p.h + 3.5, p.z + canopyOffZ);
    dummy.rotation.set(0, p.heading, 0);
    dummy.updateMatrix();
    canopyMesh.setMatrixAt(i, dummy.matrix);

    // 4 pillars under canopy corners
    const corners = [[-5, -6], [5, -6], [-5, 6], [5, 6]];
    for (let j = 0; j < 4; j++) {
      const cx = corners[j][0];
      const cz = corners[j][1];
      // Rotate corner offsets by heading
      const rx = cx * cosH - cz * sinH;
      const rz = cx * sinH + cz * cosH;
      dummy.position.set(
        p.x + canopyOffX + rx,
        p.h + 1.75,
        p.z + canopyOffZ + rz
      );
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pillarMesh.setMatrixAt(i * 4 + j, dummy.matrix);
    }

    // Parking lot (flat plane)
    const parkMesh = new THREE.Mesh(parkGeo, parkMat);
    parkMesh.rotation.x = -Math.PI / 2;
    parkMesh.rotation.z = -p.heading;
    parkMesh.position.set(p.x + canopyOffX, p.h + 0.15, p.z + canopyOffZ);
    parkMesh.receiveShadow = true;
    scene.add(parkMesh);
  }

  scene.add(bldgMesh);
  scene.add(canopyMesh);
  scene.add(pillarMesh);
}

// ── 3D. Small Ponds ──
export function createPonds(scene) {
  const positions = [];

  for (let i = 0; i < 3000 && positions.length < 8; i++) {
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.7;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.7;
    if (isNearAirport(x, z)) continue;
    if (isInCityZone(x, z)) continue;
    if (isInCapeTownZone(x, z)) continue;
    if (isNearRoad(x, z)) continue;
    const h = getTerrainHeight(x, z);
    if (h < 5 || h > 20) continue;
    // Check flatness: compare nearby samples
    const hN = getTerrainHeight(x, z + 10);
    const hS = getTerrainHeight(x, z - 10);
    const hE = getTerrainHeight(x + 10, z);
    const hW = getTerrainHeight(x - 10, z);
    const slope = Math.max(Math.abs(h - hN), Math.abs(h - hS), Math.abs(h - hE), Math.abs(h - hW));
    if (slope > 2) continue;
    // Ensure spacing from other ponds
    let tooClose = false;
    for (const p of positions) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < 200 * 200) { tooClose = true; break; }
    }
    if (tooClose) continue;
    positions.push({ x, z, h, radius: 15 + Math.random() * 15 });
  }

  const pondMat = new THREE.MeshLambertMaterial({
    color: 0x3a6e8f,
    transparent: true,
    opacity: 0.6,
  });

  for (const p of positions) {
    const geo = new THREE.CircleGeometry(p.radius, 24);
    const mesh = new THREE.Mesh(geo, pondMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, p.h + 0.1, p.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

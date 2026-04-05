// ── City Data Foundation ─────────────────────────────────────────────
// Pure data + logic module — NO Three.js imports.
// Drives road generation, building placement, traffic density, day/night.

// ── District definitions ────────────────────────────────────────────

export const DISTRICTS = [
  { type: 'downtown',    center: [4000, -4000], radius: 600,  priority: 1, density: 1.0, maxHeight: 90, traffic: 'heavy',       pedestrians: 'heavy',  blockSize: 80  },
  { type: 'commercial',  center: [4400, -3600], radius: 400,  priority: 2, density: 0.7, maxHeight: 45, traffic: 'medium',      pedestrians: 'medium', blockSize: 100 },
  { type: 'waterfront',  center: [4800, -3800], radius: 300,  priority: 3, density: 0.3, maxHeight: 12, traffic: 'light',       pedestrians: 'heavy',  blockSize: 120 },
  { type: 'industrial',  center: [4600, -4600], radius: 400,  priority: 4, density: 0.5, maxHeight: 20, traffic: 'heavy_truck', pedestrians: 'sparse', blockSize: 200 },
  { type: 'residential', center: [3500, -4300], radius: 600,  priority: 5, density: 0.4, maxHeight: 15, traffic: 'light',       pedestrians: 'light',  blockSize: 140 },
];

// ── City bounds ─────────────────────────────────────────────────────

export const CITY_BOUNDS = { minX: 3000, maxX: 5000, minZ: -5000, maxZ: -3000 };

const DEFAULT_DISTRICT = {
  type: 'residential',
  center: [0, 0],
  radius: 0,
  priority: 99,
  density: 0.2,
  maxHeight: 12,
  traffic: 'light',
  pedestrians: 'sparse',
  blockSize: 140,
};

/** Returns true if point is within the city footprint. */
export function isInCityBounds(x, z) {
  return x >= CITY_BOUNDS.minX && x <= CITY_BOUNDS.maxX &&
         z >= CITY_BOUNDS.minZ && z <= CITY_BOUNDS.maxZ;
}

/**
 * Returns the district with the lowest priority number that contains the point.
 * Returns null outside city bounds.
 * Returns a default residential district (priority 99, density 0.2) for areas
 * within bounds but not covered by any named district circle.
 */
export function getDistrictAt(x, z) {
  if (!isInCityBounds(x, z)) return null;

  let best = null;
  for (const d of DISTRICTS) {
    const dx = x - d.center[0];
    const dz = z - d.center[1];
    if (dx * dx + dz * dz <= d.radius * d.radius) {
      if (!best || d.priority < best.priority) {
        best = d;
      }
    }
  }

  return best || DEFAULT_DISTRICT;
}

// ── Building pools ──────────────────────────────────────────────────

export const BUILDING_POOLS = {
  downtown: [
    { name: 'office_tower', minH: 40, maxH: 90, style: 'glass',     setback: 2   },
    { name: 'hotel',        minH: 30, maxH: 70, style: 'glass',     setback: 3   },
    { name: 'bank',         minH: 20, maxH: 50, style: 'stone',     setback: 2.5 },
    { name: 'mixed_use',    minH: 20, maxH: 60, style: 'glass',     setback: 1.5 },
  ],
  commercial: [
    { name: 'retail',         minH: 6,  maxH: 12, style: 'storefront', setback: 1   },
    { name: 'restaurant',     minH: 6,  maxH: 10, style: 'storefront', setback: 1.5 },
    { name: 'parking_garage', minH: 10, maxH: 30, style: 'concrete',   setback: 2   },
    { name: 'mall',           minH: 8,  maxH: 20, style: 'storefront', setback: 3   },
  ],
  residential: [
    { name: 'house',     minH: 6,  maxH: 10, style: 'house',     setback: 4 },
    { name: 'apartment', minH: 10, maxH: 15, style: 'apartment', setback: 2 },
    { name: 'condo',     minH: 8,  maxH: 15, style: 'apartment', setback: 3 },
  ],
  industrial: [
    { name: 'warehouse',    minH: 6,  maxH: 14, style: 'metal',    setback: 5 },
    { name: 'factory',      minH: 8,  maxH: 20, style: 'concrete', setback: 4 },
    { name: 'silo',         minH: 10, maxH: 18, style: 'metal',    setback: 3 },
    { name: 'loading_dock', minH: 6,  maxH: 10, style: 'concrete', setback: 6 },
  ],
  waterfront: [
    { name: 'cafe',           minH: 4,  maxH: 8,  style: 'nautical', setback: 1.5 },
    { name: 'marina_office',  minH: 5,  maxH: 10, style: 'nautical', setback: 2   },
    { name: 'boardwalk_shop', minH: 4,  maxH: 7,  style: 'nautical', setback: 1   },
  ],
};

// ── Activity schedules (24-element hourly arrays) ───────────────────
// Index 0 = midnight (00:00), index 23 = 11pm (23:00).
// Each schedule holds { traffic, pedestrian, window, inbound } values per hour.

const ACTIVITY_SCHEDULES = {
  downtown: {
    //                  0     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16    17    18    19    20    21    22    23
    traffic:     [0.05, 0.03, 0.02, 0.02, 0.03, 0.10, 0.30, 0.70, 1.00, 0.90, 0.85, 0.80, 0.85, 0.80, 0.85, 0.90, 1.00, 0.80, 0.50, 0.30, 0.20, 0.15, 0.10, 0.07],
    pedestrian:  [0.05, 0.03, 0.02, 0.02, 0.03, 0.05, 0.15, 0.50, 0.80, 0.90, 0.85, 0.90, 1.00, 0.90, 0.85, 0.80, 0.70, 0.50, 0.30, 0.20, 0.15, 0.10, 0.07, 0.05],
    window:      [0.15, 0.12, 0.10, 0.10, 0.10, 0.12, 0.20, 0.50, 0.80, 0.90, 0.95, 1.00, 1.00, 1.00, 0.95, 0.90, 0.85, 0.70, 0.50, 0.35, 0.25, 0.20, 0.18, 0.15],
    inbound:     [0.10, 0.05, 0.05, 0.05, 0.05, 0.20, 0.60, 2.00, 3.00, 1.50, 0.80, 0.60, 0.50, 0.50, 0.50, 0.60, 0.80, 0.40, 0.20, 0.15, 0.10, 0.10, 0.10, 0.10],
  },
  commercial: {
    traffic:     [0.03, 0.02, 0.02, 0.02, 0.02, 0.05, 0.15, 0.40, 0.60, 0.70, 0.80, 0.90, 1.00, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.40, 0.25, 0.10, 0.05],
    pedestrian:  [0.02, 0.02, 0.01, 0.01, 0.01, 0.03, 0.10, 0.30, 0.50, 0.60, 0.75, 0.85, 1.00, 0.90, 0.80, 0.75, 0.70, 0.65, 0.70, 0.75, 0.50, 0.30, 0.10, 0.05],
    window:      [0.10, 0.08, 0.06, 0.06, 0.06, 0.08, 0.15, 0.40, 0.70, 0.85, 0.95, 1.00, 1.00, 1.00, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.50, 0.30, 0.15, 0.10],
    inbound:     [0.10, 0.05, 0.05, 0.05, 0.05, 0.10, 0.30, 0.80, 1.20, 1.00, 0.80, 0.70, 0.60, 0.60, 0.60, 0.70, 0.80, 0.60, 0.50, 0.40, 0.20, 0.15, 0.10, 0.10],
  },
  residential: {
    traffic:     [0.05, 0.03, 0.02, 0.02, 0.03, 0.10, 0.40, 0.80, 0.60, 0.30, 0.25, 0.20, 0.20, 0.20, 0.25, 0.35, 0.60, 0.90, 1.00, 0.70, 0.40, 0.20, 0.10, 0.07],
    pedestrian:  [0.05, 0.03, 0.02, 0.02, 0.02, 0.05, 0.15, 0.40, 0.30, 0.25, 0.20, 0.20, 0.20, 0.20, 0.25, 0.35, 0.50, 0.70, 0.80, 1.00, 0.60, 0.30, 0.15, 0.08],
    window:      [0.30, 0.20, 0.15, 0.12, 0.12, 0.15, 0.30, 0.50, 0.30, 0.20, 0.15, 0.15, 0.15, 0.15, 0.15, 0.20, 0.35, 0.60, 0.80, 0.90, 1.00, 0.90, 0.60, 0.40],
    inbound:     [0.10, 0.05, 0.05, 0.05, 0.05, 0.10, 0.20, 0.30, 0.20, 0.15, 0.10, 0.10, 0.10, 0.10, 0.15, 0.30, 0.70, 1.50, 2.50, 1.50, 0.60, 0.30, 0.15, 0.10],
  },
  industrial: {
    traffic:     [0.03, 0.02, 0.02, 0.02, 0.03, 0.15, 0.60, 0.90, 1.00, 0.90, 0.85, 0.80, 0.75, 0.80, 0.85, 0.70, 0.40, 0.15, 0.08, 0.05, 0.04, 0.03, 0.03, 0.03],
    pedestrian:  [0.01, 0.01, 0.01, 0.01, 0.01, 0.05, 0.20, 0.40, 0.50, 0.45, 0.40, 0.35, 0.40, 0.35, 0.35, 0.30, 0.15, 0.05, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01],
    window:      [0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.40, 0.70, 0.90, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.80, 0.40, 0.15, 0.08, 0.05, 0.05, 0.05, 0.05, 0.05],
    inbound:     [0.05, 0.05, 0.05, 0.05, 0.10, 0.40, 1.50, 2.00, 1.00, 0.50, 0.30, 0.30, 0.30, 0.30, 0.30, 0.50, 0.30, 0.10, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
  },
  waterfront: {
    traffic:     [0.02, 0.02, 0.01, 0.01, 0.01, 0.03, 0.08, 0.15, 0.25, 0.30, 0.35, 0.40, 0.50, 0.50, 0.55, 0.60, 0.70, 0.85, 1.00, 0.90, 0.70, 0.40, 0.15, 0.05],
    pedestrian:  [0.03, 0.02, 0.01, 0.01, 0.01, 0.02, 0.05, 0.15, 0.25, 0.35, 0.40, 0.50, 0.60, 0.60, 0.60, 0.65, 0.75, 0.90, 1.00, 0.95, 0.70, 0.40, 0.15, 0.05],
    window:      [0.15, 0.10, 0.08, 0.08, 0.08, 0.08, 0.10, 0.20, 0.35, 0.45, 0.55, 0.65, 0.70, 0.70, 0.70, 0.75, 0.80, 0.90, 1.00, 0.95, 0.80, 0.50, 0.25, 0.15],
    inbound:     [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.20, 0.30, 0.40, 0.40, 0.50, 0.60, 0.60, 0.60, 0.70, 0.90, 1.20, 1.50, 1.00, 0.50, 0.20, 0.10, 0.05],
  },
};

/**
 * Linearly interpolate an hourly schedule at a fractional hour.
 * @param {number[]} arr  24-element array
 * @param {number} t      time of day in hours [0, 24)
 */
function lerpSchedule(arr, t) {
  const clamped = ((t % 24) + 24) % 24; // wrap into [0, 24)
  const lo = Math.floor(clamped) % 24;
  const hi = (lo + 1) % 24;
  const frac = clamped - Math.floor(clamped);
  return arr[lo] + (arr[hi] - arr[lo]) * frac;
}

/**
 * Returns activity multipliers for a district at a given time of day.
 * @param {string} districtType  one of 'downtown','commercial','residential','industrial','waterfront'
 * @param {number} timeOfDay     hours in [0, 24)
 * @returns {{ trafficMultiplier: number, pedestrianDensity: number, windowEmissive: number, inboundMultiplier: number }}
 */
export function getActivityMultiplier(districtType, timeOfDay) {
  const schedule = ACTIVITY_SCHEDULES[districtType] || ACTIVITY_SCHEDULES.residential;
  return {
    trafficMultiplier: lerpSchedule(schedule.traffic, timeOfDay),
    pedestrianDensity: lerpSchedule(schedule.pedestrian, timeOfDay),
    windowEmissive:    lerpSchedule(schedule.window, timeOfDay),
    inboundMultiplier: lerpSchedule(schedule.inbound, timeOfDay),
  };
}

// ── Vehicle types ───────────────────────────────────────────────────

export const VEHICLE_TYPES = {
  sedan: {
    speed: { min: 8, max: 16 },       // m/s
    acceleration: 3.5,                 // m/s²
    length: 4.5,
    width: 1.8,
    height: 1.4,
    districtPrefs: ['residential', 'commercial', 'downtown'],
    special: null,
  },
  suv: {
    speed: { min: 8, max: 15 },
    acceleration: 3.0,
    length: 5.0,
    width: 2.0,
    height: 1.8,
    districtPrefs: ['residential', 'commercial'],
    special: null,
  },
  truck: {
    speed: { min: 6, max: 12 },
    acceleration: 2.0,
    length: 6.0,
    width: 2.2,
    height: 2.5,
    districtPrefs: ['industrial', 'commercial'],
    special: null,
  },
  semi: {
    speed: { min: 5, max: 10 },
    acceleration: 1.2,
    length: 12.0,
    width: 2.5,
    height: 3.5,
    districtPrefs: ['industrial'],
    special: { wideLoad: true, noUTurn: true },
  },
  bus: {
    speed: { min: 6, max: 12 },
    acceleration: 1.8,
    length: 10.0,
    width: 2.5,
    height: 3.2,
    districtPrefs: ['downtown', 'commercial', 'residential'],
    special: { stopsAtBusStops: true },
  },
  taxi: {
    speed: { min: 8, max: 16 },
    acceleration: 3.5,
    length: 4.6,
    width: 1.8,
    height: 1.5,
    districtPrefs: ['downtown', 'commercial', 'waterfront'],
    special: { stopsForPassengers: true },
  },
  emergency: {
    speed: { min: 10, max: 22 },
    acceleration: 5.0,
    length: 5.5,
    width: 2.0,
    height: 2.2,
    districtPrefs: ['downtown', 'commercial', 'residential', 'industrial', 'waterfront'],
    special: { lightsAndSiren: true, ignoresTrafficLights: true },
  },
  construction: {
    speed: { min: 3, max: 8 },
    acceleration: 1.5,
    length: 7.0,
    width: 2.5,
    height: 3.0,
    districtPrefs: ['industrial'],
    special: { hazardLights: true },
  },
};

// ── Population caps ─────────────────────────────────────────────────

export const MAX_ACTIVE_VEHICLES = 120;
export const MAX_PEDESTRIANS = 100;

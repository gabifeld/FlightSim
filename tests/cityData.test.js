import { describe, it, expect } from 'vitest';
import {
  DISTRICTS,
  CITY_BOUNDS,
  isInCityBounds,
  getDistrictAt,
  BUILDING_POOLS,
  getActivityMultiplier,
  VEHICLE_TYPES,
  MAX_ACTIVE_VEHICLES,
  MAX_PEDESTRIANS,
} from '../src/cityData.js';

// ── DISTRICTS ───────────────────────────────────────────────────────

describe('DISTRICTS', () => {
  it('has exactly 5 entries', () => {
    expect(DISTRICTS).toHaveLength(5);
  });

  it('each entry has all required fields', () => {
    const required = ['type', 'center', 'radius', 'priority', 'density', 'maxHeight', 'traffic', 'pedestrians', 'blockSize'];
    for (const d of DISTRICTS) {
      for (const field of required) {
        expect(d).toHaveProperty(field);
      }
      expect(d.center).toHaveLength(2);
      expect(typeof d.center[0]).toBe('number');
      expect(typeof d.center[1]).toBe('number');
      expect(d.radius).toBeGreaterThan(0);
      expect(d.density).toBeGreaterThan(0);
      expect(d.density).toBeLessThanOrEqual(1);
      expect(d.maxHeight).toBeGreaterThan(0);
      expect(d.blockSize).toBeGreaterThan(0);
    }
  });

  it('has unique priority numbers', () => {
    const priorities = DISTRICTS.map(d => d.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('contains the expected district types', () => {
    const types = DISTRICTS.map(d => d.type).sort();
    expect(types).toEqual(['commercial', 'downtown', 'industrial', 'residential', 'waterfront']);
  });
});

// ── isInCityBounds ──────────────────────────────────────────────────

describe('isInCityBounds', () => {
  it('returns true for the city center', () => {
    expect(isInCityBounds(4000, -4000)).toBe(true);
  });

  it('returns true for points on the boundary edges', () => {
    expect(isInCityBounds(CITY_BOUNDS.minX, CITY_BOUNDS.minZ)).toBe(true);
    expect(isInCityBounds(CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ)).toBe(true);
  });

  it('returns false for points outside bounds', () => {
    expect(isInCityBounds(0, 0)).toBe(false);
    expect(isInCityBounds(2999, -4000)).toBe(false);
    expect(isInCityBounds(5001, -4000)).toBe(false);
    expect(isInCityBounds(4000, -2999)).toBe(false);
    expect(isInCityBounds(4000, -5001)).toBe(false);
  });
});

// ── getDistrictAt ───────────────────────────────────────────────────

describe('getDistrictAt', () => {
  it('returns the correct district at each district center', () => {
    // Some district centers overlap with higher-priority districts.
    // We check that we get either the expected district itself or a
    // higher-priority one that also contains the point.
    for (const d of DISTRICTS) {
      const result = getDistrictAt(d.center[0], d.center[1]);
      expect(result).not.toBeNull();
      // Must be this district or one with higher priority (lower number)
      expect(result.priority).toBeLessThanOrEqual(d.priority);
    }
    // Verify downtown center returns downtown specifically
    const dt = getDistrictAt(4000, -4000);
    expect(dt.type).toBe('downtown');
    // Verify districts that don't overlap with higher-priority ones
    const ind = getDistrictAt(4600, -4600);
    expect(ind.type).toBe('industrial');
    // Waterfront center (4800, -3800): dist from downtown = sqrt(800^2+200^2) = ~825 > 600
    const wf = getDistrictAt(4800, -3800);
    expect(wf.type).toBe('waterfront');
  });

  it('returns downtown (priority 1) in overlap zones where downtown also covers', () => {
    // Point near downtown center but potentially within range of others
    const result = getDistrictAt(4000, -4000);
    expect(result.type).toBe('downtown');
    expect(result.priority).toBe(1);
  });

  it('prefers lower priority in overlap between two non-downtown districts', () => {
    // If a point is within two district radii, the lower priority wins
    // Commercial (center 4400,-3600 r=400) has priority 2
    // Test a point that might be in both commercial and waterfront overlap
    // The commercial center itself should always return commercial
    const result = getDistrictAt(4400, -3600);
    expect(result.priority).toBeLessThanOrEqual(2);
  });

  it('returns default residential for uncovered areas within bounds', () => {
    // A corner of the city bounds far from any district center
    const result = getDistrictAt(3050, -3050);
    expect(result).not.toBeNull();
    expect(result.priority).toBe(99);
    expect(result.density).toBe(0.2);
    expect(result.type).toBe('residential');
  });

  it('returns null outside city bounds', () => {
    expect(getDistrictAt(0, 0)).toBeNull();
    expect(getDistrictAt(10000, 10000)).toBeNull();
    expect(getDistrictAt(2500, -4000)).toBeNull();
  });

  it('returns a district with all required fields for default district', () => {
    const result = getDistrictAt(3050, -3050);
    const required = ['type', 'center', 'radius', 'priority', 'density', 'maxHeight', 'traffic', 'pedestrians', 'blockSize'];
    for (const field of required) {
      expect(result).toHaveProperty(field);
    }
  });
});

// ── getActivityMultiplier ───────────────────────────────────────────

describe('getActivityMultiplier', () => {
  const allTypes = ['downtown', 'commercial', 'residential', 'industrial', 'waterfront'];

  it('returns an object with all required fields', () => {
    for (const type of allTypes) {
      const m = getActivityMultiplier(type, 12);
      expect(m).toHaveProperty('trafficMultiplier');
      expect(m).toHaveProperty('pedestrianDensity');
      expect(m).toHaveProperty('windowEmissive');
      expect(m).toHaveProperty('inboundMultiplier');
    }
  });

  it('returns sensible values — traffic > 0, windows in [0, 1]', () => {
    for (const type of allTypes) {
      for (let h = 0; h < 24; h++) {
        const m = getActivityMultiplier(type, h);
        expect(m.trafficMultiplier).toBeGreaterThanOrEqual(0);
        expect(m.pedestrianDensity).toBeGreaterThanOrEqual(0);
        expect(m.windowEmissive).toBeGreaterThanOrEqual(0);
        expect(m.windowEmissive).toBeLessThanOrEqual(1);
        expect(m.inboundMultiplier).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('interpolates smoothly between hours', () => {
    const m1 = getActivityMultiplier('downtown', 8.0);
    const m2 = getActivityMultiplier('downtown', 8.5);
    const m3 = getActivityMultiplier('downtown', 9.0);
    // m2 should be between m1 and m3 (or equal to one if they're the same)
    // Just verify it's a reasonable midpoint
    expect(m2.trafficMultiplier).toBeGreaterThanOrEqual(Math.min(m1.trafficMultiplier, m3.trafficMultiplier));
    expect(m2.trafficMultiplier).toBeLessThanOrEqual(Math.max(m1.trafficMultiplier, m3.trafficMultiplier));
  });

  it('downtown has high traffic at midday, low at night', () => {
    const midday = getActivityMultiplier('downtown', 12);
    const night = getActivityMultiplier('downtown', 3);
    expect(midday.trafficMultiplier).toBeGreaterThan(night.trafficMultiplier * 5);
  });

  it('downtown has strong morning inbound rush (~3x at 8am)', () => {
    const morning = getActivityMultiplier('downtown', 8);
    expect(morning.inboundMultiplier).toBeGreaterThanOrEqual(2.5);
  });

  it('residential has high inbound multiplier in evening (returning commuters)', () => {
    const evening = getActivityMultiplier('residential', 18);
    const midday = getActivityMultiplier('residential', 12);
    expect(evening.inboundMultiplier).toBeGreaterThan(midday.inboundMultiplier * 3);
  });

  it('industrial is busy during day shift (6am-4pm) and dead at night', () => {
    const dayShift = getActivityMultiplier('industrial', 10);
    const night = getActivityMultiplier('industrial', 22);
    expect(dayShift.trafficMultiplier).toBeGreaterThan(night.trafficMultiplier * 5);
  });

  it('waterfront peaks in evening hours', () => {
    const evening = getActivityMultiplier('waterfront', 18);
    const morning = getActivityMultiplier('waterfront', 7);
    expect(evening.trafficMultiplier).toBeGreaterThan(morning.trafficMultiplier);
    expect(evening.pedestrianDensity).toBeGreaterThan(morning.pedestrianDensity);
  });

  it('handles fractional hours and wrapping around midnight', () => {
    const m1 = getActivityMultiplier('downtown', 23.5);
    expect(m1.trafficMultiplier).toBeGreaterThanOrEqual(0);
    // Should not crash on edge values
    const m2 = getActivityMultiplier('downtown', 0);
    expect(m2.trafficMultiplier).toBeGreaterThanOrEqual(0);
    const m3 = getActivityMultiplier('downtown', 24);
    expect(m3.trafficMultiplier).toBeGreaterThanOrEqual(0);
  });

  it('falls back to residential schedule for unknown district type', () => {
    const unknown = getActivityMultiplier('nonexistent', 12);
    const residential = getActivityMultiplier('residential', 12);
    expect(unknown.trafficMultiplier).toBe(residential.trafficMultiplier);
  });
});

// ── BUILDING_POOLS ──────────────────────────────────────────────────

describe('BUILDING_POOLS', () => {
  it('has entries for every district type', () => {
    const districtTypes = DISTRICTS.map(d => d.type);
    for (const type of districtTypes) {
      expect(BUILDING_POOLS).toHaveProperty(type);
      expect(Array.isArray(BUILDING_POOLS[type])).toBe(true);
      expect(BUILDING_POOLS[type].length).toBeGreaterThan(0);
    }
  });

  it('each building pool entry has required fields', () => {
    for (const [type, pool] of Object.entries(BUILDING_POOLS)) {
      for (const bldg of pool) {
        expect(bldg).toHaveProperty('name');
        expect(bldg).toHaveProperty('minH');
        expect(bldg).toHaveProperty('maxH');
        expect(bldg).toHaveProperty('style');
        expect(bldg).toHaveProperty('setback');
        expect(typeof bldg.name).toBe('string');
        expect(bldg.minH).toBeGreaterThan(0);
        expect(bldg.maxH).toBeGreaterThanOrEqual(bldg.minH);
        expect(typeof bldg.style).toBe('string');
        expect(bldg.setback).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('downtown buildings have glass/stone styles and tall heights', () => {
    for (const bldg of BUILDING_POOLS.downtown) {
      expect(['glass', 'stone']).toContain(bldg.style);
      expect(bldg.maxH).toBeGreaterThanOrEqual(20);
    }
  });

  it('waterfront buildings are small with nautical style', () => {
    for (const bldg of BUILDING_POOLS.waterfront) {
      expect(bldg.style).toBe('nautical');
      expect(bldg.maxH).toBeLessThanOrEqual(10);
    }
  });
});

// ── VEHICLE_TYPES ───────────────────────────────────────────────────

describe('VEHICLE_TYPES', () => {
  const expectedTypes = ['sedan', 'suv', 'truck', 'semi', 'bus', 'taxi', 'emergency', 'construction'];

  it('has all expected vehicle types', () => {
    for (const type of expectedTypes) {
      expect(VEHICLE_TYPES).toHaveProperty(type);
    }
  });

  it('each type has speed ranges, acceleration, dimensions, and district preferences', () => {
    for (const [name, vt] of Object.entries(VEHICLE_TYPES)) {
      expect(vt.speed).toHaveProperty('min');
      expect(vt.speed).toHaveProperty('max');
      expect(vt.speed.max).toBeGreaterThan(vt.speed.min);
      expect(vt.acceleration).toBeGreaterThan(0);
      expect(vt.length).toBeGreaterThan(0);
      expect(vt.width).toBeGreaterThan(0);
      expect(vt.height).toBeGreaterThan(0);
      expect(Array.isArray(vt.districtPrefs)).toBe(true);
      expect(vt.districtPrefs.length).toBeGreaterThan(0);
    }
  });

  it('emergency vehicles have lights and siren special behavior', () => {
    expect(VEHICLE_TYPES.emergency.special).toBeTruthy();
    expect(VEHICLE_TYPES.emergency.special.lightsAndSiren).toBe(true);
  });

  it('semi trucks cannot make U-turns', () => {
    expect(VEHICLE_TYPES.semi.special).toBeTruthy();
    expect(VEHICLE_TYPES.semi.special.noUTurn).toBe(true);
  });
});

// ── Population caps ─────────────────────────────────────────────────

describe('Population caps', () => {
  it('MAX_ACTIVE_VEHICLES is 120', () => {
    expect(MAX_ACTIVE_VEHICLES).toBe(120);
  });

  it('MAX_PEDESTRIANS is 100', () => {
    expect(MAX_PEDESTRIANS).toBe(100);
  });
});

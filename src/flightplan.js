// Waypoint-based flight planning with auto-sequencing
// Provides LNAV cross-track error and VNAV target VS

import { clamp } from './utils.js';
import { MS_TO_KNOTS, M_TO_FEET } from './constants.js';
import { getActiveVehicle } from './vehicleState.js';
import {
  computeBearing, computeDistance, computeDistanceNM,
  getAllNavaids,
} from './navdata.js';
import { AIRPORTS, getAirportByICAO } from './airportData.js';

// ---- Constants ----
const NM_TO_M = 1852;
const SEQUENCE_DIST_M = 1000; // distance threshold for auto-sequencing

// ---- Flight plan state ----
const fpState = {
  waypoints: [],    // { name, x, z, altitude (optional, meters), type: 'navaid'|'airport'|'custom' }
  activeIndex: 0,
  autoSequence: true,
};

// Computed values (updated each frame)
const computed = {
  desiredTrack: 0,      // degrees
  crossTrackError: 0,   // meters, positive = right of course
  bearingToActive: 0,   // degrees
  distanceToActive: 0,  // meters
  distanceToActiveNM: 0,
  vnavTargetVS: null,   // ft/min or null
};

// Previous distance for divergence detection
let _prevDistToActive = Infinity;

// ---- Helpers ----

/** Normalize angle to 0..360 */
function normAngle360(deg) {
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return deg;
}

/** Normalize angle to -180..+180 */
function normAngle180(deg) {
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

// ---- Auto-sequencing logic ----

function checkAutoSequence(vehicle) {
  if (!fpState.autoSequence) return;
  if (fpState.waypoints.length === 0) return;
  if (fpState.activeIndex >= fpState.waypoints.length) return;

  const wp = fpState.waypoints[fpState.activeIndex];
  const px = vehicle.position.x;
  const pz = vehicle.position.z;

  const dist = computeDistance(px, pz, wp.x, wp.z);

  // Check if close enough and diverging (moving away)
  if (dist < SEQUENCE_DIST_M && dist > _prevDistToActive) {
    // Aircraft has passed abeam the waypoint — advance
    if (fpState.activeIndex < fpState.waypoints.length - 1) {
      fpState.activeIndex++;
      _prevDistToActive = Infinity;
      return;
    }
  }

  // Alternative: perpendicular pass test when there is a next waypoint
  if (fpState.activeIndex < fpState.waypoints.length - 1) {
    const next = fpState.waypoints[fpState.activeIndex + 1];
    // Vector from active to next
    const ax = next.x - wp.x;
    const az = next.z - wp.z;
    // Vector from active to aircraft
    const bx = px - wp.x;
    const bz = pz - wp.z;
    // Dot product: positive means aircraft is past the waypoint toward next
    const dot = ax * bx + az * bz;
    if (dot > 0 && dist < SEQUENCE_DIST_M * 2) {
      fpState.activeIndex++;
      _prevDistToActive = Infinity;
      return;
    }
  }

  _prevDistToActive = dist;
}

// ---- Compute flight plan data ----

function computeFlightPlanData(vehicle) {
  if (fpState.waypoints.length === 0 || fpState.activeIndex >= fpState.waypoints.length) {
    computed.desiredTrack = 0;
    computed.crossTrackError = 0;
    computed.bearingToActive = 0;
    computed.distanceToActive = 0;
    computed.distanceToActiveNM = 0;
    computed.vnavTargetVS = null;
    return;
  }

  const px = vehicle.position.x;
  const pz = vehicle.position.z;
  const py = vehicle.position.y || 0;

  const activeWP = fpState.waypoints[fpState.activeIndex];

  // Bearing and distance to active waypoint
  computed.bearingToActive = computeBearing(px, pz, activeWP.x, activeWP.z);
  computed.distanceToActive = computeDistance(px, pz, activeWP.x, activeWP.z);
  computed.distanceToActiveNM = computed.distanceToActive / NM_TO_M;

  // Desired track: from previous waypoint (or aircraft) to active waypoint
  let fromX, fromZ;
  if (fpState.activeIndex > 0) {
    const prev = fpState.waypoints[fpState.activeIndex - 1];
    fromX = prev.x;
    fromZ = prev.z;
  } else {
    // First waypoint — desired track is direct from aircraft
    fromX = px;
    fromZ = pz;
  }

  computed.desiredTrack = computeBearing(fromX, fromZ, activeWP.x, activeWP.z);

  // Cross-track error
  // Line from A (from-point) to B (active waypoint), aircraft at P
  const ax = fromX;
  const az = fromZ;
  const bx = activeWP.x;
  const bz = activeWP.z;

  const abDist = computeDistance(ax, az, bx, bz);
  if (abDist > 0.1) {
    // crossTrack = ((B.z - A.z) * (A.x - P.x) - (B.x - A.x) * (A.z - P.z)) / dist(A,B)
    // Positive = right of course
    computed.crossTrackError = ((bz - az) * (ax - px) - (bx - ax) * (az - pz)) / abDist;
  } else {
    computed.crossTrackError = 0;
  }

  // VNAV: compute target VS if next waypoint has altitude constraint
  computed.vnavTargetVS = null;

  // Look ahead for altitude constraints
  for (let i = fpState.activeIndex; i < fpState.waypoints.length; i++) {
    const wp = fpState.waypoints[i];
    if (wp.altitude != null) {
      const wpDist = computeDistance(px, pz, wp.x, wp.z);
      // Ground speed in m/s
      const gs = vehicle.speed || 0;
      if (gs > 1 && wpDist > 10) {
        const timeToWP = wpDist / gs; // seconds
        const altDiffM = wp.altitude - py;
        const altDiffFt = altDiffM * M_TO_FEET;
        const timeMin = timeToWP / 60;
        if (timeMin > 0) {
          computed.vnavTargetVS = altDiffFt / timeMin; // ft/min
        }
      }
      break; // use first constraint found
    }
  }
}

// ---- Public API ----

export function initFlightPlan() {
  fpState.waypoints = [];
  fpState.activeIndex = 0;
  fpState.autoSequence = true;
  _prevDistToActive = Infinity;
}

export function updateFlightPlan(dt) {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  checkAutoSequence(vehicle);
  computeFlightPlanData(vehicle);
}

export function addWaypoint(waypoint) {
  fpState.waypoints.push({
    name: waypoint.name || 'WPT',
    x: waypoint.x,
    z: waypoint.z,
    altitude: waypoint.altitude != null ? waypoint.altitude : null,
    type: waypoint.type || 'custom',
  });
}

export function addNavaidWaypoint(navaidId) {
  const upperID = navaidId.toUpperCase();
  const navaids = getAllNavaids();
  // Find first navaid matching the id (prefer VOR over NDB over others)
  let best = null;
  for (const n of navaids) {
    if (n.id.toUpperCase() === upperID) {
      if (!best || (n.type === 'VOR' && best.type !== 'VOR')) {
        best = n;
      }
    }
  }
  if (best) {
    addWaypoint({
      name: best.id,
      x: best.x,
      z: best.z,
      altitude: null,
      type: 'navaid',
    });
    return true;
  }
  return false;
}

export function addAirportWaypoint(icao) {
  const apt = getAirportByICAO(icao);
  if (apt) {
    addWaypoint({
      name: apt.icao,
      x: apt.x,
      z: apt.z,
      altitude: apt.elevation || 0,
      type: 'airport',
    });
    return true;
  }
  return false;
}

export function removeWaypoint(index) {
  if (index < 0 || index >= fpState.waypoints.length) return;
  fpState.waypoints.splice(index, 1);
  // Adjust active index
  if (fpState.activeIndex >= fpState.waypoints.length) {
    fpState.activeIndex = Math.max(0, fpState.waypoints.length - 1);
  }
  _prevDistToActive = Infinity;
}

export function clearFlightPlan() {
  fpState.waypoints = [];
  fpState.activeIndex = 0;
  _prevDistToActive = Infinity;
}

export function getFlightPlan() {
  return { waypoints: fpState.waypoints, activeIndex: fpState.activeIndex };
}

export function getActiveWaypoint() {
  if (fpState.waypoints.length === 0 || fpState.activeIndex >= fpState.waypoints.length) return null;
  return fpState.waypoints[fpState.activeIndex];
}

export function getNextWaypoint() {
  const nextIdx = fpState.activeIndex + 1;
  if (nextIdx >= fpState.waypoints.length) return null;
  return fpState.waypoints[nextIdx];
}

export function getDesiredTrack() {
  return computed.desiredTrack;
}

export function getCrossTrackError() {
  return computed.crossTrackError;
}

export function getBearingToActive() {
  return computed.bearingToActive;
}

export function getDistanceToActive() {
  return computed.distanceToActive;
}

export function getDistanceToActiveNM() {
  return computed.distanceToActiveNM;
}

export function getVNAVTargetVS() {
  return computed.vnavTargetVS;
}

export function activateDirectTo(index) {
  if (index < 0 || index >= fpState.waypoints.length) return;
  fpState.activeIndex = index;
  _prevDistToActive = Infinity;
}

export function isFlightPlanActive() {
  return fpState.waypoints.length > 0;
}

export function getFlightPlanRoute() {
  return fpState.waypoints.map(wp => ({ name: wp.name, x: wp.x, z: wp.z }));
}

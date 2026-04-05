// Enhanced ATC — clearance state machine, background chatter, ATIS.
// Non-punitive: player can ignore all instructions. Just immersive callouts.

import { showMessage } from './hud.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { getSetting } from './settings.js';
import { RUNWAY_WIDTH, RUNWAY_LENGTH, MS_TO_KNOTS, AIRPORT2_X, AIRPORT2_Z } from './constants.js';
import { isOnTaxiway } from './taxi.js';
import { getNearestAirport, AIRPORTS } from './airportData.js';
import { getCurrentPreset, WEATHER_PRESETS } from './weatherFx.js';

// ============================================================
// Core state
// ============================================================

let lastCallout = '';
let calloutCooldown = 0;
let prevOnGround = true;
let prevOnRunway = false;
let hasAnnouncedTakeoff = false;
let hasAnnouncedLanding = false;
let approachAnnounced = false;

// ============================================================
// Clearance state machine
// ============================================================

const ClearanceState = {
  PARKED: 'PARKED',
  TAXI_OUT: 'TAXI_OUT',
  HOLD_SHORT: 'HOLD_SHORT',
  CLEARED_TAKEOFF: 'CLEARED_TAKEOFF',
  AIRBORNE: 'AIRBORNE',
  APPROACH: 'APPROACH',
  CLEARED_LAND: 'CLEARED_LAND',
  LANDED: 'LANDED',
  TAXI_IN: 'TAXI_IN',
};

let clearanceState = ClearanceState.PARKED;
let landedTimer = 0; // seconds since LANDED state entered
let taxiInAnnounced = false; // whether "taxi to gate" has been said

// ============================================================
// Background chatter
// ============================================================

let chatterTimer = 0;
let nextChatterInterval = 0;

const CHATTER_TEMPLATES = [
  '[cs], turn left heading [hdg]',
  '[cs], turn right heading [hdg], descend and maintain [alt]',
  '[cs], climb and maintain flight level [fl]',
  '[cs], contact approach on [freq]',
  '[cs], radar contact, resume own navigation',
  '[cs], cleared direct [fix], maintain [alt]',
  '[cs], reduce speed to [spd] knots',
  '[cs], traffic twelve o\'clock, [dist] miles, opposite direction',
  '[cs], descend and maintain [alt], expect ILS runway [rwy]',
  '[cs], maintain present heading, vectors for runway [rwy]',
  '[cs], cleared ILS approach runway [rwy]',
  '[cs], squawk [squawk]',
  '[cs], wind [wdir] at [wspd], cleared to land runway [rwy]',
  '[cs], hold short runway [rwy], traffic on final',
  '[cs], cross runway [rwy], report clear',
];

// ============================================================
// ATC display
// ============================================================

let atcDisplayMsg = '';
let atcDisplayTimer = 0;
let atcDisplayOpacity = 1.0;
let atcIsChatter = false; // whether current display is background chatter

// ============================================================
// Helpers
// ============================================================

function atcEnabled() {
  return getSetting('atcEnabled') !== false;
}

function isOnRunway(x, z) {
  for (const apt of AIRPORTS) {
    const rwy = apt.runways[0];
    const halfLen = rwy.length / 2;
    const halfWid = rwy.width / 2;
    if (Math.abs(x - apt.x) < halfWid + 5 && Math.abs(z - apt.z) < halfLen) return true;
  }
  return false;
}

function nearestAirport(x, z) {
  return getNearestAirport(x, z);
}

function distToAirport(x, z, apt) {
  const dx = x - apt.x;
  const dz = z - apt.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function nearestRunwayNumber(apt) {
  // All runways are along Z (heading 90 in data = numbers 09/27)
  // Return the first number pair
  const rwy = apt.runways[0];
  return rwy.numbers ? rwy.numbers[0] : '36';
}

function windString() {
  const preset = getCurrentPreset();
  const wp = WEATHER_PRESETS[preset];
  if (!wp) return 'calm';
  const spd = Math.round(wp.windSpeed * MS_TO_KNOTS);
  if (spd < 3) return 'calm';
  // Random-ish but consistent direction based on preset
  const dirs = { clear: 270, overcast: 180, rain: 210, storm: 240 };
  const dir = dirs[preset] || 270;
  return `${String(dir).padStart(3, '0')}/${spd}`;
}

// ============================================================
// Callout / display system
// ============================================================

function callout(msg, isChatter = false) {
  if (calloutCooldown > 0 && !isChatter) return;
  lastCallout = msg;
  atcDisplayMsg = msg;
  atcDisplayTimer = 6;
  atcDisplayOpacity = isChatter ? 0.6 : 1.0;
  atcIsChatter = isChatter;
  if (!isChatter) {
    calloutCooldown = 5;
  }
  // Also show via showMessage for non-chatter
  if (!isChatter) {
    showMessage(`\u260E ${msg}`);
  }
}

function showATCInElement() {
  const el = document.getElementById('hud-atc-instruction');
  if (!el) return;
  if (atcDisplayTimer > 0 && atcDisplayMsg) {
    el.textContent = atcIsChatter ? `\u260E ${atcDisplayMsg}` : atcDisplayMsg;
    el.style.display = 'block';
    // Fade near end
    if (atcDisplayTimer < 1.5) {
      el.style.opacity = String(atcDisplayOpacity * (atcDisplayTimer / 1.5));
    } else {
      el.style.opacity = String(atcDisplayOpacity);
    }
  } else {
    el.style.display = 'none';
    el.style.opacity = '1';
  }
}

// ============================================================
// Background chatter generation
// ============================================================

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomCallsign() {
  const types = [
    () => `November-${randomInt(1,9)}-${randomInt(1,9)}-${String.fromCharCode(65 + randomInt(0,25))}-${String.fromCharCode(65 + randomInt(0,25))}`,
    () => `Delta ${randomInt(100, 999)}`,
    () => `United ${randomInt(100, 999)}`,
    () => `American ${randomInt(100, 999)}`,
    () => `Southwest ${randomInt(100, 999)}`,
    () => `JetBlue ${randomInt(100, 999)}`,
  ];
  return types[randomInt(0, types.length - 1)]();
}

function generateChatter() {
  const template = CHATTER_TEMPLATES[randomInt(0, CHATTER_TEMPLATES.length - 1)];
  const rwys = ['09', '27', '36', '18'];
  const fixes = ['ROMEO', 'BRAVO', 'CHARLIE', 'DELTA', 'FOXTROT', 'GOLF'];
  const msg = template
    .replace('[cs]', randomCallsign())
    .replace('[hdg]', String(randomInt(1, 36) * 10).padStart(3, '0'))
    .replace('[alt]', `${randomInt(2, 12) * 1000}`)
    .replace('[fl]', String(randomInt(180, 410)))
    .replace('[freq]', `${randomInt(118, 135)}.${randomInt(0, 99).toString().padStart(2, '0')}`)
    .replace('[spd]', String(randomInt(160, 280)))
    .replace('[dist]', String(randomInt(2, 15)))
    .replace('[fix]', fixes[randomInt(0, fixes.length - 1)])
    .replace('[rwy]', rwys[randomInt(0, rwys.length - 1)])
    .replace('[squawk]', String(randomInt(1000, 7777)))
    .replace('[wdir]', String(randomInt(1, 36) * 10).padStart(3, '0'))
    .replace('[wspd]', String(randomInt(5, 25)));
  return msg;
}

function resetChatterTimer() {
  nextChatterInterval = 20 + Math.random() * 20; // 20-40s
  chatterTimer = 0;
}

// ============================================================
// ATIS
// ============================================================

let cachedATIS = '';
let atisWeatherKey = '';

function buildATIS() {
  const preset = getCurrentPreset();
  const wp = WEATHER_PRESETS[preset];
  if (!wp) return 'ATIS unavailable';

  const windSpd = Math.round(wp.windSpeed * MS_TO_KNOTS);
  const windDir = windSpd < 3 ? 'variable' : (() => {
    const dirs = { clear: 270, overcast: 180, rain: 210, storm: 240 };
    return String(dirs[preset] || 270).padStart(3, '0');
  })();
  const windStr = windSpd < 3 ? 'Wind calm' : `Wind ${windDir} at ${windSpd}`;

  const visMap = { clear: '10+', overcast: '6', rain: '3', storm: '1' };
  const vis = visMap[preset] || '10';

  const weatherMap = { clear: 'Sky clear', overcast: 'Few clouds', rain: 'Rain', storm: 'Thunderstorm' };
  const weather = weatherMap[preset] || 'Sky clear';

  const tempMap = { clear: 22, overcast: 18, rain: 15, storm: 12 };
  const temp = tempMap[preset] || 20;

  // Altimeter: standard-ish, lower in storms
  const altMap = { clear: 30.12, overcast: 29.95, rain: 29.82, storm: 29.58 };
  const altimeter = (altMap[preset] || 29.92).toFixed(2);

  // Information letter cycles with weather changes
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letterIdx = Object.keys(WEATHER_PRESETS).indexOf(preset) % 26;
  const infoLetter = letters[letterIdx];

  return `KFSA Information ${infoLetter}. ${windStr}. Visibility ${vis}. ${weather}. Temperature ${temp}. Altimeter ${altimeter}. Landing runway 09. Departing runway 09.`;
}

export function getATIS() {
  const key = getCurrentPreset();
  if (key !== atisWeatherKey) {
    atisWeatherKey = key;
    cachedATIS = buildATIS();
  }
  return cachedATIS;
}

// ============================================================
// Clearance state machine logic
// ============================================================

function updateClearanceState(dt, v) {
  if (!v || !isAircraft(v)) return;

  const apt = nearestAirport(v.position.x, v.position.z);
  const aptDist = distToAirport(v.position.x, v.position.z, apt);
  const rwyNum = nearestRunwayNumber(apt);
  const onRwy = isOnRunway(v.position.x, v.position.z);
  const wind = windString();
  const NM = 1852; // meters per nautical mile

  switch (clearanceState) {
    case ClearanceState.PARKED:
      // Wait for F1 (handled by requestClearance)
      break;

    case ClearanceState.TAXI_OUT:
      // Auto transition when within 100m of runway threshold
      if (aptDist < apt.runways[0].length / 2 + 100 && onRwy) {
        clearanceState = ClearanceState.HOLD_SHORT;
        callout(`${apt.icao} Tower, hold short runway ${rwyNum}`);
      }
      break;

    case ClearanceState.HOLD_SHORT:
      // Wait for F1 (handled by requestClearance)
      break;

    case ClearanceState.CLEARED_TAKEOFF:
      // Auto when altitude > 50m AGL
      if (!v.onGround && v.altitude > 50) {
        clearanceState = ClearanceState.AIRBORNE;
        callout(`${apt.icao} Departure, radar contact, climb and maintain 3000`);
      }
      break;

    case ClearanceState.AIRBORNE:
      // Auto when descending through 1500m toward an airport
      if (v.verticalSpeed < -2 && v.altitude < 1500) {
        const closestApt = nearestAirport(v.position.x, v.position.z);
        const d = distToAirport(v.position.x, v.position.z, closestApt);
        if (d < 15000) { // within ~8nm
          clearanceState = ClearanceState.APPROACH;
          const rwy = nearestRunwayNumber(closestApt);
          callout(`${closestApt.icao} Approach, descend to 2000, cleared ILS approach runway ${rwy}`);
        }
      }
      break;

    case ClearanceState.APPROACH:
      // Auto when within 3nm of runway
      {
        const closestApt = nearestAirport(v.position.x, v.position.z);
        const d = distToAirport(v.position.x, v.position.z, closestApt);
        if (d < 3 * NM) {
          clearanceState = ClearanceState.CLEARED_LAND;
          const rwy = nearestRunwayNumber(closestApt);
          callout(`${closestApt.icao} Tower, cleared to land runway ${rwy}, wind ${wind}`);
        }
      }
      break;

    case ClearanceState.CLEARED_LAND:
      // Auto when on ground after being airborne
      if (v.onGround) {
        clearanceState = ClearanceState.LANDED;
        landedTimer = 0;
        taxiInAnnounced = false;
        const closestApt = nearestAirport(v.position.x, v.position.z);
        callout(`${closestApt.icao} Tower, exit runway when able, contact ground`);
      }
      break;

    case ClearanceState.LANDED:
      // After 5s, auto say "taxi to gate"
      landedTimer += dt;
      if (landedTimer > 5 && !taxiInAnnounced) {
        taxiInAnnounced = true;
        const closestApt = nearestAirport(v.position.x, v.position.z);
        callout(`${closestApt.icao} Ground, taxi to gate via Alpha`);
        clearanceState = ClearanceState.TAXI_IN;
      }
      break;

    case ClearanceState.TAXI_IN:
      // Auto when speed < 1 m/s near gate (near airport center, off runway)
      if (v.speed < 1 && !onRwy) {
        const closestApt = nearestAirport(v.position.x, v.position.z);
        const d = distToAirport(v.position.x, v.position.z, closestApt);
        if (d < 500) {
          clearanceState = ClearanceState.PARKED;
          // No callout needed, just reset
        }
      }
      break;
  }
}

// ============================================================
// Public API — requestClearance (called on F1)
// ============================================================

export function requestClearance() {
  if (!atcEnabled()) return;
  const v = getActiveVehicle();
  if (!v || !isAircraft(v)) return;

  const apt = nearestAirport(v.position.x, v.position.z);
  const rwyNum = nearestRunwayNumber(apt);
  const wind = windString();

  switch (clearanceState) {
    case ClearanceState.PARKED:
      // Request taxi
      clearanceState = ClearanceState.TAXI_OUT;
      callout(`${apt.icao} Ground, taxi to runway ${rwyNum} via Alpha`);
      break;

    case ClearanceState.HOLD_SHORT:
      // Request takeoff clearance
      clearanceState = ClearanceState.CLEARED_TAKEOFF;
      callout(`${apt.icao} Tower, cleared for takeoff runway ${rwyNum}, wind ${wind}`);
      break;

    case ClearanceState.TAXI_OUT:
      // Repeat current instruction
      callout(`${apt.icao} Ground, continue taxi to runway ${rwyNum}`);
      break;

    case ClearanceState.CLEARED_TAKEOFF:
      callout(`${apt.icao} Tower, cleared for takeoff runway ${rwyNum}`);
      break;

    case ClearanceState.AIRBORNE:
      // Request approach info
      callout(`${apt.icao} Approach, radar contact, maintain present heading`);
      break;

    case ClearanceState.APPROACH:
      callout(`${apt.icao} Approach, continue approach runway ${rwyNum}`);
      break;

    case ClearanceState.CLEARED_LAND:
      callout(`${apt.icao} Tower, cleared to land runway ${rwyNum}, wind ${wind}`);
      break;

    case ClearanceState.LANDED:
      callout(`${apt.icao} Tower, exit runway when able`);
      break;

    case ClearanceState.TAXI_IN:
      callout(`${apt.icao} Ground, taxi to gate via Alpha`);
      break;

    default:
      break;
  }
}

// ============================================================
// Init / Reset
// ============================================================

export function initATC() {
  lastCallout = '';
  calloutCooldown = 0;
  prevOnGround = true;
  prevOnRunway = false;
  hasAnnouncedTakeoff = false;
  hasAnnouncedLanding = false;
  approachAnnounced = false;
  clearanceState = ClearanceState.PARKED;
  landedTimer = 0;
  taxiInAnnounced = false;
  atcDisplayMsg = '';
  atcDisplayTimer = 0;
  chatterTimer = 0;
  resetChatterTimer();
  cachedATIS = '';
  atisWeatherKey = '';
}

export const resetATC = initATC;

// ============================================================
// Existing exports (kept for compatibility)
// ============================================================

export function getATCState() {
  return { lastInstruction: lastCallout, enabled: atcEnabled(), clearanceState };
}

export function getATCInstruction() {
  if (!atcEnabled()) return '';
  if (atcDisplayTimer > 0) return atcDisplayMsg;
  return '';
}

export function isPushbackActive() {
  return false;
}

export function updatePushback() {
  // No-op
}

// ============================================================
// Main update
// ============================================================

export function updateATC(dt) {
  if (!atcEnabled()) return;

  const v = getActiveVehicle();
  if (!v || !isAircraft(v)) return;

  // Cooldown
  if (calloutCooldown > 0) {
    calloutCooldown -= dt;
  }

  // Display timer
  if (atcDisplayTimer > 0) {
    atcDisplayTimer -= dt;
  }

  // Update the HUD element directly
  showATCInElement();

  const onRwy = isOnRunway(v.position.x, v.position.z);

  // ── Legacy callouts (coexist with state machine) ──

  // Detect takeoff
  if (prevOnGround && !v.onGround && !hasAnnouncedTakeoff) {
    hasAnnouncedTakeoff = true;
    hasAnnouncedLanding = false;
    approachAnnounced = false;
  }

  // Detect approach (descending below 300m within 5km of an airport)
  if (!v.onGround && v.altitude < 300 && v.verticalSpeed < -1 && !approachAnnounced) {
    for (const apt of AIRPORTS) {
      const d = distToAirport(v.position.x, v.position.z, apt);
      if (d < 5000) {
        approachAnnounced = true;
        break;
      }
    }
  }

  // Detect landing
  if (!prevOnGround && v.onGround && !hasAnnouncedLanding) {
    hasAnnouncedLanding = true;
    hasAnnouncedTakeoff = false;
  }

  prevOnGround = v.onGround;
  prevOnRunway = onRwy;

  // ── Clearance state machine ──
  updateClearanceState(dt, v);

  // ── Background chatter (only when airborne) ──
  if (!v.onGround) {
    chatterTimer += dt;
    if (chatterTimer >= nextChatterInterval) {
      const msg = generateChatter();
      callout(msg, true);
      resetChatterTimer();
    }
  } else {
    // Reset chatter timer on ground so it starts fresh when airborne
    chatterTimer = 0;
  }
}

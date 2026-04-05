// Radio stack simulation: NAV1, NAV2, COM1, COM2, ADF
// Provides VOR/ILS/NDB receiver logic with CDI deflection and DME

import { clamp } from './utils.js';
import { MS_TO_KNOTS, M_TO_FEET } from './constants.js';
import { getActiveVehicle } from './vehicleState.js';
import { isAvionicsPowered } from './electrical.js';
import {
  getNavaidsByFreq, getNavaidByFreq,
  computeBearing, computeDistance, computeDistanceNM,
} from './navdata.js';
import { AIRPORTS } from './airportData.js';

// ---- Constants ----
const NM_TO_M = 1852;
const VOR_FULL_SCALE_DEG = 10;   // +/-10 degrees for VOR CDI
const ILS_LOC_FULL_SCALE_DEG = 2.5; // +/-2.5 degrees for ILS localizer
const ILS_GS_FULL_SCALE_DEG = 0.7;  // +/-0.7 degrees for glideslope
const ILS_GS_REF_DEG = 3.0;         // standard 3-degree glideslope

// ---- ILS runway heading lookup ----
// Maps ILS frequency to runway heading and glideslope angle
function getILSData(freq) {
  const rounded = Math.round(freq * 100) / 100;
  for (const apt of AIRPORTS) {
    if (apt.ilsFreq && Math.round(apt.ilsFreq * 100) / 100 === rounded) {
      const rwy = apt.runways[0];
      return { runwayHeading: rwy.heading, glideslope: ILS_GS_REF_DEG, airport: apt };
    }
  }
  return null;
}

// ---- Radio state ----
const radioStack = {
  nav1: { active: 110.30, standby: 112.00, ident: '', receiving: false, obs: 90 },
  nav2: { active: 114.00, standby: 116.00, ident: '', receiving: false, obs: 90 },
  com1: { active: 118.00, standby: 121.50 },
  com2: { active: 128.00, standby: 119.10 },
  adf:  { active: 335, standby: 278, ident: '', receiving: false },
  selectedRadio: 'nav1',
};

// Computed NAV receiver outputs (updated each frame)
const navOutput = [
  { receiving: false, ident: '', bearing: 0, distance: 0, distanceNM: 0, cdiDeflection: 0, dmeDistance: null, hasGlideslope: false, gsDeflection: 0 },
  { receiving: false, ident: '', bearing: 0, distance: 0, distanceNM: 0, cdiDeflection: 0, dmeDistance: null, hasGlideslope: false, gsDeflection: 0 },
];

// Computed ADF output
const adfOutput = { receiving: false, ident: '', relativeBearing: 0 };

// Radio selector order for Tab cycling
const RADIO_ORDER = ['nav1', 'nav2', 'com1', 'com2', 'adf'];

// ---- Helpers ----

/** Normalize angle to -180..+180 */
function normalizeAngle(deg) {
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

/** Round frequency to 2 decimal places */
function roundFreq(f) {
  return Math.round(f * 100) / 100;
}

// ---- NAV receiver update ----

function updateNavReceiver(index) {
  const key = index === 0 ? 'nav1' : 'nav2';
  const nav = radioStack[key];
  const out = navOutput[index];

  // Reset
  out.receiving = false;
  out.ident = '';
  out.bearing = 0;
  out.distance = 0;
  out.distanceNM = 0;
  out.cdiDeflection = 0;
  out.dmeDistance = null;
  out.hasGlideslope = false;
  out.gsDeflection = 0;

  if (!isAvionicsPowered()) {
    nav.receiving = false;
    nav.ident = '';
    return;
  }

  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const px = vehicle.position.x;
  const pz = vehicle.position.z;
  const py = vehicle.position.y || 0;

  // Find navaids on this frequency
  const navaids = getNavaidsByFreq(nav.active);
  if (navaids.length === 0) {
    nav.receiving = false;
    nav.ident = '';
    return;
  }

  // Find the primary navaid (VOR or ILS, prefer ILS)
  let primary = null;
  let dme = null;
  for (const n of navaids) {
    if (n.type === 'ILS') primary = n;
    else if (n.type === 'VOR' && !primary) primary = n;
    if (n.type === 'DME') dme = n;
  }
  if (!primary) primary = navaids[0];

  // Check range
  const distM = computeDistance(px, pz, primary.x, primary.z);
  const distNM = distM / NM_TO_M;

  if (distNM > primary.range) {
    nav.receiving = false;
    nav.ident = '';
    return;
  }

  // In range - compute outputs
  nav.receiving = true;
  nav.ident = primary.id;
  out.receiving = true;
  out.ident = primary.id;
  out.bearing = computeBearing(px, pz, primary.x, primary.z);
  out.distance = distM;
  out.distanceNM = distNM;

  // DME distance (if collocated DME exists)
  if (dme) {
    const dmeDistM = computeDistance(px, pz, dme.x, dme.z);
    const dmeDistNM = dmeDistM / NM_TO_M;
    if (dmeDistNM <= dme.range) {
      out.dmeDistance = dmeDistNM;
    }
  }

  // CDI deflection
  if (primary.type === 'ILS') {
    // ILS localizer
    const ilsData = getILSData(nav.active);
    if (ilsData) {
      const rwyHdg = ilsData.runwayHeading;
      // Bearing FROM aircraft TO localizer
      const bearingToLoc = out.bearing;
      // Inbound course = runway heading (we approach on the runway heading)
      const deviation = normalizeAngle(bearingToLoc - rwyHdg + 180);
      out.cdiDeflection = clamp(deviation / ILS_LOC_FULL_SCALE_DEG, -1, 1);
      out.hasGlideslope = true;

      // Glideslope deviation
      // Angle from aircraft to ILS antenna
      const horizDist = distM;
      const vertDist = py - (primary.elevation || 0);
      const actualAngle = Math.atan2(vertDist, horizDist) * (180 / Math.PI);
      const gsDeviation = actualAngle - ilsData.glideslope;
      out.gsDeflection = clamp(gsDeviation / ILS_GS_FULL_SCALE_DEG, -1, 1);
    }
  } else {
    // VOR - CDI based on OBS
    const bearingToVOR = out.bearing;
    // Course deviation = difference between selected OBS and bearing TO the VOR
    // When on the selected radial, bearing FROM VOR = OBS, bearing TO VOR = OBS + 180
    const deviation = normalizeAngle(bearingToVOR - (nav.obs + 180));
    out.cdiDeflection = clamp(deviation / VOR_FULL_SCALE_DEG, -1, 1);
  }
}

// ---- ADF receiver update ----

function updateADFReceiver() {
  const adf = radioStack.adf;
  adfOutput.receiving = false;
  adfOutput.ident = '';
  adfOutput.relativeBearing = 0;

  if (!isAvionicsPowered()) {
    adf.receiving = false;
    adf.ident = '';
    return;
  }

  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const px = vehicle.position.x;
  const pz = vehicle.position.z;

  const navaid = getNavaidByFreq(adf.active);
  if (!navaid || navaid.type !== 'NDB') {
    adf.receiving = false;
    adf.ident = '';
    return;
  }

  const distNM = computeDistanceNM(px, pz, navaid.x, navaid.z);
  if (distNM > navaid.range) {
    adf.receiving = false;
    adf.ident = '';
    return;
  }

  adf.receiving = true;
  adf.ident = navaid.id;
  adfOutput.receiving = true;
  adfOutput.ident = navaid.id;

  // Relative bearing = bearing to NDB minus aircraft heading
  const bearingToNDB = computeBearing(px, pz, navaid.x, navaid.z);
  const heading = vehicle.heading || 0; // already in degrees
  let rel = bearingToNDB - heading;
  while (rel < 0) rel += 360;
  while (rel >= 360) rel -= 360;
  adfOutput.relativeBearing = rel;
}

// ---- Public API ----

export function initRadio() {
  // Reset to defaults
  radioStack.nav1.active = 110.30;
  radioStack.nav1.standby = 112.00;
  radioStack.nav1.obs = 90;
  radioStack.nav2.active = 114.00;
  radioStack.nav2.standby = 116.00;
  radioStack.nav2.obs = 90;
  radioStack.com1.active = 118.00;
  radioStack.com1.standby = 121.50;
  radioStack.com2.active = 128.00;
  radioStack.com2.standby = 119.10;
  radioStack.adf.active = 335;
  radioStack.adf.standby = 278;
  radioStack.selectedRadio = 'nav1';
}

export function updateRadio(dt) {
  updateNavReceiver(0);
  updateNavReceiver(1);
  updateADFReceiver();
}

export function getRadioStack() {
  return radioStack;
}

export function getNavReceiver(index) {
  return navOutput[clamp(index, 0, 1)];
}

export function getADFState() {
  return adfOutput;
}

export function cycleRadio() {
  const idx = RADIO_ORDER.indexOf(radioStack.selectedRadio);
  radioStack.selectedRadio = RADIO_ORDER[(idx + 1) % RADIO_ORDER.length];
}

export function tuneFreq(delta) {
  const sel = radioStack.selectedRadio;
  const radio = radioStack[sel];
  if (sel === 'adf') {
    radio.standby = clamp(Math.round(radio.standby + delta), 190, 535);
  } else {
    radio.standby = roundFreq(clamp(radio.standby + delta, 108.00, 136.975));
  }
}

export function swapFreq() {
  const sel = radioStack.selectedRadio;
  const radio = radioStack[sel];
  const tmp = radio.active;
  radio.active = radio.standby;
  radio.standby = tmp;
}

export function setNavOBS(index, obs) {
  const key = index === 0 ? 'nav1' : 'nav2';
  let o = obs % 360;
  if (o < 0) o += 360;
  radioStack[key].obs = o;
}

export function adjustNavOBS(index, delta) {
  const key = index === 0 ? 'nav1' : 'nav2';
  let o = (radioStack[key].obs + delta) % 360;
  if (o < 0) o += 360;
  radioStack[key].obs = o;
}

export function getSelectedRadioName() {
  const names = { nav1: 'NAV1', nav2: 'NAV2', com1: 'COM1', com2: 'COM2', adf: 'ADF' };
  return names[radioStack.selectedRadio] || 'NAV1';
}

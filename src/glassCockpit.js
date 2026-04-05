// Glass Cockpit: PFD (Primary Flight Display) + ND (Navigation Display)
// Canvas-based overlay for glass-panel aircraft (737, A340)

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { getCameraMode } from './camera.js';
import { isAvionicsPowered } from './electrical.js';
import { isAPEngaged, getAPState } from './autopilot.js';
import { getNavaidsInRange } from './navdata.js';
import { getFlightPlanRoute, getActiveWaypoint, getBearingToActive, getDistanceToActiveNM } from './flightplan.js';
import { MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM } from './constants.js';
import { clamp } from './utils.js';

let pfdCanvas, pfdCtx;
let ndCanvas, ndCtx;
let frameCounter = 0;
let visible = false;
let glassEnabled = false;

const PFD_W = 320;
const PFD_H = 320;
const ND_W = 320;
const ND_H = 320;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Colors
const COL_SKY = '#0066cc';
const COL_GROUND = '#664400';
const COL_BG = '#1a1a1a';
const COL_ND_BG = '#111111';
const COL_GREEN = '#00ff44';
const COL_YELLOW = '#ffcc00';
const COL_RED = '#ff3333';
const COL_MAGENTA = '#ff00ff';
const COL_CYAN = '#00ccff';
const COL_WHITE = '#ffffff';
const COL_AMBER = '#ffaa00';

// ── Init ──────────────────────────────────────────────────────────────
export function initGlassCockpit() {
  pfdCanvas = document.createElement('canvas');
  pfdCanvas.id = 'glass-pfd';
  pfdCanvas.width = PFD_W;
  pfdCanvas.height = PFD_H;
  pfdCanvas.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:50;pointer-events:none;border:1px solid #333;border-radius:4px;display:none;';
  document.body.appendChild(pfdCanvas);
  pfdCtx = pfdCanvas.getContext('2d');

  ndCanvas = document.createElement('canvas');
  ndCanvas.id = 'glass-nd';
  ndCanvas.width = ND_W;
  ndCanvas.height = ND_H;
  ndCanvas.style.cssText = 'position:fixed;bottom:10px;left:340px;z-index:50;pointer-events:none;border:1px solid #333;border-radius:4px;display:none;';
  document.body.appendChild(ndCanvas);
  ndCtx = ndCanvas.getContext('2d');
}

// ── Visibility ────────────────────────────────────────────────────────
function shouldShow() {
  if (!glassEnabled) return false;
  const v = getActiveVehicle();
  if (!v || !isAircraft(v)) return false;
  if (!v.config || !v.config.glassPanel) return false;
  if (getCameraMode() !== 'cockpit') return false;
  return true;
}

export function toggleGlassCockpit() {
  glassEnabled = !glassEnabled;
  return glassEnabled;
}

export function isGlassCockpitActive() {
  return visible;
}

// ── Update (called each frame) ────────────────────────────────────────
export function updateGlassCockpit(dt) {
  const show = shouldShow();
  if (show !== visible) {
    visible = show;
    pfdCanvas.style.display = show ? 'block' : 'none';
    ndCanvas.style.display = show ? 'block' : 'none';
  }
  if (!visible) return;

  // Render every 2 frames for performance
  frameCounter++;
  if (frameCounter % 2 !== 0) return;

  const powered = isAvionicsPowered();
  if (!powered) {
    drawBlank(pfdCtx, PFD_W, PFD_H);
    drawBlank(ndCtx, ND_W, ND_H);
    return;
  }

  const v = getActiveVehicle();
  if (!v) return;

  drawPFD(v);
  drawND(v);
}

function drawBlank(ctx, w, h) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
}

// ══════════════════════════════════════════════════════════════════════
// PFD
// ══════════════════════════════════════════════════════════════════════
function drawPFD(v) {
  const ctx = pfdCtx;
  const w = PFD_W, h = PFD_H;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, w, h);

  const pitch = v.euler ? v.euler.x * RAD : 0;   // pitch in degrees
  const rollRad = v.euler ? v.euler.z : 0;
  const roll = rollRad * RAD;     // degrees
  const heading = ((v.heading || 0) + 360) % 360; // already in degrees
  const speed = (v.speed || 0) * MS_TO_KNOTS;
  const alt = (v.position ? v.position.y : 0) * M_TO_FEET;
  const vs = (v.verticalSpeed || 0) * MS_TO_FPM;
  const vne = v.config ? (v.config.takeoffSpeed || 80) * 2.5 * MS_TO_KNOTS : 250;

  // Layout
  const aiCX = 160, aiCY = 150, aiR = 95;
  const tapeL = 15, tapeR = 255, tapeW = 48;

  // ── Attitude Indicator ──────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.arc(aiCX, aiCY, aiR, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(aiCX, aiCY);
  ctx.rotate(-rollRad);

  const pitchPx = pitch * 2.5; // pixels per degree
  // Sky
  ctx.fillStyle = COL_SKY;
  ctx.fillRect(-aiR - 20, -aiR - 200 + pitchPx, (aiR + 20) * 2, 200 + aiR);
  // Ground
  ctx.fillStyle = COL_GROUND;
  ctx.fillRect(-aiR - 20, pitchPx, (aiR + 20) * 2, 200 + aiR);
  // Horizon line
  ctx.strokeStyle = COL_WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-aiR - 10, pitchPx);
  ctx.lineTo(aiR + 10, pitchPx);
  ctx.stroke();

  // Pitch ladder
  ctx.lineWidth = 1;
  ctx.font = '10px monospace';
  ctx.fillStyle = COL_WHITE;
  ctx.textAlign = 'center';
  for (let deg = -30; deg <= 30; deg += 5) {
    if (deg === 0) continue;
    const y = pitchPx - deg * 2.5;
    const halfW = deg % 10 === 0 ? 25 : 12;
    ctx.beginPath();
    ctx.moveTo(-halfW, y);
    ctx.lineTo(halfW, y);
    ctx.stroke();
    if (deg % 10 === 0) {
      ctx.fillText(`${Math.abs(deg)}`, -halfW - 14, y + 3);
      ctx.fillText(`${Math.abs(deg)}`, halfW + 14, y + 3);
    }
  }

  ctx.restore();

  // Bank angle arc
  ctx.save();
  ctx.translate(aiCX, aiCY);
  ctx.strokeStyle = COL_WHITE;
  ctx.lineWidth = 1;
  const bankR = aiR - 5;
  ctx.beginPath();
  ctx.arc(0, 0, bankR, -Math.PI + 0.35, -0.35);
  ctx.stroke();
  // Bank marks
  for (const a of [10, 20, 30, 45, 60]) {
    const len = a === 30 || a === 60 ? 10 : 6;
    for (const sign of [-1, 1]) {
      const angle = -Math.PI / 2 + sign * a * DEG;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * bankR, Math.sin(angle) * bankR);
      ctx.lineTo(Math.cos(angle) * (bankR - len), Math.sin(angle) * (bankR - len));
      ctx.stroke();
    }
  }
  // Bank pointer
  const bpAngle = -Math.PI / 2 - rollRad;
  ctx.fillStyle = COL_WHITE;
  ctx.beginPath();
  ctx.moveTo(Math.cos(bpAngle) * (bankR + 2), Math.sin(bpAngle) * (bankR + 2));
  ctx.lineTo(Math.cos(bpAngle - 0.06) * (bankR + 10), Math.sin(bpAngle - 0.06) * (bankR + 10));
  ctx.lineTo(Math.cos(bpAngle + 0.06) * (bankR + 10), Math.sin(bpAngle + 0.06) * (bankR + 10));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Aircraft symbol (fixed)
  ctx.strokeStyle = '#ff9900';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(aiCX - 30, aiCY);
  ctx.lineTo(aiCX - 8, aiCY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(aiCX + 8, aiCY);
  ctx.lineTo(aiCX + 30, aiCY);
  ctx.stroke();
  ctx.fillStyle = '#ff9900';
  ctx.beginPath();
  ctx.arc(aiCX, aiCY, 3, 0, Math.PI * 2);
  ctx.fill();

  // ── Airspeed Tape (left) ──────────────────────────────────────────
  drawTape(ctx, tapeL, 40, tapeW, 200, speed, 10, 1, vne, 'SPD');

  // ── Altitude Tape (right) ─────────────────────────────────────────
  drawTape(ctx, tapeR, 40, tapeW, 200, alt, 100, 0, null, 'ALT');

  // ── Heading Tape (bottom) ─────────────────────────────────────────
  drawHeadingTape(ctx, 60, h - 40, 200, 30, heading);

  // ── VS Indicator (far right) ──────────────────────────────────────
  drawVSIndicator(ctx, w - 20, 60, 12, 170, vs);

  // ── FMA (top) ─────────────────────────────────────────────────────
  drawFMA(ctx, w);
}

function drawTape(ctx, x, y, w, h, value, majorStep, decimals, limit, label) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, w, h);

  const cy = y + h / 2;
  const pxPerUnit = h / (majorStep * 6);

  ctx.strokeStyle = '#888';
  ctx.fillStyle = COL_WHITE;
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 1;

  const startVal = Math.floor(value / majorStep - 3) * majorStep;
  const endVal = startVal + majorStep * 7;

  for (let v = startVal; v <= endVal; v += majorStep) {
    const py = cy - (v - value) * pxPerUnit;
    if (py < y - 10 || py > y + h + 10) continue;
    ctx.beginPath();
    ctx.moveTo(x + w - 6, py);
    ctx.lineTo(x + w, py);
    ctx.stroke();

    // Color for speed tape
    if (label === 'SPD' && limit) {
      if (v > limit) ctx.fillStyle = COL_RED;
      else if (v > limit * 0.9) ctx.fillStyle = COL_YELLOW;
      else ctx.fillStyle = COL_GREEN;
    } else {
      ctx.fillStyle = COL_WHITE;
    }
    ctx.fillText(v.toFixed(decimals), x + w / 2, py + 4);
  }
  ctx.restore();

  // Value box
  ctx.fillStyle = '#000';
  ctx.strokeStyle = COL_WHITE;
  ctx.lineWidth = 1.5;
  const bx = x + 2, by = cy - 11, bw = w - 4, bh = 22;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = COL_WHITE;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(value.toFixed(decimals), x + w / 2, cy + 5);

  // Label
  ctx.font = '9px monospace';
  ctx.fillStyle = COL_CYAN;
  ctx.fillText(label, x + w / 2, y - 4);
}

function drawHeadingTape(ctx, x, y, w, h, heading) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, w, h);

  const cx = x + w / 2;
  const pxPerDeg = w / 40; // show +-20 degrees

  ctx.strokeStyle = '#888';
  ctx.fillStyle = COL_WHITE;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 1;

  const labels = ['N', '', '', 'E', '', '', 'S', '', '', 'W', '', ''];

  for (let d = -25; d <= 25; d++) {
    let deg = ((heading + d) % 360 + 360) % 360;
    const px = cx + d * pxPerDeg;
    if (px < x || px > x + w) continue;
    if (Math.round(deg) % 10 === 0) {
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + 8);
      ctx.stroke();
      const idx = Math.round(deg / 30) % 12;
      const lbl = labels[idx] || `${Math.round(deg)}`;
      ctx.fillText(lbl, px, y + 20);
    } else if (Math.round(deg) % 5 === 0) {
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + 5);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Pointer
  ctx.fillStyle = COL_WHITE;
  ctx.beginPath();
  ctx.moveTo(cx, y - 2);
  ctx.lineTo(cx - 5, y - 8);
  ctx.lineTo(cx + 5, y - 8);
  ctx.closePath();
  ctx.fill();

  // Value box
  ctx.fillStyle = '#000';
  ctx.strokeStyle = COL_WHITE;
  ctx.lineWidth = 1.5;
  ctx.fillRect(cx - 22, y + h - 2, 44, 16);
  ctx.strokeRect(cx - 22, y + h - 2, 44, 16);
  ctx.fillStyle = COL_WHITE;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(heading)}`, cx, y + h + 12);
}

function drawVSIndicator(ctx, x, y, w, h, vs) {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - w / 2, y, w, h);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2, y, w, h);

  const cy = y + h / 2;
  const maxVS = 2000;
  const clampedVS = clamp(vs, -maxVS, maxVS);
  const py = cy - (clampedVS / maxVS) * (h / 2 - 10);

  // Scale marks
  ctx.font = '8px monospace';
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  for (const sv of [-2000, -1000, 0, 1000, 2000]) {
    const sy = cy - (sv / maxVS) * (h / 2 - 10);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, sy);
    ctx.lineTo(x - w / 2 + 3, sy);
    ctx.stroke();
  }

  // Pointer
  ctx.fillStyle = vs > 200 ? COL_GREEN : vs < -800 ? COL_AMBER : COL_WHITE;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, py);
  ctx.lineTo(x + w / 2, py - 4);
  ctx.lineTo(x + w / 2, py + 4);
  ctx.closePath();
  ctx.fill();

  // Value
  ctx.font = '9px monospace';
  ctx.fillStyle = COL_WHITE;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(vs)}`, x, y + h + 12);

  ctx.font = '8px monospace';
  ctx.fillStyle = COL_CYAN;
  ctx.fillText('VS', x, y - 3);
}

function drawFMA(ctx, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, 0, w, 28);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, 28);

  if (!isAPEngaged()) {
    ctx.font = '11px monospace';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    ctx.fillText('AP OFF', w / 2, 18);
    return;
  }

  const ap = getAPState();
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';

  // Lateral mode
  const latMode = ap.lnavMode ? 'LNAV' : ap.hdgHold ? 'HDG' : ap.aprMode ? 'LOC' : '---';
  ctx.fillStyle = ap.lnavMode || ap.hdgHold || ap.aprMode ? COL_GREEN : '#888';
  ctx.fillText(latMode, 60, 18);

  // Vertical mode
  let vertMode = '---';
  if (ap.vnavMode) vertMode = 'VNAV';
  else if (ap.altHold) vertMode = 'ALT';
  else if (ap.vsMode) vertMode = 'VS';
  else if (ap.aprMode) vertMode = 'GS';
  ctx.fillStyle = vertMode !== '---' ? COL_GREEN : '#888';
  ctx.fillText(vertMode, 160, 18);

  // Speed mode
  const spdMode = ap.spdHold ? 'SPD' : '---';
  ctx.fillStyle = ap.spdHold ? COL_GREEN : '#888';
  ctx.fillText(spdMode, 260, 18);

  // Labels
  ctx.font = '8px monospace';
  ctx.fillStyle = '#666';
  ctx.fillText('LAT', 60, 8);
  ctx.fillText('VERT', 160, 8);
  ctx.fillText('THR', 260, 8);
}

// ══════════════════════════════════════════════════════════════════════
// ND (Navigation Display)
// ══════════════════════════════════════════════════════════════════════
function drawND(v) {
  const ctx = ndCtx;
  const w = ND_W, h = ND_H;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COL_ND_BG;
  ctx.fillRect(0, 0, w, h);

  const heading = ((v.heading || 0) + 360) % 360; // already in degrees
  const headingRad = heading * DEG;
  const px = v.position ? v.position.x : 0;
  const pz = v.position ? v.position.z : 0;
  const gs = (v.speed || 0) * MS_TO_KNOTS;
  const tas = gs; // simplified

  const cx = w / 2, cy = h / 2;
  const rangeNM = 20;
  const mPerNM = 1852;
  const scale = (h / 2 - 30) / (rangeNM * mPerNM); // pixels per meter

  // ── Compass Rose ────────────────────────────────────────────────
  const roseR = h / 2 - 25;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, roseR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = '10px monospace';
  ctx.fillStyle = COL_WHITE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let deg = 0; deg < 360; deg += 10) {
    const a = (deg - heading) * DEG - Math.PI / 2;
    const isMajor = deg % 30 === 0;
    const inner = isMajor ? roseR - 14 : roseR - 7;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * roseR, Math.sin(a) * roseR);
    ctx.stroke();
    if (isMajor) {
      const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
      const lbl = labels[deg] || `${deg}`;
      const lr = roseR + 10;
      ctx.fillText(lbl, Math.cos(a) * lr, Math.sin(a) * lr);
    }
  }
  ctx.restore();

  // ── Range Rings ─────────────────────────────────────────────────
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 4]);
  for (const rNM of [5, 10]) {
    const rPx = rNM * mPerNM * scale;
    ctx.beginPath();
    ctx.arc(0, 0, rPx, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // ── Heading Line ────────────────────────────────────────────────
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -roseR + 15);
  ctx.stroke();
  ctx.restore();

  // Helper: world coords to ND pixels (north-up, heading rotated)
  function worldToND(wx, wz) {
    const dx = wx - px;
    const dz = wz - pz;
    // In sim: +X = east, -Z = north. On ND: right = east, up = north
    // Rotate by heading so aircraft heading points up
    const hRad = heading * DEG;
    const sin = Math.sin(hRad);
    const cos = Math.cos(hRad);
    // Rotate (dx, dz) by -heading
    const ndx = (dx * cos + dz * sin) * scale;
    const ndy = (-dx * sin + dz * cos) * scale;
    return [cx + ndx, cy + ndy];
  }

  // ── Flight Plan Route ───────────────────────────────────────────
  const route = getFlightPlanRoute();
  const activeWpt = getActiveWaypoint();
  if (route && route.length > 1) {
    ctx.strokeStyle = COL_MAGENTA;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < route.length; i++) {
      const [sx, sy] = worldToND(route[i].x, route[i].z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Waypoint markers
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    for (const wpt of route) {
      const [sx, sy] = worldToND(wpt.x, wpt.z);
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
      const isActive = activeWpt && wpt.name === activeWpt.name;
      ctx.fillStyle = isActive ? COL_MAGENTA : '#cc44cc';
      ctx.beginPath();
      ctx.arc(sx, sy, isActive ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COL_WHITE;
      ctx.fillText(wpt.name || '', sx + 7, sy + 3);
    }
  }

  // ── Navaids ─────────────────────────────────────────────────────
  const navaids = getNavaidsInRange(px, pz, rangeNM);
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  for (const nav of navaids) {
    const [sx, sy] = worldToND(nav.x, nav.z);
    if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
    if (nav.type === 'VOR') {
      // Green hexagon
      ctx.strokeStyle = COL_GREEN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 - Math.PI / 6;
        const r = 5;
        if (i === 0) ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
        else ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = COL_GREEN;
    } else {
      // NDB: blue triangle
      ctx.strokeStyle = COL_CYAN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx - 5, sy + 4);
      ctx.lineTo(sx + 5, sy + 4);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = COL_CYAN;
    }
    ctx.fillText(nav.id || '', sx + 8, sy + 3);
  }

  // ── Aircraft Icon (center) ──────────────────────────────────────
  ctx.fillStyle = COL_WHITE;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx - 5, cy + 5);
  ctx.lineTo(cx, cy + 2);
  ctx.lineTo(cx + 5, cy + 5);
  ctx.closePath();
  ctx.fill();

  // ── Info Readouts ───────────────────────────────────────────────
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';

  // Top left: GS, TAS
  ctx.fillStyle = COL_GREEN;
  ctx.fillText(`GS ${Math.round(gs)}`, 8, 16);
  ctx.fillText(`TAS ${Math.round(tas)}`, 8, 30);

  // Bottom: active waypoint info
  if (activeWpt) {
    const brg = getBearingToActive();
    const dist = getDistanceToActiveNM();
    ctx.fillStyle = COL_MAGENTA;
    ctx.textAlign = 'left';
    ctx.fillText(activeWpt.name || 'WPT', 8, h - 20);
    ctx.fillStyle = COL_WHITE;
    ctx.fillText(`${Math.round(brg || 0)}°`, 8, h - 6);
    ctx.fillText(`${(dist || 0).toFixed(1)}nm`, 60, h - 6);
  }

  // Range label
  ctx.fillStyle = '#888';
  ctx.textAlign = 'right';
  ctx.font = '9px monospace';
  ctx.fillText(`${rangeNM}NM`, w - 6, h - 6);
}

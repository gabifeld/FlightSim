import * as THREE from 'three';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, AIRPORT2_X, AIRPORT2_Z, MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM } from './constants.js';
import { getAircraftType, AIRCRAFT_TYPES } from './aircraftTypes.js';
import { getKeys } from './controls.js';
import { getApproachSpawn } from './landing.js';

// Spawn locations
let spawnLocation = 'runway'; // 'runway' | 'gate' | 'short_final' | 'long_final' | 'runway_apt2' | 'gate_apt2'

const SPAWN_POSITIONS = {
  runway: { x: 0, z: RUNWAY_LENGTH / 2 - 100, heading: 0 },
  gate: {
    x: RUNWAY_WIDTH / 2 + 100,
    z: 50,
    heading: Math.PI,
  },
  runway_apt2: { x: AIRPORT2_X, z: AIRPORT2_Z + RUNWAY_LENGTH / 2 - 100, heading: 0 },
  gate_apt2: {
    x: AIRPORT2_X + RUNWAY_WIDTH / 2 + 100,
    z: AIRPORT2_Z + 50,
    heading: Math.PI,
  },
};

export const aircraftState = {
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  quaternion: new THREE.Quaternion(),
  euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  speed: 0,
  altitude: 0,
  altitudeAGL: 0,
  verticalSpeed: 0,
  throttle: 0,
  flaps: false,
  gear: true,
  speedbrake: false,
  onGround: true,
  heading: 0,
  aoa: 0,
  propSpeed: 0,
  gForce: 1,
  landingLight: false,
  // Per-aircraft physics config
  config: null,
  currentType: 'cessna_172',
};

let aircraftGroup;
let propeller;
let gearGroup;
let sceneRef;

// Landing/taxi lights
let landingSpotLight = null;
let landingLightCone = null;

// Control surface meshes
let leftAileron, rightAileron, elevator, rudder;

// Cockpit interior
let cockpitGroup;

// Contrail system
let contrailLeft, contrailRight;
let contrailPositions = [];
const CONTRAIL_LENGTH = 200;

// Cockpit canvas instrument panel
let cockpitCanvas, cockpitCtx, cockpitTexture, cockpitPanel;
let cockpitFrameCount = 0;

// ═══════════════════════════════════════════════════════════
// Cockpit Canvas Instrument Drawing Functions
// ═══════════════════════════════════════════════════════════

const DEG = Math.PI / 180;

/**
 * Draw a realistic round gauge with colored arcs, ticks, needle, and labels.
 */
function drawRoundGauge(ctx, cx, cy, r, value, min, max, label, unit, arcs, tickCount) {
  const startAngle = 225 * DEG;  // 7 o'clock
  const endAngle = -45 * DEG;    // 5 o'clock
  const sweep = 270 * DEG;

  ctx.save();

  // Background circle with gradient
  const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#1a1a1a');
  grad.addColorStop(1, '#111111');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Colored arcs
  if (arcs) {
    for (const arc of arcs) {
      const aStart = startAngle - ((arc.min - min) / (max - min)) * sweep;
      const aEnd = startAngle - ((arc.max - min) / (max - min)) * sweep;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.82, aStart, aEnd, true);
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = r * 0.1;
      ctx.stroke();
    }
  }

  // Tick marks and numbers
  const majorTicks = tickCount || 10;
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(8, r * 0.22)}px monospace`;

  for (let i = 0; i <= majorTicks; i++) {
    const frac = i / majorTicks;
    const angle = startAngle - frac * sweep;
    const cos = Math.cos(angle);
    const sin = -Math.sin(angle);

    // Major tick
    const innerR = r * 0.68;
    const outerR = r * 0.9;
    ctx.beginPath();
    ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
    ctx.lineTo(cx + cos * outerR, cy + sin * outerR);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Number at major tick
    const numR = r * 0.55;
    const tickVal = min + frac * (max - min);
    ctx.fillText(Math.round(tickVal).toString(), cx + cos * numR, cy + sin * numR);

    // Minor ticks (between major ticks)
    if (i < majorTicks) {
      for (let m = 1; m < 5; m++) {
        const mFrac = (i + m / 5) / majorTicks;
        const mAngle = startAngle - mFrac * sweep;
        const mCos = Math.cos(mAngle);
        const mSin = -Math.sin(mAngle);
        ctx.beginPath();
        ctx.moveTo(cx + mCos * (r * 0.78), cy + mSin * (r * 0.78));
        ctx.lineTo(cx + mCos * (r * 0.9), cy + mSin * (r * 0.9));
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  // Needle
  const clampedVal = Math.max(min, Math.min(max, value));
  const needleAngle = startAngle - ((clampedVal - min) / (max - min)) * sweep;
  const needleCos = Math.cos(needleAngle);
  const needleSin = -Math.sin(needleAngle);

  ctx.beginPath();
  ctx.moveTo(cx - needleCos * r * 0.12, cy - needleSin * r * 0.12);
  ctx.lineTo(cx + needleCos * r * 0.75, cy + needleSin * r * 0.75);
  ctx.strokeStyle = '#FF8800';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  // Label
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.max(8, r * 0.22)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + r * 0.38);

  // Value readout
  ctx.font = `${Math.max(7, r * 0.18)}px monospace`;
  ctx.fillStyle = '#FFCC00';
  ctx.fillText(Math.round(value) + (unit ? ' ' + unit : ''), cx, cy + r * 0.55);

  ctx.restore();
}

/**
 * Draw an attitude indicator (artificial horizon).
 */
function drawAttitudeIndicator(ctx, cx, cy, r, pitch, roll) {
  ctx.save();

  // Clip to circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Background
  ctx.fillStyle = '#111111';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  // Rotate canvas for roll
  ctx.translate(cx, cy);
  ctx.rotate(-roll);

  // Pitch offset (pixels per degree)
  const pxPerDeg = r / 20;
  const pitchDeg = pitch * (180 / Math.PI);
  const yOff = pitchDeg * pxPerDeg;

  // Sky
  ctx.fillStyle = '#3366AA';
  ctx.fillRect(-r * 1.5, -r * 1.5 + yOff, r * 3, r * 1.5);

  // Ground
  ctx.fillStyle = '#885533';
  ctx.fillRect(-r * 1.5, yOff, r * 3, r * 1.5);

  // Horizon line
  ctx.beginPath();
  ctx.moveTo(-r * 1.5, yOff);
  ctx.lineTo(r * 1.5, yOff);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pitch ladder lines
  for (let deg = -30; deg <= 30; deg += 10) {
    if (deg === 0) continue;
    const ly = deg * pxPerDeg + yOff;
    const half = deg > 0 ? r * 0.25 : r * 0.15;
    ctx.beginPath();
    ctx.moveTo(-half, ly);
    ctx.lineTo(half, ly);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `${Math.max(7, r * 0.15)}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(Math.abs(deg).toString(), -half - 3, ly + 3);
  }

  // 5-degree marks (shorter)
  for (let deg = -25; deg <= 25; deg += 10) {
    const ly = deg * pxPerDeg + yOff;
    const half = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(-half, ly);
    ctx.lineTo(half, ly);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  // Aircraft symbol (orange triangle at center)
  ctx.beginPath();
  ctx.moveTo(cx, cy + 3);
  ctx.lineTo(cx - 18, cy + 10);
  ctx.lineTo(cx + 18, cy + 10);
  ctx.closePath();
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  // Bank angle pointer at top
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  ctx.beginPath();
  ctx.moveTo(0, -r + 4);
  ctx.lineTo(-5, -r + 12);
  ctx.lineTo(5, -r + 12);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // Bank angle reference marks (at the circle edge)
  ctx.save();
  ctx.translate(cx, cy);
  const bankMarks = [0, 10, 20, 30, 45, 60];
  for (const bm of bankMarks) {
    for (const side of [-1, 1]) {
      const bAngle = -Math.PI / 2 + side * bm * DEG;
      const x1 = Math.cos(bAngle) * (r - 2);
      const y1 = Math.sin(bAngle) * (r - 2);
      const x2 = Math.cos(bAngle) * (r - (bm % 30 === 0 ? 10 : 6));
      const y2 = Math.sin(bAngle) * (r - (bm % 30 === 0 ? 10 : 6));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = bm === 0 ? 0 : 1;
      ctx.stroke();
    }
  }
  ctx.restore();

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw a heading indicator (directional gyro).
 */
function drawHeadingIndicator(ctx, cx, cy, r, heading) {
  ctx.save();

  // Clip to circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Background
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, '#1a1a1a');
  grad.addColorStop(1, '#111111');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Rotating compass card
  ctx.translate(cx, cy);
  ctx.rotate(-heading * DEG);

  const cardLabels = {
    0: 'N', 90: 'E', 180: 'S', 270: 'W'
  };

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(8, r * 0.2)}px monospace`;

  for (let deg = 0; deg < 360; deg += 10) {
    const angle = deg * DEG - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Major tick every 30, medium every 10
    const isMajor = deg % 30 === 0;
    const innerR = isMajor ? r * 0.65 : r * 0.78;
    const outerR = r * 0.88;

    ctx.beginPath();
    ctx.moveTo(cos * innerR, sin * innerR);
    ctx.lineTo(cos * outerR, sin * outerR);
    ctx.lineWidth = isMajor ? 1.5 : 0.7;
    ctx.stroke();

    // Labels at major ticks
    if (isMajor) {
      const labelR = r * 0.5;
      const text = cardLabels[deg] || (deg / 10).toString();
      ctx.save();
      ctx.translate(cos * labelR, sin * labelR);
      ctx.rotate(deg * DEG);
      ctx.fillStyle = cardLabels[deg] ? '#FF8800' : '#FFFFFF';
      ctx.font = cardLabels[deg]
        ? `bold ${Math.max(9, r * 0.25)}px monospace`
        : `${Math.max(7, r * 0.18)}px monospace`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Fixed aircraft symbol at center
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx - 4, cy + 5);
  ctx.lineTo(cx + 4, cy + 5);
  ctx.closePath();
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  // Lubber line at top
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.lineTo(cx, cy - r + 14);
  ctx.strokeStyle = '#FF8800';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Heading readout
  ctx.fillStyle = '#FFCC00';
  ctx.font = `bold ${Math.max(8, r * 0.2)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(((heading % 360) + 360) % 360) + '\u00B0', cx, cy + r * 0.78);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw a glass-cockpit PFD (primary flight display) for jets.
 */
function drawGlassPFD(ctx, x, y, w, h, state) {
  ctx.save();

  // Background
  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(x, y, w, h);

  const midX = x + w * 0.5;
  const midY = y + h * 0.45;
  const aiSize = Math.min(w * 0.32, h * 0.55);

  // ── Attitude Indicator (center) ──
  const aiCx = midX;
  const aiCy = midY;
  const aiR = aiSize;

  ctx.save();
  ctx.beginPath();
  ctx.rect(midX - aiR, midY - aiR, aiR * 2, aiR * 2);
  ctx.clip();

  const pitch = state.euler ? state.euler.x : 0;
  const roll = state.euler ? state.euler.z : 0;

  ctx.translate(aiCx, aiCy);
  ctx.rotate(-roll);

  const pxPerDeg = aiR / 18;
  const pitchDeg = pitch * (180 / Math.PI);
  const yOff = pitchDeg * pxPerDeg;

  // Sky
  ctx.fillStyle = '#3366AA';
  ctx.fillRect(-aiR * 2, -aiR * 2 + yOff, aiR * 4, aiR * 2);
  // Ground
  ctx.fillStyle = '#885533';
  ctx.fillRect(-aiR * 2, yOff, aiR * 4, aiR * 2);
  // Horizon
  ctx.beginPath();
  ctx.moveTo(-aiR * 2, yOff);
  ctx.lineTo(aiR * 2, yOff);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pitch ladder
  for (let deg = -20; deg <= 20; deg += 5) {
    if (deg === 0) continue;
    const ly = deg * pxPerDeg + yOff;
    const half = Math.abs(deg) % 10 === 0 ? aiR * 0.3 : aiR * 0.15;
    ctx.beginPath();
    ctx.moveTo(-half, ly);
    ctx.lineTo(half, ly);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.abs(deg) % 10 === 0 ? 1.2 : 0.6;
    ctx.stroke();
    if (Math.abs(deg) % 10 === 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(Math.abs(deg).toString(), -half - 3, ly + 3);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Aircraft symbol
  ctx.strokeStyle = '#FF8800';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(aiCx - 25, aiCy);
  ctx.lineTo(aiCx - 8, aiCy);
  ctx.lineTo(aiCx - 5, aiCy + 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(aiCx + 25, aiCy);
  ctx.lineTo(aiCx + 8, aiCy);
  ctx.lineTo(aiCx + 5, aiCy + 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(aiCx, aiCy, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  ctx.restore();

  // ── Speed Tape (left side) ──
  const spdX = x + 5;
  const spdW = w * 0.15;
  const spdH = h * 0.7;
  const spdY0 = y + h * 0.1;
  const speed = state.speed * MS_TO_KNOTS;

  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(spdX, spdY0, spdW, spdH);
  ctx.strokeStyle = '#334455';
  ctx.lineWidth = 1;
  ctx.strokeRect(spdX, spdY0, spdW, spdH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(spdX, spdY0, spdW, spdH);
  ctx.clip();

  const spdMidY = spdY0 + spdH / 2;
  const spdPxPerKt = spdH / 80;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';

  for (let spd = Math.floor(speed / 10) * 10 - 40; spd <= speed + 40; spd += 10) {
    if (spd < 0) continue;
    const ty = spdMidY - (spd - speed) * spdPxPerKt;
    ctx.beginPath();
    ctx.moveTo(spdX + spdW - 5, ty);
    ctx.lineTo(spdX + spdW, ty);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText(spd.toString(), spdX + spdW - 7, ty + 3);
  }
  ctx.restore();

  // Speed box
  ctx.fillStyle = '#000000';
  ctx.fillRect(spdX, spdMidY - 10, spdW, 20);
  ctx.strokeStyle = '#00CC44';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(spdX, spdMidY - 10, spdW, 20);
  ctx.fillStyle = '#00FF44';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(speed).toString(), spdX + spdW / 2, spdMidY + 4);

  // ── Altitude Tape (right side) ──
  const altX = x + w - 5 - w * 0.18;
  const altW = w * 0.18;
  const altH = spdH;
  const altY0 = spdY0;
  const alt = state.altitude * M_TO_FEET;

  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(altX, altY0, altW, altH);
  ctx.strokeStyle = '#334455';
  ctx.lineWidth = 1;
  ctx.strokeRect(altX, altY0, altW, altH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(altX, altY0, altW, altH);
  ctx.clip();

  const altMidY = altY0 + altH / 2;
  const altPxPerFt = altH / 800;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';

  for (let a = Math.floor(alt / 100) * 100 - 400; a <= alt + 400; a += 100) {
    const ty = altMidY - (a - alt) * altPxPerFt;
    ctx.beginPath();
    ctx.moveTo(altX, ty);
    ctx.lineTo(altX + 5, ty);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText(a.toString(), altX + 7, ty + 3);
  }
  ctx.restore();

  // Altitude box
  ctx.fillStyle = '#000000';
  ctx.fillRect(altX, altMidY - 10, altW, 20);
  ctx.strokeStyle = '#00CC44';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(altX, altMidY - 10, altW, 20);
  ctx.fillStyle = '#00FF44';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(alt).toString(), altX + altW / 2, altMidY + 4);

  // ── VS indicator (far right, thin bar) ──
  const vsX = altX + altW + 2;
  const vsW = 12;
  const vsH = altH * 0.6;
  const vsY0a = altY0 + (altH - vsH) / 2;
  const vs = state.verticalSpeed * MS_TO_FPM;

  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(vsX, vsY0a, vsW, vsH);

  const vsMid = vsY0a + vsH / 2;
  const vsClamp = Math.max(-3000, Math.min(3000, vs));
  const vsBarH = (vsClamp / 3000) * (vsH / 2);
  ctx.fillStyle = vs >= 0 ? '#00CC44' : '#FF2200';
  ctx.fillRect(vsX + 1, vsMid - Math.max(0, vsBarH), vsW - 2, Math.abs(vsBarH));

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(vs).toString(), vsX + vsW / 2, vsMid + vsH / 2 + 10);

  // ── Heading (bottom strip) ──
  const hdgY = y + h - 28;
  const hdgH = 22;
  const hdgX0 = x + w * 0.2;
  const hdgW = w * 0.6;
  const hdg = ((state.heading || 0) % 360 + 360) % 360;

  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(hdgX0, hdgY, hdgW, hdgH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(hdgX0, hdgY, hdgW, hdgH);
  ctx.clip();

  const hdgMidX = hdgX0 + hdgW / 2;
  const hdgPxPerDeg = hdgW / 60;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  const cardinals = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

  for (let d = Math.floor(hdg / 10) * 10 - 30; d <= hdg + 30; d += 5) {
    const dd = ((d % 360) + 360) % 360;
    const px = hdgMidX + (d - hdg) * hdgPxPerDeg;
    if (d % 10 === 0) {
      ctx.beginPath();
      ctx.moveTo(px, hdgY);
      ctx.lineTo(px, hdgY + 6);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.stroke();
      const lbl = cardinals[dd] || dd.toString();
      ctx.fillStyle = cardinals[dd] ? '#FF8800' : '#FFFFFF';
      ctx.fillText(lbl, px, hdgY + 16);
    } else {
      ctx.beginPath();
      ctx.moveTo(px, hdgY);
      ctx.lineTo(px, hdgY + 4);
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
  ctx.restore();

  // Heading triangle pointer
  ctx.beginPath();
  ctx.moveTo(hdgMidX, hdgY);
  ctx.lineTo(hdgMidX - 4, hdgY - 5);
  ctx.lineTo(hdgMidX + 4, hdgY - 5);
  ctx.closePath();
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  // Border
  ctx.strokeStyle = '#334455';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  ctx.restore();
}

/**
 * Prop aircraft instrument panel: six-pack + engine gauges.
 */
function drawPropPanel(ctx, state, w, h) {
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, w, h);

  const speed = state.speed * MS_TO_KNOTS;
  const alt = state.altitude * M_TO_FEET;
  const vs = state.verticalSpeed * MS_TO_FPM;
  const hdg = ((state.heading || 0) % 360 + 360) % 360;
  const pitch = state.euler ? state.euler.x : 0;
  const roll = state.euler ? state.euler.z : 0;
  const throttle = state.throttle * 100;
  const aoaDeg = state.aoa * (180 / Math.PI);

  // ── Left column (0-180): Engine gauges 2x2 ──
  const engR = 38;
  const engStartX = 50;
  const engStartY = 60;
  const engSpacingX = 80;
  const engSpacingY = 100;

  // RPM
  drawRoundGauge(ctx, engStartX, engStartY, engR, throttle * 27.5, 0, 2750, 'RPM', '', [
    { min: 0, max: 1800, color: '#00CC44' },
    { min: 1800, max: 2500, color: '#FFCC00' },
    { min: 2500, max: 2750, color: '#FF2200' },
  ], 5);

  // Manifold Pressure
  drawRoundGauge(ctx, engStartX + engSpacingX, engStartY, engR,
    15 + throttle * 0.15, 10, 30, 'MAN', 'inHg', [
    { min: 10, max: 25, color: '#00CC44' },
    { min: 25, max: 30, color: '#FF2200' },
  ], 4);

  // Oil Temp
  drawRoundGauge(ctx, engStartX, engStartY + engSpacingY, engR,
    75 + throttle * 0.6, 50, 250, 'OIL T', '\u00B0F', [
    { min: 50, max: 100, color: '#FFCC00' },
    { min: 100, max: 200, color: '#00CC44' },
    { min: 200, max: 250, color: '#FF2200' },
  ], 4);

  // Oil Pressure
  drawRoundGauge(ctx, engStartX + engSpacingX, engStartY + engSpacingY, engR,
    25 + throttle * 0.55, 0, 100, 'OIL P', 'psi', [
    { min: 0, max: 25, color: '#FF2200' },
    { min: 25, max: 80, color: '#00CC44' },
    { min: 80, max: 100, color: '#FF2200' },
  ], 5);

  // ── Center (180-730): Six Pack 3x2 ──
  const spR = 68;
  const spStartX = 290;
  const spStartY = 85;
  const spSpacingX = 155;
  const spSpacingY = 175;

  // Top row: ASI, AI, ALT
  // Airspeed Indicator
  drawRoundGauge(ctx, spStartX, spStartY, spR, speed, 0, 300, 'KIAS', 'kt', [
    { min: 0, max: 60, color: '#FF2200' },
    { min: 60, max: 160, color: '#00CC44' },
    { min: 160, max: 230, color: '#FFCC00' },
    { min: 230, max: 300, color: '#FF2200' },
  ], 6);

  // Attitude Indicator
  drawAttitudeIndicator(ctx, spStartX + spSpacingX, spStartY, spR, pitch, roll);

  // Altimeter
  drawRoundGauge(ctx, spStartX + spSpacingX * 2, spStartY, spR, alt % 10000, 0, 10000, 'ALT', 'ft', null, 10);

  // Alt readout (additional thousands)
  ctx.fillStyle = '#FFCC00';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(alt) + ' ft', spStartX + spSpacingX * 2, spStartY + spR * 0.72);

  // Bottom row: Turn Coord, DG (heading), VSI
  // Turn Coordinator (simplified as AoA / slip indicator)
  drawRoundGauge(ctx, spStartX, spStartY + spSpacingY, spR, aoaDeg, -10, 30, 'AoA', '\u00B0', [
    { min: -10, max: 15, color: '#00CC44' },
    { min: 15, max: 22, color: '#FFCC00' },
    { min: 22, max: 30, color: '#FF2200' },
  ], 8);

  // Heading Indicator (DG)
  drawHeadingIndicator(ctx, spStartX + spSpacingX, spStartY + spSpacingY, spR, hdg);

  // VSI
  drawRoundGauge(ctx, spStartX + spSpacingX * 2, spStartY + spSpacingY, spR, vs, -3000, 3000, 'VS', 'fpm', [
    { min: -3000, max: -1500, color: '#FF2200' },
    { min: -1500, max: 1500, color: '#00CC44' },
    { min: 1500, max: 3000, color: '#FFCC00' },
  ], 6);

  // ── Right column (730-920): Fuel / Eng gauges 2x2 ──
  const frR = 38;
  const frStartX = 790;
  const frStartY = 60;
  const frSpacingX = 80;
  const frSpacingY = 100;

  // Fuel L
  drawRoundGauge(ctx, frStartX, frStartY, frR, 65, 0, 100, 'FUEL L', '%', [
    { min: 0, max: 15, color: '#FF2200' },
    { min: 15, max: 100, color: '#00CC44' },
  ], 4);

  // Fuel R
  drawRoundGauge(ctx, frStartX + frSpacingX, frStartY, frR, 63, 0, 100, 'FUEL R', '%', [
    { min: 0, max: 15, color: '#FF2200' },
    { min: 15, max: 100, color: '#00CC44' },
  ], 4);

  // EGT
  drawRoundGauge(ctx, frStartX, frStartY + frSpacingY, frR,
    200 + throttle * 6.5, 0, 900, 'EGT', '\u00B0C', [
    { min: 0, max: 700, color: '#00CC44' },
    { min: 700, max: 900, color: '#FF2200' },
  ], 4);

  // CHT
  drawRoundGauge(ctx, frStartX + frSpacingX, frStartY + frSpacingY, frR,
    100 + throttle * 2.5, 50, 500, 'CHT', '\u00B0F', [
    { min: 50, max: 300, color: '#00CC44' },
    { min: 300, max: 400, color: '#FFCC00' },
    { min: 400, max: 500, color: '#FF2200' },
  ], 4);

  // ── Radio freq display (bottom-right area) ──
  const radioX = 750;
  const radioY = 210;
  ctx.fillStyle = '#0a0f0a';
  ctx.fillRect(radioX, radioY, 180, 55);
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.strokeRect(radioX, radioY, 180, 55);

  ctx.fillStyle = '#00FF44';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('COM1 124.85', radioX + 8, radioY + 18);
  ctx.fillText('NAV1 110.30', radioX + 8, radioY + 36);
  ctx.fillStyle = '#00AA33';
  ctx.font = '10px monospace';
  ctx.fillText('XPDR 1200', radioX + 8, radioY + 50);

  // ── Throttle / Flaps status (bottom) ──
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('THR: ' + Math.round(throttle) + '%', 10, h - 30);
  ctx.fillText('FLAP: ' + (state.flaps ? 'DN' : 'UP'), 10, h - 15);
  ctx.fillText('GEAR: ' + (state.gear ? 'DN' : 'UP'), 100, h - 15);
  ctx.fillText('BRK: ' + (state.speedbrake ? 'ON' : 'OFF'), 100, h - 30);

  // G-force
  ctx.fillStyle = '#FF8800';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('G: ' + (state.gForce || 1).toFixed(1), w - 10, h - 15);
}

/**
 * Jet airliner instrument panel: dual PFDs + engine gauges.
 */
function drawJetPanel(ctx, state, w, h) {
  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(0, 0, w, h);

  const throttle = state.throttle * 100;

  // ── Left PFD ──
  drawGlassPFD(ctx, 10, 5, w * 0.35, h * 0.95, state);

  // ── Right PFD ──
  drawGlassPFD(ctx, w * 0.58, 5, w * 0.35, h * 0.95, state);

  // ── Center: Engine Gauges as bar graphs ──
  const engX = w * 0.37;
  const engW = w * 0.2;
  const engTop = 15;

  ctx.fillStyle = '#0A0F1A';
  ctx.fillRect(engX, 0, engW, h);
  ctx.strokeStyle = '#334455';
  ctx.lineWidth = 1;
  ctx.strokeRect(engX, 0, engW, h);

  // Title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ENGINE', engX + engW / 2, engTop);

  const barW = 18;
  const barH = h * 0.22;
  const barGap = (engW - barW * 4) / 5;
  const barLabels = ['N1', 'N2', 'EGT', 'FF'];
  const barValues = [
    throttle,                     // N1 %
    throttle * 0.95,              // N2 %
    (250 + throttle * 7) / 1000 * 100, // EGT normalized to 0-100
    throttle * 0.8,               // Fuel flow normalized
  ];
  const barColors = ['#00CC44', '#00CC44', '#FF8800', '#3388FF'];
  const barMaxLabels = ['100%', '100%', '1000\u00B0C', '100%'];

  for (let i = 0; i < 4; i++) {
    const bx = engX + barGap + i * (barW + barGap);
    const by = engTop + 15;
    const fillH = (barValues[i] / 100) * barH;

    // Bar background
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(bx, by, barW, barH);

    // Bar fill
    ctx.fillStyle = barColors[i];
    ctx.fillRect(bx, by + barH - fillH, barW, fillH);

    // Bar outline
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(bx, by, barW, barH);

    // Label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(barLabels[i], bx + barW / 2, by + barH + 12);

    // Value
    ctx.fillStyle = barColors[i];
    ctx.font = 'bold 9px monospace';
    ctx.fillText(Math.round(barValues[i]) + '%', bx + barW / 2, by - 4);
  }

  // ── ECAM Messages Area ──
  const ecamY = engTop + barH + 40;
  ctx.fillStyle = '#0a0f0a';
  ctx.fillRect(engX + 5, ecamY, engW - 10, h - ecamY - 10);
  ctx.strokeStyle = '#333333';
  ctx.strokeRect(engX + 5, ecamY, engW - 10, h - ecamY - 10);

  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  const msgs = [];
  if (state.gear) msgs.push({ text: 'GEAR DN', color: '#00CC44' });
  else msgs.push({ text: 'GEAR UP', color: '#FFFFFF' });
  if (state.flaps) msgs.push({ text: 'FLAPS DN', color: '#00CC44' });
  if (state.speedbrake) msgs.push({ text: 'SPD BRK', color: '#FF8800' });
  msgs.push({ text: 'THR ' + Math.round(throttle) + '%', color: '#FFFFFF' });
  msgs.push({ text: 'G ' + (state.gForce || 1).toFixed(1), color: '#FF8800' });

  for (let i = 0; i < msgs.length && i < 8; i++) {
    ctx.fillStyle = msgs[i].color;
    ctx.fillText(msgs[i].text, engX + 10, ecamY + 14 + i * 14);
  }
}

/**
 * Fighter HUD-style panel: green on black.
 */
function drawFighterPanel(ctx, state, w, h) {
  ctx.fillStyle = '#0A0A0A';
  ctx.fillRect(0, 0, w, h);

  const hudColor = '#00FF44';
  const hudDim = '#008822';
  const speed = state.speed * MS_TO_KNOTS;
  const alt = state.altitude * M_TO_FEET;
  const vs = state.verticalSpeed * MS_TO_FPM;
  const hdg = ((state.heading || 0) % 360 + 360) % 360;
  const pitch = state.euler ? state.euler.x : 0;
  const roll = state.euler ? state.euler.z : 0;
  const pitchDeg = pitch * (180 / Math.PI);
  const aoaDeg = state.aoa * (180 / Math.PI);
  const throttle = state.throttle * 100;
  const gForce = state.gForce || 1;
  const mach = speed / 661.5; // rough Mach at sea level

  const cx = w / 2;
  const cy = h * 0.45;

  // ── HUD border frame ──
  ctx.strokeStyle = hudDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(5, 5, w - 10, h - 10);

  // ── Flight path marker (center circle with wings) ──
  // Offset by pitch and roll slightly
  const fpmX = cx;
  const fpmY = cy + pitchDeg * 2;

  ctx.strokeStyle = hudColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(fpmX, fpmY, 10, 0, Math.PI * 2);
  ctx.stroke();
  // Wings
  ctx.beginPath();
  ctx.moveTo(fpmX - 10, fpmY);
  ctx.lineTo(fpmX - 25, fpmY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fpmX + 10, fpmY);
  ctx.lineTo(fpmX + 25, fpmY);
  ctx.stroke();
  // Top fin
  ctx.beginPath();
  ctx.moveTo(fpmX, fpmY - 10);
  ctx.lineTo(fpmX, fpmY - 18);
  ctx.stroke();

  // ── Horizon line with pitch ladder ──
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);

  const pxPerDeg = 3;
  const yOff = pitchDeg * pxPerDeg;

  // Horizon line
  ctx.beginPath();
  ctx.moveTo(-w * 0.35, yOff);
  ctx.lineTo(-40, yOff);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(40, yOff);
  ctx.lineTo(w * 0.35, yOff);
  ctx.stroke();

  // Pitch ladder
  ctx.font = '9px monospace';
  ctx.fillStyle = hudColor;
  ctx.textAlign = 'right';
  for (let deg = -30; deg <= 30; deg += 5) {
    if (deg === 0) continue;
    const ly = deg * pxPerDeg + yOff;
    const half = Math.abs(deg) % 10 === 0 ? 30 : 15;
    const isDash = deg < 0;

    if (isDash) {
      // Dashed line for negative pitch
      for (let dx = -half; dx < half; dx += 8) {
        ctx.beginPath();
        ctx.moveTo(dx, ly);
        ctx.lineTo(Math.min(dx + 5, half), ly);
        ctx.strokeStyle = hudColor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(-half, ly);
      ctx.lineTo(half, ly);
      ctx.strokeStyle = hudColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (Math.abs(deg) % 10 === 0) {
      ctx.fillText(Math.abs(deg).toString(), -half - 4, ly + 3);
      ctx.textAlign = 'left';
      ctx.fillText(Math.abs(deg).toString(), half + 4, ly + 3);
      ctx.textAlign = 'right';
    }
  }

  ctx.restore();

  // ── Airspeed (left side) ──
  const spdX = 60;
  const spdBoxY = cy - 8;
  ctx.strokeStyle = hudColor;
  ctx.lineWidth = 1;

  // Speed tape
  ctx.save();
  ctx.beginPath();
  ctx.rect(spdX - 45, cy - 90, 55, 180);
  ctx.clip();

  ctx.font = '10px monospace';
  ctx.fillStyle = hudColor;
  ctx.textAlign = 'right';

  for (let spd = Math.floor(speed / 20) * 20 - 80; spd <= speed + 80; spd += 20) {
    if (spd < 0) continue;
    const ty = cy - (spd - speed) * 1.5;
    ctx.beginPath();
    ctx.moveTo(spdX - 2, ty);
    ctx.lineTo(spdX + 5, ty);
    ctx.stroke();
    ctx.fillText(spd.toString(), spdX - 5, ty + 3);
  }
  ctx.restore();

  // Speed box
  ctx.fillStyle = '#0A0A0A';
  ctx.fillRect(spdX - 45, spdBoxY, 55, 18);
  ctx.strokeStyle = hudColor;
  ctx.strokeRect(spdX - 45, spdBoxY, 55, 18);
  ctx.fillStyle = hudColor;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(speed).toString(), spdX - 17, spdBoxY + 14);

  // Mach number below speed box
  ctx.fillStyle = hudColor;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('M ' + mach.toFixed(2), spdX - 17, spdBoxY + 32);

  // ── Altitude (right side) ──
  const altX = w - 60;
  const altBoxY = cy - 8;

  // Alt tape
  ctx.save();
  ctx.beginPath();
  ctx.rect(altX - 10, cy - 90, 60, 180);
  ctx.clip();

  ctx.font = '10px monospace';
  ctx.fillStyle = hudColor;
  ctx.textAlign = 'left';

  for (let a = Math.floor(alt / 200) * 200 - 800; a <= alt + 800; a += 200) {
    const ty = cy - (a - alt) * 0.15;
    ctx.beginPath();
    ctx.moveTo(altX - 5, ty);
    ctx.lineTo(altX - 2, ty);
    ctx.strokeStyle = hudColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText(a.toString(), altX + 2, ty + 3);
  }
  ctx.restore();

  // Alt box
  ctx.fillStyle = '#0A0A0A';
  ctx.fillRect(altX - 10, altBoxY, 60, 18);
  ctx.strokeStyle = hudColor;
  ctx.strokeRect(altX - 10, altBoxY, 60, 18);
  ctx.fillStyle = hudColor;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(alt).toString(), altX + 20, altBoxY + 14);

  // ── Heading (top strip) ──
  const hdgStripY = 25;
  const hdgStripW = w * 0.5;
  const hdgStripX = (w - hdgStripW) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(hdgStripX, hdgStripY - 5, hdgStripW, 25);
  ctx.clip();

  const hdgMidX = w / 2;
  const hdgPxPerDeg = 4;
  const cardinals = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

  ctx.font = '9px monospace';
  ctx.textAlign = 'center';

  for (let d = Math.floor(hdg / 5) * 5 - 30; d <= hdg + 30; d += 5) {
    const dd = ((d % 360) + 360) % 360;
    const px = hdgMidX + (d - hdg) * hdgPxPerDeg;
    if (d % 10 === 0) {
      ctx.beginPath();
      ctx.moveTo(px, hdgStripY);
      ctx.lineTo(px, hdgStripY + 6);
      ctx.strokeStyle = hudColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      const lbl = cardinals[dd] || dd.toString();
      ctx.fillStyle = hudColor;
      ctx.fillText(lbl, px, hdgStripY + 17);
    }
  }
  ctx.restore();

  // Heading caret
  ctx.beginPath();
  ctx.moveTo(hdgMidX, hdgStripY);
  ctx.lineTo(hdgMidX - 5, hdgStripY - 6);
  ctx.lineTo(hdgMidX + 5, hdgStripY - 6);
  ctx.closePath();
  ctx.fillStyle = hudColor;
  ctx.fill();

  // ── G-Force (large, lower right) ──
  ctx.fillStyle = hudColor;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(gForce.toFixed(1) + 'G', w - 25, h - 30);

  // ── AoA (lower left) ──
  ctx.fillStyle = hudColor;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('\u03B1 ' + aoaDeg.toFixed(1) + '\u00B0', 20, h - 50);

  // ── Throttle bar (far left) ──
  const thrBarX = 15;
  const thrBarY = cy - 80;
  const thrBarH = 160;
  const thrBarW = 8;
  ctx.strokeStyle = hudDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(thrBarX, thrBarY, thrBarW, thrBarH);
  const thrFill = (throttle / 100) * thrBarH;
  ctx.fillStyle = hudColor;
  ctx.fillRect(thrBarX, thrBarY + thrBarH - thrFill, thrBarW, thrFill);
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('THR', thrBarX + thrBarW / 2, thrBarY - 5);
  ctx.fillText(Math.round(throttle) + '%', thrBarX + thrBarW / 2, thrBarY + thrBarH + 12);

  // ── VS readout ──
  ctx.fillStyle = hudColor;
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('VS ' + Math.round(vs) + ' fpm', w - 25, h - 50);

  // ── Status line (bottom center) ──
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = hudDim;
  const statusParts = [];
  if (state.gear) statusParts.push('GEAR');
  if (state.flaps) statusParts.push('FLAP');
  if (state.speedbrake) statusParts.push('BRK');
  if (statusParts.length > 0) {
    ctx.fillStyle = hudColor;
    ctx.fillText(statusParts.join(' | '), cx, h - 12);
  }
}



// Blinking lights
let beaconMesh, strobeLeftMesh, strobeRightMesh;

// Nav point lights
let navLightLeft, navLightRight;

// Tail logo light
let tailLogoLight = null;

export function setSpawnLocation(loc) {
  spawnLocation = loc;
}

export function getSpawnLocation() {
  return spawnLocation;
}

export function resetAircraft() {
  // Check if this is an approach spawn
  const approachSpawn = getApproachSpawn(spawnLocation, aircraftState.config);

  if (approachSpawn) {
    // Airborne approach spawn
    aircraftState.position.set(approachSpawn.x, approachSpawn.y, approachSpawn.z);

    // Face north (+Z toward runway): rotate 180deg around Y
    // Default forward is (0,0,-1), rotating PI makes it (0,0,+1)
    aircraftState.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    aircraftState.euler.setFromQuaternion(aircraftState.quaternion, 'YXZ');

    // Velocity toward runway (+Z) with slight descent on 3-deg glideslope
    const descentRate = Math.sin(3 * Math.PI / 180) * approachSpawn.speed;
    aircraftState.velocity.set(0, -descentRate, approachSpawn.speed);
    aircraftState.speed = approachSpawn.speed;
    aircraftState.altitude = approachSpawn.y;
    aircraftState.altitudeAGL = approachSpawn.y;
    aircraftState.verticalSpeed = -descentRate;
    aircraftState.throttle = approachSpawn.throttle;
    aircraftState.flaps = approachSpawn.flapsDown;
    aircraftState.gear = approachSpawn.gearDown;
    aircraftState.speedbrake = false;
    aircraftState.onGround = false;
    aircraftState.heading = 360;
    aircraftState.aoa = 0;
    aircraftState.propSpeed = 0;
    aircraftState.gForce = 1;
  } else {
    // Ground spawn
    const spawn = SPAWN_POSITIONS[spawnLocation] || SPAWN_POSITIONS.runway;

    aircraftState.position.set(spawn.x, 1.5, spawn.z);
    aircraftState.velocity.set(0, 0, 0);
    aircraftState.quaternion.identity();
    aircraftState.euler.set(0, 0, 0);
    aircraftState.speed = 0;
    aircraftState.altitude = 0;
    aircraftState.altitudeAGL = 0;
    aircraftState.verticalSpeed = 0;
    aircraftState.throttle = 0;
    aircraftState.flaps = false;
    aircraftState.gear = true;
    aircraftState.speedbrake = false;
    aircraftState.onGround = true;
    aircraftState.heading = 0;
    aircraftState.aoa = 0;
    aircraftState.propSpeed = 0;
    aircraftState.gForce = 1;

    if (spawn.heading) {
      aircraftState.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.heading);
      aircraftState.euler.setFromQuaternion(aircraftState.quaternion, 'YXZ');
      aircraftState.heading = ((spawn.heading * 180) / Math.PI + 360) % 360;
    }
  }

  if (aircraftGroup) {
    aircraftGroup.position.copy(aircraftState.position);
    aircraftGroup.quaternion.copy(aircraftState.quaternion);
  }
}

function loadAircraftConfig(typeName) {
  const type = getAircraftType(typeName);
  aircraftState.config = {
    mass: type.mass,
    maxThrust: type.maxThrust,
    wingArea: type.wingArea,
    pitchRate: type.pitchRate,
    rollRate: type.rollRate,
    yawRate: type.yawRate,
    stallAoa: type.stallAoa,
    takeoffSpeed: type.takeoffSpeed,
    type: type.type,
    wingspan: type.wingSpan || 14,
  };
  aircraftState.currentType = typeName;
}

export function createAircraft(scene, typeName) {
  sceneRef = scene;
  typeName = typeName || 'cessna_172';
  loadAircraftConfig(typeName);

  const type = getAircraftType(typeName);
  buildAircraftModel(scene, type);

  resetAircraft();
  scene.add(aircraftGroup);
  return aircraftGroup;
}

export function switchAircraft(typeName) {
  if (!sceneRef) return;
  if (aircraftGroup) {
    sceneRef.remove(aircraftGroup);
    // Dispose geometries/materials
    aircraftGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  // Remove old contrails
  if (contrailLeft) { sceneRef.remove(contrailLeft); contrailLeft = null; }
  if (contrailRight) { sceneRef.remove(contrailRight); contrailRight = null; }

  loadAircraftConfig(typeName);
  const type = getAircraftType(typeName);
  buildAircraftModel(sceneRef, type);

  resetAircraft();
  sceneRef.add(aircraftGroup);
}

// ─── Geometry helpers ───

function createFuselageGeo(length, radius, noseLen, tailLen, segments) {
  const points = [];
  const n = 28;
  const noseFrac = noseLen / length;
  const tailFrac = tailLen / length;

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r;
    if (t < noseFrac) {
      const nt = t / noseFrac;
      r = radius * Math.sin(nt * Math.PI * 0.5); // ogive nose
    } else if (t > 1 - tailFrac) {
      const tt = (t - (1 - tailFrac)) / tailFrac;
      r = radius * Math.cos(tt * Math.PI * 0.5) * 0.95 + radius * 0.05;
    } else {
      r = radius;
    }
    points.push(new THREE.Vector2(Math.max(r, 0.02), (t - 0.5) * length));
  }

  const geo = new THREE.LatheGeometry(points, segments || 20);
  geo.rotateX(Math.PI / 2);
  return geo;
}

function createTaperedWing(span, rootChord, tipChord, sweep, rootThick, tipThick, dihedral) {
  const segsX = 16;
  const segsZ = 4;
  const geo = new THREE.BoxGeometry(span, rootThick, rootChord, segsX, 1, segsZ);
  const pos = geo.attributes.position;
  const halfSpan = span / 2;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const sf = Math.abs(x) / halfSpan; // 0 at root, 1 at tip

    // Taper chord
    const localChord = rootChord * (1 - sf * (1 - tipChord / rootChord));
    z = z * (localChord / rootChord);

    // Sweep leading edge
    z += sf * sweep;

    // Thickness taper
    const thickness = rootThick * (1 - sf * (1 - tipThick / rootThick));
    y = y * (thickness / rootThick);

    // Airfoil shape: thicker near leading edge
    const chordFrac = (z / rootChord + 0.5);
    if (y > 0) {
      y += Math.sin(Math.max(0, Math.min(1, chordFrac)) * Math.PI) * rootThick * 0.4 * (1 - sf * 0.5);
    }

    // Dihedral
    y += Math.abs(x) * Math.tan(dihedral || 0.03);

    pos.setX(i, x);
    pos.setY(i, y);
    pos.setZ(i, z);
  }

  geo.computeVertexNormals();
  return geo;
}

function createNacelle(scene, group, x, y, z, radius, length, mat, chromeMat) {
  // Nacelle body
  const nacPts = [];
  const ns = 12;
  for (let i = 0; i <= ns; i++) {
    const t = i / ns;
    let r;
    if (t < 0.15) {
      r = radius * (0.7 + 0.3 * (t / 0.15)); // intake lip
    } else if (t > 0.85) {
      r = radius * (1 - (t - 0.85) / 0.15 * 0.3); // exhaust taper
    } else {
      r = radius;
    }
    nacPts.push(new THREE.Vector2(r, (t - 0.5) * length));
  }
  const nacGeo = new THREE.LatheGeometry(nacPts, 14);
  nacGeo.rotateX(Math.PI / 2);
  const nac = new THREE.Mesh(nacGeo, mat);
  nac.position.set(x, y, z);
  nac.castShadow = true;
  group.add(nac);

  // Intake ring highlight
  const ringGeo = new THREE.TorusGeometry(radius * 0.95, radius * 0.08, 8, 20);
  const ring = new THREE.Mesh(ringGeo, chromeMat);
  ring.position.set(x, y, z - length * 0.48);
  group.add(ring);

  // Fan face (dark circle)
  const fanGeo = new THREE.CircleGeometry(radius * 0.85, 16);
  const fanMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.4 });
  const fan = new THREE.Mesh(fanGeo, fanMat);
  fan.position.set(x, y, z - length * 0.47);
  fan.rotation.y = Math.PI;
  group.add(fan);

  // Exhaust (slightly glowing inner ring)
  const exGeo = new THREE.CircleGeometry(radius * 0.65, 12);
  const exMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.2 });
  const ex = new THREE.Mesh(exGeo, exMat);
  ex.position.set(x, y, z + length * 0.49);
  group.add(ex);

  // Pylon connecting nacelle to wing
  const pylonGeo = new THREE.BoxGeometry(0.15, Math.abs(y) * 0.4, length * 0.6);
  const pylon = new THREE.Mesh(pylonGeo, mat);
  pylon.position.set(x, y + Math.abs(y) * 0.25, z + length * 0.1);
  group.add(pylon);
}

// ─── Main model builder ───

function buildAircraftModel(scene, type) {
  aircraftGroup = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.3, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: type.accentColor, roughness: 0.4, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.1, metalness: 0.8 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0x661111, emissiveIntensity: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccdd, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35,
  });
  const aileronMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.35 });

  const fLen = type.fuselageLength;
  const fRad = type.fuselageRadius;
  const wSpan = type.wingSpan;

  // ── Fuselage (smooth LatheGeometry) ──
  const noseLen = type.type === 'fighter' ? fLen * 0.3 : fLen * 0.2;
  const tailLen = type.type === 'fighter' ? fLen * 0.2 : fLen * 0.25;
  const fuselageGeo = createFuselageGeo(fLen, fRad, noseLen, tailLen, 20);
  const fuselage = new THREE.Mesh(fuselageGeo, bodyMat);
  fuselage.castShadow = true;
  aircraftGroup.add(fuselage);

  // Accent stripe along fuselage
  const stripeGeo = new THREE.CylinderGeometry(fRad + 0.02, fRad * 0.95, fLen * 0.5, 20, 1, false, -0.25, 0.5);
  stripeGeo.rotateX(Math.PI / 2);
  const stripe = new THREE.Mesh(stripeGeo, accentMat);
  stripe.position.z = fLen * 0.05;
  aircraftGroup.add(stripe);

  // ── Wings (per aircraft type) ──
  const isHighWing = type.type === 'prop'; // Cessna = high wing
  const wingY = isHighWing ? fRad * 0.7 : -fRad * 0.15;
  const wingZ = type.type === 'fighter' ? fLen * 0.05 : -fLen * 0.05;
  const rootChord = fLen * 0.22;
  const tipRatio = type.type === 'fighter' ? 0.3 : 0.55;
  const tipChord = rootChord * tipRatio;
  const rootThick = type.type === 'fighter' ? 0.12 : 0.22;
  const tipThick = rootThick * 0.5;
  const dihedral = type.type === 'fighter' ? -0.02 : (isHighWing ? 0.01 : 0.04);

  const wingGeo = createTaperedWing(wSpan, rootChord, tipChord, type.wingSweep * rootChord, rootThick, tipThick, dihedral);
  const wings = new THREE.Mesh(wingGeo, bodyMat);
  wings.position.set(0, wingY, wingZ);
  wings.castShadow = true;
  aircraftGroup.add(wings);

  // Wing root fairing (smooth blend into fuselage)
  if (!isHighWing) {
    for (const side of [-1, 1]) {
      const fairGeo = new THREE.SphereGeometry(fRad * 0.6, 8, 6);
      fairGeo.scale(1.2, 0.5, 2.0);
      const fair = new THREE.Mesh(fairGeo, bodyMat);
      fair.position.set(side * fRad * 0.5, wingY + 0.05, wingZ);
      aircraftGroup.add(fair);
    }
  }

  // Wing struts for high-wing Cessna
  if (isHighWing) {
    for (const side of [-1, 1]) {
      const strutLen = fRad * 1.8;
      const strutGeo = new THREE.CylinderGeometry(0.03, 0.03, strutLen, 4);
      const strut = new THREE.Mesh(strutGeo, chromeMat);
      strut.position.set(side * wSpan * 0.2, wingY * 0.35, wingZ + rootChord * 0.2);
      strut.rotation.z = side * 0.15;
      aircraftGroup.add(strut);
    }
  }

  // Winglets (737 and A320)
  if (type.type === 'jet') {
    const wingletHeight = type.name.includes('A320') ? rootChord * 1.2 : rootChord * 0.6;
    for (const side of [-1, 1]) {
      const wlGeo = new THREE.BoxGeometry(0.08, wingletHeight, rootChord * 0.35);
      const wlPos = wlGeo.attributes.position;
      for (let i = 0; i < wlPos.count; i++) {
        if (wlPos.getY(i) > 0) {
          wlPos.setX(i, wlPos.getX(i) + side * wingletHeight * 0.1);
          wlPos.setZ(i, wlPos.getZ(i) - wingletHeight * 0.08);
        }
      }
      wlGeo.computeVertexNormals();
      const wl = new THREE.Mesh(wlGeo, accentMat);
      const tipY = wingY + wSpan / 2 * Math.tan(dihedral);
      wl.position.set(side * (wSpan / 2 + 0.02), tipY + wingletHeight * 0.4, wingZ + type.wingSweep * rootChord);
      aircraftGroup.add(wl);
    }
  }

  // Ailerons (animated control surfaces)
  const aileronGeo = new THREE.BoxGeometry(wSpan * 0.22, 0.06, rootChord * 0.2);
  rightAileron = new THREE.Mesh(aileronGeo, aileronMat);
  rightAileron.position.set(wSpan * 0.33, wingY - 0.05, wingZ + rootChord * 0.35);
  aircraftGroup.add(rightAileron);

  leftAileron = new THREE.Mesh(aileronGeo, aileronMat);
  leftAileron.position.set(-wSpan * 0.33, wingY - 0.05, wingZ + rootChord * 0.35);
  aircraftGroup.add(leftAileron);

  // ── Tail section ──
  const tailZ = fLen * 0.4;

  // Horizontal stabilizer
  const hStabSpan = wSpan * 0.35;
  const hStabChord = fLen * 0.12;
  const hStabGeo = createTaperedWing(hStabSpan, hStabChord, hStabChord * 0.6, type.wingSweep * hStabChord * 0.5, 0.08, 0.04, 0);
  const hStab = new THREE.Mesh(hStabGeo, bodyMat);
  hStab.position.set(0, fRad * 0.3, tailZ);
  hStab.castShadow = true;
  aircraftGroup.add(hStab);

  // Elevator (animated)
  const elevGeo = new THREE.BoxGeometry(hStabSpan * 0.7, 0.05, hStabChord * 0.3);
  elevator = new THREE.Mesh(elevGeo, aileronMat);
  elevator.position.set(0, fRad * 0.28, tailZ + hStabChord * 0.45);
  aircraftGroup.add(elevator);

  // Vertical stabilizer (swept)
  const tH = type.tailHeight;
  const vStabGeo = new THREE.BoxGeometry(0.1, tH, fLen * 0.18, 1, 4, 2);
  const vp = vStabGeo.attributes.position;
  for (let i = 0; i < vp.count; i++) {
    const y = vp.getY(i);
    if (y > 0) {
      vp.setZ(i, vp.getZ(i) - y * 0.25); // sweep top backward
      vp.setX(i, vp.getX(i)); // keep centered
    }
  }
  vStabGeo.computeVertexNormals();
  const vStab = new THREE.Mesh(vStabGeo, accentMat);
  vStab.position.set(0, fRad * 0.3 + tH * 0.5, tailZ - fLen * 0.02);
  vStab.castShadow = true;
  aircraftGroup.add(vStab);

  // Rudder (animated)
  const rudGeo = new THREE.BoxGeometry(0.08, tH * 0.65, fLen * 0.06);
  rudder = new THREE.Mesh(rudGeo, aileronMat);
  rudder.position.set(0, fRad * 0.3 + tH * 0.4, tailZ + fLen * 0.08);
  aircraftGroup.add(rudder);

  // ── Cockpit ──
  if (type.type === 'fighter') {
    // Bubble canopy
    const canopyGeo = new THREE.SphereGeometry(fRad * 1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
    const canopy = new THREE.Mesh(canopyGeo, glassMat);
    canopy.position.set(0, fRad * 0.6, -fLen * 0.22);
    canopy.rotation.x = -0.15;
    aircraftGroup.add(canopy);
    // Canopy frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });
    const frame = new THREE.Mesh(new THREE.TorusGeometry(fRad * 0.9, 0.03, 6, 16, Math.PI), frameMat);
    frame.position.set(0, fRad * 0.75, -fLen * 0.22);
    frame.rotation.x = -Math.PI * 0.5;
    aircraftGroup.add(frame);
  } else if (type.type === 'prop') {
    // Small windshield for Cessna
    const wsGeo = new THREE.PlaneGeometry(fRad * 1.6, fRad * 1.2);
    const ws = new THREE.Mesh(wsGeo, glassMat);
    ws.position.set(0, fRad * 0.85, -fLen * 0.28);
    ws.rotation.x = -0.5;
    aircraftGroup.add(ws);
    // Side windows
    for (const side of [-1, 1]) {
      const swGeo = new THREE.PlaneGeometry(fLen * 0.12, fRad * 0.8);
      const sw = new THREE.Mesh(swGeo, glassMat);
      sw.position.set(side * (fRad * 0.68), fRad * 0.55, -fLen * 0.2);
      sw.rotation.y = side * Math.PI * 0.5;
      aircraftGroup.add(sw);
    }
  } else {
    // Airliner cockpit windshield (angled panels)
    const wsGeo = new THREE.BoxGeometry(fRad * 1.7, fRad * 1.0, fRad * 0.05);
    const ws = new THREE.Mesh(wsGeo, glassMat);
    ws.position.set(0, fRad * 0.55, -fLen * 0.38);
    ws.rotation.x = -0.6;
    aircraftGroup.add(ws);
    // Passenger windows (row of small squares)
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x99ccdd, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.3,
    });
    for (let wz = -fLen * 0.25; wz < fLen * 0.3; wz += fLen * 0.04) {
      for (const side of [-1, 1]) {
        const winGeo = new THREE.PlaneGeometry(0.08, 0.12);
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(side * (fRad - 0.01), fRad * 0.35, wz);
        win.rotation.y = side * Math.PI * 0.5;
        aircraftGroup.add(win);
      }
    }
  }

  // ── Type-specific features ──
  if (type.type === 'prop') {
    propeller = new THREE.Group();

    // Engine cowling (smooth)
    const cowlPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = fRad * (0.65 + 0.15 * Math.sin(t * Math.PI));
      cowlPts.push(new THREE.Vector2(r, (t - 0.5) * fRad * 2.5));
    }
    const cowlGeo = new THREE.LatheGeometry(cowlPts, 14);
    cowlGeo.rotateX(Math.PI / 2);
    const cowl = new THREE.Mesh(cowlGeo, darkMat);
    cowl.position.z = -fLen / 2 - fRad * 0.3;
    cowl.castShadow = true;
    aircraftGroup.add(cowl);

    // Spinner
    const spinGeo = new THREE.ConeGeometry(fRad * 0.25, fRad * 1.0, 10);
    spinGeo.rotateX(Math.PI / 2);
    const spinner = new THREE.Mesh(spinGeo, chromeMat);
    spinner.position.z = -fRad * 0.3;
    propeller.add(spinner);

    // Propeller blades (2-blade, wider and more realistic)
    for (let i = 0; i < 2; i++) {
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, 0);
      bladeShape.quadraticCurveTo(0.08, 0.5, 0.12, 1.0);
      bladeShape.quadraticCurveTo(0.1, 1.5, 0.05, 1.8);
      bladeShape.lineTo(-0.05, 1.8);
      bladeShape.quadraticCurveTo(-0.1, 1.5, -0.12, 1.0);
      bladeShape.quadraticCurveTo(-0.08, 0.5, 0, 0);
      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.04, bevelEnabled: false });
      const blade = new THREE.Mesh(bladeGeo, darkMat);
      blade.position.y = 0;
      blade.position.z = -0.02;
      const bg = new THREE.Group();
      bg.add(blade);
      bg.rotation.z = i * Math.PI;
      propeller.add(bg);
    }

    propeller.position.z = -fLen / 2 - fRad * 1.2;
    aircraftGroup.add(propeller);

  } else if (type.type === 'jet') {
    propeller = null;
    const nacSpacing = wSpan * 0.28;
    const nacRadius = fRad * 0.45;
    const nacLength = fLen * 0.28;
    for (let i = 0; i < type.engineCount; i++) {
      const side = i === 0 ? -1 : 1;
      createNacelle(scene, aircraftGroup,
        side * nacSpacing,
        wingY - fRad * 0.6,
        wingZ - rootChord * 0.1,
        nacRadius, nacLength, darkMat, chromeMat
      );
    }

  } else if (type.type === 'fighter') {
    propeller = null;
    // Air intake (chin-mounted)
    const intakeGeo = new THREE.BoxGeometry(fRad * 1.0, fRad * 0.5, fLen * 0.15);
    const intake = new THREE.Mesh(intakeGeo, darkMat);
    intake.position.set(0, -fRad * 0.6, -fLen * 0.15);
    aircraftGroup.add(intake);

    // Exhaust nozzle
    const exPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = fRad * (0.5 + 0.15 * Math.sin(t * Math.PI * 0.8));
      exPts.push(new THREE.Vector2(r, (t - 0.5) * fLen * 0.15));
    }
    const exGeo = new THREE.LatheGeometry(exPts, 14);
    exGeo.rotateX(Math.PI / 2);
    const exhaust = new THREE.Mesh(exGeo, darkMat);
    exhaust.position.z = fLen * 0.48;
    aircraftGroup.add(exhaust);

    // Afterburner glow
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 0.8, transparent: true, opacity: 0.5,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(fRad * 0.35, 8, 6), glowMat);
    glow.position.set(0, 0, fLen * 0.55);
    aircraftGroup.add(glow);

    // Ventral fins
    for (const side of [-1, 1]) {
      const vfGeo = new THREE.BoxGeometry(0.06, fRad * 0.8, fLen * 0.08);
      const vf = new THREE.Mesh(vfGeo, bodyMat);
      vf.position.set(side * fRad * 0.4, -fRad * 0.8, fLen * 0.35);
      vf.rotation.z = side * 0.3;
      aircraftGroup.add(vf);
    }
  }

  // ── Landing Gear ──
  gearGroup = new THREE.Group();
  const gearStrutGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6);
  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });

  // Nose gear
  const ng = new THREE.Mesh(gearStrutGeo, chromeMat);
  ng.position.set(0, -fRad - 0.3, -fLen * 0.35);
  gearGroup.add(ng);
  const nw = new THREE.Mesh(wheelGeo, tireMat);
  nw.position.set(0, -fRad - 0.9, -fLen * 0.35);
  gearGroup.add(nw);

  // Main gear
  const mgSpread = type.type === 'prop' ? fRad + 0.7 : fRad + 1.2;
  for (const side of [-1, 1]) {
    const ms = new THREE.Mesh(gearStrutGeo, chromeMat);
    ms.position.set(side * mgSpread, -fRad - 0.3, wingZ + 0.3);
    gearGroup.add(ms);
    // Dual wheel for jets
    if (type.type !== 'prop') {
      for (const wz of [-0.12, 0.12]) {
        const mw = new THREE.Mesh(wheelGeo, tireMat);
        mw.position.set(side * mgSpread, -fRad - 0.9, wingZ + 0.3 + wz);
        gearGroup.add(mw);
      }
    } else {
      const mw = new THREE.Mesh(wheelGeo, tireMat);
      mw.position.set(side * mgSpread, -fRad - 0.9, wingZ + 0.3);
      gearGroup.add(mw);
    }
    // Gear fairing
    const fairGeo = new THREE.SphereGeometry(0.2, 6, 5);
    fairGeo.scale(0.6, 1.2, 1.4);
    const fair = new THREE.Mesh(fairGeo, bodyMat);
    fair.position.set(side * mgSpread, -fRad + 0.05, wingZ + 0.3);
    gearGroup.add(fair);
  }
  aircraftGroup.add(gearGroup);

  // ── Nav lights ──
  const greenNavMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 1.0 });
  const redNavMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.0 });
  const navGeo = new THREE.SphereGeometry(0.1, 6, 6);

  const rNav = new THREE.Mesh(navGeo, greenNavMat);
  rNav.position.set(wSpan / 2, wingY, wingZ);
  aircraftGroup.add(rNav);
  const lNav = new THREE.Mesh(navGeo, redNavMat);
  lNav.position.set(-wSpan / 2, wingY, wingZ);
  aircraftGroup.add(lNav);
  const tLight = new THREE.Mesh(navGeo, redMat);
  tLight.position.set(0, fRad * 0.3 + tH * 0.9, tailZ);
  aircraftGroup.add(tLight);

  navLightLeft = new THREE.PointLight(0xff0000, 5, 40);
  navLightLeft.position.copy(lNav.position);
  aircraftGroup.add(navLightLeft);
  navLightRight = new THREE.PointLight(0x00ff00, 5, 40);
  navLightRight.position.copy(rNav.position);
  aircraftGroup.add(navLightRight);

  // Beacon (blinking red on tail top)
  const beaconGeoB = new THREE.SphereGeometry(0.2, 6, 6);
  const beaconMatB = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.0 });
  beaconMesh = new THREE.Mesh(beaconGeoB, beaconMatB);
  beaconMesh.position.set(0, fRad * 0.3 + tH + 0.2, tailZ - fLen * 0.02);
  aircraftGroup.add(beaconMesh);

  // Tail logo light (illuminates vertical stabilizer)
  tailLogoLight = new THREE.PointLight(0xffffff, 0, 20);
  tailLogoLight.position.set(0, fRad * 0.3 + tH * 0.5, tailZ - fLen * 0.02 + 0.5);
  aircraftGroup.add(tailLogoLight);

  // Strobes on wingtips
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0 });
  strobeLeftMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), strobeMat.clone());
  strobeLeftMesh.position.set(-wSpan / 2, wingY, wingZ + rootChord * 0.4);
  aircraftGroup.add(strobeLeftMesh);
  strobeRightMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), strobeMat.clone());
  strobeRightMesh.position.set(wSpan / 2, wingY, wingZ + rootChord * 0.4);
  aircraftGroup.add(strobeRightMesh);

  // ── Landing/Taxi SpotLight ──
  landingSpotLight = new THREE.SpotLight(0xfff8e0, 0, 800, Math.PI / 5, 0.5, 1.5);
  landingSpotLight.position.set(0, -fRad * 0.3, -fLen * 0.45);
  landingSpotLight.target.position.set(0, -fRad * 2, -fLen * 3);
  aircraftGroup.add(landingSpotLight);
  aircraftGroup.add(landingSpotLight.target);

  // Visible beam cone (subtle)
  const coneGeo = new THREE.ConeGeometry(8, 40, 12, 1, true);
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, -22);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfff8e0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  landingLightCone = new THREE.Mesh(coneGeo, coneMat);
  landingLightCone.position.copy(landingSpotLight.position);
  aircraftGroup.add(landingLightCone);

  // ── Cockpit Interior ──
  cockpitGroup = new THREE.Group();

  const dashMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.1 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7, emissive: 0x111111, emissiveIntensity: 0.15 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.9 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.2 });
  const glareMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.05 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x112211, emissiveIntensity: 0.3, roughness: 0.2 });

  // Camera sits at (0, cockpitY, cockpitZ) looking forward (-Z)
  const cockpitY = type.cockpitY || 0.3;
  const cockpitZ = type.cockpitZ || -2.8;
  const isFighter = type.type === 'fighter';
  const isJet = type.type === 'jet';
  const isProp = type.type === 'prop';

  // Scale factors: distance from camera to dashboard, side width, etc.
  const dashDist = isFighter ? 0.9 : (isJet ? 1.4 : 1.1);    // how far ahead dashboard is
  const dashWidth = Math.min(fRad * 1.8, 2.4);                  // dashboard width
  const sideX = Math.min(fRad * 0.65, 0.8);                     // side console X offset

  // ── Windshield Frame (TubeGeometry between explicit 3D points — no rotation math) ──
  const pillarRadius = 0.012;
  const pillarSpreadX = isFighter ? 0.5 : (isJet ? 0.85 : 0.75);
  const wsBaseY = cockpitY - 0.15;
  const wsBaseZ = cockpitZ - dashDist - 0.1;
  const wsHeight = isFighter ? 0.7 : (isJet ? 1.0 : 0.8);
  // Windshield rake: top is closer to pilot (+Z) than bottom, and narrower (inward)
  const wsRake = isFighter ? 0.08 : (isJet ? 0.25 : 0.18);
  const wsNarrow = isFighter ? 0.0 : 0.08; // top is narrower than bottom

  function makeTube(p1, p2, radius) {
    const curve = new THREE.LineCurve3(p1, p2);
    const geo = new THREE.TubeGeometry(curve, 1, radius, 6, false);
    return new THREE.Mesh(geo, frameMat);
  }

  if (isFighter) {
    // Fighter: Thin bubble canopy bow frame (single arch over the pilot)
    const canopyArch = makeTube(
      new THREE.Vector3(-0.55, cockpitY + 0.15, cockpitZ - 0.2),
      new THREE.Vector3(0.55, cockpitY + 0.15, cockpitZ - 0.2),
      0.006
    );
    cockpitGroup.add(canopyArch);

    // Canopy longitudinal spine (thin bar along the top center)
    const spine = makeTube(
      new THREE.Vector3(0, cockpitY + 0.65, cockpitZ - 0.8),
      new THREE.Vector3(0, cockpitY + 0.55, cockpitZ + 0.6),
      0.005
    );
    cockpitGroup.add(spine);

    // Canopy side rails (thin longitudinal bars following canopy curve)
    for (const side of [-1, 1]) {
      const rail = makeTube(
        new THREE.Vector3(side * 0.55, cockpitY + 0.15, cockpitZ - 0.8),
        new THREE.Vector3(side * 0.4, cockpitY + 0.45, cockpitZ + 0.5),
        0.005
      );
      cockpitGroup.add(rail);
    }

    // HUD combiner glass — small and minimal like a real F-16
    // Two thin support posts rising from the dashboard
    const hudY = cockpitY + 0.05;
    const hudZ = cockpitZ - dashDist + 0.08;
    for (const side of [-1, 1]) {
      const post = makeTube(
        new THREE.Vector3(side * 0.07, hudY - 0.12, hudZ),
        new THREE.Vector3(side * 0.07, hudY + 0.1, hudZ - 0.02),
        0.004
      );
      cockpitGroup.add(post);
    }
    // Small combiner glass (transparent, barely visible)
    const hudGlassGeo = new THREE.PlaneGeometry(0.14, 0.12);
    const hudGlassMat = new THREE.MeshStandardMaterial({
      color: 0x88ffaa, transparent: true, opacity: 0.06, emissive: 0x225533, emissiveIntensity: 0.1,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const hudGlass = new THREE.Mesh(hudGlassGeo, hudGlassMat);
    hudGlass.position.set(0, hudY + 0.04, hudZ - 0.01);
    hudGlass.rotation.x = -0.15; // slight tilt
    cockpitGroup.add(hudGlass);
  } else {
    // Civilian/airliner: A-pillar windshield frame using point-to-point tubes
    for (const side of [-1, 1]) {
      const bottomPt = new THREE.Vector3(side * pillarSpreadX, wsBaseY, wsBaseZ);
      const topPt = new THREE.Vector3(side * (pillarSpreadX - wsNarrow), wsBaseY + wsHeight, wsBaseZ + wsRake);
      cockpitGroup.add(makeTube(bottomPt, topPt, pillarRadius));
    }

    // Center post (airliners only)
    if (isJet) {
      const cBottom = new THREE.Vector3(0, wsBaseY + 0.02, wsBaseZ);
      const cTop = new THREE.Vector3(0, wsBaseY + wsHeight * 0.95, wsBaseZ + wsRake * 0.95);
      cockpitGroup.add(makeTube(cBottom, cTop, 0.01));
    }

    // Top crossbar connecting pillar tops
    const topLeft = new THREE.Vector3(-(pillarSpreadX - wsNarrow), wsBaseY + wsHeight, wsBaseZ + wsRake);
    const topRight = new THREE.Vector3((pillarSpreadX - wsNarrow), wsBaseY + wsHeight, wsBaseZ + wsRake);
    cockpitGroup.add(makeTube(topLeft, topRight, 0.01));

    // Windshield base coaming (horizontal bar at bottom)
    const coamingGeo = new THREE.BoxGeometry(dashWidth, 0.025, 0.02);
    const coaming = new THREE.Mesh(coamingGeo, frameMat);
    coaming.position.set(0, wsBaseY - 0.02, wsBaseZ);
    cockpitGroup.add(coaming);
  }

  // ── Dashboard / Instrument Panel ──
  const dashH = isFighter ? 0.35 : 0.45;
  const dashDepth = 0.2;
  const dashY = cockpitY - 0.55;
  const dashZ = cockpitZ - dashDist;

  const dashGeo = new THREE.BoxGeometry(dashWidth, dashH, dashDepth);
  const dash = new THREE.Mesh(dashGeo, dashMat);
  dash.position.set(0, dashY, dashZ);
  cockpitGroup.add(dash);

  // ── Glare Shield (thin ledge on top of dashboard) ──
  const glareW = dashWidth;
  const glareD = isFighter ? 0.08 : 0.12;
  const glareGeo = new THREE.BoxGeometry(glareW, 0.015, glareD);
  const glare = new THREE.Mesh(glareGeo, glareMat);
  glare.position.set(0, dashY + dashH * 0.5 + 0.008, dashZ - dashDepth * 0.3);
  glare.rotation.x = -0.3;
  cockpitGroup.add(glare);

  // ── Instruments ── (Canvas-based dynamic panel)
  const instrFaceZ = dashZ + dashDepth * 0.5 + 0.005;

  // Create offscreen canvas for instrument panel
  cockpitCanvas = document.createElement('canvas');
  cockpitCanvas.width = 1024;
  cockpitCanvas.height = 384;
  cockpitCtx = cockpitCanvas.getContext('2d');

  // Fill initial black
  cockpitCtx.fillStyle = '#111111';
  cockpitCtx.fillRect(0, 0, 1024, 384);

  cockpitTexture = new THREE.CanvasTexture(cockpitCanvas);
  cockpitTexture.minFilter = THREE.LinearFilter;
  cockpitTexture.magFilter = THREE.LinearFilter;

  const panelGeo = new THREE.PlaneGeometry(dashWidth, dashH);
  const panelTexMat = new THREE.MeshBasicMaterial({ map: cockpitTexture, transparent: false });
  cockpitPanel = new THREE.Mesh(panelGeo, panelTexMat);
  cockpitPanel.position.set(0, dashY, instrFaceZ);
  cockpitGroup.add(cockpitPanel);

  // ── Center Pedestal (between pilot seats) ──
  const pedW = 0.25;
  const pedH = isFighter ? 0.2 : 0.3;
  const pedD = isFighter ? 0.4 : 0.6;
  const pedY = cockpitY - 0.65;
  const pedZ = cockpitZ + (isFighter ? 0.1 : 0.0);
  const pedGeo = new THREE.BoxGeometry(pedW, pedH, pedD);
  const ped = new THREE.Mesh(pedGeo, dashMat);
  ped.position.set(0, pedY, pedZ);
  cockpitGroup.add(ped);

  // Throttle levers on pedestal
  const leverCount = isFighter ? 1 : 2;
  for (let i = 0; i < leverCount; i++) {
    const lx = leverCount === 1 ? 0 : (i - 0.5) * 0.08;
    // Lever track (slot)
    const trackGeo = new THREE.BoxGeometry(0.02, 0.015, 0.2);
    const track = new THREE.Mesh(trackGeo, darkMat);
    track.position.set(lx, pedY + pedH * 0.5 + 0.008, pedZ - 0.05);
    cockpitGroup.add(track);
    // Lever handle
    const leverGeo = new THREE.BoxGeometry(0.035, 0.06, 0.03);
    const lever = new THREE.Mesh(leverGeo, chromeMat);
    lever.position.set(lx, pedY + pedH * 0.5 + 0.04, pedZ - 0.08);
    cockpitGroup.add(lever);
  }

  // Trim wheel (on side of pedestal, jets/prop)
  if (!isFighter) {
    const trimGeo = new THREE.TorusGeometry(0.06, 0.01, 6, 12);
    const trim = new THREE.Mesh(trimGeo, chromeMat);
    trim.position.set(pedW * 0.5 + 0.01, pedY + pedH * 0.3, pedZ + 0.1);
    trim.rotation.y = Math.PI / 2;
    cockpitGroup.add(trim);
  }

  // ── Side Walls (curved to match fuselage shape) ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  const wallTrimMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.15 });
  const wallD = isFighter ? 1.4 : 2.0;
  const wallBaseY = cockpitY - 0.85;
  const wallTopY = cockpitY + (isFighter ? 0.7 : 0.65);
  const wallH = wallTopY - wallBaseY;

  // Use curved cylinder section to match fuselage radius
  const fuselageR = fRad * (isFighter ? 1.1 : 1.0);
  const wallArc = isFighter ? 0.6 : 0.8; // radians of arc to show (less = flatter wall)
  const wallSegH = 8;
  const wallSegL = 12;

  for (const side of [-1, 1]) {
    // Curved wall panel using a partial cylinder (inside surface of fuselage)
    const curveGeo = new THREE.CylinderGeometry(
      fuselageR, fuselageR, wallD, wallSegL, wallSegH, true,
      side === 1 ? Math.PI / 2 - wallArc * 0.5 : 3 * Math.PI / 2 - wallArc * 0.5, wallArc
    );
    curveGeo.rotateX(Math.PI / 2); // align along Z axis
    const curveWall = new THREE.Mesh(curveGeo, wallMat);
    curveWall.position.set(0, cockpitY - 0.1, cockpitZ + (isFighter ? 0.0 : 0.2));
    cockpitGroup.add(curveWall);

    // Side console ledge (lower wall shelf for switches/controls)
    const scW = 0.12;
    const scH = 0.22;
    const scD = isFighter ? 0.5 : 0.8;
    const scGeo = new THREE.BoxGeometry(scW, scH, scD);
    const sc = new THREE.Mesh(scGeo, dashMat);
    sc.position.set(side * (sideX - 0.02), cockpitY - 0.45, cockpitZ + (isFighter ? 0.0 : 0.15));
    cockpitGroup.add(sc);

    // Armrest on console
    const armGeo = new THREE.BoxGeometry(0.1, 0.03, scD * 0.6);
    const arm = new THREE.Mesh(armGeo, seatMat);
    arm.position.set(side * (sideX - 0.02), cockpitY - 0.33, cockpitZ + (isFighter ? 0.05 : 0.2));
    cockpitGroup.add(arm);

    // Wall trim strip (horizontal accent along the curve)
    const trimGeo2 = new THREE.BoxGeometry(0.01, 0.02, wallD * 0.8);
    const trimStrip = new THREE.Mesh(trimGeo2, wallTrimMat);
    trimStrip.position.set(side * (sideX + 0.03), cockpitY + 0.05, cockpitZ + (isFighter ? 0.0 : 0.2));
    cockpitGroup.add(trimStrip);
  }

  // ── Overhead Panel (high up, out of main view) ──
  const ohW = isFighter ? 0.5 : (isJet ? dashWidth * 0.7 : dashWidth * 0.5);
  const ohD = isFighter ? 0.3 : (isJet ? 0.6 : 0.35);
  const ohY = cockpitY + 0.6;
  const ohZ = cockpitZ + (isFighter ? 0.0 : 0.1);

  if (isJet || isFighter) {
    const ohGeo = new THREE.BoxGeometry(ohW, 0.06, ohD);
    const oh = new THREE.Mesh(ohGeo, panelMat);
    oh.position.set(0, ohY, ohZ);
    cockpitGroup.add(oh);

    // Overhead panel rows of switches/lights
    const dotCount = isJet ? 14 : 6;
    const dotColors = [0x44ff44, 0xffaa00, 0xff4444, 0x44ff44, 0xffaa00, 0x44ff44, 0xff4444];
    for (let i = 0; i < dotCount; i++) {
      const dotGeo = new THREE.SphereGeometry(0.012, 4, 4);
      const dotMat2 = new THREE.MeshStandardMaterial({
        color: dotColors[i % dotColors.length],
        emissive: dotColors[i % dotColors.length],
        emissiveIntensity: 0.7,
      });
      const dot = new THREE.Mesh(dotGeo, dotMat2);
      const row = Math.floor(i / (dotCount / 2));
      const col = i % Math.ceil(dotCount / 2);
      const totalCols = Math.ceil(dotCount / 2);
      dot.position.set(
        (col - (totalCols - 1) * 0.5) * (ohW / (totalCols + 1)),
        ohY - 0.025,
        ohZ + (row - 0.5) * 0.15
      );
      cockpitGroup.add(dot);
    }

    // Overhead panel switch rows (small raised bumps)
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 5; c++) {
        const switchGeo = new THREE.BoxGeometry(0.02, 0.025, 0.015);
        const switchMesh = new THREE.Mesh(switchGeo, chromeMat);
        switchMesh.position.set(
          (c - 2) * (ohW / 6),
          ohY - 0.02,
          ohZ + (r - 0.5) * 0.25
        );
        cockpitGroup.add(switchMesh);
      }
    }
  } else {
    // Prop: smaller overhead with sun visor bar
    const visorBarGeo = new THREE.CylinderGeometry(0.015, 0.015, dashWidth * 0.7, 6);
    visorBarGeo.rotateZ(Math.PI / 2);
    const visorBar = new THREE.Mesh(visorBarGeo, chromeMat);
    visorBar.position.set(0, ohY - 0.05, cockpitZ - dashDist * 0.3);
    cockpitGroup.add(visorBar);

    // Small overhead panel
    const ohSmallGeo = new THREE.BoxGeometry(ohW, 0.04, ohD);
    const ohSmall = new THREE.Mesh(ohSmallGeo, panelMat);
    ohSmall.position.set(0, ohY, ohZ);
    cockpitGroup.add(ohSmall);

    // A few overhead switches
    for (let i = 0; i < 4; i++) {
      const swGeo = new THREE.BoxGeometry(0.02, 0.02, 0.015);
      const swMesh = new THREE.Mesh(swGeo, chromeMat);
      swMesh.position.set((i - 1.5) * 0.08, ohY - 0.015, ohZ);
      cockpitGroup.add(swMesh);
    }
  }

  // ── Ceiling / Roof ──
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
  const ceilW = sideX * 2.0 + 0.1;
  const ceilD = isFighter ? 1.0 : 1.6;
  const ceilY = cockpitY + (isFighter ? 0.7 : 0.65);

  // Main ceiling panel
  const ceilGeo = new THREE.PlaneGeometry(ceilW, ceilD);
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, ceilY, cockpitZ + (isFighter ? 0.0 : 0.15));
  cockpitGroup.add(ceil);

  // Ceiling cross-beams (structural ribs)
  const beamCount = isFighter ? 2 : 3;
  for (let bi = 0; bi < beamCount; bi++) {
    const beamGeo = new THREE.BoxGeometry(ceilW * 0.9, 0.02, 0.02);
    const beam = new THREE.Mesh(beamGeo, frameMat);
    const bz = cockpitZ + (isFighter ? -0.2 : -0.1) + bi * (ceilD / (beamCount + 1));
    beam.position.set(0, ceilY - 0.01, bz);
    cockpitGroup.add(beam);
  }

  // Ceiling light strip (subtle ambient)
  if (isJet) {
    const lightStripGeo = new THREE.BoxGeometry(0.03, 0.01, ceilD * 0.6);
    const lightStripMat = new THREE.MeshStandardMaterial({
      color: 0xffeedd, emissive: 0xffeedd, emissiveIntensity: 0.15, roughness: 0.3,
    });
    const lightStrip = new THREE.Mesh(lightStripGeo, lightStripMat);
    lightStrip.position.set(0, ceilY - 0.005, cockpitZ + 0.1);
    cockpitGroup.add(lightStrip);
  }

  // ── Rear Bulkhead (wall behind the seats) ──
  const bulkheadZ = cockpitZ + (isFighter ? 0.7 : 1.0);
  const bulkheadW = sideX * 2.0 + 0.1;
  const bulkheadH = wallH;
  const bulkheadGeo = new THREE.PlaneGeometry(bulkheadW, bulkheadH);
  const bulkhead = new THREE.Mesh(bulkheadGeo, wallMat);
  bulkhead.position.set(0, wallBaseY + bulkheadH * 0.5, bulkheadZ);
  bulkhead.rotation.y = Math.PI;
  cockpitGroup.add(bulkhead);

  // ── Floor ──
  const floorW = sideX * 2.0 + 0.1;
  const floorD = isFighter ? 1.0 : 1.5;
  const floorGeo = new THREE.PlaneGeometry(floorW, floorD);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, cockpitY - 0.85, cockpitZ + (isFighter ? 0.0 : 0.1));
  cockpitGroup.add(floor);

  // Rudder pedals on floor
  for (const side of [-1, 1]) {
    const pedalGeo = new THREE.BoxGeometry(0.08, 0.015, 0.12);
    const pedal = new THREE.Mesh(pedalGeo, darkMat);
    pedal.position.set(side * 0.15, cockpitY - 0.83, cockpitZ - dashDist + 0.35);
    pedal.rotation.x = 0.3;
    cockpitGroup.add(pedal);
  }

  // ── Yoke / Stick ──
  if (isFighter) {
    // Side stick (right side, F-16 style)
    const stickGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.25, 6);
    const stick = new THREE.Mesh(stickGeo, chromeMat);
    stick.position.set(0.2, cockpitY - 0.55, cockpitZ + 0.05);
    stick.rotation.x = -0.15;
    cockpitGroup.add(stick);
    const gripGeo = new THREE.BoxGeometry(0.035, 0.06, 0.035);
    const grip = new THREE.Mesh(gripGeo, darkMat);
    grip.position.set(0.2, cockpitY - 0.42, cockpitZ + 0.04);
    cockpitGroup.add(grip);
  } else if (isProp) {
    // Control yoke on column (Cessna-style)
    const colGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6);
    const col = new THREE.Mesh(colGeo, darkMat);
    col.position.set(0, cockpitY - 0.55, cockpitZ - dashDist + 0.35);
    col.rotation.x = -0.5;
    cockpitGroup.add(col);
    const hornGeo = new THREE.TorusGeometry(0.08, 0.01, 6, 12, Math.PI);
    const horn = new THREE.Mesh(hornGeo, darkMat);
    horn.position.set(0, cockpitY - 0.4, cockpitZ - dashDist + 0.25);
    horn.rotation.x = Math.PI * 0.55;
    cockpitGroup.add(horn);
    const shaftGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.16, 6);
    shaftGeo.rotateZ(Math.PI / 2);
    const shaft = new THREE.Mesh(shaftGeo, darkMat);
    shaft.position.set(0, cockpitY - 0.4, cockpitZ - dashDist + 0.25);
    cockpitGroup.add(shaft);
  } else {
    // Airliner yoke columns
    for (const side of [-1, 1]) {
      const colGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6);
      const col = new THREE.Mesh(colGeo, darkMat);
      col.position.set(side * 0.28, cockpitY - 0.58, cockpitZ - dashDist + 0.4);
      col.rotation.x = -0.5;
      cockpitGroup.add(col);
      const hornGeo = new THREE.TorusGeometry(0.075, 0.01, 6, 12, Math.PI);
      const horn = new THREE.Mesh(hornGeo, darkMat);
      horn.position.set(side * 0.28, cockpitY - 0.44, cockpitZ - dashDist + 0.3);
      horn.rotation.x = Math.PI * 0.55;
      cockpitGroup.add(horn);
    }
  }

  // ── Seats (positioned so side edges are visible in peripheral vision) ──
  const seatCount = isFighter ? 1 : 2;
  for (let si = 0; si < seatCount; si++) {
    const sx = seatCount === 1 ? 0 : (si - 0.5) * 0.55;
    // Seat back (wider, positioned so edges peek into view)
    const seatBackW = isFighter ? 0.38 : 0.35;
    const seatBackGeo = new THREE.BoxGeometry(seatBackW, 0.55, 0.07);
    const seatBackMesh = new THREE.Mesh(seatBackGeo, seatMat);
    seatBackMesh.position.set(sx, cockpitY - 0.05, cockpitZ + 0.25);
    cockpitGroup.add(seatBackMesh);
    // Headrest (wider, taller, slightly forward)
    const headrestGeo = new THREE.BoxGeometry(0.24, 0.18, 0.06);
    const headrest = new THREE.Mesh(headrestGeo, seatMat);
    headrest.position.set(sx, cockpitY + 0.28, cockpitZ + 0.27);
    cockpitGroup.add(headrest);
    // Seat bottom
    const seatBotGeo = new THREE.BoxGeometry(seatBackW, 0.06, 0.35);
    const seatBot = new THREE.Mesh(seatBotGeo, seatMat);
    seatBot.position.set(sx, cockpitY - 0.5, cockpitZ + 0.1);
    cockpitGroup.add(seatBot);
    // Seat side bolsters (visible at edges of view)
    for (const bolsterSide of [-1, 1]) {
      const bolsterGeo = new THREE.BoxGeometry(0.04, 0.35, 0.07);
      const bolster = new THREE.Mesh(bolsterGeo, seatMat);
      bolster.position.set(sx + bolsterSide * (seatBackW * 0.5 + 0.01), cockpitY - 0.1, cockpitZ + 0.25);
      cockpitGroup.add(bolster);
    }
  }

  // ── Type-specific extras ──
  if (isFighter) {
    // Ejection seat rails (visible behind seat)
    for (const side of [-1, 1]) {
      const railGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4);
      const rail = new THREE.Mesh(railGeo, chromeMat);
      rail.position.set(side * 0.15, cockpitY + 0.1, cockpitZ + 0.42);
      cockpitGroup.add(rail);
    }
    // Ejection handle (yellow/black between knees)
    const ejectGeo = new THREE.TorusGeometry(0.05, 0.01, 4, 8);
    const ejectMat = new THREE.MeshStandardMaterial({
      color: 0xffcc00, emissive: 0x664400, emissiveIntensity: 0.3, roughness: 0.5,
    });
    const ejectHandle = new THREE.Mesh(ejectGeo, ejectMat);
    ejectHandle.position.set(0, cockpitY - 0.55, cockpitZ + 0.15);
    ejectHandle.rotation.x = Math.PI / 2;
    cockpitGroup.add(ejectHandle);
  }

  if (isJet) {
    // FMS/CDU keypads on center pedestal (one per side)
    for (const side of [-1, 1]) {
      const cduGeo = new THREE.BoxGeometry(0.12, 0.01, 0.14);
      const cdu = new THREE.Mesh(cduGeo, panelMat);
      cdu.position.set(side * 0.08, pedY + pedH * 0.5 + 0.006, pedZ + 0.2);
      cockpitGroup.add(cdu);
      // CDU screen
      const cduScreenGeo = new THREE.PlaneGeometry(0.08, 0.05);
      const cduScreen = new THREE.Mesh(cduScreenGeo, screenMat);
      cduScreen.position.set(side * 0.08, pedY + pedH * 0.5 + 0.012, pedZ + 0.15);
      cduScreen.rotation.x = -Math.PI / 2;
      cockpitGroup.add(cduScreen);
    }

    // Weather radar display (top center of dash)
    const radarGeo = new THREE.PlaneGeometry(0.12, 0.08);
    const radarMat = new THREE.MeshStandardMaterial({
      color: 0x001a00, emissive: 0x003300, emissiveIntensity: 0.25, roughness: 0.3,
    });
    const radar = new THREE.Mesh(radarGeo, radarMat);
    radar.position.set(0, dashY + dashH * 0.35, instrFaceZ - 0.015);
    cockpitGroup.add(radar);
  }

  if (isProp) {
    // Mixture/prop controls (colored knobs below throttle)
    const knobColors = [0xcc2222, 0x2255cc, 0x222222]; // mixture(red), prop(blue), throttle(black)
    for (let ki = 0; ki < knobColors.length; ki++) {
      const knobGeo = new THREE.SphereGeometry(0.018, 6, 6);
      const knobMat = new THREE.MeshStandardMaterial({ color: knobColors[ki], roughness: 0.5, metalness: 0.2 });
      const knob = new THREE.Mesh(knobGeo, knobMat);
      knob.position.set((ki - 1) * 0.05, pedY + pedH * 0.5 + 0.02, pedZ - 0.15);
      cockpitGroup.add(knob);
    }

    // Magnetic compass on top of glare shield
    const compassGeo = new THREE.SphereGeometry(0.04, 8, 6);
    const compassMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.3 });
    const compass = new THREE.Mesh(compassGeo, compassMat);
    compass.position.set(0, dashY + dashH * 0.5 + 0.08, dashZ - dashDepth * 0.2);
    cockpitGroup.add(compass);
  }

  // ── Cockpit ambient light (dim interior illumination) ──
  const cockpitLight = new THREE.PointLight(0xffeedd, 0.15, 3.0, 2);
  cockpitLight.position.set(0, cockpitY + 0.3, cockpitZ);
  cockpitGroup.add(cockpitLight);

  cockpitGroup.visible = false; // Only shown in cockpit camera mode
  aircraftGroup.add(cockpitGroup);

  // ── Aircraft Detail Geometry ──

  // Comm antenna (top of fuselage)
  const antennaGeo = new THREE.CylinderGeometry(0.015, 0.02, fRad * 1.2, 4);
  const antenna = new THREE.Mesh(antennaGeo, darkMat);
  antenna.position.set(0, fRad + fRad * 0.5, -fLen * 0.05);
  aircraftGroup.add(antenna);

  // Nav antenna (belly)
  const navAntennaGeo = new THREE.CylinderGeometry(0.02, 0.03, fRad * 0.6, 4);
  const navAntenna = new THREE.Mesh(navAntennaGeo, darkMat);
  navAntenna.position.set(0, -fRad - fRad * 0.2, fLen * 0.1);
  aircraftGroup.add(navAntenna);

  // Pitot tube (nose side)
  const pitotGeo = new THREE.CylinderGeometry(0.01, 0.01, fRad * 0.8, 4);
  pitotGeo.rotateX(Math.PI / 2);
  const pitot = new THREE.Mesh(pitotGeo, chromeMat);
  pitot.position.set(fRad * 0.4, fRad * 0.1, -fLen * 0.42);
  aircraftGroup.add(pitot);

  // Static ports (small discs on fuselage sides)
  for (const side of [-1, 1]) {
    const portGeo = new THREE.CircleGeometry(0.03, 6);
    const portMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });
    const port = new THREE.Mesh(portGeo, portMat);
    port.position.set(side * (fRad - 0.01), fRad * 0.2, -fLen * 0.1);
    port.rotation.y = side * Math.PI * 0.5;
    aircraftGroup.add(port);
  }

  // Type-specific details
  if (type.type === 'prop') {
    // Cessna: Wheel fairings (teardrop around main gear)
    const wingZ = -fLen * 0.05;
    const mgSpread = fRad + 0.7;
    for (const side of [-1, 1]) {
      const fairingGeo = new THREE.SphereGeometry(0.32, 6, 5);
      fairingGeo.scale(0.5, 0.8, 1.5);
      const fairing = new THREE.Mesh(fairingGeo, bodyMat);
      fairing.position.set(side * mgSpread, -fRad - 0.65, wingZ + 0.3);
      aircraftGroup.add(fairing);
    }
    // Tail tie-down ring
    const ringGeo = new THREE.TorusGeometry(0.06, 0.015, 4, 8);
    const ring = new THREE.Mesh(ringGeo, chromeMat);
    ring.position.set(0, -fRad * 0.3, fLen * 0.48);
    ring.rotation.x = Math.PI / 2;
    aircraftGroup.add(ring);
  } else if (type.type === 'jet') {
    // APU exhaust at tail tip
    const apuGeo = new THREE.ConeGeometry(fRad * 0.15, fRad * 0.5, 8);
    apuGeo.rotateX(-Math.PI / 2);
    const apu = new THREE.Mesh(apuGeo, darkMat);
    apu.position.set(0, fRad * 0.4, fLen * 0.5);
    aircraftGroup.add(apu);
    // Passenger door outlines
    const doorPositions = [-fLen * 0.3, fLen * 0.15];
    for (const dz of doorPositions) {
      for (const side of [-1, 1]) {
        const doorGeo = new THREE.PlaneGeometry(0.06, fRad * 0.9);
        const doorMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(side * (fRad - 0.005), fRad * 0.05, dz);
        door.rotation.y = side * Math.PI * 0.5;
        aircraftGroup.add(door);
      }
    }
    // Logo light on tail (illuminates vertical stabilizer)
    const logoGeo = new THREE.SphereGeometry(0.06, 4, 4);
    const logoMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 0.5 });
    const logo = new THREE.Mesh(logoGeo, logoMat);
    logo.position.set(0, fRad * 0.3, fLen * 0.34);
    aircraftGroup.add(logo);
  } else if (type.type === 'fighter') {
    // Wing pylons
    for (const side of [-1, 1]) {
      for (const offset of [0.25, 0.45]) {
        const pylonGeo = new THREE.BoxGeometry(0.15, 0.2, 0.5);
        const pylon = new THREE.Mesh(pylonGeo, darkMat);
        pylon.position.set(side * wSpan * offset, wingY - 0.25, wingZ + 0.2);
        aircraftGroup.add(pylon);
      }
    }
    // Tail hook
    const hookGeo = new THREE.CylinderGeometry(0.02, 0.015, 1.2, 4);
    const hook = new THREE.Mesh(hookGeo, chromeMat);
    hook.position.set(0, -fRad - 0.3, fLen * 0.4);
    hook.rotation.x = 0.5;
    aircraftGroup.add(hook);
  }

  // Setup contrails
  setupContrails(scene, wSpan);
}

function setupContrails(scene, wingspan) {
  const maxPoints = CONTRAIL_LENGTH;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxPoints * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  contrailLeft = new THREE.Points(geometry.clone(), material.clone());
  contrailRight = new THREE.Points(geometry.clone(), material.clone());
  scene.add(contrailLeft);
  scene.add(contrailRight);

  contrailPositions = [];
}

export function updateAircraftVisual(dt) {
  if (!aircraftGroup) return;

  aircraftGroup.position.copy(aircraftState.position);
  aircraftGroup.quaternion.copy(aircraftState.quaternion);

  const keys = getKeys();

  // Propeller spin
  if (propeller) {
    aircraftState.propSpeed = aircraftState.throttle * 50;
    propeller.rotation.z += aircraftState.propSpeed * dt;
  }

  // Gear retraction animation
  if (gearGroup) {
    const targetScale = aircraftState.gear ? 1 : 0;
    gearGroup.scale.y += (targetScale - gearGroup.scale.y) * Math.min(1, 5 * dt);
    gearGroup.visible = gearGroup.scale.y > 0.05;
  }

  // Control surface animation
  const rollInput = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
  const pitchInput = (keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0);
  const yawInput = (keys['e'] ? 1 : 0) - (keys['q'] ? 1 : 0);

  if (rightAileron) {
    rightAileron.rotation.x += (rollInput * 0.3 - rightAileron.rotation.x) * Math.min(1, 10 * dt);
  }
  if (leftAileron) {
    leftAileron.rotation.x += (-rollInput * 0.3 - leftAileron.rotation.x) * Math.min(1, 10 * dt);
  }
  if (elevator) {
    elevator.rotation.x += (pitchInput * 0.25 - elevator.rotation.x) * Math.min(1, 10 * dt);
  }
  if (rudder) {
    rudder.rotation.y += (yawInput * 0.25 - rudder.rotation.y) * Math.min(1, 10 * dt);
  }

  // Blinking lights
  const now = performance.now();
  if (beaconMesh) {
    const pulse = (Math.sin(now * 0.005) + 1) * 0.5;
    beaconMesh.material.emissiveIntensity = pulse * 3.5;
  }
  if (strobeLeftMesh && strobeRightMesh) {
    // Strobe: sharp flash every ~1 second
    const strobeVal = Math.sin(now * 0.006) > 0.95 ? 5.0 : 0.1;
    strobeLeftMesh.material.emissiveIntensity = strobeVal;
    strobeRightMesh.material.emissiveIntensity = strobeVal;
  }

  // Landing/taxi lights
  if (landingSpotLight) {
    const lightOn = aircraftState.landingLight;
    landingSpotLight.intensity = lightOn ? 10 : 0;
    if (landingLightCone) {
      landingLightCone.visible = lightOn;
      landingLightCone.material.opacity = lightOn ? 0.04 : 0;
    }
    if (tailLogoLight) {
      tailLogoLight.intensity = lightOn ? 1.5 : 0;
    }
  }

  // Update cockpit instruments canvas
  if (cockpitCanvas && cockpitGroup && cockpitGroup.visible) {
    cockpitFrameCount = (cockpitFrameCount || 0) + 1;
    if (cockpitFrameCount % 3 === 0) { // ~20fps update rate
      const ctx = cockpitCtx;
      const w = cockpitCanvas.width;
      const h = cockpitCanvas.height;
      const type = aircraftState.config?.type || 'prop';

      if (type === 'prop') drawPropPanel(ctx, aircraftState, w, h);
      else if (type === 'fighter') drawFighterPanel(ctx, aircraftState, w, h);
      else drawJetPanel(ctx, aircraftState, w, h);

      cockpitTexture.needsUpdate = true;
    }
  }

  // Contrails (only visible above 500m AGL)
  updateContrails();
}

function updateContrails() {
  if (!contrailLeft || !contrailRight) return;

  const visible = aircraftState.altitudeAGL > 500;
  contrailLeft.visible = visible;
  contrailRight.visible = visible;

  if (!visible) {
    contrailPositions = [];
    contrailLeft.geometry.setDrawRange(0, 0);
    contrailRight.geometry.setDrawRange(0, 0);
    return;
  }

  const type = getAircraftType(aircraftState.currentType);
  const wSpan = type.wingSpan || 14;

  // Get wingtip world positions
  const leftTip = new THREE.Vector3(-wSpan / 2, 0, 0.5);
  leftTip.applyQuaternion(aircraftState.quaternion);
  leftTip.add(aircraftState.position);

  const rightTip = new THREE.Vector3(wSpan / 2, 0, 0.5);
  rightTip.applyQuaternion(aircraftState.quaternion);
  rightTip.add(aircraftState.position);

  contrailPositions.unshift({ left: leftTip.clone(), right: rightTip.clone() });
  if (contrailPositions.length > CONTRAIL_LENGTH) {
    contrailPositions.length = CONTRAIL_LENGTH;
  }

  // Update buffer geometries
  const leftPosAttr = contrailLeft.geometry.attributes.position;
  const rightPosAttr = contrailRight.geometry.attributes.position;

  for (let i = 0; i < contrailPositions.length; i++) {
    const p = contrailPositions[i];
    leftPosAttr.setXYZ(i, p.left.x, p.left.y, p.left.z);
    rightPosAttr.setXYZ(i, p.right.x, p.right.y, p.right.z);
  }

  leftPosAttr.needsUpdate = true;
  rightPosAttr.needsUpdate = true;
  contrailLeft.geometry.setDrawRange(0, contrailPositions.length);
  contrailRight.geometry.setDrawRange(0, contrailPositions.length);
}

export function getAircraftGroup() {
  return aircraftGroup;
}

export function setCockpitVisible(visible) {
  if (cockpitGroup) cockpitGroup.visible = visible;
}

export function getCockpitGroup() {
  return cockpitGroup;
}

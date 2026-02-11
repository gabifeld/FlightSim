import { MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM } from './constants.js';

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
  const grad = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
  grad.addColorStop(0, '#1c1c1c');
  grad.addColorStop(0.85, '#111111');
  grad.addColorStop(1, '#0a0a0a');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Bezel ring (3D effect)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
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

  // Needle (triangular for realism)
  const clampedVal = Math.max(min, Math.min(max, value));
  const needleAngle = startAngle - ((clampedVal - min) / (max - min)) * sweep;
  const needleCos = Math.cos(needleAngle);
  const needleSin = -Math.sin(needleAngle);
  const perpCos = Math.cos(needleAngle + Math.PI / 2);
  const perpSin = -Math.sin(needleAngle + Math.PI / 2);

  // Needle body (triangular)
  ctx.beginPath();
  ctx.moveTo(cx + needleCos * r * 0.75, cy + needleSin * r * 0.75); // tip
  ctx.lineTo(cx + perpCos * r * 0.04 - needleCos * r * 0.12, cy + perpSin * r * 0.04 - needleSin * r * 0.12);
  ctx.lineTo(cx - perpCos * r * 0.04 - needleCos * r * 0.12, cy - perpSin * r * 0.04 - needleSin * r * 0.12);
  ctx.closePath();
  ctx.fillStyle = '#FF8800';
  ctx.fill();

  // White center stripe on needle
  ctx.beginPath();
  ctx.moveTo(cx + needleCos * r * 0.6, cy + needleSin * r * 0.6);
  ctx.lineTo(cx + needleCos * r * 0.1, cy + needleSin * r * 0.1);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center hub (metallic look)
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
  const hubGrad = ctx.createRadialGradient(cx - r * 0.02, cy - r * 0.02, 0, cx, cy, r * 0.1);
  hubGrad.addColorStop(0, '#888888');
  hubGrad.addColorStop(0.6, '#444444');
  hubGrad.addColorStop(1, '#222222');
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  ctx.stroke();

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
 * Draw an attitude indicator (artificial horizon) with gradient sky/ground.
 */
function drawAttitudeIndicator(ctx, cx, cy, r, pitch, roll) {
  ctx.save();

  // Clip to circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  // Rotate canvas for roll
  ctx.translate(cx, cy);
  ctx.rotate(-roll);

  // Pitch offset (pixels per degree)
  const pxPerDeg = r / 20;
  const pitchDeg = pitch * (180 / Math.PI);
  const yOff = pitchDeg * pxPerDeg;

  // Sky gradient (darker at top, lighter near horizon)
  const skyGrad = ctx.createLinearGradient(0, -r * 1.5 + yOff, 0, yOff);
  skyGrad.addColorStop(0, '#1a3366');
  skyGrad.addColorStop(0.5, '#2255aa');
  skyGrad.addColorStop(1, '#4488cc');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(-r * 1.5, -r * 1.5 + yOff, r * 3, r * 1.5);

  // Ground gradient (lighter near horizon, darker below)
  const gndGrad = ctx.createLinearGradient(0, yOff, 0, r * 1.5 + yOff);
  gndGrad.addColorStop(0, '#8B5A2B');
  gndGrad.addColorStop(0.3, '#6B4423');
  gndGrad.addColorStop(1, '#3B2413');
  ctx.fillStyle = gndGrad;
  ctx.fillRect(-r * 1.5, yOff, r * 3, r * 1.5);

  // Horizon line (bright white)
  ctx.beginPath();
  ctx.moveTo(-r * 1.5, yOff);
  ctx.lineTo(r * 1.5, yOff);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Pitch ladder lines
  for (let deg = -30; deg <= 30; deg += 10) {
    if (deg === 0) continue;
    const ly = deg * pxPerDeg + yOff;
    const half = deg > 0 ? r * 0.28 : r * 0.18;
    ctx.beginPath();
    ctx.moveTo(-half, ly);
    ctx.lineTo(half, ly);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Pitch value labels on both sides
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `${Math.max(7, r * 0.15)}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(Math.abs(deg).toString(), -half - 3, ly + 3);
    ctx.textAlign = 'left';
    ctx.fillText(Math.abs(deg).toString(), half + 3, ly + 3);
  }

  // 5-degree marks (shorter)
  for (let deg = -25; deg <= 25; deg += 10) {
    const ly = deg * pxPerDeg + yOff;
    const half = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(-half, ly);
    ctx.lineTo(half, ly);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  // Aircraft symbol (orange wings with center dot)
  ctx.strokeStyle = '#FF8800';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.35, cy);
  ctx.lineTo(cx - r * 0.1, cy);
  ctx.lineTo(cx - r * 0.07, cy + r * 0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.35, cy);
  ctx.lineTo(cx + r * 0.1, cy);
  ctx.lineTo(cx + r * 0.07, cy + r * 0.06);
  ctx.stroke();

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
  ctx.lineTo(-6, -r + 14);
  ctx.lineTo(6, -r + 14);
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
      const len = bm % 30 === 0 ? 12 : (bm === 45 ? 8 : 6);
      const x2 = Math.cos(bAngle) * (r - len);
      const y2 = Math.sin(bAngle) * (r - len);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = bm === 0 ? 0 : (bm % 30 === 0 ? 1.5 : 1);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Bezel ring (darker outer, lighter inner for depth)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
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

  // Background with subtle gradient
  const grad = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
  grad.addColorStop(0, '#1e1e1e');
  grad.addColorStop(0.8, '#141414');
  grad.addColorStop(1, '#0a0a0a');
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

  for (let deg = 0; deg < 360; deg += 5) {
    const angle = deg * DEG - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const isMajor = deg % 30 === 0;
    const isMedium = deg % 10 === 0;

    if (isMajor || isMedium || deg % 5 === 0) {
      const innerR = isMajor ? r * 0.65 : (isMedium ? r * 0.75 : r * 0.82);
      const outerR = r * 0.88;

      ctx.beginPath();
      ctx.moveTo(cos * innerR, sin * innerR);
      ctx.lineTo(cos * outerR, sin * outerR);
      ctx.lineWidth = isMajor ? 1.5 : (isMedium ? 1 : 0.5);
      ctx.strokeStyle = isMajor ? '#FFFFFF' : (isMedium ? '#CCCCCC' : '#888888');
      ctx.stroke();
    }

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

  // Fixed aircraft symbol at center (miniature plan view)
  ctx.strokeStyle = '#FF8800';
  ctx.lineWidth = 1.8;
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx, cy + 6);
  ctx.stroke();
  // Wings
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.stroke();
  // Tail
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy + 5);
  ctx.lineTo(cx + 5, cy + 5);
  ctx.stroke();

  // Lubber line at top
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.lineTo(cx, cy - r + 14);
  ctx.strokeStyle = '#FF8800';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Heading readout box
  const hdgBoxW = r * 0.7;
  const hdgBoxH = r * 0.25;
  const hdgBoxY = cy + r * 0.65;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(cx - hdgBoxW / 2, hdgBoxY - hdgBoxH / 2, hdgBoxW, hdgBoxH);
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(cx - hdgBoxW / 2, hdgBoxY - hdgBoxH / 2, hdgBoxW, hdgBoxH);
  ctx.fillStyle = '#FFCC00';
  ctx.font = `bold ${Math.max(8, r * 0.22)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(((heading % 360) + 360) % 360) + '\u00B0', cx, hdgBoxY + 1);

  // Bezel ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
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

  // Sky gradient
  const pfdSkyGrad = ctx.createLinearGradient(0, -aiR * 2 + yOff, 0, yOff);
  pfdSkyGrad.addColorStop(0, '#0d2255');
  pfdSkyGrad.addColorStop(0.6, '#1a44aa');
  pfdSkyGrad.addColorStop(1, '#3388cc');
  ctx.fillStyle = pfdSkyGrad;
  ctx.fillRect(-aiR * 2, -aiR * 2 + yOff, aiR * 4, aiR * 2);
  // Ground gradient
  const pfdGndGrad = ctx.createLinearGradient(0, yOff, 0, aiR * 2 + yOff);
  pfdGndGrad.addColorStop(0, '#8B5A2B');
  pfdGndGrad.addColorStop(0.4, '#6B4423');
  pfdGndGrad.addColorStop(1, '#2B1810');
  ctx.fillStyle = pfdGndGrad;
  ctx.fillRect(-aiR * 2, yOff, aiR * 4, aiR * 2);
  // Horizon
  ctx.beginPath();
  ctx.moveTo(-aiR * 2, yOff);
  ctx.lineTo(aiR * 2, yOff);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
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

  // Flight director bars (magenta cross indicating target attitude)
  ctx.strokeStyle = '#DD44DD';
  ctx.lineWidth = 2;
  // Horizontal FD bar (pitch guidance)
  ctx.beginPath();
  ctx.moveTo(aiCx - aiR * 0.35, aiCy);
  ctx.lineTo(aiCx + aiR * 0.35, aiCy);
  ctx.stroke();
  // Vertical FD bar (roll guidance)
  ctx.beginPath();
  ctx.moveTo(aiCx, aiCy - aiR * 0.25);
  ctx.lineTo(aiCx, aiCy + aiR * 0.25);
  ctx.stroke();

  // Aircraft symbol (on top of FD)
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

  // Speed tape background with gradient
  const spdBg = ctx.createLinearGradient(spdX, spdY0, spdX + spdW, spdY0);
  spdBg.addColorStop(0, '#0A0F1A');
  spdBg.addColorStop(1, '#0F1525');
  ctx.fillStyle = spdBg;
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

  // Altitude tape background with gradient
  const altBg = ctx.createLinearGradient(altX, altY0, altX + altW, altY0);
  altBg.addColorStop(0, '#0F1525');
  altBg.addColorStop(1, '#0A0F1A');
  ctx.fillStyle = altBg;
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
  // Color based on altitude
  const altColor = alt < 200 ? '#FF4400' : (alt < 1000 ? '#FFCC00' : '#00CC44');
  ctx.strokeStyle = altColor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(altX, altMidY - 10, altW, 20);
  ctx.fillStyle = alt < 200 ? '#FF4400' : '#00FF44';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(alt).toString(), altX + altW / 2, altMidY + 4);

  // Ground proximity bar (red/amber at low altitude)
  if (alt < 500) {
    const gpwsH = Math.min(altH * 0.3, ((500 - alt) / 500) * altH * 0.3);
    const gpwsColor = alt < 100 ? 'rgba(255,0,0,0.3)' : 'rgba(255,160,0,0.2)';
    ctx.fillStyle = gpwsColor;
    ctx.fillRect(altX + 1, altMidY + altH / 2 - gpwsH - 1, altW - 2, gpwsH);
  }

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
export function drawPropPanel(ctx, state, w, h) {
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

  // ── Annunciator panel (warning lights) ──
  const annX = 195;
  const annY = 8;
  const annW = 70;
  const annH = 16;
  const annGap = 3;

  // Master caution / warning
  const highAoa = aoaDeg > 18;
  const lowSpeed = speed < 55;
  const highVs = vs < -1500;

  const annunciators = [
    { label: 'L FUEL', active: false, color: '#FFCC00' },
    { label: 'R FUEL', active: false, color: '#FFCC00' },
    { label: 'OIL P', active: throttle > 95, color: '#FF4400' },
    { label: 'STALL', active: highAoa || lowSpeed, color: '#FF0000' },
    { label: 'VACUUM', active: false, color: '#FFCC00' },
    { label: 'VOLTS', active: false, color: '#FF4400' },
  ];

  for (let i = 0; i < annunciators.length; i++) {
    const ax = annX + (i % 2) * (annW + annGap);
    const ay = annY + Math.floor(i / 2) * (annH + annGap);
    ctx.fillStyle = annunciators[i].active ? annunciators[i].color : '#1a1a1a';
    ctx.fillRect(ax, ay, annW, annH);
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ax, ay, annW, annH);
    ctx.fillStyle = annunciators[i].active ? '#000000' : '#444444';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(annunciators[i].label, ax + annW / 2, ay + 12);
  }

  // ── Throttle quadrant (bottom-left) ──
  const tqX = 10;
  const tqY = h - 68;
  const tqW = 55;
  const tqH = 60;

  // Throttle background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(tqX, tqY, tqW, tqH);
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 1;
  ctx.strokeRect(tqX, tqY, tqW, tqH);

  // Throttle bar
  const thrFillH = (throttle / 100) * (tqH - 10);
  ctx.fillStyle = throttle > 90 ? '#FF4400' : '#00CC44';
  ctx.fillRect(tqX + 12, tqY + tqH - 5 - thrFillH, 18, thrFillH);

  // Throttle frame marks
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const my = tqY + tqH - 5 - (i / 4) * (tqH - 10);
    ctx.beginPath();
    ctx.moveTo(tqX + 8, my);
    ctx.lineTo(tqX + 14, my);
    ctx.stroke();
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('THR', tqX + tqW / 2, tqY - 3);
  ctx.fillStyle = '#FFCC00';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(Math.round(throttle) + '%', tqX + tqW / 2 + 5, tqY + tqH / 2);

  // ── Status indicators (bottom strip) ──
  const statusY = h - 12;
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  const statusItems = [
    { label: 'FLAP', val: state.flaps ? 'DN' : 'UP', color: state.flaps ? '#00CC44' : '#888888', x: 80 },
    { label: 'GEAR', val: state.gear ? 'DN' : 'UP', color: state.gear ? '#00CC44' : '#FF8800', x: 180 },
    { label: 'BRK', val: state.speedbrake ? 'ON' : 'OFF', color: state.speedbrake ? '#FF8800' : '#888888', x: 270 },
  ];
  for (const item of statusItems) {
    ctx.fillStyle = '#888888';
    ctx.fillText(item.label + ':', item.x, statusY);
    ctx.fillStyle = item.color;
    ctx.fillText(item.val, item.x + ctx.measureText(item.label + ': ').width, statusY);
  }

  // G-force
  ctx.fillStyle = '#FF8800';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('G: ' + (state.gForce || 1).toFixed(1), w - 10, h - 15);
}

/**
 * Jet airliner instrument panel: dual PFDs + engine gauges.
 */
export function drawJetPanel(ctx, state, w, h) {
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

  // ── ECAM / Status Area ──
  const ecamY = engTop + barH + 40;
  ctx.fillStyle = '#060a10';
  ctx.fillRect(engX + 5, ecamY, engW - 10, h - ecamY - 10);
  ctx.strokeStyle = '#223344';
  ctx.strokeRect(engX + 5, ecamY, engW - 10, h - ecamY - 10);

  // ECAM header with separator
  ctx.fillStyle = '#4488cc';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('E/WD', engX + engW / 2, ecamY + 12);
  ctx.strokeStyle = '#334455';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(engX + 10, ecamY + 16);
  ctx.lineTo(engX + engW - 10, ecamY + 16);
  ctx.stroke();

  const aoaDegJet = (state.aoa || 0) * (180 / Math.PI);
  const machJet = (state.speed * MS_TO_KNOTS) / 661.5;
  const speedKts = state.speed * MS_TO_KNOTS;

  // Flight phase determination
  let flightPhase = 'CRZ';
  if (state.onGround) flightPhase = speedKts > 5 ? 'TAXI' : 'PARK';
  else if (state.altitudeAGL < 50 && state.verticalSpeed * MS_TO_FPM < -200) flightPhase = 'FLARE';
  else if (state.gear && state.verticalSpeed * MS_TO_FPM < -300) flightPhase = 'APPR';
  else if (state.altitude * M_TO_FEET > 10000 && state.verticalSpeed * MS_TO_FPM > 200) flightPhase = 'CLB';
  else if (state.altitude * M_TO_FEET > 10000 && state.verticalSpeed * MS_TO_FPM < -200) flightPhase = 'DES';
  else if (state.verticalSpeed * MS_TO_FPM > 300) flightPhase = 'CLB';

  // Phase indicator
  ctx.fillStyle = '#00CC44';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FLT', engX + 10, ecamY + 28);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'right';
  ctx.fillText(flightPhase, engX + engW - 10, ecamY + 28);

  // Status messages
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  let lineY = ecamY + 42;
  const lineH = 12;

  const msgs = [];
  if (state.gear) msgs.push({ text: 'GEAR DN', color: '#00CC44' });
  else msgs.push({ text: 'GEAR UP', color: '#88AACC' });
  if (state.flaps) msgs.push({ text: 'FLAPS  EXT', color: '#00CC44' });
  if (state.speedbrake) msgs.push({ text: 'SPD BRK  ON', color: '#FF8800' });
  msgs.push({ text: 'AoA ' + aoaDegJet.toFixed(1) + '\u00B0', color: aoaDegJet > 20 ? '#FF2200' : '#88AACC' });
  msgs.push({ text: 'M ' + machJet.toFixed(2), color: machJet > 0.82 ? '#FFCC00' : '#88AACC' });
  msgs.push({ text: 'G ' + (state.gForce || 1).toFixed(1), color: Math.abs((state.gForce || 1) - 1) > 0.8 ? '#FF8800' : '#88AACC' });

  // Fuel (simulated)
  const fuelPct = Math.max(0, 85 - (throttle * 0.002));
  msgs.push({ text: 'FUEL ' + fuelPct.toFixed(0) + '%', color: fuelPct < 20 ? '#FFCC00' : '#88AACC' });

  for (let i = 0; i < msgs.length && i < 8; i++) {
    ctx.fillStyle = msgs[i].color;
    ctx.fillText(msgs[i].text, engX + 10, lineY + i * lineH);
  }

  // Warning area at bottom of ECAM
  const warnY = h - 26;
  if (aoaDegJet > 22 || speedKts < 120) {
    ctx.fillStyle = '#FF0000';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(aoaDegJet > 22 ? 'STALL' : 'SPD LOW', engX + engW / 2, warnY);
  }
}

/**
 * Fighter HUD-style panel: green phosphor on black with scan lines.
 */
export function drawFighterPanel(ctx, state, w, h) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);

  // Subtle scan lines (batched into single path for performance)
  ctx.beginPath();
  for (let y = 0; y < h; y += 4) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.strokeStyle = 'rgba(0, 255, 60, 0.03)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const hudColor = '#00FF44';
  const hudDim = '#006622';
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

  // ── AoA bracket indicator (lower left) ──
  ctx.fillStyle = hudColor;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('\u03B1 ' + aoaDeg.toFixed(1) + '\u00B0', 20, h - 50);

  // AoA bracket (E-bracket for optimal AoA)
  const aoaBracketX = 42;
  const aoaBracketY = h - 90;
  const optAoa = 12; // optimal AoA for F-16
  const aoaOffset = Math.max(-25, Math.min(25, (aoaDeg - optAoa) * 2));
  ctx.strokeStyle = hudColor;
  ctx.lineWidth = 1.5;
  // E-bracket
  ctx.beginPath();
  ctx.moveTo(aoaBracketX, aoaBracketY - 15);
  ctx.lineTo(aoaBracketX - 8, aoaBracketY - 15);
  ctx.lineTo(aoaBracketX - 8, aoaBracketY + 15);
  ctx.lineTo(aoaBracketX, aoaBracketY + 15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(aoaBracketX - 8, aoaBracketY);
  ctx.lineTo(aoaBracketX, aoaBracketY);
  ctx.stroke();
  // AoA caret
  ctx.beginPath();
  ctx.moveTo(aoaBracketX + 4, aoaBracketY + aoaOffset);
  ctx.lineTo(aoaBracketX + 10, aoaBracketY + aoaOffset - 4);
  ctx.lineTo(aoaBracketX + 10, aoaBracketY + aoaOffset + 4);
  ctx.closePath();
  ctx.fillStyle = Math.abs(aoaDeg - optAoa) < 3 ? hudColor : '#FFCC00';
  ctx.fill();

  // ── Throttle bar (far left) ──
  const thrBarX = 15;
  const thrBarY = cy - 80;
  const thrBarH = 160;
  const thrBarW = 8;
  ctx.strokeStyle = hudDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(thrBarX, thrBarY, thrBarW, thrBarH);
  const thrFill = (throttle / 100) * thrBarH;
  ctx.fillStyle = throttle > 95 ? '#FFCC00' : hudColor;
  ctx.fillRect(thrBarX, thrBarY + thrBarH - thrFill, thrBarW, thrFill);

  // Mil power / afterburner marker
  const abLine = thrBarY + thrBarH * 0.1;
  ctx.strokeStyle = hudColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(thrBarX - 3, abLine);
  ctx.lineTo(thrBarX + thrBarW + 3, abLine);
  ctx.stroke();
  ctx.font = '6px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = hudDim;
  ctx.fillText('AB', thrBarX + thrBarW + 3, abLine + 3);

  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = hudColor;
  ctx.fillText('THR', thrBarX + thrBarW / 2, thrBarY - 5);
  ctx.fillText(Math.round(throttle) + '%', thrBarX + thrBarW / 2, thrBarY + thrBarH + 12);

  // ── VS readout ──
  ctx.fillStyle = hudColor;
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('VS ' + Math.round(vs) + ' fpm', w - 25, h - 50);

  // ── Radar/FCR indicator (bottom-right) ──
  const radarCx = w - 58;
  const radarCy = h - 100;
  const radarR = 28;

  // Radar scope background
  ctx.strokeStyle = hudDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(radarCx, radarCy, radarR, -Math.PI, 0);
  ctx.stroke();
  // Range rings
  ctx.strokeStyle = 'rgba(0,255,68,0.15)';
  ctx.beginPath();
  ctx.arc(radarCx, radarCy, radarR * 0.5, -Math.PI, 0);
  ctx.stroke();
  // Sweep line (animated)
  const sweepAngle = -Math.PI + ((performance.now() * 0.002) % Math.PI);
  ctx.strokeStyle = 'rgba(0,255,68,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(radarCx, radarCy);
  ctx.lineTo(radarCx + Math.cos(sweepAngle) * radarR, radarCy + Math.sin(sweepAngle) * radarR);
  ctx.stroke();

  ctx.fillStyle = hudDim;
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FCR', radarCx, radarCy + 10);

  // ── Status line (bottom center) ──
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const statusParts = [];
  if (state.gear) statusParts.push('GEAR');
  if (state.flaps) statusParts.push('FLAP');
  if (state.speedbrake) statusParts.push('BRK');
  if (statusParts.length > 0) {
    ctx.fillStyle = hudColor;
    ctx.fillText(statusParts.join(' | '), cx, h - 12);
  } else {
    ctx.fillStyle = hudDim;
    ctx.fillText('NAV', cx, h - 12);
  }
}

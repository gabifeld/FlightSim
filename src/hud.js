import { aircraftState } from './aircraft.js';
import { getKeys } from './controls.js';
import { getWeatherState } from './weather.js';
import { getAircraftType } from './aircraftTypes.js';
import { isOnTaxiway, getTaxiwayNetwork } from './taxi.js';
import { isLandingMode, computeILSGuidance, getScoreData, hasTouchdown } from './landing.js';
import { isAPEngaged, getAPState } from './autopilot.js';
import { getGPWSState } from './gpws.js';
import { getTimeOfDay, isNight } from './scene.js';
import { isReplayPlaying, getReplayState } from './replay.js';
import { getCurrentPreset } from './weatherFx.js';
import { isMenuOpen } from './menu.js';
import {
  MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM, STALL_AOA,
  RUNWAY_WIDTH, RUNWAY_LENGTH, TAXI_SPEED_LIMIT,
  AIRPORT2_X, AIRPORT2_Z,
  CITY_CENTER_X, CITY_CENTER_Z, CITY_SIZE,
} from './constants.js';
import { getRoadNetwork } from './city.js';
import { getTerrainHeight, getCloudDensity } from './terrain.js';
import { radToDeg } from './utils.js';

let els = {};
let minimapCtx = null;
let minimapZoom = 'local'; // 'local' | 'overview'
let terrainImage = null; // cached terrain background

export function initHUD() {
  els = {
    speed: document.getElementById('hud-speed'),
    altitude: document.getElementById('hud-altitude'),
    vspeed: document.getElementById('hud-vspeed'),
    heading: document.getElementById('hud-heading'),
    throttle: document.getElementById('hud-throttle'),
    throttleBar: document.getElementById('throttle-bar'),
    flaps: document.getElementById('hud-flaps'),
    gear: document.getElementById('hud-gear'),
    speedbrake: document.getElementById('hud-speedbrake'),
    brake: document.getElementById('hud-brake'),
    state: document.getElementById('hud-state'),
    message: document.getElementById('hud-message'),
    horizon: document.getElementById('attitude-horizon'),
    aoa: document.getElementById('hud-aoa'),
    gforce: document.getElementById('hud-gforce'),
    stallWarning: document.getElementById('hud-stall-warning'),
    wind: document.getElementById('hud-wind'),
    aircraftName: document.getElementById('hud-aircraft-name'),
    taxiIndicator: document.getElementById('hud-taxi'),
    // AP panel
    apPanel: document.getElementById('ap-panel'),
    apHdg: document.getElementById('ap-hdg'),
    apAlt: document.getElementById('ap-alt'),
    apVs: document.getElementById('ap-vs'),
    apSpd: document.getElementById('ap-spd'),
    apApr: document.getElementById('ap-apr'),
    apTargetHdg: document.getElementById('ap-target-hdg'),
    apTargetAlt: document.getElementById('ap-target-alt'),
    // New HUD elements
    timeDisplay: document.getElementById('hud-time'),
    gpwsWarning: document.getElementById('hud-gpws-warning'),
    replayIndicator: document.getElementById('hud-replay'),
    replayProgress: document.getElementById('replay-progress'),
    replayProgressBar: document.getElementById('replay-progress-bar'),
    weatherIndicator: document.getElementById('hud-weather'),
    lightsIndicator: document.getElementById('hud-lights'),
    // ILS elements
    ilsPanel: document.getElementById('ils-panel'),
    ilsDme: document.getElementById('ils-dme'),
    locDiamond: document.getElementById('loc-diamond'),
    gsDiamond: document.getElementById('gs-diamond'),
    // Landing score
    scorePanel: document.getElementById('landing-score-panel'),
    scoreGrade: document.getElementById('score-grade'),
    scoreTotal: document.getElementById('score-total'),
    scoreVs: document.getElementById('score-vs'),
    scoreCl: document.getElementById('score-cl'),
    scoreTz: document.getElementById('score-tz'),
    scoreSpeed: document.getElementById('score-speed'),
    scoreBest: document.getElementById('score-best'),
  };

  const minimapCanvas = document.getElementById('minimap-canvas');
  if (minimapCanvas) {
    minimapCtx = minimapCanvas.getContext('2d');
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
    minimapCanvas.addEventListener('click', () => {
      minimapZoom = minimapZoom === 'local' ? 'overview' : 'local';
    });
    // Pre-render terrain (deferred slightly for terrain to be ready)
    setTimeout(() => renderTerrainImage(), 100);
  }
}

export function updateHUD(flightState) {
  // Hide HUD when menu is open
  const hudEl = document.getElementById('hud');
  const helpEl = document.getElementById('controls-help');
  if (isMenuOpen()) {
    if (hudEl) hudEl.style.opacity = '0';
    if (helpEl) helpEl.style.opacity = '0';
    return;
  } else {
    if (hudEl) hudEl.style.opacity = '1';
    if (helpEl) helpEl.style.opacity = '1';
  }

  const state = aircraftState;
  const keys = getKeys();

  // Flight data
  if (els.speed) els.speed.textContent = Math.round(state.speed * MS_TO_KNOTS);
  if (els.altitude) els.altitude.textContent = Math.round(state.altitude * M_TO_FEET);

  const vs = Math.round(state.verticalSpeed * MS_TO_FPM);
  if (els.vspeed) els.vspeed.textContent = (vs > 0 ? '+' : '') + vs;

  if (els.heading) els.heading.textContent = String(Math.round(state.heading)).padStart(3, '0');

  // Throttle
  const thrPct = Math.round(state.throttle * 100);
  if (els.throttle) els.throttle.textContent = thrPct + '%';
  if (els.throttleBar) els.throttleBar.style.width = thrPct + '%';

  // Gear
  if (els.gear) {
    els.gear.textContent = state.gear ? 'DOWN' : 'UP';
    els.gear.className = 'sys-status ' + (state.gear ? 'on' : 'warn');
  }

  // Flaps
  if (els.flaps) {
    els.flaps.textContent = state.flaps ? 'DOWN' : 'UP';
    els.flaps.className = 'sys-status ' + (state.flaps ? 'on' : 'off');
  }

  // Speedbrake
  if (els.speedbrake) {
    els.speedbrake.textContent = state.speedbrake ? 'ON' : 'OFF';
    els.speedbrake.className = 'sys-status ' + (state.speedbrake ? 'active' : 'off');
  }

  // Brake
  const braking = keys[' '] && state.onGround;
  if (els.brake) {
    els.brake.textContent = braking ? 'ON' : 'OFF';
    els.brake.className = 'sys-status ' + (braking ? 'active' : 'off');
  }

  // Attitude indicator
  if (els.horizon) {
    const pitch = radToDeg(state.euler.x);
    const roll = radToDeg(state.euler.z);
    els.horizon.style.transform =
      `translateY(${pitch * 1.5}px) rotate(${-roll}deg)`;
  }

  // AoA display
  if (els.aoa) {
    const aoaDeg = radToDeg(state.aoa);
    els.aoa.textContent = aoaDeg.toFixed(1) + '\u00B0';
  }

  // G-force display
  if (els.gforce) {
    els.gforce.textContent = state.gForce.toFixed(1) + 'G';
  }

  // Stall warning
  const stallAoa = state.config ? state.config.stallAoa : STALL_AOA;
  const isStalling = Math.abs(state.aoa) > stallAoa && state.speed > 5;
  if (els.stallWarning) {
    els.stallWarning.style.display = isStalling ? 'block' : 'none';
  }

  // Wind display
  if (els.wind) {
    const weather = getWeatherState();
    const windDir = Math.round(((weather.windDirection * 180 / Math.PI) + 360) % 360);
    const windSpd = Math.round(weather.windSpeed * MS_TO_KNOTS);
    els.wind.textContent = `${String(windDir).padStart(3, '0')}/${windSpd}KT`;
  }

  // Aircraft name
  if (els.aircraftName) {
    const type = getAircraftType(state.currentType);
    els.aircraftName.textContent = type.name;
  }

  // Taxi mode indicator
  if (els.taxiIndicator) {
    const onTaxi = state.onGround && state.speed < TAXI_SPEED_LIMIT * 1.2;
    const speedOverLimit = state.onGround && state.speed > TAXI_SPEED_LIMIT;
    if (onTaxi && isOnTaxiway(state.position.x, state.position.z)) {
      els.taxiIndicator.style.display = 'block';
      els.taxiIndicator.textContent = speedOverLimit ? 'TAXI - SLOW DOWN' : 'TAXI';
      els.taxiIndicator.className = speedOverLimit ? 'taxi-indicator warn' : 'taxi-indicator';
    } else {
      els.taxiIndicator.style.display = 'none';
    }
  }

  // Landing/taxi lights
  if (els.lightsIndicator) {
    els.lightsIndicator.textContent = state.landingLight ? 'ON' : 'OFF';
    els.lightsIndicator.className = 'sys-status ' + (state.landingLight ? 'on' : 'off');
  }

  // Autopilot panel
  updateAPPanel();

  // Time display
  if (els.timeDisplay) {
    const tod = getTimeOfDay();
    const hours = Math.floor(tod);
    const mins = Math.floor((tod % 1) * 60);
    els.timeDisplay.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} LOCAL`;
  }

  // GPWS overlay
  const gpws = getGPWSState();
  if (els.gpwsWarning) {
    if (gpws.pullUpActive) {
      els.gpwsWarning.style.display = 'block';
      els.gpwsWarning.textContent = 'PULL UP';
    } else if (gpws.activeWarning) {
      els.gpwsWarning.style.display = 'block';
      els.gpwsWarning.textContent = gpws.activeWarning;
    } else {
      els.gpwsWarning.style.display = 'none';
    }
  }

  // Replay indicator
  if (els.replayIndicator) {
    if (isReplayPlaying()) {
      els.replayIndicator.style.display = 'block';
      const rs = getReplayState();
      const timeStr = `${Math.floor(rs.timeSeconds / 60)}:${String(Math.floor(rs.timeSeconds % 60)).padStart(2, '0')}`;
      const totalStr = `${Math.floor(rs.totalSeconds / 60)}:${String(Math.floor(rs.totalSeconds % 60)).padStart(2, '0')}`;
      els.replayIndicator.textContent = `REPLAY ${rs.speed}x  ${timeStr} / ${totalStr}`;
    } else {
      els.replayIndicator.style.display = 'none';
    }
  }
  if (els.replayProgressBar) {
    if (isReplayPlaying()) {
      els.replayProgressBar.style.display = 'block';
      const rs = getReplayState();
      if (els.replayProgress) {
        els.replayProgress.style.width = `${rs.progress * 100}%`;
      }
    } else {
      els.replayProgressBar.style.display = 'none';
    }
  }

  // Weather indicator
  if (els.weatherIndicator) {
    els.weatherIndicator.textContent = getCurrentPreset().toUpperCase() + ' | CLD: ' + getCloudDensity().toUpperCase();
  }

  // ILS guidance
  updateILS(state);

  // State
  if (els.state) els.state.textContent = flightState;

  // Minimap
  updateMinimap();
}

function updateAPPanel() {
  if (!els.apPanel) return;

  const engaged = isAPEngaged();
  els.apPanel.style.display = engaged ? 'flex' : 'none';

  if (!engaged) return;

  const ap = getAPState();

  if (els.apHdg) {
    els.apHdg.className = 'ap-mode' + (ap.hdgHold ? ' active' : '');
  }
  if (els.apAlt) {
    els.apAlt.className = 'ap-mode' + (ap.altHold ? ' active' : '');
  }
  if (els.apVs) {
    els.apVs.className = 'ap-mode' + (ap.vsMode ? ' active' : '');
  }
  if (els.apSpd) {
    els.apSpd.className = 'ap-mode' + (ap.spdHold ? ' active' : '');
  }
  if (els.apApr) {
    els.apApr.className = 'ap-mode' + (ap.aprMode ? ' active' : '');
  }
  if (els.apTargetHdg) {
    els.apTargetHdg.textContent = `HDG ${Math.round(ap.targetHeading)}`;
  }
  if (els.apTargetAlt) {
    els.apTargetAlt.textContent = `ALT ${Math.round(ap.targetAltitude)}ft`;
  }
}

function updateILS(state) {
  if (!els.ilsPanel) return;

  // Show ILS when on approach (airborne or in landing mode and not landed)
  const showILS = !state.onGround || (isLandingMode() && !hasTouchdown());

  if (!showILS && !isLandingMode()) {
    els.ilsPanel.style.display = 'none';
    return;
  }

  const ils = computeILSGuidance(state);
  if (!ils || ils.pastThreshold) {
    els.ilsPanel.style.display = 'none';
    return;
  }

  els.ilsPanel.style.display = 'block';

  // DME distance
  if (els.ilsDme) {
    els.ilsDme.textContent = ils.distNM.toFixed(1) + ' NM';
  }

  // Localizer diamond (horizontal position, clamped to +-48px)
  if (els.locDiamond) {
    const locPx = Math.max(-48, Math.min(48, ils.locDots * 20));
    els.locDiamond.style.left = `calc(50% + ${locPx}px)`;
    els.locDiamond.style.borderColor = ils.onLocalizer ? '#44dd66' : '#ffaa33';
  }

  // Glideslope diamond (vertical position, clamped to +-48px)
  if (els.gsDiamond) {
    const gsPx = Math.max(-48, Math.min(48, ils.gsDots * 20));
    els.gsDiamond.style.top = `calc(50% - ${gsPx}px)`;
    els.gsDiamond.style.borderColor = ils.onGlideslope ? '#44dd66' : '#ffaa33';
  }
}

export function showLandingScore(score) {
  if (!els.scorePanel) return;
  els.scorePanel.style.display = 'block';

  if (els.scoreGrade) {
    els.scoreGrade.textContent = score.overall.grade;
    els.scoreGrade.className = 'score-grade grade-' + score.overall.grade.toLowerCase();
  }
  if (els.scoreTotal) els.scoreTotal.textContent = score.overall.score + '/100';
  if (els.scoreVs) els.scoreVs.textContent = `${score.vs.value} FPM - ${score.vs.grade}`;
  if (els.scoreCl) els.scoreCl.textContent = `${score.centerline.value}m - ${score.centerline.grade}`;
  if (els.scoreTz) els.scoreTz.textContent = `${score.touchdownZone.value}m - ${score.touchdownZone.grade}`;
  if (els.scoreSpeed) els.scoreSpeed.textContent = `${score.speed.value} KTS`;
  if (els.scoreBest) {
    els.scoreBest.textContent = score.newBest ? 'NEW BEST!' : `BEST: ${score.bestScore}`;
    els.scoreBest.className = 'score-best' + (score.newBest ? ' new-best' : '');
  }
}

export function hideLandingScore() {
  if (els.scorePanel) els.scorePanel.style.display = 'none';
}

function renderTerrainImage() {
  const size = 180;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const worldRange = 20000; // covers full terrain for overview mode

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = (x / size - 0.5) * worldRange;
      const wz = (y / size - 0.5) * worldRange;
      const h = getTerrainHeight(wx, wz);
      const idx = (y * size + x) * 4;

      if (h < 0.5) {
        // Water
        data[idx] = 20; data[idx+1] = 40; data[idx+2] = 80; data[idx+3] = 255;
      } else if (h < 30) {
        // Low green
        data[idx] = 35; data[idx+1] = 70 + h; data[idx+2] = 30; data[idx+3] = 255;
      } else if (h < 100) {
        // Mid brown-green
        const t = (h - 30) / 70;
        data[idx] = 35 + t * 60; data[idx+1] = 70 + h * 0.3; data[idx+2] = 30 + t * 20; data[idx+3] = 255;
      } else if (h < 250) {
        // Brown-gray
        const t = (h - 100) / 150;
        data[idx] = 95 + t * 30; data[idx+1] = 80 + t * 20; data[idx+2] = 55 + t * 30; data[idx+3] = 255;
      } else {
        // Gray-white peaks
        const t = Math.min((h - 250) / 150, 1);
        data[idx] = 125 + t * 100; data[idx+1] = 120 + t * 100; data[idx+2] = 115 + t * 110; data[idx+3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  terrainImage = canvas;
}

function updateMinimap() {
  if (!minimapCtx) return;

  const ctx = minimapCtx;
  const w = 180;
  const h = 180;

  const px = aircraftState.position.x;
  const pz = aircraftState.position.z;

  // Zoom levels
  const viewRange = minimapZoom === 'local' ? 4000 : 20000;
  const scale = w / viewRange;

  // Background - terrain or dark
  if (minimapZoom === 'overview' && terrainImage) {
    // Draw pre-rendered terrain image
    ctx.drawImage(terrainImage, 0, 0, w, h);
    // Darken slightly for contrast
    ctx.fillStyle = 'rgba(0, 8, 20, 0.35)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, w, h);

    // Grid for local view
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.1)';
    ctx.lineWidth = 0.5;
    const gridStep = 500;
    const startGrid = Math.floor((px - viewRange/2) / gridStep) * gridStep;
    const endGrid = px + viewRange/2;
    for (let g = startGrid; g <= endGrid; g += gridStep) {
      const sx = (g - px) * scale + w / 2;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    }
    const startGridZ = Math.floor((pz - viewRange/2) / gridStep) * gridStep;
    const endGridZ = pz + viewRange/2;
    for (let g = startGridZ; g <= endGridZ; g += gridStep) {
      const sy = (g - pz) * scale + h / 2;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }
  }

  // Helper to convert world coords to minimap pixel coords
  const toX = (wx) => (wx - px) * scale + w / 2;
  const toY = (wz) => (wz - pz) * scale + h / 2;

  // ── Airport 1 runway ──
  const rw1 = RUNWAY_WIDTH * scale;
  const rl1 = RUNWAY_LENGTH * scale;
  ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
  ctx.fillRect(toX(0) - rw1/2, toY(-RUNWAY_LENGTH/2), rw1, rl1);

  // Airport 1 taxiway
  ctx.strokeStyle = 'rgba(200, 200, 0, 0.3)';
  ctx.lineWidth = Math.max(1, 2 * scale * 10);
  ctx.beginPath();
  ctx.moveTo(toX(RUNWAY_WIDTH/2 + 100), toY(-700));
  ctx.lineTo(toX(RUNWAY_WIDTH/2 + 100), toY(700));
  ctx.stroke();

  // Taxi network edges (Airport 1)
  const network = getTaxiwayNetwork();
  ctx.strokeStyle = 'rgba(200, 200, 0, 0.2)';
  ctx.lineWidth = 1;
  for (const [a, b] of network.edges) {
    const na = network.nodeMap[a];
    const nb = network.nodeMap[b];
    if (!na || !nb) continue;
    ctx.beginPath();
    ctx.moveTo(toX(na.x), toY(na.z));
    ctx.lineTo(toX(nb.x), toY(nb.z));
    ctx.stroke();
  }

  // ── Airport 2 runway ──
  ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
  ctx.fillRect(toX(AIRPORT2_X) - rw1/2, toY(AIRPORT2_Z - RUNWAY_LENGTH/2), rw1, rl1);

  // ── City zone ──
  const cityHalf = CITY_SIZE / 2;
  const cityX = toX(CITY_CENTER_X - cityHalf);
  const cityY = toY(CITY_CENTER_Z - cityHalf);
  const cityW = CITY_SIZE * scale;
  const cityH = CITY_SIZE * scale;
  ctx.fillStyle = 'rgba(60, 60, 80, 0.4)';
  ctx.fillRect(cityX, cityY, cityW, cityH);

  // City roads
  try {
    const roads = getRoadNetwork();
    ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
    for (const seg of roads) {
      ctx.lineWidth = Math.max(0.5, seg.width * scale);
      ctx.beginPath();
      ctx.moveTo(toX(seg.start.x), toY(seg.start.z));
      ctx.lineTo(toX(seg.end.x), toY(seg.end.z));
      ctx.stroke();
    }
  } catch(e) { /* city not loaded yet */ }

  // Glideslope line (when in landing mode)
  if (isLandingMode() && !hasTouchdown()) {
    ctx.strokeStyle = 'rgba(68, 221, 102, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(-RUNWAY_LENGTH/2));
    ctx.lineTo(toX(0), toY(-RUNWAY_LENGTH/2 - 5000));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Labels ──
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';

  // APT1 label
  ctx.fillStyle = 'rgba(200, 200, 255, 0.8)';
  ctx.fillText('APT1', toX(0), toY(-RUNWAY_LENGTH/2 - 80));

  // APT2 label
  ctx.fillText('APT2', toX(AIRPORT2_X), toY(AIRPORT2_Z - RUNWAY_LENGTH/2 - 80));

  // CITY label
  ctx.fillStyle = 'rgba(200, 180, 140, 0.8)';
  ctx.fillText('CITY', toX(CITY_CENTER_X), toY(CITY_CENTER_Z - cityHalf - 40));

  // ── Aircraft dot ──
  ctx.fillStyle = '#44ff66';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Heading line
  const hdgRad = (aircraftState.heading * Math.PI) / 180;
  const lineLen = 15;
  ctx.strokeStyle = '#44ff66';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2);
  ctx.lineTo(
    w / 2 - Math.sin(hdgRad) * lineLen,
    h / 2 - Math.cos(hdgRad) * lineLen
  );
  ctx.stroke();

  // ── Compass rose ──
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
  ctx.fillText('N', w / 2, 11);
  ctx.fillStyle = 'rgba(180, 180, 220, 0.5)';
  ctx.fillText('S', w / 2, h - 3);
  ctx.fillText('W', 8, h / 2 + 3);
  ctx.fillText('E', w - 8, h / 2 + 3);

  // Zoom indicator
  ctx.fillStyle = 'rgba(150, 180, 255, 0.5)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(minimapZoom === 'local' ? 'LOCAL' : 'OVERVIEW', w - 4, h - 3);
}

export function showMessage(msg) {
  if (els.message) els.message.textContent = msg;
}

export function clearMessage() {
  if (els.message) els.message.textContent = '';
}

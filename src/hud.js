import { getActiveVehicle, isAircraft, isCar } from './vehicleState.js';
import { getKeys } from './controls.js';
import { getWeatherState } from './weather.js';
import { getAircraftType } from './aircraftTypes.js';
import { isOnTaxiway, getTaxiwayNetwork } from './taxi.js';
import { isLandingMode, computeILSGuidance, getScoreData, hasTouchdown, isLandingAssistActive } from './landing.js';
import { isAPEngaged, getAPState } from './autopilot.js';
import { getGPWSState } from './gpws.js';
import { getTimeOfDay, isNight } from './scene.js';
import { isReplayPlaying, getReplayState } from './replay.js';
import { getCurrentPreset } from './weatherFx.js';
import { isMenuOpen } from './menu.js';
import { getActiveChallenge, getChallengeState, formatTime } from './challenges.js';
import {
  MS_TO_KNOTS, M_TO_FEET, MS_TO_FPM, STALL_AOA,
  RUNWAY_WIDTH, RUNWAY_LENGTH, TAXI_SPEED_LIMIT,
  AIRPORT2_X, AIRPORT2_Z,
  CITY_CENTER_X, CITY_CENTER_Z, CITY_SIZE,
  INTL_AIRPORT_X, INTL_AIRPORT_Z, INTL_RUNWAY_LENGTH, INTL_RUNWAY_WIDTH,
  CT_CENTER_X, CT_CENTER_Z, CT_SIZE_X, CT_SIZE_Z,
  COAST_LINE_X,
} from './constants.js';
import { getRoadNetwork } from './city.js';
import { getTerrainHeightCached, getCloudDensity, getHighwayPath } from './terrain.js';
import { getSetting, setSetting } from './settings.js';
import { radToDeg } from './utils.js';
import { getRadioStack, getNavReceiver, getSelectedRadioName } from './radio.js';
import { getActiveWaypoint as getFPActiveWaypoint, getBearingToActive, getDistanceToActiveNM } from './flightplan.js';
import { getEngineCount, getAllEngineStates, isAnyEngineRunning } from './systemsEngine.js';
import { getBatteryCharge, getBusVoltage, isAvionicsPowered, isInstrumentsPowered, getElectricalState } from './electrical.js';
import { getActiveFailures } from './failures.js';
import { AIRPORTS } from './airportData.js';
import { getATCState, getATCInstruction } from './atc.js';
import { getJobState, isJobActive } from './groundJobs.js';
import { isRaceActive, getRaceState, formatRaceTime } from './raceMode.js';

let els = {};
let minimapCtx = null;
let minimapMode = 'local'; // 'local' | 'overview' | 'fullscreen'
let terrainImage = null; // cached terrain background
let ilsDismissed = false;
let lastMinimapUpdateMs = 0;
let fullmapCtx = null;
let fullmapCanvas = null;

// Waypoints
const waypoints = [];
const MAX_WAYPOINTS = 5;
let activeWaypointIdx = 0;
let cachedRoadNetwork = null;
let cachedTaxiNetwork = null;

// HUD mode: 'full' | 'minimal' | 'off'
let hudMode = 'full';

// Speed tape
let speedTapeBuilt = false;

export function initHUD() {
  els = {
    hudRoot: document.getElementById('hud'),
    controlsHelp: document.getElementById('controls-help-wrap'),
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
    fuel: document.getElementById('hud-fuel'),
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
    // Challenge elements
    dailyBriefing: document.getElementById('daily-briefing'),
    dailySeed: document.getElementById('daily-seed'),
    dailyAircraft: document.getElementById('daily-aircraft'),
    dailyApproach: document.getElementById('daily-approach'),
    dailyWind: document.getElementById('daily-wind'),
    dailyEmergency: document.getElementById('daily-emergency'),
    speedrunTimer: document.getElementById('speedrun-timer'),
    speedrunTime: document.getElementById('speedrun-time'),
    engineFailWarning: document.getElementById('engine-fail-warning'),
    // Speed tape
    speedTapeStrip: document.getElementById('speed-tape-strip'),
    speedTapeCurrent: document.getElementById('speed-tape-current'),
    speedTapeContainer: document.getElementById('speed-tape'),
    waypoint: document.getElementById('hud-waypoint'),
  };

  const minimapCanvas = document.getElementById('minimap-canvas');
  if (minimapCanvas) {
    minimapCtx = minimapCanvas.getContext('2d');
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
    minimapCanvas.addEventListener('click', () => {
      if (minimapMode === 'local') minimapMode = 'overview';
      else if (minimapMode === 'overview') openFullscreenMap();
      else minimapMode = 'local';
    });
    // Pre-render terrain (deferred slightly for terrain to be ready)
    setTimeout(() => renderTerrainImage(), 100);
    cachedTaxiNetwork = getTaxiwayNetwork();
    cachedRoadNetwork = getRoadNetwork();
  }

  // Fullscreen map canvas
  fullmapCanvas = document.getElementById('fullmap-canvas');
  if (fullmapCanvas) {
    fullmapCtx = fullmapCanvas.getContext('2d');
  }

  // Escape to close fullscreen map
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && minimapMode === 'fullscreen') {
      closeFullscreenMap();
    }
  });

  // Create systems info strip (radio, engine, electrical)
  const hudContainer2 = document.getElementById('hud');
  if (hudContainer2) {
    const sysStrip = document.createElement('div');
    sysStrip.id = 'systems-strip';
    sysStrip.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:40;font-family:monospace;font-size:11px;color:#ccc;text-align:center;pointer-events:none;display:flex;gap:12px;background:rgba(0,0,0,0.5);padding:3px 10px;border-radius:4px;';
    const radioSpan = document.createElement('span');
    radioSpan.id = 'sys-radio';
    const engSpan = document.createElement('span');
    engSpan.id = 'sys-engines';
    const elecSpan = document.createElement('span');
    elecSpan.id = 'sys-elec';
    const cautionSpan = document.createElement('span');
    cautionSpan.id = 'sys-caution';
    cautionSpan.style.cssText = 'color:#ffaa00;font-weight:bold;';
    sysStrip.appendChild(radioSpan);
    sysStrip.appendChild(engSpan);
    sysStrip.appendChild(elecSpan);
    sysStrip.appendChild(cautionSpan);
    hudContainer2.appendChild(sysStrip);
    els.sysRadio = radioSpan;
    els.sysEngines = engSpan;
    els.sysElec = elecSpan;
    els.sysCaution = cautionSpan;
    els.sysStrip = sysStrip;
  }

  // Pre-create landing assist indicator
  const hudContainer = document.getElementById('hud');
  if (hudContainer) {
    const assistEl = document.createElement('div');
    assistEl.id = 'hud-landing-assist';
    assistEl.className = 'landing-assist-indicator';
    assistEl.textContent = 'LAND ASSIST';
    assistEl.style.display = 'none';
    hudContainer.appendChild(assistEl);
    els.landingAssist = assistEl;
  }

  // Build speed tape ticks
  buildSpeedTape();

  // Restore HUD mode from settings
  hudMode = getSetting('hudMode') || 'full';
  applyHudMode();
}

function buildSpeedTape() {
  const strip = els.speedTapeStrip;
  if (!strip || speedTapeBuilt) return;
  speedTapeBuilt = true;

  // Build ticks from 0 to 600kt, each tick every 10kt
  // Each tick is 24px tall
  const tickHeight = 24;
  const maxSpeed = 600;
  const tickCount = maxSpeed / 10;

  for (let i = 0; i <= tickCount; i++) {
    const speed = i * 10;
    const tick = document.createElement('div');
    tick.className = 'speed-tape-tick' + (speed % 50 === 0 ? ' major' : '');
    tick.style.top = ((tickCount - i) * tickHeight) + 'px';
    tick.textContent = speed % 50 === 0 ? speed : '';
    strip.appendChild(tick);
  }

  strip.style.height = ((tickCount + 1) * tickHeight) + 'px';
}

function updateSpeedTape(speedKts) {
  if (!els.speedTapeStrip) return;
  const tickHeight = 24;
  const maxSpeed = 600;
  const tickCount = maxSpeed / 10;

  // Center the strip so current speed aligns with pointer (at 50% height)
  const containerHeight = 240;
  const speedPos = ((maxSpeed - speedKts) / 10) * tickHeight;
  const offset = speedPos - containerHeight / 2 + tickHeight / 2;
  els.speedTapeStrip.style.transform = `translateY(${-offset}px)`;

  if (els.speedTapeCurrent) {
    els.speedTapeCurrent.textContent = Math.round(speedKts);
  }
}

function applyHudMode() {
  const hudEl = els.hudRoot;
  if (!hudEl) return;
  hudEl.classList.remove('hud-minimal', 'hud-off');
  if (hudMode === 'minimal') hudEl.classList.add('hud-minimal');
  else if (hudMode === 'off') hudEl.classList.add('hud-off');
}

export function cycleHudMode() {
  if (hudMode === 'full') hudMode = 'minimal';
  else if (hudMode === 'minimal') hudMode = 'off';
  else hudMode = 'full';
  setSetting('hudMode', hudMode);
  applyHudMode();
  return hudMode;
}

export function updateHUD(flightState) {
  // Hide HUD when menu is open
  const hudEl = els.hudRoot;
  const helpEl = els.controlsHelp;
  if (isMenuOpen()) {
    if (hudEl) hudEl.style.opacity = '0';
    if (helpEl) helpEl.style.opacity = '0';
    return;
  } else {
    if (hudEl) hudEl.style.opacity = '1';
    if (helpEl) helpEl.style.opacity = '1';
  }

  const state = getActiveVehicle();
  const keys = getKeys();
  const isAircraftVehicle = isAircraft(state);

  // Power loss — show dashes for aircraft instruments when unpowered
  const instrumentsOff = isAircraftVehicle && !isInstrumentsPowered();

  // Speed display: knots for aircraft, mph for cars
  // Deadband: below 5 knots / 6 mph, hold at 0 to prevent jitter from float noise
  let speedDisplay;
  if (isAircraftVehicle) {
    const rawKts = state.speed * MS_TO_KNOTS;
    speedDisplay = rawKts < 5 ? 0 : Math.round(rawKts);
  } else {
    const rawMph = Math.abs(state.speed) * 2.237;
    speedDisplay = rawMph < 6 ? 0 : Math.round(rawMph);
  }
  if (els.speed) els.speed.textContent = instrumentsOff ? '---' : speedDisplay;
  if (els.altitude) els.altitude.textContent = instrumentsOff ? '-----' : Math.round(state.altitude * M_TO_FEET);

  if (els.heading) els.heading.textContent = instrumentsOff ? '---' : String(Math.round(state.heading)).padStart(3, '0');

  // Speed tape
  updateSpeedTape(speedDisplay);

  // Throttle
  const thrPct = Math.round(state.throttle * 100);
  if (els.throttle) els.throttle.textContent = instrumentsOff ? '--' : thrPct + '%';
  if (els.throttleBar) els.throttleBar.style.width = (instrumentsOff ? 0 : thrPct) + '%';

  // Flight-specific HUD (aircraft only)
  if (isAircraftVehicle) {
    const vs = Math.round(state.verticalSpeed * MS_TO_FPM);
    if (els.vspeed) { els.vspeed.textContent = instrumentsOff ? '---' : (vs > 0 ? '+' : '') + vs; els.vspeed.parentElement && (els.vspeed.style.display = ''); }

    if (els.gear) {
      els.gear.textContent = state.gear ? 'DOWN' : 'UP';
      els.gear.className = 'sys-status ' + (state.gear ? 'on' : 'warn');
    }
    if (els.flaps) {
      els.flaps.textContent = state.flaps ? 'DOWN' : 'UP';
      els.flaps.className = 'sys-status ' + (state.flaps ? 'on' : 'off');
    }
    if (els.speedbrake) {
      els.speedbrake.textContent = state.speedbrake ? 'ON' : 'OFF';
      els.speedbrake.className = 'sys-status ' + (state.speedbrake ? 'active' : 'off');
    }
    if (els.horizon) {
      if (instrumentsOff) {
        els.horizon.style.transform = '';
        els.horizon.style.opacity = '0.2';
      } else {
        els.horizon.style.opacity = '1';
        const pitch = radToDeg(state.euler.x);
        const roll = radToDeg(state.euler.z);
        els.horizon.style.transform = `translateY(${pitch * 1.5}px) rotate(${-roll}deg)`;
      }
    }
    if (els.aoa) {
      const aoaDeg = radToDeg(state.aoa);
      els.aoa.textContent = aoaDeg.toFixed(1) + '\u00B0';
    }
    if (els.gforce) {
      els.gforce.textContent = state.gForce.toFixed(1) + 'G';
    }
    const stallAoa = state.config ? state.config.stallAoa : STALL_AOA;
    const isStalling = Math.abs(state.aoa) > stallAoa && state.speed > 5;
    if (els.stallWarning) {
      els.stallWarning.style.display = isStalling ? 'block' : 'none';
    }
  } else {
    // Non-aircraft: hide flight instruments
    if (els.vspeed) els.vspeed.textContent = '--';
    if (els.gear) { els.gear.textContent = '--'; els.gear.className = 'sys-status off'; }
    if (els.flaps) { els.flaps.textContent = '--'; els.flaps.className = 'sys-status off'; }
    if (els.speedbrake) { els.speedbrake.textContent = '--'; els.speedbrake.className = 'sys-status off'; }
    if (els.aoa) els.aoa.textContent = '--';
    if (els.gforce) els.gforce.textContent = '--';
    if (els.stallWarning) els.stallWarning.style.display = 'none';
    if (els.horizon) els.horizon.style.transform = '';
  }

  // Brake
  const braking = (keys[' '] || (!isAircraftVehicle && (keys['s'] || keys['arrowdown']))) && state.onGround;
  if (els.brake) {
    els.brake.textContent = braking ? 'ON' : 'OFF';
    els.brake.className = 'sys-status ' + (braking ? 'active' : 'off');
  }

  // Wind display
  if (els.wind) {
    const weather = getWeatherState();
    const windDir = Math.round(((weather.windDirection * 180 / Math.PI) + 360) % 360);
    const windSpd = Math.round(weather.windSpeed * MS_TO_KNOTS);
    els.wind.textContent = `${String(windDir).padStart(3, '0')}/${windSpd}KT`;
  }

  // Vehicle name
  if (els.aircraftName) {
    if (isAircraftVehicle) {
      const type = getAircraftType(state.currentType);
      els.aircraftName.textContent = type.name;
    } else {
      els.aircraftName.textContent = (state.config && state.config.name) || state.currentType || 'Vehicle';
    }
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

  // Fuel indicator
  if (els.fuel) {
    if (getSetting('unlimitedFuel')) {
      els.fuel.textContent = 'UNLIMITED';
      els.fuel.className = 'sys-status on';
    } else if (isAircraftVehicle && state.fuel !== undefined) {
      const pct = Math.round(state.fuel * 100);
      if (state.fuel <= 0) {
        els.fuel.textContent = 'EMPTY';
        els.fuel.className = 'sys-status active';
      } else if (pct <= 20) {
        els.fuel.textContent = pct + '%';
        els.fuel.className = 'sys-status active';
      } else if (pct <= 50) {
        els.fuel.textContent = pct + '%';
        els.fuel.className = 'sys-status warn';
      } else {
        els.fuel.textContent = pct + '%';
        els.fuel.className = 'sys-status on';
      }
    } else {
      els.fuel.textContent = '--';
      els.fuel.className = 'sys-status off';
    }
  }

  // Lights indicator
  if (els.lightsIndicator) {
    const lightsOn = isAircraftVehicle ? state.landingLight : state.headlights;
    els.lightsIndicator.textContent = lightsOn ? 'ON' : 'OFF';
    els.lightsIndicator.className = 'sys-status ' + (lightsOn ? 'on' : 'off');
  }

  // Autopilot panel (aircraft only)
  if (isAircraftVehicle) updateAPPanel();
  else if (els.apPanel) els.apPanel.style.display = 'none';

  // Systems strip (aircraft only)
  if (isAircraftVehicle && els.sysStrip) {
    els.sysStrip.style.display = 'flex';
    updateSystemsStrip(state);
  } else if (els.sysStrip) {
    els.sysStrip.style.display = 'none';
  }

  // Landing assist indicator (aircraft only)
  if (els.landingAssist) {
    els.landingAssist.style.display = isLandingAssistActive() ? 'block' : 'none';
  }

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

  // Challenge HUD
  updateChallengeHUD();

  // ILS guidance
  updateILS(state);

  // ATC instruction display
  const atcState = getATCState();
  const atcEl = document.getElementById('hud-atc-instruction');
  if (atcEl) {
    const instruction = getATCInstruction();
    atcEl.textContent = instruction || '';
    atcEl.style.display = instruction ? 'block' : 'none';
  }

  // Job HUD
  const jobEl = document.getElementById('hud-job-info');
  if (jobEl) {
    if (isJobActive()) {
      const job = getJobState();
      jobEl.textContent = `JOB: ${job.type.toUpperCase()} - ${job.phase.toUpperCase()} - ${Math.floor(job.timer)}s`;
      jobEl.style.display = 'block';
    } else {
      jobEl.style.display = 'none';
    }
  }

  // Race HUD
  const raceEl = document.getElementById('hud-race-info');
  if (raceEl) {
    if (isRaceActive()) {
      const rs = getRaceState();
      const lapTimeStr = formatRaceTime(rs.lapTimer);
      const totalStr = formatRaceTime(rs.raceTimer);
      const bestStr = rs.bestLap > 0 ? formatRaceTime(rs.bestLap) : '--:--.--';
      raceEl.textContent = `LAP ${rs.lap + 1}/${rs.totalLaps} | CP ${rs.currentCP + 1}/${rs.totalCPs} | Lap: ${lapTimeStr} | Total: ${totalStr} | Best: ${bestStr}`;
      raceEl.style.display = 'block';
    } else {
      raceEl.style.display = 'none';
    }
  }

  // Ground vehicle controls hint (shown when driving, not during active job)
  const driveHintEl = document.getElementById('hud-drive-hint');
  if (driveHintEl) {
    const av = getActiveVehicle();
    if (isCar(av) && !isJobActive()) {
      driveHintEl.textContent = 'W=Forward S=Brake/Reverse A/D=Steer L=Lights';
      driveHintEl.style.display = 'block';
    } else {
      driveHintEl.style.display = 'none';
    }
  }

  // Circuit challenge phase display (also used for other challenge HUD messages)
  const circuitEl = document.getElementById('hud-circuit-phase');
  if (circuitEl) {
    const challenge = getActiveChallenge();
    if (challenge === 'full_circuit') {
      const cs = getChallengeState();
      const phaseLabels = {
        pushback: 'REQUEST PUSHBACK (F1)',
        taxi: 'TAXI TO RUNWAY - USE ATC (F1)',
        takeoff: 'TAKEOFF - CLIMB TO PATTERN ALT (300m)',
        pattern: 'FLY PATTERN - TURN BASE & FINAL TO LAND',
        landing: 'LANDED - TAXI TO GATE',
        taxi_in: 'TAXI TO GATE AREA (x>300)',
        complete: 'CIRCUIT COMPLETE!',
      };
      const label = phaseLabels[cs.circuitPhase] || cs.circuitPhase;
      let text = `CIRCUIT: ${label} | ${formatTime(cs.circuitTimer)} | VIOLATIONS: ${cs.circuitViolations}`;
      if (cs.circuitPhaseMessage) {
        text += ` | ${cs.circuitPhaseMessage}`;
      }
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else if (challenge === 'cargo_run') {
      const cs = getChallengeState();
      if (!cs.cargoRunFinished) {
        circuitEl.textContent = `CARGO RUN: FLY TO AIRPORT 2 (8km NE) | ${formatTime(cs.cargoRunTimer)}`;
      } else {
        circuitEl.textContent = `CARGO RUN COMPLETE: ${formatTime(cs.cargoRunTimer)}`;
      }
      circuitEl.style.display = 'block';
    } else if (challenge === 'emergency_landing') {
      const cs = getChallengeState();
      if (cs.emergencyLandingActive) {
        circuitEl.textContent = 'EMERGENCY: ALL ENGINES FAILED - GLIDE TO ANY RUNWAY';
      } else {
        circuitEl.textContent = 'EMERGENCY LANDING COMPLETE';
      }
      circuitEl.style.display = 'block';
    } else if (challenge === 'crosswind') {
      const cs = getChallengeState();
      let text = `CROSSWIND: ${cs.level ? cs.level.toUpperCase() : ''}`;
      if (cs.crosswindGustActive) {
        text += ' | GUST!';
      }
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else if (challenge === 'engine_out') {
      const cs = getChallengeState();
      if (cs.engineFireWarningShown && cs.engineFireWarningTimer > 0) {
        circuitEl.textContent = 'WARNING: ENGINE FIRE DETECTED';
        circuitEl.style.display = 'block';
      } else if (cs.engineFailed) {
        circuitEl.textContent = 'ENGINE FAILED - LAND NOW';
        circuitEl.style.display = 'block';
      } else {
        circuitEl.textContent = 'ENGINE OUT CHALLENGE - FLY THE APPROACH';
        circuitEl.style.display = 'block';
      }
    } else if (challenge === 'speedrun') {
      const cs = getChallengeState();
      let text = `SPEEDRUN: ${formatTime(cs.speedrunTimer)}`;
      const splits = cs.speedrunSplits;
      if (splits[0] !== null) text += ` | DEPART: ${formatTime(splits[0])}`;
      if (splits[1] !== null) text += ` | MID: ${formatTime(splits[1])}`;
      if (splits[2] !== null) text += ` | APPROACH: ${formatTime(splits[2])}`;
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else if (challenge === 'daily') {
      const cs = getChallengeState();
      if (cs.dailyParams && cs.dailyParScore) {
        circuitEl.textContent = `DAILY CHALLENGE | PAR: ${cs.dailyParScore}`;
        circuitEl.style.display = 'block';
      } else {
        circuitEl.style.display = 'none';
      }
    } else if (challenge === 'touch_and_go') {
      const cs = getChallengeState();
      let text = `TOUCH & GO: ${cs.tagCount}/3 | ${formatTime(cs.tagTimer)}`;
      if (cs.tagMessage) text += ` | ${cs.tagMessage}`;
      if (cs.tagPhase === 'complete') text = cs.tagMessage;
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else if (challenge === 'precision_approach') {
      const cs = getChallengeState();
      let text = cs.precisionMessage || 'PRECISION APPROACH';
      if (cs.precisionSamples && cs.precisionSamples.length > 0 && cs.precisionTracking) {
        text += ` | SAMPLES: ${cs.precisionSamples.length}`;
      }
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else if (challenge === 'progressive') {
      const cs = getChallengeState();
      let text = cs.progressiveMessage || `PROGRESSIVE: LEVEL ${cs.progressiveLevel + 1}/5`;
      if (!cs.progressiveComplete) {
        text = `LEVEL ${cs.progressiveLevel + 1}/5 | ${text}`;
      }
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else if (challenge === 'stunt') {
      const cs = getChallengeState();
      let text;
      if (cs.stuntComplete) {
        text = cs.stuntMessage || `STUNT COMPLETE! SCORE: ${cs.stuntScore}`;
      } else if (cs.stuntMessage && cs.stuntMessageTimer > 0) {
        text = cs.stuntMessage;
      } else {
        text = `GATE ${cs.stuntCurrentGate}/${cs.stuntTotalGates} -- SCORE: ${cs.stuntScore} | ${formatTime(cs.stuntTimer)}`;
      }
      circuitEl.textContent = text;
      circuitEl.style.display = 'block';
    } else {
      circuitEl.style.display = 'none';
    }
  }

  // State
  if (els.state) els.state.textContent = flightState;

  // Minimap
  updateMinimap();
  updateFullscreenMap();

  // Waypoint bearing/distance
  const awp = getActiveWaypoint();
  if (awp && els.waypoint) {
    const dx = awp.x - state.position.x;
    const dz = awp.z - state.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const bearingRad = Math.atan2(-dx, -dz);
    let bearingDeg = bearingRad * 180 / Math.PI;
    if (bearingDeg < 0) bearingDeg += 360;
    const distNm = (dist / 1852).toFixed(1);
    els.waypoint.textContent = `${awp.label} \u2192 ${Math.round(bearingDeg).toString().padStart(3, '0')}\u00B0 ${distNm}nm`;
    els.waypoint.style.display = '';
  } else if (els.waypoint) {
    els.waypoint.style.display = 'none';
  }
}

let dailyBriefingDismissed = false;
let dailyDismissHandler = null;
let dailyDismissTouchHandler = null;
let dailyAutoTimer = 0;
let engineFailShown = false;
let speedrunFinishedShown = false;

function dismissDailyBriefing() {
  dailyBriefingDismissed = true;
  if (els.dailyBriefing) els.dailyBriefing.style.display = 'none';
}

function updateChallengeHUD() {
  const challenge = getActiveChallenge();
  const cs = getChallengeState();

  // Engine failure warning — force animation restart on each new failure
  if (els.engineFailWarning) {
    if (cs.engineFailed) {
      if (!engineFailShown) {
        engineFailShown = true;
        // Force animation restart by re-inserting element
        const parent = els.engineFailWarning.parentNode;
        const next = els.engineFailWarning.nextSibling;
        parent.removeChild(els.engineFailWarning);
        void els.engineFailWarning.offsetWidth; // trigger reflow
        parent.insertBefore(els.engineFailWarning, next);
      }
      els.engineFailWarning.style.display = 'block';
    } else {
      els.engineFailWarning.style.display = 'none';
      engineFailShown = false;
    }
  }

  // Speedrun timer — force finished animation restart
  if (els.speedrunTimer) {
    if (challenge === 'speedrun') {
      els.speedrunTimer.style.display = 'block';
      if (els.speedrunTime) {
        els.speedrunTime.textContent = formatTime(cs.speedrunTimer);
        if (cs.speedrunFinished) {
          if (!speedrunFinishedShown) {
            speedrunFinishedShown = true;
            // Force animation restart
            els.speedrunTime.classList.remove('finished');
            void els.speedrunTime.offsetWidth;
            els.speedrunTime.classList.add('finished');
          }
        } else {
          els.speedrunTime.classList.remove('finished');
          speedrunFinishedShown = false;
        }
      }
    } else {
      els.speedrunTimer.style.display = 'none';
      speedrunFinishedShown = false;
    }
  }

  // Daily briefing panel — with auto-dismiss after 5s
  if (els.dailyBriefing) {
    if (challenge === 'daily' && cs.dailyParams && !dailyBriefingDismissed) {
      const p = cs.dailyParams;
      els.dailyBriefing.style.display = 'block';
      if (els.dailySeed) els.dailySeed.textContent = `#${p.seed}`;
      if (els.dailyAircraft) els.dailyAircraft.textContent = p.aircraft.replace(/_/g, ' ').toUpperCase();
      if (els.dailyApproach) els.dailyApproach.textContent = p.approach === 'short_final' ? 'SHORT FINAL' : 'LONG FINAL';
      if (els.dailyWind) els.dailyWind.textContent = `${String(p.windDir).padStart(3, '0')}/${p.windSpeed}KT`;
      if (els.dailyEmergency) els.dailyEmergency.textContent = p.emergency ? `ENGINE OUT ~${p.failAlt}FT` : 'NONE';

      // Bind dismiss handler once per daily session
      if (!dailyDismissHandler) {
        dailyDismissHandler = () => dismissDailyBriefing();
        dailyDismissTouchHandler = (e) => { e.preventDefault(); dismissDailyBriefing(); };
        els.dailyBriefing.addEventListener('click', dailyDismissHandler);
        els.dailyBriefing.addEventListener('touchend', dailyDismissTouchHandler);
        // Auto-dismiss after 5 seconds
        dailyAutoTimer = setTimeout(dismissDailyBriefing, 5000);
      }
    } else if (challenge !== 'daily') {
      els.dailyBriefing.style.display = 'none';
      // Clean up listeners and timer
      if (dailyDismissHandler) {
        els.dailyBriefing.removeEventListener('click', dailyDismissHandler);
        els.dailyBriefing.removeEventListener('touchend', dailyDismissTouchHandler);
        dailyDismissHandler = null;
        dailyDismissTouchHandler = null;
      }
      if (dailyAutoTimer) {
        clearTimeout(dailyAutoTimer);
        dailyAutoTimer = 0;
      }
      dailyBriefingDismissed = false;
    }
  }
}

function updateSystemsStrip() {
  // Radio info
  if (els.sysRadio) {
    const radio = getRadioStack();
    const nav1 = getNavReceiver(0);
    const selName = getSelectedRadioName();
    let radioText = `${selName} `;
    if (nav1.receiving) {
      radioText += `NAV1:${radio.nav1.active.toFixed(2)} ${nav1.ident}`;
      if (nav1.dmeDistance !== null) radioText += ` ${nav1.dmeDistance.toFixed(1)}nm`;
    } else {
      radioText += `NAV1:${radio.nav1.active.toFixed(2)} ---`;
    }
    els.sysRadio.textContent = radioText;
  }

  // Engine N1 readouts
  if (els.sysEngines) {
    const count = getEngineCount();
    const states = getAllEngineStates();
    let engText = '';
    for (let i = 0; i < count; i++) {
      const e = states[i];
      if (i > 0) engText += ' ';
      engText += `E${i + 1}:${Math.round(e.n1)}%`;
    }
    els.sysEngines.textContent = engText;
  }

  // Electrical warnings
  if (els.sysElec) {
    const elec = getElectricalState();
    let elecText = '';
    if (elec.busVoltage < 20 && elec.busVoltage > 0) {
      elecText = 'LOW VOLTAGE';
    } else if (!elec.alternatorOn || elec.busVoltage < 28) {
      if (elec.batteryOn && elec.batteryCharge < 0.3) elecText = 'BATT LOW';
      else if (!elec.alternatorOn && elec.batteryOn) elecText = 'BATT ONLY';
    }
    els.sysElec.textContent = elecText;
    els.sysElec.style.color = elecText ? '#ffaa00' : '#888';
  }

  // MASTER CAUTION for active failures
  if (els.sysCaution) {
    const failures = getActiveFailures();
    if (failures.length > 0) {
      els.sysCaution.textContent = 'MASTER CAUTION';
    } else {
      els.sysCaution.textContent = '';
    }
  }

  // Flight plan waypoint (from flightplan.js, not the old HUD waypoints)
  if (els.waypoint) {
    const fpWp = getFPActiveWaypoint();
    if (fpWp) {
      const brg = Math.round(getBearingToActive());
      const dist = getDistanceToActiveNM().toFixed(1);
      els.waypoint.textContent = `${fpWp.name} \u2192 ${String(brg).padStart(3, '0')}\u00B0 ${dist}nm`;
      els.waypoint.style.display = '';
    }
  }
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
    els.apTargetHdg.textContent = ap.lnavMode ? 'LNAV' : `HDG ${Math.round(ap.targetHeading)}`;
  }
  if (els.apTargetAlt) {
    els.apTargetAlt.textContent = ap.vnavMode ? 'VNAV' : `ALT ${Math.round(ap.targetAltitude)}ft`;
  }
}

export function toggleILS() {
  ilsDismissed = !ilsDismissed;
}

export function isILSVisible() {
  return !ilsDismissed;
}

function updateILS(state) {
  if (!els.ilsPanel) return;

  if (ilsDismissed) {
    els.ilsPanel.style.display = 'none';
    return;
  }

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
  els.scorePanel.style.cursor = 'pointer';

  // Click/tap to dismiss
  const dismiss = () => {
    hideLandingScore();
    els.scorePanel.removeEventListener('click', dismiss);
    els.scorePanel.removeEventListener('touchend', dismiss);
  };
  els.scorePanel.addEventListener('click', dismiss);
  els.scorePanel.addEventListener('touchend', dismiss);

  if (els.scoreGrade) {
    els.scoreGrade.textContent = score.overall.grade;
    els.scoreGrade.className = 'score-grade grade-' + score.overall.grade.toLowerCase() + ' score-grade-animated';
  }
  if (els.scoreTotal) els.scoreTotal.textContent = score.overall.score + '/100';

  // Animated score rows — fill sequentially
  const rows = [els.scoreVs, els.scoreCl, els.scoreTz, els.scoreSpeed];
  const texts = [
    `${score.vs.value} FPM - ${score.vs.grade}`,
    `${score.centerline.value}m - ${score.centerline.grade}`,
    `${score.touchdownZone.value}m - ${score.touchdownZone.grade}`,
    `${score.speed.value} KTS`,
  ];
  rows.forEach((el, i) => {
    if (!el) return;
    el.textContent = texts[i];
    const row = el.closest('.score-row');
    if (row) {
      row.classList.remove('score-row-animated');
      void row.offsetWidth; // force reflow
      row.classList.add('score-row-animated');
      row.style.animationDelay = (i * 0.15) + 's';
    }
  });
  if (els.scoreBest) {
    els.scoreBest.textContent = score.newBest ? 'NEW BEST!' : `BEST: ${score.bestScore}`;
    els.scoreBest.className = 'score-best' + (score.newBest ? ' new-best score-best-pulse' : '');
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
  const worldRange = 42000; // covers expanded map with new airports

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = (x / size - 0.5) * worldRange;
      const wz = (y / size - 0.5) * worldRange;
      const h = getTerrainHeightCached(wx, wz);
      const idx = (y * size + x) * 4;

      if (h < 0.5) {
        // Water
        data[idx] = 15; data[idx+1] = 35; data[idx+2] = 75; data[idx+3] = 255;
      } else if (h < 5) {
        // Beach sand
        data[idx] = 140; data[idx+1] = 130; data[idx+2] = 95; data[idx+3] = 255;
      } else if (h < 25) {
        // Light grass
        const t = (h - 5) / 20;
        data[idx] = 55 + t * (-10); data[idx+1] = 100 + t * 20; data[idx+2] = 40; data[idx+3] = 255;
      } else if (h < 55) {
        // Rich grass / forest
        const t = (h - 25) / 30;
        data[idx] = 38 - t * 15; data[idx+1] = 80 + t * 10; data[idx+2] = 30 - t * 8; data[idx+3] = 255;
      } else if (h < 110) {
        // Scrubland to dirt
        const t = (h - 55) / 55;
        data[idx] = 60 + t * 50; data[idx+1] = 65 + t * 15; data[idx+2] = 35 + t * 20; data[idx+3] = 255;
      } else if (h < 200) {
        // Rocky highlands
        const t = (h - 110) / 90;
        data[idx] = 100 + t * 20; data[idx+1] = 95 + t * 15; data[idx+2] = 85 + t * 15; data[idx+3] = 255;
      } else if (h < 300) {
        // Dark rock to alpine
        const t = (h - 200) / 100;
        data[idx] = 90 + t * 40; data[idx+1] = 85 + t * 45; data[idx+2] = 82 + t * 50; data[idx+3] = 255;
      } else {
        // Snow/ice
        const t = Math.min((h - 300) / 80, 1);
        data[idx] = 130 + t * 110; data[idx+1] = 135 + t * 108; data[idx+2] = 140 + t * 105; data[idx+3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  terrainImage = canvas;
}

function updateMinimap() {
  if (!minimapCtx) return;
  const nowMs = performance.now();
  const refreshInterval = minimapMode === 'local' ? 100 : 250; // 10Hz local, 4Hz overview
  if (nowMs - lastMinimapUpdateMs < refreshInterval) return;
  lastMinimapUpdateMs = nowMs;

  const ctx = minimapCtx;
  const w = 180;
  const h = 180;

  const px = getActiveVehicle().position.x;
  const pz = getActiveVehicle().position.z;

  // Zoom levels
  const viewRange = minimapMode === 'local' ? 4000 : 20000;
  const scale = w / viewRange;

  // Background - terrain or dark
  if (minimapMode === 'overview' && terrainImage) {
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
  const network = cachedTaxiNetwork || getTaxiwayNetwork();
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

  // ── International Airport runway ──
  const intlRw = INTL_RUNWAY_WIDTH * scale;
  const intlRl = INTL_RUNWAY_LENGTH * scale;
  ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
  ctx.fillRect(toX(INTL_AIRPORT_X) - intlRw/2, toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2), intlRw, intlRl);

  // ── Data-driven airports (new airports from airportData) ──
  for (const apt of AIRPORTS) {
    if (apt._existing) continue;
    const rwy = apt.runways[0];
    const rLen = Math.max(4, rwy.length * scale);
    const rWid = Math.max(3, rwy.width * scale);
    const headingRad = ((rwy.heading - 90) * Math.PI) / 180;
    const cx = toX(apt.x);
    const cy = toY(apt.z);
    if (cx < -50 || cx > w + 50 || cy < -50 || cy > h + 50) continue;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(headingRad);
    ctx.fillStyle = apt.type === 'military' ? 'rgba(160, 160, 80, 0.9)' : 'rgba(150, 150, 150, 0.8)';
    ctx.fillRect(-rWid / 2, -rLen / 2, rWid, rLen);
    ctx.restore();
    // Marker dot for visibility at any zoom
    ctx.fillStyle = apt.type === 'military' ? '#aaaa44' : '#aaaaaa';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Runway numbers
  ctx.font = 'bold 8px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.textAlign = 'center';
  // Airport 1: Runway 36/18 (N-S)
  ctx.fillText('36', toX(0), toY(-RUNWAY_LENGTH/2 + 60));
  ctx.fillText('18', toX(0), toY(RUNWAY_LENGTH/2 - 40));
  // Airport 2: Runway 36/18 (N-S)
  ctx.fillText('36', toX(AIRPORT2_X), toY(AIRPORT2_Z - RUNWAY_LENGTH/2 + 60));
  ctx.fillText('18', toX(AIRPORT2_X), toY(AIRPORT2_Z + RUNWAY_LENGTH/2 - 40));

  // ── Bayview city zone ──
  ctx.fillStyle = 'rgba(60, 60, 80, 0.4)';
  ctx.fillRect(toX(CT_CENTER_X - CT_SIZE_X/2), toY(CT_CENTER_Z - CT_SIZE_Z/2), CT_SIZE_X * scale, CT_SIZE_Z * scale);

  // ── Coastline ──
  const coastX = toX(COAST_LINE_X);
  if (coastX > -10 && coastX < w + 10) {
    ctx.strokeStyle = 'rgba(40, 120, 200, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(coastX, 0);
    ctx.lineTo(coastX, h);
    ctx.stroke();
  }

  // ── Highway ──
  const hwPath = getHighwayPath();
  if (hwPath && hwPath.points) {
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.5)';
    ctx.lineWidth = Math.max(1, 12 * scale);
    ctx.beginPath();
    let hwStarted = false;
    for (let i = 0; i < hwPath.points.length; i += 5) {
      const pt = hwPath.points[i];
      const sx = toX(pt.x);
      const sy = toY(pt.z);
      if (!hwStarted) { ctx.moveTo(sx, sy); hwStarted = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // ── Lighthouse marker ──
  const lhX = toX(13000);
  const lhY = toY(-200);
  if (lhX > 0 && lhX < w && lhY > 0 && lhY < h) {
    ctx.fillStyle = 'rgba(255, 220, 100, 0.8)';
    ctx.beginPath();
    ctx.arc(lhX, lhY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── City zone ──
  const cityHalf = CITY_SIZE / 2;
  const cityX = toX(CITY_CENTER_X - cityHalf);
  const cityY = toY(CITY_CENTER_Z - cityHalf);
  const cityW = CITY_SIZE * scale;
  const cityH = CITY_SIZE * scale;
  ctx.fillStyle = 'rgba(60, 60, 80, 0.4)';
  ctx.fillRect(cityX, cityY, cityW, cityH);

  // City roads
  if (!cachedRoadNetwork || cachedRoadNetwork.length === 0) {
    cachedRoadNetwork = getRoadNetwork();
  }
  ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
  for (const seg of cachedRoadNetwork) {
    ctx.lineWidth = Math.max(0.5, seg.width * scale);
    ctx.beginPath();
    ctx.moveTo(toX(seg.start.x), toY(seg.start.z));
    ctx.lineTo(toX(seg.end.x), toY(seg.end.z));
    ctx.stroke();
  }

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

  // INTL label
  ctx.fillText('INTL', toX(INTL_AIRPORT_X), toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2 - 80));

  // New airport labels
  for (const apt of AIRPORTS) {
    if (apt._existing) continue;
    const lx = toX(apt.x);
    const ly = toY(apt.z - apt.runways[0].length / 2 - 80);
    if (lx > -20 && lx < w + 20 && ly > -20 && ly < h + 20) {
      ctx.fillStyle = apt.type === 'military' ? 'rgba(180, 180, 120, 0.8)' : 'rgba(200, 200, 255, 0.8)';
      ctx.fillText(apt.icao, lx, ly);
    }
  }

  // CITY label
  ctx.fillStyle = 'rgba(200, 180, 140, 0.8)';
  ctx.fillText('CITY', toX(CITY_CENTER_X), toY(CITY_CENTER_Z - cityHalf - 40));

  // BAYVIEW label
  ctx.fillText('BAYVIEW', toX(CT_CENTER_X), toY(CT_CENTER_Z - CT_SIZE_Z/2 - 40));

  // ── Waypoints ──
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const wpx = toX(wp.x);
    const wpy = toY(wp.z);
    if (wpx < -10 || wpx > w + 10 || wpy < -10 || wpy > h + 10) continue;
    const isActive = i === activeWaypointIdx;
    const size = isActive ? 5 : 4;
    ctx.fillStyle = isActive ? '#ff6644' : 'rgba(255, 100, 68, 0.6)';
    ctx.beginPath();
    ctx.moveTo(wpx, wpy - size);
    ctx.lineTo(wpx + size, wpy);
    ctx.lineTo(wpx, wpy + size);
    ctx.lineTo(wpx - size, wpy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = isActive ? '#ffaa88' : 'rgba(255, 170, 136, 0.7)';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(wp.label, wpx, wpy - size - 3);
  }

  // ── Dashed line to active waypoint ──
  if (waypoints.length > 0 && activeWaypointIdx < waypoints.length) {
    const awp = waypoints[activeWaypointIdx];
    ctx.strokeStyle = 'rgba(255, 100, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(toX(awp.x), toY(awp.z));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Aircraft dot ──
  ctx.fillStyle = '#44ff66';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Heading line
  const hdgRad = (getActiveVehicle().heading * Math.PI) / 180;
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
  ctx.fillText(minimapMode === 'local' ? 'LOCAL' : 'OVERVIEW', w - 4, h - 3);
}

// ── Waypoint helpers ──

function addWaypoint(worldX, worldZ) {
  if (waypoints.length >= MAX_WAYPOINTS) return;
  waypoints.push({ x: worldX, z: worldZ, label: 'WPT' + (waypoints.length + 1) });
  activeWaypointIdx = waypoints.length - 1;
}

function removeWaypointAt(worldX, worldZ, hitRadius) {
  for (let i = waypoints.length - 1; i >= 0; i--) {
    const dx = waypoints[i].x - worldX;
    const dz = waypoints[i].z - worldZ;
    if (Math.sqrt(dx * dx + dz * dz) < hitRadius) {
      waypoints.splice(i, 1);
      // Relabel remaining waypoints
      for (let j = 0; j < waypoints.length; j++) waypoints[j].label = 'WPT' + (j + 1);
      if (activeWaypointIdx >= waypoints.length) activeWaypointIdx = Math.max(0, waypoints.length - 1);
      return true;
    }
  }
  return false;
}

function getActiveWaypoint() {
  return waypoints.length > 0 ? waypoints[activeWaypointIdx] : null;
}

// ── Fullscreen map ──

function openFullscreenMap() {
  minimapMode = 'fullscreen';
  const overlay = document.getElementById('minimap-fullscreen');
  const backdrop = document.getElementById('fullmap-backdrop');
  if (overlay) overlay.style.display = '';
  if (backdrop) backdrop.style.display = '';

  if (fullmapCanvas && fullmapCtx) {
    const rect = fullmapCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    fullmapCanvas.width = Math.round(rect.width * dpr);
    fullmapCanvas.height = Math.round(rect.height * dpr);
    fullmapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const closeBtn = document.querySelector('.fullmap-close');
  if (closeBtn) closeBtn.onclick = closeFullscreenMap;
  if (backdrop) backdrop.onclick = closeFullscreenMap;

  if (fullmapCanvas) {
    fullmapCanvas.onclick = (e) => {
      const rect = fullmapCanvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const fullViewRange = 42000;
      const worldX = (cx / rect.width - 0.5) * fullViewRange;
      const worldZ = (cy / rect.height - 0.5) * fullViewRange;
      const hitRadius = fullViewRange / rect.width * 20;
      if (!removeWaypointAt(worldX, worldZ, hitRadius)) {
        addWaypoint(worldX, worldZ);
      }
    };
  }
}

function closeFullscreenMap() {
  minimapMode = 'local';
  const overlay = document.getElementById('minimap-fullscreen');
  const backdrop = document.getElementById('fullmap-backdrop');
  if (overlay) overlay.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
}

function updateFullscreenMap() {
  if (minimapMode !== 'fullscreen' || !fullmapCtx || !fullmapCanvas) return;

  const ctx = fullmapCtx;
  const dpr = window.devicePixelRatio || 1;
  const w = fullmapCanvas.width / dpr;
  const h = fullmapCanvas.height / dpr;
  const fullViewRange = 42000;
  const scale = w / fullViewRange;

  // Background terrain
  if (terrainImage) {
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(terrainImage, 0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 8, 20, 0.25)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, w, h);
  }

  // Ocean east of coastline
  const coastPx = (COAST_LINE_X / fullViewRange + 0.5) * w;
  if (coastPx < w) {
    ctx.fillStyle = 'rgba(15, 30, 60, 0.5)';
    ctx.fillRect(coastPx, 0, w - coastPx, h);
    ctx.strokeStyle = 'rgba(40, 120, 200, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(coastPx, 0);
    ctx.lineTo(coastPx, h);
    ctx.stroke();
  }

  const toX = (wx) => (wx / fullViewRange + 0.5) * w;
  const toY = (wz) => (wz / fullViewRange + 0.5) * h;

  // Grid
  ctx.strokeStyle = 'rgba(120, 180, 255, 0.06)';
  ctx.lineWidth = 0.5;
  for (let g = -20000; g <= 20000; g += 2000) {
    const sx = toX(g);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    const sy = toY(g);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }

  // Runways
  ctx.fillStyle = 'rgba(140, 140, 140, 0.8)';
  const rw = RUNWAY_WIDTH * scale;
  const rl = RUNWAY_LENGTH * scale;
  ctx.fillRect(toX(0) - rw/2, toY(-RUNWAY_LENGTH/2), rw, rl);
  ctx.fillRect(toX(AIRPORT2_X) - rw/2, toY(AIRPORT2_Z - RUNWAY_LENGTH/2), rw, rl);
  const irw = INTL_RUNWAY_WIDTH * scale;
  const irl = INTL_RUNWAY_LENGTH * scale;
  ctx.fillRect(toX(INTL_AIRPORT_X) - irw/2, toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2), irw, irl);

  // Data-driven new airports
  for (const apt of AIRPORTS) {
    if (apt._existing) continue;
    const rwy = apt.runways[0];
    const rLen = Math.max(6, rwy.length * scale);
    const rWid = Math.max(4, rwy.width * scale);
    const headingRad = ((rwy.heading - 90) * Math.PI) / 180;
    const cx = toX(apt.x);
    const cy = toY(apt.z);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(headingRad);
    ctx.fillStyle = apt.type === 'military' ? 'rgba(160, 160, 80, 0.9)' : 'rgba(150, 150, 150, 0.9)';
    ctx.fillRect(-rWid / 2, -rLen / 2, rWid, rLen);
    ctx.restore();
    // Marker dot
    ctx.fillStyle = apt.type === 'military' ? '#aaaa44' : '#cccccc';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // City zones
  ctx.fillStyle = 'rgba(60, 60, 80, 0.4)';
  const cityHalf = CITY_SIZE / 2;
  ctx.fillRect(toX(CITY_CENTER_X - cityHalf), toY(CITY_CENTER_Z - cityHalf), CITY_SIZE * scale, CITY_SIZE * scale);
  ctx.fillRect(toX(CT_CENTER_X - CT_SIZE_X/2), toY(CT_CENTER_Z - CT_SIZE_Z/2), CT_SIZE_X * scale, CT_SIZE_Z * scale);

  // Highway
  const hwPath = getHighwayPath();
  if (hwPath && hwPath.points) {
    ctx.strokeStyle = 'rgba(140, 140, 140, 0.5)';
    ctx.lineWidth = Math.max(1, 14 * scale);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < hwPath.points.length; i += 3) {
      const pt = hwPath.points[i];
      if (!started) { ctx.moveTo(toX(pt.x), toY(pt.z)); started = true; }
      else ctx.lineTo(toX(pt.x), toY(pt.z));
    }
    ctx.stroke();
  }

  // Lighthouse
  ctx.fillStyle = 'rgba(255, 220, 100, 0.8)';
  ctx.beginPath();
  ctx.arc(toX(13000), toY(-200), 3, 0, Math.PI * 2);
  ctx.fill();

  // Waypoints
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const wpx = toX(wp.x);
    const wpy = toY(wp.z);
    const isActive = i === activeWaypointIdx;
    const sz = isActive ? 7 : 5;
    ctx.fillStyle = isActive ? '#ff6644' : 'rgba(255, 100, 68, 0.6)';
    ctx.beginPath();
    ctx.moveTo(wpx, wpy - sz);
    ctx.lineTo(wpx + sz, wpy);
    ctx.lineTo(wpx, wpy + sz);
    ctx.lineTo(wpx - sz, wpy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = isActive ? '#ffaa88' : 'rgba(255, 170, 136, 0.7)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(wp.label, wpx, wpy - sz - 4);
  }

  // Dashed line to active waypoint
  const v = getActiveVehicle();
  if (waypoints.length > 0 && activeWaypointIdx < waypoints.length) {
    const awp = waypoints[activeWaypointIdx];
    ctx.strokeStyle = 'rgba(255, 100, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(v.position.x), toY(v.position.z));
    ctx.lineTo(toX(awp.x), toY(awp.z));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Aircraft dot
  const acx = toX(v.position.x);
  const acy = toY(v.position.z);
  ctx.fillStyle = '#44ff66';
  ctx.beginPath();
  ctx.arc(acx, acy, 4, 0, Math.PI * 2);
  ctx.fill();
  const hdgRad = (v.heading * Math.PI) / 180;
  ctx.strokeStyle = '#44ff66';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(acx, acy);
  ctx.lineTo(acx - Math.sin(hdgRad) * 20, acy - Math.cos(hdgRad) * 20);
  ctx.stroke();

  // Labels
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200, 200, 255, 0.9)';
  ctx.fillText('APT1', toX(0), toY(-RUNWAY_LENGTH/2 - 120));
  ctx.fillText('APT2', toX(AIRPORT2_X), toY(AIRPORT2_Z - RUNWAY_LENGTH/2 - 120));
  ctx.fillText('INTL', toX(INTL_AIRPORT_X), toY(INTL_AIRPORT_Z - INTL_RUNWAY_LENGTH/2 - 120));
  // New airport labels
  for (const apt of AIRPORTS) {
    if (apt._existing) continue;
    ctx.fillStyle = apt.type === 'military' ? 'rgba(180, 180, 120, 0.9)' : 'rgba(200, 200, 255, 0.9)';
    ctx.fillText(apt.icao, toX(apt.x), toY(apt.z - apt.runways[0].length / 2 - 120));
  }
  ctx.fillStyle = 'rgba(200, 180, 140, 0.9)';
  ctx.fillText('CITY', toX(CITY_CENTER_X), toY(CITY_CENTER_Z - cityHalf - 60));
  ctx.fillText('BAYVIEW', toX(CT_CENTER_X), toY(CT_CENTER_Z - CT_SIZE_Z/2 - 60));

  // Compass
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
  ctx.fillText('N', w / 2, 14);
  ctx.fillStyle = 'rgba(180, 180, 220, 0.5)';
  ctx.fillText('S', w / 2, h - 6);
  ctx.fillText('W', 10, h / 2 + 4);
  ctx.fillText('E', w - 10, h / 2 + 4);

  // Scale bar
  const scaleBarPx = 5000 * scale;
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, h - 20);
  ctx.lineTo(12 + scaleBarPx, h - 20);
  ctx.stroke();
  ctx.fillStyle = 'rgba(160, 200, 255, 0.5)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('5km', 12, h - 10);
}

export function showMessage(msg) {
  if (els.message) els.message.textContent = msg;
}

let _timedMsgTimer = 0;
export function showTimedHudMessage(msg, ms) {
  showMessage(msg);
  if (_timedMsgTimer) clearTimeout(_timedMsgTimer);
  _timedMsgTimer = setTimeout(() => { showMessage(''); _timedMsgTimer = 0; }, ms);
}

export function clearMessage() {
  if (els.message) els.message.textContent = '';
}

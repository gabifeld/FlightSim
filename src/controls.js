import { switchAircraft, setSpawnLocation } from './aircraft.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { THROTTLE_RATE } from './constants.js';
import { playGearSound, playFlapSound } from './audio.js';
import { startLandingMode, exitLandingMode, isLandingMode, APPROACH_CONFIGS } from './landing.js';
import { setTimeOfDay, getTimeOfDay, toggleAutoCycleTime } from './scene.js';
import {
  toggleAPMaster, toggleHDGHold, toggleALTHold, toggleVSMode,
  toggleSPDHold, toggleAPRMode, adjustTargetHeading, adjustTargetAltitude,
  isAPEngaged,
} from './autopilot.js';
import { cycleWeatherPreset } from './weatherFx.js';
import { toggleILS, cycleHudMode } from './hud.js';
import { toggleLandingAssist } from './landing.js';
import { cycleCloudDensity } from './terrain.js';
import { toggleReplay, isReplayPlaying, scrubReplay, setReplaySpeed, getReplayState } from './replay.js';
import { startCrosswind, startDaily, startEngineOut, startSpeedrun, resetChallenge } from './challenges.js';
import { updateGamepad, getButtonJustPressed, isGamepadConnected } from './gamepad.js';
import { togglePause, isPaused, isMenuOpen, onGameStart } from './menu.js';
import { getSetting, setSetting } from './settings.js';
import { showMessage } from './hud.js';

const keys = {};
let cameraToggleCallback = null;
let resetCallback = null;
let aircraftSelectCallback = null;
let carSpawnCallback = null;
let carDespawnCallback = null;

// Keys used by the sim
const SIM_KEYS = new Set([
  'w', 's', 'a', 'd', 'q', 'e', 'g', 'f', 'b', 'v', 'r', ' ',
  '1', '2', '3', '4', '5',
  'l', 't', 'p', 'c', 'z', 'h', 'j', 'n', 'm', '=', 'u',
  '[', ']', '+', '-', 'i', 'k', 'x',
]);

const AIRCRAFT_MAP = {
  '1': 'cessna_172',
  '2': 'boeing_737',
  '3': 'f16',
  '4': 'airbus_a320',
  '5': 'dhc2_beaver',
};

export function getKeys() {
  return keys;
}

export function setCallbacks({ onCameraToggle, onReset, onAircraftSelect, onCarSpawn, onCarDespawn }) {
  cameraToggleCallback = onCameraToggle;
  resetCallback = onReset;
  aircraftSelectCallback = onAircraftSelect;
  carSpawnCallback = onCarSpawn || null;
  carDespawnCallback = onCarDespawn || null;
}

export function initControls() {
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (SIM_KEYS.has(key) || e.key === 'Shift' || e.key === 'Control' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        key === ';' || e.key === 'Escape') {
      e.preventDefault();
    }

    // ESC: toggle pause/menu (always available)
    if (e.key === 'Escape') {
      // If in replay, exit replay first
      if (isReplayPlaying()) {
        toggleReplay();
        return;
      }
      // Clear all held keys before pausing
      for (const k in keys) keys[k] = false;
      togglePause();
      return;
    }

    // Block all sim input while menu is open
    if (isMenuOpen()) return;

    const mapped = mapKey(e);

    if (!keys[mapped]) {
      // Toggle actions on first press only (aircraft-specific)
      if (mapped === 'g' && isAircraft(getActiveVehicle())) {
        getActiveVehicle().gear = !getActiveVehicle().gear;
        playGearSound();
      }
      if (mapped === 'f' && isAircraft(getActiveVehicle())) {
        getActiveVehicle().flaps = !getActiveVehicle().flaps;
        playFlapSound();
      }
      if (mapped === 'b' && isAircraft(getActiveVehicle())) {
        getActiveVehicle().speedbrake = !getActiveVehicle().speedbrake;
      }
      if (mapped === 'v' && cameraToggleCallback) {
        cameraToggleCallback();
      }
      if (mapped === 'r' && resetCallback) {
        resetCallback();
      }

      // Aircraft selection (1-4)
      if (AIRCRAFT_MAP[mapped]) {
        // If currently in a car, despawn it first
        if (!isAircraft(getActiveVehicle()) && carDespawnCallback) {
          carDespawnCallback();
        }
        switchAircraft(AIRCRAFT_MAP[mapped]);
        if (aircraftSelectCallback) aircraftSelectCallback(AIRCRAFT_MAP[mapped]);
        updateAircraftSelectUI(AIRCRAFT_MAP[mapped]);
      }

      // Lights toggle (landing lights for aircraft, headlights for cars)
      if (mapped === 'l') {
        const v = getActiveVehicle();
        if (isAircraft(v)) {
          v.landingLight = !v.landingLight;
        } else if (v.headlights !== undefined) {
          v.headlights = !v.headlights;
        }
      }

      // Time of day controls
      if (mapped === '[') {
        setTimeOfDay(getTimeOfDay() - 0.5);
      }
      if (mapped === ']') {
        setTimeOfDay(getTimeOfDay() + 0.5);
      }
      if (mapped === 't') {
        toggleAutoCycleTime();
      }

      // Autopilot controls (aircraft only)
      if (isAircraft(getActiveVehicle())) {
        if (mapped === 'z') toggleAPMaster();
        if (mapped === 'h') toggleHDGHold();
        if (mapped === 'j') toggleALTHold();
        if (mapped === 'n') toggleVSMode();
        if (mapped === 'm') toggleSPDHold();
        if (mapped === ';') toggleAPRMode();

        // Arrow keys: adjust AP targets
        if (isAPEngaged()) {
          if (e.key === 'ArrowLeft') adjustTargetHeading(-10);
          if (e.key === 'ArrowRight') adjustTargetHeading(10);
          if (e.key === 'ArrowUp') adjustTargetAltitude(100);
          if (e.key === 'ArrowDown') adjustTargetAltitude(-100);
        }
      }

      // Weather preset cycle
      if (mapped === 'p') {
        cycleWeatherPreset();
      }

      // Toggle unlimited fuel
      if (mapped === 'u') {
        const current = getSetting('unlimitedFuel');
        setSetting('unlimitedFuel', !current);
        showMessage('Unlimited Fuel: ' + (!current ? 'ON' : 'OFF'));
        setTimeout(() => showMessage(''), 2000);
      }

      // Cloud density cycle
      if (mapped === 'c') {
        cycleCloudDensity();
      }

      // HUD mode cycle
      if (mapped === 'x') {
        const mode = cycleHudMode();
        showMessage('HUD: ' + mode.toUpperCase());
        setTimeout(() => showMessage(''), 1500);
      }

      // ILS toggle (aircraft only)
      if (mapped === 'i' && isAircraft(getActiveVehicle())) {
        toggleILS();
      }

      // Landing assist (aircraft only)
      if (mapped === 'k' && isAircraft(getActiveVehicle())) {
        toggleLandingAssist();
      }

      // Replay controls
      if (mapped === '=') {
        toggleReplay();
      }
      if (isReplayPlaying()) {
        if (mapped === '+') {
          const rs = getReplayState();
          setReplaySpeed(rs.speed * 2);
        }
        if (mapped === '-') {
          const rs = getReplayState();
          setReplaySpeed(rs.speed / 2);
        }
      }
    }

    keys[mapped] = true;
  });

  window.addEventListener('keyup', (e) => {
    keys[mapKey(e)] = false;
  });

  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });

  // Helper: click + touchend for mobile compatibility
  function onTap(el, handler) {
    if (!el) return;
    el.addEventListener('click', handler);
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      handler(e);
    });
  }

  // Click/tap handlers for aircraft selection panel
  document.querySelectorAll('.aircraft-option').forEach((el) => {
    onTap(el, () => {
      const type = el.dataset.type;
      if (type) {
        document.querySelectorAll('.aircraft-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
      }
    });
  });

  // Spawn location selection
  document.querySelectorAll('.spawn-option').forEach((el) => {
    onTap(el, () => {
      document.querySelectorAll('.spawn-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
    });
  });

  // Start button
  const startBtn = document.getElementById('start-btn');
  onTap(startBtn, () => {
    // Get selected aircraft
    const selectedAircraft = document.querySelector('.aircraft-option.selected');
    let type = selectedAircraft ? selectedAircraft.dataset.type : 'cessna_172';

    // Get selected spawn
    const selectedSpawn = document.querySelector('.spawn-option.selected');
    const spawn = selectedSpawn ? selectedSpawn.dataset.spawn : 'runway';

    // Reset any previous challenge
    resetChallenge();

    // Route challenge spawns
    if (spawn.startsWith('crosswind_')) {
      const level = spawn.replace('crosswind_', '');
      startCrosswind(level);
      startLandingMode('short_final');
      setSpawnLocation('short_final');
      switchAircraft(type);
    } else if (spawn === 'daily_challenge') {
      const params = startDaily();
      type = params.aircraft;
      startLandingMode(params.approach);
      setSpawnLocation(params.approach);
      switchAircraft(type);
    } else if (spawn === 'engine_out') {
      startEngineOut();
      startLandingMode('short_final');
      setSpawnLocation('short_final');
      switchAircraft(type);
    } else if (spawn === 'speedrun') {
      startSpeedrun();
      exitLandingMode();
      setSpawnLocation('runway');
      switchAircraft(type);
    } else if (spawn.startsWith('city_')) {
      // City driving mode — spawn a car
      const carType = spawn.replace('city_', '');
      exitLandingMode();
      if (carSpawnCallback) carSpawnCallback(carType);
    } else {
      // Default: existing logic
      if (APPROACH_CONFIGS[spawn]) {
        startLandingMode(spawn);
      } else {
        exitLandingMode();
      }
      setSpawnLocation(spawn);
      switchAircraft(type);
    }

    // Hide panel and notify menu system
    const panel = document.getElementById('aircraft-select');
    if (panel) panel.classList.add('hidden');
    onGameStart();
  });

  // Hide aircraft select on load (main menu shows first)
  const selectPanel = document.getElementById('aircraft-select');
  if (selectPanel) selectPanel.classList.add('hidden');
}

function mapKey(e) {
  if (e.key === 'Shift') return 'shift';
  if (e.key === 'Control') return 'control';
  return e.key.toLowerCase();
}

function updateAircraftSelectUI(typeName) {
  document.querySelectorAll('.aircraft-option').forEach((el) => {
    el.classList.toggle('selected', el.dataset.type === typeName);
  });
  // Hide panel
  const panel = document.getElementById('aircraft-select');
  if (panel) panel.classList.add('hidden');
}

export function clearKeys() {
  for (const k in keys) keys[k] = false;
}

export function updateThrottle(dt) {
  if (!isAircraft(getActiveVehicle())) return;
  if (keys['shift']) {
    getActiveVehicle().throttle = Math.min(1, getActiveVehicle().throttle + THROTTLE_RATE * dt);
  }
  if (keys['control']) {
    getActiveVehicle().throttle = Math.max(0, getActiveVehicle().throttle - THROTTLE_RATE * dt);
  }
}

export function updateControlsGamepad() {
  if (!isGamepadConnected()) return;
  updateGamepad();

  // Gamepad button toggles (aircraft-specific)
  if (isAircraft(getActiveVehicle())) {
    if (getButtonJustPressed(0)) { // A = gear
      getActiveVehicle().gear = !getActiveVehicle().gear;
      playGearSound();
    }
    if (getButtonJustPressed(1)) { // B = flaps
      getActiveVehicle().flaps = !getActiveVehicle().flaps;
      playFlapSound();
    }
    if (getButtonJustPressed(2)) { // X = speedbrake
      getActiveVehicle().speedbrake = !getActiveVehicle().speedbrake;
    }
  }
  if (getButtonJustPressed(3) && cameraToggleCallback) { // Y = camera
    cameraToggleCallback();
  }
}

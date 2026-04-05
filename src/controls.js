import { switchAircraft, setSpawnLocation } from './aircraft.js';
import { toggleArrestingWire, isArrestingWireArmed } from './aircraftCarrier.js';
import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { THROTTLE_RATE } from './constants.js';
import { playGearSound, playFlapSound, playMissileLaunch } from './audio.js';
import { startLandingMode, exitLandingMode, isLandingMode, APPROACH_CONFIGS } from './landing.js';
import { setTimeOfDay, getTimeOfDay, toggleAutoCycleTime } from './scene.js';
import {
  toggleAPMaster, toggleHDGHold, toggleALTHold, toggleVSMode,
  toggleSPDHold, toggleAPRMode, toggleLNAVMode, toggleVNAVMode,
  adjustTargetHeading, adjustTargetAltitude,
  isAPEngaged,
} from './autopilot.js';
import { cycleRadio, tuneFreq, swapFreq } from './radio.js';
import { startEngine, startAllEngines, shutdownAllEngines, isAnyEngineRunning, areAllEnginesRunning } from './systemsEngine.js';
import { toggleBattery, toggleAlternator, isBatteryOn, isAlternatorOn } from './electrical.js';
import { toggleChecklist, advanceChecklistItem, nextChecklist, prevChecklist, isChecklistOpen } from './checklist.js';
import { isHydraulicFailed, isFlapsJammed } from './failures.js';
import { cycleWeatherPreset } from './weatherFx.js';
import { toggleILS, cycleHudMode, showTimedHudMessage } from './hud.js';
import { toggleLandingAssist } from './landing.js';
import { cycleCloudDensity } from './terrain.js';
import { toggleReplay, isReplayPlaying, scrubReplay, setReplaySpeed, getReplayState } from './replay.js';
import { startCrosswind, startDaily, startEngineOut, startSpeedrun, startFullCircuit, startCargoRun, startEmergencyLanding, startTouchAndGo, startPrecisionApproach, startProgressive, startStunt, resetChallenge } from './challenges.js';
import { updateGamepad, getButtonJustPressed, isGamepadConnected } from './gamepad.js';
import { togglePause, isPaused, isMenuOpen, onGameStart } from './menu.js';
import { getSetting, setSetting } from './settings.js';
import { toggleGlassCockpit } from './glassCockpit.js';
import { fireMissile, getAmmoCount } from './missiles.js';
import { requestClearance, getATCState } from './atc.js';

const keys = {};
let simSpeed = 1;
export function getSimSpeed() { return simSpeed; }

let cameraToggleCallback = null;
let resetCallback = null;
let aircraftSelectCallback = null;
let carSpawnCallback = null;
let carDespawnCallback = null;

// Keys used by the sim
const SIM_KEYS = new Set([
  'w', 's', 'a', 'd', 'q', 'e', 'g', 'f', 'b', 'v', 'r', ' ',
  '0', '1', '2', '3', '4', '5', '6', '9',
  'l', 't', 'p', 'c', 'z', 'h', 'j', 'n', 'm', '=', 'u',
  '[', ']', '+', '-', 'i', 'k', 'x', 'o', 'y',
  '`', 'tab', 'enter', ',', '.',
]);

const AIRCRAFT_MAP = {
  '1': 'cessna_172',
  '2': 'boeing_737',
  '3': 'f16',
  '4': 'airbus_a320',
  '5': 'dhc2_beaver',
  '6': 'extra_300',
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
        key === ';' || e.key === 'Escape' ||
        e.key === 'Tab' || e.key === '`' || e.key === 'Enter' ||
        e.key === 'F1' || e.key === 'F2') {
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
      if (mapped === 'g' && isAircraft(getActiveVehicle()) && !isHydraulicFailed()) {
        getActiveVehicle().gear = !getActiveVehicle().gear;
        playGearSound();
      }
      if (mapped === 'f' && isAircraft(getActiveVehicle()) && !isHydraulicFailed() && !isFlapsJammed()) {
        getActiveVehicle().flaps = !getActiveVehicle().flaps;
        playFlapSound();
      }
      if (mapped === 'b' && !e.ctrlKey && isAircraft(getActiveVehicle())) {
        getActiveVehicle().speedbrake = !getActiveVehicle().speedbrake;
      }
      if (mapped === 'v' && cameraToggleCallback) {
        cameraToggleCallback();
      }
      // Fire missile (Space while airborne in fighter)
      if (mapped === ' ' && isAircraft(getActiveVehicle()) && !getActiveVehicle().onGround) {
        const aType = getActiveVehicle().currentType;
        if (aType === 'f16') {
          if (fireMissile()) {
            playMissileLaunch();
            showTimedHudMessage('FOX 2 - MSL ' + getAmmoCount() + '/' + 6, 2000);
          } else if (getAmmoCount() <= 0) {
            showTimedHudMessage('NO MISSILES', 1500);
          }
        }
      }
      if (mapped === 'r' && resetCallback) {
        resetCallback();
      }

      // Aircraft selection (1-4) — skip when Ctrl is held (Ctrl+1-4 = engine start)
      if (AIRCRAFT_MAP[mapped] && !e.ctrlKey) {
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

      // Tailhook / arresting wire toggle (carrier landing) — key 9
      if (mapped === '9' && isAircraft(getActiveVehicle())) {
        const armed = toggleArrestingWire();
        showTimedHudMessage(armed ? 'TAILHOOK DOWN — WIRE ARMED' : 'TAILHOOK UP — WIRE DISARMED', 2000);
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
        if (mapped === 'o') toggleLNAVMode();
        if (mapped === 'y') toggleVNAVMode();

        // Arrow keys: adjust AP targets when AP engaged (and not tuning radio)
        if (isAPEngaged() && !isChecklistOpen()) {
          if (e.key === 'ArrowLeft') adjustTargetHeading(-10);
          if (e.key === 'ArrowRight') adjustTargetHeading(10);
          if (e.key === 'ArrowUp') adjustTargetAltitude(100);
          if (e.key === 'ArrowDown') adjustTargetAltitude(-100);
        }
      }

      // Radio controls (aircraft only)
      if (isAircraft(getActiveVehicle()) && !isChecklistOpen()) {
        if (e.key === 'Tab') cycleRadio();
        if (e.key === '`') swapFreq();
        // Arrow keys for radio tuning when AP is NOT engaged
        if (!isAPEngaged()) {
          if (e.key === 'ArrowUp') tuneFreq(0.05);
          if (e.key === 'ArrowDown') tuneFreq(-0.05);
        }
      }

      // Engine controls (Ctrl+1-4 for individual engines, Ctrl+E start all, Ctrl+Shift+E shutdown all)
      if (e.ctrlKey && isAircraft(getActiveVehicle())) {
        if (key === '1') { e.preventDefault(); startEngine(0); showTimedHudMessage('ENGINE 1 START', 2000); }
        if (key === '2') { e.preventDefault(); startEngine(1); showTimedHudMessage('ENGINE 2 START', 2000); }
        if (key === '3') { e.preventDefault(); startEngine(2); showTimedHudMessage('ENGINE 3 START', 2000); }
        if (key === '4') { e.preventDefault(); startEngine(3); showTimedHudMessage('ENGINE 4 START', 2000); }
        if (key === 'e' && !e.shiftKey) {
          e.preventDefault();
          startAllEngines();
          showTimedHudMessage('ALL ENGINES START', 2000);
        }
        if (key === 'e' && e.shiftKey) {
          e.preventDefault();
          shutdownAllEngines();
          showTimedHudMessage('ALL ENGINES SHUTDOWN', 2000);
        }
      }

      // Electrical controls
      if (e.ctrlKey) {
        if (key === 'b') {
          e.preventDefault();
          toggleBattery();
          showTimedHudMessage('BATTERY: ' + (isBatteryOn() ? 'ON' : 'OFF'), 2000);
        }
        if (key === 'a') {
          e.preventDefault();
          toggleAlternator();
          showTimedHudMessage('ALTERNATOR: ' + (isAlternatorOn() ? 'ON' : 'OFF'), 2000);
        }
      }

      // Checklist controls
      if (e.ctrlKey && key === 'c') {
        e.preventDefault();
        toggleChecklist();
      }
      if (isChecklistOpen()) {
        if (e.key === 'Enter') advanceChecklistItem();
        if (e.key === 'ArrowRight') nextChecklist();
        if (e.key === 'ArrowLeft') prevChecklist();
      }

      // Block gear/flap toggle when hydraulic failure
      if (isHydraulicFailed() && (mapped === 'g' || mapped === 'f')) {
        showTimedHudMessage('HYDRAULIC FAILURE', 2000);
      }
      // Block flap toggle when flaps jammed
      if (isFlapsJammed() && mapped === 'f') {
        showTimedHudMessage('FLAP JAM', 2000);
      }

      // Sim speed controls
      if (mapped === '.') {
        simSpeed = Math.min(simSpeed * 2, 4);
        showTimedHudMessage('SIM SPEED: ' + simSpeed + 'x', 1500);
      }
      if (mapped === ',') {
        simSpeed = Math.max(simSpeed / 2, 0.25);
        showTimedHudMessage('SIM SPEED: ' + simSpeed + 'x', 1500);
      }

      // Weather preset cycle
      if (mapped === 'p') {
        cycleWeatherPreset();
      }

      // Toggle unlimited fuel
      if (mapped === 'u') {
        const current = getSetting('unlimitedFuel');
        setSetting('unlimitedFuel', !current);
        showTimedHudMessage('Unlimited Fuel: ' + (!current ? 'ON' : 'OFF'), 2000);
      }

      // Cloud density cycle — skip when Ctrl held (Ctrl+C = checklist)
      if (mapped === 'c' && !e.ctrlKey) {
        cycleCloudDensity();
      }

      // HUD mode cycle
      if (mapped === 'x') {
        const mode = cycleHudMode();
        showTimedHudMessage('HUD: ' + mode.toUpperCase(), 1500);
      }

      // ILS toggle (aircraft only)
      if (mapped === 'i' && isAircraft(getActiveVehicle())) {
        toggleILS();
      }

      // Landing assist (aircraft only)
      if (mapped === 'k' && isAircraft(getActiveVehicle())) {
        toggleLandingAssist();
      }

      // Glass cockpit toggle (aircraft only)
      if (mapped === '0' && isAircraft(getActiveVehicle())) {
        const on = toggleGlassCockpit();
        showTimedHudMessage('GLASS COCKPIT: ' + (on ? 'ON' : 'OFF'), 2000);
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

    // ATC clearance request
    if (e.key === 'F1') {
      e.preventDefault();
      requestClearance();
    }
    // Repeat last ATC instruction
    if (e.key === 'F2') {
      e.preventDefault();
      const atcState = getATCState();
      if (atcState.lastInstruction) {
        showTimedHudMessage(atcState.lastInstruction, 3000);
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
    } else if (spawn.startsWith('job_')) {
      const jobType = spawn.replace('job_', '');
      exitLandingMode();
      const vehicleMap = { refuel: 'fuel_truck', baggage: 'baggage_cart', pushback: 'pushback_tug', emergency: 'fire_truck' };
      if (carSpawnCallback) carSpawnCallback(vehicleMap[jobType] || 'fuel_truck');
      setTimeout(() => {
        import('./groundJobs.js').then(m => m.startJob(jobType));
      }, 100);
    } else if (spawn.startsWith('race_')) {
      const circuit = spawn.replace('race_', '');
      exitLandingMode();
      if (carSpawnCallback) carSpawnCallback('sports');
      // Teleport car to first checkpoint of the circuit after spawn
      setTimeout(() => {
        import('./raceMode.js').then(m => {
          const v = getActiveVehicle();
          const starts = { airport: { x: 130, z: -500 }, city: { x: 3700, z: -3800 }, highway: { x: 600, z: -1900 } };
          const start = starts[circuit] || starts.airport;
          if (v) {
            v.position.x = start.x;
            v.position.z = start.z;
          }
          m.startRace(circuit);
        });
      }, 200);
    } else if (spawn === 'full_circuit') {
      startFullCircuit();
      exitLandingMode();
      setSpawnLocation('gate');
      switchAircraft(type);
    } else if (spawn === 'cargo_run') {
      startCargoRun();
      exitLandingMode();
      setSpawnLocation('runway');
      switchAircraft(type);
    } else if (spawn === 'emergency_landing') {
      startEmergencyLanding();
      startLandingMode('short_final');
      setSpawnLocation('short_final');
      switchAircraft(type);
    } else if (spawn === 'touch_and_go') {
      startTouchAndGo();
      startLandingMode('short_final');
      setSpawnLocation('short_final');
      switchAircraft(type);
    } else if (spawn === 'precision_approach') {
      startPrecisionApproach();
      startLandingMode('long_final');
      setSpawnLocation('long_final');
      switchAircraft(type);
    } else if (spawn === 'progressive') {
      startProgressive();
      startLandingMode('short_final');
      setSpawnLocation('short_final');
      switchAircraft(type);
    } else if (spawn === 'stunt_challenge') {
      startStunt();
      exitLandingMode();
      setSpawnLocation('runway');
      switchAircraft(type);
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

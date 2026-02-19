import { initScene, scene, renderer, updateSunTarget, updateTimeOfDay, getTimeOfDay, isNight, ambientLight, configureShadowQuality, generateEnvironmentMap, setResizeCallback } from './scene.js';
import { createTerrain, createVegetation, createWater, createClouds, updateWater, updateClouds, updateCloudColors, createRuralStructures, createHighway, createRockFormations, createWildflowers, setCloudQuality, updateVegetationLOD, buildTerrainHeightCache } from './terrain.js';
import { createRunway, registerIntlRunwayCheck } from './runway.js';
import { createAircraft, updateAircraftVisual } from './aircraft.js';
import { getActiveVehicle, isAircraft, isCar } from './vehicleState.js';
import { initControls, setCallbacks, updateThrottle, updateControlsGamepad, getKeys } from './controls.js';
import { updatePhysics } from './physics.js';
import { initCamera, toggleCamera, updateCamera } from './camera.js';
import { initHUD, updateHUD } from './hud.js';
import {
  updateGameState,
  getCurrentState,
  resetState,
  FlightState,
} from './gameState.js';
import { initPostProcessing, updatePostProcessing, renderFrame, onResize } from './postprocessing.js';
import { initAudio, updateAudio, setRainVolume } from './audio.js';
import { initWeather, updateWeather, getWeatherState } from './weather.js';
import { initTaxiGuidance, registerIntlTaxiChecks } from './taxi.js';
import { isLandingMode } from './landing.js';
import { MAX_DT } from './constants.js';

// New modules
import { initSettings, getSetting, isSettingExplicit } from './settings.js';
import { initGPWS, updateGPWS, resetGPWS } from './gpws.js';
import { initParticles, updateParticles } from './particles.js';
import { initWeatherFx, updateWeatherFx, setAmbientRef, getCurrentPreset, WEATHER_PRESETS } from './weatherFx.js';
import { initReplay, updateRecording, updateReplay, isReplayPlaying } from './replay.js';
import { initAirportLights, updateAirportLights, setNightMode } from './airportLights.js';
import { initGamepad } from './gamepad.js';
import { initMobile, updateMobile } from './mobile.js';
import { initAutopilot } from './autopilot.js';
import { initMenu, isPaused, isMenuOpen, setMenuCallbacks, onGameStart } from './menu.js';
import { createCity, updateCityNight } from './city.js';
import { createCapeTownCity, updateCapeTownNight } from './capeTownCity.js';
import { createCoastal } from './coastal.js';
import { updateChallenge, resetChallenge, setSpeedrunCallback, formatTime } from './challenges.js';
import { applyGraphicsQuality } from './graphics.js';
import { initPerfProbe, updatePerfProbe } from './debugPerf.js';
import { initGroundVehicleAI, updateGroundVehicleAI } from './groundVehicleAI.js';
import { updateCarPhysics } from './carPhysics.js';
import { initCarSpawn, spawnCar, despawnCar, updateCarVisual, isCarSpawned } from './carSpawn.js';
import { createInternationalAirport, createIntlAirportLights, updateIntlAirportLights, setIntlNightMode, isOnIntlRunway, isOnIntlTaxiway } from './internationalAirport.js';
import { initAircraftAI, updateAircraftAI, resetAircraftAI } from './aircraftAI.js';
import { initHints, updateHints, resetHints } from './hints.js';

// Init settings (localStorage persistence)
initSettings();

// Loading screen progress
function setLoadProgress(pct, text) {
  const bar = document.getElementById('loading-bar');
  const label = document.getElementById('loading-text');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = text;
}

// Init
setLoadProgress(5, 'Initializing...');
const container = document.getElementById('app');
initScene(container);
const camera = initCamera();
initHUD();
initWeather();

// Graphics quality settings
const graphicsPreset = applyGraphicsQuality(getSetting('graphicsQuality'));
setCloudQuality(isSettingExplicit('cloudQuality') ? getSetting('cloudQuality') : graphicsPreset.cloudQuality);
configureShadowQuality(isSettingExplicit('shadowQuality') ? getSetting('shadowQuality') : graphicsPreset.shadowQuality);

// Post-processing pipeline
initPostProcessing(renderer, scene, camera);
setResizeCallback(onResize);
initPerfProbe(renderer);

// Create world
setLoadProgress(10, 'Creating terrain...');
const terrain = createTerrain();
scene.add(terrain);
buildTerrainHeightCache();
createWater(scene);
createRunway(scene);
createHighway(scene);
setLoadProgress(25, 'Growing vegetation...');
createVegetation(scene);
createRuralStructures(scene);
createRockFormations(scene);
createWildflowers(scene);
setLoadProgress(40, 'Building airports...');
createCity(scene);
createCapeTownCity(scene);
createCoastal(scene);
createClouds(scene);
createAircraft(scene);

setLoadProgress(55, 'Setting up lighting...');

// Taxi guidance system
initTaxiGuidance(scene);

// Airport ground vehicles (AI)
initGroundVehicleAI(scene);

// AI aircraft (fly between airports)
initAircraftAI(scene);

// Car spawn system
initCarSpawn(scene);

// International airport
createInternationalAirport(scene);
createIntlAirportLights(scene);
registerIntlRunwayCheck(isOnIntlRunway);
registerIntlTaxiChecks(isOnIntlRunway, isOnIntlTaxiway);

// Airport lighting system
initAirportLights(scene);

setLoadProgress(70, 'Initializing systems...');

// Particle effects
initParticles(scene);

// Weather visual effects
initWeatherFx(scene);
if (ambientLight) setAmbientRef(ambientLight);

// Autopilot
initAutopilot();

// GPWS system
initGPWS();

// Replay system
initReplay();

// Gamepad
initGamepad();

// Generate environment map for PBR reflections (must be after scene objects are added)
generateEnvironmentMap();

setLoadProgress(85, 'Preparing audio...');

// Mobile touch/tilt controls
initMobile();

// Contextual hints
initHints();

// Loading complete — fade out loading screen
setLoadProgress(100, 'Ready!');
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls) ls.classList.add('fade-out');
}, 300);

function resetFlight() {
  resetChallenge();
  resetState();
  resetGPWS();
  resetHints();
  initAutopilot();
  resetAircraftAI();
}

// Controls
initControls();
setCallbacks({
  onCameraToggle: toggleCamera,
  onReset: () => {
    const s = getCurrentState();
    if (s === FlightState.CRASHED || s === FlightState.GROUNDED || isLandingMode()) {
      // If in car, despawn it (unregister auto-restores aircraft as active)
      if (isCarSpawned()) despawnCar();
      resetFlight();
    }
  },
  onCarSpawn: (typeName) => {
    spawnCar(typeName);
  },
  onCarDespawn: () => {
    despawnCar();
  },
});

// Menu system
initMenu();
setMenuCallbacks({
  onResume: (action) => {
    if (action === 'reset') {
      resetFlight();
    }
  },
  onMainMenu: () => {
    resetFlight();
    // Show aircraft select again
    const selectPanel = document.getElementById('aircraft-select');
    if (selectPanel) selectPanel.classList.remove('hidden');
  },
});

// Speedrun completion callback
setSpeedrunCallback((time) => {
  const msg = `SPEED RUN: ${formatTime(time)}`;
  // Show via HUD message (imported from gameState)
  const el = document.getElementById('hud-message');
  if (el) el.textContent = msg;
});

// Init audio on first user interaction
let audioInitialized = false;
function ensureAudio() {
  if (!audioInitialized) {
    initAudio();
    audioInitialized = true;
  }
}
window.addEventListener('keydown', ensureAudio, { once: true });
window.addEventListener('click', ensureAudio, { once: true });
window.addEventListener('touchstart', ensureAudio, { once: true });

// Game loop
let lastTime = performance.now();
let envMapTimer = 0;

function gameLoop(time) {
  requestAnimationFrame(gameLoop);

  const rawDt = (time - lastTime) / 1000;
  lastTime = time;
  updatePerfProbe(rawDt); // Use unclamped dt for accurate FPS measurement
  let dt = Math.min(rawDt, MAX_DT);

  const gamePaused = isPaused();

  // Always update time of day and weather visuals (for menu background)
  updateTimeOfDay(dt);
  updateWeather(dt);

  if (!gamePaused) {
    // Replay playback (overrides physics when playing)
    if (isReplayPlaying()) {
      updateReplay(dt);
    } else {
      // Normal simulation
      const state = getCurrentState();

      if (state !== FlightState.CRASHED) {
        const v = getActiveVehicle();
        if (isAircraft(v)) {
          updateThrottle(dt);
          updateControlsGamepad();
          updateMobile(dt);
          updatePhysics(dt);
        } else if (isCar(v)) {
          updateCarPhysics(v, getKeys(), dt);
        }
      }

      const flightState = updateGameState(dt);
      updateChallenge(dt);
      updateHUD(flightState);

      // GPWS
      updateGPWS(dt);

      // Contextual hints
      updateHints(getActiveVehicle(), flightState, dt);

      // Record for replay
      updateRecording(dt);
    }

    if (isAircraft(getActiveVehicle())) {
      updateAircraftVisual(dt, getKeys());
    } else if (isCar(getActiveVehicle())) {
      updateCarVisual(dt);
    }

    // If replay, still update HUD
    if (isReplayPlaying()) {
      updateHUD('REPLAY');
    }

    // Audio
    if (audioInitialized) {
      updateAudio(getActiveVehicle(), dt);

      // Rain volume from weather preset
      const presetName = getCurrentPreset();
      const presetData = WEATHER_PRESETS[presetName];
      setRainVolume(presetData ? presetData.rainIntensity : 0);
    }

    // Particles
    updateParticles(dt);

    // AI ground vehicles (always update)
    updateGroundVehicleAI(dt);

    // AI aircraft (fly between airports)
    updateAircraftAI(dt);
  }

  updateCamera(dt);

  const weather = getWeatherState();

  // Water wave animation (always for menu background)
  updateWater(dt, weather.windVector);

  // Cloud drift with wind + time-of-day coloring
  const activeVehicle = getActiveVehicle();
  updateClouds(
    dt,
    weather.windVector,
    activeVehicle.position.y,
    activeVehicle.position.x,
    activeVehicle.position.z
  );
  updateVegetationLOD(activeVehicle.position.x, activeVehicle.position.z);
  const tod = getTimeOfDay();
  const sunElev = (tod >= 6 && tod <= 18) ? 90 * Math.sin(Math.PI * (tod - 6) / 12) : -10;
  updateCloudColors(sunElev);

  // Weather visual effects (rain, lightning)
  updateWeatherFx(dt);

  // Refresh environment map periodically for time-of-day changes
  envMapTimer += dt;
  if (envMapTimer > 60) {
    envMapTimer = 0;
    generateEnvironmentMap();
  }

  // Night mode updates (airport + city lights)
  const nightActive = isNight();
  setNightMode(nightActive);
  setIntlNightMode(nightActive);
  updateAirportLights(dt);
  updateIntlAirportLights(dt);
  updateCityNight(nightActive);
  updateCapeTownNight(nightActive);

  // Post-processing adjustments (night bloom)
  updatePostProcessing();

  // Keep sun shadow frustum centered on aircraft
  updateSunTarget(activeVehicle.position);

  // Render through post-processing pipeline
  renderFrame();
}

requestAnimationFrame(gameLoop);

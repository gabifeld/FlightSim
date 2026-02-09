import { initScene, scene, renderer, updateSunTarget, updateTimeOfDay, getTimeOfDay, isNight, ambientLight } from './scene.js';
import { createTerrain, createVegetation, createWater, createClouds, updateWater, updateClouds, updateCloudColors, createRuralStructures, createHighway, createRockFormations, createWildflowers } from './terrain.js';
import { createRunway } from './runway.js';
import { createAircraft, updateAircraftVisual, aircraftState } from './aircraft.js';
import { initControls, setCallbacks, updateThrottle, updateControlsGamepad } from './controls.js';
import { updatePhysics } from './physics.js';
import { initCamera, toggleCamera, updateCamera } from './camera.js';
import { initHUD, updateHUD } from './hud.js';
import {
  updateGameState,
  getCurrentState,
  resetState,
  FlightState,
} from './gameState.js';
import { initPostProcessing, updatePostProcessing, renderFrame } from './postprocessing.js';
import { initAudio, updateAudio, setRainVolume } from './audio.js';
import { initWeather, updateWeather, getWeatherState } from './weather.js';
import { initTaxiGuidance } from './taxi.js';
import { isLandingMode } from './landing.js';
import { MAX_DT } from './constants.js';

// New modules
import { initSettings } from './settings.js';
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

// Init settings (localStorage persistence)
initSettings();

// Init
const container = document.getElementById('app');
initScene(container);
const camera = initCamera();
initHUD();
initWeather();

// Post-processing pipeline
initPostProcessing(renderer, scene, camera);

// Create world
const terrain = createTerrain();
scene.add(terrain);
createWater(scene);
createRunway(scene);
createVegetation(scene);
createRuralStructures(scene);
createHighway(scene);
createRockFormations(scene);
createWildflowers(scene);
createCity(scene);
createClouds(scene);
createAircraft(scene);

// Taxi guidance system
initTaxiGuidance(scene);

// Airport lighting system
initAirportLights(scene);

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

// Mobile touch/tilt controls
initMobile();

// Controls
initControls();
setCallbacks({
  onCameraToggle: toggleCamera,
  onReset: () => {
    const s = getCurrentState();
    if (s === FlightState.CRASHED || s === FlightState.GROUNDED || isLandingMode()) {
      resetState();
      resetGPWS();
      initAutopilot();
    }
  },
});

// Menu system
initMenu();
setMenuCallbacks({
  onResume: (action) => {
    if (action === 'reset') {
      resetState();
      resetGPWS();
      initAutopilot();
    }
  },
  onMainMenu: () => {
    resetState();
    resetGPWS();
    initAutopilot();
    // Show aircraft select again
    const selectPanel = document.getElementById('aircraft-select');
    if (selectPanel) selectPanel.classList.remove('hidden');
  },
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

function gameLoop(time) {
  requestAnimationFrame(gameLoop);

  let dt = (time - lastTime) / 1000;
  lastTime = time;
  dt = Math.min(dt, MAX_DT);

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
        updateThrottle(dt);
        updateControlsGamepad();
        updateMobile(dt);
        updatePhysics(dt);
      }

      const flightState = updateGameState(dt);
      updateHUD(flightState);

      // GPWS
      updateGPWS(dt);

      // Record for replay
      updateRecording(dt);
    }

    updateAircraftVisual(dt);

    // If replay, still update HUD
    if (isReplayPlaying()) {
      updateHUD('REPLAY');
    }

    // Audio
    if (audioInitialized) {
      updateAudio(aircraftState, dt);

      // Rain volume from weather preset
      const presetName = getCurrentPreset();
      const presetData = WEATHER_PRESETS[presetName];
      setRainVolume(presetData ? presetData.rainIntensity : 0);
    }

    // Particles
    updateParticles(dt);
  }

  updateCamera(dt);

  // Water wave animation (always for menu background)
  updateWater(dt);

  // Cloud drift with wind + time-of-day coloring
  const weather = getWeatherState();
  updateClouds(dt, weather.windVector, aircraftState.position.y);
  const tod = getTimeOfDay();
  const sunElev = (tod >= 6 && tod <= 18) ? 90 * Math.sin(Math.PI * (tod - 6) / 12) : -10;
  updateCloudColors(sunElev);

  // Weather visual effects (rain, lightning)
  updateWeatherFx(dt);

  // Night mode updates (airport + city lights)
  const nightActive = isNight();
  setNightMode(nightActive);
  updateAirportLights(dt);
  updateCityNight(nightActive);

  // Post-processing adjustments (night bloom)
  updatePostProcessing();

  // Keep sun shadow frustum centered on aircraft
  updateSunTarget(aircraftState.position);

  // Render through post-processing pipeline
  renderFrame();
}

requestAnimationFrame(gameLoop);

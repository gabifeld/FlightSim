import * as THREE from 'three';
import { initScene, scene, renderer, updateSunTarget, updateTimeOfDay, getTimeOfDay, isNight, ambientLight, configureShadowQuality, generateEnvironmentMap, setResizeCallback, getSunDirection, getHorizonColor } from './scene.js';
import { createTerrain, createVegetation, createWater, createClouds, updateWater, updateClouds, updateCloudColors, createRuralStructures, createHighway, createRockFormations, createWildflowers, setCloudQuality, updateVegetationLOD, buildTerrainHeightCache, getTerrainHeightCached, createPowerLines, createCellTowers, createRestStops, createPonds, updateTerrainShader, getHighwayPath, setCarrierDeckCheck } from './terrain.js';
import { registerIntlRunwayCheck } from './runway.js';
import { createAircraft, updateAircraftVisual, showAircraftModel } from './aircraft.js';
import { getActiveVehicle, isAircraft, isCar } from './vehicleState.js';
import { initControls, setCallbacks, updateThrottle, updateControlsGamepad, getKeys, getSimSpeed } from './controls.js';
import { updatePhysics, getPhysicsFlightModel } from './physics.js';
import { initCamera, toggleCamera, updateCamera, resetCrashCamera } from './camera.js';
import { initCameraEffects, updateCameraEffects, getShakeOffset, getEffectFOV, getVignetteIntensity, isRedout, getDesaturation, getBlackoutDim } from './cameraEffects.js';
import { getGOnset } from './flightModel.js';
import { initHUD, updateHUD } from './hud.js';
import {
  updateGameState,
  getCurrentState,
  resetState,
  FlightState,
} from './gameState.js';
import { initPostProcessing, updatePostProcessing, setVignetteUniforms, setFlashOverlay, setGForceColorOverrides, renderFrame, onResize } from './postprocessing.js';
import { initAudio, updateAudio, setRainVolume, setMasterVolume, playCreakSound, canPlayCreak, getAudioContext } from './audio.js';
import { initEngineAudio, updateEngineAudio, switchEngineAudio } from './engineAudio.js';
import { initWeather, updateWeather, getWeatherState } from './weather.js';
import { initTaxiGuidance, registerIntlTaxiChecks } from './taxi.js';
import { isLandingMode } from './landing.js';
import { MAX_DT } from './constants.js';
import { getSunElevation } from './utils.js';

// New modules
import { initSettings, getSetting, setSetting, isSettingExplicit } from './settings.js';
import { initGPWS, updateGPWS, resetGPWS } from './gpws.js';
import { initParticles, updateParticles, resetParticles } from './particles.js';
import { initWeatherFx, updateWeatherFx, setAmbientRef, getCurrentPreset, WEATHER_PRESETS, getLightningFlashIntensity } from './weatherFx.js';
import { initReplay, updateRecording, updateReplay, isReplayPlaying } from './replay.js';
import { initAirportLights, updateAirportLights, setNightMode } from './airportLights.js';
import { initGamepad } from './gamepad.js';
import { initMobile, updateMobile, isMobileDevice } from './mobile.js';
import { initAutopilot } from './autopilot.js';
import { initMenu, isPaused, isMenuOpen, setMenuCallbacks, onGameStart } from './menu.js';
import { createCity, updateCityNight, updateCity } from './city.js';
import { createCapeTownCity, updateCapeTownNight } from './capeTownCity.js';
import { createCoastal } from './coastal.js';
import { updateChallenge, resetChallenge, setSpeedrunCallback, formatTime } from './challenges.js';
import { applyGraphicsQuality, runBenchmark } from './graphics.js';
import { initPerfProbe, updatePerfProbe } from './debugPerf.js';
import { initGroundVehicleAI, updateGroundVehicleAI } from './groundVehicleAI.js';
import { updateCarPhysics } from './carPhysics.js';
import { initCarSpawn, spawnCar, despawnCar, updateCarVisual, isCarSpawned } from './carSpawn.js';
import { createInternationalAirport, createIntlAirportLights, updateIntlAirportLights, setIntlNightMode, isOnIntlRunway, isOnIntlTaxiway } from './internationalAirport.js';
import { initAircraftAI, updateAircraftAI, resetAircraftAI } from './aircraftAI.js';
import { initAircraftCarrier, updateAircraftCarrier, resetCarrierAI, getCarrierDeckHeight, updateArrestingWire } from './aircraftCarrier.js';
import { initHints, updateHints, resetHints } from './hints.js';
import { initSpeedLines, updateSpeedLines } from './speedLines.js';
import { getCameraMode } from './camera.js';
import { updateHeatHaze } from './heatHaze.js';
import { initMissiles, updateMissiles, resetMissiles } from './missiles.js';
import { initCrashFx, updateCrashFx, resetCrashFx, getFlashIntensity, getCrashShakeIntensity } from './crashFx.js';
import { initATC, updateATC, resetATC, isPushbackActive, updatePushback } from './atc.js';
import { initGroundJobs, updateGroundJobs, resetGroundJobs, isJobActive } from './groundJobs.js';
import { triggerEmergencyResponse, resetEmergency } from './groundVehicleAI.js';
import { initRaceMode, updateRaceMode, resetRace, isRaceActive } from './raceMode.js';
import { initHighwayTraffic, updateHighwayTraffic } from './highwayTraffic.js';
import { initCareer, addXP, recordFlight, recordFlightTime, recordAirportVisit, recordAircraftFlown, resetFlightXPCap } from './career.js';
import { initAchievements, checkAchievement, showAchievementToast } from './achievements.js';
import { initCloudSystem, updateCloudSystem, getCloudFogFactor, setCloudSystemQuality } from './cloudSystem.js';
import { initWaterShader, updateWaterShader } from './waterShader.js';

// FlightGear-Lite modules
import { initNavaidMarkers, updateNavaidMarkers } from './navdata.js';
import { buildAllAirports } from './airportData.js';
import { initSystems, updateSystems } from './systemsEngine.js';
import { initElectrical, updateElectrical } from './electrical.js';
import { initFuelSystem, updateFuelSystem } from './fuelSystem.js';
import { initFailures, updateFailures } from './failures.js';
import { initRadio, updateRadio } from './radio.js';
import { initFlightPlan, updateFlightPlan } from './flightplan.js';
import { initGlassCockpit, updateGlassCockpit } from './glassCockpit.js';
import { initChecklist, updateChecklist } from './checklist.js';

// Init settings (localStorage persistence)
initSettings();
initCareer();
initAchievements();

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
initCameraEffects(camera);
initSpeedLines(camera);
scene.add(camera); // camera must be in scene for speed lines child to render
initHUD();
initWeather();

// Auto-detect graphics quality if user never explicitly set it
let detectedQuality = getSetting('graphicsQuality');
if (!isSettingExplicit('graphicsQuality')) {
  if (isMobileDevice()) {
    // Skip benchmark on mobile (unreliable due to thermal throttling)
    // Use dedicated mobile preset: high DPR + no shadows = sharp & fast
    detectedQuality = 'mobile';
    setSetting('postFxQuality', 'mobile');
  } else {
    detectedQuality = runBenchmark(renderer, scene, camera);
  }
  setSetting('graphicsQuality', detectedQuality);
}
const graphicsPreset = applyGraphicsQuality(detectedQuality);
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
buildAllAirports(scene, (x, z) => { try { return getTerrainHeightCached(x, z); } catch (_) { return 0; } });
createHighway(scene);

// Highway night lights — orange glow points every 80m along highway
let highwayGlowPoints = null;
{
  const hw = getHighwayPath();
  if (hw && hw.points && hw.points.length > 0) {
    const spacing = 80; // meters between lights
    const pts = hw.points;
    const lightPositions = [];
    let accumulated = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      accumulated += segLen;
      if (accumulated >= spacing) {
        accumulated -= spacing;
        // Place lights on both sides of highway (offset ±12m perpendicular)
        const nx = -dz / segLen; // perpendicular
        const nz = dx / segLen;
        lightPositions.push(pts[i].x + nx * 12, (pts[i].y || 0) + 8, pts[i].z + nz * 12);
        lightPositions.push(pts[i].x - nx * 12, (pts[i].y || 0) + 8, pts[i].z - nz * 12);
      }
    }
    if (lightPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(lightPositions, 3));
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const ctx2d = canvas.getContext('2d');
      const g = ctx2d.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255, 210, 140, 1.0)');
      g.addColorStop(0.4, 'rgba(255, 190, 100, 0.5)');
      g.addColorStop(1, 'rgba(255, 170, 70, 0.0)');
      ctx2d.fillStyle = g;
      ctx2d.fillRect(0, 0, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.PointsMaterial({
        map: tex, size: 40, transparent: true, opacity: 0.6,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, color: 0xffcc66,
      });
      highwayGlowPoints = new THREE.Points(geo, mat);
      highwayGlowPoints.visible = false;
      highwayGlowPoints.frustumCulled = false;
      scene.add(highwayGlowPoints);
    }
  }
}

setLoadProgress(25, 'Growing vegetation...');
createVegetation(scene);
createRuralStructures(scene);
createPowerLines(scene);
createCellTowers(scene);
createRestStops(scene);
createPonds(scene);
createRockFormations(scene);
createWildflowers(scene);
setLoadProgress(40, 'Building airports...');
createCity(scene);
createCapeTownCity(scene);
createCoastal(scene);
createClouds(scene);
initCloudSystem(scene);
initWaterShader(scene);
createAircraft(scene);

// Highway traffic (city traffic is handled by city.js)
initHighwayTraffic(scene);

setLoadProgress(55, 'Setting up lighting...');

// Taxi guidance system
initTaxiGuidance(scene);

// Airport ground vehicles (AI)
initGroundVehicleAI(scene);

// AI aircraft (fly between airports)
initAircraftAI(scene);

// Aircraft carrier with AI fighter jets
initAircraftCarrier(scene);
setCarrierDeckCheck(getCarrierDeckHeight);

// Car spawn system
initCarSpawn(scene);

// International airport checks (geometry now created by buildAllAirports)
registerIntlRunwayCheck(isOnIntlRunway);
registerIntlTaxiChecks(isOnIntlRunway, isOnIntlTaxiway);

// Airport lighting system
initAirportLights(scene);

setLoadProgress(70, 'Initializing systems...');

// Particle effects
initParticles(scene);

// Crash FX (fireball, debris, scorch mark)
initCrashFx(scene);

// Missile system
initMissiles(scene);

// Weather visual effects
initWeatherFx(scene);
if (ambientLight) setAmbientRef(ambientLight);

// Autopilot
initAutopilot();

// ATC and ground jobs
initATC();
initGroundJobs(scene);

// Race mode
initRaceMode(scene);

// FlightGear-Lite systems (init order matters: electrical → systems → fuel → rest)
initElectrical();
initSystems();
initFuelSystem();
initFailures();
initRadio();
initFlightPlan();
initGlassCockpit();
initChecklist();

// Navaid markers in scene
initNavaidMarkers(scene);

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

// Loading complete — fade out and remove loading screen
setLoadProgress(100, 'Ready!');
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls) {
    ls.classList.add('fade-out');
    // Fully remove after fade transition completes
    setTimeout(() => ls.classList.add('hidden'), 600);
  }
}, 300);

function resetFlight() {
  resetChallenge();
  resetRace();
  resetState();
  resetFlightXPCap();
  // Record aircraft type for career
  const veh = getActiveVehicle();
  if (veh && veh.currentType) recordAircraftFlown(veh.currentType);
  resetCrashFx();
  resetCrashCamera();
  resetParticles();
  showAircraftModel();
  resetGPWS();
  resetMissiles();
  resetHints();
  initAutopilot();
  resetAircraftAI();
  resetCarrierAI();
  resetATC();
  resetGroundJobs();
  resetEmergency();
  // Reset FlightGear-Lite systems
  initElectrical();
  initSystems();
  initFuelSystem();
  initFailures();
  initRadio();
  initFlightPlan();
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
    // Keep aircraft select hidden until player chooses FLY from the main menu
    const selectPanel = document.getElementById('aircraft-select');
    if (selectPanel) selectPanel.classList.add('hidden');
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
    // Initialize per-aircraft engine audio
    const actx = getAudioContext();
    if (actx) {
      const av = getActiveVehicle();
      const acType = av && av.config ? (av.config.type || 'prop') : 'prop';
      const engCount = av && av.config ? (av.config.engineCount || 1) : 1;
      const hasAB = acType === 'fighter';
      try { initEngineAudio(actx, actx.destination, acType === 'fighter' ? 'jet' : acType, engCount, hasAB); } catch (e) { console.warn('[Audio] engine audio init failed:', e.message); }
    }
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
  const clampedDt = Math.min(rawDt, MAX_DT);
  const simSpd = getSimSpeed();
  // Total simulation time this frame (may be large at high sim speed)
  let dt = clampedDt * simSpd;

  const gamePaused = isPaused();
  const av = getActiveVehicle();

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
        if (isAircraft(av)) {
          // Systems (once per frame, not sub-stepped)
          updateElectrical(dt);
          updateSystems(dt);
          updateFuelSystem(dt);
          updateFailures(dt);
          updateThrottle(dt);
          updateControlsGamepad();
          updateMobile(dt);

          // Physics sub-stepping only at high sim speed
          const PHYSICS_MAX_DT = 0.05;
          if (dt > PHYSICS_MAX_DT) {
            const steps = Math.ceil(dt / PHYSICS_MAX_DT);
            const pdt = dt / steps;
            for (let s = 0; s < steps; s++) updatePhysics(pdt);
          } else {
            updatePhysics(dt);
          }

          // Carrier arresting wire auto-catch
          updateArrestingWire(av, dt);

          // Navigation + ATC (once per frame)
          updateRadio(dt);
          updateFlightPlan(dt);
          updateATC(dt);
          if (isPushbackActive()) updatePushback(dt, av);
        } else if (isCar(av)) {
          const PHYSICS_MAX_DT = 0.05;
          if (dt > PHYSICS_MAX_DT) {
            const steps = Math.ceil(dt / PHYSICS_MAX_DT);
            const pdt = dt / steps;
            for (let s = 0; s < steps; s++) updateCarPhysics(av, getKeys(), pdt);
          } else {
            updateCarPhysics(av, getKeys(), dt);
          }
        }
      }

      // Ground jobs
      if (isJobActive()) {
        updateGroundJobs(dt);
      }

      // Race mode
      if (isRaceActive()) updateRaceMode(dt);

      const flightState = updateGameState(dt);
      updateChallenge(dt);
      updateHUD(flightState);

      // GPWS
      updateGPWS(dt);

      // Contextual hints
      updateHints(av, flightState, dt);

      // Record for replay
      updateRecording(dt);

      // Career: track flight time when airborne
      if (isAircraft(av) && !av.onGround && state === FlightState.AIRBORNE) {
        recordFlightTime(dt);
      }
    }

    if (isAircraft(av)) {
      updateAircraftVisual(dt, getKeys());
    } else if (isCar(av)) {
      updateCarVisual(dt);
    }

    // If replay, still update HUD
    if (isReplayPlaying()) {
      updateHUD('REPLAY');
    }

    // Audio
    if (audioInitialized) {
      updateAudio(av, dt, getCameraMode());
      try { updateEngineAudio(av, null, dt); } catch (_) {}

      // Structural creak at high G
      if (isAircraft(av) && Math.abs(av.gForce) > 3.0 && canPlayCreak()) {
        playCreakSound();
      }

      // Rain volume from weather preset
      const presetName2 = getCurrentPreset();
      const presetData2 = WEATHER_PRESETS[presetName2];
      setRainVolume(presetData2 ? presetData2.rainIntensity : 0);

      // Subtle audio dampening inside clouds
      const cloudFogAudio = getCloudFogFactor(av.position.x, av.position.y, av.position.z);
      const targetVol = 0.8 * (1.0 - cloudFogAudio * 0.15); // reduce to 85% inside cloud
      setMasterVolume(targetVol);
    }

    // Glass cockpit + checklist (display updates)
    updateGlassCockpit(dt);
    updateChecklist();

    // Particles
    updateParticles(dt);

    // Crash FX
    updateCrashFx(dt);

    // Missiles
    updateMissiles(dt);

    // Speed lines overlay
    updateSpeedLines(av.speed, getCameraMode(), dt);

    // AI ground vehicles (always update)
    updateGroundVehicleAI(dt);

    // City systems (traffic, pedestrians, street furniture) + highway traffic
    updateCity(dt, { x: av.position.x, y: av.position.y, z: av.position.z });
    updateHighwayTraffic(dt, isNight());

    // AI aircraft (fly between airports)
    updateAircraftAI(dt);

    // Aircraft carrier AI jets
    updateAircraftCarrier(dt, isNight());
  }

  updateCamera(dt);

  // Camera effects (FOV, vignette, shake) — driven by G-force onset from flight model
  { const vehicle = getActiveVehicle();
    if (isAircraft(vehicle)) {
      const fmState = getPhysicsFlightModel();
      updateCameraEffects(vehicle, dt, getGOnset(fmState));
    }
  }

  const weather = getWeatherState();

  // Cloud fly-through fog: gently increase scene fog when inside cloud volume
  { const cloudFog = getCloudFogFactor(av.position.x, av.position.y, av.position.z);
    const baseDensity = scene.fog ? 0.000028 : 0;
    if (scene.fog && cloudFog > 0.01) {
      // Gentle fog increase — just enough to feel it, not blackout (max ~10x base density)
      const targetDensity = baseDensity + cloudFog * 0.00025;
      scene.fog.density += (targetDensity - scene.fog.density) * Math.min(1, dt * 3);
    } else if (scene.fog) {
      // Smoothly return to base fog
      scene.fog.density += (baseDensity - scene.fog.density) * Math.min(1, dt * 2);
    }
  }

  // Water wave animation (always for menu background)
  updateWater(dt, weather.windVector, camera);

  // Terrain shader update (atmospheric haze + cloud shadows)
  updateTerrainShader(dt, weather.windVector);

  // Cloud drift with wind + time-of-day coloring
  updateClouds(
    dt,
    weather.windVector,
    av.position.y,
    av.position.x,
    av.position.z
  );
  const tod = getTimeOfDay();
  const sunElev = getSunElevation(tod);
  updateCloudColors(sunElev);

  // New cloud system (layered billboards with fly-through fog)
  const presetName = getCurrentPreset();
  updateCloudSystem(dt, weather.windVector.x, weather.windVector.z, tod, presetName);

  // New water shader (Gerstner waves)
  { const sunDir = getSunDirection();
    const hc = getHorizonColor();
    const waveAmp = presetName === 'storm' ? 2.0 : presetName === 'rain' ? 1.0 : 0.3;
    updateWaterShader(dt, sunDir, hc, camera.position, waveAmp);
  }

  updateVegetationLOD(av.position.x, av.position.z);
  updateNavaidMarkers(av.position.x, av.position.z);

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
  if (highwayGlowPoints) highwayGlowPoints.visible = nightActive;

  // Post-processing adjustments (bloom + god rays + color grading + heat haze + vignette)
  updatePostProcessing();
  setVignetteUniforms(getVignetteIntensity(), isRedout());
  setGForceColorOverrides(getDesaturation(), getBlackoutDim());
  // Flash from crash impact + lightning strikes
  setFlashOverlay(Math.max(getFlashIntensity(), getLightningFlashIntensity() * 0.3));
  updateHeatHaze(dt);

  // Keep sun shadow frustum centered on aircraft
  updateSunTarget(av.position);

  // Render through post-processing pipeline
  renderFrame();
}

requestAnimationFrame(gameLoop);

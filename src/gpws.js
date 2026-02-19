// Ground Proximity Warning System + altitude callouts

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { isOnRunway } from './runway.js';
import { M_TO_FEET, MS_TO_FPM } from './constants.js';
import { getSetting } from './settings.js';

const CALLOUT_ALTITUDES = [500, 400, 300, 200, 100, 50, 40, 30, 20, 10];

let lastCalloutIndex = -1;
let calloutCooldown = 0;
let warningCooldown = 0;
let activeWarning = '';
let pullUpActive = false;
let aboveResetAlt = false;

// SpeechSynthesis for callouts
let speechAvailable = false;
let preferredVoice = null;

export function initGPWS() {
  lastCalloutIndex = -1;
  calloutCooldown = 0;
  warningCooldown = 0;
  activeWarning = '';
  pullUpActive = false;
  aboveResetAlt = false;

  // Check for SpeechSynthesis availability
  if (window.speechSynthesis) {
    speechAvailable = true;
    // Try to find a deep male voice
    const findVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      preferredVoice = voices.find(v => v.name.includes('Male') && v.lang.startsWith('en')) ||
                       voices.find(v => v.lang.startsWith('en')) ||
                       voices[0];
    };
    findVoice();
    window.speechSynthesis.addEventListener('voiceschanged', findVoice);
  }
}

function speak(text, rate = 1.2) {
  if (!speechAvailable || !getSetting('gpwsEnabled')) return;

  // Cancel any current speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.rate = rate;
  utterance.pitch = 0.8; // deeper
  utterance.volume = 0.8;
  window.speechSynthesis.speak(utterance);
}

export function resetGPWS() {
  lastCalloutIndex = -1;
  calloutCooldown = 0;
  warningCooldown = 0;
  activeWarning = '';
  pullUpActive = false;
  aboveResetAlt = false;
}

export function updateGPWS(dt) {
  if (!getSetting('gpwsEnabled')) {
    pullUpActive = false;
    activeWarning = '';
    return;
  }

  const state = getActiveVehicle();
  const aglFt = state.altitudeAGL * M_TO_FEET;
  const vsFPM = state.verticalSpeed * MS_TO_FPM;

  // Reduce cooldowns
  calloutCooldown = Math.max(0, calloutCooldown - dt);
  warningCooldown = Math.max(0, warningCooldown - dt);

  // Reset callout tracking when climbing above 600ft AGL
  if (aglFt > 600) {
    aboveResetAlt = true;
    lastCalloutIndex = -1;
    pullUpActive = false;
    activeWarning = '';
  }

  // Only active during descent
  if (state.onGround || !aboveResetAlt) return;

  // Altitude callouts
  if (calloutCooldown <= 0 && vsFPM < -50) {
    for (let i = 0; i < CALLOUT_ALTITUDES.length; i++) {
      const alt = CALLOUT_ALTITUDES[i];
      if (aglFt <= alt + 15 && aglFt >= alt - 15 && i > lastCalloutIndex) {
        lastCalloutIndex = i;
        calloutCooldown = 1.5;

        // Speak the callout
        const callText = String(alt);
        speak(callText, alt <= 20 ? 1.5 : 1.2);
        break;
      }
    }
  }

  // Warnings (minimum 2s gap)
  if (warningCooldown > 0) return;

  pullUpActive = false;
  activeWarning = '';

  // SINK RATE: VS < -1500 FPM below 2500ft AGL
  if (vsFPM < -1500 && aglFt < 2500) {
    activeWarning = 'SINK RATE';
    speak('Sink Rate', 1.3);
    warningCooldown = 3.0;
    return;
  }

  // PULL UP: terrain closure < 10 seconds
  if (vsFPM < -500 && aglFt > 10) {
    const timeToTerrain = (aglFt / Math.abs(vsFPM)) * 60; // seconds
    if (timeToTerrain < 10) {
      pullUpActive = true;
      activeWarning = 'PULL UP';
      speak('Pull Up', 1.5);
      warningCooldown = 2.0;
      return;
    }
  }

  // TOO LOW GEAR: below 500ft, slow, gear up
  const takeoffSpeed = state.config ? state.config.takeoffSpeed : 55;
  if (aglFt < 500 && state.speed < takeoffSpeed * 1.5 && !state.gear && vsFPM < -200) {
    activeWarning = 'TOO LOW GEAR';
    speak('Too Low, Gear', 1.3);
    warningCooldown = 3.0;
    return;
  }

  // TERRAIN: below 100ft, not aligned with runway
  if (aglFt < 100 && aglFt > 10 && !isOnRunway(state.position.x, state.position.z) && vsFPM < -200) {
    activeWarning = 'TERRAIN';
    speak('Terrain, Terrain', 1.5);
    warningCooldown = 2.0;
    return;
  }
}

export function getGPWSState() {
  return {
    activeWarning,
    pullUpActive,
  };
}

// Persistent settings + scores via localStorage

const STORAGE_KEY = 'flightsim_settings';
const SCORES_KEY = 'flightsim_scores';

const defaults = {
  graphicsQuality: 'high', // 'low', 'medium', 'high'
  shadowQuality: 'high', // 'low', 'medium', 'high'
  vegetationDensity: 'high', // 'low', 'medium', 'high'
  cloudQuality: 'high', // 'low', 'medium', 'high'
  postFxQuality: 'high', // 'low', 'medium', 'high'
  assetQuality: 'medium', // 'low', 'medium', 'high'
  masterVolume: 0.8,
  mouseSensitivity: 1.0,
  showFPS: false,
  lastAircraft: 'cessna_172',
  lastAirport: 'procedural',
  timeOfDay: 12.0,
  mapboxApiKey: '',
  gpwsEnabled: true,
  autoCycleTime: false,
};

let settings = { ...defaults };
let bestScores = {};
const explicitSettingKeys = new Set();

function loadSettings() {
  explicitSettingKeys.clear();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = { ...defaults, ...parsed };
      for (const key of Object.keys(parsed)) explicitSettingKeys.add(key);
    }
  } catch (e) {
    // Ignore parse errors
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    // Ignore storage errors
  }
}

function loadScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (raw) {
      bestScores = JSON.parse(raw);
    }
  } catch (e) {
    // Ignore parse errors
  }
}

function saveScores() {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(bestScores));
  } catch (e) {
    // Ignore storage errors
  }
}

export function initSettings() {
  loadSettings();
  loadScores();
}

export function getSetting(key) {
  return settings[key] !== undefined ? settings[key] : defaults[key];
}

export function setSetting(key, value) {
  settings[key] = value;
  explicitSettingKeys.add(key);
  saveSettings();
}

export function getAllSettings() {
  return { ...settings };
}

export function saveBestScore(key, score) {
  if (!bestScores[key] || score > bestScores[key]) {
    bestScores[key] = score;
    saveScores();
    return true; // new best
  }
  return false;
}

export function getBestScore(key) {
  return bestScores[key] || 0;
}

export function getAllScores() {
  return { ...bestScores };
}

export function isSettingExplicit(key) {
  return explicitSettingKeys.has(key);
}

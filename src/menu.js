// Menu system: main menu, pause menu, settings panel, controls reference
import { getSetting, setSetting } from './settings.js';
import { setMasterVolume } from './audio.js';
import { setTimeOfDay, getTimeOfDay } from './scene.js';

let paused = false;
let activePanel = 'main'; // 'main' | 'pause' | 'settings' | 'controls' | null
let returnTo = null; // which panel to return to from settings/controls
let onResumeCallback = null;
let onMainMenuCallback = null;

// DOM refs
let els = {};

export function initMenu() {
  els = {
    overlay: document.getElementById('menu-overlay'),
    mainMenu: document.getElementById('main-menu'),
    pauseMenu: document.getElementById('pause-menu'),
    settingsPanel: document.getElementById('settings-panel'),
    controlsPanel: document.getElementById('controls-panel'),
    // Main menu buttons
    btnFly: document.getElementById('menu-fly'),
    btnMainSettings: document.getElementById('menu-main-settings'),
    btnMainControls: document.getElementById('menu-main-controls'),
    // Pause menu buttons
    btnResume: document.getElementById('menu-resume'),
    btnPauseSettings: document.getElementById('menu-pause-settings'),
    btnPauseControls: document.getElementById('menu-pause-controls'),
    btnReset: document.getElementById('menu-reset'),
    btnMainMenuReturn: document.getElementById('menu-main-return'),
    // Settings
    volumeSlider: document.getElementById('setting-volume'),
    volumeValue: document.getElementById('setting-volume-value'),
    todSlider: document.getElementById('setting-tod'),
    todValue: document.getElementById('setting-tod-value'),
    gpwsToggle: document.getElementById('setting-gpws'),
    // Back buttons
    btnSettingsBack: document.getElementById('settings-back'),
    btnControlsBack: document.getElementById('controls-back'),
  };

  // Main menu buttons
  if (els.btnFly) {
    els.btnFly.addEventListener('click', () => {
      hideAllPanels();
      // Show the aircraft selection panel
      const selectPanel = document.getElementById('aircraft-select');
      if (selectPanel) selectPanel.classList.remove('hidden');
      els.overlay.classList.add('hidden');
      activePanel = null;
    });
  }

  if (els.btnMainSettings) {
    els.btnMainSettings.addEventListener('click', () => {
      returnTo = 'main';
      showPanel('settings');
    });
  }

  if (els.btnMainControls) {
    els.btnMainControls.addEventListener('click', () => {
      returnTo = 'main';
      showPanel('controls');
    });
  }

  // Pause menu buttons
  if (els.btnResume) {
    els.btnResume.addEventListener('click', resumeGame);
  }

  if (els.btnPauseSettings) {
    els.btnPauseSettings.addEventListener('click', () => {
      returnTo = 'pause';
      showPanel('settings');
    });
  }

  if (els.btnPauseControls) {
    els.btnPauseControls.addEventListener('click', () => {
      returnTo = 'pause';
      showPanel('controls');
    });
  }

  if (els.btnReset) {
    els.btnReset.addEventListener('click', () => {
      resumeGame();
      if (onResumeCallback) onResumeCallback('reset');
    });
  }

  if (els.btnMainMenuReturn) {
    els.btnMainMenuReturn.addEventListener('click', () => {
      paused = false;
      if (onMainMenuCallback) onMainMenuCallback();
      showPanel('main');
    });
  }

  // Settings controls
  if (els.volumeSlider) {
    els.volumeSlider.value = getSetting('masterVolume') * 100;
    updateVolumeLabel();
    els.volumeSlider.addEventListener('input', () => {
      const vol = els.volumeSlider.value / 100;
      setSetting('masterVolume', vol);
      setMasterVolume(vol);
      updateVolumeLabel();
    });
  }

  if (els.todSlider) {
    els.todSlider.value = getTimeOfDay();
    updateTodLabel();
    els.todSlider.addEventListener('input', () => {
      const tod = parseFloat(els.todSlider.value);
      setTimeOfDay(tod);
      setSetting('timeOfDay', tod);
      updateTodLabel();
    });
  }

  if (els.gpwsToggle) {
    els.gpwsToggle.checked = getSetting('gpwsEnabled');
    els.gpwsToggle.addEventListener('change', () => {
      setSetting('gpwsEnabled', els.gpwsToggle.checked);
    });
  }

  // Back buttons
  if (els.btnSettingsBack) {
    els.btnSettingsBack.addEventListener('click', () => {
      showPanel(returnTo || 'main');
    });
  }

  if (els.btnControlsBack) {
    els.btnControlsBack.addEventListener('click', () => {
      showPanel(returnTo || 'main');
    });
  }

  // Show main menu on load
  showPanel('main');
}

function updateVolumeLabel() {
  if (els.volumeValue) {
    els.volumeValue.textContent = Math.round(els.volumeSlider.value) + '%';
  }
}

function updateTodLabel() {
  if (els.todValue && els.todSlider) {
    const h = parseFloat(els.todSlider.value);
    const hours = Math.floor(h);
    const mins = Math.floor((h % 1) * 60);
    els.todValue.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }
}

function hideAllPanels() {
  if (els.mainMenu) els.mainMenu.classList.add('hidden');
  if (els.pauseMenu) els.pauseMenu.classList.add('hidden');
  if (els.settingsPanel) els.settingsPanel.classList.add('hidden');
  if (els.controlsPanel) els.controlsPanel.classList.add('hidden');
}

function showPanel(name) {
  hideAllPanels();
  activePanel = name;

  if (els.overlay) els.overlay.classList.remove('hidden');

  switch (name) {
    case 'main':
      if (els.mainMenu) els.mainMenu.classList.remove('hidden');
      break;
    case 'pause':
      if (els.pauseMenu) els.pauseMenu.classList.remove('hidden');
      break;
    case 'settings':
      if (els.settingsPanel) els.settingsPanel.classList.remove('hidden');
      // Sync tod slider with current time
      if (els.todSlider) {
        els.todSlider.value = getTimeOfDay();
        updateTodLabel();
      }
      break;
    case 'controls':
      if (els.controlsPanel) els.controlsPanel.classList.remove('hidden');
      break;
  }
}

export function togglePause() {
  if (activePanel === 'main') return; // Don't pause from main menu

  if (paused) {
    resumeGame();
  } else {
    pauseGame();
  }
}

export function pauseGame() {
  paused = true;
  showPanel('pause');
}

function resumeGame() {
  paused = false;
  hideAllPanels();
  if (els.overlay) els.overlay.classList.add('hidden');
  activePanel = null;
}

export function isPaused() {
  return paused;
}

export function isMenuOpen() {
  return activePanel !== null;
}

export function setMenuCallbacks({ onResume, onMainMenu }) {
  onResumeCallback = onResume;
  onMainMenuCallback = onMainMenu;
}

// Called when the game starts (after aircraft select START click)
export function onGameStart() {
  hideAllPanels();
  if (els.overlay) els.overlay.classList.add('hidden');
  activePanel = null;
  paused = false;
}

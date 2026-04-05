// Menu system: main menu, pause menu, settings panel, controls reference, pilot log
import { getSetting, setSetting } from './settings.js';
import { setMasterVolume } from './audio.js';
import { setTimeOfDay, getTimeOfDay } from './scene.js';
import { applyGraphicsQuality } from './graphics.js';
import { setFailureMode, getFailureMode } from './failures.js';
import { getCareerState, getRank, getXP, getXPForNextRank, getRankProgress } from './career.js';
import { getAllAchievements } from './achievements.js';

// Helper: listen for both click and touchend to ensure mobile compatibility.
// Prevents double-fire by consuming the event on touchend.
function onTap(el, handler) {
  if (!el) return;
  el.addEventListener('click', handler);
  el.addEventListener('touchend', (e) => {
    e.preventDefault();
    handler(e);
  });
}

let paused = false;
let activePanel = 'main'; // 'main' | 'pause' | 'settings' | 'controls' | null
let returnTo = null; // which panel to return to from settings/controls
let onResumeCallback = null;
let onMainMenuCallback = null;
let transitionTimer = null;

// DOM refs
let els = {};

function clearTransitionTimer() {
  if (transitionTimer !== null) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
}

export function initMenu() {
  els = {
    overlay: document.getElementById('menu-overlay'),
    mainMenu: document.getElementById('main-menu'),
    pauseMenu: document.getElementById('pause-menu'),
    settingsPanel: document.getElementById('settings-panel'),
    controlsPanel: document.getElementById('controls-panel'),
    pilotPanel: document.getElementById('pilot-panel'),
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
    fuelToggle: document.getElementById('setting-fuel'),
    // Graphics + FPS
    graphicsSelect: document.getElementById('setting-graphics'),
    fpsToggle: document.getElementById('setting-fps'),
    failuresSelect: document.getElementById('setting-failures'),
    realismSelect: document.getElementById('setting-realism'),
    // Back buttons
    btnSettingsBack: document.getElementById('settings-back'),
    btnControlsBack: document.getElementById('controls-back'),
    btnPilotBack: document.getElementById('pilot-back'),
    // Pilot log buttons
    btnMainPilot: document.getElementById('menu-main-pilot'),
    btnPausePilot: document.getElementById('menu-pause-pilot'),
  };

  // Main menu buttons
  onTap(els.btnFly, () => {
    clearTransitionTimer();
    hideAllPanels();
    // Show the aircraft selection panel
    const selectPanel = document.getElementById('aircraft-select');
    if (selectPanel) selectPanel.classList.remove('hidden');
    if (els.overlay) {
      els.overlay.classList.add('hidden');
      els.overlay.style.opacity = ''; // clear transition inline style
    }
    activePanel = null;
  });

  onTap(els.btnMainSettings, () => {
    returnTo = 'main';
    transitionTo('settings');
  });

  onTap(els.btnMainControls, () => {
    returnTo = 'main';
    transitionTo('controls');
  });

  // Pause menu buttons
  onTap(els.btnResume, () => resumeGame());

  onTap(els.btnPauseSettings, () => {
    returnTo = 'pause';
    transitionTo('settings');
  });

  onTap(els.btnPauseControls, () => {
    returnTo = 'pause';
    transitionTo('controls');
  });

  onTap(els.btnReset, () => {
    resumeGame();
    if (onResumeCallback) onResumeCallback('reset');
  });

  onTap(els.btnMainMenuReturn, () => {
    paused = false;
    if (onMainMenuCallback) onMainMenuCallback();
    transitionTo('main');
  });

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

  // ATC toggle
  const atcEl = document.getElementById('setting-atc');
  if (atcEl) {
    atcEl.checked = getSetting('atcEnabled') !== false;
    atcEl.addEventListener('change', () => setSetting('atcEnabled', atcEl.checked));
  }

  if (els.fuelToggle) {
    els.fuelToggle.checked = getSetting('unlimitedFuel');
    els.fuelToggle.addEventListener('change', () => {
      setSetting('unlimitedFuel', els.fuelToggle.checked);
    });
  }

  if (els.graphicsSelect) {
    els.graphicsSelect.value = getSetting('graphicsQuality');
    els.graphicsSelect.addEventListener('change', () => {
      const level = els.graphicsSelect.value;
      setSetting('graphicsQuality', level);
      applyGraphicsQuality(level);
    });
  }

  if (els.fpsToggle) {
    els.fpsToggle.checked = getSetting('showFPS');
    els.fpsToggle.addEventListener('change', () => {
      setSetting('showFPS', els.fpsToggle.checked);
      const fpsEl = document.getElementById('perf-overlay');
      if (fpsEl) fpsEl.style.display = els.fpsToggle.checked ? 'block' : 'none';
    });
  }

  if (els.failuresSelect) {
    els.failuresSelect.value = getFailureMode();
    els.failuresSelect.addEventListener('change', () => {
      const mode = els.failuresSelect.value;
      setFailureMode(mode);
      setSetting('failureMode', mode);
    });
  }

  if (els.realismSelect) {
    els.realismSelect.value = getSetting('realism');
    els.realismSelect.addEventListener('change', () => {
      setSetting('realism', els.realismSelect.value);
    });
  }

  // Back buttons
  onTap(els.btnSettingsBack, () => {
    transitionTo(returnTo || 'main');
  });

  onTap(els.btnControlsBack, () => {
    transitionTo(returnTo || 'main');
  });

  // Pilot log buttons
  onTap(els.btnMainPilot, () => {
    returnTo = 'main';
    transitionTo('pilot');
  });
  onTap(els.btnPausePilot, () => {
    returnTo = 'pause';
    transitionTo('pilot');
  });
  onTap(els.btnPilotBack, () => {
    transitionTo(returnTo || 'main');
  });

  // Pilot log tab switching
  const pilotTabs = document.querySelectorAll('.pilot-tab');
  pilotTabs.forEach(tab => {
    onTap(tab, () => {
      pilotTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.pilot-tab-content').forEach(c => c.style.display = 'none');
      const target = document.getElementById('pilot-' + tab.dataset.tab);
      if (target) target.style.display = '';
    });
  });

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
  if (els.pilotPanel) els.pilotPanel.classList.add('hidden');
}

function transitionTo(name) {
  if (!els.overlay) { showPanel(name); return; }
  clearTransitionTimer();
  els.overlay.classList.remove('hidden');
  els.overlay.style.opacity = '0';
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    showPanel(name);
    els.overlay.style.opacity = '1';
  }, 200);
}

function showPanel(name) {
  hideAllPanels();
  activePanel = name;

  if (els.overlay) {
    els.overlay.classList.remove('hidden');
    els.overlay.style.opacity = '1';
  }

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
      // Sync fuel toggle (may have been changed via U key)
      if (els.fuelToggle) {
        els.fuelToggle.checked = getSetting('unlimitedFuel');
      }
      // Sync failure mode
      if (els.failuresSelect) {
        els.failuresSelect.value = getFailureMode();
      }
      break;
    case 'controls':
      if (els.controlsPanel) els.controlsPanel.classList.remove('hidden');
      break;
    case 'pilot':
      if (els.pilotPanel) els.pilotPanel.classList.remove('hidden');
      populatePilotLog();
      break;
  }
}

function populatePilotLog() {
  const state = getCareerState();
  const rank = getRank();
  const xp = getXP();
  const nextXP = getXPForNextRank();
  const progress = getRankProgress();

  // Career tab
  const rankEl = document.getElementById('pilot-rank');
  if (rankEl) rankEl.textContent = rank.toUpperCase();
  const fillEl = document.getElementById('pilot-xp-fill');
  if (fillEl) fillEl.style.width = (progress * 100) + '%';
  const xpText = document.getElementById('pilot-xp-text');
  if (xpText) xpText.textContent = `${xp} / ${nextXP} XP`;
  const nextEl = document.getElementById('pilot-next-unlock');
  if (nextEl) {
    const ranks = ['Student Pilot', 'Private Pilot', 'Commercial', 'ATP', 'Captain'];
    const idx = ranks.findIndex(r => r.toLowerCase().replace(/ /g, '_') === rank || r.toLowerCase() === rank);
    if (idx < ranks.length - 1) nextEl.textContent = 'Next: ' + ranks[idx + 1];
    else nextEl.textContent = 'MAX RANK';
  }

  // Stats tab
  const setStatEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setStatEl('stat-flights', state.flights || 0);
  const totalSec = state.totalFlightTimeSec || 0;
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  setStatEl('stat-time', `${hrs}h ${mins}m`);
  setStatEl('stat-airports', `${(state.firstVisits || []).length} / 6`);
  setStatEl('stat-aircraft', `${(state.firstAircraft || []).length} / 5`);

  // Achievements tab — build DOM safely (no innerHTML)
  const listEl = document.getElementById('achievements-list');
  if (listEl) {
    listEl.textContent = ''; // clear
    const all = getAllAchievements();
    for (const a of all) {
      const item = document.createElement('div');
      item.className = 'achievement-item ' + (a.unlocked ? 'unlocked' : 'locked');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'achievement-name';
      nameDiv.textContent = a.name;
      const descDiv = document.createElement('div');
      descDiv.className = 'achievement-desc';
      descDiv.textContent = a.description;
      item.appendChild(nameDiv);
      item.appendChild(descDiv);
      if (a.unlocked) {
        const badge = document.createElement('div');
        badge.className = 'achievement-badge';
        badge.textContent = '\u2713';
        item.appendChild(badge);
      }
      listEl.appendChild(item);
    }
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
  clearTransitionTimer();
  paused = false;
  hideAllPanels();
  if (els.overlay) {
    els.overlay.classList.add('hidden');
    els.overlay.style.opacity = '';  // clear any inline opacity from transitionTo
  }
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
  clearTransitionTimer();
  hideAllPanels();
  if (els.overlay) {
    els.overlay.classList.add('hidden');
    els.overlay.style.opacity = '';  // clear any inline opacity from transitionTo
  }
  activePanel = null;
  paused = false;
}

// Interactive checklists with auto-condition checking
// Supports preflight, engine start, before takeoff, landing, and shutdown checklists

import { getActiveVehicle, isAircraft } from './vehicleState.js';
import { isBatteryOn, isAlternatorOn, isAvionicsPowered, isInstrumentsPowered } from './electrical.js';
import { getTotalFuel, isFuelPressureOK } from './fuelSystem.js';
import { getEngineState, isAnyEngineRunning, areAllEnginesRunning } from './systemsEngine.js';

// ── Checklist Definitions ─────────────────────────────────────────────
const CHECKLISTS = {
  preflight: {
    name: 'Preflight',
    items: [
      { text: 'Battery', check: () => isBatteryOn(), action: 'ON' },
      { text: 'Alternator', check: () => isAlternatorOn(), action: 'ON' },
      { text: 'Fuel Quantity', check: () => getTotalFuel() > 0.1, action: 'CHECK' },
      { text: 'Avionics', check: () => isAvionicsPowered(), action: 'ON' },
    ],
  },
  engine_start: {
    name: 'Engine Start',
    items: [
      { text: 'Battery', check: () => isBatteryOn(), action: 'ON' },
      { text: 'Fuel Selector', check: () => isFuelPressureOK(), action: 'BOTH' },
      { text: 'Engine Start', check: () => isAnyEngineRunning(), action: 'START' },
      { text: 'Oil Pressure', check: () => { const e = getEngineState(0); return e && e.oilPressure > 30; }, action: 'CHECK GREEN' },
      { text: 'Alternator', check: () => isAlternatorOn(), action: 'ON' },
    ],
  },
  before_takeoff: {
    name: 'Before Takeoff',
    items: [
      { text: 'Engines Running', check: () => areAllEnginesRunning(), action: 'ALL RUNNING' },
      { text: 'Flaps', check: () => getActiveVehicle().flaps === false, action: 'UP / T/O' },
      { text: 'Speedbrake', check: () => getActiveVehicle().speedbrake === false, action: 'RETRACTED' },
      { text: 'Flight Controls', check: () => true, action: 'FREE & CORRECT' },
      { text: 'Instruments', check: () => isInstrumentsPowered(), action: 'CHECK' },
    ],
  },
  landing: {
    name: 'Landing',
    items: [
      { text: 'Gear', check: () => getActiveVehicle().gear === true, action: 'DOWN' },
      { text: 'Flaps', check: () => getActiveVehicle().flaps === true, action: 'LANDING' },
      { text: 'Speedbrake', check: () => !getActiveVehicle().speedbrake, action: 'ARMED/RET' },
      { text: 'Landing Lights', check: () => getActiveVehicle().landingLight === true, action: 'ON' },
    ],
  },
  shutdown: {
    name: 'Shutdown',
    items: [
      { text: 'Throttle', check: () => getActiveVehicle().throttle < 0.05, action: 'IDLE' },
      { text: 'Speedbrake', check: () => !getActiveVehicle().speedbrake, action: 'RETRACTED' },
      { text: 'Avionics', check: () => true, action: 'OFF' },
      { text: 'Engines', check: () => !isAnyEngineRunning(), action: 'SHUTDOWN' },
      { text: 'Battery', check: () => !isBatteryOn(), action: 'OFF' },
    ],
  },
};

const CHECKLIST_ORDER = ['preflight', 'engine_start', 'before_takeoff', 'landing', 'shutdown'];

// ── State ─────────────────────────────────────────────────────────────
let panel = null;
let titleEl = null;
let itemsEl = null;
let open = false;
let currentIdx = 0;          // which checklist in CHECKLIST_ORDER
let currentItemIdx = 0;      // cursor position within current checklist

// ── Init ──────────────────────────────────────────────────────────────
export function initChecklist() {
  panel = document.createElement('div');
  panel.id = 'checklist-panel';
  panel.style.cssText = `
    position: fixed; top: 50%; right: 20px; transform: translateY(-50%);
    width: 280px; background: rgba(0,0,0,0.85); color: #fff;
    border: 1px solid #444; border-radius: 8px; padding: 16px;
    font-family: monospace; font-size: 13px; z-index: 60;
    pointer-events: auto; max-height: 80vh; overflow-y: auto;
    display: none;
  `;

  titleEl = document.createElement('div');
  titleEl.id = 'checklist-title';
  titleEl.style.cssText = 'font-size:15px;font-weight:bold;margin-bottom:10px;color:#00aaff;';
  panel.appendChild(titleEl);

  itemsEl = document.createElement('div');
  itemsEl.id = 'checklist-items';
  panel.appendChild(itemsEl);

  const help = document.createElement('div');
  help.style.cssText = 'margin-top:10px;color:#888;font-size:11px;';
  help.textContent = 'Ctrl+C: toggle | Enter: next item | \u2190/\u2192: switch checklist';
  panel.appendChild(help);

  document.body.appendChild(panel);
}

// ── Toggle ────────────────────────────────────────────────────────────
export function toggleChecklist() {
  open = !open;
  if (panel) {
    panel.style.display = open ? 'block' : 'none';
  }
  if (open) renderChecklist();
}

export function isChecklistOpen() {
  return open;
}

// ── Navigation ────────────────────────────────────────────────────────
export function nextChecklist() {
  currentIdx = (currentIdx + 1) % CHECKLIST_ORDER.length;
  currentItemIdx = 0;
  if (open) renderChecklist();
}

export function prevChecklist() {
  currentIdx = (currentIdx - 1 + CHECKLIST_ORDER.length) % CHECKLIST_ORDER.length;
  currentItemIdx = 0;
  if (open) renderChecklist();
}

export function advanceChecklistItem() {
  const key = CHECKLIST_ORDER[currentIdx];
  const cl = CHECKLISTS[key];
  if (!cl) return;
  currentItemIdx = Math.min(currentItemIdx + 1, cl.items.length - 1);
  if (open) renderChecklist();
}

export function getCurrentChecklistName() {
  const key = CHECKLIST_ORDER[currentIdx];
  const cl = CHECKLISTS[key];
  return cl ? cl.name : '';
}

// ── Update (call each frame when open) ────────────────────────────────
export function updateChecklist() {
  if (!open) return;
  renderChecklist();
}

// ── Render (uses safe DOM methods only) ───────────────────────────────
function renderChecklist() {
  if (!panel || !titleEl || !itemsEl) return;

  const key = CHECKLIST_ORDER[currentIdx];
  const cl = CHECKLISTS[key];
  if (!cl) return;

  // Title with arrows
  titleEl.textContent = '\u25C0 ' + cl.name + ' \u25B6';

  // Clear items using DOM
  while (itemsEl.firstChild) {
    itemsEl.removeChild(itemsEl.firstChild);
  }

  let allPassed = true;

  for (let i = 0; i < cl.items.length; i++) {
    const item = cl.items[i];
    let passed = false;
    try {
      passed = item.check();
    } catch (e) {
      passed = false;
    }

    if (!passed) allPassed = false;

    const row = document.createElement('div');
    row.style.cssText =
      'padding: 4px 6px; margin: 2px 0; border-radius: 3px;' +
      'display: flex; justify-content: space-between; align-items: center;' +
      (i === currentItemIdx
        ? 'background: rgba(0,170,255,0.15); border-left: 3px solid #00aaff;'
        : 'border-left: 3px solid transparent;');

    // Left side: icon + text
    const left = document.createElement('span');

    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = 'color:' + (passed ? '#00ff44' : '#ff3333') + ';margin-right:6px;';
    iconSpan.textContent = passed ? '\u2713' : '\u2717';

    const textNode = document.createTextNode(item.text);

    left.appendChild(iconSpan);
    left.appendChild(textNode);

    // Right side: action
    const right = document.createElement('span');
    right.style.cssText = 'color:' + (passed ? '#00ff44' : '#aaa') + ';font-size:11px;';
    right.textContent = item.action;

    row.appendChild(left);
    row.appendChild(right);
    itemsEl.appendChild(row);
  }

  // Completion indicator
  if (allPassed) {
    const complete = document.createElement('div');
    complete.style.cssText = 'margin-top:8px;color:#00ff44;text-align:center;font-weight:bold;';
    complete.textContent = '\u2713 CHECKLIST COMPLETE';
    itemsEl.appendChild(complete);
  }
}

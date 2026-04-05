// Pilot career progression system — XP, ranks, flight tracking
// Persists all state to localStorage under 'pilotCareer'

const STORAGE_KEY = 'pilotCareer';

const RANKS = [
  { name: 'Student Pilot', minXP: 0 },
  { name: 'Private Pilot', minXP: 1000 },
  { name: 'Commercial',    minXP: 5000 },
  { name: 'ATP',           minXP: 15000 },
  { name: 'Captain',       minXP: 30000 },
];

const RANK_KEYS = ['student', 'private', 'commercial', 'atp', 'captain'];

// XP cap for airborne time per single flight
const AIRBORNE_XP_CAP = 50;
const AIRBORNE_XP_PER_MINUTE = 10;

// XP awards for first-time events
const FIRST_AIRPORT_XP = 200;
const FIRST_AIRCRAFT_XP = 150;

let state = null;
let airborneXPThisFlight = 0;

function defaultState() {
  return {
    xp: 0,
    rank: 'student',
    flights: 0,
    totalFlightTimeSec: 0,
    firstVisits: [],
    firstAircraft: [],
    achievements: [],
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Ignore storage errors
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...defaultState(), ...parsed };
    } else {
      state = defaultState();
    }
  } catch (e) {
    state = defaultState();
  }
}

function rankIndexByKey(key) {
  const idx = RANK_KEYS.indexOf(key);
  return idx >= 0 ? idx : 0;
}

function computeRank(xp) {
  let rankIdx = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].minXP) {
      rankIdx = i;
      break;
    }
  }
  return RANK_KEYS[rankIdx];
}

// ── Public API ──

export function initCareer() {
  load();
  airborneXPThisFlight = 0;
}

export function getCareerState() {
  if (!state) load();
  return { ...state, firstVisits: [...state.firstVisits], firstAircraft: [...state.firstAircraft], achievements: [...state.achievements] };
}

export function addXP(amount, _source) {
  if (!state) load();
  const prevRank = state.rank;
  state.xp += amount;
  const newRank = computeRank(state.xp);
  const promoted = newRank !== prevRank && rankIndexByKey(newRank) > rankIndexByKey(prevRank);
  if (promoted) {
    state.rank = newRank;
  }
  save();
  return { newXP: state.xp, promoted, newRank: promoted ? newRank : prevRank };
}

export function recordFlight() {
  if (!state) load();
  state.flights += 1;
  airborneXPThisFlight = 0;
  save();
}

// Accumulator for fractional XP (dt per frame is too small for Math.floor to produce 1)
let _xpAccumulator = 0;

export function recordFlightTime(seconds) {
  if (!state) load();
  state.totalFlightTimeSec += seconds;

  // Accumulate fractional XP over frames, award when >= 1
  const minutes = seconds / 60;
  _xpAccumulator += minutes * AIRBORNE_XP_PER_MINUTE;

  let result = null;
  if (_xpAccumulator >= 1 && airborneXPThisFlight < AIRBORNE_XP_CAP) {
    const xpEarned = Math.min(
      Math.floor(_xpAccumulator),
      AIRBORNE_XP_CAP - airborneXPThisFlight
    );
    _xpAccumulator -= xpEarned;
    airborneXPThisFlight += xpEarned;
    result = addXP(xpEarned, 'flight_time');
  }

  // Save flight time periodically (every ~10s) not every frame
  if (Math.floor(state.totalFlightTimeSec) % 10 === 0) save();
  return result;
}

export function recordAirportVisit(icao) {
  if (!state) load();
  if (!icao) return null;
  const code = icao.toUpperCase();
  if (state.firstVisits.includes(code)) return null;

  state.firstVisits.push(code);
  save();
  return addXP(FIRST_AIRPORT_XP, 'first_airport');
}

export function recordAircraftFlown(typeName) {
  if (!state) load();
  if (!typeName) return null;
  if (state.firstAircraft.includes(typeName)) return null;

  state.firstAircraft.push(typeName);
  save();
  return addXP(FIRST_AIRCRAFT_XP, 'first_aircraft');
}

export function getRank() {
  if (!state) load();
  const idx = rankIndexByKey(state.rank);
  return RANKS[idx].name;
}

export function getXP() {
  if (!state) load();
  return state.xp;
}

export function getXPForNextRank() {
  if (!state) load();
  const idx = rankIndexByKey(state.rank);
  if (idx >= RANKS.length - 1) return RANKS[RANKS.length - 1].minXP; // Already max rank
  return RANKS[idx + 1].minXP;
}

export function getRankProgress() {
  if (!state) load();
  const idx = rankIndexByKey(state.rank);
  if (idx >= RANKS.length - 1) return 1; // Max rank

  const currentMin = RANKS[idx].minXP;
  const nextMin = RANKS[idx + 1].minXP;
  const range = nextMin - currentMin;
  if (range <= 0) return 1;

  return Math.min(1, Math.max(0, (state.xp - currentMin) / range));
}

// Used by achievements system to read/write the achievements array
export function getAchievementIds() {
  if (!state) load();
  return state.achievements;
}

export function addAchievementId(id) {
  if (!state) load();
  if (!state.achievements.includes(id)) {
    state.achievements.push(id);
    save();
  }
}

// Reset airborne XP tracking (call at start of each flight)
export function resetFlightXPCap() {
  _xpAccumulator = 0;
  airborneXPThisFlight = 0;
}

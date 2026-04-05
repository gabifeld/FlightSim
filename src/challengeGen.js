// Procedural challenge generator with shareable seed
// No external dependencies — fully self-contained

// ── Seeded PRNG (mulberry32) ──
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Seed encoding / decoding ──
// Maps a numeric seed to a 6-character alphanumeric string and back.
// Alphabet: 0-9 A-Z (36 symbols), 36^6 = 2,176,782,336 unique codes.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = ALPHABET.length; // 36
const SEED_LENGTH = 6;

export function encodeSeed(num) {
  num = Math.abs(Math.floor(num)) % Math.pow(BASE, SEED_LENGTH);
  let str = '';
  for (let i = 0; i < SEED_LENGTH; i++) {
    str = ALPHABET[num % BASE] + str;
    num = Math.floor(num / BASE);
  }
  return str;
}

export function decodeSeed(str) {
  str = str.toUpperCase().slice(0, SEED_LENGTH);
  let num = 0;
  for (let i = 0; i < str.length; i++) {
    const idx = ALPHABET.indexOf(str[i]);
    if (idx === -1) continue; // skip invalid chars
    num = num * BASE + idx;
  }
  return num;
}

// ── Lookup tables ──

const AIRCRAFT_POOL = [
  'cessna_172',
  'boeing_737',
  'f16',
  'airbus_a320',
  'dhc2_beaver',
];

const AIRPORT_POOL = ['KFSA', 'KFSB', 'KFSI', 'KFSM', 'KFSG', 'KFSC'];

const WEATHER_OPTIONS = ['clear', 'overcast', 'rain', 'storm'];
const WEATHER_WEIGHTS = [0.6, 0.2, 0.15, 0.05]; // cumulative: 0.6, 0.8, 0.95, 1.0

function weightedPick(rng, options, weights) {
  const r = rng();
  let cumulative = 0;
  for (let i = 0; i < options.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return options[i];
  }
  return options[options.length - 1];
}

// ── Difficulty & scoring ──

function calcDifficulty(params) {
  let stars = 1;
  if (params.wind.speed > 15) stars++;
  if (params.weather === 'rain' || params.weather === 'storm') stars++;
  if (params.engineFailure) stars++;
  if (params.aircraft === 'airbus_a320' || params.aircraft === 'boeing_737') stars++;
  if (params.timeOfDay >= 20 || params.timeOfDay < 6) stars++;
  return Math.min(stars, 5);
}

function calcScoreMultiplier(stars) {
  return 1.0 + (stars - 1) * 0.5;
}

// ── Main generator ──

export function generateChallenge(seed) {
  // Resolve seed
  let numericSeed;
  let seedStr;

  if (typeof seed === 'string' && seed.length > 0) {
    seedStr = seed.toUpperCase().slice(0, SEED_LENGTH);
    numericSeed = decodeSeed(seedStr);
    seedStr = encodeSeed(numericSeed); // normalise
  } else {
    numericSeed = Date.now() % Math.pow(BASE, SEED_LENGTH);
    seedStr = encodeSeed(numericSeed);
  }

  const rng = mulberry32(numericSeed);

  // Aircraft
  const aircraft = AIRCRAFT_POOL[Math.floor(rng() * AIRCRAFT_POOL.length)];

  // Airport
  const airport = AIRPORT_POOL[Math.floor(rng() * AIRPORT_POOL.length)];

  // Wind
  const windSpeed = Math.round(rng() * 25);           // 0-25 kt
  const windDirection = Math.floor(rng() * 360);       // 0-359 deg

  // Weather (weighted)
  const weather = weightedPick(rng, WEATHER_OPTIONS, WEATHER_WEIGHTS);

  // Time of day — half-hour increments: 0, 0.5, 1, ... 23.5 (48 slots)
  const timeOfDay = Math.floor(rng() * 48) * 0.5;

  // Engine failure — 15% chance
  const engineFailure = rng() < 0.15;

  // Approach type — 50/50
  const approachType = rng() < 0.5 ? 'short_final' : 'long_final';

  // Build params object (without difficulty yet, needed for calc)
  const params = {
    seed: seedStr,
    aircraft,
    airport,
    wind: { speed: windSpeed, direction: windDirection },
    weather,
    timeOfDay,
    engineFailure,
    approachType,
    difficulty: 0,
    scoreMultiplier: 0,
  };

  params.difficulty = calcDifficulty(params);
  params.scoreMultiplier = calcScoreMultiplier(params.difficulty);

  return params;
}

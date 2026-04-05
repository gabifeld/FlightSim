let ctx;
let masterGain;
let engineOscs = [];
let engineGain;
let engineFilter;
let windNoise;
let windGain;
let windFilter;
let stallOsc;
let stallGain;
let rainNoise;
let rainGain;
let thunderBuffer = null;
let initialized = false;

// Wind rush (separate from wind — higher intensity, airspeed-driven)
let windRushSource;
let windRushGain;
let windRushFilter;

// Cockpit ambiance
let cockpitHumOsc;
let cockpitNoiseSource;
let cockpitGain;

// Creak throttle
let lastCreakTime = 0;

// Crosswind audio
let crosswindSource;
let crosswindFilter;
let crosswindGain;
let crosswindPanner;

// Airframe buffet rattle
let buffetSource;
let buffetFilter;
let buffetGain;
let currentBuffetIntensity = 0;

// Shared noise buffer (reused for fire-and-forget sounds)
let sharedNoiseBuffer = null;

function createNoiseBuffer(duration) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function getAudioContext() {
  return ctx;
}

export function initAudio() {
  if (initialized) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  initialized = true;

  // Master gain for global volume control — fade in to prevent click/pop
  masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(ctx.destination);
  masterGain.gain.setTargetAtTime(0.8, ctx.currentTime, 0.1);

  // Engine: smooth sine harmonics for warm drone (not harsh sawtooth)
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 400;
  engineFilter.Q.value = 0.7;
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);

  // Lower frequencies, sine waves for smooth engine sound
  const baseFreqs = [45, 90, 135];
  const oscGains = [0.6, 0.3, 0.15]; // fundamental loudest, harmonics quieter
  for (let i = 0; i < baseFreqs.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle'; // fundamental sine, harmonics triangle
    osc.frequency.value = baseFreqs[i];
    // Individual gain per harmonic
    const hGain = ctx.createGain();
    hGain.gain.value = oscGains[i];
    osc.connect(hGain);
    hGain.connect(engineFilter);
    osc.start();
    engineOscs.push(osc);
  }

  // Wind: looped white noise through bandpass
  windGain = ctx.createGain();
  windGain.gain.value = 0;
  windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 800;
  windFilter.Q.value = 0.5;

  const noiseBuffer = createNoiseBuffer(2);
  windNoise = ctx.createBufferSource();
  windNoise.buffer = noiseBuffer;
  windNoise.loop = true;
  windNoise.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(masterGain);
  windNoise.start();

  // Stall warning: 440 Hz square wave, gain-toggled (no LFO to avoid bleed)
  stallOsc = ctx.createOscillator();
  stallOsc.type = 'square';
  stallOsc.frequency.value = 440;

  stallGain = ctx.createGain();
  stallGain.gain.value = 0;

  stallOsc.connect(stallGain);
  stallGain.connect(masterGain);
  stallOsc.start();

  // Rain ambient (pink-ish noise, looped)
  rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  const rainFilter = ctx.createBiquadFilter();
  rainFilter.type = 'lowpass';
  rainFilter.frequency.value = 3000;
  rainFilter.Q.value = 0.3;

  const rainBuffer = createNoiseBuffer(3);
  rainNoise = ctx.createBufferSource();
  rainNoise.buffer = rainBuffer;
  rainNoise.loop = true;
  rainNoise.connect(rainFilter);
  rainFilter.connect(rainGain);
  rainGain.connect(masterGain);
  rainNoise.start();

  // Pre-allocate thunder noise buffer
  thunderBuffer = createNoiseBuffer(2);

  // Shared noise buffer for fire-and-forget sounds
  sharedNoiseBuffer = createNoiseBuffer(2);

  // Wind rush: bandpass-filtered noise, scales with airspeed
  windRushGain = ctx.createGain();
  windRushGain.gain.value = 0;
  windRushFilter = ctx.createBiquadFilter();
  windRushFilter.type = 'bandpass';
  windRushFilter.frequency.value = 200;
  windRushFilter.Q.value = 0.8;

  const windRushBuf = createNoiseBuffer(2);
  windRushSource = ctx.createBufferSource();
  windRushSource.buffer = windRushBuf;
  windRushSource.loop = true;
  windRushSource.connect(windRushFilter);
  windRushFilter.connect(windRushGain);
  windRushGain.connect(masterGain);
  windRushSource.start();

  // Cockpit ambiance: 60Hz hum + filtered noise at very low volume
  cockpitGain = ctx.createGain();
  cockpitGain.gain.value = 0;

  cockpitHumOsc = ctx.createOscillator();
  cockpitHumOsc.type = 'sine';
  cockpitHumOsc.frequency.value = 60;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.5;
  cockpitHumOsc.connect(humGain);
  humGain.connect(cockpitGain);
  cockpitHumOsc.start();

  const cockpitNoiseBuf = createNoiseBuffer(2);
  cockpitNoiseSource = ctx.createBufferSource();
  cockpitNoiseSource.buffer = cockpitNoiseBuf;
  cockpitNoiseSource.loop = true;
  const cockpitNoiseFilter = ctx.createBiquadFilter();
  cockpitNoiseFilter.type = 'lowpass';
  cockpitNoiseFilter.frequency.value = 400;
  cockpitNoiseFilter.Q.value = 0.5;
  const cockpitNoiseGain = ctx.createGain();
  cockpitNoiseGain.gain.value = 0.3;
  cockpitNoiseSource.connect(cockpitNoiseFilter);
  cockpitNoiseFilter.connect(cockpitNoiseGain);
  cockpitNoiseGain.connect(cockpitGain);
  cockpitNoiseSource.start();

  cockpitGain.connect(masterGain);

  // ── Crosswind audio: bandpass noise 400-1200Hz with stereo panning ────
  crosswindGain = ctx.createGain();
  crosswindGain.gain.value = 0;
  crosswindFilter = ctx.createBiquadFilter();
  crosswindFilter.type = 'bandpass';
  crosswindFilter.frequency.value = 800; // center of 400-1200Hz
  crosswindFilter.Q.value = 0.6;
  crosswindPanner = ctx.createStereoPanner();
  crosswindPanner.pan.value = 0;

  const crosswindBuf = createNoiseBuffer(2);
  crosswindSource = ctx.createBufferSource();
  crosswindSource.buffer = crosswindBuf;
  crosswindSource.loop = true;
  crosswindSource.connect(crosswindFilter);
  crosswindFilter.connect(crosswindGain);
  crosswindGain.connect(crosswindPanner);
  crosswindPanner.connect(masterGain);
  crosswindSource.start();

  // ── Airframe buffet rattle: low-frequency bandpass noise 80-150Hz ─────
  buffetGain = ctx.createGain();
  buffetGain.gain.value = 0;
  buffetFilter = ctx.createBiquadFilter();
  buffetFilter.type = 'bandpass';
  buffetFilter.frequency.value = 115; // center of 80-150Hz
  buffetFilter.Q.value = 3;

  const buffetBuf = createNoiseBuffer(2);
  buffetSource = ctx.createBufferSource();
  buffetSource.buffer = buffetBuf;
  buffetSource.loop = true;
  buffetSource.connect(buffetFilter);
  buffetFilter.connect(buffetGain);
  buffetGain.connect(masterGain);
  buffetSource.start();
}

export function updateAudio(state, dt, cameraMode) {
  if (!ctx || ctx.state === 'suspended') return;

  const now = ctx.currentTime;

  // Engine: smooth pitch and low volume from throttle
  const throttle = state.throttle;
  const pitchMul = 0.6 + throttle * 1.2;
  const baseFreqs = [45, 90, 135];
  for (let i = 0; i < engineOscs.length; i++) {
    engineOscs[i].frequency.setTargetAtTime(baseFreqs[i] * pitchMul, now, 0.15);
  }
  // Much quieter engine - subtle drone, not annoying buzz
  engineGain.gain.setTargetAtTime(0.02 + throttle * 0.1, now, 0.15);
  engineFilter.frequency.setTargetAtTime(200 + throttle * 600, now, 0.15);

  // Wind: gentler volume scaling from speed
  const speed = Number.isFinite(state.speed) ? state.speed : 0;
  const windVol = Math.min(speed / 120, 1.0) * 0.15;
  windGain.gain.setTargetAtTime(windVol, now, 0.2);
  windFilter.frequency.setTargetAtTime(600 + speed * 12, now, 0.2);

  // Wind rush: louder bandpass noise that scales with high airspeed
  if (windRushGain) {
    const speedFactor = Math.min(speed / 250, 1.0);
    windRushFilter.frequency.setTargetAtTime(200 + speedFactor * 2000, now, 0.1);
    windRushGain.gain.setTargetAtTime(speedFactor * 0.12, now, 0.15);
  }

  // Cockpit ambiance: audible only in cockpit camera mode
  if (cockpitGain) {
    const targetVol = cameraMode === 'cockpit' ? 0.03 : 0;
    cockpitGain.gain.setTargetAtTime(targetVol, now, 0.3);
  }

  // Stall warning (uses per-aircraft stallAoa)
  const stallAoa = (state.config && state.config.stallAoa) || 0.38; // fallback ~22deg
  const isStalling = Math.abs(state.aoa) > stallAoa && speed > 5;
  stallGain.gain.setTargetAtTime(isStalling ? 0.3 : 0, now, 0.05);

  // ── Crosswind audio ─────────────────────────────────────────────────
  if (crosswindGain && crosswindPanner && state.heading !== undefined) {
    // Compute perpendicular wind component relative to aircraft heading
    const windDir = state.windDirection || 0;   // radians, direction wind is FROM
    const windSpd = state.windSpeed || 0;       // m/s
    const heading = state.heading || 0;         // radians

    // Angle between wind direction and aircraft heading
    const relAngle = windDir - heading;
    // Perpendicular component (crosswind): sin of relative angle
    const crossComponent = Math.sin(relAngle) * windSpd;
    // Absolute crosswind intensity, normalized (assume max useful wind ~30 m/s)
    const crossIntensity = Math.min(Math.abs(crossComponent) / 30, 1.0);

    // Volume: 0 to 0.08
    crosswindGain.gain.setTargetAtTime(crossIntensity * 0.08, now, 0.2);

    // Stereo pan: wind from left = -0.5, wind from right = +0.5
    // crossComponent > 0 means wind from the right side
    const panValue = Math.max(-0.5, Math.min(0.5, crossComponent / 30));
    crosswindPanner.pan.setTargetAtTime(panValue, now, 0.1);

    // Shift filter frequency based on crosswind strength (400-1200Hz range)
    crosswindFilter.frequency.setTargetAtTime(400 + crossIntensity * 800, now, 0.2);
  }
}

export function setRainVolume(intensity) {
  if (!rainGain || !ctx) return;
  rainGain.gain.setTargetAtTime(intensity * 0.2, ctx.currentTime, 0.5);
}

export function setMasterVolume(volume) {
  if (masterGain) {
    masterGain.gain.value = volume;
  }
}

export function playThunder() {
  if (!ctx || !thunderBuffer) return;
  // Low-frequency rumble
  const source = ctx.createBufferSource();
  source.buffer = thunderBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(200, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 1.5);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.01, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start();
  source.stop(ctx.currentTime + 2.5);
}

function playNoiseBurst(duration, filterFreq, filterType, volume) {
  if (!ctx) return;
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(duration + 0.1);

  const filter = ctx.createBiquadFilter();
  filter.type = filterType || 'bandpass';
  filter.frequency.value = filterFreq;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume || 0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start();
  source.stop(ctx.currentTime + duration + 0.1);
}

export function playGearSound() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Low thunk (60Hz sine burst, 0.1s)
  const thunkOsc = ctx.createOscillator();
  thunkOsc.type = 'sine';
  thunkOsc.frequency.value = 60;
  const thunkGain = ctx.createGain();
  thunkGain.gain.setValueAtTime(0.3, now);
  thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  thunkOsc.connect(thunkGain);
  thunkGain.connect(masterGain);
  thunkOsc.start(now);
  thunkOsc.stop(now + 0.15);

  // Mechanical clunk (noise burst, 0.05s)
  playNoiseBurst(0.05, 500, 'bandpass', 0.25);

  // Original longer noise
  playNoiseBurst(0.5, 300, 'bandpass', 0.2);
}

export function playFlapSound() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Servo whine: rising sine 400 -> 800Hz, 0.3s
  const servoOsc = ctx.createOscillator();
  servoOsc.type = 'sine';
  servoOsc.frequency.setValueAtTime(400, now);
  servoOsc.frequency.linearRampToValueAtTime(800, now + 0.3);
  const servoGain = ctx.createGain();
  servoGain.gain.setValueAtTime(0.12, now);
  servoGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  servoOsc.connect(servoGain);
  servoGain.connect(masterGain);
  servoOsc.start(now);
  servoOsc.stop(now + 0.4);

  // Original noise
  playNoiseBurst(0.3, 800, 'bandpass', 0.15);
}

export function playTouchdownSound(intensity) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const vol = Math.min(intensity * 0.3, 0.5);

  // Tire chirp: highpass noise at 2000Hz, 0.15s
  const chirpSource = ctx.createBufferSource();
  chirpSource.buffer = createNoiseBuffer(0.2);
  const chirpFilter = ctx.createBiquadFilter();
  chirpFilter.type = 'highpass';
  chirpFilter.frequency.value = 2000;
  const chirpGain = ctx.createGain();
  chirpGain.gain.setValueAtTime(vol * 0.7, now);
  chirpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  chirpSource.connect(chirpFilter);
  chirpFilter.connect(chirpGain);
  chirpGain.connect(masterGain);
  chirpSource.start(now);
  chirpSource.stop(now + 0.2);

  // Original thump
  playNoiseBurst(0.2, 400, 'lowpass', vol);
}

export function playCrashSound() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Layer 1: Low rumble (40Hz sine, 0.3s)
  const rumbleOsc = ctx.createOscillator();
  rumbleOsc.type = 'sine';
  rumbleOsc.frequency.value = 40;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.4, now);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  rumbleOsc.connect(rumbleGain);
  rumbleGain.connect(masterGain);
  rumbleOsc.start(now);
  rumbleOsc.stop(now + 0.4);

  // Layer 2: Metal crunch (noise through highpass at 1000Hz, 0.2s)
  const crunchSource = ctx.createBufferSource();
  crunchSource.buffer = createNoiseBuffer(0.3);
  const crunchFilter = ctx.createBiquadFilter();
  crunchFilter.type = 'highpass';
  crunchFilter.frequency.value = 1000;
  const crunchGain = ctx.createGain();
  crunchGain.gain.setValueAtTime(0.4, now);
  crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  crunchSource.connect(crunchFilter);
  crunchFilter.connect(crunchGain);
  crunchGain.connect(masterGain);
  crunchSource.start(now);
  crunchSource.stop(now + 0.3);

  // Layer 3: Glass tinkle (sine 3000Hz, 0.1s)
  const glassOsc = ctx.createOscillator();
  glassOsc.type = 'sine';
  glassOsc.frequency.value = 3000;
  const glassGain = ctx.createGain();
  glassGain.gain.setValueAtTime(0.15, now + 0.05);
  glassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  glassOsc.connect(glassGain);
  glassGain.connect(masterGain);
  glassOsc.start(now + 0.05);
  glassOsc.stop(now + 0.2);

  // Layer 4: Overall impact noise (lowpass sweep for body)
  const impactSource = ctx.createBufferSource();
  impactSource.buffer = createNoiseBuffer(1);
  const impactFilter = ctx.createBiquadFilter();
  impactFilter.type = 'lowpass';
  impactFilter.frequency.setValueAtTime(2000, now);
  impactFilter.frequency.exponentialRampToValueAtTime(100, now + 0.8);
  const impactGain = ctx.createGain();
  impactGain.gain.setValueAtTime(0.4, now);
  impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  impactSource.connect(impactFilter);
  impactFilter.connect(impactGain);
  impactGain.connect(masterGain);
  impactSource.start(now);
  impactSource.stop(now + 1);
}

export function playCreakSound() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Structural creak: sawtooth 80-120Hz -> bandpass 200Hz Q=5, 0.5s decay
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 80 + Math.random() * 40;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 200;
  filter.Q.value = 5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.55);
}

export function canPlayCreak() {
  if (!ctx) return false;
  const now = ctx.currentTime;
  if (now - lastCreakTime < 2) return false;
  lastCreakTime = now;
  return true;
}

export function playExplosion() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Layer 1: Deep boom
  const boomOsc = ctx.createOscillator();
  boomOsc.type = 'sine';
  boomOsc.frequency.setValueAtTime(80, now);
  boomOsc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
  const boomGain = ctx.createGain();
  boomGain.gain.setValueAtTime(0.5, now);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  boomOsc.connect(boomGain);
  boomGain.connect(masterGain);
  boomOsc.start(now);
  boomOsc.stop(now + 0.9);

  // Layer 2: Crackle (filtered noise)
  const crackleSource = ctx.createBufferSource();
  crackleSource.buffer = createNoiseBuffer(1.0);
  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'bandpass';
  crackleFilter.frequency.value = 1200;
  crackleFilter.Q.value = 1;
  const crackleGain = ctx.createGain();
  crackleGain.gain.setValueAtTime(0.4, now);
  crackleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  crackleSource.connect(crackleFilter);
  crackleFilter.connect(crackleGain);
  crackleGain.connect(masterGain);
  crackleSource.start(now);
  crackleSource.stop(now + 1.0);

  // Layer 3: Rumble tail
  const rumbleSource = ctx.createBufferSource();
  rumbleSource.buffer = createNoiseBuffer(2.0);
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 200;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0, now);
  rumbleGain.gain.linearRampToValueAtTime(0.25, now + 0.1);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
  rumbleSource.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(masterGain);
  rumbleSource.start(now);
  rumbleSource.stop(now + 2.0);
}

export function playMissileLaunch() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Layer 1: Whoosh — rising filtered noise
  const whooshSource = ctx.createBufferSource();
  whooshSource.buffer = createNoiseBuffer(0.8);
  const whooshFilter = ctx.createBiquadFilter();
  whooshFilter.type = 'bandpass';
  whooshFilter.frequency.setValueAtTime(800, now);
  whooshFilter.frequency.exponentialRampToValueAtTime(3000, now + 0.3);
  whooshFilter.Q.value = 2;
  const whooshGain = ctx.createGain();
  whooshGain.gain.setValueAtTime(0.4, now);
  whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  whooshSource.connect(whooshFilter);
  whooshFilter.connect(whooshGain);
  whooshGain.connect(masterGain);
  whooshSource.start(now);
  whooshSource.stop(now + 0.8);

  // Layer 2: Ignition thump — low sine pop
  const thumpOsc = ctx.createOscillator();
  thumpOsc.type = 'sine';
  thumpOsc.frequency.setValueAtTime(120, now);
  thumpOsc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.35, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  thumpOsc.connect(thumpGain);
  thumpGain.connect(masterGain);
  thumpOsc.start(now);
  thumpOsc.stop(now + 0.25);

  // Layer 3: Rocket hiss — high frequency noise tail
  const hissSource = ctx.createBufferSource();
  hissSource.buffer = createNoiseBuffer(1.5);
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'highpass';
  hissFilter.frequency.value = 4000;
  const hissGain = ctx.createGain();
  hissGain.gain.setValueAtTime(0, now);
  hissGain.gain.linearRampToValueAtTime(0.15, now + 0.1);
  hissGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  hissSource.connect(hissFilter);
  hissFilter.connect(hissGain);
  hissGain.connect(masterGain);
  hissSource.start(now);
  hissSource.stop(now + 1.5);
}

export function playAPDisconnect() {
  if (!ctx) return;
  // Two quick descending tones
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.3);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
}

// ── New exports: Gust sound, Buffet intensity ───────────────────────────────

/**
 * Play a short wind gust noise burst. Fire-and-forget.
 * @param {number} intensity - 0..1 gust strength
 */
export function playGustSound(intensity) {
  if (!ctx || !masterGain || intensity <= 0) return;
  const now = ctx.currentTime;

  // Short 0.2s noise burst, bandpass 200-800Hz, sharp attack, 0.3s exponential decay
  const source = ctx.createBufferSource();
  source.buffer = sharedNoiseBuffer || createNoiseBuffer(0.6);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 500; // center of 200-800Hz
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  const vol = Math.min(intensity, 1.0) * 0.12;
  // Sharp attack: ramp to full volume in 0.01s
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.01);
  // Exponential decay over 0.3s
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(now);
  source.stop(now + 0.5);
}

/**
 * Set airframe buffet rattle intensity. Driven by flight model buffet state.
 * @param {number} intensity - 0..1, 0 = silence, 1 = full rattle
 */
export function setBuffetIntensity(intensity) {
  if (!ctx || !buffetGain) return;
  const now = ctx.currentTime;
  const clamped = Math.max(0, Math.min(1, intensity));
  currentBuffetIntensity = clamped;

  if (clamped > 0) {
    // Continuous bandpass noise at volume = intensity * 0.06
    buffetGain.gain.setTargetAtTime(clamped * 0.06, now, 0.05);
  } else {
    // Fade to silence over 0.3s
    buffetGain.gain.setTargetAtTime(0, now, 0.3);
  }
}

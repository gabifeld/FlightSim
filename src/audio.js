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

  // Master gain for global volume control
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(ctx.destination);

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
  const speed = state.speed;
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

// Flight replay system with ring buffer recording + playback
import * as THREE from 'three';
import { getActiveVehicle } from './vehicleState.js';
import { setReplayCameraMode } from './camera.js';

const FPS = 15;                       // Recording framerate
const DURATION = 300;                 // 5 minutes max
const MAX_FRAMES = FPS * DURATION;    // 4500 frames
const FRAME_SIZE = 46;                // bytes per frame

// Ring buffer storage
let buffer = null;
let view = null;
let writeIndex = 0;
let frameCount = 0;
let recordTimer = 0;
const RECORD_INTERVAL = 1 / FPS;

// Playback state
let playing = false;
let playIndex = 0;
let playSpeed = 1.0;
let playTimer = 0;
let playPaused = false;

// Saved state for restore after replay
let savedState = null;
const _frameA = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  velocity: new THREE.Vector3(),
  throttle: 0,
  flags: 0,
};
const _frameB = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  velocity: new THREE.Vector3(),
  throttle: 0,
  flags: 0,
};

function init() {
  buffer = new ArrayBuffer(MAX_FRAMES * FRAME_SIZE);
  view = new DataView(buffer);
  writeIndex = 0;
  frameCount = 0;
  recordTimer = 0;
}

// Write a frame: position(12) + quaternion(16) + velocity(12) + throttle(4) + flags(2) = 46 bytes
function writeFrame() {
  const offset = writeIndex * FRAME_SIZE;
  const s = getActiveVehicle();

  // Position (3 floats = 12 bytes)
  view.setFloat32(offset, s.position.x, true);
  view.setFloat32(offset + 4, s.position.y, true);
  view.setFloat32(offset + 8, s.position.z, true);

  // Quaternion (4 floats = 16 bytes)
  view.setFloat32(offset + 12, s.quaternion.x, true);
  view.setFloat32(offset + 16, s.quaternion.y, true);
  view.setFloat32(offset + 20, s.quaternion.z, true);
  view.setFloat32(offset + 24, s.quaternion.w, true);

  // Velocity (3 floats = 12 bytes)
  view.setFloat32(offset + 28, s.velocity.x, true);
  view.setFloat32(offset + 32, s.velocity.y, true);
  view.setFloat32(offset + 36, s.velocity.z, true);

  // Throttle (1 float = 4 bytes)
  view.setFloat32(offset + 40, s.throttle, true);

  // Flags (2 bytes): gear, flaps, speedbrake, onGround
  let flags = 0;
  if (s.gear) flags |= 1;
  if (s.flaps) flags |= 2;
  if (s.speedbrake) flags |= 4;
  if (s.onGround) flags |= 8;
  view.setUint16(offset + 44, flags, true);

  writeIndex = (writeIndex + 1) % MAX_FRAMES;
  if (frameCount < MAX_FRAMES) frameCount++;
}

function readFrameInto(index, out) {
  const actualIndex = (writeIndex - frameCount + index + MAX_FRAMES) % MAX_FRAMES;
  const offset = actualIndex * FRAME_SIZE;

  out.position.set(
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true)
  );
  out.quaternion.set(
    view.getFloat32(offset + 12, true),
    view.getFloat32(offset + 16, true),
    view.getFloat32(offset + 20, true),
    view.getFloat32(offset + 24, true)
  );
  out.velocity.set(
    view.getFloat32(offset + 28, true),
    view.getFloat32(offset + 32, true),
    view.getFloat32(offset + 36, true)
  );
  out.throttle = view.getFloat32(offset + 40, true);
  out.flags = view.getUint16(offset + 44, true);
  return out;
}

export function initReplay() {
  init();
}

export function updateRecording(dt) {
  if (playing) return;
  if (!buffer) init();

  recordTimer += dt;
  if (recordTimer >= RECORD_INTERVAL) {
    recordTimer -= RECORD_INTERVAL;
    writeFrame();
  }
}

export function startReplay() {
  if (frameCount < 2) return false;

  // Save current state
  savedState = {
    position: getActiveVehicle().position.clone(),
    quaternion: getActiveVehicle().quaternion.clone(),
    velocity: getActiveVehicle().velocity.clone(),
    throttle: getActiveVehicle().throttle,
    gear: getActiveVehicle().gear,
    flaps: getActiveVehicle().flaps,
    speedbrake: getActiveVehicle().speedbrake,
    onGround: getActiveVehicle().onGround,
  };

  playing = true;
  playIndex = 0;
  playSpeed = 1.0;
  playTimer = 0;
  playPaused = false;
  setReplayCameraMode(true);
  return true;
}

export function stopReplay() {
  playing = false;
  setReplayCameraMode(false);

  // Restore saved state
  if (savedState) {
    getActiveVehicle().position.copy(savedState.position);
    getActiveVehicle().quaternion.copy(savedState.quaternion);
    getActiveVehicle().velocity.copy(savedState.velocity);
    getActiveVehicle().throttle = savedState.throttle;
    getActiveVehicle().gear = savedState.gear;
    getActiveVehicle().flaps = savedState.flaps;
    getActiveVehicle().speedbrake = savedState.speedbrake;
    getActiveVehicle().onGround = savedState.onGround;
    savedState = null;
  }
}

export function toggleReplay() {
  if (playing) {
    stopReplay();
    return false;
  }
  return startReplay();
}

export function updateReplay(dt) {
  if (!playing || playPaused) return;

  playTimer += dt * playSpeed;

  while (playTimer >= RECORD_INTERVAL && playIndex < frameCount - 1) {
    playTimer -= RECORD_INTERVAL;
    playIndex++;
  }

  // Clamp to end
  if (playIndex >= frameCount - 1) {
    playIndex = frameCount - 1;
    playPaused = true;
  }

  // Interpolate between current and next frame
  const t = playTimer / RECORD_INTERVAL;
  const frame = readFrameInto(playIndex, _frameA);
  const nextIdx = Math.min(playIndex + 1, frameCount - 1);
  const nextFrame = readFrameInto(nextIdx, _frameB);

  // Lerp position
  getActiveVehicle().position.lerpVectors(frame.position, nextFrame.position, t);

  // Slerp quaternion
  getActiveVehicle().quaternion.copy(frame.quaternion).slerp(nextFrame.quaternion, t);

  // Lerp velocity
  getActiveVehicle().velocity.lerpVectors(frame.velocity, nextFrame.velocity, t);

  // Throttle
  getActiveVehicle().throttle = frame.throttle + (nextFrame.throttle - frame.throttle) * t;

  // Flags from current frame
  getActiveVehicle().gear = !!(frame.flags & 1);
  getActiveVehicle().flaps = !!(frame.flags & 2);
  getActiveVehicle().speedbrake = !!(frame.flags & 4);
  getActiveVehicle().onGround = !!(frame.flags & 8);
}

export function setReplaySpeed(speed) {
  playSpeed = Math.max(0.25, Math.min(4, speed));
}

export function scrubReplay(delta) {
  if (!playing) return;
  playIndex = Math.max(0, Math.min(frameCount - 1, playIndex + delta));
  playTimer = 0;
  playPaused = false;
}

export function toggleReplayPause() {
  if (!playing) return;
  playPaused = !playPaused;
}

export function isReplayPlaying() {
  return playing;
}

export function getReplayState() {
  return {
    playing,
    paused: playPaused,
    currentFrame: playIndex,
    totalFrames: frameCount,
    speed: playSpeed,
    progress: frameCount > 0 ? playIndex / frameCount : 0,
    timeSeconds: playIndex / FPS,
    totalSeconds: frameCount / FPS,
  };
}

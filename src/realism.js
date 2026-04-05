// Adaptive difficulty — lite vs study realism profiles
import { getSetting } from './settings.js';

export const REALISM_PROFILES = {
  lite: {
    spinAutoRecovery: true,
    spinRecoveryTime: 3.0,
    wingDropIntensity: 0.5,
    vmcEnabled: false,
    gLimitStructural: 15,
    gBlackoutThreshold: Infinity,
    gVignetteOnset: 7,
    gTunnelVision: 9,
    gRedoutThreshold: -4,
    cameraShakeScale: 0.5,
  },
  study: {
    spinAutoRecovery: false,
    spinRecoveryTime: Infinity,
    wingDropIntensity: 1.0,
    vmcEnabled: true,
    gLimitStructural: 9,
    gBlackoutThreshold: 9,
    gVignetteOnset: 4.5,
    gTunnelVision: 6,
    gRedoutThreshold: -2.5,
    cameraShakeScale: 1.0,
  },
};

export function getRealism() {
  const mode = getSetting('realism') || 'lite';
  return REALISM_PROFILES[mode] || REALISM_PROFILES.lite;
}

export function isStudy() {
  return (getSetting('realism') || 'lite') === 'study';
}

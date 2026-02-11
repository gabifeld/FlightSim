import { getSetting } from './settings.js';

const FRAME_HISTORY = 20000;
const frameTimesMs = new Float32Array(FRAME_HISTORY);

let rendererRef = null;
let enabled = true;
let frameWriteIndex = 0;
let frameCount = 0;
let routeLabel = null;
let routeStartMs = 0;
let routeStartHeapMB = null;
let routePeakHeapMB = null;
let overlayEl = null;
let overlayUpdateTimer = 0;
let recentFps = 0;
let recentFrameMs = 0;

function getSortedFrameTimes() {
  const count = Math.min(frameCount, FRAME_HISTORY);
  const values = new Array(count);
  for (let i = 0; i < count; i++) values[i] = frameTimesMs[i];
  values.sort((a, b) => a - b);
  return values;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function getHeapUsedMB() {
  if (typeof performance !== 'undefined' && performance.memory && performance.memory.usedJSHeapSize) {
    return performance.memory.usedJSHeapSize / (1024 * 1024);
  }
  return null;
}

export function initPerfProbe(renderer) {
  rendererRef = renderer;
  overlayEl = document.getElementById('perf-overlay');
  if (overlayEl && getSetting('showFPS')) {
    overlayEl.style.display = 'block';
  }
  if (typeof window !== 'undefined') {
    window.FlightSimPerf = {
      setEnabled: setPerfProbeEnabled,
      report: getPerfReport,
      startRoute: startPerfRoute,
      endRoute: endPerfRoute,
    };
  }
}

export function setPerfProbeEnabled(value) {
  enabled = !!value;
}

export function updatePerfProbe(dt) {
  if (!enabled) return;
  const ms = dt * 1000;
  frameTimesMs[frameWriteIndex] = ms;
  frameWriteIndex = (frameWriteIndex + 1) % FRAME_HISTORY;
  frameCount = Math.min(frameCount + 1, FRAME_HISTORY);

  if (routeLabel) {
    const heap = getHeapUsedMB();
    if (heap !== null) {
      if (routePeakHeapMB === null || heap > routePeakHeapMB) routePeakHeapMB = heap;
      if (routeStartHeapMB === null) routeStartHeapMB = heap;
    }
  }

  // Update FPS overlay every ~500ms
  overlayUpdateTimer += dt;
  if (overlayEl && overlayUpdateTimer >= 0.5) {
    overlayUpdateTimer = 0;
    recentFps = ms > 0 ? 1000 / ms : 0;
    // Smooth FPS display using last 30 frames
    const count = Math.min(frameCount, 30);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const idx = (frameWriteIndex - 1 - i + FRAME_HISTORY) % FRAME_HISTORY;
      sum += frameTimesMs[idx];
    }
    recentFrameMs = count > 0 ? sum / count : ms;
    const avgFps = recentFrameMs > 0 ? 1000 / recentFrameMs : 0;
    const draws = rendererRef ? rendererRef.info.render.calls : 0;
    const tris = rendererRef ? rendererRef.info.render.triangles : 0;
    if (overlayEl.style.display !== 'none') {
      overlayEl.textContent = `${avgFps.toFixed(0)} FPS | ${recentFrameMs.toFixed(1)}ms | ${draws} draws | ${(tris / 1000).toFixed(0)}K tris`;
    }
  }
}

export function getPerfReport() {
  const sorted = getSortedFrameTimes();
  const med = median(sorted);
  const p95 = percentile(sorted, 0.95);
  const worst = percentile(sorted, 0.999);
  const fpsMedian = med > 0 ? 1000 / med : 0;
  const drawCalls = rendererRef ? rendererRef.info.render.calls : null;
  const heapMB = getHeapUsedMB();

  return {
    samples: sorted.length,
    frameTimeMs: {
      median: Number(med.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      worst: Number(worst.toFixed(2)),
    },
    fpsMedian: Number(fpsMedian.toFixed(1)),
    drawCalls,
    heapUsedMB: heapMB === null ? null : Number(heapMB.toFixed(1)),
    route: routeLabel,
  };
}

export function startPerfRoute(label = 'route') {
  routeLabel = label;
  routeStartMs = performance.now();
  routeStartHeapMB = getHeapUsedMB();
  routePeakHeapMB = routeStartHeapMB;
}

export function endPerfRoute() {
  const elapsedMs = routeStartMs > 0 ? performance.now() - routeStartMs : 0;
  const report = getPerfReport();
  const heapEnd = getHeapUsedMB();
  const heapDelta = routeStartHeapMB !== null && heapEnd !== null ? heapEnd - routeStartHeapMB : null;
  const peakDelta = routeStartHeapMB !== null && routePeakHeapMB !== null ? routePeakHeapMB - routeStartHeapMB : null;
  routeLabel = null;
  routeStartMs = 0;
  routeStartHeapMB = null;
  routePeakHeapMB = null;
  return {
    ...report,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    heapDeltaMB: heapDelta === null ? null : Number(heapDelta.toFixed(2)),
    peakHeapDeltaMB: peakDelta === null ? null : Number(peakDelta.toFixed(2)),
  };
}

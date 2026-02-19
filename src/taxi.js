import * as THREE from 'three';
import { RUNWAY_WIDTH, RUNWAY_LENGTH, AIRPORT2_X, AIRPORT2_Z } from './constants.js';

// Taxiway network - graph of waypoints
const TAXI_NODES = [
  // Runway exits (along runway centerline Z-axis)
  { id: 'rwy_n', x: 0, z: -600 },
  { id: 'rwy_mid', x: 0, z: 0 },
  { id: 'rwy_s', x: 0, z: 600 },

  // Parallel taxiway (100m east of runway)
  { id: 'tw_n', x: RUNWAY_WIDTH / 2 + 100, z: -600 },
  { id: 'tw_mid_n', x: RUNWAY_WIDTH / 2 + 100, z: -200 },
  { id: 'tw_mid', x: RUNWAY_WIDTH / 2 + 100, z: 0 },
  { id: 'tw_mid_s', x: RUNWAY_WIDTH / 2 + 100, z: 200 },
  { id: 'tw_s', x: RUNWAY_WIDTH / 2 + 100, z: 600 },

  // Exit taxiway connections (perpendicular connectors)
  { id: 'exit_n', x: RUNWAY_WIDTH / 2 + 10, z: -600 },
  { id: 'exit_mid', x: RUNWAY_WIDTH / 2 + 10, z: 0 },
  { id: 'exit_s', x: RUNWAY_WIDTH / 2 + 10, z: 600 },

  // Apron / gate area
  { id: 'apron_n', x: RUNWAY_WIDTH / 2 + 250, z: -80 },
  { id: 'apron_mid', x: RUNWAY_WIDTH / 2 + 250, z: 0 },
  { id: 'apron_s', x: RUNWAY_WIDTH / 2 + 250, z: 80 },

  // Gates
  { id: 'gate_1', x: RUNWAY_WIDTH / 2 + 310, z: -60 },
  { id: 'gate_2', x: RUNWAY_WIDTH / 2 + 310, z: -20 },
  { id: 'gate_3', x: RUNWAY_WIDTH / 2 + 310, z: 20 },
  { id: 'gate_4', x: RUNWAY_WIDTH / 2 + 310, z: 60 },
];

const TAXI_EDGES = [
  // Runway to exit taxiways
  ['rwy_n', 'exit_n'],
  ['rwy_mid', 'exit_mid'],
  ['rwy_s', 'exit_s'],

  // Exit taxiways to parallel taxiway
  ['exit_n', 'tw_n'],
  ['exit_mid', 'tw_mid'],
  ['exit_s', 'tw_s'],

  // Parallel taxiway segments
  ['tw_n', 'tw_mid_n'],
  ['tw_mid_n', 'tw_mid'],
  ['tw_mid', 'tw_mid_s'],
  ['tw_mid_s', 'tw_s'],

  // Parallel taxiway to apron
  ['tw_mid_n', 'apron_n'],
  ['tw_mid', 'apron_mid'],
  ['tw_mid_s', 'apron_s'],

  // Apron connections
  ['apron_n', 'apron_mid'],
  ['apron_mid', 'apron_s'],

  // Apron to gates
  ['apron_n', 'gate_1'],
  ['apron_n', 'gate_2'],
  ['apron_s', 'gate_3'],
  ['apron_s', 'gate_4'],
];

// Build adjacency map
const adjacency = {};
for (const node of TAXI_NODES) {
  adjacency[node.id] = [];
}
for (const [a, b] of TAXI_EDGES) {
  adjacency[a].push(b);
  adjacency[b].push(a);
}

const nodeMap = {};
for (const n of TAXI_NODES) {
  nodeMap[n.id] = n;
}

export function getTaxiwayNetwork() {
  return { nodes: TAXI_NODES, edges: TAXI_EDGES, nodeMap };
}

export function getNearestTaxiNode(x, z) {
  let nearest = null;
  let minDist = Infinity;
  for (const node of TAXI_NODES) {
    const dx = node.x - x;
    const dz = node.z - z;
    const dist = dx * dx + dz * dz;
    if (dist < minDist) {
      minDist = dist;
      nearest = node;
    }
  }
  return nearest;
}

function isOnTaxiwayAt(x, z, ox, oz) {
  const halfWid = RUNWAY_WIDTH / 2;
  const lx = x - ox;
  const lz = z - oz;
  // On parallel taxiway
  const txX = halfWid + 100;
  if (Math.abs(lx - txX) < 12 && Math.abs(lz) < 700) return true;
  // On exit taxiways
  for (const tz of [-600, 0, 600]) {
    if (Math.abs(lz - tz) < 12 && lx > halfWid - 5 && lx < txX + 15) return true;
  }
  // On apron
  const apronX = halfWid + 250;
  if (Math.abs(lx - apronX) < 80 && Math.abs(lz) < 120) return true;
  return false;
}

export function isOnTaxiway(x, z) {
  return isOnTaxiwayAt(x, z, 0, 0) || isOnTaxiwayAt(x, z, AIRPORT2_X, AIRPORT2_Z);
}

// Simple BFS pathfinding
export function getTaxiRoute(fromId, toId) {
  if (!adjacency[fromId] || !adjacency[toId]) return [];

  const visited = new Set();
  const queue = [[fromId, [fromId]]];
  visited.add(fromId);

  while (queue.length > 0) {
    const [current, path] = queue.shift();
    if (current === toId) {
      return path.map(id => nodeMap[id]);
    }
    for (const neighbor of adjacency[current]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }
  return [];
}

// Taxi guidance lights (visual green lights along route)
let guideLights = [];
let guideLightGroup = null;

export function initTaxiGuidance(scene) {
  guideLightGroup = new THREE.Group();
  const lightGeo = new THREE.BoxGeometry(0.3, 0.15, 0.3);
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 1.5,
  });

  // Pre-create pool of guide lights
  for (let i = 0; i < 40; i++) {
    const light = new THREE.Mesh(lightGeo, lightMat);
    light.visible = false;
    guideLightGroup.add(light);
    guideLights.push(light);
  }

  scene.add(guideLightGroup);
}

export function updateTaxiGuidance(route, aircraftX, aircraftZ) {
  // Hide all first
  for (const l of guideLights) l.visible = false;

  if (!route || route.length < 2) return;

  let lightIdx = 0;
  for (let i = 0; i < route.length - 1 && lightIdx < guideLights.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.min(Math.floor(dist / 15), 8);

    for (let s = 0; s <= steps && lightIdx < guideLights.length; s++) {
      const t = s / Math.max(steps, 1);
      const lx = a.x + dx * t;
      const lz = a.z + dz * t;

      // Only show lights ahead of aircraft (within 200m)
      const distToAircraft = Math.sqrt(
        (lx - aircraftX) ** 2 + (lz - aircraftZ) ** 2
      );
      if (distToAircraft < 200) {
        guideLights[lightIdx].position.set(lx, 0.1, lz);
        guideLights[lightIdx].visible = true;
        lightIdx++;
      }
    }
  }
}

export let taxiMode = false;

export function updateTaxiMode(onGround, speed, x, z) {
  taxiMode = onGround && speed < 15.4 && (isOnTaxiway(x, z) || isOnRunway(x, z));
  return taxiMode;
}

function isOnRunway(x, z) {
  if (Math.abs(x) < RUNWAY_WIDTH / 2 && Math.abs(z) < RUNWAY_LENGTH / 2) return true;
  if (Math.abs(x - AIRPORT2_X) < RUNWAY_WIDTH / 2 && Math.abs(z - AIRPORT2_Z) < RUNWAY_LENGTH / 2) return true;
  if (_isOnIntlRunway && _isOnIntlRunway(x, z)) return true;
  if (_isOnIntlTaxiway && _isOnIntlTaxiway(x, z)) return true;
  return false;
}

let _isOnIntlRunway = null;
let _isOnIntlTaxiway = null;
export function registerIntlTaxiChecks(runwayFn, taxiwayFn) {
  _isOnIntlRunway = runwayFn;
  _isOnIntlTaxiway = taxiwayFn;
}

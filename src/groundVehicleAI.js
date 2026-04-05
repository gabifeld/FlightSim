// Airport ground vehicle AI — waypoint following on taxiway network
import * as THREE from 'three';
import { getTaxiwayNetwork, getNearestTaxiNode } from './taxi.js';
import { getGroundLevel } from './terrain.js';
import { clamp } from './utils.js';
import { createGroundVehicleState, registerVehicle, isGroundVehicle, getAllVehicles, getActiveVehicle } from './vehicleState.js';
import { getGroundVehicleType } from './vehicleTypes.js';
import { buildGroundVehicleModel } from './carGeometry.js';
import { getWeatherState } from './weather.js';
import { AIRPORT2_X, AIRPORT2_Z } from './constants.js';

const _forward = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

let sceneRef = null;
const aiVehicles = []; // { state, model, route, routeIdx, waitTimer }

// Emergency response
let emergencyPos = null;
let emergencyActive = false;

// Windsocks
const windsocks = [];

// Airport announcements
let announcementTimer = 45 + Math.random() * 75;
const ANNOUNCEMENTS = [
  'Attention passengers, flight 247 to Denver now boarding at gate 2',
  'Ground crew, pushback required at gate 1',
  'Caution, vehicle crossing runway 36',
  'Passenger Smith, please report to gate 3',
  'Flight 182 from Chicago has arrived at gate 4',
  'All personnel, FOD walk scheduled in 30 minutes',
  'Attention, wind check: winds variable at 10 knots',
  'Ground crew, fuel truck requested at gate 2',
];

// Idle waypoints where vehicles park when not moving
const IDLE_NODES = ['gate_1', 'gate_2', 'gate_3', 'gate_4'];
// Patrol route endpoints
const PATROL_NODES = ['apron_n', 'apron_s', 'tw_n', 'tw_s'];
const RUNWAY_NODES = new Set(['rwy_n', 'rwy_mid', 'rwy_s']);

// Build adjacency map from network edges
let adjacency = null;
function getAdjacency(network) {
  if (adjacency) return adjacency;
  adjacency = {};
  for (const n of network.nodes) adjacency[n.id] = [];
  for (const [a, b] of network.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

function findPath(network, fromId, toId) {
  const adj = getAdjacency(network);
  const queue = [[fromId]];
  const visited = new Set([fromId]);

  while (queue.length > 0) {
    const path = queue.shift();
    const node = path[path.length - 1];

    if (node === toId) return path;

    for (const next of (adj[node] || [])) {
      if (!visited.has(next) && !RUNWAY_NODES.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

function getNodePos(network, nodeId) {
  const node = network.nodeMap[nodeId];
  return node ? new THREE.Vector3(node.x, 0, node.z) : null;
}

function pickRandomNode(nodes, exclude) {
  const filtered = nodes.filter(n => n !== exclude);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

// Find nearest network node to a world position
function findNearestNode(network, pos) {
  let nearest = null;
  let minDist = Infinity;
  for (const n of network.nodes) {
    const dx = n.x - pos.x;
    const dz = n.z - pos.z;
    const dist = dx * dx + dz * dz;
    if (dist < minDist) {
      minDist = dist;
      nearest = n.id;
    }
  }
  return nearest;
}

// Windsock positions near runway thresholds
const WINDSOCK_POSITIONS = [
  { x: 25, z: -650 },      // Airport 1 north
  { x: 25, z: 650 },       // Airport 1 south
  { x: 8025, z: -8650 },   // Airport 2 north
  { x: 8025, z: -7350 },   // Airport 2 south
  { x: -5025, z: -11250 }, // Military north
  { x: 5025, z: 11600 },   // GA south
];

export function triggerEmergencyResponse(pos) {
  emergencyPos = pos ? new THREE.Vector3(pos.x, pos.y, pos.z) : null;
  emergencyActive = !!pos;
}

export function resetEmergency() {
  emergencyPos = null;
  emergencyActive = false;
}

export function initGroundVehicleAI(scene) {
  sceneRef = scene;

  const network = getTaxiwayNetwork();
  if (!network || !network.nodeMap) return;

  // Spawn 8 ground vehicles
  const types = ['tow_truck', 'fuel_truck', 'stairs_truck', 'baggage_cart', 'catering_truck', 'fire_truck', 'pushback_tug', 'pax_bus'];
  const startNodes = ['gate_1', 'gate_2', 'gate_3', 'gate_4', 'apron_n', 'apron_s', 'tw_n', 'tw_s'];

  for (let i = 0; i < types.length; i++) {
    const typeName = types[i];
    const nodeId = startNodes[i];
    const node = network.nodeMap[nodeId];
    if (!node) continue;

    const state = createGroundVehicleState();
    const cfg = getGroundVehicleType(typeName);
    state.config = cfg;
    state.currentType = typeName;
    state.position.set(node.x, getGroundLevel(node.x, node.z) + 0.4, node.z);
    state.heading = 0;
    state.quaternion.identity();
    registerVehicle(state);

    const { group, beacon } = buildGroundVehicleModel(typeName);
    group.position.copy(state.position);
    group.quaternion.copy(state.quaternion);
    scene.add(group);

    aiVehicles.push({
      state,
      group,
      beacon,
      currentNode: nodeId,
      route: null,
      routeIdx: 0,
      waitTimer: 3 + Math.random() * 5, // initial wait before moving
      targetPos: null,
    });
  }

  // Create windsocks
  for (const wsPos of WINDSOCK_POSITIONS) {
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(wsPos.x, getGroundLevel(wsPos.x, wsPos.z) + 2, wsPos.z);
    scene.add(pole);

    const coneGeo = new THREE.ConeGeometry(0.3, 1.2, 8);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.2 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(wsPos.x, getGroundLevel(wsPos.x, wsPos.z) + 3.8, wsPos.z);
    cone.rotation.z = Math.PI / 2; // horizontal by default
    scene.add(cone);

    windsocks.push({ pole, cone });
  }
}

export function updateGroundVehicleAI(dt) {
  const network = getTaxiwayNetwork();
  if (!network || !network.nodeMap) return;

  for (const v of aiVehicles) {
    const state = v.state;
    const cfg = state.config;
    if (!cfg) continue;

    // Emergency response: reroute fire trucks
    if (emergencyActive && emergencyPos && state.currentType === 'fire_truck') {
      const nearestNode = findNearestNode(network, emergencyPos);
      if (nearestNode && nearestNode !== v.currentNode) {
        const path = findPath(network, v.currentNode, nearestNode);
        if (path && path.length > 1) {
          v.route = path;
          v.routeIdx = 1;
          v.targetPos = getNodePos(network, v.route[v.routeIdx]);
          v.waitTimer = 0; // no waiting during emergency
        }
      }
    }

    // Waiting at a node
    if (v.waitTimer > 0) {
      v.waitTimer -= dt;
      // Pulse beacon
      if (v.beacon) {
        v.beacon.material.emissiveIntensity = 0.4 + Math.sin(performance.now() * 0.005) * 0.4;
      }
      v.group.position.copy(state.position);
      v.group.quaternion.copy(state.quaternion);
      continue;
    }

    // Need a new route?
    if (!v.route || v.routeIdx >= v.route.length) {
      const dest = pickRandomNode(PATROL_NODES, v.currentNode);
      const path = findPath(network, v.currentNode, dest);
      if (path && path.length > 1) {
        v.route = path;
        v.routeIdx = 1; // skip current node
        v.targetPos = getNodePos(network, v.route[v.routeIdx]);
      } else {
        v.waitTimer = 2 + Math.random() * 4;
        continue;
      }
    }

    // Drive toward current target node
    if (v.targetPos) {
      _toTarget.subVectors(v.targetPos, state.position);
      _toTarget.y = 0;
      const dist = _toTarget.length();

      // Emergency speed override for fire truck
      const effectiveMaxSpeed = (emergencyActive && state.currentType === 'fire_truck') ? 15 : cfg.maxSpeed;

      if (dist < 2) {
        // Arrived at node
        v.currentNode = v.route[v.routeIdx];
        v.routeIdx++;

        // Check if fire truck arrived near emergency
        if (emergencyActive && emergencyPos && state.currentType === 'fire_truck') {
          const distToEmergency = state.position.distanceTo(emergencyPos);
          if (distToEmergency < 15) {
            emergencyPos = null;
            emergencyActive = false;
          }
        }

        if (v.routeIdx >= v.route.length) {
          // Route complete, wait and pick new route
          v.route = null;
          v.waitTimer = 3 + Math.random() * 8;
          state.speed = 0;
          state.velocity.set(0, 0, 0);
          v.group.position.copy(state.position);
          continue;
        }
        v.targetPos = getNodePos(network, v.route[v.routeIdx]);
      }

      // Steer toward target
      const targetAngle = Math.atan2(-_toTarget.x, -_toTarget.z);
      const targetHeading = ((targetAngle * 180 / Math.PI) + 360) % 360;

      // Smooth heading toward target
      let headingErr = targetHeading - state.heading;
      while (headingErr > 180) headingErr -= 360;
      while (headingErr < -180) headingErr += 360;

      const maxTurn = cfg.turnRate * (180 / Math.PI) * dt;
      state.heading += clamp(headingErr, -maxTurn, maxTurn);
      state.heading = ((state.heading % 360) + 360) % 360;

      // Speed control (slow near turns, target node)
      const turnSharpness = Math.abs(headingErr) / 45;
      const targetSpeed = effectiveMaxSpeed * clamp(1 - turnSharpness * 0.6, 0.2, 1);
      const approachSlowdown = clamp(dist / 5, 0.3, 1);

      state.speed += (targetSpeed * approachSlowdown - state.speed) * clamp(cfg.acceleration * dt * 0.5, 0, 1);
      state.speed = clamp(state.speed, 0, effectiveMaxSpeed);

      // Update position
      const headingRad = state.heading * (Math.PI / 180);
      _forward.set(-Math.sin(headingRad), 0, -Math.cos(headingRad));
      state.velocity.copy(_forward).multiplyScalar(state.speed);
      state.position.addScaledVector(state.velocity, dt);

      // Ground following
      const groundH = getGroundLevel(state.position.x, state.position.z);
      state.position.y = groundH + 0.4;

      // Update quaternion
      state.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -headingRad);
    }

    // Beacon pulse
    if (v.beacon) {
      v.beacon.material.emissiveIntensity = 0.4 + Math.sin(performance.now() * 0.005) * 0.4;
    }

    // Sync 3D model
    v.group.position.copy(state.position);
    v.group.quaternion.copy(state.quaternion);
  }

  // Update windsocks
  const weather = getWeatherState();
  const windDir = weather.windDirection || 0;
  const windSpd = weather.windSpeed || 0;
  for (const ws of windsocks) {
    ws.cone.rotation.y = windDir;
    ws.cone.rotation.z = Math.min(windSpd * 0.05, 0.8);
  }

  // Airport announcements
  announcementTimer -= dt;
  if (announcementTimer <= 0) {
    announcementTimer = 45 + Math.random() * 75;
    // Only play if player is near an airport (within 1000m of origin or airport 2)
    const av = getActiveVehicle();
    const nearApt1 = Math.sqrt(av.position.x ** 2 + av.position.z ** 2) < 1000;
    const nearApt2 = Math.sqrt((av.position.x - AIRPORT2_X) ** 2 + (av.position.z - AIRPORT2_Z) ** 2) < 1000;
    if ((nearApt1 || nearApt2) && typeof speechSynthesis !== 'undefined') {
      const msg = new SpeechSynthesisUtterance(ANNOUNCEMENTS[Math.floor(Math.random() * ANNOUNCEMENTS.length)]);
      msg.rate = 1.0;
      msg.volume = 0.3;
      speechSynthesis.speak(msg);
    }
  }
}

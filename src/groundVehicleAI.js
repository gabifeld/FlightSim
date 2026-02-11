// Airport ground vehicle AI — waypoint following on taxiway network
import * as THREE from 'three';
import { getTaxiwayNetwork } from './taxi.js';
import { getGroundLevel } from './terrain.js';
import { clamp } from './utils.js';
import { createGroundVehicleState, registerVehicle, isGroundVehicle, getAllVehicles } from './vehicleState.js';
import { getGroundVehicleType } from './vehicleTypes.js';
import { buildGroundVehicleModel } from './carGeometry.js';

const _forward = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

let sceneRef = null;
const aiVehicles = []; // { state, model, route, routeIdx, waitTimer }

// Idle waypoints where vehicles park when not moving
const IDLE_NODES = ['gate_1', 'gate_2', 'gate_3', 'gate_4'];
// Patrol route endpoints
const PATROL_NODES = ['apron_n', 'apron_s', 'tw_n', 'tw_s'];

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
      if (!visited.has(next)) {
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

export function initGroundVehicleAI(scene) {
  sceneRef = scene;

  const network = getTaxiwayNetwork();
  if (!network || !network.nodeMap) return;

  // Spawn 3 ground vehicles at gates
  const types = ['tow_truck', 'fuel_truck', 'stairs_truck'];
  const startNodes = ['gate_1', 'gate_2', 'gate_3'];

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
}

export function updateGroundVehicleAI(dt) {
  const network = getTaxiwayNetwork();
  if (!network || !network.nodeMap) return;

  for (const v of aiVehicles) {
    const state = v.state;
    const cfg = state.config;
    if (!cfg) continue;

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

      if (dist < 2) {
        // Arrived at node
        v.currentNode = v.route[v.routeIdx];
        v.routeIdx++;

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
      const targetSpeed = cfg.maxSpeed * clamp(1 - turnSharpness * 0.6, 0.2, 1);
      const approachSlowdown = clamp(dist / 5, 0.3, 1);

      state.speed += (targetSpeed * approachSlowdown - state.speed) * clamp(cfg.acceleration * dt * 0.5, 0, 1);
      state.speed = clamp(state.speed, 0, cfg.maxSpeed);

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
}

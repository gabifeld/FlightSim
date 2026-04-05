// Car spawning and lifecycle management
import * as THREE from 'three';
import { createCarState, registerVehicle, setActiveVehicle, getActiveVehicle, unregisterVehicle, isCar } from './vehicleState.js';
import { getCarType, GROUND_VEHICLE_TYPES, getGroundVehicleType } from './vehicleTypes.js';
import { buildCarModel, buildGroundVehicleModel } from './carGeometry.js';
import { getGroundLevel } from './terrain.js';
import { CITY_CENTER_X, CITY_CENTER_Z, RUNWAY_WIDTH } from './constants.js';
import { getCityGraph } from './roadGraph.js';

let sceneRef = null;
let carState = null;
let carGroup = null;
let carWheels = [];
let carHeadlight = null;

export function initCarSpawn(scene) {
  sceneRef = scene;
}

function isGroundVehicleType(typeName) {
  return typeName in GROUND_VEHICLE_TYPES;
}

export function spawnCar(typeName) {
  // Clean up any existing car
  despawnCar();

  const isGround = isGroundVehicleType(typeName);
  const cfg = isGround ? getGroundVehicleType(typeName) : getCarType(typeName);

  // Ground vehicles need car-compatible config for car physics (add maxSteerDeg if missing)
  if (isGround && !cfg.maxSteerDeg) {
    cfg.maxSteerDeg = (cfg.turnRate || 1.0) * 25;
  }

  // Create car state and register it
  carState = createCarState();
  carState.config = cfg;
  carState.currentType = typeName;
  registerVehicle(carState);

  // Spawn location: airport apron for ground vehicles, road graph for cars (fallback: city center)
  let spawnX, spawnZ, spawnY;
  let usedGraph = false;
  if (isGround) {
    // Spawn near the apron area of airport 1
    spawnX = RUNWAY_WIDTH / 2 + 250;
    spawnZ = 0;
  } else {
    // Try to spawn on a road from the city graph
    const graph = getCityGraph();
    if (graph) {
      const edges = [...graph.edges.values()].filter(e => e.type === 'arterial' || e.type === 'collector');
      if (edges.length > 0) {
        const edge = edges[Math.floor(Math.random() * edges.length)];
        const fromNode = graph.nodes.get(edge.from);
        const toNode = graph.nodes.get(edge.to);
        const t = 0.5;
        spawnX = fromNode.x + (toNode.x - fromNode.x) * t;
        spawnZ = fromNode.z + (toNode.z - fromNode.z) * t;
        spawnY = fromNode.y + (toNode.y - fromNode.y) * t + 0.4;
        usedGraph = true;
      }
    }
    if (!usedGraph) {
      spawnX = CITY_CENTER_X;
      spawnZ = CITY_CENTER_Z;
    }
  }

  if (!usedGraph) {
    spawnY = getGroundLevel(spawnX, spawnZ) + 0.4;
  }

  carState.position.set(spawnX, spawnY, spawnZ);
  carState.heading = 0;
  carState.quaternion.identity();
  carState.onGround = true;

  // Build 3D model (use ground vehicle model for airport vehicles)
  let built;
  if (isGround) {
    const gv = buildGroundVehicleModel(typeName);
    built = { group: gv.group, wheels: [] };
  } else {
    built = buildCarModel(typeName);
  }
  carGroup = built.group;
  carWheels = built.wheels || [];
  carGroup.position.copy(carState.position);
  carGroup.quaternion.copy(carState.quaternion);

  // Add headlights (SpotLight for actual illumination)
  const hl = new THREE.SpotLight(0xffffdd, 0, 120, Math.PI * 0.25, 0.5, 1.5);
  hl.position.set(0, cfg.height * 0.3, -cfg.length * 0.5);
  hl.target.position.set(0, cfg.height * 0.1, -cfg.length * 0.5 - 30);
  carGroup.add(hl);
  carGroup.add(hl.target);
  carHeadlight = hl;

  if (sceneRef) sceneRef.add(carGroup);

  // Set as active vehicle
  setActiveVehicle(carState);

  return carState;
}

export function despawnCar() {
  if (carGroup && sceneRef) {
    sceneRef.remove(carGroup);
    carGroup = null;
    carWheels = [];
  }
  if (carState) {
    unregisterVehicle(carState);
    carState = null;
  }
}

export function updateCarVisual(dt) {
  if (!carState || !carGroup) return;

  // Sync 3D model to state
  carGroup.position.copy(carState.position);
  carGroup.quaternion.copy(carState.quaternion);

  // Headlight toggle (uses same landingLight property)
  if (carHeadlight) {
    carHeadlight.intensity = carState.landingLight ? 30 : 0;
  }

  // Wheel spin animation (radius ~0.3m, so rotation = speed / radius)
  const wheelRotSpeed = carState.speed / 0.3 * dt;
  for (const w of carWheels) {
    w.rotation.x += wheelRotSpeed;
  }
}

export function isCarSpawned() {
  return carState !== null;
}

export function getCarState() {
  return carState;
}


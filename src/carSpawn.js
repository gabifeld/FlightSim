// Car spawning and lifecycle management
import * as THREE from 'three';
import { createCarState, registerVehicle, setActiveVehicle, getActiveVehicle, unregisterVehicle, isCar } from './vehicleState.js';
import { getCarType } from './vehicleTypes.js';
import { buildCarModel } from './carGeometry.js';
import { getGroundLevel } from './terrain.js';
import { CITY_CENTER_X, CITY_CENTER_Z } from './constants.js';

let sceneRef = null;
let carState = null;
let carGroup = null;
let carWheels = [];

export function initCarSpawn(scene) {
  sceneRef = scene;
}

export function spawnCar(typeName) {
  // Clean up any existing car
  despawnCar();

  const cfg = getCarType(typeName);

  // Create car state and register it
  carState = createCarState();
  carState.config = cfg;
  carState.currentType = typeName;
  registerVehicle(carState);

  // Spawn at center of city
  const spawnX = CITY_CENTER_X;
  const spawnZ = CITY_CENTER_Z;
  const groundY = getGroundLevel(spawnX, spawnZ);

  carState.position.set(spawnX, groundY + 0.4, spawnZ);
  carState.heading = 0;
  carState.quaternion.identity(); // heading 0 = facing -Z (same as aircraft convention)
  carState.onGround = true;

  // Build 3D model
  const built = buildCarModel(typeName);
  carGroup = built.group;
  carWheels = built.wheels;
  carGroup.position.copy(carState.position);
  carGroup.quaternion.copy(carState.quaternion);

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

  // Wheel spin animation
  const wheelRotSpeed = carState.speed * dt * 3;
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


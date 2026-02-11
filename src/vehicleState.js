import * as THREE from 'three';

// Vehicle type constants
export const VehicleType = { AIRCRAFT: 'aircraft', CAR: 'car', GROUND_VEHICLE: 'ground_vehicle' };

// Factory: base vehicle state (shared by all types)
export function createVehicleState(type) {
  return {
    vehicleType: type,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ'),
    speed: 0,
    altitude: 0,
    altitudeAGL: 0,
    heading: 0,
    onGround: true,
    throttle: 0,
    config: null,
    currentType: null,
  };
}

// Aircraft extension (adds flight-specific properties)
export function createAircraftState() {
  return Object.assign(createVehicleState(VehicleType.AIRCRAFT), {
    verticalSpeed: 0,
    aoa: 0,
    gForce: 1,
    propSpeed: 0,
    flaps: false,
    gear: true,
    speedbrake: false,
    landingLight: false,
    currentType: 'cessna_172',
  });
}

// Car extension (for driveable city cars)
export function createCarState() {
  return Object.assign(createVehicleState(VehicleType.CAR), {
    steering: 0,
    brake: 0,
    rpm: 0,
    gearNum: 1,
    headlights: false,
    currentType: 'sedan',
  });
}

// Ground vehicle extension (airport vehicles)
export function createGroundVehicleState() {
  return Object.assign(createVehicleState(VehicleType.GROUND_VEHICLE), {
    steering: 0,
    targetNode: null,
    task: null,
    aiControlled: true,
    currentType: 'tow_truck',
  });
}

// Active vehicle registry
let activeVehicle = null;
const allVehicles = [];

export function getActiveVehicle() { return activeVehicle; }
export function setActiveVehicle(v) { activeVehicle = v; }
export function getAllVehicles() { return allVehicles; }

export function registerVehicle(v) {
  allVehicles.push(v);
  if (!activeVehicle) activeVehicle = v;
  return v;
}

export function unregisterVehicle(v) {
  const idx = allVehicles.indexOf(v);
  if (idx !== -1) allVehicles.splice(idx, 1);
  if (activeVehicle === v) {
    activeVehicle = allVehicles.length > 0 ? allVehicles[0] : null;
  }
}

// Type guards
export function isAircraft(v) { return v?.vehicleType === VehicleType.AIRCRAFT; }
export function isCar(v) { return v?.vehicleType === VehicleType.CAR; }
export function isGroundVehicle(v) { return v?.vehicleType === VehicleType.GROUND_VEHICLE; }

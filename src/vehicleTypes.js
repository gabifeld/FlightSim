// Vehicle type configurations for cars and ground vehicles

export const CAR_TYPES = {
  sedan: {
    name: 'Sedan',
    maxSpeed: 45,         // m/s (~100 mph)
    acceleration: 14,     // m/s²
    brakeForce: 22,       // m/s²
    grip: 0.95,           // lateral grip (0-1, higher = tighter cornering)
    turnDegPerSec: 150,   // degrees/sec steering rate
    width: 1.8,
    height: 1.4,
    length: 4.5,
    color: 0x3366aa,
  },
  sports: {
    name: 'Sports Car',
    maxSpeed: 70,         // m/s (~155 mph)
    acceleration: 22,     // m/s²
    brakeForce: 30,       // m/s²
    grip: 0.92,           // slightly looser for fun sliding
    turnDegPerSec: 170,   // sharper steering
    width: 1.9,
    height: 1.2,
    length: 4.3,
    color: 0xcc2222,
  },
};

export const GROUND_VEHICLE_TYPES = {
  tow_truck: {
    name: 'Tow Truck',
    maxSpeed: 8,       // m/s (~18 mph) — slow airport speed
    acceleration: 3,
    brakeForce: 6,
    mass: 5000,
    turnRate: 1.2,
    wheelBase: 3.5,
    width: 2.2,
    height: 2.0,
    length: 5.5,
    color: 0xddaa22,
  },
  fuel_truck: {
    name: 'Fuel Truck',
    maxSpeed: 8,
    acceleration: 2.5,
    brakeForce: 5,
    mass: 8000,
    turnRate: 0.9,
    wheelBase: 4.0,
    width: 2.4,
    height: 2.5,
    length: 7.0,
    color: 0xeeeeee,
  },
  stairs_truck: {
    name: 'Stairs Truck',
    maxSpeed: 6,
    acceleration: 2,
    brakeForce: 4,
    mass: 3000,
    turnRate: 1.4,
    wheelBase: 3.0,
    width: 2.0,
    height: 3.5,
    length: 6.0,
    color: 0x4488cc,
  },
};

export function getCarType(name) {
  return CAR_TYPES[name] || CAR_TYPES.sedan;
}

export function getGroundVehicleType(name) {
  return GROUND_VEHICLE_TYPES[name] || GROUND_VEHICLE_TYPES.tow_truck;
}

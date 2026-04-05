// Vehicle type configurations for cars and ground vehicles

export const CAR_TYPES = {
  sedan: {
    name: 'Sedan',
    maxSpeed: 55,         // m/s (~123 mph)
    acceleration: 10,     // m/s²
    brakeForce: 20,       // m/s² — responsive brakes
    maxSteerDeg: 32,      // max front-wheel lock angle
    wheelBase: 2.7,       // metres — determines turn radius
    width: 1.8,
    height: 1.4,
    length: 4.5,
    color: 0x3366aa,
  },
  sports: {
    name: 'Sports Car',
    maxSpeed: 80,         // m/s (~179 mph) — fast enough for fun racing
    acceleration: 16,     // m/s² — punchy acceleration
    brakeForce: 28,       // m/s² — strong brakes for tight corners
    maxSteerDeg: 30,      // tighter lock = sportier
    wheelBase: 2.5,       // shorter = snappier turn-in
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
  baggage_cart: {
    name: 'Baggage Cart',
    maxSpeed: 5,
    acceleration: 2,
    brakeForce: 4,
    mass: 1500,
    turnRate: 1.8,
    wheelBase: 2.0,
    width: 1.5,
    height: 1.2,
    length: 3.0,
    color: 0x44aa44,
  },
  catering_truck: {
    name: 'Catering Truck',
    maxSpeed: 7,
    acceleration: 2.5,
    brakeForce: 5,
    mass: 6000,
    turnRate: 1.0,
    wheelBase: 3.5,
    width: 2.2,
    height: 3.0,
    length: 6.5,
    color: 0xeeeeee,
  },
  fire_truck: {
    name: 'Fire Truck',
    maxSpeed: 15,
    acceleration: 5,
    brakeForce: 10,
    mass: 12000,
    turnRate: 0.8,
    wheelBase: 5.0,
    width: 2.5,
    height: 3.2,
    length: 8.0,
    color: 0xcc2222,
  },
  pushback_tug: {
    name: 'Pushback Tug',
    maxSpeed: 4,
    acceleration: 2,
    brakeForce: 6,
    mass: 7000,
    turnRate: 1.5,
    wheelBase: 2.5,
    width: 2.0,
    height: 1.8,
    length: 4.0,
    color: 0xddcc22,
  },
  pax_bus: {
    name: 'Passenger Bus',
    maxSpeed: 8,
    acceleration: 2,
    brakeForce: 5,
    mass: 9000,
    turnRate: 0.7,
    wheelBase: 5.5,
    width: 2.5,
    height: 3.0,
    length: 10.0,
    color: 0x3366cc,
  },
};

export function getCarType(name) {
  return CAR_TYPES[name] || CAR_TYPES.sedan;
}

export function getGroundVehicleType(name) {
  return GROUND_VEHICLE_TYPES[name] || GROUND_VEHICLE_TYPES.tow_truck;
}

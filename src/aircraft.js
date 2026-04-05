import * as THREE from 'three';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, AIRPORT2_X, AIRPORT2_Z, SEAPLANE_X, SEAPLANE_Z, INTL_AIRPORT_X, INTL_AIRPORT_Z, INTL_RUNWAY_LENGTH } from './constants.js';
import { getAircraftType } from './aircraftTypes.js';
import { getApproachSpawn } from './landing.js';
import { isNight } from './scene.js';
import { buildAircraftModel as _buildAircraftModel } from './aircraftGeometry.js';
import { drawPropPanel, drawJetPanel, drawFighterPanel } from './cockpitDisplay.js';
import { getSetting, isSettingExplicit } from './settings.js';
import { createAircraftState, registerVehicle } from './vehicleState.js';
import { getGroundLevel } from './terrain.js';

// Spawn locations
let spawnLocation = 'runway'; // 'runway' | 'gate' | 'short_final' | 'long_final' | 'runway_apt2' | 'gate_apt2'

const SPAWN_POSITIONS = {
  runway: { x: 0, z: RUNWAY_LENGTH / 2 - 100, heading: 0 },
  gate: {
    x: RUNWAY_WIDTH / 2 + 100,
    z: 50,
    heading: Math.PI,
  },
  runway_apt2: { x: AIRPORT2_X, z: AIRPORT2_Z + RUNWAY_LENGTH / 2 - 100, heading: 0 },
  gate_apt2: {
    x: AIRPORT2_X + RUNWAY_WIDTH / 2 + 100,
    z: AIRPORT2_Z + 50,
    heading: Math.PI,
  },
  seaplane_water: {
    x: SEAPLANE_X,
    z: SEAPLANE_Z,
    heading: Math.PI * 0.9,
    y: -0.5, // on water surface
  },
  // International airport (E-W runways)
  runway_intl: {
    x: INTL_AIRPORT_X - INTL_RUNWAY_LENGTH / 2 + 100,
    z: INTL_AIRPORT_Z - 150,
    heading: Math.PI / 2, // east (runway 09L)
  },
  gate_intl: {
    x: INTL_AIRPORT_X,
    z: INTL_AIRPORT_Z - 60,
    heading: -Math.PI / 2, // facing west
  },
  // New airports — all heading 90 = runway along Z (same as APT1/APT2)
  // Spawn at south end (+Z end), face north (same as main runway spawn)
  runway_military: {
    x: -5000,
    z: -10000 + 2500 / 2 - 100, // south end of 2500m runway
    heading: 0, // face north
  },
  runway_ga: {
    x: 5000,
    z: 12000 + 1200 / 2 - 100, // south end of 1200m runway at KFSG (5000, 12000)
    heading: 0,
  },
  runway_mountain: {
    x: -3000 - 800 / 2 + 80, // west end of 800m E-W runway at KFSC (-3000, -18000)
    z: -18000,
    heading: Math.PI / 2, // face east (runway heading 90)
  },
  runway_carrier: {
    x: 16000,
    z: -4000 - (330 * 3) / 2 + 100, // near stern of 3x scaled carrier deck
    y: -2 + 20 * 3 + 1.5, // WATER_SURFACE_Y + scaled deck height + wheel clearance
    heading: 0,
  },
};

// aircraftState is the registered active vehicle — same object reference
// All existing consumers can import this and it works unchanged
export const aircraftState = registerVehicle(createAircraftState());

let aircraftGroup;
let propeller;
let gearGroup;
let sceneRef;
let engineFanGroups = [];
let cabinWindowMaterials = [];
let cockpitNightMaterials = [];
let aircraftDisposableTextures = [];

// Landing/taxi lights
let landingSpotLight = null;
let landingLightCone = null;

// Control surface meshes
let leftAileron, rightAileron, elevator, rudder;

// Cockpit interior
let cockpitGroup;

// Exterior parts hidden in cockpit view (nose, fuselage front, windshield posts)
let exteriorBodyParts = [];

// Contrail system
let contrailLeft, contrailRight;
const CONTRAIL_LENGTH = 200;
let contrailWriteIndex = 0;
let contrailCount = 0;
let contrailRingLeft = new Float32Array(CONTRAIL_LENGTH * 3);
let contrailRingRight = new Float32Array(CONTRAIL_LENGTH * 3);
const _leftWingtip = new THREE.Vector3();
const _rightWingtip = new THREE.Vector3();
const _wingOffsetLeft = new THREE.Vector3();
const _wingOffsetRight = new THREE.Vector3();

// Cockpit canvas instrument panel
let cockpitCanvas, cockpitCtx, cockpitTexture, cockpitPanel;
let cockpitFrameCount = 0;
let cockpitUpdateDivisor = 4;





// Afterburner cones
let afterburnerInner = null;
let afterburnerOuter = null;

// Wing flex
let mainWing = null;
let lastFlexGDelta = -999;

// Blinking lights
let beaconMesh, strobeLeftMesh, strobeRightMesh;

// Nav point lights
let navLightLeft, navLightRight;

// Tail logo light
let tailLogoLight = null;

export function setSpawnLocation(loc) {
  spawnLocation = loc;
}

export function getSpawnLocation() {
  return spawnLocation;
}

export function resetAircraft() {
  // Check if this is an approach spawn
  const approachSpawn = getApproachSpawn(spawnLocation, aircraftState.config);

  if (approachSpawn) {
    // Airborne approach spawn
    aircraftState.position.set(approachSpawn.x, approachSpawn.y, approachSpawn.z);

    // Face north (+Z toward runway): rotate 180deg around Y
    // Default forward is (0,0,-1), rotating PI makes it (0,0,+1)
    aircraftState.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    aircraftState.euler.setFromQuaternion(aircraftState.quaternion, 'YXZ');

    // Velocity toward runway (+Z) with slight descent on 3-deg glideslope
    const descentRate = Math.sin(3 * Math.PI / 180) * approachSpawn.speed;
    aircraftState.velocity.set(0, -descentRate, approachSpawn.speed);
    aircraftState.speed = approachSpawn.speed;
    aircraftState.altitude = approachSpawn.y;
    aircraftState.altitudeAGL = approachSpawn.y;
    aircraftState.verticalSpeed = -descentRate;
    aircraftState.throttle = approachSpawn.throttle;
    aircraftState.flaps = approachSpawn.flapsDown;
    aircraftState.gear = approachSpawn.gearDown;
    aircraftState.speedbrake = false;
    aircraftState.onGround = false;
    aircraftState.heading = 360;
    aircraftState.aoa = 0;
    aircraftState.propSpeed = 0;
    aircraftState.gForce = 1;
    aircraftState.fuel = 1.0;
  } else {
    // Ground spawn
    const spawn = SPAWN_POSITIONS[spawnLocation] || SPAWN_POSITIONS.runway;

    // Use terrain height at spawn point so plane doesn't spawn underground
    const spawnY = spawn.y !== undefined ? spawn.y : (getGroundLevel(spawn.x, spawn.z) + 1.5);
    aircraftState.position.set(spawn.x, spawnY, spawn.z);
    aircraftState.velocity.set(0, 0, 0);
    aircraftState.quaternion.identity();
    aircraftState.euler.set(0, 0, 0);
    aircraftState.speed = 0;
    aircraftState.altitude = 0;
    aircraftState.altitudeAGL = 0;
    aircraftState.verticalSpeed = 0;
    aircraftState.throttle = 0;
    aircraftState.flaps = false;
    aircraftState.gear = true;
    aircraftState.speedbrake = false;
    aircraftState.onGround = true;
    aircraftState.heading = 0;
    aircraftState.aoa = 0;
    aircraftState.propSpeed = 0;
    aircraftState.gForce = 1;
    aircraftState.fuel = 1.0;

    if (spawn.heading) {
      aircraftState.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.heading);
      aircraftState.euler.setFromQuaternion(aircraftState.quaternion, 'YXZ');
      aircraftState.heading = ((spawn.heading * 180) / Math.PI + 360) % 360;
    }
  }

  // Safety: ensure aircraft is never below terrain at spawn
  const safeGroundH = getGroundLevel(aircraftState.position.x, aircraftState.position.z) + 2.0;
  if (aircraftState.position.y < safeGroundH) {
    aircraftState.position.y = safeGroundH;
    aircraftState.altitude = safeGroundH;
    aircraftState.altitudeAGL = 2.0;
  }

  if (aircraftGroup) {
    aircraftGroup.position.copy(aircraftState.position);
    aircraftGroup.quaternion.copy(aircraftState.quaternion);
  }
}

function loadAircraftConfig(typeName) {
  const type = getAircraftType(typeName);
  aircraftState.config = {
    mass: type.mass,
    maxThrust: type.maxThrust,
    wingArea: type.wingArea,
    pitchRate: type.pitchRate,
    rollRate: type.rollRate,
    yawRate: type.yawRate,
    stallAoa: type.stallAoa,
    takeoffSpeed: type.takeoffSpeed,
    type: type.type,
    wingspan: type.wingSpan || 14,
    isSeaplane: !!type.isSeaplane,
    fuelCapacity: type.fuelCapacity || 1000,
    fuelBurnRate: type.fuelBurnRate || 100,
    engineCount: type.engineCount || 1,
    glassPanel: !!type.glassPanel,
  };
  aircraftState.currentType = typeName;
}

export function createAircraft(scene, typeName) {
  sceneRef = scene;
  typeName = typeName || 'cessna_172';
  disposeAircraftTextures();
  loadAircraftConfig(typeName);

  const type = getAircraftType(typeName);
  buildAircraftModel(scene, type);

  resetAircraft();
  scene.add(aircraftGroup);
  return aircraftGroup;
}

function disposeAircraftTextures() {
  for (let i = 0; i < aircraftDisposableTextures.length; i++) {
    aircraftDisposableTextures[i].dispose();
  }
  aircraftDisposableTextures = [];
}

export function switchAircraft(typeName) {
  if (!sceneRef) return;
  disposeAircraftTextures();
  if (aircraftGroup) {
    sceneRef.remove(aircraftGroup);
    // Dispose geometries/materials
    aircraftGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  // Remove old contrails
  if (contrailLeft) { sceneRef.remove(contrailLeft); contrailLeft = null; }
  if (contrailRight) { sceneRef.remove(contrailRight); contrailRight = null; }

  loadAircraftConfig(typeName);
  const type = getAircraftType(typeName);
  buildAircraftModel(sceneRef, type);

  resetAircraft();
  sceneRef.add(aircraftGroup);
}

function buildAircraftModel(scene, type) {
  const built = _buildAircraftModel(scene, type);

  // Destructure into module-level vars
  aircraftGroup = built.aircraftGroup;
  propeller = built.propeller;
  gearGroup = built.gearGroup;
  engineFanGroups = built.engineFanGroups;
  cabinWindowMaterials = built.cabinWindowMaterials;
  cockpitNightMaterials = built.cockpitNightMaterials;
  aircraftDisposableTextures = built.aircraftDisposableTextures;
  leftAileron = built.leftAileron;
  rightAileron = built.rightAileron;
  elevator = built.elevator;
  rudder = built.rudder;
  cockpitGroup = built.cockpitGroup;
  exteriorBodyParts = built.exteriorBodyParts;
  beaconMesh = built.beaconMesh;
  strobeLeftMesh = built.strobeLeftMesh;
  strobeRightMesh = built.strobeRightMesh;
  navLightLeft = built.navLightLeft;
  navLightRight = built.navLightRight;
  tailLogoLight = built.tailLogoLight;
  landingSpotLight = built.landingSpotLight;
  landingLightCone = built.landingLightCone;
  cockpitCanvas = built.cockpitCanvas;
  cockpitCtx = built.cockpitCtx;
  cockpitTexture = built.cockpitTexture;
  cockpitPanel = built.cockpitPanel;
  afterburnerInner = built.afterburnerInner;
  afterburnerOuter = built.afterburnerOuter;
  mainWing = built.mainWing;
  lastFlexGDelta = -999;
  cockpitFrameCount = 0;

  const detail = (isSettingExplicit('assetQuality') ? getSetting('assetQuality') : getSetting('graphicsQuality'));
  cockpitUpdateDivisor = detail === 'low' ? 5 : (detail === 'high' ? 2 : 3);

  setupContrails(scene, built.layout.wingSpan || type.wingSpan || 14);
}

function setupContrails(scene, wingspan) {
  const maxPoints = CONTRAIL_LENGTH;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxPoints * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  contrailLeft = new THREE.Points(geometry.clone(), material.clone());
  contrailRight = new THREE.Points(geometry.clone(), material.clone());
  scene.add(contrailLeft);
  scene.add(contrailRight);

  contrailWriteIndex = 0;
  contrailCount = 0;
  contrailRingLeft = new Float32Array(CONTRAIL_LENGTH * 3);
  contrailRingRight = new Float32Array(CONTRAIL_LENGTH * 3);
}

export function updateAircraftVisual(dt, keys) {
  if (!aircraftGroup) return;
  keys = keys || {};

  aircraftGroup.position.copy(aircraftState.position);
  aircraftGroup.quaternion.copy(aircraftState.quaternion);

  // Propeller spin + 4C prop disc/blade visibility
  if (propeller) {
    aircraftState.propSpeed = aircraftState.throttle * 50;
    propeller.rotation.z += aircraftState.propSpeed * dt;
    const cockpitView = cockpitGroup && cockpitGroup.visible;

    propeller.children.forEach(child => {
      if (child.userData.isPropBlade) {
        // In cockpit, avoid solid prop blade obstruction.
        child.visible = !cockpitView && aircraftState.propSpeed < 15;
      }
      if (child.userData.isPropDisc) {
        if (cockpitView) {
          child.visible = aircraftState.propSpeed > 3;
          child.material.opacity = 0.05;
        } else if (aircraftState.propSpeed < 10) {
          child.visible = false;
        } else if (aircraftState.propSpeed > 20) {
          child.visible = true;
          child.material.opacity = aircraftState.propSpeed > 35 ? 0.25 : 0.15;
        } else {
          child.visible = true;
          child.material.opacity = ((aircraftState.propSpeed - 10) / 10) * 0.15;
        }
      }
    });
  }

  // Jet fan spin
  if (engineFanGroups.length > 0) {
    const fanSpeed = 10 + aircraftState.throttle * 165 + aircraftState.speed * 0.08;
    for (let i = 0; i < engineFanGroups.length; i++) {
      engineFanGroups[i].rotation.z += fanSpeed * dt;
    }
  }

  // Gear retraction animation (seaplane floats are fixed, never retract)
  if (gearGroup) {
    const isSeaplane = aircraftState.config && aircraftState.config.isSeaplane;
    if (isSeaplane) {
      gearGroup.scale.y = 1;
      gearGroup.visible = true;
      aircraftState.gear = true;
    } else {
      const targetScale = aircraftState.gear ? 1 : 0;
      gearGroup.scale.y += (targetScale - gearGroup.scale.y) * Math.min(1, 5 * dt);
      gearGroup.visible = gearGroup.scale.y > 0.05;
    }
  }

  // Control surface animation follows resolved control commands, not keyboard only.
  const ctrl = aircraftState.controlInputs;
  const rollInput = ctrl ? ctrl.roll : ((keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0));
  const pitchInput = ctrl ? ctrl.pitch : ((keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0));
  const yawInput = ctrl ? ctrl.yaw : ((keys['e'] ? 1 : 0) - (keys['q'] ? 1 : 0));

  if (rightAileron) {
    rightAileron.rotation.x += (rollInput * 0.3 - rightAileron.rotation.x) * Math.min(1, 10 * dt);
  }
  if (leftAileron) {
    leftAileron.rotation.x += (-rollInput * 0.3 - leftAileron.rotation.x) * Math.min(1, 10 * dt);
  }
  if (elevator) {
    elevator.rotation.x += (pitchInput * 0.25 - elevator.rotation.x) * Math.min(1, 10 * dt);
  }
  if (rudder) {
    rudder.rotation.y += (yawInput * 0.25 - rudder.rotation.y) * Math.min(1, 10 * dt);
  }

  // Blinking lights
  const now = performance.now();
  if (beaconMesh) {
    const pulse = (Math.sin(now * 0.005) + 1) * 0.5;
    beaconMesh.material.emissiveIntensity = pulse * 3.5;
  }
  if (strobeLeftMesh && strobeRightMesh) {
    // Strobe: sharp flash every ~1 second
    const strobeVal = Math.sin(now * 0.006) > 0.95 ? 5.0 : 0.1;
    strobeLeftMesh.material.emissiveIntensity = strobeVal;
    strobeRightMesh.material.emissiveIntensity = strobeVal;
  }

  // Landing/taxi lights
  if (landingSpotLight) {
    const lightOn = aircraftState.landingLight;
    landingSpotLight.intensity = lightOn ? 40 : 0;
    landingSpotLight.distance = lightOn ? 200 : 0;
    if (landingLightCone) {
      landingLightCone.visible = lightOn;
      landingLightCone.material.opacity = lightOn ? 0.06 : 0;
    }
    if (tailLogoLight) {
      tailLogoLight.intensity = lightOn ? 1.5 : 0;
    }
  }

  const night = isNight();
  for (let i = 0; i < cabinWindowMaterials.length; i++) {
    cabinWindowMaterials[i].emissiveIntensity += ((night ? 0.42 : 0.06) - cabinWindowMaterials[i].emissiveIntensity) * Math.min(1, dt * 2.5);
  }
  for (let i = 0; i < cockpitNightMaterials.length; i++) {
    cockpitNightMaterials[i].emissiveIntensity += ((night ? 0.32 : 0.1) - cockpitNightMaterials[i].emissiveIntensity) * Math.min(1, dt * 2.0);
  }

  // Update cockpit instruments canvas
  if (cockpitCanvas && cockpitGroup && cockpitGroup.visible) {
    cockpitFrameCount = (cockpitFrameCount || 0) + 1;
    if (cockpitFrameCount % cockpitUpdateDivisor === 0) {
      const ctx = cockpitCtx;
      const w = cockpitCanvas.width;
      const h = cockpitCanvas.height;
      const type = aircraftState.config?.type || 'prop';

      if (type === 'prop') drawPropPanel(ctx, aircraftState, w, h);
      else if (type === 'fighter') drawFighterPanel(ctx, aircraftState, w, h);
      else drawJetPanel(ctx, aircraftState, w, h);

      cockpitTexture.needsUpdate = true;
    }
  }

  // 4A: Afterburner animation (lightweight)
  if (afterburnerInner && afterburnerOuter) {
    const abActive = aircraftState.throttle > 0.5;
    afterburnerInner.visible = abActive;
    afterburnerOuter.visible = abActive;
    const abLight = afterburnerInner.userData.abLight;
    if (abLight) abLight.visible = abActive;
    if (abActive) {
      const intensity = (aircraftState.throttle - 0.5) * 2;
      const t = performance.now() * 0.001;
      const flicker = 0.9 + 0.1 * Math.sin(t * 37) * Math.sin(t * 53);
      const scaledIntensity = intensity * flicker;

      // Inner cone shader uniforms
      if (afterburnerInner.material.uniforms) {
        afterburnerInner.material.uniforms.uTime.value = t;
        afterburnerInner.material.uniforms.uIntensity.value = scaledIntensity;
      }

      // Outer cone (MeshBasicMaterial) — just opacity + scale
      afterburnerOuter.material.opacity = 0.15 + scaledIntensity * 0.2;

      // Dynamic scale
      const scaleXY = 0.8 + scaledIntensity * 0.4;
      const scaleZ = 0.6 + scaledIntensity * 0.8;
      afterburnerInner.scale.set(scaleXY, scaleXY, scaleZ);
      afterburnerOuter.scale.set(scaleXY * 1.1, scaleXY * 1.1, scaleZ * 1.2);

      // Point light glow
      if (abLight) {
        abLight.intensity = scaledIntensity * 3.0;
        abLight.color.setHSL(0.07 + intensity * 0.02, 1.0, 0.5 + intensity * 0.2);
      }
    }
  }

  // 4D: Wing flex under load
  if (mainWing && mainWing.userData.hasWingFlex) {
    const gForce = aircraftState.gForce || 1;
    const gDelta = Math.max(-0.35, Math.min(1.0, gForce - 1));
    if (Math.abs(gDelta - lastFlexGDelta) >= 0.02) {
      lastFlexGDelta = gDelta;
      const pos = mainWing.geometry.attributes.position;
      const origY = mainWing.userData.originalY;
      const halfSpan = mainWing.userData.wingSpan / 2;
      const flexFactor = mainWing.userData.flexFactor ?? 0.008;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const spanFrac = Math.abs(x) / halfSpan;
        const flex = gDelta * flexFactor * spanFrac * spanFrac;
        pos.setY(i, origY[i] + flex);
      }
      pos.needsUpdate = true;
    }
  }

  // Contrails (jet/fighter at high altitude/high speed)
  updateContrails();
}

function updateContrails() {
  if (!contrailLeft || !contrailRight) return;

  const type = getAircraftType(aircraftState.currentType);
  const isJetType = type.type === 'jet' || type.type === 'fighter';
  const visible =
    isJetType &&
    aircraftState.altitude > 2200 &&
    aircraftState.speed > 75 &&
    aircraftState.throttle > 0.55;

  contrailLeft.visible = visible;
  contrailRight.visible = visible;

  if (!visible) {
    contrailWriteIndex = 0;
    contrailCount = 0;
    contrailLeft.geometry.setDrawRange(0, 0);
    contrailRight.geometry.setDrawRange(0, 0);
    return;
  }

  const wSpan = type.wingSpan || 14;

  // Get wingtip world positions
  _wingOffsetLeft.set(-wSpan / 2, 0, 0.5).applyQuaternion(aircraftState.quaternion);
  _wingOffsetRight.set(wSpan / 2, 0, 0.5).applyQuaternion(aircraftState.quaternion);
  _leftWingtip.copy(aircraftState.position).add(_wingOffsetLeft);
  _rightWingtip.copy(aircraftState.position).add(_wingOffsetRight);

  const writeBase = contrailWriteIndex * 3;
  contrailRingLeft[writeBase] = _leftWingtip.x;
  contrailRingLeft[writeBase + 1] = _leftWingtip.y;
  contrailRingLeft[writeBase + 2] = _leftWingtip.z;
  contrailRingRight[writeBase] = _rightWingtip.x;
  contrailRingRight[writeBase + 1] = _rightWingtip.y;
  contrailRingRight[writeBase + 2] = _rightWingtip.z;

  contrailWriteIndex = (contrailWriteIndex + 1) % CONTRAIL_LENGTH;
  if (contrailCount < CONTRAIL_LENGTH) contrailCount++;

  // Update buffer geometries
  const leftPosAttr = contrailLeft.geometry.attributes.position;
  const rightPosAttr = contrailRight.geometry.attributes.position;

  const oldestIndex = (contrailWriteIndex - contrailCount + CONTRAIL_LENGTH) % CONTRAIL_LENGTH;
  for (let i = 0; i < contrailCount; i++) {
    const src = (oldestIndex + i) % CONTRAIL_LENGTH;
    const srcBase = src * 3;
    leftPosAttr.setXYZ(
      i,
      contrailRingLeft[srcBase],
      contrailRingLeft[srcBase + 1],
      contrailRingLeft[srcBase + 2]
    );
    rightPosAttr.setXYZ(
      i,
      contrailRingRight[srcBase],
      contrailRingRight[srcBase + 1],
      contrailRingRight[srcBase + 2]
    );
  }

  leftPosAttr.needsUpdate = true;
  rightPosAttr.needsUpdate = true;
  contrailLeft.geometry.setDrawRange(0, contrailCount);
  contrailRight.geometry.setDrawRange(0, contrailCount);
}

export function getAircraftGroup() {
  return aircraftGroup;
}

export function setCockpitVisible(visible) {
  if (cockpitGroup) cockpitGroup.visible = visible;
  // Hide exterior body parts that block the cockpit camera view
  for (let i = 0; i < exteriorBodyParts.length; i++) {
    exteriorBodyParts[i].visible = !visible;
  }
}

export function getCockpitGroup() {
  return cockpitGroup;
}

export function hideAircraftModel() {
  if (aircraftGroup) aircraftGroup.visible = false;
}

export function showAircraftModel() {
  if (aircraftGroup) aircraftGroup.visible = true;
}

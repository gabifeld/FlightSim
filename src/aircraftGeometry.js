import * as THREE from 'three';
import { getEnvironmentMap, isNight } from './scene.js';
import { getSetting, isSettingExplicit } from './settings.js';

// Toon outline for stylized aircraft look
const _outlineMat = new THREE.MeshBasicMaterial({
  color: 0x222222,
  side: THREE.BackSide,
});

function addOutline(mesh, thickness = 0.04) {
  if (!mesh.geometry) return;
  const outline = new THREE.Mesh(mesh.geometry, _outlineMat);
  outline.scale.multiplyScalar(1 + thickness);
  outline.raycast = () => {}; // not pickable
  mesh.add(outline);
}

// Module-level state (set during build, returned as struct)
let aircraftGroup;
let propeller;
let gearGroup;
let engineFanGroups = [];
let cabinWindowMaterials = [];
let cockpitNightMaterials = [];
let aircraftDisposableTextures = [];
let leftAileron, rightAileron, elevator, rudder;
let cockpitGroup;
let exteriorBodyParts = [];
let beaconMesh, strobeLeftMesh, strobeRightMesh;
let navLightLeft, navLightRight;
let tailLogoLight = null;
let landingSpotLight = null;
let landingLightCone = null;
let cockpitCanvas, cockpitCtx, cockpitTexture, cockpitPanel;


function createFuselageGeo(length, radius, noseLen, tailLen, segments) {
  const points = [];
  const n = 36;
  const noseFrac = noseLen / length;
  const tailFrac = tailLen / length;

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r;
    if (t < noseFrac) {
      const nt = t / noseFrac;
      // Super-ellipse nose for smoother blend into body
      r = radius * Math.pow(Math.sin(nt * Math.PI * 0.5), 0.82);
    } else if (t > 1 - tailFrac) {
      const tt = (t - (1 - tailFrac)) / tailFrac;
      // Smooth tail taper with gradual blend
      const cosVal = Math.cos(tt * Math.PI * 0.5);
      r = radius * (cosVal * cosVal * 0.88 + 0.12 * (1 - tt * tt));
    } else {
      // Subtle barrel shape for body realism
      const bodyT = (t - noseFrac) / (1 - noseFrac - tailFrac);
      r = radius * (1 + 0.015 * Math.sin(bodyT * Math.PI));
    }
    points.push(new THREE.Vector2(Math.max(r, 0.015), (t - 0.5) * length));
  }

  const geo = new THREE.LatheGeometry(points, segments || 20);
  geo.rotateX(Math.PI / 2);
  return geo;
}

function createTaperedWing(span, rootChord, tipChord, sweep, rootThick, tipThick, dihedral) {
  const halfSpan = span / 2;
  // NACA thickness ratio (rootThick is max half-thickness in meters)
  const t = Math.max(0.04, (rootThick * 2.2) / rootChord);
  const m = 0.02; // max camber (NACA 2412)
  const p = 0.4;  // max camber position
  const profileN = 18; // points per surface

  // NACA 4-digit helper: thickness at chord fraction xn (0=LE, 1=TE)
  function nacaHT(xn) {
    return 5 * t * (0.2969 * Math.sqrt(Math.max(0, xn)) - 0.126 * xn
      - 0.3516 * xn * xn + 0.2843 * xn * xn * xn - 0.1015 * xn * xn * xn * xn);
  }
  function nacaCamber(xn) {
    return xn < p
      ? m / (p * p) * (2 * p * xn - xn * xn)
      : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * xn - xn * xn);
  }

  // Build NACA airfoil cross-section as THREE.Shape (XY plane)
  // X = chordwise (-rootChord/2 to +rootChord/2), Y = thickness
  const shape = new THREE.Shape();

  // Start at trailing edge
  const teY = nacaCamber(1);
  shape.moveTo(rootChord * 0.5, teY * rootChord);

  // Upper surface: TE → LE
  for (let i = profileN; i >= 0; i--) {
    const xn = i / profileN;
    const yt = nacaHT(xn);
    const yc = nacaCamber(xn);
    shape.lineTo((xn - 0.5) * rootChord, (yc + yt) * rootChord);
  }

  // Lower surface: LE → TE
  for (let i = 1; i <= profileN; i++) {
    const xn = i / profileN;
    const yt = nacaHT(xn);
    const yc = nacaCamber(xn);
    shape.lineTo((xn - 0.5) * rootChord, (yc - yt) * rootChord);
  }
  shape.closePath();

  // Extrude along Z (0 to span)
  const spanSteps = 14;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: false,
    steps: spanSteps,
  });

  // Transform vertices: ExtrudeGeometry axes → wing axes
  // Extrude coords: X=chord, Y=thickness, Z=span(0→span)
  // Wing coords:    X=span(centered), Y=thickness, Z=chord
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const cx = pos.getX(i); // chord
    const ty = pos.getY(i); // thickness
    const sz = pos.getZ(i); // span (0→span)

    const spanCentered = sz - halfSpan;
    const sf = Math.abs(spanCentered) / halfSpan; // 0=root, 1=tip

    // Taper chord and thickness
    const taper = 1 - sf * (1 - tipChord / rootChord);
    const thickTaper = 1 - sf * (1 - tipThick / rootThick);

    // Wing tip rounding
    let tipRound = 1;
    if (sf > 0.92) tipRound = 1 - ((sf - 0.92) / 0.08) * 0.3;

    pos.setX(i, spanCentered);
    pos.setY(i, ty * thickTaper * tipRound + Math.abs(spanCentered) * Math.tan(dihedral || 0.03));
    pos.setZ(i, cx * taper + sf * sweep);
  }

  geo.computeVertexNormals();
  return geo;
}


function createCockpitSurfaceTexture(isHighDetail) {
  const size = isHighDetail ? 768 : 384;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#232529';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 40 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v},0.2)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  ctx.strokeStyle = 'rgba(120,125,138,0.24)';
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += Math.floor(size / 12)) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function createSeatFabricTexture(isHighDetail) {
  const size = isHighDetail ? 512 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1f2333';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const v = 55 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v + 12},0.22)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  ctx.strokeStyle = 'rgba(150,160,180,0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const y = ((i + 1) / 8) * size;
    ctx.beginPath();
    ctx.moveTo(size * 0.08, y);
    ctx.lineTo(size * 0.92, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  return tex;
}

function createNacelle(scene, group, x, y, z, radius, length, mat, chromeMat, detailLevel = 'medium') {
  // Nacelle body
  const nacPts = [];
  const ns = 12;
  for (let i = 0; i <= ns; i++) {
    const t = i / ns;
    let r;
    if (t < 0.15) {
      r = radius * (0.7 + 0.3 * (t / 0.15)); // intake lip
    } else if (t > 0.85) {
      r = radius * (1 - (t - 0.85) / 0.15 * 0.3); // exhaust taper
    } else {
      r = radius;
    }
    nacPts.push(new THREE.Vector2(r, (t - 0.5) * length));
  }
  const nacGeo = new THREE.LatheGeometry(nacPts, 14);
  nacGeo.rotateX(Math.PI / 2);
  const nac = new THREE.Mesh(nacGeo, mat);
  nac.position.set(x, y, z);
  nac.castShadow = true;
  group.add(nac);

  // Intake ring highlight
  const ringGeo = new THREE.TorusGeometry(radius * 0.95, radius * 0.08, 8, 20);
  const ring = new THREE.Mesh(ringGeo, chromeMat);
  ring.position.set(x, y, z - length * 0.48);
  group.add(ring);

  // Fan face (dark circle)
  const fanGeo = new THREE.CircleGeometry(radius * 0.85, 16);
  const fanMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.4 });
  const fan = new THREE.Mesh(fanGeo, fanMat);
  fan.position.set(x, y, z - length * 0.47);
  fan.rotation.y = Math.PI;
  group.add(fan);

  // Spinning fan blades for jet realism
  const fanGroup = new THREE.Group();
  fanGroup.position.set(x, y, z - length * 0.46);
  fanGroup.rotation.y = Math.PI;
  const bladeCount = detailLevel === 'high' ? 22 : (detailLevel === 'low' ? 12 : 16);
  const bladeGeo = new THREE.BoxGeometry(radius * 0.06, radius * 0.6, radius * 0.02);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.35, metalness: 0.75 });
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    const a = (i / bladeCount) * Math.PI * 2;
    blade.position.set(Math.cos(a) * radius * 0.44, Math.sin(a) * radius * 0.44, 0);
    blade.rotation.z = a;
    blade.rotation.x = 0.3;
    fanGroup.add(blade);
  }
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.12, radius * 0.2, radius * 0.16, detailLevel === 'high' ? 18 : 12),
    chromeMat
  );
  hub.rotation.x = Math.PI / 2;
  fanGroup.add(hub);
  group.add(fanGroup);
  engineFanGroups.push(fanGroup);

  // Exhaust (slightly glowing inner ring)
  const exGeo = new THREE.CircleGeometry(radius * 0.65, 12);
  const exMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.2 });
  const ex = new THREE.Mesh(exGeo, exMat);
  ex.position.set(x, y, z + length * 0.49);
  group.add(ex);

  // Pylon connecting nacelle to wing
  const pylonGeo = new THREE.BoxGeometry(0.15, Math.abs(y) * 0.4, length * 0.6);
  const pylon = new THREE.Mesh(pylonGeo, mat);
  pylon.position.set(x, y + Math.abs(y) * 0.25, z + length * 0.1);
  group.add(pylon);
}

// ─── Main model builder ───

// ─── Main model builder ───

function getAircraftDetailConfig() {
  const assetQuality = isSettingExplicit('assetQuality') ? getSetting('assetQuality') : getSetting('graphicsQuality');
  const isLowDetail = assetQuality === 'low';
  const isHighDetail = assetQuality === 'high';

  return {
    assetQuality,
    isLowDetail,
    isHighDetail,
    fuselageSegments: isLowDetail ? 16 : (isHighDetail ? 42 : 28),
    wingSegments: isLowDetail ? 10 : (isHighDetail ? 26 : 18),
    canopySegments: isLowDetail ? 12 : (isHighDetail ? 30 : 20),
    roundSegments: isLowDetail ? 10 : (isHighDetail ? 24 : 16),
  };
}

function resolveAircraftVariant(type) {
  if (type.name === 'Cessna 172') return 'cessna_172';
  if (type.name === 'Boeing 737') return 'boeing_737';
  if (type.name === 'Airbus A340' || type.name === 'Airbus A320') return 'airbus_a320';
  if (type.name === 'F-16 Falcon') return 'f16';

  if (type.type === 'fighter') return 'f16';
  if (type.type === 'prop') return 'cessna_172';
  return 'boeing_737';
}

function createAircraftMaterialSet(type, detail, variant) {
  const isLowDetail = detail.isLowDetail;
  const isHighDetail = detail.isHighDetail;

  const fighterPrimary = 0x6e747b;
  const fighterAccent = 0x4e545a;
  const baseColor = variant === 'f16' ? fighterPrimary : type.color;
  const accentColor = variant === 'f16' ? fighterAccent : type.accentColor;

  const bodyMat = isHighDetail
    ? new THREE.MeshPhysicalMaterial({
      color: baseColor,
      roughness: variant === 'f16' ? 0.42 : 0.15,
      metalness: variant === 'f16' ? 0.08 : 0.28,
      clearcoat: variant === 'f16' ? 0.35 : 1.0,
      clearcoatRoughness: variant === 'f16' ? 0.35 : 0.1,
      envMapIntensity: variant === 'f16' ? 1.2 : 2.0,
    })
    : new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: isLowDetail ? 0.46 : 0.25,
      metalness: variant === 'f16' ? 0.05 : 0.18,
      envMapIntensity: 1.5,
    });

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: variant === 'f16' ? 0.56 : (isLowDetail ? 0.52 : 0.28),
    metalness: variant === 'f16' ? 0.05 : 0.25,
    envMapIntensity: 1.5,
  });

  const bareMetalMat = new THREE.MeshStandardMaterial({
    color: 0xc1c7cf,
    roughness: isLowDetail ? 0.25 : 0.16,
    metalness: 0.82,
  });

  const darkMat = new THREE.MeshStandardMaterial({
    color: variant === 'f16' ? 0x2f343b : 0x1d1f24,
    roughness: isLowDetail ? 0.78 : 0.62,
    metalness: 0.26,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x101114,
    roughness: 0.92,
    metalness: 0.02,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: variant === 'f16' ? 0x8ec4ae : 0x98c2d8,
    roughness: variant === 'f16' ? 0.06 : 0.1,
    metalness: 0.02,
    transmission: isLowDetail ? 0.12 : (variant === 'f16' ? 0.28 : 0.22),
    thickness: variant === 'f16' ? 0.06 : 0.03,
    ior: 1.48,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07,
    transparent: true,
    opacity: variant === 'f16' ? 0.26 : 0.34,
    side: THREE.DoubleSide,
  });

  const panelLineMat = new THREE.MeshStandardMaterial({
    color: variant === 'f16' ? 0x373c43 : 0x90959c,
    roughness: 0.7,
    metalness: 0.2,
  });

  const controlSurfaceMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: variant === 'f16' ? 0.54 : 0.36,
    metalness: variant === 'f16' ? 0.06 : 0.12,
  });

  // Apply sky-only envMap for PBR reflections (aircraft only, not scene-wide)
  const envMap = getEnvironmentMap();
  if (envMap) {
    bodyMat.envMap = envMap;
    accentMat.envMap = envMap;
    bareMetalMat.envMap = envMap;
    controlSurfaceMat.envMap = envMap;
  }

  return {
    bodyMat,
    accentMat,
    bareMetalMat,
    darkMat,
    tireMat,
    glassMat,
    panelLineMat,
    controlSurfaceMat,
  };
}

function markShadow(mesh, cast = true, receive = false) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function addJetCabinWindows(group, config) {
  const {
    fLen,
    fRad,
    detail,
  } = config;

  const windowRadius = fLen * 0.0046;
  const sideY = fRad * 0.33;
  const startZ = -fLen * 0.24;
  const endZ = fLen * 0.29;
  const step = detail.isLowDetail ? fLen * 0.073 : (detail.isHighDetail ? fLen * 0.035 : fLen * 0.048);
  const perSide = Math.max(2, Math.floor((endZ - startZ) / step) + 1);
  const total = perSide * 2;

  const segs = detail.roundSegments;
  const glassGeo = new THREE.CircleGeometry(windowRadius, segs);
  glassGeo.scale(1.0, 0.72, 1.0);
  const frameGeo = new THREE.RingGeometry(windowRadius * 0.82, windowRadius * 1.15, segs);
  frameGeo.scale(1.0, 0.72, 1.0);
  const innerGeo = new THREE.CircleGeometry(windowRadius * 0.78, segs);
  innerGeo.scale(1.0, 0.7, 1.0);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9dbdd0,
    roughness: 0.08,
    metalness: 0.06,
    transmission: detail.isLowDetail ? 0.12 : 0.2,
    thickness: 0.02,
    clearcoat: 0.9,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xa7aeb8,
    roughness: 0.5,
    metalness: 0.32,
  });
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x1e2631,
    emissive: 0x2f5a84,
    emissiveIntensity: 0.08,
    roughness: 0.45,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  cabinWindowMaterials.push(innerMat);

  const glassInst = new THREE.InstancedMesh(glassGeo, glassMat, total);
  const frameInst = new THREE.InstancedMesh(frameGeo, frameMat, total);
  const innerInst = new THREE.InstancedMesh(innerGeo, innerMat, total);

  const rightQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const leftQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  const tmpMatrix = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const unitScale = new THREE.Vector3(1, 1, 1);

  let index = 0;
  for (let i = 0; i < perSide; i++) {
    const z = startZ + i * step;
    tmpPos.set(-fRad + 0.004, sideY, z);
    tmpMatrix.compose(tmpPos, leftQ, unitScale);
    glassInst.setMatrixAt(index, tmpMatrix);
    frameInst.setMatrixAt(index, tmpMatrix);
    tmpPos.set(-fRad + 0.018, sideY, z);
    tmpMatrix.compose(tmpPos, leftQ, unitScale);
    innerInst.setMatrixAt(index, tmpMatrix);
    index++;

    tmpPos.set(fRad - 0.004, sideY, z);
    tmpMatrix.compose(tmpPos, rightQ, unitScale);
    glassInst.setMatrixAt(index, tmpMatrix);
    frameInst.setMatrixAt(index, tmpMatrix);
    tmpPos.set(fRad - 0.018, sideY, z);
    tmpMatrix.compose(tmpPos, rightQ, unitScale);
    innerInst.setMatrixAt(index, tmpMatrix);
    index++;
  }

  glassInst.instanceMatrix.needsUpdate = true;
  frameInst.instanceMatrix.needsUpdate = true;
  innerInst.instanceMatrix.needsUpdate = true;

  group.add(innerInst);
  group.add(frameInst);
  group.add(glassInst);
}

function addControlSurfacePair(surfaceGeo, material, sideOffset, y, z, spanFrac) {
  rightAileron = markShadow(new THREE.Mesh(surfaceGeo, material));
  rightAileron.position.set(sideOffset * spanFrac, y, z);
  aircraftGroup.add(rightAileron);

  leftAileron = markShadow(new THREE.Mesh(surfaceGeo, material));
  leftAileron.position.set(-sideOffset * spanFrac, y, z);
  aircraftGroup.add(leftAileron);
}

function buildCessnaExterior(type, detail, mats) {
  const fLen = type.fuselageLength * 1.08;
  const fRad = type.fuselageRadius * 0.56;
  const wSpan = type.wingSpan;

  const fuselage = markShadow(new THREE.Mesh(
    createFuselageGeo(fLen, fRad, fLen * 0.24, fLen * 0.2, detail.fuselageSegments),
    mats.bodyMat
  ));
  fuselage.scale.set(1.12, 0.92, 1.0); // wider oval cabin cross-section
  aircraftGroup.add(fuselage);
  exteriorBodyParts.push(fuselage);

  // Boxy cabin section (distinctive Cessna 172 rectangular upper fuselage)
  {
    const cbW = fRad * 0.88, cbH = fRad * 0.52, cbL = fLen * 0.26;
    const cabGeo = new THREE.BoxGeometry(cbW * 2, cbH, cbL, 4, 2, 4);
    const cp = cabGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      const x = cp.getX(i);
      const z = cp.getZ(i);
      // Round the top edges for smoother blend
      if (y > cbH * 0.2) {
        const edgeDist = Math.max(Math.abs(x) / cbW - 0.6, 0) / 0.4;
        cp.setY(i, y - edgeDist * edgeDist * cbH * 0.3);
      }
      // Taper front and back
      const zFrac = (z / cbL + 0.5);
      if (zFrac < 0.15) {
        const t = zFrac / 0.15;
        cp.setX(i, x * (0.7 + 0.3 * t));
        cp.setY(i, cp.getY(i) * (0.6 + 0.4 * t));
      } else if (zFrac > 0.85) {
        const t = (1 - zFrac) / 0.15;
        cp.setX(i, x * (0.7 + 0.3 * t));
        cp.setY(i, cp.getY(i) * (0.6 + 0.4 * t));
      }
    }
    cabGeo.computeVertexNormals();
    const cabin = markShadow(new THREE.Mesh(cabGeo, mats.bodyMat));
    cabin.position.set(0, fRad * 0.46, -fLen * 0.12);
    aircraftGroup.add(cabin);
    exteriorBodyParts.push(cabin);
  }

  // Engine cowling (rounded nose cone shape)
  const cowlPts = [];
  for (let ci = 0; ci <= 10; ci++) {
    const ct = ci / 10;
    const cr = fRad * (ct < 0.3 ? 0.58 + ct * 0.4 : (ct > 0.8 ? 0.72 - (ct - 0.8) * 0.2 : 0.7));
    cowlPts.push(new THREE.Vector2(cr, (ct - 0.5) * fLen * 0.18));
  }
  const cowlGeo = new THREE.LatheGeometry(cowlPts, detail.roundSegments);
  cowlGeo.rotateX(Math.PI / 2);
  const cowl = markShadow(new THREE.Mesh(cowlGeo, mats.darkMat));
  cowl.position.z = -fLen * 0.5;
  aircraftGroup.add(cowl);
  exteriorBodyParts.push(cowl);

  const wingY = fRad * 0.78;
  const wingZ = -fLen * 0.06;
  const rootChord = fLen * 0.235;
  const tipChord = rootChord * 0.64;
  const wingGeo = createTaperedWing(wSpan, rootChord, tipChord, rootChord * 0.08, 0.17, 0.08, 0.025);
  const wing = markShadow(new THREE.Mesh(wingGeo, mats.bodyMat));
  wing.position.set(0, wingY, wingZ);
  aircraftGroup.add(wing);

  const strutLen = fRad * 2.05;
  for (const side of [-1, 1]) {
    const strut = markShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.03, strutLen, detail.isLowDetail ? 5 : 8),
      mats.bareMetalMat
    ));
    strut.position.set(side * wSpan * 0.21, fRad * 0.02, wingZ + rootChord * 0.1);
    strut.rotation.z = side * 0.24;
    aircraftGroup.add(strut);
  }

  const flapTrackGeo = new THREE.ConeGeometry(0.06, 0.22, detail.isLowDetail ? 6 : 10);
  flapTrackGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const frac of [0.22, 0.36]) {
      const fairing = markShadow(new THREE.Mesh(flapTrackGeo, mats.panelLineMat));
      fairing.position.set(side * wSpan * frac, wingY - 0.09, wingZ + rootChord * 0.35);
      aircraftGroup.add(fairing);
    }
  }

  const aileronGeo = new THREE.BoxGeometry(wSpan * 0.2, 0.045, rootChord * 0.18);
  addControlSurfacePair(aileronGeo, mats.controlSurfaceMat, wSpan, wingY - 0.03, wingZ + rootChord * 0.34, 0.35);

  const tailZ = fLen * 0.42;
  const hStabSpan = wSpan * 0.38;
  const hStabChord = fLen * 0.13;
  const hStabGeo = createTaperedWing(hStabSpan, hStabChord, hStabChord * 0.62, 0.02, 0.07, 0.04, 0.01);
  const hStab = markShadow(new THREE.Mesh(hStabGeo, mats.bodyMat));
  hStab.position.set(0, fRad * 0.16, tailZ);
  aircraftGroup.add(hStab);

  elevator = markShadow(new THREE.Mesh(
    new THREE.BoxGeometry(hStabSpan * 0.72, 0.04, hStabChord * 0.28),
    mats.controlSurfaceMat
  ));
  elevator.position.set(0, fRad * 0.15, tailZ + hStabChord * 0.42);
  aircraftGroup.add(elevator);

  const vStabGeo = new THREE.BoxGeometry(0.09, type.tailHeight * 0.95, fLen * 0.18, 1, 4, 2);
  const vPos = vStabGeo.attributes.position;
  for (let i = 0; i < vPos.count; i++) {
    const y = vPos.getY(i);
    if (y > 0) {
      vPos.setZ(i, vPos.getZ(i) - y * 0.2);
    }
  }
  vStabGeo.computeVertexNormals();
  const vStab = markShadow(new THREE.Mesh(vStabGeo, mats.accentMat));
  vStab.position.set(0, fRad * 0.2 + type.tailHeight * 0.45, tailZ - fLen * 0.03);
  aircraftGroup.add(vStab);

  rudder = markShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.075, type.tailHeight * 0.62, fLen * 0.07),
    mats.controlSurfaceMat
  ));
  rudder.position.set(0, fRad * 0.2 + type.tailHeight * 0.34, tailZ + fLen * 0.07);
  aircraftGroup.add(rudder);

  // Cessna windshield — large wrap-around with prominent frames
  const wsFrameMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.55, metalness: 0.3 });
  const cessnaGlass = new THREE.MeshPhysicalMaterial({
    color: 0x88bbdd, roughness: 0.03, metalness: 0.02,
    transmission: 0.5, thickness: 0.4, clearcoat: 1.0,
    clearcoatRoughness: 0.02, transparent: true, opacity: 0.35,
    envMapIntensity: 2.5, side: THREE.DoubleSide, depthWrite: false,
  });

  // Front windshield — 2 large curved panels (Cessna has a WIDE wrap-around)
  for (const side of [-1, 1]) {
    const panelGeo = new THREE.PlaneGeometry(fRad * 0.82, fRad * 0.62, 5, 5);
    const pp = panelGeo.attributes.position;
    for (let j = 0; j < pp.count; j++) {
      const px = pp.getX(j);
      pp.setZ(j, -px * px * 0.4 - Math.abs(px) * 0.06);
    }
    panelGeo.computeVertexNormals();
    const panel = new THREE.Mesh(panelGeo, cessnaGlass);
    panel.position.set(side * fRad * 0.38, fRad * 0.72, -fLen * 0.26);
    panel.rotation.set(-0.48, side * 0.28, 0);
    aircraftGroup.add(panel);
  }

  // Thin center windshield post only (no top/bottom bars that block cockpit view)
  const wsCenter = markShadow(new THREE.Mesh(new THREE.BoxGeometry(0.012, fRad * 0.55, 0.012), wsFrameMat));
  wsCenter.position.set(0, fRad * 0.73, -fLen * 0.26);
  wsCenter.rotation.x = -0.48;
  aircraftGroup.add(wsCenter);
  exteriorBodyParts.push(wsCenter);

  // Side windows (large, with visible frames)
  for (const side of [-1, 1]) {
    // Main side window
    const sideWinGeo = new THREE.PlaneGeometry(fLen * 0.14, fRad * 0.6, 3, 3);
    const swp = sideWinGeo.attributes.position;
    for (let j = 0; j < swp.count; j++) swp.setZ(j, swp.getY(j) * swp.getY(j) * 0.15);
    sideWinGeo.computeVertexNormals();
    const sideWin = new THREE.Mesh(sideWinGeo, cessnaGlass);
    sideWin.position.set(side * (fRad * 0.78), fRad * 0.56, -fLen * 0.18);
    sideWin.rotation.y = side * Math.PI * 0.5;
    aircraftGroup.add(sideWin);

    // Rear quarter window
    const rearWin = new THREE.Mesh(new THREE.PlaneGeometry(fLen * 0.16, fRad * 0.56), cessnaGlass);
    rearWin.position.set(side * (fRad * 0.78), fRad * 0.48, -fLen * 0.02);
    rearWin.rotation.y = side * Math.PI * 0.5;
    aircraftGroup.add(rearWin);
  }

  // Rear window
  {
    const rearPanelGeo = new THREE.PlaneGeometry(fRad * 1.1, fRad * 0.4);
    const rearPanel = new THREE.Mesh(rearPanelGeo, cessnaGlass);
    rearPanel.position.set(0, fRad * 0.52, fLen * 0.06);
    rearPanel.rotation.x = 0.3;
    aircraftGroup.add(rearPanel);
  }

  // Cheatline stripe (wider, more visible livery band)
  const stripeGeo = new THREE.CylinderGeometry(fRad * 1.01, fRad * 0.98, fLen * 0.65, detail.roundSegments, 1, false, -0.55, 0.92);
  stripeGeo.rotateX(Math.PI / 2);
  const stripe = new THREE.Mesh(stripeGeo, mats.accentMat);
  stripe.position.z = -fLen * 0.04;
  aircraftGroup.add(stripe);
  exteriorBodyParts.push(stripe);
  // Thin accent pinstripe above main stripe
  const pinstripeGeo = new THREE.CylinderGeometry(fRad * 1.015, fRad * 0.99, fLen * 0.6, detail.roundSegments, 1, false, -0.65, 0.12);
  pinstripeGeo.rotateX(Math.PI / 2);
  const accentThin = new THREE.MeshStandardMaterial({
    color: 0xcc2222, roughness: 0.3, metalness: 0.15,
  });
  const pinstripe = new THREE.Mesh(pinstripeGeo, accentThin);
  pinstripe.position.z = -fLen * 0.04;
  aircraftGroup.add(pinstripe);
  exteriorBodyParts.push(pinstripe);

  propeller = new THREE.Group();
  // Spinner (polished chrome nose cone)
  const spinnerPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const r = fRad * 0.24 * Math.cos(t * Math.PI * 0.5);
    spinnerPts.push(new THREE.Vector2(Math.max(r, 0.005), (t - 0.5) * fRad * 0.85));
  }
  const spinnerGeo = new THREE.LatheGeometry(spinnerPts, detail.roundSegments);
  spinnerGeo.rotateX(Math.PI / 2);
  const spinner = markShadow(new THREE.Mesh(spinnerGeo, mats.bareMetalMat));
  spinner.position.z = -fRad * 0.18;
  propeller.add(spinner);

  // Prop blades (wider, with proper airfoil twist)
  const propRadius = fRad * 3.8;
  const bladeGeo = new THREE.BoxGeometry(0.14, propRadius, 0.025, 1, detail.isLowDetail ? 6 : 12, 1);
  const bladePos = bladeGeo.attributes.position;
  for (let i = 0; i < bladePos.count; i++) {
    const y = bladePos.getY(i);
    const yFrac = y / propRadius;
    // Progressive twist and width taper
    bladePos.setX(i, bladePos.getX(i) + yFrac * 0.06);
    // Width taper near tip
    if (Math.abs(yFrac) > 0.85) {
      const tipT = (Math.abs(yFrac) - 0.85) / 0.15;
      bladePos.setX(i, bladePos.getX(i) * (1 - tipT * 0.5));
    }
  }
  bladeGeo.computeVertexNormals();

  const bladeCount = 2; // Cessna 172 has 2-blade prop
  for (let i = 0; i < bladeCount; i++) {
    const blade = markShadow(new THREE.Mesh(bladeGeo, mats.darkMat));
    blade.position.z = -0.02;
    blade.rotation.z = (i / bladeCount) * Math.PI * 2;
    propeller.add(blade);
  }

  // Prop disc (translucent spinning arc, visible when engine running)
  const discGeo = new THREE.RingGeometry(fRad * 0.28, propRadius, 32, 1);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x888888, transparent: true, opacity: 0.06,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.z = -0.02;
  propeller.add(disc);

  propeller.position.z = -fLen * 0.585;
  aircraftGroup.add(propeller);

  // ─── Cessna 172 detail features ───

  // Wheel pants (fairings) — THE defining Cessna 172 visual feature
  {
    const pantMat = mats.bodyMat;
    const pantProfile = [];
    const pn = 14;
    for (let i = 0; i <= pn; i++) {
      const t = i / pn;
      // Teardrop: fat at front (wheel area), tapers to rear
      const r = 0.15 * (t < 0.4
        ? 0.6 + 0.4 * Math.sin(t / 0.4 * Math.PI * 0.5)
        : Math.cos((t - 0.4) / 0.6 * Math.PI * 0.5));
      pantProfile.push(new THREE.Vector2(Math.max(r, 0.008), (t - 0.35) * 0.65));
    }
    const pantGeo = new THREE.LatheGeometry(pantProfile, 10);
    pantGeo.rotateX(Math.PI / 2);
    // Scale to teardrop shape (wider than tall)
    pantGeo.scale(0.85, 0.6, 1.0);
    // Main gear pants
    for (const side of [-1, 1]) {
      const pant = markShadow(new THREE.Mesh(pantGeo.clone(), pantMat));
      pant.position.set(side * (fRad + 0.64), -fRad * 0.85, wingZ + rootChord * 0.22);
      aircraftGroup.add(pant);
    }
    // Nose wheel pant (smaller)
    const nosePantGeo = pantGeo.clone();
    nosePantGeo.scale(0.75, 0.75, 0.8);
    const nosePant = markShadow(new THREE.Mesh(nosePantGeo, pantMat));
    nosePant.position.set(0, -fRad * 0.9, -fLen * 0.37);
    aircraftGroup.add(nosePant);
  }

  // Exhaust pipes (twin exhaust, both sides under cowl)
  for (const side of [-1, 1]) {
    const exhaustGeo = new THREE.CylinderGeometry(0.022, 0.03, fLen * 0.12, 8);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaustPipe = markShadow(new THREE.Mesh(exhaustGeo, mats.darkMat));
    exhaustPipe.position.set(side * fRad * 0.35, -fRad * 0.42, -fLen * 0.42);
    aircraftGroup.add(exhaustPipe);
  }

  // Wing tip fairings with nav light housings
  for (const side of [-1, 1]) {
    const tipGeo = new THREE.SphereGeometry(rootChord * 0.07, detail.roundSegments, 8);
    tipGeo.scale(1.4, 0.5, 2.2);
    const tip = markShadow(new THREE.Mesh(tipGeo, mats.bodyMat));
    const tipDihedralY = wingY + Math.abs(wSpan * 0.5) * Math.tan(0.025);
    tip.position.set(side * (wSpan * 0.5 + 0.02), tipDihedralY, wingZ + rootChord * 0.12);
    aircraftGroup.add(tip);
    // Nav light lens
    const lensGeo = new THREE.SphereGeometry(0.022, 8, 6);
    const lensMat = new THREE.MeshStandardMaterial({
      color: side < 0 ? 0xff0000 : 0x00ff00,
      emissive: side < 0 ? 0x880000 : 0x008800,
      emissiveIntensity: 0.4, transparent: true, opacity: 0.8,
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(side * (wSpan * 0.5 + 0.05), tipDihedralY, wingZ + rootChord * 0.12);
    aircraftGroup.add(lens);
  }

  // Pitot tube (left wing, prominent and visible)
  const pitotGeo = new THREE.CylinderGeometry(0.008, 0.006, 0.35, 6);
  pitotGeo.rotateZ(Math.PI / 2);
  const pitot = markShadow(new THREE.Mesh(pitotGeo, mats.bareMetalMat));
  pitot.position.set(-wSpan * 0.32, wingY - 0.06, wingZ - 0.02);
  aircraftGroup.add(pitot);


  // Ventral fin under tail
  const ventFinGeo = new THREE.BoxGeometry(0.035, fRad * 0.45, fLen * 0.06, 1, 2, 1);
  const vfPos = ventFinGeo.attributes.position;
  for (let i = 0; i < vfPos.count; i++) {
    if (vfPos.getY(i) < 0) vfPos.setZ(i, vfPos.getZ(i) + 0.03);
  }
  ventFinGeo.computeVertexNormals();
  const ventFin = markShadow(new THREE.Mesh(ventFinGeo, mats.bodyMat));
  ventFin.position.set(0, -fRad * 0.35, tailZ + fLen * 0.01);
  aircraftGroup.add(ventFin);

  // Cowl air intake with visible scoop shape
  {
    const scoopShape = new THREE.Shape();
    scoopShape.moveTo(-fRad * 0.15, 0);
    scoopShape.lineTo(-fRad * 0.12, 0.04);
    scoopShape.lineTo(fRad * 0.12, 0.04);
    scoopShape.lineTo(fRad * 0.15, 0);
    scoopShape.closePath();
    const scoopGeo = new THREE.ExtrudeGeometry(scoopShape, { depth: fLen * 0.08, bevelEnabled: false });
    scoopGeo.rotateX(Math.PI / 2);
    scoopGeo.translate(0, 0, fLen * 0.04);
    const scoop = markShadow(new THREE.Mesh(scoopGeo, mats.darkMat));
    scoop.position.set(0, fRad * 0.1, -fLen * 0.53);
    aircraftGroup.add(scoop);
  }

  // Landing/taxi light (on cowling, visible disc)
  {
    const lightGeo = new THREE.CircleGeometry(fRad * 0.12, 12);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 0.3,
      roughness: 0.1, metalness: 0.4,
    });
    const cowlLight = new THREE.Mesh(lightGeo, lightMat);
    cowlLight.position.set(0, -fRad * 0.2, -fLen * 0.56);
    aircraftGroup.add(cowlLight);
  }

  // Tail cone (tapered aft end)
  const tailConeGeo = new THREE.ConeGeometry(fRad * 0.22, fLen * 0.12, detail.roundSegments);
  tailConeGeo.rotateX(-Math.PI / 2);
  const tailCone = markShadow(new THREE.Mesh(tailConeGeo, mats.bodyMat));
  tailCone.position.set(0, fRad * 0.08, fLen * 0.52);
  aircraftGroup.add(tailCone);


  return {
    fuselageLength: fLen,
    fuselageRadius: fRad,
    wingSpan: wSpan,
    wingY,
    wingZ,
    rootChord,
    tailHeight: type.tailHeight,
    tailZ,
    mainGearSpread: fRad + 0.64,
    mainGearZ: wingZ + rootChord * 0.22,
    noseGearZ: -fLen * 0.37,
    landingLightPos: new THREE.Vector3(0, -fRad * 0.16, -fLen * 0.47),
    navLeftPos: new THREE.Vector3(-wSpan * 0.5, wingY + 0.02, wingZ + rootChord * 0.05),
    navRightPos: new THREE.Vector3(wSpan * 0.5, wingY + 0.02, wingZ + rootChord * 0.05),
    strobeLeftPos: new THREE.Vector3(-wSpan * 0.5, wingY + 0.04, wingZ + rootChord * 0.24),
    strobeRightPos: new THREE.Vector3(wSpan * 0.5, wingY + 0.04, wingZ + rootChord * 0.24),
    beaconPos: new THREE.Vector3(0, fRad * 0.42 + type.tailHeight, tailZ - fLen * 0.02),
    tailLogoPos: new THREE.Vector3(0, fRad * 0.34 + type.tailHeight * 0.52, tailZ + 0.3),
  };
}

function buildJetExterior(type, detail, mats, variant, scene) {
  const isA320 = variant === 'airbus_a320';
  const fLen = type.fuselageLength * (isA320 ? 1.02 : 1.0);
  const fRad = type.fuselageRadius * 0.92;
  const wSpan = type.wingSpan * (isA320 ? 1.04 : 1.0);

  const fuselage = markShadow(new THREE.Mesh(
    createFuselageGeo(fLen, fRad, fLen * 0.22, fLen * 0.2, detail.fuselageSegments),
    mats.bodyMat
  ));
  fuselage.scale.set(0.98, 1.02, 1.0); // slight oval cross-section (airliner)
  aircraftGroup.add(fuselage);

  // Track fuselage for cockpit visibility toggling
  exteriorBodyParts.push(fuselage);

  // Window band / cheatline (THE defining airliner livery element)
  {
    // Main cheatline stripe (colored band at window level)
    const cheatGeo = new THREE.CylinderGeometry(
      fRad * 1.008, fRad * 0.99, fLen * 0.72, detail.roundSegments, 1, false,
      -0.38, 0.68
    );
    cheatGeo.rotateX(Math.PI / 2);
    const cheatline = new THREE.Mesh(cheatGeo, mats.accentMat);
    cheatline.position.z = fLen * 0.01;
    aircraftGroup.add(cheatline);
    exteriorBodyParts.push(cheatline);

    // Thin gold/gray pinstripe below cheatline
    const pinGeo = new THREE.CylinderGeometry(
      fRad * 1.01, fRad * 0.995, fLen * 0.68, detail.roundSegments, 1, false,
      -0.2, 0.12
    );
    pinGeo.rotateX(Math.PI / 2);
    const pinMat = new THREE.MeshStandardMaterial({
      color: isA320 ? 0xccaa33 : 0x888888, roughness: 0.25, metalness: 0.3,
    });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.position.z = fLen * 0.01;
    aircraftGroup.add(pin);
    exteriorBodyParts.push(pin);
  }


  const wingY = -fRad * 0.15;
  const wingZ = -fLen * 0.03;
  const rootChord = fLen * (isA320 ? 0.285 : 0.275);
  const tipChord = rootChord * (isA320 ? 0.3 : 0.32);
  const wingGeo = createTaperedWing(
    wSpan,
    rootChord,
    tipChord,
    rootChord * (isA320 ? 0.68 : 0.74),
    0.17,
    0.07,
    0.095
  );
  const wing = markShadow(new THREE.Mesh(wingGeo, mats.bodyMat));
  wing.position.set(0, wingY, wingZ);
  aircraftGroup.add(wing);

  // Center belly fairing (wing-to-body fairing, large bulge visible from side)
  {
    const bfGeo = new THREE.SphereGeometry(fRad * 0.5, detail.roundSegments, 10);
    bfGeo.scale(2.0, 0.42, 3.5);
    const bellFair = markShadow(new THREE.Mesh(bfGeo, mats.bodyMat));
    bellFair.position.set(0, -fRad * 0.65, wingZ + rootChord * 0.15);
    aircraftGroup.add(bellFair);
  }

  // Cockpit eyebrow visor (dark section above cockpit windows)
  {
    const visorGeo = new THREE.CylinderGeometry(
      fRad * 1.012, fRad * 1.005, fLen * 0.06, detail.roundSegments, 1, false,
      -0.85, 1.65
    );
    visorGeo.rotateX(Math.PI / 2);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d22, roughness: 0.7, metalness: 0.15,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.z = -fLen * 0.36;
    aircraftGroup.add(visor);
    exteriorBodyParts.push(visor);
  }

  for (const side of [-1, 1]) {
    const fairGeo = new THREE.SphereGeometry(fRad * 0.75, detail.roundSegments, Math.max(6, detail.roundSegments - 4));
    fairGeo.scale(1.2, 0.52, 2.15);
    const fairing = markShadow(new THREE.Mesh(fairGeo, mats.bodyMat));
    fairing.position.set(side * fRad * 0.48, wingY + 0.03, wingZ + rootChord * 0.14);
    aircraftGroup.add(fairing);
  }

  const fairingGeo = new THREE.ConeGeometry(0.11, 0.5, detail.isLowDetail ? 8 : 12);
  fairingGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const frac of [0.22, 0.39, 0.56]) {
      const flapFairing = markShadow(new THREE.Mesh(fairingGeo, mats.panelLineMat));
      flapFairing.position.set(side * wSpan * frac, wingY - 0.12, wingZ + rootChord * 0.37 + frac * 0.06);
      aircraftGroup.add(flapFairing);
    }
  }

  const wingletHeight = isA320 ? rootChord * 0.95 : rootChord * 0.58;
  for (const side of [-1, 1]) {
    const wingletGeo = new THREE.BoxGeometry(0.09, wingletHeight, rootChord * 0.28, 1, 3, 2);
    const wlPos = wingletGeo.attributes.position;
    for (let i = 0; i < wlPos.count; i++) {
      if (wlPos.getY(i) > 0) {
        wlPos.setX(i, wlPos.getX(i) + side * wingletHeight * 0.14);
        wlPos.setZ(i, wlPos.getZ(i) - wingletHeight * 0.1);
      }
    }
    wingletGeo.computeVertexNormals();
    const winglet = markShadow(new THREE.Mesh(wingletGeo, mats.accentMat));
    const tipY = wingY + Math.tan(0.095) * (wSpan * 0.5);
    winglet.position.set(side * (wSpan * 0.5 + 0.02), tipY + wingletHeight * 0.45, wingZ + rootChord * 0.57);
    aircraftGroup.add(winglet);
  }

  const aileronGeo = new THREE.BoxGeometry(wSpan * 0.18, 0.05, rootChord * 0.2);
  addControlSurfacePair(aileronGeo, mats.controlSurfaceMat, wSpan, wingY - 0.03, wingZ + rootChord * 0.38, 0.34);

  const tailZ = fLen * 0.42;
  const hSpan = wSpan * (isA320 ? 0.32 : 0.31);
  const hChord = fLen * 0.12;
  const hStab = markShadow(new THREE.Mesh(
    createTaperedWing(hSpan, hChord, hChord * 0.58, hChord * 0.35, 0.08, 0.05, 0.02),
    mats.bodyMat
  ));
  hStab.position.set(0, fRad * 0.2, tailZ);
  aircraftGroup.add(hStab);

  elevator = markShadow(new THREE.Mesh(
    new THREE.BoxGeometry(hSpan * 0.7, 0.045, hChord * 0.28),
    mats.controlSurfaceMat
  ));
  elevator.position.set(0, fRad * 0.19, tailZ + hChord * 0.42);
  aircraftGroup.add(elevator);

  const vStabGeo = new THREE.BoxGeometry(0.1, type.tailHeight * 1.05, fLen * 0.19, 1, 5, 2);
  const vPos = vStabGeo.attributes.position;
  for (let i = 0; i < vPos.count; i++) {
    const y = vPos.getY(i);
    if (y > 0) {
      vPos.setZ(i, vPos.getZ(i) - y * 0.24);
    }
  }
  vStabGeo.computeVertexNormals();
  const vStab = markShadow(new THREE.Mesh(vStabGeo, mats.accentMat));
  vStab.position.set(0, fRad * 0.25 + type.tailHeight * 0.55, tailZ - fLen * 0.02);
  aircraftGroup.add(vStab);

  rudder = markShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.08, type.tailHeight * 0.7, fLen * 0.07),
    mats.controlSurfaceMat
  ));
  rudder.position.set(0, fRad * 0.27 + type.tailHeight * 0.48, tailZ + fLen * 0.08);
  aircraftGroup.add(rudder);

  // Cockpit windshield — large, prominent panels with reflective glass
  const wsFrameMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.5, metalness: 0.35 });
  const cockpitGlass = new THREE.MeshPhysicalMaterial({
    color: 0x6699bb, roughness: 0.02, metalness: 0.05,
    transmission: 0.45, thickness: 0.3, clearcoat: 1.0,
    clearcoatRoughness: 0.02, transparent: true, opacity: 0.38,
    envMapIntensity: 3.0, side: THREE.DoubleSide, depthWrite: false,
  });

  const windshieldBaseZ = -fLen * 0.37;
  const windshieldY = fRad * 0.5;

  // 6-panel cockpit windshield (scaled up 25% for visibility)
  for (const side of [-1, 1]) {
    // Front V-panels (curved, larger)
    const fpGeo = new THREE.PlaneGeometry(fRad * 0.42, fRad * 0.38, 4, 4);
    const fpP = fpGeo.attributes.position;
    for (let j = 0; j < fpP.count; j++) fpP.setZ(j, -fpP.getX(j) * fpP.getX(j) * 0.32);
    fpGeo.computeVertexNormals();
    const fp = new THREE.Mesh(fpGeo, cockpitGlass);
    fp.position.set(side * fRad * 0.22, windshieldY + 0.12, windshieldBaseZ - 0.06);
    fp.rotation.set(-0.65, side * 0.16, 0);
    aircraftGroup.add(fp);

    // Side panels (angled outward, larger)
    const spGeo = new THREE.PlaneGeometry(fRad * 0.34, fRad * 0.36, 4, 4);
    const spP = spGeo.attributes.position;
    for (let j = 0; j < spP.count; j++) spP.setZ(j, -spP.getX(j) * spP.getX(j) * 0.28);
    spGeo.computeVertexNormals();
    const sp = new THREE.Mesh(spGeo, cockpitGlass);
    sp.position.set(side * fRad * 0.52, windshieldY + 0.08, windshieldBaseZ + 0.02);
    sp.rotation.set(-0.48, side * 0.6, 0);
    aircraftGroup.add(sp);

    // Quarter/eyebrow panels (larger)
    const qpGeo = new THREE.PlaneGeometry(fRad * 0.26, fRad * 0.2, 2, 2);
    const qp = new THREE.Mesh(qpGeo, cockpitGlass);
    qp.position.set(side * fRad * 0.62, windshieldY + 0.18, windshieldBaseZ + 0.08);
    qp.rotation.set(-0.32, side * 0.78, 0);
    aircraftGroup.add(qp);
  }

  // Windshield frame dividers (thicker, more visible)
  const wsCenterPost = markShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.028, fRad * 0.4, 0.028), wsFrameMat
  ));
  wsCenterPost.position.set(0, windshieldY + 0.12, windshieldBaseZ - 0.04);
  wsCenterPost.rotation.x = -0.65;
  aircraftGroup.add(wsCenterPost);
  exteriorBodyParts.push(wsCenterPost);

  for (const side of [-1, 1]) {
    const innerPost = markShadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.025, fRad * 0.38, 0.025), wsFrameMat
    ));
    innerPost.position.set(side * fRad * 0.38, windshieldY + 0.1, windshieldBaseZ - 0.01);
    innerPost.rotation.set(-0.55, side * 0.3, 0);
    aircraftGroup.add(innerPost);
    exteriorBodyParts.push(innerPost);

    const outerPost = markShadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.025, fRad * 0.35, 0.025), wsFrameMat
    ));
    outerPost.position.set(side * fRad * 0.58, windshieldY + 0.1, windshieldBaseZ + 0.03);
    outerPost.rotation.set(-0.42, side * 0.52, 0);
    aircraftGroup.add(outerPost);
    exteriorBodyParts.push(outerPost);
  }

  addJetCabinWindows(aircraftGroup, { fLen, fRad, detail });

  const engineY = wingY - fRad * 0.68;
  const engineZ = wingZ + rootChord * 0.02;
  const nacelleRadius = fRad * (isA320 ? 0.46 : 0.50);
  const nacelleLength = fLen * (isA320 ? 0.24 : 0.26);
  const detailLevel = detail.isHighDetail ? 'high' : (detail.isLowDetail ? 'low' : 'medium');
  if (type.engineCount === 4) {
    // 4-engine layout (A340 style): inner pair + outer pair
    const innerSpacing = wSpan * 0.2;
    const outerSpacing = wSpan * 0.37;
    for (const side of [-1, 1]) {
      createNacelle(scene, aircraftGroup, side * innerSpacing, engineY, engineZ, nacelleRadius, nacelleLength, mats.darkMat, mats.bareMetalMat, detailLevel);
      createNacelle(scene, aircraftGroup, side * outerSpacing, engineY, engineZ + rootChord * 0.06, nacelleRadius * 0.92, nacelleLength * 0.92, mats.darkMat, mats.bareMetalMat, detailLevel);
    }
  } else {
    const engineSpacing = wSpan * 0.29;
    for (let i = 0; i < type.engineCount; i++) {
      const side = i === 0 ? -1 : 1;
      createNacelle(scene, aircraftGroup, side * engineSpacing, engineY, engineZ, nacelleRadius, nacelleLength, mats.darkMat, mats.bareMetalMat, detailLevel);
    }
  }


  const apu = markShadow(new THREE.Mesh(
    new THREE.ConeGeometry(fRad * 0.12, fRad * 0.45, detail.roundSegments),
    mats.darkMat
  ));
  apu.rotation.x = -Math.PI / 2;
  apu.position.set(0, fRad * 0.28, fLen * 0.5);
  aircraftGroup.add(apu);

  propeller = null;

  // ─── Airliner detail features (737 / A320) ───

  // Dorsal fin (leading edge extension into vertical stab)
  const dorsalFinGeo = new THREE.BoxGeometry(0.06, type.tailHeight * 0.35, fLen * 0.12, 1, 3, 2);
  const dfPos = dorsalFinGeo.attributes.position;
  for (let i = 0; i < dfPos.count; i++) {
    const y = dfPos.getY(i);
    if (y > 0) dfPos.setZ(i, dfPos.getZ(i) - y * 0.45);
    if (y < 0) dfPos.setX(i, dfPos.getX(i) * 2.2);
  }
  dorsalFinGeo.computeVertexNormals();
  const dorsalFin = markShadow(new THREE.Mesh(dorsalFinGeo, mats.bodyMat));
  dorsalFin.position.set(0, fRad * 0.28 + type.tailHeight * 0.12, tailZ - fLen * 0.12);
  aircraftGroup.add(dorsalFin);

  // Ventral fin (under tail, forward of APU)
  const ventFinGeo = new THREE.BoxGeometry(0.04, fRad * 0.35, fLen * 0.06, 1, 2, 1);
  const vfp = ventFinGeo.attributes.position;
  for (let i = 0; i < vfp.count; i++) {
    if (vfp.getY(i) < 0) vfp.setZ(i, vfp.getZ(i) + 0.04);
  }
  ventFinGeo.computeVertexNormals();
  const ventFin = markShadow(new THREE.Mesh(ventFinGeo, mats.bodyMat));
  ventFin.position.set(0, -fRad * 0.25, tailZ + fLen * 0.04);
  aircraftGroup.add(ventFin);

  // Tail cone (aft of APU, prominent)
  {
    const tcPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = fRad * 0.32 * Math.cos(t * Math.PI * 0.5);
      tcPts.push(new THREE.Vector2(Math.max(r, 0.01), (t - 0.5) * fLen * 0.14));
    }
    const tailConeGeo = new THREE.LatheGeometry(tcPts, detail.roundSegments);
    tailConeGeo.rotateX(-Math.PI / 2);
    const tailCone = markShadow(new THREE.Mesh(tailConeGeo, mats.bodyMat));
    tailCone.position.set(0, fRad * 0.22, fLen * 0.54);
    aircraftGroup.add(tailCone);
  }

  // VOR antenna (on top of vertical stab)
  const vorAntenna = markShadow(new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.15, 8),
    mats.darkMat
  ));
  vorAntenna.position.set(0, fRad * 0.28 + type.tailHeight * 1.08, tailZ - fLen * 0.04);
  aircraftGroup.add(vorAntenna);

  // Wing root fairing blend (smoother wing-body junction)
  for (const side of [-1, 1]) {
    const blendGeo = new THREE.SphereGeometry(fRad * 0.6, detail.roundSegments, 8);
    blendGeo.scale(2.0, 0.5, 3.0);
    const blend = new THREE.Mesh(blendGeo, mats.bodyMat);
    blend.position.set(side * fRad * 0.65, wingY + 0.06, wingZ + rootChord * 0.2);
    aircraftGroup.add(blend);
  }





  // Landing/taxi lights (on nose gear bay and wing leading edge)
  {
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 0.25,
      roughness: 0.08, metalness: 0.4,
    });
    // Nose landing light
    const noseLight = new THREE.Mesh(new THREE.CircleGeometry(fRad * 0.1, 10), lightMat);
    noseLight.position.set(0, -fRad * 0.85, -fLen * 0.34);
    noseLight.rotation.x = -Math.PI * 0.5;
    aircraftGroup.add(noseLight);
    // Wing landing lights
    for (const side of [-1, 1]) {
      const wingLight = new THREE.Mesh(new THREE.CircleGeometry(fRad * 0.08, 8), lightMat);
      wingLight.position.set(side * wSpan * 0.22, wingY - 0.02, wingZ - 0.02);
      wingLight.rotation.x = -0.1;
      aircraftGroup.add(wingLight);
    }
  }

  // Registration / airline logo area on tail (accent-colored band)
  {
    const tailBandGeo = new THREE.CylinderGeometry(
      fRad * 1.01, fRad * 0.96, fLen * 0.14, detail.roundSegments, 1, false,
      -0.8, 1.6
    );
    tailBandGeo.rotateX(Math.PI / 2);
    const tailBand = new THREE.Mesh(tailBandGeo, mats.accentMat);
    tailBand.position.z = fLen * 0.36;
    aircraftGroup.add(tailBand);
  }

  return {
    fuselageLength: fLen,
    fuselageRadius: fRad,
    wingSpan: wSpan,
    wingY,
    wingZ,
    rootChord,
    tailHeight: type.tailHeight,
    tailZ,
    mainGearSpread: fRad + 1.2,
    mainGearZ: wingZ + rootChord * 0.2,
    noseGearZ: -fLen * 0.35,
    landingLightPos: new THREE.Vector3(0, -fRad * 0.3, -fLen * 0.43),
    navLeftPos: new THREE.Vector3(-wSpan * 0.5, wingY + 0.03, wingZ + rootChord * 0.03),
    navRightPos: new THREE.Vector3(wSpan * 0.5, wingY + 0.03, wingZ + rootChord * 0.03),
    strobeLeftPos: new THREE.Vector3(-wSpan * 0.5, wingY + 0.04, wingZ + rootChord * 0.46),
    strobeRightPos: new THREE.Vector3(wSpan * 0.5, wingY + 0.04, wingZ + rootChord * 0.46),
    beaconPos: new THREE.Vector3(0, fRad * 0.33 + type.tailHeight * 1.05, tailZ - fLen * 0.03),
    tailLogoPos: new THREE.Vector3(0, fRad * 0.2 + type.tailHeight * 0.55, tailZ + 0.45),
  };
}

function buildF16Exterior(type, detail, mats) {
  const fLen = type.fuselageLength * 1.08;
  const fRad = type.fuselageRadius * 0.78;
  const wSpan = type.wingSpan * 0.94;

  const fuselage = markShadow(new THREE.Mesh(
    createFuselageGeo(fLen, fRad, fLen * 0.34, fLen * 0.16, detail.fuselageSegments),
    mats.bodyMat
  ));
  fuselage.scale.set(1.05, 0.95, 1.0); // flattened oval cross-section (fighter)
  aircraftGroup.add(fuselage);
  exteriorBodyParts.push(fuselage);

  // Dorsal spine (blended shape instead of box)
  const dorsalGeo = new THREE.BoxGeometry(fRad * 0.9, fRad * 0.42, fLen * 0.35, 6, 3, 4);
  const dorsalPos = dorsalGeo.attributes.position;
  for (let di = 0; di < dorsalPos.count; di++) {
    const dx = dorsalPos.getX(di);
    const dy = dorsalPos.getY(di);
    // Round the top edges for smoother blending
    if (dy > 0) {
      const blendFactor = Math.cos(Math.min(1, Math.abs(dx) / (fRad * 0.45)) * Math.PI * 0.5);
      dorsalPos.setY(di, dy * (0.6 + 0.4 * blendFactor));
    }
  }
  dorsalGeo.computeVertexNormals();
  const dorsalSpine = markShadow(new THREE.Mesh(dorsalGeo, mats.bodyMat));
  dorsalSpine.position.set(0, fRad * 0.32, -fLen * 0.03);
  aircraftGroup.add(dorsalSpine);
  exteriorBodyParts.push(dorsalSpine);

  const wingY = -fRad * 0.04;
  const wingZ = fLen * 0.03;
  const rootChord = fLen * 0.37;
  const tipChord = rootChord * 0.24;
  const wingGeo = createTaperedWing(wSpan, rootChord, tipChord, rootChord * 0.92, 0.12, 0.045, -0.01);
  const wing = markShadow(new THREE.Mesh(wingGeo, mats.bodyMat));
  wing.position.set(0, wingY, wingZ);
  aircraftGroup.add(wing);

  for (const side of [-1, 1]) {
    const lerxShape = new THREE.Shape();
    lerxShape.moveTo(0, 0);
    lerxShape.lineTo(side * (wSpan * 0.2), 0);
    lerxShape.lineTo(side * (wSpan * 0.1), rootChord * 0.45);
    lerxShape.lineTo(0, rootChord * 0.26);
    lerxShape.closePath();

    const lerxGeo = new THREE.ExtrudeGeometry(lerxShape, { depth: 0.03, bevelEnabled: false });
    const lerx = markShadow(new THREE.Mesh(lerxGeo, mats.bodyMat));
    lerx.rotation.x = Math.PI / 2;
    lerx.position.set(0, wingY + 0.04, wingZ - rootChord * 0.04);
    aircraftGroup.add(lerx);
  }

  const aileronGeo = new THREE.BoxGeometry(wSpan * 0.22, 0.04, rootChord * 0.16);
  addControlSurfacePair(aileronGeo, mats.controlSurfaceMat, wSpan, wingY - 0.01, wingZ + rootChord * 0.39, 0.31);

  const tailZ = fLen * 0.36;
  const stabSpan = wSpan * 0.42;
  const stabChord = fLen * 0.16;
  elevator = new THREE.Group();
  for (const side of [-1, 1]) {
    const stabGeo = createTaperedWing(stabSpan * 0.5, stabChord, stabChord * 0.55, stabChord * 0.4, 0.06, 0.03, -0.01);
    const stab = markShadow(new THREE.Mesh(stabGeo, mats.controlSurfaceMat));
    stab.position.set(side * stabSpan * 0.26, fRad * 0.08, tailZ);
    elevator.add(stab);
  }
  aircraftGroup.add(elevator);

  const vStabGeo = new THREE.BoxGeometry(0.09, type.tailHeight * 1.08, fLen * 0.18, 1, 5, 2);
  const vPos = vStabGeo.attributes.position;
  for (let i = 0; i < vPos.count; i++) {
    const y = vPos.getY(i);
    if (y > 0) {
      vPos.setZ(i, vPos.getZ(i) - y * 0.32);
      vPos.setX(i, vPos.getX(i) + y * 0.03);
    }
  }
  vStabGeo.computeVertexNormals();
  const vStab = markShadow(new THREE.Mesh(vStabGeo, mats.accentMat));
  vStab.position.set(0, fRad * 0.16 + type.tailHeight * 0.55, tailZ - fLen * 0.02);
  aircraftGroup.add(vStab);

  rudder = markShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.07, type.tailHeight * 0.7, fLen * 0.07),
    mats.controlSurfaceMat
  ));
  rudder.position.set(0, fRad * 0.2 + type.tailHeight * 0.5, tailZ + fLen * 0.08);
  aircraftGroup.add(rudder);

  // F-16 chin intake — rounded D-shape via ExtrudeGeometry
  {
    const iW = fRad * 0.64, iH = fRad * 0.26, iDepth = fLen * 0.22;
    const outerShape = new THREE.Shape();
    // Flat bottom, rounded top corners — D-shape profile
    outerShape.moveTo(-iW, 0);
    outerShape.lineTo(-iW, iH * 0.25);
    outerShape.quadraticCurveTo(-iW, iH, -iW * 0.6, iH);
    outerShape.quadraticCurveTo(0, iH * 1.15, iW * 0.6, iH);
    outerShape.quadraticCurveTo(iW, iH, iW, iH * 0.25);
    outerShape.lineTo(iW, 0);
    outerShape.closePath();
    // Hollow center (inner opening)
    const innerW = iW * 0.78, innerH = iH * 0.7;
    const holePath = new THREE.Path();
    holePath.moveTo(-innerW, 0.02);
    holePath.lineTo(-innerW, innerH * 0.3);
    holePath.quadraticCurveTo(-innerW, innerH, -innerW * 0.55, innerH);
    holePath.quadraticCurveTo(0, innerH * 1.1, innerW * 0.55, innerH);
    holePath.quadraticCurveTo(innerW, innerH, innerW, innerH * 0.3);
    holePath.lineTo(innerW, 0.02);
    holePath.closePath();
    outerShape.holes.push(holePath);
    const intakeGeo = new THREE.ExtrudeGeometry(outerShape, {
      depth: iDepth, bevelEnabled: true, bevelThickness: 0.02,
      bevelSize: 0.015, bevelSegments: 2, steps: 1,
    });
    intakeGeo.rotateX(Math.PI / 2);
    intakeGeo.translate(0, 0, iDepth * 0.5);
    const intakeOuter = markShadow(new THREE.Mesh(intakeGeo, mats.darkMat));
    intakeOuter.position.set(0, -fRad * 0.52, -fLen * 0.13);
    aircraftGroup.add(intakeOuter);
    // Intake duct (dark interior visible through opening)
    const ductGeo = new THREE.CylinderGeometry(innerW * 0.6, innerW * 0.7, fLen * 0.3, 12, 1, true);
    ductGeo.rotateX(Math.PI / 2);
    const intakeDuct = new THREE.Mesh(ductGeo,
      new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.9, metalness: 0.05, side: THREE.BackSide })
    );
    intakeDuct.position.set(0, -fRad * 0.42, -fLen * 0.04);
    aircraftGroup.add(intakeDuct);
    // Splitter plate (intake separation boundary layer plate)
    const splitterGeo = new THREE.BoxGeometry(iW * 1.9, 0.018, iDepth * 0.7);
    const splitter = markShadow(new THREE.Mesh(splitterGeo, mats.panelLineMat));
    splitter.position.set(0, -fRad * 0.52, -fLen * 0.14);
    aircraftGroup.add(splitter);
  }

  // F-16 bubble canopy — elongated teardrop shape
  {
    const cLen = fLen * 0.22, cRad = fRad * 1.04, cH = fRad * 0.62;
    const cSegs = detail.canopySegments;
    // Build canopy profile via LatheGeometry for smooth bubble
    const canopyProfile = [];
    const cN = 16;
    for (let i = 0; i <= cN; i++) {
      const t = i / cN;
      const angle = t * Math.PI * 0.52;
      // Wider at base, narrowing at top with elliptical curve
      const r = cRad * Math.cos(angle);
      const y = cH * Math.sin(angle);
      canopyProfile.push(new THREE.Vector2(Math.max(r, 0.01), y));
    }
    const canopyGeo = new THREE.LatheGeometry(canopyProfile, cSegs);
    // Scale along Z to elongate the bubble
    const cPos = canopyGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
      const x = cPos.getX(i), y = cPos.getY(i), z = cPos.getZ(i);
      // Stretch along fuselage axis (Z after rotation) with teardrop taper toward rear
      const zNorm = z / cRad;
      const stretch = 1 + 0.8 * (0.5 + 0.5 * zNorm);
      cPos.setZ(i, z * stretch);
    }
    canopyGeo.computeVertexNormals();
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x445566, transparent: true, opacity: 0.35,
      roughness: 0.05, metalness: 0.1, transmission: 0.6,
      thickness: 0.5, clearcoat: 1.0, clearcoatRoughness: 0.05,
      envMapIntensity: 2.5, side: THREE.DoubleSide, depthWrite: false,
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, fRad * 0.68, -fLen * 0.18);
    canopy.rotation.x = -0.06;
    aircraftGroup.add(canopy);
    exteriorBodyParts.push(canopy);
    // Canopy bow frame (main structural arch)
    const bowFrame = markShadow(new THREE.Mesh(
      new THREE.TorusGeometry(cRad * 0.88, 0.028, 8, cSegs, Math.PI),
      mats.panelLineMat
    ));
    bowFrame.position.set(0, fRad * 0.72, -fLen * 0.18);
    bowFrame.rotation.x = -Math.PI * 0.5;
    aircraftGroup.add(bowFrame);
    exteriorBodyParts.push(bowFrame);
    // Windscreen frame (front arch)
    const wsFrame = markShadow(new THREE.Mesh(
      new THREE.TorusGeometry(cRad * 0.82, 0.022, 8, cSegs, Math.PI),
      mats.panelLineMat
    ));
    wsFrame.position.set(0, fRad * 0.7, -fLen * 0.26);
    wsFrame.rotation.x = -Math.PI * 0.48;
    aircraftGroup.add(wsFrame);
    exteriorBodyParts.push(wsFrame);
    // HUD combiner glass (inside canopy)
    const hudGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(fRad * 0.38, fRad * 0.32),
      new THREE.MeshPhysicalMaterial({
        color: 0x88ff88, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    hudGlass.position.set(0, fRad * 0.92, -fLen * 0.22);
    hudGlass.rotation.x = -0.4;
    aircraftGroup.add(hudGlass);
  }

  const nozzleOuter = markShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(fRad * 0.44, fRad * 0.5, fLen * 0.15, detail.roundSegments, 1, true),
    mats.darkMat
  ));
  nozzleOuter.rotation.x = Math.PI / 2;
  nozzleOuter.position.z = fLen * 0.5;
  aircraftGroup.add(nozzleOuter);

  const afterburner = new THREE.Mesh(
    new THREE.CircleGeometry(fRad * 0.34, detail.roundSegments),
    new THREE.MeshStandardMaterial({
      color: 0xff7b33,
      emissive: 0xff6618,
      emissiveIntensity: 0.72,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
    })
  );
  afterburner.position.set(0, 0, fLen * 0.58);
  aircraftGroup.add(afterburner);

  for (const side of [-1, 1]) {
    const ventral = markShadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.055, fRad * 0.78, fLen * 0.085),
      mats.bodyMat
    ));
    ventral.position.set(side * fRad * 0.42, -fRad * 0.82, fLen * 0.34);
    ventral.rotation.z = side * 0.28;
    aircraftGroup.add(ventral);

    for (const offset of [0.25, 0.43]) {
      const pylon = markShadow(new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.18, 0.42),
        mats.darkMat
      ));
      pylon.position.set(side * wSpan * offset, wingY - 0.24, wingZ + 0.22 + offset * 0.2);
      aircraftGroup.add(pylon);
    }
  }

  propeller = null;

  // ─── Additional F-16 detail ───

  // Wing tip missile rails (distinctive F-16 feature)
  const missileMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.3, metalness: 0.15 });
  const seekerMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.2, metalness: 0.4 });
  for (const side of [-1, 1]) {
    const railGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6);
    railGeo.rotateX(Math.PI / 2);
    const rail = markShadow(new THREE.Mesh(railGeo, mats.darkMat));
    const tipDY = wingY + Math.abs(wSpan * 0.5) * 0.01;
    rail.position.set(side * (wSpan * 0.5 + 0.03), tipDY, wingZ + rootChord * 0.22);
    aircraftGroup.add(rail);

    // AIM-9 Sidewinder missile
    const missileGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.48, 8);
    missileGeo.rotateX(Math.PI / 2);
    const missile = markShadow(new THREE.Mesh(missileGeo, missileMat));
    missile.position.set(side * (wSpan * 0.5 + 0.03), tipDY - 0.055, wingZ + rootChord * 0.22);
    aircraftGroup.add(missile);

    // Seeker head
    const seekerGeo = new THREE.SphereGeometry(0.038, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    seekerGeo.rotateX(Math.PI / 2);
    const seeker = new THREE.Mesh(seekerGeo, seekerMat);
    seeker.position.set(side * (wSpan * 0.5 + 0.03), tipDY - 0.055, wingZ + rootChord * 0.22 - 0.26);
    aircraftGroup.add(seeker);

    // Missile tail fins
    for (let f = 0; f < 4; f++) {
      const finGeo = new THREE.BoxGeometry(0.055, 0.003, 0.035);
      const fin = new THREE.Mesh(finGeo, mats.bareMetalMat);
      const angle = (f / 4) * Math.PI * 2 + Math.PI / 4;
      fin.position.set(
        side * (wSpan * 0.5 + 0.03) + Math.cos(angle) * 0.048,
        tipDY - 0.055 + Math.sin(angle) * 0.048,
        wingZ + rootChord * 0.22 + 0.2
      );
      fin.rotation.z = angle;
      aircraftGroup.add(fin);
    }
  }

  // Nozzle petals (variable geometry exhaust)
  const petalCount = detail.isLowDetail ? 8 : 12;
  for (let p = 0; p < petalCount; p++) {
    const angle = (p / petalCount) * Math.PI * 2;
    const petalGeo = new THREE.BoxGeometry(0.018, fRad * 0.32, fLen * 0.05);
    const petal = markShadow(new THREE.Mesh(petalGeo, mats.bareMetalMat));
    petal.position.set(
      Math.cos(angle) * fRad * 0.4,
      Math.sin(angle) * fRad * 0.4,
      fLen * 0.52
    );
    petal.rotation.z = angle;
    aircraftGroup.add(petal);
  }

  // IFF antenna bumps (dorsal spine)
  for (const z of [-fLen * 0.08, fLen * 0.14]) {
    const iffBump = markShadow(new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 6),
      mats.darkMat
    ));
    iffBump.scale.set(1.8, 0.6, 2.5);
    iffBump.position.set(0, fRad * 0.55, z);
    aircraftGroup.add(iffBump);
  }

  // Speed brake panel marking (top of fuselage behind cockpit)
  const sbPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(fRad * 0.7, fLen * 0.08),
    mats.panelLineMat
  );
  sbPanel.position.set(0, fRad * 0.54, fLen * 0.06);
  sbPanel.rotation.x = -Math.PI / 2;
  aircraftGroup.add(sbPanel);

  // Formation strip lights (intake sides)
  const formLightMat = new THREE.MeshStandardMaterial({
    color: 0x44ee44, emissive: 0x22aa22, emissiveIntensity: 0.3,
    transparent: true, opacity: 0.8
  });
  for (const side of [-1, 1]) {
    const formLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, fRad * 0.14, 0.04),
      formLightMat
    );
    formLight.position.set(side * fRad * 0.65, -fRad * 0.38, -fLen * 0.08);
    aircraftGroup.add(formLight);
  }

  return {
    fuselageLength: fLen,
    fuselageRadius: fRad,
    wingSpan: wSpan,
    wingY,
    wingZ,
    rootChord,
    tailHeight: type.tailHeight,
    tailZ,
    mainGearSpread: fRad + 0.9,
    mainGearZ: wingZ + rootChord * 0.18,
    noseGearZ: -fLen * 0.27,
    landingLightPos: new THREE.Vector3(0, -fRad * 0.5, -fLen * 0.23),
    navLeftPos: new THREE.Vector3(-wSpan * 0.5, wingY + 0.02, wingZ + rootChord * 0.12),
    navRightPos: new THREE.Vector3(wSpan * 0.5, wingY + 0.02, wingZ + rootChord * 0.12),
    strobeLeftPos: new THREE.Vector3(-wSpan * 0.5, wingY + 0.04, wingZ + rootChord * 0.34),
    strobeRightPos: new THREE.Vector3(wSpan * 0.5, wingY + 0.04, wingZ + rootChord * 0.34),
    beaconPos: new THREE.Vector3(0, fRad * 0.45 + type.tailHeight * 0.95, tailZ - fLen * 0.02),
    tailLogoPos: new THREE.Vector3(0, fRad * 0.22 + type.tailHeight * 0.5, tailZ + 0.2),
  };
}

function addSeaplaneFloats(type, detail, mats, layout) {
  gearGroup = new THREE.Group();

  const fLen = layout.fuselageLength;
  const fRad = layout.fuselageRadius;
  const floatLen = fLen * 1.1;
  const floatRadius = fRad * 0.42;
  const floatSpread = fRad + 0.7;
  const floatY = -fRad * 1.6;

  const floatMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd, roughness: 0.3, metalness: 0.15,
  });
  const floatAccentMat = new THREE.MeshStandardMaterial({
    color: type.accentColor, roughness: 0.35, metalness: 0.1,
  });

  for (const side of [-1, 1]) {
    // Pontoon hull — tapered cylinder (boat hull shape)
    const hullPts = [];
    const hullN = 24;
    for (let i = 0; i <= hullN; i++) {
      const t = i / hullN;
      let r;
      if (t < 0.15) {
        // Sharp bow taper
        r = floatRadius * Math.pow(t / 0.15, 0.6) * 0.85;
      } else if (t > 0.8) {
        // Stern taper (less sharp)
        const st = (t - 0.8) / 0.2;
        r = floatRadius * (1 - st * 0.5) * 0.92;
      } else {
        // Main hull body with slight barrel
        const bodyT = (t - 0.15) / 0.65;
        r = floatRadius * (0.92 + 0.08 * Math.sin(bodyT * Math.PI));
      }
      hullPts.push(new THREE.Vector2(Math.max(r, 0.01), (t - 0.45) * floatLen));
    }
    const hullGeo = new THREE.LatheGeometry(hullPts, detail.isLowDetail ? 8 : 12);
    hullGeo.rotateX(Math.PI / 2);
    // Flatten bottom for planing hull
    const hullPos = hullGeo.attributes.position;
    for (let i = 0; i < hullPos.count; i++) {
      const y = hullPos.getY(i);
      if (y < -floatRadius * 0.3) {
        hullPos.setY(i, -floatRadius * 0.3 + (y + floatRadius * 0.3) * 0.2);
      }
    }
    hullGeo.computeVertexNormals();

    const hull = markShadow(new THREE.Mesh(hullGeo, floatMat));
    hull.position.set(side * floatSpread, floatY, -fLen * 0.02);
    gearGroup.add(hull);

    // Keel step (the step on the bottom of the float for water break)
    const stepGeo = new THREE.BoxGeometry(floatRadius * 1.6, floatRadius * 0.15, 0.08);
    const step = markShadow(new THREE.Mesh(stepGeo, mats.darkMat));
    step.position.set(side * floatSpread, floatY - floatRadius * 0.28, fLen * 0.05);
    gearGroup.add(step);

    // Color accent stripe along float
    const stripeGeo = new THREE.BoxGeometry(floatRadius * 0.08, floatRadius * 0.6, floatLen * 0.75);
    const stripe = new THREE.Mesh(stripeGeo, floatAccentMat);
    stripe.position.set(side * (floatSpread + floatRadius * 0.88), floatY + floatRadius * 0.1, -fLen * 0.02);
    gearGroup.add(stripe);

    // Bow cap (reinforced front of float)
    const bowGeo = new THREE.SphereGeometry(floatRadius * 0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    bowGeo.rotateX(Math.PI * 0.5);
    const bow = markShadow(new THREE.Mesh(bowGeo, mats.darkMat));
    bow.position.set(side * floatSpread, floatY + floatRadius * 0.15, -floatLen * 0.5);
    gearGroup.add(bow);

    // Struts connecting float to fuselage (V-struts front and rear)
    const strutGeo = new THREE.CylinderGeometry(0.03, 0.035, fRad * 2.2, 6);
    // Front V-struts
    const frontStrut = markShadow(new THREE.Mesh(strutGeo, mats.bareMetalMat));
    frontStrut.position.set(side * floatSpread * 0.5, floatY + fRad * 0.7, -fLen * 0.28);
    frontStrut.rotation.z = side * 0.4;
    gearGroup.add(frontStrut);

    // Rear V-struts
    const rearStrut = markShadow(new THREE.Mesh(strutGeo, mats.bareMetalMat));
    rearStrut.position.set(side * floatSpread * 0.5, floatY + fRad * 0.7, fLen * 0.15);
    rearStrut.rotation.z = side * 0.4;
    gearGroup.add(rearStrut);

    // Horizontal spreader bar between strut pairs
    const spreaderGeo = new THREE.CylinderGeometry(0.02, 0.02, floatSpread * 0.6, 6);
    spreaderGeo.rotateZ(Math.PI / 2);
    const frontSpreader = markShadow(new THREE.Mesh(spreaderGeo, mats.bareMetalMat));
    frontSpreader.position.set(side * floatSpread * 0.5, floatY + fRad * 1.3, -fLen * 0.28);
    gearGroup.add(frontSpreader);

    const rearSpreader = markShadow(new THREE.Mesh(spreaderGeo.clone(), mats.bareMetalMat));
    rearSpreader.position.set(side * floatSpread * 0.5, floatY + fRad * 1.3, fLen * 0.15);
    gearGroup.add(rearSpreader);
  }

  // Small tail float (water rudder area)
  for (const side of [-1, 1]) {
    const tailFloatGeo = new THREE.SphereGeometry(floatRadius * 0.25, 6, 4);
    tailFloatGeo.scale(0.6, 0.5, 1.8);
    const tailFloat = markShadow(new THREE.Mesh(tailFloatGeo, floatMat));
    tailFloat.position.set(side * floatSpread * 0.4, floatY + floatRadius * 0.1, fLen * 0.45);
    gearGroup.add(tailFloat);

    // Tail strut
    const tailStrutGeo = new THREE.CylinderGeometry(0.02, 0.025, fRad * 1.4, 5);
    const tailStrut = markShadow(new THREE.Mesh(tailStrutGeo, mats.bareMetalMat));
    tailStrut.position.set(side * floatSpread * 0.25, floatY + fRad * 0.5, fLen * 0.4);
    tailStrut.rotation.z = side * 0.3;
    gearGroup.add(tailStrut);
  }

  aircraftGroup.add(gearGroup);
}

function addLandingGear(type, detail, mats, layout) {
  gearGroup = new THREE.Group();

  const strutRadiusTop = type.type === 'fighter' ? 0.04 : 0.045;
  const strutRadiusBottom = strutRadiusTop * 1.15;
  const strutLen = type.type === 'prop' ? 0.95 : (type.type === 'fighter' ? 1.05 : 1.22);
  const strutGeo = new THREE.CylinderGeometry(strutRadiusTop, strutRadiusBottom, strutLen, detail.isLowDetail ? 7 : 10);

  const wheelRadius = type.type === 'prop' ? 0.2 : (type.type === 'fighter' ? 0.24 : 0.23);
  const wheelWidth = type.type === 'jet' ? 0.12 : 0.1;
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, detail.isLowDetail ? 12 : 18);
  wheelGeo.rotateZ(Math.PI / 2);

  const noseStrut = markShadow(new THREE.Mesh(strutGeo, mats.bareMetalMat));
  noseStrut.position.set(0, -layout.fuselageRadius - strutLen * 0.45, layout.noseGearZ);
  gearGroup.add(noseStrut);

  const noseWheel = markShadow(new THREE.Mesh(wheelGeo, mats.tireMat));
  noseWheel.position.set(0, noseStrut.position.y - strutLen * 0.42, layout.noseGearZ);
  gearGroup.add(noseWheel);

  const mainStrutY = -layout.fuselageRadius - strutLen * 0.4;
  const mainWheelY = mainStrutY - strutLen * 0.44;
  const hasDualMain = type.type !== 'prop';

  for (const side of [-1, 1]) {
    const mainStrut = markShadow(new THREE.Mesh(strutGeo, mats.bareMetalMat));
    mainStrut.position.set(side * layout.mainGearSpread, mainStrutY, layout.mainGearZ);
    mainStrut.rotation.z = side * (type.type === 'fighter' ? 0.12 : 0.06);
    gearGroup.add(mainStrut);

    if (hasDualMain) {
      for (const offset of [-0.12, 0.12]) {
        const wheel = markShadow(new THREE.Mesh(wheelGeo, mats.tireMat));
        wheel.position.set(side * layout.mainGearSpread, mainWheelY, layout.mainGearZ + offset);
        gearGroup.add(wheel);
      }
    } else {
      const wheel = markShadow(new THREE.Mesh(wheelGeo, mats.tireMat));
      wheel.position.set(side * layout.mainGearSpread, mainWheelY, layout.mainGearZ);
      gearGroup.add(wheel);
    }

    if (type.type === 'prop') {
      const pantGeo = new THREE.SphereGeometry(0.3, detail.roundSegments, Math.max(6, detail.roundSegments - 4));
      pantGeo.scale(0.48, 0.82, 1.56);
      const pant = markShadow(new THREE.Mesh(pantGeo, mats.bodyMat));
      pant.position.set(side * layout.mainGearSpread, mainWheelY + 0.16, layout.mainGearZ);
      gearGroup.add(pant);
    } else {
      const fairGeo = new THREE.SphereGeometry(0.2, detail.roundSegments, Math.max(5, detail.roundSegments - 5));
      fairGeo.scale(0.65, 1.25, 1.35);
      const fair = markShadow(new THREE.Mesh(fairGeo, mats.panelLineMat));
      fair.position.set(side * layout.mainGearSpread, mainStrutY + 0.38, layout.mainGearZ);
      gearGroup.add(fair);
    }
  }

  // ─── Enhanced landing gear detail ───

  // Oleo scissors / torque links (nose gear)
  const scissorGeo = new THREE.BoxGeometry(0.014, strutLen * 0.26, 0.025);
  const noseScissor1 = new THREE.Mesh(scissorGeo, mats.bareMetalMat);
  noseScissor1.position.set(0.032, noseStrut.position.y - strutLen * 0.06, layout.noseGearZ);
  noseScissor1.rotation.z = 0.15;
  gearGroup.add(noseScissor1);
  const noseScissor2 = new THREE.Mesh(scissorGeo, mats.bareMetalMat);
  noseScissor2.position.set(0.032, noseStrut.position.y - strutLen * 0.22, layout.noseGearZ);
  noseScissor2.rotation.z = -0.15;
  gearGroup.add(noseScissor2);

  // Wheel hub caps
  const hubGeo = new THREE.CircleGeometry(wheelRadius * 0.5, detail.isLowDetail ? 8 : 12);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 });
  for (const hubSide of [-1, 1]) {
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.set(hubSide * (wheelWidth * 0.5 + 0.002), noseWheel.position.y, layout.noseGearZ);
    hub.rotation.y = hubSide * Math.PI * 0.5;
    gearGroup.add(hub);
  }
  for (const side of [-1, 1]) {
    const wheelZ = hasDualMain ? [layout.mainGearZ - 0.12, layout.mainGearZ + 0.12] : [layout.mainGearZ];
    for (const wz of wheelZ) {
      for (const hubSide of [-1, 1]) {
        const hub = new THREE.Mesh(hubGeo, hubMat);
        hub.position.set(
          side * layout.mainGearSpread + hubSide * (wheelWidth * 0.5 + 0.002),
          mainWheelY, wz
        );
        hub.rotation.y = hubSide * Math.PI * 0.5;
        gearGroup.add(hub);
      }
    }
  }

  // Gear doors (jets and fighters only)
  if (type.type !== 'prop') {
    const gearDoorMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.4, metalness: 0.3 });
    // Nose gear doors
    const noseDoorGeo = new THREE.BoxGeometry(0.06, 0.02, strutLen * 0.65);
    for (const side of [-1, 1]) {
      const noseDoor = markShadow(new THREE.Mesh(noseDoorGeo, gearDoorMat));
      noseDoor.position.set(side * 0.12, -layout.fuselageRadius + 0.02, layout.noseGearZ);
      gearGroup.add(noseDoor);
    }
    // Main gear doors
    const mainDoorGeo = new THREE.BoxGeometry(0.06, 0.02, strutLen * 0.5);
    for (const side of [-1, 1]) {
      const mainDoor = markShadow(new THREE.Mesh(mainDoorGeo, gearDoorMat));
      mainDoor.position.set(
        side * layout.mainGearSpread + side * 0.16,
        -layout.fuselageRadius + 0.02,
        layout.mainGearZ
      );
      gearGroup.add(mainDoor);
    }
  }

  // Brake assemblies (main gear)
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.5 });
  for (const side of [-1, 1]) {
    const brakeGeo = new THREE.CylinderGeometry(wheelRadius * 0.35, wheelRadius * 0.35, wheelWidth * 0.6, 8);
    brakeGeo.rotateZ(Math.PI / 2);
    const brake = new THREE.Mesh(brakeGeo, brakeMat);
    const firstWheelZ = hasDualMain ? layout.mainGearZ - 0.12 : layout.mainGearZ;
    brake.position.set(side * layout.mainGearSpread, mainWheelY, firstWheelZ);
    gearGroup.add(brake);
  }

  aircraftGroup.add(gearGroup);
}

function addAircraftLights(detail, layout) {
  const navSphereGeo = new THREE.SphereGeometry(0.09, detail.roundSegments, detail.roundSegments);

  const redNavMat = new THREE.MeshStandardMaterial({ color: 0xff1a1a, emissive: 0xff1a1a, emissiveIntensity: 1.1 });
  const greenNavMat = new THREE.MeshStandardMaterial({ color: 0x00f07a, emissive: 0x00f07a, emissiveIntensity: 1.1 });

  const leftNavMesh = new THREE.Mesh(navSphereGeo, redNavMat);
  leftNavMesh.position.copy(layout.navLeftPos);
  aircraftGroup.add(leftNavMesh);

  const rightNavMesh = new THREE.Mesh(navSphereGeo, greenNavMat);
  rightNavMesh.position.copy(layout.navRightPos);
  aircraftGroup.add(rightNavMesh);

  navLightLeft = new THREE.PointLight(0xff2a2a, 5, 45);
  navLightLeft.position.copy(layout.navLeftPos);
  aircraftGroup.add(navLightLeft);

  navLightRight = new THREE.PointLight(0x00ff86, 5, 45);
  navLightRight.position.copy(layout.navRightPos);
  aircraftGroup.add(navLightRight);

  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1111, emissiveIntensity: 1.0 });
  beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, detail.roundSegments, detail.roundSegments), beaconMat);
  beaconMesh.position.copy(layout.beaconPos);
  aircraftGroup.add(beaconMesh);

  const strobeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.1 });
  strobeLeftMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, detail.roundSegments, detail.roundSegments), strobeMat.clone());
  strobeLeftMesh.position.copy(layout.strobeLeftPos);
  aircraftGroup.add(strobeLeftMesh);

  strobeRightMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, detail.roundSegments, detail.roundSegments), strobeMat.clone());
  strobeRightMesh.position.copy(layout.strobeRightPos);
  aircraftGroup.add(strobeRightMesh);

  tailLogoLight = new THREE.PointLight(0xfff3cf, 0, 24);
  tailLogoLight.position.copy(layout.tailLogoPos);
  aircraftGroup.add(tailLogoLight);

  landingSpotLight = new THREE.SpotLight(0xfff9e8, 0, 950, Math.PI / 5, 0.52, 1.5);
  landingSpotLight.position.copy(layout.landingLightPos);
  landingSpotLight.target.position.copy(layout.landingLightPos).add(new THREE.Vector3(0, -2, -25));
  aircraftGroup.add(landingSpotLight);
  aircraftGroup.add(landingSpotLight.target);

  const coneGeo = new THREE.ConeGeometry(8.5, 42, 14, 1, true);
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, -22);
  landingLightCone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
    color: 0xfff8db,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  landingLightCone.position.copy(layout.landingLightPos);
  aircraftGroup.add(landingLightCone);
}

function addSharedAirframeDetails(detail, mats, layout, type, variant) {
  const antenna = markShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.016, layout.fuselageRadius * 1.0, 6),
    mats.darkMat
  ));
  antenna.position.set(0, layout.fuselageRadius * 1.45, -layout.fuselageLength * 0.04);
  aircraftGroup.add(antenna);

  const bellyAntenna = markShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.025, layout.fuselageRadius * 0.68, 6),
    mats.darkMat
  ));
  bellyAntenna.position.set(0, -layout.fuselageRadius * 1.18, layout.fuselageLength * 0.08);
  aircraftGroup.add(bellyAntenna);

  const pitot = markShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, layout.fuselageRadius * 0.86, 6),
    mats.bareMetalMat
  ));
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(layout.fuselageRadius * 0.46, layout.fuselageRadius * 0.12, -layout.fuselageLength * 0.42);
  aircraftGroup.add(pitot);

  const staticPortMat = new THREE.MeshStandardMaterial({ color: 0x4c5057, roughness: 0.5, metalness: 0.3 });
  for (const side of [-1, 1]) {
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.022, detail.roundSegments), staticPortMat);
    port.position.set(side * (layout.fuselageRadius - 0.006), layout.fuselageRadius * 0.22, -layout.fuselageLength * 0.12);
    port.rotation.y = side * Math.PI * 0.5;
    aircraftGroup.add(port);
  }

  if (variant === 'f16') {
    const aoaProbe = markShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.35, 6),
      mats.bareMetalMat
    ));
    aoaProbe.position.set(-layout.fuselageRadius * 0.44, layout.fuselageRadius * 0.05, -layout.fuselageLength * 0.39);
    aoaProbe.rotation.z = -0.4;
    aircraftGroup.add(aoaProbe);
  }

  if (type.type === 'prop') {
    const tieRing = markShadow(new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.012, 8, detail.roundSegments),
      mats.bareMetalMat
    ));
    tieRing.position.set(0, -layout.fuselageRadius * 0.32, layout.fuselageLength * 0.48);
    tieRing.rotation.x = Math.PI / 2;
    aircraftGroup.add(tieRing);
  }
}

function buildCockpitInterior(type, detail, mats, layout) {
  cockpitGroup = new THREE.Group();

  const isJet = type.type === 'jet';
  const isFighter = type.type === 'fighter';
  const isProp = type.type === 'prop';

  const cpY = type.cockpitY || 0.35;
  const cpZ = type.cockpitZ || -2.8;

  const shellWidth = isFighter ? 1.0 : (isJet ? 1.92 : 1.45);
  const shellDepth = isFighter ? 1.45 : (isJet ? 2.25 : 1.85);
  const shellHeight = isFighter ? 1.25 : (isJet ? 1.3 : 1.18);

  const cockpitPanelTex = createCockpitSurfaceTexture(detail.isHighDetail);
  const seatTex = createSeatFabricTexture(detail.isHighDetail);
  aircraftDisposableTextures.push(cockpitPanelTex, seatTex);

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x20242b,
    map: cockpitPanelTex,
    roughness: 0.86,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const dashMat = new THREE.MeshStandardMaterial({
    color: 0x161a20,
    map: cockpitPanelTex,
    roughness: 0.78,
    metalness: 0.1,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: isFighter ? 0x2e333a : 0x202738,
    map: seatTex,
    roughness: 0.9,
    metalness: 0.05,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    roughness: 0.6,
    metalness: 0.24,
  });
  const displayMat = new THREE.MeshStandardMaterial({
    color: 0x081318,
    emissive: isFighter ? 0x22aa66 : 0x1b8eff,
    emissiveIntensity: 0.24,
    roughness: 0.2,
    metalness: 0.06,
  });
  cockpitNightMaterials.push(displayMat);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(shellWidth, shellDepth), shellMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, cpY - 0.86, cpZ + 0.08);
  cockpitGroup.add(floor);

  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, shellHeight, shellDepth * 0.95),
      shellMat
    );
    sideWall.position.set(side * (shellWidth * 0.5), cpY - 0.25, cpZ + 0.1);
    cockpitGroup.add(sideWall);
  }

  const rearWall = new THREE.Mesh(new THREE.BoxGeometry(shellWidth, shellHeight, 0.04), shellMat);
  rearWall.position.set(0, cpY - 0.24, cpZ + shellDepth * 0.5);
  cockpitGroup.add(rearWall);

  const dashDepth = isFighter ? 0.28 : (isJet ? 0.3 : 0.26);
  const dashHeight = isFighter ? 0.36 : 0.42;
  const dashY = cpY - 0.54;
  const dashZ = cpZ - (isFighter ? 0.92 : (isJet ? 1.38 : 1.05));

  const dash = new THREE.Mesh(new THREE.BoxGeometry(shellWidth * 0.86, dashHeight, dashDepth), dashMat);
  dash.position.set(0, dashY, dashZ);
  cockpitGroup.add(dash);

  const glare = new THREE.Mesh(new THREE.BoxGeometry(shellWidth * 0.88, 0.02, dashDepth * 0.65), frameMat);
  glare.position.set(0, dashY + dashHeight * 0.5 + 0.01, dashZ - dashDepth * 0.25);
  glare.rotation.x = -0.32;
  cockpitGroup.add(glare);

  const panelWidth = detail.isLowDetail ? 640 : (detail.isHighDetail ? 1280 : 1024);
  const panelHeight = Math.round(panelWidth * 0.375);
  cockpitCanvas = document.createElement('canvas');
  cockpitCanvas.width = panelWidth;
  cockpitCanvas.height = panelHeight;
  cockpitCtx = cockpitCanvas.getContext('2d');
  cockpitCtx.fillStyle = '#101010';
  cockpitCtx.fillRect(0, 0, panelWidth, panelHeight);

  cockpitTexture = new THREE.CanvasTexture(cockpitCanvas);
  cockpitTexture.minFilter = THREE.LinearFilter;
  cockpitTexture.magFilter = THREE.LinearFilter;

  const panelPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(shellWidth * (isJet ? 0.8 : 0.72), dashHeight * 0.9),
    new THREE.MeshBasicMaterial({ map: cockpitTexture })
  );
  panelPlane.position.set(0, dashY - 0.01, dashZ + dashDepth * 0.52 + 0.01);
  cockpitPanel = panelPlane;
  cockpitGroup.add(panelPlane);

  const pedestal = new THREE.Mesh(
    new THREE.BoxGeometry(isJet ? 0.32 : 0.24, isFighter ? 0.2 : 0.28, isJet ? 0.72 : 0.46),
    dashMat
  );
  pedestal.position.set(0, cpY - 0.66, cpZ + (isFighter ? 0.06 : 0.03));
  cockpitGroup.add(pedestal);

  const leverCount = isFighter ? 1 : 2;
  for (let i = 0; i < leverCount; i++) {
    const offset = leverCount === 1 ? 0 : (i - 0.5) * 0.09;
    const throttleStem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.013, 0.11, 8), frameMat);
    throttleStem.position.set(offset, pedestal.position.y + 0.08, pedestal.position.z - 0.14);
    cockpitGroup.add(throttleStem);

    const throttleGrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.03), frameMat);
    throttleGrip.position.set(offset, pedestal.position.y + 0.14, pedestal.position.z - 0.14);
    cockpitGroup.add(throttleGrip);
  }

  if (isProp) {
    const yokeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.3, 8), frameMat);
    yokeStem.position.set(0, cpY - 0.56, cpZ - 0.62);
    yokeStem.rotation.x = -0.45;
    cockpitGroup.add(yokeStem);

    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 14, Math.PI), frameMat);
    yoke.position.set(0, cpY - 0.43, cpZ - 0.73);
    yoke.rotation.x = Math.PI * 0.55;
    cockpitGroup.add(yoke);
  } else if (isJet) {
    for (const side of [-1, 1]) {
      const yokeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.26, 8), frameMat);
      yokeStem.position.set(side * 0.3, cpY - 0.58, cpZ - 0.94);
      yokeStem.rotation.x = -0.52;
      cockpitGroup.add(yokeStem);

      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.011, 8, 12, Math.PI), frameMat);
      yoke.position.set(side * 0.3, cpY - 0.45, cpZ - 1.02);
      yoke.rotation.x = Math.PI * 0.55;
      cockpitGroup.add(yoke);
    }

    const upperMfd = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.16), displayMat);
    upperMfd.position.set(0, dashY + 0.13, dashZ + 0.14);
    upperMfd.rotation.x = -0.12;
    cockpitGroup.add(upperMfd);
  } else {
    const sideStick = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.017, 0.24, 8), frameMat);
    sideStick.position.set(0.23, cpY - 0.55, cpZ + 0.06);
    sideStick.rotation.x = -0.16;
    cockpitGroup.add(sideStick);

    const sideGrip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.06, 0.036), frameMat);
    sideGrip.position.set(0.23, cpY - 0.42, cpZ + 0.05);
    cockpitGroup.add(sideGrip);

    const hudGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0x91ffbf,
        emissive: 0x2b6849,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    hudGlass.position.set(0, cpY + 0.1, cpZ - 0.84);
    hudGlass.rotation.x = -0.16;
    cockpitGroup.add(hudGlass);

    const mfdBar = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), displayMat);
    mfdBar.position.set(0, dashY + 0.1, dashZ + 0.15);
    mfdBar.rotation.x = -0.1;
    cockpitGroup.add(mfdBar);
  }

  const seatCount = isFighter ? 1 : 2;
  for (let i = 0; i < seatCount; i++) {
    const x = seatCount === 1 ? 0 : (i - 0.5) * 0.56;
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(isFighter ? 0.4 : 0.34, 0.56, 0.08), seatMat);
    seatBack.position.set(x, cpY - 0.08, cpZ + 0.24);
    cockpitGroup.add(seatBack);

    const seatBottom = new THREE.Mesh(new THREE.BoxGeometry(isFighter ? 0.4 : 0.34, 0.065, 0.34), seatMat);
    seatBottom.position.set(x, cpY - 0.5, cpZ + 0.1);
    cockpitGroup.add(seatBottom);

    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.06), seatMat);
    headrest.position.set(x, cpY + 0.25, cpZ + 0.27);
    cockpitGroup.add(headrest);

    const beltMat = new THREE.MeshStandardMaterial({ color: 0x595f69, roughness: 0.8, metalness: 0.06 });
    for (const side of [-1, 1]) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.012), beltMat);
      belt.position.set(x + side * 0.08, cpY - 0.17, cpZ + 0.2);
      belt.rotation.z = side * 0.2;
      cockpitGroup.add(belt);
    }
  }


  const cockpitLight = new THREE.PointLight(0xffead2, 0.15, 3.4, 2);
  cockpitLight.position.set(0, cpY + 0.34, cpZ + 0.02);
  cockpitGroup.add(cockpitLight);

  cockpitGroup.visible = false;
  aircraftGroup.add(cockpitGroup);
}

export function buildAircraftModel(scene, type) {
  aircraftGroup = new THREE.Group();
  engineFanGroups = [];
  cabinWindowMaterials = [];
  cockpitNightMaterials = [];
  propeller = null;
  gearGroup = null;
  landingSpotLight = null;
  landingLightCone = null;
  leftAileron = null;
  rightAileron = null;
  elevator = null;
  rudder = null;
  cockpitGroup = null;
  exteriorBodyParts = [];
  beaconMesh = null;
  strobeLeftMesh = null;
  strobeRightMesh = null;
  navLightLeft = null;
  navLightRight = null;
  tailLogoLight = null;
  cockpitCanvas = null;
  cockpitCtx = null;
  cockpitTexture = null;
  cockpitPanel = null;

  const detail = getAircraftDetailConfig();

  const variant = resolveAircraftVariant(type);
  const mats = createAircraftMaterialSet(type, detail, variant);

  let layout;
  if (variant === 'cessna_172') {
    layout = buildCessnaExterior(type, detail, mats);
  } else if (variant === 'f16') {
    layout = buildF16Exterior(type, detail, mats);
  } else {
    layout = buildJetExterior(type, detail, mats, variant, scene);
  }

  if (type.isSeaplane) {
    addSeaplaneFloats(type, detail, mats, layout);
  } else {
    addLandingGear(type, detail, mats, layout);
  }
  addAircraftLights(detail, layout);
  addSharedAirframeDetails(detail, mats, layout, type, variant);
  buildCockpitInterior(type, detail, mats, layout);

  // Apply toon outlines to major body parts (fuselage, wings, tail)
  for (const part of exteriorBodyParts) {
    addOutline(part, 0.04);
  }

  return {
    aircraftGroup,
    propeller,
    gearGroup,
    engineFanGroups,
    cabinWindowMaterials,
    cockpitNightMaterials,
    aircraftDisposableTextures,
    leftAileron,
    rightAileron,
    elevator,
    rudder,
    cockpitGroup,
    exteriorBodyParts,
    beaconMesh,
    strobeLeftMesh,
    strobeRightMesh,
    navLightLeft,
    navLightRight,
    tailLogoLight,
    landingSpotLight,
    landingLightCone,
    cockpitCanvas,
    cockpitCtx,
    cockpitTexture,
    cockpitPanel,
    layout,
  };
}

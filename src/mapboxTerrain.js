// Real-world satellite terrain from Mapbox tiles
import * as THREE from 'three';
import { getSetting } from './settings.js';

// Airport configurations
export const AIRPORTS = {
  procedural: {
    name: 'Procedural',
    lat: 0, lon: 0,
    runwayHeading: 0,
    runwayLength: 2000,
    runwayWidth: 45,
    elevation: 0,
    zoomLevel: 14,
  },
  kjfk: {
    name: 'KJFK - New York JFK',
    lat: 40.6413,
    lon: -73.7781,
    runwayHeading: 310, // Runway 31L heading
    runwayLength: 3460,
    runwayWidth: 60,
    elevation: 4,
    zoomLevel: 14,
  },
  egll: {
    name: 'EGLL - London Heathrow',
    lat: 51.4700,
    lon: -0.4543,
    runwayHeading: 270, // Runway 27L
    runwayLength: 3660,
    runwayWidth: 50,
    elevation: 25,
    zoomLevel: 14,
  },
  lszs: {
    name: 'LSZS - Swiss Alps Samedan',
    lat: 46.5340,
    lon: 9.8841,
    runwayHeading: 210,
    runwayLength: 1800,
    runwayWidth: 40,
    elevation: 1707,
    zoomLevel: 13,
  },
  rjtt: {
    name: 'RJTT - Tokyo Haneda',
    lat: 35.5494,
    lon: 139.7798,
    runwayHeading: 340,
    runwayLength: 3000,
    runwayWidth: 60,
    elevation: 6,
    zoomLevel: 14,
  },
  yssy: {
    name: 'YSSY - Sydney',
    lat: 33.9461 * -1, // Southern hemisphere
    lon: 151.1772,
    runwayHeading: 340,
    runwayLength: 3960,
    runwayWidth: 45,
    elevation: 6,
    zoomLevel: 14,
  },
};

let terrainMesh = null;
let heightData = null;
let heightGridSize = 0;
let heightGridScale = 0;
let heightGridOffsetX = 0;
let heightGridOffsetZ = 0;
let activeAirport = 'procedural';
let isLoaded = false;

// Mercator projection helpers
function lat2tile(lat, zoom) {
  return (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom);
}

function lon2tile(lon, zoom) {
  return (lon + 180) / 360 * Math.pow(2, zoom);
}

function tile2meters(zoom) {
  // Approximate meters per tile at equator
  return 40075016.686 / Math.pow(2, zoom);
}

// Decode Mapbox terrain-RGB elevation
function decodeTerrainRGB(r, g, b) {
  return -10000 + ((r * 65536 + g * 256 + b) * 0.1);
}

async function fetchTile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return createImageBitmap(blob);
  } catch {
    return null;
  }
}

function getPixelData(imageBitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function getActiveAirport() {
  return activeAirport;
}

export function getAirportConfig(id) {
  return AIRPORTS[id] || AIRPORTS.procedural;
}

export function isMapboxLoaded() {
  return isLoaded && activeAirport !== 'procedural';
}

export async function loadMapboxTerrain(scene, airportId, onProgress) {
  const apiKey = getSetting('mapboxApiKey');
  if (!apiKey || airportId === 'procedural') {
    activeAirport = 'procedural';
    isLoaded = false;
    return null;
  }

  const airport = AIRPORTS[airportId];
  if (!airport) return null;

  activeAirport = airportId;

  const zoom = airport.zoomLevel;
  const centerTileX = Math.floor(lon2tile(airport.lon, zoom));
  const centerTileY = Math.floor(lat2tile(airport.lat, zoom));
  const gridRadius = 2; // 5x5 grid
  const gridSize = gridRadius * 2 + 1;
  const tileMeters = tile2meters(zoom);

  if (onProgress) onProgress(0);

  // Fetch terrain-RGB tiles and satellite tiles
  const terrainTiles = [];
  const satelliteTiles = [];
  let loaded = 0;
  const total = gridSize * gridSize * 2;

  for (let dy = -gridRadius; dy <= gridRadius; dy++) {
    for (let dx = -gridRadius; dx <= gridRadius; dx++) {
      const tx = centerTileX + dx;
      const ty = centerTileY + dy;

      // Terrain RGB
      const terrainUrl = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${tx}/${ty}@2x.pngraw?access_token=${apiKey}`;
      terrainTiles.push(
        fetchTile(terrainUrl).then(img => {
          loaded++;
          if (onProgress) onProgress(loaded / total);
          return { img, dx, dy };
        })
      );

      // Satellite imagery
      const satUrl = `https://api.mapbox.com/v4/mapbox.satellite/${zoom}/${tx}/${ty}@2x.png?access_token=${apiKey}`;
      satelliteTiles.push(
        fetchTile(satUrl).then(img => {
          loaded++;
          if (onProgress) onProgress(loaded / total);
          return { img, dx, dy };
        })
      );
    }
  }

  const [terrainResults, satelliteResults] = await Promise.all([
    Promise.all(terrainTiles),
    Promise.all(satelliteTiles),
  ]);

  // Check if any tiles loaded
  const validTerrain = terrainResults.filter(t => t.img);
  if (validTerrain.length === 0) {
    isLoaded = false;
    return null;
  }

  // Build height grid from terrain tiles
  const tileSize = 512; // @2x tiles are 512px
  const totalPixels = gridSize * tileSize;
  const heights = new Float32Array(totalPixels * totalPixels);
  const totalWorldSize = gridSize * tileMeters;

  for (const tile of terrainResults) {
    if (!tile.img) continue;
    const data = getPixelData(tile.img);
    const offsetX = (tile.dx + gridRadius) * tileSize;
    const offsetY = (tile.dy + gridRadius) * tileSize;

    for (let py = 0; py < tileSize; py++) {
      for (let px = 0; px < tileSize; px++) {
        const srcIdx = (py * tileSize + px) * 4;
        const r = data.data[srcIdx];
        const g = data.data[srcIdx + 1];
        const b = data.data[srcIdx + 2];
        const elevation = decodeTerrainRGB(r, g, b) - airport.elevation;

        const gridX = offsetX + px;
        const gridY = offsetY + py;
        if (gridX < totalPixels && gridY < totalPixels) {
          heights[gridY * totalPixels + gridX] = Math.max(elevation, -5);
        }
      }
    }
  }

  // Store height data for lookups
  heightData = heights;
  heightGridSize = totalPixels;
  heightGridScale = totalWorldSize / totalPixels;
  heightGridOffsetX = -totalWorldSize / 2;
  heightGridOffsetZ = -totalWorldSize / 2;

  // Flatten terrain under runway
  const rwyHalfLen = airport.runwayLength / 2 + 50;
  const rwyHalfWid = airport.runwayWidth / 2 + 30;
  const flattenMargin = 200;
  const headingRad = airport.runwayHeading * Math.PI / 180;
  const cosH = Math.cos(headingRad);
  const sinH = Math.sin(headingRad);

  for (let gy = 0; gy < totalPixels; gy++) {
    for (let gx = 0; gx < totalPixels; gx++) {
      const worldX = heightGridOffsetX + gx * heightGridScale;
      const worldZ = heightGridOffsetZ + gy * heightGridScale;

      // Rotate into runway-local coordinates
      const localX = worldX * cosH + worldZ * sinH;
      const localZ = -worldX * sinH + worldZ * cosH;

      const dxR = Math.max(0, Math.abs(localX) - rwyHalfWid);
      const dzR = Math.max(0, Math.abs(localZ) - rwyHalfLen);
      const dist = Math.sqrt(dxR * dxR + dzR * dzR);

      if (dist < flattenMargin) {
        const factor = dist / flattenMargin;
        const smooth = factor * factor * (3 - 2 * factor);
        const idx = gy * totalPixels + gx;
        heights[idx] = heights[idx] * smooth;
      }
    }
  }

  // Create terrain mesh (downsampled)
  const meshRes = 256;
  const geometry = new THREE.PlaneGeometry(totalWorldSize, totalWorldSize, meshRes, meshRes);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const h = getMapboxTerrainHeight(x, z);
    positions.setY(i, h);
  }
  geometry.computeVertexNormals();

  // Build satellite texture from tiles
  const texCanvas = document.createElement('canvas');
  texCanvas.width = gridSize * tileSize;
  texCanvas.height = gridSize * tileSize;
  const texCtx = texCanvas.getContext('2d');

  for (const tile of satelliteResults) {
    if (!tile.img) continue;
    const ox = (tile.dx + gridRadius) * tileSize;
    const oy = (tile.dy + gridRadius) * tileSize;
    texCtx.drawImage(tile.img, ox, oy);
  }

  const satTexture = new THREE.CanvasTexture(texCanvas);
  satTexture.minFilter = THREE.LinearMipmapLinearFilter;
  satTexture.magFilter = THREE.LinearFilter;
  satTexture.anisotropy = 8;

  const material = new THREE.MeshStandardMaterial({
    map: satTexture,
    roughness: 0.85,
    metalness: 0,
  });

  // Remove old terrain mesh if exists
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
  }

  terrainMesh = new THREE.Mesh(geometry, material);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  isLoaded = true;
  return terrainMesh;
}

export function getMapboxTerrainHeight(x, z) {
  if (!heightData || !isLoaded) return 0;

  // Convert world coords to grid coords
  const gx = (x - heightGridOffsetX) / heightGridScale;
  const gy = (z - heightGridOffsetZ) / heightGridScale;

  // Bilinear interpolation
  const gxi = Math.floor(gx);
  const gyi = Math.floor(gy);
  const fx = gx - gxi;
  const fy = gy - gyi;

  if (gxi < 0 || gxi >= heightGridSize - 1 || gyi < 0 || gyi >= heightGridSize - 1) {
    return 0;
  }

  const h00 = heightData[gyi * heightGridSize + gxi];
  const h10 = heightData[gyi * heightGridSize + gxi + 1];
  const h01 = heightData[(gyi + 1) * heightGridSize + gxi];
  const h11 = heightData[(gyi + 1) * heightGridSize + gxi + 1];

  return h00 * (1 - fx) * (1 - fy) +
         h10 * fx * (1 - fy) +
         h01 * (1 - fx) * fy +
         h11 * fx * fy;
}

export function cleanupMapboxTerrain(scene) {
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
    terrainMesh = null;
  }
  heightData = null;
  isLoaded = false;
  activeAirport = 'procedural';
}

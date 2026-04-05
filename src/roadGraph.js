// ── Road Graph Core ─────────────────────────────────────────────────
// Pure data structure — NO Three.js imports.
// Central graph used by buildings, traffic, pedestrians, terrain, HUD.

import { CITY_BOUNDS, DISTRICTS, getDistrictAt } from './cityData.js';

// ── Spatial grid constants ──────────────────────────────────────────

const CELL_SIZE = 20;
const GRID_ORIGIN_X = CITY_BOUNDS.minX;   // 3000
const GRID_ORIGIN_Z = CITY_BOUNDS.minZ;   // -5000
const GRID_COLS = Math.round((CITY_BOUNDS.maxX - CITY_BOUNDS.minX) / CELL_SIZE); // 100
const GRID_ROWS = Math.round((CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ) / CELL_SIZE); // 100

// ── Module-level graph storage ──────────────────────────────────────

let _cityGraph = null;

export function setCityGraph(graph) { _cityGraph = graph; }
export function getCityGraph() { return _cityGraph; }

// ── Graph CRUD ──────────────────────────────────────────────────────

/** Creates a fresh empty graph. */
export function createGraph() {
  return {
    nodes: new Map(),
    edges: new Map(),
    adjacency: new Map(),
    spatialGrid: null,
    lots: [],
  };
}

/** Adds a node to the graph. Initialises node.edges if missing. */
export function addNode(graph, node) {
  if (!node.edges) node.edges = [];
  graph.nodes.set(node.id, node);
  if (!graph.adjacency.has(node.id)) {
    graph.adjacency.set(node.id, []);
  }
}

/**
 * Adds an edge between two existing nodes.
 * Updates adjacency lists and pushes edge.id onto both endpoint nodes.
 */
export function addEdge(graph, edge) {
  graph.edges.set(edge.id, edge);

  // Adjacency — store edge id for both directions
  const adjFrom = graph.adjacency.get(edge.from);
  if (adjFrom) adjFrom.push(edge.id);

  const adjTo = graph.adjacency.get(edge.to);
  if (adjTo) adjTo.push(edge.id);

  // Push edge id onto the nodes' own edge lists
  const fromNode = graph.nodes.get(edge.from);
  if (fromNode) fromNode.edges.push(edge.id);

  const toNode = graph.nodes.get(edge.to);
  if (toNode) toNode.edges.push(edge.id);
}

// ── Accessors ───────────────────────────────────────────────────────

export function getNode(graph, id) {
  return graph.nodes.get(id) ?? null;
}

export function getEdge(graph, id) {
  return graph.edges.get(id) ?? null;
}

/** Returns all edge objects reachable from a node (both directions). */
export function getEdgesFromNode(graph, nodeId) {
  const ids = graph.adjacency.get(nodeId);
  if (!ids) return [];
  const result = [];
  for (let i = 0; i < ids.length; i++) {
    const e = graph.edges.get(ids[i]);
    if (e) result.push(e);
  }
  return result;
}

/** Returns all nodes within an axis-aligned bounding box. */
export function getNodesInArea(graph, minX, maxX, minZ, maxZ) {
  const result = [];
  for (const node of graph.nodes.values()) {
    // node uses x/z (y is vertical, matching Three.js convention)
    const nx = node.x;
    const nz = node.z !== undefined ? node.z : node.y; // allow z or y field
    if (nx >= minX && nx <= maxX && nz >= minZ && nz <= maxZ) {
      result.push(node);
    }
  }
  return result;
}

// ── Spatial Index ───────────────────────────────────────────────────

/**
 * Rasterises all edges into grid cells for O(1) lookup.
 * Call once after the road network is built.
 */
export function buildSpatialIndex(graph) {
  const grid = new Map();
  const halfStep = CELL_SIZE * 0.5;

  for (const edge of graph.edges.values()) {
    const nFrom = graph.nodes.get(edge.from);
    const nTo   = graph.nodes.get(edge.to);
    if (!nFrom || !nTo) continue;

    const fx = nFrom.x, fz = nFrom.z !== undefined ? nFrom.z : nFrom.y;
    const tx = nTo.x,   tz = nTo.z !== undefined ? nTo.z : nTo.y;

    const dx = tx - fx;
    const dz = tz - fz;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) continue;

    // How many neighbouring cells the edge width can span
    const halfWidth = (edge.width || 10) * 0.5;
    const cellSpan = Math.ceil(halfWidth / CELL_SIZE);

    const steps = Math.ceil(len / halfStep) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = fx + dx * t;
      const pz = fz + dz * t;

      const baseCx = Math.floor((px - GRID_ORIGIN_X) / CELL_SIZE);
      const baseCz = Math.floor((pz - GRID_ORIGIN_Z) / CELL_SIZE);

      // Register in base cell and neighbouring cells within half-width
      for (let oz = -cellSpan; oz <= cellSpan; oz++) {
        for (let ox = -cellSpan; ox <= cellSpan; ox++) {
          const cx = baseCx + ox;
          const cz = baseCz + oz;
          if (cx < 0 || cx >= GRID_COLS || cz < 0 || cz >= GRID_ROWS) continue;

          const key = cz * GRID_COLS + cx;
          let cell = grid.get(key);
          if (!cell) {
            cell = [];
            grid.set(key, cell);
          }
          // Avoid duplicates within the same cell
          if (cell.indexOf(edge.id) === -1) {
            cell.push(edge.id);
          }
        }
      }
    }
  }

  graph.spatialGrid = grid;
}

/**
 * O(1) road-elevation lookup.
 * Returns { elevation, edgeId, t, dist } or null.
 */
export function queryRoadElevation(graph, x, z) {
  const g = graph || _cityGraph;
  if (!g) return null;

  // Bounds check
  if (x < CITY_BOUNDS.minX || x > CITY_BOUNDS.maxX ||
      z < CITY_BOUNDS.minZ || z > CITY_BOUNDS.maxZ) {
    return null;
  }

  if (!g.spatialGrid) return null;

  const cx = Math.floor((x - GRID_ORIGIN_X) / CELL_SIZE);
  const cz = Math.floor((z - GRID_ORIGIN_Z) / CELL_SIZE);
  if (cx < 0 || cx >= GRID_COLS || cz < 0 || cz >= GRID_ROWS) return null;

  const key = cz * GRID_COLS + cx;
  const cell = g.spatialGrid.get(key);
  if (!cell) return null;

  let bestDist = Infinity;
  let bestResult = null;

  for (let i = 0; i < cell.length; i++) {
    const edge = g.edges.get(cell[i]);
    if (!edge) continue;

    const nFrom = g.nodes.get(edge.from);
    const nTo   = g.nodes.get(edge.to);
    if (!nFrom || !nTo) continue;

    const fx = nFrom.x, fz = nFrom.z !== undefined ? nFrom.z : nFrom.y;
    const tx = nTo.x,   tz = nTo.z !== undefined ? nTo.z : nTo.y;

    // Project point onto line segment [from, to]
    const ex = tx - fx;
    const ez = tz - fz;
    const segLenSq = ex * ex + ez * ez;
    if (segLenSq === 0) continue;

    let t = ((x - fx) * ex + (z - fz) * ez) / segLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const projX = fx + ex * t;
    const projZ = fz + ez * t;
    const pdx = x - projX;
    const pdz = z - projZ;
    const dist = Math.sqrt(pdx * pdx + pdz * pdz);

    const halfWidth = (edge.width || 10) * 0.5;
    if (dist > halfWidth) continue;

    if (dist < bestDist) {
      // Interpolate elevation from edge endpoints
      const elev = edge.elevation;
      const y0 = elev ? elev[0] : (nFrom.y ?? 0);
      const y1 = elev ? elev[1] : (nTo.y ?? 0);
      const elevation = y0 + (y1 - y0) * t;

      bestDist = dist;
      bestResult = { elevation, edgeId: edge.id, t, dist };
    }
  }

  return bestResult;
}

// ── Road Generation ─────────────────────────────────────────────────

/** Seeded PRNG — deterministic across calls. Reset at generation start. */
let _seed = 54321;
function srand() { _seed = (_seed * 16807) % 2147483647; return (_seed & 0x7fffffff) / 0x7fffffff; }

/** Distance between two 2D points. */
function dist2(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Find existing node within `radius` of (x, z), or null. */
function findNearNode(graph, x, z, radius) {
  for (const n of graph.nodes.values()) {
    if (dist2(n.x, n.z, x, z) < radius) return n;
  }
  return null;
}

let _nodeId = 0;
let _edgeId = 0;
function nextNodeId() { return `n${_nodeId++}`; }
function nextEdgeId() { return `e${_edgeId++}`; }

/** Clamp a value to city bounds. */
function clampX(x) { return Math.max(CITY_BOUNDS.minX, Math.min(CITY_BOUNDS.maxX, x)); }
function clampZ(z) { return Math.max(CITY_BOUNDS.minZ, Math.min(CITY_BOUNDS.maxZ, z)); }

/** Add-or-reuse a node at (x, z). Dedup within 20m. */
function ensureNode(graph, x, z, getHeightAt) {
  const cx = clampX(x), cz = clampZ(z);
  const existing = findNearNode(graph, cx, cz, 20);
  if (existing) return existing;
  const node = { id: nextNodeId(), x: cx, y: getHeightAt(cx, cz), z: cz, edges: [] };
  addNode(graph, node);
  return node;
}

/** Add edge between two nodes if no duplicate edge exists. */
function ensureEdge(graph, fromNode, toNode, props) {
  // Check for existing edge between these nodes
  for (const eid of fromNode.edges) {
    const e = graph.edges.get(eid);
    if (!e) continue;
    if ((e.from === fromNode.id && e.to === toNode.id) ||
        (e.from === toNode.id && e.to === fromNode.id)) return e;
  }
  const edge = {
    id: nextEdgeId(),
    from: fromNode.id,
    to: toNode.id,
    elevation: [fromNode.y, toNode.y],
    ...props,
  };
  addEdge(graph, edge);
  return edge;
}

/**
 * Delaunay triangulation for a small set of 2D points.
 * Returns array of [i, j] index pairs (edges of the triangulation).
 * Uses the simple super-triangle approach.
 */
function delaunayEdges(points) {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) return [[0, 1]];

  // Super triangle encompassing all points
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const dx = maxX - minX, dz = maxZ - minZ;
  const dmax = Math.max(dx, dz) * 2;
  const midX = (minX + maxX) * 0.5, midZ = (minZ + maxZ) * 0.5;

  // Super-triangle vertices
  const st0 = [midX - dmax * 2, midZ - dmax];
  const st1 = [midX + dmax * 2, midZ - dmax];
  const st2 = [midX, midZ + dmax * 2];
  const allPts = points.concat([st0, st1, st2]);

  // Triangles stored as [i, j, k]
  let triangles = [[n, n + 1, n + 2]];

  // Circumcircle test
  function inCircumcircle(px, pz, ax, az, bx, bz, cx, cz) {
    const dAx = ax - px, dAz = az - pz;
    const dBx = bx - px, dBz = bz - pz;
    const dCx = cx - px, dCz = cz - pz;
    return (dAx * dAx + dAz * dAz) * (dBx * dCz - dCx * dBz)
         - (dBx * dBx + dBz * dBz) * (dAx * dCz - dCx * dAz)
         + (dCx * dCx + dCz * dCz) * (dAx * dBz - dBx * dAz) > 0;
  }

  for (let i = 0; i < n; i++) {
    const px = allPts[i][0], pz = allPts[i][1];
    const badTriangles = [];
    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      const a = allPts[tri[0]], b = allPts[tri[1]], c = allPts[tri[2]];
      if (inCircumcircle(px, pz, a[0], a[1], b[0], b[1], c[0], c[1])) {
        badTriangles.push(t);
      }
    }
    // Find polygon boundary of bad triangles
    const polyEdges = [];
    for (const bt of badTriangles) {
      const tri = triangles[bt];
      for (let j = 0; j < 3; j++) {
        const e0 = tri[j], e1 = tri[(j + 1) % 3];
        let shared = false;
        for (const bt2 of badTriangles) {
          if (bt2 === bt) continue;
          const tri2 = triangles[bt2];
          if ((tri2.includes(e0) && tri2.includes(e1))) { shared = true; break; }
        }
        if (!shared) polyEdges.push([e0, e1]);
      }
    }
    // Remove bad triangles (reverse order)
    badTriangles.sort((a, b) => b - a);
    for (const bt of badTriangles) triangles.splice(bt, 1);
    // Create new triangles
    for (const [e0, e1] of polyEdges) {
      triangles.push([i, e0, e1]);
    }
  }

  // Collect edges from triangles, excluding super-triangle vertices
  const edgeSet = new Set();
  for (const tri of triangles) {
    if (tri[0] >= n || tri[1] >= n || tri[2] >= n) continue;
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeSet.add(key);
    }
  }
  return [...edgeSet].map(k => k.split('-').map(Number));
}

/**
 * Generate a complete city road graph from district definitions.
 * @param {function(number, number): number} getHeightAt  terrain height sampler
 * @returns {object} graph with nodes, edges, adjacency, lots, spatialGrid
 */
export function generateCityRoadGraph(getHeightAt) {
  // Reset deterministic state
  _seed = 54321;
  _nodeId = 0;
  _edgeId = 0;

  const graph = createGraph();

  // ── 1. Arterials via Delaunay triangulation ──────────────────────
  const centers = DISTRICTS.map(d => d.center);
  const triEdges = delaunayEdges(centers);

  // Also add all pairwise connections < 1500m (for 5 points, Delaunay may miss some)
  const pairSet = new Set(triEdges.map(([a, b]) => a < b ? `${a}-${b}` : `${b}-${a}`));
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const d = dist2(centers[i][0], centers[i][1], centers[j][0], centers[j][1]);
      if (d <= 1500) {
        const key = `${i}-${j}`;
        if (!pairSet.has(key)) {
          triEdges.push([i, j]);
          pairSet.add(key);
        }
      }
    }
  }

  // Map district index -> arterial node at center
  const centerNodes = [];
  for (const d of DISTRICTS) {
    centerNodes.push(ensureNode(graph, d.center[0], d.center[1], getHeightAt));
  }

  const arterialProps = { type: 'arterial', lanes: 4, width: 16, speedLimit: 50, sidewalks: true, parking: 'none' };

  for (const [i, j] of triEdges) {
    const nA = centerNodes[i];
    const nB = centerNodes[j];
    const segLen = dist2(nA.x, nA.z, nB.x, nB.z);

    if (segLen <= 200) {
      ensureEdge(graph, nA, nB, arterialProps);
    } else {
      // Add intermediate nodes every ~200m
      const steps = Math.ceil(segLen / 200);
      let prev = nA;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mx = nA.x + (nB.x - nA.x) * t;
        const mz = nA.z + (nB.z - nA.z) * t;
        const next = s === steps ? nB : ensureNode(graph, mx, mz, getHeightAt);
        ensureEdge(graph, prev, next, arterialProps);
        prev = next;
      }
    }
  }

  // ── 2. Block grids per district ──────────────────────────────────
  // For each district, lay out a grid within its radius, clipped to CITY_BOUNDS.
  // Grid aligned to the nearest arterial direction for variety.

  /** All grid nodes per district, stored for lot generation. */
  const districtGrids = [];

  for (let di = 0; di < DISTRICTS.length; di++) {
    const d = DISTRICTS[di];
    const bs = d.blockSize;
    const cx = d.center[0], cz = d.center[1];

    // Find nearest arterial direction for grid alignment
    const cNode = centerNodes[di];
    let bestAngle = 0;
    let bestDist = Infinity;
    for (const eid of cNode.edges) {
      const e = graph.edges.get(eid);
      if (!e || e.type !== 'arterial') continue;
      const other = graph.nodes.get(e.from === cNode.id ? e.to : e.from);
      if (!other) continue;
      const dd = dist2(cNode.x, cNode.z, other.x, other.z);
      if (dd < bestDist) {
        bestDist = dd;
        bestAngle = Math.atan2(other.z - cNode.z, other.x - cNode.x);
      }
    }

    // Snap angle to nearest 15 degrees to keep things tidy
    bestAngle = Math.round(bestAngle / (Math.PI / 12)) * (Math.PI / 12);
    const cosA = Math.cos(bestAngle), sinA = Math.sin(bestAngle);

    // Grid extent in local coords
    const extent = d.radius + bs * 0.5;
    const halfSteps = Math.ceil(extent / bs);

    const gridNodes = []; // 2D array [row][col] of node references or null
    for (let row = -halfSteps; row <= halfSteps; row++) {
      const rowArr = [];
      for (let col = -halfSteps; col <= halfSteps; col++) {
        // Local grid position
        const lx = col * bs;
        const lz = row * bs;
        // Rotate to world
        const wx = cx + lx * cosA - lz * sinA;
        const wz = cz + lx * sinA + lz * cosA;

        // Clip to city bounds and district radius
        if (wx < CITY_BOUNDS.minX || wx > CITY_BOUNDS.maxX ||
            wz < CITY_BOUNDS.minZ || wz > CITY_BOUNDS.maxZ) {
          rowArr.push(null);
          continue;
        }
        const dr = dist2(wx, wz, cx, cz);
        if (dr > d.radius + bs * 0.25) {
          rowArr.push(null);
          continue;
        }

        const node = ensureNode(graph, wx, wz, getHeightAt);
        rowArr.push(node);
      }
      gridNodes.push(rowArr);
    }

    const localEdgeProps = {
      type: 'local', lanes: 2, width: 8, speedLimit: 30,
      sidewalks: true, parking: 'street', district: d.type,
    };

    // Connect grid edges
    const rows = gridNodes.length;
    for (let r = 0; r < rows; r++) {
      const cols = gridNodes[r].length;
      for (let c = 0; c < cols; c++) {
        const n = gridNodes[r][c];
        if (!n) continue;
        // Right neighbour
        if (c + 1 < cols && gridNodes[r][c + 1]) {
          ensureEdge(graph, n, gridNodes[r][c + 1], localEdgeProps);
        }
        // Down neighbour
        if (r + 1 < rows && gridNodes[r + 1][c]) {
          ensureEdge(graph, n, gridNodes[r + 1][c], localEdgeProps);
        }
      }
    }

    // ── 3. Promote collectors ────────────────────────────────────────
    // Every 3rd row and column, upgrade edges to collector type
    const collectorProps = {
      type: 'collector', lanes: 2, width: 10, speedLimit: 40,
      sidewalks: true, parking: 'none', district: d.type,
    };

    for (let r = 0; r < rows; r++) {
      const cols = gridNodes[r].length;
      const isCollectorRow = (r % 3 === 0);
      for (let c = 0; c < cols; c++) {
        const isCollectorCol = (c % 3 === 0);
        const n = gridNodes[r][c];
        if (!n) continue;

        if (isCollectorRow && c + 1 < cols && gridNodes[r][c + 1]) {
          // Upgrade horizontal edge to collector
          promoteEdge(graph, n, gridNodes[r][c + 1], collectorProps);
        }
        if (isCollectorCol && r + 1 < rows && gridNodes[r + 1][c]) {
          // Upgrade vertical edge to collector
          promoteEdge(graph, n, gridNodes[r + 1][c], collectorProps);
        }

        // Connect collector nodes to nearest arterial
        if ((isCollectorRow || isCollectorCol) && n.edges.length > 0) {
          connectToNearestArterial(graph, n, getHeightAt);
        }
      }
    }

    districtGrids.push({ district: d, gridNodes });
  }

  // ── 4. Expressways & ramps ─────────────────────────────────────────

  const HIGHWAY_ROUTES = [
    { name: 'H1', points: [[650,-2000],[250,-2300],[950,-2950],[1650,-3325],[2550,-3725],[3350,-4550],[4200,-5450]] },
    { name: 'H2', points: [[4200,-5450],[5400,-6200],[6500,-5850],[7600,-5400]], externalSpline: true },
    { name: 'H3', points: [[4000,-4000],[3600,-3600],[3000,-3200],[2400,-2800],[1800,-2400]] },
  ];

  const EXPRESSWAY_SPACING = 120; // metres between sample points
  const MAX_GRADE = 0.12;         // 12% slope limit
  const HWY_BUFFER = 500;         // extend beyond city bounds

  const expresswayProps = { type: 'expressway', lanes: 6, width: 24, speedLimit: 100, sidewalks: false, parking: 'none' };

  /** Add a highway node WITHOUT clamping to city bounds. */
  function addHighwayNode(gph, x, z, ht) {
    // Dedup within 20m (mirrors ensureNode but without clamp)
    const existing = findNearNode(gph, x, z, 20);
    if (existing) return existing;
    const node = { id: nextNodeId(), x, y: ht(x, z) + 0.3, z, edges: [] };
    addNode(gph, node);
    return node;
  }

  /** Linearly interpolate between control points at fixed spacing. */
  function sampleSpline(controlPts, spacing) {
    const samples = [];
    // Walk each segment of the polyline
    for (let i = 0; i < controlPts.length - 1; i++) {
      const [ax, az] = controlPts[i];
      const [bx, bz] = controlPts[i + 1];
      const segLen = dist2(ax, az, bx, bz);
      const steps = Math.max(1, Math.round(segLen / spacing));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        samples.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    }
    // Always include the last control point
    const last = controlPts[controlPts.length - 1];
    samples.push([last[0], last[1]]);
    return samples;
  }

  /** All expressway nodes across all routes, for ramp connections. */
  const allExpresswayNodes = [];

  for (const route of HIGHWAY_ROUTES) {
    const samples = sampleSpline(route.points, EXPRESSWAY_SPACING);
    const hwNodes = [];

    // Create nodes for each sample point
    for (const [sx, sz] of samples) {
      hwNodes.push(addHighwayNode(graph, sx, sz, getHeightAt));
    }

    // Grade limiting: max 12% slope between consecutive nodes
    for (let i = 0; i < hwNodes.length - 1; i++) {
      const a = hwNodes[i], b = hwNodes[i + 1];
      const horiz = dist2(a.x, a.z, b.x, b.z);
      if (horiz === 0) continue;
      const slope = Math.abs(b.y - a.y) / horiz;
      if (slope > MAX_GRADE) {
        const maxRise = horiz * MAX_GRADE;
        if (b.y > a.y) {
          b.y = a.y + maxRise;
        } else {
          b.y = a.y - maxRise;
        }
      }
    }

    // Connect consecutive nodes with expressway edges
    for (let i = 0; i < hwNodes.length - 1; i++) {
      ensureEdge(graph, hwNodes[i], hwNodes[i + 1], expresswayProps);
    }

    // Mark external spline termination node on H2
    if (route.externalSpline) {
      hwNodes[hwNodes.length - 1].externalSpline = true;
    }

    allExpresswayNodes.push(...hwNodes);
  }

  // ── Ramps: connect districts to expressway ───────────────────────

  const rampOffExpressway = { type: 'ramp', lanes: 1, width: 5, speedLimit: 60 };
  const rampToArterial    = { type: 'ramp', lanes: 1, width: 5, speedLimit: 40 };
  const rampFromArterial  = { type: 'ramp', lanes: 1, width: 5, speedLimit: 40, merge: true };
  const rampOntoExpressway = { type: 'ramp', lanes: 1, width: 5, speedLimit: 80, merge: true };

  for (let di = 0; di < DISTRICTS.length; di++) {
    const d = DISTRICTS[di];
    const dcx = d.center[0], dcz = d.center[1];

    // Find nearest expressway node to district center
    let nearestHW = null, nearestHWDist = Infinity;
    for (const n of allExpresswayNodes) {
      const dd = dist2(n.x, n.z, dcx, dcz);
      if (dd < nearestHWDist) { nearestHWDist = dd; nearestHW = n; }
    }

    // Find nearest arterial node to district center
    let nearestArt = null, nearestArtDist = Infinity;
    for (const n of graph.nodes.values()) {
      let hasArterial = false;
      for (const eid of n.edges) {
        const e = graph.edges.get(eid);
        if (e && e.type === 'arterial') { hasArterial = true; break; }
      }
      if (!hasArterial) continue;
      const dd = dist2(n.x, n.z, dcx, dcz);
      if (dd < nearestArtDist) { nearestArtDist = dd; nearestArt = n; }
    }

    if (!nearestHW || !nearestArt) continue;

    // Create ramp node midway between expressway and arterial nodes
    const rampX = (nearestHW.x + nearestArt.x) * 0.5;
    const rampZ = (nearestHW.z + nearestArt.z) * 0.5;
    const rampNode = ensureNode(graph, rampX, rampZ, getHeightAt);

    // Off-ramp: expressway → ramp → arterial
    ensureEdge(graph, nearestHW, rampNode, rampOffExpressway);
    ensureEdge(graph, rampNode, nearestArt, rampToArterial);

    // On-ramp: arterial → ramp → expressway
    // Use the same ramp node but edges go the other direction
    // ensureEdge deduplicates bidirectional, so create a second ramp node offset slightly
    const rampX2 = rampX + 15;
    const rampZ2 = rampZ + 15;
    const rampNode2 = ensureNode(graph, rampX2, rampZ2, getHeightAt);

    ensureEdge(graph, nearestArt, rampNode2, rampFromArterial);
    ensureEdge(graph, rampNode2, nearestHW, rampOntoExpressway);
  }

  // ── 5. Generate building lots ──────────────────────────────────────
  const lotConfigs = {
    downtown:    { width: 0, depth: 0, setback: 0, fullBlock: true },
    residential: { width: 20, depth: 30, setback: 4, fullBlock: false },
    commercial:  { width: 30, depth: 40, setback: 1, fullBlock: false },
    industrial:  { width: 40, depth: 60, setback: 2, fullBlock: false },
    waterfront:  { width: 25, depth: 35, setback: 1, fullBlock: false },
  };

  for (const { district: d, gridNodes } of districtGrids) {
    const rows = gridNodes.length;
    for (let r = 0; r < rows - 1; r++) {
      const cols = gridNodes[r].length;
      for (let c = 0; c < cols - 1; c++) {
        const tl = gridNodes[r][c];
        const tr = gridNodes[r][c + 1];
        const bl = gridNodes[r + 1][c];
        const br = gridNodes[r + 1][c + 1];
        if (!tl || !tr || !bl || !br) continue;

        // Block center and dimensions
        const bx = (tl.x + tr.x + bl.x + br.x) * 0.25;
        const bz = (tl.z + tr.z + bl.z + br.z) * 0.25;
        const blockW = dist2(tl.x, tl.z, tr.x, tr.z);
        const blockD = dist2(tl.x, tl.z, bl.x, bl.z);
        const blockRot = Math.atan2(tr.z - tl.z, tr.x - tl.x);

        // Check if block is near an arterial
        let nearArterial = false;
        for (const nid of [tl.id, tr.id, bl.id, br.id]) {
          const node = graph.nodes.get(nid);
          if (!node) continue;
          for (const eid of node.edges) {
            const e = graph.edges.get(eid);
            if (e && e.type === 'arterial') { nearArterial = true; break; }
          }
          if (nearArterial) break;
        }

        const cfg = lotConfigs[d.type] || lotConfigs.residential;

        if (cfg.fullBlock) {
          // Downtown: one lot per block
          graph.lots.push({
            x: bx, z: bz,
            width: blockW - 4, depth: blockD - 4,
            district: d.type, nearArterial, rotation: blockRot,
          });
        } else {
          // Subdivide block into lots
          const lw = cfg.width, ld = cfg.depth;
          const sb = cfg.setback;
          const usableW = blockW - sb * 2;
          const usableD = blockD - sb * 2;
          const nCols = Math.max(1, Math.floor(usableW / lw));
          const nRows = Math.max(1, Math.floor(usableD / ld));
          const cosR = Math.cos(blockRot), sinR = Math.sin(blockRot);

          for (let lr = 0; lr < nRows; lr++) {
            for (let lc = 0; lc < nCols; lc++) {
              // Local offset from block center
              const lox = -usableW * 0.5 + (lc + 0.5) * (usableW / nCols);
              const loz = -usableD * 0.5 + (lr + 0.5) * (usableD / nRows);
              // Rotate to world
              const wx = bx + lox * cosR - loz * sinR;
              const wz = bz + lox * sinR + loz * cosR;
              // Skip if out of bounds
              if (wx < CITY_BOUNDS.minX || wx > CITY_BOUNDS.maxX ||
                  wz < CITY_BOUNDS.minZ || wz > CITY_BOUNDS.maxZ) continue;

              graph.lots.push({
                x: wx, z: wz,
                width: usableW / nCols, depth: usableD / nRows,
                district: d.type, nearArterial, rotation: blockRot,
              });
            }
          }
        }
      }
    }
  }

  // ── 6. Build spatial index ─────────────────────────────────────────
  buildSpatialIndex(graph);

  return graph;
}

/** Promote an edge between two nodes to a higher road class. */
function promoteEdge(graph, nodeA, nodeB, props) {
  for (const eid of nodeA.edges) {
    const e = graph.edges.get(eid);
    if (!e) continue;
    if ((e.from === nodeA.id && e.to === nodeB.id) ||
        (e.from === nodeB.id && e.to === nodeA.id)) {
      // Only promote upward (local -> collector -> arterial)
      const rank = { local: 0, collector: 1, arterial: 2 };
      if ((rank[props.type] || 0) > (rank[e.type] || 0)) {
        e.type = props.type;
        e.lanes = props.lanes;
        e.width = props.width;
        e.speedLimit = props.speedLimit;
        if (props.parking !== undefined) e.parking = props.parking;
      }
      return;
    }
  }
  // No existing edge — create one
  ensureEdge(graph, nodeA, nodeB, props);
}

/** Connect a node to the nearest arterial node, if not already connected. */
function connectToNearestArterial(graph, node, getHeightAt) {
  // Already connected to an arterial?
  for (const eid of node.edges) {
    const e = graph.edges.get(eid);
    if (e && e.type === 'arterial') return;
  }
  // Find nearest arterial node
  let bestNode = null, bestDist = Infinity;
  for (const n of graph.nodes.values()) {
    if (n.id === node.id) continue;
    let hasArterial = false;
    for (const eid of n.edges) {
      const e = graph.edges.get(eid);
      if (e && e.type === 'arterial') { hasArterial = true; break; }
    }
    if (!hasArterial) continue;
    const d = dist2(node.x, node.z, n.x, n.z);
    if (d < bestDist && d < 400) {
      bestDist = d;
      bestNode = n;
    }
  }
  if (bestNode) {
    ensureEdge(graph, node, bestNode, {
      type: 'collector', lanes: 2, width: 10, speedLimit: 40,
      sidewalks: true, parking: 'none',
    });
  }
}

// ── A* Pathfinding ──────────────────────────────────────────────────

/**
 * A* pathfinding on the road graph.
 * @param {object} graph  - graph with nodes, edges, adjacency
 * @param {string} startId - starting node ID
 * @param {string} endId   - destination node ID
 * @returns {string[]|null} array of node IDs from start to end, or null if unreachable
 */
export function findPath(graph, startId, endId) {
  const endNode = graph.nodes.get(endId);
  if (!endNode) return null;
  const startNode = graph.nodes.get(startId);
  if (!startNode) return null;

  // Trivial case: start === end
  if (startId === endId) return [startId];

  const open = new Map();   // nodeId -> { f, g, parent }
  const closed = new Map(); // nodeId -> parentId

  const h = (n) => Math.sqrt((n.x - endNode.x) ** 2 + (n.z - endNode.z) ** 2);
  open.set(startId, { f: h(startNode), g: 0, parent: null });

  while (open.size > 0) {
    // Find lowest f in open set
    let currentId = null, currentF = Infinity;
    for (const [id, data] of open) {
      if (data.f < currentF) { currentF = data.f; currentId = id; }
    }

    if (currentId === endId) {
      // Reconstruct path through both open and closed maps
      const path = [];
      let id = endId;
      while (id !== null) {
        path.unshift(id);
        const openData = open.get(id);
        id = openData ? openData.parent : (closed.get(id) ?? null);
      }
      return path;
    }

    const currentData = open.get(currentId);
    open.delete(currentId);
    closed.set(currentId, currentData.parent); // store parent in closed map

    const edges = getEdgesFromNode(graph, currentId);
    for (const edge of edges) {
      const neighborId = edge.from === currentId ? edge.to : edge.from;
      if (closed.has(neighborId)) continue;

      const neighbor = graph.nodes.get(neighborId);
      const dx = neighbor.x - graph.nodes.get(currentId).x;
      const dz = neighbor.z - graph.nodes.get(currentId).z;
      const edgeCost = Math.sqrt(dx * dx + dz * dz);
      const gNew = currentData.g + edgeCost;

      const existing = open.get(neighborId);
      if (!existing || gNew < existing.g) {
        open.set(neighborId, { f: gNew + h(neighbor), g: gNew, parent: currentId });
      }
    }
  }
  return null;
}

// ── HUD Compatibility Export ────────────────────────────────────────

let _roadNetworkCache = null;

/**
 * Returns the road network in the format the HUD minimap expects:
 * [{ start: {x, z}, end: {x, z}, width, type, direction, lanes }]
 * Caches the result for performance.
 */
export function getRoadNetworkCompat(graph) {
  if (_roadNetworkCache) return _roadNetworkCache;
  const g = graph || _cityGraph;
  if (!g) return [];
  _roadNetworkCache = [...g.edges.values()].map(e => {
    const nFrom = g.nodes.get(e.from);
    const nTo = g.nodes.get(e.to);
    return {
      start: { x: nFrom.x, z: nFrom.z },
      end: { x: nTo.x, z: nTo.z },
      width: e.width,
      type: e.type,
      direction: Math.atan2(nTo.z - nFrom.z, nTo.x - nFrom.x),
      lanes: e.lanes,
    };
  });
  return _roadNetworkCache;
}

/** Clears the cached road network compat data. Call when graph is regenerated. */
export function clearRoadNetworkCache() {
  _roadNetworkCache = null;
}

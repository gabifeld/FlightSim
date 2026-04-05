import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGraph,
  addNode,
  addEdge,
  getNode,
  getEdge,
  getEdgesFromNode,
  getNodesInArea,
  buildSpatialIndex,
  queryRoadElevation,
  setCityGraph,
  getCityGraph,
  generateCityRoadGraph,
  findPath,
  getRoadNetworkCompat,
  clearRoadNetworkCache,
} from '../src/roadGraph.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeNode(id, x, y, z) {
  return { id, x, y, z, signal: null };
}

function makeEdge(id, from, to, opts = {}) {
  return {
    id,
    from,
    to,
    lanes: opts.lanes ?? 2,
    width: opts.width ?? 10,
    type: opts.type ?? 'local',
    speedLimit: opts.speedLimit ?? 13,
    sidewalks: opts.sidewalks ?? true,
    parking: opts.parking ?? false,
    district: opts.district ?? 'residential',
    elevation: opts.elevation ?? [0, 0],
  };
}

/** Builds a small two-node graph inside city bounds for spatial tests. */
function buildKnownGraph() {
  const g = createGraph();
  addNode(g, makeNode('A', 4000, 5, -4000));
  addNode(g, makeNode('B', 4100, 7, -4000));
  addEdge(g, makeEdge('e1', 'A', 'B', {
    width: 10,
    type: 'arterial',
    elevation: [5, 7],
  }));
  buildSpatialIndex(g);
  return g;
}

// ── Graph core ──────────────────────────────────────────────────────

describe('Graph core', () => {
  let g;
  beforeEach(() => { g = createGraph(); });

  it('createGraph returns the expected shape', () => {
    expect(g.nodes).toBeInstanceOf(Map);
    expect(g.edges).toBeInstanceOf(Map);
    expect(g.adjacency).toBeInstanceOf(Map);
    expect(g.spatialGrid).toBeNull();
    expect(Array.isArray(g.lots)).toBe(true);
  });

  it('adds and retrieves nodes', () => {
    const n = makeNode('n1', 4000, 5, -4000);
    addNode(g, n);
    expect(getNode(g, 'n1')).toBe(n);
    expect(getNode(g, 'missing')).toBeNull();
  });

  it('initialises node.edges if not present', () => {
    const n = { id: 'n2', x: 4000, y: 5, z: -4000, signal: null };
    addNode(g, n);
    expect(Array.isArray(n.edges)).toBe(true);
    expect(n.edges).toHaveLength(0);
  });

  it('does not overwrite existing node.edges', () => {
    const n = makeNode('n3', 4000, 5, -4000);
    n.edges = ['pre-existing'];
    addNode(g, n);
    expect(n.edges).toContain('pre-existing');
  });

  it('adds edges between nodes', () => {
    addNode(g, makeNode('a', 4000, 5, -4000));
    addNode(g, makeNode('b', 4100, 7, -4000));
    const e = makeEdge('e1', 'a', 'b', { elevation: [5, 7] });
    addEdge(g, e);
    expect(getEdge(g, 'e1')).toBe(e);
    expect(getEdge(g, 'missing')).toBeNull();
  });

  it('addEdge populates node.edges arrays on both from and to nodes', () => {
    addNode(g, makeNode('a', 4000, 5, -4000));
    addNode(g, makeNode('b', 4100, 7, -4000));
    addEdge(g, makeEdge('e1', 'a', 'b'));
    expect(getNode(g, 'a').edges).toContain('e1');
    expect(getNode(g, 'b').edges).toContain('e1');
  });

  it('finds edges from a node (including both directions)', () => {
    addNode(g, makeNode('a', 4000, 5, -4000));
    addNode(g, makeNode('b', 4100, 7, -4000));
    addNode(g, makeNode('c', 4000, 6, -4100));
    addEdge(g, makeEdge('e1', 'a', 'b'));
    addEdge(g, makeEdge('e2', 'c', 'a'));  // a is the "to" node here

    const edges = getEdgesFromNode(g, 'a');
    expect(edges).toHaveLength(2);
    const ids = edges.map(e => e.id).sort();
    expect(ids).toEqual(['e1', 'e2']);
  });

  it('getEdgesFromNode returns empty array for unknown node', () => {
    expect(getEdgesFromNode(g, 'nope')).toEqual([]);
  });

  it('getNodesInArea returns correct subset', () => {
    addNode(g, makeNode('inside1', 4050, 5, -4050));
    addNode(g, makeNode('inside2', 4100, 6, -4000));
    addNode(g, makeNode('outside', 3000, 5, -3000));

    const result = getNodesInArea(g, 4000, 4200, -4100, -3900);
    const ids = result.map(n => n.id).sort();
    expect(ids).toEqual(['inside1', 'inside2']);
  });

  it('getNodesInArea returns empty array when no nodes match', () => {
    addNode(g, makeNode('far', 100, 0, 100));
    expect(getNodesInArea(g, 4000, 4100, -4100, -4000)).toEqual([]);
  });

  it('getNodesInArea includes nodes on the boundary', () => {
    addNode(g, makeNode('edge', 4000, 0, -4000));
    const result = getNodesInArea(g, 4000, 4000, -4000, -4000);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('edge');
  });
});

// ── Spatial index ───────────────────────────────────────────────────

describe('Spatial index', () => {
  let g;
  beforeEach(() => { g = buildKnownGraph(); });

  it('buildSpatialIndex populates the spatial grid', () => {
    expect(g.spatialGrid).toBeInstanceOf(Map);
    expect(g.spatialGrid.size).toBeGreaterThan(0);
  });

  it('queryRoadElevation at midpoint returns elevation ~6.0', () => {
    const result = queryRoadElevation(g, 4050, -4000);
    expect(result).not.toBeNull();
    expect(result.elevation).toBeCloseTo(6.0, 1);
  });

  it('queryRoadElevation 3m off centreline still returns result', () => {
    // Edge width is 10, so half-width = 5. 3m off centre should still hit.
    const result = queryRoadElevation(g, 4050, -4003);
    expect(result).not.toBeNull();
    expect(result.elevation).toBeCloseTo(6.0, 0);
  });

  it('queryRoadElevation far from any road returns null', () => {
    // (3500, -3500) is inside city bounds but far from the edge at y=-4000
    const result = queryRoadElevation(g, 3500, -3500);
    expect(result).toBeNull();
  });

  it('queryRoadElevation outside city bounds returns null', () => {
    expect(queryRoadElevation(g, 0, 0)).toBeNull();
    expect(queryRoadElevation(g, 2999, -4000)).toBeNull();
    expect(queryRoadElevation(g, 5001, -4000)).toBeNull();
    expect(queryRoadElevation(g, 4000, -2999)).toBeNull();
    expect(queryRoadElevation(g, 4000, -5001)).toBeNull();
  });

  it('result includes edgeId and t parameter', () => {
    const result = queryRoadElevation(g, 4050, -4000);
    expect(result).toHaveProperty('edgeId', 'e1');
    expect(result).toHaveProperty('t');
    expect(result.t).toBeCloseTo(0.5, 1);
    expect(result).toHaveProperty('dist');
  });

  it('elevation interpolation is correct at t=0.25 (expect ~5.5)', () => {
    // t=0.25 means 25% along the edge from A(5) to B(7): 5 + 0.25*2 = 5.5
    const result = queryRoadElevation(g, 4025, -4000);
    expect(result).not.toBeNull();
    expect(result.elevation).toBeCloseTo(5.5, 1);
    expect(result.t).toBeCloseTo(0.25, 1);
  });

  it('elevation at start node matches from-elevation', () => {
    const result = queryRoadElevation(g, 4000, -4000);
    expect(result).not.toBeNull();
    expect(result.elevation).toBeCloseTo(5.0, 1);
  });

  it('elevation at end node matches to-elevation', () => {
    const result = queryRoadElevation(g, 4100, -4000);
    expect(result).not.toBeNull();
    expect(result.elevation).toBeCloseTo(7.0, 1);
  });

  it('returns null when spatial index has not been built', () => {
    const g2 = createGraph();
    addNode(g2, makeNode('a', 4000, 5, -4000));
    addNode(g2, makeNode('b', 4100, 7, -4000));
    addEdge(g2, makeEdge('e1', 'a', 'b', { elevation: [5, 7], width: 10 }));
    // spatialGrid is still null — no buildSpatialIndex call
    expect(queryRoadElevation(g2, 4050, -4000)).toBeNull();
  });

  it('point just outside half-width returns null', () => {
    // Edge width 10 → half-width 5. 6m off should be outside.
    const result = queryRoadElevation(g, 4050, -4006);
    expect(result).toBeNull();
  });
});

// ── Module-level graph ──────────────────────────────────────────────

describe('Module-level graph', () => {
  beforeEach(() => { setCityGraph(null); });

  it('setCityGraph / getCityGraph round-trips', () => {
    const g = createGraph();
    setCityGraph(g);
    expect(getCityGraph()).toBe(g);
  });

  it('getCityGraph returns null by default', () => {
    expect(getCityGraph()).toBeNull();
  });

  it('queryRoadElevation with null graph uses module-level graph', () => {
    const g = buildKnownGraph();
    setCityGraph(g);

    const result = queryRoadElevation(null, 4050, -4000);
    expect(result).not.toBeNull();
    expect(result.elevation).toBeCloseTo(6.0, 1);
    expect(result.edgeId).toBe('e1');
  });

  it('queryRoadElevation with null graph and no module-level graph returns null', () => {
    expect(queryRoadElevation(null, 4050, -4000)).toBeNull();
  });
});

// ── Road generation ─────────────────────────────────────────────────

const flatHeight = () => 5;

describe('Road generation', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('generates nodes', () => expect(g.nodes.size).toBeGreaterThan(50));
  it('generates edges', () => expect(g.edges.size).toBeGreaterThan(50));
  it('has arterial edges', () => {
    const a = [...g.edges.values()].filter(e => e.type === 'arterial');
    expect(a.length).toBeGreaterThan(3);
  });
  it('has local roads', () => {
    const l = [...g.edges.values()].filter(e => e.type === 'local');
    expect(l.length).toBeGreaterThan(20);
  });
  it('has collector roads', () => {
    const c = [...g.edges.values()].filter(e => e.type === 'collector');
    expect(c.length).toBeGreaterThan(3);
  });
  it('non-expressway nodes within city bounds', () => {
    // Expressway nodes may extend beyond city bounds (highways connect to airports)
    const expresswayNodeIds = new Set();
    for (const e of g.edges.values()) {
      if (e.type === 'expressway' || e.type === 'ramp') {
        expresswayNodeIds.add(e.from);
        expresswayNodeIds.add(e.to);
      }
    }
    for (const [id, n] of g.nodes) {
      if (expresswayNodeIds.has(id)) continue;
      expect(n.x).toBeGreaterThanOrEqual(3000);
      expect(n.x).toBeLessThanOrEqual(5000);
      expect(n.z).toBeGreaterThanOrEqual(-5000);
      expect(n.z).toBeLessThanOrEqual(-3000);
    }
  });
  it('non-expressway nodes have correct elevation', () => {
    // Expressway nodes have +0.3 offset, so only check non-expressway nodes
    const expresswayNodeIds = new Set();
    for (const e of g.edges.values()) {
      if (e.type === 'expressway') {
        expresswayNodeIds.add(e.from);
        expresswayNodeIds.add(e.to);
      }
    }
    for (const [id, n] of g.nodes) {
      if (expresswayNodeIds.has(id)) continue;
      expect(n.y).toBe(5);
    }
  });
  it('generates building lots', () => {
    expect(g.lots).toBeDefined();
    expect(g.lots.length).toBeGreaterThan(50);
  });
  it('lots have required fields', () => {
    for (const lot of g.lots.slice(0, 10)) {
      expect(lot).toHaveProperty('x');
      expect(lot).toHaveProperty('z');
      expect(lot).toHaveProperty('width');
      expect(lot).toHaveProperty('depth');
      expect(lot).toHaveProperty('district');
    }
  });
  it('builds spatial index', () => {
    expect(g.spatialGrid).not.toBeNull();
    expect(g.spatialGrid.size).toBeGreaterThan(0);
  });
  it('is deterministic (same output each call)', () => {
    const g2 = generateCityRoadGraph(flatHeight);
    expect(g.nodes.size).toBe(g2.nodes.size);
    expect(g.edges.size).toBe(g2.edges.size);
  });
});

// ── Expressway edges ─────────────────────────────────────────────────

describe('Expressway edges', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('has expressway edges', () => {
    const e = [...g.edges.values()].filter(e => e.type === 'expressway');
    expect(e.length).toBeGreaterThan(5);
  });
  it('expressway edges have 6 lanes and 24m width', () => {
    const e = [...g.edges.values()].filter(e => e.type === 'expressway');
    for (const edge of e) {
      expect(edge.lanes).toBe(6);
      expect(edge.width).toBe(24);
    }
  });
  it('has ramp edges', () => {
    const r = [...g.edges.values()].filter(e => e.type === 'ramp');
    expect(r.length).toBeGreaterThan(2);
  });
  it('ramp edges are single lane', () => {
    const r = [...g.edges.values()].filter(e => e.type === 'ramp');
    for (const ramp of r) expect(ramp.lanes).toBe(1);
  });
  it('has an external spline termination node', () => {
    const ext = [...g.nodes.values()].find(n => n.externalSpline);
    expect(ext).toBeDefined();
  });
});

// ── A* pathfinding ──────────────────────────────────────────────────

describe('A* pathfinding', () => {
  let g;
  beforeEach(() => { g = generateCityRoadGraph(flatHeight); });

  it('finds a path between two connected nodes', () => {
    const nodeIds = [...g.nodes.keys()];
    const start = nodeIds[0];
    const end = nodeIds[Math.min(20, nodeIds.length - 1)];
    const path = findPath(g, start, end);
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(end);
  });

  it('path visits only valid node IDs', () => {
    const nodeIds = [...g.nodes.keys()];
    const path = findPath(g, nodeIds[0], nodeIds[10]);
    if (path) {
      for (const id of path) {
        expect(g.nodes.has(id)).toBe(true);
      }
    }
  });

  it('returns null for unreachable nodes', () => {
    // Add isolated node with no edges
    const isoId = 99999;
    addNode(g, { id: isoId, x: 0, y: 0, z: 0 });
    const path = findPath(g, [...g.nodes.keys()][0], isoId);
    expect(path).toBeNull();
  });

  it('returns path of length 1 for start === end', () => {
    const id = [...g.nodes.keys()][0];
    const path = findPath(g, id, id);
    expect(path).toEqual([id]);
  });
});

// ── getRoadNetworkCompat ────────────────────────────────────────────

describe('getRoadNetworkCompat', () => {
  let g;
  beforeEach(() => {
    clearRoadNetworkCache();
    g = generateCityRoadGraph(flatHeight);
  });

  it('returns array of segments', () => {
    const segs = getRoadNetworkCompat(g);
    expect(segs.length).toBeGreaterThan(0);
  });

  it('each segment has start/end/width/type', () => {
    const segs = getRoadNetworkCompat(g);
    const seg = segs[0];
    expect(seg.start).toHaveProperty('x');
    expect(seg.start).toHaveProperty('z');
    expect(seg.end).toHaveProperty('x');
    expect(seg.end).toHaveProperty('z');
    expect(seg).toHaveProperty('width');
    expect(seg).toHaveProperty('type');
    expect(seg).toHaveProperty('direction');
    expect(seg).toHaveProperty('lanes');
  });

  it('segment count matches edge count', () => {
    const segs = getRoadNetworkCompat(g);
    expect(segs.length).toBe(g.edges.size);
  });
});

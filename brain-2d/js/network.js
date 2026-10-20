(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

  const LUT_STEPS = 20;

  function cubic(p0, p1, p2, p3, u) {
    const v = 1 - u;
    const a = v * v * v;
    const b = 3 * v * v * u;
    const c = 3 * v * u * u;
    const d = u * u * u;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    };
  }

  // World space uses one unit per lattice step. Rows are staggered so a
  // prime count such as 233 still fills the viewport. The renderer fits the
  // bounding rectangle with a uniform scale. Pass {width, height}; the
  // default matches a 1440×900 window.
  PL.createNetwork = function (config, lattice) {
    const U = PL.util;
    const count = (config.network && config.network.count) || 233;
    const chosen = lattice && lattice.rows
      ? lattice
      : PL.chooseLattice(
        count,
        (lattice && lattice.width) || 1440,
        (lattice && lattice.height) || 900
      );
    const rows = chosen.rows;
    const rowLengths = PL.staggeredRowLengths(count, rows);
    const cols = rowLengths.reduce(function (m, n) { return Math.max(m, n); }, 0);
    const jitterMin = (config.network && config.network.jitterMin) || 0.22;
    const jitterMax = (config.network && config.network.jitterMax) || 0.30;
    const minSpacing = (config.network && config.network.minSpacing) || 0.55;
    const random = U.mulberry32(23);
    const neurons = [];
    const byRow = [];

    for (let row = 0; row < rows; row++) {
      const length = rowLengths[row];
      // Shorter rows shift by half a step so their centers line up with
      // the gaps of the longer rows.
      const shift = (cols - length) * 0.5;
      const line = [];
      for (let i = 0; i < length; i++) {
        const neuron = {
          id: neurons.length,
          col: i,
          row: row,
          homeX: i + 0.5 + shift,
          homeY: row + 0.5,
          x: i + 0.5 + shift,
          y: row + 0.5,
          onLeft: i === 0,
          onRight: i === length - 1,
          onTop: row === 0,
          onBottom: row === rows - 1,
          angle: (random() - 0.5) * 0.42,
          dendriteSeed: random() * Math.PI * 2,
          incoming: [],
          outgoing: [],
          adjacent: [],
          strength: 0,
          crystal: 0,
          pending: 0,
          category: -1
        };
        neurons.push(neuron);
        line.push(neuron);
      }
      byRow.push(line);
    }

    // ±22–30% of the lattice step, resampled until neighbors stay apart.
    // The fallback is the unjittered staggered center.
    const margin = 0.18;
    function nearest(neuron, x, y) {
      let best = Infinity;
      for (let i = 0; i < neuron.id; i++) {
        const other = neurons[i];
        const dist = Math.hypot(x - other.x, y - other.y);
        if (dist < best) best = dist;
      }
      return best;
    }
    for (let i = 0; i < neurons.length; i++) {
      const neuron = neurons[i];
      let placed = false;
      for (let attempt = 0; attempt < 32 && !placed; attempt++) {
        const amp = jitterMin + random() * (jitterMax - jitterMin);
        const x = U.clamp(neuron.homeX + (random() - 0.5) * 2 * amp, margin, cols - margin);
        const y = U.clamp(neuron.homeY + (random() - 0.5) * 2 * amp, margin, rows - margin);
        if (nearest(neuron, x, y) >= minSpacing) {
          neuron.x = x;
          neuron.y = y;
          placed = true;
        }
      }
      if (!placed) {
        neuron.x = neuron.homeX;
        neuron.y = neuron.homeY;
      }
    }

    function nodeAt(col, row) {
      const line = byRow[U.clamp(row, 0, rows - 1)];
      return line[U.clamp(col, 0, line.length - 1)];
    }

    function shape(edge) {
      const p0 = { x: edge.from.x, y: edge.from.y };
      const p3 = { x: edge.to.x, y: edge.to.y };
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      const span = Math.hypot(dx, dy) || 1;
      const bx = -dy / span * edge.bend;
      const by = dx / span * edge.bend;
      const p1 = { x: p0.x + dx * 0.31 + bx, y: p0.y + dy * 0.31 + by };
      const p2 = { x: p0.x + dx * 0.69 - bx * 0.55, y: p0.y + dy * 0.69 - by * 0.55 };
      const lut = [];
      let distance = 0;
      let previous = p0;
      for (let i = 0; i <= LUT_STEPS; i++) {
        const point = cubic(p0, p1, p2, p3, i / LUT_STEPS);
        distance += Math.hypot(point.x - previous.x, point.y - previous.y);
        lut.push({ x: point.x, y: point.y, s: distance });
        previous = point;
      }
      edge.p0 = p0;
      edge.p1 = p1;
      edge.p2 = p2;
      edge.p3 = p3;
      edge.lut = lut;
      edge.length = Math.max(0.0001, distance);
    }

    const edges = [];
    const keys = {};
    const schwannPerAxon = config.schwannPerAxon || 5;

    function addEdge(from, to) {
      const key = from.id + ':' + to.id;
      if (from === to || keys[key]) return;
      keys[key] = true;
      const cells = [];
      for (let i = 0; i < schwannPerAxon; i++) cells.push(0);
      const edge = {
        id: edges.length,
        from: from,
        to: to,
        bend: (U.hash(from.id, to.id) - 0.5) * 0.72,
        seedAt: -1,
        strength: 0,
        traversals: 0,
        // Five Schwann cells along the arc, 0 pale and 1 purple. owner is the
        // category that claimed the axon, or -1. Cells are filled from the
        // domain neuron that first reached the axon.
        cells: cells,
        purpleCount: 0,
        owner: -1
      };
      shape(edge);
      edges.push(edge);
      from.outgoing.push(edge);
      to.incoming.push(edge);
      from.adjacent.push(edge);
      to.adjacent.push(edge);
    }

    // Each row is a horizontal chain. Between rows, every neuron links to
    // its nearest neighbor by nominal x, and to the second when that
    // neighbor is at most one step away (the diagonal). Walkable both ways.
    for (let row = 0; row < rows; row++) {
      const line = byRow[row];
      for (let i = 0; i < line.length - 1; i++) addEdge(line[i], line[i + 1]);
    }
    for (let row = 0; row < rows - 1; row++) {
      const below = byRow[row + 1];
      const line = byRow[row];
      for (let i = 0; i < line.length; i++) {
        const neuron = line[i];
        const ranked = below.slice().sort(function (a, b) {
          const da = Math.abs(a.homeX - neuron.homeX);
          const db = Math.abs(b.homeX - neuron.homeX);
          if (Math.abs(da - db) > 1e-9) return da - db;
          return a.id - b.id;
        });
        if (!ranked.length) continue;
        addEdge(neuron, ranked[0]);
        if (ranked.length > 1 && Math.abs(ranked[1].homeX - neuron.homeX) <= 1 + 1e-9) {
          addEdge(neuron, ranked[1]);
        }
      }
    }

    // One component, even if a ragged edge ever missed its neighbor.
    function components() {
      const seen = {};
      const comps = [];
      for (let i = 0; i < neurons.length; i++) {
        if (seen[neurons[i].id]) continue;
        const stack = [neurons[i]];
        seen[neurons[i].id] = true;
        const comp = [];
        while (stack.length) {
          const node = stack.pop();
          comp.push(node);
          for (let e = 0; e < node.adjacent.length; e++) {
            const edge = node.adjacent[e];
            const other = edge.from === node ? edge.to : edge.from;
            if (!seen[other.id]) {
              seen[other.id] = true;
              stack.push(other);
            }
          }
        }
        comps.push(comp);
      }
      return comps;
    }
    let comps = components();
    while (comps.length > 1) {
      let bestA = comps[0][0];
      let bestB = comps[1][0];
      let bestD = Infinity;
      for (let a = 0; a < comps[0].length; a++) {
        for (let c = 1; c < comps.length; c++) {
          for (let b = 0; b < comps[c].length; b++) {
            const d = Math.hypot(comps[0][a].homeX - comps[c][b].homeX, comps[0][a].homeY - comps[c][b].homeY);
            if (d < bestD) {
              bestD = d;
              bestA = comps[0][a];
              bestB = comps[c][b];
            }
          }
        }
      }
      addEdge(bestA, bestB);
      comps = components();
    }

    // Category centers, scattered. The same mulberry32(23) stream that
    // jittered the neurons continues here, so the scatter is fixed for a life.
    // How many is config.categories.count. Family is the index band, not a
    // region of the screen.
    const inset = 2;
    const pool = [];
    for (let i = 0; i < neurons.length; i++) {
      const neuron = neurons[i];
      if (
        neuron.homeX >= inset + 0.5 && neuron.homeX <= cols - inset - 0.5 &&
        neuron.homeY >= inset + 0.5 && neuron.homeY <= rows - inset - 0.5
      ) pool.push(neuron);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }

    function farEnough(neuron, chosen, separation) {
      for (let k = 0; k < chosen.length; k++) {
        const dx = neuron.x - chosen[k].x;
        const dy = neuron.y - chosen[k].y;
        if (dx * dx + dy * dy < separation * separation) return false;
      }
      return true;
    }

    const anchorCount = config.categories.count;
    let separation = 3;
    let anchors = [];
    while (anchors.length < anchorCount && separation >= 0) {
      anchors = [];
      for (let i = 0; i < pool.length && anchors.length < anchorCount; i++) {
        if (farEnough(pool[i], anchors, separation)) anchors.push(pool[i]);
      }
      if (anchors.length < anchorCount) separation -= 0.5;
    }
    for (let i = 0; i < anchors.length; i++) anchors[i].category = i;

    function pointOnEdge(edge, t) {
      const target = U.clamp(t, 0, 1) * edge.length;
      const lut = edge.lut;
      let i = 1;
      while (i < lut.length - 1 && lut[i].s < target) i++;
      const a = lut[i - 1];
      const b = lut[i];
      const f = U.clamp((target - a.s) / ((b.s - a.s) || 1), 0, 1);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }

    const borders = {
      left: byRow.map(function (line) { return line[0]; }),
      right: byRow.map(function (line) { return line[line.length - 1]; }),
      top: byRow[0].slice(),
      bottom: byRow[rows - 1].slice()
    };

    return {
      cols: cols,
      rows: rows,
      worldWidth: cols,
      worldHeight: rows,
      rowLengths: rowLengths,
      borders: borders,
      neurons: neurons,
      edges: edges,
      anchors: anchors,
      anchorSeparation: separation,
      nodeAt: nodeAt,
      pointOnEdge: pointOnEdge,
      totalLength: edges.reduce(function (sum, edge) {
        return sum + edge.length;
      }, 0)
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

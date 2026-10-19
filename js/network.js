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

  // World space uses one unit per lattice step, so a 16×9 lattice is a
  // 16 by 9 rectangle. The renderer fits that rectangle with a uniform
  // scale. Pass {cols, rows} or {width, height}; the default matches a
  // 1440×900 window.
  PL.createNetwork = function (config, lattice) {
    const U = PL.util;
    const count = (config.network && config.network.count) || 144;
    const chosen = lattice && lattice.cols * lattice.rows === count
      ? lattice
      : PL.chooseLattice(
        count,
        (lattice && lattice.width) || 1440,
        (lattice && lattice.height) || 900
      );
    const cols = chosen.cols;
    const rows = chosen.rows;
    const jitterMin = (config.network && config.network.jitterMin) || 0.22;
    const jitterMax = (config.network && config.network.jitterMax) || 0.30;
    const minSpacing = (config.network && config.network.minSpacing) || 0.55;
    const random = U.mulberry32(23);
    const neurons = [];

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        neurons.push({
          id: neurons.length,
          col: col,
          row: row,
          x: col + 0.5,
          y: row + 0.5,
          angle: (random() - 0.5) * 0.42,
          dendriteSeed: random() * Math.PI * 2,
          incoming: [],
          outgoing: [],
          adjacent: [],
          strength: 0,
          crystal: 0,
          pending: 0,
          category: -1
        });
      }
    }

    // ±22–30% of the lattice step, resampled until neighbors stay apart.
    // The fallback center is at least 0.70 from any ±0.30 jitter.
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
        const x = U.clamp(neuron.col + 0.5 + (random() - 0.5) * 2 * amp, margin, cols - margin);
        const y = U.clamp(neuron.row + 0.5 + (random() - 0.5) * 2 * amp, margin, rows - margin);
        if (nearest(neuron, x, y) >= minSpacing) {
          neuron.x = x;
          neuron.y = y;
          placed = true;
        }
      }
      if (!placed) {
        neuron.x = neuron.col + 0.5;
        neuron.y = neuron.row + 0.5;
      }
    }

    function nodeAt(col, row) {
      return neurons[U.clamp(col, 0, cols - 1) * rows + U.clamp(row, 0, rows - 1)];
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

    // Horizontal lanes plus alternating diagonals, then vertical links so
    // thoughts can enter from any border. Every axon is walkable both ways.
    for (let col = 0; col < cols - 1; col++) {
      for (let row = 0; row < rows; row++) {
        const from = nodeAt(col, row);
        addEdge(from, nodeAt(col + 1, row));
        addEdge(from, nodeAt(col + 1, row + ((col + row) % 2 === 0 ? 1 : -1)));
      }
    }
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows - 1; row++) {
        addEdge(nodeAt(col, row), nodeAt(col, row + 1));
      }
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
        neuron.col >= inset && neuron.col <= cols - 1 - inset &&
        neuron.row >= inset && neuron.row <= rows - 1 - inset
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

    return {
      cols: cols,
      rows: rows,
      worldWidth: cols,
      worldHeight: rows,
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

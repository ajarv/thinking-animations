(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }

  // One point on an egg. `side` is -1 or 1. The two eggs share a long
  // axis and their centers sit `fuse` egg-widths apart, so they overlap.
  function eggPoint(i, count, side, brain, jitter, rng) {
    const last = Math.max(1, count - 1);
    const y = count === 1 ? 0 : 1 - (i / last) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (3 - Math.sqrt(5)) * i;
    let x = Math.cos(theta) * ring + (rng() - 0.5) * jitter;
    let yy = y + (rng() - 0.5) * jitter;
    let z = Math.sin(theta) * ring + (rng() - 0.5) * jitter;
    const len = Math.hypot(x, yy, z) || 1;
    x /= len;
    yy /= len;
    z /= len;

    // Blunt at the front, a little narrower at the rear.
    const rear = Math.max(0, -z);
    const taper = 1 - brain.point * rear * rear;
    return {
      x: side * brain.fuse * brain.ax + x * brain.ax * taper,
      y: yy * brain.ay * taper,
      z: z * brain.az
    };
  }

  // Seeded Fibonacci points warped into a stylized brain surface.
  B3.createSkeleton = function (config) {
    const count = config.network.count;
    const shape = config.shape;
    const jitter = config.network.jitter;
    const rng = mulberry32(config.seed);
    const neurons = [];
    const perSide = Math.floor(count / 2);

    for (let i = 0; i < count; i++) {
      const side = i < perSide ? -1 : 1;
      const index = side < 0 ? i : i - perSide;
      const onSide = side < 0 ? perSide : count - perSide;
      const point = eggPoint(index, onSide, side, shape.brain, jitter, rng);
      neurons.push({
        id: i,
        x: point.x * shape.rx,
        y: point.y * shape.ry,
        z: point.z * shape.rz,
        adjacent: []
      });
    }

    const take = Math.min(config.network.neighbors, count - 1);
    const seen = new Set();
    const edges = [];
    const others = [];
    for (let i = 0; i < count; i++) {
      others.length = 0;
      for (let j = 0; j < count; j++) {
        if (j !== i) others.push(j);
      }
      others.sort(function (a, b) {
        return dist2(neurons[i], neurons[a]) - dist2(neurons[i], neurons[b]);
      });
      for (let n = 0; n < take; n++) {
        const j = others[n];
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        const key = lo * count + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        const edge = { id: edges.length, a: lo, b: hi };
        edges.push(edge);
        neurons[lo].adjacent.push({ edge: edge.id, to: hi, forward: true });
        neurons[hi].adjacent.push({ edge: edge.id, to: lo, forward: false });
      }
    }

    const schwann = config.schwann;
    const bends = [0];
    for (let bend = 1; bend < schwann.cellsPerAxon; bend++) {
      bends.push(bend % 2 === 1 ? 1 : -1);
    }
    bends.push(0);

    edges.forEach(function (edge, index) {
      const a = neurons[edge.a];
      const b = neurons[edge.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      let ux;
      let uy;
      let uz;
      if (Math.abs(dy) / len < 0.85) {
        ux = -dz;
        uy = 0;
        uz = dx;
      } else {
        ux = 0;
        uy = dz;
        uz = -dy;
      }
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const vx = dy * uz - dz * uy;
      const vy = dz * ux - dx * uz;
      const vz = dx * uy - dy * ux;
      const vl = Math.hypot(vx, vy, vz) || 1;
      const twist = ((Math.imul(index + 1, 0x9E3779B1) >>> 0) / 4294967296) * Math.PI * 2;
      const ct = Math.cos(twist);
      const st = Math.sin(twist);
      edge.zigzag = {
        x: ux * ct + (vx / vl) * st,
        y: uy * ct + (vy / vl) * st,
        z: uz * ct + (vz / vl) * st,
        amp: Math.min(schwann.zigzag, len * schwann.zigzagLength)
      };
      edge.length = len;
    });

    function pointOnEdge(edgeOrIndex, t, out) {
      const edge = typeof edgeOrIndex === 'number' ? edges[edgeOrIndex] : edgeOrIndex;
      const a = neurons[edge.a];
      const b = neurons[edge.b];
      const u = Math.max(0, Math.min(1, t));
      const count = schwann.cellsPerAxon;
      const slot = Math.min(count - 1, Math.floor(u * count));
      const local = u * count - slot;
      const bend = bends[slot] + (bends[slot + 1] - bends[slot]) * local;
      const zig = edge.zigzag;
      const point = out || {};
      point.x = a.x + (b.x - a.x) * u + zig.x * zig.amp * bend;
      point.y = a.y + (b.y - a.y) * u + zig.y * zig.amp * bend;
      point.z = a.z + (b.z - a.z) * u + zig.z * zig.amp * bend;
      return point;
    }

    // Category centers, scattered. The same mulberry32 stream that jittered
    // the neurons continues here, so the scatter is fixed for a life. Family
    // is the index band, not a region of the brain.
    const categories = config.categories;
    const ys = neurons.map(function (neuron) { return neuron.y; });
    const yMin = Math.min.apply(null, ys);
    const yMax = Math.max.apply(null, ys);
    const floor = yMin + (yMax - yMin) * 0.18;
    let pool = neurons.filter(function (neuron) { return neuron.y >= floor; });
    if (pool.length < categories.count) pool = neurons.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }

    function farEnough(neuron, chosen, separation) {
      const limit = separation * separation;
      for (let k = 0; k < chosen.length; k++) {
        if (dist2(neuron, chosen[k]) < limit) return false;
      }
      return true;
    }

    const anchorCount = categories.count;
    let separation = categories.separation;
    let anchors = [];
    while (anchors.length < anchorCount && separation >= 0) {
      anchors = [];
      for (let i = 0; i < pool.length && anchors.length < anchorCount; i++) {
        if (farEnough(pool[i], anchors, separation)) anchors.push(pool[i]);
      }
      if (anchors.length < anchorCount) separation -= categories.separationStep;
    }

    neurons.forEach(function (neuron) {
      neuron.category = -1;
      neuron.domain = -1;
    });
    const familyOf = [];
    categories.familySizes.forEach(function (size, family) {
      for (let i = 0; i < size; i++) familyOf.push(family);
    });
    anchors.forEach(function (neuron, category) {
      neuron.category = category;
      neuron.domain = category;
      neuron.weight = categories.weights[category];
      neuron.family = familyOf[category];
    });
    neurons.forEach(function (neuron) {
      if (neuron.category >= 0) return;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const d = dist2(neuron, anchors[i]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      neuron.domain = best;
    });

    return {
      neurons: neurons,
      edges: edges,
      anchors: anchors,
      anchorSeparation: Math.max(0, separation),
      pointOnEdge: pointOnEdge
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

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

  // Fibonacci points on a sphere, stretched into an ellipsoid and nudged by the seed.
  B3.createSkeleton = function (config) {
    const count = config.network.count;
    const shape = config.shape;
    const jitter = config.network.jitter;
    const rng = mulberry32(config.seed);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const last = Math.max(1, count - 1);
    const neurons = [];

    for (let i = 0; i < count; i++) {
      const y = count === 1 ? 0 : 1 - (i / last) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      neurons.push({
        id: i,
        x: (Math.cos(theta) * ring + (rng() - 0.5) * jitter) * shape.rx,
        y: (y + (rng() - 0.5) * jitter) * shape.ry,
        z: (Math.sin(theta) * ring + (rng() - 0.5) * jitter) * shape.rz
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
        edges.push({ a: lo, b: hi });
      }
    }

    return { neurons: neurons, edges: edges };
  };
})(typeof window !== 'undefined' ? window : globalThis);

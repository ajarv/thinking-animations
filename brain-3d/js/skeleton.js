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

  function warpBrain(x, y, z, brain) {
    const top = Math.max(0, y);
    const medial = Math.exp(-Math.pow(x / brain.grooveWidth, 2));
    const side = x < 0 ? -1 : 1;

    // Two upper lobes with a visible longitudinal fissure.
    x += side * brain.hemisphereSplit * top * medial;
    y -= brain.grooveDepth * Math.pow(top, 1.5) * medial;

    const front = Math.max(0, z);
    const rear = Math.max(0, -z);
    const temporal = Math.exp(-Math.pow((y + 0.32) / 0.3, 2)) *
      (0.55 + 0.45 * (1 - Math.min(1, Math.abs(z))));

    // Human-brain silhouette: broad frontal and temporal regions, narrower rear.
    x *= 1 + brain.frontalBulge * front -
      brain.posteriorTaper * rear + brain.temporalBulge * temporal;
    z *= 1 + brain.frontalBulge * 0.45 * front -
      brain.posteriorTaper * 0.35 * rear;

    // Compress the bottom into a flatter base without a hard edge.
    if (y < brain.underside) {
      y = brain.underside + (y - brain.underside) * brain.undersideCompression;
    }
    return { x: x, y: y, z: z };
  }

  // Seeded Fibonacci points warped into a stylized brain surface.
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
      const point = warpBrain(
        Math.cos(theta) * ring + (rng() - 0.5) * jitter,
        y + (rng() - 0.5) * jitter,
        Math.sin(theta) * ring + (rng() - 0.5) * jitter,
        shape.brain
      );
      neurons.push({
        id: i,
        x: point.x * shape.rx,
        y: point.y * shape.ry,
        z: point.z * shape.rz
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

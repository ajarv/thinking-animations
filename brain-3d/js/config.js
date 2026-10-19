(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  // Split `count` homes across the three families. Earlier bands take the
  // remainder, so 13 is 5 danger, 4 attraction, 4 everyday. Weights cycle
  // the seven-value pattern when a family is not exactly that long.
  function categoryLayout(count, families, pattern) {
    const base = Math.floor(count / families);
    const extra = count % families;
    const familySizes = [];
    const weights = [];
    for (let band = 0; band < families; band++) {
      const size = base + (band < extra ? 1 : 0);
      familySizes.push(size);
      for (let i = 0; i < size; i++) weights.push(pattern[i % pattern.length]);
    }
    return {
      count: count,
      families: families,
      familySizes: familySizes,
      weightPattern: pattern.slice(),
      weights: weights,
      // 3D units. The placer relaxes this by `separationStep` until all homes fit.
      separation: 1.05,
      separationStep: 0.15
    };
  }

  B3.config = {
    seed: 23,
    network: {
      count: 144,
      // Each neuron links to this many nearest neighbors.
      neighbors: 3,
      // Jitter on the unit sphere, before the ellipsoid scale.
      jitter: 0.08
    },
    shape: {
      rx: 1.35,
      ry: 0.92,
      rz: 1.05,
      brain: {
        // Separate the upper hemispheres and cut a shallow sagittal groove.
        hemisphereSplit: 0.055,
        grooveDepth: 0.11,
        grooveWidth: 0.2,
        // Round the front, taper the rear, and form the lower temporal lobes.
        frontalBulge: 0.11,
        posteriorTaper: 0.13,
        temporalBulge: 0.13,
        underside: -0.58,
        undersideCompression: 0.32
      }
    },
    spin: { degreesPerSecond: 6 },
    camera: {
      // Distance from the eye to the origin, in skeleton units.
      distance: 4.2,
      // Fraction of the shorter screen side covered by one skeleton unit.
      fill: 0.3
    },
    // Awake palette from the 2D brain.
    colors: {
      bgCenter: '#f6fbff',
      bgEdge: '#d8eaf7',
      soma: '#a9c9ea',
      somaEdge: '#294b8b',
      nucleus: '#f2f8fd',
      schwann: '#78a8d2',
      anchorRing: '#2e7d32',
      external: '#ef9a9a',
      externalCore: '#fff6f6',
      internal: '#1d6fe3',
      internalCore: '#e5f0ff',
      temporary: '#ff9800',
      temporaryCore: '#fff3e0',
      text: '#22407e'
    },
    // Permanent homes. `count` is the only size. Families are not regions of
    // the brain; the same weights repeat inside a family.
    categories: categoryLayout(13, 3, [0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4]),
    soma: { radius: 7.2, minRadius: 3, nucleus: 0.42 },
    schwann: {
      cellsPerAxon: 5,
      // Fraction of each cell slot left empty between neighboring cells.
      gapRatio: 0.22,
      strokeWidth: 2.2,
      // Lateral step of the zigzag, in skeleton units, capped by axon length.
      zigzag: 0.022,
      zigzagLength: 0.16
    },
    thoughts: {
      fixedStep: 1 / 60,
      spawnDelay: 1.25,
      collisionScale: 1.35,
      routeEdges: 36,
      internalCount: 3,
      maxHomes: 48,
      external: {
        ttl: 12,
        speed: 0.34,
        radius: 0.052,
        entryDuration: 0.9,
        entryDistance: 1.3,
        entryScale: 3.4,
        shrinkPower: 1.1
      },
      internal: {
        ttl: 9,
        speedMin: 0.22,
        speedMax: 0.72,
        radius: 0.034,
        shrinkPower: 1.2
      },
      temporary: {
        scale: 2,
        growDuration: 0.35
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

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
    spin: {
      degreesPerSecond: 6,
      minDegreesPerSecond: 0.6,
      slowdownPower: 1.25
    },
    camera: {
      // Distance from the eye to the origin, in skeleton units.
      distance: 4.2,
      // Fraction of the shorter screen side covered by one skeleton unit.
      fill: 0.3
    },
    // Awake palette from the 2D brain.
    colors: {
      bgCenter: '#f4f8fc',
      bgEdge: '#d7e4f0',
      soma: '#c5d8ec',
      somaEdge: '#6d8aab',
      nucleus: '#f8fbfe',
      schwann: '#9bbfd4',
      saturatedSchwann: '#e4bc55',
      anchorRing: '#6a9a78',
      external: '#d98986',
      externalCore: '#fff7f5',
      internal: '#7aa0d4',
      internalCore: '#f3f7fc',
      temporary: '#e0a56a',
      temporaryCore: '#fff7ee',
      settled: '#8fb89a',
      settledCore: '#f4f8f5',
      needCenter: '#fff5ee',
      needEdge: '#f0d9cc',
      stage1Center: '#f7f4fb',
      stage1Edge: '#e4dced',
      remCenter: '#f3f8f5',
      remEdge: '#d7ebe0',
      deepCenter: '#445068',
      deepEdge: '#2e384c',
      nightSoma: '#dce6f3',
      nightSomaEdge: '#b9cbe2',
      nightSchwann: '#c9d6e8',
      nightSaturatedSchwann: '#f0d48a',
      nightText: '#e7eef6',
      text: '#3e5878'
    },
    sleep: {
      secondsPerHour: 2,
      needPhase: 0.2,
      wakeBlend: 1.8,
      migrationSpeed: 1.02,
      // Hours of sleep from the unsettled count. The curve is flat outside
      // the anchors and log-linear between them.
      anchors: [
        { u: 5, hours: 18 },
        { u: 8, hours: 12 },
        { u: 13, hours: 8 },
        { u: 21, hours: 4 }
      ]
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
      saturatedStrokeWidth: 5.5,
      // Lateral step of the zigzag, in skeleton units, capped by axon length.
      zigzag: 0.022,
      zigzagLength: 0.16
    },
    thoughts: {
      fixedStep: 1 / 60,
      spawnDelay: 1.25,
      collisionScale: 1.35,
      routeEdges: 36,
      // A fresh thought loses relevance below half its own starting size.
      halfLife: 0.5,
      maxHomes: 48,
      external: {
        ttl: 12,
        speed: 0.34,
        radius: 0.052,
        // Straight flight from outside the shell toward the brain center.
        approachSpeed: 1.05,
        approachGap: 1.2,
        // First mesh contact within this radius is "sensation received".
        contactRadius: 0.22,
        // Received rests on the strand, then acceptance starts mesh travel.
        receiveHold: 0.65,
        // Larger bands launch more internal thoughts. Ranges do not overlap.
        sizes: [
          { scaleMin: 4.4, scaleMax: 5.4, internals: 5 },
          { scaleMin: 3.3, scaleMax: 4.1, internals: 3 },
          { scaleMin: 2.4, scaleMax: 3.1, internals: 2 },
          { scaleMin: 1.6, scaleMax: 2.2, internals: 1 }
        ],
        shrinkPower: 1.1
      },
      internal: {
        // Each internal thought starts near the external sensation's radius,
        // then shrinks at its own rate: a seeded lifetime and curve.
        ttlMin: 4.5,
        ttlMax: 12,
        startMatchMin: 0.8,
        startMatchMax: 1.05,
        shrinkPowerMin: 0.7,
        shrinkPowerMax: 1.8,
        speedMin: 0.22,
        speedMax: 0.72,
        radius: 0.034
      },
      temporary: {
        scale: 2,
        growDuration: 0.35
      },
      saturation: {
        // Select the largest Fibonacci block below the saturation-dependent
        // ideal. The calibrated age curve maps 80% saturation to age 50.
        fibonacci: [1, 2, 3, 5, 8, 13, 21, 34],
        maxBlock: 34,
        ceiling: 0.84,
        blockPower: 1.15,
        ageAtTarget: 50,
        ageRate: 3.044522,
        agePower: 1.35,
        maxAge: 100,
        // Relative sensation frequency, linearly interpolated by age.
        birthInterval: 10,
        sensationRates: [
          { age: 0, perYear: 10.1 },
          { age: 8, perYear: 7.4 },
          { age: 16, perYear: 5.1 },
          { age: 24, perYear: 3.6 },
          { age: 50, perYear: 3.0 },
          { age: 70, perYear: 2.3 },
          { age: 100, perYear: 1.6 }
        ]
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

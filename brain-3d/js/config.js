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
      // Final scale. The egg radii below are already in brain units.
      rx: 1,
      ry: 1,
      rz: 1,
      brain: {
        // Two eggs side by side. Centers are this fraction of one egg's
        // width apart, so each egg keeps about three quarters of its width.
        fuse: 0.75,
        ax: 0.82,
        ay: 0.8,
        az: 1.18,
        // Rear of each egg narrows a little; the front stays blunt.
        point: 0.16
      }
    },
    ageBands: [
      { name: 'Early childhood', max: 5 },
      { name: 'Childhood', max: 12 },
      { name: 'Adolescence', max: 18 },
      { name: 'Early adulthood', max: 25 },
      { name: 'Adulthood', max: 40 },
      { name: 'Middle age', max: 60 },
      { name: 'Later life', max: 80 },
      { name: 'Elder years', max: 101 }
    ],
    spin: {
      // Ten rotations make a 100-year life. Saturation accelerates the
      // toilet-roll clock from a fixed minimum to a fixed maximum.
      yearsPerRotation: 10,
      // Half of the previous curve. Saturation still sets the speed; nights
      // and sensations stay on the wall clock, so a life now lasts longer.
      minDegreesPerSecond: 3,
      maxDegreesPerSecond: 16.15,
      accelerationPower: 4,
      maxAge: 100,
      targetLifetimeSeconds: 180
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
      schwann: '#ffffff',
      saturatedSchwann: '#bd45f5',
      anchorRing: '#6a9a78',
      external: '#d98986',
      externalCore: '#fff7f5',
      internal: '#f6c445',
      internalCore: '#fff1b8',
      sparks: ['#f6c445', '#f0a03a', '#e07a3d'],
      sparkCores: ['#fff1b8', '#ffe0a3', '#ffd0a8'],
      // Daytime answers to a sensation. Blue border, interior white, orange, or yellow.
      daySparkBorder: '#3d9eea',
      daySparks: ['#ffffff', '#f0a03a', '#f6c445'],
      temporary: '#e0a56a',
      temporaryCore: '#fff7ee',
      settled: '#8fb89a',
      settledCore: '#f4f8f5',
      needCenter: '#fff5ee',
      needEdge: '#f0d9cc',
      stage1Center: '#f7f4fb',
      stage1Edge: '#e4dced',
      remCenter: '#1c1814',
      remEdge: '#100e0c',
      deepCenter: '#445068',
      deepEdge: '#2e384c',
      nightSoma: '#dce6f3',
      nightSomaEdge: '#b9cbe2',
      nightSchwann: '#ffffff',
      nightSaturatedSchwann: '#9bbfd4',
      nightText: '#e7eef6',
      text: '#3e5878'
    },
    sleep: {
      secondsPerHour: 0.5,
      // Sleep starts once this many thoughts are temporarily housed.
      onsetHomes: 3,
      // The animation opens already in deep sleep, before the first sensation.
      openingDeep: 10,
      needPhase: 0.2,
      wakeBlend: 1.8,
      migrationSpeed: 0.26,
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
      spawnInterval: 10,
      collisionScale: 1.35,
      routeEdges: 36,
      // A fresh thought loses relevance below a quarter of its starting size,
      // the second halving. A temporary home is exempt.
      halfLife: 0.25,
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
          { scaleMin: 4.4, scaleMax: 5.4, internals: 12 },
          { scaleMin: 3.3, scaleMax: 4.1, internals: 9 },
          { scaleMin: 2.4, scaleMax: 3.1, internals: 6 },
          { scaleMin: 1.6, scaleMax: 2.2, internals: 4 }
        ],
        shrinkPower: 1.1
      },
      internal: {
        maxCount: 32,
        // Small sparks of a fixed size. They expire by age, not by shrinking.
        ttlMin: 4.5,
        ttlMax: 12,
        speedMin: 0.7,
        speedMax: 1.35,
        radius: 0.012,
        // Seconds after the burst before a spark can house the sensation.
        arming: 0.45,
        // Each knowledge center throws this many awake-style sparks per wave.
        remBurst: 8,
        remPool: 160,
        remWaveInterval: 0.75,
        // After every temporary home has settled, the sparks fade this long.
        remFade: 1.4
      },
      receptivity: {
        multiplierFloor: 1.2,
        multiplierRange: 1.4,
        power: 1.2,
        // Rare, very large adult sensations can still trigger a crisis burst.
        distressSaturation: 0.45,
        distressChance: 0.2,
        distressBursts: [3, 5, 8]
      },
      temporary: {
        scale: 2,
        growDuration: 0.35
      },
      saturation: {
        // Select the largest Fibonacci block below the saturation-dependent
        // ideal. A short life has only a few nights, so blocks are large.
        fibonacci: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144],
        maxBlock: 144,
        ceiling: 0.84,
        blockPower: 0.5
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

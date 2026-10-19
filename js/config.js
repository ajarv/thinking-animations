(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

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
      weights: weights
    };
  }

  // Row count for a staggered lattice of exactly `count` neurons. 233 is
  // prime, so this does not look for a rectangular factor pair. R is chosen
  // near sqrt(count / viewportAspect). Among nearby integers, the winner is
  // the one whose nominal pixel pitch is closest on both axes under a
  // uniform fit (screen-space spacing error).
  PL.chooseLattice = function (count, width, height) {
    const aspect = width / Math.max(height, 0.001);
    const ideal = Math.sqrt(count / aspect);
    const lo = Math.max(2, Math.floor(ideal) - 8);
    const hi = Math.min(Math.floor(count / 2), Math.ceil(ideal) + 8);
    let best = null;
    let bestScore = Infinity;
    for (let rows = lo; rows <= hi; rows++) {
      const base = Math.floor(count / rows);
      if (base < 2) continue;
      const extra = count % rows;
      const cols = base + (extra > 0 ? 1 : 0);
      if (cols < 2) continue;
      const scaleX = width / cols;
      const scaleY = height / rows;
      const pitchErr = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
      const score = pitchErr + Math.abs(rows - ideal) * 1e-6;
      if (score < bestScore) {
        bestScore = score;
        best = { cols: cols, rows: rows, aspect: cols / rows, base: base, extra: extra };
      }
    }
    return best;
  };

  // Longer rows (base+1) are spread from top to bottom, not bunched.
  PL.staggeredRowLengths = function (count, rows) {
    const base = Math.floor(count / rows);
    const extra = count % rows;
    const lengths = [];
    let err = 0;
    for (let r = 0; r < rows; r++) {
      err += extra;
      if (err >= rows) {
        err -= rows;
        lengths.push(base + 1);
      } else {
        lengths.push(base);
      }
    }
    return lengths;
  };

  PL.config = {
    // 233 neurons, a prime, so the lattice is staggered rows rather than a
    // rectangle. The row count follows the viewport aspect at load; a
    // resize only refits the scale.
    network: {
      count: 89,
      // Jitter amplitude, as a fraction of the one-unit lattice spacing.
      jitterMin: 0.22,
      jitterMax: 0.30,
      // Nearest neurons stay at least this far apart, in lattice units.
      minSpacing: 0.55
    },

    pools: {
      thoughts: 144,
      // Acceptance bursts are 7 and home ticks are at most 3. The first night
      // on the wide lattice drops none.
      counters: 610,
      // Crystal slots, not neurons. The sleep threshold is a share of this
      // pool, so it stays at 377 to keep the first night about 18s in.
      crystals: 377
    },

    life: {
      // Age 90 is the plateau once purple coverage reaches 95%.
      maxAge: 90,
      // Border filters and natural lust still treat 80% coverage as maturity.
      // It is not the end of life.
      saturationLimit: 0.8,
      plateau: 0.95,
      epsilon: 0.001,
      growthFloor: 0.2,
      hold: 3
    },

    // One soft screen wave per successful temporary home. Attraction emits a
    // reward wave; danger emits a stress wave. Everyday thoughts emit none.
    waves: {
      pool: 16,
      ttlMin: 0.9,
      ttlMax: 1.3
    },

    // Lust for learning, 0–100. It rests at 100 × (1 − peakSaturation / 0.8)
    // and returns there with this time constant after being forced.
    lust: {
      tau: 3.5,
      forcedBand: 0.5
    },

    spawnRate: 11,
    centerMin: 0.07,
    // Each axon is five Schwann cells of equal arc length. One permanent
    // housing turns exactly one eligible cell purple.
    schwannPerAxon: 5,
    // Temporary and traveling thoughts are drawn at twice the size of the
    // thought that arrived. A permanent home shrinks back to 1×.
    crystalScale: 2,
    // Accepted thoughts enter large, shrink toward insignificance, and fade.
    // A temporary home ignores this curve and is drawn at crystalScale.
    entryScale: 3.4,
    fadeScale: 0.15,
    shrinkPower: 1.35,
    rejectTtlMin: 0.22,
    rejectTtlMax: 0.38,

    // An accepted thought fires 7 internal thoughts once, from hash-picked
    // centers. A temporary or wandering home fires 1–3 more on each tick of
    // its own 3–6s timer, until it settles or sleep tosses it.
    internal: {
      acceptCount: 7,
      homeMax: 3,
      intervalMin: 3,
      intervalMax: 6,
      // Visual sizes, same units as kind size × scale. Mixed inside a burst.
      sizes: { medium: 1.15, large: 2.1, xlarge: 3.4 },
      // Awake lifetime. Sleep stretches it; age shortens it. The shrink
      // curve is still initialScale * (1 − age/ttl) ^ shrinkPower.
      ttlMin: 2.6,
      ttlMax: 4.2,
      sleepTtl: 1.35,
      shrinkPower: 1.2
    },

    learning: {
      // An everyday thought carries this share of a full deposit to sleep.
      ordinaryWeight: 0.45,
      // Speed factor on a fully thick pathway (thoughts linger in knowledge).
      thickSlowdown: 0.45,
      // Border rejection of familiar danger/attraction, scaled by filter strength.
      rejectMin: 0.15,
      rejectMax: 0.55
    },

    // Permanent homes. `count` is the only size: anchors, weights, domains,
    // and the cluster readout all follow it. Families are not a screen grid.
    // The pattern runs about 0.6 to 1.8 and repeats inside a family when
    // that family is longer than the pattern, or stops early when shorter.
    categories: categoryLayout(13, 3, [0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4]),

    sleep: {
      // One simulated second per this many hours of the sleep-duration
      // function. 18 hours is 36 seconds: 18 of calculated REM and 18 of
      // deep. Actual REM lasts at least that half, and longer if the onset
      // cohort is still unsettled.
      secondsPerHour: 2,
      // Kept so older notes still parse. Onset is unsettled vs crystallized,
      // not this share of the crystal pool, and there is no minimum afternoon.
      needThreshold: 0.38,
      minAwake: 0,
      // needPhase is where "needs sleep" begins; the red blend is the need
      // itself and is full at 1. wakeBlend is how long waking eases from
      // deep dark gray back to light blue. tossFade is how long a tossed thought fades.
      needPhase: 0.2,
      wakeBlend: 1.8,
      tossFade: 1.2,
      migrationRate: 6,
      rebalanceEvery: 0.6,
      arriveRadius: 0.32,
      travelMultiplier: 3,
      steering: 5,
      wobble: 0.9,
      maxTravel: 14,
      loss: 0.05,
      consolidationBonus: 0.03,
      // Thickness a settled thought adds at its permanent cluster. It is
      // remembered from the day and applied only during sleep.
      deposit: 0.72,
      seedDrift: 0.22
    },

    kindOdds: {
      danger: 0.16,
      attraction: 0.18
    },

    kinds: {
      danger: {
        ttlMin: 9,
        ttlMax: 13,
        size: 1.8,
        home: 1,
        speed: 0.92,
        band: 0,
        color: '#c62828',
        core: '#ffe8e4'
      },
      attraction: {
        ttlMin: 8,
        ttlMax: 12,
        size: 1.6,
        home: 0.85,
        speed: 0.92,
        band: 1,
        color: '#c2185b',
        core: '#fde7f0'
      },
      ordinary: {
        ttlMin: 1.5,
        ttlMax: 2.8,
        size: 0.62,
        home: 0.06,
        speed: 1.08,
        band: 2,
        color: '#ef9a9a',
        core: '#fff6f6'
      }
    },

    // Sleep, inflow, and what is kept for good, interpolated by age.
    // threshold scales the temporary-home count that forces sleep.
    stages: [
      { age: 0, name: 'Infant', sleep: 18, awake: 6, acceptance: 1, keep: 0.9, threshold: 0.45 },
      { age: 8, name: 'Elementary', sleep: 12, awake: 12, acceptance: 0.7, keep: 0.72, threshold: 0.633 },
      { age: 16, name: 'High school', sleep: 8, awake: 16, acceptance: 0.48, keep: 0.55, threshold: 0.817 },
      { age: 24, name: 'Young adult', sleep: 6, awake: 18, acceptance: 0.34, keep: 0.42, threshold: 1 },
      { age: 48, name: 'Adult', sleep: 6, awake: 18, acceptance: 0.3, keep: 0.36, threshold: 1 },
      { age: 70, name: 'Older adult', sleep: 5, awake: 19, acceptance: 0.22, keep: 0.28, threshold: 1.15 }
    ],

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

    colors: {
      // Background cycle: light blue rested, light red sleep-starved, pale
      // lavender Stage 1, very light green REM, dark gray deep sleep, then
      // light blue again. REM stays far paler than the settled thought beads.
      bgCenter: '#f6fbff',
      bgEdge: '#d8eaf7',
      needCenter: '#fff1f1',
      needEdge: '#f6d5d5',
      stage1Center: '#f4f0fb',
      stage1Edge: '#e4dcf3',
      remCenter: '#f3fbf4',
      remEdge: '#d9f0dc',
      deepCenter: '#4f535a',
      deepEdge: '#24272d',
      thinAxon: [0.74, 0.84, 0.92, 0.45],
      dendrite: [0.27, 0.49, 0.72, 0.66],
      knowledge: '#203f7d',
      somaLight: '#a9c9ea',
      somaDark: '#294b8b',
      nucleusLight: '#f2f8fd',
      nucleusDark: '#8eaedf',
      // Uncrystallized Schwann cells: a few shades darker than the awake
      // background edge, so unlearned axons sit almost on the background.
      // Deep sleep mixes toward the night value.
      schwann: [0.71, 0.82, 0.91, 0.95],
      // One crystallized Schwann cell: purple body, lighter center.
      schwannBody: '#7b1fa2',
      schwannHighlight: '#a75bc9',
      counter: '#1d6fe3',
      counterCore: '#e5f0ff',
      // Homed thoughts: orange while temporary or traveling, light green once settled.
      homed: '#ff9800',
      homedCore: '#fff3e0',
      settled: '#81c784',
      settledCore: '#e8f5e9',
      settledEdge: '#43a047',
      anchorRing: '#2e7d32',
      // Deep-sleep foreground. The renderer blends toward these as the
      // background darkens, so axons, somas, rings, and counters stay
      // legible on dark gray without turning pure white.
      night: {
        thinAxon: [0.38, 0.42, 0.49, 0.5],
        dendrite: [0.6, 0.72, 0.86, 0.62],
        knowledge: '#8fb4ec',
        somaLight: '#5a6c88',
        somaDark: '#a8c6f2',
        nucleusLight: '#7f90a8',
        nucleusDark: '#e1ebf8',
        schwann: [0.38, 0.42, 0.5, 0.85],
        counter: '#5c9cff',
        anchorRing: '#9ad7a0'
      },
      // Hormone waves are a visual metaphor, not an assay. Reward is warm
      // gold into rose. Stress is crimson into violet.
      rewardGold: [1, 0.78, 0.28, 0.36],
      rewardRose: [1, 0.45, 0.55, 0.28],
      stressCrimson: [0.62, 0.1, 0.22, 0.42],
      stressViolet: [0.38, 0.1, 0.45, 0.3]
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

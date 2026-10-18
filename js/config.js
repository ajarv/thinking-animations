(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

  PL.config = {
    // 29 x 13 = 377 neurons, the first Fibonacci number above 300.
    cols: 29,
    rows: 13,

    pools: {
      thoughts: 144,
      // Acceptance bursts are 7 and home ticks are at most 3. Measured peak
      // over 400s and two nights is 362 live, with zero drops. 610 is the
      // next Fibonacci size with room for another burst at that peak.
      counters: 610,
      crystals: 377
    },

    life: {
      maxAge: 100,
      saturationLimit: 0.8,
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

    // 21 permanent homes in three families of seven. cols and rows count
    // the families, not a screen grid: the anchors are scattered. The same
    // seven weights repeat in each family, about 0.6 to 1.8, so the biggest
    // category holds about three times the smallest.
    categories: {
      cols: 7,
      rows: 3,
      weights: [
        0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4,
        0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4,
        0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4
      ]
    },

    sleep: {
      // Sleep starts once this share of the crystal pool (377) is temporarily
      // homed, scaled by the life stage's threshold factor. The night then
      // lasts awakeDuration × sleep/awake for that age: half REM, half deep.
      needThreshold: 0.38,
      minAwake: 8,
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
      // Background cycle: light blue rested, light red sleep-starved, very
      // light green REM, dark gray deep sleep, then light blue again. REM
      // stays far paler than the settled thought beads.
      bgCenter: '#f6fbff',
      bgEdge: '#d8eaf7',
      needCenter: '#fff1f1',
      needEdge: '#f6d5d5',
      remCenter: '#f3fbf4',
      remEdge: '#d9f0dc',
      deepCenter: '#4f535a',
      deepEdge: '#24272d',
      thinAxon: [0.30, 0.53, 0.76, 0.48],
      dendrite: [0.27, 0.49, 0.72, 0.66],
      knowledge: '#203f7d',
      somaLight: '#a9c9ea',
      somaDark: '#294b8b',
      nucleusLight: '#f2f8fd',
      nucleusDark: '#8eaedf',
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
        thinAxon: [0.62, 0.74, 0.88, 0.5],
        dendrite: [0.6, 0.72, 0.86, 0.62],
        knowledge: '#8fb4ec',
        somaLight: '#5a6c88',
        somaDark: '#a8c6f2',
        nucleusLight: '#7f90a8',
        nucleusDark: '#e1ebf8',
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

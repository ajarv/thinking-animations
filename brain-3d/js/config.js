(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  B3.config = {
    seed: 23,
    network: {
      count: 144,
      // Each neuron links to this many nearest neighbors.
      neighbors: 3,
      // Jitter on the unit sphere, before the ellipsoid scale.
      jitter: 0.08
    },
    // Brain-shaped volume: wider than it is tall.
    shape: { rx: 1.35, ry: 0.92, rz: 1.05 },
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
      text: '#22407e'
    },
    soma: { radius: 7.2, minRadius: 3, nucleus: 0.42 },
    schwann: {
      cellsPerAxon: 5,
      // Fraction of each cell slot left empty between neighboring cells.
      gapRatio: 0.22,
      strokeWidth: 2.2
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

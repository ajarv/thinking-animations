(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(a, b, value) {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Deterministic pseudo-random value in [0, 1) so runs are reproducible.
  function hash(a, b) {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function mulberry32(seed) {
    let value = seed;
    return function () {
      value |= 0;
      value = value + 0x6D2B79F5 | 0;
      let t = Math.imul(value ^ value >>> 15, 1 | value);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  PL.util = {
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    hash: hash,
    mulberry32: mulberry32
  };
})(typeof window !== 'undefined' ? window : globalThis);

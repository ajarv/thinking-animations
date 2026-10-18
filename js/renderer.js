(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

  // Draws the simulation with Paper.js. The model lives in grid units; this
  // module owns every pixel decision. Z-order follows creation order.
  PL.createRenderer = function (paper, network, sim, config) {
    const U = PL.util;
    const clamp = U.clamp;
    const lerp = U.lerp;
    const Path = paper.Path;
    const Point = paper.Point;
    const Segment = paper.Segment;
    const Rectangle = paper.Rectangle;
    const view = paper.view;

    function toColor(value) {
      return Array.isArray(value)
        ? new paper.Color(value[0], value[1], value[2], value[3])
        : new paper.Color(value);
    }

    const C = {};
    Object.keys(config.colors).forEach(function (key) {
      if (key === 'night') return;
      C[key] = toColor(config.colors[key]);
    });
    const NIGHT = {};
    const nightColors = config.colors.night || {};
    Object.keys(nightColors).forEach(function (key) {
      NIGHT[key] = toColor(nightColors[key]);
    });
    const KIND_COLORS = {};
    Object.keys(config.kinds).forEach(function (kind) {
      KIND_COLORS[kind] = {
        color: toColor(config.kinds[kind].color),
        core: toColor(config.kinds[kind].core)
      };
    });

    function mix(a, b, t) {
      const u = clamp(t, 0, 1);
      return new paper.Color(
        a.red + (b.red - a.red) * u,
        a.green + (b.green - a.green) * u,
        a.blue + (b.blue - a.blue) * u,
        a.alpha + (b.alpha - a.alpha) * u
      );
    }

    function circle() {
      const path = new Path.Circle(new Point(0, 0), 1);
      path.applyMatrix = false;
      return path;
    }

    function openPath() {
      const path = new Path();
      path.strokeCap = 'round';
      path.strokeJoin = 'round';
      return path;
    }

    // Path.Circle is built at radius 1, so placing it is a matrix change only.
    function place(path, x, y, radius) {
      path.matrix = new paper.Matrix(radius, 0, 0, radius, x, y);
    }

    // Foreground palette for the current darkness: day colors at 0, the
    // night colors at 1. Awake and REM sit at 0, so their look is unchanged.
    const PALETTE_KEYS = Object.keys(NIGHT);
    const P = {};
    PALETTE_KEYS.forEach(function (key) { P[key] = C[key]; });
    let paletteStep = 0;
    const PALETTE_STEPS = 40;

    let sx = 1;
    let sy = 1;
    let cell = 1;
    let thoughtRadius = 1.75;
    let counterRadius = 1.55;

    const background = new Path.Rectangle(new Rectangle(0, 0, 10, 10));

    // Hormone waves sit above the mood gradient and below every axon.
    // The pool is fixed so a busy minute of homing does not allocate paths.
    function waveGradient(type) {
      const reward = type === 'reward';
      return {
        gradient: {
          radial: true,
          stops: reward
            ? [
                [new paper.Color(1, 0.9, 0.55, 0), 0],
                [new paper.Color(1, 0.78, 0.28, 0.18), 0.58],
                [new paper.Color(1, 0.72, 0.42, 0.34), 0.78],
                [new paper.Color(1, 0.45, 0.55, 0.22), 0.9],
                [new paper.Color(1, 0.48, 0.58, 0), 1]
              ]
            : [
                [new paper.Color(0.55, 0.08, 0.2, 0), 0],
                [new paper.Color(0.62, 0.1, 0.22, 0.08), 0.66],
                [new paper.Color(0.58, 0.08, 0.28, 0.4), 0.84],
                [new paper.Color(0.36, 0.1, 0.46, 0.22), 0.93],
                [new paper.Color(0.28, 0.06, 0.34, 0), 1]
              ]
        },
        origin: new Point(0, 0),
        destination: new Point(1, 0)
      };
    }

    const waveFills = {
      reward: waveGradient('reward'),
      stress: waveGradient('stress')
    };
    const waveViews = [];
    const wavePool = (config.waves && config.waves.pool) || 16;
    for (let i = 0; i < wavePool; i++) {
      const path = circle();
      path.visible = false;
      path.fillColor = waveFills.reward;
      waveViews.push({ path: path, type: '' });
    }

    const edgeViews = network.edges.map(function (edge) {
      const base = openPath();
      base.strokeColor = C.thinAxon;
      return { edge: edge, base: base, thick: null, length: 1, key: '' };
    });
    edgeViews.forEach(function (ev) {
      ev.thick = openPath();
      ev.thick.strokeColor = C.knowledge;
      ev.thick.strokeCap = 'butt';
      ev.thick.visible = false;
    });

    const neuronViews = network.neurons.map(function (neuron) {
      return {
        neuron: neuron,
        dendrites: [openPath(), openPath(), openPath()],
        soma: circle(),
        nucleus: circle(),
        shown: -1
      };
    });

    const ringViews = network.anchors.map(function () {
      const ring = circle();
      ring.fillColor = null;
      ring.strokeColor = C.anchorRing;
      ring.dashArray = [3, 4];
      ring.opacity = 0;
      return ring;
    });

    const crystalViews = sim.crystals.map(function () {
      const halo = circle();
      halo.visible = false;
      const partner = circle();
      partner.visible = false;
      const bead = circle();
      bead.visible = false;
      return { halo: halo, partner: partner, bead: bead };
    });

    const counterViews = sim.counters.map(function () {
      const halo = circle();
      halo.blendMode = 'screen';
      halo.fillColor = C.counter;
      halo.visible = false;
      const bead = circle();
      bead.fillColor = C.counter;
      bead.strokeColor = C.counterCore;
      bead.visible = false;
      return { halo: halo, bead: bead };
    });

    const thoughtViews = sim.thoughts.map(function () {
      const halo = circle();
      halo.blendMode = 'screen';
      halo.visible = false;
      const bead = circle();
      bead.visible = false;
      return { halo: halo, bead: bead };
    });

    // Background mood eases toward its target over ~1.5–2 s of simulated time.
    // A time jump (seek, reset, first frame) snaps straight to the target.
    const mood = { center: C.bgCenter.clone(), edge: C.bgEdge.clone(), dark: 0, time: null, key: '' };

    function darkTarget(snap) {
      if (snap.phase === 'deep') return 1;
      if (snap.phase === 'waking') return 1 - (snap.phaseBlend || 0);
      return 0;
    }

    function applyPalette() {
      const step = Math.round(mood.dark * PALETTE_STEPS);
      if (step === paletteStep) return;
      paletteStep = step;
      const t = step / PALETTE_STEPS;
      PALETTE_KEYS.forEach(function (key) { P[key] = mix(C[key], NIGHT[key], t); });
      edgeViews.forEach(function (ev) {
        ev.base.strokeColor = P.thinAxon;
        ev.thick.strokeColor = P.knowledge;
      });
      neuronViews.forEach(function (nv) {
        for (let i = 0; i < nv.dendrites.length; i++) nv.dendrites[i].strokeColor = P.dendrite;
        nv.soma.strokeColor = P.dendrite;
        nv.shown = -1;
      });
      ringViews.forEach(function (ring) { ring.strokeColor = P.anchorRing; });
      counterViews.forEach(function (cv) {
        cv.halo.fillColor = P.counter;
        cv.bead.fillColor = P.counter;
      });
    }

    // Each phase has one target color. The mood lerp below is what makes the
    // whole screen take about 1.5–2 s to arrive there.
    function moodTarget(snap) {
      const blend = snap.phaseBlend || 0;
      if (snap.phase === 'sleep-needed') {
        return {
          center: mix(C.bgCenter, C.needCenter, blend),
          edge: mix(C.bgEdge, C.needEdge, blend)
        };
      }
      if (snap.phase === 'rem') return { center: C.remCenter, edge: C.remEdge };
      if (snap.phase === 'deep') return { center: C.deepCenter, edge: C.deepEdge };
      if (snap.phase === 'waking') {
        return {
          center: mix(C.deepCenter, C.bgCenter, blend),
          edge: mix(C.deepEdge, C.bgEdge, blend)
        };
      }
      return { center: C.bgCenter, edge: C.bgEdge };
    }

    function paintBackground() {
      const width = view.size.width;
      const height = view.size.height;
      background.fillColor = {
        gradient: { stops: [mood.center, mood.edge], radial: true },
        origin: view.center,
        destination: view.center.add(new Point(Math.max(width, height) * 0.72, 0))
      };
    }

    function updateMood(snap) {
      const target = moodTarget(snap);
      const dt = mood.time === null ? Infinity : snap.time - mood.time;
      mood.time = snap.time;
      const k = dt < 0 || dt > 0.5 ? 1 : 1 - Math.exp(-dt / 0.55);
      if (k <= 0) return;
      mood.dark += (darkTarget(snap) - mood.dark) * k;
      mood.center = mix(mood.center, target.center, k);
      mood.edge = mix(mood.edge, target.edge, k);
      const key = mood.center.toCSS(true) + mood.edge.toCSS(true);
      if (key === mood.key) return;
      mood.key = key;
      paintBackground();
    }

    function px(x, y) {
      return new Point(x * sx, y * sy);
    }

    function layout() {
      const width = view.size.width;
      const height = view.size.height;
      sx = width / network.cols;
      sy = height / network.rows;
      cell = Math.min(sx, sy);
      thoughtRadius = Math.max(1.75, cell * 0.034);
      counterRadius = Math.max(1.55, cell * 0.028);

      background.segments = [[0, 0], [width, 0], [width, height], [0, height]];
      background.closed = true;
      paintBackground();

      const thinWidth = Math.max(0.55, cell * 0.0105);
      const thickWidth = Math.max(2.3, cell * 0.075);
      edgeViews.forEach(function (ev) {
        const e = ev.edge;
        const p0 = px(e.p0.x, e.p0.y);
        const p1 = px(e.p1.x, e.p1.y);
        const p2 = px(e.p2.x, e.p2.y);
        const p3 = px(e.p3.x, e.p3.y);
        const segments = [
          new Segment(p0, null, p1.subtract(p0)),
          new Segment(p3, p2.subtract(p3), null)
        ];
        ev.base.segments = segments;
        ev.thick.segments = segments.map(function (s) { return s.clone(); });
        ev.base.strokeWidth = thinWidth;
        ev.thick.strokeWidth = thickWidth;
        ev.length = Math.max(1, ev.base.length);
        ev.key = '';
      });

      const somaRadius = Math.max(2.5, cell * 0.067);
      const dendriteLength = cell * 0.17;
      const dendriteWidth = Math.max(0.55, cell * 0.009);
      neuronViews.forEach(function (nv) {
        const n = nv.neuron;
        const center = px(n.x, n.y);
        for (let i = 0; i < nv.dendrites.length; i++) {
          const angle = Math.PI + n.angle + (i - 1) * 0.8 +
            Math.sin(n.dendriteSeed + i * 1.7) * 0.22;
          const start = center.add(new Point(Math.cos(angle), Math.sin(angle)).multiply(somaRadius * 0.78));
          const bendA = angle + (U.hash(n.id, i) - 0.5) * 0.55;
          const middle = start.add(new Point(Math.cos(bendA), Math.sin(bendA)).multiply(dendriteLength * 0.56));
          const bendB = angle + (U.hash(i, n.id) - 0.5) * 0.8;
          const end = middle.add(new Point(Math.cos(bendB), Math.sin(bendB)).multiply(dendriteLength * 0.44));
          const dendrite = nv.dendrites[i];
          dendrite.segments = [start, middle, end];
          dendrite.smooth({ type: 'continuous' });
          dendrite.strokeColor = P.dendrite;
          dendrite.strokeWidth = dendriteWidth;
        }
        place(nv.soma, center.x, center.y, somaRadius);
        nv.soma.strokeColor = P.dendrite;
        nv.soma.strokeWidth = dendriteWidth / somaRadius;
        place(nv.nucleus, center.x - somaRadius * 0.16, center.y - somaRadius * 0.1, somaRadius * 0.34);
        nv.shown = -1;
      });

      network.anchors.forEach(function (anchor, i) {
        const radius = Math.max(cell * 0.42, sim.domainRadius(i) * cell);
        place(ringViews[i], anchor.x * sx, anchor.y * sy, radius);
        ringViews[i].strokeWidth = Math.max(0.8, cell * 0.02) / radius;
        ringViews[i].dashArray = [3 / radius, 4 / radius];
      });
    }

    function drawKnowledge() {
      edgeViews.forEach(function (ev) {
        const e = ev.edge;
        const show = e.seedAt >= 0 && e.strength > 0.004;
        if (!show) {
          if (ev.thick.visible) ev.thick.visible = false;
          ev.key = '';
          return;
        }
        const interval = sim.seedInterval(e);
        const key = interval.start.toFixed(3) + ':' + interval.end.toFixed(3);
        if (key === ev.key && ev.thick.visible) return;
        ev.key = key;
        ev.thick.visible = true;
        const before = ev.length * interval.start;
        const filled = Math.max(0.1, ev.length * (interval.end - interval.start));
        ev.thick.dashArray = [filled, ev.length * 2 + 2];
        ev.thick.dashOffset = -before;
      });

      neuronViews.forEach(function (nv) {
        const strength = nv.neuron.strength;
        if (Math.abs(strength - nv.shown) < 0.004) return;
        nv.shown = strength;
        nv.soma.fillColor = mix(P.somaLight, P.somaDark, strength);
        nv.nucleus.fillColor = mix(P.nucleusLight, P.nucleusDark, strength);
      });
    }

    function fadeFor(age, ttl, start) {
      const fadeStart = ttl * start;
      return age <= fadeStart ? 1 : clamp((ttl - age) / (ttl - fadeStart), 0, 1);
    }

    function drawThoughts() {
      sim.thoughts.forEach(function (p, i) {
        const tv = thoughtViews[i];
        if (!p.active) {
          tv.halo.visible = false;
          tv.bead.visible = false;
          return;
        }
        const kind = config.kinds[p.kind];
        const colors = KIND_COLORS[p.kind];
        const u = p.ttl > 0 ? p.age / p.ttl : 1;
        const fade = p.rejected ? Math.max(0, 1 - u) : fadeFor(p.age, p.ttl, 0.72);
        const radius = thoughtRadius * kind.size * sim.thoughtScale(p.age, p.ttl, p.rejected);
        const x = p.x * sx;
        const y = p.y * sy;
        if (tv.kind !== p.kind) {
          tv.kind = p.kind;
          tv.halo.fillColor = colors.color;
          tv.bead.fillColor = colors.color;
          tv.bead.strokeColor = colors.core;
        }
        tv.halo.visible = true;
        place(tv.halo, x, y, radius * 3.4);
        tv.halo.opacity = (p.rejected ? 0.22 : 0.2) * fade;
        tv.bead.visible = true;
        place(tv.bead, x, y, Math.max(0.2, radius));
        tv.bead.strokeWidth = 0.28;
        tv.bead.opacity = 0.96 * fade;
      });
    }

    function drawCounters() {
      sim.counters.forEach(function (c, i) {
        const cv = counterViews[i];
        if (!c.active) {
          cv.halo.visible = false;
          cv.bead.visible = false;
          return;
        }
        const u = c.ttl > 0 ? c.age / c.ttl : 1;
        const fade = Math.max(0, 1 - Math.max(0, u - 0.62) / 0.38);
        const radius = thoughtRadius * sim.counterVisualSize(c);
        const x = c.x * sx;
        const y = c.y * sy;
        if (radius < 0.04) {
          cv.halo.visible = false;
          cv.bead.visible = false;
          return;
        }
        cv.halo.visible = true;
        place(cv.halo, x, y, radius * 3.4);
        cv.halo.opacity = 0.16 * fade;
        cv.bead.visible = true;
        place(cv.bead, x, y, radius);
        cv.bead.strokeWidth = 0.28;
        cv.bead.opacity = 0.94 * fade;
      });
    }

    // Temporary and traveling thoughts are drawn at crystalScale (2×). A
    // permanent home eases back to the originating kind's regular size.
    const shownScale = sim.crystals.map(function () { return 0; });
    let drawnAt = null;

    function crystalScale(c, i, now) {
      const target = c.state === 'settled' ? 1 : config.crystalScale;
      const dt = drawnAt === null ? Infinity : now - drawnAt;
      if (shownScale[i] === 0) shownScale[i] = target;
      else {
        const k = dt < 0 || dt > 0.5 ? 1 : 1 - Math.exp(-dt / 0.28);
        shownScale[i] += (target - shownScale[i]) * k;
      }
      return shownScale[i];
    }

    function drawCrystals(asleep, now) {
      sim.crystals.forEach(function (c, i) {
        const cv = crystalViews[i];
        if (!c.active) {
          shownScale[i] = 0;
          cv.halo.visible = false;
          cv.partner.visible = false;
          cv.bead.visible = false;
          return;
        }
        const radius = thoughtRadius * config.kinds[c.kind].size * crystalScale(c, i, now);
        const at = sim.crystalPosition(c);
        const x = at.x * sx;
        const y = at.y * sy;

        cv.bead.visible = true;
        place(cv.bead, x, y, radius);
        cv.bead.opacity = 1;

        if (c.state === 'settled') {
          cv.bead.fillColor = C.settled;
          cv.bead.strokeColor = C.settledEdge;
          cv.bead.strokeWidth = 0.22;
          cv.halo.visible = true;
          place(cv.halo, x, y, radius * 1.9);
          cv.halo.fillColor = C.settledCore;
          cv.halo.opacity = 0.55;
          cv.partner.visible = false;
          return;
        }

        cv.bead.fillColor = C.homed;
        cv.bead.strokeColor = C.homedCore;
        cv.bead.strokeWidth = 0.26;

        if (c.state === 'wandering') {
          cv.halo.visible = true;
          place(cv.halo, x, y, radius * 2.8);
          cv.halo.fillColor = C.homed;
          cv.halo.opacity = asleep ? 0.28 : 0.16;
          cv.partner.visible = false;
          return;
        }

        cv.halo.visible = true;
        place(cv.halo, x, y, radius * 2.2);
        cv.halo.fillColor = C.homed;
        cv.halo.opacity = 0.14;
        const partner = sim.partnerPosition(c);
        cv.partner.visible = true;
        place(cv.partner, partner.x * sx, partner.y * sy, counterRadius * 0.8);
        cv.partner.fillColor = P.counter;
        cv.partner.opacity = 0.55;
      });
      drawnAt = now;
    }

    function drawRings(asleep) {
      const counts = sim.categoryCounts();
      const weights = config.categories.weights;
      ringViews.forEach(function (ring, i) {
        const radius = Math.max(cell * 0.42, sim.domainRadius(i) * cell);
        const anchor = network.anchors[i];
        place(ring, anchor.x * sx, anchor.y * sy, radius);
        ring.strokeWidth = Math.max(0.8, cell * 0.02) / radius;
        const presence = asleep ? 0.62 : (counts[i] > 0 ? 0.34 : 0.1);
        const weight = 0.72 + 0.4 * (weights[i] / 1.8);
        const target = Math.min(1, presence * weight * (1 + 0.45 * mood.dark));
        ring.opacity = lerp(ring.opacity, target, 0.12);
      });
    }

    // One smooth expansion. Reward is a broad gold-rose pulse; stress is a
    // narrower crimson-violet ring. Overlapping waves share a single opacity cap.
    function waveEnvelope(age, ttl, type) {
      const u = clamp(age / Math.max(ttl, 0.001), 0, 1);
      const hump = Math.sin(Math.PI * u);
      return Math.pow(hump, type === 'stress' ? 1.45 : 0.85);
    }

    function drawWaves(snap) {
      const events = snap.waves || [];
      const span = Math.max(view.size.width, view.size.height);
      const envelopes = [];
      let weight = 0;
      for (let i = 0; i < events.length; i++) {
        const envelope = waveEnvelope(events[i].age, events[i].ttl, events[i].type);
        envelopes.push(envelope);
        weight += envelope;
      }
      const cap = 0.82;
      const scale = weight > cap ? cap / weight : 1;
      for (let i = 0; i < waveViews.length; i++) {
        const viewW = waveViews[i];
        const wave = events[i];
        if (!wave) {
          viewW.path.visible = false;
          continue;
        }
        if (viewW.type !== wave.type) {
          viewW.type = wave.type;
          viewW.path.fillColor = waveFills[wave.type] || waveFills.reward;
        }
        const u = clamp(wave.age / Math.max(wave.ttl, 0.001), 0, 1);
        place(viewW.path, wave.x * sx, wave.y * sy, span * (0.045 + 0.74 * u));
        const peak = wave.type === 'stress' ? 0.58 + 0.22 * mood.dark : 0.48;
        viewW.path.opacity = envelopes[i] * peak * scale;
        viewW.path.visible = viewW.path.opacity > 0.012;
      }
    }

    function draw(snap) {
      const asleep = snap.asleep;
      updateMood(snap);
      applyPalette();
      drawWaves(snap);
      drawKnowledge();
      drawRings(asleep);
      drawCrystals(asleep, snap.time);
      drawCounters();
      drawThoughts();
    }

    return { layout: layout, draw: draw };
  };
})(typeof window !== 'undefined' ? window : globalThis);

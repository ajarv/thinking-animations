(function (root) {
  'use strict';
  const PL = root.PaperLife;
  const paper = root.paper;

  paper.setup(document.getElementById('stage'));
  const view = paper.view;

  const config = PL.config;
  const params = new URLSearchParams(location.search);
  // The lattice is chosen once, from the window this life opened in.
  // Later resizes only refit the uniform scale.
  function latticeFor(search) {
    const count = config.network.count;
    const spec = search.get('aspect');
    const pair = spec && /^(\d+)x(\d+)$/i.exec(spec);
    // 16x9 is a viewport shape, not a forced rectangle. 233 is prime.
    if (pair) return PL.chooseLattice(count, +pair[1], +pair[2]);
    if (spec && isFinite(parseFloat(spec))) return PL.chooseLattice(count, parseFloat(spec), 1);
    return PL.chooseLattice(count, root.innerWidth || 1440, root.innerHeight || 900);
  }
  const network = PL.createNetwork(config, latticeFor(params));
  const sim = PL.createSimulation(network, config);
  const renderer = PL.createRenderer(paper, network, sim, config);

  const hud = PL.createHud(config, {
    onLustHold: function (value) { sim.holdLust(value); },
    onLustRelease: function () { sim.releaseLust(); }
  });

  function render() {
    const snap = sim.snapshot();
    renderer.draw(snap);
    hud.update(snap);
  }

  function resize() {
    view.viewSize = new paper.Size(window.innerWidth, window.innerHeight);
    renderer.layout();
    render();
  }

  // URL parameters. Sleep is automatic. lust=0..100 forces a starting value
  // that then slides back toward the natural equilibrium.
  //   aspect=16x9  choose the staggered lattice for that viewport shape
  //   t=N      start N simulated seconds into a life
  //   still=1  freeze on that frame
  //   lust=N   start with lust forced to N
  //   diag=1   write stats JSON into <pre id="diag">
  //   bench=1  time N draw frames and write the result into #diag
  const reducedMotion = root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frozen = params.get('still') === '1' || params.get('bench') === '1' ||
    (reducedMotion && !params.has('t'));
  const startAt = params.has('t') ? parseFloat(params.get('t')) : (reducedMotion ? 55 : 0);
  const forcedLust = params.has('lust');

  if (forcedLust) sim.setLust(parseFloat(params.get('lust')));
  if (isFinite(startAt) && startAt > 0) {
    if (forcedLust) sim.resume(startAt);
    else sim.seek(startAt);
  }

  root.addEventListener('resize', resize);
  resize();

  // A backgrounded tab can report a multi-second delta. Cap the catch-up
  // so one frame cannot replay a long stretch of life.
  const MAX_FRAME = 0.05;
  view.onFrame = function (event) {
    if (!frozen) sim.advance(Math.min(event.delta, MAX_FRAME));
    render();
  };

  root.__life = {
    seek: function (seconds) { sim.seek(seconds); render(); },
    resume: function (seconds) { sim.resume(seconds); render(); },
    freeze: function (value) { frozen = !!value; },
    setLust: function (value) { sim.setLust(value); render(); },
    holdLust: function (value) { sim.holdLust(value); render(); },
    releaseLust: function () { sim.releaseLust(); render(); },
    time: function () { return sim.snapshot().time; },
    stats: sim.stats
  };

  if (params.get('bench') === '1') {
    const frames = 48;
    sim.resume(12);
    const samples = [];
    for (let i = 0; i < frames; i++) {
      const started = root.performance.now();
      sim.advance(1 / 60);
      renderer.draw(sim.snapshot());
      samples.push(root.performance.now() - started);
    }
    samples.sort(function (a, b) { return a - b; });
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i];
    const layer = paper.project.activeLayer;
    const report = {
      frames: frames,
      avgMs: +(sum / frames).toFixed(3),
      p95Ms: +samples[Math.min(frames - 1, Math.floor(frames * 0.95))].toFixed(3),
      paperItems: layer && layer.children ? layer.children.length : 0
    };
    root.__bench = report;
    const diag = document.createElement('pre');
    diag.id = 'diag';
    diag.textContent = JSON.stringify(report);
    document.body.appendChild(diag);
  }

  if (params.get('diag') === '1') {
    const diag = document.createElement('pre');
    diag.id = 'diag';
    diag.textContent = JSON.stringify(sim.stats());
    document.body.appendChild(diag);
  }
})(window);

(function (root) {
  'use strict';
  const B3 = root.Brain3D;
  const paper = root.paper;
  const params = new URLSearchParams(root.location.search);

  paper.setup(document.getElementById('stage'));
  const skeleton = B3.createSkeleton(B3.config);
  const simulation = B3.createSimulation(skeleton, B3.config);
  const renderer = B3.createRenderer(paper, skeleton, B3.config, simulation);
  const hud = B3.createHud(B3.config, simulation);
  const fixedStep = B3.config.thoughts.fixedStep;
  root.brain3d = {
    skeleton: skeleton,
    simulation: simulation,
    renderer: renderer
  };

  paper.view.onResize = function () {
    renderer.layout();
  };

  function advanceSimulation(seconds) {
    const steps = Math.floor(seconds / fixedStep);
    for (let i = 0; i < steps; i++) simulation.step(fixedStep);
  }

  // ?still=1&t=N advances both simulation and spin by N seconds.
  if (params.get('still') === '1') {
    const seconds = Number(params.get('t')) || 0;
    advanceSimulation(seconds);
    renderer.draw(seconds);
    renderer.draw(0);
    hud.update();
    paper.view.update();
    return;
  }

  // ?bench=1 times N frames of update plus canvas draw, without waiting for the display.
  if (params.get('bench') === '1') {
    const frames = Number(params.get('frames')) || 600;
    const update = [];
    const total = [];
    const countItems = function (item) {
      let count = 1;
      if (item.children) {
        for (let i = 0; i < item.children.length; i++) count += countItems(item.children[i]);
      }
      return count;
    };
    const itemCount = function () {
      let count = 0;
      for (let i = 0; i < paper.project.layers.length; i++) {
        count += countItems(paper.project.layers[i]);
      }
      return count;
    };
    const itemsBefore = itemCount();
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      simulation.step(fixedStep);
      renderer.draw(fixedStep);
      const t1 = performance.now();
      paper.view.update();
      const t2 = performance.now();
      update.push(t1 - t0);
      total.push(t2 - t0);
    }
    const summary = function (list) {
      const sorted = list.slice().sort(function (a, b) { return a - b; });
      const avg = list.reduce(function (s, v) { return s + v; }, 0) / list.length;
      return 'avg ' + avg.toFixed(3) + ' ms, p95 ' + sorted[Math.floor(sorted.length * 0.95)].toFixed(3) + ' ms';
    };
    const pre = document.createElement('pre');
    pre.id = 'diag';
    pre.textContent = renderer.stats.neurons + ' neurons, ' + renderer.stats.axons + ' axons, ' +
      renderer.stats.schwannCells + ' Schwann cells, ' + renderer.stats.domains +
      ' domains, ' + simulation.stats.cohorts + ' cohorts, ' +
      simulation.stats.housed + ' housed, ' + frames + ' frames\nupdate ' +
      summary(update) + '\nupdate+draw ' + summary(total) + '\npaper items ' +
      itemsBefore + ' -> ' + itemCount();
    document.body.appendChild(pre);
    return;
  }

  let accumulator = 0;
  let paused = false;
  const toggle = document.createElement('button');
  toggle.id = 'play-toggle';
  toggle.type = 'button';
  toggle.textContent = 'Pause';
  toggle.setAttribute('aria-pressed', 'false');
  document.body.appendChild(toggle);

  function setPaused(next) {
    paused = next;
    toggle.textContent = paused ? 'Resume' : 'Pause';
    toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }

  toggle.addEventListener('click', function () {
    setPaused(!paused);
  });
  root.addEventListener('keydown', function (event) {
    if (event.code !== 'Space' || event.target === toggle || event.target.tagName === 'BUTTON') return;
    event.preventDefault();
    setPaused(!paused);
  });

  paper.view.onFrame = function (event) {
    if (paused) return;
    const delta = Math.min(event.delta, 0.05);
    accumulator += delta;
    while (accumulator >= fixedStep) {
      simulation.step(fixedStep);
      accumulator -= fixedStep;
    }
    renderer.draw(delta);
    hud.update();
  };
  root.brain3d.paused = function () { return paused; };
})(window);

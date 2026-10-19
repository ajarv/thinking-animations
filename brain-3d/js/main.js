(function (root) {
  'use strict';
  const B3 = root.Brain3D;
  const paper = root.paper;
  const params = new URLSearchParams(root.location.search);

  paper.setup(document.getElementById('stage'));
  const skeleton = B3.createSkeleton(B3.config);
  const renderer = B3.createRenderer(paper, skeleton, B3.config);
  root.brain3d = renderer;

  paper.view.onResize = function () {
    renderer.layout();
  };

  // ?still=1&t=N draws one frame N seconds into the spin, for screenshots.
  if (params.get('still') === '1') {
    renderer.draw(Number(params.get('t')) || 0);
    renderer.draw(0);
    paper.view.update();
    return;
  }

  // ?bench=1 times N frames of update plus canvas draw, without waiting for the display.
  if (params.get('bench') === '1') {
    const frames = Number(params.get('frames')) || 600;
    const update = [];
    const total = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      renderer.draw(1 / 60);
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
      renderer.stats.schwannCells + ' Schwann cells, ' + frames + ' frames\nupdate ' +
      summary(update) + '\nupdate+draw ' + summary(total);
    document.body.appendChild(pre);
    return;
  }

  paper.view.onFrame = function (event) {
    renderer.draw(Math.min(event.delta, 0.05));
  };
})(window);

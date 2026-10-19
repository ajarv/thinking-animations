(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  function now() {
    return root.performance ? root.performance.now() : Date.now();
  }

  B3.createRenderer = function (paper, skeleton, config) {
    const Point = paper.Point;
    const Path = paper.Path;
    const neurons = skeleton.neurons;
    const edges = skeleton.edges;
    const colors = config.colors;
    const camera = config.camera;
    const somaCfg = config.soma;
    const schwannCfg = config.schwann;
    const yawRate = config.spin.degreesPerSecond * Math.PI / 180;
    const BASE = 10;

    const background = new Path.Rectangle(paper.view.bounds);
    const schwannLayer = new paper.Group();
    const somaLayer = new paper.Group();

    // Five pooled, rounded paths make the Schwann cells along each axon.
    const schwannCells = edges.map(function () {
      const cells = [];
      for (let i = 0; i < schwannCfg.cellsPerAxon; i++) {
        const path = new Path({
          segments: [[0, 0], [0, 0]],
          strokeColor: colors.schwann,
          strokeWidth: schwannCfg.strokeWidth,
          strokeCap: 'round'
        });
        schwannLayer.addChild(path);
        cells.push(path);
      }
      return cells;
    });

    // Soma and nucleus share a group so depth sort moves one item per neuron.
    const cells = neurons.map(function () {
      const soma = new Path.Circle({
        center: [0, 0],
        radius: BASE,
        fillColor: colors.soma,
        strokeColor: colors.somaEdge,
        strokeWidth: 1.2,
        strokeScaling: false
      });
      const nucleus = new Path.Circle({
        center: [-0.6, -0.4],
        radius: BASE * somaCfg.nucleus,
        fillColor: colors.nucleus
      });
      const group = new paper.Group({ children: [soma, nucleus], applyMatrix: false });
      group.pivot = new Point(0, 0);
      somaLayer.addChild(group);
      return group;
    });

    const readout = new paper.PointText({
      point: [16, 28],
      fillColor: colors.text,
      fontSize: 13,
      fontFamily: 'Georgia, serif',
      content: ''
    });

    const projected = neurons.map(function () { return { x: 0, y: 0, z: 0, s: 1 }; });
    const order = neurons.map(function (_, i) { return i; });
    const byDepth = function (a, b) { return projected[b].z - projected[a].z; };
    let yaw = 0;
    let scale = 1;
    let cx = 0;
    let cy = 0;
    const drawn = order.slice();
    let frameMs = 0;
    let frames = 0;
    let sampled = 0;
    const stats = {
      neurons: neurons.length,
      axons: edges.length,
      schwannCells: edges.length * schwannCfg.cellsPerAxon,
      avgMs: 0,
      fps: 0
    };

    function layout() {
      const bounds = paper.view.bounds;
      background.segments[0].point = bounds.bottomLeft;
      background.segments[1].point = bounds.topLeft;
      background.segments[2].point = bounds.topRight;
      background.segments[3].point = bounds.bottomRight;
      background.fillColor = {
        gradient: { stops: [colors.bgCenter, colors.bgEdge], radial: true },
        origin: bounds.center,
        destination: new Point(bounds.right, bounds.top)
      };
      cx = bounds.center.x;
      cy = bounds.center.y;
      scale = Math.min(bounds.width, bounds.height) * camera.fill * camera.distance;
    }

    function project() {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (let i = 0; i < neurons.length; i++) {
        const n = neurons[i];
        const p = projected[i];
        const x = n.x * c + n.z * s;
        const z = n.z * c - n.x * s;
        const k = 1 / (camera.distance + z);
        p.x = cx + x * scale * k;
        p.y = cy - n.y * scale * k;
        p.z = z;
        p.s = camera.distance * k;
      }
    }

    function draw(dt) {
      const t0 = now();
      yaw += yawRate * dt;
      project();

      for (let i = 0; i < edges.length; i++) {
        const pa = projected[edges[i].a];
        const pb = projected[edges[i].b];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const opacity = Math.min(1, 0.4 + 0.55 * (pa.s + pb.s) * 0.5);
        const gap = schwannCfg.gapRatio * 0.5;
        const cells = schwannCells[i];
        for (let j = 0; j < cells.length; j++) {
          const start = (j + gap) / cells.length;
          const finish = (j + 1 - gap) / cells.length;
          const segs = cells[j].segments;
          segs[0].point.x = pa.x + dx * start;
          segs[0].point.y = pa.y + dy * start;
          segs[1].point.x = pa.x + dx * finish;
          segs[1].point.y = pa.y + dy * finish;
          cells[j].opacity = opacity;
        }
      }

      for (let i = 0; i < cells.length; i++) {
        const p = projected[i];
        const r = Math.max(somaCfg.minRadius, somaCfg.radius * p.s) / BASE;
        const m = cells[i].matrix;
        m.a = r; m.b = 0; m.c = 0; m.d = r; m.tx = p.x; m.ty = p.y;
        cells[i].matrix = m;
      }

      order.sort(byDepth);
      let changed = false;
      for (let n = 0; n < order.length; n++) {
        if (drawn[n] !== order[n]) { changed = true; break; }
      }
      if (changed) {
        for (let n = 0; n < order.length; n++) {
          drawn[n] = order[n];
          somaLayer.addChild(cells[order[n]]);
        }
      }

      if (dt > 0.1) return;
      frameMs += now() - t0;
      frames++;
      sampled += dt;
      if (sampled >= 0.5) {
        stats.avgMs = frameMs / frames;
        stats.fps = frames / sampled;
        readout.content = stats.neurons + ' neurons · ' + stats.axons + ' axons · ' +
          stats.schwannCells + ' Schwann cells · ' +
          stats.avgMs.toFixed(2) + ' ms update · ' + stats.fps.toFixed(0) + ' fps';
        frameMs = 0;
        frames = 0;
        sampled = 0;
      }
    }

    layout();
    readout.content = stats.neurons + ' neurons · ' + stats.axons + ' axons · ' +
      stats.schwannCells + ' Schwann cells';
    return { layout: layout, draw: draw, stats: stats };
  };
})(typeof window !== 'undefined' ? window : globalThis);

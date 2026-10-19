(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  function now() {
    return root.performance ? root.performance.now() : Date.now();
  }

  B3.createRenderer = function (paper, skeleton, config, simulation) {
    const Point = paper.Point;
    const Path = paper.Path;
    const neurons = skeleton.neurons;
    const edges = skeleton.edges;
    const colors = config.colors;
    const camera = config.camera;
    const somaCfg = config.soma;
    const schwannCfg = config.schwann;
    const thoughtCfg = config.thoughts;
    const BASE = 10;

    const background = new Path.Rectangle(paper.view.bounds);
    const schwannLayer = new paper.Group();
    const objectLayer = new paper.Group();

    const scratch3 = { x: 0, y: 0, z: 0 };
    const scratch2 = { x: 0, y: 0, z: 0, s: 1 };

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
    // A domain center also carries a camera-facing ring, the 2D anchor mark.
    const cells = neurons.map(function (neuron) {
      const isCenter = neuron.category >= 0;
      const children = [];
      if (isCenter) {
        children.push(new Path.Circle({
          center: [0, 0],
          radius: BASE * 2.15,
          strokeColor: colors.anchorRing,
          strokeWidth: 2,
          strokeScaling: false
        }));
      }
      const soma = new Path.Circle({
        center: [0, 0],
        radius: BASE,
        fillColor: colors.soma,
        strokeColor: isCenter ? colors.anchorRing : colors.somaEdge,
        strokeWidth: isCenter ? 2 : 1.2,
        strokeScaling: false
      });
      const nucleus = new Path.Circle({
        center: [-0.6, -0.4],
        radius: BASE * somaCfg.nucleus,
        fillColor: colors.nucleus
      });
      children.push(soma, nucleus);
      const group = new paper.Group({ children: children, applyMatrix: false });
      group.pivot = new Point(0, 0);
      objectLayer.addChild(group);
      return group;
    });

    function createBead(fill, core, haloScale) {
      const halo = new Path.Circle({
        center: [0, 0],
        radius: BASE * haloScale,
        fillColor: fill,
        opacity: 0.14
      });
      const bead = new Path.Circle({
        center: [0, 0],
        radius: BASE,
        fillColor: fill,
        strokeColor: core,
        strokeWidth: 1.5,
        strokeScaling: false
      });
      const group = new paper.Group({ children: [halo, bead], applyMatrix: false });
      group.pivot = new Point(0, 0);
      group.visible = false;
      objectLayer.addChild(group);
      return {
        group: group,
        projected: { x: 0, y: 0, z: 0, s: 1 },
        record: null
      };
    }

    const externalView = createBead(colors.external, colors.externalCore, 1.75);
    const internalViews = simulation.internals.map(function () {
      return createBead(colors.internal, colors.internalCore, 1.55);
    });
    const homeViews = simulation.homes.map(function () {
      const view = createBead(colors.temporary, colors.temporaryCore, 1.45);
      view.isHome = true;
      return view;
    });

    const readout = new paper.PointText({
      point: [16, 28],
      fillColor: colors.text,
      fontSize: 13,
      leading: 18,
      fontFamily: 'Georgia, serif',
      content: ''
    });

    const projected = neurons.map(function () { return { x: 0, y: 0, z: 0, s: 1 }; });
    const depthOrder = cells.map(function (view, index) {
      return { view: view, depth: 0, active: true, neuron: index };
    });
    function addBeadRecord(view) {
      const record = { view: view.group, depth: Infinity, active: false, neuron: -1 };
      view.record = record;
      depthOrder.push(record);
    }
    addBeadRecord(externalView);
    internalViews.forEach(addBeadRecord);
    homeViews.forEach(addBeadRecord);
    const byDepth = function (a, b) {
      if (a.active !== b.active) return a.active ? 1 : -1;
      return b.depth - a.depth;
    };
    let yaw = 0;
    let scale = 1;
    let cx = 0;
    let cy = 0;
    let frameMs = 0;
    let frames = 0;
    let sampled = 0;
    const stats = {
      neurons: neurons.length,
      axons: edges.length,
      schwannCells: edges.length * schwannCfg.cellsPerAxon,
      domains: skeleton.anchors.length,
      activeThoughts: 0,
      temporaryHomes: 0,
      cohorts: 0,
      housed: 0,
      avgMs: 0,
      fps: 0
    };

    const daySoma = new paper.Color(colors.soma);
    const daySomaEdge = new paper.Color(colors.somaEdge);
    const daySchwann = new paper.Color(colors.schwann);
    const daySaturatedSchwann = new paper.Color(colors.saturatedSchwann);
    const dayText = new paper.Color(colors.text);
    const nightSoma = new paper.Color(colors.nightSoma);
    const nightSomaEdge = new paper.Color(colors.nightSomaEdge);
    const nightSchwann = new paper.Color(colors.nightSchwann);
    const nightSaturatedSchwann = new paper.Color(colors.nightSaturatedSchwann);
    const nightText = new paper.Color(colors.nightText);
    const mood = {
      center: new paper.Color(colors.bgCenter),
      edge: new paper.Color(colors.bgEdge),
      dark: 0,
      time: null,
      token: '',
      paintTime: null
    };

    function hexColor(color) {
      const channel = function (value) {
        return ('0' + Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16)).slice(-2);
      };
      return '#' + channel(color.red) + channel(color.green) + channel(color.blue);
    }

    function mixColor(a, b, t) {
      const u = Math.max(0, Math.min(1, t));
      return new paper.Color(
        a.red + (b.red - a.red) * u,
        a.green + (b.green - a.green) * u,
        a.blue + (b.blue - a.blue) * u
      );
    }

    function moodTarget() {
      const blend = simulation.phaseBlend || 0;
      if (simulation.phase === 'sleep-needed') {
        return {
          center: mixColor(new paper.Color(colors.bgCenter), new paper.Color(colors.needCenter), blend),
          edge: mixColor(new paper.Color(colors.bgEdge), new paper.Color(colors.needEdge), blend)
        };
      }
      if (simulation.phase === 'stage1') {
        return {
          center: new paper.Color(colors.stage1Center),
          edge: new paper.Color(colors.stage1Edge)
        };
      }
      if (simulation.phase === 'rem') {
        return {
          center: new paper.Color(colors.remCenter),
          edge: new paper.Color(colors.remEdge)
        };
      }
      if (simulation.phase === 'deep') {
        return {
          center: new paper.Color(colors.deepCenter),
          edge: new paper.Color(colors.deepEdge)
        };
      }
      if (simulation.phase === 'waking') {
        return {
          center: mixColor(new paper.Color(colors.deepCenter), new paper.Color(colors.bgCenter), blend),
          edge: mixColor(new paper.Color(colors.deepEdge), new paper.Color(colors.bgEdge), blend)
        };
      }
      return {
        center: new paper.Color(colors.bgCenter),
        edge: new paper.Color(colors.bgEdge)
      };
    }

    function updateMood() {
      const dt = mood.time === null ? Infinity : simulation.time - mood.time;
      mood.time = simulation.time;
      const darkTarget = simulation.phase === 'deep' ? 1
        : simulation.phase === 'waking' ? 1 - (simulation.phaseBlend || 0)
        : 0;
      const k = dt < 0 || dt > 0.5 ? 1 : 1 - Math.exp(-dt / 0.55);
      const nextDark = mood.dark + (darkTarget - mood.dark) * k;
      // Restyling every axon is visible work. Steady phases and unchanged
      // saturation reuse the last colors; transitions still step smoothly.
      const token = simulation.phase + ':' +
        Math.round((simulation.phaseBlend || 0) * 40) + ':' +
        Math.round(nextDark * 40) + ':' +
        simulation.stats.saturated;
      mood.dark = nextDark;
      if (token === mood.token) return;
      const paintDt = mood.paintTime === null ? Infinity : simulation.time - mood.paintTime;
      mood.paintTime = simulation.time;
      mood.token = token;
      const paintK = paintDt < 0 || paintDt > 0.5 ? 1 : 1 - Math.exp(-paintDt / 0.55);
      const target = moodTarget();
      mood.center = mixColor(mood.center, target.center, paintK);
      mood.edge = mixColor(mood.edge, target.edge, paintK);
      background.fillColor = {
        gradient: {
          stops: [hexColor(mood.center), hexColor(mood.edge)],
          radial: true
        },
        origin: paper.view.center,
        destination: paper.view.bounds.rightCenter
      };
      const somaFill = mixColor(daySoma, nightSoma, mood.dark);
      const somaEdge = mixColor(daySomaEdge, nightSomaEdge, mood.dark);
      const axon = mixColor(daySchwann, nightSchwann, mood.dark);
      const saturatedAxon = mixColor(
        daySaturatedSchwann,
        nightSaturatedSchwann,
        mood.dark
      );
      for (let i = 0; i < cells.length; i++) {
        const soma = neurons[i].category >= 0 ? cells[i].children[1] : cells[i].children[0];
        soma.fillColor = somaFill;
        if (neurons[i].category < 0) soma.strokeColor = somaEdge;
      }
      for (let i = 0; i < schwannCells.length; i++) {
        for (let j = 0; j < schwannCells[i].length; j++) {
          const saturated = simulation.saturatedSchwann[i][j];
          schwannCells[i][j].strokeColor = saturated ? saturatedAxon : axon;
          schwannCells[i][j].strokeWidth = saturated
            ? schwannCfg.saturatedStrokeWidth
            : schwannCfg.strokeWidth;
        }
      }
      readout.fillColor = mixColor(dayText, nightText, mood.dark);
      document.body.style.background = hexColor(mood.center);
    }

    function layout() {
      const bounds = paper.view.bounds;
      background.segments[0].point = bounds.bottomLeft;
      background.segments[1].point = bounds.topLeft;
      background.segments[2].point = bounds.topRight;
      background.segments[3].point = bounds.bottomRight;
      cx = bounds.center.x;
      cy = bounds.center.y;
      scale = Math.min(bounds.width, bounds.height) * camera.fill * camera.distance;
      updateMood();
    }

    function projectPoint(x, y, z, into) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const xr = x * c + z * s;
      const zr = z * c - x * s;
      const k = 1 / (camera.distance + zr);
      into.x = cx + xr * scale * k;
      into.y = cy - y * scale * k;
      into.z = zr;
      into.s = camera.distance * k;
    }

    function axonPoint(edgeIndex, t, into) {
      skeleton.pointOnEdge(edgeIndex, t, scratch3);
      projectPoint(scratch3.x, scratch3.y, scratch3.z, into);
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

    function hideBead(view) {
      view.group.visible = false;
      view.record.active = false;
      view.record.depth = Infinity;
    }

    function placeBead(view, item, radius, fadeAt) {
      if (!item.active) {
        hideBead(view);
        return false;
      }
      const p = view.projected;
      projectPoint(item.position.x, item.position.y, item.position.z, p);
      const pixelRadius = Math.max(0.25, radius * item.scale *
        (scale / camera.distance) * p.s);
      const factor = pixelRadius / BASE;
      const matrix = view.group.matrix;
      matrix.a = factor;
      matrix.b = 0;
      matrix.c = 0;
      matrix.d = factor;
      matrix.tx = p.x;
      matrix.ty = p.y;
      view.group.matrix = matrix;
      view.group.opacity = fadeAt > 0 ? Math.min(1, item.scale / fadeAt) : 1;
      if (view.isHome) {
        const settled = item.state === 'settled';
        const kind = settled ? 'settled' : 'temporary';
        if (view.kind !== kind) {
          view.kind = kind;
          view.group.children[0].fillColor = settled ? colors.settled : colors.temporary;
          view.group.children[1].fillColor = settled ? colors.settled : colors.temporary;
          view.group.children[1].strokeColor = settled ? colors.settledCore : colors.temporaryCore;
        }
      }
      view.group.visible = true;
      view.record.active = true;
      view.record.depth = p.z;
      return true;
    }

    function drawThoughts() {
      let active = 0;
      if (placeBead(
        externalView,
        simulation.external,
        thoughtCfg.external.radius,
        0
      )) active++;
      for (let i = 0; i < internalViews.length; i++) {
        if (placeBead(
          internalViews[i],
          simulation.internals[i],
          thoughtCfg.internal.radius,
          0.25
        )) active++;
      }
      let homes = 0;
      for (let i = 0; i < homeViews.length; i++) {
        if (placeBead(
          homeViews[i],
          simulation.homes[i],
          thoughtCfg.external.radius,
          0
        )) homes++;
      }
      stats.activeThoughts = active;
      stats.temporaryHomes = homes;
      stats.cohorts = simulation.stats.cohorts;
      stats.housed = simulation.stats.housed;
    }

    function sensationLabel() {
      const item = simulation.external;
      if (!item.active) return '';
      if (item.state === 'approaching') return ' · sensation approaching';
      if (item.state === 'received') return ' · sensation received';
      if (item.accepted) return ' · sensation accepted';
      return '';
    }

    function statusText(includePerformance) {
      const blocked = simulation.stats.saturated;
      const total = simulation.schwannTotal;
      const pct = total ? 100 * blocked / total : 0;
      const percent = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
      let detail = stats.temporaryHomes + ' housed · ' + stats.activeThoughts +
        ' moving · ' + blocked + '/' + total + ' · ' + percent + '% saturated';
      if (includePerformance) {
        detail += ' · ' + stats.avgMs.toFixed(2) + ' ms · ' +
          stats.fps.toFixed(0) + ' fps';
      }
      return stats.neurons + ' neurons · ' + simulation.phase + sensationLabel() +
        '\n' + detail;
    }

    function draw(dt) {
      const t0 = now();
      const fullRate = config.spin.degreesPerSecond;
      const minRate = config.spin.minDegreesPerSecond;
      const spinDps = minRate + (fullRate - minRate) *
        Math.pow(1 - simulation.saturation, config.spin.slowdownPower);
      yaw += spinDps * Math.PI / 180 * dt;
      updateMood();
      project();

      for (let i = 0; i < edges.length; i++) {
        const pa = projected[edges[i].a];
        const pb = projected[edges[i].b];
        const opacity = Math.min(1, 0.4 + 0.55 * (pa.s + pb.s) * 0.5);
        const gap = schwannCfg.gapRatio * 0.5;
        const cells = schwannCells[i];
        for (let j = 0; j < cells.length; j++) {
          const segs = cells[j].segments;
          axonPoint(i, (j + gap) / cells.length, scratch2);
          segs[0].point.x = scratch2.x;
          segs[0].point.y = scratch2.y;
          axonPoint(i, (j + 1 - gap) / cells.length, scratch2);
          segs[1].point.x = scratch2.x;
          segs[1].point.y = scratch2.y;
          cells[j].opacity = opacity;
        }
      }

      for (let i = 0; i < cells.length; i++) {
        const p = projected[i];
        const r = Math.max(somaCfg.minRadius, somaCfg.radius * p.s) / BASE;
        const m = cells[i].matrix;
        m.a = r; m.b = 0; m.c = 0; m.d = r; m.tx = p.x; m.ty = p.y;
        cells[i].matrix = m;
        if (neurons[i].category >= 0) {
          cells[i].firstChild.opacity = Math.min(1, 0.55 + 0.45 * p.s);
        }
        depthOrder[i].depth = p.z;
      }

      drawThoughts();
      depthOrder.sort(byDepth);
      for (let n = 0; n < depthOrder.length; n++) {
        objectLayer.addChild(depthOrder[n].view);
      }

      if (dt > 0.1) {
        readout.content = statusText(false);
        return;
      }
      frameMs += now() - t0;
      frames++;
      sampled += dt;
      if (sampled >= 0.5) {
        stats.avgMs = frameMs / frames;
        stats.fps = frames / sampled;
        readout.content = statusText(true);
        frameMs = 0;
        frames = 0;
        sampled = 0;
      }
    }

    layout();
    readout.content = statusText(false);
    return { layout: layout, draw: draw, stats: stats };
  };
})(typeof window !== 'undefined' ? window : globalThis);

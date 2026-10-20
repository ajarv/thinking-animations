(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function routeLength(route, edges, end) {
    let length = 0;
    const stop = end == null ? route.length : Math.min(route.length, end + 1);
    for (let i = 0; i < stop; i++) length += edges[route[i].edge].length;
    return length;
  }

  B3.createSimulation = function (skeleton, config) {
    const neurons = skeleton.neurons;
    const edges = skeleton.edges;
    const anchors = skeleton.anchors;
    const cfg = config.thoughts;
    const rng = mulberry32((config.seed ^ 0xA341316C) >>> 0);
    const positionScratch = { x: 0, y: 0, z: 0 };
    const center = { x: 0, y: 0, z: 0 };
    neurons.forEach(function (neuron) {
      center.x += neuron.x;
      center.y += neuron.y;
      center.z += neuron.z;
    });
    center.x /= neurons.length;
    center.y /= neurons.length;
    center.z /= neurons.length;
    let shellRadius = 0;
    neurons.forEach(function (neuron) {
      shellRadius = Math.max(shellRadius, Math.hypot(
        neuron.x - center.x, neuron.y - center.y, neuron.z - center.z
      ));
    });
    const meshPoints = [];
    const meshSegments = [];
    const bendSteps = Math.max(1, config.schwann.cellsPerAxon);
    edges.forEach(function (edge) {
      let previous = null;
      for (let step = 0; step <= bendSteps; step++) {
        const u = step / bendSteps;
        const point = skeleton.pointOnEdge(edge.id, u);
        const sample = { edge: edge.id, u: u, x: point.x, y: point.y, z: point.z };
        meshPoints.push(sample);
        if (previous) {
          meshSegments.push({
            edge: edge.id,
            u0: previous.u,
            u1: u,
            ax: previous.x,
            ay: previous.y,
            az: previous.z,
            bx: sample.x,
            by: sample.y,
            bz: sample.z
          });
        }
        previous = sample;
      }
    });

    // Looking inward from outside the shell, sort each neuron's axons
    // clockwise. Saturation walks around that order, then moves one Schwann
    // cell farther from the neuron and walks around again.
    const schwannCount = config.schwann.cellsPerAxon;
    const saturationCfg = cfg.saturation;
    const spinCfg = config.spin;
    const receptivityCfg = cfg.receptivity;
    const schwannTotal = edges.length * schwannCount;
    const maxInternals = cfg.internal.maxCount;
    const saturatedSchwann = edges.map(function () {
      return new Array(schwannCount).fill(false);
    });
    const saturationOrder = neurons.map(function (neuron) {
      let nx = neuron.x - center.x;
      let ny = neuron.y - center.y;
      let nz = neuron.z - center.z;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;

      // Tangent "up"; switch reference near the poles.
      let rx = 0;
      let ry = 1;
      let rz = 0;
      if (Math.abs(ny) > 0.9) {
        rx = 1;
        ry = 0;
      }
      const dot = rx * nx + ry * ny + rz * nz;
      let ux = rx - nx * dot;
      let uy = ry - ny * dot;
      let uz = rz - nz * dot;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;

      const around = neuron.adjacent.map(function (option) {
        const other = neurons[option.to];
        let dx = other.x - neuron.x;
        let dy = other.y - neuron.y;
        let dz = other.z - neuron.z;
        const radial = dx * nx + dy * ny + dz * nz;
        dx -= nx * radial;
        dy -= ny * radial;
        dz -= nz * radial;
        return {
          edge: option.edge,
          nearA: edges[option.edge].a === neuron.id,
          angle: Math.atan2(dx * vx + dy * vy + dz * vz, dx * ux + dy * uy + dz * uz)
        };
      });
      around.sort(function (a, b) {
        return b.angle - a.angle || a.edge - b.edge;
      });

      const order = [];
      for (let ring = 0; ring < schwannCount; ring++) {
        for (let i = 0; i < around.length; i++) {
          order.push({
            edge: around[i].edge,
            cell: around[i].nearA ? ring : schwannCount - 1 - ring
          });
        }
      }
      return order;
    });
    const saturationWalks = new Array(neurons.length);
    const saturationCursors = new Uint16Array(neurons.length);

    function saturationWalk(nodeId) {
      if (saturationWalks[nodeId]) return saturationWalks[nodeId];
      const order = [];
      const queue = [nodeId];
      const seenNodes = new Uint8Array(neurons.length);
      const seenCells = new Uint8Array(schwannTotal);
      seenNodes[nodeId] = 1;
      let read = 0;
      while (read < queue.length) {
        const current = queue[read++];
        const local = saturationOrder[current];
        const queuedEdges = {};
        for (let i = 0; i < local.length; i++) {
          const candidate = local[i];
          const key = candidate.edge * schwannCount + candidate.cell;
          if (!seenCells[key]) {
            seenCells[key] = 1;
            order.push(candidate);
          }
          if (queuedEdges[candidate.edge]) continue;
          queuedEdges[candidate.edge] = true;
          const edge = edges[candidate.edge];
          const next = edge.a === current ? edge.b : edge.a;
          if (!seenNodes[next]) {
            seenNodes[next] = 1;
            queue.push(next);
          }
        }
      }
      saturationWalks[nodeId] = order;
      return order;
    }

    function blockSizeForSaturation(value) {
      const room = clamp(
        (saturationCfg.ceiling - value) / saturationCfg.ceiling,
        0,
        1
      );
      const ideal = Math.max(
        1,
        saturationCfg.maxBlock * Math.pow(room, saturationCfg.blockPower)
      );
      let selected = saturationCfg.fibonacci[0];
      for (let i = 1; i < saturationCfg.fibonacci.length; i++) {
        if (saturationCfg.fibonacci[i] > ideal + 1e-9) break;
        selected = saturationCfg.fibonacci[i];
      }
      return selected;
    }

    function saturationFill() {
      return clamp(state.saturation / saturationCfg.ceiling, 0, 1);
    }

    function internalCountForBand(band) {
      const room = 1 - saturationFill();
      const multiplier = receptivityCfg.multiplierFloor +
        receptivityCfg.multiplierRange * Math.pow(room, receptivityCfg.power);
      let count = Math.round(band.internals * multiplier);
      let distress = false;
      const largestBand = cfg.external.sizes[0];
      if (
        band === largestBand &&
        state.saturation >= receptivityCfg.distressSaturation &&
        rng() < receptivityCfg.distressChance
      ) {
        const bursts = receptivityCfg.distressBursts;
        count += bursts[Math.floor(rng() * bursts.length)];
        distress = true;
        state.stats.distressEvents++;
      }
      return {
        count: clamp(count, 1, maxInternals),
        distress: distress
      };
    }

    const external = {
      active: false,
      state: 'idle',
      accepted: false,
      age: 0,
      ttl: cfg.external.ttl,
      scale: 0,
      speed: cfg.external.speed,
      route: [],
      routeIndex: 0,
      progress: 0,
      position: { x: 0, y: 0, z: 0 },
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      flight: 0,
      hitT: 0,
      hit: null,
      receivedAt: -1,
      startScale: 1,
      internalCount: 0,
      distress: false,
      serial: 0
    };

    function makeSpark() {
      return {
        active: false,
        age: 0,
        ttl: cfg.internal.ttlMax,
        scale: 0,
        startScale: 1,
        shrinkPower: 1,
        speed: cfg.internal.speedMin,
        route: [],
        routeIndex: 0,
        progress: 0,
        direction: { x: 0, y: -1, z: 0 },
        flightLeft: 0,
        spark: 0,
        position: { x: 0, y: 0, z: 0 },
        sourceCategory: -1,
        targetNode: -1,
        serial: 0
      };
    }

    const internals = [];
    for (let i = 0; i < maxInternals; i++) internals.push(makeSpark());
    const fireworks = [];
    for (let i = 0; i < cfg.internal.remPool; i++) fireworks.push(makeSpark());

    const homes = [];
    for (let i = 0; i < cfg.maxHomes; i++) {
      homes.push({
        active: false,
        state: 'temporary',
        age: 0,
        scale: 1,
        node: -1,
        serial: 0,
        blockedSchwann: 0,
        settledAt: -1,
        route: [],
        routeIndex: 0,
        progress: 0,
        speed: 0,
        position: { x: 0, y: 0, z: 0 }
      });
    }

    const state = {
      time: 0,
      serial: 0,
      cohortActive: false,
      nextSpawn: cfg.spawnDelay,
      lastSpawnAt: -Infinity,
      phase: 'deep',
      phaseBlend: 0,
      asleep: true,
      inStage1: false,
      inDeep: true,
      sleeps: 0,
      stateTime: 0,
      lastWakeAt: -1,
      need: 0,
      unsettled: 0,
      crystallized: 0,
      saturation: 0,
      age: 0,
      rotationTurns: 0,
      rotationDps: spinCfg.minDegreesPerSecond,
      yearsPerMinute: spinCfg.minDegreesPerSecond *
        spinCfg.yearsPerRotation / 360 * 60,
      lifeComplete: false,
      threshold: config.sleep.onsetHomes,
      calculatedRemSeconds: 0,
      deepStartedAt: 0,
      deepTargetSeconds: config.sleep.openingDeep,
      external: external,
      internals: internals,
      fireworks: fireworks,
      remNextBurst: Infinity,
      remWaves: 0,
      remCalming: false,
      homes: homes,
      saturatedSchwann: saturatedSchwann,
      schwannTotal: schwannTotal,
      stats: {
        cohorts: 0,
        housed: 0,
        externalFaded: 0,
        internalFaded: 0,
        latestSources: [],
        latestEntry: -1,
        latestHome: -1,
        collisions: 0,
        received: 0,
        accepted: 0,
        saturated: 0,
        saturationEvents: 0,
        latestBlockSize: 0,
        distressEvents: 0
      }
    };

    function saturateNextSchwann(nodeId) {
      const order = saturationWalk(nodeId);
      for (let i = saturationCursors[nodeId]; i < order.length; i++) {
        saturationCursors[nodeId] = i + 1;
        const candidate = order[i];
        if (saturatedSchwann[candidate.edge][candidate.cell]) continue;
        saturatedSchwann[candidate.edge][candidate.cell] = true;
        state.stats.saturated++;
        state.saturation = state.stats.saturated / schwannTotal;
        state.stats.latestSaturated = {
          node: nodeId,
          edge: candidate.edge,
          cell: candidate.cell
        };
        return candidate;
      }
      return null;
    }

    function blockSchwannCells(home, nodeId) {
      const requested = blockSizeForSaturation(state.saturation);
      let blocked = 0;
      for (let i = 0; i < requested; i++) {
        if (!saturateNextSchwann(nodeId)) break;
        blocked++;
      }
      home.blockedSchwann = blocked;
      state.stats.saturationEvents++;
      state.stats.latestBlockSize = blocked;
    }

    function randomRoute(start, count, previous) {
      const route = [];
      let current = start;
      let prior = previous == null ? -1 : previous;
      for (let step = 0; step < count; step++) {
        const adjacent = neurons[current].adjacent;
        if (!adjacent.length) break;
        let choices = adjacent;
        if (adjacent.length > 1 && prior >= 0) {
          choices = adjacent.filter(function (option) { return option.to !== prior; });
        }
        const option = choices[Math.floor(rng() * choices.length)];
        route.push({
          edge: option.edge,
          forward: option.forward,
          from: current,
          to: option.to
        });
        prior = current;
        current = option.to;
      }
      return route;
    }

    function shortestRoute(start, target) {
      if (start === target) return [];
      const queue = [start];
      const previous = new Int16Array(neurons.length);
      const previousEdge = new Int16Array(neurons.length);
      previous.fill(-2);
      previousEdge.fill(-1);
      previous[start] = -1;
      let read = 0;
      while (read < queue.length && previous[target] === -2) {
        const node = queue[read++];
        const adjacent = neurons[node].adjacent;
        for (let i = 0; i < adjacent.length; i++) {
          const option = adjacent[i];
          if (previous[option.to] !== -2) continue;
          previous[option.to] = node;
          previousEdge[option.to] = option.edge;
          queue.push(option.to);
          if (option.to === target) break;
        }
      }
      if (previous[target] === -2) return [];
      const nodes = [];
      let node = target;
      while (node !== start) {
        nodes.push(node);
        node = previous[node];
      }
      nodes.push(start);
      nodes.reverse();
      const route = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const from = nodes[i];
        const to = nodes[i + 1];
        const edge = edges[previousEdge[to]];
        route.push({
          edge: edge.id,
          forward: edge.a === from,
          from: from,
          to: to
        });
      }
      return route;
    }

    function setAtNode(item, nodeId) {
      const node = neurons[nodeId];
      item.position.x = node.x;
      item.position.y = node.y;
      item.position.z = node.z;
    }

    function placeOnRoute(item) {
      const segment = item.route[item.routeIndex];
      if (!segment) return;
      const t = segment.forward ? item.progress : 1 - item.progress;
      skeleton.pointOnEdge(segment.edge, t, item.position);
    }

    function advanceRoute(item, dt) {
      let remaining = dt;
      let guard = 0;
      while (remaining > 0.000001 && item.active && guard < 12) {
        const segment = item.route[item.routeIndex];
        if (!segment) {
          item.active = false;
          break;
        }
        const edge = edges[segment.edge];
        const rate = item.speed / Math.max(0.0001, edge.length);
        const untilEnd = (1 - item.progress) / rate;
        if (remaining < untilEnd) {
          item.progress += rate * remaining;
          remaining = 0;
        } else {
          remaining -= untilEnd;
          item.routeIndex++;
          item.progress = 0;
          if (item.routeIndex >= item.route.length) {
            item.active = false;
            setAtNode(item, segment.to);
            break;
          }
        }
        guard++;
      }
      if (item.active) placeOnRoute(item);
    }

    function pickCenters(count) {
      const order = anchors.map(function (_, index) { return index; });
      const limit = Math.min(count, order.length);
      for (let i = 0; i < limit; i++) {
        const j = i + Math.floor(rng() * (order.length - i));
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
      }
      const sources = [];
      for (let i = 0; i < count; i++) sources.push(order[i % order.length]);
      return sources;
    }

    function halfLifeScale(startScale) {
      return startScale * cfg.halfLife;
    }

    function unitFromCenter(x, y, z) {
      let nx = x - center.x;
      let ny = y - center.y;
      let nz = z - center.z;
      const length = Math.hypot(nx, ny, nz) || 1;
      return { x: nx / length, y: ny / length, z: nz / length };
    }

    // The far shell along a ray. The largest hit is the opposite wall, so a
    // thought leaving its own neuron does not bounce off a neighbor.
    function farWall(ox, oy, oz, dx, dy, dz) {
      const radius = cfg.external.contactRadius;
      const minT = 0.2;
      const maxT = shellRadius * 3;
      let best = 0;
      function consider(t) {
        if (t == null || t <= minT || t >= maxT || t <= best) return;
        best = t;
      }
      for (let i = 0; i < neurons.length; i++) {
        const neuron = neurons[i];
        consider(raySphereT(ox, oy, oz, dx, dy, dz, neuron.x, neuron.y, neuron.z, radius));
      }
      for (let i = 0; i < meshSegments.length; i++) {
        const segment = meshSegments[i];
        consider(rayCylinderT(
          ox, oy, oz, dx, dy, dz,
          segment.ax, segment.ay, segment.az,
          segment.bx, segment.by, segment.bz,
          radius
        ));
      }
      if (!best) return null;
      return {
        t: best,
        x: ox + dx * best,
        y: oy + dy * best,
        z: oz + dz * best
      };
    }

    function aimThrough(item) {
      const hit = farWall(
        item.position.x, item.position.y, item.position.z,
        item.direction.x, item.direction.y, item.direction.z
      );
      if (!hit) {
        item.direction.x *= -1;
        item.direction.y *= -1;
        item.direction.z *= -1;
        item.flightLeft = shellRadius;
        return;
      }
      item.flightLeft = hit.t;
    }

    function bounceInternal(item) {
      const normal = unitFromCenter(item.position.x, item.position.y, item.position.z);
      const dot = item.direction.x * normal.x +
        item.direction.y * normal.y +
        item.direction.z * normal.z;
      item.direction.x -= 2 * dot * normal.x;
      item.direction.y -= 2 * dot * normal.y;
      item.direction.z -= 2 * dot * normal.z;
      const length = Math.hypot(item.direction.x, item.direction.y, item.direction.z) || 1;
      item.direction.x /= length;
      item.direction.y /= length;
      item.direction.z /= length;
      item.position.x += item.direction.x * 0.05;
      item.position.y += item.direction.y * 0.05;
      item.position.z += item.direction.z * 0.05;
      aimThrough(item);
    }

    function advanceFlight(item, dt) {
      let remaining = item.speed * dt;
      let guard = 0;
      while (remaining > 0.000001 && item.active && guard < 6) {
        if (item.flightLeft <= 0.000001) aimThrough(item);
        const step = Math.min(remaining, Math.max(item.flightLeft, 0));
        item.position.x += item.direction.x * step;
        item.position.y += item.direction.y * step;
        item.position.z += item.direction.z * step;
        item.flightLeft -= step;
        remaining -= step;
        if (item.flightLeft <= 0.000001) bounceInternal(item);
        guard++;
      }
    }

    function fireworkDirection(origin) {
      const outward = unitFromCenter(origin.x, origin.y, origin.z);
      let rx = 0;
      let ry = 1;
      let rz = 0;
      if (Math.abs(outward.y) > 0.85) {
        rx = 1;
        ry = 0;
      }
      const dot = rx * outward.x + ry * outward.y + rz * outward.z;
      let ux = rx - outward.x * dot;
      let uy = ry - outward.y * dot;
      let uz = rz - outward.z * dot;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const vx = outward.y * uz - outward.z * uy;
      const vy = outward.z * ux - outward.x * uz;
      const vz = outward.x * uy - outward.y * ux;
      const spread = 0.25 + rng() * 0.95;
      const angle = rng() * Math.PI * 2;
      let dx = -outward.x + (ux * Math.cos(angle) + vx * Math.sin(angle)) * spread;
      let dy = -outward.y + (uy * Math.cos(angle) + vy * Math.sin(angle)) * spread;
      let dz = -outward.z + (uz * Math.cos(angle) + vz * Math.sin(angle)) * spread;
      const length = Math.hypot(dx, dy, dz) || 1;
      return { x: dx / length, y: dy / length, z: dz / length };
    }

    function igniteSpark(item, origin, ttl, direction, speedMin, speedMax) {
      const burst = direction || fireworkDirection(origin);
      const internalCfg = cfg.internal;
      const lo = speedMin == null ? internalCfg.speedMin : speedMin;
      const hi = speedMax == null ? internalCfg.speedMax : speedMax;
      item.route = [];
      item.routeIndex = 0;
      item.progress = 0;
      item.active = true;
      item.age = 0;
      item.ttl = ttl;
      item.shrinkPower = 1;
      item.startScale = 1;
      item.scale = 1;
      item.speed = lo + rng() * (hi - lo);
      item.spark = Math.floor(rng() * colorsLength());
      const tintAngle = rng() * Math.PI * 2;
      const tintDist = 0.35 + rng() * 0.65;
      item.glintX = Math.cos(tintAngle) * tintDist;
      item.glintY = Math.sin(tintAngle) * tintDist;
      item.calm = false;
      item.fadeWindow = 0;
      item.direction.x = burst.x;
      item.direction.y = burst.y;
      item.direction.z = burst.z;
      item.flightLeft = 0;
      item.bloom = 0;
      item.traveled = 0;
      const gap = direction ? 0.04 : 0.12;
      item.position.x = origin.x + burst.x * gap;
      item.position.y = origin.y + burst.y * gap;
      item.position.z = origin.z + burst.z * gap;
      if (direction) item.bloom = 0.16 + rng() * 0.34;
      else aimThrough(item);
    }

    function colorsLength() {
      return 3;
    }

    function spawnInternal(item, category, cohortSerial) {
      const internalCfg = cfg.internal;
      const ttl = internalCfg.ttlMin + rng() * (internalCfg.ttlMax - internalCfg.ttlMin);
      const origin = anchors[category];
      igniteSpark(item, origin, ttl);
      item.sourceCategory = category;
      item.targetNode = origin.id;
      item.serial = cohortSerial;
      item.stage1Sleep = state.inStage1 ? state.sleeps : -1;
    }

    function raySphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
      const lx = ox - cx;
      const ly = oy - cy;
      const lz = oz - cz;
      const b = lx * dx + ly * dy + lz * dz;
      const c = lx * lx + ly * ly + lz * lz - radius * radius;
      const disc = b * b - c;
      if (disc < 0) return null;
      const root = Math.sqrt(disc);
      const near = -b - root;
      if (near >= 0) return near;
      const far = -b + root;
      return far >= 0 ? far : null;
    }

    function rayCylinderT(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, radius) {
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const len = Math.hypot(abx, aby, abz);
      if (len < 1e-8) return null;
      const ux = abx / len;
      const uy = aby / len;
      const uz = abz / len;
      const ocx = ox - ax;
      const ocy = oy - ay;
      const ocz = oz - az;
      const dDot = dx * ux + dy * uy + dz * uz;
      const ocDot = ocx * ux + ocy * uy + ocz * uz;
      const rdx = dx - ux * dDot;
      const rdy = dy - uy * dDot;
      const rdz = dz - uz * dDot;
      const rox = ocx - ux * ocDot;
      const roy = ocy - uy * ocDot;
      const roz = ocz - uz * ocDot;
      const a = rdx * rdx + rdy * rdy + rdz * rdz;
      if (a < 1e-10) return null;
      const b = 2 * (rdx * rox + rdy * roy + rdz * roz);
      const c = rox * rox + roy * roy + roz * roz - radius * radius;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const root = Math.sqrt(disc);
      const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
      for (let i = 0; i < candidates.length; i++) {
        const t = candidates[i];
        if (t < 0) continue;
        const px = ox + dx * t;
        const py = oy + dy * t;
        const pz = oz + dz * t;
        const along = (px - ax) * ux + (py - ay) * uy + (pz - az) * uz;
        if (along >= 0 && along <= len) return t;
      }
      return null;
    }

    function rememberHit(best, t, hit) {
      if (t == null || t < 0 || t >= best.t) return;
      hit.t = t;
      best.t = t;
      best.hit = hit;
    }

    function findApproachHit(origin, direction) {
      const radius = cfg.external.contactRadius;
      const best = { t: Infinity, hit: null };
      for (let i = 0; i < neurons.length; i++) {
        const neuron = neurons[i];
        const t = raySphereT(
          origin.x, origin.y, origin.z,
          direction.x, direction.y, direction.z,
          neuron.x, neuron.y, neuron.z,
          radius
        );
        rememberHit(best, t, {
          kind: 'neuron',
          node: i,
          edge: -1,
          u: 0,
          meshX: neuron.x,
          meshY: neuron.y,
          meshZ: neuron.z
        });
      }
      for (let i = 0; i < meshPoints.length; i++) {
        const sample = meshPoints[i];
        const t = raySphereT(
          origin.x, origin.y, origin.z,
          direction.x, direction.y, direction.z,
          sample.x, sample.y, sample.z,
          radius
        );
        rememberHit(best, t, {
          kind: 'edge',
          node: -1,
          edge: sample.edge,
          u: sample.u,
          meshX: sample.x,
          meshY: sample.y,
          meshZ: sample.z
        });
      }
      for (let i = 0; i < meshSegments.length; i++) {
        const segment = meshSegments[i];
        const t = rayCylinderT(
          origin.x, origin.y, origin.z,
          direction.x, direction.y, direction.z,
          segment.ax, segment.ay, segment.az,
          segment.bx, segment.by, segment.bz,
          radius
        );
        if (t == null) continue;
        const px = origin.x + direction.x * t;
        const py = origin.y + direction.y * t;
        const pz = origin.z + direction.z * t;
        const abx = segment.bx - segment.ax;
        const aby = segment.by - segment.ay;
        const abz = segment.bz - segment.az;
        const lab2 = abx * abx + aby * aby + abz * abz || 1;
        const s = clamp(((px - segment.ax) * abx + (py - segment.ay) * aby + (pz - segment.az) * abz) / lab2, 0, 1);
        const u = segment.u0 + (segment.u1 - segment.u0) * s;
        const mesh = skeleton.pointOnEdge(segment.edge, u);
        rememberHit(best, t, {
          kind: 'edge',
          node: -1,
          edge: segment.edge,
          u: u,
          meshX: mesh.x,
          meshY: mesh.y,
          meshZ: mesh.z
        });
      }
      if (!best.hit) {
        const reach = Math.hypot(
          center.x - origin.x, center.y - origin.y, center.z - origin.z
        ) + radius;
        let nearest = Infinity;
        meshPoints.forEach(function (sample) {
          const vx = sample.x - origin.x;
          const vy = sample.y - origin.y;
          const vz = sample.z - origin.z;
          const t = vx * direction.x + vy * direction.y + vz * direction.z;
          if (t < 0 || t > reach) return;
          const distance = Math.hypot(vx - direction.x * t, vy - direction.y * t, vz - direction.z * t);
          if (distance >= nearest) return;
          nearest = distance;
          best.t = t;
          best.hit = {
            kind: 'edge',
            node: -1,
            edge: sample.edge,
            u: sample.u,
            meshX: sample.x,
            meshY: sample.y,
            meshZ: sample.z,
            t: t
          };
        });
      }
      const hit = best.hit;
      hit.rayX = origin.x + direction.x * hit.t;
      hit.rayY = origin.y + direction.y * hit.t;
      hit.rayZ = origin.z + direction.z * hit.t;
      return hit;
    }

    function routeFromHit(hit) {
      if (hit.kind === 'neuron') {
        external.route = randomRoute(hit.node, cfg.routeEdges, -1);
        external.routeIndex = 0;
        external.progress = 0;
        return hit.node;
      }
      const edge = edges[hit.edge];
      const forward = rng() < 0.5;
      const from = forward ? edge.a : edge.b;
      const to = forward ? edge.b : edge.a;
      const first = { edge: edge.id, forward: forward, from: from, to: to };
      const rest = randomRoute(to, Math.max(0, cfg.routeEdges - 1), from);
      external.route = [first].concat(rest);
      external.routeIndex = 0;
      external.progress = forward ? hit.u : 1 - hit.u;
      return from;
    }

    function acceptSensation() {
      if (!external.active || external.accepted) return;
      external.accepted = true;
      external.state = 'network';
      state.stats.accepted++;
      const entry = routeFromHit(external.hit);
      state.stats.latestEntry = entry;
      if (!external.route.length) {
        external.active = false;
        external.state = 'faded';
        state.stats.externalFaded++;
        return;
      }
      placeOnRoute(external);
      const count = external.internalCount;
      const sources = pickCenters(count);
      state.stats.latestSources = sources.slice();
      for (let i = 0; i < internals.length; i++) {
        if (i >= count) {
          internals[i].active = false;
          continue;
        }
        spawnInternal(internals[i], sources[i], external.serial);
      }
    }

    function spawnCohort() {
      const cohortSerial = ++state.serial;
      state.lastSpawnAt = state.time;
      const z = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - z * z));
      const outwardX = ring * Math.cos(theta);
      const outwardY = z;
      const outwardZ = ring * Math.sin(theta);
      const distance = shellRadius + cfg.external.approachGap;
      const band = cfg.external.sizes[Math.floor(rng() * cfg.external.sizes.length)];
      const startScale = band.scaleMin + rng() * (band.scaleMax - band.scaleMin);
      const response = internalCountForBand(band);
      external.active = true;
      external.accepted = false;
      external.state = 'approaching';
      external.age = 0;
      external.ttl = cfg.external.ttl;
      external.startScale = startScale;
      external.internalCount = response.count;
      external.distress = response.distress;
      external.scale = startScale;
      external.speed = cfg.external.speed;
      external.route = [];
      external.routeIndex = 0;
      external.progress = 0;
      external.serial = cohortSerial;
      external.flight = 0;
      external.receivedAt = -1;
      external.origin.x = center.x + outwardX * distance;
      external.origin.y = center.y + outwardY * distance;
      external.origin.z = center.z + outwardZ * distance;
      external.direction.x = -outwardX;
      external.direction.y = -outwardY;
      external.direction.z = -outwardZ;
      external.hit = findApproachHit(external.origin, external.direction);
      external.hitT = external.hit.t;
      external.position.x = external.origin.x;
      external.position.y = external.origin.y;
      external.position.z = external.origin.z;
      state.cohortActive = true;
      state.stats.cohorts++;
      state.stats.latestEntry = -1;
      state.stats.latestSources = [];
    }

    function fadeScale(age, ttl, start, power) {
      return start * Math.pow(Math.max(0, 1 - age / ttl), power);
    }

    function stepExternal(dt) {
      if (!external.active) return;
      external.age += dt;
      external.scale = fadeScale(
        external.age,
        external.ttl,
        external.startScale,
        cfg.external.shrinkPower
      );
      if (external.scale < halfLifeScale(external.startScale) || external.age >= external.ttl) {
        external.active = false;
        external.state = 'faded';
        state.stats.externalFaded++;
        return;
      }
      if (external.state === 'approaching') {
        external.flight += cfg.external.approachSpeed * dt;
        const t = Math.min(external.flight, external.hitT);
        external.position.x = external.origin.x + external.direction.x * t;
        external.position.y = external.origin.y + external.direction.y * t;
        external.position.z = external.origin.z + external.direction.z * t;
        if (external.flight + 1e-8 < external.hitT) return;
        external.state = 'received';
        external.receivedAt = state.time;
        state.stats.received++;
      }
      if (external.state === 'received') {
        const hold = cfg.external.receiveHold;
        const u = hold <= 0 ? 1 : clamp((state.time - external.receivedAt) / hold, 0, 1);
        const ease = u * u * (3 - 2 * u);
        const hit = external.hit;
        external.position.x = hit.rayX + (hit.meshX - hit.rayX) * ease;
        external.position.y = hit.rayY + (hit.meshY - hit.rayY) * ease;
        external.position.z = hit.rayZ + (hit.meshZ - hit.rayZ) * ease;
        if (u < 1) return;
        acceptSensation();
        return;
      }
      advanceRoute(external, dt);
      if (!external.active) {
        external.state = 'faded';
        state.stats.externalFaded++;
      }
    }

    function stepInternals(dt) {
      for (let i = 0; i < internals.length; i++) {
        const item = internals[i];
        if (!item.active) continue;
        item.age += dt;
        item.scale = item.startScale;
        if (item.age >= item.ttl) {
          item.active = false;
          state.stats.internalFaded++;
          continue;
        }
        advanceFlight(item, dt);
        if (!item.active) state.stats.internalFaded++;
      }
    }

    function stepFireworks(dt) {
      for (let i = 0; i < fireworks.length; i++) {
        const item = fireworks[i];
        if (!item.active) continue;
        item.age += dt;
        item.scale = 1;
        if (item.age >= item.ttl) {
          item.active = false;
          continue;
        }
        advanceFlight(item, dt);
      }
    }

    function activeFireworks() {
      let count = 0;
      for (let i = 0; i < fireworks.length; i++) {
        if (fireworks[i].active) count++;
      }
      return count;
    }

    function burstFromHome(origin) {
      const internalCfg = cfg.internal;
      let launched = 0;
      for (let i = 0; i < fireworks.length && launched < internalCfg.remBurst; i++) {
        if (fireworks[i].active) continue;
        const ttl = internalCfg.ttlMin +
          rng() * (internalCfg.ttlMax - internalCfg.ttlMin);
        igniteSpark(fireworks[i], origin, ttl);
        launched++;
      }
      return launched;
    }

    function nearestNeuron(point) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < neurons.length; i++) {
        const dx = neurons[i].x - point.x;
        const dy = neurons[i].y - point.y;
        const dz = neurons[i].z - point.z;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      return best;
    }

    function houseAt(nodeId) {
      let home = null;
      let oldest = null;
      for (let i = 0; i < homes.length; i++) {
        if (!homes[i].active) {
          home = homes[i];
          break;
        }
        if (!oldest || homes[i].serial < oldest.serial) oldest = homes[i];
      }
      if (!home) home = oldest;
      const node = neurons[nodeId];
      home.active = true;
      home.state = 'temporary';
      home.age = 0;
      home.scale = 1;
      home.node = nodeId;
      home.blockedSchwann = 0;
      home.settledAt = -1;
      home.route = [];
      home.routeIndex = 0;
      home.progress = 0;
      home.serial = state.stats.housed + 1;
      home.position.x = node.x;
      home.position.y = node.y;
      home.position.z = node.z;
      state.stats.housed++;
      state.stats.latestHome = nodeId;
    }

    function resolveCollision() {
      if (!external.active || external.state !== 'network') return;
      const externalRadius = cfg.external.radius * external.scale;
      for (let i = 0; i < internals.length; i++) {
        const item = internals[i];
        if (!item.active || item.serial !== external.serial) continue;
        if (item.age < cfg.internal.arming) continue;
        const internalRadius = cfg.internal.radius * item.scale;
        const limit = (externalRadius + internalRadius) * cfg.collisionScale;
        const dx = external.position.x - item.position.x;
        const dy = external.position.y - item.position.y;
        const dz = external.position.z - item.position.z;
        if (dx * dx + dy * dy + dz * dz > limit * limit) continue;
        positionScratch.x = (external.position.x + item.position.x) * 0.5;
        positionScratch.y = (external.position.y + item.position.y) * 0.5;
        positionScratch.z = (external.position.z + item.position.z) * 0.5;
        houseAt(nearestNeuron(positionScratch));
        external.active = false;
        external.state = 'housed';
        item.active = false;
        state.stats.collisions++;
        return;
      }
    }

    function ease(u) {
      const t = clamp(u, 0, 1);
      return t * t * (3 - 2 * t);
    }

    function settleHome(home, nodeId) {
      if (home.state === 'settled') return;
      home.state = 'settled';
      home.node = nodeId;
      home.settledAt = state.time;
      home.route = [];
      setAtNode(home, nodeId);
      blockSchwannCells(home, nodeId);
    }

    function stepMigration(home, dt) {
      let remaining = dt;
      let guard = 0;
      while (remaining > 0.000001 && home.state === 'migrating' && guard < 12) {
        const segment = home.route[home.routeIndex];
        if (!segment) {
          settleHome(home, home.node);
          return;
        }
        const rate = home.speed / Math.max(0.0001, edges[segment.edge].length);
        const untilEnd = (1 - home.progress) / rate;
        if (remaining < untilEnd) {
          home.progress += rate * remaining;
          remaining = 0;
          const t = segment.forward ? home.progress : 1 - home.progress;
          skeleton.pointOnEdge(segment.edge, t, home.position);
        } else {
          remaining -= untilEnd;
          home.node = segment.to;
          home.routeIndex++;
          home.progress = 0;
          if (home.routeIndex >= home.route.length) settleHome(home, segment.to);
        }
        guard++;
      }
    }

    function stepHomes(dt) {
      for (let i = 0; i < homes.length; i++) {
        const home = homes[i];
        if (!home.active) continue;
        home.age += dt;
        if (home.state === 'migrating') stepMigration(home, dt);
        if (home.state === 'settled') {
          const u = (state.time - home.settledAt) / cfg.temporary.growDuration;
          home.scale = cfg.temporary.scale - (cfg.temporary.scale - 1) * ease(u);
        } else {
          const u = home.age / cfg.temporary.growDuration;
          home.scale = 1 + (cfg.temporary.scale - 1) * ease(u);
        }
      }
    }

    function activeInternals() {
      let active = 0;
      for (let i = 0; i < internals.length; i++) {
        if (internals[i].active) active++;
      }
      return active;
    }

    function activeHomes() {
      let active = 0;
      for (let i = 0; i < homes.length; i++) {
        if (homes[i].active) active++;
      }
      return active;
    }

    function updateLifeClock(dt) {
      const fill = saturationFill();
      const dps = spinCfg.minDegreesPerSecond +
        (spinCfg.maxDegreesPerSecond - spinCfg.minDegreesPerSecond) *
          Math.pow(fill, spinCfg.accelerationPower);
      state.rotationDps = state.lifeComplete ? 0 : dps;
      state.yearsPerMinute = state.rotationDps *
        spinCfg.yearsPerRotation / 360 * 60;
      if (state.lifeComplete) return;
      state.age = Math.min(
        spinCfg.maxAge,
        state.age + state.rotationDps * dt *
          spinCfg.yearsPerRotation / 360
      );
      state.rotationTurns = state.age / spinCfg.yearsPerRotation;
      if (state.age >= spinCfg.maxAge) {
        state.lifeComplete = true;
        state.rotationDps = 0;
        state.yearsPerMinute = 0;
      }
    }

    const sleep = config.sleep;
    const firstAnchor = sleep.anchors[0];

    function unsettledHours(count) {
      const anchors = sleep.anchors;
      if (count <= anchors[0].u) return anchors[0].hours;
      const last = anchors[anchors.length - 1];
      if (count >= last.u) return last.hours;
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1];
        const b = anchors[i];
        if (count > b.u) continue;
        const t = (Math.log(count) - Math.log(a.u)) / (Math.log(b.u) - Math.log(a.u));
        return Math.exp(Math.log(a.hours) + (Math.log(b.hours) - Math.log(a.hours)) * t);
      }
      return last.hours;
    }

    function sleepHours(unsettled, crystallized) {
      const base = unsettledHours(unsettled);
      const onsetCrystallized = config.categories.count * unsettled / firstAnchor.u;
      if (!(crystallized > onsetCrystallized) || !(crystallized > 0)) return base;
      return base * clamp(
        (config.categories.count * unsettled) / (firstAnchor.u * crystallized),
        0.5,
        1
      );
    }

    function countHomes(predicate) {
      let count = 0;
      for (let i = 0; i < homes.length; i++) {
        if (homes[i].active && predicate(homes[i])) count++;
      }
      return count;
    }

    function refreshSleepCounts() {
      state.crystallized = countHomes(function (home) { return home.state === 'settled'; });
      state.unsettled = countHomes(function (home) {
        return home.state === 'temporary' || home.state === 'migrating';
      });
      state.threshold = sleep.onsetHomes;
      state.need = state.threshold > 0 ? clamp(state.unsettled / state.threshold, 0, 1) : 0;
    }

    function setPhase(name, blend) {
      state.phase = name;
      state.phaseBlend = clamp(blend, 0, 1);
    }

    function assignAwakePhase() {
      if (state.lastWakeAt >= 0 && state.stateTime < sleep.wakeBlend && state.need < sleep.needPhase) {
        setPhase('waking', state.stateTime / sleep.wakeBlend);
        return;
      }
      if (state.need >= sleep.needPhase) setPhase('sleep-needed', state.need);
      else setPhase('awake', 0);
    }

    function stage1Remaining() {
      let count = 0;
      const travelers = [external].concat(internals);
      for (let i = 0; i < travelers.length; i++) {
        if (travelers[i].stage1Sleep === state.sleeps && travelers[i].active) count++;
      }
      return count;
    }

    function burstAllCenters() {
      for (let i = 0; i < anchors.length; i++) burstFromHome(anchors[i]);
      state.remWaves++;
    }

    function releaseRemHomes() {
      for (let i = 0; i < homes.length; i++) {
        const home = homes[i];
        if (!home.active || home.state !== 'temporary') continue;
        const start = Math.floor(rng() * anchors.length);
        let route = [];
        let target = anchors[start];
        for (let n = 0; n < anchors.length; n++) {
          target = anchors[(start + n) % anchors.length];
          route = shortestRoute(home.node, target.id);
          if (route.length) break;
        }
        home.route = route;
        home.routeIndex = 0;
        home.progress = 0;
        home.speed = sleep.migrationSpeed;
        if (!route.length) settleHome(home, target.id);
        else home.state = 'migrating';
      }
    }

    function calmFireworks() {
      if (state.remCalming) return;
      state.remCalming = true;
      const fade = cfg.internal.remFade;
      for (let i = 0; i < fireworks.length; i++) {
        const item = fireworks[i];
        if (!item.active) continue;
        item.calm = true;
        item.fadeWindow = fade;
        item.ttl = item.age + fade;
      }
    }

    function beginRem() {
      state.inStage1 = false;
      state.remStartedAt = state.time;
      state.remNextBurst = state.time;
      state.remWaves = 0;
      state.remCalming = false;
      releaseRemHomes();
    }

    function fallAsleep() {
      refreshSleepCounts();
      const hours = sleepHours(state.unsettled, state.crystallized);
      const seconds = hours * sleep.secondsPerHour;
      state.asleep = true;
      state.inStage1 = true;
      state.inDeep = false;
      state.sleeps++;
      state.stateTime = 0;
      state.stage1StartedAt = state.time;
      state.calculatedRemSeconds = seconds / 2;
      state.deepTargetSeconds = seconds / 2;
      state.sleepHours = hours;
      const travelers = [external].concat(internals);
      for (let i = 0; i < travelers.length; i++) {
        travelers[i].stage1Sleep = travelers[i].active ? state.sleeps : -1;
      }
      setPhase('stage1', 1);
    }

    function wakeFromDeep() {
      state.asleep = false;
      state.inDeep = false;
      state.stateTime = 0;
      state.lastWakeAt = state.time;
      state.nextSpawn = state.time + cfg.spawnDelay;
      setPhase('waking', 0);
    }

    function updateSleep(dt) {
      state.stateTime += dt;
      refreshSleepCounts();
      if (!state.asleep) {
        if (state.unsettled >= state.threshold) {
          fallAsleep();
          return;
        }
        assignAwakePhase();
        return;
      }
      if (state.inStage1) {
        const elapsed = state.time - state.stage1StartedAt;
        if (stage1Remaining() > 0 || elapsed <= 0) {
          setPhase('stage1', 1);
          return;
        }
        beginRem();
      }
      if (state.inDeep) {
        const elapsed = state.time - state.deepStartedAt;
        setPhase('deep', clamp(elapsed / Math.max(state.deepTargetSeconds, dt), 0, 1));
        if (elapsed + 1e-8 >= state.deepTargetSeconds) wakeFromDeep();
        return;
      }
      const elapsed = state.time - state.remStartedAt;
      const remOpen = countHomes(function (home) {
        return home.state === 'temporary' || home.state === 'migrating';
      });
      if (remOpen > 0 && state.time + 1e-8 >= state.remNextBurst) {
        burstAllCenters();
        state.remNextBurst = state.time + cfg.internal.remWaveInterval;
      } else if (remOpen === 0) calmFireworks();
      if (
        elapsed + 1e-8 < state.calculatedRemSeconds ||
        remOpen > 0 ||
        activeFireworks() > 0
      ) {
        setPhase('rem', remOpen > 0 ? 0.45 : 1);
        return;
      }
      state.inDeep = true;
      state.deepStartedAt = state.time;
      state.deepTargetSeconds = state.calculatedRemSeconds;
      setPhase('deep', 0);
    }

    function step(dt) {
      state.time += dt;
      if (
        !state.lifeComplete &&
        !state.asleep &&
        !state.cohortActive &&
        state.time >= state.nextSpawn
      ) spawnCohort();
      stepExternal(dt);
      stepInternals(dt);
      stepFireworks(dt);
      resolveCollision();
      stepHomes(dt);
      if (state.cohortActive && !external.active && activeInternals() === 0) {
        state.cohortActive = false;
        if (!state.asleep) {
          state.nextSpawn = Math.max(state.time, state.lastSpawnAt + cfg.spawnInterval);
        }
      }
      updateSleep(dt);
      updateLifeClock(dt);
    }

    state.step = step;
    state.activeInternals = activeInternals;
    state.activeHomes = activeHomes;
    return state;
  };
})(typeof window !== 'undefined' ? window : globalThis);

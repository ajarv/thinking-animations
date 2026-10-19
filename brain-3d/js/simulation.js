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

    const external = {
      active: false,
      state: 'idle',
      age: 0,
      ttl: cfg.external.ttl,
      scale: 0,
      speed: cfg.external.speed,
      route: [],
      routeIndex: 0,
      progress: 0,
      position: { x: 0, y: 0, z: 0 },
      entryFrom: { x: 0, y: 0, z: 0 },
      entryTo: { x: 0, y: 0, z: 0 },
      serial: 0
    };

    const internals = [];
    for (let i = 0; i < cfg.internalCount; i++) {
      internals.push({
        active: false,
        age: 0,
        ttl: cfg.internal.ttl,
        scale: 0,
        speed: cfg.internal.speedMin,
        route: [],
        routeIndex: 0,
        progress: 0,
        position: { x: 0, y: 0, z: 0 },
        sourceCategory: -1,
        targetNode: -1,
        serial: 0
      });
    }

    const homes = [];
    for (let i = 0; i < cfg.maxHomes; i++) {
      homes.push({
        active: false,
        age: 0,
        scale: 1,
        node: -1,
        serial: 0,
        position: { x: 0, y: 0, z: 0 }
      });
    }

    const state = {
      time: 0,
      serial: 0,
      cohortActive: false,
      nextSpawn: cfg.spawnDelay,
      external: external,
      internals: internals,
      homes: homes,
      stats: {
        cohorts: 0,
        housed: 0,
        externalFaded: 0,
        internalFaded: 0,
        latestSources: [],
        latestEntry: -1,
        latestHome: -1,
        collisions: 0
      }
    };

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

    function pickCenters() {
      const order = anchors.map(function (_, index) { return index; });
      for (let i = 0; i < cfg.internalCount; i++) {
        const j = i + Math.floor(rng() * (order.length - i));
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
      }
      return order.slice(0, cfg.internalCount);
    }

    function spawnInternal(item, category, targetStep, cohortSerial) {
      const anchor = anchors[category];
      const targetSegment = external.route[Math.min(targetStep, external.route.length - 1)];
      const targetNode = targetSegment.to;
      const route = shortestRoute(anchor.id, targetNode);
      const externalDistance = routeLength(external.route, edges, targetStep);
      const arrival = cfg.external.entryDuration + externalDistance / cfg.external.speed;
      const internalDistance = routeLength(route, edges);
      const variation = 0.92 + rng() * 0.16;
      const desiredSpeed = internalDistance / Math.max(0.5, arrival) * variation;
      const continuation = randomRoute(targetNode, 18, route.length ? route[route.length - 1].from : -1);

      item.route = route.concat(continuation);
      item.routeIndex = 0;
      item.progress = 0;
      item.active = item.route.length > 0;
      item.age = 0;
      item.ttl = cfg.internal.ttl;
      item.scale = 1;
      item.speed = clamp(desiredSpeed, cfg.internal.speedMin, cfg.internal.speedMax);
      item.sourceCategory = category;
      item.targetNode = targetNode;
      item.serial = cohortSerial;
      setAtNode(item, anchor.id);
      if (item.active) placeOnRoute(item);
    }

    function spawnCohort() {
      const cohortSerial = ++state.serial;
      const entry = Math.floor(rng() * neurons.length);
      const node = neurons[entry];
      external.active = true;
      external.state = 'entry';
      external.age = 0;
      external.ttl = cfg.external.ttl;
      external.scale = cfg.external.entryScale;
      external.speed = cfg.external.speed;
      external.route = randomRoute(entry, cfg.routeEdges, -1);
      external.routeIndex = 0;
      external.progress = 0;
      external.serial = cohortSerial;
      external.entryTo.x = node.x;
      external.entryTo.y = node.y;
      external.entryTo.z = node.z;
      external.entryFrom.x = node.x * cfg.external.entryDistance;
      external.entryFrom.y = node.y * cfg.external.entryDistance;
      external.entryFrom.z = node.z * cfg.external.entryDistance;
      external.position.x = external.entryFrom.x;
      external.position.y = external.entryFrom.y;
      external.position.z = external.entryFrom.z;

      const sources = pickCenters();
      state.stats.latestSources = sources.slice();
      const routeLast = Math.max(1, external.route.length - 1);
      for (let i = 0; i < internals.length; i++) {
        const target = Math.min(routeLast, 4 + i * 4 + Math.floor(rng() * 3));
        spawnInternal(internals[i], sources[i], target, cohortSerial);
      }

      state.cohortActive = true;
      state.stats.cohorts++;
      state.stats.latestEntry = entry;
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
        cfg.external.entryScale,
        cfg.external.shrinkPower
      );
      if (external.age >= external.ttl) {
        external.active = false;
        external.state = 'faded';
        state.stats.externalFaded++;
        return;
      }
      if (external.state === 'entry') {
        const u = Math.min(1, external.age / cfg.external.entryDuration);
        const ease = u * u * (3 - 2 * u);
        external.position.x = external.entryFrom.x +
          (external.entryTo.x - external.entryFrom.x) * ease;
        external.position.y = external.entryFrom.y +
          (external.entryTo.y - external.entryFrom.y) * ease;
        external.position.z = external.entryFrom.z +
          (external.entryTo.z - external.entryFrom.z) * ease;
        if (u >= 1) {
          external.state = 'network';
          if (external.route.length) placeOnRoute(external);
          else external.active = false;
        }
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
        item.scale = fadeScale(item.age, item.ttl, 1, cfg.internal.shrinkPower);
        if (item.age >= item.ttl) {
          item.active = false;
          state.stats.internalFaded++;
          continue;
        }
        advanceRoute(item, dt);
        if (!item.active) state.stats.internalFaded++;
      }
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
      home.age = 0;
      home.scale = 1;
      home.node = nodeId;
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

    function stepHomes(dt) {
      for (let i = 0; i < homes.length; i++) {
        const home = homes[i];
        if (!home.active) continue;
        home.age += dt;
        const u = Math.min(1, home.age / cfg.temporary.growDuration);
        const ease = u * u * (3 - 2 * u);
        home.scale = 1 + (cfg.temporary.scale - 1) * ease;
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

    function step(dt) {
      state.time += dt;
      if (!state.cohortActive && state.time >= state.nextSpawn) spawnCohort();
      stepExternal(dt);
      stepInternals(dt);
      resolveCollision();
      stepHomes(dt);
      if (state.cohortActive && !external.active && activeInternals() === 0) {
        state.cohortActive = false;
        state.nextSpawn = state.time + cfg.spawnDelay;
      }
    }

    state.step = step;
    state.activeInternals = activeInternals;
    state.activeHomes = activeHomes;
    return state;
  };
})(typeof window !== 'undefined' ? window : globalThis);

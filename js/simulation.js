(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const STEP = 1 / 60;

  PL.createSimulation = function (network, config) {
    const U = PL.util;
    const clamp = U.clamp;
    const lerp = U.lerp;
    const hash = U.hash;
    const smoothstep = U.smoothstep;

    const COLS = network.cols;
    const ROWS = network.rows;
    const neurons = network.neurons;
    const edges = network.edges;
    const anchors = network.anchors;
    const LIFE = config.life;
    const KINDS = config.kinds;
    const LEARN = config.learning;
    const SLEEP = config.sleep;
    const CATEGORY_COUNT = anchors.length;
    const BAND_SIZE = config.categories.cols;
    const CATEGORY_WEIGHTS = config.categories.weights.slice();
    const WEIGHT_SUM = CATEGORY_WEIGHTS.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    const domains = [];
    const settledCount = new Array(CATEGORY_COUNT);
    for (let i = 0; i < CATEGORY_COUNT; i++) {
      domains.push({ neurons: [], radius: 1 });
      settledCount[i] = 0;
    }

    function pool(size, make) {
      const list = [];
      for (let i = 0; i < size; i++) list.push(make(i));
      return list;
    }

    const thoughts = pool(config.pools.thoughts, function (id) {
      return {
        id: id,
        active: false,
        kind: 'ordinary',
        edge: null,
        forward: true,
        progress: 0,
        speed: 0,
        routeStep: 0,
        bornAt: 0,
        age: 0,
        ttl: 1,
        inwardCol: 0,
        inwardRow: 0,
        housingRoll: 0,
        rejected: false,
        x: 0,
        y: 0
      };
    });

    const counters = pool(config.pools.counters, function (id) {
      return {
        id: id, active: false, x: 0, y: 0, vx: 0, vy: 0,
        age: 0, ttl: 1, sourceId: -1, initialScale: 1
      };
    });

    // A crystal is an external thought that found a temporary home. It turns
    // orange and doubles in size ("temporary"); during sleep it detaches and
    // travels at three times its daytime speed ("wandering"), and turns light
    // green once "settled" in one of the 21 permanent home clusters.
    const crystals = pool(config.pools.crystals, function (id) {
      return {
        id: id,
        active: false,
        state: 'temporary',
        kind: 'ordinary',
        bornAt: 0,
        settledAt: 0,
        site: null,
        category: -1,
        slot: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        travel: 0,
        carried: 0,
        judged: false,
        kept: true,
        tossAge: 0,
        tossTtl: 1,
        daySpeed: 1,
        nextInternal: Infinity,
        internalEvery: 0,
        angleA: 0,
        distA: 0,
        angleB: 0,
        distB: 0
      };
    });

    // A small fixed pool so frequent homing does not allocate a new wave
    // object on every crystallization.
    const waves = pool(config.waves.pool, function (id) {
      return {
        id: id,
        active: false,
        type: 'reward',
        kind: 'attraction',
        x: 0,
        y: 0,
        age: 0,
        ttl: 1,
        bornAt: 0
      };
    });

    function byKind() {
      return { danger: 0, attraction: 0, ordinary: 0 };
    }

    const s = {};
    let centers = [];
    let asleep = false;
    const STAGES = config.stages;
    const LUST = config.lust;
    const BASE_THRESHOLD = SLEEP.needThreshold * config.pools.crystals;

    // ---------- Life stage ----------

    // Linear in age between the stage anchors, clamped outside them.
    function stageAt(age) {
      if (age <= STAGES[0].age) return stageBlend(STAGES[0], STAGES[0], 0);
      for (let i = 1; i < STAGES.length; i++) {
        const b = STAGES[i];
        if (age <= b.age) {
          const a = STAGES[i - 1];
          return stageBlend(a, b, (age - a.age) / (b.age - a.age));
        }
      }
      const last = STAGES[STAGES.length - 1];
      return stageBlend(last, last, 0);
    }

    function stageBlend(a, b, t) {
      const sleep = lerp(a.sleep, b.sleep, t);
      const awake = lerp(a.awake, b.awake, t);
      return {
        name: t < 0.5 ? a.name : b.name,
        ratio: sleep / awake,
        sleep: sleep,
        awake: awake,
        acceptance: lerp(a.acceptance, b.acceptance, t),
        keep: lerp(a.keep, b.keep, t),
        threshold: lerp(a.threshold, b.threshold, t)
      };
    }

    function sleepThreshold() {
      return Math.max(1, Math.round(BASE_THRESHOLD * stageAt(s.age).threshold));
    }

    // ---------- Lust for learning ----------

    function lustNatural() {
      return clamp(100 * (1 - s.peakSaturation / LIFE.saturationLimit), 0, 100);
    }

    function housingChance() {
      return clamp(s.lust / 100, 0, 1);
    }

    function stepLust(dt) {
      if (s.lustHeld) return;
      const k = 1 - Math.exp(-dt / LUST.tau);
      s.lust += (lustNatural() - s.lust) * k;
    }

    function lustForced() {
      return s.lustHeld || Math.abs(s.lust - lustNatural()) > LUST.forcedBand;
    }

    // ---------- Knowledge ----------

    // Large at entry, about 1× at midlife, near fadeScale at expiry.
    // Rejected thoughts collapse across their short lifetime instead.
    function thoughtScale(age, ttl, rejected) {
      const entry = config.entryScale;
      const u = ttl > 0 ? age / ttl : 1;
      const t = u < 0 ? 0 : u > 1 ? 1 : u;
      if (rejected) return entry * (1 - t);
      return config.fadeScale + (entry - config.fadeScale) * Math.pow(1 - t, config.shrinkPower);
    }

    // Dimensionless bead size, before the renderer's pixel scale. External
    // thoughts use kind size times their shrinking travel scale. An orange
    // temporary or wandering home is exactly 2× its kind. An internal thought
    // stores that number at birth and shrinks it to zero over its own life.
    function thoughtVisualSize(p) {
      return KINDS[p.kind].size * thoughtScale(p.age, p.ttl, p.rejected);
    }

    function crystalVisualSize(c) {
      const factor = (c.state === 'temporary' || c.state === 'wandering')
        ? config.crystalScale
        : 1;
      return KINDS[c.kind].size * factor;
    }

    function counterVisualSize(c) {
      const u = c.ttl > 0 ? c.age / c.ttl : 1;
      const t = u < 0 ? 0 : u > 1 ? 1 : u;
      return c.initialScale * Math.pow(1 - t, config.internal.shrinkPower);
    }

    let knowledgeDirty = true;

    function touchKnowledge() {
      knowledgeDirty = true;
    }

    function seedRadius(edge) {
      return edge.seedAt < 0 ? 0 : 0.015 + 0.985 * Math.pow(edge.strength, 0.75);
    }

    function seedInterval(edge) {
      const radius = seedRadius(edge);
      return {
        start: clamp(edge.seedAt - radius, 0, 1),
        end: clamp(edge.seedAt + radius, 0, 1)
      };
    }

    function centerStrength(neuron) {
      const adjacent = neuron.adjacent;
      if (!adjacent.length) return 0;
      let strongest = 0;
      let sum = 0;
      for (let i = 0; i < adjacent.length; i++) {
        strongest = Math.max(strongest, adjacent[i].strength);
        sum += adjacent[i].strength;
      }
      return clamp(strongest * 0.72 + sum / adjacent.length * 0.28, 0, 1);
    }

    function lifeProgress() {
      return clamp(s.peakSaturation / LIFE.saturationLimit, 0, 1);
    }

    function filterStrength() {
      return smoothstep(0.04, 0.96, lifeProgress());
    }

    function riskAffinity() {
      return 1 - smoothstep(0, 1, lifeProgress());
    }

    // Age 0–100 maps to 0–90 degrees: growth is fast in youth and slows with
    // age. Since age itself comes from saturation, a pure cosine would only
    // approach the 80% limit asymptotically, so a small floor lets life end.
    function growthFactor() {
      if (s.finishedAt >= 0) return 0;
      return Math.max(LIFE.growthFloor, Math.cos(s.age * 0.9 * Math.PI / 180) - 0.0001);
    }

    function localFamiliarity(neuron) {
      const adjacent = neuron.adjacent;
      if (!adjacent.length) return 0;
      let sum = 0;
      adjacent.forEach(function (edge) {
        sum += edge.strength;
      });
      return clamp(neuron.strength * 0.7 + sum / adjacent.length * 0.3, 0, 1);
    }

    // Age follows the highest saturation reached, so consolidation during
    // sleep never makes the brain younger.
    function refreshKnowledge() {
      if (!knowledgeDirty) return;
      knowledgeDirty = false;
      let covered = 0;
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (edge.seedAt < 0) continue;
        const interval = seedInterval(edge);
        covered += (interval.end - interval.start) * edge.length;
      }
      s.saturation = covered / network.totalLength;
      s.peakSaturation = Math.max(s.peakSaturation, s.saturation);
      s.age = LIFE.maxAge * lifeProgress();
      if (s.peakSaturation >= LIFE.saturationLimit - LIFE.epsilon) {
        s.age = LIFE.maxAge;
        if (s.finishedAt < 0) s.finishedAt = s.time;
      }

      centers = [];
      for (let i = 0; i < neurons.length; i++) {
        const neuron = neurons[i];
        neuron.strength = neuron.domain >= 0 ? centerStrength(neuron) : 0;
        if (neuron.strength >= config.centerMin) centers.push(neuron);
      }
    }

    // Any neuron can temporarily house a thought. Thickness only biases
    // which neurons answer an arrival with an internal thought.
    function hostCenters() {
      return neurons;
    }

    // The thickness a daytime home will later move onto its permanent cluster.
    function depositFor(kind) {
      const weight = kind === 'ordinary' ? LEARN.ordinaryWeight : 1;
      return SLEEP.deposit * weight * growthFactor();
    }

    // ---------- External thoughts ----------

    function departures(node) {
      const options = [];
      node.outgoing.forEach(function (edge) {
        options.push({ edge: edge, forward: true, dest: edge.to });
      });
      node.incoming.forEach(function (edge) {
        options.push({ edge: edge, forward: false, dest: edge.from });
      });
      return options;
    }

    function movesInward(p, from, dest) {
      const dc = dest.col - from.col;
      const dr = dest.row - from.row;
      if (p.inwardCol > 0 && dc < 0) return false;
      if (p.inwardCol < 0 && dc > 0) return false;
      if (p.inwardRow > 0 && dr < 0) return false;
      if (p.inwardRow < 0 && dr > 0) return false;
      if (p.inwardCol !== 0 && (dc === p.inwardCol || dc === 0)) return true;
      if (p.inwardRow !== 0 && (dr === p.inwardRow || dr === 0)) return true;
      return false;
    }

    function reachedFarSide(p, node) {
      if (p.inwardCol > 0 && node.col >= COLS - 1) return true;
      if (p.inwardCol < 0 && node.col <= 0) return true;
      if (p.inwardRow > 0 && node.row >= ROWS - 1) return true;
      if (p.inwardRow < 0 && node.row <= 0) return true;
      return false;
    }

    // Young brains explore and favor novelty; older brains route important
    // thoughts toward what they already know.
    function pickEdge(node, p) {
      if (!node) return null;
      const options = departures(node).filter(function (option) {
        return movesInward(p, node, option.dest);
      });
      if (!options.length) return null;

      const kind = KINDS[p.kind];
      const filters = filterStrength();
      const risk = riskAffinity();
      const exploreChance = lerp(0.08, 0.78, risk) * lerp(1, 0.62, kind.home * filters);
      const decision = hash(p.id * 13.7 + p.routeStep * 2.31, s.serial * 0.17 + node.id);
      if (decision < exploreChance) {
        const pick = hash(p.id * 3.71 + node.id, p.routeStep * 5.13 + s.serial);
        return options[Math.floor(pick * options.length)];
      }

      const home = kind.home * lerp(0.12, 1, filters);
      let total = 0;
      const weights = options.map(function (option) {
        const dc = option.dest.col - node.col;
        const dr = option.dest.row - node.row;
        const inwardStep = (p.inwardCol !== 0 && dc === p.inwardCol) ||
          (p.inwardRow !== 0 && dr === p.inwardRow);
        const knowledge = option.edge.strength * 0.62 + option.dest.strength * 0.38;
        const weight = (inwardStep ? 1.6 : 0.28) +
          home * 24 * knowledge * knowledge +
          risk * 1.8 * (1 - knowledge);
        total += weight;
        return weight;
      });
      let choice = hash(p.id * 8.17 + p.routeStep, node.id * 0.91 + s.serial * 0.37) * total;
      for (let i = 0; i < options.length; i++) {
        choice -= weights[i];
        if (choice <= 0) return options[i];
      }
      return options[options.length - 1];
    }

    function geometryT(p, travel) {
      return p.forward ? travel : 1 - travel;
    }

    function placeThought(p) {
      const point = network.pointOnEdge(p.edge, geometryT(p, p.progress));
      p.x = point.x;
      p.y = point.y;
    }

    function enterEdge(p, option) {
      const edge = option.edge;
      p.edge = edge;
      p.forward = option.forward;
      p.progress = 0;
      edge.traversals++;
    }

    function takeFree(list) {
      for (let i = 0; i < list.length; i++) {
        if (!list[i].active) return list[i];
      }
      return null;
    }

    function chooseKind(serial) {
      const roll = hash(serial, 4.2);
      if (roll < config.kindOdds.danger) return 'danger';
      if (roll < config.kindOdds.danger + config.kindOdds.attraction) return 'attraction';
      return 'ordinary';
    }

    function hideThought(p) {
      p.active = false;
      p.edge = null;
    }

    function completeJourney(p) {
      s.completedJourneys++;
      s.journeyTime += s.time - p.bornAt;
    }

    function spawnThought() {
      const p = takeFree(thoughts);
      if (!p) return;

      const serial = s.serial++;
      const side = Math.floor(hash(serial, 1.3) * 4);
      const slot = Math.floor(hash(serial, 2.7) * (side < 2 ? ROWS : COLS));
      let start;
      p.inwardCol = 0;
      p.inwardRow = 0;
      if (side === 0) {
        start = network.nodeAt(0, slot);
        p.inwardCol = 1;
      } else if (side === 1) {
        start = network.nodeAt(COLS - 1, slot);
        p.inwardCol = -1;
      } else if (side === 2) {
        start = network.nodeAt(slot, 0);
        p.inwardRow = 1;
      } else {
        start = network.nodeAt(slot, ROWS - 1);
        p.inwardRow = -1;
      }

      const kind = chooseKind(serial);
      const spec = KINDS[kind];
      p.kind = kind;
      p.routeStep = 0;
      p.age = 0;
      p.rejected = false;
      p.bornAt = s.time;
      p.ttl = lerp(spec.ttlMin, spec.ttlMax, hash(serial, 6.6)) * lerp(0.75, 1, riskAffinity());
      p.speed = lerp(130, 205, hash(serial, 9.1)) / 72 * spec.speed;
      s.born[kind]++;

      // Older brains recognize familiar danger/attraction and filter it at the
      // border; the recognition still reinforces the matching knowledge.
      p.housingRoll = hash(serial, 21.7);
      if (kind !== 'ordinary') {
        const rejectChance = filterStrength() *
          lerp(LEARN.rejectMin, LEARN.rejectMax, localFamiliarity(start));
        if (hash(serial, 12.8) < rejectChance) {
          p.active = true;
          p.rejected = true;
          p.edge = null;
          p.x = start.x;
          p.y = start.y;
          p.ttl = lerp(config.rejectTtlMin, config.rejectTtlMax, hash(serial, 14.3));
          s.filtered++;
          s.rejected[kind]++;
          return;
        }
      }

      const first = pickEdge(start, p);
      if (!first) return;
      p.active = true;
      enterEdge(p, first);
      placeThought(p);
      if (hash(serial, 23.9) < housingChance()) emitCounters(p, serial);
    }

    function stepThoughts(dt) {
      thoughts.forEach(function (p) {
        if (!p.active) return;
        p.age += dt;
        if (p.age >= p.ttl) {
          if (p.rejected) s.fastRejected++;
          else s.insignificant++;
          s.faded++;
          hideThought(p);
          return;
        }
        if (p.rejected || !p.edge) return;

        let remaining = dt;
        let guard = 0;
        while (remaining > 0.00001 && p.active && guard < 4) {
          const edge = p.edge;
          const geo = geometryT(p, p.progress);
          const interval = seedInterval(edge);
          const inThick = edge.seedAt >= 0 && geo >= interval.start && geo <= interval.end;
          const slowdown = inThick ? lerp(1, LEARN.thickSlowdown, edge.strength) : 1;
          const rate = p.speed * slowdown / edge.length;
          const untilEnd = (1 - p.progress) / rate;

          if (remaining < untilEnd) {
            p.progress += rate * remaining;
            remaining = 0;
          } else {
            remaining -= untilEnd;
            p.routeStep++;
            const dest = p.forward ? edge.to : edge.from;
            const next = reachedFarSide(p, dest) ? null : pickEdge(dest, p);
            if (!next) {
              completeJourney(p);
              s.insignificant++;
              hideThought(p);
            } else {
              enterEdge(p, next);
            }
          }
          guard++;
        }
        if (p.active) placeThought(p);
      });
    }

    // ---------- Internal counter-thoughts ----------

    function emitCounter(neuron, serial, index, visualSize) {
      const c = takeFree(counters);
      if (!c || !neuron) return false;
      const ageRatio = s.age / LIFE.maxAge;
      const angle = hash(serial * 2.17, index * 5.91 + 0.3) * Math.PI * 2;
      const speed = lerp(48, 155, hash(serial, index + 11.4)) / 72 * (asleep ? 1.25 : 1);
      c.active = true;
      c.x = neuron.x;
      c.y = neuron.y;
      c.vx = Math.cos(angle) * speed;
      c.vy = Math.sin(angle) * speed;
      c.age = 0;
      c.ttl = (lerp(7.2, 1.15, ageRatio) +
        hash(serial * 1.7, index * 3.1 + 0.4) * lerp(1.8, 0.65, ageRatio)) *
        (asleep ? 1.8 : 1);
      c.sourceId = neuron.id;
      c.initialScale = visualSize > 0 ? visualSize : 1;
      s.countersEmitted++;
      return true;
    }

    // Each unsettled crystal has its own cadence, staggered by identity so a
    // full pool does not fire on the same frame. Sleep shortens the wait but
    // does not create thoughts on its own.
    function internalInterval(c) {
      const span = config.internal.intervalMax - config.internal.intervalMin;
      const base = config.internal.intervalMin + hash(c.id, 2.8) * span;
      return asleep ? base * config.internal.sleepScale : base;
    }

    function scheduleInternal(c) {
      const every = internalInterval(c);
      c.internalEvery = every;
      c.nextInternal = s.time + every;
      s.intervalMinSeen = Math.min(s.intervalMinSeen, every);
      s.intervalMaxSeen = Math.max(s.intervalMaxSeen, every);
    }

    function permanentAnchors() {
      const seen = {};
      const list = [];
      crystals.forEach(function (c) {
        if (!c.active || c.state !== 'settled' || c.category < 0 || seen[c.category]) return;
        seen[c.category] = true;
        list.push(anchors[c.category]);
      });
      return list;
    }

    function siteNeuron(c) {
      if (c.state === 'temporary' && c.site) return c.site;
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < neurons.length; i++) {
        const neuron = neurons[i];
        const d = (neuron.x - c.x) * (neuron.x - c.x) + (neuron.y - c.y) * (neuron.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = neuron;
        }
      }
      return best;
    }

    // One internal thought per unsettled crystal per interval. It leaves
    // either the crystal's own site or, about half the time, a cluster that
    // already has a permanent member.
    function emitFromUnsettled(c) {
      const homes = permanentAnchors();
      const useHome = homes.length > 0 && hash(c.id * 9.3, s.time * 3.1 + c.id) >= 0.5;
      const neuron = useHome
        ? homes[Math.floor(hash(c.id, s.time + 2.2) * homes.length)]
        : siteNeuron(c);
      if (!emitCounter(neuron, c.id * 17 + s.internalFromUnsettled, 1, crystalVisualSize(c))) return;
      s.internalFromUnsettled++;
      if (useHome) s.fromPermanent++;
      else s.fromTemporary++;
    }

    function stepUnsettledEmissions() {
      crystals.forEach(function (c) {
        if (!c.active || c.state === 'settled' || c.state === 'tossed') return;
        if (s.time < c.nextInternal) return;
        emitFromUnsettled(c);
        scheduleInternal(c);
      });
    }

    function emitCounters(trigger, serial) {
      const hosts = hostCenters();
      if (!hosts.length || !trigger) return;
      const visualSize = thoughtVisualSize(trigger);
      const spread = asleep ? 3 : Math.min(3, hosts.length);
      const count = Math.min(
        hosts.length,
        (asleep ? 2 : 1) + Math.floor(hash(serial, 17.2) * spread)
      );
      const candidates = hosts.slice();
      for (let i = 0; i < count; i++) {
        let total = 0;
        const weights = candidates.map(function (neuron) {
          const weight = 0.15 + neuron.strength;
          total += weight;
          return weight;
        });
        let choice = hash(serial * 1.9 + i * 4.7, 8.2) * total;
        let index = candidates.length - 1;
        for (let j = 0; j < candidates.length; j++) {
          choice -= weights[j];
          if (choice <= 0) {
            index = j;
            break;
          }
        }
        emitCounter(candidates[index], serial, i, visualSize);
        candidates.splice(index, 1);
      }
    }

    function stepCounters(dt) {
      const margin = 0.15;
      counters.forEach(function (c) {
        if (!c.active) return;
        c.age += dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (
          c.age >= c.ttl ||
          c.x < -margin || c.y < -margin ||
          c.x > COLS + margin || c.y > ROWS + margin
        ) {
          c.active = false;
        }
      });
    }

    // ---------- Crystallization ----------

    function slotOffset(slot, count, radius) {
      const angle = slot * GOLDEN_ANGLE;
      const maxR = Math.max(0.16, (radius || 1) * 0.82);
      const distance = maxR * Math.sqrt((slot + 0.5) / Math.max(count || 1, 1));
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
    }

    function crystalPosition(c) {
      if (c.state === 'temporary') {
        return {
          x: c.site.x + Math.cos(c.angleA) * c.distA,
          y: c.site.y + Math.sin(c.angleA) * c.distA
        };
      }
      return { x: c.x, y: c.y };
    }

    function partnerPosition(c) {
      return {
        x: c.site.x + Math.cos(c.angleB) * c.distB,
        y: c.site.y + Math.sin(c.angleB) * c.distB
      };
    }

    function compactCategory(category) {
      crystals
        .filter(function (c) {
          return c.active && c.state === 'settled' && c.category === category;
        })
        .sort(function (a, b) {
          return a.settledAt - b.settledAt;
        })
        .forEach(function (c, index) {
          c.slot = index;
        });
    }

    function hideCrystal(c) {
      const category = c.state === 'settled' ? c.category : -1;
      if (c.active && c.state === 'temporary' && c.site && c.carried > 0) {
        c.site.pending = Math.max(0, (c.site.pending || 0) - c.carried);
        c.carried = 0;
      }
      c.active = false;
      c.state = 'temporary';
      c.site = null;
      c.category = -1;
      c.nextInternal = Infinity;
      c.judged = false;
      c.kept = true;
      if (category >= 0) {
        settledCount[category]--;
        compactCategory(category);
      }
    }

    function takeCrystal() {
      const free = takeFree(crystals);
      if (free) return free;
      // When memory is full the oldest settled memories fade first, so fresh
      // temporary homes keep accumulating toward the next sleep.
      const order = ['tossed', 'settled', 'temporary', 'wandering'];
      for (let k = 0; k < order.length; k++) {
        let oldest = null;
        crystals.forEach(function (c) {
          if (c.state !== order[k]) return;
          const at = c.state === 'settled' ? c.settledAt : c.bornAt;
          const best = oldest && (oldest.state === 'settled' ? oldest.settledAt : oldest.bornAt);
          if (!oldest || at < best) oldest = c;
        });
        if (oldest) {
          hideCrystal(oldest);
          return oldest;
        }
      }
      return crystals[0];
    }

    function crystallizePair(p, counter, neuron) {
      hideThought(p);
      counter.active = false;
      s.crystallizations++;
      s.homed[p.kind]++;
      const c = takeCrystal();
      const salt = s.crystallizations * 1.7 + neuron.id;
      c.active = true;
      c.state = 'temporary';
      c.kind = p.kind;
      c.bornAt = s.time;
      c.site = neuron;
      c.category = -1;
      c.travel = 0;
      c.judged = false;
      c.kept = true;
      c.carried = depositFor(p.kind);
      c.daySpeed = p.speed;
      neuron.pending = (neuron.pending || 0) + c.carried;
      scheduleInternal(c);
      c.angleA = hash(salt, 1.2) * Math.PI * 2;
      c.angleB = c.angleA + Math.PI + (hash(salt, 2.4) - 0.5) * 0.8;
      c.distA = lerp(0.05, 0.22, hash(salt, 3.3));
      c.distB = lerp(0.06, 0.24, hash(salt, 4.5));
      emitHormoneWave(p.kind, neuron);
    }

    // Attraction housing is the reward metaphor. Danger housing is the stress
    // metaphor. Ordinary housing, rejection, travel, settlement, and
    // rebalancing do not call this.
    function emitHormoneWave(kind, neuron) {
      let type = null;
      if (kind === 'attraction') type = 'reward';
      else if (kind === 'danger') type = 'stress';
      else return;

      let slot = null;
      let oldest = null;
      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        if (!wave.active) {
          slot = wave;
          break;
        }
        if (!oldest || wave.bornAt < oldest.bornAt) oldest = wave;
      }
      if (!slot) slot = oldest;
      const spec = config.waves;
      slot.active = true;
      slot.type = type;
      slot.kind = kind;
      slot.x = neuron.x;
      slot.y = neuron.y;
      slot.age = 0;
      slot.bornAt = s.time;
      slot.ttl = lerp(spec.ttlMin, spec.ttlMax, hash(neuron.id * 1.9, s.crystallizations + 6.2));
      if (type === 'reward') s.rewardWaves++;
      else s.stressWaves++;
    }

    function stepWaves(dt) {
      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        if (!wave.active) continue;
        wave.age += dt;
        if (wave.age >= wave.ttl) wave.active = false;
      }
    }

    function activeWaves() {
      const list = [];
      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        if (!wave.active) continue;
        list.push({
          x: wave.x,
          y: wave.y,
          type: wave.type,
          kind: wave.kind,
          age: wave.age,
          ttl: wave.ttl,
          bornAt: wave.bornAt
        });
      }
      return list;
    }

    // A red/blue pair that meets near a knowledge center (other than the
    // blue thought's source) stops there. Bigger thoughts reach farther.
    function resolveCrystals() {
      const hosts = hostCenters();
      const chance = housingChance();
      if (chance <= 0 || hosts.length < 2) return;
      const reds = [];
      thoughts.forEach(function (p) {
        if (!p.active || p.rejected || !p.edge) return;
        if (p.housingRoll >= chance) return;
        reds.push({ p: p, redVis: thoughtVisualSize(p) });
      });
      if (!reds.length) return;
      const claimed = {};

      counters.forEach(function (counter) {
        if (!counter.active) return;
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < reds.length; i++) {
          const red = reds[i];
          if (claimed[red.p.id]) continue;
          const dx = red.p.x - counter.x;
          const dy = red.p.y - counter.y;
          const d2 = dx * dx + dy * dy;
          const span = 0.5 * (red.redVis + counterVisualSize(counter)) / config.entryScale;
          if (d2 <= 0.0225 * span * span && d2 < bestD) {
            bestD = d2;
            best = red;
          }
        }
        if (!best) return;

        const mx = (best.p.x + counter.x) * 0.5;
        const my = (best.p.y + counter.y) * 0.5;
        const span = 0.5 * (best.redVis + counterVisualSize(counter)) / config.entryScale;
        let nearest = null;
        let nearestD = 0.1296 * span * span;
        for (let i = 0; i < hosts.length; i++) {
          const neuron = hosts[i];
          if (neuron.id === counter.sourceId) continue;
          const dx = neuron.x - mx;
          const dy = neuron.y - my;
          const d2 = dx * dx + dy * dy;
          if (d2 <= nearestD) {
            nearestD = d2;
            nearest = neuron;
          }
        }
        if (!nearest) return;
        claimed[best.p.id] = true;
        crystallizePair(best.p, counter, nearest);
      });
    }

    // ---------- Sleep consolidation ----------

    function categoryCounts() {
      const counts = new Array(CATEGORY_COUNT).fill(0);
      crystals.forEach(function (c) {
        if (c.active && c.category >= 0 && c.state !== 'temporary') counts[c.category]++;
      });
      return counts;
    }

    // Integer seats for `total` thoughts. Largest fractional shares get the
    // leftover seats, so the targets always sum to the total.
    function targetCounts(total) {
      const targets = new Array(CATEGORY_COUNT).fill(0);
      if (total <= 0) return targets;
      const raw = CATEGORY_WEIGHTS.map(function (weight) {
        return total * weight / WEIGHT_SUM;
      });
      let used = 0;
      const rest = [];
      for (let i = 0; i < CATEGORY_COUNT; i++) {
        targets[i] = Math.floor(raw[i]);
        used += targets[i];
        rest.push({ index: i, frac: raw[i] - targets[i] });
      }
      rest.sort(function (a, b) {
        return b.frac - a.frac || a.index - b.index;
      });
      for (let i = 0; i < total - used; i++) targets[rest[i].index]++;
      return targets;
    }

    function distribution(counts) {
      const total = counts.reduce(function (sum, n) { return sum + n; }, 0);
      const targets = targetCounts(total);
      let error = 0;
      let maxOver = 0;
      let maxUnder = 0;
      for (let i = 0; i < CATEGORY_COUNT; i++) {
        const delta = counts[i] - targets[i];
        error += Math.abs(delta);
        if (delta > maxOver) maxOver = delta;
        if (-delta > maxUnder) maxUnder = -delta;
      }
      return { total: total, targets: targets, error: error, maxOver: maxOver, maxUnder: maxUnder };
    }

    // A thought prefers its family, then the category furthest below its
    // weighted share. Distance is only a tie-breaker.
    function classify(c, from) {
      const counts = categoryCounts();
      const total = counts.reduce(function (sum, n) { return sum + n; }, 0) + 1;
      const band = KINDS[c.kind].band;
      let best = 0;
      let bestScore = Infinity;
      for (let i = 0; i < CATEGORY_COUNT; i++) {
        const anchor = anchors[i];
        const distance = Math.hypot(anchor.x - from.x, anchor.y - from.y);
        const ideal = total * CATEGORY_WEIGHTS[i] / WEIGHT_SUM;
        const score = (counts[i] + 1) - ideal +
          (Math.floor(i / BAND_SIZE) === band ? 0 : 0.55) +
          0.03 * distance +
          hash(c.id + i, s.serial) * 0.04;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    }

    function drainSite(neuron, amount) {
      const seeded = neuron.adjacent.filter(function (edge) {
        return edge.seedAt >= 0;
      });
      if (!seeded.length || amount <= 0) return 0;
      const share = amount / seeded.length;
      let removed = 0;
      seeded.forEach(function (edge) {
        const take = Math.min(share, edge.strength);
        edge.strength -= take;
        removed += take;
        s.drained += take;
        if (edge.strength < 0.004) {
          edge.seedAt = -1;
          edge.strength = 0;
        }
      });
      touchKnowledge();
      return removed;
    }

    function nearestAnchorGap() {
      let min = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const dx = anchors[i].x - anchors[j].x;
          const dy = anchors[i].y - anchors[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < min) min = dist;
        }
      }
      return min;
    }

    const ANCHOR_GAP = nearestAnchorGap();

    function initialRadius(cat) {
      const base = 0.72 + 0.5 * (CATEGORY_WEIGHTS[cat] / 1.8);
      return Math.min(base, ANCHOR_GAP * 0.42);
    }

    function initDomains() {
      neurons.forEach(function (neuron) { neuron.domain = -1; });
      for (let i = 0; i < CATEGORY_COUNT; i++) {
        domains[i].neurons = [anchors[i]];
        anchors[i].domain = i;
        domains[i].radius = initialRadius(i);
      }
    }

    function nearestCategory(neuron) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < CATEGORY_COUNT; i++) {
        const dist = Math.hypot(neuron.x - anchors[i].x, neuron.y - anchors[i].y);
        if (dist < bestD - 1e-6 || (Math.abs(dist - bestD) <= 1e-6 && i < best)) {
          best = i;
          bestD = dist;
        }
      }
      return best;
    }

    // A full neuron pulls its grid neighbors into the category, unless a
    // nearer anchor already owns that ground. The ring grows to contain them.
    function expandDomain(cat) {
      const domain = domains[cat];
      const anchor = anchors[cat];
      const fresh = [];
      domain.neurons.forEach(function (neuron) {
        if (neuron.strength < 0.999) return;
        neurons.forEach(function (other) {
          if (other.domain >= 0) return;
          if (Math.hypot(other.x - neuron.x, other.y - neuron.y) > 1.55) return;
          if (nearestCategory(other) !== cat) return;
          other.domain = cat;
          fresh.push(other);
        });
      });
      fresh.forEach(function (neuron) { domain.neurons.push(neuron); });
      let radius = initialRadius(cat);
      domain.neurons.forEach(function (neuron) {
        const dist = Math.hypot(neuron.x - anchor.x, neuron.y - anchor.y);
        if (neuron === anchor || neuron.strength >= 0.999 || fresh.indexOf(neuron) >= 0) {
          radius = Math.max(radius, dist + (neuron.strength >= 0.999 ? 0.9 : 0));
        }
      });
      domain.radius = radius;
    }

    function feedNeuron(neuron, amount) {
      const adjacent = neuron.adjacent;
      if (!adjacent.length || amount <= 0) return;
      const share = amount / adjacent.length;
      s.fed += amount;
      adjacent.forEach(function (edge) {
        const near = edge.from === neuron ? 0.14 : 0.86;
        if (edge.seedAt < 0) {
          edge.seedAt = near;
          edge.strength = share;
          s.seedEvents++;
        } else {
          edge.seedAt = lerp(edge.seedAt, near, 0.25);
          edge.strength = clamp(edge.strength + share, 0, 1);
        }
      });
      neuron.strength = centerStrength(neuron);
      touchKnowledge();
    }

    function thickenDomain(cat, amount) {
      expandDomain(cat);
      let target = null;
      domains[cat].neurons.forEach(function (neuron) {
        if (neuron.strength >= 0.999) return;
        if (!target || neuron.strength < target.strength) target = neuron;
      });
      if (!target) return;
      feedNeuron(target, amount);
      if (target.strength >= 0.999) expandDomain(cat);
    }

    function feedAnchor(anchor, amount) {
      const adjacent = anchor.adjacent;
      if (!adjacent.length || amount <= 0) return;
      const share = amount / adjacent.length;
      s.fed += amount;
      adjacent.forEach(function (edge) {
        const near = edge.from === anchor ? 0.14 : 0.86;
        if (edge.seedAt < 0) {
          edge.seedAt = near;
          edge.strength = share;
          s.seedEvents++;
        } else {
          edge.seedAt = lerp(edge.seedAt, near, 0.25);
          edge.strength = clamp(edge.strength + share, 0, 1);
        }
      });
    }

    // Once per thought per sleep: keep it for a permanent home, or toss it.
    // A stable hash of the thought and the night decides, never Math.random.
    function judge(c) {
      if (c.judged || (c.state !== 'temporary' && c.state !== 'wandering')) return c.kept;
      c.judged = true;
      c.kept = hash(c.id * 7.31 + s.sleeps * 1.37, 41.9) < s.keepChance;
      if (c.kept) {
        s.keptThisSleep++;
        return true;
      }
      toss(c);
      return false;
    }

    // A tossed thought releases its latent thickness without delivering it,
    // stops provoking internal thoughts, and fades out where it is.
    function toss(c) {
      const at = crystalPosition(c);
      if (c.state === 'temporary' && c.site) {
        c.site.pending = Math.max(0, (c.site.pending || 0) - c.carried);
      }
      c.carried = 0;
      c.x = at.x;
      c.y = at.y;
      c.state = 'tossed';
      c.category = -1;
      c.nextInternal = Infinity;
      c.tossAge = 0;
      c.tossTtl = SLEEP.tossFade;
      s.tossedThisSleep++;
      s.tossedTotal++;
    }

    function startWandering(c, category, source) {
      const origin = crystalPosition(c);
      const previous = c.state === 'settled' ? c.category : -1;
      const anchor = anchors[category];
      const heading = Math.atan2(anchor.y - origin.y, anchor.x - origin.x) +
        (hash(c.id * 1.3, s.time * 0.7 + category) - 0.5) * 1.6;
      const speed = travelSpeed(c);
      const keepSchedule = c.state === 'temporary' && c.nextInternal > s.time;
      if (c.state === 'settled') {
        c.judged = true;
        c.kept = true;
      }
      c.state = 'wandering';
      c.category = category;
      if (!keepSchedule) scheduleInternal(c);
      c.x = origin.x;
      c.y = origin.y;
      c.vx = Math.cos(heading) * speed;
      c.vy = Math.sin(heading) * speed;
      c.travel = 0;
      const latent = c.carried;
      if (source) source.pending = Math.max(0, (source.pending || 0) - latent);
      c.carried = latent + (source ? drainSite(source, SLEEP.loss) : 0);
      if (previous >= 0) {
        settledCount[previous]--;
        compactCategory(previous);
      }
      s.migrations++;
    }

    function settle(c) {
      const anchor = anchors[c.category];
      c.state = 'settled';
      c.settledAt = s.time;
      c.site = anchor;
      thickenDomain(c.category, c.carried + SLEEP.consolidationBonus * growthFactor());
      c.carried = 0;
      c.nextInternal = Infinity;
      settledCount[c.category]++;
      compactCategory(c.category);
      s.consolidated++;
    }

    function travelSpeed(c) {
      return c.daySpeed * SLEEP.travelMultiplier;
    }

    // Travelers fly at constant speed, steering hard toward their cluster
    // with a slight wobble, and bounce off the brain's edge.
    function moveWanderer(c, dt) {
      c.travel += dt;
      const anchor = anchors[c.category];
      const speed = travelSpeed(c);
      let dx = anchor.x - c.x;
      let dy = anchor.y - c.y;
      let distance = Math.hypot(dx, dy) || 0.0001;
      const wobble = (hash(c.id * 3.1, Math.floor(c.travel * 3) + c.category) - 0.5) *
        SLEEP.wobble * smoothstep(0.4, 2.5, distance);
      const target = Math.atan2(dy, dx) + wobble;
      const steer = Math.min(1, dt * SLEEP.steering);
      const vx = c.vx + (Math.cos(target) * speed - c.vx) * steer;
      const vy = c.vy + (Math.sin(target) * speed - c.vy) * steer;
      const current = Math.hypot(vx, vy) || 0.0001;
      c.vx = vx / current * speed;
      c.vy = vy / current * speed;

      const step = Math.min(speed * dt, distance);
      const startX = c.x;
      const startY = c.y;
      if (distance <= speed * dt) {
        c.x = anchor.x;
        c.y = anchor.y;
      } else {
        c.x += c.vx / speed * step;
        c.y += c.vy / speed * step;
      }

      const margin = 0.25;
      if (c.x < margin) { c.x = margin; c.vx = Math.abs(c.vx); }
      if (c.x > COLS - margin) { c.x = COLS - margin; c.vx = -Math.abs(c.vx); }
      if (c.y < margin) { c.y = margin; c.vy = Math.abs(c.vy); }
      if (c.y > ROWS - margin) { c.y = ROWS - margin; c.vy = -Math.abs(c.vy); }

      s.travelDistance += Math.hypot(c.x - startX, c.y - startY);
      s.travelDayDistance += c.daySpeed * dt;

      dx = anchor.x - c.x;
      dy = anchor.y - c.y;
      distance = Math.hypot(dx, dy);
      if (distance < SLEEP.arriveRadius || c.travel > SLEEP.maxTravel) settle(c);
    }

    function glideSettled(c, dt) {
      const anchor = anchors[c.category];
      const offset = slotOffset(c.slot, settledCount[c.category], domains[c.category].radius);
      const pull = Math.min(1, dt * 4);
      c.x += (anchor.x + offset.x - c.x) * pull;
      c.y += (anchor.y + offset.y - c.y) * pull;
    }

    function oldestTemporary() {
      let oldest = null;
      crystals.forEach(function (c) {
        if (c.active && c.state === 'temporary' && (!oldest || c.bornAt < oldest.bornAt)) {
          oldest = c;
        }
      });
      return oldest;
    }

    // Move one settled thought from the category furthest over its weighted
    // target to the category furthest under it. Stop once every count is
    // within an integer of that target.
    function rebalanceEnds(counts) {
      const info = distribution(counts);
      let high = -1;
      let low = -1;
      let highS = 0;
      let lowS = 0;
      for (let i = 0; i < CATEGORY_COUNT; i++) {
        const delta = counts[i] - info.targets[i];
        if (delta > highS) { highS = delta; high = i; }
        if (delta < lowS) { lowS = delta; low = i; }
      }
      return { high: high, low: low, highS: highS, lowS: lowS, info: info };
    }

    function newestSettled(category) {
      let pick = null;
      crystals.forEach(function (c) {
        if (
          c.active && c.state === 'settled' && c.category === category &&
          (!pick || c.settledAt > pick.settledAt)
        ) pick = c;
      });
      return pick;
    }

    function rebalance() {
      const ends = rebalanceEnds(categoryCounts());
      if (ends.high < 0 || ends.low < 0 || ends.highS < 1 || ends.lowS > -1) return false;
      const pick = newestSettled(ends.high);
      if (!pick) return false;
      startWandering(pick, ends.low, anchors[ends.high]);
      s.rebalances++;
      return true;
    }

    function rebalanceDirect() {
      const ends = rebalanceEnds(categoryCounts());
      if (ends.high < 0 || ends.low < 0 || ends.highS < 1 || ends.lowS > -1) return false;
      const pick = newestSettled(ends.high);
      if (!pick) return false;
      const previous = pick.category;
      pick.category = ends.low;
      pick.site = anchors[ends.low];
      settledCount[previous]--;
      settledCount[ends.low]++;
      compactCategory(previous);
      compactCategory(ends.low);
      s.rebalances++;
      return true;
    }

    // Seeds slide toward their stronger neuron so knowledge gathers into
    // tidy clusters instead of floating mid-axon.
    function reshapeSeeds(dt) {
      const step = 1 - Math.exp(-dt * SLEEP.seedDrift);
      edges.forEach(function (edge) {
        if (edge.seedAt < 0) return;
        if (edge.from.strength <= 0 && edge.to.strength <= 0) return;
        const target = edge.from.strength >= edge.to.strength ? 0.08 : 0.92;
        edge.seedAt = lerp(edge.seedAt, target, step);
      });
      touchKnowledge();
    }

    function stepCrystals(dt) {
      crystals.forEach(function (c) {
        if (!c.active) return;
        if (c.state === 'settled') glideSettled(c, dt);
        else if (c.state === 'wandering' && asleep) moveWanderer(c, dt);
        else if (c.state === 'tossed') {
          c.tossAge += dt;
          if (c.tossAge >= c.tossTtl) hideCrystal(c);
        }
      });
      if (!asleep) return;

      // Detach fast enough that the night's backlog is on its way within the
      // first part of REM, however short this age makes the night.
      const detachSpan = Math.max(0.5, s.remTarget * 0.6);
      const base = Math.max(SLEEP.migrationRate, s.sleepBacklog / detachSpan);
      const migrationRate = s.inDeep ? base * 3 : base;
      s.migrationAcc += dt * migrationRate;
      while (s.migrationAcc >= 1) {
        s.migrationAcc -= 1;
        const c = oldestTemporary();
        if (!c) {
          s.migrationAcc = 0;
          break;
        }
        if (judge(c)) startWandering(c, classify(c, c.site), c.site);
      }

      s.rebalanceAcc += dt;
      const rebalanceEvery = s.inDeep ? 0.12 : SLEEP.rebalanceEvery;
      if (s.rebalanceAcc >= rebalanceEvery) {
        s.rebalanceAcc -= rebalanceEvery;
        rebalance();
      }
      expandAllDomains();
      reshapeSeeds(dt);
    }

    // ---------- Lifecycle ----------

    function reset() {
      Object.assign(s, {
        time: 0,
        saturation: 0,
        peakSaturation: 0,
        age: 0,
        finishedAt: -1,
        spawnAcc: 0,
        migrationAcc: 0,
        rebalanceAcc: 0,
        serial: 0,
        seedEvents: 0,
        crystallizations: 0,
        faded: 0,
        filtered: 0,
        countersEmitted: 0,
        internalFromUnsettled: 0,
        fromTemporary: 0,
        fromPermanent: 0,
        intervalMinSeen: Infinity,
        intervalMaxSeen: 0,
        completedJourneys: 0,
        journeyTime: 0,
        migrations: 0,
        consolidated: 0,
        rebalances: 0,
        travelDistance: 0,
        travelDayDistance: 0,
        need: 0,
        reorganized: 1,
        phase: 'awake',
        phaseBlend: 0,
        phaseElapsed: 0,
        inDeep: false,
        remStartedAt: -1,
        deepStartedAt: -1,
        remDuration: 0,
        deepDuration: 0,
        deepTarget: 0,
        stateTime: 0,
        sleeps: 0,
        sleepBacklog: 1,
        lastSleepAt: -1,
        lastWakeAt: -1,
        lastSleepDuration: 0,
        drained: 0,
        fed: 0,
        born: byKind(),
        homed: byKind(),
        rejected: byKind(),
        rewardWaves: 0,
        stressWaves: 0,
        fastRejected: 0,
        insignificant: 0,
        lust: 100,
        lustHeld: false,
        threshold: Math.max(1, Math.round(BASE_THRESHOLD * STAGES[0].threshold)),
        awakeDuration: 0,
        sleepAge: 0,
        sleepRatio: 0,
        sleepTarget: 0,
        remTarget: 0,
        keepChance: STAGES[0].keep,
        keptThisSleep: 0,
        tossedThisSleep: 0,
        tossedTotal: 0
      });
      waves.forEach(function (wave) {
        wave.active = false;
        wave.age = 0;
      });
      asleep = false;
      edges.forEach(function (edge) {
        edge.seedAt = -1;
        edge.strength = 0;
        edge.traversals = 0;
      });
      neurons.forEach(function (neuron) {
        neuron.pending = 0;
        neuron.strength = 0;
      });
      for (let i = 0; i < CATEGORY_COUNT; i++) settledCount[i] = 0;
      knowledgeDirty = true;
      initDomains();
      thoughts.forEach(hideThought);
      counters.forEach(function (c) {
        c.active = false;
      });
      crystals.forEach(function (c) {
        c.active = false;
        c.state = 'temporary';
        c.site = null;
        c.category = -1;
      });
      refreshKnowledge();
    }

    // ---------- Automatic sleep ----------

    function pendingCrystals() {
      let temporary = 0;
      let wandering = 0;
      crystals.forEach(function (c) {
        if (!c.active) return;
        if (c.state === 'temporary') temporary++;
        else if (c.state === 'wandering') wandering++;
      });
      return { temporary: temporary, wandering: wandering };
    }

    function expandAllDomains() {
      for (let i = 0; i < CATEGORY_COUNT; i++) expandDomain(i);
    }

    function finishDeepWork() {
      crystals.forEach(function (c) {
        if (!c.active || c.state !== 'temporary') return;
        if (judge(c)) startWandering(c, classify(c, c.site), c.site);
      });
      crystals.forEach(function (c) {
        if (!c.active || c.state !== 'wandering') return;
        const anchor = anchors[c.category];
        c.x = anchor.x;
        c.y = anchor.y;
        settle(c);
      });
      for (let i = 0; i < CATEGORY_COUNT * 2; i++) {
        if (!rebalanceDirect()) break;
      }
      crystals.forEach(function (c) {
        if (c.active && c.state === 'tossed') hideCrystal(c);
      });
    }

    function wakeFromDeep() {
      finishDeepWork();
      s.deepDuration = s.time - s.deepStartedAt;
      asleep = false;
      s.inDeep = false;
      s.stateTime = 0;
      s.lastWakeAt = s.time;
      s.lastSleepDuration = s.time - s.lastSleepAt;
      s.reorganized = 1;
      s.phaseElapsed = 0;
      setPhase('waking', 0);
    }

    function setPhase(name, blend) {
      s.phase = name;
      s.phaseBlend = clamp(blend, 0, 1);
    }

    // Awake is blue. Rising need blends toward red. Just after waking, the
    // phase stays "waking" so the screen can ease from deep dark gray back to blue.
    function assignAwakePhase() {
      if (s.lastWakeAt >= 0 && s.stateTime < SLEEP.wakeBlend && s.need < SLEEP.needPhase) {
        setPhase('waking', s.stateTime / SLEEP.wakeBlend);
        return;
      }
      if (s.need >= SLEEP.needPhase) setPhase('sleep-needed', s.need);
      else setPhase('awake', s.need);
    }

    // At sleep onset the age decides how long the night is: the awake bout
    // times sleepHours / awakeHours. REM takes the first half and deep sleep
    // the second, so deep always equals the REM just finished.
    function fallAsleep(pending) {
      const stage = stageAt(s.age);
      asleep = true;
      s.awakeDuration = s.stateTime;
      s.stateTime = 0;
      s.sleeps++;
      s.lastSleepAt = s.time;
      s.sleepAge = s.age;
      s.sleepRatio = stage.ratio;
      s.keepChance = stage.keep;
      s.sleepTarget = s.awakeDuration * stage.ratio;
      s.remTarget = s.sleepTarget / 2;
      s.sleepBacklog = Math.max(1, pending.temporary + pending.wandering);
      s.remStartedAt = s.time;
      s.remDuration = 0;
      s.deepDuration = 0;
      s.deepTarget = 0;
      s.keptThisSleep = 0;
      s.tossedThisSleep = 0;
      crystals.forEach(function (c) {
        if (c.active) judge(c);
      });
    }

    function updateSleepState(dt) {
      s.stateTime += dt;
      const pending = pendingCrystals();
      s.threshold = sleepThreshold();
      s.need = clamp(pending.temporary / s.threshold, 0, 1);
      if (!asleep) {
        s.reorganized = 1;
        s.inDeep = false;
        if (s.finishedAt < 0 && s.stateTime >= SLEEP.minAwake && s.need >= 1) {
          fallAsleep(pending);
        } else {
          assignAwakePhase();
          s.phaseElapsed = s.phase === 'waking' ? s.stateTime : 0;
          return;
        }
      }

      if (s.inDeep) {
        s.deepDuration = s.time - s.deepStartedAt;
        s.phaseElapsed = s.deepDuration;
        const span = Math.max(s.deepTarget, STEP);
        setPhase('deep', clamp(s.deepDuration / span, 0, 1));
        s.reorganized = clamp(s.deepDuration / span, 0, 1);
        if (s.deepDuration + 1e-8 >= s.deepTarget) wakeFromDeep();
        return;
      }

      const remaining = pending.temporary + pending.wandering;
      s.sleepBacklog = Math.max(s.sleepBacklog, remaining, 1);
      const travelShare = remaining / s.sleepBacklog;
      s.reorganized = clamp(1 - travelShare, 0, 1);
      s.remDuration = s.time - s.remStartedAt;
      s.phaseElapsed = s.remDuration;
      if (s.remDuration + 1e-8 < Math.max(s.remTarget, STEP)) {
        setPhase('rem', clamp(1 - travelShare, 0, 1));
        return;
      }
      s.inDeep = true;
      s.deepStartedAt = s.time;
      s.deepTarget = s.remDuration;
      s.deepDuration = 0;
      s.phaseElapsed = 0;
      setPhase('deep', 0);
    }

    function step(dt) {
      if (s.finishedAt < 0) {
        if (!asleep) {
          s.spawnAcc += dt * config.spawnRate * stageAt(s.age).acceptance;
          while (s.spawnAcc >= 1) {
            spawnThought();
            s.spawnAcc -= 1;
          }
        }
      }
      stepThoughts(dt);
      stepCounters(dt);
      resolveCrystals();
      stepWaves(dt);
      stepCrystals(dt);
      stepUnsettledEmissions();
      refreshKnowledge();
      stepLust(dt);
      updateSleepState(dt);
      s.time += dt;
    }

    function advance(dt) {
      let remaining = dt;
      while (remaining > 0.00001) {
        const slice = Math.min(STEP, remaining);
        step(slice);
        remaining -= slice;
        if (s.finishedAt >= 0 && s.time - s.finishedAt >= LIFE.hold) reset();
      }
    }

    function resume(seconds) {
      let elapsed = 0;
      while (seconds - elapsed > 0.0001) {
        const slice = Math.min(0.1, seconds - elapsed);
        advance(slice);
        elapsed += slice;
      }
    }

    function seek(seconds) {
      reset();
      resume(Math.max(0, seconds));
    }

    function count(list, test) {
      let n = 0;
      list.forEach(function (item) {
        if (test(item)) n++;
      });
      return n;
    }

    // Fields shared by snapshot() and stats(): life stage, lust, and the
    // current or most recent night.
    function lifeFields(out) {
      const stage = stageAt(s.age);
      out.ageStage = stage.name;
      out.sleepAwakeRatio = asleep ? s.sleepRatio : stage.ratio;
      out.acceptance = stage.acceptance;
      out.keepChance = asleep ? s.keepChance : stage.keep;
      out.awakeDuration = asleep ? s.awakeDuration : s.stateTime;
      out.lastAwakeDuration = s.awakeDuration;
      out.sleepTarget = s.sleepTarget;
      out.remTarget = s.remTarget;
      out.remDuration = s.remDuration;
      out.deepDuration = s.deepDuration;
      out.deepTarget = s.deepTarget;
      out.keptThisSleep = s.keptThisSleep;
      out.tossedThisSleep = s.tossedThisSleep;
      out.tossedTotal = s.tossedTotal;
      out.lust = s.lust;
      out.lustNatural = lustNatural();
      out.lustForced = lustForced();
      out.housingChance = housingChance();
      out.sleepThreshold = s.threshold;
      out.rewardWaves = s.rewardWaves;
      out.stressWaves = s.stressWaves;
      return out;
    }

    function snapshot() {
      return lifeFields({
        time: s.time,
        saturation: s.saturation,
        age: s.age,
        finishedAt: s.finishedAt,
        hold: LIFE.hold,
        asleep: asleep,
        settled: count(crystals, function (c) { return c.active && c.state === 'settled'; }),
        wandering: count(crystals, function (c) { return c.active && c.state === 'wandering'; }),
        temporary: count(crystals, function (c) { return c.active && c.state === 'temporary'; }),
        need: s.need,
        reorganized: s.reorganized,
        phase: s.phase,
        phaseBlend: s.phaseBlend,
        phaseElapsed: s.phaseElapsed,
        clusters: categoryCounts().filter(function (n) { return n > 0; }).length,
        tossed: count(crystals, function (c) { return c.active && c.state === 'tossed'; }),
        waves: activeWaves()
      });
    }

    function stats() {
      const counts = categoryCounts();
      return lifeFields({
        neurons: neurons.length,
        edges: edges.length,
        time: s.time,
        age: s.age,
        saturation: s.saturation,
        peakSaturation: s.peakSaturation,
        saturationLimit: LIFE.saturationLimit,
        finishedAt: s.finishedAt,
        asleep: asleep,
        growthFactor: growthFactor(),
        filterStrength: filterStrength(),
        riskAffinity: riskAffinity(),
        centers: centers.length,
        seededAxons: count(edges, function (e) { return e.seedAt >= 0; }),
        seedEvents: s.seedEvents,
        activeThoughts: count(thoughts, function (p) { return p.active; }),
        activeCounters: count(counters, function (c) { return c.active; }),
        countersEmitted: s.countersEmitted,
        unsettledCrystals: count(crystals, function (c) {
          return c.active && c.state !== 'settled';
        }),
        internalEmissionsFromUnsettled: s.internalFromUnsettled,
        internalFromTemporarySite: s.fromTemporary,
        internalFromPermanentCluster: s.fromPermanent,
        internalIntervalMin: s.intervalMinSeen === Infinity ? 0 : s.intervalMinSeen,
        internalIntervalMax: s.intervalMaxSeen,
        crystallizations: s.crystallizations,
        temporarilyHoused: s.crystallizations,
        fastRejectedThoughts: s.fastRejected,
        insignificantFades: s.insignificant,
        fadedThoughts: s.faded,
        filteredThoughts: s.filtered,
        completedJourneys: s.completedJourneys,
        averageJourneyDuration: s.completedJourneys ? s.journeyTime / s.completedJourneys : 0,
        kindBorn: Object.assign({}, s.born),
        kindHomed: Object.assign({}, s.homed),
        kindFiltered: Object.assign({}, s.rejected),
        temporaryCrystals: count(crystals, function (c) { return c.active && c.state === 'temporary'; }),
        wanderingCrystals: count(crystals, function (c) { return c.active && c.state === 'wandering'; }),
        settledCrystals: count(crystals, function (c) { return c.active && c.state === 'settled'; }),
        migrations: s.migrations,
        consolidated: s.consolidated,
        rebalances: s.rebalances,
        travelSpeedRatio: s.travelDayDistance ? s.travelDistance / s.travelDayDistance : 0,
        sleepNeed: s.need,
        reorganized: s.reorganized,
        phase: s.phase,
        phaseBlend: s.phaseBlend,
        phaseElapsed: s.phaseElapsed,
        tossedCrystals: count(crystals, function (c) { return c.active && c.state === 'tossed'; }),
        categoryWeights: CATEGORY_WEIGHTS.slice(),
        categoryTargets: distribution(counts).targets,
        weightedError: distribution(counts).error,
        domainRadii: domains.map(function (domain) { return domain.radius; }),
        sleeps: s.sleeps,
        lastSleepAt: s.lastSleepAt,
        lastWakeAt: s.lastWakeAt,
        lastSleepDuration: s.lastSleepDuration,
        clusterSizes: counts,
        clusterSpread: Math.max.apply(null, counts) - Math.min.apply(null, counts),
        strengthSum: (function () {
          let sum = 0;
          edges.forEach(function (edge) { sum += edge.strength; });
          return sum;
        })(),
        anchorStrength: (function () {
          const seen = {};
          let sum = 0;
          anchors.forEach(function (anchor) {
            anchor.adjacent.forEach(function (edge) {
              if (seen[edge.id]) return;
              seen[edge.id] = true;
              sum += edge.strength;
            });
          });
          return sum;
        })(),
        drainedThickness: s.drained,
        fedThickness: s.fed,
        pendingThickness: (function () {
          let sum = 0;
          neurons.forEach(function (neuron) { sum += neuron.pending || 0; });
          return sum;
        })(),
        activeWaves: count(waves, function (wave) { return wave.active; }),
        waves: activeWaves()
      });
    }

    // While the slider is held, lust follows the finger. On release, or
    // after a programmatic nudge, it slides back to the natural value.
    function holdLust(value) {
      s.lust = clamp(+value || 0, 0, 100);
      s.lustHeld = true;
    }

    function releaseLust() {
      s.lustHeld = false;
    }

    function setLust(value) {
      s.lust = clamp(+value || 0, 0, 100);
      s.lustHeld = false;
    }

    function setPeak(value) {
      s.peakSaturation = clamp(+value || 0, 0, LIFE.saturationLimit);
      s.age = LIFE.maxAge * (s.peakSaturation / LIFE.saturationLimit);
      knowledgeDirty = true;
    }

    reset();

    return {
      thoughts: thoughts,
      counters: counters,
      crystals: crystals,
      waves: waves,
      anchors: anchors,
      reset: reset,
      advance: advance,
      resume: resume,
      seek: seek,
      setLust: setLust,
      setPeak: setPeak,
      holdLust: holdLust,
      releaseLust: releaseLust,
      lust: function () { return s.lust; },
      isAsleep: function () { return asleep; },
      seedInterval: seedInterval,
      crystalPosition: crystalPosition,
      partnerPosition: partnerPosition,
      categoryCounts: categoryCounts,
      domainRadius: function (index) { return domains[index].radius; },
      categoryWeights: function () { return CATEGORY_WEIGHTS.slice(); },
      thoughtScale: thoughtScale,
      thoughtVisualSize: thoughtVisualSize,
      crystalVisualSize: crystalVisualSize,
      counterVisualSize: counterVisualSize,
      snapshot: snapshot,
      stats: stats
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

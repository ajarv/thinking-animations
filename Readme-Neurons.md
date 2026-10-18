# Paper Life — Neurons

A Paper.js animation of one life, from age 0 to 100, played out on a brain of 377 neurons. Age is not a clock. It is how much of the wiring has become knowledge. Sleep is not a switch. It arrives when too many thoughts are parked in temporary homes, and it ends when those thoughts have found permanent clusters.

Open `index.html` in a browser. The page loads Paper.js 0.12.17 from the CDN and then the scripts under `js/`.

## How the idea grew

The picture started as thoughts moving along axons. Each later rule answered a question about what a life actually does.

- Knowledge should thicken the axons it lives on, and it should arrive fast in youth and slow toward the end. Growth follows `cos(age°) − 0.0001`, with displayed age 0–100 mapped onto 0–90°.
- Knowledge centers answer an arriving thought with blue internal thoughts. When a red thought and a blue internal thought meet near a different center, the pair crystallizes there. After that, only thoughts that have not yet found a permanent home keep provoking internal thoughts. A fully settled mind is quiet.
- Thoughts enter from any border. Danger and attraction matter more than a walk in the park: they are larger, live longer, and are much more likely to find a home.
- Age comes from knowledge saturation, and the life ends at 80% saturation. Youth has weak filters and a high appetite for risk. Age strengthens the filters and lowers that appetite, because a familiar input is mostly routed to knowledge that already exists, and some of it is turned away at the border.
- Learning can be switched off. Thoughts still provoke counter-thoughts, but nothing is allowed to stop and become knowledge.
- Sleep reorganizes the day. A thought that has just found a temporary home turns orange and doubles in size. At night it detaches, still orange and doubled, and travels to a classified cluster at three times its daytime speed. On arrival it turns light green and shrinks back to the regular size of the thought that arrived. The temporary site thins; the permanent site thickens. The 21 categories are uneven: some are built to hold more thoughts than others.
- The brain decides for itself when to sleep. The whole screen follows the night: light blue on waking, light red as temporary homes pile up, light gray while those thoughts travel (REM sleep), pale green while they settle into clusters (deep sleep), then light blue again.

## The network

`js/network.js` builds the brain in grid space. One unit is one neuron cell, so the model does not depend on the window size. The renderer scales grid coordinates to pixels.

There are 29 columns and 13 rows, which is 377 neurons — the first Fibonacci number above 300. Each neuron is jittered slightly off its grid point so the mesh does not look mechanical. Axons are cubic Bézier curves:

- the first control point sits at 31% of the span plus a bend along the edge normal;
- the second sits at 69% minus a smaller opposite bend;
- the bend itself is `(hash − 0.5) × 0.72`.

An arc-length table of 20 steps backs `pointOnEdge`, so a thought moves at a steady speed along the curve rather than along the parameter.

The mesh is horizontal lanes, alternating diagonals, and vertical links. Every axon can be walked in either direction, which is what lets a thought enter from the left, right, top, or bottom border.

Twenty-one of the neurons are anchors, on a 7×3 lattice (columns 2, 6, 10, 14, 18, 22, 26 and rows 2, 6, 10). Each row is a family:

| Row | Family |
| --- | --- |
| Top | Danger |
| Middle | Attraction |
| Bottom | Everyday |

## Thoughts

External thoughts are born on a border neuron and travel inward along the axons. Three kinds are drawn:

| Kind | Share of births | Lifetime | Relative size | Urge to find a home |
| --- | --- | --- | --- | --- |
| Danger | 16% | 9–13 s | 1.8 | Strong |
| Attraction | 18% | 8–12 s | 1.6 | Strong |
| Everyday | the rest | 1.5–2.8 s | 0.62 | Weak |

Danger is deep red (`#c62828`), attraction is magenta (`#c2185b`), everyday thoughts are pale pink (`#ef9a9a`). Daytime speed is about `lerp(130, 205) / 72 × kind.speed` cells per second, so a thought crosses a few cells a second. Important thoughts are a little slower than everyday ones. A thought fades near the end of its lifetime, and it is removed if it reaches the far side or runs out of time.

While a thought is on a thickened stretch of axon it slows down. On a fully thick pathway it moves at 0.45 of its thin-axon speed, which is the visual of lingering in something already known.

### Internal thoughts

Blue internal thoughts (`#1d6fe3`) are caused. Nothing emits them merely because the brain is awake or asleep.

Two kinds of unsettled activity provoke them:

- An external thought, at the moment it enters, gets an initial answer: one to three knowledge centers emit a blue thought. Stronger centers are more likely to answer.
- Every thought that is temporarily homed, and every thought traveling to a permanent cluster, has its own timer. Once every 2.5–5.5 seconds (a bit sooner during sleep, about 0.72 of that wait) it provokes exactly one blue thought. The timers are staggered by the thought's identity, so a full pool does not fire on one frame. If the counter pool is full, that tick is skipped and the next one is scheduled anyway.

The provoked thought leaves either the unsettled thought's own site, or, about half the time once any permanent cluster exists, one of those clusters. It travels in a straight line and fades when its lifetime ends or when it leaves the screen. It never crystallizes on its own. It only becomes half of a crystal when it meets a still-traveling external thought near a center.

A thought that has settled stops its timer permanently. Settled green clusters do not emit.

The calm invariant: when no external thought is active, no thought is temporarily homed, and none is traveling, no new internal thoughts are created. Whatever is already in flight finishes its lifetime and the blue count falls to zero. Sleep does not add a pulse of its own. During a night the blue traffic tapers as orange thoughts arrive home and turn green.

### Crystallization

A red thought and a blue counter-thought that meet near a knowledge center — other than the center that emitted the counter — stop. The thought is removed from the axon and becomes a crystal at that center. Bigger thoughts reach farther. This is the temporary home.

The moment it homes, the thought turns orange (`#ff9800`, core `#fff3e0`) and is drawn at twice the bead size of the kind that arrived (`crystalScale` is 2). A small blue partner bead stays beside it, marking the internal thought that caught it. While learning is off, pairs never crystallize; both thoughts simply fade.

## Knowledge, age, and the end of a life

Axons thicken only during sleep, and only around the permanent clusters. A daytime thought can cross every axon in the brain, be filtered, find an orange temporary home, and provoke internal thoughts, and none of that changes `edge.strength`, plants a seed, or moves saturation. The temporary home remembers two things for the night: which neuron held it, and how much thickness it is carrying (`sleep.deposit`, smaller for an everyday thought, scaled by the cosine growth factor). That carry is not painted onto the axons.

Each axon starts bare. A seed covers a fraction of the axon that grows with strength, up to nearly the whole axon when the pathway is fully learned (`radius = 0.015 + 0.985 × strength^0.75`). Saturation is covered length divided by total axon length. While the brain is awake and nothing has been consolidated, saturation and age stay where the last night left them.

Once an axon at a permanent cluster is fully thick, further deposits stay capped there. They are not spread across the daytime network.

A neuron's strength is a blend of its strongest adjacent axon and the mean of its adjacent axons. Neurons above `centerMin` (0.07) are knowledge centers: they can emit counters and host crystals, and they darken from light to deep blue as they strengthen.

Age is `100 × peakSaturation / 0.8`. It uses the highest saturation ever reached, so a night of consolidation, which concentrates thickness and can lower coverage, never makes the brain younger. The life finishes when peak saturation reaches 80% (within 0.001). The picture holds for 3 seconds, the veil fades in, and a new life begins.

Growth follows the cosine of the mapped age, with a floor:

```
growth = max(0.2, cos(age × 0.9°) − 0.0001)
```

Youth is near 1, so seeds and reinforcement land quickly. The cosine would otherwise only approach zero as age approaches 100, and because age is itself saturation, a pure cosine never quite reaches 80%. The floor of 0.2 keeps late life slow without making the ending unreachable. In an awake-only run the life reaches 80% a little after 1,200 simulated seconds (about 20 minutes) and resets.

### Filters and risk

Filter strength rises with life progress (`smoothstep` from 4% to 96% of the way to the 80% limit). Risk affinity falls across the whole life.

- Young brains explore. They pick unfamiliar routes, seed new axons more often, and accept danger and attraction at the border.
- Older brains route important thoughts toward axons and centers they already know. Familiar danger and attraction can be recognized and rejected at the border; the recognition still reinforces the matching center, but the thought itself only flashes and fades. Everyday thoughts are not rejected this way.
- Lifetime shortens slightly with age (`lerp(0.75, 1, risk)`), and the chance of seeding a brand-new axon falls from the young chances (0.12 important, 0.07 everyday) toward 0.10.

## Learning

The status panel has one control: Learning on or off.

- On: thoughts can seed axons, reinforce them, and crystallize.
- Off: external thoughts still enter and still trigger counter-thoughts, but nothing stops at a center and no axon thickens. Everything fades at the end of its lifetime or at the boundary.

`?learn=0` starts the page with learning off.

## Sleep, decided by the brain

There is no awake/sleep switch. The simulation counts temporarily homed crystals and turns that count into a need from 0 to 1:

```
need = clamp(temporaryCount / threshold, 0, 1)
threshold = round(0.38 × crystal pool) = 143
```

The crystal pool holds 377 memories, one per neuron. Sleep begins when need reaches 1, that is when 143 thoughts are sitting in temporary homes, provided the brain has been awake for at least 8 seconds. In a measured run the first sleep starts at about 59 seconds, at age 33.

During sleep:

- no external thoughts enter;
- internal thoughts continue only from thoughts that are still temporary or traveling, on the same per-thought timer (slightly shorter at night);
- temporary crystals detach, oldest first, about six per second;
- each one classifies itself and flies to one of the 21 anchors.

Classification prefers the family that matches the thought (danger, attraction, everyday), and within that choice it joins the category furthest below its weighted share. The seven weights repeat down the three family rows: 0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4. The largest holds about three times the smallest. Distance is only a tie-breaker. During deep sleep, a thought moves from the category furthest over its target to the one furthest under it, and only while that gap is at least one thought. The clusters are not meant to end up the same size.

Each category also has a domain, a circumference around its anchor. Thickness during sleep is applied inside that domain, starting at the anchor. When a neuron there becomes fully thick, the circumference grows to contain it and the adjoining neurons begin to thicken on later sleep steps. Two domains never claim the same neuron; the nearer anchor keeps it. Neurons outside every domain stay bare.

### Orange on the way, light green at home

A detached thought stays orange and doubled in size while it travels. Its speed is three times the daytime speed of the thought that originally arrived (`travelMultiplier` is 3). It steers toward its anchor with a little wobble, and it bounces inside the brain rather than leaving it. A headless run measured the travel speed ratio at 2.999, with zero travelers outside the grid.

On arrival the thought turns light green — bead `#81c784`, pale core `#e8f5e9`, edge `#43a047` — and shrinks back to exactly the regular size of the kind that arrived. Danger stays larger than attraction, which stays larger than an everyday thought; the temporary enlargement is over. The scale eases down in about a quarter of a second. The thought then sits on a golden-angle spiral around the anchor. The anchor is marked with a green dashed ring (`#2e7d32`) that brightens while the brain is asleep. Its internal-thought timer stops.

Thickness moves with the thought, and this is the only moment axons grow. The crystal already carries the thickness it earned during the day. If the temporary site has committed axon strength from an earlier night, a share of that is drained as well (`loss` 0.05, split across the seeded axons; an axon that drops below 0.004 is erased). The permanent anchor receives the carried daytime thickness, the drained strength, and a small consolidation bonus, planted on the axon ends nearest the anchor. Saturation and age can rise from that. They do not rise from the day's traffic. Peak saturation still never falls, so a night that concentrates wiring cannot make the brain younger.

If one cluster gets more than one member ahead of another, the newest settled member detaches and travels to the smaller cluster. Rebalancing repeats every 0.6 seconds until the spread is at most 1. Seeds also drift toward the stronger end of their axon, so knowledge gathers at neurons instead of floating mid-path.

### Waking

REM sleep is the gray phase, while thoughts are still detaching and traveling. Its simulated duration is recorded when that travel is largely finished. Deep sleep, the pale green phase, then lasts the same simulated length, to within one frame (1/60 second). Waking happens at that matched endpoint, not earlier, even if the clusters settled sooner. Any thought still loose at that instant is placed in its weighted category before the screen returns to blue, so deep sleep is never extended and the morning does not begin with travelers still out. `snapshot()` reports `remDuration`, `deepDuration`, `deepTarget`, and `phaseElapsed`.

After waking, the temporary count is 0, so sleep cannot start again until a fresh set of 143 homes accumulates. That takes about 50 seconds of waking life, and `minAwake` is a second guard against an immediate return to sleep. When the pool is full, the oldest settled memories fade to make room for new temporary homes, which is what lets the next night happen.

Each night's gray REM and pale-green deep sleep are the same simulated length. The categories underneath are the weights 0.7, 1.5, 1.0, 1.8, 1.2, 0.6, 1.4, repeated for danger, attraction, and everyday thoughts. A finished night leaves the larger weights with more permanent thoughts than the smaller ones.

## What the background is saying

The background is one radial gradient for the whole screen. It eases toward the color of the current phase over roughly a second and a half to two seconds (`1 − e^(−dt/0.55)`), so a change of phase is a fade rather than a cut. A time jump, such as `?t=`, snaps to the color that moment deserves. The phase and its blend are on `snapshot()` as `phase` and `phaseBlend`.

The cycle, in order:

| Phase | Center | Edge | Meaning |
| --- | --- | --- | --- |
| `awake` | `#f6fbff` | `#d8eaf7` | Light blue. Freshly awake, need still low. |
| `sleep-needed` | toward `#fff1f1` | toward `#f6d5d5` | Light red. The blend is the sleep need itself, and it is fully red when need reaches 1, just as sleep starts. |
| `rem` | `#f4f4f6` | `#e2e2e6` | Light gray. Thoughts are detaching and traveling to permanent homes. The panel says "REM sleep". |
| `deep` | `#edf8ef` | `#d7eedb` | Pale green, held for the same simulated duration as the REM phase just finished. Clusters finish settling and domains thicken. The panel shows that matched length. |
| `waking` | back toward `#f6fbff` | back toward `#d8eaf7` | Reorganization is done. Over about two seconds the pale green returns to light blue, and the phase becomes `awake` again. |

The status panel names the phase. While awake it fills with sleep need. During REM and deep sleep it shows how much of the night's travel is left, along with a line such as "73 settled · 7 traveling · 71 waiting · 21/21 clusters".

## Visual legend

| Mark | Meaning |
| --- | --- |
| Deep red bead | Danger, still traveling |
| Magenta bead | Attraction, still traveling |
| Pale pink bead | Everyday thought, still traveling |
| Small blue bead | Counter-thought |
| Large orange bead | Temporarily homed, or traveling to a permanent cluster (2×) |
| Light green bead, regular size | Settled in a permanent cluster (1× its kind) |
| Green dashed ring | One of the 21 anchors |
| Dark blue axon segment | Knowledge. Longer and darker means stronger. |
| Light blue background | Awake, or just waking |
| Light red background | Sleep needed badly |
| Light gray background | REM sleep, thoughts traveling |
| Pale green background | Deep sleep, clusters settling |

## Controls and parameters

The only radio control is Learning on/off.

URL parameters:

| Parameter | Effect |
| --- | --- |
| `t=N` | Start N simulated seconds into a life. Sleep will already have happened if N is past a threshold. |
| `still=1` | Draw that frame and do not animate. |
| `learn=0` | Start with learning off. |
| `diag=1` | Write `stats()` JSON into a hidden `<pre id="diag">`. |

`sleep` and `nap` are not parameters. Sleep is automatic, so those names do nothing.

`window.__life` exposes:

| Method | Effect |
| --- | --- |
| `seek(seconds)` | Reset and run forward to that time. |
| `resume(seconds)` | Run forward from the current time. |
| `freeze(on)` | Stop or resume the animation clock. |
| `setLearning(on)` | Learning on or off. |
| `time()` | Current simulated time. |
| `stats()` | Saturation, age, sleep need, cluster sizes, travel speed ratio, and the other counters. |

Reduced motion starts the page frozen at 55 seconds unless `t` is set.

## Files

| File | Owns |
| --- | --- |
| `index.html` | The canvas, the status panel, the script order. |
| `styles.css` | The panel, the sleep-need bar, the between-lives veil. |
| `js/config.js` | Every tunable number and color. |
| `js/util.js` | `clamp`, `lerp`, `smoothstep`, `hash`, `mulberry32`. |
| `js/network.js` | The 377 neurons, the axons, the 21 anchors. |
| `js/simulation.js` | Thoughts, counters, crystals, saturation, age, and the sleep cycle. |
| `js/renderer.js` | Paper.js drawing. Grid units in, pixels out. |
| `js/hud.js` | The status panel and the Learning control. |
| `js/main.js` | Setup, resize, URL parameters, `window.__life`. |

Each script attaches to `window.PaperLife` and is wrapped so it can also be loaded under Node's `vm` for headless checks. The model never reads the viewport. `renderer.js` is the only file that knows about pixels.

## Tuning

All of these live in `js/config.js`.

| Key | Value | Role |
| --- | --- | --- |
| `cols`, `rows` | 29 × 13 | 377 neurons |
| `pools.crystals` | 377 | Memory. Oldest settled memories fade when it is full. |
| `life.saturationLimit` | 0.8 | The life ends here. |
| `life.growthFloor` | 0.2 | Late-life learning. Stops the cosine from stalling below 80%. |
| `spawnRate` | 11 / s | External thoughts while awake. |
| `internal.intervalMin`, `intervalMax` | 2.5 s, 5.5 s | How often one unsettled thought provokes an internal thought. |
| `internal.sleepScale` | 0.72 | Shorter wait during sleep. Sleep itself emits nothing. |
| `sleep.needThreshold` | 0.38 | Share of the pool that forces sleep. 143 thoughts. |
| `sleep.wakeResidue` | 2 | Temporary homes still allowed at waking. |
| `sleep.minAwake`, `minSleep` | 8 s, 3 s | Hysteresis. The cycle cannot flicker. |
| `sleep.migrationRate` | 6 / s | How fast temporary homes detach. |
| `sleep.travelMultiplier` | 3 | Night travel versus daytime speed. |
| `sleep.deposit` | 0.36 | Thickness carried by a temporary home and applied at its permanent cluster during sleep. Everyday thoughts carry 0.45 of this. |
| `crystalScale` | 2 | Homed and settled beads versus the arriving thought. |
| `learning.reinforce` | 0.18 | Strength added when a thought crosses its seed. |
| `learning.thickSlowdown` | 0.45 | Speed on a fully learned axon. |
| `learning.rejectMin`, `rejectMax` | 0.15, 0.55 | Border rejection of familiar danger and attraction. |

## Known limits

Reaching 80% takes about 20 simulated minutes in an awake-only run, and longer when nights are included, because a night concentrates thickness and pauses external learning. Age never falls, because it follows peak saturation. The growth floor is what makes the ending reachable; without it the cosine and the saturation-derived age approach 80% and never arrive.

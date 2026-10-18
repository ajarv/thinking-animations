(function (root) {
  'use strict';
  const PL = root.PaperLife = root.PaperLife || {};

  // The status panel: saturation, age, life stage, the automatic sleep state,
  // the lust-for-learning slider, and the between-lives veil.
  PL.createHud = function (config, handlers) {
    const U = PL.util;
    const byId = function (id) { return document.getElementById(id); };
    const kVal = byId('kVal');
    const kFill = byId('kFill');
    const aVal = byId('aVal');
    const aFill = byId('aFill');
    const aBar = byId('aBar');
    const stageName = byId('stageName');
    const clusterInfo = byId('clusterInfo');
    const waveNote = byId('waveNote');
    const veil = byId('veil');
    const stateVal = byId('stateVal');
    const needFill = byId('needFill');
    const bands = config.ageBands;

    bands.slice(0, -1).forEach(function (band) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = band.max + '%';
      aBar.appendChild(tick);
    });

    function stage(age) {
      for (let i = 0; i < bands.length; i++) {
        if (age < bands[i].max) return bands[i].name;
      }
      return bands[bands.length - 1].name;
    }

    const lustInput = byId('lust');
    const lustVal = byId('lustVal');
    const hud = byId('hud');
    const hideButton = byId('hideControls');
    const showButton = byId('showControls');
    const STORE = 'paperLife.hudHidden';
    let dragging = false;
    let hidden = true;
    let pending = null;

    function storedHidden() {
      try {
        const value = root.localStorage.getItem(STORE);
        if (value === null) return true;
        return value === '1';
      } catch (err) {
        return true;
      }
    }

    function remember(isHidden) {
      try {
        root.localStorage.setItem(STORE, isHidden ? '1' : '0');
      } catch (err) {}
    }

    function applyHidden(isHidden) {
      hidden = isHidden;
      if (hud) hud.classList.toggle('is-hidden', isHidden);
      if (showButton) {
        showButton.classList.toggle('is-on', isHidden);
        showButton.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
      }
      if (hideButton) hideButton.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
      if (!isHidden && pending) {
        const snap = pending;
        pending = null;
        update(snap);
      }
    }

    // The box starts hidden. A saved choice is kept. ?hud=0 or ?hud=1
    // overrides that choice for this load only.
    (function decide() {
      const params = new URLSearchParams(root.location.search);
      const query = params.get('hud');
      if (query === '0') applyHidden(true);
      else if (query === '1') applyHidden(false);
      else applyHidden(storedHidden());
    })();

    if (hideButton) {
      hideButton.addEventListener('click', function () {
        applyHidden(true);
        remember(true);
        if (showButton) showButton.focus();
      });
    }
    if (showButton) {
      showButton.addEventListener('click', function () {
        applyHidden(false);
        remember(false);
        if (hideButton) hideButton.focus();
      });
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (handlers.onLustRelease) handlers.onLustRelease();
    }

    if (lustInput) {
      lustInput.addEventListener('pointerdown', function () {
        dragging = true;
        if (handlers.onLustHold) handlers.onLustHold(Number(lustInput.value));
      });
      lustInput.addEventListener('input', function () {
        lustVal.textContent = lustInput.value;
        if (dragging && handlers.onLustHold) handlers.onLustHold(Number(lustInput.value));
      });
      lustInput.addEventListener('pointerup', endDrag);
      lustInput.addEventListener('pointercancel', endDrag);
    }
    document.addEventListener('pointerup', endDrag);

    function update(snap) {
      let fade = 0;
      if (snap.finishedAt >= 0) {
        fade = U.smoothstep(snap.hold - 0.9, snap.hold, snap.time - snap.finishedAt);
      } else if (snap.time < 0.6) {
        fade = 1 - U.smoothstep(0, 0.6, snap.time);
      }
      veil.style.opacity = fade.toFixed(3);

      if (hidden) {
        pending = snap;
        return;
      }
      pending = null;

      const percent = Math.round(snap.saturation * 100);
      const age = Math.floor(snap.age);
      kVal.textContent = percent + '%';
      kFill.style.width = percent + '%';
      aVal.textContent = age + (age === 1 ? ' yr' : ' yrs');
      aFill.style.width = (snap.age / config.life.maxAge * 100) + '%';
      stageName.textContent = snap.finishedAt >= 0 ? 'Life complete' : stage(snap.age);

      const phase = snap.phase || 'awake';
      needFill.className = 'fill ' + phase;
      const phaseLabel = {
        awake: 'Awake',
        'sleep-needed': 'Needs sleep',
        rem: 'REM sleep',
        deep: 'Deep sleep',
        waking: 'Waking'
      };
      if (phase === 'rem') {
        stateVal.textContent = 'REM sleep · ' + snap.phaseElapsed.toFixed(1) + 's';
      } else if (phase === 'deep') {
        stateVal.textContent = 'Deep sleep · ' + snap.deepTarget.toFixed(1) + 's';
      } else {
        stateVal.textContent = phaseLabel[phase] || 'Awake';
      }
      if (phase === 'rem' || phase === 'deep') {
        needFill.style.width = ((1 - snap.reorganized) * 100) + '%';
        clusterInfo.textContent = snap.settled + ' settled · ' + snap.wandering + ' traveling · ' +
          snap.temporary + ' waiting · ' + snap.clusters + '/21 clusters';
      } else if (phase === 'waking') {
        needFill.style.width = ((1 - snap.phaseBlend) * 100) + '%';
        clusterInfo.textContent = snap.settled + ' settled · waking';
      } else {
        needFill.style.width = (snap.need * 100) + '%';
        clusterInfo.textContent = snap.temporary + '/' + snap.sleepThreshold +
          ' temporarily homed · ' + snap.settled + ' settled';
      }

      if (waveNote) {
        const events = snap.waves || [];
        let reward = false;
        let stress = false;
        for (let i = 0; i < events.length; i++) {
          if (events[i].type === 'reward') reward = true;
          else if (events[i].type === 'stress') stress = true;
        }
        if (reward && stress) {
          waveNote.textContent = 'Reward response · Stress response';
          waveNote.className = 'both';
        } else if (reward) {
          waveNote.textContent = 'Reward response';
          waveNote.className = 'reward';
        } else if (stress) {
          waveNote.textContent = 'Stress response';
          waveNote.className = 'stress';
        } else {
          waveNote.textContent = '';
          waveNote.className = '';
        }
      }

      if (lustInput && !dragging && snap.lust !== undefined) {
        const shown = Math.round(snap.lust);
        lustInput.value = String(shown);
        lustVal.textContent = String(shown);
      }
    }

    return { update: update };
  };
})(typeof window !== 'undefined' ? window : globalThis);

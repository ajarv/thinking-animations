(function (root) {
  'use strict';
  const B3 = root.Brain3D = root.Brain3D || {};

  B3.createHud = function (config, simulation) {
    const byId = function (id) { return document.getElementById(id); };
    const kVal = byId('kVal');
    const kFill = byId('kFill');
    const aVal = byId('aVal');
    const aFill = byId('aFill');
    const aBar = byId('aBar');
    const stageName = byId('stageName');
    const stateVal = byId('stateVal');
    const needFill = byId('needFill');
    const clusterInfo = byId('clusterInfo');
    const hud = byId('hud');
    const hideButton = byId('hideControls');
    const showButton = byId('showControls');
    const bands = config.ageBands || [];
    const STORE = 'brain3d.hudHidden';

    bands.slice(0, -1).forEach(function (band) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = (band.max / config.spin.maxAge * 100) + '%';
      aBar.appendChild(tick);
    });

    function stage(age) {
      for (let i = 0; i < bands.length; i++) {
        if (age < bands[i].max) return bands[i].name;
      }
      return bands.length ? bands[bands.length - 1].name : '';
    }

    function phaseText() {
      if (simulation.lifeComplete) return 'Life complete';
      if (simulation.phase === 'awake') return 'Fresh awake';
      if (simulation.phase === 'sleep-needed') return 'Overloaded';
      if (simulation.phase === 'stage1') return 'Winding down';
      if (simulation.phase === 'rem') return 'REM sleep';
      if (simulation.phase === 'deep') return 'Deep sleep';
      if (simulation.phase === 'waking') return 'Waking';
      return simulation.phase;
    }

    function sensationText() {
      const item = simulation.external;
      if (!item.active) return '';
      if (item.state === 'approaching') return ' · sensation approaching';
      if (item.state === 'received') return ' · sensation received';
      if (item.distress) return ' · distress response';
      if (item.accepted) return ' · sensation accepted';
      return '';
    }

    function applyHidden(isHidden) {
      if (hud) hud.classList.toggle('is-hidden', isHidden);
      if (showButton) {
        showButton.classList.toggle('is-on', isHidden);
        showButton.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
      }
      if (hideButton) hideButton.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    }

    function remember(isHidden) {
      try { root.localStorage.setItem(STORE, isHidden ? '1' : '0'); } catch (err) {}
    }

    (function decide() {
      const query = new URLSearchParams(root.location.search).get('hud');
      if (query === '0') applyHidden(true);
      else if (query === '1') applyHidden(false);
      else {
        let stored = null;
        try { stored = root.localStorage.getItem(STORE); } catch (err) {}
        applyHidden(stored === '1');
      }
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

    function update() {
      if (!kVal || (hud && hud.classList.contains('is-hidden'))) return;
      const percent = Math.round(simulation.saturation * 100);
      const age = Math.floor(simulation.age);
      const housed = simulation.stats.housed;
      const moving = simulation.activeInternals() + (simulation.external.active ? 1 : 0);
      kVal.textContent = percent + '%';
      kFill.style.width = Math.min(100, percent) + '%';
      aVal.textContent = age + (age === 1 ? ' yr' : ' yrs');
      aFill.style.width = Math.min(100, simulation.age / config.spin.maxAge * 100) + '%';
      stageName.textContent = simulation.lifeComplete ? 'Life complete' : stage(simulation.age);
      stateVal.textContent = phaseText();
      needFill.className = 'fill ' + (simulation.phase || 'awake');
      if (simulation.phase === 'rem' || simulation.phase === 'deep' || simulation.phase === 'stage1') {
        needFill.style.width = '100%';
      } else if (simulation.phase === 'waking') {
        needFill.style.width = ((1 - simulation.phaseBlend) * 100) + '%';
      } else {
        needFill.style.width = (simulation.need * 100) + '%';
      }
      clusterInfo.textContent = housed + ' housed · ' + moving + ' moving · ' +
        simulation.yearsPerMinute.toFixed(1) + ' years/min' + sensationText();
    }

    return { update: update };
  };
})(typeof window !== 'undefined' ? window : globalThis);

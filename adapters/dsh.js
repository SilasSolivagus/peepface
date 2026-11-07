/* peepface × DSH 适配层
 * 依赖 window.peepface.createFace（由 core.js 提供）
 * 负责：状态判定、拖拽、位置记忆、主题
 */
(function (root) {
  'use strict';

  var POS_KEY = 'peepface:pos';
  var SIZE = 84;

  /* ---------- 主题 ---------- */
  var RGB = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s\/]+([\d.]+))?\)/;

  function parseRGB(str) {
    var m = RGB.exec(str || '');
    if (!m) return null;
    if (m[4] !== undefined && +m[4] <= 0.5) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

  function pageDark() {
    var nodes = [document.body, document.documentElement];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i]) continue;
      var c = parseRGB(getComputedStyle(nodes[i]).backgroundColor);
      if (c) return lum(c) < 110;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ---------- 拖拽 ---------- */
  function clampPos(x, y) {
    var maxX = Math.max(0, window.innerWidth - SIZE - 4);
    var maxY = Math.max(0, window.innerHeight - SIZE - 4);
    return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
  }

  function attachDrag(host, onTap) {
    function place(x, y) {
      host.style.left = x + 'px';
      host.style.top = y + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }

    try {
      var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && typeof saved.x === 'number') {
        var xy = clampPos(saved.x, saved.y);
        place(xy[0], xy[1]);
      }
    } catch (e) {}

    var dragging = false, gx = 0, gy = 0, travel = 0;

    host.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var r = host.getBoundingClientRect();
      gx = e.clientX - r.left;
      gy = e.clientY - r.top;
      dragging = true;
      travel = 0;
      try { host.setPointerCapture(e.pointerId); } catch (_) {}
    });

    host.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      travel += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      var p = clampPos(e.clientX - gx, e.clientY - gy);
      place(p[0], p[1]);
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      try { host.releasePointerCapture(e.pointerId); } catch (_) {}
      if (travel < 6) {
        onTap();
      } else {
        var r = host.getBoundingClientRect();
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
        } catch (_) {}
      }
    }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);

    window.addEventListener('resize', function () {
      if (!host.style.left) return;
      var r = host.getBoundingClientRect();
      var p = clampPos(r.left, r.top);
      place(p[0], p[1]);
    });
  }

  /* ---------- 状态判定 ---------- */

  var MANUAL_ORDER = ['idle', 'listening', 'thinking', 'searching', 'streaming', 'working', 'finished'];

  function startProbe(face) {
    var probe = { lastMut: 0, rate: 0, failedUntil: 0, finishedUntil: 0, searchUntil: 0, waitUntil: 0, lastError: false };
    var net = { last: 0, lastPost: 0, lastErr: 0, events: [] };
    var fresh = { text: '', at: 0 };
    var lastTextChange = 0, lastBusyAt = 0, lastKeyAt = 0, wokeUntil = 0;
    var pending = null, pendingCount = 0;
    var manualUntil = 0;

    var bodyText = function () { return document.body ? (document.body.innerText || '') : ''; };
    var prevLen = bodyText().length, prevT = performance.now();

    var ERROR_RE = /(失败|错误|异常|Error|Failed)/;
    var SEARCH_RE = /(web_search|web_fetch|\bgrep\b|\bglob\b|\bbrowse\b|检索|搜索结果|正在搜索|读取目录)/i;
    var APPROVAL_RE = /(批准|允许|拒绝|同意执行|需要你确认|等待确认|Approve|Deny|Allow once)/i;

    function markNet() {
      var t = performance.now();
      net.last = t;
      net.events.push(t);
      if (net.events.length > 80) net.events.shift();
    }
    function pushFresh(str) {
      if (!str) return;
      fresh.text = (fresh.text + ' ' + str).slice(-3000);
      fresh.at = performance.now();
    }

    var mo = new MutationObserver(function (muts) {
      probe.lastMut = performance.now();
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') pushFresh(m.target.data);
        else if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1 || n.nodeType === 3) pushFresh(n.textContent);
          }
        }
      }
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    /* 网络：只用来判断「有在途请求」，不作为工作状态的主信号 */
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        markNet();
        var p = origFetch.apply(this, arguments);
        if (p && typeof p.then === 'function') {
          p.then(function (res) {
            markNet();
            if (!res.ok) net.lastErr = performance.now();
          }, function () {
            net.lastErr = performance.now();
            markNet();
          });
        }
        return p;
      };
    }

    ['WebSocket', 'EventSource'].forEach(function (key) {
      var Orig = window[key];
      if (!Orig) return;
      try {
        window[key] = new Proxy(Orig, {
          construct: function (t, args) {
            var inst = new t(...args);
            try { inst.addEventListener('message', markNet); } catch (e) {}
            return inst;
          }
        });
      } catch (e) {}
    });

    document.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Enter' || e.shiftKey) return;
      var t = e.target;
      if (!t) return;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable === true) {
        lastKeyAt = performance.now();
        net.lastPost = lastKeyAt;
      } else {
        lastKeyAt = performance.now();
      }
    }, true);
    document.addEventListener('keydown', function () { lastKeyAt = performance.now(); }, true);

    function inputHasText() {
      var a = document.activeElement;
      if (!a) return false;
      if (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') return (a.value || '').trim().length > 0;
      if (a.isContentEditable) return (a.innerText || '').trim().length > 0;
      return false;
    }

    /* 迟滞：连续 3 次一致才切；finished / failed 例外 */
    function commit(next) {
      if (next === 'finished' || next === 'failed') {
        if (face.getState() !== next) face.setState(next);
        pending = null; pendingCount = 0;
        return;
      }
      if (next === face.getState()) { pending = null; pendingCount = 0; return; }
      if (pending === next) {
        if (++pendingCount >= 3) {
          face.setState(next);
          pending = null; pendingCount = 0;
        }
      } else {
        pending = next; pendingCount = 1;
      }
    }

    var timer = setInterval(function () {
      var now = performance.now();
      var text = bodyText();
      var len = text.length;
      var dt = Math.max(0.001, (now - prevT) / 1000);
      if (len !== prevLen) lastTextChange = now;
      var inst = (len - prevLen) / dt;
      probe.rate = probe.rate * 0.55 + inst * 0.45;
      prevLen = len; prevT = now;

      if (now - probe.lastMut < 400) {
        var hit = ERROR_RE.test(text.slice(-240));
        if (hit && !probe.lastError) probe.failedUntil = now + 2600;
        probe.lastError = hit;
      }

      if (fresh.text && now - fresh.at < 1500) {
        if (SEARCH_RE.test(fresh.text)) probe.searchUntil = now + 3000;
        if (APPROVAL_RE.test(fresh.text)) probe.waitUntil = now + 4000;
        fresh.text = '';
      }

      var idleFor = now - lastTextChange;

      if (idleFor > 300000 && face.getState() !== 'sleeping' && face.getState() !== 'waking') {
        wokeUntil = 0;
        commit('sleeping');
        return;
      }
      if (face.getState() === 'sleeping' && idleFor < 1500) wokeUntil = now + 2000;

      if (now < manualUntil) return;

      if (wokeUntil && now < wokeUntil) { commit('waking'); return; }

      var textFlowing = now - lastTextChange < 1400 && probe.rate > 2;
      var typing = now - lastKeyAt < 3000 && inputHasText();
      var justSent = now - net.lastPost < 2000 && now - lastKeyAt < 2000;

      var next = 'idle';
      if (now < probe.failedUntil) next = 'failed';
      else if (now < probe.waitUntil) next = 'waiting';
      else if (now < probe.finishedUntil) next = 'finished';
      else if (now < probe.searchUntil) next = 'searching';
      else if (probe.rate > 55) { next = 'streaming'; lastBusyAt = now; }
      else if (textFlowing) { next = 'working'; lastBusyAt = now; }
      else if (typing) next = 'listening';
      else if (justSent && probe.rate < 1) next = 'thinking';
      else if (idleFor > 1400 && now - lastBusyAt < 8000) {
        probe.finishedUntil = now + 1800;
        next = 'finished';
      }

      commit(next);
    }, 200);

    return {
      tap: function () {
        var cur = face.getState();
        var i = MANUAL_ORDER.indexOf(cur);
        face.setState(MANUAL_ORDER[(i + 1) % MANUAL_ORDER.length] || 'idle');
        manualUntil = performance.now() + 4000;
      },
      stop: function () {
        clearInterval(timer);
        try { mo.disconnect(); } catch (e) {}
      }
    };
  }

  /* ---------- 挂载 ---------- */

  function mount(container) {
    if (!root.peepface) {
      console.error('[peepface] core.js 未加载');
      return function () {};
    }
    if (document.getElementById('peepface-root')) return function () {};

    var host = document.createElement('div');
    host.id = 'peepface-root';
    host.style.cssText = 'position:fixed;right:22px;bottom:96px;z-index:2147483000;';
    (container || document.body).appendChild(host);

    var face = root.peepface.createFace(host, {
      state: 'idle',
      size: SIZE,
      dark: pageDark(),
      follow: true,
    });

    var probe = startProbe(face);
    attachDrag(host, probe.tap);

    return function () {
      probe.stop();
      face.destroy();
      try { host.remove(); } catch (e) {}
    };
  }

  root.__peepfaceDsh = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);

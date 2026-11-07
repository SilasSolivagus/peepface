/* peepface v2 · DSH 适配器
 *
 * v1 的探测层直接产出「状态」，一堆 if-else 优先级链。
 * v2 只产出「事实」，判断交给 resolveFacts()。
 *
 * 好处：DSH 哪天暴露真实状态，只换数据源，判断逻辑一行不动。
 */

(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  var api = (root.peepface = root.peepface || {});

  /* ---------- 颜色工具 ---------- */

  function parseRGB(str) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(str || '');
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }
  function lum(c) {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  }
  function pageDark() {
    try {
      var bg = getComputedStyle(document.body).backgroundColor;
      var c = parseRGB(bg);
      if (c) return lum(c) < 128;
      var scheme = getComputedStyle(document.documentElement).colorScheme || '';
      return scheme.indexOf('dark') >= 0;
    } catch (e) {
      return true;
    }
  }

  /* ---------- 拖拽 ---------- */

  function attachDrag(host, onTap) {
    var KEY = 'peepface:pos';
    var drag = null;

    function place(x, y) {
      var w = host.offsetWidth || 96;
      var h = host.offsetHeight || 96;
      var maxX = innerWidth - w - 12;
      var maxY = innerHeight - h - 12;
      x = Math.max(12, Math.min(maxX, x));
      y = Math.max(12, Math.min(maxY, y));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      return { x: x, y: y };
    }

    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved.x === 'number') place(saved.x, saved.y);
      else place(innerWidth - 120, innerHeight - 140);
    } catch (e) {
      place(innerWidth - 120, innerHeight - 140);
    }

    host.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false, sl: host.offsetLeft, st: host.offsetTop };
      host.setPointerCapture(e.pointerId);
      host.style.cursor = 'grabbing';
    });

    host.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true;
      if (drag.moved) place(drag.sl + dx, drag.st + dy);
    });

    function end(e) {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      host.style.cursor = 'grab';
      try {
        localStorage.setItem(KEY, JSON.stringify({ x: host.offsetLeft, y: host.offsetTop }));
      } catch (err) {}
      if (!moved && onTap) onTap();
    }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  }

  /* ---------- 事实收集 ---------- */

  function startProbe(face) {
    var state = {
      lastTextChange: performance.now(),
      lastKeyAt: 0,
      lastPostAt: 0,
      prevLen: 0,
      rate: 0,
      prevT: performance.now(),
      fresh: '',
      freshAt: 0,
      failedAt: 0,
      finishedAt: 0,
      searchUntil: 0,
      awaitingUntil: 0,
      wokeUntil: 0,
      asleep: false,
      manualUntil: 0,
    };

    var ERROR_RE = /(失败|错误|异常|Error|Failed)/;
    var SEARCH_RE = /(web_search|web_fetch|\bgrep\b|\bglob\b|\bbrowse\b|检索|搜索结果|正在搜索|读取目录)/i;
    var APPROVAL_RE = /(批准|允许|拒绝|同意执行|需要你确认|等待确认|Approve|Deny|Allow once)/i;

    state.prevLen = (document.body.innerText || '').length;

    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') state.fresh += ' ' + m.target.data;
        else if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1 || n.nodeType === 3) state.fresh += ' ' + (n.textContent || '');
          }
        }
      }
      state.fresh = state.fresh.slice(-3000);
      state.freshAt = performance.now();
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });

    function onKey(e) {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        state.lastKeyAt = performance.now();
        state.lastPostAt = performance.now();
        state.wokeUntil = performance.now() + 2200;
        state.asleep = false;
      } else {
        state.lastKeyAt = performance.now();
      }
    }
    document.addEventListener('keydown', onKey, true);

    function inputHasText() {
      var a = document.activeElement;
      if (!a) return false;
      if (a.tagName === 'TEXTAREA') return (a.value || '').trim().length > 0;
      if (a.isContentEditable) return (a.innerText || '').trim().length > 0;
      return false;
    }

    function collect(now) {
      var idleFor = now - state.lastTextChange;
      var textFlowing = now - state.lastTextChange < 1400 && state.rate > 2;
      var typing = now - state.lastKeyAt < 3000 && inputHasText();

      var facts = {
        running: textFlowing || typing,
        composing: state.rate > 55,
        activity: null,
        awaiting: null,
        settlement: null,
      };

      if (now < state.searchUntil) {
        facts.activity = { kind: 'searching' };
        facts.running = true;
      } else if (textFlowing) {
        facts.activity = { kind: 'working' };
      }

      if (now < state.awaitingUntil) {
        facts.awaiting = { reason: 'approval' };
      }

      if (now < state.failedAt + 2600) {
        facts.settlement = { outcome: 'error', at: state.failedAt };
      } else if (now < state.finishedAt + 1800) {
        facts.settlement = { outcome: 'success', at: state.finishedAt };
      }

      return facts;
    }

    var timer = setInterval(function () {
      var now = performance.now();

      /* --- 观察 --- */
      var text = document.body.innerText || '';
      var dt = Math.max(0.001, (now - state.prevT) / 1000);
      if (text.length !== state.prevLen) state.lastTextChange = now;
      var inst = (text.length - state.prevLen) / dt;
      state.rate = state.rate * 0.55 + inst * 0.45;
      state.prevLen = text.length;
      state.prevT = now;

      /* 错误只认新鲜的 */
      if (state.fresh && now - state.freshAt < 1500) {
        var tail = text.slice(-240);
        if (ERROR_RE.test(tail) && state.failedAt < now - 3000) state.failedAt = now;
        if (SEARCH_RE.test(state.fresh)) state.searchUntil = now + 3000;
        if (APPROVAL_RE.test(state.fresh)) state.awaitingUntil = now + 4000;
        state.fresh = '';
      }

      /* 休眠：单独处理，不属于 facts */
      var idleFor = now - state.lastTextChange;
      if (idleFor > 300000) state.asleep = true;
      if (state.asleep) {
        if (idleFor < 1500) {
          state.asleep = false;
          state.wokeUntil = now + 2200;
        } else {
          face.state('sleeping');
          return;
        }
      }
      if (now < state.wokeUntil) {
        face.state('waking');
        return;
      }

      if (now < state.manualUntil) return;

      /* 一轮结束 → 记一个 settlement */
      var wasBusy = now - state.lastTextChange < 3000;
      if (wasBusy) state.lastBusyAt = now;
      if (
        !wasBusy &&
        state.lastBusyAt &&
        now - state.lastBusyAt < 8000 &&
        now - state.lastBusyAt > 1400 &&
        state.finishedAt < state.lastBusyAt
      ) {
        state.finishedAt = now;
      }

      /* --- 判断交给协议 --- */
      face.sync(collect(now));
    }, 200);

    return {
      tap: function () {
        var order = ['idle', 'listening', 'thinking', 'searching', 'streaming', 'working', 'finished'];
        var cur = face.state ? undefined : undefined;
        var i = order.indexOf(window.__peepfaceLast || 'idle');
        var next = order[(i + 1) % order.length];
        window.__peepfaceLast = next;
        face.state(next);
        state.manualUntil = performance.now() + 4000;
      },
      stop: function () {
        clearInterval(timer);
        try { mo.disconnect(); } catch (e) {}
        document.removeEventListener('keydown', onKey, true);
      },
    };
  }

  /* ---------- 设置面板 ---------- */

  var CFG_KEY = 'peepface:config';

  function loadConfig() {
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function buildPanel(face, host, onChange) {
    var cfg = loadConfig() || {};
    var wrap = document.createElement('div');
    wrap.id = 'peepface-panel';

    var dark = pageDark();
    var bg = dark ? '#14141a' : '#ffffff';
    var fg = dark ? '#ececef' : '#111114';
    var line = dark ? '#26262c' : '#e6e6e2';
    var dim = dark ? '#71717a' : '#8a8a92';

    wrap.style.cssText = [
      'position:fixed', 'z-index:2147483001',
      'width:308px', 'max-height:70vh', 'overflow:auto',
      'background:' + bg, 'color:' + fg,
      'border:1px solid ' + line, 'border-radius:14px',
      'box-shadow:0 12px 40px rgba(0,0,0,.35)',
      'padding:14px', 'box-sizing:border-box', 'font:13px/1.5 -apple-system,"PingFang SC",system-ui,sans-serif',
      'display:none',
    ].join(';');

    var title = document.createElement('div');
    title.textContent = '外观';
    title.style.cssText = 'font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:' + dim + ';margin-bottom:10px';
    wrap.appendChild(title);

    /* 形状网格 */
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:14px';

    var cells = [];
    var SHAPES = root.peepface.SHAPES || ['sphere'];

    function paintThumbs(color) {
      cells.forEach(function (cell) {
        cell.replaceChildren();
        try {
          root.peepface.createFace(cell, {
            shape: cell.dataset.shape, size: 38, color: color, state: 'idle', static: true,
          });
        } catch (e) { cell.textContent = '?'; }
      });
    }

    SHAPES.forEach(function (name) {
      var cell = document.createElement('div');
      cell.dataset.shape = name;
      cell.style.cssText = [
        'aspect-ratio:1', 'border-radius:9px', 'cursor:pointer',
        'border:1px solid transparent', 'background:' + (dark ? '#0e0e12' : '#f6f6f4'),
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:3px',
      ].join(';');

      try {
        root.peepface.createFace(cell, {
          shape: name, size: 38,
          color: cfg.color || ('#EDEDED'),
          state: 'idle', static: true,
        });
      } catch (e) {
        cell.textContent = '?';
      }

      cell.onclick = function () {
        cfg.shape = name;
        saveConfig(cfg);
        face.shape(name);
        paintSelection();
        onChange && onChange(cfg);
      };

      grid.appendChild(cell);
      cells.push(cell);
    });
    wrap.appendChild(grid);

    /* 颜色 */
    var colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px';
    var swatches = [];
    var PALETTE = root.peepface.PALETTE || [];

    PALETTE.forEach(function (c) {
      var sw = document.createElement('div');
      sw.style.cssText = [
        'width:24px', 'height:24px', 'border-radius:7px', 'cursor:pointer',
        'border:2px solid transparent', 'background:' + (c.id === 'black' ? '#111' : c.value),
      ].join(';');
      sw.title = c.label;
      sw.dataset.color = c.value;
      sw.onclick = function () {
        cfg.color = c.value;
        saveConfig(cfg);
        face.color(c.value);
        paintThumbs(c.value);
        paintSelection();
        onChange && onChange(cfg);
      };
      colorRow.appendChild(sw);
      swatches.push(sw);
    });
    wrap.appendChild(colorRow);

    /* 自定义颜色 */
    var customRow = document.createElement('div');
    customRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:14px';

    var picker = document.createElement('input');
    picker.type = 'color';
    picker.value = /^#[0-9a-f]{6}$/i.test(cfg.color || '') ? cfg.color : '#ff6700';
    picker.style.cssText = 'width:32px;height:26px;border:none;background:none;padding:0;cursor:pointer';

    var hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.placeholder = '#RRGGBB';
    hexInput.value = cfg.color || '';
    hexInput.style.cssText = [
      'flex:1', 'background:' + (dark ? '#0e0e12' : '#f6f6f4'),
      'border:1px solid ' + line, 'border-radius:7px',
      'color:' + fg, 'font:inherit', 'font-size:12px', 'padding:5px 8px', 'outline:none',
    ].join(';');

    function applyCustom(v) {
      cfg.color = v;
      saveConfig(cfg);
      face.color(v);
      paintThumbs(v);
      paintSelection();
    }
    picker.oninput = function () { hexInput.value = picker.value; applyCustom(picker.value); };
    hexInput.onchange = function () {
      var v = hexInput.value.trim();
      if (v) { picker.value = /^#[0-9a-f]{6}$/i.test(v) ? v : picker.value; applyCustom(v); }
    };

    customRow.appendChild(picker);
    customRow.appendChild(hexInput);
    wrap.appendChild(customRow);

    /* 重置 */
    var reset = document.createElement('button');
    reset.textContent = '重置';
    reset.style.cssText = [
      'font:inherit', 'font-size:12px', 'padding:6px 12px', 'border-radius:8px',
      'border:1px solid ' + line, 'background:transparent', 'color:' + fg, 'cursor:pointer',
    ].join(';');
    reset.onclick = function () {
      cfg = {};
      saveConfig(cfg);
      face.shape('sphere');
      var base = '#EDEDED';
      face.color(base);
      paintThumbs(base);
      paintSelection();
      onChange && onChange(cfg);
    };
    wrap.appendChild(reset);

    function paintSelection() {
      var curShape = cfg.shape || 'sphere';
      cells.forEach(function (c) {
        var on = c.dataset.shape === curShape;
        c.style.outline = on ? '2px solid #ff6700' : 'none';
        c.style.outlineOffset = on ? '-1px' : '0';
      });
      var curColor = (cfg.color || ('#EDEDED')).toLowerCase();
      swatches.forEach(function (s) {
        var on = s.dataset.color.toLowerCase() === curColor;
        s.style.outline = on ? '2px solid ' + fg : 'none';
        s.style.outlineOffset = on ? '2px' : '0';
      });
    }
    paintSelection();

    document.body.appendChild(wrap);
    return wrap;
  }

  /* ---------- 挂载 ---------- */

  function mount(container) {
    if (!root.peepface || !root.peepface.createFace) {
      console.error('[peepface] createFace 不可用');
      return function () {};
    }
    if (root.__peepfaceDshMounted) return function () {};
    root.__peepfaceDshMounted = true;

    var dark = pageDark();

    var host = document.createElement('div');
    host.id = 'peepface-dsh';
    host.style.cssText =
      'position:fixed;width:96px;height:96px;z-index:2147483000;cursor:grab;' +
      'user-select:none;touch-action:none;pointer-events:auto;';
    container.appendChild(host);

    var face = root.peepface.createFace(host, {
      shape: 'sphere',
      color: '#EDEDED',
      size: 96,
      state: 'idle',
    });

    var probe = startProbe(face);

    /* 读取上次保存的外观 */
    var saved = loadConfig();
    if (saved && saved.shape) { try { face.shape(saved.shape); } catch (e) {} }
    if (saved && saved.color) { try { face.color(saved.color); } catch (e) {} }

    /* 点一下开设置面板 */
    var panel = null;
    function togglePanel() {
      if (!panel) panel = buildPanel(face, host);
      var open = panel.style.display === 'block';
      if (open) {
        panel.style.display = 'none';
        return;
      }
      var r = host.getBoundingClientRect();
      var w = panel.offsetWidth || 308;
      var left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
      var top = r.top - 12;
      panel.style.left = left + 'px';
      panel.style.bottom = 'auto';
      panel.style.top = 'auto';
      // 优先显示在头像上方
      var ph = panel.offsetHeight || 360;
      if (r.top > ph + 20) {
        panel.style.top = (r.top - ph - 12) + 'px';
      } else {
        panel.style.top = (r.bottom + 12) + 'px';
      }
      panel.style.display = 'block';
    }

    attachDrag(host, togglePanel);

    /* 点外面关掉 */
    document.addEventListener('pointerdown', function (e) {
      if (!panel || panel.style.display !== 'block') return;
      if (panel.contains(e.target) || host.contains(e.target)) return;
      panel.style.display = 'none';
    }, true);

    /* 主题变化时换色 */
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function onScheme() {
      var d = pageDark();
      host.querySelectorAll('svg path').forEach(function () {});
      face.color(d ? '#E8E8E8' : '#0a0a0c');
    }
    if (mq && mq.addEventListener) mq.addEventListener('change', onScheme);

    return function () {
      try { probe.stop(); } catch (e) {}
      try { face.destroy(); } catch (e) {}
      try { host.remove(); } catch (e) {}
      try { panel && panel.remove(); } catch (e) {}
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onScheme);
      root.__peepfaceDshMounted = false;
    };
  }

  root.__peepfaceDsh = { mount: mount, pageDark: pageDark };
})();

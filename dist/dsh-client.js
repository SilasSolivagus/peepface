/* peepface v0.1.0 — 由 build.mjs 从 core.js 生成，不要手改 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-peepface",
  factory(require) {
    /* peepface core — 工厂版
     * createFace(container, options) → { setState, getState, destroy }
     * 无状态判定、无全局单例，可在一页里同时跑多个实例。
     */
    (function (root) {
      'use strict';

      const DEG = Math.PI / 180;
      const SAMPLES = 64;
      const R = 56;

      /* ---------------- 几何 ---------------- */

      const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
      const norm = v => { const l = Math.hypot(...v) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };

      const sphere = (lon, lat) => {
        const lo = lon * DEG, la = lat * DEG;
        return [Math.sin(lo)*Math.cos(la), Math.sin(la), Math.cos(lo)*Math.cos(la)];
      };

      const rotate = (n, yaw, pitch) => {
        const a = yaw * DEG, b = pitch * DEG;
        const x1 =  n[0]*Math.cos(a) + n[2]*Math.sin(a);
        const z1 = -n[0]*Math.sin(a) + n[2]*Math.cos(a);
        const y2 =  n[1]*Math.cos(b) - z1*Math.sin(b);
        const z2 =  n[1]*Math.sin(b) + z1*Math.cos(b);
        return [x1, y2, z2];
      };

      const tangentFrame = n => {
        let u = cross([0, 1, 0], n);
        if (Math.hypot(...u) < 1e-6) u = [1, 0, 0];
        u = norm(u);
        return { u, v: norm(cross(n, u)) };
      };

      /* 椭圆眼形：用两段 A 命令，带旋转角。
         之前的 capsule 实现在 hw > hh（横条）时两端圆心重合，会退化成圆。 */
      function eyePath(cx, cy, ux, uy, hw, hh) {
        const theta = Math.atan2(uy, ux) * 180 / Math.PI;
        const p0x = cx + ux * hw, p0y = cy + uy * hw;
        const p1x = cx - ux * hw, p1y = cy - uy * hw;
        return 'M' + p0x.toFixed(2) + ' ' + p0y.toFixed(2) +
               'A' + hw.toFixed(2) + ' ' + hh.toFixed(2) + ' ' + theta.toFixed(1) +
               ' 0 1 ' + p1x.toFixed(2) + ' ' + p1y.toFixed(2) +
               'A' + hw.toFixed(2) + ' ' + hh.toFixed(2) + ' ' + theta.toFixed(1) +
               ' 0 1 ' + p0x.toFixed(2) + ' ' + p0y.toFixed(2) + 'Z';
      }

      /* ---------------- 形体 ---------------- */

      const SHAPES = {
        circle: () => 1,
        blob:   th => 1 + 0.05*Math.cos(3*th + 0.6) + 0.02*Math.cos(5*th - 1.1),
        tall:   th => { const a=0.90, b=1.12, c=Math.cos(th), s=Math.sin(th); return a*b/Math.hypot(b*c, a*s); },
        wide:   th => { const a=1.14, b=0.88, c=Math.cos(th), s=Math.sin(th); return a*b/Math.hypot(b*c, a*s); },
      };

      const TABLE = {};
      for (const k in SHAPES) {
        TABLE[k] = Array.from({ length: SAMPLES }, (_, i) => SHAPES[k](i / SAMPLES * Math.PI * 2));
      }

      function radiusPath(radii, scale) {
        let d = '';
        for (let i = 0; i < SAMPLES; i++) {
          const th = i / SAMPLES * Math.PI * 2;
          const r = radii[i] * R * scale;
          d += (i ? 'L' : 'M') + (Math.cos(th) * r).toFixed(1) + ' ' + (Math.sin(th) * r).toFixed(1);
        }
        return d + 'Z';
      }

      /* ---------------- 表情 ---------------- */

      const EXPR = {
        neutral:   { w: 11.5, h: 24,  tilt: -13 },
        sad:       { w: 11.5, h: 21,  tilt: -28 },
        focused:   { w: 19,   h: 8.5, tilt: 0   },
        happy:     { w: 16,   h: 7,   tilt: -18 },
        surprised: { w: 13,   h: 29,  tilt: -8  },
        sleepy:    { w: 20,   h: 3.2, tilt: -2  },
        confused:  { w: 10.5, h: 19,  tilt: 30  },
        droop:     { w: 11,   h: 16,  tilt: -44 },
      };

      /* ---------------- 状态（来自 states.json） ---------------- */

      const STATES = {
        idle:      { expr:'neutral',   shape:'circle', gaze:[0, 0.05],    breath:0.008, blink:[2.6, 6.0] },
        listening: { expr:'neutral',   shape:'circle', gaze:[0, 0.60],    breath:0.010, blink:[2.4, 5.0] },
        thinking:  { expr:'sad',       shape:'blob',   gaze:[0, 0.60],    breath:0.014, blink:[2.0, 4.0], ring:1 },
        searching: { expr:'focused',   shape:'circle', gaze:[0, 0.10],    breath:0.012, blink:[3.0, 6.0], scan:1 },
        streaming: { expr:'neutral',   shape:'circle', gaze:[0, 0.15],    breath:0.012, blink:[3.0, 6.0] },
        working:   { expr:'focused',   shape:'circle', gaze:[0, 0.15],    breath:0.020, blink:[3.0, 7.0] },
        waiting:   { expr:'neutral',   shape:'blob',   gaze:[0.55, 0.05], breath:0.006, blink:[3.0, 7.0], ring:0.5 },
        blocked:   { expr:'confused',  shape:'tall',   gaze:[-0.40, 0.10], breath:0.005, blink:[4.0, 8.0] },
        finished:  { expr:'happy',     shape:'wide',   gaze:[0, 0.20],    breath:0.006, blink:[3.0, 6.0] },
        failed:    { expr:'droop',     shape:'circle', gaze:[0, 0.42],    breath:0.004, blink:[5.0, 9.0] },
        sleeping:  { expr:'sleepy',    shape:'circle', gaze:[0, -0.20],   breath:0.004, blink:[9, 16], asleep:1 },
        waking:    { expr:'surprised', shape:'circle', gaze:[0, 0.35],    breath:0.016, blink:[1.4, 2.6] },
      };

      const ease = (cur, tgt, tau, dt) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));

      /* ---------------- 工厂 ---------------- */

      let uid = 0;

      function createFace(container, options) {
        if (!container) throw new Error('peepface: container required');
        const opts = options || {};
        const size = opts.size || 84;
        const dark = !!opts.dark;
        const follow = opts.follow !== false;
        const id = 'pf' + (++uid);

        const host = document.createElement('div');
        host.className = 'peepface';
        const shadow = host.attachShadow({ mode: 'open' });

        shadow.innerHTML = `
          <style>
            :host { all: initial; }
            .wrap {
              position: relative; width: ${size}px; height: ${size}px;
              display: block; user-select: none;
            }
            svg { width: 100%; height: 100%; display: block; overflow: visible; }
            .face { fill: ${dark ? '#e8e8e8' : '#0a0a0c'}; }
            .ring { fill: none; stroke: ${dark ? '#e8e8e8' : '#0a0a0c'}; stroke-width: 1.4; opacity: 0; }
          </style>
          <div class="wrap">
            <svg viewBox="-70 -70 140 140">
              <defs>
                <mask id="${id}-holes" maskUnits="userSpaceOnUse" x="-70" y="-70" width="140" height="140">
                  <path id="${id}-body-mask" fill="#fff" d=""/>
                  <path id="${id}-eye-l" fill="#000" d=""/>
                  <path id="${id}-eye-r" fill="#000" d=""/>
                </mask>
              </defs>
              <path id="${id}-ring" class="ring" d=""/>
              <path id="${id}-body" class="face" mask="url(#${id}-holes)" d=""/>
            </svg>
          </div>`;

        const el = {
          body:     shadow.getElementById(id + '-body'),
          bodyMask: shadow.getElementById(id + '-body-mask'),
          eyeL:     shadow.getElementById(id + '-eye-l'),
          eyeR:     shadow.getElementById(id + '-eye-r'),
          ring:     shadow.getElementById(id + '-ring'),
          wrap:     shadow.querySelector('.wrap'),
        };

        const S = {
          state: opts.state && STATES[opts.state] ? opts.state : 'idle',
          yaw: 0, pitch: 0,
          expr: 'neutral', shape: 'circle',
          radii: TABLE.circle.slice(),
          blink: 0, blinkT: -1, blinkDur: 0.26, nextBlink: 2 + Math.random() * 3,
          breath: 0.008, ring: 0, tRing: 0,
          pointer: null, time: Math.random() * 5, morph: null, asleep: 0,
        };

        function applyState(name) {
          const st = STATES[name] || STATES.idle;
          S.state = name;
          S.expr = st.expr;
          S.shape = st.shape;
          S.tRing = st.ring || 0;
          S.breath = st.breath;
          S.asleep = st.asleep ? 1 : 0;
          if (st.blink) S.nextBlink = st.blink[0] + Math.random() * (st.blink[1] - st.blink[0]);
        }

        function blink(dur) {
          if (S.blinkT >= 0 && S.blinkT < 0.5) return;
          S.blinkT = 0; S.blinkDur = dur || 0.26;
        }

        function onPointer(e) {
          if (!follow) return;
          const r = el.wrap.getBoundingClientRect();
          if (!r.width) return;
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const half = Math.max(r.width, 1);
          let gx = (e.clientX - cx) / half, gy = -(e.clientY - cy) / half;
          const len = Math.hypot(gx, gy);
          if (len > 1) { gx /= len; gy /= len; }
          S.pointer = [gx, gy];
        }
        const onLeave = () => { S.pointer = null; };

        if (follow) {
          window.addEventListener('pointermove', onPointer, { passive: true });
          document.addEventListener('mouseleave', onLeave);
          window.addEventListener('blur', onLeave);
        }

        let last = performance.now();
        let alive = true;

        function tick(now) {
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now; S.time += dt;

          const cur = STATES[S.state];
          const bias = cur.gaze || [0, 0];

          let ty, tp;
          if (S.pointer) {
            ty = S.pointer[0] * 40 + bias[0] * 18;
            tp = -S.pointer[1] * 28 - bias[1] * 16;
          } else {
            ty = Math.sin(S.time * 0.42) * 8 + Math.sin(S.time * 0.17 + 1.3) * 4 + bias[0] * 18;
            tp = Math.cos(S.time * 0.31) * 5 - bias[1] * 16;
          }
          if (cur.scan) ty += Math.sin(S.time * 3.6) * 30;

          S.yaw = ease(S.yaw, ty, 0.08, dt);
          S.pitch = ease(S.pitch, tp, 0.08, dt);

          if (S.asleep) {
            S.blink = 0;                     // 闭眼交给 sleepy 眼形本身表达
            S.blinkT = -1;
            S.nextBlink = 1e9;               // 睡着不眨
          } else if (S.blinkT >= 0) {
            S.blinkT += dt / S.blinkDur;
            if (S.blinkT >= 1) { S.blinkT = -1; S.blink = 0; }
            else {
              const t = S.blinkT, U1 = 0.42, U2 = 0.56;
              const ss = x => x * x * (3 - 2 * x);
              S.blink = t < U1 ? ss(t / U1) : t <= U2 ? 1 : 1 - ss((t - U2) / (1 - U2));
            }
          } else {
            S.nextBlink -= dt;
            if (S.nextBlink <= 0) {
              blink(0.26);
              const b = cur.blink || [2.6, 6];
              S.nextBlink = b[0] + Math.random() * (b[1] - b[0]);
            }
          }

          const target = TABLE[S.shape] || TABLE.circle;
          for (let i = 0; i < SAMPLES; i++) S.radii[i] = ease(S.radii[i], target[i], 0.12, dt);

          const scale = 1 + Math.sin(S.time * 1.4) * S.breath;
          const d = radiusPath(S.radii, scale);
          el.body.setAttribute('d', d);
          el.bodyMask.setAttribute('d', d);

          const ex = EXPR[S.expr] || EXPR.neutral;
          const eyes = [{ id: 'eyeL', lon: -27 }, { id: 'eyeR', lon: 27 }];
          for (let k = 0; k < eyes.length; k++) {
            const e = eyes[k];
            const n = rotate(sphere(e.lon, 10), S.yaw, S.pitch);
            const px = n[0] * R, py = -n[1] * R;
            const tf = tangentFrame(n);
            const uS = [tf.u[0], -tf.u[1]], vS = [tf.v[0], -tf.v[1]];
            const uz = Math.hypot(uS[0], uS[1]) || 1e-4;
            const vz = Math.hypot(vS[0], vS[1]) || 1e-4;
            const ux = uS[0] / uz, uy = uS[1] / uz;
            const roll = -S.yaw * 0.28 + ex.tilt;
            const cR = Math.cos(roll * DEG), sR = Math.sin(roll * DEG);
            const wx = ux * cR - uy * sR, wy = ux * sR + uy * cR;
            const hw = (ex.w / 2) * Math.max(0.22, uz);
            const hh = Math.max(0.3, (ex.h / 2) * vz * (1 - S.blink * 0.995));
            el[e.id].setAttribute('d', eyePath(px, py, wx, wy, hw, hh));
            const vis = Math.max(0, Math.min(1, (n[2] - 0.02) / 0.22));
            el[e.id].setAttribute('opacity', vis.toFixed(2));
          }

          S.ring = ease(S.ring, S.tRing, 0.25, dt);
          if (S.ring > 0.02) {
            const rx = 74, ry = 26, rot = -18 * DEG, a0 = S.time * 0.9;
            let p = '';
            for (let i = 0; i <= 60; i++) {
              const a = i / 60 * Math.PI * 2 + a0;
              const x0 = Math.cos(a) * rx, y0 = Math.sin(a) * ry;
              p += (i ? 'L' : 'M') + (x0 * Math.cos(rot) - y0 * Math.sin(rot)).toFixed(1) + ' '
                   + (x0 * Math.sin(rot) + y0 * Math.cos(rot)).toFixed(1);
            }
            el.ring.setAttribute('d', p + 'Z');
            el.ring.style.opacity = (S.ring * 0.45).toFixed(2);
          } else {
            el.ring.style.opacity = 0;
          }
        }

        function frame(now) {
          if (!alive) return;
          try { tick(now); } catch (e) { /* 一帧出错不杀循环 */ }
          requestAnimationFrame(frame);
        }

        container.appendChild(host);
        applyState(S.state);
        requestAnimationFrame(frame);

        return {
          setState(name) {
            applyState(name);
            // 换状态的瞬间眨一次眼盖住形变
            blink(0.26);
          },
          getState() { return S.state; },
          blink() { blink(0.26); },
          destroy() {
            alive = false;
            if (follow) {
              window.removeEventListener('pointermove', onPointer);
              document.removeEventListener('mouseleave', onLeave);
              window.removeEventListener('blur', onLeave);
            }
            host.remove();
          },
          el: host,
        };
      }

      root.peepface = {
        createFace,
        STATES: Object.keys(STATES),
        VERSION: '0.1.0',
      };
    })(typeof window !== 'undefined' ? window : globalThis);

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

    return {
      inject: [],
      apply(ctx) {
        try {
          ctx.effect(() => window.__peepfaceDsh.mount(document.body), "dsh-plugin-peepface: overlay");
        } catch (error) {
          console.error("[peepface] apply failed:", error);
        }
      },
    };
  },
});

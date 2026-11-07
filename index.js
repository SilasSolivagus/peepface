/* peepface v2 · 接口层
 *
 * 引擎（engine.mjs）从 Grok Bot 的 bundle 原样移植，不裁剪、不改逻辑。
 * 这个文件是唯一属于我们的代码。
 */

import { p_, o_, cc, Oo, Ns, Cc, pc, ms } from './engine.mjs';

/* ================================================================== *
 * 形状：引擎支持的全部 26 种
 * ================================================================== */

export const SHAPES = [
  'sphere', 'cloud', 'square', 'sparkle', 'clover', 'heartChubby', 'starFlower',
  'teardrop', 'tablet', 'wedge', 'house', 'star6', 'pebble', 'bean', 'egg',
  'squircle', 'capsule', 'cylinder', 'hex', 'gem', 'crystal', 'shield',
  'dome', 'arch', 'leaf', 'pumpkin',
];

/** 形状别名：用户更容易记住的叫法 */
export const SHAPE_ALIAS = {
  ball: 'sphere', circle: 'sphere',
  blob: 'sphere',
  flower: 'starFlower', star: 'star6', heart: 'heartChubby',
  drop: 'teardrop', water: 'teardrop',
  box: 'square', block: 'square',
  pill: 'capsule', tube: 'cylinder',
};

/* ================================================================== *
 * 颜色：11 色板（推荐）+ 任意自定义
 * ================================================================== */

export const PALETTE = [
  { id: 'black',   label: '黑',   value: '#000000' },
  { id: 'brown',   label: '棕',   value: '#936439' },
  { id: 'red',     label: '红',   value: '#FF263C' },
  { id: 'orange',  label: '橙',   value: '#FF6700' },
  { id: 'yellow',  label: '黄',   value: '#FF9800' },
  { id: 'green',   label: '绿',   value: '#00C972' },
  { id: 'cyan',    label: '青',   value: '#00BCA6' },
  { id: 'blue',    label: '蓝',   value: '#1084FE' },
  { id: 'violet',  label: '紫',   value: '#9159FE' },
  { id: 'magenta', label: '品红', value: '#FF309B' },
  { id: 'gray',    label: '灰',   value: '#777777' },
];

const PALETTE_BY_ID = new Map(PALETTE.map(c => [c.id, c.value]));

/** 颜色解析：色板 id → hex 值；已是 hex 就原样返回 */
export function resolveColor(input, fallback = '#E8E8E8') {
  if (!input) return fallback;
  if (PALETTE_BY_ID.has(input)) return PALETTE_BY_ID.get(input);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input)) return input;
  return fallback;
}

/* ================================================================== *
 * 状态
 * ================================================================== */

export const STATE = {
  IDLE: 'idle', LISTENING: 'listening', THINKING: 'thinking',
  SEARCHING: 'searching', STREAMING: 'streaming', WORKING: 'working',
  WAITING: 'waiting', BLOCKED: 'blocked', FINISHED: 'finished',
  FAILED: 'failed', SLEEPING: 'sleeping', WAKING: 'waking',
};

/** 引擎实际用到的全部状态（含工具族细分） */
export const STATE_ALL = [
  'idle', 'listening', 'thinking', 'searching', 'streaming', 'working',
  'waiting', 'blocked', 'finished', 'failed', 'sleeping', 'waking', 'spawning',
  'reading', 'coding', 'running', 'computing', 'controlling',
  'orbit', 'progress', 'sending', 'writing',
];

export const STATE_HELP = {
  idle: '没事干，但醒着', listening: '对方在说话（语音）', thinking: '收到请求，还没开口',
  searching: '在主动搜索', streaming: '正在往外吐字', working: '在调工具',
  waiting: '工具在等你填表', blocked: '需要人拉一把', finished: '干完了',
  failed: '出错了', sleeping: '很久没人用', waking: '被叫醒了', spawning: '刚出现',
  reading: '在读文件/检索', coding: '在改代码', running: '在跑命令',
  computing: '在它自己的沙箱里算', controlling: '在你的机器上操作',
  orbit: '在联网/握手', progress: '在生成长内容', sending: '在发消息给别人',
  writing: '在写文件',
};

/* ================================================================== *
 * 身份派生：不传形状/颜色时，按 id 算出一个稳定的组合
 * ================================================================== */

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** 同一个 id 永远得到同一个形状 */
export function shapeFromId(id) {
  // sphere 太素，不进池子
  const pool = SHAPES.filter(s => s !== 'sphere' && s !== 'pumpkin');
  return pool[fnv1a(String(id)) % pool.length];
}

/** 同一个 id 永远得到同一个颜色（不取黑色，太容易看不见） */
export function colorFromId(id) {
  const pool = PALETTE.filter(c => c.id !== 'black');
  return pool[fnv1a(String(id) + '\u0001color') % pool.length].value;
}

/* ================================================================== *
 * 自定义形状
 *
 * 用户画一个 SVG path，我们把它变成引擎认识的形状。
 * 引擎需要两处注册：cc（几何）+ Oo（眼睛布局）。
 * ================================================================== */

/** 默认的眼位比例，按包围盒缩放 */
const DEFAULT_LAYOUT = {
  width: 0.21,    // 眼睛宽（引擎单位，和 Oo 表同量级）
  height: 0.47,   // 眼睛高
  gap: 0.46,      // 眼间距
  shiftY: 0.07,   // 眼睛垂直偏移
};

/**
 * 定义一个形状。
 *
 *   defineShape('myBlob', {
 *     path: 'M 40 0 L 160 0 Q 200 0 200 40 ...',
 *     // 可选：手动指定眼睛布局
 *     layout: { width: 0.22, height: 0.47, gap: 0.48, shiftY: 0.07 },
 *   });
 *
 *   createFace(el, { shape: 'myBlob' });
 */
export function defineShape(name, spec = {}) {
  if (!name) throw new Error('defineShape: 需要名字');
  if (!spec.path && !spec.silhouette) {
    throw new Error('defineShape: 需要 path（SVG 路径）或 silhouette（引擎原生描述）');
  }

  let silhouette = spec.silhouette;
  let bbox = { w: 2, h: 2 };

  if (!silhouette) {
    const pts = Ns(String(spec.path), spec.tolerance ?? 0.5);  // 解析 + 简化（容差越小点越密）
    if (!pts || pts.length < 3) throw new Error('defineShape: 路径点数不足');
    const norm = Cc(pts);                          // 归一化到 -1..1
    silhouette = pc(norm);                         // 转成引擎格式

    const xs = norm.map(p => p.x), ys = norm.map(p => p.y);
    bbox.w = Math.max(...xs) - Math.min(...xs) || 2;
    bbox.h = Math.max(...ys) - Math.min(...ys) || 2;
  }

  // 眼睛布局：手给优先，否则按包围盒推
  // 窄形状（菱形等）按包围盒宽度收一点，避免眼睛溢出
  const narrow = Math.min(1, bbox.w / 1.55);
  const layout = {
    width: DEFAULT_LAYOUT.width * narrow,
    height: DEFAULT_LAYOUT.height,
    gap: DEFAULT_LAYOUT.gap * narrow,
    shiftY: DEFAULT_LAYOUT.shiftY,
    ...(spec.layout || {}),
  };

  // 两处注册
  cc[name] = () => ({
    size: spec.size ?? 1.2,
    silhouette,
    seat: spec.seat ?? { kind: 'front', faceZ: 0.36 },
  });
  Oo[name] = layout;

  if (SHAPES.indexOf(name) < 0) SHAPES.push(name);

  return { name, layout };
}

/** 列出所有可用形状（含自定义的） */
export function shapes() {
  return SHAPES.slice();
}

/* ================================================================== *
 * 创建
 * ================================================================== */

let uid = 0;

export function createFace(host, options = {}) {
  const el = typeof host === 'string' ? document.querySelector(host) : host;
  if (!el) throw new Error('peepface: container not found');

  const id = options.id ?? `pf-${++uid}`;

  const shapeInput = options.shape ?? options.body;
  const shape = shapeInput
    ? (SHAPE_ALIAS[shapeInput] || shapeInput)
    : shapeFromId(id);

  const colorInput = options.color ?? options.ink;
  const ink = colorInput ? resolveColor(colorInput, colorFromId(id)) : colorFromId(id);

  const engine = p_({
    id,
    body: shape,
    state: options.state ?? 'idle',
    size: options.size ?? 84,
    appearance: o_(ink, options.spot ?? null),
    isFollowingPointer: options.followPointer !== false,
    // 静态模式：不跑 rAF，只渲染一个定格（用于选择器里的缩略图）
    isStatic: options.static === true,
  });

  engine.attach({ host: el, canvas: el });

  const api = {
    /* ---- 外观 ---- */

    /** 换形状。别名也认（blob→sphere、flower→starFlower…） */
    shape(name) {
      engine.setBody(SHAPE_ALIAS[name] || name);
      return api;
    },

    /** 换颜色。认色板 id（'blue'）也认 hex（'#1084FE'） */
    color(value) {
      engine.update?.({ appearance: o_(resolveColor(value, ink), options.spot ?? null) });
      return api;
    },

    /* ---- 状态 ---- */

    state(name) {
      engine.setState(name || 'idle');
      return api;
    },

    /** 事实投影：唯一的状态入口（见 PROTOCOL-v2.md） */
    sync(facts) {
      engine.setState(resolveFacts(facts, Date.now()));
      return api;
    },

    /* ---- 精细控制 ---- */

    expression(name) { engine.setExpression(name, undefined); return api; },
    look(x, y) { engine.look({ x, y }); return api; },
    gaze(v) { engine.gaze(v); return api; },
    blink() { engine.blink(); return api; },
    restart() { engine.restart(); return api; },
    play(flag = true) { engine.setPlaying(!!flag); return api; },
    poke(kind) { engine.poke(kind); return api; },

    destroy() {
      try { el.replaceChildren(); } catch {}
    },

    get engine() { return engine; },
    get id() { return id; },
  };

  return api;
}

/* ================================================================== *
 * 事实投影（PROTOCOL-v2）
 * ================================================================== */

const TOOL_VERB = {
  read_file: 'reading', grep: 'reading', glob: 'reading', web_search: 'searching',
  write_file: 'writing', edit: 'writing',
  bash: 'running', exec: 'running', shell: 'running',
  apply_patch: 'coding',
  browser: 'orbit', fetch: 'orbit', connect: 'orbit',
  screenshot: 'controlling', click: 'controlling', type: 'controlling',
};

const VERB_STATE = {
  reading: 'reading', searching: 'searching', writing: 'writing',
  coding: 'coding', running: 'running', computing: 'computing',
  controlling: 'controlling', orbit: 'orbit', progress: 'progress',
  sending: 'sending', thinking: 'thinking', asking: 'waiting',
};

export function resolveFacts(facts, now = Date.now()) {
  if (!facts) return 'idle';
  if (facts.awaiting) return 'blocked';
  if (facts.running || facts.composing) {
    if (facts.composing) return 'streaming';
    const tool = facts.activity?.tool;
    const verb = tool ? (TOOL_VERB[tool] || 'working') : (facts.activity?.kind || 'working');
    return VERB_STATE[verb] || 'working';
  }
  const s = facts.settlement;
  if (s && now < s.at + 8000) return s.outcome === 'success' ? 'finished' : 'failed';
  return 'idle';
}

export default {
  createFace, resolveFacts, defineShape, shapes,
  SHAPES, SHAPE_ALIAS, PALETTE, resolveColor,
  STATE, STATE_ALL, STATE_HELP,
  shapeFromId, colorFromId,
};

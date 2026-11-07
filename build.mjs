#!/usr/bin/env node
/* peepface v2 构建：把 ESM 引擎 + 接口层 + DSH 适配器拼成一个 ModuleLoader 插件
 *
 *   engine.mjs   原版引擎（ESM，58 条 export）
 *   runtime.mjs  rolldown 运行时垫片
 *   index.js     我们的接口层（ESM）
 *   adapters/dsh.js  DSH 适配器（状态探测 → facts）
 *
 * 输出：plugin/lib/client.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(here, p), 'utf8');

/* ---------- 1. runtime：去掉 export ---------- */
let runtime = read('runtime.mjs')
  .replace(/^\/\/.*$/gm, '')
  .replace(/^export\s+const\s+t\s*=/m, 'const __rolldownT =');

/* ---------- 2. engine：去掉 import，收集 export，去掉 export 语句 ---------- */
let engine = read('engine.mjs');

// 收集所有导出的名字
const exported = new Set();
for (const m of engine.matchAll(/^export\s*\{\s*([^}]+)\}\s*;?/gm)) {
  for (const name of m[1].split(',')) {
    const n = name.trim();
    if (n) exported.add(n);
  }
}

// 去掉 import / export 语句
engine = engine
  .replace(/^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, '')
  .replace(/^export\s*\{\s*[^}]+\}\s*;?\s*$/gm, '')
  .replace(/^export\s+default\s+[^;]+;?\s*$/gm, '');

/* ---------- 3. index.js：import 换成解构，去掉 export ---------- */
let iface = read('index.js');

// 收集接口层自己要导出的名字（给 window.peepface 用）
const ifaceExports = new Set();
for (const m of iface.matchAll(/^export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm)) {
  ifaceExports.add(m[1]);
}
// export default { ... } 里的也收
const defMatch = iface.match(/^export\s+default\s*\{([\s\S]*?)\};?\s*$/m);
if (defMatch) {
  for (const n of defMatch[1].split(',')) {
    const t = n.trim().split(':')[0].trim();
    if (t) ifaceExports.add(t);
  }
}

iface = iface
  .replace(/^import\s*\{([^}]*)\}\s*from\s*['"][^'"]*engine\.mjs['"];?\s*$/gm,
           (_, names) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = __ENGINE;`)
  .replace(/^export\s+default\s*\{[\s\S]*?\};?\s*$/gm, '')
  .replace(/^export\s+(const|function|let)\s+/gm, '$1 ');

/* ---------- 4. adapter ---------- */
const adapter = read('adapters/dsh.js');

/* ---------- 5. 拼装 ---------- */
const BANNER = `/* peepface v2 — 由 build-v2.mjs 生成，不要手改
 * 引擎：Grok Bot 头像引擎的原样移植（不裁剪）
 * 接口：createFace / sync / 形状与颜色
 */`;

const out = `${BANNER}
window.__ModuleLoader__.load({
  id: "dsh-plugin-peepface",
  factory(require) {
/* ================= 引擎运行时 ================= */
${indent(runtime, 4)}

/* ================= 引擎本体（IIFE 隔离，避免顶层重名） ================= */
const __ENGINE = (function () {
  const e = __rolldownT;   // 原 import { t as e }
${indent(engine, 2)}
  return { ${[...exported].join(', ')} };
})();

/* ================= 接口层 ================= */
${indent(iface, 4)}

/* ================= DSH 适配器 ================= */
${indent(adapter, 4)}

/* ================= 模块返回 ================= */
    const API = { ${[...ifaceExports].join(', ')} };
    try { window.peepface = API; } catch (e) {}

    return {
      inject: [],
      apply(ctx) {
        try {
          ctx.effect(
            () => window.__peepfaceDsh.mount(document.body),
            "dsh-plugin-peepface: overlay",
          );
        } catch (error) {
          console.error("[peepface] apply failed:", error);
        }
      },
    };
  },
});
`;

mkdirSync(join(here, 'plugin-dsh/lib'), { recursive: true });
writeFileSync(join(here, 'plugin-dsh/lib/client.js'), out);
console.log(`plugin-dsh/lib/client.js  ${(out.length / 1024).toFixed(0)} KB`);
console.log(`  引擎导出 ${exported.size} 个符号`);
console.log(`  接口导出 ${ifaceExports.size} 个符号：${[...ifaceExports].slice(0, 10).join(', ')}…`);

function indent(str, n) {
  const pad = ' '.repeat(n);
  return str.split('\n').map(l => (l ? pad + l : l)).join('\n');
}

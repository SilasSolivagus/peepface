#!/usr/bin/env node
/* 把引擎 + 接口 + 页面 拼成一个单文件 HTML
 * file:// 下也能跑（没有 import，全部内联）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(here, p), 'utf8');

/* 1. runtime */
let runtime = read('runtime.mjs')
  .replace(/^\/\/.*$/gm, '')
  .replace(/^export\s+const\s+t\s*=/m, 'const __rolldownT =');

/* 2. engine */
let engine = read('engine.mjs');
const exported = new Set();
for (const m of engine.matchAll(/^export\s*\{\s*([^}]+)\}\s*;?/gm)) {
  for (const n of m[1].split(',')) { const t = n.trim(); if (t) exported.add(t); }
}
engine = engine
  .replace(/^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, '')
  .replace(/^export\s*\{\s*[^}]+\}\s*;?\s*$/gm, '')
  .replace(/^export\s+default\s+[^;]+;?\s*$/gm, '');

/* 3. index.js */
let iface = read('index.js');
const ifaceExports = new Set();
for (const m of iface.matchAll(/^export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm)) {
  ifaceExports.add(m[1]);
}
iface = iface
  .replace(/^import\s*\{([^}]*)\}\s*from\s*['"][^'"]*engine\.mjs['"];?\s*$/gm,
           (_, names) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = __ENGINE;`)
  .replace(/^export\s+default\s*\{[\s\S]*?\};?\s*$/gm, '')
  .replace(/^export\s+(const|function|let)\s+/gm, '$1 ');

const bundle = `
/* ================= runtime ================= */
${runtime}

/* ================= engine ================= */
const __ENGINE = (function () {
  const e = __rolldownT;
${engine.split('\n').map(l => (l ? '  ' + l : l)).join('\n')}
  return { ${[...exported].join(', ')} };
})();

/* ================= 接口层 ================= */
${iface}

/* ================= 对外暴露 ================= */
window.peepface = { ${[...ifaceExports].join(', ')} };
`;

/* 4. 页面（不含 type="module"，改用全局 peepface） */
const page = read('custom.page.html');

// 必须用函数式替换：bundle 里含 $' $& 这类序列，会被 String.replace 当特殊模式
// 先替换页面脚本：去掉 module、换 import 为全局解构、用 IIFE 包住避免重名
let out = page.replace("<script type=\"module\">", '<script>(function(){')
  .replace("import { createFace, defineShape, STATE_ALL, STATE_HELP } from './index.js';",
           'const { createFace, defineShape, STATE_ALL, STATE_HELP } = window.peepface;');

// 页面脚本的收尾 </script> 前补 IIFE 闭合（只处理最后一个）
const lastClose = out.lastIndexOf('</script>');
out = out.slice(0, lastClose) + '})();\n' + out.slice(lastClose);

// 再插入 bundle（函数式替换，防 $ 转义）
out = out.replace('<!-- BUNDLE -->', () => `<script>${bundle}</script>`);

writeFileSync(join(here, 'custom-standalone.html'), out);
console.log(`custom-standalone.html  ${(out.length / 1024).toFixed(0)} KB`);
console.log(`  引擎导出 ${exported.size} / 接口导出 ${ifaceExports.size}`);

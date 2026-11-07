#!/usr/bin/env node
/* 从本地安装的 Grok Bot 里提取头像引擎
 *
 *   npx peepface-extract "/Applications/Grok Bot.app"
 *   node extract-engine.mjs --from "/Applications/Grok Bot.app"
 *
 * 产物：engine.mjs（512 KB）+ _runtime.mjs（178 B），与 peepface 同目录。
 *
 * 为什么不在包里直接带引擎：见 README「法律状态」。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- 参数 ---------- */
const args = process.argv.slice(2);
const appPath =
  args.find(a => !a.startsWith('--')) ||
  (args.includes('--from') ? args[args.indexOf('--from') + 1] : null) ||
  '/Applications/Grok Bot.app';

const CHUNK = 'index.eager-common';
const RUNTIME_FILE = 'chunk-rolldown-runtime';

function log(msg) { console.log('[peepface] ' + msg); }
function die(msg) { console.error('[peepface] ' + msg); process.exit(1); }

/* ---------- 1. 找 asar ---------- */
const asarPath = join(appPath, 'Contents/Resources/app.asar');
if (!existsSync(asarPath)) {
  die(`找不到 ${asarPath}\n  用法：node extract-engine.mjs "/Applications/Grok Bot.app"`);
}
log(`app: ${appPath}`);

/* ---------- 2. 解开 asar 里的 renderer assets ---------- */
const tmp = mkdtempSync(join(tmpdir(), 'peepface-'));
log(`临时目录: ${tmp}`);

try {
  // 用 npx asar 解包（首次会下载 asar 包）
  log('解包 app.asar（首次需要下载 asar，约 10 秒）…');
  try {
    execFileSync('npx', ['--yes', '@electron/asar', 'extract', asarPath, tmp], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 180000,
    });
  } catch (e) {
    die('解包失败。需要网络下载 @electron/asar，或手动解包后把 dist/ 放进来。\n  ' + (e.stderr?.toString() || e.message));
  }

  /* ---------- 3. 定位引擎 chunk ---------- */
  const assetsDir = join(tmp, 'dist/renderer/assets');
  if (!existsSync(assetsDir)) die('解包后找不到 dist/renderer/assets');

  const files = execFileSync('ls', [assetsDir]).toString().split('\n').filter(Boolean);
  const chunkFile = files.find(f => f.startsWith(CHUNK) && f.endsWith('.js'));
  if (!chunkFile) die(`找不到 ${CHUNK}-*.js，这个版本的目录结构可能变了`);

  const chunkPath = join(assetsDir, chunkFile);
  const src = readFileSync(chunkPath, 'utf8');
  log(`引擎 chunk: ${chunkFile}  ${(src.length / 1024).toFixed(0)} KB`);

  /* ---------- 4. 截掉末尾 export，换成具名导出 ---------- */
  // 压缩版是单行：export{...}; 后面还可能跟 //# debugId= 注释
  const expIdx = Math.max(src.lastIndexOf('export{'), src.lastIndexOf('export {'));
  if (expIdx < 0) die('找不到 export 块，这个版本可能不是 ESM');

  let code = src.slice(0, expIdx);

  // 唯一的 import 指向 rolldown 运行时（压缩版无空格：import{t as e}from"..."）
  const importRe = /import\s*\{\s*t\s+as\s+e\s*\}\s*from\s*["']\.\/${RUNTIME_FILE}-[^"']*["']\s*;?/;
  if (!importRe.test(code)) {
    // 兜底：只要能找到这个文件名就替换
    if (!code.includes(RUNTIME_FILE)) die('找不到运行时 import，这个版本可能改了打包方式');
    code = code.replace(
      /import[^;]*from\s*["']\.\/[^"']*chunk-rolldown-runtime[^"']*["']\s*;?/,
      'import { t as e } from "./_runtime.mjs";'
    );
  } else {
    code = code.replace(importRe, 'import { t as e } from "./_runtime.mjs";');
  }

  /* ---------- 5. 追加导出面 ---------- */
  // 这些是接口层和构建脚本需要的符号
  const WANTED = [
    'p_', 'eo', 'go', 'Xg', 'Yg', 'n_', 'e_', 'f_', 'd_', 'u_', 'o_', 'i_', 'hp', 'io', 'ao', 'ro',
    'Ea', 'no', 'lo', 'oo', 'Zg', 'Oo', 'ko', 'ja', 'Ns', 'Cc', 'pc', 'Vs', 'Gs', 'Ws',
    'ms', 'ds', 'fs', 'ls', 'Sg', 'cc', 'gi',
  ];
  code += '\n/* ---- peepface exports ---- */\n';
  for (const name of WANTED) code += `export { ${name} };\n`;
  code += 'export default null;\n';

  /* ---------- 6. 写文件 ---------- */
  const runtime = `// rolldown 运行时垫片（等价物，178 B）
export const t = (e, t) => () => (t || (e((t = { exports: {} }).exports, t, t.exports), (e = null)), t.exports);
`;

  writeFileSync(join(here, '_runtime.mjs'), runtime);
  writeFileSync(join(here, 'engine.mjs'), code);

  log(`✓ engine.mjs     ${(code.length / 1024).toFixed(0)} KB`);
  log(`✓ _runtime.mjs   178 B`);
  log('');
  log('现在可以用了：');
  log('  import { createFace } from "peepface";');
  log('');
  log(`注：引擎提取自 ${appPath}`);
  log('    不要提交它，也不要分发。');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

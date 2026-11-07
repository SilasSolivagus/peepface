#!/usr/bin/env node
/* peepface export — 把状态导出成图片
 *
 *   node export.mjs --state working --size 640 --out working.png
 *   node export.mjs --all --size 240 --out pack/              # 12 张 PNG
 *   node export.mjs --all --size 240 --gif --out pack/         # 12 个 GIF（每个 1.6s）
 *
 * 需要本机装有 Chrome，以及 playwright-core。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d;
};
const flag = k => argv.includes('--' + k);

const STATES = ['idle', 'listening', 'thinking', 'searching', 'streaming', 'working',
                'waiting', 'blocked', 'finished', 'failed', 'sleeping', 'waking'];

const all = flag('all');
const state = arg('state', 'idle');
const size = Number(arg('size', 640));
const out = resolve(arg('out', 'face.png'));
const gif = flag('gif');
const bg = arg('bg', null);
const dark = arg('dark', null);

if (!all && !argv.includes('--state')) {
  console.error('用法：node export.mjs --state <状态> --size 640 --out face.png');
  console.error('      node export.mjs --all --size 240 --out pack/');
  process.exit(1);
}

/* ---------- 静态服务（只用它把页面和 dist 喂给 Chrome） ---------- */
const PORT = 8800 + Math.floor(Math.random() * 500);
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: here, stdio: 'ignore', detached: false,
});
await new Promise(r => setTimeout(r, 900));

/* ---------- playwright ---------- */
const require = createRequire(import.meta.url);
let chromium;
for (const p of [
  'playwright-core',
  '/Users/silas/.dsh/profiles/desktop/node_modules/playwright-core',
]) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 下一个 */ }
}
if (!chromium) {
  console.error('找不到 playwright-core。装一个：npm i -D playwright-core');
  server.kill(); process.exit(1);
}

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

const list = all ? STATES : [state];
mkdirSync(gif || all ? out : dirname(out), { recursive: true });

for (const st of list) {
  const q = new URLSearchParams({ state: st, size: String(size) });
  if (bg) q.set('bg', bg);
  if (dark !== null) q.set('dark', dark === '1' || dark === true ? '1' : '0');

  const page = await browser.newPage({
    viewport: { width: size + 40, height: size + 40 },
    deviceScaleFactor: 1,
  });
  await page.goto(`http://127.0.0.1:${PORT}/export.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true');
  await page.waitForTimeout(260);          // 让呼吸/眨眼落到一个稳定相位

  const el = await page.$('#f');

  if (gif) {
    /* GIF：真实时间采样 1.6 秒，10fps */
    const dir = join(out, '.frames-' + st);
    mkdirSync(dir, { recursive: true });
    const FPS = 10, N = 16;
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const wait = t0 + i * (1000 / FPS) - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      await el.screenshot({ path: join(dir, `f_${String(i).padStart(3, '0')}.png`), omitBackground: !bg });
    }
    await page.close();

    const target = join(out, st + '.gif');
    await run('ffmpeg', [
      '-y', '-framerate', String(FPS), '-i', join(dir, 'f_%03d.png'),
      '-vf', 'split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop', '0', target,
    ]);
    await run('rm', ['-rf', dir]);
    console.log('  ' + st + '.gif');
  } else {
    const target = all ? join(out, st + '.png') : out;
    await el.screenshot({ path: target, omitBackground: !bg });
    await page.close();
    console.log('  ' + (all ? st + '.png' : target));
  }
}

await browser.close();
server.kill();
console.log('完成 →', out);

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('exit', c => (c === 0 ? res() : rej(new Error(cmd + ' 退出码 ' + c))));
  });
}

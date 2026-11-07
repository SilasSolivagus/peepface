#!/usr/bin/env node
/* peepface v2 表情导出器
 *
 *   node export-v2.mjs --state working --text "在做了" --ink '#FF6700' --spot '#2B1B12'
 *   node export-v2.mjs --all --out stickers
 *
 * 产物：240×240 的 GIF（16 帧 / 1.6s）与 PNG
 */
import pw from '/Users/silas/.dsh/profiles/desktop/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- 参数 ---------- */
function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const flag = n => process.argv.includes('--' + n);

const STATE = arg('state', 'idle');
const ALL = flag('all');
const OUT = arg('out', join(here, 'stickers-v2'));
const SIZE = Number(arg('size', 240));
const INK = arg('ink', '#FF6700');
const SPOT = arg('spot', '#2B1B12');
const BG = arg('bg', '#ffffff');
const TEXT = arg('text', '');
const SHAPE = arg('shape', 'sphere');
const FRAMES = Number(arg('frames', 16));
const DELAY = Number(arg('delay', 100));   // ms/帧

/* 表情包配置：状态 → 文案 */
const PACK = {
  idle: '在的',
  listening: '你说',
  thinking: '想想',        // 三个点，省略号
  curious: '好奇',         // inspecting 表情：两只眼不一样大
  streaming: '来了来了',
  working: '在做了在做了',
  blocked: '卡住了',
  finished: '搞定',
  failed: '寄了',
  surprised: '惊了',
  sleeping: '已下班',
  waking: '醒了醒了',
};

/* ---------- 页面 ---------- */
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent;}
  #stage{display:flex;flex-direction:column;align-items:center;justify-content:center;}
  #t{font-family:"PingFang SC","Hiragino Sans GB",-apple-system,sans-serif;
     font-weight:600;letter-spacing:.02em;line-height:1;white-space:nowrap;}
</style></head><body>
<div id="stage"><div id="f"></div><div id="t"></div></div>
<script type="module">
import { createFace } from './index.js';
const q = new URLSearchParams(location.search);
const size = Number(q.get('size') || 240);
const text = q.get('text') || '';
const stage = document.getElementById('stage');
const pad = text ? Math.round(size * 0.34) : 0;
const faceSize = size - pad;
stage.style.width = size + 'px';
stage.style.height = size + 'px';
if (q.get('bg')) { stage.style.background = q.get('bg'); document.body.style.display='grid'; document.body.style.placeItems='center'; document.body.style.minHeight='100vh'; }
document.getElementById('f').style.cssText = 'width:'+faceSize+'px;height:'+faceSize+'px';
if (text) {
  const t = document.getElementById('t');
  t.textContent = text;
  t.style.fontSize = '26px';
  t.style.marginTop = Math.round(size*0.035)+'px';
  t.style.color = q.get('dark') === '1' ? '#f2f2f3' : '#101014';
}
window.__face = createFace('#f', {
  shape: q.get('shape') || 'sphere',
  size: faceSize,
  color: q.get('ink') || '#FF6700',
  spot: q.get('spot') || '#2B1B12',
  state: q.get('state') || 'idle',
});
window.__ready = true;
</script></body></html>`;

writeFileSync(join(here, '_export.html'), PAGE);

/* ---------- 启动本地服务 ---------- */
const PORT = 8800 + Math.floor(Math.random() * 500);
const server = execFileSync('bash', ['-c', `cd "${here}" && (python3 -m http.server ${PORT} --bind 127.0.0.1 >/dev/null 2>&1 &) ; sleep 1; echo ok`]).toString();

/* ---------- 主流程 ---------- */
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

async function shoot(state, text, outDir) {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });

  const q = new URLSearchParams({
    state, size: String(SIZE), text: text || '',
    ink: INK, spot: SPOT, bg: BG, shape: SHAPE,
  });
  await page.goto(`http://127.0.0.1:${PORT}/_export.html?${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  await page.waitForTimeout(Number(arg('settle', 2500)));   // 等 clip 进入稳定姿态

  const box = await page.$('#stage');

  if (flag('gif')) {
    const tmp = join('/tmp', `pf-shots-${state}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < FRAMES; i++) {
      await box.screenshot({ path: join(tmp, `f_${String(i).padStart(4, '0')}.png`) });
      await page.waitForTimeout(DELAY);
    }
    const gif = join(outDir, `${state}.gif`);
    execFileSync('/opt/homebrew/bin/ffmpeg', [
      '-y', '-framerate', String(Math.round(1000 / DELAY)),
      '-i', join(tmp, 'f_%04d.png'),
      '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop', '0', gif,
    ], { stdio: 'ignore' });
    rmSync(tmp, { recursive: true, force: true });
    return gif;
  } else {
    const png = join(outDir, `${state}.png`);
    await box.screenshot({ path: png });
    return png;
  }
}

mkdirSync(OUT, { recursive: true });

if (ALL) {
  const states = Object.keys(PACK);
  const gif = flag('gif');
  for (const s of states) {
    const f = await shoot(s, flag('text') ? PACK[s] : '', OUT);
    console.log('  ' + f.split('/').pop());
  }
  console.log(`完成 → ${OUT}`);
} else {
  const f = await shoot(STATE, TEXT, OUT);
  console.log('完成 → ' + f);
}

await browser.close();
process.exit(0);

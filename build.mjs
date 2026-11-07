#!/usr/bin/env node
/* peepface build — core.js 是唯一源，生成两份产物
 *
 *   dist/peepface.js      浏览器：<script src> 直接用，暴露 window.peepface
 *   dist/dsh-client.js    DSH 插件：ModuleLoader 包装，含状态判定与拖拽
 *
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(here, p), 'utf8');

const core = read('core.js');
const adapter = read('adapters/dsh.js');

const BANNER = `/* peepface v0.1.0 — 由 build.mjs 从 core.js 生成，不要手改 */\n`;

/* 1) 浏览器版：core.js 已经是 UMD 形态，直接加 banner */
const browser = BANNER + core;

/* 2) DSH 插件版：core + adapter，包进 ModuleLoader */
const dsh = `${BANNER}window.__ModuleLoader__.load({
  id: "dsh-plugin-peepface",
  factory(require) {
${indent(core, 4)}
${indent(adapter, 4)}
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
`;

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n');
}

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/peepface.js'), browser, 'utf8');
writeFileSync(join(here, 'dist/dsh-client.js'), dsh, 'utf8');

const kb = s => (Buffer.byteLength(s) / 1024).toFixed(1);
console.log(`dist/peepface.js     ${kb(browser)} KB`);
console.log(`dist/dsh-client.js   ${kb(dsh)} KB`);

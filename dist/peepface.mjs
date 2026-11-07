/* peepface v0.1.0 — 由 build.mjs 从 core.js 生成，不要手改 */
import './peepface.js';

const api = globalThis.peepface;
if (!api) throw new Error('peepface: UMD 入口没有正确挂载');

export const createFace = api.createFace;
export const STATES = api.STATES;
export const VERSION = api.VERSION;
export default api;

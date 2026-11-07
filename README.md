<p align="center">
  <img src="assets/logo.svg" width="96" alt="peepface" />
</p>

<h1 align="center">peepface</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/peepface"><img src="https://img.shields.io/npm/v/peepface" alt="npm version"></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-FF6700" alt="license">
  <img src="https://img.shields.io/badge/22%20states-26%20shapes-FF6700" alt="22 states, 26 shapes">
  <img src="https://img.shields.io/badge/install-21%20KB-FF6700" alt="install size">
</p>

<h3 align="center">
给 AI agent 装一张会表达状态的脸<br/>
<span>22 个状态 · 26 种形状 · 一行 <code>sync()</code></span>
</h3>

<p align="center">
  <img src="assets/banner.gif" width="760" alt="peepface 的六个状态" />
</p>

```bash
npm i peepface
npx peepface-extract "/Applications/Grok Bot.app"
```

> **第二步是必须的。** 包里**不含引擎**（版权原因），提取脚本会从你本机安装的 Grok Bot 里把它拆出来。

```js
import { createFace } from 'peepface';

const face = createFace('#face', { shape: 'sphere', color: '#EDEDED', spot: '#121212' });

face.sync({ running: true, activity: { tool: 'read_file' } });
// → 脸在「读文件」
```

**它在思考、在检索、在调工具、卡住了、干完了——你扫一眼就知道，不用读那行「正在搜索…」的小字。**

---

## 目录

- [为什么不用 GIF](#为什么不用-gif)
- [状态：22 个](#状态22-个)
- [协议：说事实，不说事件](#协议说事实不说事件)
- [外观：26 种形状](#外观26-种形状)
- [自定义形状](#自定义形状)
- [换装间](#换装间)
- [DSH 插件](#dsh-插件)
- [引擎从哪来](#引擎从哪来)
- [文档](#文档)

---

## 为什么不用 GIF

| | 循环 GIF | peepface |
|---|---|---|
| 知道自己在干什么 | ❌ 一直循环 | ✅ 22 个状态 |
| 接得上你的 agent | ❌ | ✅ 一行 `sync()` |
| 换形状 / 换颜色 | 重新做图 | 改一个参数 |
| 体积 | 几百 KB 视频 | **26 KB SVG** |

**GIF 是装饰，peepface 是仪表。**

---

## 状态：22 个

```
idle  listening  thinking  searching  streaming  working
waiting  blocked  finished  failed  sleeping  waking  spawning
reading  coding  running  computing  controlling
orbit  progress  sending  writing
```

前 13 个是通用 agent 状态，后面是工具族细分（`reading` 在读文件、`running` 在跑命令、`controlling` 在操作你的机器）。

```js
face.state('blocked');
```

**别名自动转换** —— 你用自己的词，视觉上大家统一：

```js
face.state('tool_call');   // → working
face.state('error');       // → failed
face.state('done');        // → finished
```

完整对照在 [`DEFAULT_ALIASES`](index.js)。

---

## 协议：说事实，不说事件

```js
face.sync({
  running: true,                    // agent 在跑
  composing: false,                 // 正在输出文字
  activity: { tool: 'read_file' },  // 在干什么
  awaiting: null,                   // 在等人
  settlement: null,                 // 上一轮怎么结束的
});
```

**幂等** —— 重发一百遍结果一样，丢一条推送下一帧自己修正。

不需要维护状态机，不需要记事件顺序。求值只有三段：

```js
if (facts.awaiting)       return 'blocked';        // 闸门：人没回话，别的都不算
if (running || composing) return composing ? 'streaming' : verbToState(activity);
if (settlement 在 8 秒内)  return success ? 'finished' : 'failed';
return 'idle';
```

**没有优先级数字表。** `awaiting` 一非空，`running` 那条分支根本不存在——不是「打断」，是「前者消失」。

完整规格 → [PROTOCOL.md](PROTOCOL.md)

---

## 外观：26 种形状

```js
createFace('#face', {
  shape: 'cloud',       // 26 种
  color: '#1084FE',     // 11 色板 id / 任意 hex / 三位简写
  spot:  '#FFFFFF',     // 眼睛颜色（不给 = 洞，露出背景）
});
```

```
sphere cloud square sparkle clover heartChubby starFlower teardrop
tablet wedge house star6 pebble bean egg squircle capsule cylinder
hex gem crystal shield dome arch leaf pumpkin
```

**不传形状和颜色？** 按 `id` 的 hash 自动派生：

```js
createFace('#face', { id: 'agent-42' });   // → leaf #00BCA6
```

同一个 agent 永远同一张脸，**不用存任何东西**。

---

## 自定义形状

```js
import { defineShape } from 'peepface';

defineShape('myArch', {
  path: 'M 20 190 L 20 80 C 20 40 55 10 100 10 C 145 10 180 40 180 80 L 180 190 Z',
});

createFace('#face', { shape: 'myArch' });
```

<p align="center">
  <img src="assets/custom.gif" width="760" alt="三个自定义形状：花朵、云朵、水滴" />
</p>

**能力边界**（实测出来的，不是猜的）：

| 能做 | 做不了 | 为什么 |
|---|---|---|
| 凸形状（圆、蛋、胶囊…） | 深凹陷（猫耳、兔耳、星角） | 2D path 走凸包，凹角被填平。深凹要引擎的 3D 环 |
| 浅凹（心形那种） | 内部线条（斑纹、胡须） | 只有一层轮廓，没有第二个图层 |
| 眼睛自动避让 | 第三层图案（面具、蛛网） | `spot` 只是眼睛颜色，不是图案层 |
| **圆润 / 对称形状**（花、云、水滴） | **方形、菱形、任何靠方向辨认的形状** | 引擎归一化时会重新定向，菱形会被转 45° |

最后一条最容易踩。`transform` 矩阵里没有旋转分量，所以**不是动画在转——是归一化改了方向**。

```js
// ❌ 会被转歪
'M 100 8 L 192 100 L 100 192 L 8 100 Z'        // 菱形 → 斜的
// ✅ 怎么定向都成立
ms([[82,86,44], [140,86,44], [82,144,44], [140,144,44]])   // 四圆融合 → 花
```

`ms()` 是引擎的圆融合函数（`import { ms } from 'peepface/engine'`），生成的形状天然圆润。

---

## 换装间

**https://silassolivagus.github.io/peepface/studio.html**

换形状、换颜色、试穿 22 个状态、导出 PNG / SVG。

不想开服务器？先 `node build-single.mjs` 生成 `custom-standalone.html`（约 560 KB，内联引擎），双击就能开。

---

## DSH 插件

```json
// ~/.dsh/profiles/desktop/package.json
"dsh-plugin-peepface": "link:/path/to/peepface/plugin-dsh"
```

装上后右下角一张脸，**点头像换形状和颜色**，选择存 `localStorage`。

状态由 DOM 观察驱动，**不拦截任何请求**。

---

## 引擎从哪来

引擎是 **Grok Bot**（xAI 桌面客户端）里的头像动画模块，我们从它的 bundle 里拆出来，**没有改过一行**。

它负责：球面眼睛投影、贝塞尔缓动、弹簧物理、28 段关键帧、26 种形状几何、13 种装饰渲染器。

**这不是我们写的，也不在 npm 包里。**

### 为什么不带在包里

因为它的版权不属于我们。分发别人的代码 = 侵权。

所以包只有 **21 KB**（接口层 + 文档），引擎由你自己从本机 app 里提取：

```bash
npx peepface-extract "/Applications/Grok Bot.app"
# → 生成 engine.mjs (373 KB) 到你本地
```

提取脚本做的事：解开 `app.asar` → 找到 `index.eager-common-*.js` → 换掉 import/export → 写出来。全流程在 [HOW.md](HOW.md)。

### 我们写的

```
index.js            接口层：createFace / sync / defineShape / 形状与颜色的解析
extract-engine.mjs  提取脚本
adapters/           DSH 适配器：DOM 观察 → facts
PROTOCOL.md         状态协议
HOW.md              拆解方法
```

**全部价值在这里**：把一套闭源的动画能力，变成一个任何人能接上的接口——而且不搬运代码。

### 法律状态

**这个仓库不含引擎代码。** `.gitignore` 里明确排除了 `engine.mjs` 和构建产物。

- 我们分发的：接口层、协议、文档、提取脚本 — Apache-2.0
- 不分发的：引擎本体 — 版权属原厂，你自己提取，自己承担使用风险
- 表情包（`stickers/`）是用引擎渲染的衍生作品，**不建议商用**

要做类似的东西，正确做法是**读 [PROTOCOL.md](PROTOCOL.md) 的接口设计，自己实现引擎**。

---

## 文档

| | |
|---|---|
| [PROTOCOL.md](PROTOCOL.md) | 状态协议：facts 结构、求值顺序、工具映射 |
| [HOW.md](HOW.md) | 引擎是怎么从一个 382 KB 的 chunk 里拆出来的 |
| [IDEA-desktop.md](IDEA-desktop.md) | 设想：做成桌面应用 |
| [`studio.html`](studio.html) | 换装间 |
| `custom-standalone.html` | 单文件版（本地 `node build-single.mjs` 生成） |

---

## License

Apache-2.0 —— 仅覆盖 `index.js`、`adapters/`、构建脚本与文档。

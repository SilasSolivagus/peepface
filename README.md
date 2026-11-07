<div align="center">

# peepface

**agent 状态的视觉词汇表。**

12 KB · 零依赖 · 纯 SVG

</div>

---

## 为什么

现在做 agent 的人，状态只有三种表达：

```
转圈      三个点     一行小字
◜         ...        正在思考…
```

这三种**都分不清「在干活」和「卡死了」**。用户看到转圈转了三十秒，不知道应该等，还是应该去点一下。

peepface 的做法是：**给 agent 一张脸，让状态变成一眼能读的东西。**

| 状态 | 它是什么样 |
|---|---|
| `working` | 眼睛眯成一条横缝 |
| `blocked` | 身体拉长、眼歪着 —— 过不去 |
| `failed` | 圆脸 + 眼睛下垂 —— 塌了 |
| `finished` | 弯月笑眼、身体撑开一下 |

差别不在文字上，在**形状**上。不看标签也能分出「在做事」和「出问题了」。

---

## 怎么用

三行：

```html
<script src="dist/peepface.js"></script>
<div id="face"></div>
<script>
  const face = peepface.createFace(document.getElementById('face'), { state: 'working' });
</script>
```

换状态：

```js
face.setState('thinking');
```

它自己会眨眼、呼吸、跟着鼠标看。你只负责告诉它「现在在干什么」。

---

## 十二个状态

| | 状态 | 什么时候用 |
|---|---|---|
| 1 | `idle` | 没事干，但醒着 |
| 2 | `listening` | 用户在打字，我在等 |
| 3 | `thinking` | 收到请求，还没开口 |
| 4 | `searching` | 在翻找（检索、读文件） |
| 5 | `streaming` | 正在往外吐字 |
| 6 | `working` | 在做事，用户不用管 |
| 7 | `waiting` | 等你决定（审批、选择） |
| 8 | `blocked` | 过不去，需要人拉一把 |
| 9 | `finished` | 干完了 |
| 10 | `failed` | 出错了 |
| 11 | `sleeping` | 很久没人用 |
| 12 | `waking` | 被叫醒了 |

完整定义在 [`states.json`](./states.json)。每个状态都写了 **`differs_from`**（和谁不像）和 **`must_not`**（做了什么就毁了）。

**这两条才是这个项目的核心。** 代码可以从零再写一遍，但这些判断是调出来的。

---

## API

```js
const face = peepface.createFace(container, {
  state: 'idle',     // 初始状态
  size: 84,          // 像素
  dark: true,        // 深色主题（白脸黑眼）
  follow: true,      // 眼睛跟随鼠标
});

face.setState('working');
face.getState();     // 'working'
face.blink();        // 手动眨一次
face.destroy();      // 卸载，移除事件监听
```

一页可以同时跑多个实例（demo 页就是 12 个）。

---

## 别名：保留你自己的词汇

现实里没人把自己的状态叫 `working`。你叫 `tool_call`、叫 `executing`、叫 `retrieving`。

`states.json` 里有 `aliases`：

```json
{ "coding": "working", "retrieving": "searching" }
```

**你保留自己的词，视觉上大家统一。** 这也是它能当「规范」而不是「一个库」的前提——不逼人改代码。

---

## 目录

```
peepface/
├── core.js            唯一引擎（工厂版，可多实例）
├── adapters/
│   └── dsh.js         DeepSeek Harness 适配层（状态判定 + 拖拽）
├── build.mjs          core.js → dist/
├── dist/
│   ├── peepface.js    浏览器版
│   └── dsh-client.js  DSH 插件版
├── states.json        词汇表
├── index.html         十二个状态并排的 demo
└── plugin-dsh/        DeepSeek Harness 插件（不改安装包，走官方扩展点）
```

```bash
node build.mjs      # 改完 core.js 后重新生成 dist/
```

**只改 `core.js`，不要手改 `dist/`。**

---

## 视觉上唯一需要知道的一件事

**眼睛是「洞」**——它从脸的形状里挖出来，露出的是背景色。

所以背景换什么颜色、什么主题，眼睛都自动是对的。脸用页面的文字色，洞用页面的背景色。

```js
dark ? { face: '#e8e8e8', eye: 背景 } : { face: '#0a0a0c', eye: 背景 }
```

---

## 致谢

球面眼睛的几何、眨眼的分段曲线、状态语义的分层，来自对 [Grok Bot](https://x.ai/news/designing-grok-bot) 头像系统的观察与研究。

本项目不含任何原厂素材（形状路径、关键帧、配色）。全部代码与参数基于可观察行为重建。

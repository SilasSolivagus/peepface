# peepface 协议 v2 · 事实投影

> v1 的错：把「电平」做成了「边沿」。
> v2 的核心：**`state = f(现在的事实)`**，幂等、无历史、无队列。

---

## 1. 为什么推翻 v1

| | v1（事件流） | v2（事实投影） |
|---|---|---|
| 输入 | 「发生了什么」 | 「现在是什么」 |
| 丢一条消息 | 状态错了 | 下一帧自己修正 |
| 调用方负担 | 记住该发哪个事件 | 报当前状态即可 |
| 顺序 | 需要保证 | 不需要 |

原版 Grok Bot 的全部状态逻辑是 5 行纯函数，应用层**从没调过 `setState()`**。

---

## 2. 唯一的主体接口

```js
face.sync(facts);
```

`facts` 是一个**幂等快照**——你随时可以重发，结果一样。

```ts
type Facts = {
  running?:   boolean;                 // agent 在跑
  composing?: boolean;                 // 正在往外输出文字
  activity?:  {                        // 正在干什么（单槽，不是栈）
    kind?:   string;
    tool?:   string;
    detail?: string;
    target?: string;
    callId?: string;
  } | null;
  awaiting?:  {                        // 在等人
    reason:  string;
    since?:  number;
  } | null;
  settlement?: {                       // 上一轮如何结束
    outcome: 'success' | 'error';
    at:      number;                   // 时间戳 ms
  } | null;
};
```

---

## 3. 求解（就是全部逻辑）

```js
function resolve(facts, now) {
  if (!facts) return 'idle';

  if (facts.awaiting) return 'blocked';          // 闸门：人没回话，别的都不算

  if (facts.running || facts.composing) {
    if (facts.composing) return 'streaming';     // 输出压过活动
    return verbToState(facts.activity) ?? 'working';
  }

  const s = facts.settlement;
  if (s && now < s.at + 8000) {
    return s.outcome === 'success' ? 'finished' : 'failed';
  }
  return 'idle';
}
```

**没有优先级数字表。** 只有三段短路 + 一个 8 秒窗口。

---

## 4. 映射：工具名 → 语义动词 → 状态

两层，和原版一致。

**第一层**（工具名 → 动词，开放给调用方扩展）：

```js
const TOOL_VERB = {
  read_file: 'browsing',  grep: 'browsing',  web_search: 'browsing',
  write_file: 'writing',  edit: 'writing',
  bash: 'running',        exec: 'running',
  apply_patch: 'coding',
  browser: 'connecting',  fetch: 'connecting',
  screenshot: 'on-your-computer',
  ...
};
```

**第二层**（动词 → 状态，19 条，对齐原版）：

| 动词 | 状态 | 说明 |
|---|---|---|
| `browsing` | `reading` | 读文件 / 检索 |
| `searching` | `searching` | 主动搜索 |
| `writing` | `writing` | 写文件 |
| `coding` | `coding` | 改代码 |
| `running` | `running` | 跑命令 |
| `computing` | `computing` | 在**它自己的**沙箱里算 |
| `controlling` | `controlling` | 在**你的**机器上操作 |
| `connecting` | `orbit` | 联网/握手 |
| `generating` | `progress` | 生成长内容 |
| `messaging` | `sending` | 发消息给别人 |
| `thinking` | `thinking` | 纯思考 |
| `asking` | `waiting` | 工具在等你填表 |
| — | `working` | 兜底 |

> `computing` vs `controlling` 是原版当一等信息处理的区分：**在"它的"云电脑** vs **在"你的"本机**。值得抄。

---

## 5. 乐观覆盖：别等服务端

```js
face.hold({ running: true, activity: { tool: 'thinking' } }, 3000);
```

按下回车，脸立刻动，不等服务器回执。3 秒后自动失效。

**合并规则**（和原版一致）：

```js
// server 是权威，除非它还是 idle
const state = (held && stillAlive && resolve(server) === 'idle')
  ? resolve(held)
  : resolve(server);
```

意思是：本地乐观只在「服务端还没反应过来」时生效。

---

## 6. 事件糖（可选）

```js
face.emit('tool.start', { name: 'read_file' });
```

内部做的事：

```js
emit('tool.start', p) {
  this.facts.activity = { tool: p.name };
  this.facts.running = true;
  this.sync(this.facts);
}
```

**`emit` 不维护队列，只改 facts 再重算。** 所以它是糖，不是契约。

---

## 7. 三个原版有、v1 漏掉的

| 机制 | 作用 |
|---|---|
| **`spawning`** | 入场态。脸第一次出现时有个"诞生"动画，不是直接 idle |
| **1400ms 沉降去抖** | 一轮结束后 1.4 秒内不立刻回 idle，避免闪烁 |
| **渲染治理** | `size < 48px → 静态`；`idle 时停 rAF`；30↔60fps 自适应；`prefers-reduced-motion`；`data-*-state` CSS 钩子 |

---

## 8. 值域：19 个，不是 12 个

```
idle  listening  thinking  searching  streaming
working  waiting  blocked  finished  failed
sleeping  waking  spawning
reading  coding  running  computing  controlling
orbit  progress  sending  writing
```

前 12 个是「通用 agent 状态」，后面是「工具族细分」。

**调用方可以只用前 12 个**——`sync` 里不传 `activity.tool` 就自动落到 `working`。

---

## 9. 最小实现

```js
face.sync(facts)        // 唯一必需
face.state(name)        // 绕过协议直接指定（调试用）
face.hold(facts, ttl)   // 乐观覆盖
face.on('statechange')  // 观察
face.destroy()
```

其余（`emit` / `look` / `blink` / `body`）都是可选的。

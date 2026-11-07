# 这个引擎是怎么拆出来的

> 一份可复现的方法记录。
> 目标应用：Grok Bot（Electron / arm64 / v0.78.4）

---

## 0. 一句话

一个 382 KB 的压缩 ESM chunk 里装着整套头像引擎。**不改代码、不裁剪，只把 import/export 换掉**，就让它独立跑起来了。

---

## 1. 找到它

Electron 应用的代码在 `Contents/Resources/app.asar` 里。

```bash
npx asar list /Applications/Grok\ Bot.app/Contents/Resources/app.asar | grep -i avatar
```

没用上——**真正定位靠的是特征字符串**：

```bash
# 引擎里有个罕见的形状名
grep -l "squircle" dist/renderer/assets/*.js
# → index.eager-common-DbK3Oi_r.js
```

```
dist/renderer/assets/index.eager-common-DbK3Oi_r.js
sha256  fc17d4622e059ba7de70cc54d18c7fdc64a09b8d823c1904482181f21968e933
大小    382,305 chars
```

名字里的 `eager-common` 说明是**共享 chunk**——里面混着 React、i18n、调度库，头像只是乘客。

---

## 2. 让它可读

压缩代码是单行、单字母变量。先格式化：

```bash
npx prettier@3 --parser babel index.eager-common-*.js > engine.js
# 13,993 行
```

**13,993 行里只有约一半是头像引擎。** 剩下的：

| 行段 | 内容 |
|---|---|
| L1–1749 | React + i18n + 调度库 |
| L8746–10494 | 3D 数学（三角剖分、SDF、投影） |

---

## 3. 摸清结构

单字母函数名读不出语义。用 AST 数一遍：

```js
// 用 @babel/parser 遍历
// 收集：FunctionDeclaration、ArrowFunctionExpression、ObjectMethod
// 输出：名字、起止行、参数数、调用了谁
```

结果：**709 个函数**，按行号八等分：

| 区段 | 行 | 函数 | 内容 |
|---|---|---|---|
| 1 | 1–1749 | 91 | 调度 / React / i18n |
| 2 | 1750–3498 | 139 | **引擎心脏**：弹簧、四元数、眼形、变形 |
| 3 | 3499–5247 | 23 | clip 求值 + `eo`（377 行引擎主体） |
| 4 | 5248–6996 | 11 | **clip 数据**（2400 行字面量）+ 状态机 |
| 5 | 6997–8745 | 128 | 形状几何 |
| 6 | 8746–10494 | 96 | 3D 数学 |
| 7 | 10495–12243 | 125 | 渲染层 |
| 8 | 12244–13993 | 96 | 实例工厂 + 公开 API |

**注意区段 3–4：只有 34 个函数，却占了 3500 行**——里面全是关键帧数据。

---

## 4. 算依赖闭包（失败了一次）

第一版用 AST 的 `calls` 直接做 BFS，**结果全是假边**。

因为压缩后所有参数都叫 `e`/`t`/`n`/`r`/`i`，局部调用被错认成顶层同名函数。`eo` 的 47 条调用里，**23 条是局部变量**。

重做：**作用域感知解析**（参数、`var` 提升、块级 `let`、类方法、对象方法各自建栈），调用和数据引用共用一套机制。

结果：

```
752 个顶层单元 = 456 函数 + 296 数据对象
10,437 行 / 13,993 = 74.6%
```

**三处和预判相反：**

| 以为 | 实际 |
|---|---|
| 区段 6（3D 数学）可以不要 | **192/192 全在链上**——它是形状注册表的执行后端 |
| 区段 5 的「2D 留、3D 丢」 | **切不开**，两套注册表共用几何底座 |
| 区段 8 全要 | 只有 **38/137** 在链上，其余是主题 token / 上传配额 / 键盘导航 |

---

## 5. 关键决定：不裁剪

闭包是 74.6%，看起来能砍掉四分之一。

**但砍不干净。**

裁掉 25% 换来的是「可能静默画错」——几何不会报错，只会画得不对，而且你查不出来。

所以：**整包 512 KB，只改 import 和 export。**

```js
// build_engine.mjs 做的事
1. 换掉唯一的 import：  chunk-rolldown-runtime → ./_runtime.mjs
2. 截掉末尾的 export 清单
3. 追加自己的具名导出（57 个符号）
```

**没做依赖闭包提取，没做代码裁剪。** 闭包分析的价值是「知道里面有什么」，不是「砍掉什么」。

---

## 6. 原版怎么跑起来

先得知道引擎是不是纯函数。

**答案：是。**

```
eo() 内部       无 rAF、无时钟、无 DOM
采样路径需要     0 个全局
DOM 只出现在     n_（createElementNS）和 e_（属性 diff）两个函数里
attach() 才需要  document / rAF / IntersectionObserver / ResizeObserver
```

所以可以脱离浏览器做确定性采样：

```js
const eng = eo({ body: 'sphere' });
eng.seek(1.2);              // 跳到 1.2 秒
const frame = eng.frame();  // { body, quat, zoom, offset, squash, eyes, morph }
const tree = Xg(frame, appearance, 128, 'id', { displaySize: 128 });
```

**验证一致性：**

```
同一个输入（thinking @ 1.2s）
  node   → 2811 字符，hash -632289792
  Chrome → 2811 字符，hash -632289792
```

字节级一致。

---

## 7. 三个会让人白干一天的坑

**① `advance(dt)` 把 dt 硬截断在 0.1 秒**

```js
advance(1.0)   // 只推进 0.1 秒
// 想采 t=2s，必须跑 120 次 advance(1/60)
```

**② morph 激活时，clip 时间被拖慢甚至冻结**

```js
de(t * (1 - morph.amount))
// thinking 推 1.2 秒，引擎内部 time 只有 0.147
```

**永远读 `eng.time`，不要自己累加 dt。**

**③ `body` 别名必须先归一化**

```js
cc['blob']     // → cc[e] is not a function
i_('blob')     // → 'sphere'
```

---

## 8. 数字

| | |
|---|---|
| 原始 chunk | 382 KB |
| 格式化后 | 13,993 行 |
| 函数 | 709 个 |
| 依赖闭包 | 752 单元 / 10,437 行 / 74.6% |
| 移植产物 | **512 KB**（原样，未裁剪） |
| node 导入耗时 | 0.6 s |
| 单帧 | `advance + frame + 渲染树` **0.55 ms** |
| 1000 帧 | 545 ms |

---

## 9. 工具链

```bash
# 格式化
npx prettier@3 --parser babel <chunk.js> > engine.js

# AST 索引（709 个函数 + 调用关系）
node .ast/index.mjs

# 依赖闭包（作用域感知）
#   @babel/parser + 手写作用域栈

# 移植（改 import/export）
node build_engine.mjs

# 验证（node vs Chrome）
node probe.mjs --mode golden --frames 60
node shot.mjs
```

---

## 10. 这件事的边界

**这是研究，不是分发。**

- 引擎版权属原厂
- 仓库公开是为了**学习「一个闭源动画引擎是怎么组织的」**
- Apache-2.0 只覆盖我们写的接口层
- **不适合商业分发**

真正可复用的是**方法**：怎么定位、怎么算闭包、怎么验证一致性。

如果你要做类似的东西，正确做法是：

1. 读 [`PROTOCOL.md`](PROTOCOL.md) 的接口设计
2. 读这篇的拆解方法
3. **自己实现引擎**

---

## 附：这套方法能用在别的应用上吗

能，只要满足：

| 条件 | 说明 |
|---|---|
| 代码在 JS 里 | Electron / RN / 小程序 / 任何 JS bundle |
| 有特征字符串 | 能 grep 到罕见词（形状名、状态名、常量） |
| 依赖可追踪 | 知道入口函数（比如实例工厂） |

**不适用**：native 二进制、WASM、强混淆（控制流平坦化）。

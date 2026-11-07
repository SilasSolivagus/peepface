# dsh-plugin-peepface

给 DeepSeek Harness 客户端加一张会看你的脸。

- **跟随鼠标**：眼睛在球面上做正交投影，倾斜和压缩都是投影的副产品
- **眨眼**：0.26 秒，闭合在 42%，睁眼比闭眼慢
- **跟随状态**：`idle / listening / thinking / streaming / working / finished`
- **跟随主题**：脸 = 页面文字色，眼睛 = 洞露出的背景色
- **纯观察**：不拦截请求、不改任何响应，只读 DOM 与文本长度

## 安装

```bash
dsh plugin --profile desktop add /path/to/dsh-plugin-peepface
```

然后在 profile 的 `dsh.profile.bundles` 里确认包含 `dsh-plugin-peepface`，重启客户端。

## 交互

| 动作 | 效果 |
|---|---|
| 移动鼠标 | 眼睛跟随，离开窗口后回到中性漂移 |
| 点击 | 手动切状态（锁定 4 秒） |
| 右键 | 显示/隐藏调试小字 |

## 状态判定

```
rate > 55                     → streaming
1.4 秒内文本变过 & rate > 2   → working
3 秒内打过字 且输入框有内容    → listening
2 秒内按过回车 & 无输出        → thinking
文本静止 1.4 秒，且忙过        → finished（1.8 秒）
其余                          → idle
```

除 `finished` / `failed` 外，所有切换有 3 次（≈600ms）迟滞。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-plugin-peepface
```

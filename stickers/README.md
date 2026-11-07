# AI 打工人 · 表情包

12 个状态，12 句话。素材由 peepface 导出（`node export.mjs`）。

## 内容

| 文件 | 规格 | 用途 |
|---|---|---|
| `gif/*.gif` | 240×240，16 帧 / 1.6s，8–14 KB | 微信表情主图（动态） |
| `png/*.png` | 240×240，白底带字 | 静态版 / 缩略图 |
| `cover-750.png` | 750×750 | 投稿主图 |
| `banner-750x400.png` | 750×400 | 横幅 |
| `icon-50.png` | 50×50 | 图标 |
| `icon-240.png` | 240×240 | 高清图标 |
| `copy.md` | — | 文案与设计说明 |

## 重新生成

```bash
# 静态
node export.mjs --state working --sticker --text "在做了在做了" --dark 0 --bg '#ffffff' --out stickers/png

# 动态
node export.mjs --state working --sticker --gif --text "在做了在做了" --dark 0 --bg '#ffffff' --out stickers/gif
```

## 注意

微信表情开放平台要求**一组至少 16 张**，我们只有 12 个生命周期状态。
要么补 4 个 reaction（happy / confused / surprised / angry），要么只当"非官方套装"用。

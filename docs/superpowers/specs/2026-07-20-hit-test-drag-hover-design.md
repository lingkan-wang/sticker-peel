# 命中测试 / 拖动移位 / hover 引导 / 真实阴影 设计文档

日期：2026-07-20
前置：`2026-07-20-sticker-pickup-design.md`（撕下、粘手、贴回已实现并合并）

## 目标

四件事：

1. 贴平时不该有影子。影子只在贴纸离开桌面（撕起、粘手）时出现。
2. hover 到贴纸上给一句英文引导 "Peel me from any corner"。
3. 贴纸可以整张拖着走，不撕。
4. 把 demo 放进作品集的 Vibe Coding 板块。

## 命中测试与区域划分

新增：`down(x, y)` 先把落点转成相对贴纸中心的局部坐标 `[lx, ly] = [x - pos[0], y - pos[1]]`，再分三档：

| 区域 | 判定 | 结果 |
|---|---|---|
| 包围盒外 | `|lx| > W/2` 或 `|ly| > H/2` | 什么都不做，保持 `attached` |
| 边缘带 | 在盒内，且 `min(W/2 - |lx|, H/2 - |ly|) <= EDGE_BAND` | 进 `peeling` |
| 中央 | 在盒内且不在边缘带 | 进新模式 `dragging` |

`EDGE_BAND = min(W, H) * 0.22`。对当前 287×420 的贴纸约 63px。

用包围盒而不是逐像素 alpha 命中：die-cut 的透明角落会被算进边缘带，而那里恰恰是最该能撕的地方，所以这个近似方向是对的。

**副作用（有意）**：包围盒外按下不再启动撕开，一并根治上一轮最终审查发现的 Critical —— 在贴纸外空白处按下会产生不受约束的抓取点。原有的 `grabOffset` 夹取保留，作为第二道防线。

尺寸 `W`/`H` 由场景在贴图加载后确定，模式机通过构造时注入的 `stickerSizeFor()` 读取，不自己持有副本。

## 新模式 dragging

- `pos = cursor - anchor`，**1:1 直接跟随，不加弹簧**。拖动要跟手；弹簧滞后属于脱手后的 `held`，放在这里会显得飘。
- `peel = 0`、`tilt = 0`、`lift = 0` 全程不动。
- `pointerup` / `pointercancel` → 回 `attached`，位置就停在松手处。
- `dragging` 期间忽略新的 `pointerdown`。
- `idle` 在 `dragging` 时为 false（要持续渲染跟随）。

模式图更新为：

```
                 ┌─ 边缘带按下 ─> PEELING ─ peel/maxPeel > 0.75 ─> HELD ─ 点击 ─> PLACING ─┐
ATTACHED ────────┤                    └─ 松手且未过阈值 ─> 弹回 ATTACHED ─┘                │
   ^             └─ 中央按下 ─> DRAGGING ─ 松手 ─> ATTACHED(新位置)                        │
   └──────────────────────────────────────────────────────────────────────────────────────┘
```

## 阴影

现状：贴平时 `opacity` 就有 0.18，随撕开进度递减。这与"贴纸压在纸面上"不符。

改为完全由离开桌面的程度驱动：

```
peelProgress = clamp(peel / (span * 2), 0, 1)
opacity = 0.10 * peelProgress + 0.16 * lift
```

- `attached` / `dragging`：两项都是 0 → **完全没有阴影**
- `peeling`：卷边升起，投影随进度渐显
- `held`：`lift = 1`，阴影最重

缩放与偏移沿用现有逻辑（随 `lift` 变大、朝 `tilt` 反方向偏移）。

## hover 引导

- 一个 DOM 元素，不进 WebGL。`createStickerPeel` 创建并插入 `container`，`destroy()` 移除。
- 显示条件：`mode === 'attached'` **且** 最后一次 `pointermove` 的位置落在贴纸包围盒内。
- 文案固定为 `Peel me from any corner`。
- 位置跟随贴纸：水平居中于 `pos[0]`，垂直放在贴纸上边缘之上 16px。
- 用 CSS `opacity` + `transition` 淡入淡出（150ms），不占 rAF。
- 指针事件必须 `pointer-events: none`，否则标签会挡住贴纸本身的命中。

## 光标

- 边缘带：`grab`（可撕）
- 中央：`move`（可拖）
- 盒外：`default`
- 拖动中：`grabbing`；`held`：`grabbing`

由 `main.js` 在 `pointermove` 时按区域切换 `container` 上的 class。

## 作品集集成

- 把 `index.html`、`src/`、`assets/` 拷到 `~/lingkan-portfolio/public/sticker-peel/`
- `~/lingkan-portfolio/lib/coded.ts` 的 `codedWork` 数组加一条，与 `photo-transfer` 同构：
  - `slug: "sticker-peel"`
  - `live: "/sticker-peel/index.html"`
  - `offset: 0`
  - `tags`、`blurb`、`year: 2026` 按现有条目的语气写
- three.js 仍从 unpkg CDN 加载，作品集部署在 https 下可用

## 范围外

- 多张贴纸、旋转、缩放
- 逐像素 alpha 精确命中
- 拖动时的抬起感（拖动全程贴平，无影）
- 触屏上的 hover 引导（触屏没有 hover，标签不显示即可，不做替代方案）

## 验收标准

1. 贴平静止时画面上看不到任何阴影
2. 撕开过程中阴影随卷起程度渐显；粘在光标上时阴影最明显
3. 鼠标移到贴纸上出现 "Peel me from any corner"，移开消失；拖动或撕开时不显示
4. 在贴纸中央按住拖动，整张贴纸跟着走且不产生任何卷曲
5. 在贴纸边缘带按住拖动，撕开行为与现有实现一致
6. 在贴纸外面按下不产生任何反应
7. 光标形态随区域切换
8. 空闲时 rAF 已停止
9. demo 在作品集 Vibe Coding 板块中可正常交互

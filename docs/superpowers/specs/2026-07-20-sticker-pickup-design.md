# Sticker 撕下 / 粘手 / 贴回 交互设计文档

日期：2026-07-20
前置：`2026-07-19-sticker-peel-design.md`（撕开与回弹已实现并合并）

## 目标

在已有的撕贴纸 demo 上补完整个动作链：撕过阈值后贴纸真的脱落、粘在鼠标上跟着跑，再点一下贴回桌面。贴纸画面换成用户提供的异形 die-cut 照片贴纸。

## 模式机

```
ATTACHED ──按住拖──> PEELING ──peel/maxPeel > 0.75──> HELD ──pointerdown──> PLACING ──> ATTACHED(新位置)
              └── 松手且未过阈值 ──> 弹簧回弹 ──> ATTACHED(原位)
```

新增纯逻辑模块 `src/sticker-machine.js`，内部持有一个现有的 `PeelState` 实例负责撕开数学，自己负责模式、位置、倾斜。**不修改 `src/peel-state.js`**，其 21 个既有测试保持绿色。

对外每帧吐一个状态对象：

```js
{
  mode: 'attached' | 'peeling' | 'placing' | 'held',
  pos:  [number, number],   // 贴纸中心的画布局部坐标（原点居中，y 轴向上，CSS 像素）
  dir:  [number, number],   // 单位向量，卷曲方向
  peel: number,             // 卷起线推进距离
  tilt: number,             // 弧度，绕 Z 轴
  lift: number,             // 0..1，离开桌面的程度，只驱动阴影
}
```

`main.js` 只做映射：`pos` → `mesh.position`，`tilt` → `mesh.rotation.z`，`dir`/`peel` → uniform，`lift` → 阴影的 opacity / scale / offset。`main.js` 内不含任何模式判断。

## 各模式行为

### ATTACHED
贴纸静止在 `pos`，`peel = 0`、`tilt = 0`、`lift = 0`。可从此处再次撕开。

**关键改动**：撕开用的局部坐标必须相对 `pos` 计算，不能再假设贴纸在原点。`down(x, y)` 收到的是画布坐标，内部转成 `[x - pos[0], y - pos[1]]` 再喂给 `PeelState`。

### PEELING
沿用现有 `PeelState` 逻辑。每帧在 `step()` 之后检查 `peel / maxPeel > DETACH_THRESHOLD`（0.75）；越线立即转 HELD，抓取偏移取自按下那一刻记录的 `PeelState.anchor`（贴纸局部坐标下最初按下的那一点），而不是脱落瞬间的光标位置。

未越线时松手 → `PeelState` 的弹簧回弹 → `peel` 归零后转回 ATTACHED。

### HELD
- `peel` 用弹簧收敛到 `maxPeel * HELD_CURL`（0.18），保留可见卷边而不抹平。
- `pos` 用欠阻尼弹簧追踪目标 `cursor - anchor`（`anchor` 即按下时记录的 `PeelState.anchor`，贴纸局部坐标），也就是让用户最初按下的那一点始终跟在指尖下——捏住贴纸哪里，哪里就该待在指尖下。弹簧参数 `stiffness 0.18 / damping 0.82`，特征值是复数，会带一点过冲再收敛，刻意保留约 60ms 滞后与轻微摆动 —— 这个过冲加滞后就是惯性感的来源，不是延迟 bug。若误用脱落瞬间的光标位置做锚点，会把贴纸永久吊在离光标一整个拖拽距离（往往三四百像素）远处，稍一移动光标贴纸就可能飞出可视区域。
- `tilt = clamp(-vx * TILT_GAIN, ±MAX_TILT)`，`vx` 取自位置弹簧的横向速度，`TILT_GAIN = 0.06`，`MAX_TILT = 14°`。横向甩动时贴纸尾巴摆动。
- `lift` 用弹簧升到 1。阴影随之变大、变淡，偏移方向与 `tilt` 相反（贴纸往左甩，影子往右偏）。
- `dir` 冻结在脱落瞬间的值，不再跟随光标，否则卷边会在手上乱转。

**边界处理（必须）**：进入 HELD 时置 `awaitingRelease = true`。这一帧用户手指还按在屏幕上，紧接着到来的 `pointerup` 只清除该标志，不触发贴下。只有 `awaitingRelease` 为 false 之后的全新 `pointerdown` 才转 PLACING。

### PLACING
由 `pointerdown` 触发（不等 `pointerup`，更跟手）。`pos` 锁死在点击处，`peel`、`tilt`、`lift` 三者一起弹簧归零。三者都归零后转 ATTACHED。

PLACING 期间忽略一切指针输入，避免半程被打断产生中间态。

## 贴纸贴图

画面换成用户提供的异形 die-cut 照片贴纸（PNG，带 alpha）。

- `src/sticker-texture.js` 增加 `loadStickerTexture(url)`，走 `THREE.TextureLoader`；保留现有的 canvas 绘制路径作为图片加载失败时的兜底。
- 贴纸的世界尺寸由图片宽高比推导：长边固定 `STICKER_LONG = 420`，短边按比例算。现在写死的 `420 × 260` 改为运行时计算。
- 片元着色器**无需改动**：现有的 `if (face.a < 0.01) discard;` 已经能切出异形边。
- 纹理加载是异步的：加载完成前渲染跳过，完成后触发一次 `wake()`。加载失败则回退到 canvas 贴纸并在 console 记一条 warning。

## 资源清理

沿用现有约定并扩展：`sticker-machine.js` 是纯数学、无监听。新增的纹理在 `dispose()` 中释放。`ResizeObserver`、pointer 监听、rAF 的清理逻辑不变。

## 范围外（明确不做）

- 多张贴纸同时存在 / 堆叠
- 手动旋转或缩放贴纸
- 撕下后的胶痕、残留
- 贴纸飞出视口的边界约束（允许贴到任意位置，包括部分出屏）

## 验收标准

1. 从贴纸任意位置按住拖动，撕开行为与现有实现一致
2. 撕过 75% 时贴纸脱手粘到光标上，不需要拖到 100%
3. 脱手瞬间那次松手不会被误判为"贴下去"
4. HELD 状态下移动鼠标，贴纸带滞后跟随，横向甩动时有可见的摆动
5. HELD 状态下点击，贴纸在点击处平复贴好
6. 贴好之后可以从新位置再撕一次，循环无异常
7. 异形贴纸的透明区不显示为白色方块
8. 空闲时 rAF 已停止

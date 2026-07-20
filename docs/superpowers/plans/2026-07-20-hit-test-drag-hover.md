# 命中测试 / 拖动 / hover 引导 / 真实阴影 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 贴平时无影子；hover 出英文引导；贴纸中央可整张拖走、边缘带才撕；把 demo 放进作品集 Vibe Coding。

**Architecture:** 命中测试与新的 `dragging` 模式加进纯逻辑 `StickerMachine`（继续零 DOM、零 three.js）。贴纸半跨度**从已注入的 `maxProjectionFor` 反推**（`maxProjectionFor(1,0) = W/2`、`maxProjectionFor(0,1) = H/2`），因此构造函数签名不变、也不会与场景的贴图换图脱节。阴影、光标、hover 标签都落在 `main.js` 与 `index.html`。

**Tech Stack:** 原生 ES Modules、three.js 0.160.0（unpkg ESM CDN）、GLSL、Vitest（仅测纯逻辑）

## Global Constraints

- 参考 spec：`docs/superpowers/specs/2026-07-20-hit-test-drag-hover-design.md`
- **不得修改** `src/peel-state.js` 与 `src/shaders.js`
- `src/sticker-machine.js` 必须是纯数学：只 import `./peel-state.js`，不得引用 `window`、`document`、three.js
- **不得**出现任何滑杆、控制面板、参数调试 UI
- 无构建工具、无框架、无服务端、无新增 npm 依赖
- 所有监听、rAF、observer、DOM 节点必须可清理；rAF 在 `idle` 时停止、交互时唤醒
- 坐标约定：画布局部坐标，原点在画布中心，**y 轴向上**，单位 CSS 像素
- 引导文案精确为 `Peel me from any corner`
- 新增常量：`EDGE_BAND_RATIO = 0.22`
- 阴影公式精确为 `opacity = peelProgress * 0.10 + lift * 0.16`
- hover 标签必须 `pointer-events: none`
- Git 提交信息用中文，含需求与实现两节

## 对 spec 的一处简化（实现以此为准）

spec 写「模式机通过构造时注入的 `stickerSizeFor()` 读取尺寸」。实际不需要新注入：现有的 `maxProjectionFor(dx, dy)` 定义就是 `(|dx|·W + |dy|·H) / 2`，所以 `maxProjectionFor(1,0)` 恰为 `W/2`、`maxProjectionFor(0,1)` 恰为 `H/2`，可精确反推。这样构造函数签名不变、既有测试不受影响，且换图后自动跟随。

## File Structure

| 文件 | 职责 | 状态 |
|---|---|---|
| `src/peel-state.js` | 撕开数学 | **不改** |
| `src/shaders.js` | GLSL | **不改** |
| `src/sticker-machine.js` | 模式机：新增命中测试与 `dragging` | 改 |
| `src/main.js` | 阴影公式、光标区域、hover 标签 | 改 |
| `index.html` | 光标与标签样式 | 改 |
| `tests/sticker-machine.test.js` | 新增命中测试与拖动用例 | 改 |

---

### Task 1: 命中测试与 dragging 模式

**Files:**
- Modify: `src/sticker-machine.js`
- Test: `tests/sticker-machine.test.js`

**Interfaces:**
- Consumes: 现有 `StickerMachine`（构造签名不变：`new StickerMachine(maxProjectionFor, initialPos)`）
- Produces:
  - `EDGE_BAND_RATIO = 0.22` 导出常量
  - `machine.hitZone(x, y): 'outside' | 'edge' | 'center'`（画布坐标）
  - `machine.mode` 新增取值 `'dragging'`
  - `machine.dragAnchor: [number, number]`

- [ ] **Step 1: 写失败的测试**

在 `tests/sticker-machine.test.js` 末尾追加（顶部已有的 `proj`、`W = 420`、`H = 260`、`StickerMachine` 引入直接复用；把 `EDGE_BAND_RATIO` 并入文件顶部那条已存在的 `import { ... } from '../src/sticker-machine.js';`，不要在文件中间另起一条 import）：

```js
describe('StickerMachine 命中测试', () => {
  // W=420 H=260 → 半跨度 210 × 130，边缘带 = min(420,260) * 0.22 = 57.2
  const BAND = Math.min(W, H) * EDGE_BAND_RATIO;

  it('包围盒外返回 outside', () => {
    const m = new StickerMachine(proj, [0, 0]);
    expect(m.hitZone(400, 0)).toBe('outside');
    expect(m.hitZone(0, 200)).toBe('outside');
    expect(m.hitZone(-400, -200)).toBe('outside');
  });

  it('正中央返回 center', () => {
    const m = new StickerMachine(proj, [0, 0]);
    expect(m.hitZone(0, 0)).toBe('center');
  });

  it('贴近边缘返回 edge', () => {
    const m = new StickerMachine(proj, [0, 0]);
    expect(m.hitZone(210 - 1, 0)).toBe('edge');      // 右缘内侧
    expect(m.hitZone(0, 130 - 1)).toBe('edge');      // 上缘内侧
    expect(m.hitZone(-(210 - 1), -(130 - 1))).toBe('edge');
  });

  it('边缘带宽度符合 EDGE_BAND_RATIO', () => {
    const m = new StickerMachine(proj, [0, 0]);
    // 距右缘刚好超过一个带宽 → center；刚好不到 → edge
    expect(m.hitZone(210 - BAND - 1, 0)).toBe('center');
    expect(m.hitZone(210 - BAND + 1, 0)).toBe('edge');
  });

  it('区域随贴纸位置移动，不假设贴纸在原点', () => {
    const m = new StickerMachine(proj, [300, -150]);
    expect(m.hitZone(300, -150)).toBe('center');
    expect(m.hitZone(0, 0)).toBe('outside');
    expect(m.hitZone(300 + 210 - 1, -150)).toBe('edge');
  });
});

describe('StickerMachine 拖动移位', () => {
  it('在贴纸外按下不产生任何反应', () => {
    const m = new StickerMachine(proj, [0, 0]);
    m.down(600, 350);
    expect(m.mode).toBe('attached');
    m.move(200, 200);
    for (let i = 0; i < 60; i += 1) m.step();
    expect(m.mode).toBe('attached');
    expect(m.pos).toEqual([0, 0]);
    expect(m.peel).toBe(0);
  });

  it('按中央进入 dragging，按边缘进入 peeling', () => {
    const a = new StickerMachine(proj, [0, 0]);
    a.down(0, 0);
    expect(a.mode).toBe('dragging');

    const b = new StickerMachine(proj, [0, 0]);
    b.down(205, 0);
    expect(b.mode).toBe('peeling');
  });

  it('拖动是 1:1 跟随，没有弹簧滞后', () => {
    const m = new StickerMachine(proj, [0, 0]);
    m.down(20, 10);                 // 中央按下，抓取点偏离中心
    m.move(320, 210);
    m.step();                       // 只走一帧就应完全到位
    expect(m.pos[0]).toBeCloseTo(300, 6);
    expect(m.pos[1]).toBeCloseTo(200, 6);
  });

  it('拖动期间不产生任何卷曲、倾斜或抬起', () => {
    const m = new StickerMachine(proj, [0, 0]);
    m.down(0, 0);
    for (let i = 1; i <= 40; i += 1) {
      m.move(i * 10, i * 6);
      m.step();
      expect(m.peel).toBe(0);
      expect(m.tilt).toBe(0);
      expect(m.lift).toBe(0);
    }
  });

  it('松手回到 attached 并停在松手处', () => {
    const m = new StickerMachine(proj, [0, 0]);
    m.down(0, 0);
    m.move(150, -80);
    m.step();
    m.up();
    expect(m.mode).toBe('attached');
    expect(m.pos[0]).toBeCloseTo(150, 6);
    expect(m.pos[1]).toBeCloseTo(-80, 6);
    expect(m.idle).toBe(true);
  });

  it('dragging 期间不空闲，忽略新的 down', () => {
    const m = new StickerMachine(proj, [0, 0]);
    m.down(0, 0);
    expect(m.idle).toBe(false);
    m.down(205, 0);                 // 边缘再按一次，应被忽略
    expect(m.mode).toBe('dragging');
  });

  it('拖到新位置后可以从新位置的边缘撕开', () => {
    const m = new StickerMachine(proj, [0, 0]);
    m.down(0, 0);
    m.move(250, 100);
    m.step();
    m.up();
    expect(m.pos[0]).toBeCloseTo(250, 6);

    // 新位置的右缘
    m.down(250 + 205, 100);
    expect(m.mode).toBe('peeling');
    m.move(250 + 205 + 400, 100);
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/sticker-peel-demo && npm test tests/sticker-machine.test.js`
Expected: FAIL，`m.hitZone is not a function`

- [ ] **Step 3: 加入常量与命中测试**

在 `src/sticker-machine.js` 的常量区（`EPS_M` 那一行之后）追加：

```js
// 边缘带宽度占贴纸短边的比例。带内按下 = 撕，带内以外 = 整张拖走
export const EDGE_BAND_RATIO = 0.22;
```

在构造函数里，`this.liftVel = 0;` 之后追加：

```js
    // dragging 期间光标相对贴纸中心的固定偏移
    this.dragAnchor = [0, 0];
```

在 `_maxPeel()` 之后追加两个方法：

```js
  /**
   * 贴纸半跨度 [hx, hy]。从 maxProjectionFor 反推而不另存一份：
   * maxProjectionFor 的定义是 (|dx|·W + |dy|·H)/2，所以 (1,0) 恰为 W/2、(0,1) 恰为 H/2。
   * 换贴图后场景会重算尺寸，这样命中区域自动跟着走，不会残留旧尺寸
   */
  _halfExtent() {
    return [this.maxProjectionFor(1, 0), this.maxProjectionFor(0, 1)];
  }

  /** 画布坐标落在贴纸的哪个区域 */
  hitZone(x, y) {
    const [hx, hy] = this._halfExtent();
    const lx = Math.abs(x - this.pos[0]);
    const ly = Math.abs(y - this.pos[1]);
    if (lx > hx || ly > hy) return 'outside';
    const band = Math.min(hx * 2, hy * 2) * EDGE_BAND_RATIO;
    return Math.min(hx - lx, hy - ly) <= band ? 'edge' : 'center';
  }
```

- [ ] **Step 4: 按区域分派 down，并加入 dragging**

把 `down()` 替换为：

```js
  down(x, y) {
    this.cursor = [x, y];
    if (this.mode === 'attached') {
      const zone = this.hitZone(x, y);
      // 贴纸外按下什么都不做：既是正确的命中行为，也堵住了"在空白处起手
      // 导致抓取点不受贴纸尺寸约束"这条路
      if (zone === 'outside') return;
      if (zone === 'center') {
        this.mode = 'dragging';
        this.dragAnchor = [x - this.pos[0], y - this.pos[1]];
        return;
      }
      this.mode = 'peeling';
      this.peelState.down(x - this.pos[0], y - this.pos[1]);
      return;
    }
    if (this.mode === 'held' && !this.awaitingRelease) {
      this._beginPlacing();
    }
    // peeling / dragging / placing：忽略，避免中途重入产生中间态
  }
```

把 `up()` 替换为：

```js
  up() {
    if (this.mode === 'peeling') {
      this.peelState.up();
    } else if (this.mode === 'held') {
      this.awaitingRelease = false;
    } else if (this.mode === 'dragging') {
      this.mode = 'attached';
    }
  }
```

把 `step()` 替换为：

```js
  step() {
    if (this.mode === 'peeling') this._stepPeeling();
    else if (this.mode === 'held') this._stepHeld();
    else if (this.mode === 'placing') this._stepPlacing();
    else if (this.mode === 'dragging') this._stepDragging();
  }
```

在 `_stepHeld()` 之前追加：

```js
  _stepDragging() {
    // 1:1 跟随，不加弹簧。拖动要跟手；滞后感是 held 的事，放这里只会显得飘
    this.pos[0] = this.cursor[0] - this.dragAnchor[0];
    this.pos[1] = this.cursor[1] - this.dragAnchor[1];
  }
```

把 `get idle()` 的最后一行 `return false;` 保持不变即可 —— `dragging` 会走到那一行，返回 false，正是要的（拖动期间必须持续渲染）。确认这一点后不要改动该 getter。

- [ ] **Step 5: 运行全部测试确认通过**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，62 passed（50 既有 + 12 新增）

- [ ] **Step 6: 提交**

```bash
cd ~/sticker-peel-demo
git add src/sticker-machine.js tests/sticker-machine.test.js
git commit -m "功能: 命中测试与拖动移位

需求: 贴纸要能整张拖着走; 但现在按住拖就是撕, 必须先能区分两者, 且在贴纸外按下不应有任何反应
实现: 新增 hitZone 把落点分成 outside/edge/center 三档(半跨度从 maxProjectionFor 反推, 换贴图后自动跟随), 边缘带撕、中央进新的 dragging 模式 1:1 跟随、盒外直接忽略"
```

---

### Task 2: 阴影改为离开桌面驱动，光标随区域切换

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `machine.hitZone(x, y)`、`machine.mode` from Task 1
- Produces: `container` 上的 `zone-edge` / `zone-center` / `zone-outside` class

- [ ] **Step 1: 改阴影公式**

在 `src/main.js` 的 `setSticker` 中，把这三行：

```js
    const curlScale = 1 - progress * 0.25;
    const liftScale = curlScale * (1 + lift * 0.35);
    shadowMaterial.opacity = (0.18 - progress * 0.12) * (1 - lift * 0.45);
```

替换为：

```js
    const curlScale = 1 - progress * 0.25;
    const liftScale = curlScale * (1 + lift * 0.35);
    // 影子完全由"离开桌面的程度"驱动：贴平（attached / dragging）时两项都是 0，
    // 一点影子都不该有——真贴纸压在纸面上是不投影的
    shadowMaterial.opacity = progress * 0.1 + lift * 0.16;
```

- [ ] **Step 2: 改样式**

在 `index.html` 的样式块中，把：

```css
  #stage {
    position: fixed;
    inset: 0;
    cursor: grab;
    touch-action: none;
  }
  #stage.is-dragging { cursor: grabbing; }
```

替换为：

```css
  #stage {
    position: fixed;
    inset: 0;
    cursor: default;
    touch-action: none;
  }
  #stage.zone-edge { cursor: grab; }
  #stage.zone-center { cursor: move; }
  #stage.is-dragging,
  #stage.is-holding { cursor: grabbing; }
```

（`#stage.is-holding { cursor: grabbing; }` 原本已存在，合并到这一条即可，不要留下重复规则。）

- [ ] **Step 3: 在 pointermove 里切换区域 class**

把 `src/main.js` 的 `onPointerMove` 替换为：

```js
  function onPointerMove(event) {
    // held 期间没有按住的手指（activePointerId 为 null），但贴纸要跟着光标跑，
    // 所以只在这一个模式下放宽 pointerId 校验。其余模式（尤其是松手后仍在回弹的
    // peeling）必须继续只认发起拖拽的那根手指，否则第二根手指的移动会串进来，
    // 按第一根手指的锚点改写撕开量
    if (machine.mode !== 'held' && event.pointerId !== activePointerId) return;
    const [x, y] = toLocal(event);
    machine.move(x, y);
    updateZone(x, y);
    wake();
  }
```

注意：`activePointerId` 在没有按下时是 `null`，而 `event.pointerId` 永远不是 `null`，所以 `attached` 下单纯的鼠标移动会在上面那一行被挡掉。区域 class 与后续的 hover 标签都依赖 attached 下的移动，因此**再挂一个独立的 hover 监听**，不参与拖拽的 pointerId 逻辑。在 `onPointerMove` 之后追加：

```js
  /** 悬停位置，仅用于光标形态与引导标签；与拖拽的 pointerId 无关 */
  let hoverZone = 'outside';

  function updateZone(x, y) {
    hoverZone = machine.mode === 'attached' ? machine.hitZone(x, y) : 'outside';
    container.classList.toggle('zone-edge', hoverZone === 'edge');
    container.classList.toggle('zone-center', hoverZone === 'center');
  }

  function onHoverMove(event) {
    const [x, y] = toLocal(event);
    updateZone(x, y);
  }

  function onHoverLeave() {
    hoverZone = 'outside';
    container.classList.remove('zone-edge', 'zone-center');
  }
```

在现有的监听注册处（`container.addEventListener('pointerdown', onPointerDown);` 那一组）追加：

```js
  container.addEventListener('pointermove', onHoverMove);
  container.addEventListener('pointerleave', onHoverLeave);
```

在 `destroy()` 的移除列表中相应追加：

```js
    container.removeEventListener('pointermove', onHoverMove);
    container.removeEventListener('pointerleave', onHoverLeave);
```

在 `tick()` 里，`container.classList.toggle('is-holding', ...)` 那一行之后追加一行，让贴纸移动后光标形态立即跟上（例如拖动结束、贴下落位后）：

```js
    if (machine.mode !== 'attached') onHoverLeave();
```

- [ ] **Step 4: 运行测试确认没被改坏**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，62 passed

- [ ] **Step 5: 浏览器验收**

用 preview 工具（不要用 Bash）：`preview_start` 传 `{name: "sticker"}`。

预览标签报告 `document.hidden = true` 并节流 rAF。要驱动动画必须自己接管 `requestAnimationFrame`，且**必须用 Map 存多个句柄** —— 页面同时有 tick 循环和 resize 合并两个独立句柄，单槽实现会互相踩掉，测出来的结论是假的。另外：页面加载时 `ResizeObserver` 会立刻用真实的（被节流的）rAF 占住循环句柄，导致后装的接管永远收不到回调。可靠做法是装好接管之后，清空 `#stage` 并重新 `import('./src/main.js?fresh=' + Date.now())` 再调用 `createStickerPeel(stage)`，让新实例的所有句柄都走你的 Map。

逐条确认：
- 贴平静止时画面上**看不到任何阴影**
- 撕开过程中阴影随卷起程度渐显；脱手粘在光标上时阴影最明显
- 鼠标在贴纸中央 → 光标是 `move`；移到边缘带 → `grab`；移出贴纸 → `default`
- `read_console_messages` 无报错

- [ ] **Step 6: 提交**

```bash
cd ~/sticker-peel-demo
git add src/main.js index.html
git commit -m "功能: 阴影改为离开桌面驱动, 光标随区域切换

需求: 贴纸贴平压在纸面上时不该有影子, 影子只在撕起/粘手时出现; 光标要能提示当前区域是可撕还是可拖
实现: 阴影 opacity 改为 peelProgress*0.10 + lift*0.16, attached 与 dragging 下两项均为 0; 另挂一组独立的 hover 监听维护区域 class, 不与拖拽的 pointerId 逻辑纠缠"
```

---

### Task 3: hover 引导标签

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2 的 `hoverZone`、`updateZone`、`onHoverLeave`；`machine.mode`、`machine.pos`
- Produces: `container` 内一个 `.peel-hint` 节点，由 `destroy()` 移除

- [ ] **Step 1: 加样式**

在 `index.html` 的样式块末尾（`#stage canvas { display: block; }` 之后）追加：

```css
  .peel-hint {
    position: absolute;
    left: 0;
    top: 0;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(28, 26, 24, 0.88);
    color: #fff;
    font: 500 13px/1 -apple-system, system-ui, "Helvetica Neue", sans-serif;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 150ms ease;
    /* 必须穿透：否则标签会盖在贴纸上方接走 hover, 命中在标签与贴纸之间反复横跳,
       表现为文案不停闪烁 */
    pointer-events: none;
  }
  .peel-hint.is-visible { opacity: 1; }
```

- [ ] **Step 2: 创建标签节点**

在 `src/main.js` 的 `createStickerPeel` 中，`const machine = new StickerMachine(...)` 之后追加：

```js
  const hint = document.createElement('div');
  hint.className = 'peel-hint';
  hint.textContent = 'Peel me from any corner';
  container.appendChild(hint);
```

- [ ] **Step 3: 定位与显隐**

在 `updateZone` 之后追加：

```js
  /** 标签跟着贴纸走：水平居中于贴纸，垂直放在贴纸上边缘之上 16px */
  function layoutHint() {
    const show = machine.mode === 'attached' && hoverZone !== 'outside';
    hint.classList.toggle('is-visible', show);
    if (!show) return;
    const rect = container.getBoundingClientRect();
    const halfH = scene.maxProjection(0, 1);
    hint.style.left = `${rect.width / 2 + machine.pos[0]}px`;
    hint.style.top = `${rect.height / 2 - machine.pos[1] - halfH - 16}px`;
    hint.style.transform = 'translate(-50%, -100%)';
  }
```

把 Task 2 里的 `updateZone` 末尾补一行调用：

```js
  function updateZone(x, y) {
    hoverZone = machine.mode === 'attached' ? machine.hitZone(x, y) : 'outside';
    container.classList.toggle('zone-edge', hoverZone === 'edge');
    container.classList.toggle('zone-center', hoverZone === 'center');
    layoutHint();
  }
```

把 Task 2 里的 `onHoverLeave` 也补一行：

```js
  function onHoverLeave() {
    hoverZone = 'outside';
    container.classList.remove('zone-edge', 'zone-center');
    layoutHint();
  }
```

- [ ] **Step 4: 清理**

在 `destroy()` 中，`scene.dispose();` 之前追加：

```js
    if (hint.parentNode) hint.parentNode.removeChild(hint);
```

- [ ] **Step 5: 运行测试确认没被改坏**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，62 passed

- [ ] **Step 6: 浏览器验收**

`preview_start` 传 `{name: "sticker"}`，用 Task 2 Step 5 描述的同一套 rAF 接管方式（Map 多句柄 + 重新实例化）。

逐条确认：
- 鼠标移到贴纸上，`Peel me from any corner` 淡入；移开淡出
- 标签位于贴纸正上方、水平居中
- 把贴纸拖到别处后，标签跟着贴纸走（不是留在原处）
- 拖动中、撕开中、粘在光标上时标签**不显示**
- 鼠标停在标签正下方靠近贴纸上缘处，文案不闪烁（验证 `pointer-events: none` 生效）
- `read_console_messages` 无报错

- [ ] **Step 7: 提交**

```bash
cd ~/sticker-peel-demo
git add src/main.js index.html
git commit -m "功能: hover 引导标签

需求: 鼠标移到贴纸上时给一句英文引导, 告诉用户可以从边角撕下
实现: DOM 层一个 .peel-hint 节点(不进 WebGL), 仅在 attached 且指针落在贴纸内时淡入, 位置跟随贴纸; 设 pointer-events:none 防止标签接走 hover 导致文案闪烁; destroy 时移除节点"
```

---

### Task 4: 放进作品集 Vibe Coding

**Files:**
- Create: `~/lingkan-portfolio/public/sticker-peel/`（拷贝 demo 产物）
- Modify: `~/lingkan-portfolio/lib/coded.ts`

**Interfaces:**
- Consumes: `~/sticker-peel-demo` 的 `index.html`、`src/`、`assets/`
- Produces: `codedWork` 数组新增一条 `slug: "sticker-peel"`

注意：本任务在**另一个仓库** `~/lingkan-portfolio` 里提交，不要把它的改动混进 `~/sticker-peel-demo` 的提交。

- [ ] **Step 1: 拷贝 demo 产物**

```bash
cd ~/lingkan-portfolio
rm -rf public/sticker-peel
mkdir -p public/sticker-peel
cp ~/sticker-peel-demo/index.html public/sticker-peel/
cp -R ~/sticker-peel-demo/src public/sticker-peel/
cp -R ~/sticker-peel-demo/assets public/sticker-peel/
ls -R public/sticker-peel | head -20
```

Expected: 目录下有 `index.html`、`src/`（5 个 .js）、`assets/sticker-dog.png`。不要拷 `tests/`、`tools/`、`docs/`、`package.json`、`node_modules/`。

- [ ] **Step 2: 加数据条目**

在 `~/lingkan-portfolio/lib/coded.ts` 的 `codedWork` 数组**开头**（`photo-transfer` 那条之前）插入：

```ts
  {
    slug: "sticker-peel",
    title: "Sticker — peel it off, carry it, stick it back",
    blurb:
      "A die-cut sticker you actually peel. Drag from any edge and a vertex shader curls the sheet around a cylinder, showing the paper backing underneath; pull past three quarters and it comes away in your cursor, swinging with the weight of it. Click to lay it back down anywhere. Grab it by the middle instead and you just slide it around.",
    tags: ["Three.js", "GLSL", "Spring Physics"],
    year: 2026,
    live: "/sticker-peel/index.html",
    offset: 0,
  },
```

- [ ] **Step 3: 本地起作品集验收**

在 `~/lingkan-portfolio/.claude/launch.json` 里已有名为 `portfolio` 的配置（`npm run dev`，端口 3000）。用 `preview_start` 传 `{name: "portfolio"}` 启动，然后导航到 `http://localhost:3000/playground#vibe-coding`。

逐条确认：
- Vibe Coding 标签页里出现 "Sticker — peel it off, carry it, stick it back" 卡片
- iframe 内贴纸正常渲染（不是空白、不是灰底方块）
- 在 iframe 内可以撕开、脱手、拖动
- `read_console_messages` 无报错

若 iframe 内是空白，先检查 `public/sticker-peel/index.html` 里的模块路径是否仍是相对路径 `./src/main.js`（应当是），以及 three.js 的 unpkg CDN 是否可达。

- [ ] **Step 4: 提交作品集仓库**

```bash
cd ~/lingkan-portfolio
git add public/sticker-peel lib/coded.ts
git commit -m "内容: Vibe Coding 新增撕贴纸交互

需求: 把 sticker-peel demo 放进作品集的可玩 demo 板块
实现: demo 产物拷进 public/sticker-peel, lib/coded.ts 加一条与 photo-transfer 同构的记录"
```

---

## Self-Review

**Spec 覆盖核对**

| Spec 要求 | 落在哪 |
|---|---|
| 三档命中：盒外/边缘带/中央 | Task 1 `hitZone` + 5 条测试 |
| `EDGE_BAND_RATIO = 0.22` | Task 1 常量 + 带宽测试 |
| 半跨度从场景读取、换图跟随 | Task 1 `_halfExtent` 从 `maxProjectionFor` 反推 |
| 盒外按下无反应（含根治 Critical） | Task 1 `down` 的 outside 分支 + 测试 |
| `dragging` 1:1 跟随 | Task 1 `_stepDragging` + 单帧到位测试 |
| dragging 期间 peel/tilt/lift 为 0 | Task 1（该模式不碰这三个字段）+ 测试 |
| 松手回 attached 停在原处 | Task 1 `up` + 测试 |
| dragging 不 idle | Task 1（走 `get idle` 的 `return false`）+ 测试 |
| 阴影 `progress*0.10 + lift*0.16` | Task 2 Step 1 |
| 贴平无阴影 | Task 2 Step 1 + Step 5 目视 |
| 光标随区域切换 | Task 2 Step 2/3 |
| hover 文案 `Peel me from any corner` | Task 3 Step 2 |
| 标签跟随贴纸位置 | Task 3 `layoutHint` + Step 6 目视 |
| 标签 `pointer-events: none` | Task 3 Step 1 + Step 6 闪烁验证 |
| 标签在非 attached 时不显示 | Task 3 `layoutHint` 的 `show` 条件 |
| DOM 节点可清理 | Task 3 Step 4 |
| 作品集 Vibe Coding 集成 | Task 4 |
| 验收标准 1–9 | Task 2 Step 5、Task 3 Step 6、Task 4 Step 3 |

无遗漏。

**实现中的两处非显然点（已写进对应任务）**

1. `onPointerMove` 现在的首行是 `if (machine.mode !== 'held' && event.pointerId !== activePointerId) return;`。`attached` 下没有按下时 `activePointerId` 为 `null`，而 `event.pointerId` 永远不是 `null`，所以纯 hover 的移动会被这一行挡掉。区域 class 和引导标签都依赖 attached 下的移动，因此 Task 2 另挂了一组 `onHoverMove` / `onHoverLeave`，与拖拽的 pointerId 逻辑完全分开。
2. `.peel-hint` 若不设 `pointer-events: none`，标签会盖在贴纸上方接走 hover，命中在标签与贴纸之间反复横跳，表现为文案不停闪烁。Task 3 Step 1 的注释里写明了原因。

**Placeholder 扫描:** 无 TBD / TODO / "类似 Task N" / 空泛的"加上错误处理"。每个改代码的步骤都给了完整代码。

**类型一致性:** `hitZone` 在 Task 1 定义并导出区域字符串 `'outside'|'edge'|'center'`，Task 2 的 `updateZone` 与 Task 3 的 `layoutHint` 都按同一组字符串判断；`machine.pos` 全程是 `[number, number]`；`scene.maxProjection(0, 1)` 在 Task 3 用来取半高，与 Task 1 `_halfExtent` 的口径一致。

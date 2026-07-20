# Sticker 撕下 / 粘手 / 贴回 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有撕贴纸 demo 上补完动作链：撕过 75% 贴纸脱落粘到光标上跟随，点击后在新位置贴回，可循环。

**Architecture:** 新增纯逻辑模块 `src/sticker-machine.js`，内部持有一个现有 `PeelState` 实例负责撕开数学，自己管模式（attached/peeling/held/placing）、位置弹簧、倾斜与抬起。`src/peel-state.js` 一行不改，其 21 个既有测试保持绿色。`main.js` 只把机器的状态字段映射到 mesh transform 与 uniform，不含模式判断。

**Tech Stack:** 原生 ES Modules、three.js 0.160.0（unpkg ESM CDN）、GLSL、Vitest（仅测纯逻辑）

## Global Constraints

- 参考 spec：`docs/superpowers/specs/2026-07-20-sticker-pickup-design.md`
- **不得修改** `src/peel-state.js`；`tests/peel-state.test.js` 现有 21 个测试必须全程保持通过
- **不得**出现任何滑杆、控制面板、参数调试 UI
- 唯一交互方式是 pointer 拖拽 + 点击（鼠标与触摸共用 pointer 事件）
- 无构建工具、无框架、无服务端、无新增 npm 依赖；Vitest 仅用于单元测试，不参与运行时
- `src/sticker-machine.js` 必须是纯数学：零 import 除了 `./peel-state.js`，不得引用 `window`、`document`、three.js
- 所有监听、rAF、observer 必须可清理；rAF 在 `idle` 时停止、交互时唤醒
- 坐标约定：画布局部坐标，原点在画布中心，**y 轴向上**，单位 CSS 像素
- 阈值常量（精确值）：`DETACH_THRESHOLD = 0.75`、`HELD_CURL = 0.18`、`FOLLOW_K = 0.18`、`FOLLOW_DAMP = 0.82`、`TILT_GAIN = 0.06`、`MAX_TILT = 14 * Math.PI / 180`、`LIFT_K = 0.15`、`LIFT_DAMP = 0.75`、`PLACE_K = 0.2`、`PLACE_DAMP = 0.7`、`TILT_RETURN = 0.2`、`EPS_M = 0.001`
- Git 提交信息用中文，含需求与实现两节

## File Structure

| 文件 | 职责 | 状态 |
|---|---|---|
| `src/peel-state.js` | 撕开数学（方向 slerp、进度、回弹） | **不改** |
| `src/sticker-machine.js` | 模式机：位置、倾斜、抬起、模式迁移 | 新建 |
| `src/sticker-texture.js` | canvas 绘制贴纸 + 从 PNG 加载贴图 | 扩展 |
| `src/main.js` | three.js 装配、状态到 mesh/uniform 的映射、事件与 rAF | 改 |
| `src/shaders.js` | GLSL | **不改** |
| `index.html` | 页面骨架 | **不改** |
| `tests/sticker-machine.test.js` | 模式机单测 | 新建 |

---

### Task 1: 模式机骨架 —— attached / peeling / 脱落判定

**Files:**
- Create: `src/sticker-machine.js`
- Test: `tests/sticker-machine.test.js`

**Interfaces:**
- Consumes: `PeelState` from `./peel-state.js`（`down(x,y)` / `move(x,y)` / `up()` / `step()` / `setMaxPeel(n)` / `.dir` / `.peel` / `.idle`；坐标以贴纸中心为原点）
- Produces:
  - `class StickerMachine { constructor(maxProjectionFor: (dx:number, dy:number) => number, initialPos?: [number, number]) }`
  - `machine.down(x: number, y: number): void`（画布坐标）
  - `machine.move(x: number, y: number): void`
  - `machine.up(): void`
  - `machine.step(): void`
  - 只读字段：`machine.mode: 'attached'|'peeling'|'held'|'placing'`、`machine.pos: [number,number]`、`machine.dir: [number,number]`、`machine.peel: number`、`machine.tilt: number`、`machine.lift: number`
  - `get machine.idle: boolean`
  - 导出常量 `DETACH_THRESHOLD`、`HELD_CURL`、`FOLLOW_K`、`FOLLOW_DAMP`、`TILT_GAIN`、`MAX_TILT`、`LIFT_K`、`LIFT_DAMP`、`PLACE_K`、`PLACE_DAMP`、`TILT_RETURN`、`EPS_M`

本任务只实现 attached / peeling 两个模式与「越过阈值转 held」的判定。held 与 placing 的内部运动留给 Task 2，本任务里进入 held 后除了记录字段不做任何运动。

- [ ] **Step 1: 写失败的测试**

创建 `tests/sticker-machine.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { StickerMachine, DETACH_THRESHOLD } from '../src/sticker-machine.js';

const W = 420;
const H = 260;
/** 与 main.js 里的 maxProjection 同构：贴纸在给定方向上的半跨度 */
const proj = (dx, dy) => (Math.abs(dx) * W + Math.abs(dy) * H) / 2;

/** 造一台位于 origin 的机器 */
function make(origin = [0, 0]) {
  return new StickerMachine(proj, origin);
}

/** 按住并朝 +x 拖 distance 像素，泵 frames 帧 */
function dragRight(m, from, distance, frames = 200) {
  m.down(from[0], from[1]);
  m.move(from[0] + distance, from[1]);
  for (let i = 0; i < frames; i += 1) m.step();
}

describe('StickerMachine 模式迁移', () => {
  it('初始是 attached，停在给定位置，完全贴平', () => {
    const m = make([120, -40]);
    expect(m.mode).toBe('attached');
    expect(m.pos).toEqual([120, -40]);
    expect(m.peel).toBe(0);
    expect(m.tilt).toBe(0);
    expect(m.lift).toBe(0);
    expect(m.idle).toBe(true);
  });

  it('按下即进入 peeling', () => {
    const m = make();
    m.down(0, 0);
    expect(m.mode).toBe('peeling');
    expect(m.idle).toBe(false);
  });

  it('撕开量小于阈值时松手会弹回 attached 且完全贴平', () => {
    const m = make();
    m.down(0, 0);
    m.move(60, 0);              // 60 远小于 420 * 0.75
    for (let i = 0; i < 40; i += 1) m.step();
    expect(m.mode).toBe('peeling');
    m.up();
    for (let i = 0; i < 400; i += 1) m.step();
    expect(m.mode).toBe('attached');
    expect(m.peel).toBe(0);
    expect(m.idle).toBe(true);
  });

  it('撕过阈值会自动脱落进入 held，不需要松手', () => {
    const m = make();
    dragRight(m, [0, 0], 400);   // 400 / 420 > 0.75
    expect(m.mode).toBe('held');
  });

  it('脱落发生在越过阈值的那一刻，而不是拖满', () => {
    const m = make();
    const maxPeel = proj(1, 0) * 2;
    m.down(0, 0);
    m.move(maxPeel * 0.8, 0);    // 只拖到 80%，没拖满
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
  });

  it('撕开坐标相对贴纸当前位置，不假设贴纸在原点', () => {
    const origin = [200, 100];
    const m = make(origin);
    // 在贴纸正中央按下：锚点应当是贴纸局部的 (0,0)，往 +x 拖足够远即脱落
    dragRight(m, origin, 400);
    expect(m.mode).toBe('held');
  });

  it('脱落时置 awaitingRelease，随后那次 up 只清标志不贴下', () => {
    const m = make();
    dragRight(m, [0, 0], 400);
    expect(m.mode).toBe('held');
    m.up();                      // 撕开那一按的松手
    expect(m.mode).toBe('held');
    m.step();
    expect(m.mode).toBe('held');
  });

  it('还没松手时按下不会贴下去', () => {
    const m = make();
    dragRight(m, [0, 0], 400);
    m.down(10, 10);              // awaitingRelease 仍为 true
    expect(m.mode).toBe('held');
  });

  it('阈值常量是 0.75', () => {
    expect(DETACH_THRESHOLD).toBe(0.75);
  });

  it('placing 与 peeling 期间的 down 被忽略，不会重入', () => {
    const m = make();
    m.down(0, 0);
    expect(m.mode).toBe('peeling');
    m.down(50, 50);              // 已在 peeling，忽略
    expect(m.mode).toBe('peeling');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/sticker-peel-demo && npm test tests/sticker-machine.test.js`
Expected: FAIL，`Failed to resolve import "../src/sticker-machine.js"`

- [ ] **Step 3: 实现模式机骨架**

创建 `src/sticker-machine.js`：

```js
import { PeelState } from './peel-state.js';

export const DETACH_THRESHOLD = 0.75;
export const HELD_CURL = 0.18;
export const FOLLOW_K = 0.18;
export const FOLLOW_DAMP = 0.82;
export const TILT_GAIN = 0.06;
export const MAX_TILT = (14 * Math.PI) / 180;
export const LIFT_K = 0.15;
export const LIFT_DAMP = 0.75;
export const PLACE_K = 0.2;
export const PLACE_DAMP = 0.7;
export const TILT_RETURN = 0.2;
export const EPS_M = 0.001;

/**
 * 贴纸模式机。只做数学，不碰 DOM 也不碰 three.js。
 * 坐标是画布局部坐标：原点在画布中心，y 轴向上，单位 CSS 像素。
 *
 * attached ──按住拖──> peeling ──超过阈值──> held ──点击──> placing ──> attached(新位置)
 *                          └── 松手且未过阈值 ──> 弹回 attached(原位)
 */
export class StickerMachine {
  /**
   * @param maxProjectionFor 贴纸在给定单位方向上的半跨度，由场景几何提供
   * @param initialPos 贴纸初始中心位置
   */
  constructor(maxProjectionFor, initialPos = [0, 0]) {
    this.maxProjectionFor = maxProjectionFor;
    this.mode = 'attached';
    this.pos = [initialPos[0], initialPos[1]];
    this.dir = [1, 0];
    this.peel = 0;
    this.tilt = 0;
    this.lift = 0;

    this.peelState = new PeelState(this._maxPeel());
    this.cursor = [0, 0];
    // 脱落瞬间贴纸中心相对光标的偏移，held 期间保持不变，贴纸才不会跳到光标正中
    this.grabOffset = [0, 0];
    // 脱落那一刻用户手指还按着；紧接着到来的 up 只用来清掉这个标志，不能当成"贴下去"的点击
    this.awaitingRelease = false;

    this.posVel = [0, 0];
    this.peelVel = 0;
    this.liftVel = 0;
  }

  /** 当前方向下的撕开量上限 */
  _maxPeel() {
    return this.maxProjectionFor(this.dir[0], this.dir[1]) * 2;
  }

  down(x, y) {
    this.cursor = [x, y];
    if (this.mode === 'attached') {
      this.mode = 'peeling';
      this.peelState.down(x - this.pos[0], y - this.pos[1]);
      return;
    }
    if (this.mode === 'held' && !this.awaitingRelease) {
      this._beginPlacing();
    }
    // peeling / placing：忽略，避免中途重入产生中间态
  }

  move(x, y) {
    this.cursor = [x, y];
    if (this.mode === 'peeling') {
      this.peelState.move(x - this.pos[0], y - this.pos[1]);
    }
  }

  up() {
    if (this.mode === 'peeling') {
      this.peelState.up();
    } else if (this.mode === 'held') {
      this.awaitingRelease = false;
    }
  }

  step() {
    if (this.mode === 'peeling') this._stepPeeling();
    // held / placing 的运动在 Task 2 实现
  }

  _stepPeeling() {
    this.peelState.setMaxPeel(this._maxPeel());
    this.peelState.step();
    this.dir = this.peelState.dir;
    this.peel = this.peelState.peel;

    if (this.peel / this._maxPeel() > DETACH_THRESHOLD) {
      this._detach();
      return;
    }
    if (this.peelState.idle) this.mode = 'attached';
  }

  _detach() {
    this.mode = 'held';
    this.awaitingRelease = true;
    this.grabOffset = [this.pos[0] - this.cursor[0], this.pos[1] - this.cursor[1]];
    this.posVel = [0, 0];
    this.peelVel = 0;
    this.liftVel = 0;
  }

  _beginPlacing() {
    this.mode = 'placing';
    // 位置冻结在贴纸当前所在处，而不是光标处：光标带着 grabOffset 和跟随滞后，
    // snap 到光标会让贴纸在落下瞬间跳一下
    this.posVel = [0, 0];
  }

  get idle() {
    return this.mode === 'attached' && this.peelState.idle;
  }
}
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，30 passed（21 既有 + 9 新增）

- [ ] **Step 5: 提交**

```bash
cd ~/sticker-peel-demo
git add src/sticker-machine.js tests/sticker-machine.test.js
git commit -m "功能: 贴纸模式机骨架与脱落判定

需求: 撕过 75% 时贴纸应自动脱手, 且脱手那一刻的松手不能被误判为贴下去
实现: 新增纯逻辑 StickerMachine 包住现有 PeelState, 管 attached/peeling 两态与越阈脱落; 撕开坐标改为相对贴纸当前位置计算, 不再假设贴纸在原点; 脱落时置 awaitingRelease 吞掉紧随其后的那次 up"
```

---

### Task 2: held 跟随摆动与 placing 贴回

**Files:**
- Modify: `src/sticker-machine.js`（补齐 `step()` 的 held / placing 分支与 `idle` 判定）
- Test: `tests/sticker-machine.test.js`（在既有 `describe` 之后追加一个新 `describe`）

**Interfaces:**
- Consumes: Task 1 的 `StickerMachine`，字段 `mode/pos/dir/peel/tilt/lift/cursor/grabOffset/posVel/peelVel/liftVel/awaitingRelease`
- Produces: 同一个类，`step()` 在 held 与 placing 下产生运动；`idle` 在 held 静止时为 true（否则 rAF 永不停）

- [ ] **Step 1: 写失败的测试**

在 `tests/sticker-machine.test.js` 末尾追加：

```js
import { MAX_TILT, HELD_CURL } from '../src/sticker-machine.js';

/** 撕到脱手并完成那次松手，返回处于 held 且可接受点击的机器 */
function toHeld(origin = [0, 0]) {
  const m = new StickerMachine(proj, origin);
  m.down(origin[0], origin[1]);
  m.move(origin[0] + 400, origin[1]);
  for (let i = 0; i < 200; i += 1) m.step();
  m.up();
  return m;
}

describe('StickerMachine held 跟随', () => {
  it('贴纸带滞后追光标，最终收敛到光标加抓取偏移', () => {
    const m = toHeld();
    const offset = [m.grabOffset[0], m.grabOffset[1]];
    m.move(300, 150);
    for (let i = 0; i < 400; i += 1) m.step();
    expect(m.pos[0]).toBeCloseTo(300 + offset[0], 1);
    expect(m.pos[1]).toBeCloseTo(150 + offset[1], 1);
  });

  it('跟随是滞后的，不是瞬间吸附', () => {
    const m = toHeld();
    const startX = m.pos[0];
    m.move(600, 0);
    m.step();
    // 一帧内只能走过去一小段，远没到位
    expect(m.pos[0]).toBeGreaterThan(startX);
    expect(Math.abs(m.pos[0] - (600 + m.grabOffset[0]))).toBeGreaterThan(50);
  });

  it('横向甩动时产生倾斜，方向与速度相反', () => {
    const m = toHeld();
    m.move(600, 0);              // 往 +x 甩
    for (let i = 0; i < 5; i += 1) m.step();
    expect(m.posVel[0]).toBeGreaterThan(0);
    expect(m.tilt).toBeLessThan(0);
  });

  it('倾斜被夹在 MAX_TILT 以内', () => {
    const m = toHeld();
    for (let round = 0; round < 6; round += 1) {
      m.move(round % 2 === 0 ? 4000 : -4000, 0);   // 疯狂来回甩
      for (let i = 0; i < 6; i += 1) {
        m.step();
        expect(Math.abs(m.tilt)).toBeLessThanOrEqual(MAX_TILT + 1e-9);
      }
    }
  });

  it('held 时保留可见卷边，收敛到 maxPeel * HELD_CURL', () => {
    const m = toHeld();
    for (let i = 0; i < 400; i += 1) m.step();
    const expected = proj(m.dir[0], m.dir[1]) * 2 * HELD_CURL;
    expect(m.peel).toBeCloseTo(expected, 1);
    expect(m.peel).toBeGreaterThan(0);
  });

  it('held 时 lift 升到 1', () => {
    const m = toHeld();
    for (let i = 0; i < 400; i += 1) m.step();
    expect(m.lift).toBeCloseTo(1, 2);
  });

  it('held 期间方向冻结，光标乱动也不会让卷边在手上转', () => {
    const m = toHeld();
    const frozen = [m.dir[0], m.dir[1]];
    m.move(-500, 400);
    for (let i = 0; i < 100; i += 1) m.step();
    expect(m.dir[0]).toBeCloseTo(frozen[0], 6);
    expect(m.dir[1]).toBeCloseTo(frozen[1], 6);
  });

  it('held 静止后进入 idle，光标再动则重新唤醒', () => {
    const m = toHeld();
    for (let i = 0; i < 800; i += 1) m.step();
    expect(m.idle).toBe(true);
    m.move(300, 300);
    expect(m.idle).toBe(false);
  });
});

describe('StickerMachine 贴回与循环', () => {
  it('松手后点击进入 placing', () => {
    const m = toHeld();
    m.down(100, 100);
    expect(m.mode).toBe('placing');
  });

  it('placing 时位置冻结在贴纸当前处，不跳到光标', () => {
    const m = toHeld();
    for (let i = 0; i < 200; i += 1) m.step();
    const frozen = [m.pos[0], m.pos[1]];
    m.down(999, -999);
    m.step();
    expect(m.pos[0]).toBeCloseTo(frozen[0], 6);
    expect(m.pos[1]).toBeCloseTo(frozen[1], 6);
  });

  it('placing 把 peel / tilt / lift 一起收到 0 并转回 attached', () => {
    const m = toHeld();
    for (let i = 0; i < 200; i += 1) m.step();
    m.down(0, 0);
    for (let i = 0; i < 1000; i += 1) m.step();
    expect(m.mode).toBe('attached');
    expect(m.peel).toBe(0);
    expect(m.tilt).toBe(0);
    expect(m.lift).toBe(0);
    expect(m.idle).toBe(true);
  });

  it('placing 期间忽略指针输入', () => {
    const m = toHeld();
    m.down(0, 0);
    expect(m.mode).toBe('placing');
    m.down(50, 50);
    expect(m.mode).toBe('placing');
    m.up();
    expect(m.mode).toBe('placing');
  });

  it('贴好之后可以从新位置再撕一次，完成完整循环', () => {
    const m = toHeld();
    m.move(250, 120);
    for (let i = 0; i < 400; i += 1) m.step();
    m.down(250, 120);
    for (let i = 0; i < 1000; i += 1) m.step();
    expect(m.mode).toBe('attached');
    const placedAt = [m.pos[0], m.pos[1]];

    // 从新位置再撕一次
    m.down(placedAt[0], placedAt[1]);
    m.move(placedAt[0] + 400, placedAt[1]);
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
  });

  it('连续三轮撕下贴回不出异常状态', () => {
    const m = new StickerMachine(proj, [0, 0]);
    for (let round = 0; round < 3; round += 1) {
      const at = [m.pos[0], m.pos[1]];
      m.down(at[0], at[1]);
      m.move(at[0] + 400, at[1]);
      for (let i = 0; i < 200; i += 1) m.step();
      expect(m.mode).toBe('held');
      m.up();
      for (let i = 0; i < 200; i += 1) m.step();
      m.down(m.pos[0], m.pos[1]);
      for (let i = 0; i < 1000; i += 1) m.step();
      expect(m.mode).toBe('attached');
      expect(m.peel).toBe(0);
      expect(m.idle).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/sticker-peel-demo && npm test tests/sticker-machine.test.js`
Expected: FAIL，held 相关用例报错（`pos` 不动、`tilt` 恒为 0、`mode` 停在 held）

- [ ] **Step 3: 补齐 held 与 placing**

把 `src/sticker-machine.js` 的 `step()` 替换为：

```js
  step() {
    if (this.mode === 'peeling') this._stepPeeling();
    else if (this.mode === 'held') this._stepHeld();
    else if (this.mode === 'placing') this._stepPlacing();
  }

  _stepHeld() {
    // 位置：临界阻尼弹簧追光标。刻意留下滞后 —— 这个滞后就是惯性感的来源
    const targetX = this.cursor[0] + this.grabOffset[0];
    const targetY = this.cursor[1] + this.grabOffset[1];
    this.posVel[0] = (this.posVel[0] + (targetX - this.pos[0]) * FOLLOW_K) * FOLLOW_DAMP;
    this.posVel[1] = (this.posVel[1] + (targetY - this.pos[1]) * FOLLOW_K) * FOLLOW_DAMP;
    this.pos[0] += this.posVel[0];
    this.pos[1] += this.posVel[1];

    // 卷边：收到一个固定的微卷量，不抹平
    const targetPeel = this._maxPeel() * HELD_CURL;
    this.peelVel = (this.peelVel + (targetPeel - this.peel) * PLACE_K) * PLACE_DAMP;
    this.peel += this.peelVel;

    // 倾斜由横向速度导出：往右甩则贴纸尾巴向左摆
    this.tilt = clamp(-this.posVel[0] * TILT_GAIN, -MAX_TILT, MAX_TILT);

    // 抬离桌面：只驱动阴影
    this.liftVel = (this.liftVel + (1 - this.lift) * LIFT_K) * LIFT_DAMP;
    this.lift += this.liftVel;
  }

  _stepPlacing() {
    this.peelVel = (this.peelVel + (0 - this.peel) * PLACE_K) * PLACE_DAMP;
    this.peel += this.peelVel;

    this.liftVel = (this.liftVel + (0 - this.lift) * PLACE_K) * PLACE_DAMP;
    this.lift += this.liftVel;

    this.tilt += (0 - this.tilt) * TILT_RETURN;

    if (
      Math.abs(this.peel) < EPS_M && Math.abs(this.peelVel) < EPS_M &&
      Math.abs(this.lift) < EPS_M && Math.abs(this.liftVel) < EPS_M &&
      Math.abs(this.tilt) < EPS_M
    ) {
      this.peel = 0;
      this.peelVel = 0;
      this.lift = 0;
      this.liftVel = 0;
      this.tilt = 0;
      this.mode = 'attached';
      // 贴纸已经落在新位置：把撕开状态机的锚点世界观一并归零，下次撕开重新取样
      this.peelState = new PeelState(this._maxPeel());
    }
  }
```

在文件末尾（class 之外）追加：

```js
function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}
```

把 `idle` getter 替换为：

```js
  get idle() {
    if (this.mode === 'attached') return this.peelState.idle;
    if (this.mode === 'held') {
      // held 也要能进 idle，否则贴纸挂在光标上时 rAF 永远停不下来。
      // 光标一动 move() 会改 cursor，下一帧弹簧又有活干，主循环负责重新唤醒。
      const dx = this.cursor[0] + this.grabOffset[0] - this.pos[0];
      const dy = this.cursor[1] + this.grabOffset[1] - this.pos[1];
      const peelGap = this._maxPeel() * HELD_CURL - this.peel;
      return (
        Math.abs(dx) < EPS_M && Math.abs(dy) < EPS_M &&
        Math.abs(this.posVel[0]) < EPS_M && Math.abs(this.posVel[1]) < EPS_M &&
        Math.abs(peelGap) < EPS_M && Math.abs(this.peelVel) < EPS_M &&
        Math.abs(1 - this.lift) < EPS_M && Math.abs(this.liftVel) < EPS_M
      );
    }
    return false;   // peeling / placing 期间始终在动
  }
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，43 passed（21 既有 + 9 Task 1 + 13 本任务）

- [ ] **Step 5: 提交**

```bash
cd ~/sticker-peel-demo
git add src/sticker-machine.js tests/sticker-machine.test.js
git commit -m "功能: 粘手跟随摆动与点击贴回

需求: 脱手后贴纸粘在光标上带惯性跟随, 点击后在当前位置平复贴好, 可循环再撕
实现: held 用临界阻尼弹簧追光标并保留滞后, 由横向速度导出限幅倾斜, lift 驱动阴影; placing 把 peel/tilt/lift 一起收零后转回 attached 并重建 PeelState; held 静止时也判 idle, 避免贴纸挂在光标上时 rAF 停不下来"
```

---

### Task 3: 接到场景上

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `StickerMachine` from `./sticker-machine.js`（字段 `mode/pos/dir/peel/tilt/lift`、方法 `down/move/up/step`、getter `idle`）
- Produces: `createScene` 的返回对象把 `setPeel(dir, peel)` 换成 `setSticker(pos, dir, peel, tilt, lift)`；`createStickerPeel(container)` 签名与返回值不变（仍返回 `{ destroy }`）

- [ ] **Step 1: 把 setPeel 换成 setSticker**

在 `src/main.js` 中，把 `setPeel` 函数整体替换为：

```js
  function setSticker(pos, dir, peel, tilt, lift) {
    uniforms.uDir.value.set(dir[0], dir[1]);
    const span = maxProjection(dir[0], dir[1]);
    uniforms.uLine.value = -span + peel;

    sticker.position.set(pos[0], pos[1], 0);
    sticker.rotation.z = tilt;

    // 贴纸被卷起后接触面变小：阴影同步收缩、变淡
    // 释放弹簧欠阻尼，peel 会短暂冲到负值；下限也要夹住，否则贴纸已经贴平了
    // 阴影还在按负 progress 反向变亮变大
    const progress = Math.min(Math.max(peel / (span * 2), 0), 1);
    const curlScale = 1 - progress * 0.25;
    // 抬离桌面：影子变大、变淡，并朝倾斜的反方向偏移
    const liftScale = curlScale * (1 + lift * 0.35);
    shadowMaterial.opacity = (0.18 - progress * 0.12) * (1 - lift * 0.45);
    shadow.scale.set(liftScale, liftScale, 1);
    shadow.position.set(
      pos[0] - tilt * 90 * lift,
      pos[1] - STICKER_H * 0.06 - lift * 18,
      -1
    );
  }
```

把 `createScene` 返回对象里的 `setPeel` 改成 `setSticker`：

```js
  return {
    setSticker,
    resize,
    render,
    dispose,
    maxProjection,
  };
```

- [ ] **Step 2: 让 createStickerPeel 改用 StickerMachine**

把 `src/main.js` 顶部的 import 改为：

```js
import { StickerMachine } from './sticker-machine.js';
```

（删掉 `import { PeelState } from './peel-state.js';` —— `peel-state.js` 现在由 `sticker-machine.js` 间接引用。）

把 `createStickerPeel` 里 `const state = new PeelState(...)` 那一行替换为：

```js
  const machine = new StickerMachine(scene.maxProjection, [0, 0]);
```

把 `tick` 替换为：

```js
  function tick() {
    machine.step();
    scene.setSticker(machine.pos, machine.dir, machine.peel, machine.tilt, machine.lift);
    scene.render();
    container.classList.toggle('is-holding', machine.mode === 'held');
    frame = machine.idle ? 0 : requestAnimationFrame(tick);
  }
```

把三个指针处理函数替换为：

```js
  function onPointerDown(event) {
    if (activePointerId !== null) return; // 已经有一根手指在操作了，忽略其余的
    activePointerId = event.pointerId;
    const [x, y] = toLocal(event);
    machine.down(x, y);
    container.classList.add('is-dragging');
    container.setPointerCapture?.(event.pointerId);
    wake();
  }

  function onPointerMove(event) {
    // held 期间没有按住的手指，但贴纸要跟着光标跑，所以这里不能再要求 pointerId 匹配
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    const [x, y] = toLocal(event);
    machine.move(x, y);
    wake();
  }

  function onPointerUp(event) {
    if (event.pointerId !== activePointerId) return;
    machine.up();
    activePointerId = null;
    container.classList.remove('is-dragging');
    container.releasePointerCapture?.(event.pointerId);
    wake();
  }
```

把文件末尾的初始化两行替换为：

```js
  scene.setSticker(machine.pos, machine.dir, 0, 0, 0);
  scene.render();
```

- [ ] **Step 3: 运行全部测试确认没被改坏**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，43 passed

- [ ] **Step 4: 在浏览器里验收**

用 preview 工具（不要用 Bash）：`preview_start` 传 `{name: "sticker"}`。

预览标签会报告 `document.hidden = true` 并节流 rAF。要驱动动画必须自己接管 `requestAnimationFrame`，且**必须用 Map 存多个句柄** —— 页面里同时存在 tick 循环和 resize 合并两个独立句柄，用单槽实现会互相踩掉，测出来的结论是假的：

```js
const q = new Map();
let nextId = 1;
window.requestAnimationFrame = (cb) => { const id = nextId++; q.set(id, cb); return id; };
window.cancelAnimationFrame = (id) => { q.delete(id); };
window.__pump = (n) => {
  let ran = 0;
  for (let i = 0; i < n; i++) {
    if (q.size === 0) break;
    const batch = [...q.entries()];
    q.clear();
    for (const [, cb] of batch) cb(performance.now());
    ran += 1;
  }
  return ran;
};
window.__q = q;
```

接管必须在页面加载之后、派发任何指针事件之前安装，否则模块的循环里会攥着一个来自真实节流 rAF 的旧句柄，`wake()` 判断 `!frame` 为假就再也不请求新帧了。

逐条确认：
- 撕开行为与之前一致（拖动方向即卷起方向，方向平滑跟随）
- 往一个方向拖足够远，贴纸脱手；此时松开鼠标，贴纸**不会**掉下去
- 移动鼠标，贴纸带滞后跟随；横向快速甩动时能看到明显摆动
- 点击，贴纸在当前位置平复贴好
- 从新位置再撕一次，循环正常
- `read_console_messages` 无报错
- 静止后 `q.size === 0`（rAF 已停）

- [ ] **Step 5: 提交**

```bash
cd ~/sticker-peel-demo
git add src/main.js
git commit -m "功能: 把模式机接到场景上

需求: 贴纸要能移动位置、倾斜、抬离桌面, 场景不能再假设它固定在原点
实现: setPeel 扩展为 setSticker, 额外驱动 mesh 的 position/rotation 与阴影的偏移缩放; createStickerPeel 改用 StickerMachine; pointermove 不再要求 pointerId 匹配, 否则 held 期间没有按住的手指就收不到移动"
```

---

### Task 4: 贴图支持 PNG 素材

**Files:**
- Modify: `src/sticker-texture.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `drawSticker(canvas, w, h, dpr)`、`textureMetrics(w, h, dpr)` from `./sticker-texture.js`
- Produces: `STICKER_IMAGE_URL: string | null` 与 `loadStickerImage(url): Promise<HTMLImageElement>` from `./sticker-texture.js`

贴纸画面最终要换成一张异形 die-cut 照片贴纸（PNG，带 alpha）。素材文件尚未提供，因此本任务交付的是**加载通路**：`STICKER_IMAGE_URL` 为 `null` 时走现有 canvas 贴纸，设成路径时走图片。素材到位后只需改这一个常量。

片元着色器无需改动 —— 现有的 `if (face.a < 0.01) discard;` 已经能切出异形边。

- [ ] **Step 1: 在 sticker-texture.js 里加图片加载**

在 `src/sticker-texture.js` 末尾追加：

```js
/**
 * 贴纸图片素材路径。为 null 时使用 canvas 绘制的 Lingkan 贴纸。
 * 换成异形 die-cut 照片贴纸时，把这里改成 PNG 路径即可（需带 alpha 通道）。
 */
export const STICKER_IMAGE_URL = null;

/** 加载贴纸图片。失败时 reject，由调用方回退到 canvas 贴纸。 */
export function loadStickerImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`贴纸图片加载失败: ${url}`));
    img.src = url;
  });
}
```

- [ ] **Step 2: 让场景按图片宽高比推导贴纸尺寸**

在 `src/main.js` 顶部把 import 改为：

```js
import { drawSticker, STICKER_IMAGE_URL, loadStickerImage } from './sticker-texture.js';
```

把开头的尺寸常量替换为：

```js
const STICKER_LONG = 420;        // 贴纸长边固定，短边按素材宽高比推导
let STICKER_W = 420;
let STICKER_H = 260;
const CURL_RADIUS = 26;
const SEGMENTS = 160;
```

在 `createScene` 内部、`const geometry = ...` 之前插入替换贴图的函数：

```js
  /** 用图片素材替换贴纸贴图，并按其宽高比重建几何 */
  function applyStickerImage(img) {
    const ratio = img.naturalWidth / img.naturalHeight;
    if (ratio >= 1) {
      STICKER_W = STICKER_LONG;
      STICKER_H = STICKER_LONG / ratio;
    } else {
      STICKER_H = STICKER_LONG;
      STICKER_W = STICKER_LONG * ratio;
    }

    const nextTexture = new THREE.Texture(img);
    nextTexture.colorSpace = THREE.SRGBColorSpace;
    nextTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    nextTexture.needsUpdate = true;
    uniforms.uTex.value.dispose();
    uniforms.uTex.value = nextTexture;

    sticker.geometry.dispose();
    sticker.geometry = new THREE.PlaneGeometry(STICKER_W, STICKER_H, SEGMENTS, SEGMENTS);
    shadow.geometry.dispose();
    shadow.geometry = new THREE.PlaneGeometry(STICKER_W * 1.25, STICKER_H * 1.6);
  }
```

把 `dispose()` 里的 `geometry.dispose();` 与 `texture.dispose();` 两行替换为（几何与贴图可能已被换过，必须释放当前那一份而不是构造时那一份）：

```js
    sticker.geometry.dispose();
    uniforms.uTex.value.dispose();
```

把 `createScene` 的返回对象补上 `applyStickerImage`：

```js
  return {
    setSticker,
    resize,
    render,
    dispose,
    maxProjection,
    applyStickerImage,
  };
```

- [ ] **Step 3: 在 createStickerPeel 里发起加载**

在 `createStickerPeel` 中，`scene.setSticker(...)` 与 `scene.render()` 两行之前插入：

```js
  if (STICKER_IMAGE_URL) {
    loadStickerImage(STICKER_IMAGE_URL).then(
      (img) => {
        if (destroyed) return;   // 加载期间页面可能已经被销毁
        scene.applyStickerImage(img);
        wake();
      },
      (err) => {
        console.warn(err.message, '—— 回退到 canvas 贴纸');
      }
    );
  }
```

注意 `let destroyed = false;` 的声明当前在 `createStickerPeel` 靠后的位置，而这段代码引用了它。把 `let destroyed = false;` 上移到 `let activePointerId = null;` 那一行的紧后面，避免暂时性死区报错。

- [ ] **Step 4: 运行全部测试确认没被改坏**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，43 passed

- [ ] **Step 5: 浏览器验收回退通路**

`STICKER_IMAGE_URL` 仍是 `null`，页面应当与 Task 3 结束时完全一致：Lingkan 贴纸、撕开、脱手、跟随、贴回全部正常，console 无 warning。

再临时把 `STICKER_IMAGE_URL` 改成一个不存在的路径（例如 `'./nope.png'`）刷新一次，确认：console 出现一条 warning，且贴纸仍然正常显示为 canvas 版本、交互不受影响。验完把常量改回 `null`。

- [ ] **Step 6: 提交**

```bash
cd ~/sticker-peel-demo
git add src/sticker-texture.js src/main.js
git commit -m "功能: 贴纸贴图支持 PNG 素材

需求: 贴纸画面要换成异形 die-cut 照片贴纸, 但素材尚未到位
实现: 加 STICKER_IMAGE_URL 开关与 loadStickerImage, 为 null 时走现有 canvas 贴纸; 图片到位后按其宽高比重建几何与阴影, 加载失败则告警并回退; 片元着色器的 alpha discard 已能切异形边, 无需改动"
```

---

## Self-Review

**Spec 覆盖核对**

| Spec 要求 | 落在哪 |
|---|---|
| 模式机四态与迁移条件 | Task 1（attached/peeling/脱落）+ Task 2（held/placing） |
| 状态对象 `{mode,pos,dir,peel,tilt,lift}` | Task 1 字段定义 |
| `main.js` 不含模式判断 | Task 3：tick 只读字段做映射 |
| 撕开坐标相对 `pos` | Task 1 `down`/`move` 内减去 `pos` |
| DETACH_THRESHOLD 0.75 | Task 1 常量 + 测试 |
| HELD_CURL 0.18 保留卷边 | Task 2 `_stepHeld` + 测试 |
| 位置弹簧 0.18/0.82 带滞后 | Task 2 `_stepHeld` + 滞后测试 |
| tilt 由横向速度导出、限幅 14° | Task 2 + 两条测试 |
| lift 弹簧升到 1、驱动阴影 | Task 2（数值）+ Task 3（阴影映射） |
| held 期间 dir 冻结 | Task 2 测试；实现上 `_stepHeld` 不写 `this.dir` |
| `awaitingRelease` 吞掉脱手那次 up | Task 1 `_detach`/`up`/`down` + 两条测试 |
| PLACING 由 pointerdown 触发 | Task 1 `down` 的 held 分支 |
| PLACING 期间忽略输入 | Task 1 `down` 的 fallthrough + Task 2 测试 |
| 位置冻结不跳 | Task 2 `_beginPlacing` + 测试 |
| 贴好后可再撕（循环） | Task 2 两条循环测试 |
| PNG 加载 + 宽高比推导 + 失败回退 | Task 4 |
| 片元着色器不改 | Task 4 说明 |
| 纹理在 dispose 中释放 | Task 4 Step 2 改 `dispose` |
| rAF 空闲即停 | Task 2 `idle` 的 held 分支 + Task 3 浏览器验收 |
| 验收标准 1–8 | Task 3 Step 4 + Task 4 Step 5 |

无遗漏。

**实现中需要注意的两处非显然点（已写进对应任务）**

1. `onPointerMove` 不能再要求 `pointerId === activePointerId`：held 期间没有按住的手指，`activePointerId` 为 `null`，若沿用旧判断贴纸就收不到光标移动。Task 3 Step 2 已改为「有活跃指针时才校验」。
2. `placing` 收敛后必须重建 `PeelState`：旧实例里还留着上一次撕开的 `anchor` 与 `rawDistance`，不重建会让下一次撕开从错误的锚点起步。Task 2 `_stepPlacing` 已处理。

**Placeholder 扫描:** 无 TBD / TODO / "类似 Task N" / 空泛的"加上错误处理"。每个改代码的步骤都给了完整代码。Task 4 的素材缺口不是 placeholder —— 交付的是开关与回退通路，行为完整可验收。

**类型一致性:** `setSticker(pos, dir, peel, tilt, lift)` 在 Task 3 定义并调用，Task 4 不改其签名；`maxProjectionFor` 在 Task 1 构造函数接收，Task 3 传入 `scene.maxProjection`，两者都是 `(dx, dy) => number`；`machine.pos` 全程是 `[number, number]` 数组，未与 `THREE.Vector2` 混用；`applyStickerImage(img)` 在 Task 4 定义、导出、调用三处一致。

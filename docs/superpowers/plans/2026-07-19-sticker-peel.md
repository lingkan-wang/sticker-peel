# Sticker Peel 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个单页 demo：中央一张写着 "Lingkan" 的贴纸，按住鼠标沿任意方向拖动即把贴纸卷起撕开，松手弹回贴平，可无限次重复。

**Architecture:** three.js 正交相机 + 细分平面网格，顶点着色器把卷起线之后的部分绕圆柱卷起，`DoubleSide` 渲染出纸背。撕开进度与方向由一个纯 JS 状态机 `PeelState` 计算（可单元测试），three.js 只负责把状态映射成 uniform。零构建工具，静态起服务即可运行。

**Tech Stack:** 原生 ES Modules、three.js 0.160.0（unpkg ESM CDN）、GLSL、Vitest（仅测纯逻辑）

## Global Constraints

- 参考 spec：`docs/superpowers/specs/2026-07-19-sticker-peel-design.md`
- 品牌蓝固定为 `#156AF3`，贴纸文字固定为 `Lingkan`（大小写照此）
- 纸背色固定为 `#f2f0ec`
- **不得**出现任何滑杆、控制面板、参数调试 UI
- 唯一交互方式是 pointer 拖拽（鼠标 + 触摸共用 pointer 事件）
- 无构建工具、无框架、无服务端；Vitest 仅用于单元测试，不参与运行时
- 所有事件监听与 rAF 必须可清理：`pagehide` 时移除监听；`PeelState` 空闲时停止 rAF
- 数学约定：贴纸局部坐标以贴纸中心为原点，**y 轴向上**，单位为 CSS 像素
- 卷起线定义（对 spec 的修正，实现以此为准）：
  - `sMax = (|dir.x| * STICKER_W + |dir.y| * STICKER_H) / 2`
  - `line = -sMax + peel`
  - `maxPeel = 2 * sMax`
  - 顶点满足 `dot(pos.xy, dir) < line` 的部分被卷起
- Git 提交信息用中文，含需求/实现思路

## File Structure

| 文件 | 职责 |
|---|---|
| `index.html` | 页面骨架、全局样式、canvas 容器、光标状态 |
| `src/peel-state.js` | 纯逻辑：撕开状态机（方向平滑、进度推进、弹簧回弹、空闲判定） |
| `src/sticker-texture.js` | canvas 2D 绘制贴纸位图 + 尺寸度量的纯函数 |
| `src/shaders.js` | 顶点 / 片元 GLSL 字符串 |
| `src/main.js` | three.js 场景装配、uniform 同步、事件绑定、rAF 循环、清理 |
| `tests/peel-state.test.js` | `PeelState` 单元测试 |
| `tests/sticker-texture.test.js` | `textureMetrics` 单元测试 |
| `package.json` | Vitest 依赖与脚本 |

---

### Task 1: 项目脚手架与 PeelState 状态机

**Files:**
- Create: `package.json`
- Create: `src/peel-state.js`
- Test: `tests/peel-state.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class PeelState { constructor(maxPeel: number) }`
  - `peelState.down(x: number, y: number): void`
  - `peelState.move(x: number, y: number): void`
  - `peelState.up(): void`
  - `peelState.step(): void`
  - `peelState.dir: [number, number]`（单位向量）
  - `peelState.peel: number`
  - `peelState.pressed: boolean`
  - `get peelState.idle: boolean`
  - `peelState.setMaxPeel(maxPeel: number): void`
  - 导出常量 `LERP_DIR = 0.15`、`LERP_PEEL = 0.25`、`SPRING_K = 0.12`、`SPRING_DAMP = 0.75`、`EPS = 0.001`

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "sticker-peel-demo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "python3 -m http.server 4780"
  },
  "devDependencies": {
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd ~/sticker-peel-demo && npm install`
Expected: 生成 `node_modules/` 与 `package-lock.json`，无 ERR

- [ ] **Step 3: 写失败的测试**

创建 `tests/peel-state.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { PeelState } from '../src/peel-state.js';

const MAX = 100;

/** 反复 step 直到静止或超过 limit 帧，返回实际帧数 */
function settle(state, limit = 600) {
  let frames = 0;
  while (!state.idle && frames < limit) {
    state.step();
    frames += 1;
  }
  return frames;
}

describe('PeelState', () => {
  it('初始状态是贴平且空闲的', () => {
    const s = new PeelState(MAX);
    expect(s.peel).toBe(0);
    expect(s.idle).toBe(true);
  });

  it('未按下时 move 不产生任何撕开', () => {
    const s = new PeelState(MAX);
    s.move(50, 0);
    s.step();
    expect(s.peel).toBe(0);
    expect(s.pressed).toBe(false);
  });

  it('按住向右拖动，方向收敛到 +x，进度趋近拖动距离', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(40, 0);
    for (let i = 0; i < 120; i += 1) s.step();
    expect(s.dir[0]).toBeCloseTo(1, 2);
    expect(s.dir[1]).toBeCloseTo(0, 2);
    expect(s.peel).toBeCloseTo(40, 1);
  });

  it('方向始终是单位向量', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(-30, 30);
    for (let i = 0; i < 60; i += 1) {
      s.step();
      expect(Math.hypot(s.dir[0], s.dir[1])).toBeCloseTo(1, 6);
    }
  });

  it('方向是平滑跟随而不是瞬间跳变', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(40, 0);
    for (let i = 0; i < 120; i += 1) s.step();
    s.move(0, 40);          // 骤然改为向上
    s.step();
    expect(s.dir[1]).toBeGreaterThan(0);
    expect(s.dir[1]).toBeLessThan(0.5);   // 一帧内远未转到位
  });

  it('拖动距离超过 maxPeel 时进度被夹住', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(5000, 0);
    for (let i = 0; i < 200; i += 1) s.step();
    expect(s.peel).toBeLessThanOrEqual(MAX);
    expect(s.peel).toBeCloseTo(MAX, 1);
  });

  it('零位移不会把方向算成 NaN', () => {
    const s = new PeelState(MAX);
    s.down(10, 10);
    s.move(10, 10);
    s.step();
    expect(Number.isNaN(s.dir[0])).toBe(false);
    expect(Number.isNaN(s.dir[1])).toBe(false);
    expect(Math.hypot(s.dir[0], s.dir[1])).toBeCloseTo(1, 6);
  });

  it('按住期间永远不空闲', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(30, 0);
    for (let i = 0; i < 300; i += 1) s.step();
    expect(s.idle).toBe(false);
  });

  it('松手后弹回精确的 0 并进入空闲', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(80, 0);
    for (let i = 0; i < 60; i += 1) s.step();
    expect(s.peel).toBeGreaterThan(10);
    s.up();
    const frames = settle(s);
    expect(frames).toBeLessThan(600);
    expect(s.peel).toBe(0);
    expect(s.idle).toBe(true);
  });

  it('可以反复撕十次，每次都干净归零', () => {
    const s = new PeelState(MAX);
    for (let round = 0; round < 10; round += 1) {
      s.down(0, 0);
      s.move(90, 20);
      for (let i = 0; i < 40; i += 1) s.step();
      s.up();
      settle(s);
      expect(s.peel).toBe(0);
      expect(s.idle).toBe(true);
    }
  });

  it('setMaxPeel 立即收紧当前进度上限', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(100, 0);
    for (let i = 0; i < 200; i += 1) s.step();
    s.setMaxPeel(20);
    s.step();
    expect(s.peel).toBeLessThanOrEqual(20 + EPS_TOLERANCE);
  });
});

const EPS_TOLERANCE = 0.5;
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: FAIL，报错类似 `Failed to resolve import "../src/peel-state.js"`

- [ ] **Step 5: 实现 PeelState**

创建 `src/peel-state.js`：

```js
export const LERP_DIR = 0.15;
export const LERP_PEEL = 0.25;
export const SPRING_K = 0.12;
export const SPRING_DAMP = 0.75;
export const EPS = 0.001;

/**
 * 撕开状态机。只做数学，不碰 DOM 也不碰 three.js。
 * 坐标单位是 CSS 像素，原点在贴纸中心，y 轴向上。
 */
export class PeelState {
  constructor(maxPeel) {
    this.maxPeel = maxPeel;
    this.dir = [1, 0];
    this.targetDir = [1, 0];
    this.peel = 0;
    this.target = 0;
    this.velocity = 0;
    this.pressed = false;
    this.anchor = [0, 0];
  }

  setMaxPeel(maxPeel) {
    this.maxPeel = maxPeel;
    this.target = Math.min(this.target, maxPeel);
    this.peel = Math.min(this.peel, maxPeel);
  }

  down(x, y) {
    this.pressed = true;
    this.anchor = [x, y];
    this.target = 0;
    this.velocity = 0;
  }

  move(x, y) {
    if (!this.pressed) return;
    const dx = x - this.anchor[0];
    const dy = y - this.anchor[1];
    const len = Math.hypot(dx, dy);
    // 位移过小时方向无意义，保留上一帧方向，避免 0/0 出 NaN
    if (len > EPS) this.targetDir = [dx / len, dy / len];
    this.target = Math.min(len, this.maxPeel);
  }

  up() {
    this.pressed = false;
    this.target = 0;
  }

  step() {
    // 方向平滑：先线性插值再归一化，保证始终是单位向量
    const nx = this.dir[0] + (this.targetDir[0] - this.dir[0]) * LERP_DIR;
    const ny = this.dir[1] + (this.targetDir[1] - this.dir[1]) * LERP_DIR;
    const len = Math.hypot(nx, ny);
    if (len > EPS) this.dir = [nx / len, ny / len];

    if (this.pressed) {
      this.peel += (this.target - this.peel) * LERP_PEEL;
      this.velocity = 0;
      return;
    }

    // 松手后用弹簧拉回 0
    this.velocity += (0 - this.peel) * SPRING_K;
    this.velocity *= SPRING_DAMP;
    this.peel += this.velocity;
    if (Math.abs(this.peel) < EPS && Math.abs(this.velocity) < EPS) {
      this.peel = 0;
      this.velocity = 0;
    }
  }

  get idle() {
    return !this.pressed && this.peel === 0 && this.velocity === 0;
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，11 passed

- [ ] **Step 7: 提交**

```bash
cd ~/sticker-peel-demo
printf 'node_modules/\n' > .gitignore
git add .gitignore package.json package-lock.json src/peel-state.js tests/peel-state.test.js
git commit -m "功能: 实现撕开状态机 PeelState

需求: 按住鼠标沿拖动方向撕开贴纸, 松手弹回, 可反复触发
实现: 纯 JS 状态机负责方向平滑(lerp+归一化)、进度推进与夹取、松手弹簧回弹与空闲判定, 不依赖 DOM 便于单测"
```

---

### Task 2: 贴纸纹理绘制

**Files:**
- Create: `src/sticker-texture.js`
- Test: `tests/sticker-texture.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `textureMetrics(w: number, h: number, dpr: number): { pxW, pxH, radius, margin, fontSize }` —— 纯函数，全部返回设备像素
  - `drawSticker(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): HTMLCanvasElement` —— 把贴纸画进 canvas 并返回它

**说明:** `drawSticker` 依赖真实的 canvas 2D 上下文，Vitest 的 node 环境跑不了，所以只对 `textureMetrics` 写单测，绘制效果放到 Task 5 的浏览器验收里看。

- [ ] **Step 1: 写失败的测试**

创建 `tests/sticker-texture.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { textureMetrics } from '../src/sticker-texture.js';

describe('textureMetrics', () => {
  it('按 dpr 放大画布像素尺寸', () => {
    const m = textureMetrics(400, 250, 2);
    expect(m.pxW).toBe(800);
    expect(m.pxH).toBe(500);
  });

  it('圆角与字号按短边推导，与长边无关', () => {
    const a = textureMetrics(400, 250, 1);
    const b = textureMetrics(900, 250, 1);
    expect(a.radius).toBeCloseTo(b.radius, 6);
    expect(a.fontSize).toBeCloseTo(b.fontSize, 6);
  });

  it('die-cut 白边留在贴纸内部，不会吃掉圆角', () => {
    const m = textureMetrics(400, 250, 1);
    expect(m.margin).toBeGreaterThan(0);
    expect(m.margin).toBeLessThan(m.radius);
  });

  it('字号小于贴纸高度，保证文字不出血', () => {
    const m = textureMetrics(400, 250, 1);
    expect(m.fontSize).toBeLessThan(250);
  });

  it('dpr 只缩放尺寸，不改变各量之间的比例', () => {
    const a = textureMetrics(400, 250, 1);
    const b = textureMetrics(400, 250, 3);
    expect(b.radius / a.radius).toBeCloseTo(3, 6);
    expect(b.fontSize / a.fontSize).toBeCloseTo(3, 6);
    expect(b.margin / a.margin).toBeCloseTo(3, 6);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/sticker-peel-demo && npm test tests/sticker-texture.test.js`
Expected: FAIL，`Failed to resolve import "../src/sticker-texture.js"`

- [ ] **Step 3: 实现纹理模块**

创建 `src/sticker-texture.js`：

```js
export const BRAND_BLUE = '#156AF3';
export const STICKER_TEXT = 'Lingkan';

/** 由贴纸尺寸推导出所有绘制度量，单位是设备像素。纯函数，可单测。 */
export function textureMetrics(w, h, dpr) {
  const short = Math.min(w, h);
  return {
    pxW: Math.round(w * dpr),
    pxH: Math.round(h * dpr),
    radius: short * 0.14 * dpr,   // 圆角
    margin: short * 0.05 * dpr,   // die-cut 白边宽度（在圆角之内）
    fontSize: short * 0.34 * dpr,
  };
}

/**
 * 把贴纸画进给定 canvas：
 * 外圈是透明留白，内部是白色圆角矩形，中央是品牌蓝的 Lingkan。
 * 透明区在 shader 里被 discard，所以贴纸是 die-cut 的异形边而非满幅方块。
 */
export function drawSticker(canvas, w, h, dpr) {
  const m = textureMetrics(w, h, dpr);
  canvas.width = m.pxW;
  canvas.height = m.pxH;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, m.pxW, m.pxH);

  // 白色圆角底：四边各缩进 margin，缩进出来的透明圈就是 die-cut 外沿
  ctx.beginPath();
  ctx.roundRect(m.margin, m.margin, m.pxW - m.margin * 2, m.pxH - m.margin * 2, m.radius);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.fillStyle = BRAND_BLUE;
  ctx.font = `800 ${m.fontSize}px -apple-system, system-ui, "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(STICKER_TEXT, m.pxW / 2, m.pxH / 2);

  return canvas;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，16 passed（11 + 5）

- [ ] **Step 5: 提交**

```bash
cd ~/sticker-peel-demo
git add src/sticker-texture.js tests/sticker-texture.test.js
git commit -m "功能: 贴纸纹理绘制模块

需求: 圆角矩形白底贴纸, 品牌蓝 #156AF3 粗体 Lingkan, 带 die-cut 白边
实现: textureMetrics 纯函数按短边推导圆角/白边/字号并随 dpr 缩放(可单测), drawSticker 用 canvas 2D 落地绘制"
```

---

### Task 3: 着色器与静态场景

**Files:**
- Create: `src/shaders.js`
- Create: `src/main.js`
- Create: `index.html`

**Interfaces:**
- Consumes: `drawSticker` from `src/sticker-texture.js`
- Produces:
  - `VERTEX_SHADER: string`、`FRAGMENT_SHADER: string` from `src/shaders.js`
  - `src/main.js` 导出 `createScene(container: HTMLElement): { setPeel(dir: [number,number], peel: number): void, resize(): void, render(): void, dispose(): void, stickerSize: { w: number, h: number } }`

**本任务的目标是能用硬编码的 `peel` 值渲染出正确的卷曲曲面**，交互留到 Task 4。

- [ ] **Step 1: 写着色器**

创建 `src/shaders.js`：

```js
export const VERTEX_SHADER = /* glsl */ `
  uniform vec2  uDir;      // 拖动方向（单位向量）
  uniform float uLine;     // 卷起线在 uDir 上的投影位置
  uniform float uRadius;   // 卷曲圆柱半径

  varying vec2 vUv;
  varying vec3 vNormal;

  const float TWO_PI = 6.28318530718;

  void main() {
    vUv = uv;

    vec3 pos = position;
    vec3 nrm = vec3(0.0, 0.0, 1.0);

    float s = dot(pos.xy, uDir);
    float t = uLine - s;          // 顶点越过卷起线多远（>0 即被卷起）

    if (t > 0.0) {
      float theta = min(t / uRadius, TWO_PI);
      // 绕位于 uLine 处、轴垂直于 uDir 的圆柱卷起
      pos.xy = pos.xy + uDir * (t - uRadius * sin(theta));
      pos.z  = uRadius * (1.0 - cos(theta));
      nrm = vec3(uDir * sin(theta), cos(theta));
    }

    vNormal = normalize(nrm);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 face = texture2D(uTex, vUv);
    // die-cut：纹理透明的地方两面都不画，贴纸才有异形外沿
    if (face.a < 0.01) discard;

    // 背面法线要翻过来，否则卷起后背面的明暗是反的
    vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
    vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
    float light = 0.72 + 0.28 * max(dot(n, lightDir), 0.0);

    vec3 base;
    if (gl_FrontFacing) {
      base = face.rgb;
    } else {
      // 纸背：米白 + 一层极轻的程序化纸纹
      float grain = fract(sin(dot(vUv * 420.0, vec2(12.9898, 78.233))) * 43758.5453);
      base = vec3(0.949, 0.941, 0.925) - grain * 0.02;
    }

    gl_FragColor = vec4(base * light, face.a);
  }
`;
```

- [ ] **Step 2: 写场景装配**

创建 `src/main.js`（本任务只到 `createScene`，交互在 Task 4 追加）：

```js
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { drawSticker } from './sticker-texture.js';

const STICKER_W = 420;
const STICKER_H = 260;
const CURL_RADIUS = 26;
const SEGMENTS = 160;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // 正交相机，视锥直接用 CSS 像素，指针位移就能当世界坐标用
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  camera.position.z = 1000;

  const dpr = Math.min(window.devicePixelRatio, 2);
  const texture = new THREE.CanvasTexture(
    drawSticker(document.createElement('canvas'), STICKER_W, STICKER_H, dpr)
  );
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const uniforms = {
    uDir: { value: new THREE.Vector2(1, 0) },
    uLine: { value: -maxProjection(1, 0) },   // peel=0：卷起线在后缘，完全贴平
    uRadius: { value: CURL_RADIUS },
    uTex: { value: texture },
  };

  const geometry = new THREE.PlaneGeometry(STICKER_W, STICKER_H, SEGMENTS, SEGMENTS);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const sticker = new THREE.Mesh(geometry, material);
  scene.add(sticker);

  /** 贴纸在方向 dir 上的最大投影，也就是卷起线的起止范围 */
  function maxProjection(dx, dy) {
    return (Math.abs(dx) * STICKER_W + Math.abs(dy) * STICKER_H) / 2;
  }

  function setPeel(dir, peel) {
    uniforms.uDir.value.set(dir[0], dir[1]);
    uniforms.uLine.value = -maxProjection(dir[0], dir[1]) + peel;
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  resize();

  return {
    setPeel,
    resize,
    render,
    dispose,
    maxProjection,
    stickerSize: { w: STICKER_W, h: STICKER_H },
  };
}
```

- [ ] **Step 3: 写页面骨架**

创建 `index.html`：

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Lingkan Sticker</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: #e8e6e1;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  #stage {
    position: fixed;
    inset: 0;
    cursor: grab;
    touch-action: none;
  }
  #stage.is-dragging { cursor: grabbing; }
  #stage canvas { display: block; }
</style>
</head>
<body>
  <div id="stage"></div>
  <script type="module">
    import { createScene } from './src/main.js';
    const scene = createScene(document.getElementById('stage'));
    // 临时：硬编码一个撕开量，确认卷曲曲面正确
    scene.setPeel([1, 0], 180);
    scene.render();
  </script>
</body>
</html>
```

- [ ] **Step 4: 起服务并在浏览器里验收静态卷曲**

Run: 用 preview_start 启动，配置 `.claude/launch.json`：

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "sticker", "runtimeExecutable": "python3", "runtimeArgs": ["-m", "http.server", "4780"], "port": 4780 }
  ]
}
```

Expected（逐条目视确认）：
- 控制台无报错（`read_console_messages`）
- 贴纸左侧约 180px 宽的一条被卷起，形成圆柱状卷边
- 卷起部分能看到米白色纸背，不是白底蓝字
- 卷曲处有由法线产生的明暗过渡，不是死平的一片白
- 贴纸四角是圆角，圆角外是背景色而非白色方块（die-cut 生效）

把 `scene.setPeel([1, 0], 180)` 依次改成 `([0, 1], 120)`、`([-0.707, -0.707], 240)` 各刷新一次，确认卷起线方向随之改变且始终垂直于给定方向。验收完把这行改回 `scene.setPeel([1, 0], 0)`，确认此时贴纸完全贴平、看不到任何卷边。

- [ ] **Step 5: 提交**

```bash
cd ~/sticker-peel-demo
git add index.html src/shaders.js src/main.js .claude/launch.json
git commit -m "功能: 卷曲着色器与 three.js 静态场景

需求: 贴纸沿指定方向被卷起并露出纸背, 带自然明暗
实现: 顶点着色器把越过卷起线的部分绕圆柱卷起并输出卷曲法线, 片元着色器按 gl_FrontFacing 分正反面着色、透明处 discard 做出 die-cut 外沿; 正交相机视锥用 CSS 像素以便与指针坐标对齐"
```

---

### Task 4: 指针交互与动画循环

**Files:**
- Modify: `src/main.js`（在文件末尾追加 `createStickerPeel`）
- Modify: `index.html`（替换 `<script type="module">` 内容）

**Interfaces:**
- Consumes: `createScene` from `src/main.js`、`PeelState` from `src/peel-state.js`
- Produces: `createStickerPeel(container: HTMLElement): { destroy(): void }`

- [ ] **Step 1: 追加交互控制器**

在 `src/main.js` 顶部的 import 里加上：

```js
import { PeelState } from './peel-state.js';
```

在 `src/main.js` 末尾追加：

```js
/**
 * 把 PeelState 接到场景上：指针事件驱动状态机，rAF 把状态刷进 uniform。
 * 空闲时主动停掉 rAF，避免静止画面还在空转。
 */
export function createStickerPeel(container) {
  const scene = createScene(container);
  const state = new PeelState(scene.maxProjection(1, 0) * 2);
  let frame = 0;

  /** 屏幕坐标 → 贴纸局部坐标（原点居中，y 轴向上） */
  function toLocal(event) {
    const rect = container.getBoundingClientRect();
    return [
      event.clientX - rect.left - rect.width / 2,
      -(event.clientY - rect.top - rect.height / 2),
    ];
  }

  function tick() {
    state.step();
    // maxPeel 依赖当前方向，每帧跟着方向一起更新
    state.setMaxPeel(scene.maxProjection(state.dir[0], state.dir[1]) * 2);
    scene.setPeel(state.dir, state.peel);
    scene.render();
    frame = state.idle ? 0 : requestAnimationFrame(tick);
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function onPointerDown(event) {
    const [x, y] = toLocal(event);
    state.down(x, y);
    container.classList.add('is-dragging');
    container.setPointerCapture?.(event.pointerId);
    wake();
  }

  function onPointerMove(event) {
    if (!state.pressed) return;
    const [x, y] = toLocal(event);
    state.move(x, y);
    wake();
  }

  function onPointerUp(event) {
    if (!state.pressed) return;
    state.up();
    container.classList.remove('is-dragging');
    container.releasePointerCapture?.(event.pointerId);
    wake();
  }

  function onResize() {
    scene.resize();
    wake();
  }

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', onResize);

  function destroy() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
    scene.dispose();
  }

  window.addEventListener('pagehide', destroy, { once: true });

  scene.setPeel(state.dir, 0);
  scene.render();

  return { destroy };
}
```

- [ ] **Step 2: 页面改为挂载交互控制器**

把 `index.html` 里的 `<script type="module">` 整块替换为：

```html
  <script type="module">
    import { createStickerPeel } from './src/main.js';
    createStickerPeel(document.getElementById('stage'));
  </script>
```

- [ ] **Step 3: 浏览器验收交互**

刷新页面，逐条确认：
- 初始完全贴平，看不到任何卷边
- 从贴纸任意位置按住向右拖 → 从左缘卷起，卷起线垂直于拖动方向
- 向上、向左、斜向各拖一次 → 卷起方向都跟着拖动方向走
- 拖动中途转向 → 卷曲轴平滑转过去，不跳变
- 松手 → 弹回完全贴平，无残留位移
- 光标在舞台上是 `grab`，按下变 `grabbing`
- `read_console_messages` 无报错

- [ ] **Step 4: 验证空闲时 rAF 已停**

在浏览器控制台执行：

```js
let n = 0; const id = setInterval(() => {}, 0);
const raf = requestAnimationFrame; let count = 0;
window.requestAnimationFrame = function (cb) { count += 1; return raf(cb); };
setTimeout(() => { console.log('rAF calls while idle:', count); clearInterval(id); }, 2000);
```

Expected: 静止不动 2 秒后输出 `rAF calls while idle: 0`

- [ ] **Step 5: 提交**

```bash
cd ~/sticker-peel-demo
git add src/main.js index.html
git commit -m "功能: 指针拖拽交互与动画循环

需求: 按住鼠标顺着拖动方向撕下贴纸, 松手弹回, 触屏同样可用
实现: pointer 事件驱动 PeelState, rAF 每帧把方向与进度刷进 uniform; 空闲时主动停 rAF 避免空转, pagehide 与 destroy 统一移除监听并释放 GPU 资源"
```

---

### Task 5: 投影层与视觉收尾

**Files:**
- Modify: `src/main.js`（`createScene` 内加入阴影层，`createStickerPeel` 的 tick 同步阴影）

**Interfaces:**
- Consumes: `createScene` 现有内部结构
- Produces: `scene.setPeel(dir, peel)` 额外驱动阴影的透明度与缩放（对外签名不变）

- [ ] **Step 1: 在 createScene 里加入阴影层**

在 `src/main.js` 的 `createScene` 中，`const sticker = new THREE.Mesh(...)` **之前**插入：

```js
  // 软阴影：一张径向渐变贴图，随撕开进度收缩变淡
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);

  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.18,
  });
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(STICKER_W * 1.25, STICKER_H * 1.6),
    shadowMaterial
  );
  shadow.position.set(0, -STICKER_H * 0.06, -1);
  scene.add(shadow);
```

- [ ] **Step 2: 让 setPeel 同步驱动阴影**

把 `createScene` 里的 `setPeel` 替换为：

```js
  function setPeel(dir, peel) {
    uniforms.uDir.value.set(dir[0], dir[1]);
    const span = maxProjection(dir[0], dir[1]);
    uniforms.uLine.value = -span + peel;

    // 贴纸被卷起后接触面变小：阴影同步收缩、变淡
    const progress = Math.min(peel / (span * 2), 1);
    shadowMaterial.opacity = 0.18 - progress * 0.12;
    const scale = 1 - progress * 0.25;
    shadow.scale.set(scale, scale, 1);
  }
```

- [ ] **Step 3: dispose 里释放阴影资源**

把 `dispose` 中的资源释放补全为：

```js
  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    shadow.geometry.dispose();
    shadowMaterial.dispose();
    shadowTexture.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }
```

- [ ] **Step 4: 跑一遍全部单测确认没被改坏**

Run: `cd ~/sticker-peel-demo && npm test`
Expected: PASS，16 passed

- [ ] **Step 5: 按 spec 的六条验收标准逐条走查**

刷新页面，对照 `docs/superpowers/specs/2026-07-19-sticker-peel-design.md` 的「验收标准」：

1. 从贴纸任意位置按下并朝任意方向拖动，卷起方向与拖动方向一致
2. 拖动中改变方向，卷曲轴平滑跟随而非跳变
3. 松手后弹回完全贴平，无残留位移
4. 连续快速重复撕 10 次以上无视觉异常；`performance.memory.usedJSHeapSize` 前后无持续增长
5. 用 `resize_window` 切到 mobile 预设，触摸拖动可用且页面不滚动
6. 空闲时 rAF 已停（复用 Task 4 Step 4 的探针）

任一条不过就修到过，不要跳过。

- [ ] **Step 6: 截图留证并提交**

用 `computer {action: "screenshot"}` 各截一张「贴平」与「撕到一半」的画面。

```bash
cd ~/sticker-peel-demo
git add src/main.js
git commit -m "功能: 贴纸软阴影与视觉收尾

需求: 贴纸卷起时接触面变小, 阴影应随之收缩变淡
实现: 底层加一张径向渐变阴影贴图, 由 setPeel 按撕开进度同步 opacity 与 scale; dispose 一并释放阴影的几何/材质/贴图"
```

---

## Self-Review

**Spec 覆盖核对**

| Spec 要求 | 落在哪 |
|---|---|
| pointerdown 记锚点 | Task 1 `down()` + Task 4 `onPointerDown` |
| dir lerp 0.15 / peel lerp 0.25 | Task 1 `LERP_DIR` / `LERP_PEEL` |
| 弹簧 0.12 / 0.75 回弹 | Task 1 `step()` |
| peel 上限 = 贴纸沿方向的跨度 | Task 1 `setMaxPeel` + Task 4 tick 每帧更新 |
| touch-action: none | Task 3 `index.html` |
| 光标 grab / grabbing | Task 3 样式 + Task 4 `is-dragging` |
| 正交相机 | Task 3 `createScene` |
| PlaneGeometry 160×160 细分 | Task 3 `SEGMENTS` |
| 顶点着色器圆柱卷曲 + 法线 | Task 3 `VERTEX_SHADER` |
| gl_FrontFacing 分正反面 | Task 3 `FRAGMENT_SHADER` |
| 纸背 #f2f0ec + 纸纹 ≤0.02 | Task 3 `FRAGMENT_SHADER` |
| Lambert 0.72 + 0.28 | Task 3 `FRAGMENT_SHADER` |
| 贴纸纹理 canvas 2D、DPR×2、anisotropy | Task 2 + Task 3 |
| 阴影随进度衰减收缩 | Task 5 |
| 监听清理 / rAF 停转 / resize | Task 4 `destroy` + `pagehide` + `onResize` |
| 六条验收标准 | Task 5 Step 5 |

无遗漏。

**已知偏离 spec 之处（均已在正文写明）**

1. spec 写「单文件 index.html」，实际拆成 `index.html` + 4 个 ES 模块，为的是让 `PeelState` 能被单测。仍然零构建。
2. spec 的 `uPeel` 未定义卷起线起点，实现改用 `uLine = -sMax + peel`，见 Global Constraints。
3. spec 的顶点着色器伪代码把 `t > 0` 判为「顶点在卷起线之前」，实现取 `t = uLine - s`，方向与之相反，这样卷起的才是拖动方向后缘那一侧。

**Placeholder 扫描:** 无 TBD / TODO / "类似 Task N" / 空泛的"加上错误处理"。每个改代码的步骤都给了完整代码。

**类型一致性:** `setPeel(dir, peel)` 在 Task 3 定义、Task 4 调用、Task 5 扩展，签名一致；`maxProjection(dx, dy)` 在 Task 3 定义并由 Task 4 通过返回对象调用（Task 3 的 return 里已导出）；`PeelState` 的 `dir` 全程是 `[number, number]` 数组，未与 `THREE.Vector2` 混用。

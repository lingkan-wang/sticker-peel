export const LERP_DIR = 0.15;
export const LERP_PEEL = 0.25;
export const SPRING_K = 0.12;
export const SPRING_DAMP = 0.75;
export const EPS = 0.001;
const TAU = Math.PI * 2;

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
    // 按下后指针相对锚点的真实（未夹住）位移长度；setMaxPeel 变化时用它重新推导 target，
    // 避免 target 卡死在方向旋转前的旧上限上
    this.rawDistance = 0;
    this.velocity = 0;
    this.pressed = false;
    this.anchor = [0, 0];
  }

  setMaxPeel(maxPeel) {
    this.maxPeel = maxPeel;
    this.target = this.pressed ? Math.min(this.rawDistance, maxPeel) : 0;
    this.peel = Math.min(this.peel, maxPeel);
  }

  down(x, y) {
    this.pressed = true;
    this.anchor = [x, y];
    this.target = 0;
    this.rawDistance = 0;
    this.velocity = 0;
  }

  move(x, y) {
    if (!this.pressed) return;
    const dx = x - this.anchor[0];
    const dy = y - this.anchor[1];
    const len = Math.hypot(dx, dy);
    // 位移过小时方向无意义，保留上一帧方向，避免 0/0 出 NaN
    if (len > EPS) this.targetDir = [dx / len, dy / len];
    this.rawDistance = len;
    this.target = Math.min(len, this.maxPeel);
  }

  up() {
    this.pressed = false;
    this.target = 0;
  }

  step() {
    // 方向平滑：沿最短弧对角度插值，再转回单位向量。直接对笛卡尔向量做 lerp
    // 再归一化，在接近 180° 反向时插值向量会经过原点附近，归一化会把微小的
    // 残差放大成近乎瞬间的翻转；对角度插值则每帧的转动量严格有界。
    const cur = Math.atan2(this.dir[1], this.dir[0]);
    const tgt = Math.atan2(this.targetDir[1], this.targetDir[0]);
    let delta = (((tgt - cur) % TAU) + TAU) % TAU; // [0, TAU)
    if (delta > Math.PI) delta -= TAU;             // (-PI, PI] —— 恰好 180° 时保留 +PI 固定旋向，打破平局
    const next = cur + delta * LERP_DIR;
    this.dir = [Math.cos(next), Math.sin(next)];

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

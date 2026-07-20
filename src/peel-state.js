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
    // 插值用的原始（未重新归一化）向量：dir 每帧都会被归一化为单位向量对外暴露，
    // 若拿归一化后的 dir 当下一帧插值的起点，方向与目标恰好反向（180°）时衰减信息
    // 会在归一化时丢失，导致 lerp 永远收敛回原方向、卡死不动。这里单独维护一份
    // 不归一化的向量承接跨帧的插值进度，只在算 dir 时才归一化。
    this._dirRaw = [1, 0];
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
    const nx = this._dirRaw[0] + (this.targetDir[0] - this._dirRaw[0]) * LERP_DIR;
    const ny = this._dirRaw[1] + (this.targetDir[1] - this._dirRaw[1]) * LERP_DIR;
    this._dirRaw = [nx, ny];
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

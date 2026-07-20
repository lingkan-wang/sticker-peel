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
      // 当前 pos 在整段撕开过程中不变，PeelState 内部只用 move/down 点之间的差值，
      // 所以这个减法此刻算出来会被抵消、观察不到效果；保留它是因为它才是正确的坐标契约——
      // 一旦 PeelState 改成依赖绝对坐标，或者 pos 在 peeling 期间开始变化，这里不减就会静默出错。
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
    const maxPeel = this._maxPeel();
    this.peelState.setMaxPeel(maxPeel);
    this.peelState.step();
    this.dir = this.peelState.dir;
    this.peel = this.peelState.peel;

    // 分子分母必须用同一个方向下的上限：this.dir 在 step() 里已经转过了，
    // 若此处重新调用 _maxPeel() 会拿新方向的上限去除以按旧方向夹过的 peel，
    // 方向旋转期间阈值会提前或延后触发
    if (this.peel / maxPeel > DETACH_THRESHOLD) {
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

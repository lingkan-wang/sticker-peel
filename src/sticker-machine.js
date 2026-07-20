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
      // 这个减法是有实际效果的：算出来的贴纸局部坐标会被存进 PeelState.anchor，
      // 而 _detach() 正是靠 anchor 算 grabOffset。删掉它 anchor 会变成按下点的绝对坐标，
      // 贴纸会被甩到几百像素外。move() 里同名的减法才是纯坐标契约、可抵消不影响结果——
      // 两处形似但不等价，不要因为对称就一起删。
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
    else if (this.mode === 'held') this._stepHeld();
    else if (this.mode === 'placing') this._stepPlacing();
  }

  _stepHeld() {
    // 位置：欠阻尼弹簧追光标。特征值是模为 sqrt(FOLLOW_DAMP) 的复数，会带一点
    // 过冲再收敛——这个过冲加滞后就是摆动感/惯性感的来源，是故意的，不是没调好
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
      // 沿用当前方向：新实例的 dir 默认是 [1,0]，不带过去的话下一次撕开会先
      // 朝 +x 猛地一跳再慢慢转回来，而 peel 的爬升比方向的 slerp 更快
      this.peelState.dir = [this.dir[0], this.dir[1]];
      this.peelState.targetDir = [this.dir[0], this.dir[1]];
    }
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
    // 抓取点就是最初按下的那个点：捏住贴纸哪里, 哪里就该待在指尖下。
    // 若改用脱落瞬间的 pos - cursor, 由于脱落必然发生在拖出 75% 跨度之后,
    // 贴纸会被永久吊在离光标三四百像素处, 稍一移动就飞出视口
    //
    // anchor 是用户按下的那一点，但 #stage 覆盖整个视口且没有命中测试，
    // 在贴纸外面按下时 anchor 会远超贴纸自身范围。不夹住的话贴纸会被吊在
    // 离光标几百像素处，一路推出视口且无法找回
    const hx = this.maxProjectionFor(1, 0);
    const hy = this.maxProjectionFor(0, 1);
    this.grabOffset = [
      -clamp(this.peelState.anchor[0], -hx, hx),
      -clamp(this.peelState.anchor[1], -hy, hy),
    ];
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
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

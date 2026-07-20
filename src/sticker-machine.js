import { PeelState } from './peel-state.js';

export const DETACH_THRESHOLD = 0.75;
export const HELD_CURL = 0.18;

// held 期间的三组弹簧都按临界阻尼配。这类离散弹簧 v=(v+(T-x)K)·D; x+=v 的
// 状态矩阵行列式恒为 D、迹为 1+D-DK，判别式为零（即临界阻尼、不过冲）时
//   K = (1-√D)² / D
// 收敛速度由 √D 决定：每帧衰减 √D，衰到 1% 约需 ln(0.01)/ln(√D) 帧。
// 先前这几个 K 都比临界值大 5~16 倍，贴纸粘在光标上时会明显来回振荡。
export const FOLLOW_DAMP = 0.62;      // √D≈0.787，约 19 帧收敛
export const FOLLOW_K = 0.073;        // ≈ (1-√0.62)²/0.62
export const HELD_PEEL_DAMP = 0.6;    // √D≈0.775，约 18 帧
export const HELD_PEEL_K = 0.085;     // ≈ (1-√0.6)²/0.6
export const LIFT_DAMP = 0.65;        // √D≈0.806，约 21 帧
export const LIFT_K = 0.058;          // ≈ (1-√0.65)²/0.65

// tilt 直接由横向速度导出，速度一振荡倾斜就跟着甩。跟随改为不过冲后速度
// 单调衰减，增益也要一起调小，否则常规移动就把倾斜顶到上限、看着仍在抖
export const TILT_GAIN = 0.014;
export const MAX_TILT = (14 * Math.PI) / 180;

// placing（点击贴下）是一次性收尾动作，保留原本略带过冲的手感
export const PLACE_K = 0.2;
export const PLACE_DAMP = 0.7;
export const TILT_RETURN = 0.2;
export const EPS_M = 0.001;

// 边缘带宽度占贴纸短边的比例。带内按下 = 撕，带内以外 = 整张拖走
export const EDGE_BAND_RATIO = 0.22;

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

    // dragging 期间光标相对贴纸中心的固定偏移
    this.dragAnchor = [0, 0];
  }

  /** 当前方向下的撕开量上限 */
  _maxPeel() {
    return this.maxProjectionFor(this.dir[0], this.dir[1]) * 2;
  }

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
    // peeling / dragging / placing：忽略，避免中途重入产生中间态
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
    } else if (this.mode === 'dragging') {
      this.mode = 'attached';
    }
  }

  step() {
    if (this.mode === 'peeling') this._stepPeeling();
    else if (this.mode === 'held') this._stepHeld();
    else if (this.mode === 'placing') this._stepPlacing();
    else if (this.mode === 'dragging') this._stepDragging();
  }

  _stepDragging() {
    // 1:1 跟随，不加弹簧。拖动要跟手；滞后感是 held 的事，放这里只会显得飘
    this.pos[0] = this.cursor[0] - this.dragAnchor[0];
    this.pos[1] = this.cursor[1] - this.dragAnchor[1];
  }

  _stepHeld() {
    // 位置：临界阻尼弹簧追光标，不过冲。惯性感来自它本身的滞后（约 19 帧收敛），
    // 而不是来回振荡——振荡在贴纸粘手时读起来就是"抖"
    const targetX = this.cursor[0] + this.grabOffset[0];
    const targetY = this.cursor[1] + this.grabOffset[1];
    this.posVel[0] = (this.posVel[0] + (targetX - this.pos[0]) * FOLLOW_K) * FOLLOW_DAMP;
    this.posVel[1] = (this.posVel[1] + (targetY - this.pos[1]) * FOLLOW_K) * FOLLOW_DAMP;
    this.pos[0] += this.posVel[0];
    this.pos[1] += this.posVel[1];

    // 卷边：收到一个固定的微卷量，不抹平
    const targetPeel = this._maxPeel() * HELD_CURL;
    this.peelVel = (this.peelVel + (targetPeel - this.peel) * HELD_PEEL_K) * HELD_PEEL_DAMP;
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

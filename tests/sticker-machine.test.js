import { describe, it, expect } from 'vitest';
import { StickerMachine, DETACH_THRESHOLD, MAX_TILT, HELD_CURL, EDGE_BAND_RATIO } from '../src/sticker-machine.js';

const W = 420;
const H = 260;
/** 与 main.js 里的 maxProjection 同构：贴纸在给定方向上的半跨度 */
const proj = (dx, dy) => (Math.abs(dx) * W + Math.abs(dy) * H) / 2;

/** 造一台位于 origin 的机器 */
function make(origin = [0, 0]) {
  return new StickerMachine(proj, origin);
}

// 命中测试上线后，按在贴纸正中央会进入 dragging 而不是 peeling，
// 所有想测撕开行为的用例都必须先落在边缘带内。205 在 W=420 的右边缘带
// （边缘带宽 57.2，210-205=5<=57.2）内，且 PeelState 只看相对锚点的位移，
// 从这一点起沿相同相对距离拖拽，撕开/方向/阈值的数值结果与从原点按下完全一致。
const EDGE_X = 205;

/** 按住并朝 +x 拖 distance 像素，泵 frames 帧 */
function dragRight(m, from, distance, frames = 200) {
  m.down(from[0] + EDGE_X, from[1]);
  m.move(from[0] + EDGE_X + distance, from[1]);
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
    m.down(EDGE_X, 0);           // 命中测试上线后必须按在边缘带内才会撕开
    expect(m.mode).toBe('peeling');
    expect(m.idle).toBe(false);
  });

  it('撕开量小于阈值时松手会弹回 attached 且完全贴平', () => {
    const m = make();
    m.down(EDGE_X, 0);
    m.move(EDGE_X + 60, 0);      // 相对锚点仍移动 60，远小于 420 * 0.75
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
    m.down(EDGE_X, 0);
    m.move(EDGE_X + maxPeel * 0.8, 0);    // 相对锚点只拖到 80%，没拖满
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
  });

  it('贴纸不在原点时也能正常撕开脱落，pos 不变、grabOffset 按按下点（anchor）而非原点计算', () => {
    const origin = [200, 20];
    const m = make(origin);
    // 故意不按在贴纸正中央，而是偏一点按下：这样 anchor 非零，
    // grabOffset 才能同时验证"按的是哪一点"和"坐标转换有没有做对"。
    // 命中测试上线后，这个偏移必须落在边缘带内（否则会进入 dragging 而不是
    // peeling），所以选 [190,30]：190 距右缘 20px，在 57.2px 的边缘带内。
    // 拖拽距离特意拉到 600（超过一个 W=420 的跨度）：如果 down() 里漏掉了
    // "- this.pos" 这个坐标转换，PeelState.anchor 会变成按下点的绝对坐标（即
    // [390,50]）而不是贴纸局部坐标 [190,30]；即便 _detach() 里的 clamp 会把
    // 超出半跨度(210)的 x 分量夹回 210，算出的 grabOffset 也会是 [-210,-50]
    // 而不是期望的 [-190,-30]，所以能被下面的断言区分出来
    const pressOffset = [190, 30];
    const press = [origin[0] + pressOffset[0], origin[1] + pressOffset[1]];
    m.down(press[0], press[1]);
    m.move(press[0] + 600, press[1]);
    // 只跑到刚脱落那一帧为止：脱落之后 held 的跟随弹簧会立刻开始把 pos 拉向
    // cursor - anchor，多跑几帧 pos 就不再等于 origin 了（这本身恰恰是新公式
    // 生效的证据——旧公式下 target 永远等于 pos，多跑多久 pos 都不会挪动）
    let guard = 0;
    while (m.mode !== 'held' && guard < 200) {
      m.step();
      guard += 1;
    }
    expect(m.mode).toBe('held');
    // peeling 期间 pos 本身不应该被撕开逻辑改动
    expect(m.pos).toEqual(origin);
    // grabOffset = -anchor，anchor 是 down() 里 (x - this.pos[0], y - this.pos[1]) 算出的
    // 贴纸局部按下点，此处应等于 pressOffset
    expect(m.grabOffset).toEqual([-pressOffset[0], -pressOffset[1]]);
    expect(m.grabOffset).toEqual([-190, -30]);
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
    m.down(EDGE_X, 0);
    expect(m.mode).toBe('peeling');
    m.down(50, 50);              // 已在 peeling，忽略
    expect(m.mode).toBe('peeling');
  });

  it('held 状态下必须先 up 清掉 awaitingRelease，再 down 才能进入 placing', () => {
    const m = make();
    dragRight(m, [0, 0], 400);
    expect(m.mode).toBe('held');

    // 顺序颠倒：还没 up 就 down，awaitingRelease 仍为 true，必须停在 held
    m.down(10, 10);
    expect(m.mode).toBe('held');

    m.up();                      // 清掉 awaitingRelease，不改变 mode
    expect(m.mode).toBe('held');

    m.down(20, 20);               // 这次才是真正的“点击贴下”
    expect(m.mode).toBe('placing');
  });

  it('方向旋转期间脱落阈值的分子分母必须用同一个方向的上限', () => {
    // 复现 Finding 1：沿 +x 拖拽一段后，中途把目标方向换成 +y，dir 会在随后
    // 若干帧里逐步转向。旧实现里 setMaxPeel/clamp 用的是“转之前”的 dir，
    // 但阈值比较时 this.dir 已经被 step() 更新成“转之后”的 dir，两者不是同一个
    // 方向的上限；本用例的具体数字是用真实的新旧实现各跑一遍反推出来的：
    //   旧（有 bug）实现：换向后第 9 步 mode 已经变成 held
    //   新（修复后）实现：换向后第 9 步仍是 peeling，第 10 步才变成 held
    // 所以“换向后第 9 步仍处于 peeling”这一断言，在旧实现下必然失败，能够
    // 区分两种实现；不是单纯捏造的巧合数字。
    const m = make();
    m.down(EDGE_X, 0);
    m.move(EDGE_X + 300, 0);
    for (let i = 0; i < 5; i += 1) m.step(); // 先沿 +x 撕开几帧，dir 仍是 [1,0]
    expect(m.mode).toBe('peeling');

    m.move(EDGE_X, 300); // x 回到锚点(相对位移 dx=0)，中途把目标方向换成 +y，触发 dir 后续逐帧旋转

    for (let s = 0; s < 9; s += 1) m.step();
    // 关键区分点：旧实现在这里已经因为“新方向上限”把 ratio 撑过阈值而提前脱落
    expect(m.mode).toBe('peeling');

    m.step(); // 第 10 步
    expect(m.mode).toBe('held');

    // 脱落那一刻，peel 与判定阈值时用的上限必须一致：用脱落时的 dir 反推上限，
    // ratio 应当确实越过阈值（而不是被不同方向的上限凑巧撑过去）
    const maxPeelAtTrip = proj(m.dir[0], m.dir[1]) * 2;
    expect(m.peel / maxPeelAtTrip).toBeGreaterThan(DETACH_THRESHOLD);
  });
});

/** 撕到脱手并完成那次松手，返回处于 held 且可接受点击的机器 */
function toHeld(origin = [0, 0]) {
  const m = new StickerMachine(proj, origin);
  m.down(origin[0] + EDGE_X, origin[1]);   // 边缘带内按下才会撕开
  m.move(origin[0] + EDGE_X + 400, origin[1]);
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
    // toHeld() 收敛后的光标停在 origin+EDGE_X+400，这里同样加上 EDGE_X 才能让
    // 光标真正往前移（否则 600 比收敛时的光标更靠后，target 反而会变小）
    m.move(600 + EDGE_X, 0);
    m.step();
    // 一帧内只能走过去一小段，远没到位
    expect(m.pos[0]).toBeGreaterThan(startX);
    expect(Math.abs(m.pos[0] - (600 + EDGE_X + m.grabOffset[0]))).toBeGreaterThan(50);
  });

  it('横向甩动时产生倾斜，方向与速度相反', () => {
    const m = toHeld();
    m.move(600 + EDGE_X, 0);     // 往 +x 甩（同上，需加 EDGE_X 保持真正前移）
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

  it('回归：按下点脱落后应一直待在光标附近，不能被大幅拖拽甩到几百像素外（浏览器复现：cursor (-350,100) 时贴纸飞出画布左边缘）', () => {
    const origin = [0, 0];
    const m = make(origin);
    // 按在贴纸中心偏一角的位置，而不是正中央；命中测试上线后还必须落在
    // 边缘带内才会触发撕开。选上边缘带内的 [40,125]（125 距上缘 5px，在
    // 57.2px 边缘带内）：换成这个点是为了把下面 dist<halfSpanX 的margin
    // 从原先 [195,-40] 算出的 ~199<210（约 11px）拉开到 ~131<210（约
    // 79px），原来的 margin 太薄，接近浮点误差量级，容易假失败
    const pressOffset = [40, 125];
    const press = [origin[0] + pressOffset[0], origin[1] + pressOffset[1]];
    // 用一个很大的拖拽距离（远超脱落阈值）去放大旧公式的 bug：
    // 旧公式 grabOffset = pos - cursor(脱落瞬间) 会把这段拖拽距离原封不动地
    // 变成一个永久偏移，越拖越远；新公式只取决于按下点，与拖拽距离无关
    const detachDistance = 600;
    m.down(press[0], press[1]);
    m.move(press[0] + detachDistance, press[1]);
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
    m.up();

    const cursor = [-350, 100]; // 浏览器里复现 bug 的那个坐标
    m.move(cursor[0], cursor[1]);
    for (let i = 0; i < 800; i += 1) m.step(); // 步进到弹簧收敛

    // 中心应收敛到 cursor - anchor（anchor 就是 pressOffset，因为 pos 从未变化）
    expect(m.pos[0]).toBeCloseTo(cursor[0] - pressOffset[0], 1);
    expect(m.pos[1]).toBeCloseTo(cursor[1] - pressOffset[1], 1);

    // 关键区分点：贴纸中心到光标的距离必须被贴纸自身的半跨度约束住，
    // 不能随拖拽距离（这里是 600px）线性增长。旧公式在这个用例下算出的
    // grabOffset 长度约 652px，远超半跨度，会让这个断言失败。
    const dist = Math.hypot(m.pos[0] - cursor[0], m.pos[1] - cursor[1]);
    const halfSpanX = proj(1, 0); // 贴纸在 x 方向的半跨度（W/2）
    expect(dist).toBeLessThan(halfSpanX);
  });

  // Fix 1 回归（restore，重写）：_detach() 里的 clamp 不是死代码。它读的
  // _halfExtent() 直接调用 maxProjectionFor，而 peelState.anchor 是 down()
  // 那一刻捕获的旧尺寸下的局部坐标。真实场景里 applyStickerImage 会在贴图
  // 加载完成后重算 W/H，如果这发生在"按下"和"脱落"之间，_halfExtent() 会
  // 变小而 anchor 不变，clamp 就真的会咬住。这里用一个可变的 proj 闭包
  // 模拟贴图中途换尺寸，不再依赖已被命中测试堵死的"贴纸外按下"路径。
  it('Fix 1 回归：撕开期间贴纸尺寸变小（如换贴图重算 W/H），grabOffset 必须夹在新半跨度内', () => {
    let w = 420;
    let h = 260;
    // 与文件顶部的 proj 同构，但 w/h 可变，用来模拟 applyStickerImage 重算尺寸
    const mutableProj = (dx, dy) => (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    const m = new StickerMachine(mutableProj, [0, 0]);

    // 在原始尺寸（W=420,H=260）的边缘带内按下：EDGE_X=205 距右缘 5px，
    // 在边缘带 57.2px 内，与文件顶部其它用例保持同一命中口径
    m.down(EDGE_X, 0);
    expect(m.mode).toBe('peeling');
    m.move(EDGE_X + 300, 0); // 相对锚点位移 300，target=300 < maxPeel(420)*0.75=315，不会自然越过阈值

    // 走到接近收敛（peel→300，ratio→300/420≈0.714），但还没到 0.75，即"刚脱落之前"
    for (let i = 0; i < 50; i += 1) m.step();
    expect(m.mode).toBe('peeling');
    expect(m.peel / (mutableProj(1, 0) * 2)).toBeLessThan(DETACH_THRESHOLD);

    // 贴图中途换成一张小得多的图，模拟 applyStickerImage 重算后的新尺寸；
    // _halfExtent()/_maxPeel() 都是活读 mutableProj，所以下一帧起立刻生效
    w = 40;
    h = 24;

    // 继续步进直到脱落：新 maxPeel=40，setMaxPeel 会把已经涨到 300 的 peel
    // 立刻夹到 40，ratio 瞬间到 1.0，通常一步以内就会脱落
    let guard = 0;
    while (m.mode !== 'held' && guard < 200) {
      m.step();
      guard += 1;
    }
    expect(m.mode).toBe('held');

    // 期望值：anchor 是 down() 那一刻算出的贴纸局部坐标 [205,0]（原始尺寸下
    // 落在边缘带内，本身没有越界），但脱落时读到的半跨度已经变成新尺寸的
    // [20,12]，必须被 clamp 夹住，而不是原样取负
    const [hx, hy] = [mutableProj(1, 0), mutableProj(0, 1)];
    const anchor = [EDGE_X - 0, 0 - 0];
    const clampFn = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const expected = [-clampFn(anchor[0], -hx, hx), -clampFn(anchor[1], -hy, hy)];
    // 用同一个 clamp 公式算期望值，避免 -0 与 0 在 toEqual 下被判定不相等
    expect(m.grabOffset).toEqual(expected);
    // 关键区分点：若把 _detach() 里的 clamp 删掉，grabOffset 会是原始
    // -anchor = [-205, 0]，与新半跨度夹出来的 [-20, 0]（hx=20,hy=12）不同，
    // 下面这两个具体数值断言在去掉 clamp 后必然失败
    expect(m.grabOffset[0]).toBeCloseTo(-20, 6);
    expect(m.grabOffset[1]).toBeCloseTo(0, 6);
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

    // 从新位置再撕一次：必须按在新位置的边缘带内
    m.down(placedAt[0] + EDGE_X, placedAt[1]);
    m.move(placedAt[0] + EDGE_X + 400, placedAt[1]);
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
  });

  it('连续三轮撕下贴回不出异常状态', () => {
    const m = new StickerMachine(proj, [0, 0]);
    for (let round = 0; round < 3; round += 1) {
      const at = [m.pos[0], m.pos[1]];
      m.down(at[0] + EDGE_X, at[1]);   // 边缘带内按下才会撕开
      m.move(at[0] + EDGE_X + 400, at[1]);
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

  it('Fix 2 回归：贴回之后沿同一方向再撕一次，方向不应先跳向 +x 再转回来', () => {
    // _stepPlacing 收敛时会 new 一个全新的 PeelState，它的 dir 默认是 [1,0]。
    // 如果不把 this.dir（上一次撕开冻结下来的方向）搬过去，下一次撕开的第一帧
    // 就会看到 dir 从 [1,0] 开始，往真实拖拽方向慢慢转，视觉上像是"先甩向右
    // 再转回来"。这里用竖直向下（非 +x）验证：正确实现下 dir[0] 应该从一开始
    // 就贴着 0，不会跳向 1 附近。
    const m = new StickerMachine(proj, [0, 0]);

    // 第一次撕开：朝正下方拖（y 轴向上，所以往下是 -y）。命中测试上线后
    // 必须先按在下边缘带内（-125 距下缘 5px，在 57.2px 边缘带内），
    // 后续 move 的 x 分量保持与按下点相同以维持 dx=0（纯 -y 方向不受影响）
    m.down(0, -125);
    m.move(0, -125 - 400); // 相对锚点仍移动 -400，> maxPeel(0,-1)*0.75 = 260*0.75 = 195，会脱落
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
    m.up();

    // 点击贴回（awaitingRelease 已清，down 会走 _beginPlacing）
    m.down(m.pos[0], m.pos[1]);
    for (let i = 0; i < 1000; i += 1) m.step();
    expect(m.mode).toBe('attached');
    const placedAt = [m.pos[0], m.pos[1]];

    // 第二次撕开：同样朝正下方拖，同样需要先落在下边缘带内
    m.down(placedAt[0], placedAt[1] - 125);
    m.move(placedAt[0], placedAt[1] - 125 - 400);
    expect(m.mode).toBe('peeling');

    // 关键区分点：未修复版本这里 dir[0] 第一帧就会跳到 ~0.97（默认方向 [1,0]
    // 正在往 [0,-1] 慢慢转），修复后 dir 从旧方向 [0,-1] 原样带过来，
    // targetDir 又恰好也是 [0,-1]，dir[0] 应该始终贴着 0，不会有任何一帧超过 0.5
    for (let i = 0; i < 6; i += 1) {
      m.step();
      expect(Math.abs(m.dir[0])).toBeLessThan(0.5);
    }
  });
});

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

  it('EDGE_BAND_RATIO 常量是 0.22', () => {
    // 上面的用例只验证"BAND 与 EDGE_BAND_RATIO 内部自洽"，换成任何比例都会
    // 通过，测不出具体数值被改错；这里像"阈值常量是 0.75"那样直接钉死数值
    expect(EDGE_BAND_RATIO).toBe(0.22);
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

  it('Fix 2 回归：up() 必须补一次 _stepDragging，不能丢掉最后一次 move', () => {
    // 上面"松手回到 attached 并停在松手处"和下面"拖到新位置..."两个用例，
    // 在 up() 之前都已经手动 step() 过一次，天然不会暴露这个 bug；这里特意
    // 让最后一次 move 落在 up() 之前、且中途不再 step，复现"rAF 帧和松手
    // 事件谁先到"这类真实时序
    const m = new StickerMachine(proj, [0, 0]);
    m.down(0, 0);          // 中心按下，dragAnchor = [0,0]
    m.step();               // 走一帧，此时 pos 仍是 [0,0]（光标还没挪动）
    m.move(400, -220);      // 松手前最后一次 move，中途没有再 step
    m.up();
    expect(m.mode).toBe('attached');
    // 关键区分点：不补 _stepDragging 的旧实现下，pos 还停在 up() 之前最后一次
    // step() 时的值 [0,0]，与 400/-220 相去甚远，下面两个断言必然失败
    expect(m.pos[0]).toBeCloseTo(400 - m.dragAnchor[0], 6);
    expect(m.pos[1]).toBeCloseTo(-220 - m.dragAnchor[1], 6);
    expect(m.pos[0]).toBeCloseTo(400, 6);
    expect(m.pos[1]).toBeCloseTo(-220, 6);
  });

  it('Fix 3 回归：贴纸不在原点时，dragAnchor 必须是 (按下点 - pos) 而非按下点本身', () => {
    // 之前所有拖动用例的贴纸都造在 [0,0]，dragAnchor = x - pos[0] 和裸的 x
    // 数值上无法区分，测不出漏掉 "- this.pos" 这个坐标转换的 bug；这里换成
    // 非原点位置，专门钉住这处减法
    const origin = [300, -150];
    const m = new StickerMachine(proj, origin);
    m.down(320, -140);      // 贴纸中心附近按下（偏移 20,10），落在 center 区
    expect(m.mode).toBe('dragging');
    m.move(500, 50);
    m.step();
    // 正确的 dragAnchor 应为 [320-300, -140-(-150)] = [20, 10]
    expect(m.dragAnchor).toEqual([20, 10]);
    expect(m.pos[0]).toBeCloseTo(500 - (320 - origin[0]), 6);
    expect(m.pos[1]).toBeCloseTo(50 - (-140 - origin[1]), 6);
    expect(m.pos[0]).toBeCloseTo(480, 6);
    expect(m.pos[1]).toBeCloseTo(40, 6);
    // 关键区分点：若 dragAnchor 漏掉 "- this.pos"，会变成裸的按下点 [320,-140]，
    // 使 pos 算成 [500-320, 50-(-140)] = [180, 190]，与上面 [480,40] 明显不同
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

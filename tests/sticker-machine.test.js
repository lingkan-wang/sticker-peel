import { describe, it, expect } from 'vitest';
import { StickerMachine, DETACH_THRESHOLD, MAX_TILT, HELD_CURL } from '../src/sticker-machine.js';

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

  it('贴纸不在原点时也能正常撕开脱落，pos 不变、grabOffset 按按下点（anchor）而非原点计算', () => {
    const origin = [200, 20];
    const m = make(origin);
    // 故意不按在贴纸正中央，而是偏一点按下：这样 anchor 非零，
    // grabOffset 才能同时验证"按的是哪一点"和"坐标转换有没有做对"。
    // 拖拽距离特意拉到 600（超过一个 W=420 的跨度）：如果 down() 里漏掉了
    // "- this.pos" 这个坐标转换，PeelState.anchor 会变成按下点的绝对坐标而不是
    // 贴纸局部坐标，用真实实现反推验证过——在 origin=[200,20] 下这个偏差仍会让
    // 撕开量在 6 帧内越过阈值进入 held（不会卡在 peeling 出不来），但算出的
    // grabOffset 是 [-250,-50] 而不是期望的 [-50,-30]，所以能被下面的断言区分出来
    const pressOffset = [50, 30];
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
    expect(m.grabOffset).toEqual([-50, -30]);
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
    m.down(0, 0);
    m.move(300, 0);
    for (let i = 0; i < 5; i += 1) m.step(); // 先沿 +x 撕开几帧，dir 仍是 [1,0]
    expect(m.mode).toBe('peeling');

    m.move(0, 300); // 中途把目标方向换成 +y，触发 dir 后续逐帧旋转

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

  it('回归：按下点脱落后应一直待在光标附近，不能被大幅拖拽甩到几百像素外（浏览器复现：cursor (-350,100) 时贴纸飞出画布左边缘）', () => {
    const origin = [0, 0];
    const m = make(origin);
    // 按在贴纸中心偏一角的位置，而不是正中央
    const pressOffset = [80, -40];
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
    // grabOffset 长度约 681px，远超半跨度，会让这个断言失败。
    const dist = Math.hypot(m.pos[0] - cursor[0], m.pos[1] - cursor[1]);
    const halfSpanX = proj(1, 0); // 贴纸在 x 方向的半跨度（W/2）
    expect(dist).toBeLessThan(halfSpanX);
  });

  it('Fix 1 回归：在贴纸范围外按下并脱落，anchor 必须被夹在贴纸半跨度内，收敛后贴纸不能被甩出半对角线之外', () => {
    // #stage 覆盖整个视口且没有命中测试，用户完全可能按在贴纸外面的空白背景上。
    // anchor 就是按下点（贴纸局部坐标），未夹住时 grabOffset = -anchor 会远超
    // 贴纸自身范围，held 收敛后贴纸会被吊在离光标几百像素处。
    const origin = [0, 0];
    const m = make(origin);
    const hx = proj(1, 0); // 210，贴纸半宽
    const hy = proj(0, 1); // 130，贴纸半高
    const halfDiagonal = Math.hypot(hx, hy); // ≈ 246.98，贴纸自身的半对角线

    // 按在贴纸范围外很远的地方（贴纸半跨度只有 210×130，这里按在 600,350）
    const press = [600, 350];
    m.down(press[0], press[1]);
    m.move(press[0] - 500, press[1]); // 朝 -x 拖 500px，触发脱落
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
    m.up();

    // grabOffset 应该是 -clamp(anchor)，而不是 -anchor 本身：
    // anchor = press = [600, 350]，clamp 到 [-hx,hx]x[-hy,hy] 后是 [210,130]
    expect(m.grabOffset).toEqual([-hx, -hy]);

    const cursor = [1000, 1000];
    m.move(cursor[0], cursor[1]);
    for (let i = 0; i < 800; i += 1) m.step(); // 步进到弹簧收敛

    // 关键区分点：贴纸中心到光标的距离收敛后不能超过贴纸自身的半对角线。
    // 不夹住 anchor 的旧实现里，grabOffset = -press = [-600,-350]，
    // 收敛后中心到光标的距离约为 |press| ≈ 694.6px，远超 halfDiagonal ≈ 247px，
    // 这个断言在旧实现下必然失败；夹住之后距离最多等于 halfDiagonal（按下点
    // 恰好夹到贴纸角上时取等号）。
    const dist = Math.hypot(m.pos[0] - cursor[0], m.pos[1] - cursor[1]);
    expect(dist).toBeLessThanOrEqual(halfDiagonal + 1e-6);
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

  it('Fix 2 回归：贴回之后沿同一方向再撕一次，方向不应先跳向 +x 再转回来', () => {
    // _stepPlacing 收敛时会 new 一个全新的 PeelState，它的 dir 默认是 [1,0]。
    // 如果不把 this.dir（上一次撕开冻结下来的方向）搬过去，下一次撕开的第一帧
    // 就会看到 dir 从 [1,0] 开始，往真实拖拽方向慢慢转，视觉上像是"先甩向右
    // 再转回来"。这里用竖直向下（非 +x）验证：正确实现下 dir[0] 应该从一开始
    // 就贴着 0，不会跳向 1 附近。
    const m = new StickerMachine(proj, [0, 0]);

    // 第一次撕开：朝正下方拖（y 轴向上，所以往下是 -y）
    m.down(0, 0);
    m.move(0, -400); // 400 > maxPeel(0,-1)*0.75 = 260*0.75 = 195，会脱落
    for (let i = 0; i < 200; i += 1) m.step();
    expect(m.mode).toBe('held');
    m.up();

    // 点击贴回（awaitingRelease 已清，down 会走 _beginPlacing）
    m.down(m.pos[0], m.pos[1]);
    for (let i = 0; i < 1000; i += 1) m.step();
    expect(m.mode).toBe('attached');
    const placedAt = [m.pos[0], m.pos[1]];

    // 第二次撕开：同样朝正下方拖
    m.down(placedAt[0], placedAt[1]);
    m.move(placedAt[0], placedAt[1] - 400);
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

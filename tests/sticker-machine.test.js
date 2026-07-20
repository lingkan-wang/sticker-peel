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

  it('贴纸不在原点时也能正常撕开脱落，pos 不变、grabOffset 按贴纸而非原点计算', () => {
    const origin = [200, 100];
    const m = make(origin);
    // 在贴纸正中央按下：锚点应当是贴纸局部的 (0,0)，往 +x 拖足够远即脱落
    dragRight(m, origin, 400);
    expect(m.mode).toBe('held');
    // peeling 期间 pos 本身不应该被撕开逻辑改动
    expect(m.pos).toEqual(origin);
    // grabOffset = pos - cursor，必须按贴纸实际所在的 origin 计算；
    // 若坐标转换被错误地省略（换算成相对原点），这里会变成 [0,0]-cursor，与期望值不符
    const cursor = [origin[0] + 400, origin[1]];
    expect(m.grabOffset).toEqual([origin[0] - cursor[0], origin[1] - cursor[1]]);
    expect(m.grabOffset).toEqual([-400, 0]);
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

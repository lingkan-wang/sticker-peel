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

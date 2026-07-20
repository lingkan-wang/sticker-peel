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

  it('从默认方向精确反向拖动(180°)时方向能收敛到 -x，而不是卡死在原方向', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(-50, 0);
    for (let i = 0; i < 200; i += 1) s.step();
    expect(s.dir[0]).toBeCloseTo(-1, 2);
    expect(s.dir[1]).toBeCloseTo(0, 2);
  });

  it('接近但不完全反向(179°附近)拖动时方向同样能收敛到 -x', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(-50, 1);
    for (let i = 0; i < 200; i += 1) s.step();
    expect(s.dir[0]).toBeCloseTo(-1, 2);
  });

  it('方向经历一次反向掉头，全程 dir 始终保持单位向量', () => {
    const s = new PeelState(MAX);
    s.down(0, 0);
    s.move(50, 0);
    for (let i = 0; i < 120; i += 1) s.step();
    s.move(-50, 0);
    for (let i = 0; i < 200; i += 1) {
      s.step();
      expect(Math.hypot(s.dir[0], s.dir[1])).toBeCloseTo(1, 6);
    }
  });
});

const EPS_TOLERANCE = 0.5;

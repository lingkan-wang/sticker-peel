import { describe, it, expect } from 'vitest';
import { textureMetrics } from '../src/sticker-texture.js';

describe('textureMetrics', () => {
  it('按 dpr 放大画布像素尺寸', () => {
    const m = textureMetrics(400, 250, 2);
    expect(m.pxW).toBe(800);
    expect(m.pxH).toBe(500);
  });

  it('圆角与字号按短边推导，与长边无关', () => {
    const a = textureMetrics(400, 250, 1);
    const b = textureMetrics(900, 250, 1);
    expect(a.radius).toBeCloseTo(b.radius, 6);
    expect(a.fontSize).toBeCloseTo(b.fontSize, 6);
  });

  it('die-cut 白边留在贴纸内部，不会吃掉圆角', () => {
    const m = textureMetrics(400, 250, 1);
    expect(m.margin).toBeGreaterThan(0);
    expect(m.margin).toBeLessThan(m.radius);
  });

  it('字号小于贴纸高度，保证文字不出血', () => {
    const m = textureMetrics(400, 250, 1);
    expect(m.fontSize).toBeLessThan(250);
  });

  it('dpr 只缩放尺寸，不改变各量之间的比例', () => {
    const a = textureMetrics(400, 250, 1);
    const b = textureMetrics(400, 250, 3);
    expect(b.radius / a.radius).toBeCloseTo(3, 6);
    expect(b.fontSize / a.fontSize).toBeCloseTo(3, 6);
    expect(b.margin / a.margin).toBeCloseTo(3, 6);
  });
});

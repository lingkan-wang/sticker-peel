export const BRAND_BLUE = '#156AF3';
export const STICKER_TEXT = 'Lingkan';

/** 由贴纸尺寸推导出所有绘制度量，单位是设备像素。纯函数，可单测。 */
export function textureMetrics(w, h, dpr) {
  const short = Math.min(w, h);
  return {
    pxW: Math.round(w * dpr),
    pxH: Math.round(h * dpr),
    radius: short * 0.14 * dpr,   // 圆角
    margin: short * 0.05 * dpr,   // die-cut 白边宽度（在圆角之内）
    fontSize: short * 0.34 * dpr,
  };
}

/**
 * 把贴纸画进给定 canvas：
 * 外圈是透明留白，内部是白色圆角矩形，中央是品牌蓝的 Lingkan。
 * 透明区在 shader 里被 discard，所以贴纸是 die-cut 的异形边而非满幅方块。
 */
export function drawSticker(canvas, w, h, dpr) {
  const m = textureMetrics(w, h, dpr);
  canvas.width = m.pxW;
  canvas.height = m.pxH;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, m.pxW, m.pxH);

  // 白色圆角底：四边各缩进 margin，缩进出来的透明圈就是 die-cut 外沿
  ctx.beginPath();
  ctx.roundRect(m.margin, m.margin, m.pxW - m.margin * 2, m.pxH - m.margin * 2, m.radius);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.fillStyle = BRAND_BLUE;
  ctx.font = `800 ${m.fontSize}px -apple-system, system-ui, "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(STICKER_TEXT, m.pxW / 2, m.pxH / 2);

  return canvas;
}

/**
 * 贴纸图片素材路径。为 null 时使用 canvas 绘制的 Lingkan 贴纸。
 * 换成异形 die-cut 照片贴纸时，把这里改成 PNG 路径即可（需带 alpha 通道）。
 */
export const STICKER_IMAGE_URL = null;

/** 加载贴纸图片。失败时 reject，由调用方回退到 canvas 贴纸。 */
export function loadStickerImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`贴纸图片加载失败: ${url}`));
    img.src = url;
  });
}

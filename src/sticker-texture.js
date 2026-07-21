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
 * 贴纸图片素材路径。为 null 时回退到 canvas 绘制的 Lingkan 贴纸。
 * 必须带 alpha 通道：片元着色器靠 alpha < 0.01 discard 切出异形边，
 * 喂一张不透明的图会渲染成带底色的方块。
 * assets/sticker-dog.png 由 tools/cutout.py 从原始照片抠出。
 */
export const STICKER_IMAGE_URL = './assets/sticker-dog.png';

/**
 * 加载贴纸图片。失败时 reject，由调用方回退到 canvas 贴纸。
 *
 * 返回 { promise, cancel }：`cancel()` 摘掉回调并清空 src 中止下载。
 * 必须能中止 —— 否则 img 的 onload 闭包持有 resolve、调用方的 .then 闭包持有
 * 整个 scene，图片下载完成之前已经 dispose 的渲染器和 GPU 对象都还可达；
 * 光靠一个 `if (destroyed) return` 守卫只是不再使用它们，并没有解除引用。
 */
export function loadStickerImage(url) {
  const img = new Image();
  const promise = new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`贴纸图片加载失败: ${url}`));
    img.src = url;
  });
  function cancel() {
    img.onload = null;
    img.onerror = null;
    img.src = '';           // 中止仍在进行的下载
  }
  return { promise, cancel };
}

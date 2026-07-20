import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { drawSticker } from './sticker-texture.js';
import { PeelState } from './peel-state.js';

const STICKER_W = 420;
const STICKER_H = 260;
const CURL_RADIUS = 26;
const SEGMENTS = 160;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // 正交相机，视锥直接用 CSS 像素，指针位移就能当世界坐标用
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  camera.position.z = 1000;

  const dpr = Math.min(window.devicePixelRatio, 2);
  const texture = new THREE.CanvasTexture(
    drawSticker(document.createElement('canvas'), STICKER_W, STICKER_H, dpr)
  );
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const uniforms = {
    uDir: { value: new THREE.Vector2(1, 0) },
    uLine: { value: -maxProjection(1, 0) },   // peel=0：卷起线在后缘，完全贴平
    uRadius: { value: CURL_RADIUS },
    uTex: { value: texture },
  };

  // 软阴影：一张径向渐变贴图，随撕开进度收缩变淡
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);

  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.18,
  });
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(STICKER_W * 1.25, STICKER_H * 1.6),
    shadowMaterial
  );
  shadow.position.set(0, -STICKER_H * 0.06, -1);
  scene.add(shadow);

  const geometry = new THREE.PlaneGeometry(STICKER_W, STICKER_H, SEGMENTS, SEGMENTS);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const sticker = new THREE.Mesh(geometry, material);
  scene.add(sticker);

  /** 贴纸在方向 dir 上的最大投影，也就是卷起线的起止范围 */
  function maxProjection(dx, dy) {
    return (Math.abs(dx) * STICKER_W + Math.abs(dy) * STICKER_H) / 2;
  }

  function setPeel(dir, peel) {
    uniforms.uDir.value.set(dir[0], dir[1]);
    const span = maxProjection(dir[0], dir[1]);
    uniforms.uLine.value = -span + peel;

    // 贴纸被卷起后接触面变小：阴影同步收缩、变淡
    // 释放弹簧欠阻尼，peel 会短暂冲到负值；下限也要夹住，否则贴纸已经贴平了
    // 阴影还在按负 progress 反向变亮变大
    const progress = Math.min(Math.max(peel / (span * 2), 0), 1);
    shadowMaterial.opacity = 0.18 - progress * 0.12;
    const scale = 1 - progress * 0.25;
    shadow.scale.set(scale, scale, 1);
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    shadow.geometry.dispose();
    shadowMaterial.dispose();
    shadowTexture.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  resize();

  return {
    setPeel,
    resize,
    render,
    dispose,
    maxProjection,
  };
}

/**
 * 把 PeelState 接到场景上：指针事件驱动状态机，rAF 把状态刷进 uniform。
 * 空闲时主动停掉 rAF，避免静止画面还在空转。
 */
export function createStickerPeel(container) {
  const scene = createScene(container);
  const state = new PeelState(scene.maxProjection(1, 0) * 2);
  let frame = 0;
  let resizeFrame = 0;
  // 拖拽期间只认第一根手指的 pointerId，避免第二根手指落下时把 anchor 重置，
  // 或两指其中一个先抬起就把还按着的那个手指的后续 move 吞掉
  let activePointerId = null;

  /** 屏幕坐标 → 贴纸局部坐标（原点居中，y 轴向上） */
  function toLocal(event) {
    const rect = container.getBoundingClientRect();
    return [
      event.clientX - rect.left - rect.width / 2,
      -(event.clientY - rect.top - rect.height / 2),
    ];
  }

  function tick() {
    state.step();
    // maxPeel 依赖当前方向，每帧跟着方向一起更新
    state.setMaxPeel(scene.maxProjection(state.dir[0], state.dir[1]) * 2);
    scene.setPeel(state.dir, state.peel);
    scene.render();
    frame = state.idle ? 0 : requestAnimationFrame(tick);
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function onPointerDown(event) {
    if (activePointerId !== null) return; // 已经有一根手指在拖了，忽略其余的
    activePointerId = event.pointerId;
    const [x, y] = toLocal(event);
    state.down(x, y);
    container.classList.add('is-dragging');
    container.setPointerCapture?.(event.pointerId);
    wake();
  }

  function onPointerMove(event) {
    if (!state.pressed || event.pointerId !== activePointerId) return;
    const [x, y] = toLocal(event);
    state.move(x, y);
    wake();
  }

  function onPointerUp(event) {
    if (!state.pressed || event.pointerId !== activePointerId) return;
    state.up();
    activePointerId = null;
    container.classList.remove('is-dragging');
    container.releasePointerCapture?.(event.pointerId);
    wake();
  }

  function onResize() {
    // 用 rAF 把一串 resize 事件合并成一次，避免每个事件都重新分配 drawbuffer
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      scene.resize();
      wake();
    });
  }

  function onPageHide(event) {
    // bfcache：页面只是被挂起，不是真正卸载，不能在这里 dispose 掉 WebGL 上下文，
    // 否则用户点 Back 恢复回来时会看到一个画布已被移除的空白页
    if (!event.persisted) destroy();
  }

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', onResize);

  let destroyed = false;

  function destroy() {
    if (destroyed) return; // 允许重复调用：真正 unload 和某次显式调用都可能触发
    destroyed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
    scene.dispose();
  }

  window.addEventListener('pagehide', onPageHide);

  scene.setPeel(state.dir, 0);
  scene.render();

  return { destroy };
}

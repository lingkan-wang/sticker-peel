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
    uniforms.uLine.value = -maxProjection(dir[0], dir[1]) + peel;
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
    stickerSize: { w: STICKER_W, h: STICKER_H },
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
    const [x, y] = toLocal(event);
    state.down(x, y);
    container.classList.add('is-dragging');
    container.setPointerCapture?.(event.pointerId);
    wake();
  }

  function onPointerMove(event) {
    if (!state.pressed) return;
    const [x, y] = toLocal(event);
    state.move(x, y);
    wake();
  }

  function onPointerUp(event) {
    if (!state.pressed) return;
    state.up();
    container.classList.remove('is-dragging');
    container.releasePointerCapture?.(event.pointerId);
    wake();
  }

  function onResize() {
    scene.resize();
    wake();
  }

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', onResize);

  function destroy() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', destroy);
    scene.dispose();
  }

  window.addEventListener('pagehide', destroy, { once: true });

  scene.setPeel(state.dir, 0);
  scene.render();

  return { destroy };
}

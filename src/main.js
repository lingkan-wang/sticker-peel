import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { drawSticker, STICKER_IMAGE_URL, loadStickerImage } from './sticker-texture.js';
import { StickerMachine } from './sticker-machine.js';

const STICKER_LONG = 420;        // 贴纸长边固定，短边按素材宽高比推导
let STICKER_W = 420;
let STICKER_H = 260;
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

  /** 用图片素材替换贴纸贴图，并按其宽高比重建几何 */
  function applyStickerImage(img) {
    const ratio = img.naturalWidth / img.naturalHeight;
    if (ratio >= 1) {
      STICKER_W = STICKER_LONG;
      STICKER_H = STICKER_LONG / ratio;
    } else {
      STICKER_H = STICKER_LONG;
      STICKER_W = STICKER_LONG * ratio;
    }

    const nextTexture = new THREE.Texture(img);
    // 刻意不设 colorSpace = SRGBColorSpace：那会让 three.js 在采样时注入 sRGB→线性解码，
    // 而我们用的是自定义 ShaderMaterial，片元着色器没有回写 sRGB 的编码环节，
    // 结果整张贴图会暗掉一档。canvas 兜底路径同样不设，两条路径保持一致
    nextTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    nextTexture.needsUpdate = true;
    uniforms.uTex.value.dispose();
    uniforms.uTex.value = nextTexture;

    sticker.geometry.dispose();
    sticker.geometry = new THREE.PlaneGeometry(STICKER_W, STICKER_H, SEGMENTS, SEGMENTS);
    shadow.geometry.dispose();
    shadow.geometry = new THREE.PlaneGeometry(STICKER_W * 1.25, STICKER_H * 1.6);
  }

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

  function setSticker(pos, dir, peel, tilt, lift) {
    uniforms.uDir.value.set(dir[0], dir[1]);
    const span = maxProjection(dir[0], dir[1]);
    uniforms.uLine.value = -span + peel;

    sticker.position.set(pos[0], pos[1], 0);
    sticker.rotation.z = tilt;

    // 贴纸被卷起后接触面变小：阴影同步收缩、变淡
    // 释放弹簧欠阻尼，peel 会短暂冲到负值；下限也要夹住，否则贴纸已经贴平了
    // 阴影还在按负 progress 反向变亮变大
    const progress = Math.min(Math.max(peel / (span * 2), 0), 1);
    const curlScale = 1 - progress * 0.25;
    // 抬离桌面：影子变大、变淡，并朝倾斜的反方向偏移
    const liftScale = curlScale * (1 + lift * 0.35);
    // 影子完全由"离开桌面的程度"驱动：贴平（attached / dragging）时两项都是 0，
    // 一点影子都不该有——真贴纸压在纸面上是不投影的
    shadowMaterial.opacity = progress * 0.1 + lift * 0.16;
    shadow.scale.set(liftScale, liftScale, 1);
    shadow.position.set(
      pos[0] - tilt * 90 * lift,
      pos[1] - STICKER_H * 0.06 - lift * 18,
      -1
    );
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // 容器还没参与布局时会量出 0×0：跳过，避免配出一个退化的空视锥、空 drawbuffer。
    // 之后 ResizeObserver 量到真实尺寸会再调一次。
    if (w === 0 || h === 0) return;
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
    sticker.geometry.dispose();
    material.dispose();
    uniforms.uTex.value.dispose();
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
    setSticker,
    resize,
    render,
    dispose,
    maxProjection,
    applyStickerImage,
  };
}

/**
 * 把 PeelState 接到场景上：指针事件驱动状态机，rAF 把状态刷进 uniform。
 * 空闲时主动停掉 rAF，避免静止画面还在空转。
 */
export function createStickerPeel(container) {
  const scene = createScene(container);
  const machine = new StickerMachine(scene.maxProjection, [0, 0]);
  const hint = document.createElement('div');
  hint.className = 'peel-hint';
  hint.textContent = 'Peel me from any corner';
  container.appendChild(hint);
  let frame = 0;
  let resizeFrame = 0;
  // 拖拽期间只认第一根手指的 pointerId，避免第二根手指落下时把 anchor 重置，
  // 或两指其中一个先抬起就把还按着的那个手指的后续 move 吞掉
  let activePointerId = null;
  let destroyed = false;

  /** 屏幕坐标 → 贴纸局部坐标（原点居中，y 轴向上） */
  function toLocal(event) {
    const rect = container.getBoundingClientRect();
    return [
      event.clientX - rect.left - rect.width / 2,
      -(event.clientY - rect.top - rect.height / 2),
    ];
  }

  function tick() {
    machine.step();
    scene.setSticker(machine.pos, machine.dir, machine.peel, machine.tilt, machine.lift);
    scene.render();
    container.classList.toggle('is-holding', machine.mode === 'held');
    if (machine.mode !== 'attached') onHoverLeave();
    frame = machine.idle ? 0 : requestAnimationFrame(tick);
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function onPointerDown(event) {
    if (activePointerId !== null) return; // 已经有一根手指在操作了，忽略其余的
    activePointerId = event.pointerId;
    const [x, y] = toLocal(event);
    machine.down(x, y);
    container.classList.add('is-dragging');
    container.setPointerCapture?.(event.pointerId);
    wake();
  }

  function onPointerMove(event) {
    // held 期间没有按住的手指（activePointerId 为 null），但贴纸要跟着光标跑，
    // 所以只在这一个模式下放宽 pointerId 校验。其余模式（尤其是松手后仍在回弹的
    // peeling）必须继续只认发起拖拽的那根手指，否则第二根手指的移动会串进来，
    // 按第一根手指的锚点改写撕开量
    if (machine.mode !== 'held' && event.pointerId !== activePointerId) return;
    const [x, y] = toLocal(event);
    machine.move(x, y);
    updateZone(x, y);
    wake();
  }

  /** 悬停位置，仅用于光标形态与引导标签；与拖拽的 pointerId 无关 */
  let hoverZone = 'outside';

  function updateZone(x, y) {
    hoverZone = machine.mode === 'attached' ? machine.hitZone(x, y) : 'outside';
    container.classList.toggle('zone-edge', hoverZone === 'edge');
    container.classList.toggle('zone-center', hoverZone === 'center');
    layoutHint();
  }

  /** 标签跟着贴纸走：水平居中于贴纸，垂直放在贴纸上边缘之上 16px */
  function layoutHint() {
    const show = machine.mode === 'attached' && hoverZone !== 'outside';
    hint.classList.toggle('is-visible', show);
    if (!show) return;
    const rect = container.getBoundingClientRect();
    const halfH = scene.maxProjection(0, 1);
    hint.style.left = `${rect.width / 2 + machine.pos[0]}px`;
    hint.style.top = `${rect.height / 2 - machine.pos[1] - halfH - 16}px`;
    hint.style.transform = 'translate(-50%, -100%)';
  }

  function onHoverMove(event) {
    const [x, y] = toLocal(event);
    updateZone(x, y);
  }

  function onHoverLeave() {
    hoverZone = 'outside';
    container.classList.remove('zone-edge', 'zone-center');
    layoutHint();
  }

  function onPointerUp(event) {
    if (event.pointerId !== activePointerId) return;
    machine.up();
    activePointerId = null;
    container.classList.remove('is-dragging');
    // wake() 必须先于 releasePointerCapture：触屏上指针已消失时 release 可能抛
    // NotFoundError，若排在前面会中断本函数，漏掉 wake() 导致 rAF 循环没能重新起来
    wake();
    container.releasePointerCapture?.(event.pointerId);
  }

  function scheduleResize() {
    // 用 rAF 把一串 resize/ResizeObserver 通知合并成一次，避免每次都重新分配 drawbuffer
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      scene.resize();
      wake();
    });
  }

  function onResize() {
    scheduleResize();
  }

  // container 首次挂载时可能还没参与布局（后台 tab、bfcache 恢复、display:none 切换、
  // 字体/图片晚到撑开尺寸……），构造时的一次性 resize() 会量到 0×0 且此后再也没有恢复的
  // 机会——window resize 事件未必会来。改为持续观察 container 本身的尺寸变化。
  const resizeObserver = new ResizeObserver(scheduleResize);
  resizeObserver.observe(container);

  function onPageHide(event) {
    // bfcache：页面只是被挂起，不是真正卸载，不能在这里 dispose 掉 WebGL 上下文，
    // 否则用户点 Back 恢复回来时会看到一个画布已被移除的空白页
    if (!event.persisted) destroy();
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onHoverMove);
  container.addEventListener('pointerleave', onHoverLeave);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', onResize);

  function destroy() {
    if (destroyed) return; // 允许重复调用：真正 unload 和某次显式调用都可能触发
    destroyed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    resizeObserver.disconnect();
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onHoverMove);
    container.removeEventListener('pointerleave', onHoverLeave);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
    if (hint.parentNode) hint.parentNode.removeChild(hint);
    scene.dispose();
  }

  window.addEventListener('pagehide', onPageHide);

  if (STICKER_IMAGE_URL) {
    loadStickerImage(STICKER_IMAGE_URL).then(
      (img) => {
        if (destroyed) return;   // 加载期间页面可能已经被销毁
        scene.applyStickerImage(img);
        wake();
      },
      (err) => {
        console.warn(err.message, '—— 回退到 canvas 贴纸');
      }
    );
  }

  scene.setSticker(machine.pos, machine.dir, 0, 0, 0);
  scene.render();

  return { destroy };
}

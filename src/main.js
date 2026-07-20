import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { drawSticker } from './sticker-texture.js';

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

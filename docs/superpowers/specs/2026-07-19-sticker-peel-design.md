# Sticker Peel 交互设计文档

日期：2026-07-19
参考：https://x.com/vishlbhardwaj/status/2078898281695076770/video/1（视频无法抓取，按该类效果的通行做法实现）

## 目标

单页 demo：屏幕中央一张写着 "Lingkan" 的贴纸，按住鼠标并拖动，贴纸沿拖动方向被卷起撕开，露出纸背；松手弹回贴平，可无限次重复。

不做参考 demo 里的滑杆控制面板，唯一的控制方式是鼠标/触摸拖拽。

## 交互模型

| 阶段 | 行为 |
|---|---|
| `pointerdown` | 记录锚点 `anchor`（贴纸局部坐标），开始 rAF 循环 |
| `pointermove` | `raw = pointer - anchor`；方向 `dirTarget = normalize(raw)`，位移 `d = length(raw)` |
| 每帧 | `dir` 以 lerp 系数 0.15 平滑趋向 `dirTarget`；`peel` 以 lerp 0.25 趋向 `d` |
| `pointerup` / `pointercancel` | 目标 `peel` 置 0，切换为弹簧回弹 |
| 回弹 | 弹簧积分：`v += (0 - peel) * 0.12; v *= 0.75; peel += v`，`|peel| < 0.001 且 |v| < 0.001` 时归零并停 rAF |

- `dir` 平滑是必需的：不平滑时鼠标微抖会让卷曲轴整体乱转。
- `peel` 上限 = 贴纸对角线长度，超出后不再增加，避免贴纸卷穿自身。
- 触摸与鼠标共用 pointer 事件；canvas 设 `touch-action: none` 防止移动端滚动抢事件。
- 光标：默认 `grab`，按下时 `grabbing`。

## 渲染架构

单文件 `index.html`，three.js 通过 ESM CDN 引入（`import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js'`）。本地用 `python3 -m http.server` 预览。

### 场景
- 正交相机（`OrthographicCamera`），贴纸不需要透视畸变
- 三个对象：阴影 plane（最底）、贴纸 mesh、无其他

### 贴纸 mesh
- 几何：`PlaneGeometry(w, h, 160, 160)` —— 细分足够密才能让圆柱卷曲的曲面平滑
- 材质：`ShaderMaterial({ side: THREE.DoubleSide, transparent: true })`

### 顶点着色器
uniforms：`uDir`（vec2，卷曲推进方向）、`uLine`（float，卷起线沿 `uDir` 的投影位置）、`uRadius`（float，卷曲半径）

```
s = dot(position.xy, uDir)              // 顶点在卷曲方向上的投影
t = uLine - s                           // 顶点越过卷起线多远（t > 0 即在被卷起的那部分“flap”上）
if (t > 0.0) {
  theta = t / uRadius
  if (theta <= PI) {
    // 绕位于 uLine 处、轴垂直于 uDir 的圆柱卷起
    pos.xy += uDir * (t - uRadius * sin(theta))
    pos.z   = uRadius * (1.0 - cos(theta))
    // 卷曲后的法线：绕垂直于 uDir 的轴旋转 theta
    n = vec3(uDir * sin(theta), cos(theta))
  } else {
    // 转过 180° 之后曲面已经完全掉头，若继续按同一公式转下去会自己穿自己；
    // 超出 PI 的部分改为沿卷起时最后的切线方向继续平铺，法线锁定为 (0,0,-1)
    ext = t - uRadius * PI
    pos.xy += uDir * (t + ext)
    pos.z   = 2.0 * uRadius
    n = vec3(0.0, 0.0, -1.0)
  }
}
```

`t <= 0` 的部分保持平整、法线为 `(0,0,1)`。法线传给片元着色器做光照。

注意 `n` 里 `uDir` 分量前是 `+sin(theta)` 而不是 `-sin(theta)`：把 `pos.xy`/`pos.z` 对 `theta` 求导得到
曲面在该点的切线方向，`n = vec3(uDir * sin(theta), cos(theta))` 与这条切线严格垂直（且 `theta = 0`
处退化为平整贴纸的 `(0,0,1)`）；`-sin(theta)` 那个符号与切线不垂直，卷曲边缘的光照会明显偏离预期。

### 片元着色器
- `gl_FrontFacing` 为真 → 采样贴纸 CanvasTexture（正面）
- 为假 → 纸背：`#f2f0ec` 基色 + 一层极轻的程序化纸纹（基于 uv 的高频噪声，振幅 ≤ 0.02）
- 两面统一过一层 Lambert：`light = 0.72 + 0.28 * max(dot(normal, normalize(vec3(0.3, 0.5, 1.0))), 0.0)`
- 卷曲的高光靠法线自然产生，不额外加 specular，避免塑料感

### 贴纸纹理
运行时用 canvas 2D 绘制，DPR × 2：
- 圆角矩形白底（`#ffffff`，圆角 = 短边的 12%）
- 外描一圈白边（模拟 die-cut 留白），边外透明
- 居中粗体 "Lingkan"，色 `#156AF3`，字体 `system-ui / -apple-system` 的 800 字重
- 转成 `THREE.CanvasTexture`，`anisotropy` 拉满

### 阴影
贴纸下方一张 plane，用一个径向渐变纹理（或 shader 内 smoothstep 生成的软椭圆）：
- 不透明度随 `uPeel / 对角线` 从 0.18 衰减到 0.06
- 尺寸随 `uPeel` 略微收缩（贴纸被卷起后接触面变小）

## 资源清理

- pointer 监听挂在 canvas / window 上，页面卸载（`pagehide`）时统一移除
- rAF 循环在 `peel` 归零且无按压时主动 `cancelAnimationFrame` 停掉，交互恢复时重启，避免空转
- `resize` 监听做节流，更新相机与 renderer 尺寸

## 范围外（明确不做）

- 任何滑杆、控制面板、参数调试 UI
- 贴纸内容切换、多张贴纸
- 撕下后脱落／残留胶痕（本版本一律弹回）
- 服务端、构建工具、框架

## 验收标准

1. 从贴纸任意位置按下并朝任意方向拖动，卷起方向与拖动方向一致
2. 拖动中改变方向，卷曲轴平滑跟随而非跳变
3. 松手后弹回完全贴平，无残留位移
4. 连续快速重复撕 10 次以上无视觉异常、无内存增长
5. 触屏设备可用，拖动时页面不滚动
6. 空闲时 rAF 已停止（DevTools Performance 无持续帧）

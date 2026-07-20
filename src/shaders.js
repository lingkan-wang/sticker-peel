export const VERTEX_SHADER = /* glsl */ `
  uniform vec2  uDir;      // 拖动方向（单位向量）
  uniform float uLine;     // 卷起线在 uDir 上的投影位置
  uniform float uRadius;   // 卷曲圆柱半径

  varying vec2 vUv;
  varying vec3 vNormal;

  const float TWO_PI = 6.28318530718;

  void main() {
    vUv = uv;

    vec3 pos = position;
    vec3 nrm = vec3(0.0, 0.0, 1.0);

    float s = dot(pos.xy, uDir);
    float t = uLine - s;          // 顶点越过卷起线多远（>0 即被卷起）

    if (t > 0.0) {
      float theta = min(t / uRadius, TWO_PI);
      // 绕位于 uLine 处、轴垂直于 uDir 的圆柱卷起
      pos.xy = pos.xy + uDir * (t - uRadius * sin(theta));
      pos.z  = uRadius * (1.0 - cos(theta));
      nrm = vec3(uDir * sin(theta), cos(theta));
    }

    vNormal = normalize(nrm);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 face = texture2D(uTex, vUv);
    // die-cut：纹理透明的地方两面都不画，贴纸才有异形外沿
    if (face.a < 0.01) discard;

    // 背面法线要翻过来，否则卷起后背面的明暗是反的
    vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
    vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
    float light = 0.72 + 0.28 * max(dot(n, lightDir), 0.0);

    vec3 base;
    if (gl_FrontFacing) {
      base = face.rgb;
    } else {
      // 纸背：米白 + 一层极轻的程序化纸纹
      float grain = fract(sin(dot(vUv * 420.0, vec2(12.9898, 78.233))) * 43758.5453);
      base = vec3(0.949, 0.941, 0.925) - grain * 0.02;
    }

    gl_FragColor = vec4(base * light, face.a);
  }
`;

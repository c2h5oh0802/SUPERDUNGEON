import * as THREE from 'three';
import { RENDER } from '../config';

// 「厚塗插畫 × 烘焙色光」的材質：
// - 環境：頂點上的烘焙光（暖火把光、藍紫陰影）× 固有色，加上玩家提燈與心核的即時光、柔和色帶、霧，
//   以及世界變慢時的環境降彩度（威脅物件不受影響）。
// - 角色與可互動物件：三階 toon 光、邊緣光、受擊閃白、預備動作發光，外加反向外殼描邊。

export interface SharedUniforms {
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uSlow: { value: number };
  uLanternPos: { value: THREE.Vector3 };
  uLanternColor: { value: THREE.Color };
  uLanternRange: { value: number };
  uAccentPos: { value: THREE.Vector3 };
  uAccentColor: { value: THREE.Color };
  uAccentRange: { value: number };
  uTime: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uFogColor: { value: new THREE.Color(RENDER.fogColor) },
    uFogDensity: { value: RENDER.fogDensity },
    uSlow: { value: 0 },
    uLanternPos: { value: new THREE.Vector3() },
    uLanternColor: { value: new THREE.Color(0xffc48a).multiplyScalar(0.55) },
    uLanternRange: { value: 7.5 },
    uAccentPos: { value: new THREE.Vector3(0, -100, 0) },
    uAccentColor: { value: new THREE.Color(0x5aa8ff).multiplyScalar(1.3) },
    uAccentRange: { value: 9 },
    uTime: { value: 0 },
  };
}

const FOG_GLSL = /* glsl */ `
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
`;

const COMMON_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uSlow;
  uniform vec3 uLanternPos;
  uniform vec3 uLanternColor;
  uniform float uLanternRange;
  uniform vec3 uAccentPos;
  uniform vec3 uAccentColor;
  uniform float uAccentRange;
  uniform float uTime;
`;

const ENV_VERT = /* glsl */ `
  attribute vec3 aAlbedo;
  attribute vec3 aLight;
  varying vec3 vAlbedo;
  varying vec3 vLight;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vViewDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vViewDepth = -mv.z;
    vAlbedo = aAlbedo;
    vLight = aLight;
    gl_Position = projectionMatrix * mv;
  }
`;

const ENV_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  varying vec3 vAlbedo;
  varying vec3 vLight;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vViewDepth;

  vec3 pointLight(vec3 n, vec3 pos, vec3 color, float range) {
    vec3 L = pos - vWorldPos;
    float d = length(L);
    float att = clamp(1.0 - d / range, 0.0, 1.0);
    att *= att;
    float ndl = clamp(dot(n, L / max(d, 1e-3)) * 0.75 + 0.25, 0.0, 1.0);
    return color * att * ndl;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 light = vLight;
    light += pointLight(n, uLanternPos, uLanternColor, uLanternRange);
    light += pointLight(n, uAccentPos, uAccentColor, uAccentRange);
    // 柔和色帶：讓光影像手繪的分塊
    float li = dot(light, vec3(0.299, 0.587, 0.114));
    float band = floor(li * 6.0 + 0.5) / 6.0;
    float soft = mix(li, band, 0.4);
    light *= (soft + 1e-4) / (li + 1e-4);
    vec3 col = vAlbedo * light;
    // 世界變慢：環境稍微退色並偏冷（威脅物件使用其他材質，不受影響）
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * vec3(0.9, 0.95, 1.12), uSlow * 0.2);
    ${FOG_GLSL}
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createEnvMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: ENV_VERT,
    fragmentShader: ENV_FRAG,
  });
}

const CHAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aGlow;
  varying vec3 vColor;
  varying float vGlow;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vViewDepth;
  void main() {
    vColor = aColor;
    vGlow = aGlow;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CHAR_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  uniform vec3 uColor;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  uniform vec3 uGlow;
  uniform float uGlowAmt;
  uniform float uFlash;
  uniform float uDim;
  uniform float uDesat;
  uniform vec3 uTint;
  uniform float uTintAmt;
  varying vec3 vColor;
  varying float vGlow;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vViewDepth;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(n, normalize(uKeyDir));
    float t = smoothstep(-0.08, 0.08, ndl) * 0.6 + smoothstep(0.5, 0.62, ndl) * 0.4;
    vec3 lit = uAmbient + uKeyColor * t;
    vec3 L = uLanternPos - vWorldPos;
    float d = length(L);
    float att = clamp(1.0 - d / uLanternRange, 0.0, 1.0);
    lit += uLanternColor * att * att * smoothstep(-0.1, 0.2, dot(n, L / max(d, 1e-3))) * 1.1;
    vec3 A = uAccentPos - vWorldPos;
    float da = length(A);
    float aatt = clamp(1.0 - da / uAccentRange, 0.0, 1.0);
    lit += uAccentColor * aatt * aatt * smoothstep(-0.1, 0.2, dot(n, A / max(da, 1e-3)));
    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    vec3 base = uColor * vColor;
    vec3 col = base * lit * uDim + rim * 0.22 * (uKeyColor + uAmbient + vec3(0.08, 0.07, 0.12));
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * vec3(0.9, 0.95, 1.12), uSlow * 0.2 * uDesat);
    col += uGlow * uGlowAmt * vGlow;
    // 狀態色（麻痺、冰寒）：整個角色染色，保留明暗
    col = mix(col, uTint * (0.35 + 1.4 * dot(col, vec3(0.299, 0.587, 0.114))), uTintAmt);
    col = mix(col, vec3(1.0, 0.95, 0.9), uFlash);
    ${FOG_GLSL}
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface CharUniforms {
  uColor: { value: THREE.Color };
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Color };
  uAmbient: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uGlowAmt: { value: number };
  uFlash: { value: number };
  uDim: { value: number };
  uDesat: { value: number };
}

/** 每個角色共用一組光照 uniform（同一個物件），各部位只換顏色。 */
export interface LightRig {
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Color };
  uAmbient: { value: THREE.Color };
  uFlash: { value: number };
  uDim: { value: number };
  uTint: { value: THREE.Color };
  uTintAmt: { value: number };
}

export function createLightRig(): LightRig {
  return {
    uTint: { value: new THREE.Color(0xffffff) },
    uTintAmt: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0.3, 1, 0.2).normalize() },
    uKeyColor: { value: new THREE.Color(0xffb070).multiplyScalar(0.6) },
    uAmbient: { value: new THREE.Color(0x3a3f6a).multiplyScalar(0.55) },
    uFlash: { value: 0 },
    uDim: { value: 1 },
  };
}

/** 為幾何加上角色材質需要的頂點色與發光遮罩。 */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, glow = 0): THREE.BufferGeometry {
  const n = geo.attributes.position!.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n).fill(glow);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return geo;
}

export function createCharMaterial(
  shared: SharedUniforms,
  rig: LightRig,
  color: THREE.ColorRepresentation,
  opts: { glow?: THREE.ColorRepresentation; desat?: number } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      ...rig,
      uColor: { value: new THREE.Color(color) },
      uGlow: { value: new THREE.Color(opts.glow ?? 0xff6a1a) },
      uGlowAmt: { value: 0 },
      uDesat: { value: opts.desat ?? 0.5 },
    },
    vertexShader: CHAR_VERT,
    fragmentShader: CHAR_FRAG,
  });
}

const OUTLINE_VERT = /* glsl */ `
  uniform float uThickness;
  varying float vViewDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    float w = uThickness * clamp(-mv.z, 1.0, 30.0) * 0.006 + uThickness * 0.012;
    mv.xyz += n * w;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  uniform vec3 uOutline;
  varying float vViewDepth;
  void main() {
    vec3 col = uOutline;
    ${FOG_GLSL}
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createOutlineMaterial(shared: SharedUniforms, thickness = 1, color: THREE.ColorRepresentation = 0x0c0a14): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uThickness: { value: thickness }, uOutline: { value: new THREE.Color(color) } },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
  });
}

/** 柔邊圓形貼圖（煙霧、火光、光暈）。以 canvas 生成，不依賴外部檔案。 */
export function makeSoftTexture(size = 64, falloff = 2.2): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - d, falloff);
      const k = (y * size + x) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 煙霧用：帶有雲朵邊緣起伏的柔邊貼圖。 */
export function makeSmokeTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const ang = Math.atan2(dy, dx);
      const wob = 0.08 * Math.sin(ang * 5 + 1.3) + 0.05 * Math.sin(ang * 9 + 0.4);
      const d = Math.min(1, (Math.sqrt(dx * dx + dy * dy) * 2) / (0.9 + wob));
      const a = Math.pow(Math.max(0, 1 - d), 1.4);
      const shade = 225 + Math.round(30 * (1 - d) * (0.5 + 0.5 * Math.sin(dx * 9 - dy * 7)));
      const k = (y * size + x) * 4;
      img.data[k] = shade;
      img.data[k + 1] = shade - 6;
      img.data[k + 2] = Math.min(255, shade + 14);
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

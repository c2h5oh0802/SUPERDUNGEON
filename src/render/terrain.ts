import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { TER } from '../sim/grid';
import type { GameEvent } from '../sim/types';
import type { World } from '../sim/world';
import { COMMON_UNIFORMS_GLSL, FOG_GLSL, type SharedUniforms } from './materials';

// 地形的動態外觀：長草（會被踩倒、燒掉）與淺水（波光）。
// 每一種只有一個網格；草的狀態寫在頂點屬性裡，格子改變時只更新那一段。

const BLADES = 7;
const VERTS_PER_BLADE = 6;

/** 草的狀態：0 長草、1 被踩倒、2 燃燒中、3 燒成灰。 */
const STATE: Record<string, number> = { flat: 1, burning: 2, ash: 3 };

const REED_VERT = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  attribute vec3 aRoot;
  attribute float aH;
  attribute float aState;
  attribute float aTint;
  varying float vH;
  varying float vState;
  varying float vTint;
  varying vec3 vWorldPos;
  varying float vViewDepth;
  void main() {
    vec3 p = position;
    float tall = aState < 0.5 ? 1.0 : aState < 1.5 ? 0.16 : aState < 2.5 ? 0.85 : 0.0;
    // 鏡頭附近的草壓低，不擋住臉
    float dc = distance(aRoot.xz, uLanternPos.xz);
    tall *= mix(0.3, 1.0, smoothstep(0.35, 1.0, dc));
    float y = (p.y - aRoot.y) * tall;
    float sway = sin(uTime * 1.3 + aRoot.x * 1.7 + aRoot.z * 2.3) * 0.06 * aH * tall;
    p = vec3(p.x + sway, aRoot.y + y, p.z + sway * 0.6);
    vH = aH;
    vState = aState;
    vTint = aTint;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vWorldPos = p;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const REED_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  varying float vH;
  varying float vState;
  varying float vTint;
  varying vec3 vWorldPos;
  varying float vViewDepth;
  void main() {
    vec3 base = mix(vec3(0.16, 0.2, 0.1), vec3(0.52, 0.55, 0.3), vH);
    base *= 0.85 + vTint * 0.3;
    if (vState > 2.5) discard;
    float d = length(uLanternPos - vWorldPos);
    float att = clamp(1.0 - d / uLanternRange, 0.0, 1.0);
    vec3 col = base * (vec3(0.32, 0.3, 0.42) + uLanternColor * att * att * 1.4);
    if (vState > 1.5) {
      float f = 0.6 + 0.4 * sin(uTime * 23.0 + vWorldPos.x * 7.0) * sin(uTime * 17.0 + vWorldPos.z * 5.0);
      col = mix(col * 0.4, vec3(1.0, 0.45, 0.12) * f * 1.6, vH);
    }
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * vec3(0.9, 0.95, 1.12), uSlow * 0.2);
    ${FOG_GLSL}
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const WATER_VERT = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  varying vec3 vWorldPos;
  varying float vViewDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const WATER_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS_GLSL}
  varying vec3 vWorldPos;
  varying float vViewDepth;
  void main() {
    vec2 q = vWorldPos.xz;
    float r = sin(q.x * 3.1 + uTime * 1.2) * sin(q.y * 2.7 - uTime * 0.9) + 0.5 * sin((q.x + q.y) * 5.3 + uTime * 2.1);
    vec3 col = vec3(0.06, 0.2, 0.26) + vec3(0.04, 0.1, 0.12) * r;
    float d = length(uLanternPos - vWorldPos);
    float att = clamp(1.0 - d / (uLanternRange * 1.3), 0.0, 1.0);
    // 波光：提燈照到的水面閃爍
    float spark = pow(max(0.0, sin(q.x * 9.0 + uTime * 2.3) * sin(q.y * 8.0 - uTime * 1.9)), 6.0);
    col += uLanternColor * att * (0.25 + 0.3 * max(r, 0.0) + 1.2 * spark);
    ${FOG_GLSL}
    gl_FragColor = vec4(col, 0.78);
    #include <colorspace_fragment>
  }
`;

export class TerrainVisual {
  readonly group = new THREE.Group();
  private reedMat: THREE.ShaderMaterial | null = null;
  private waterMat: THREE.ShaderMaterial | null = null;
  private reedGeo: THREE.BufferGeometry | null = null;
  private waterGeo: THREE.BufferGeometry | null = null;
  /** 格子索引 → 頂點起點。 */
  private cellStart = new Map<number, number>();

  constructor(private world: World, shared: SharedUniforms) {
    const g = world.grid;
    const reedPos: number[] = [];
    const root: number[] = [];
    const hh: number[] = [];
    const st: number[] = [];
    const tint: number[] = [];
    const water: number[] = [];
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const t = g.terrainAt(i, j);
      if (t === TER.Water) {
        const y = 0.025;
        water.push(i, y, j, i + 1, y, j + 1, i + 1, y, j, i, y, j, i, y, j + 1, i + 1, y, j + 1);
        continue;
      }
      if (t !== TER.Reeds && t !== TER.Flat) continue;
      this.cellStart.set(j * g.w + i, reedPos.length / 3);
      const state = t === TER.Flat ? 1 : 0;
      for (let b = 0; b < BLADES; b++) {
        const rx = i + 0.1 + hash2(i * 7 + b, j * 13, 11) * 0.8;
        const rz = j + 0.1 + hash2(i * 5, j * 11 + b, 17) * 0.8;
        const height = 1.55 + hash2(i + b * 3, j, 23) * 0.6;
        const yaw = hash2(i, j + b * 5, 29) * Math.PI;
        const w2 = 0.05 + hash2(i * 3 + b, j * 3, 31) * 0.04;
        const lean = (hash2(i + b, j + b, 37) - 0.5) * 0.35;
        const cx = Math.cos(yaw) * w2;
        const cz = Math.sin(yaw) * w2;
        const tipX = rx + Math.sin(yaw) * lean;
        const tipZ = rz - Math.cos(yaw) * lean;
        const k = hash2(i * 17 + b, j * 19, 41);
        // 兩個三角形：底部寬、頂端尖
        const verts: Array<[number, number, number, number]> = [
          [rx - cx, 0, rz - cz, 0], [rx + cx, 0, rz + cz, 0], [tipX, height, tipZ, 1],
          [rx + cx * 0.6, height * 0.45, rz + cz * 0.6, 0.45], [rx - cx * 0.6, height * 0.45, rz - cz * 0.6, 0.45], [tipX, height, tipZ, 1],
        ];
        for (const [x, y, z, h] of verts) {
          reedPos.push(x, y, z);
          root.push(rx, 0, rz);
          hh.push(h);
          st.push(state);
          tint.push(k);
        }
      }
    }
    if (reedPos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(reedPos, 3));
      geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
      geo.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
      const sAttr = new THREE.Float32BufferAttribute(st, 1);
      sAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aState', sAttr);
      geo.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
      geo.computeBoundingSphere();
      this.reedMat = new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: REED_VERT, fragmentShader: REED_FRAG, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, this.reedMat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.reedGeo = geo;
    }
    if (water.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
      geo.computeBoundingSphere();
      this.waterMat = new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geo, this.waterMat);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.waterGeo = geo;
    }
  }

  onEvents(events: GameEvent[]): void {
    if (!this.reedGeo) return;
    const attr = this.reedGeo.getAttribute('aState') as THREE.BufferAttribute;
    let dirty = false;
    for (const e of events) {
      if (e.type !== 'terrain' || e.x === undefined || e.z === undefined) continue;
      const state = STATE[e.kind ?? ''];
      if (state === undefined) continue;
      const start = this.cellStart.get(Math.floor(e.z) * this.world.grid.w + Math.floor(e.x));
      if (start === undefined) continue;
      for (let k = 0; k < BLADES * VERTS_PER_BLADE; k++) attr.setX(start + k, state);
      dirty = true;
    }
    if (dirty) attr.needsUpdate = true;
  }

  dispose(): void {
    this.reedGeo?.dispose();
    this.waterGeo?.dispose();
    this.reedMat?.dispose();
    this.waterMat?.dispose();
    this.group.clear();
  }
}

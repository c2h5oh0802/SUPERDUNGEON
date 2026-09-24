// 模擬用的輕量向量運算（不依賴 three，便於在 Node 測試）。

export interface V2 {
  x: number;
  z: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const v2 = (x = 0, z = 0): V2 => ({ x, z });

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist3(a: V3, b: V3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** yaw 對應的水平前方：yaw=0 朝 -z（與 three.js 相機一致）。 */
export function forwardFromYaw(yaw: number): V2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function yawFromDir(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function dirFromYawPitch(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angleDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}

/** 以最大角速度 rate 由 cur 轉向 target。 */
export function turnToward(cur: number, target: number, rate: number): number {
  const d = angleDiff(target, cur);
  if (Math.abs(d) <= rate) return target;
  return wrapAngle(cur + Math.sign(d) * rate);
}

/** 點到線段（3D）的最近距離平方與參數 t。 */
export function pointSegDist2(p: V3, a: V3, b: V3): { d2: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (len2 > 1e-12) t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2, 0, 1);
  const cx = a.x + abx * t - p.x;
  const cy = a.y + aby * t - p.y;
  const cz = a.z + abz * t - p.z;
  return { d2: cx * cx + cy * cy + cz * cz, t };
}

/**
 * 線段 a→b 與球（中心 c、半徑 r）第一次接觸的參數 t（0..1），沒有則回傳 -1。
 * 起點已在球內時回傳 0。
 */
export function segSphere(a: V3, b: V3, c: V3, r: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C <= 0) return 0;
  if (A < 1e-12) return -1;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * 兩個同時移動的球：在同一時間區間內，p 從 p0 以速度 vp 移動、q 從 q0 以速度 vq 移動，
 * 回傳第一次距離 ≤ r 的時間 τ（0..dt），沒有則 -1。用於飛行中的瓶子與箭／石的交會。
 */
export function movingSpheresTOI(p0: V3, vp: V3, q0: V3, vq: V3, r: number, dt: number): number {
  const rx = p0.x - q0.x;
  const ry = p0.y - q0.y;
  const rz = p0.z - q0.z;
  const vx = vp.x - vq.x;
  const vy = vp.y - vq.y;
  const vz = vp.z - vq.z;
  const C = rx * rx + ry * ry + rz * rz - r * r;
  if (C <= 0) return 0;
  const A = vx * vx + vy * vy + vz * vz;
  if (A < 1e-12) return -1;
  const B = 2 * (rx * vx + ry * vy + rz * vz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= dt ? t : -1;
}

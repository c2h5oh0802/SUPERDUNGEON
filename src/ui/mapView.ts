import { ITEM_FX } from '../config';
import { localize } from './i18n';
import { T, TER } from '../sim/grid';
import type { World } from '../sim/world';

/** 自動地圖：只畫玩家看過的格子與已發現的重要地點；不顯示敵人。 */
export function drawMap(canvas: HTMLCanvasElement, w: World): void {
  const g = w.grid;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // 以已探索範圍取景
  let minI = g.w;
  let minJ = g.h;
  let maxI = 0;
  let maxJ = 0;
  for (let j = 0; j < g.h; j++)
    for (let i = 0; i < g.w; i++)
      if (w.isExplored(i, j)) {
        minI = Math.min(minI, i);
        minJ = Math.min(minJ, j);
        maxI = Math.max(maxI, i);
        maxJ = Math.max(maxJ, j);
      }
  // 心眼：地圖範圍也包含感覺到的敵人
  if ((w.player.mindT ?? 0) > 0) {
    for (const e of w.enemies) {
      if (!e.alive || Math.hypot(e.x - w.player.x, e.z - w.player.z) > ITEM_FX.mindvision.range) continue;
      minI = Math.min(minI, Math.floor(e.x));
      minJ = Math.min(minJ, Math.floor(e.z));
      maxI = Math.max(maxI, Math.floor(e.x));
      maxJ = Math.max(maxJ, Math.floor(e.z));
    }
  }
  if (maxI < minI) {
    minI = 0;
    minJ = 0;
    maxI = g.w - 1;
    maxJ = g.h - 1;
  }
  const pad = 3;
  minI = Math.max(0, minI - pad);
  minJ = Math.max(0, minJ - pad);
  maxI = Math.min(g.w - 1, maxI + pad);
  maxJ = Math.min(g.h - 1, maxJ + pad);
  const cw = canvas.width;
  const ch = canvas.height;
  const s = Math.min(cw / (maxI - minI + 1), ch / (maxJ - minJ + 1), 22);
  const ox = (cw - (maxI - minI + 1) * s) / 2 - minI * s;
  const oz = (ch - (maxJ - minJ + 1) * s) / 2 - minJ * s;
  ctx.fillStyle = '#0d0b18';
  ctx.fillRect(0, 0, cw, ch);
  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      if (!w.isExplored(i, j)) continue;
      const t = g.get(i, j);
      let c = '';
      switch (t) {
        case T.Floor: {
          const ter = g.terrainAt(i, j);
          c = ter === TER.Water ? '#2c4a5c' : ter === TER.Reeds ? '#3c5236' : ter === TER.Flat ? '#45503c' : '#3b3450';
          break;
        }
        case T.Chasm:
          c = '#08070c';
          break;
        case T.Wall:
          c = '#7a6c5e';
          break;
        case T.Low:
          c = '#5c5268';
          break;
        case T.Platform:
          c = '#51485f';
          break;
        case T.Stairs:
          c = '#8ccaff';
          break;
        case T.Door: {
          const d = g.doorAt(i, j)!;
          // 秘密門在被發現前畫成牆；上鎖的寶庫門是金色
          c = d.hidden ? '#7a6c5e' : d.arch ? '#3b3450' : d.locked ? '#f2c14e' : d.barred ? '#c07040' : d.progress > 0.5 ? '#7a5a3a' : '#a8743e';
          break;
        }
        default:
          continue;
      }
      ctx.fillStyle = c;
      ctx.fillRect(ox + i * s, oz + j * s, Math.ceil(s), Math.ceil(s));
    }
  }
  const trapColor: Record<string, string> = {
    spikes: '#b8603a', alarm: '#e04848', fire: '#ff7a2a', frost: '#6ad0ff', gas: '#b070ff', dart: '#c8c8b0', teleport: '#ff5ad8',
  };
  for (const t of w.traps) {
    if (!w.isExplored(t.i, t.j) || t.hidden) continue;
    ctx.fillStyle = t.spent ? '#4a4450' : trapColor[t.kind] ?? '#b8603a';
    ctx.fillRect(ox + (t.i + 0.25) * s, oz + (t.j + 0.25) * s, s * 0.5, s * 0.5);
  }
  const mark = (x: number, z: number, color: string, shape: 'sq' | 'dia' | 'tri', size = 0.45) => {
    const cx = ox + x * s;
    const cy = oz + z * s;
    const r = Math.max(4, s * size);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (shape === 'sq') ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
    else if (shape === 'dia') {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
    } else {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.lineTo(cx - r, cy + r);
      ctx.closePath();
    }
    ctx.fill();
  };
  for (const it of w.interactables) {
    if (!w.isExplored(Math.floor(it.x), Math.floor(it.z))) continue;
    if (it.kind === 'chest') mark(it.x, it.z, it.used ? '#6b6275' : '#f2c14e', 'sq', 0.4);
    else if (it.kind === 'heart' && w.level.goal === 'descend') mark(it.x, it.z, '#3fe0c0', 'tri', 0.6);
    else if (it.kind === 'heart' && !w.heartTaken) mark(it.x, it.z, '#5aa8ff', 'dia', 0.6);
    else if (it.kind === 'stairs') mark(it.x, it.z, '#8ccaff', 'tri', 0.6);
    else if (it.kind === 'resupply') mark(it.x, it.z, '#3fe0c0', 'sq', 0.4);
    else if (it.kind === 'pedestal') mark(it.x, it.z, it.used ? '#6b6275' : '#f2c14e', 'dia', 0.35);
    // 寶箱怪在地圖上也像一個寶箱
    else if (it.kind === 'mimic' && w.enemies.some((e) => e.id === it.ref && e.alive && e.disguised)) mark(it.x, it.z, '#f2c14e', 'sq', 0.4);
  }
  for (const k of w.pickups) if (k.kind === 'key' && !k.taken && w.isExplored(Math.floor(k.x), Math.floor(k.z))) mark(k.x, k.z, '#ffe08a', 'dia', 0.45);
  // 心眼：範圍內的敵人（包括偽裝的寶箱怪）在地圖上也看得到
  if ((w.player.mindT ?? 0) > 0) {
    for (const e of w.enemies) {
      if (!e.alive || Math.hypot(e.x - w.player.x, e.z - w.player.z) > ITEM_FX.mindvision.range) continue;
      const attacking = e.phase === 'windup' || e.phase === 'aim' || e.phase === 'charge' || e.phase === 'active';
      mark(e.x, e.z, attacking ? '#ff6a4a' : '#b9a6ff', 'dia', 0.75);
    }
  }
  // 房間名稱
  ctx.font = `${Math.max(11, Math.round(s * 0.7))}px 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(236,228,212,0.55)';
  for (const r of w.level.rooms) {
    const cx = Math.floor(r.x0 + r.w / 2);
    const cz = Math.floor(r.z0 + r.h / 2);
    if (w.isExplored(cx, cz)) ctx.fillText(localize(r.name), ox + (r.x0 + r.w / 2) * s, oz + (r.z0 + 1.6) * s);
  }
  // 玩家
  const p = w.player;
  const px = ox + p.x * s;
  const pz = oz + p.z * s;
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-p.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const r = Math.max(6, s * 0.7);
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.7, r * 0.8);
  ctx.lineTo(-r * 0.7, r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

import { T } from '../sim/grid';
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
        case T.Floor:
          c = '#3b3450';
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
          c = d.arch ? '#3b3450' : d.barred ? '#c07040' : d.progress > 0.5 ? '#7a5a3a' : '#a8743e';
          break;
        }
        default:
          continue;
      }
      ctx.fillStyle = c;
      ctx.fillRect(ox + i * s, oz + j * s, Math.ceil(s), Math.ceil(s));
    }
  }
  for (const t of w.traps) {
    if (!w.isExplored(t.i, t.j)) continue;
    ctx.fillStyle = '#b8603a';
    ctx.fillRect(ox + (t.i + 0.25) * s, oz + (t.j + 0.25) * s, s * 0.5, s * 0.5);
  }
  const mark = (x: number, z: number, color: string, shape: 'sq' | 'dia' | 'tri' | 'ring', size = 0.45) => {
    const cx = ox + x * s;
    const cy = oz + z * s;
    const r = Math.max(4, s * size);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (shape === 'sq') ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
    else if (shape === 'dia' || shape === 'ring') {
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
    if (shape === 'ring') ctx.stroke();
    else ctx.fill();
  };
  for (const it of w.interactables) {
    if (!w.isExplored(Math.floor(it.x), Math.floor(it.z))) continue;
    if (it.kind === 'chest') mark(it.x, it.z, it.used ? '#6b6275' : '#f2c14e', 'sq', 0.4);
    else if (it.kind === 'altar') mark(it.x, it.z, it.used ? '#4b6a66' : '#3fe0c0', 'ring', 0.55);
    else if (it.kind === 'heart' && !w.heartTaken) mark(it.x, it.z, '#5aa8ff', 'dia', 0.6);
    else if (it.kind === 'stairs') mark(it.x, it.z, '#8ccaff', 'tri', 0.6);
    else if (it.kind === 'resupply') mark(it.x, it.z, '#3fe0c0', 'sq', 0.4);
  }
  // 房間名稱
  ctx.font = `${Math.max(11, Math.round(s * 0.7))}px 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(236,228,212,0.55)';
  for (const r of w.level.rooms) {
    const cx = Math.floor(r.x0 + r.w / 2);
    const cz = Math.floor(r.z0 + r.h / 2);
    if (w.isExplored(cx, cz)) ctx.fillText(r.name, ox + (r.x0 + r.w / 2) * s, oz + (r.z0 + 1.6) * s);
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

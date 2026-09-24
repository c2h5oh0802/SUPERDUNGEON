import { DOOR, NOISE, PLAYER, SMOKE, TRAP } from '../config';
import { smoothstep } from '../core/math';
import { damageEnemy } from './enemySys';
import type { World } from './world';

function doorOccupied(w: World, doorId: number): boolean {
  const d = w.grid.doors[doorId]!;
  const circles: Array<{ x: number; z: number; r: number }> = [{ x: w.player.x, z: w.player.z, r: PLAYER.radius }];
  for (const e of w.enemies) if (e.alive) circles.push({ x: e.x, z: e.z, r: e.radius });
  for (const [i, j] of d.cells) {
    for (const c of circles) {
      const cx = Math.max(i, Math.min(c.x, i + 1));
      const cz = Math.max(j, Math.min(c.z, j + 1));
      if (Math.hypot(c.x - cx, c.z - cz) < c.r) return true;
    }
  }
  return false;
}

/** 開關門（玩家或敵人）。門被角色擋住時拒絕關閉，不夾人、不推人。 */
export function setDoor(w: World, doorId: number, open: boolean, by: 'player' | 'enemy'): boolean {
  const d = w.grid.doors[doorId]!;
  if (d.arch) return false;
  if (!open && doorOccupied(w, doorId)) {
    if (by === 'player') w.emit({ type: 'doorBlocked', text: '門口有東西擋著' });
    return false;
  }
  if (d.target === (open ? 1 : 0)) return false;
  d.target = open ? 1 : 0;
  w.emit({ type: 'door', id: doorId, open, x: d.cx, z: d.cz, source: by });
  w.emitNoise(d.cx, 1.5, d.cz, NOISE.door, 'door');
  return true;
}

export function updateDoors(w: World, dt: number): void {
  const rate = dt / DOOR.moveTime;
  for (const d of w.grid.doors) {
    if (d.arch) continue;
    if (d.progress < d.target) d.progress = Math.min(1, d.progress + rate);
    else if (d.progress > d.target) d.progress = Math.max(0, d.progress - rate);
  }
}

function inCell(x: number, z: number, i: number, j: number, inset: number): boolean {
  return x >= i + inset && x <= i + 1 - inset && z >= j + inset && z <= j + 1 - inset;
}

function circleOverlapsCell(x: number, z: number, r: number, i: number, j: number): boolean {
  const cx = Math.max(i, Math.min(x, i + 1));
  const cz = Math.max(j, Math.min(z, j + 1));
  return Math.hypot(x - cx, z - cz) < r;
}

/** 尖刺踏板：踩下 → 預警 → 尖刺 → 重置；玩家與敵人都會觸發。 */
export function updateTraps(w: World, dt: number): void {
  const p = w.player;
  for (const t of w.traps) {
    t.t += dt;
    switch (t.state) {
      case 'idle': {
        let trig = !p.dead && inCell(p.x, p.z, t.i, t.j, 0.05);
        if (!trig) for (const e of w.enemies) if (e.alive && !e.perched && inCell(e.x, e.z, t.i, t.j, 0.05)) trig = true;
        if (trig) {
          t.state = 'armed';
          t.t = 0;
          w.emit({ type: 'trapArm', id: t.id, x: t.i + 0.5, y: 0, z: t.j + 0.5 });
        }
        break;
      }
      case 'armed':
        if (t.t >= TRAP.warn) {
          t.state = 'spikes';
          t.t = 0;
          t.hitSet.clear();
          w.emit({ type: 'trapSpike', id: t.id, x: t.i + 0.5, y: 0, z: t.j + 0.5 });
          w.emitNoise(t.i + 0.5, 0.5, t.j + 0.5, NOISE.trap, 'trap');
        }
        break;
      case 'spikes':
        if (!p.dead && !t.hitSet.has(0) && circleOverlapsCell(p.x, p.z, PLAYER.radius * 0.6, t.i, t.j)) {
          t.hitSet.add(0);
          w.damagePlayer(TRAP.damage, '尖刺踏板', t.i + 0.5, t.j + 0.5);
        }
        for (const e of w.enemies) {
          if (!e.alive || e.perched || t.hitSet.has(e.id)) continue;
          if (circleOverlapsCell(e.x, e.z, e.radius * 0.6, t.i, t.j)) {
            t.hitSet.add(e.id);
            damageEnemy(w, e, TRAP.damage, { source: 'trap', sneak: false, head: false, x: e.x, y: 0.3, z: e.z });
          }
        }
        if (t.t >= TRAP.spikes) {
          t.state = 'reset';
          t.t = 0;
        }
        break;
      case 'reset':
        if (t.t >= TRAP.reset) {
          t.state = 'idle';
          t.t = 0;
        }
        break;
    }
  }
}

/** 煙霧：世界時間壽命；半徑先擴張、最後收縮消失。 */
export function updateSmokes(w: World, dt: number): void {
  for (const s of w.smokes) {
    s.age += dt;
    const grow = 0.35 + 0.65 * smoothstep(0, SMOKE.growTime, s.age);
    const fade = 1 - smoothstep(SMOKE.life - SMOKE.fadeTime, SMOKE.life, s.age);
    s.radius = SMOKE.radius * grow * fade;
  }
  for (let i = w.smokes.length - 1; i >= 0; i--) if (w.smokes[i]!.age >= SMOKE.life) w.smokes.splice(i, 1);
}

/** 走過去自動拾取（不花時間）；滿了就留在原地。 */
export function updatePickups(w: World): void {
  const p = w.player;
  if (p.dead) return;
  for (const k of w.pickups) {
    if (k.taken) continue;
    if (k.y > 2.4) continue;
    if (Math.hypot(k.x - p.x, k.z - p.z) > PLAYER.pickupRadius) continue;
    const key = k.kind === 'arrows' ? 'arrows' : k.kind === 'bottle' ? 'bottles' : 'potions';
    const max = k.kind === 'arrows' ? PLAYER.maxArrows : k.kind === 'bottle' ? PLAYER.maxBottles : PLAYER.maxPotions;
    const room = max - p[key];
    if (room <= 0) continue;
    const take = Math.min(room, k.amount);
    p[key] += take;
    k.amount -= take;
    w.emit({ type: 'pickup', kind: k.kind, amount: take, x: k.x, z: k.z });
    if (k.amount <= 0) k.taken = true;
  }
  if (w.pickups.length > 64) {
    for (let i = w.pickups.length - 1; i >= 0; i--) if (w.pickups[i]!.taken) w.pickups.splice(i, 1);
  }
}

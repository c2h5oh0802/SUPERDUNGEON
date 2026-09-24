import { ENEMIES, PERCEPTION, PLAYER } from '../config';
import { Nav } from '../sim/nav';
import { buildLevel, type GenerateOptions, type LevelData } from './generator';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const ENEMY_NAV_R = Math.max(ENEMIES.guard.radius, ENEMIES.archer.radius, ENEMIES.charger.radius);

function reachableNear(nav: Nav, seen: Uint8Array, x: number, z: number, within: number): boolean {
  const r = Math.ceil(within / nav.res);
  const ci = Math.floor(x / nav.res);
  const cj = Math.floor(z / nav.res);
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= nav.w || j >= nav.h) continue;
      const c = nav.center(j * nav.w + i);
      if (Math.hypot(c.x - x, c.z - z) > within) continue;
      if (seen[j * nav.w + i]) return true;
    }
  }
  return false;
}

/** 以角色實際半徑擴張後的導航格檢查可達性、出生安全與關鍵物件位置。 */
export function validateLevel(l: LevelData): ValidationResult {
  const errors: string[] = [];
  const g = l.grid;
  const pnav = new Nav(g, PLAYER.radius);
  const enav = new Nav(g, ENEMY_NAV_R);

  if (g.circleBlocked(l.spawn.x, l.spawn.z, PLAYER.radius)) errors.push('出生點被阻擋');
  const seen = pnav.flood(l.spawn.x, l.spawn.z, false);

  const need = (label: string, x: number, z: number, within = 1.6) => {
    if (!reachableNear(pnav, seen, x, z, within)) errors.push(`${label} 不可達`);
  };
  if (!l.practice) {
    if (!l.heart) errors.push('缺少沉眠之心');
    else need('沉眠之心', l.heart.x, l.heart.z);
    if (!l.stairs) errors.push('缺少出口階梯');
    else need('出口階梯', l.stairs.front.x, l.stairs.front.z, 0.9);
  }
  l.chests.forEach((c, k) => need(`寶箱 ${k}`, c.x, c.z));
  l.altars.forEach((a, k) => need(`祭壇 ${k}`, a.x, a.z));
  if (l.resupply) need('補給台', l.resupply.x, l.resupply.z);

  // 不經過陷阱也能抵達沉眠之心
  if (l.heart) {
    const trapCells = new Set(l.traps.map((t) => `${t.i},${t.j}`));
    const seenNoTrap = floodAvoiding(pnav, l.spawn.x, l.spawn.z, (x, z) => {
      for (let dz = -PLAYER.radius; dz <= PLAYER.radius; dz += PLAYER.radius) {
        for (let dx = -PLAYER.radius; dx <= PLAYER.radius; dx += PLAYER.radius) {
          if (trapCells.has(`${Math.floor(x + dx)},${Math.floor(z + dz)}`)) return true;
        }
      }
      return false;
    });
    if (!reachableNear(pnav, seenNoTrap, l.heart.x, l.heart.z, 1.6)) errors.push('沉眠之心只能經過陷阱抵達');
  }

  // 出生安全
  const entrance = l.rooms.find((r) => r.role === 'entrance' || r.role === 'practice');
  const eye = { x: l.spawn.x, y: PLAYER.eyeHeight, z: l.spawn.z };
  for (const e of l.enemies) {
    if (
      entrance &&
      entrance.role === 'entrance' &&
      e.x >= entrance.x0 &&
      e.x < entrance.x0 + entrance.w &&
      e.z >= entrance.z0 &&
      e.z < entrance.z0 + entrance.h
    )
      errors.push('入口房有敵人');
    const d = Math.hypot(e.x - l.spawn.x, e.z - l.spawn.z);
    if (!l.practice && d < 9) errors.push(`敵人距出生點過近（${d.toFixed(1)} m）`);
    const eeye = { x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z };
    if (!l.practice && d < PERCEPTION.alertRange && g.lineOfSight(eeye, eye)) errors.push('敵人開局即可看見出生點');
    if (!e.perched) {
      const c = enav.nearestPassable(e.x, e.z, 3);
      if (c < 0) errors.push(`敵人 ${e.kind} 起點無法導航`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function floodAvoiding(nav: Nav, sx: number, sz: number, avoid: (x: number, z: number) => boolean): Uint8Array {
  const seen = new Uint8Array(nav.w * nav.h);
  const start = nav.nearestPassable(sx, sz);
  if (start < 0) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const ci = c % nav.w;
    const cj = Math.floor(c / nav.w);
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nav.w || nj >= nav.h) continue;
      const n = nj * nav.w + ni;
      if (seen[n] || !nav.passable(n)) continue;
      const p = nav.center(n);
      if (avoid(p.x, p.z)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

export interface GeneratedLevel {
  level: LevelData;
  attempts: number;
}

/** 產生並驗證關卡；同種子結果完全相同。 */
export function generateLevel(seed: string, opts: GenerateOptions = {}): LevelData {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    const level = buildLevel(seed, attempt, opts);
    const v = validateLevel(level);
    if (v.ok) return level;
    lastErrors = v.errors;
  }
  throw new Error(`無法為種子 ${seed} 產生合法地城：${lastErrors.join('、')}`);
}

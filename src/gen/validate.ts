import { ENEMIES, HUNGER, IDENTIFY, ITEM_FX, PERCEPTION, PLAYER, RUN } from '../config';
import { Nav } from '../sim/nav';
import { T } from '../sim/grid';
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
  // 拉開門閂、打開上鎖與秘密門之後才走得到的地方（寶箱、寶庫台座）
  const seenAll = pnav.flood(l.spawn.x, l.spawn.z, true);

  const need = (label: string, x: number, z: number, within = 1.6) => {
    if (!reachableNear(pnav, seen, x, z, within)) errors.push(`${label} 不可達`);
  };
  if (!l.practice) {
    if (!l.heart) errors.push('缺少沉眠之心');
    else need('沉眠之心', l.heart.x, l.heart.z);
    if (!l.stairs) errors.push('缺少出口階梯');
    else need('出口階梯', l.stairs.front.x, l.stairs.front.z, 0.9);
  }
  l.chests.forEach((c, k) => {
    if (!reachableNear(pnav, seenAll, c.x, c.z, 1.6)) errors.push(`寶箱 ${k} 不可達`);
  });
  for (const [k, p] of (l.pedestals ?? []).entries()) if (!reachableNear(pnav, seenAll, p.x, p.z, 1.6)) errors.push(`寶庫台座 ${k} 不可達`);
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

  const identifySupplies = l.pickups.filter((p) => p.guaranteedIdentify);
  const identifyCount = l.practice ? IDENTIFY.practiceCount : (IDENTIFY.guaranteedPerFloor[l.floor - 1] ?? 0);
  if (identifySupplies.length !== identifyCount) errors.push('鑑定卷軸保底數量錯誤');
  if (!l.practice) {
    const food = l.pickups.filter((p) => p.item === 'food:ration');
    if (food.length !== HUNGER.foodPerFloor[l.floor - 1]) errors.push('乾糧保底數量錯誤');
    const upgrades = l.pickups.filter((p) => p.item === 'scroll:upgrade');
    if (upgrades.length !== (l.encounter ? 0 : 1)) errors.push('強化卷軸預算錯誤');
    for (const p of food) need('乾糧', p.x, p.z, PLAYER.pickupRadius);
    if (l.encounter && (l.pickups.length || l.chests.length || l.traps.length)) errors.push('首領層混入探索物資或陷阱');
    if (l.encounter && (l.enemies.length !== 1 || l.enemies[0]?.kind !== 'warden' || !l.enemies[0]?.boss)) errors.push('首領層必須有一名守心者');
    if (l.floor <= RUN.explorationFloors && l.goal !== 'descend') errors.push('探索層不可直接通關');
    const optional = l.rooms.filter((r) => r.optional);
    const inOptional = (x: number, z: number) => optional.some((r) => x >= r.x0 && x <= r.x0 + r.w && z >= r.z0 && z <= r.z0 + r.h);
    const flames = (l.specialRooms ?? []).flatMap((r) => r.fire ? [r.fire] : []);
    const safe = floodAvoiding(pnav, l.spawn.x, l.spawn.z, (x, z) => inOptional(x, z) ||
      flames.some((a) => Math.hypot(a.x - x, a.z - z) <= ITEM_FX.area.fire.radius + PLAYER.radius));
    if (l.heart && !reachableNear(pnav, safe, l.heart.x, l.heart.z, 1.6)) errors.push('主線需要穿過特殊房');
    for (const p of identifySupplies) {
      if (p.kind !== 'item' || p.item !== 'scroll:identify' || p.amount !== 1 || p.level !== 0) errors.push('鑑定卷軸保底內容錯誤');
      const mainRoom = l.rooms.some((r) => !r.optional && r.role === 'combat' &&
        p.x > r.x0 && p.x < r.x0 + r.w && p.z > r.z0 && p.z < r.z0 + r.h);
      if (!mainRoom || !reachableNear(pnav, safe, p.x, p.z, PLAYER.pickupRadius)) errors.push('鑑定卷軸保底不在可達主線');
      if (g.circleBlocked(p.x, p.z, PLAYER.radius) ||
          Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z) <= PLAYER.pickupRadius ||
          l.traps.some((t) => Math.hypot(t.i + .5 - p.x, t.j + .5 - p.z) < 1.2) ||
          l.enemies.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < PLAYER.radius + ENEMIES[e.kind].radius) ||
          l.pickups.some((other) => other !== p && Math.hypot(other.x - p.x, other.z - p.z) < 1)) errors.push('鑑定卷軸保底位置不安全');
    }
    for (const room of l.specialRooms ?? []) {
      if (!optional.some((r) => r.key === room.roomKey)) errors.push('特殊房不是可選支線');
      const supply = room.supply;
      if (!room.solution || !supply) continue;
      if (!l.pickups.some((p) => p.item === room.solution && p.x === supply.x && p.z === supply.z)) errors.push('特殊房缺少保底物資');
      if (!reachableNear(pnav, safe, supply.x, supply.z, PLAYER.pickupRadius)) errors.push('特殊房物資需要穿過自身危險');
    }
    if (l.gen === 2) {
      const vaults = (l.specialRooms ?? []).filter((r) => r.kind === 'vault');
      const keys = l.pickups.filter((p) => p.kind === 'key');
      if (keys.length !== vaults.length) errors.push('寶庫鑰匙數量錯誤');
      if ((l.pedestals ?? []).length !== vaults.length * 3) errors.push('寶庫台座數量錯誤');
      if (vaults.length && !g.doors.some((d) => d.locked)) errors.push('寶庫沒有上鎖');
      for (const k of keys) if (!reachableNear(pnav, safe, k.x, k.z, PLAYER.pickupRadius)) errors.push('鑰匙不在可達主線');
      // 上鎖與秘密門後面只有可選的特殊房
      for (const r of optional) {
        if (!(l.specialRooms ?? []).some((s) => s.roomKey === r.key && (s.kind === 'vault' || s.kind === 'stash'))) continue;
        if (reachableNear(pnav, seen, r.x0 + r.w / 2, r.z0 + r.h / 2, 3)) errors.push('上鎖或秘密房沒有被門隔開');
      }
      const doorCells = new Set(g.doors.flatMap((d) => d.cells.map(([i, j]) => `${i},${j}`)));
      for (const t of l.traps) if (doorCells.has(`${t.i},${t.j}`) || g.get(t.i, t.j) !== T.Floor) errors.push('陷阱位置錯誤');
    }
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

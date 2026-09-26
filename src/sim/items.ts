import {
  ALL_POTIONS,
  ALL_SCROLLS,
  ARMORS,
  ITEM_FX,
  PLAYER,
  POTIONS,
  POTION_LOOKS,
  SCROLLS,
  SCROLL_LOOKS,
  TALENT_FX,
  UPGRADE,
  WEAPONS,
  type ItemId,
  type PotionId,
  type ScrollId,
} from '../config';
import { dirFromYawPitch } from '../core/math';
import { Rng } from '../core/rng';
import { rollConsumable, rollItem } from '../gen/loot';
import { AIM_EYE_Y, aimPoint } from './aim';
import { Nav } from './nav';
import { hasTalent, queueChoice } from './progress';
import type { Area, Enemy, InvItem, UpgradeTarget } from './types';
import type { World } from './world';

// 物品：未鑑定的藥水與卷軸（每一局外觀不同）、背包、喝／讀／丟／裝備，以及效果。

export type ItemCategory = 'potion' | 'scroll' | 'weapon' | 'armor';

export const categoryOf = (id: ItemId): ItemCategory => id.split(':')[0] as ItemCategory;
const keyOf = (id: ItemId): string => id.split(':')[1]!;

// ---------- 外觀與鑑定 ----------

interface Looks {
  potion: Record<PotionId, number>;
  scroll: Record<ScrollId, number>;
}

const looksCache = new Map<string, Looks>();

/** 這一局（種子）的外觀對應：同一個種子永遠一樣，所以跨層、續玩都一致。 */
export function looksFor(seed: string): Looks {
  let l = looksCache.get(seed);
  if (l) return l;
  const rng = new Rng(`${seed}#looks`);
  const pi = rng.shuffle(ALL_POTIONS.map((_, k) => k));
  const si = rng.shuffle(ALL_SCROLLS.map((_, k) => k));
  l = {
    potion: Object.fromEntries(ALL_POTIONS.map((id, k) => [id, pi[k]!])) as Record<PotionId, number>,
    scroll: Object.fromEntries(ALL_SCROLLS.map((id, k) => [id, si[k]!])) as Record<ScrollId, number>,
  };
  looksCache.set(seed, l);
  return l;
}

export function isKnown(w: World, id: ItemId): boolean {
  const c = categoryOf(id);
  if (c === 'weapon' || c === 'armor' || id === 'scroll:upgrade') return true;
  return w.player.known.includes(id);
}

function lookName(w: World, id: ItemId): string {
  const looks = looksFor(w.level.seed);
  if (categoryOf(id) === 'potion') return `${POTION_LOOKS[looks.potion[keyOf(id) as PotionId]]!.name}藥水`;
  return `${SCROLL_LOOKS[looks.scroll[keyOf(id) as ScrollId]]!}符文卷軸`;
}

export function identify(w: World, id: ItemId): void {
  if (isKnown(w, id)) return;
  w.player.known.push(id);
  w.emit({ type: 'identify', kind: id, text: `${lookName(w, id)}原來是「${itemName(w, id)}」` });
}

export function itemName(w: World, id: ItemId, level = 0): string {
  const c = categoryOf(id);
  const lv = level ? ` +${level}` : '';
  if (c === 'weapon') return `${WEAPONS[keyOf(id) as keyof typeof WEAPONS].name}${lv}`;
  if (c === 'armor') return `${ARMORS[keyOf(id) as keyof typeof ARMORS].name}${lv}`;
  if (!isKnown(w, id)) return lookName(w, id);
  if (c === 'potion') return POTIONS[keyOf(id) as PotionId].name;
  return SCROLLS[keyOf(id) as ScrollId | 'upgrade'].name;
}

export function itemDesc(w: World, id: ItemId): string {
  const c = categoryOf(id);
  const k = keyOf(id);
  if (c === 'weapon') {
    const s = WEAPONS[k as keyof typeof WEAPONS];
    return `${s.damage} 傷害（每級 +${s.perLevel}）、${Math.round((s.windup + s.active + s.recovery) * 100) / 100} 秒、範圍 ${s.reach} m、背刺 ×${s.sneakMultiplier}；${s.note}`;
  }
  if (c === 'armor') return ARMORS[k as keyof typeof ARMORS].note;
  if (!isKnown(w, id)) return c === 'potion' ? '未知的藥水：喝下或丟出才知道效果。' : '未知的卷軸：讀了才知道效果。';
  if (c === 'potion') {
    const p = POTIONS[k as PotionId];
    return `喝下：${p.drink}。丟出：${p.thrown}。`;
  }
  return SCROLLS[k as ScrollId | 'upgrade'].text + '。';
}

/** 物品在畫面上的顏色（藥水依這一局的外觀）。 */
export function itemColor(seed: string, id: ItemId): number {
  const c = categoryOf(id);
  if (c === 'potion') return POTION_LOOKS[looksFor(seed).potion[keyOf(id) as PotionId]]!.color;
  if (c === 'scroll') return id === 'scroll:upgrade' ? 0xf2c14e : 0xe8dcc0;
  if (c === 'armor') return 0x9aa4b0;
  return 0xc3cad4;
}

// ---------- 背包 ----------

/** 放進背包；滿了回傳 false。 */
export function addItem(w: World, id: ItemId, level = 0): boolean {
  const items = w.player.items;
  const c = categoryOf(id);
  if (c === 'potion' || c === 'scroll') {
    const s = items.find((it) => it.id === id);
    if (s) {
      s.count++;
      return true;
    }
  }
  if (items.length >= ITEM_FX.slots) return false;
  items.push({ id, count: 1, level });
  return true;
}

function takeOne(w: World, index: number): InvItem | null {
  const it = w.player.items[index];
  if (!it) return null;
  it.count--;
  if (it.count <= 0) w.player.items.splice(index, 1);
  return it;
}

/** 從背包排入一個動作（介面呼叫；世界恢復後的第一幀開始）。 */
export function queueUse(w: World, index: number, mode: 'use' | 'throw'): void {
  const it = w.player.items[index];
  if (!it) return;
  if (mode === 'throw' && categoryOf(it.id) !== 'potion') return;
  w.player.pendingUse = { index, mode };
}

/** 行動開始時從背包拿出來（避免排隊期間背包變動）。 */
export function takeForAction(w: World, index: number): ItemId | null {
  const it = takeOne(w, index);
  return it ? it.id : null;
}

// ---------- 藥水 ----------

export function drinkPotion(w: World, id: PotionId): void {
  const p = w.player;
  w.stats.itemsUsed++;
  identify(w, `potion:${id}`);
  switch (id) {
    case 'invisibility':
      p.invisT = ITEM_FX.invisibility;
      w.emit({ type: 'buff', kind: 'invisibility', text: `隱形 ${ITEM_FX.invisibility} 秒` });
      return;
    case 'haste':
      p.hasteT = ITEM_FX.haste.duration;
      w.emit({ type: 'buff', kind: 'haste', text: `迅捷 ${ITEM_FX.haste.duration} 秒` });
      return;
    default:
      // 有害的藥水喝下去：在自己腳下碎開
      spawnArea(w, id, p.x, p.z);
  }
}

/** 丟出的藥水碎開（落地、撞到東西，或在空中被射爆）。 */
export function shatterPotion(w: World, id: PotionId, x: number, y: number, z: number): void {
  w.emit({ type: 'shatter', kind: id, x, y, z });
  w.emitNoise(x, y, z, 6, 'bottle');
  if (id === 'invisibility' || id === 'haste') return;
  identify(w, `potion:${id}`);
  spawnArea(w, id, x, z);
}

function spawnArea(w: World, kind: Area['kind'], x: number, z: number): void {
  const spec = ITEM_FX.area[kind];
  w.areas.push({ id: w.nextId++, kind, x, z, radius: spec.radius, age: 0, life: spec.life, tickT: 0, hitPlayer: false });
  w.emit({ type: 'area', kind, x, y: 0.1, z, radius: spec.radius });
}

export function inArea(w: World, kind: Area['kind'], x: number, z: number, pad = 0): boolean {
  return w.areas.some((a) => a.kind === kind && Math.hypot(a.x - x, a.z - z) <= a.radius + pad);
}

/** 區域效果（世界時間）。 */
export function updateAreas(w: World, dt: number, damageEnemy: (e: Enemy, dmg: number, src: string) => void): void {
  const p = w.player;
  for (const a of w.areas) {
    a.age += dt;
    const inside = (x: number, z: number, r: number) => Math.hypot(a.x - x, a.z - z) <= a.radius + r * 0.5;
    if (a.kind === 'fire') {
      a.tickT += dt;
      if (a.tickT >= ITEM_FX.area.fire.tick) {
        a.tickT -= ITEM_FX.area.fire.tick;
        for (const e of w.enemies) if (e.alive && !e.perched && inside(e.x, e.z, e.radius)) damageEnemy(e, ITEM_FX.area.fire.damage, 'fire');
        if (!p.dead && inside(p.x, p.z, PLAYER.radius)) w.damagePlayer(ITEM_FX.area.fire.damage, '火焰', a.x, a.z);
      }
    } else if (a.kind === 'frost') {
      for (const e of w.enemies) if (e.alive && inside(e.x, e.z, e.radius)) e.slowT = Math.max(e.slowT, ITEM_FX.area.frost.slow);
    } else {
      for (const e of w.enemies) if (e.alive && inside(e.x, e.z, e.radius)) e.paralyzeT = Math.max(e.paralyzeT, ITEM_FX.area.gas.paralyze);
      if (!a.hitPlayer && !p.dead && inside(p.x, p.z, PLAYER.radius)) {
        a.hitPlayer = true;
        stunPlayer(w, ITEM_FX.area.gas.playerStun);
      }
    }
  }
  for (let k = w.areas.length - 1; k >= 0; k--) if (w.areas[k]!.age >= w.areas[k]!.life) w.areas.splice(k, 1);
}

/** 玩家被麻痺：取消目前的行動，改成一段不能動的「行動」（世界照常以正常速度前進）。 */
export function stunPlayer(w: World, dur: number): void {
  const p = w.player;
  p.action = {
    kind: 'stunned',
    windup: 0,
    active: 0,
    recovery: dur,
    t: 0,
    fired: true,
    lockedYaw: p.yaw,
    hitSet: new Set(),
    targetId: -1,
    counter: false,
    countered: false,
    tip: null,
    weapon: p.weapon.id,
    item: null,
  };
  w.emit({ type: 'buff', kind: 'stunned', text: '你被麻痺了' });
}

// ---------- 卷軸 ----------

export function readScroll(w: World, id: ScrollId | 'upgrade'): void {
  w.stats.itemsUsed++;
  const p = w.player;
  if (id !== 'upgrade') identify(w, `scroll:${id}`);
  w.emit({ type: 'read', kind: id });
  switch (id) {
    case 'upgrade':
      queueChoice(w, { kind: 'upgrade', options: upgradeTargets(w) });
      return;
    case 'teleport':
      teleport(w);
      return;
    case 'mapping':
      w.explored.fill(1);
      w.mapped = true;
      return;
    case 'timeStop':
      for (const e of w.enemies) if (e.alive) e.paralyzeT = Math.max(e.paralyzeT, ITEM_FX.timeStop);
      return;
    case 'lure': {
      const eye = { x: p.x, y: AIM_EYE_Y, z: p.z };
      const at = aimPoint(w, eye, dirFromYawPitch(p.yaw, p.pitch));
      w.emitNoise(at.x, Math.min(at.y, 1.5), at.z, ITEM_FX.lureRadius, 'lure');
      return;
    }
  }
}

function teleport(w: World): void {
  const p = w.player;
  const nav = new Nav(w.grid, PLAYER.radius);
  const seen = nav.flood(w.level.spawn.x, w.level.spawn.z, false);
  const cands: Array<{ x: number; z: number; d: number }> = [];
  for (let c = 0; c < seen.length; c++) {
    if (!seen[c]) continue;
    const q = nav.center(c);
    if (w.grid.circleBlocked(q.x, q.z, PLAYER.radius + 0.05)) continue;
    let d = Infinity;
    for (const e of w.enemies) if (e.alive) d = Math.min(d, Math.hypot(e.x - q.x, e.z - q.z));
    if (Math.hypot(q.x - p.x, q.z - p.z) < 6) continue;
    cands.push({ x: q.x, z: q.z, d });
  }
  if (!cands.length) return;
  const far = cands.filter((c) => c.d >= ITEM_FX.teleportMinDist);
  const pool = far.length ? far : cands.sort((a, b) => b.d - a.d).slice(0, 20);
  const t = pool[w.rng.int(0, pool.length - 1)]!;
  p.x = t.x;
  p.z = t.z;
  p.vx = 0;
  p.vz = 0;
  // 追你的敵人失去目標
  for (const e of w.enemies) if (e.alive && e.state === 'alert') e.seesPlayer = false;
  w.reveal();
}

// ---------- 裝備與強化 ----------

/** 換上背包裡的裝備；換下來的放回同一格。 */
export function equipFromBag(w: World, id: ItemId, level: number): void {
  const p = w.player;
  const c = categoryOf(id);
  if (c === 'weapon') {
    const old = p.weapon;
    p.weapon = { id: keyOf(id) as typeof p.weapon.id, level };
    addItem(w, `weapon:${old.id}`, old.level);
  } else if (c === 'armor') {
    const old = p.armor;
    p.armor = { id: keyOf(id) as typeof p.armor.id, level };
    if (old.id !== 'cloth') addItem(w, `armor:${old.id}`, old.level);
  }
  w.emit({ type: 'equip', kind: id, text: `裝備：${itemName(w, id, level)}` });
}

export function upgradeTargets(w: World): UpgradeTarget[] {
  const p = w.player;
  const out: UpgradeTarget[] = [];
  if (p.weapon.level < UPGRADE.maxLevel) out.push('weapon');
  if (p.armor.id !== 'cloth' && p.armor.level < UPGRADE.maxLevel) out.push('armor');
  if (p.cls === 'huntress' && p.bowLevel < UPGRADE.maxLevel) out.push('bow');
  if (p.cls === 'warrior' && p.shieldLevel < UPGRADE.maxLevel) out.push('shield');
  return out;
}

export function upgradeLabel(w: World, t: UpgradeTarget): { name: string; text: string } {
  const p = w.player;
  switch (t) {
    case 'weapon': {
      const s = WEAPONS[p.weapon.id];
      return { name: `${s.name} +${p.weapon.level} → +${p.weapon.level + 1}`, text: `傷害 ${s.damage + s.perLevel * p.weapon.level} → ${s.damage + s.perLevel * (p.weapon.level + 1)}` };
    }
    case 'armor':
      return { name: `${ARMORS[p.armor.id].name} +${p.armor.level} → +${p.armor.level + 1}`, text: `每次受傷多減 ${UPGRADE.armorPerLevel}（總減傷最多 ${UPGRADE.armorMaxReduce}）` };
    case 'bow':
      return { name: `獵弓 +${p.bowLevel} → +${p.bowLevel + 1}`, text: `身體 +${UPGRADE.bowBody}、頭部 +${UPGRADE.bowHead} 傷害` };
    case 'shield':
      return { name: `臂盾 +${p.shieldLevel} → +${p.shieldLevel + 1}`, text: `盾推多推 ${UPGRADE.shieldPush} m、格擋時間 +${UPGRADE.shieldActive} 秒` };
  }
}

export function applyUpgrade(w: World, t: UpgradeTarget): void {
  const p = w.player;
  const label = upgradeLabel(w, t).name;
  if (t === 'weapon') p.weapon.level++;
  else if (t === 'armor') p.armor.level++;
  else if (t === 'bow') p.bowLevel++;
  else p.shieldLevel++;
  w.emit({ type: 'equip', kind: t, text: `強化：${label}` });
}

// ---------- 掉落 ----------

/** 敵人倒下：一定機率掉東西（老兵一定掉，而且可能是裝備）。 */
export function dropLoot(w: World, e: Enemy): void {
  if (!e.veteran && !w.rng.chance(ITEM_FX.dropChance)) return;
  const roll = e.veteran ? rollItem(w.rng, w.level.floor) : rollConsumable(w.rng);
  w.addPickup('item', 1, e.x + 0.3, 0.15, e.z + 0.3, null, roll.id, roll.level);
}

/** 隱形、迅捷、連擊、狙擊標記的倒數（世界時間）。 */
export function updateBuffs(w: World, dt: number): void {
  const p = w.player;
  p.invisT = Math.max(0, p.invisT - dt);
  p.hasteT = Math.max(0, p.hasteT - dt);
  p.comboT = Math.max(0, p.comboT - dt);
  p.markT = Math.max(0, p.markT - dt);
}

/** 潛行步的速度與時間倍率（輕步天賦）。 */
export function lightstep(w: World): { speed: number; time: number } {
  return hasTalent(w.player, 'lightstep') ? { speed: TALENT_FX.lightstepSpeed, time: TALENT_FX.lightstepTime } : { speed: 1, time: 0 };
}

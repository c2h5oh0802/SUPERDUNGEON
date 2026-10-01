import {
  ALL_POTIONS,
  ALL_SCROLLS,
  ARMORS,
  ITEM_FX,
  HUNGER,
  HEALING_POTION,
  PLAYER,
  POTIONS,
  POTION_LOOKS,
  SCROLLS,
  SCROLL_LOOKS,
  TALENT_FX,
  TIP_NAMES,
  UPGRADE,
  WEAPONS,
  type ItemId,
  type PotionId,
  type ScrollId,
  type TipKind,
} from '../config';
import { lullEnemy } from './enemySys';
import { Rng } from '../core/rng';
import { rollConsumable, rollItem } from '../gen/loot';
import { Nav } from './nav';
import { hasTalent, maxTipped, queueChoice } from './progress';
import type { Area, Enemy, InvItem, PendingUse, UpgradeTarget } from './types';
import type { World } from './world';

// 物品：未鑑定的藥水與卷軸（每一局外觀不同）、背包、喝／讀／丟／裝備，以及效果。

export type ItemCategory = 'food' | 'potion' | 'scroll' | 'weapon' | 'armor';

export const categoryOf = (id: ItemId): ItemCategory => id.split(':')[0] as ItemCategory;
const keyOf = (id: ItemId): string => id.split(':')[1]!;

// ---------- 外觀與鑑定 ----------

interface Looks {
  potion: Record<PotionId, number>;
  scroll: Record<ScrollId, number>;
}

const looksCache = new Map<string, Looks>();

/** 這一局（種子）的外觀對應：同一個種子永遠一樣，所以跨層、續玩都一致。 */
export function looksFor(seed: string, version: 1 | 2 = 2): Looks {
  const cacheKey = `${seed}#${version}`;
  let l = looksCache.get(cacheKey);
  if (l) return l;
  const rng = new Rng(`${seed}#looks`);
  // Preserve old scroll glyph RNG independently of the added sixth potion.
  const legacy = rng.shuffle([0, 1, 2, 3, 4]);
  const pi = version === 1 ? [...legacy, 5] : new Rng(`${seed}#potion-looks-v2`).shuffle(ALL_POTIONS.map((_, k) => k));
  // Preserve v2 glyph assignments: old timeStop slot becomes Sleep; slot 3 is retired.
  const si = rng.shuffle([0, 1, 2, 3]);
  l = {
    potion: Object.fromEntries(ALL_POTIONS.map((id, k) => [id, pi[k]!])) as Record<PotionId, number>,
    scroll: Object.fromEntries(ALL_SCROLLS.map((id, k) => [id, si[k]!])) as Record<ScrollId, number>,
  };
  looksCache.set(cacheKey, l);
  return l;
}

export function isKnown(w: World, id: ItemId): boolean {
  const c = categoryOf(id);
  if (c === 'food' || c === 'weapon' || c === 'armor' || id === 'scroll:upgrade') return true;
  return w.player.known.includes(id);
}

function lookName(w: World, id: ItemId): string {
  const looks = looksFor(w.level.seed, w.level.potionLooksVersion);
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
  if (c === 'food') return '乾糧';
  if (c === 'weapon') return `${WEAPONS[keyOf(id) as keyof typeof WEAPONS].name}${lv}`;
  if (c === 'armor') return `${ARMORS[keyOf(id) as keyof typeof ARMORS].name}${lv}`;
  if (!isKnown(w, id)) return lookName(w, id);
  if (c === 'potion') return POTIONS[keyOf(id) as PotionId].name;
  return SCROLLS[keyOf(id) as ScrollId | 'upgrade'].name;
}

export function itemDesc(w: World, id: ItemId): string {
  const c = categoryOf(id);
  const k = keyOf(id);
  if (c === 'food') return `吃下：減少 ${HUNGER.foodRestore} 世界秒的飢餓。吃完才生效；正常行動要花時間，已飽食時保留。`;
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
export function itemColor(seed: string, id: ItemId, version: 1 | 2 = 2): number {
  const c = categoryOf(id);
  if (c === 'potion') return POTION_LOOKS[looksFor(seed, version).potion[keyOf(id) as PotionId]]!.color;
  if (c === 'scroll') return id === 'scroll:upgrade' ? 0xf2c14e : 0xe8dcc0;
  if (c === 'food') return 0xc59a5c;
  if (c === 'armor') return 0x9aa4b0;
  return 0xc3cad4;
}

// ---------- 背包 ----------

/** 放進背包；滿了回傳 false。 */
export function addItem(w: World, id: ItemId, level = 0): boolean {
  const items = w.player.items;
  const c = categoryOf(id);
  if (c === 'food' || c === 'potion' || c === 'scroll') {
    const limit = c === 'food' ? HUNGER.foodStackMax : 99;
    const s = items.find((it) => it.id === id && it.count < limit);
    if (s) { s.count++; return true; }
    // Keep the single ration-stack contract; migrated consumables may retain
    // multiple <=99 stacks rather than invalidating the next boundary save.
    if (c === 'food' && items.some((it) => it.id === id)) return false;
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
export function queueUse(w: World, index: number, mode: PendingUse['mode']): void {
  const it = w.player.items[index];
  if (!it) return;
  if (mode === 'throw' && categoryOf(it.id) !== 'potion') return;
  if (mode === 'convert') {
    const reason = conversionReason(w, it.id);
    if (reason) {
      w.emit({ type: 'fullInventory', text: reason });
      return;
    }
  }
  w.player.pendingUse = { index, mode };
}

/** 行動開始時從背包拿出來（避免排隊期間背包變動）。 */
export function knownHealingCount(w: World): number {
  return isKnown(w, 'potion:healing') ? w.player.items.filter((it) => it.id === 'potion:healing').reduce((n, it) => n + it.count, 0) : 0;
}

export function takeForAction(w: World, index: number, mode: PendingUse['mode'] = 'use'): ItemId | null {
  if (mode === 'convert') {
    const id = w.player.items[index]?.id;
    if (!id) return null;
    const reason = conversionReason(w, id);
    if (reason) {
      w.emit({ type: 'fullInventory', text: reason });
      return null;
    }
  }
  if (mode === 'use' && w.player.items[index]?.id === 'potion:healing' && isKnown(w, 'potion:healing') && w.player.hp >= w.player.maxHp) {
    w.emit({ type: 'fullInventory', text: '生命已滿，治療藥水已保留' });
    return null;
  }
  if (w.player.items[index]?.id === 'food:ration' && w.player.hunger <= 0) {
    w.emit({ type: 'fullInventory', text: '已經飽食，乾糧已保留' });
    return null;
  }
  if (w.player.items[index]?.id === 'scroll:upgrade' && upgradeTargets(w).length === 0) {
    w.emit({ type: 'fullInventory', text: '目前沒有可強化的裝備，卷軸已保留' });
    return null;
  }
  const it = takeOne(w, index);
  return it ? it.id : null;
}

// ---------- 藥水 ----------

/** Eligibility deliberately checks knowledge before exposing any recipe/type. */
export function conversionKind(w: World, id: ItemId): TipKind | null {
  if (w.player.cls !== 'huntress' || !hasTalent(w.player, 'apothecary') || !isKnown(w, id)) return null;
  if (id === 'potion:frost') return 'chill';
  if (id === 'potion:gas') return 'paralysis';
  return null;
}

/** Null means the whole batch fits. Never consume a bottle for partial yield. */
export function conversionReason(w: World, id: ItemId): string | null {
  const kind = conversionKind(w, id);
  if (!kind) return '無法轉化這項物品，物品已保留';
  const count = w.player.tipped[kind], cap = maxTipped(w.player);
  return cap - count >= TALENT_FX.apothecaryYield ? null
    : `${TIP_NAMES[kind]}空間不足（目前 ${count} / ${cap}，需要 ${TALENT_FX.apothecaryYield} 格空間），藥水已保留`;
}

/** The normal action owns the reserved bottle. Interruptions have no refund.
 * Tipped stock cannot grow during this committed action: ordinary pickups only
 * grant normal arrows, while resupply is a separate, non-overlapping action. */
export function completeConversion(w: World, id: ItemId): void {
  const kind = conversionKind(w, id);
  if (!kind) return;
  w.player.tipped[kind] += TALENT_FX.apothecaryYield;
  w.stats.itemsUsed++;
  w.emit({ type: 'buff', kind: 'apothecary', text: `轉化完成：${TIP_NAMES[kind]} +${TALENT_FX.apothecaryYield}（${w.player.tipped[kind]} / ${maxTipped(w.player)}）` });
}

export function drinkPotion(w: World, id: PotionId): void {
  const p = w.player;
  w.stats.itemsUsed++;
  identify(w, `potion:${id}`);
  switch (id) {
    case 'healing': {
      const amount = Math.ceil(p.maxHp * HEALING_POTION.fraction);
      const restored = Math.min(amount, p.maxHp - p.hp);
      p.hp += restored;
      w.stats.potionsUsed++;
      w.stats.healingUsed++;
      w.stats.healingRestored += restored;
      w.stats.healingWasted += amount - restored;
      w.emit({ type: 'buff', kind: 'healing', text: `回復 ${restored} 生命` });
      return;
    }
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
  identify(w, `potion:${id}`);
  if (id === 'invisibility' || id === 'haste' || id === 'healing') return;
  spawnArea(w, id, x, z);
}

function spawnArea(w: World, kind: Area['kind'], x: number, z: number): void {
  const spec = ITEM_FX.area[kind];
  if (kind === 'frost') {
    // Local overlap only. No global fire physics or terrain/prop destruction.
    for (let k = w.areas.length - 1; k >= 0; k--) {
      const a = w.areas[k]!;
      if (a.kind === 'fire' && Math.hypot(a.x - x, a.z - z) <= a.radius + spec.radius) w.areas.splice(k, 1);
    }
  }
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
  if (id === 'upgrade' && upgradeTargets(w).length === 0) return;
  w.stats.itemsUsed++;
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
    case 'sleep':
      for (const e of w.enemies) if (Math.hypot(e.x - w.player.x, e.z - w.player.z) <= ITEM_FX.sleepRadius) lullEnemy(e);
      return;
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

/** Return outgoing gear to the bag, or leave a recoverable physical item.
 * A migrated over-cap healing stack (or a pickup during equip windup) can occupy
 * the slot reserved by taking the incoming gear. Never silently erase old gear. */
function returnEquipment(w: World, id: ItemId, level: number): void {
  if (addItem(w, id, level)) return;
  w.addPickup('item', 1, w.player.x, 0.15, w.player.z, null, id, level);
  w.emit({ type: 'fullInventory', text: '背包滿了，換下的裝備留在腳邊' });
}

/** 換上背包裡的裝備；換下來的回背包或安全留在腳邊。 */
export function equipFromBag(w: World, id: ItemId, level: number): void {
  const p = w.player;
  const c = categoryOf(id);
  if (c === 'weapon') {
    const old = p.weapon;
    p.weapon = { id: keyOf(id) as typeof p.weapon.id, level };
    returnEquipment(w, `weapon:${old.id}`, old.level);
  } else if (c === 'armor') {
    const old = p.armor;
    p.armor = { id: keyOf(id) as typeof p.armor.id, level };
    if (old.id !== 'cloth') returnEquipment(w, `armor:${old.id}`, old.level);
  }
  w.emit({ type: 'equip', kind: id, text: `裝備：${itemName(w, id, level)}` });
}

export function upgradeTargets(w: World): UpgradeTarget[] {
  const p = w.player;
  const out: UpgradeTarget[] = [];
  if (p.weapon.level < UPGRADE.maxLevel) out.push('weapon');
  if (p.armor.id !== 'cloth' && p.armor.level < UPGRADE.maxLevel) out.push('armor');
  if (p.cls === 'huntress' && p.bowLevel < UPGRADE.maxLevel) out.push('bow');
  // Historical shieldLevel remains in saves, but shield upgrades are no longer offered.
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
  if (t === 'shield') return; // Disabled legacy target: never consume a new investment.
  const p = w.player;
  const label = upgradeLabel(w, t).name;
  if (t === 'weapon') p.weapon.level++;
  else if (t === 'armor') p.armor.level++;
  else if (t === 'bow') p.bowLevel++;

  w.emit({ type: 'equip', kind: t, text: `強化：${label}` });
}

// ---------- 掉落 ----------

/** 敵人倒下：一定機率掉東西（老兵一定掉，而且可能是裝備）。 */
export function dropLoot(w: World, e: Enemy): void {
  if (w.level.encounter) return;
  if (!e.veteran && !w.rng.chance(ITEM_FX.dropChance)) return;
  const roll = e.veteran ? rollItem(w.rng, w.level.floor, 'enemy') : rollConsumable(w.rng, 'enemy');
  w.addPickup('item', 1, e.x + 0.3, 0.15, e.z + 0.3, null, roll.id, roll.level);
}

/** 隱形、迅捷、連擊的倒數（世界時間）。 */
export function updateBuffs(w: World, dt: number): void {
  const p = w.player;
  p.invisT = Math.max(0, p.invisT - dt);
  p.hasteT = Math.max(0, p.hasteT - dt);
  p.comboT = Math.max(0, p.comboT - dt);
}

/** 潛行步的速度與時間倍率（輕步天賦）。 */
export function lightstep(w: World): { speed: number; time: number } {
  return hasTalent(w.player, 'lightstep') ? { speed: TALENT_FX.lightstepSpeed, time: TALENT_FX.lightstepTime } : { speed: 1, time: 0 };
}

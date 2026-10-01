import { armorReduction, armorUpgradeLimit, bowDamage, weaponDamage } from './equipment';
import { observesPoint } from './observation';
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
import type { Area, Enemy, InvItem, PendingChoice, PendingUse, UpgradeTarget } from './types';
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

export function itemDesc(w: World, id: ItemId, level = 0): string {
  const c = categoryOf(id);
  const k = keyOf(id);
  if (c === 'food') return `吃下：減少 ${HUNGER.foodRestore} 世界秒的飢餓。吃完才生效；正常行動要花時間，已飽食時保留。`;
  if (c === 'weapon') {
    const s = WEAPONS[k as keyof typeof WEAPONS];
    return `${weaponDamage(k as keyof typeof WEAPONS, level)} 基礎傷害（每級 +${s.perLevel}）、${Math.round((s.windup + s.active + s.recovery) * 100) / 100} 秒、範圍 ${s.reach} m、背刺 ×${s.sneakMultiplier}；${s.note}`;
  }
  if (c === 'armor') {
    const id = k as keyof typeof ARMORS;
    return `每次減傷 ${armorReduction(id, level)}（至少受 1；減傷上限 ${UPGRADE.armorMaxReduce}）；${ARMORS[id].stepMul > 1 ? '腳步聲較大、潛行步較慢' : '不增加腳步聲、不降低潛行步速'}`;
  }
  if (!isKnown(w, id)) return c === 'potion' ? '未知的藥水：喝下可試出效果；投擲只有親眼看到明顯效果才會辨識，單純碎瓶不會。' : '未知的卷軸：讀了才知道效果。';
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
  w.player.pendingUse = { index, mode, stack: it };
}

/** Atomically place an intact bag item at the player's feet. The drop action
 * owns the recovery time, but no item is held in limbo if it is interrupted. */
export function dropFromBag(w: World, index: number, all: boolean): boolean {
  const it = w.player.items[index];
  if (!it || w.player.dead) return false;
  const count = all ? it.count : 1;
  const pickup = w.addPickup('item', count, w.player.x, 0.15, w.player.z, null, it.id, it.level);
  pickup.pickupBlockedUntilExit = true;
  pickup.playerDropped = true;
  it.count -= count;
  if (it.count === 0) w.player.items.splice(index, 1);
  w.emit({ type: 'dropItem', kind: it.id, amount: count,
    text: `放下 ${itemName(w, it.id, it.level)}${count > 1 ? ` ×${count}` : ''}；走開再靠近可撿回` });
  return true;
}

/** 行動開始時從背包拿出來（避免排隊期間背包變動）。 */
export function knownHealingCount(w: World): number {
  return isKnown(w, 'potion:healing') ? w.player.items.filter((it) => it.id === 'potion:healing').reduce((n, it) => n + it.count, 0) : 0;
}

export function takeForAction(w: World, index: number, mode: PendingUse['mode'] = 'use'): ItemId | null {
  // Intact drops have their own atomic transfer; they must never consume/use a bottle.
  if (mode === 'drop' || mode === 'dropAll') return null;
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
  const observed = observesPoint(w, { x, y, z });
  const harmless = id === 'invisibility' || id === 'haste' || id === 'healing';
  // Generic glass has no subtype cue. Known bottles keep their inventory names.
  w.emit({ type: 'shatter', x, y, z, text: observed && harmless ? '藥水碎了，沒有明顯效果' : undefined });
  w.emitNoise(x, y, z, 6, 'bottle');
  if (harmless) return;
  // Colored area/burst is grounded even when a bottle is airburst high above it.
  if (observesPoint(w, { x, y: .4, z })) identify(w, `potion:${id}`);
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

export function readScroll(w: World, id: ScrollId | 'upgrade', reservedScroll = false): void {
  if (id === 'upgrade' && upgradeTargets(w).length === 0) {
    if (reservedScroll) returnUpgradeScroll(w);
    return;
  }
  w.stats.itemsUsed++;
  if (id !== 'upgrade') identify(w, `scroll:${id}`);
  w.emit({ type: 'read', kind: id });
  switch (id) {
    case 'upgrade':
      queueChoice(w, { kind: 'upgrade', options: upgradeTargets(w), reservedScroll });
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

/** Only a real positive benefit below the global level cap can be purchased. */
export function upgradeTargets(w: World): UpgradeTarget[] {
  const p = w.player;
  const out: UpgradeTarget[] = [];
  if (p.weapon.level < UPGRADE.maxLevel && weaponDamage(p.weapon.id, p.weapon.level + 1) > weaponDamage(p.weapon.id, p.weapon.level)) out.push('weapon');
  if (p.armor.level < UPGRADE.maxLevel && armorReduction(p.armor.id, p.armor.level + 1) > armorReduction(p.armor.id, p.armor.level)) out.push('armor');
  if (p.cls === 'huntress' && p.bowLevel < UPGRADE.maxLevel && (bowDamage(p.bowLevel + 1, false) > bowDamage(p.bowLevel, false) || bowDamage(p.bowLevel + 1, true) > bowDamage(p.bowLevel, true))) out.push('bow');
  // Historical shieldLevel remains in saves, but shield upgrades are no longer offered.
  return out;
}

export function upgradeLabel(w: World, t: UpgradeTarget): { name: string; text: string } {
  const p = w.player;
  const allowed = upgradeTargets(w).includes(t);
  const name = (title: string, level: number) => `${title} +${level}${allowed ? ` → +${level + 1}` : '（無可用強化）'}`;
  const cap = `上限 +${UPGRADE.maxLevel}`;
  switch (t) {
    case 'weapon': {
      const s = WEAPONS[p.weapon.id];
      const before = weaponDamage(p.weapon.id, p.weapon.level), after = weaponDamage(p.weapon.id, p.weapon.level + 1);
      let text = allowed ? `基礎傷害 ${before} → ${after}` : `基礎傷害 ${before}；已達強化上限`;
      if (allowed && s.sneakMultiplier > 1) text += `；奇襲 ${before * s.sneakMultiplier} → ${after * s.sneakMultiplier}`;
      if (allowed && s.maxTargets > 1) text += `；次敵 ${before * s.secondaryDamage} → ${after * s.secondaryDamage}`;
      return { name: name(s.name, p.weapon.level), text: `${text}。${cap}；射程、出手時間與移速承諾不變。` };
    }
    case 'armor': {
      const a = p.armor, before = armorReduction(a.id, a.level), after = armorReduction(a.id, a.level + 1);
      const text = allowed ? `每次減傷 ${before} → ${after}` : `每次減傷 ${before}；${a.id === 'cloth' ? '布衣不能強化' : '減傷已封頂'}`;
      return { name: name(ARMORS[a.id].name, a.level), text: `${text}（至少受 1）。減傷上限 ${UPGRADE.armorMaxReduce}${a.id === 'cloth' ? '' : `，本件 +${armorUpgradeLimit(a.id)} 封頂`}；腳步聲與潛行速度不變。` };
    }
    case 'bow': {
      const before = p.bowLevel, after = before + 1;
      const text = allowed ? `基礎身體傷害 ${bowDamage(before, false)} → ${bowDamage(after, false)}；頭部 ${bowDamage(before, true)} → ${bowDamage(after, true)}`
        : `基礎身體傷害 ${bowDamage(before, false)}、頭部 ${bowDamage(before, true)}；${p.cls === 'huntress' ? '已達強化上限' : '此職業無獵弓強化'}`;
      return { name: name('獵弓', before), text: `${text}。${cap}；拉弓時間、箭速與藥劑效果不變。` };
    }
    case 'shield':
      return { name: '臂盾（舊版強化停用）', text: '舊版等級保留，不能投入強化卷軸。' };
  }
}

export function applyUpgrade(w: World, t: UpgradeTarget): boolean {
  if (!upgradeTargets(w).includes(t)) return false;
  const p = w.player;
  const label = upgradeLabel(w, t).name;
  if (t === 'weapon') p.weapon.level++;
  else if (t === 'armor') p.armor.level++;
  else if (t === 'bow') p.bowLevel++;
  w.emit({ type: 'equip', kind: t, text: `強化：${label}` });
  return true;
}

/** Reservation normally stays spent once reading starts, including interruption.
 * Only a completed scroll with no useful choice is returned, never old upgrades. */
function returnUpgradeScroll(w: World): void {
  const returned = addItem(w, 'scroll:upgrade');
  if (!returned) w.addPickup('item', 1, w.player.x, 0.15, w.player.z, null, 'scroll:upgrade', 0);
  w.emit({ type: 'fullInventory', text: returned ? '目前沒有可強化的裝備，卷軸已保留' : '目前沒有可強化的裝備；背包滿了，卷軸留在腳邊' });
}

/** Refresh a delayed or stale offer without silently applying a different target. */
export function refreshUpgradeChoice(w: World, choice: Extract<PendingChoice, { kind: 'upgrade' }>): boolean {
  choice.options = upgradeTargets(w);
  if (choice.options.length) return true;
  if (choice.reservedScroll) {
    choice.reservedScroll = false; // at most one return, even if called again
    returnUpgradeScroll(w);
    w.stats.itemsUsed = Math.max(0, w.stats.itemsUsed - 1);
  }
  return false;
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

import { CLASSES, PLAYER, TALENT_FX, TALENT_POOLS, TALENTS, XP, type TalentId } from '../config';
import { Rng } from '../core/rng';
import type { Enemy, PendingChoice, Player } from './types';
import type { World } from './world';

// 經驗、等級、天賦，以及需要玩家選擇的畫面（天賦、強化）。

export const hasTalent = (p: Player, t: TalentId): boolean => p.talents.includes(t);

export function maxStones(p: Player): number {
  return PLAYER.maxStones + (hasTalent(p, 'slinger') ? TALENT_FX.slingerStones : 0);
}

export function maxTipped(p: Player): number {
  return PLAYER.maxTipped + (hasTalent(p, 'apothecary') ? TALENT_FX.apothecaryExtra : 0);
}

/** 這個經驗值對應的等級（1 起算）。 */
export function levelForXp(xp: number): number {
  let lv = 1;
  while (lv < XP.levels.length && xp >= XP.levels[lv]!) lv++;
  return lv;
}

/** 下一級需要的經驗（已滿級回傳 null）。 */
export function nextLevelXp(level: number): number | null {
  return level < XP.levels.length ? XP.levels[level]! : null;
}

export function killXp(e: Enemy): number {
  return XP.kill[e.kind] * (e.veteran ? XP.veteranMul : 1);
}

export function queueChoice(w: World, c: PendingChoice): void {
  if (!w.pendingChoice) w.pendingChoice = c;
  else w.choiceQueue.push(c);
}

export function gainXp(w: World, n: number): void {
  const p = w.player;
  p.xp += n;
  while (p.level < XP.levels.length && p.xp >= XP.levels[p.level]!) {
    p.level++;
    p.maxHp += XP.hpPerLevel;
    p.hp += XP.hpPerLevel;
    w.emit({ type: 'levelUp', amount: p.level });
    if (p.level % XP.talentEvery === 0) offerTalents(w, p.level);
  }
}

/** 從職業天賦池挑兩個還沒選過的（同種子、同等級固定）。 */
export function talentOptions(seed: string, p: Player, level: number): TalentId[] {
  const pool = TALENT_POOLS[p.cls].filter((t) => !p.talents.includes(t));
  return new Rng(`${seed}#talent#${level}`).shuffle(pool.slice()).slice(0, 2);
}

function offerTalents(w: World, level: number): void {
  const options = talentOptions(w.level.seed, w.player, level);
  if (options.length) queueChoice(w, { kind: 'talent', options });
}

export function applyTalent(w: World, t: TalentId): void {
  const p = w.player;
  if (p.talents.includes(t)) return;
  p.talents.push(t);
  if (t === 'toughness') {
    p.maxHp += TALENT_FX.toughnessHp;
    p.hp = Math.min(p.maxHp, p.hp + TALENT_FX.toughnessHp);
  }
  w.emit({ type: 'buff', kind: t, text: `天賦：${TALENTS[t].name}` });
}

/** 每層開始（從上一層帶下來時）套用的天賦效果。 */
export function onFloorStart(w: World): void {
  const p = w.player;
  if (hasTalent(p, 'apothecary') && w.level.floor > 1) {
    p.tipped.paralysis = Math.min(maxTipped(p), p.tipped.paralysis + 1);
    p.tipped.chill = Math.min(maxTipped(p), p.tipped.chill + 1);
  }
}

export const startWeapon = (p: Player) => CLASSES[p.cls].weapon;

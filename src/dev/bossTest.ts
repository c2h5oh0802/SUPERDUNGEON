import { ARMORS, TALENTS, WEAPONS, XP, type PlayerClass } from '../config';
import { addItem, applyUpgrade, identify } from '../sim/items';
import { createTrialWorld } from '../sim/practiceTrials';
import { gainXp } from '../sim/progress';
import type { World } from '../sim/world';

export const BOSS_TEST_SEED = 'TRIAL-WARDEN';
export const BOSS_TEST_PRESETS = {
  starting: '職業初始裝備',
  split: 'Lv5・四張強化測試配裝',
} as const;
export type BossTestPreset = keyof typeof BOSS_TEST_PRESETS;

/** Disposable fixture only: actual floor-five arena/AI, never a campaign carry.
 * Split is a controlled comparison, not an estimate of a typical player run.
 * No talents isolates gear/HP; four scrolls go to offense +2 and leather +2.
 * Healing knowledge/stock is explicitly part of that fixture, never a refill.
 */
export function createBossTestWorld(cls: PlayerClass, preset: BossTestPreset): World {
  const w = createTrialWorld('heart-warden', cls);
  if (preset === 'split') {
    gainXp(w, XP.levels[4]);
    w.pendingChoice = null;
    w.choiceQueue.length = 0;
    w.player.armor = { id: 'leather', level: 0 };
    for (let i = 0; i < 2; i++) {
      applyUpgrade(w, 'armor');
      applyUpgrade(w, cls === 'warrior' ? 'weapon' : 'bow');
    }
    identify(w, 'potion:healing');
    addItem(w, 'potion:healing');
    addItem(w, 'potion:healing');
  }
  w.drainEvents();
  return w;
}

/** Derive the visible loadout from the actual fixture, not a second stat table. */
export function bossTestLoadout(w: World): string {
  const p = w.player;
  const weapon = `${WEAPONS[p.weapon.id].name} +${p.weapon.level}`;
  const armor = `${ARMORS[p.armor.id].name} +${p.armor.level}`;
  const ranged = p.cls === 'warrior' ? `投擲石 ×${p.stones}`
    : `獵弓 +${p.bowLevel}／箭 ×${p.arrows}／麻痺箭 ×${p.tipped.paralysis}／冰寒箭 ×${p.tipped.chill}`;
  const healing = p.items.filter(i => i.id === 'potion:healing').reduce((n, i) => n + i.count, 0);
  return `Lv${p.level}・HP ${p.hp}/${p.maxHp}・${weapon}・${armor}\n${ranged}・煙霧 ×${p.bottles}・已知治療 ×${healing}\n天賦：${p.talents.map(t => TALENTS[t].name).join('、') || '無（固定測試條件）'}・飢餓 ${p.hunger}`;
}

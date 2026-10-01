import { HUNGER } from '../config';
import type { World } from './world';

/** One resource, in world seconds. States are derived, never separately saved. */
export type HungerState = 'normal' | 'hungry' | 'starving';
export const HUNGER_NAMES: Record<HungerState, string> = { normal: '正常', hungry: '飢餓', starving: '瀕餓' };

export function hungerState(hunger: number): HungerState {
  return hunger >= HUNGER.starvingAt ? 'starving' : hunger >= HUNGER.hungryAt ? 'hungry' : 'normal';
}

function stateChanged(w: World, before: HungerState): void {
  const after = hungerState(w.player.hunger);
  if (before === after) return;
  const text = after === 'starving'
    ? `瀕餓：每 ${HUNGER.damageEvery} 世界秒損失 1 生命，按 I 吃乾糧`
    : after === 'hungry' ? '感到飢餓：按 I 查看乾糧（目前只有提醒）' : '飢餓解除';
  w.emit({ type: 'hungerState', kind: after, text });
}

/** Called only from World.advance, with each actually executed world substep. */
export function updateHunger(w: World, worldDt: number): void {
  if (!Number.isFinite(worldDt) || worldDt <= 0 || w.player.dead) return;
  const p = w.player;
  const before = hungerState(p.hunger);
  // A substep crossing the boundary pays only its post-boundary fraction.
  const starvingDt = Math.max(0, worldDt - Math.max(0, HUNGER.starvingAt - p.hunger));
  p.hunger = Math.min(HUNGER.starvingAt, p.hunger + worldDt);
  stateChanged(w, before);
  if (hungerState(p.hunger) !== 'starving') {
    p.starvationT = 0;
    return;
  }
  p.starvationT += starvingDt;
  while (p.starvationT >= HUNGER.damageEvery - 1e-9 && !p.dead) {
    p.starvationT = Math.max(0, p.starvationT - HUNGER.damageEvery);
    // Existing damage/death/stat route: 1 HP remains 1 under every armor.
    w.damagePlayer(1, '飢餓', p.x, p.z);
  }
}

/** The ordinary eat action reserves one item at start and restores only at completion. */
export function eatRation(w: World): void {
  const p = w.player;
  const before = hungerState(p.hunger);
  const restored = Math.min(p.hunger, HUNGER.foodRestore);
  p.hunger = Math.max(0, p.hunger - HUNGER.foodRestore);
  p.starvationT = 0;
  w.stats.itemsUsed++;
  w.emit({ type: 'eat', amount: restored, text: '吃下乾糧' });
  stateChanged(w, before);
}

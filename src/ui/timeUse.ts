import type { World } from '../sim/world';

/**
 * How much of the real time the player spent stopped to read (the world at its
 * slow idle rate). With enemies, only the time any of them was hunting counts.
 */
export function timeUseSummary(w: World): string {
  const u = w.timeUse;
  const combat = w.enemies.length > 0;
  const total = combat ? u.combatReal : u.real;
  const still = combat ? u.combatStill : u.still;
  const pct = total > 0 ? Math.round((100 * still) / total) : 0;
  return combat
    ? `戰鬥中停下來看：${pct}%（${still.toFixed(0)} / ${total.toFixed(0)} 秒）`
    : `停下來看：${pct}%（${still.toFixed(0)} / ${total.toFixed(0)} 秒）`;
}

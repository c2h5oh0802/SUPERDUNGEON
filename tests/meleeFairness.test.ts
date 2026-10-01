import { describe, expect, it } from 'vitest';
import { ENEMIES, WEAPONS, type WeaponId } from '../src/config';
import { emptyInput } from '../src/sim/types';
import { kiteWorld } from './spearKiteBots';

/** Ordinary single guard, no warrior counter/gear/status protection. The player
 * commits one attack inside its real reach, then withdraws when the active hit window begins.
 * Only initial setup is injected; movement and attacks use World.frame. */
function strikeAndWithdraw(id: WeaponId, distance: number, dt = 1 / 60) {
  const w = kiteWorld('guard');
  w.player.weapon.id = id;
  w.player.z = w.enemies[0]!.z + distance;
  let started = false;
  let hits = 0;
  for (let k = 0; k < Math.ceil(1.5 / dt) && !w.player.dead; k++) {
    const a = w.player.action;
    const retreat = started && (!a || a.t >= a.windup);
    w.frame(dt, { ...emptyInput(), fire: !started, moveZ: retreat ? -1 : 0, wait: !retreat });
    started = true;
    hits += w.drainEvents().filter(e => e.type === 'hitEnemy' && e.source === 'melee').length;
  }
  return { id, distance, damage: Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0), hits, worldTime: w.time };
}

function readAndFight(id: WeaponId, dt: number, prematureRetreat = false) {
  const w = kiteWorld('guard');
  w.player.weapon.id = id;
  w.player.z = w.enemies[0]!.z + WEAPONS[id].reach;
  let hits = 0, attacks = 0;
  for (let k = 0; k < Math.ceil(30 / dt) && !w.player.dead && w.enemies[0]!.alive; k++) {
    const e = w.enemies[0]!;
    const d = Math.hypot(e.x - w.player.x, e.z - w.player.z);
    const a = w.player.action;
    const threat = e.phase === 'windup' || e.phase === 'active';
    // Honor an already-started windup so it can connect. While idle, read the
    // guard; after our hit window begins, withdraw and recover spacing.
    // The old bot withdrew during its own windup and could make its axe miss.
    const retreat = prematureRetreat ? threat || (a && a.t >= a.windup) : a ? a.t >= a.windup : threat;
    const inReach = d <= WEAPONS[id].reach + e.radius - 0.1;
    const fire = !a && !threat && inReach;
    const moveZ = retreat ? -1 : !a && !inReach ? 1 : 0;
    w.frame(dt, { ...emptyInput(), moveZ, fire, wait: moveZ === 0 });
    for (const event of w.drainEvents()) {
      if (event.type === 'hitEnemy' && event.source === 'melee') hits++;
      if (event.type === 'swing') attacks++;
    }
  }
  return { id, cleared: !w.enemies[0]!.alive, damage: Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0), hits, attacks, worldTime: w.time };
}

describe('melee fairness: hit then withdraw with each ordinary weapon', () => {
  it.each([1 / 30, 1 / 60, 1 / 120])('all weapons connect and can withdraw without damage at frame size %s', dt => {
    const rows = (['knife', 'longsword', 'axe', 'spear'] as WeaponId[]).flatMap(id =>
      [WEAPONS[id].reach, WEAPONS[id].reach + ENEMIES.guard.radius - 0.1].map(d => strikeAndWithdraw(id, d, dt)));
    for (const r of rows) {
      expect(r.hits, `${r.id} at ${r.distance}`).toBe(1);
      expect(r.damage, `${r.id} at ${r.distance}`).toBe(0);
    }
    console.log('MELEE FAIRNESS', JSON.stringify({ dt, rows }));
  });
  it.each([1 / 30, 1 / 60, 1 / 120])('all weapons can finish a normal guard by reading the attack at frame size %s', dt => {
    console.log('ORIGINAL PREMATURE-RETREAT AXE (observation, not acceptance)', JSON.stringify({ dt, ...readAndFight('axe', dt, true) }));
    const rows = (['knife', 'longsword', 'axe', 'spear'] as WeaponId[]).map(id => readAndFight(id, dt));
    console.log('MELEE FULL FIGHT', JSON.stringify({ dt, rows }));
    for (const r of rows) {
      expect(r.cleared, r.id).toBe(true);
      expect(r.damage, r.id).toBe(0);
      expect(r.hits, r.id).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, WEAPONS } from '../src/config';
import { counterThreat } from '../src/sim/classSys';
import { startActions, updatePlayerAction } from '../src/sim/playerSys';
import { damageEnemy, staggerEnemy, updateEnemies, wardenBraced, wardenCrownClosed, wardenWindup } from '../src/sim/enemySys';
import { emptyInput } from '../src/sim/types';
import { makeWorld, OPEN_ROOM } from './helpers';

const dt = 1 / 120;
function fixture(distance = 2) {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 14.5 - distance, yaw: Math.PI, boss: true }]);
  const e = w.enemies[0]!;
  Object.assign(e, { state: 'alert', seesPlayer: true, awareness: 1, lastKnown: { x: w.player.x, z: w.player.z }, percT: 0 });
  return { w, e };
}
function until(w: ReturnType<typeof makeWorld>, check: () => boolean, max = 5) {
  for (let i = 0; i < max / dt; i++) { if (check()) return; updateEnemies(w, dt); }
  throw Error('Expected state not reached');
}

describe('Warden pressure regressions', () => {
  it('keeps every single attack survivable from full starting health without armor', () => {
    for (const damage of [ENEMIES.warden.damage, ENEMIES.warden.cleaveDamage, ENEMIES.warden.followupDamage, ENEMIES.warden.rushDamage]) {
      expect(damage).toBeLessThan(PLAYER.maxHp);
    }
  });
  it('approaches the sword Counter dead zone instead of preparing a stationary lance', () => {
    const { w, e } = fixture(2.7);
    const before = Math.hypot(w.player.x - e.x, w.player.z - e.z);
    updateEnemies(w, dt);
    expect(e.phase).toBe('none');
    expect(e.moving).toBe(true);
    expect(Math.hypot(w.player.x - e.x, w.player.z - e.z)).toBeLessThan(before);
  });

  it('held repeat still damages but cannot claim a deliberate Boss Counter', () => {
    const { w, e } = fixture();
    until(w, () => e.locked);
    expect(counterThreat(w)?.kind).toBe('warden');
    const hp = e.hp;
    for (let k = 0; k < 24; k++) w.frame(dt, { ...emptyInput(), fire: true, firePressed: false });
    expect(e.hp).toBeLessThan(hp);
    expect(w.stats.counters).toBe(0);
    expect(e.phase).not.toBe('stagger');
  });

  it('does not let each ordinary axe hit restart another full stagger and fresh windup', () => {
    const { w, e } = fixture();
    staggerEnemy(e, WEAPONS.axe.stagger);
    until(w, () => e.phase === 'windup');
    for (let i = 0; i < 20; i++) updateEnemies(w, dt);
    const phase = e.phase, time = e.phaseT;
    staggerEnemy(e, WEAPONS.axe.stagger);
    expect(e.phase).toBe(phase);
    expect(e.phaseT).toBe(time);
  });

  it('phase two at melee distance signals a second committed cleave before the final recovery', () => {
    const { w, e } = fixture(); e.hp = e.maxHp * ENEMIES.warden.phaseThreshold;
    until(w, () => e.phase === 'active');
    until(w, () => e.phase !== 'active');
    expect(e.phase).toBe('windup');
    expect(e.locked).toBe(false);
    expect(e.warden?.attack).toBe('cleave');
  });

  it('a successful fresh Counter gives its full opening, then visible resistance through the next full recovery', () => {
    const { w, e } = fixture();
    until(w, () => e.locked);
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true });
    for (let i = 0; i < 30 && !w.stats.counters; i++) w.frame(dt, emptyInput());
    expect(w.stats.counters).toBe(1);
    expect(e.phase).toBe('stagger'); expect(wardenCrownClosed(e)).toBe(false);
    expect(wardenBraced(e)).toBe(true);
    const t = e.phaseT;
    staggerEnemy(e, 20);
    expect(e.phaseT).toBe(t); expect(e.staggerDur).toBe(ENEMIES.warden.stagger);
    until(w, () => e.phase === 'windup' && e.locked);
    expect(counterThreat(w)).toBeNull(); expect(wardenBraced(e)).toBe(true);
    // Avoid the already locked wedge; a successful dodge remains free.
    w.player.x = e.x + 3; w.player.z = e.z;
    until(w, () => e.phase === 'recovery');
    expect(wardenCrownClosed(e)).toBe(false); expect(wardenBraced(e)).toBe(true);
    const hp = e.hp;
    damageEnemy(w, e, 3, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    expect(e.hp).toBe(hp - 3); // Resistance never reduces damage.
    for (let i = 0; i < (ENEMIES.warden.cleaveRecovery - .03) / dt; i++) updateEnemies(w, dt);
    expect(wardenBraced(e)).toBe(true);
    until(w, () => e.phase === 'none');
    expect(wardenBraced(e)).toBe(false);
  });

  it('pre-lock loss of sight pays recovery but cannot reset the interrupt budget', () => {
    const { w, e } = fixture();
    staggerEnemy(e, WEAPONS.axe.stagger);
    until(w, () => e.phase === 'windup');
    w.player.invisT = 10;
    updateEnemies(w, dt);
    expect(e.phase).toBe('recovery'); expect(e.warden!.sequenceResolved).toBe(false);
    until(w, () => e.phase === 'none');
    expect(wardenBraced(e)).toBe(true);
  });

  it('the follow-up locks its own direction after its full tell and grants no invisible extra range', () => {
    const { w, e } = fixture(); e.hp = e.maxHp * ENEMIES.warden.phaseThreshold;
    // The first slash is deliberately dodged with a fixture relocation.
    until(w, () => e.locked);
    w.player.x = e.x + 2.2; w.player.z = e.z;
    until(w, () => e.phase === 'windup' && e.warden!.followup);
    expect(e.phaseT).toBe(0); expect(e.locked).toBe(false);
    until(w, () => e.locked);
    expect(wardenWindup(e)).toBe(ENEMIES.warden.followupWindup);
    const yaw = e.lockedYaw;
    w.player.x = e.x; w.player.z = e.z - 3;
    until(w, () => e.phase === 'recovery');
    expect(e.yaw).toBe(yaw); expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(e.warden!.sequenceResolved).toBe(true);
  });

  it('a heavy hit during an already earned open recovery cannot cut it short', () => {
    const { w, e } = fixture();
    staggerEnemy(e, WEAPONS.axe.stagger);
    until(w, () => e.phase === 'windup' && e.locked);
    w.player.x = e.x + 3; w.player.z = e.z;
    until(w, () => e.phase === 'recovery');
    const time = e.phaseT;
    staggerEnemy(e, WEAPONS.axe.stagger);
    expect(e.phase).toBe('recovery'); expect(e.phaseT).toBe(time);
  });

  it('a resisted wall shove stops once without repeated effects or a later stale stagger', () => {
    const { w, e } = fixture();
    e.x = 9.5; e.z = 1.51; w.player.x = 9.5; w.player.z = 2.51;
    e.phase = 'windup'; e.phaseT = .2; e.warden!.attack = 'cleave'; e.warden!.braced = true;
    startActions(w, { ...emptyInput(), shield: true }); updatePlayerAction(w, .05);
    expect(e.push).not.toBeNull();
    for (let i = 0; i < 6; i++) updateEnemies(w, dt);
    expect(e.push).toBeNull(); expect(w.stats.wallSlams).toBe(1);
    const bumps = w.events.filter(event => event.type === 'bump');
    expect(bumps).toHaveLength(1); expect(bumps[0]!.text).toContain('未被打斷');
    expect(e.phase).toBe('windup');
    e.warden!.braced = false;
    updateEnemies(w, dt);
    expect(e.phase).toBe('windup'); expect(w.stats.wallSlams).toBe(1);
  });

  it('a resisted body collision consumes the shove without repeatedly stunning its neighbor', () => {
    const w = makeWorld(OPEN_ROOM, [
      { kind: 'warden', x: 9.5, z: 12.5, yaw: Math.PI, boss: true },
      { kind: 'guard', x: 9.5, z: 11.5 },
    ]);
    const e = w.enemies[0]!, other = w.enemies[1]!;
    w.player.z = 13.5;
    e.state = 'alert'; e.phase = 'windup'; e.locked = true; e.lockedYaw = Math.PI;
    e.warden!.attack = 'cleave'; e.warden!.braced = true;
    startActions(w, { ...emptyInput(), shield: true }); updatePlayerAction(w, .05);
    for (let i = 0; i < 12; i++) updateEnemies(w, dt);
    expect(e.push).toBeNull(); expect(e.phase).toBe('windup');
    expect(other.phase).toBe('stagger'); expect(other.phaseT).toBeGreaterThan(.02);
    expect(w.events.filter(event => event.type === 'bump')).toHaveLength(1);
  });
});

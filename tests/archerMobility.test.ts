import { describe, expect, it, vi } from 'vitest';
import { ENEMIES, PERCEPTION, PLAYER, PROJECTILES, TIPS } from '../src/config';
import { archerLineClear, interruptEnemy, lullEnemy, staggerEnemy, updateEnemies } from '../src/sim/enemySys';
import { T } from '../src/sim/grid';
import { updateProjectiles } from '../src/sim/projectileSys';
import type { Enemy } from '../src/sim/types';
import { makeWorld, OPEN_ROOM } from './helpers';

const DT = 1 / 120;
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture(x = 9.5, z = 8.5, player = { x: 9.5, z: 12.5 }, rows = OPEN_ROOM, perched = false) {
  const w = makeWorld(rows, [{ kind: 'archer', x, z, yaw: Math.PI, perched }]);
  Object.assign(w.player, player);
  const a = w.enemies[0]!;
  a.state = 'alert'; a.seesPlayer = true; a.awareness = 1; a.lastKnown = { ...player }; a.percT = 0;
  return { w, a };
}
function ticks(w: ReturnType<typeof makeWorld>, seconds: number, after?: (frame: number) => void) {
  for (let i = 0; i < Math.ceil(seconds / DT - 1e-9); i++) { updateEnemies(w, DT); after?.(i); }
}
function firstMoveEnds(w: ReturnType<typeof makeWorld>, a: Enemy) {
  let moved = false, length = 0, elapsed = 0;
  const start = { x: a.x, z: a.z };
  for (let i = 0; i < 300; i++) {
    const old = { x: a.x, z: a.z };
    updateEnemies(w, DT);
    const step = distance(old, a);
    length += step; elapsed += DT;
    if (step > 1e-7) moved = true;
    expect(w.grid.circleBlocked(a.x, a.z, a.radius - 1e-7)).toBe(false);
    if (moved && step < 1e-7) return { start, length, elapsed };
  }
  throw new Error('Archer did not complete a bounded movement episode');
}
function withAllyBlocker() {
  const w = makeWorld(undefined, [
    { kind: 'archer', x: 9.5, z: 3.5, yaw: Math.PI },
    { kind: 'guard', x: 9.5, z: 8.5, yaw: Math.PI },
  ]);
  const [a, g] = w.enemies as [Enemy, Enemy];
  a.state = 'alert'; a.seesPlayer = true; a.awareness = 1; a.lastKnown = { x: w.player.x, z: w.player.z }; a.percT = 0;
  g.paralyzeT = 100;
  return { w, a, g };
}

// Observable movement, collision, telegraph and projectile effects are the contract.
// Planner bookkeeping is deliberately not part of most assertions.
describe('Ground archer bounded repositioning', () => {
  it('retreats along legal geometry, then stands and fires while the player is still inside 7 m', () => {
    const { w, a } = fixture();
    const d0 = distance(a, w.player);
    const episode = firstMoveEnds(w, a);
    expect(episode.length).toBeGreaterThan(.5);
    expect(episode.length).toBeLessThanOrEqual(2.5 + 1e-6);
    expect(episode.elapsed).toBeLessThanOrEqual(1.1 + 2 * DT);
    expect(distance(a, w.player)).toBeGreaterThan(d0 + .5);
    expect(distance(a, w.player)).toBeLessThan(7);
    const stopped = { x: a.x, z: a.z };
    ticks(w, 1.15, () => expect(distance(a, stopped)).toBeLessThan(1e-8));
    expect(w.events.some(e => e.type === 'enemyFire' && e.id === a.id)).toBe(true);
    expect(a.hp).toBe(ENEMIES.archer.hp);
  });

  it('can retreat sideways beside a rear wall instead of continually pushing into it', () => {
    const { w, a } = fixture(9.25, 1.75, { x: 9.25, z: 4.75 });
    const before = { x: a.x, z: a.z }, d0 = distance(a, w.player);
    firstMoveEnds(w, a);
    expect(Math.abs(a.x - before.x)).toBeGreaterThan(.5);
    expect(distance(a, w.player)).toBeGreaterThan(d0);
    expect(w.grid.circleBlocked(a.x, a.z, a.radius - 1e-7)).toBe(false);
  });

  it('opens a clear firing lane around a frozen ally without walking through it', () => {
    const { w, a, g } = withAllyBlocker();
    expect(archerLineClear(w, a)).toBe(false);
    let moved = 0, last = { x: a.x, z: a.z };
    ticks(w, 3, () => {
      moved += distance(last, a); last = { x: a.x, z: a.z };
      expect(distance(a, g)).toBeGreaterThanOrEqual(a.radius + g.radius - 1e-6);
      expect(w.grid.circleBlocked(a.x, a.z, a.radius - 1e-7)).toBe(false);
    });
    expect(moved).toBeGreaterThan(.5);
    expect(archerLineClear(w, a)).toBe(true);
    expect(w.events.some(e => e.type === 'enemyFire' && e.id === a.id)).toBe(true);
  });

  it('sidesteps an ally when the rear wall prevents gaining retreat distance', () => {
    const rows = ['#######', ...Array(8).fill('#.....#'), '#######'];
    const w = makeWorld(rows, [
      { kind: 'archer', x: 3.5, z: 1.5, yaw: Math.PI },
      { kind: 'guard', x: 3.5, z: 4, yaw: Math.PI },
    ]);
    Object.assign(w.player, { x: 3.5, z: 7.5 });
    const [a, g] = w.enemies as [Enemy, Enemy];
    Object.assign(a, { state: 'alert', seesPlayer: true, awareness: 1, lastKnown: { x: 3.5, z: 7.5 }, percT: 0 });
    g.paralyzeT = 100;
    ticks(w, 4);
    expect(Math.abs(a.x - 3.5)).toBeGreaterThan(.5);
    expect(w.events.some(e => e.type === 'enemyFire' && e.id === a.id)).toBe(true);
    expect(g.hp).toBe(g.maxHp);
  });

  it('never winds up, locks or fires on a tactical movement tick', () => {
    for (const { w, a } of [fixture(), withAllyBlocker()]) {
      let movingFrames = 0;
      ticks(w, 8, () => {
        const events = w.drainEvents();
        if (a.moving) {
          movingFrames++;
          expect(a.phase).not.toBe('aim');
          expect(events.some(e => ('id' in e && e.id === a.id) && ['enemyWindup', 'enemyLock', 'enemyFire'].includes(e.type))).toBe(false);
        }
      });
      expect(movingFrames).toBeGreaterThan(10);
    }
  });

  it('commits to one local route instead of replanning each frame or flipping with the player', () => {
    const { w, a } = fixture();
    const spy = vi.spyOn(w.enav, 'findPath');
    updateEnemies(w, DT);
    const initialCalls = spy.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    expect(initialCalls).toBeLessThanOrEqual(16);
    expect(spy.mock.calls.every(call => typeof call[5] === 'number' && call[5] < 40000)).toBe(true);
    const old = { x: a.x, z: a.z };
    // Stay visible, but put the player behind the archer's selected escape route.
    w.player.z = 4;
    ticks(w, .3);
    expect(a.z).toBeLessThan(old.z);
    expect(spy.mock.calls.length).toBe(initialCalls);
    spy.mockRestore();
  });

  it('does not kite indefinitely when a player keeps closing distance', () => {
    const { w, a } = fixture(9.5, 8.5, { x: 9.5, z: 11.5 });
    let longest = 0, consecutive = 0, standingFrames = 0;
    ticks(w, 12, () => {
      if (a.moving) { consecutive += DT; longest = Math.max(longest, consecutive); }
      else { consecutive = 0; standingFrames++; }
      // Controlled pursuit at ordinary walking speed, with collision clearance.
      const d = distance(a, w.player), step = Math.min(Math.max(0, d - 1), 4.5 * DT);
      const q = w.grid.resolveCircle(w.player.x + (a.x - w.player.x) / d * step, w.player.z + (a.z - w.player.z) / d * step, PLAYER.radius);
      Object.assign(w.player, q);
    });
    expect(longest).toBeLessThanOrEqual(1.1 + DT);
    expect(standingFrames * DT).toBeGreaterThan(5);
    expect(w.events.filter(e => e.type === 'enemyFire' && e.id === a.id).length).toBeGreaterThanOrEqual(2);
  });

  it('holds and shoots in a one-cell dead end with no legal retreat', () => {
    const rows = ['###########', '#####.#####', '#####.#####', '#####.#####', '#####.#####', '#####.#####', '#####.#####', '###########'];
    const { w, a } = fixture(5.5, 1.5, { x: 5.5, z: 5.5 }, rows);
    const start = { x: a.x, z: a.z };
    ticks(w, 3, () => expect(distance(a, start)).toBeLessThan(1e-8));
    expect(w.events.filter(e => e.type === 'enemyFire').length).toBeGreaterThan(0);
  });

  it('does not walk through a pillar, low wall, closed door or barred door while selecting local cover', () => {
    for (const obstacle of ['o', '=', 'D', 'B']) {
      const rows = OPEN_ROOM.map((row, j) => j === 7 ? row.slice(0, 9) + obstacle + row.slice(10) : row);
      const { w, a } = fixture(9.5, 8.5, { x: 9.5, z: 12.5 }, rows);
      ticks(w, 3, () => expect(w.grid.circleBlocked(a.x, a.z, a.radius - 1e-7)).toBe(false));
      expect(w.events.some(e => e.type === 'enemyFire')).toBe(true);
      if (obstacle === 'D' || obstacle === 'B') expect(w.grid.doors[0]!.progress).toBe(0);
    }
  });

  it('abandons a tactical leg if an open door closes across its route', () => {
    const rows = OPEN_ROOM.map((row, j) => j === 7 ? row.slice(0, 9) + 'D' + row.slice(10) : row);
    const { w, a } = fixture(9.5, 8.5, { x: 9.5, z: 12.5 }, rows);
    const door = w.grid.doors[0]!;
    door.progress = 1; door.target = 1;
    updateEnemies(w, DT);
    expect(a.moving).toBe(true);
    door.progress = 0; door.target = 0;
    ticks(w, 1.5);
    expect(door.target).toBe(0);
    expect(door.progress).toBe(0);
    expect(w.grid.circleBlocked(a.x, a.z, a.radius - 1e-7)).toBe(false);
  });

  it('keeps perched archers stationary even with a nearby player or ally-blocked line', () => {
    const { w, a } = fixture(9.5, 8.5, { x: 9.5, z: 12.5 }, OPEN_ROOM, true);
    const start = { x: a.x, z: a.z };
    ticks(w, 5, () => expect(distance(start, a)).toBe(0));
    expect(w.events.some(e => e.type === 'enemyFire')).toBe(true);
    const blocked = withAllyBlocker(); blocked.a.perched = true;
    ticks(blocked.w, 3);
    expect(blocked.a.x).toBe(9.5); expect(blocked.a.z).toBe(3.5);
    expect(blocked.w.events.some(e => e.type === 'enemyFire')).toBe(false);
  });
});

describe('Archer perception and commitment during repositioning', () => {
  it.each(['invisibility', 'smoke'] as const)('aborts a move immediately on %s, before the next perception sample', hidden => {
    const { w, a } = fixture();
    ticks(w, .2); expect(a.moving).toBe(true);
    const old = { x: a.x, z: a.z }, known = { ...a.lastKnown! };
    a.percT = PERCEPTION.interval; // stale seesPlayer must not provide one extra tactical move.
    w.player.x = 15;
    if (hidden === 'invisibility') w.player.invisT = 10;
    else w.smokes.push({ id: w.nextId++, x: (a.x + w.player.x) / 2, y: 1.3, z: (a.z + w.player.z) / 2, radius: 3, age: 0, air: false });
    updateEnemies(w, DT);
    expect(a.lastKnown).toEqual(known);
    expect(a.phase).not.toBe('aim');
    expect(distance(a, known)).toBeLessThanOrEqual(distance(old, known) + 1e-6);
    expect(w.events.some(e => e.type === 'enemyFire')).toBe(false);
  });

  it('hidden player position cannot change the last-known chase trajectory', () => {
    const left = fixture(), right = fixture();
    for (const f of [left, right]) { ticks(f.w, .2); f.w.player.invisT = 20; f.a.percT = PERCEPTION.interval; }
    left.w.player.x = 3; right.w.player.x = 16;
    ticks(left.w, 1); ticks(right.w, 1);
    expect(left.a.x).toBeCloseTo(right.a.x, 9); expect(left.a.z).toBeCloseTo(right.a.z, 9);
    expect(left.a.lastKnown).toEqual(right.a.lastKnown);
    expect(left.w.events.filter(e => e.type === 'enemyFire')).toHaveLength(0);
    expect(right.w.events.filter(e => e.type === 'enemyFire')).toHaveLength(0);
  });

  it('aborts pre-lock aim immediately when sight disappears', () => {
    const { w, a } = fixture(9.5, 3.5, { x: 9.5, z: 14.5 });
    ticks(w, .2); expect(a.phase).toBe('aim'); expect(a.locked).toBe(false);
    a.percT = PERCEPTION.interval; w.player.invisT = 10;
    updateEnemies(w, DT);
    expect(a.phase).not.toBe('aim'); expect(a.aimPoint).toBeNull();
    expect(w.events.some(e => e.type === 'enemyLock' || e.type === 'enemyFire')).toBe(false);
  });

  it('preserves 0.9-second aim, 0.25-second final lock, and physical friendly fire after commitment', () => {
    expect(ENEMIES.archer.aim).toBe(.9); expect(ENEMIES.archer.lockBefore).toBe(.25);
    const { w, a, g } = withAllyBlocker(); g.x = 13;
    updateEnemies(w, DT); expect(a.phase).toBe('aim');
    const start = { x: a.x, z: a.z };
    ticks(w, .64); expect(a.locked).toBe(false); expect(w.projectiles).toHaveLength(0);
    ticks(w, .02); expect(a.locked).toBe(true);
    const locked = { ...a.aimPoint! };
    g.x = 9.5; w.player.x = 13; w.player.invisT = 10;
    ticks(w, .24);
    expect(w.projectiles).toHaveLength(1); expect(distance(a, start)).toBe(0);
    expect(locked.x).toBe(9.5);
    expect(w.events.filter(e => e.type === 'enemyLock')).toHaveLength(1);
    updateProjectiles(w, .6);
    expect(g.hp).toBe(g.maxHp - PROJECTILES.bolt.damage);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('does not fire into an ally that blocks a previously clear pre-lock aim', () => {
    const { w, a, g } = withAllyBlocker(); g.x = 13;
    ticks(w, .2); expect(a.phase).toBe('aim');
    g.x = 9.5; updateEnemies(w, DT);
    expect(a.locked).toBe(false); expect(a.phase).not.toBe('aim');
    expect(w.projectiles).toHaveLength(0);
    ticks(w, 3);
    expect(w.events.some(e => e.type === 'enemyFire')).toBe(true);
    expect(g.hp).toBe(g.maxHp);
  });
});

describe('Archer mobility status effects and recovery', () => {
  it('chill slows the same movement trajectory in AI time', () => {
    const normal = fixture(), chilled = fixture(); chilled.a.slowT = 20;
    ticks(normal.w, .4); ticks(chilled.w, .4 / TIPS.chill.timeScale);
    expect(chilled.a.x).toBeCloseTo(normal.a.x, 7); expect(chilled.a.z).toBeCloseTo(normal.a.z, 7);
    expect(chilled.a.phase).toBe(normal.a.phase);
  });

  it('paralysis freezes movement, perception and aim until it expires, then resumes', () => {
    const { w, a } = fixture(); ticks(w, .2);
    const frozen = { x: a.x, z: a.z, phaseT: a.phaseT, percT: a.percT };
    a.paralyzeT = .5; ticks(w, .4);
    expect({ x: a.x, z: a.z, phaseT: a.phaseT, percT: a.percT }).toEqual(frozen);
    expect(a.moving).toBe(false); expect(w.events.some(e => e.type === 'enemyFire')).toBe(false);
    ticks(w, .4); expect(distance(a, frozen)).toBeGreaterThan(.1);
  });

  it('stagger interrupts a route, holds for its duration, and allows later shots', () => {
    const { w, a } = fixture(); ticks(w, .2); staggerEnemy(a, .4);
    const start = { x: a.x, z: a.z };
    ticks(w, .35); expect(distance(a, start)).toBe(0); expect(a.phase).toBe('stagger');
    ticks(w, 3);
    expect(a.phase).not.toBe('stagger'); expect(w.events.some(e => e.type === 'enemyFire')).toBe(true);
  });

  it('Sleep cancels an uncommitted route and clears last-known chase', () => {
    const { w, a } = fixture(); ticks(w, .2); lullEnemy(a);
    const start = { x: a.x, z: a.z };
    w.player.invisT = 10; ticks(w, 2);
    expect(a.state).toBe('sleep'); expect(a.phase).toBe('none'); expect(a.lastKnown).toBeNull();
    expect(distance(a, start)).toBe(0); expect(w.events.some(e => e.type === 'enemyFire')).toBe(false);
  });

  it('external shove displaces a paralyzed archer without continuing its escape path', () => {
    const { w, a } = fixture(); ticks(w, .2); interruptEnemy(a);
    const start = { x: a.x, z: a.z };
    a.paralyzeT = 1; a.push = { dx: 1, dz: 0, left: .8 };
    ticks(w, .3);
    expect(a.x).toBeGreaterThan(start.x + .5); expect(a.z).toBeCloseTo(start.z, 8);
    expect(w.events.some(e => e.type === 'enemyFire')).toBe(false);
    ticks(w, 3); expect(w.events.some(e => e.type === 'enemyFire')).toBe(true);
  });

  it('stationary reload ends normally and produces another telegraphed shot', () => {
    const { w, a } = fixture(9.5, 3.5, { x: 9.5, z: 14.5 });
    ticks(w, 1); expect(a.phase).toBe('reload');
    const pos = { x: a.x, z: a.z };
    ticks(w, 3, () => expect(distance(a, pos)).toBe(0));
    expect(w.events.filter(e => e.type === 'enemyWindup')).toHaveLength(2);
    expect(w.events.filter(e => e.type === 'enemyFire')).toHaveLength(2);
  });

  it('updates the actual world pipeline with a legal shot after retreat', () => {
    const { w, a } = fixture();
    for (let i = 0; i < 4 / DT && !w.player.dead; i++) w.advance(DT);
    expect(w.player.hp).toBeLessThan(PLAYER.maxHp);
    expect(a.hp).toBe(ENEMIES.archer.hp);
    expect(w.grid.get(Math.floor(a.x), Math.floor(a.z))).toBe(T.Floor);
  });
});

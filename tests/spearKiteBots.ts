import { WEAPONS, type PlayerClass } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { emptyInput } from '../src/sim/types';
import { makeWorld } from './helpers';

export type KiteEncounter = 'guard' | 'twoGuards' | 'guardArcher';
export type KitePolicy = 'holdBack' | 'distanceOnly' | 'readAttack' | 'readEncounter';

/** Fixed open lane, ordinary HP/gear, no surprise, runes, teleport or healing.
 * Perfect aim is deliberate: expose spacing, not mouse precision. */
export function kiteWorld(encounter: KiteEncounter, cls: PlayerClass = 'huntress') {
  const rows = ['#'.repeat(24), ...Array.from({ length: 98 }, () => '#' + '.'.repeat(22) + '#'), '#'.repeat(24)];
  const enemies = [{ kind: 'guard' as const, x: 12, z: 7 }];
  if (encounter === 'twoGuards') enemies.push({ kind: 'guard', x: 12.9, z: 7 });
  const w = makeWorld(rows, enemies, cls);
  if (encounter === 'guardArcher') {
    // Reuse normal spawn construction, with a ranged threat behind the guard.
    const ranged = makeWorld(rows, [...enemies, { kind: 'archer', x: 15, z: 3 }], cls);
    return prepare(ranged);
  }
  return prepare(w);
}

function prepare(w: ReturnType<typeof makeWorld>) {
  Object.assign(w.player, { x: 12, z: 10, yaw: 0, tool: 'melee', desiredTool: 'melee' });
  w.player.weapon = { id: 'spear', level: 0 };
  w.player.armor = { id: 'cloth', level: 0 };
  for (const e of w.enemies) {
    e.state = 'alert';
    e.awareness = 1;
    e.seesPlayer = true;
    e.lastKnown = { x: w.player.x, z: w.player.z };
    e.yaw = Math.PI;
  }
  return w;
}

export function runKite(encounter: KiteEncounter, policy: KitePolicy, cls: PlayerClass = 'huntress', frameDt = 1 / 60, guardHp?: number, initialDistance = 3) {
  const w = kiteWorld(encounter, cls);
  w.player.z = 7 + initialDistance;
  // Optional prolonged spacing probe only, explicitly injected HP; standard cases use ordinary HP.
  if (guardHp) for (const e of w.enemies) if (e.kind === 'guard') e.hp = e.maxHp = guardHp;
  const distances: Array<{ time: number; distance: number }> = [];
  let attacks = 0, hits = 0, windups = 0, retreats = 0, frames = 0, nextSample = 0;
  let minDistance = Infinity, maxDistance = 0;
  for (; frames < Math.ceil(120 / frameDt) && !w.player.dead && w.enemies.some(e => e.alive) && w.time < 60; frames++) {
    const e = w.enemies.filter(e => e.alive).sort((a, b) => Math.hypot(a.x - w.player.x, a.z - w.player.z) - Math.hypot(b.x - w.player.x, b.z - w.player.z))[0]!;
    const d = Math.hypot(e.x - w.player.x, e.z - w.player.z);
    const yaw = yawFromDir(e.x - w.player.x, e.z - w.player.z);
    const attack = e.phase === 'windup' || e.phase === 'active';
    const reads = policy === 'readAttack' || policy === 'readEncounter';
    const retreat = policy === 'holdBack' || d <= 3.05 || (reads && attack);
    let fire = !reads || (!attack && (e.phase === 'recovery' || d > 2.7));
    let moveZ = retreat ? -1 : 0;
    let moveX = 0;
    if (policy === 'readEncounter') {
      if (e.kind === 'archer') { moveZ = d > 3.05 ? 1 : 0; fire = d <= 3.05; }
      // Read the ranged lock/projectile and change direction, rather than holding a straight retreat.
      if (w.enemies.some(a => a.alive && a.kind === 'archer' && a.phase === 'aim' && a.locked) ||
          w.projectiles.some(b => b.kind === 'bolt' && b.owner !== 'player')) moveX = 1;
    }
    if (retreat) retreats++;
    w.frame(frameDt, { ...emptyInput(yaw), moveZ, moveX, wait: !moveZ && !moveX, fire, firePressed: fire });
    for (const ev of w.drainEvents()) {
      if (ev.type === 'swing') attacks++;
      if (ev.type === 'hitEnemy' && ev.source === 'melee') hits++;
      if (ev.type === 'enemyWindup' && ev.kind === 'guard') windups++;
    }
    const main = w.enemies[0]!;
    if (main.alive) {
      const distance = Math.hypot(main.x - w.player.x, main.z - w.player.z);
      minDistance = Math.min(minDistance, distance);
      maxDistance = Math.max(maxDistance, distance);
      if (w.time >= nextSample) { distances.push({ time: +w.time.toFixed(3), distance: +distance.toFixed(3) }); nextSample += 0.25; }
    }
  }
  return { encounter, policy, cls, cleared: w.enemies.every(e => !e.alive), dead: w.player.dead,
    damage: Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0), worldTime: +w.time.toFixed(3),
    attacks, hits, windups, counters: w.stats.counters, minDistance: +minDistance.toFixed(3), maxDistance: +maxDistance.toFixed(3),
    retreatFraction: +(retreats / Math.max(1, frames)).toFixed(3), distances,
    spearReach: WEAPONS.spear.reach };
}

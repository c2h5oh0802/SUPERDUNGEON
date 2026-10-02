import { ENEMIES, PLAYER, WEAPONS, type PlayerClass } from '../src/config';
import { forwardFromYaw, yawFromDir } from '../src/core/math';
import { generateLevel } from '../src/gen/validate';
import { AIM_EYE_Y } from '../src/sim/aim';
import { counterThreat } from '../src/sim/classSys';
import { wardenCrownClosed } from '../src/sim/enemySys';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { World } from '../src/sim/world';

export type WardenPolicy = 'headspam' | 'read-bow' | 'counter-sword' | 'recovery-knife';
export function runWardenScenario(policy: WardenPolicy, fps = 60, seed = 'WARDEN-REVIEW', reaction = 0) {
  const cls: PlayerClass = policy === 'counter-sword' ? 'warrior' : 'huntress';
  const w = new World(generateLevel(seed, { floor: 5 }), { cls });
  const p = w.player, e = w.enemies[0]!;
  // Controlled entry, real generated arena and default equipment/HP. No runtime
  // teleports, invulnerability, damage injection, inventory grant or healing.
  p.x = e.x; p.z = e.z + 6;
  p.items = []; p.tipped = { paralysis: 0, chill: 0 }; p.bottles = 0; p.stones = 0;
  if (policy === 'recovery-knife') p.arrows = 0;
  p.tool = p.desiredTool = policy === 'read-bow' || policy === 'headspam' ? 'bow' : 'melee';
  w.updateEncounter();
  const move = (yaw: number, dx: number, dz: number) => {
    const l = Math.hypot(dx, dz) || 1, f = forwardFromYaw(yaw);
    return { moveX: (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / l, moveZ: (dx * f.x + dz * f.z) / l };
  };
  const clearance = (dx: number, dz: number) => {
    const len = Math.hypot(dx, dz) || 1;
    let free = 0;
    for (let n = .2; n < 2.6; n += .2) {
      if (w.grid.circleBlocked(p.x + dx / len * n, p.z + dz / len * n, PLAYER.radius)) break;
      free = n;
    }
    return free;
  };
  let recoveryAttack = false, lastPhase = '', nextDecision = 0, held: Partial<FrameInput> = {};
  let windups = 0, locks = 0, hits = 0, blockedHeads = 0;
  let dodgeDirection: { x: number; z: number } | null = null;
  const attackKinds = new Set<string>();
  for (let k = 0; k < fps * 300 && w.time < 120 && !p.dead && e.alive; k++) {
    if (w.pendingChoice) break;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz), yaw = yawFromDir(dx, dz);
    const head = policy === 'headspam' || policy === 'read-bow';
    const knifeFallback = policy === 'recovery-knife' || (policy === 'read-bow' && p.arrows === 0);
    const out: Partial<FrameInput> = { yaw, pitch: Math.atan2((head ? ENEMIES.warden.headY : 1.2) - AIM_EYE_Y, d) };
    const open = e.phase === 'recovery' || e.phase === 'stagger';
    if (e.phase !== lastPhase) { if (open) recoveryAttack = false; lastPhase = e.phase; }
    if (policy === 'headspam') {
      out.fire = true; out.firePressed = !p.action; out.wait = true;
    } else {
      let dodge: { x: number; z: number } | null = null;
      const projectile = w.projectiles.find(b => {
        if (!b.alive || b.kind !== 'bolt' || b.owner === 'player') return false;
        const len = Math.hypot(b.vel.x, b.vel.z), rx = p.x - b.pos.x, rz = p.z - b.pos.z;
        const along = (rx * b.vel.x + rz * b.vel.z) / len;
        const perp = Math.abs(rx * b.vel.z - rz * b.vel.x) / len;
        return along > 0 && perp < PLAYER.radius + b.radius + .35;
      });
      if (!e.locked && !projectile) dodgeDirection = null;
      if (e.warden!.attack === 'cleave' && (e.locked || e.phase === 'active' || (knifeFallback && e.phase === 'windup')) && d < 3.05) dodge = { x: -dx, z: -dz };
      if ((e.warden!.attack === 'rush' && (e.locked || e.phase === 'charge')) ||
          (e.warden!.attack === 'lance' && e.locked) || projectile) {
        const f = projectile ? projectile.vel : forwardFromYaw(e.lockedYaw);
        const left = { x: -f.z, z: f.x }, right = { x: f.z, z: -f.x };
        dodgeDirection ??= clearance(left.x, left.z) >= clearance(right.x, right.z) ? left : right;
        dodge = dodgeDirection;
      }
      const counter = policy === 'counter-sword' && !p.action ? counterThreat(w) : null;
      if (counter) { out.fire = true; out.firePressed = true; }
      else if (dodge) Object.assign(out, move(yaw, dodge.x, dodge.z));
      else if (knifeFallback && e.warden!.attack === 'cleave' && (e.phase === 'windup' || e.phase === 'active')) out.wait = true;
      else if (policy === 'read-bow' && p.arrows > 0) {
        if (!p.action && !wardenCrownClosed(e) && open && e.phaseT < .65) { out.fire = true; out.firePressed = true; }
        else out.wait = true;
      } else {
        if (p.tool !== 'melee') out.selectSlot = 1;
        const reach = WEAPONS[p.weapon.id].reach + e.radius - .15;
        if (open && !recoveryAttack && d <= reach && !p.action) {
          out.fire = true; out.firePressed = true;
        } else if (!p.action && d > (open ? reach - .1 : 2.2)) Object.assign(out, move(yaw, dx, dz));
        else out.wait = true;
      }
    }
    let decision: Partial<FrameInput>;
    if (w.realTime >= nextDecision) { held = out; decision = out; nextDecision = w.realTime + reaction; }
    else decision = { ...held, firePressed: false, selectSlot: undefined };
    const priorAction = p.action;
    w.frame(1 / fps, { ...emptyInput(yaw, out.pitch), ...decision });
    if (!priorAction && p.action?.kind === 'melee' && open) recoveryAttack = true;
    for (const ev of w.drainEvents()) {
      if (ev.type === 'enemyWindup') { windups++; if (ev.source) attackKinds.add(ev.source); }
      if (ev.type === 'enemyLock') locks++;
      if (ev.type === 'hitEnemy') hits++;
      if (ev.type === 'helmet') blockedHeads++;
    }
  }
  return { policy, fps, seed, reaction, cleared: !e.alive, dead: p.dead,
    damage: Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0),
    worldTime: Number(w.time.toFixed(3)), bossHp: e.hp, arrowsUsed: (cls === 'warrior' || policy === 'recovery-knife' ? 0 : 8) - p.arrows,
    counters: w.stats.counters, deflects: w.stats.deflects, windups, locks, hits, blockedHeads,
    attackKinds: [...attackKinds], position: [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))],
    bossPosition: [Number(e.x.toFixed(2)), Number(e.z.toFixed(2))], phase: e.phase, attack: e.warden!.attack };
}

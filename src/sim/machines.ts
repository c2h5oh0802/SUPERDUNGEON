import { PLAYER, PROJECTILES } from '../config';
import { damageEnemy } from './enemySys';
import { spawnArea } from './items';
import type { Machine, MachineSpawn } from './types';
import type { World } from './world';

/** 箭孔的出箭高度（胸口）；發射後亮一下的時間。 */
export const MACHINE = { dartY: 1.2, flash: 0.12 } as const;

export function createMachines(spawns: readonly MachineSpawn[]): Machine[] {
  return spawns.map((m, id) => ({ ...m, id, phase: 'idle', cycle: -1, charge: 0, hitPlayer: false, hitIds: [] }));
}

/** 只由世界時間決定：同樣的時間永遠是同樣的狀態（重播與重試一致）。 */
function stateAt(m: Machine, time: number): { phase: Machine['phase']; cycle: number; charge: number } {
  const since = time - m.start;
  if (since < 0) {
    const ahead = -since;
    return ahead <= m.warn ? { phase: 'warn', cycle: -1, charge: 1 - ahead / m.warn } : { phase: 'idle', cycle: -1, charge: 0 };
  }
  const cycle = Math.floor(since / m.period);
  const c = since - cycle * m.period;
  const up = m.kind === 'vent' ? m.burn : MACHINE.flash;
  if (c < up) return { phase: 'fire', cycle, charge: 1 };
  const ahead = m.period - c;
  if (ahead <= m.warn) return { phase: 'warn', cycle, charge: 1 - ahead / m.warn };
  return { phase: 'idle', cycle, charge: 0 };
}

function fire(w: World, m: Machine): void {
  w.emit({ type: 'machineFire', id: m.id, kind: m.kind, x: m.x, y: m.kind === 'dart' ? MACHINE.dartY : 0.1, z: m.z });
  if (m.kind === 'vent') {
    m.hitPlayer = false;
    m.hitIds = [];
    spawnArea(w, 'fire', m.x, m.z, { radius: m.radius, life: m.burn }, true);
    return;
  }
  const from = { x: m.x + m.dx * 0.12, y: MACHINE.dartY, z: m.z + m.dz * 0.12 };
  w.projectiles.push({
    id: w.nextId++, kind: 'bolt', owner: -1, damage: m.damage, source: '機關箭',
    pos: { ...from }, vel: { x: m.dx * m.speed, y: 0, z: m.dz * m.speed },
    radius: PROJECTILES.bolt.radius, gravity: 0, age: 0, alive: true, hitSet: new Set(),
    next: { ...from }, avgVel: { x: 0, y: 0, z: 0 }, deflected: false, tip: null, payload: 'smoke',
  });
}

/** 每個世界子步：預警 → 發動；噴火口在火焰期間燙到誰就傷誰一次。 */
export function updateMachines(w: World): void {
  const p = w.player;
  for (const m of w.machines) {
    const s = stateAt(m, w.time);
    if (s.phase === 'warn' && m.phase === 'idle') w.emit({ type: 'machineWarn', id: m.id, kind: m.kind, x: m.x, y: m.kind === 'dart' ? MACHINE.dartY : 0.1, z: m.z });
    m.charge = s.charge;
    if (s.cycle > m.cycle && s.cycle >= 0) {
      m.cycle = s.cycle;
      fire(w, m);
    }
    m.phase = s.phase;
    if (m.kind !== 'vent' || m.phase !== 'fire') continue;
    const reach = (x: number, z: number, r: number) => Math.hypot(x - m.x, z - m.z) <= m.radius + r * 0.5;
    if (!m.hitPlayer && !p.dead && p.armor.ench !== 'fireproof' && reach(p.x, p.z, PLAYER.radius)) {
      m.hitPlayer = true;
      w.damagePlayer(m.damage, '噴火口', m.x, m.z);
    }
    for (const e of w.enemies) {
      if (!e.alive || e.perched || m.hitIds.includes(e.id) || !reach(e.x, e.z, e.radius)) continue;
      m.hitIds.push(e.id);
      damageEnemy(w, e, m.damage, { source: 'fire', sneak: false, head: false, x: e.x, y: 0.3, z: e.z });
    }
  }
}

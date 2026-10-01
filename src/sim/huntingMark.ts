import { TALENT_FX, WEAPONS } from '../config';
import { dirFromYawPitch } from '../core/math';
import { AIM_EYE_Y } from './aim';
import { segmentEnemy } from './characterHit';
import { meleeCandidates } from './meleeTargets';
import { hasTalent } from './progress';
import type { Enemy } from './types';
import type { World } from './world';

/** A normal arrow opens one target-local, world-time window. No stored player buff. */
export function applyHuntingMark(w: World, e: Enemy): void {
  if (w.player.cls !== 'huntress' || !hasTalent(w.player, 'mark') || !e.alive) return;
  e.huntingMarkUntil = w.time + TALENT_FX.markWindow;
}

/** Use exactly the first body under the reticle, never search behind it for a mark. */
function bowTarget(w: World): Enemy | undefined {
  const p = w.player;
  const from = { x: p.x, y: AIM_EYE_Y, z: p.z };
  const d = dirFromYawPitch(p.yaw, p.pitch);
  const to = { x: from.x + d.x * 60, y: from.y + d.y * 60, z: from.z + d.z * 60 };
  let first = w.grid.segmentHit(from, to)?.t ?? 1;
  let target: Enemy | undefined;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const hit = segmentEnemy(from, to, e, 0);
    if (hit && hit.t < first) { first = hit.t; target = e; }
  }
  return target;
}

/** Called only when an eligible action is committed. A later miss never refunds it. */
export function consumeHuntingMark(w: World, tool: 'melee' | 'tipped'): boolean {
  const p = w.player;
  if (p.cls !== 'huntress' || !hasTalent(p, 'mark')) return false;
  const e = tool === 'melee'
    ? meleeCandidates(w, p.weapon.id, p.yaw, WEAPONS[p.weapon.id].reach)[0]
    : bowTarget(w);
  if (!e?.alive || (e.huntingMarkUntil ?? 0) <= w.time) return false;
  e.huntingMarkUntil = 0;
  w.emit({ type: 'buff', kind: 'mark', text: '狩獵標記：換工具，縮短準備' });
  return true;
}

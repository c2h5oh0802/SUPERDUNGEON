import { NOISE } from '../config';
import { T } from './grid';
import type { World } from './world';

/** Loud fighting carries around furniture inside its current room. This bounded
 * acoustic flood never leaves that room or crosses a solid wall/closed door.
 * It returns audible cells, not targets or enemy/player knowledge. */
export function combatRoomCells(w: World, x: number, z: number, radius: number, source: string): Set<number> {
  const cells = new Set<number>();
  const loud = source === 'combat' || source === 'shout' || source === 'shield' ||
    (source === 'impact' && radius >= NOISE.combatHit);
  if (!loud) return cells;
  const room = w.level.rooms.find((r) => x >= r.x0 && x < r.x0 + r.w && z >= r.z0 && z < r.z0 + r.h);
  if (!room) return cells;
  const open = (i: number, j: number) => {
    if (i < room.x0 || i >= room.x0 + room.w || j < room.z0 || j >= room.z0 + room.h) return false;
    const tile = w.grid.get(i, j);
    if (tile === T.Wall || tile === T.Void) return false;
    const door = w.grid.doorAt(i, j);
    return !door || door.arch || door.progress >= .9;
  };
  const i = Math.floor(x), j = Math.floor(z);
  if (!open(i, j)) return cells;
  const queue = [j * w.grid.w + i]; cells.add(queue[0]!);
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k]!, ci = c % w.grid.w, cj = Math.floor(c / w.grid.w);
    for (const [ni, nj] of [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]]) {
      const next = nj! * w.grid.w + ni!;
      if (!cells.has(next) && open(ni!, nj!)) { cells.add(next); queue.push(next); }
    }
  }
  return cells;
}

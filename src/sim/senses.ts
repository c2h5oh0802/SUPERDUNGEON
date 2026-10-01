import { PLAYER, TALENT_FX } from '../config';
import { angleDiff, yawFromDir } from '../core/math';
import { hasTalent } from './progress';
import type { GameEvent } from './types';
import type { World } from './world';

/** A short memory of a sound, never an enemy tracker. No identity or position leaves this helper. */
export interface SoundCue {
  /** Event-time player-relative bearing: 0 front, 2 left, 4 behind, 6 right. */
  sector: number;
  /** Active real seconds, deliberately independent of slowed world time. */
  expiresAt: number;
}

export const MAX_SOUND_CUES = 4;

/** Coarse, eight-way direction only. Turning or moving later cannot refine this snapshot. */
export function soundSector(dx: number, dz: number, playerYaw: number): number {
  const sectors = TALENT_FX.sensesSectors;
  const sector = Math.round(angleDiff(yawFromDir(dx, dz), playerYaw) / (Math.PI * 2 / sectors));
  return ((sector % sectors) + sectors) % sectors;
}

/** Reuse actual enemy sound events; awareness/state changes and generic impacts are not sounds here. */
function isEnemySound(event: GameEvent): boolean {
  switch (event.type) {
    case 'enemyStep':
    case 'enemyWindup':
    case 'enemyLock':
    case 'enemyStrike':
    case 'enemyFire':
      return true;
    case 'noise':
      return event.source === 'door' || event.source === 'shout';
    default:
      return false;
  }
}

export function expireSenses(w: World): void {
  if (w.player.cls !== 'huntress' || w.player.dead || !hasTalent(w.player, 'senses')) {
    w.senses.length = 0;
    return;
  }
  w.senses = w.senses.filter((cue) => cue.expiresAt > w.realTime);
}

/** Called from the existing World.emit path. Does not run AI or generate additional noise. */
export function recordSensesEvent(w: World, event: GameEvent): void {
  const p = w.player;
  if (p.cls !== 'huntress' || p.dead || !hasTalent(p, 'senses') || !isEnemySound(event)) return;
  // A door's own id is not an enemy id. Only its existing attributed noise is accepted.
  if (event.id === undefined) return;
  const enemy = w.enemies.find((e) => e.id === event.id);
  if (!enemy?.alive || enemy.state === 'sleep') return;
  const x = event.x ?? enemy.x;
  const z = event.z ?? enemy.z;
  const dx = x - p.x;
  const dz = z - p.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) ||
      Math.hypot(dx, dz) > TALENT_FX.sensesRange ||
      Math.hypot(enemy.x - p.x, enemy.z - p.z) > TALENT_FX.sensesRange) return;
  const eye = { x: p.x, y: PLAYER.eyeHeight, z: p.z };
  const head = { x: enemy.x, y: enemy.y + enemy.height - 0.2, z: enemy.z };
  if (w.canSee(eye, head)) return;

  expireSenses(w);
  const sector = soundSector(dx, dz, p.yaw);
  // Merge same-direction sounds rather than exposing an enemy count or filling the HUD.
  w.senses = w.senses.filter((cue) => cue.sector !== sector);
  w.senses.push({ sector, expiresAt: w.realTime + TALENT_FX.sensesCueSeconds });
  if (w.senses.length > MAX_SOUND_CUES) w.senses.shift();
}

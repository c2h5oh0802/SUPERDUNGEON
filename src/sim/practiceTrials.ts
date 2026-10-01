import type { PlayerClass } from '../config';
import { createTrialLevel, type PracticeTrialId } from '../gen/practiceTrials';
import { validateLevel } from '../gen/validate';
import { addItem, identify } from './items';
import { applyTalent } from './progress';
import { World } from './world';

/** New, disposable world on every retry. No campaign RunState or carry is accepted. */
export function createTrialWorld(id: PracticeTrialId, cls: PlayerClass): World {
  const level = createTrialLevel(id);
  const validation = validateLevel(level);
  if (!validation.ok) throw new Error(`Invalid practice trial: ${validation.errors.join(', ')}`);
  const w = new World(level, { cls });
  // Explicit trial kit: one known AoE bottle of each kind, or paid conversion.
  for (const item of ['potion:frost', 'potion:gas'] as const) {
    addItem(w, item);
    identify(w, item);
  }
  if (cls === 'huntress') {
    applyTalent(w, 'mark');
    applyTalent(w, 'apothecary');
    w.player.tipped = { paralysis: 1, chill: 1 };
  }
  w.drainEvents();
  return w;
}

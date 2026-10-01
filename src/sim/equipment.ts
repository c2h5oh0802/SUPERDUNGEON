import { ARMORS, PROJECTILES, STEALTH, UPGRADE, WEAPONS, type ArmorId, type WeaponId } from '../config';

// Equipment baseline calculations shared by simulation, inventory and upgrade previews.
// Contextual hit modifiers (surprise, vulnerability, combo) stay in the combat pipeline.
export function weaponDamage(id: WeaponId, level: number): number {
  return WEAPONS[id].damage + WEAPONS[id].perLevel * level;
}

export function armorReduction(id: ArmorId, level: number): number {
  return Math.min(UPGRADE.armorMaxReduce, ARMORS[id].reduce + (id === 'cloth' ? 0 : UPGRADE.armorPerLevel * level));
}

/** First effective cap; old higher-level items remain untouched. */
export function armorUpgradeLimit(id: ArmorId): number {
  for (let level = 0; level < UPGRADE.maxLevel; level++) {
    if (armorReduction(id, level + 1) <= armorReduction(id, level)) return level;
  }
  return UPGRADE.maxLevel;
}

export function bowDamage(level: number, head: boolean): number {
  return (head ? PROJECTILES.arrow.head : PROJECTILES.arrow.body) + (head ? UPGRADE.bowHead : UPGRADE.bowBody) * level;
}

export function armorFootstepRadius(id: ArmorId): number {
  return STEALTH.footstepRadius * ARMORS[id].stepMul;
}

export function armorSneakSpeedMul(id: ArmorId, lightstepSpeed = 1): number {
  return STEALTH.sneakSpeedMul * ARMORS[id].sneakSpeedMul * lightstepSpeed;
}

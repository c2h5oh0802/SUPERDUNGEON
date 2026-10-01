/** Compact publication record; full raw traces may be retained via --raw. */
export function summarize(r) {
  return {
    trial:r.trial, policy:r.policy, errorDeg:r.errorDeg, reactionSeconds:r.reactionRealSeconds,
    outcome:r.stop, cleared:r.cleared, worldSeconds:r.worldTime, realSeconds:r.realTime,
    hp:r.hp, maxHp:r.maxHp, damage:r.damageTaken, damageBySource:r.damageBySource,
    kills:r.stats.kills, shots:r.stats.shots, hits:r.stats.shotHits, tipHits:r.stats.tipHits,
    ammoRemaining:r.ammoRemaining, actions:r.actions, damageByTool:r.damageByTool,
    control:r.control, exposure:r.exposure, distance:r.distanceMoved,
    archerFires:r.events.enemyFire||0, shieldBlocks:r.events.shield||0,
    bottles:r.eventLog.filter(e=>e.type==='throw').map(e=>e.source),
    choices:r.choices.map(c=>c.chosen),
  };
}
export const explorationColumns=['trial','policy','errorDegrees','reactionSeconds','outcome','cleared','worldSeconds','realSeconds','damage','kills','shots','arrowRemaining','paralysisRemaining','chillRemaining','actions','archerLOSSeconds'];
export function historical(r) {
  return [r.trial,r.policy,r.errorDeg,r.reactionRealSeconds,r.stop,r.cleared,r.worldTime,r.realTime,r.damageTaken,r.stats.kills,r.stats.shots,r.ammoRemaining.arrows,r.ammoRemaining.paralysis,r.ammoRemaining.chill,r.actions,r.exposure.archerLOS];
}

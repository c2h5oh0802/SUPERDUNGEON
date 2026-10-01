import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const before = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const after = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const destination = process.argv[4];
for (const key of ['XP', 'huntressStart', 'bow', 'knife']) assert.deepEqual(before.config[key], after.config[key], `Base ${key} changed`);
assert.deepEqual(before.encounters, after.encounters, 'Base-kit encounter output changed');
assert.equal(before.progression.length, after.progression.length);
for (let i = 0; i < after.progression.length; i++) {
  const a = after.progression[i], b = before.progression[i];
  for (const key of ['seed', 'fraction', 'generatedTotalXp', 'xp', 'level']) assert.deepEqual(a[key], b[key], `XP supply changed: ${key}`);
  assert(a.talentChoices <= 4);
  assert.equal(new Set(a.talents).size, a.talents.length);
  assert(!a.talents.includes('toughness'));
}
for (const e of after.exhaustion) {
  assert.equal(e.level, 10); assert.equal(e.choiceCount, 4); assert.equal(e.talents.length, 4);
  assert.equal(new Set(e.talents).size, 4); assert.equal(e.pending, null); assert.equal(e.queue, 0);
  for (const choice of e.log) assert(choice.options.every(t => !choice.ownedBefore.includes(t)));
}
const range = values => ({ min: Math.min(...values), max: Math.max(...values) });
const summary = {
  checks: ['unchanged XP thresholds and enemy values', 'unchanged base loadout/bow/knife', 'unchanged all base-kit encounter output', 'unchanged generated and credited XP', 'no Toughness in new pool', 'incremental and bulk exhaustion unique/empty'],
  seeds: new Set(after.progression.map(r => r.seed)).size,
  encounterRows: after.encounters.length,
  exposure: [0.3, 0.7, 1].map(fraction => {
    const rows = after.progression.filter(r => r.fraction === fraction);
    return { fraction, xp: range(rows.map(r => r.xp)), level: range(rows.map(r => r.level)), choices: range(rows.map(r => r.talentChoices)),
      level10Seeds: rows.filter(r => r.level === 10).map(r => r.seed),
      floors: rows[0].floors.map((f, i) => ({ floor: f.floor, xp: range(rows.map(r => r.floors[i].xp)), level: range(rows.map(r => r.floors[i].level)), choices: range(rows.map(r => r.floors[i].choices)) })) };
  }),
  baseKit: { allRowsExactlyEqual: true, cleared: after.encounters.filter(r => r.cleared).length, dead: after.encounters.filter(r => r.dead).length,
    normalShots: after.encounters.reduce((n, r) => n + r.actions.normal, 0), paralysis: after.encounters.reduce((n, r) => n + r.actions.paralysis, 0),
    chill: after.encounters.reduce((n, r) => n + r.actions.chill, 0), melee: after.encounters.reduce((n, r) => n + r.actions.melee, 0),
    completedHealing: after.encounters.reduce((n, r) => n + r.healingUsed, 0) },
};
if (destination) writeFileSync(destination, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

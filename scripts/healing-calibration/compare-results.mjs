import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const dir = resolve(process.argv[2] || 'docs/healing-baselines');
const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const key = r => [r.seed, r.cls, r.policy, r.guard, r.bot].join('/');
const fields = ['damageTotal', 'healingInitial', 'healingFound', 'healingUsed', 'healingCompleted', 'healingRestored', 'healingWasted', 'healingRemaining', 'deaths', 'floorReached', 'finalHp', 'finalMaxHp', 'foodFound', 'foodUsed', 'foodRemaining', 'endHunger', 'starvationHP', 'upgradeChoices', 'worldTime', 'complete', 'policyCompleted'];
const compact = r => ({ ...Object.fromEntries(fields.map(f => [f, r[f]])), hpEnteringFloors: r.floors.map(f => ({ floor: f.floor, hp: f.hpAtStart, maxHp: f.maxHpAtStart })), floors: r.floors.map(f => ({ floor: f.floor, encounter: f.encounter, hpAtStart: f.hpAtStart, hpAtEnd: f.hp, damage: f.damage, healingAtStart: f.healingAtStart, healingFound: f.healingFound, healingUsed: f.healingUsed, healingRemaining: f.healingRemaining, healingGroundRemaining: f.healingGroundRemaining, foodUsed: f.foodUsed, endHunger: f.endHunger, upgradeChoices: f.upgradeChoices, bagSlotsAtEnd: f.bagSlotsAtEnd, outcome: f.outcome, ok: f.ok })) });
const variants = ['','-upgrades'].map(suffix => {
  const before = read(`before${suffix}.json`), after = read(`after${suffix}.json`);
  const bm = new Map(before.results.map(r => [key(r), r]));
  assert.equal(after.results.length, before.results.length, 'Unequal matrix size');
  const results = after.results.map(a => { const b = bm.get(key(a)); assert(b, `Missing paired baseline ${key(a)}`); return { seed: a.seed, cls: a.cls, policy: a.policy, guard: a.guard, bot: a.bot, before: compact(b), after: compact(a) }; });
  return { variant: suffix ? 'upgrade-seeking sensitivity' : 'primary simple-melee control', before, after, results };
});
const supplyBefore = read('before-supply.json'), supplyAfter = read('after-supply.json');
const output = { harnessVersion: 'healing-economy-comparison-v1', supply: { before: supplyBefore.results.map(r => ({ seed: r.seed, chestCount: r.chestCount, generatedHealing: r.generatedHealing })), after: supplyAfter.results.map(r => ({ seed: r.seed, chestCount: r.chestCount, generatedHealing: r.generatedHealing })) }, variants: variants.map(v => ({ variant: v.variant, results: v.results })) };
writeFileSync(join(dir, 'comparison.json'), JSON.stringify(output, null, 2) + '\n');
const summarize = (rs) => {
  const span = f => [Math.min(...rs.map(r => r[f])), Math.max(...rs.map(r => r[f]))];
  const sum = f => rs.reduce((n, r) => n + r[f], 0);
  return { n: rs.length, deaths: sum('deaths'), floor1Deaths: rs.filter(r => r.deaths && r.floorReached === 1).length,
    wins: rs.filter(r => r.complete).length,
    healingFound: { total: sum('healingFound'), range: span('healingFound') },
    healingReserved: { total: sum('healingUsed'), range: span('healingUsed') },
    healingCompleted: { total: sum('healingCompleted'), range: span('healingCompleted') },
    healingRestored: { total: sum('healingRestored'), range: span('healingRestored') },
    healingRemaining: span('healingRemaining'), upgradesUsed: span('upgradeChoices'),
    foodFound: span('foodFound'), foodUsed: span('foodUsed'), foodRemaining: span('foodRemaining'),
    hungerFinal: span('endHunger'), starvationHP: span('starvationHP'), floorReached: span('floorReached') };
};
const summary = Object.fromEntries(variants.map(v => [v.variant, Object.fromEntries(['before','after'].map(phase => {
  const rs = v[phase].results.filter(r => !r.guard);
  return [phase, { ...summarize(rs), byClass: Object.fromEntries(['warrior','huntress'].map(cls => [cls, summarize(rs.filter(r => r.cls === cls))])) }];
}))]));
writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const range = (rs, f) => { const ns=rs.map(r=>r[f]); const lo=Math.min(...ns), hi=Math.max(...ns); return lo === hi ? String(lo) : `${lo}–${hi}`; };
const pair = (b,a) => `${b} → ${a}`;
const hp = r => r.floors.map(f => `${f.floor}:${f.hpAtStart}/${f.maxHpAtStart}`).join(', ');
const stock = r => `${r.healingFound}/${r.healingUsed}/${r.healingRemaining}`;
const rows = ['# Healing economy: paired deterministic measurements', '', 'Before → after throughout. Values are measured, not estimates. HP-restored proxies and natural-death controls are separate evidence. See METHODOLOGY.md and ASSESSMENT.md for limits.', '', '## Generated supply', '', '| Seed | Chests/chapter | Generated healing | Start healing Warrior/Huntress |', '|---|---:|---:|---:|'];
for (let i=0;i<supplyBefore.results.length;i++) { const b=supplyBefore.results[i], a=supplyAfter.results.find(r=>r.seed===b.seed); rows.push(`| ${b.seed} | ${pair(b.chestCount,a.chestCount)} | ${pair(b.generatedHealing,a.generatedHealing)} | ${pair(`${supplyBefore.starts.warrior.healing}/${supplyBefore.starts.huntress.healing}`, `${supplyAfter.starts.warrior.healing}/${supplyAfter.starts.huntress.healing}`)} |`); }
for (const v of variants) {
  rows.push('', `## ${v.variant}`, '', '### Full-chapter HP-restored exposure proxies', '', 'Ranges cover the three fixed seeds. Artificial HP restoration suppresses healing demand; zero use is not evidence of sufficient or excessive supply.', '', '| Class / route | Completed | Damage HP | Healing found/used/left | Food found/used/left | End Hunger | Starvation HP | Upgrades used |', '|---|---:|---:|---|---|---:|---:|---:|');
  for (const cls of ['warrior','huntress']) for (const policy of ['normal','heavy','full_clear']) { const b=v.before.results.filter(r=>r.guard&&r.cls===cls&&r.policy===policy), a=v.after.results.filter(r=>r.guard&&r.cls===cls&&r.policy===policy); const multi=(rs,fs)=>fs.map(f=>range(rs,f)).join('/'); rows.push(`| ${cls} / ${policy} | ${pair(`${b.filter(r=>r.complete).length}/3`,`${a.filter(r=>r.complete).length}/3`)} | ${pair(range(b,'damageTotal'),range(a,'damageTotal'))} | ${pair(multi(b,['healingFound','healingUsed','healingRemaining']),multi(a,['healingFound','healingUsed','healingRemaining']))} | ${pair(multi(b,['foodFound','foodUsed','foodRemaining']),multi(a,['foodFound','foodUsed','foodRemaining']))} | ${pair(range(b,'endHunger'),range(a,'endHunger'))} | ${pair(range(b,'starvationHP'),range(a,'starvationHP'))} | ${pair(range(b,'upgradeChoices'),range(a,'upgradeChoices'))} |`); }
  rows.push('', '### Unprotected controls, stopping naturally', '', 'F/U/L = acquired healing units / reserved units / remaining units. Reservation can precede death; completed/restored values are in JSON. “Reached floor” is not a completion claim.', '', '| Class / seed / route | Damage HP | Healing F/U/L | Deaths / floor reached | HP entering floors, before → after | Final HP | End Hunger | Food used | Upgrades used |', '|---|---:|---|---|---|---:|---:|---:|---:|');
  for (const a of v.after.results.filter(r=>!r.guard)) { const b=v.before.results.find(r=>key(r)===key(a)); rows.push(`| ${a.cls} / ${a.seed} / ${a.policy} | ${pair(b.damageTotal,a.damageTotal)} | ${pair(stock(b),stock(a))} | ${pair(`${b.deaths}/${b.floorReached}`,`${a.deaths}/${a.floorReached}`)} | ${pair(hp(b),hp(a))} | ${pair(b.finalHp,a.finalHp)} | ${pair(b.endHunger,a.endHunger)} | ${pair(b.foodUsed,a.foodUsed)} | ${pair(b.upgradeChoices,a.upgradeChoices)} |`); }
}
rows.push('', 'Raw JSON retains per-floor damage, healing, remaining ground healing, entry/end HP, Hunger, food, gear and bag occupancy. Source SHA-256 sidecars identify the exact measured source.');
writeFileSync(join(dir, 'comparison.md'), rows.join('\n') + '\n');
console.log(`Wrote ${output.variants.reduce((n,v)=>n+v.results.length,0)} paired scenarios and generated supply comparison`);

# Huntress Progression v2: independent assessment

## Findings

- Across 20 seeds, the complete generated Chapter 1 enemy supply is **242–274 XP**, enough for **level 9–10**. The reworked pool yields **four choices/four unique talents**. The same source-generated XP and levels match the immutable healing baseline.
- The deterministic 30% exploration exposure plus all arena enemies yields **80–98 XP, level 5 and two choices**. At 70% it yields **170–207 XP, level 7–8 and three or four choices**. These are XP supply ledgers, not routes or timed campaign playthroughs.
- Full supply by floor: F1 **37–49 XP / level 3–4 / 1–2 choices**; F2 **85–108 / level 5–6 / 2–3 choices**; F3 **152–183 / level 7–8 / 3–4 choices**; F4 **233–265 / level 9 / 4 choices**; F5 **242–274 / level 9–10 / 4 choices**. Therefore full-clear players can exhaust the four-talent pool before the arena; level 10 still gives its existing HP growth, without an empty fifth modal.
- Both incremental threshold credit and one bulk 270-XP credit now end at level 10 with four unique talents and no pending/queued choice. Review found and reproduced stale queued offers before the fix: a bulk grant could waste choices on already-owned talents. The final candidate refreshes queued choices against current ownership and skips exhausted offers.
- **All 24 talent-free encounter outputs are exactly equal before/after**, including failures, enemy HP, normal shots, tips, knife, potion completion/interruption, world/real time, damage and ammo. Starting loadout, bow timing, knife data, XP thresholds and kill values also compare equal.

## Representative base-kit rows

The following are the 1.5° sampled-aim `mixed` controls. Every value is identical in baseline and candidate. Each starts with one explicitly granted known healing potion; no talent is selected. See `after.json` for all 24 rows, the 4° controls, hits, stock recovery and remaining enemy HP.

| Composition | Result | World seconds | Damage taken | Ordinary / paralysis / chill / knife actions | Completed healing |
|---|---|---:|---:|---|---:|
| Guard | clear | 4.6833 | 6 | 1 / 2 / 0 / 3 | 1 |
| Charger | clear | 2.8833 | 4 | 1 / 0 / 1 / 2 | 0 |
| Archer | clear | 0.5333 | 0 | 1 / 0 / 0 / 0 | 0 |
| Guard + archer | clear | 5.5500 | 10 | 2 / 2 / 0 / 3 | 1 |
| Two guards | dead | 5.0000 | 15 | 1 / 2 / 0 / 3 | 1 |
| Charger + guard | dead | 3.2750 | 11 | 1 / 1 / 0 / 1 | 0 |

For example, guard-only tip attempts strike a raised shield in this deliberately simple policy; they are not successful status hits. The charger+guard potion is reserved but interrupted before healing. Those costs and failures are preserved, not removed from the report. Imperfect aim matters in the archer fixture: the ranged control takes one ordinary shot at 1.5° versus four at 4°. This is a limited reproducible sensitivity check, not validation of perceived aiming difficulty.

## Code review

- Hunting Mark is per living enemy, applied only after a nonlethal ordinary arrow hit. Tipped arrows and ordinary-arrow spam cannot consume the cross-tool speed benefit. An ordinary arrow can refresh that target's three-world-second window.
- Tipped commitment checks the first body under the reticle before terrain, rather than searching behind it for a marked enemy. Knife commitment uses the same range/arc/terrain/body-first candidate helper as actual melee. Consumption happens on action commitment, so subsequent misses do not refund it.
- Only windup is multiplied by 0.6; active/recovery and damage are unchanged. For the starting knife, total action is **0.400 → 0.368 world seconds** (8% reduction); tipped bow is **0.800 → 0.752** (6% reduction). This removes the previous repeated half-duration ordinary-bow incentive without increasing base damage.
- Apothecary retains +1 capacity, requires known Frost/Gas, consumes a bottle for a complete two-tip batch, and rejects insufficient room before reservation. At starting stock 2/3, one tip must be spent before a batch fits. The existing per-floor refill is removed. Conversion shares ordinary action commitment/time and can be interrupted.
- Senses emits short event-time eight-way direction memories for nearby unseen enemy sounds. The HUD does not project hidden enemy positions or maintain enemy-ID tracking; marks remain visible-only. Footsteps reuse actual movement paths without introducing a second AI/noise propagation loop.
- Toughness is absent only from the new Huntress choice pool. Its identifier and effect remain accepted for legacy saves, preserving owned HP growth.

No additional blocking code issue was found in this review after the queued-choice correction. Unit/browser verification and production aggregate checks are reported separately by the implementation owner; these control results do not replace them.

## Remaining interpretation limits

This work does not establish human fun, desired talent frequency in real routes, full-campaign bow resource balance, whether the two-tip conversion trade is appealing, audio localization quality, or a stealth difficulty verdict. Those need player observations. The evidence here establishes supply scale, exhaustion safety, intended mechanical boundaries and preservation of the base kit under the listed reproducible cases.

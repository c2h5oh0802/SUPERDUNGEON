# Healing supply v2: provisional later-floor reduction

## Scope and intent

Human play feedback reported roughly five or six unused Healing bottles and a
full bag preventing further pickups. This pass conservatively reduces later-floor
surplus while preserving Floor 1's recovery opportunities. The separate drop-item
change addresses the full-bag interaction. Healing still stacks normally, so
removing three bottles does not itself promise three free inventory slots.

This supersedes the reliable-source budget in [Healing Integration v1](healing-potion-v1.md).
The v1 calibration files remain historical evidence, not measurements of v2.

## Source policy

| Floor | Fixed chest Healing | Fixed loose Healing | Guaranteed opportunities |
| --- | ---: | ---: | ---: |
| 1 | 2 | 1 | 3 |
| 2 | 1 | 1 | 2 |
| 3 | 1 | 1 | 2 |
| 4 | 1 | 1 | 2 |
| 5, guardian arena | 0 | 0 | 0 |
| Chapter total | 5 | 4 | **9, previously 12** |

`FIXED_CHEST_HEALING_PER_FLOOR` in `src/gen/generator.ts` makes the fixed
chest policy explicit. On Floors 2–4, the first, ember-cache chest retains its
fixed bottle. The second, sentry-vault chest loses only its fixed bottle. Both
templates use that stable room/chest order, including mirrored levels.

The change removes the stamped bottle before the existing random chest rolls.
Every chest keeps its three ammo, one smoke bottle and one random item. All
random rolls, their order, and their RNG draws remain unchanged; a random
Healing result in the reduced chest is still allowed. The fixed loose Healing
pickup, its location, and all other pickups remain unchanged.

The retained fixed chest and loose pickup remain reachable under the existing
navigation rules. A guaranteed opportunity is not an acquired bottle: reaching
the room, handling its danger and fitting the item into the bag are still required.

Unchanged: 50% maximum-HP healing rounded up, ordinary stack limit 99, zero
campaign starting Healing for both classes, no ordinary/veteran enemy Healing
rolls, an empty arena supply budget, practice supplies, six chapter rations and
four guaranteed Upgrade scrolls. This pass does not change enemy behavior,
damage, hunger or healing-item use.

## Seeded evidence

| Seed | Previous total, including random Healing | New total | Difference |
| --- | ---: | ---: | ---: |
| FLOW1 | 16 | 13 | -3 |
| FLOW2 | 14 | 11 | -3 |
| LIVING1 | 14 | 11 | -3 |

`tests/healingSupplyBudget.test.ts` records full generated-level SHA-256
fingerprints and RNG-next call counts captured from the pre-change source
matching commit `02e79d487731647a0370ab2b6aea7c15f46053b2`.
For Floors 2–4, putting back exactly the removed fixed bottle reproduces each
historical fingerprint. Floor 1, arena and practice fingerprints match without
modification. Coverage includes both templates, both mirror states, and
`HEAL-BUDGET4` Floor 2, whose sentry chest still contains its random Healing roll.

Independent budget tests exercise 12 seeds per forced template across all five
floors, verifying the 3/2/2/2/0 budget, retained-source reachability, unchanged
chest rewards, food and Upgrade totals. Other tests preserve zero starting
Healing, 50% healing and 99-item stacks.

Verified for this change:

- `npm test -- tests/healingSupplyBudget.test.ts tests/healing.test.ts`: 45 tests passed
- Expanded generator, living-dungeon, chapter-resource and save-compatibility checks with both Healing files: 134 tests passed across six files
- `npm run typecheck`: passed
- `npx eslint src/gen/generator.ts tests/healing.test.ts tests/healingSupplyBudget.test.ts`: passed
- `git diff --check`: passed

The integrated pass also reran the existing paired bot controls; see
[verification and caveats](inventory-drop.md#verification) and
[measurements](drop-healing-measurements.json). None of these checks is a new
human-play balance study. Nine guaranteed opportunities is provisional. Replay a recorded seed
through Floors 2–4 and note Healing found, used and remaining, deaths or close
calls, and whether optional-room rewards still justify their danger. Preserve
Floor 1 unless new evidence identifies a separate problem there.

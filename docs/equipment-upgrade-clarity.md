# Equipment and upgrade clarity — Ready for Human Review

2026-10-01. Based on remote `0c10d29d58de018223c581594b3faf1e5057841b` on `claude/wizardly-lamport-dlnz24`. The isolated dot-cloud worktree matched its full tree `bfd9a8d29f5fc41c3f8a78bd743c903bfc7b2ee5`. No repository AGENTS or relevant local skills were present. Fresh GitHub rulesets were empty and the branch was unprotected. No user computer was used.

## What changed

- Inventory shows actual item-level weapon damage, reach, baseline action duration, target count, and relevant knife surprise/axe secondary-hit behavior. Expand details for timing phases, phase-specific movement commitment, and attack arc. Each bag weapon compares directly with the currently equipped weapon on separate axes, without a generic DPS or better-gear score.
- Armor shows its actual capped reduction, walking footstep radius, and sneak speed relative to normal walking. Comparisons explain both protection and noise/mobility tradeoffs. Current Lightstep affects both compared sneak speeds. Sneaking remains silent and every damaging hit still deals at least 1.
- Equipped bow shows upgraded body/head damage and baseline action timing. Context-dependent buffs, counter/Mark timings, combo and enemy vulnerability remain in combat, not folded into a universal inventory score.
- Upgrade cards show exact before → after damage/reduction and the applicable cap. Weapon and bow level cap stays +5. Armor reduction stays capped at 3: leather reaches it at +2, mail at +1; cloth cannot be upgraded. Capped armor is absent from eligible choices, and the simulation independently rejects invalid direct applications.
- The scroll read button is disabled if there is no effective target. The normal action entry point rechecks eligibility before reserving a scroll. A stale selected target refreshes the remaining choices without applying another target implicitly. Delayed upgrade choices are also revalidated before display.

## Reservation and compatibility

Scrolls still leave the bag when the paid read action starts. Interrupted reads use the existing no-refund policy. Only a completed read whose targets became unavailable, or its now-empty delayed choice, returns that specific reserved scroll exactly once. If the bag filled meanwhile, a recoverable scroll is left at the player's feet. Synthetic direct calls without a real reservation do not create free scrolls. No existing gear is downgraded, normalized, refunded, or moved; older +3/+4/+5 armor remains at that stored level with the same capped protection.

There are no save-schema or generation changes. Swapping equipment keeps upgrades on that item; outgoing full-bag equipment remains recoverable under the existing policy. No new identification scroll, unknown equipment, strength gates, curses, or affixes. Equipment remains known, and unknown potion/scroll presentation still uses existing knowledge checks.

Shared small numerical helpers feed the simulation and UI. No combat values, enemy behavior/physics, resource budgets, Healing, Hunger, XP/Talent, four-exploration-plus-guardian structure, practice trials, rune removal, or Huntress legacy rules were rebalanced.

## Human review route

1. Open I with a stronger but slower weapon in the bag. Compare damage, reach, action time, and expanded movement/target details. Confirm that the tradeoff is understandable without calculating a score.
2. Compare leather +2 with mail +1: both reduce damage by 3; mail has louder steps and slower sneak movement. Test the same comparison with Lightstep.
3. Read an upgrade scroll with leather +1 or mail +0 equipped; preview must show 2 → 3. After applying, armor is no longer offered. If every other target is capped, the remaining scroll stays in the bag with its read button disabled.
4. Upgrade knife, axe and bow and compare inventory numbers before/after. Swap upgraded equipment out and back. Investment follows the item.
5. On a short viewport, expand details and reach every action and Close control by scrolling. Reopen/close the bag, choose with mouse and number keys, and verify that menus pause world time and hunger.
6. Continue an old run with over-cap armor, legacy Huntress/Healing data, and unknown potions. Stored item levels and knowledge should remain unchanged.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`: passed
- **587 tests in 32 files**: 83 new calculation/application/reservation tests, 23 new presentation tests, and 481 retained regressions (the old mail +4 → +5 test fixture now uses its effective +0 → +1 cap)
- Weapon/armor/bow type × levels 0–5 are checked against actual melee, arrow and incoming-damage simulation; coverage includes capped direct applications, stale/queued/refunded choices, no duplicated refunds, interrupted reads, full-bag recovery, item-bound investment, old saves, Healing, Hunger and talents
- All **30 existing encounter policy outputs reproduce exactly** with `node scripts/encounter-trials/run.mjs --verify`
- Read-only code review found no concrete blocker in reservation safety, unchanged arithmetic, item-bound investment, or knowledge-gated presentation; this does not substitute for browser QA
- `node --check e2e/equipment-upgrades.mjs`: passed. Vite starts on loopback and serves HTTP 200
- `npm run e2e`: all 14 scripts are **blocked at Chromium startup**, before page assertions, by `socket() failed: Operation not permitted`. This is an environment blocker, not 14 observed gameplay failures. A separate 0.0.0.0 Vite start also encountered restricted network-interface enumeration; loopback works
- The new equipment browser script covers actual inventory buttons/read/equip actions with disclosed debug-created items: numeric labels, armor cap/scroll retention, hunger pause, swaps, repeated open/close, bow previews, and short-viewport panel scrolling. It has not executed its browser assertions here

Automated presentation tests inspect generated HTML and plain text; they do not establish rendered layout, pointer-lock, audio, readability, accessibility in a real browser, balance, or fun. Human review remains necessary.

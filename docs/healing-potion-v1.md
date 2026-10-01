# Healing Potion Integration v1

Status: Ready for Human Review (subjective balance and browser gameplay unverified)

Starting remote HEAD: `9f137289427b54bdd7a677e886d113aae1d1adee`, branch `claude/wizardly-lamport-dlnz24`. A fresh isolated snapshot was checked against every Git blob and the exact remote tree `902805a5a874f17b17b2c10778ca07514143cde7`; the prior task's dirty workspace was not modified. No repository AGENTS files or additional formal instructions were present. User computer was not accessed.

## Unified rules

Healing is now part of the same unidentified Potion system. H is only a shortcut for an already-known Healing Potion; it no longer represents a separate healing resource.

- Six Potion IDs: Healing, Fire, Frost, Gas, Invisibility, Haste
- New run Warrior knows Healing + Teleport; Fire is no longer initial knowledge
- New run Huntress knows Invisibility + Mapping; Healing remains unknown
- Upgrade Scroll remains intrinsically known to everyone
- Both classes start with zero healing items. Knowledge gives no free bottle
- Same seed and appearance version yield identical potion colors, actual identities, positions, enemies and generation RNG across classes
- `HEALING_POTION.fraction = 0.5`: completion restores `ceil(maxHp * fraction)` HP, capped at maxHp; 10/12/16 max HP gives 5/6/8. No regeneration, food healing, status cure or healing over time
- H finds a known Healing stack, queues `queueUse` and calls the same `startPendingUse` reservation path as inventory. There is no direct H heal or separate resource
- The ordinary Potion action still reserves/removes one item at start and applies the effect at completion. Interruption loses the reserved bottle as other potions do, but never completes healing or identification
- Known Healing at full HP is disabled in the bag and refused by simulation/H. Unknown actual Healing can be manually drunk at full HP and identified; this spends the bottle with zero HP restored, without leaking identity through a disabled button
- Throwing Healing never heals an actor or makes a cloud. Existing beneficial potions already identify on breakage, so Healing follows that exact policy (including identification) rather than changing Invisibility/Haste behavior
- HUD counts only already-known Healing stacks. Debug data retains actual item IDs for test fixtures, as it did for all unknown items; player HUD and bag names do not expose unknown Healing counts

## Removed paths and retained systems

Removed active `Player/PlayerCarry.potions`, `Loadout.potions`, starting stock, `PLAYER.maxPotions`, fixed `PLAYER.potionHeal`, stock PickupKind `potion`, chest `potions`, stock inventory key and old direct H handler. Chest item contents are now an array so reliable healing and existing random loot both use normal physical items. Legacy numeric parsing exists solely as a one-time migration input.

Chapter 1 remains four exploration floors plus a guardian arena. Food v2, Hunger, arena Hunger freeze, Upgrade, XP/Talent, Sleep, special rooms, action economy, stealth, surprise and friendly fire were retained. Rune Altar was not reintroduced.

## Supply and balance evidence

Before: both classes start with one numeric bottle, cap3; each exploration floor has two chest bottles plus one loose bottle. Across the three calibration seeds this is **12 dungeon opportunities + 1 starting bottle**, fixed4 nominal HP each (52HP if all 13 are usable with no waste).

After: the same eight chest and four loose sources become **12 reliable physical item opportunities**, with zero starting bottles and zero ordinary Boss-floor healing. Existing random floor/chest potion rolls now include the sixth Healing identity; tested FLOW1/FLOW2/LIVING1 generated16/14/14 total bottles including the12 reliable ones. All generic ordinary/veteran enemy consumable rolls exclude Healing. No new enemy-specific healing drop or renewable source was added.

Opportunity does not equal acquisition: the player must reach the source, open its chest and fit the bottle into the ordinary bag. Full-bag bottles remain on the ground. The old cap3 limited stock acquisition; now Healing uses the standard consumable stack cap99 and ordinary10-slot bag. Thus players can retain more discovered bottles, and max-HP growth increases each bottle's heal. These are visible integration effects, not evidence that balance is final. Reliable source count was not simultaneously increased, and no extra first-floor source was added without evidence.

Full before/after scenarios, source hashes and accounting are in [healing-baselines](healing-baselines/). Bots compare normal/heavy/full-clear routes for both classes and three seeds, with protected exposure proxies separated from unprotected survival and an explicitly separate Upgrade-seeking control. The first unknown Healing choice in the survival bot is omniscient; it is not a model of human identification uncertainty. No bot can establish whether scarcity is enjoyable or Warrior knowledge is fair.

## Practice and statistics

Practice starts with three real Healing items and identifies them for both classes. Resupply replenishes that same stack up to3 using `addItem`; a full bag warns instead of silently adding invisible stock. Campaign knowledge and seed state are separate.

`healingFound` counts successful physical item pickups only (not debug/practice grants or migrated stock). `healingUsed` counts completed healing drinks. `healingRestored` and `healingWasted` track effective and clamped HP per completion. Existing `potionsUsed` is retained as the historical healing-drink statistic, incremented at that same completion, while `itemsUsed` counts all completed ordinary item uses. The former is a subset of the latter, not an independent consumption path; don't sum them as total item use. Interrupted reservation does not increment completed-use stats.

## Save compatibility

Save v2/chapter2 remains supported. New `inventoryVersion:1` and `potionLooksVersion` are explicit envelope metadata:

- Numeric legacy `potions:N` must be integer0–3. It merges into Healing stacks capped99, appending a stack if needed, then disappears from active state and all new serialization
- A full10-slot old bag may load as11 slots with the migrated Healing stack. The versioned parser permits exactly one extra slot containing Healing, and it persists safely through floor transitions and reloads until consumed. Ordinary pickup cannot add a new slot while full
- Stock >0 implies already-usable old healing, so its migrated bottle is known even for Huntress. A legacy zero-stock Huntress does not gain Healing knowledge. Existing saved Fire knowledge is preserved, since the save does not distinguish learned knowledge from prior class defaults
- Swapping equipment while over-cap now returns outgoing gear to the bag or places it as a recoverable physical item at the player's feet with feedback; it never silently deletes the old weapon/armor. Recover it before leaving the floor, as with other dropped loot
- Legacy saves without appearance metadata use version1: the exact historical five-potion shuffle and scroll mapping remain, with Healing taking the new unused sixth color. New runs use version2, a full six-color seeded shuffle on a separate RNG stream; old scroll glyph assignments remain unchanged. Legacy and new runs are intentionally versioned rather than silently remapping identified bottles
- Existing Rune removal, Hunger defaults, Sleep/timeStop alias and retired Lure migration remain

## Verification and review limits

Before integration: existing `npm test` passed325 tests in23 files against the original9f137 snapshot.

Current final verification results are recorded in `healing-baselines/verification.txt`: focused tests, typecheck, lint, complete unit suite, build, calibration assertions, syntax checks and diff checks. Focused browser scripts cover Healing/items/classes/Chapter/Hunger/floors. In this cloud environment Chromium fails before page navigation with `process_singleton_posix.cc socket() failed: Operation not permitted`; therefore no browser gameplay assertion passed. Vite startup and an in-process HTTP request return200 with the application module, which is server verification only.

An independent code review found the over-cap gear-return loss described above; it was corrected and regression-tested for both weapon and armor. Automated checks cannot establish healing balance, feel or first-floor human survivability.

## Human review route

1. Warrior new run on a recorded seed: initial Healing/Teleport known, no free bottle. Find the first Healing, take damage and press H. Confirm paid action completion and roughly50% max HP healing
2. Gain a level and repeat to check scaling. At full HP verify H does nothing and known Healing bag Use is disabled
3. Huntress on the same seed: same bottle color/location, but unknown. Wounded H must not select it; manually drink to identify. A later matching bottle can now use H
4. Test unknown actual Healing while full HP: manual experiment still works. Throw Healing: only break/identify, no healing
5. Play a whole normal chapter, then heavy exploration; record damage, healing found/used/remaining, HP entering each floor, food/Hunger and unused items at victory
6. Practice: both classes can resupply actual Healing and use H. Continue a legacy save with a full bag and verify no item loss; recover outgoing gear if swapped while over-cap

Questions for the human reviewer: is50% too much/too little, does removing the free starting bottle make Floor1 brittle, do bottles feel scarce, are ordinary mistakes recoverable, do many bottles remain unused, and does Huntress uncertainty create meaningful decisions rather than unavoidable frustration? Change those rules only after evidence. Healing numerical balance remains provisional.

## Files changed

- `README.md`
- `docs/chapter1-resources-v1.md`
- `docs/classes.md`
- `docs/healing-baselines/ASSESSMENT.md`
- `docs/healing-baselines/METHODOLOGY.md`
- `docs/healing-baselines/after-supply.json`
- `docs/healing-baselines/after-supply.json.source-sha256.json`
- `docs/healing-baselines/after-upgrades.json`
- `docs/healing-baselines/after-upgrades.json.source-sha256.json`
- `docs/healing-baselines/after.json`
- `docs/healing-baselines/after.json.source-sha256.json`
- `docs/healing-baselines/before-supply.json`
- `docs/healing-baselines/before-supply.json.source-sha256.json`
- `docs/healing-baselines/before-upgrades.json`
- `docs/healing-baselines/before-upgrades.json.source-sha256.json`
- `docs/healing-baselines/before.json`
- `docs/healing-baselines/before.json.source-sha256.json`
- `docs/healing-baselines/chapter-adapter-legacy-smoke.json`
- `docs/healing-baselines/chapter-adapter-legacy-smoke.json.source-sha256.json`
- `docs/healing-baselines/chapter-adapter-smoke.json`
- `docs/healing-baselines/chapter-adapter-smoke.json.source-sha256.json`
- `docs/healing-baselines/comparison.json`
- `docs/healing-baselines/comparison.md`
- `docs/healing-baselines/summary.json`
- `docs/healing-baselines/tooling-sha256.json`
- `docs/healing-baselines/validation.txt`
- `docs/healing-baselines/verification.txt`
- `docs/healing-potion-v1.md`
- `docs/stealth-and-loot.md`
- `e2e/chapter-resources.mjs`
- `e2e/healing.mjs`
- `e2e/items.mjs`
- `e2e/playthrough.mjs`
- `e2e/run-all.mjs`
- `index.html`
- `scripts/chapter-calibration/harness.mjs`
- `scripts/healing-calibration/compare-results.mjs`
- `scripts/healing-calibration/harness.mjs`
- `scripts/healing-calibration/run-calibration.mjs`
- `scripts/healing-calibration/supply.mjs`
- `scripts/healing-calibration/validate-results.mjs`
- `src/config.ts`
- `src/dev/devapi.ts`
- `src/gen/generator.ts`
- `src/gen/loot.ts`
- `src/main.ts`
- `src/render/fx.ts`
- `src/render/props.ts`
- `src/sim/inventory.ts`
- `src/sim/items.ts`
- `src/sim/playerSys.ts`
- `src/sim/propSys.ts`
- `src/sim/run.ts`
- `src/sim/types.ts`
- `src/sim/world.ts`
- `src/ui/hud.ts`
- `src/ui/inventory.ts`
- `tests/chapterResources.test.ts`
- `tests/classes.test.ts`
- `tests/healing.test.ts`
- `tests/healingSave.test.ts`
- `tests/hunger.test.ts`
- `tests/time.test.ts`

## Calibration result summary

Primary unprotected controls:18/18 deaths before,17/18 after; Floor1 deaths6→3, but two Huntress full-clear cases now die before finding a bottle. Upgrade-seeking controls:18/18 deaths before,11/18 after; Floor1 deaths2→2. Protected proxies complete all18 paired routes with identical damage, Hunger, food and time. All counts and caveats are in [ASSESSMENT](healing-baselines/ASSESSMENT.md). These observations justify retaining the requested first-pass formula/sources for human review, not declaring final balance.

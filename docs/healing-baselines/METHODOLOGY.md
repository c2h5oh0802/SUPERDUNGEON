# Healing calibration methodology

## Purpose and source identity

This is a deterministic healing-integration regression and resource-accounting harness, not a human balance certification. It preserves the Chapter calibration's live-world navigation and simple melee baseline and adds explicitly separated healing, HP and upgrade measurements.

BEFORE is an immutable source snapshot taken before Healing Integration edits on 2026-10-01. The source SHA-256 manifests accompanying every JSON file are authoritative. The snapshot lives outside the deliverable repository; no duplicate source tree is shipped. The parent verified the starting source tree against upstream commit `9f137289427b54bdd7a677e886d113aae1d1adee`. AFTER is bundled only after the implementation owner confirms source readiness. The runner hashes every TypeScript source file before and after bundling, aborts if they differ, and executes the frozen in-memory bundle. Editing source after bundling cannot contaminate an already running measurement.

## Reproduce

From this repository, using its existing installed dependencies:

    node scripts/healing-calibration/run-calibration.mjs . docs/healing-baselines/after.json
    UPGRADES=true node scripts/healing-calibration/run-calibration.mjs . docs/healing-baselines/after-upgrades.json
    HARNESS=supply.mjs node scripts/healing-calibration/run-calibration.mjs . docs/healing-baselines/after-supply.json
    node scripts/healing-calibration/validate-results.mjs docs/healing-baselines/before.json docs/healing-baselines/before-upgrades.json docs/healing-baselines/after.json docs/healing-baselines/after-upgrades.json
    node scripts/healing-calibration/compare-results.mjs docs/healing-baselines

To reproduce BEFORE, supply a checkout matching `before.json.source-sha256.json` in place of `.` and choose the corresponding output name. Optional `SEEDS`, `CLASSES`, `POLICIES`, `GUARDS`, `UPGRADES` and `EAT` select subsets. No downloaded dependency, production modification or browser is required.

Default matrix: FLOW1/FLOW2/LIVING1 × Warrior/Huntress × normal/heavy/full_clear × protected/unprotected = 36 scenarios. The upgrade-seeking sensitivity matrix adds another 36, separately labeled and paired only with its own policy version. Generation is class-independent; the supply census includes the five floors of each seed and both starting loadouts.

## Frozen route and action rules

- normal: visit the nearest chest, defeat at least 30% of the floor's enemies, then descend
- heavy: visit the two successively nearest chests, defeat at least 70%, then descend
- full_clear: visit every room center and room chest, defeat all remaining enemies, then descend
- Every arena run must defeat its remaining guardians before taking the Heart
- Incidental visible enemies within 2.2 m are fought while walking; pathfinding and aiming are omniscient and exact
- Both classes use their actual starting melee weapon; no Huntress bow/tipped-arrow tactic, tactical smoke, armor equip, counter timing strategy or puzzle consumable strategy is added
- The first offered talent is selected; no resources, levels, loot, enemy damage or world time are injected
- Hunger food is queued through normal `queueUse` at `HUNGER.hungryAt`; meals pause the bot's movement/attacks until completion
- In unprotected runs, whenever free to act and HP is at or below max(4, half maximum HP), the bot reserves a healing potion. Legacy stock uses H. New known healing uses H; the first unknown healing bottle uses ordinary bag `queueUse`. This is an explicitly omniscient identification shortcut: it measures survival after choosing the correct bottle, not the human cost/risk of discovering which unknown bottle heals
- Healing, reading and eating pause other bot commands while their ordinary action runs. Healing can be interrupted by death; reserved and completed counts remain distinct

The primary policy leaves upgrade scrolls unused, matching the earlier simple-melee tactic. The separately named `simple-melee-upgrade-seeking` sensitivity policy makes one additional detour per exploration floor to its generated upgrade-scroll coordinate. It reads acquired upgrade scrolls when no visible enemy is within 4 m, selecting the first eligible upgrade target. It does not invent scrolls or guarantee survival/collection. This changes route, time, combat exposure and potential food/healing encounters, so it must not be pooled with primary results.

“Full clear” is a room/chest/enemy policy, not a sweep of every ground item. Floor pickups missed, left because the bag is full, or dropped beside opened chests remain on the ground and are reported. This is deliberate: adding healing to the ordinary bag should expose real route and capacity effects rather than making the harness collect every bottle by fiat.

## Two different evidence types

### Protected exposure proxy (`guard: true`)

At the start of every frame, HP is restored to the current ordinary maximum. Enemy AI, attacks, collision, damage statistics, action timing, hunger, inventory and progression otherwise execute normally. Damage is actual simulated exposure. Entry/end HP, deaths and healing demand are artificially protected; these values must never be used to infer natural survivability or sufficient/excessive healing. Zero healing consumption is by construction.

### Unprotected natural-stop control (`guard: false`)

No HP reset or other survival assistance. Runs stop naturally at death or the source-defined win. An early death is not a full-chapter resource budget. A higher damage total before death can mean surviving longer rather than worse difficulty. Floor reached, deaths and per-floor HP make this censoring visible. If all bots die, the result limits this bot as an acceptance measure; it does not prove humans cannot finish.

## Accounting

“Found” means acquired into inventory, not generated, visible, or opened. Stock pickup events account for legacy chest stock. Item pickups are tracked by object reference, including items spawned and collected in the same frame. Initial + found + granted − used = remaining is asserted for every tracked consumable; floor progression/talent grants are kept separate.

Healing is normalized across legacy `potions` stock and `potion:healing` bag stacks. Used is reserved/removed units. Completed is the potion action reaching its effect; a character can reserve a dose and die before healing. AFTER restoration/waste uses production healing counters. BEFORE has no such counters, so the harness observes the legacy action's `fired` transition and actual HP gain adjusted for same-frame damage; each completed dose has nominal capacity 4 HP. Damage is accumulated production damage, including overkill recorded by that engine; it is not assumed to equal net lost HP.

Every per-floor record includes HP entering and leaving, maximum HP, damage, healing at entry/found/used/remaining, healing left on ground, known status, bag occupancy, Hunger entry/end/exposure, food found/used/left, upgrade use and final equipment levels. Full raw consumable counts remain in JSON. Validator asserts stock conservation, healing conservation, finite nonnegative metrics, per-floor totals, outcome consistency and exact HP carry to the next floor.

The supply census separately records generated chest count, chest contents, loose healing count and coordinates, fixed food/upgrades, and starting healing. It does not treat all generated units as acquired or usable. BEFORE all three seeds have 2 chests + 1 loose potion per exploration floor, 0 arena supply: 12 generated + 1 class-start = 13 nominal doses, each 4 HP, with the old stock cap of 3. The generic old potion pool contains no healing. Current healing instead uses the ordinary 99-unit consumable stack and a slot in the 10-slot bag; the independent stock cap of 3 is not recreated.

## Limits

The sample is three fixed seeds, two simplified perfect-aim bots, and two route families. It does not validate player skill distributions, knowledge decisions, real-world reaction time, fun, difficulty preference, or human completion. The upgrade-seeking sensitivity does not replace a class-appropriate campaign AI. Unit/integration tests and browser play checks remain separate evidence.

Hunger display-state time can include the frozen arena; actual starvation damage and Hunger values are authoritative. Frame/path/no-progress bounds are inherited from the original chapter harness. A route failure is visible as per-floor `ok: false` and `policyCompleted: false`, even if the bot later reaches a win.

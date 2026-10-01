# Chapter 1 resources and consumables v1

Status: **Ready for Human Review**. Food Economy v2 is provisional. No human acceptance or fun/survival claim is implied by the tests or bots.

Base: `779c53e73fa548635c4edf085439579954fd7a23` on the freshly verified default branch `claude/wizardly-lamport-dlnz24`. An isolated dot-cloud source tree was checked against every remote Git blob. Existing dirty trees were untouched. No repository AGENTS/override was present. Repository rulesets were empty and the branch listing reported unprotected; the integration denied detailed branch-protection access. No user computer, dependency change, infrastructure/config change, manual deployment, forced push or save wipe is part of this work.

## Playable chapter contract

- Floors 1–4 remain full exploration floors using both existing topologies. Their cyan goal is a downward stair, never a Heart victory
- Floor 5 is a separate, compact antechamber + guardian hall. Two existing enemy kinds (shield guard and charger) form the encounter skeleton. This is not a new boss AI framework
- Both guardians must die before the Heart interaction enables. Sleep cannot affect them; Frost/Gas and existing combat rules still work
- There are no ordinary ground supplies, random items, chests, food, guaranteed Upgrade Scrolls or random death drops on floor 5. Recovering a previously lodged arrow is still recovery of ammunition, not generated loot. Existing XP and floor-entry talent grants remain
- Hunger advances in the antechamber. Crossing inside the arena or damaging a guardian begins the formal encounter and freezes Hunger and its starvation remainder. Freeze persists after the guardians die until the Heart is taken; it is not reset by retreating or Teleport
- Eating, drinking, reading, equipment, projectiles and AI still spend/update normal world time during that freeze. Eating can reduce stored Hunger. Inventory/map/pause and talent/upgrade choices retain normal pause behavior
- Before/after engagement and Heart availability are visible in the objective/Hunger HUD. Already-won worlds cannot apply another starvation tick
- The existing ending was already “take Heart → immediate win.” It remains so, now with the guardian gate. There is no new escape/backtracking phase; the obsolete “return to entrance” toast is removed

Combat Action Economy v1, Living AI, surprise eligibility, friendly-fire/first-hit bolts, line of fire, equipment investment, XP/talents and the single world clock remain intact. Shift remains standing-height quiet walking, never crouch. Rune Altar, Rune choices and Rune effects are not reintroduced or transferred into consumables.

## Food Economy v2

| Setting | Value |
|---|---:|
| Hungry warning | 120 world seconds |
| Starving | 180 world seconds |
| Starvation damage | 1 HP per 15 starving world seconds |
| Ration restoration | 60 Hunger seconds |
| Eating action | 0.8 world seconds before existing Haste modifier |
| Reliable floor supply | **1 / 1 / 2 / 2 / 0** |
| Total exploration supply | **6 rations** |

No restoration buff, natural regeneration, extra Shift Hunger multiplier, all-monster food drop, food shop, cooking or extra food class. Future food-bearing creatures would be an explicitly bounded generation/drop hook; none is implemented.

The first ration is visibly on the approach just inside the first exploration room on each floor, away from spawn. The extra ration on floors 3–4 is in a deeper reachable main-path room. Food uses the normal ground-pickup/bag/eat flow. A full bag leaves the item on the ground. Existing stacks accept another ration even when all bag slots are occupied, up to 99. Eating is never a combat heal and restores only on action completion.

Placement is deterministic and adds no class-dependent RNG. Safe cells avoid traps and blocked geometry; validation checks count and reachability. There are no random survival-only drops. The existing full-bag limitation remains: ten equipment items cannot be discarded through a generic drop UI, so a player who fills every slot with equipment may be unable to collect food until a consumable slot is available. No equipment is silently deleted or replaced.

### Calibration, including rejected placements

The user's report that late full-clears run out of food is valid qualitative evidence. The measurements below quantify scripted costs; they do not rebut that report.

Fresh baseline used the Rune-free base above. Three seeds (`FLOW1`, `FLOW2`, `LIVING1`), both classes, seven policies: 42 protected timing/exposure runs; 18 separate unprotected controls. The legacy melee bot is used for both classes, not a specialized Huntress bow policy. Protected runs restore ordinary maximum HP each frame while retaining actual attacks, movement, doors, collision, damage statistics and world time. Direct/Shift/wait controls remove enemies; they do not demonstrate combat or arena survival. All unprotected controls died before finishing. See [methodology and reproduction](chapter1-baselines/METHODOLOGY.md), [before](chapter1-baselines/baseline.json), [after](chapter1-baselines/after.json), and both survival-control files.

| Policy | Before world s | Before food found / used | After world s, including arena | After found / used | After end Hunger |
|---|---:|---|---:|---|---:|
| Normal: nearest chest + ≥30% kills/floor | 139.2–179.7 | 4 / 1 | 146.2–165.1 | 4–5 / 1 | 80.3–98.2 |
| Heavy: two chests + ≥70% kills/floor | 190.5–221.9 | 4 / 2 | 204.9–239.5 | 4–5 / 2 | 79.1–112.6 |
| Full-clear: all rooms/chests/enemies | 360.8–421.4 | 4 / 4 | 367.7–408.8 | 5–6 / 5 | 61.5–101.1 |

All these after-runs completed with zero starvation HP; no artificial mandatory damage was added as an acceptance condition. Extreme `wait180` still incurred 25–27 starvation HP; late pickups cannot retroactively undo waiting damage. Guardian encounter cost in the live-combat proxies was 8.36–10.43 world seconds. Only the pre-engagement part charges Hunger. Removing guardians for direct-route controls resolves the arena immediately, so those arena Hunger values are not evidence for live encounters.

Initial center-of-room placement generated six food items but normal routes collected zero. The first revision mistakenly selected smoothed navigation corners rather than a threshold; it still missed them. Final placement samples the path segments into the first exploration room, producing 4–5 incidental acquisitions in the same normal policies. No threshold/restoration change was used to hide that discoverability defect.

Raw reports include per-floor time, food found/used/remaining, Hungry/Starving exposure, starvation HP, inventory acquisition/use/grants/remaining and unused-at-victory counts. Bots do not spend ordinary tactical potions/scrolls other than investing Upgrade when acquired; their unused hoards demonstrate the policy's limits, not a player preference or a verdict on usefulness. All conservation checks passed. A 60 Hz matrix is supplemented by existing world-time/action/physics frame-rate regression tests; no new full-chapter cross-FPS survival claim is made.

## Class knowledge and unidentified items

| Class | Initially knows |
|---|---|
| Warrior | Healing potion, Teleport scroll (Healing Integration v1) |
| Huntress | Invisibility potion, Mapping scroll |
| Both | Upgrade, equipment and food; healing stock stays 1 |

Only knowledge differs. Same seed and floor produce identical room choices, enemy identities/positions, item identities/positions, appearance assignments and drop-RNG state across classes. There are no class-specific loot rolls or bonus bottles. Existing discoveries carry across floors and saves, and old saves gain the selected class's initial knowledge without consuming RNG.

Unknown bag names/descriptions and pickup notifications show appearances only. The special rooms never identify a bottle color as their answer. Updated by the combat/identification fix: drinking identifies a potion; throwing Fire/Frost/Gas identifies only if the revealing effect is in view and unoccluded. Ineffective Invisibility/Haste/Healing breakage never identifies. Reading Sleep identifies it. Upgrade remains known and outside the unknown/random-scroll pool.

## Consumable responsibilities

| Item | Problem / use | Overlap and limits | Environment / AI / Hunger value |
|---|---|---|---|
| Fire potion | Damage a clustered or pursuing ground group in an area | Damages player too; does not pause attacks | Existing fire damage only; no new burnable terrain/prop destruction framework |
| Frost potion | Slow an enemy timeline, or extinguish a local flame pocket | Less complete control than Gas; needs correct area placement | Removes overlapping fire areas only, including persistent room fire; other fires remain. Makes optional recovery safer |
| Gas / Paralysis potion | Hold a cluster or choke while repositioning | Pauses timelines, including committed attacks, then resumes them; player may be stunned | Area control with self-risk; no global time stop |
| Invisibility potion | Cross a sentry sightline or break updates to an enemy's chase position | Sound still matters; last-known search persists; locked threats still finish | Opens a quiet optional chest route. Melee/bow/stone/shove reveal at start per existing rules; potion throws retain their prior behavior. Legal surprise still requires sleep or the existing unaware/rear conditions |
| Haste potion | Complete useful actions with lower action-world-time demand | Existing movement/wait demands can still dominate the single-clock maximum | Hunger naturally follows final world time; no extra hunger discount or movement multiplier |
| Upgrade scroll | Permanent equipment investment | Separate guaranteed budget; no nerf or replacement reward | Stronger chosen equipment trades off against other investments; never a room key |
| Teleport scroll | Escape dangerous positioning on the current floor | No damage/control; cannot skip the living guardian requirement | Buys space, but may add travel. Does not restore Hunger |
| Mapping scroll | Information about routes and optional branches | No loot granting, door opening or enemy removal | Can reduce wasted exploration/time, especially with sparse food or a risky route |
| Sleep scroll | Put nearby ordinary enemies into existing sleep state | Radius 6 m, no world freeze; ordinary veterans follow the same rule; guardians immune | Allows disengagement/quiet bypass or a legal sleep surprise. Noise, proximity and damage still wake sleepers |

The active random-scroll pool is Teleport / Mapping / Sleep; guaranteed Upgrade is separate. Lure is removed from active config/types, loot generation, practice inventory and UI. No fifth filler scroll is added.

Sleep clears ordinary precommit aim/windup and remembered chase data. Already locked aim/windup, active melee or a charge completes its threat before pending Sleep applies at recovery/reload/stun (before another attack). Already emitted bolts stay in flight. A hit cancels a pending lull and wakes a sleeper through the existing damage/AI route. It never manufactures an impossible canceled projectile, global pause or stuck phase.

## Two optional room patterns

Both patterns occupy the existing optional branches in each topology. The templates' main routes, ordinary doors and one-way shortcut remain item-free. Validation removes **all** optional-room interiors and their flame footprints from the navigation flood and still reaches the floor goal and each guaranteed solution pickup. This also covers topology B's chained D1→D2 branch; a solution cannot be hidden behind another special room's hazard.

1. **Ember side room:** a chest's direct approach/retrieval pocket is visibly on fire, built from the existing fire-area system. A same-floor Frost potion is guaranteed elsewhere in an accessible main room, independently of the Upgrade budget. Frost extinguishes the overlapping pocket and retains its normal slow area. A longer safe perimeter lets the player open the chest and obtain stock; the optional bag-item drop still needs a short visible fire risk or Frost. Fighting/HP risk/partial reward/skip are legitimate alternatives. The persistent fire does not extinguish by waiting, and the main route never passes through it
2. **Sentry vault:** two existing perched archers are aimed across the optional chest approach. A same-floor Invisibility potion is guaranteed elsewhere. Quiet invisible chest interaction preserves invisibility and avoids a new aim; a visible approach is detected. Ordinary combat, terrain/cover timing or skipping the branch remain alternatives. No unknown-item guess is compulsory

Tests establish actual differences in fire damage exposure and sentry perception/chest access. They do not prove that a human naturally thinks of those answers. Two repeated patterns are intentionally a small v1 vocabulary; no copied external rooms/assets/names or large generation framework is used.

## Upgrade budget and +5 cap

One guaranteed Upgrade on each exploration floor = **four** per chapter; none guaranteed/generated in the arena. Special-room solution bottles do not replace those scrolls. Existing deeper equipment rolls remain: floors ≥3 can already have +1 gear, currently a 50% branch in `rollEquipment`.

Possible allocations from +0:
- All four into one weapon → +4; or a naturally found +1 weapon plus four scrolls → existing +5 cap
- Weapon +2 and eligible armor +2 → offense/defense split
- Huntress bow +4 → +4 body and +8 head damage from the existing per-level bow values, foregoing melee/armor investment
- Huntress bow +2 and weapon/armor +2 → mixed investment

Armor remains capped by its existing total reduction, cloth remains ineligible, disabled legacy shield investment remains unavailable, and capped targets are not offered. With no eligible target the scroll is retained, not consumed into an empty choice. Different weapons retain their existing per-level increments. This budget is not copied from another game's three-scroll chapter; no rebalance was justified by this evidence.

## Saves and appearance migration

The storage version stays **v2**, with the existing floor-start checkpoints, storage key and death/win cleanup. New serialization adds `chapter: 2`, a chapter-layout revision marker. Legacy v2 saves without it remain accepted. There is no forced reset or mid-floor serialization.

- Old floor-4 checkpoints keep HP, Hunger, starvation fraction, food, inventory, XP, talents and upgrades, then regenerate the **new exploration floor 4** followed by arena 5. As with all existing checkpoints, the floor is regenerated rather than preserving its mid-floor actors. Changed chapter generation can change old boundary floor geometry/loot; this is an explicit content migration, not an assertion that the old layout is retained
- Old `scroll:timeStop` inventory/knowledge becomes `scroll:sleep`; no global paralysis behavior survives
- Retired `scroll:lure` inventory/knowledge is discarded without compensation or a free stronger consumable. Other unknown/corrupt item IDs still fail validation
- If old and new Sleep stacks coexist, quantities merge into ≤99 stacks, retaining overflow as another existing bag slot. Subsequent pickups choose a non-full stack/free slot or remain on the ground, so the next save remains valid
- Healing Integration v1 adds a versioned six-potion shuffle for new runs. Old checkpoints retain their five existing potion colors plus an unused sixth appearance for Healing; scroll glyphs retain the old RNG mapping in both versions. Teleport/Mapping stay identical and Sleep inherits timeStop. See [healing save compatibility](healing-potion-v1.md#save-compatibility).
- The prior removal-only Rune migration remains; Rune state/effects are not restored. Missing legacy Hunger fields retain prior 0/0 defaults

## Verification and remaining limits

- Baseline: typecheck, lint and 301 tests passed before production edits; fresh direct/normal/heavy/full-clear measurements were captured first
- Final: `npm run typecheck`, `npm run lint`, `npm test` (**325/325 in 23 files**), `npm run build`, and `git diff --check` passed against the final source
- Added chapter/resource tests cover 1→2→3→4→5 boundaries, disabled/enabled Heart, pre-engagement/active/resolved/victory Hunger, consumed actions, modal pause, empty arena loot, Sleep immunity/ordinary surprise/committed guard/charger/archer threats, pending-projectile preservation, knowledge/RNG/appearance equality, identification and saves, legacy aliases/overflow, two optional-room bypasses and solution supply, actual Frost and Invisibility benefits, food/full-bag/carry and four-scroll investment budget
- Independent review exercised 500 more generated floors (100 seeds×5), with zero retries, blocked guarantees or overlaps, plus focused suites. Final full-suite assertions are not replaced by that sampling
- Updated browser scripts cover five-floor UI/guardian gate, Hunger pickup location, class knowledge, unknown UI, paid Sleep use and removal of the obsolete escape route in playthrough. Syntax checks pass
- Browser attempts `browser`, `items`, `hunger`, `floors`, `classes`, `playthrough`, `chapter-resources` all stop before page assertions because installed Chromium fails `socket() failed: Operation not permitted`. Vite itself starts and production build succeeds. No browser pass, screenshot/visual QA, console-clean UI claim or human playthrough is claimed; no restriction bypass or user-computer fallback was used
- Remote commit identity/file hashes and the existing automatic Vercel build are checked separately after publication; no manual deployment or hosting configuration is needed

### Manual acceptance: three runs plus arena boundary

1. **Warrior normal run, fixed seed FLOW1:** verify Healing/Teleport known and other effects hidden. Explore for food and deliberately solve one problem with a potion and one with Teleport. Record consumables picked/used/unused at victory, HP, world time, food and end Hunger. Invest Upgrade as useful equipment growth
2. **Huntress same seed FLOW1:** compare identical map/enemy/item positions and appearances; only initial names differ. Use Mapping for a route decision and Invisibility for the sentry chest or patrol bypass. Check noise/locked attacks/surprise still feel legible
3. **Heavy/full-clear run:** visit both branches and all rooms; record food found/used/remaining per floor and when Hunger becomes uncomfortable. Compare the human late-run food report with this six-opportunity candidate, without assuming the bot's omniscient route or restored HP
4. **Arena boundary in any run:** wait in the antechamber and see Hunger advance. Enter/engage and see it stop while actions still progress. Try Sleep on a guardian; verify it does not sleep. Heart must remain unavailable until both die; after victory nothing ticks

Human review should judge whether the dungeon creates problems that naturally suggest different consumables, whether unused hoarding still dominates, and whether optional rooms feel like options rather than disguised keys. Those outcomes are **unproven**. Food Economy v2 remains provisional; Upgrade remains core investment; class differences are knowledge, not loot.

## Healing Integration v1 update

The old numeric healing stock is retired. Existing two chest bottles plus one loose bottle per exploration floor are real potion:healing items (12 reliable chapter opportunities); no free starting bottle, no ordinary arena source. Random floor potion rolls may add Healing; generic enemy drops cannot. Food 1/1/2/2, restoration60, four Upgrade Scrolls, local Sleep and both optional consumable-room relationships remain unchanged. Current healing balance and same-seed knowledge behavior are documented in [Healing Integration v1](healing-potion-v1.md). Historical Chapter baseline reports below describe the pre-integration stock system and are retained as historical evidence.

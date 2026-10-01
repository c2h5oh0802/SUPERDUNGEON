# Chapter resource calibration: deterministic cost/exposure measurements

## Source and purpose

Baseline source is the Git-blob-verified upstream commit `779c53e73fa548635c4edf085439579954fd7a23`. The exact source bytes are recorded in a SHA-256 manifest. Candidate measurements use the isolated Chapter v1 implementation and its separate manifest.

This harness adapts the project's earlier Hunger campaign calibration to current Rune-free APIs. It does not modify production source files.

Purpose: compare actual generated-floor traversal, action, combat exposure and resource accounting before/after one implementation, under fixed deterministic policies. Results are not human balance, fun, accessibility, or survival acceptance evidence.

## Reproduction

From the repository root, with the selected checkout's existing npm dependencies installed:

    node scripts/chapter-calibration/run-calibration.mjs . /tmp/chapter-after.json
    GUARDS=false POLICIES=normal,heavy,full_clear node scripts/chapter-calibration/run-calibration.mjs . /tmp/chapter-after-survival.json
    node scripts/chapter-calibration/validate-results.mjs /tmp/chapter-after.json /tmp/chapter-after-survival.json

To reproduce baseline results, pass a checkout of the exact baseline commit instead of `.`. The runner bundles `harness.mjs` in memory with that checkout's existing esbuild dependency, then runs Node. No new dependency or browser is required. `SEEDS`, `CLASSES`, `POLICIES`, `GUARDS` and `EAT` optionally select subsets. Default matrix: FLOW1/FLOW2/LIVING1 × Warrior/Huntress × seven policies × HP-restored guard. Survival controls use the same three live-combat policies with guard false.

## Frozen policies

All movement and actions use normal `World.frame(1/60, input)` calls. Navigation is omniscient using the existing `Nav`; aiming is exact. The first available talent/upgrade option is selected at modal choices. No teleport, forced enemy damage, fake resource drop, resource injection, or direct world-time injection is used.

- `direct`: shortest existing navigation route to the goal each floor, with enemies removed and traps retained. Measures travel/doors/goal actions; not a live stealth completion
- `normal`: nearest chest per floor, fight until at least 30% of that floor's enemies have died, then goal; incidental close enemies can add kills
- `heavy`: two successively nearest chests per floor, at least 70% kills, then goal; distinct from full clear
- `full_clear`: nearest-next traversal through every room center and room chest, then kill all surviving enemies, then goal
- `long_shift`: same traversal control as direct, holding Shift; no second Hunger multiplier
- `wait60`: wait input for 60 real seconds/floor, then same direct traversal control
- `wait180`: wait input for 180 real seconds/floor, then same direct traversal control

Food is queued through ordinary `queueUse` when Hunger reaches the current source's `HUNGER.hungryAt`. Eating pauses the bot's movement/attacks until its ordinary action finishes. Repeated frame counts for wait policies include any meal action; at the normal-rate wait/action clock this remains 60 or 180 executed world seconds unless play stops.

The same inherited simple melee policy is used for both classes, with each class's actual starting melee weapon and loadout. Within weapon reach and line of sight it attacks repeatedly; otherwise it navigates to the target and opens ordinary doors. It does not implement the Huntress's bow/tipped-arrow tactics, the Warrior's skillful counters, weapon swapping, tactical smoke, or potion/scroll strategy. Therefore zero use of those resources is a policy observation, not evidence that they are unnecessary or correctly balanced. Existing `tests/balanceBots.ts` is an arena encounter bot, not a campaign agent; it was inspected, not repurposed into a new AI project.

## Two distinct evidence types

### HP-restored cost/exposure proxies (`guard: true`)

At each frame start, the player is restored to its ordinary current maximum HP. All real attacks, enemy AI, collision, damage stats, deaths within a frame, hunger, pickups and progression still execute normally. This isolates full-campaign time and exposure even when the simple bot is poor at surviving. Recorded damage is actual simulated damage, but ending HP is artificially protected. The protection suppresses healing-potion demand. Starvation HP is recorded even though the next frame may heal it.

### Unprotected controls (`guard: false`)

No HP reset. The bot uses a stock healing potion when at or below max(4, half max HP), if not already acting. It stops naturally at death. These incomplete runs must not be extrapolated to four-floor costs or compared as if they completed. They demonstrate the limit of this bot as a survival measure, not that humans cannot finish.

## Resources and route visibility

“Found” means actually acquired, not merely generated or seen. Food on the ground away from the chosen route is not credited. Full-clear means all rooms/chests/enemies, not every ground-item location; it does not seek newly moved food or recover everything after clearing. This deliberately preserves a like-for-like route policy. `groundRemaining` records all untaken floor pickups, including inaccessible, missed and bag-cap-limited resources, so misses remain visible. It is omniscient reporting, not the bot's perception.

Stock acquisitions use actual pickup events, including chest stock given directly. Item pickups are observed by reference, including newly spawned items collected within the same frame. “Used” records inventory units reserved/removed by actions; `foodUsed` separately counts completed meals. Interrupted meals can therefore differ from reserved food. `granted` separately records positive inventory changes from talent choices or floor-start replenishment (not ground loot). Initial + found + granted − used must equal remaining for every tracked resource.

Tracked resources include class arrows/stones, smoke bottles, healing potions, paralysis/chill arrows, and each bag food/potion/scroll ID. Gear is not counted as a consumable. Bag fullness, stock caps, class-incompatible pickups and incidental drops retain normal production behavior. World/run inventory states are carried normally with `nextFloor`.

## Timing and completion

Hunger and damage use only actual executed world substeps. Hungry/starving exposure buckets are sampled at 60 Hz and have a one-frame boundary tolerance. World time is recorded from the engine's accumulated run stats; per-floor time and movement distance are measured too. Frame limits and no-progress limits prevent endless bot navigation; `policyCompleted`/per-floor `ok` expose route or fight failures even if a goal is later reached. `complete` requires the source-defined floor count ending in win.

The matrix's generated floor count, kill count, consumed/acquired/remaining resources, end Hunger, starvation HP, damage, time, classes and seeds are raw measured values. No missing run is filled with invented estimates.

## Chapter v1 architecture adaptation (harness v1.3)

The source-defined `RUN.floors` determines expected completion: baseline four floors; Chapter v1 four exploration floors followed by a fifth dedicated arena. If a level has `encounter`, every live-combat policy explicitly defeats remaining guardians before attempting the Heart. This is required to respect the new Heart gate, not a new combat tactic. Baseline source has no encounter marker, so its route/actions are unchanged. Both baseline matrices were rerun under this adapter.

Per-floor records now include `encounter`, Hunger at entry, end Hunger, food consumption, state-exposure time and starvation HP. `segments.exploration` and `segments.arena` aggregate them separately. Rounded per-floor sums can differ from exact total by a few milliseconds.

Chapter's production rule freezes Hunger during active/resolved arena state. Live melee proxies still pay Hunger while approaching before activation. Enemy-removed controls cause the arena to resolve on its first update, so their arena world time has effectively zero Hunger cost. Wait controls also add their named waiting duration on the fifth floor; this makes total world-time comparison longer, while exploratory first-four-floor cost remains separately available. “Hungry/starving time” is time spent displaying that state, including a frozen Hunger state in the arena; it must not be read as active Hunger-clock time or used to infer damage. Actual starvation HP is authoritative.

### Repository-ready scripts

The delivery version is ordinary `.mjs`, outside `tests`, with explicit Node imports and no new dependency. It passed the candidate repository's ESLint configuration. It bundles in memory, so running it does not leave generated JS inside the repository. From a repository containing `scripts/chapter-calibration/`:

    node scripts/chapter-calibration/run-calibration.mjs . /tmp/chapter-after.json
    GUARDS=false POLICIES=normal,heavy,full_clear node scripts/chapter-calibration/run-calibration.mjs . /tmp/chapter-after-survival.json
    node scripts/chapter-calibration/validate-results.mjs /tmp/chapter-after.json /tmp/chapter-after-survival.json

To reproduce the baseline, substitute the checkout containing the exact baseline source as the first argument. The runner writes a source SHA-256 sidecar and aborts if source files change during bundling. Source snapshots in sidecars, not a dirty checkout's HEAD alone, identify the measured implementation.

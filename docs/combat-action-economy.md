# Combat Action Economy v1

> Historical report for commit 600e681, before the uploaded local work was available. Its measurements and 178-test/browser status describe that commit only. The reconciled version restores living AI, surprise rules and guard stepping; spear recovery is 0.55 s (total 0.85 s), and axe secondary surprise stagger is 0.4 s. Current rules and verification are in [the reconciliation report](reconciliation.md).

Status: Ready for Human Review (browser validation blocked by this execution environment)

Base: `claude/wizardly-lamport-dlnz24`, verified remote HEAD `69120d99003ac8e7412e68cc19c0f04ede859eee`. Isolated dot cloud checkout, initially clean. No AGENTS.md / AGENTS.override.md / repo-local skills present. No push or deployment.

## Observations, hypotheses and confirmed causes

| Question | Observation / hypothesis | Confirmed cause |
|---|---|---|
| Movement overlap | Attacking while retreating costs no movement efficiency | `movePlayer` had no action cap; `computeWorldDt` takes max movement/action demand. Preserve the time rule, cap weapon movement |
| AoE | A second enemy could increase damage output for free | `meleeHits` iterated every valid arc target at full damage, with no action-wide target budget |
| Spear kite | Longest reach plus full-speed backward thrust could dominate | Spear moved 3.15 m per 0.7-second thrust. New caps reduce that to about 1.60 m, while leaving its 2.8 m reach |
| Shield/shove | Cheap action solved defense, cancellation and spacing together | `shieldBlocks` supplied defense, `shieldPush` interrupted/reset phase, and pushed enemies skipped their entire timeline |
| Bolts/LoF | Rear archer shot through front guard | Hostile `charHit` only checked player; aiming never checked allies |

Ten new mechanism contracts fail at the exact base, then pass after implementation. The base suite passes 135/135. Baseline fixture geometry was corrected before the recorded baseline: free movement cannot hit an arena wall, and all intended multiple targets are actually in reach.

## Rules

No change to `src/core/time.ts`: idle 0.1×, real-distance time, max instead of sum, capped at normal world speed, and the existing substeps remain.

Movement is a cap in every direction during windup / active / recovery. Existing acceleration still applies; initial momentum is immediately capped even when the movement key is released. Action-start weapon identity is used, so tool switching cannot evade commitment.

| Weapon | Move multipliers | Damage / reach / duration | Targets per action |
|---|---|---|---|
| Knife | 0.85 / 0.80 / 0.95 | 3 / 1.6 m / 0.4 s | One |
| Longsword | 0.65 / 0.55 / 0.80 | 4 / 2.0 m / 0.6 s | One, no secondary damage |
| Spear | 0.40 / 0.25 / 0.65 | 4 / 2.8 m / 0.7 s | First eligible body only, no piercing |
| Axe | 0.35 / 0.20 / 0.45 | 7 / 2.1 m / 1.0 s | At most two; second damage ×0.5, normal stagger 0.3 s instead of 0.6 s |

Candidates use the established arc/height/wall eligibility, ordered by nearest body edge with stable ID ties. The budget lasts through the entire action, including later active substeps. Counter cue and fast startup share this eligibility, so a nearer target cannot be ignored in order to promise a counter behind it. Counter's existing class stagger/stun takes precedence over normal axe stagger, including its secondary target. No spear minimum range or hidden damage debuff was added: the tested spacing policy was not universal.

### Warrior

- Counter and Deflect remain the core: committed attacks can be countered; active melee can deflect incoming bolts; success removes that attack's recovery
- Fixed player shield defense is disabled (`SHIELD.enabled=false`); its mesh is hidden, shield upgrades and shield talent offerings are removed
- F / right-click now performs a position-only shove: 0.4 s, 60% movement, 90° front arc, body gap ≤0.8 m, one target, 1 m displacement, no direct damage
- Shove does not block any attack and does not reset or pause windup, active, recovery, aim or reload. Physical wall/ally impact may still stagger. Charging chargers cannot be shoved
- Wall stagger 1 s, ally stumble 0.5 s, trap activation and charge-ally collision remain
- Internal action/input name `shield`, old stat fields, saved `shieldLevel`, and talent IDs remain for version-2 loading. Old investments are retained but dormant and explicitly marked in inventory/talent text. This is data compatibility, not equivalent value for the old build
- New warrior talent pool has three options; after all three have been selected there are no further talent choices. Replacement talents/refunds are deferred, not silently invented
- No-target upgrade scrolls are retained and do not open an empty modal

### Archer and bolts

- Projectile entry is analytically ordered across the existing enemy head-sphere/body-cylinder and player-cylinder proxies, then compared with the existing wall hit
- Shooter is excluded. First enemy stops a hostile bolt and takes the same base 2 damage as a player, including a friendly head contact; no player upgrades, shot-hit credit, pierce, recovered bolt ammo or arbitrary half damage
- Friendly damage source is `friendlyBolt`. The existing once-only enemy death route awards normal kill/XP/drop; no respawn or new farming source is introduced. A non-alert survivor investigates without magically learning the player's position
- Before aim and on every unlocked aim tick, an ally or wall blocking the muzzle-to-player line prevents/cancels aim. This includes the tick crossing lock time
- After lock, aim point stays fixed and ally entry never cancels the shot. Actual injury, Counter, smoke before lock and existing other physical mechanics still work
- Existing aim-line brightness, positional windup and fire sounds remain. A single distinct positional lock click was added. Rear archer can still fire; no view-cone immunity or HUD arrow

## Deterministic evidence

`tests/combatEconomyScenarios.ts` documents fixed 1/60-second inputs, ordinary HP, no forced damage, no automatic talent selection. The synthetic hp100 cases are labeled endurance stress, not encounter balance. Every scenario runs twice with identical results. JSON evidence is in `combat-baselines/`.

| Measurement | Before | After |
|---|---:|---:|
| Knife retreat distance per action | 1.80 m | 1.60 m |
| Sword retreat distance per action | 2.70 m | 1.90 m |
| Spear retreat distance per action | 3.15 m | 1.60 m |
| Axe retreat distance per action | 4.50 m | 1.69 m |
| Close sword action hit count | 2 | 1 |
| Crowded axe damage per action | 7, 7, 7 | 7, 3.5 |
| Corridor hostile bolt | Guard 0 / player 2 | Guard 2 / player 0 |
| Same committed guard, Counter | Clear 1.483 s / damage 0 | Clear 1.483 s / damage 0 |
| Same guard, repeated shield/shove | 27 pushes / damage 0 / observed cancellation 1 | 1 push / damage 12 / cancellations 0 |

The last row is a fixed naive policy outcome, not a requirement that shove must hurt the player. Single-guard no-damage spacing remains legal. Held retreat used to stay safe while swinging mostly into empty air (17 swings, one hit over 12 s); after caps the guard closes more effectively. A spacing cycle still clears single and dual guards without damage in open space, but requires extra single-target attacks; mixed and limited-space endurance do not remain safe. No result proves final balance.

## Validation and limitations

See the final verification summary at the end of this file. Focused coverage includes four weapon caps and target budgets, spear single/dual/mixed/restricted encounters, Counter/Deflect, shove non-cancellation, wall/ally/trap and charge interactions, bolt first hit including array-order/long-sweep edges, friendly head damage and once-only XP/drop, pre/post-lock LoF, cue suppression behind a body, and version-2 legacy investments.

- Collision is exact against the chosen static proxies during each existing simulation substep. It is not full moving-character continuous collision or an exact swept sphere against every cap/mesh
- Movement caps snap excess momentum at phase boundaries; stiffness and responsiveness require human play
- Stereo positional sound retains front/back ambiguity. Lock cue audibility and useful localization cannot be established by unit tests
- A stationary archer may wait indefinitely behind an ally; no tactical AI expansion
- No Hunger/Food, stamina, random hit/dodge, unavoidable chip, new class/enemy, shield inventory system, or time-engine rewrite

## Short human review entry

1. `npm ci`, `npm run dev`; open `http://127.0.0.1:5173/?dev=1&gfx=low`. Select warrior, read the updated class card, enter practice
2. Equip a spear via existing inventory/debug item grant when setting up a fixture. Compare the old continuous retreat/thrust input against one guard, then two and restricted retreat. Try controlled spacing → thrust → recover. Zero damage against one guard is valid
3. Compare sword and axe against two close enemies: sword must leave a second problem; axe should have clear cleave value without free unlimited full damage. Check movement responsiveness and whether spear still feels long
4. Compare Counter with F shove on the same committed guard. Counter cancels the attack; shove only changes position, and an active close enemy can still hit. Try wall, ally, trap and charger lanes; shove must not become the new universal loop
5. Line up player → front guard → rear archer. Before lock, ally obstruction should stop aim. Once locked, move an ally into the shot or use position to make the fixed shot hit it. Verify no bolt passes through it into player
6. Turn away from the archer. Listen for windup, new lock click and shot direction. Check mixed-threat pressure, accidental friendly-suicide frequency, and whether information is readable without a HUD arrow
7. Load an old save with shield upgrades/talents: it must load, show the dormant-investment notice, and provide no hidden defensive benefit

Human review is required for feel, numerical balance, strategy diversity and sound. Automated passing results do not establish these.

## Final verification summary

- `npm ci --ignore-scripts`: initial attempt failed because the default npm cache directory was unavailable; retry with `--cache /tmp/superdungeon-npm-cache --ignore-scripts` passed (183 packages)
- Base `npm test`: passed 135/135
- Latest ten mechanism contracts copied onto isolated exact-base sources, then `vitest run tests/actionEconomy.test.ts -t 'Combat Action Economy v1 contracts'`: expected 10/10 failures; the other five tests were excluded by the filter
- Final `npm run typecheck`: passed
- Final `npm run lint`: passed
- Final `npm test`: passed 178/178 across 15 files
- Final `npm run build`: passed, 49 modules transformed
- `node --check e2e/classes.mjs` and `node --check e2e/combat-economy.mjs`: passed syntax checks; not execution coverage
- `BROWSER_PATH=/usr/bin/chromium node e2e/classes.mjs`: failed before any browser assertion because Chromium could not create its local socket (`Operation not permitted`). An approved relaxed-process retry failed the same way. The managed dot cloud browser also could not open localhost (`ERR_BLOCKED_BY_CLIENT`)
- Focused `e2e/combat-economy.mjs` is prepared but not browser-executed; broad unrelated browser scripts were not run. No screenshot or audible-play claim is made
- Vite worked bound to `127.0.0.1`; wildcard host initially failed on the environment's network-interface enumeration
- `git diff --check`: passed
- Independent diff review found and verified fixes for the upgrade softlock and false rear Counter prompt; no remaining substantive issue reported
- Final remote read still shows base HEAD; no commit, push or deployment was performed

Human review remains required; this round contains no Hunger and does not establish final numerical or experiential balance.

## Changed files

- `README.md`
- `docs/classes.md`
- `docs/combat-action-economy.md`
- `docs/combat-baselines/after.jsonl`
- `docs/combat-baselines/before-stress.jsonl`
- `docs/combat-baselines/before.jsonl`
- `docs/stealth-and-loot.md`
- `e2e/classes.mjs`
- `e2e/combat-economy.mjs`
- `e2e/lib.mjs`
- `index.html`
- `src/audio/sfx.ts`
- `src/config.ts`
- `src/main.ts`
- `src/render/viewmodel.ts`
- `src/sim/characterHit.ts`
- `src/sim/classSys.ts`
- `src/sim/enemySys.ts`
- `src/sim/items.ts`
- `src/sim/meleeTargets.ts`
- `src/sim/playerSys.ts`
- `src/sim/projectileSys.ts`
- `src/sim/types.ts`
- `src/ui/hud.ts`
- `src/ui/inventory.ts`
- `tests/actionEconomy.test.ts`
- `tests/archerLineOfFire.test.ts`
- `tests/classes.test.ts`
- `tests/combatEconomyScenarios.test.ts`
- `tests/combatEconomyScenarios.ts`
- `tests/items.test.ts`
- `tests/projectileFirstHitEdges.test.ts`
- `tests/run.test.ts`

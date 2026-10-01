# Hunger v1 + Shift 安靜慢走

最新 [Chapter 1 resources v1](chapter1-resources-v1.md) 已改為 4 探索層＋1 首領層、Food Economy v2（1/1/2/2/0）、職業初始知識、沉睡卷軸與兩種可選資源房；本文件其餘內容含歷史版本敘述，衝突時以上述最新規格為準。

Status: **Ready for Human Review**

後續版本已[移除刻印祭壇](rune-removal.md)，天賦／強化選擇仍凍結 Hunger。以下測量是移除前的歷史基準（包含當時的祭壇路線／Rune 選擇），不是目前 Rune-free 版本的校準結果；飢餓與乾糧參數本次未改。

Exact base: `787fdfbdeabc9e33f4b25ffccecd3203ebce73b2`, default branch `claude/wizardly-lamport-dlnz24`, freshly checked through GitHubMcp. All 105 files were checked against the remote blob hashes; the local base tree is `c83f81f552999d52caadd5e0323e03bb775ab967`. A fresh isolated dot-cloud checkout was created. Existing dirty review worktrees were not edited. No user computer, remote publication, deployment, dependency change, save deletion or migration requiring reset.

The values below are provisional calibration. Bots establish mechanisms and cost ranges; they do not establish fun, accessibility, human survival balance or acceptance.

## Before-change evidence and integration

| Area | Existing path | Integration |
|---|---|---|
| Single time engine | `World.frame` → `clampRealDt` → movement/startActions → `computeWorldDt` → `World.advance` substeps | `updateHunger` only inside each executed substep, after world time increments, before action effects |
| Time rules | Idle 0.1×, actual horizontal movement/reference speed, ongoing actions and Space normal rate, max demand rather than sum, normal-speed cap | No time-engine changes, realDt deductions, per-action Hunger charges or wall-clock use |
| UI pauses | App calls World.frame only in playing mode; map/inventory/pause skip it; talent/upgrade stop frame and interrupt substeps | Hunger naturally freezes, including the unused remainder of a frame when a choice opens |
| Shift | input.sneak → player.sneaking → 0.5 movement × armor/talent; movement demand ×2 (lightstep override); footsteps suppressed | All unchanged; Hunger sees only final world time |
| Camera | renderer.crouch lowered eye by 0.35m | Remove that render-only field and lowering; eye stays 1.6m |
| Physics/detection | Player height 1.8m, radius .35m; existing ray/cylinder proxy; no Shift visual-perception modifier | All unchanged, including hostile first-hit/friendly-fire/LoF rules and AI investigation |
| Player/run persistence | Player → World.carry → nextFloor → v2 serialize/parse → World constructor | Add hunger + starvationT; states derive from hunger, no duplicated satiety resource |
| Inventory/action | ItemId, InvItem stack, pickup/addItem, pendingUse, action timeline | One `food:ration`, known item, same bag, consumes at action start and restores at completion |
| Ground loot | generator creates deterministic pickup plans | Append guaranteed entrance food after all RNG/mirroring; old loot draws/positions and enemy layouts unchanged |
| HUD | Resources beside HP, events for feedback | Compact labeled Hunger percentage bar plus state and ration count; transition events only |

Combat v1 commitments, target budgets/axe cleave, living AI, surprise, bolts, pauses and existing keyboard input are preserved. No cooking, extra food types, weight, crouch, stealth buff or new enemy system.

## State and rules

`player.hunger` is net elapsed world seconds since food reductions, initially 0 and capped at 180. `starvationT` is only a fractional damage clock, not a second food resource. Normal / Hungry / Starving are derived by `hungerState()` and are not independently saved.

All tunables are in `HUNGER` and `ACTIONS.eat` in config.ts:

| Setting | Provisional value |
|---|---:|
| Hungry | 120 world seconds |
| Starving | 180 world seconds |
| Starvation | 1 HP per 15 starving-world-seconds |
| Ration restoration | 60 Hunger world seconds, clamped to 0 |
| Eating | 0.8 world seconds, existing haste timing modifier applies |
| Campaign supply | 1 ration at each of 4 floor entrances |
| Stack maximum | 99 in one ordinary bag slot |
| Practice supply | 3 entrance rations; supply table replenishes stack to 3 |

Hungry is warning only: no damage, speed, accuracy or perception debuff. A boundary-crossing substep charges only the portion after reaching Starving. Damage uses the existing player-hurt/death/stat path and remains 1 HP with armor. Eating below Starving clears the fraction; leaving a floor or saving does not. No random damage or damage per frame. At normal idle rate, reaching Hungry from full takes 20 real minutes, illustrating that thought is cheap; action/wait time is the actual resource pressure.

A frame crossing a modal boundary updates Hunger only for substeps actually executed. A frameDelta of an hour still advances at most TIME.maxRealDt=.1 world seconds (or .01 while idle); background focus pause/reset behavior remains unchanged. No catch-up starvation.

### Food timing and edge cases

- The first normal frame at an entrance picks up its guaranteed ration through updatePickups/addItem; a full bag leaves it on the ground
- Rations stack even if all 10 slots are occupied when there is already a ration stack; at stack maximum the extra pickup stays on the ground
- I → 吃 queues an ordinary action; opening the bag and choosing does not advance world time. Once resumed, the action reserves one ration, advances enemies/world normally and restores only at completion
- Already fully fed: button disabled and simulation also refuses without consuming. Empty/missing index: no action. Food cannot be thrown. Partial restoration never produces negative hunger
- Existing interruption semantics apply: a gas stun or death cancels the reserved meal, with no delayed restoration or second consumption. The reserved ration is already spent, just like existing reserved potion/scroll actions
- Practice has food through the same bag/pickup/action path. Its supply table replenishes rations; it does not silently reset Hunger
- Existing inventory limitation: ten equipment items with no consumable/food stack provide no way to make a slot, because equipment swaps rather than discards. The ground ration is retained and level movement remains possible, but food recovery can be blocked. This predates Hunger and is now more consequential. No automatic gear deletion, reserved food slot or new discard subsystem was introduced; a voluntary generic drop action is a separate inventory decision

## Shift's exact meaning

Shift is **潛行步／安靜慢走**. Base speed remains 0.5×; mail and lightstep keep their existing modifiers. Base world-time demand per distance remains 2×. Camera eye, player height and collision proxy remain standing height; there is no ducking under a bolt. Footstep suppression and current investigation/noise rules remain. No new vision range, fill-rate or invisibility benefit.

Hunger has **no Shift multiplier**. The actual same-distance test travels exactly 9m: quiet walking consumes 2× world time and therefore 2× Hunger, with identical Hunger/world-time ratio. Multiplying Hunger again would charge for quiet walking twice and break the single-clock model.

## Save policy

Keep v2 and the existing floor-start checkpoint semantics, storage key and death/win cleanup. There is no new every-frame or midfloor save. Current carry serializes Hunger, damage remainder and ordinary ration stacks; next floor restores them before play. Old valid v2 saves missing both new numeric fields default to 0/0. No food stock property is required: an old bag without ration entries naturally has zero food and can pick up the new floor supply.

Malformed new fields (non-numeric, negative, beyond cap, damage remainder outside its interval or nonzero remainder below Starving) are rejected like other corrupt fields. Existing pre-v2 behavior is not expanded. No existing save is deleted or rejected solely for missing the newly optional fields.

## Measured calibration

Measurements preceded threshold selection. Baseline direct-route controls across six seeds cost 57.14–73.23 world seconds (median 67.89), same routes with Shift 110.93–140.37 (median129.42), Space60 seconds/floor plus direct route297.14–313.23. These remove enemies to isolate traversal, doors and goal actions. Existing flow tests also remove enemies; older browser playthrough is not a four-floor combat baseline.

Real combat baseline across FLOW1/FLOW2/LIVING1:
- Normal: nearest chest per floor, at least30% kills plus incidental blockers, then descend:141.958 /178.920 /160.407 world seconds
- Heavy: every room/chest/altar and every enemy:383.058 /428.819 /403.459 seconds, all81–87 enemies

Completed combat cost measurements restore ordinary maximum HP every frame, retaining real attacks, AI, collisions, recorded damage, XP, first-choice talents/runes and normal World.frame inputs. No teleport, forced enemy damage or direct time injection. All unprotected controls died before finishing, so these are cost/exposure measurements, **not survival proof**. Navigation is omniscient and aiming idealized. Real beginner routes may cost much more.

Candidate results (same bot policies, eating at Hunger≥120 via normal queued action):

| Seed | Policy | World s | Food found/used | End Hunger | Hungry s | Starving s | Hunger HP lost |
|---|---|---:|---:|---:|---:|---:|---:|
| FLOW1 | Direct |62.828|4/0|62.83|0|0|0|
| FLOW2 | Direct |72.225|4/0|72.22|0|0|0|
| LIVING1 | Direct |67.734|4/0|67.73|0|0|0|
| FLOW1 | Normal |148.520|4/1|88.52|0.80|0|0|
| FLOW2 | Normal |179.689|4/1|119.69|0.80|0|0|
| LIVING1 | Normal |161.159|4/1|101.16|0.80|0|0|
| FLOW1 | Heavy |399.164|4/4|159.16|42.39|0|0|
| FLOW2 | Heavy |432.220|4/4|180|84.11|12.22|0|
| LIVING1 | Heavy |412.889|4/4|172.89|67.24|0|0|
| FLOW1 | Long Shift |124.432|4/1|64.43|1.05|0|0|
| FLOW2 | Long Shift |139.404|4/1|79.40|0.80|0|0|
| LIVING1 | Long Shift |130.661|4/1|70.66|0.80|0|0|
| FLOW1 | Wait60/floor |303.580|4/4|63.58|3.20|0|0|
| FLOW2 | Wait60/floor |312.990|4/4|72.99|3.20|0|0|
| LIVING1 | Wait60/floor |308.463|4/4|68.46|3.20|0|0|
| FLOW1 | Wait180/floor |782.828|4/4|180|201.41|362.79|22|
| FLOW2 | Wait180/floor |792.225|4/4|180|201.02|372.19|23|
| LIVING1 | Wait180/floor |787.734|4/4|180|195.76|367.69|23|

LIVING1 without eating: normal160.407s,0 Hunger damage; heavy403.459s,14 damage; Wait60/floor307.734s,8 damage. Normal exploration benefits from one ration but is not guaranteed to suffer damage without it. Full clearing spends most available budget; long waiting becomes costly. Four fully useful rations add240 world seconds to the180-second grace budget. Only one candidate full clear reaches Starving, for less than one damage interval. This is intentionally conservative pending human play.

Eating changes living-enemy timing and route decisions, so candidate results are not merely baseline plus0.8s per meal. Heavy runs increased3.4–16.1 seconds. Hungry/starving exposure is sampled at60Hz with a one-frame boundary precision limit.

Raw per-floor metrics, transitions, damage and methods: [combined calibration](hunger-baselines/calibration.json), [route baseline](hunger-baselines/routes-before.json), [combat baseline](hunger-baselines/combat-before.json), [candidate](hunger-baselines/after.json). The review archive includes the standalone reproducible harness and frozen baseline/candidate source. After the practice corrections, all21 scenarios were rerun against the final source; every recorded campaign result was identical.

## Verification and limits

Final command results are also included in the review archive's verification logs.

- Exact baseline: `npm test -- --reporter=dot` →256/256 passed
- Final: `npm run typecheck` passed; `npm run lint` passed; `npm test -- --reporter=dot` →283/283 passed in21 files (27 new Hunger cases); `npm run build` passed; `git diff --check` passed
- Focused Hunger tests cover idle, wait, movement, action/throw/door, equal distance quiet walking, modal mid-frame interruption, lag clamp, both thresholds, fraction/interval/armor/death, actual enemy detection equivalence, pickup/full stack/full bag, meal time/full/empty/throw/interruption, practice replenishment, floor carry/current v2 roundtrip/old missing fields/invalid fields, and four bolt heights with normal/Shift
- App map/inventory/pause are code-traced to skip World.frame; choice pauses additionally have executed simulation tests
- New `e2e/hunger.mjs` covers the actual HUD, camera, idle/wait, inventory/map/pause/upgrade/talent freezes, starvation, eating and generated floor food. `e2e/floors.mjs` adds carry/reload and missing-fields v2 coverage. Existing item script's stale enabled-shield expectation was corrected to the current Combat v1 contract
- Attempted `hunger.mjs`, `items.mjs`, `floors.mjs`, `combat-economy.mjs` and `browser.mjs` with the installed system Chromium: all five failed at launch before assertions. Browser E2E is **not passed**: default Playwright Chromium is absent; system `/usr/bin/chromium` exits before opening a page with `socket() failed: Operation not permitted`; the managed dot cloud browser rejects localhost with `net::ERR_BLOCKED_BY_CLIENT`. No security bypass, user-computer use or false execution claim
- Syntax checks do not count as browser execution. Screenshots, browser console-clean claims, visual layout QA and human feel remain unverified

## Human review entry and checklist

Use the provided source: `npm ci`, `npm run dev`; open the displayed localhost URL in a WebGL-capable desktop browser. Use normal run seed FLOW1 or LIVING1 for full-flow play; practice has food plus a replenishing supply table. Optional `?dev=1&gfx=low` exposes read-only time/Hunger/food/camera/height evidence and explicitly labeled debug injection helpers.

1. Walk the same path normally and holding Shift. Confirm the slower, quiet steps, standing-height eye and more world time/Hunger for the same distance; hostile bolts still hit at the same height
2. Stand and think, then hold Space. Compare very slow Hunger accumulation with normal-rate waiting
3. Open I, Tab, Esc, then talent/upgrade selection. Confirm world/Hunger/damage fraction freezes; resume and check no background catch-up
4. Pick up entrance food, check its stack in I, eat while hungry. Confirm normal action ring/time, enemies still act, one item spent and restoration only after eating. Check full/empty bag and already-fed behavior without discarding unrelated equipment
5. Observe Hungry warning only. At Starving, confirm deterministic1HP/15worlds, state text/bar, recovery after food and no per-frame toast spam
6. Descend with Hunger and a partial starvation interval; reload the floor-start checkpoint and verify state/resources. Continue an older v2 save lacking Hunger fields
7. Compare direct descent, normal exploration, full clear, slow kills and long Shift. Are food decisions meaningful without becoming a recurring chore? Is entrance supply understandable? Do beginner delays make pressure excessive? Record actual route/time/food/damage before retuning

No Accepted status or human-fun verdict is implied.

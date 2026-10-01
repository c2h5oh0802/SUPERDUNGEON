# What the Healing Integration measurements establish

## Exact generated supply

The verified upstream baseline is `9f137289427b54bdd7a677e886d113aae1d1adee`. Both classes previously began with 1 stock healing potion, healing 4 HP per completed action and capped at 3 carried. Each exploration floor generated 2 chest potions + 1 loose potion, and the arena generated none. All three seeds therefore had 8 chests, 12 generated healing doses and 13 including the starting dose: 52 nominal HP before route misses, carrying cap, interruption or waste.

The implementation removes the starting dose but retains the same 12 fixed physical sources. Random exploration-floor potions can additionally be healing; enemy drops exclude healing. Neither class receives free known healing. Supply census includes actual coordinates and chest contents in `before-supply.json` / `after-supply.json`.

| Seed | Healing generated F1 / F2 / F3 / F4 / arena, before | After | Chapter total, before → after |
|---|---|---|---:|
| FLOW1 | 3 / 3 / 3 / 3 / 0 | 5 / 3 / 5 / 3 / 0 | 12 → 16 |
| FLOW2 | 3 / 3 / 3 / 3 / 0 | 3 / 4 / 4 / 3 / 0 | 12 → 14 |
| LIVING1 | 3 / 3 / 3 / 3 / 0 | 4 / 3 / 4 / 3 / 0 | 12 → 14 |

There are still exactly 2 chests per exploration floor and none in the arena. The extra measured doses are loose random potion rolls, not extra chests. Generated quantity is not acquired quantity. New dose strength scales as ceil(half current maximum HP); multiplying chapter supply by a single assumed HP value would not be a measured healing budget.

## Primary route controls

Protected proxies: all 18 before and all 18 after complete. Each paired scenario has identical damage, Hunger, food use and world time. No starvation damage occurs. Acquired healing rises from 2 in every old run (starting 1 + stock cap 3) to 4 on normal routes and 8 on heavy/full-clear routes. The new bottles occupy an ordinary bag stack with a per-stack cap of 99, replacing the independent stock cap of 3. Higher acquired count therefore reflects changed carrying capacity as well as removing the start dose; it is not evidence that more fixed sources were added. They are never used by protected proxies, by construction; this is route/acquisition evidence, not healing-demand evidence.

Unprotected simple-melee controls, 18 per version:

| Metric | Before | After |
|---|---:|---:|
| Deaths | 18/18 | 17/18 |
| First-floor deaths | 6/18 | 3/18 |
| Chapter wins | 0/18 | 1/18 |
| Floor reached | 1–3 | 1–5 |
| Healing acquired per run | 0–4 | 0–8 |
| Healing acquired, summed across 18 | 38 | 53 |
| HP actually restored per run | 4–20 | 0–83 |
| HP restored, summed across 18 | 208 | 409 |
| Healing remaining | 0 | 0 |
| Upgrade scrolls used | 0 | 0 |
| Starvation damage | 0 | 0 |

The after Warrior FLOW1 heavy route wins with 21/28 HP, 8 healing doses consumed and no dose remaining. This does not establish human survivability. Most simple bots still die; both classes use melee only. Removing the starting potion also worsens some early cases: Huntress full-clear FLOW2 and LIVING1 die before acquiring any healing, having used the old initial potion in the paired baseline. Results must not be summarized as every run improving.

## Upgrade-seeking sensitivity

This separate policy detours to the fixed upgrade-scroll location on each exploration floor and uses it through ordinary actions when no visible enemy is within 4 m. It changes route/exposure and must not be mixed into the primary results.

Unprotected controls, 18 per version:

| Metric | Before | After |
|---|---:|---:|
| Deaths | 18/18 | 11/18 |
| First-floor deaths | 2/18 | 2/18 |
| Chapter wins | 0/18 | 7/18 |
| Floor reached | 1–4 | 1–5 |
| Healing acquired per run | 2–8 | 1–8 |
| Healing acquired, summed across 18 | 66 | 89 |
| HP actually restored per run | 4–36 | 0–95 |
| HP restored, summed across 18 | 308 | 797 |
| Healing remaining | 0–2 | 0–2 |
| Upgrade scrolls used | 1–4 | 1–4 |
| Starvation damage | 0 | 0 |

All 18 protected upgrade-seeking runs complete before/after. Four after proxies use only 3 upgrades instead of 4, leaving the floor-4 scroll uncollected; bag occupancy and remaining ground items are retained in raw records. This is a meaningful ordinary-bag/route interaction to inspect, not a reason to silently force pickup or increase capacity. One protected Huntress full-clear sample reaches Hunger 180 but takes no starvation damage; frozen arena Hunger must not be mistaken for ongoing damage.

## Scope of acceptance

The retained comparison contains 144 campaign scenarios: 72 before and 72 after, counting the primary and sensitivity matrices separately. All resource conservation, HP carry, per-floor totals, outcome and production-healing-counter checks pass. Per-floor entry/final HP, damage, healing acquired/reserved/remaining, food/Hunger and upgrade use are in raw JSON; `comparison.md` presents paired results and `summary.json` supplies compact citation-ready counts.

These results support mechanical integration and expose route/stock/survival differences. They do not justify a broad rebalance, a human completion claim, or a judgment that the new supply is abundant. The unprotected policy has perfect aim and omnisciently chooses the first unknown healing bottle; it does not pay the risk/cost of human potion identification. Reserved doses can be lost before completion. No source resources, HP or AI behavior were altered to obtain unprotected wins.

The existing chapter-calibration harness also now recognizes current known bag healing for H while retaining an isolated presence-based adapter for historical stock snapshots; historical chapter JSON is unchanged. Its H-only policy does not knowingly use an unidentified healing item. A current-source smoke run and legacy-source smoke run validate the adapter separately from the richer healing-specific policy.

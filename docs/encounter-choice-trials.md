# Fixed encounter choice trials — Ready for Human Review

2026-10-01. Base: `58716fa4325b1d7ad478f7cdd994df5186644d71` on `claude/wizardly-lamport-dlnz24`. The clean isolated cloud worktree matched the entire remote tree `7c8f74510b75b7c5473729f690eaa22516e2e210`. No repository AGENTS or relevant local skill files were present. Fresh repository rulesets were empty; the default branch reported unprotected. No user computer was used.

## Why these fixtures

The N=1 playtest found normal arrows plus retreat/wait/weak-point shooting dominant, proactive knife use on self-stunned chargers, and little reason to spend Frost/Gas or use Apothecary. This pass tests enemy composition and geometry before changing balance or procedural generation. It does not establish that the previous bow loop is solved, or that any tool is necessary/best/fun.

Three separately selectable, deterministic practice worlds reuse Grid, navigation, enemies, AI, physical projectiles, inventory, and the existing practice restart path. Ground actors retain Living AI, including their normal room-center patrols; authored spawn positions are not frozen. The ordinary tutorial remains available separately.

## Player entry and observations

Main menu → choose a class (Huntress recommended for this comparison) → **固定遭遇試玩**. No developer URL or console command is needed.

1. **盾衛與弩手**: two existing enemies, a central stone screen with routes on both sides, and a side pillar. Clear both. Compare frontal waiting shots, flanking the guard, controlling the front actor, or shooting the rear archer first. Watch whether moving into an aiming lane actually costs exposure, and whether the ordinary bow is still the effortless answer.
2. **撞暈後的空檔**: a charger plus an eastern archer. Stone corners allow self-stuns; one side shields the knife approach and another is in archer sight. Clear both. Compare taking the knife bonus immediately, relocating first, or using an arrow/control tool. The entry baffle deliberately permits a forgiving first punish; this is not a forced-damage trap.
3. **窄道與繞路**: two sleeping guards and an archer in a short four-metre lane. The western screened loop goes to the same northern empty chest. Open it with E; kills are not required. Compare ordinary arrows, an AoE Frost/Gas bottle, a tipped arrow, and bypassing the fight. The chest has no reward or item lock; it is only a repeatable destination.

After a trial, press **Esc** to read current world seconds, cumulative damage, shots, and item uses, then **重置練習** to compare another approach. These are current pause-time counters, not a frozen completion score. Death uses the existing automatic practice reset. **返回主選單** lets you select another trial/class. The objective HUD marks cleared enemies or the opened destination chest.

## Explicit trial kit and isolation

- Both classes keep base equipment, HP and ordinary starting ammunition. Enemy HP is the ordinary floor-1 value; no veterans, new enemy kinds, hazards, bosses or custom combat rules.
- Each trial starts with one already-known Frost bottle and one already-known Gas bottle. Huntress temporarily receives the existing Mark and Apothecary talents, plus one paralysis and one chill arrow. Capacity is therefore 1/3, allowing the real 0.6-world-second, one-bottle-to-two-arrow conversion immediately.
- This is a disclosed test fixture, not campaign progression or a supply rebalance. There is no resupply pedestal and no mid-encounter free arrow refresh. Reset reconstructs the whole disposable world. Ordinary kill XP, drops, arrow recovery and all other existing systems remain active.
- Trials are entered only from explicit practice buttons. Typing a reserved trial seed into **開始冒險** still generates an ordinary campaign.
- Trial inventory, known identities and talents are never passed to RunState, serialized, or used by Continue. Ordinary practice's own Healing/food/resupply setup is unchanged.
- No changes to bow/knife numbers, enemy attack timing, friendly-fire, line of fire, combat wake, potion identification, Senses, Lightstep, legacy Toughness, Healing, Hunger/Food, Upgrade budgets, Sleep, Invisibility or the four-exploration-plus-guardian campaign.

## Evidence and limits

The focused tests cover deterministic resets for both classes; safe spawn geometry and two world seconds without damage; player/enemy reachability; base HP; paid conversion; absence of supply pedestals; campaign seed dispatch; knowledge/save isolation; and a real-input western bypass that opens the chest with zero damage, kills, shots or item uses.

Two additional 60 Hz real-input charger routes reproduce the positioning distinction without teleporting, editing HP or overriding AI. At a self-stun, the same six-damage knife attack is available while archer line of fire is either blocked or clear. An exposed route can also produce existing hostile friendly-fire; this is preserved rather than suppressed to make the comparison cleaner.

Eight seeds × all five campaign floors, including the three trial seed strings, produced byte-identical level signatures before/after. Campaign generator changes are type-only metadata. Generic identification, AI, economy and save regression tests run with the full suite.

Approximate scripted comparisons and their failed policies: [measurement methodology](encounter-trials/METHODOLOGY.md) and [raw results](encounter-trials/measurements.json). They are deterministic probes with automation-selected aims/routes, not human playtests or a proof of optimality. World time includes approach and action time. Do not infer balance or necessity from a single policy's death.

Browser checks remain limited: system Chromium exits before page assertions with `socket() failed: Operation not permitted`. The separate dot cloud browser rejects the local Vite URL with `ERR_BLOCKED_BY_CLIENT`. Vite serves HTTP 200 and builds, but no rendered gameplay, audio, pointer-lock, visual composition or browser lifecycle pass is claimed. The new `e2e/practice-trials.mjs` covers the menu, paid conversion, restart, Back, campaign Continue/save/knowledge isolation and ordinary practice; it is checked syntactically but cannot run here.

## Final verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`: pass
- Full suite: **481 tests across 30 files**; the 17 trial-specific tests include real-input bypass and both charger punish routes
- `node scripts/encounter-trials/run.mjs --verify`: all 30 final policy outputs reproduce exactly; all 110 explored attempts remain represented in the compact data
- `node --check e2e/practice-trials.mjs`: pass
- Actual browser attempts: `practice-trials`, `potion-identification`, `huntress-progression` all blocked at Chromium startup before assertions; no E2E pass claimed
- Independent read-only review found no blocking geometry/navigation/loadout/save-isolation defect; class-qualified instructions and short-window picker scrolling were added during final review

## Deployment boundary

At work start, the latest Vercel production deployment was READY at `dcc15b70a31385fc7f02d5488c853dd0ac17e7c8`; the prior `58716fa` commit had no deployment or commit statuses. Repository publication is separate from proof that the live site updated. No manual redeploy, empty trigger commit or deployment-setting change is part of this pass.

# Heart Warden v2 — readable close-range pressure

Status: **Ready for Human Review**. This revision responds to an actual warrior play report: walking up and holding attack was enough to win. The former 32-HP/base-kit policy tests did not cover that strategy or normal chapter progression. Deterministic tests now distinguish blind held attacks from reading/positioning; they still do not prove fun, visual readability or human fairness.

## What changed, and why

- **Close the ranged dead zone by moving.** Previously the Boss chose cleave only at center distance ≤2.6 m, while a sword Counter reached 2.8 m and an ordinary spear reached 3.3 m. Now at 2.6–4 m it visibly approaches before choosing its close attack. Cleave hit reach is still 2.35 m + player radius: no enlarged invisible hitbox and no swapping an already committed lance into a melee strike
- **Boss Counter is deliberate.** A new attack press while the Boss's Counter cue is available starts an eligible fast swing. Merely holding attack still repeats ordinary melee, but cannot acquire Boss Counter rewards. A normal swing started before the cue cannot accidentally become a Boss Counter on impact. Mouse and touch use the same existing press-edge input. Ordinary enemy Counter and physical bolt Deflect rules are unchanged
- **One useful interruption, then a readable steady stance.** The first Counter, heavy-weapon stagger or physical shove collision still gives its normal exposed opening. After that the Boss resists another ordinary stagger/Counter until it completes its next threat and full recovery. Damage, body/flank hits, open-crown headshots, finite chill/paralysis and Hunting Mark continue to work. A committed rush hitting real geometry still earns its full wall-crash stagger even during the steady stance. Cancelling an uncommitted attack by breaking sight pays recovery but does not refresh the interruption budget
- **Phase two also matters up close.** Its close pattern is two separately telegraphed cleaves, with a full new preparation and direction lock for the second. The first slash does not pretend to be a recovery opening. Interrupting an eligible strike still earns a complete exposed interval; after an uninterrupted pair, the full final recovery remains
- **Calibrate for progression.** Fixed HP is now **80**, rather than 32. This is not adaptive scaling: upgrades retain their full damage. Cleave, second cleave and rush each deal **8 raw damage**; lance remains **4**. Every single hit can be survived from full starting 10 HP without armor. Four guaranteed chapter scrolls and levelled health are explicitly represented in the tests

All values live in `ENEMIES.warden`. Floors 1–4 generation/resources, ordinary enemies, item rules, movement/time rules, mobile/fullscreen and saves are preserved.

## Attacks (world/AI seconds)

| Move | Selection and tell | Commitment / damage | Earned opening |
|---|---|---|---|
| Cleave | At ≤2.6 m; 0.8 s planted preparation and filled 90° ground wedge. At 2.6–4 m, approach first | Last 0.35 s locks yaw; 0.15 s active, 2.35 m reach + player radius, **8 damage once** | 1.1 s recovery in phase one; phase two starts its second tell instead |
| Phase-two follow-up | After the first cleave: **1.0 s new preparation**, visibly winds the polearm back; HUD says 2/2 | Last **0.45 s** locks its own yaw; same wedge/reach and 0.15 s active, **8 damage once** | Full 1.1 s exposed recovery after the pair |
| Heart lance | At ranged distance up to 16 m, with legitimate sight and clear muzzle path; 1 s polearm preparation and line | Last 0.4 s locks target point/yaw; physical 18 m/s bolt with at most 16 m travel, **4 damage**. Dodge or Deflect | 1.15 s exposed recovery |
| Crown rush | At half HP, every other ranged selection attempts a rush when ≤8 m and the lane is traversable; otherwise lance | 1 s preparation; last 0.45 s locks yaw; straight at 8 m/s for at most 6 m, **8 damage once**. No homing or explosion | 1.2 s recovery; a real wall/closed-door crash gives 1.5 s exposed stagger |

The half-health transition occurs only at the next safe move boundary after the current complete attack/recovery. It never takes away an earned opening. A stronger build may shorten the fight or avoid some individual moves; there is no forced phase-health gate or damage clamp.

Each locked attack keeps its committed direction/target. Pre-lock invisibility, smoke or blocked sight cancels into paid recovery. Pursuit uses legitimate perception/last-known position. Pillars and doors remain real cover, with no new invisible arena seal.

## Reading the feedback

- **Orange preparation → brighter locked warning:** its direction is now fixed; leave the wedge or lane
- **Purple/magenta steady stance (穩勢):** the Boss resists another interruption, **not damage**. HUD explicitly says it does not reduce damage and when it ends. Do not keep waiting for a Counter cue during this stance; dodge and punish recovery
- **Teal open crown during stagger/recovery:** the earned punish window remains open even while the steady-state budget is set. The pose and HUD keep that opening prominent
- **橫斬 1/2 → 追斬 2/2:** there is a second separate tell; wait until the pair finishes, or earn an eligible interruption
- **反擊：鬆開再按:** release the held attack, then press at the available cue. This applies to the Warden only
- A shove stopped by geometry consumes its physical displacement even if the Boss resists stagger. Resisted collisions report resistance instead of falsely announcing stagger, and cannot repeat collision effects every simulation step

Ground warnings retain the actual configured collision extents. Pose timing and Counter prediction use the same windup/lock helpers as simulation. Finite paralysis/chill retain their distinct status tints.

## Crown and class rules

- A closed crown protects frontal headshots only during approach/preparation/attack. Body shots and side/back shots still work. Recovery/stagger opens the head; there is no new Boss-only damage reduction
- Ordinary arrows still deal 3 body / 6 head before upgrades; each bow level adds 1 / 2. Blocked arrows remain recoverable under the existing rules
- A valid deliberate warrior Counter cancels the eligible tell/reachable rush and gives **1.1 s exposed stagger**, normal weapon damage and the existing successful-Counter recovery benefit. Repeating a held swing does not confer that eligibility
- F/right-click remains position-only shove, not a block or automatic interruption. Actual wall/ally impacts may stagger when interruption is available. Active rush cannot be shoved
- First heavy-weapon stagger remains useful. Repeated hits keep dealing normal damage without restarting the Boss's whole preparation forever
- Sleep immunity is unchanged. Finite consumables/control remain optional advantages, not required keys to deal damage

## Campaign, practice and saves

The fight is still one Boss on floor five, with **9 XP**, one kill, no random Boss loot draw and no arena supplies/chests/traps. Guaranteed chapter supplies remain Healing 3/2/2/2/0, Food 1/1/2/2/0, Upgrade 1/1/1/1/0. Hunger freezes only when the encounter starts. After the Boss dies, the normal E interaction with the Heart is still required to win.

Floor-start carry/save fields need no migration. Retry regenerates a full dormant Boss and resets phase, brace, follow-up, interruption budget, damage and statuses. Trial mode remains main menu → choose class → **固定遭遇試玩 → 4 · 守心者**, with the normal starting kit and no campaign-save writes.

Representative durability breakpoints (no combo/sneak modifiers):

| Build | Damage per ordinary hit | Hits to defeat 80 HP |
|---|---:|---:|
| Sword +0 / +2 / +4 | 4 / 6 / 8 | 20 / 14 / 10 |
| Axe +0 / +2 / +4 | 7 / 11 / 15 | 12 / 8 / 6 |
| Bow head +0 / +2 / +4 | 6 / 10 / 14 | 14 / 8 / 6 |

Base Huntress arrows alone do not now finish every route; ordinary knife remains a verified no-ammo/no-consumable fallback. Upgrades still substantially shorten the fight. A fully levelled, armored build can afford mistakes or trade health deliberately; making every possible high-gear blind policy die is **not** the acceptance target.

## Measured evidence

`tests/wardenPressureScenarios.ts` uses the real generated arena, a declared controlled entry/build, then only ordinary `World.frame` inputs. Consumables/ammo are removed for melee-policy probes. There is no invulnerability, health refill, runtime teleport, injected damage, forced Boss state or projectile injection. Reading bots aim perfectly but use genuine press/release edges and Boss/projectile snapshots at least 0/120/200 ms old in **real time**. They are diagnostic policies, not human play.

The report [`warden-pressure-measurements.json`](warden-pressure-measurements.json) includes baseline, candidate history, final configuration, exact reproduction instructions, fixture definitions and failure/timeout counts.

- Old source: blind starting sword walked in holding attack and won in **5.12 world seconds**; the old close-range and axe-interruption loops were reproduced
- Final source: **0/216** starting-sword approach/hold clears across three seeds, three frame rates, four stop distances and six start delays, with no automatic Counters
- Four-scroll level-five sword +2/leather +2 and sword +4 each still clear **36/216** such sensitivity probes. The default 60 FPS blind approach dies for these builds, while deliberate 200 ms-reaction Counter/dodge clears in about **30.62 / 21.72 / 16.85 world seconds** for base / split / offense builds, with full health in those particular runs
- All **120** primary, fuller-campaign and alternate-seed deliberate probes clear. Zero damage is an earned possible result, never a required human outcome
- Strong level-nine split builds (26 HP, or 30 with Toughness) still clear all 12 relevant blind-approach weapon/frame-rate rows, losing **16–25 HP**. This trade remains disclosed; stronger preparation is allowed to matter
- The conservative base zero-ammo knife policy takes about **70 world seconds**, including genuine 120/200 ms observation delays. A more aggressive two-hit recovery policy reaches about **35.6 s** at perfect-reaction 60/120 FPS, but that advantage did not persist at the tested realistic delays. These data do not establish a necessary human fight duration
- Existing recovery-bow → knife and timed sword/knife routes remain viable. Old policy output in `warden-measurements.json` is historical v1 evidence, not current-v2 timing

The initial four new mechanics regressions all failed on the unchanged remote baseline before implementation: near-range lance selection, held-input Counter reward, repeated axe windup reset, and missing phase-two close follow-up.

## Verification and remaining limits

- Strict typecheck, lint, full test suite, production build and whitespace checks pass; final command totals are recorded in the commit message
- Coverage includes new mouse/touch press-edge integration; full recovery and interrupt-budget expiry; pre-lock sight loss; single-hit survivability; follow-up commitment; repeated heavy hits; save/retry cleanup; crown/damage parity; actual-arena gear/FPS/reaction matrices; ordinary class behavior; shared pose/warning geometry and HUD state
- Independent cross-review found a new resisted-shove stale-push defect. It was fixed and covered by wall/body collision regression tests; a 108-window Counter timing probe found no offered cue failures
- CPU DOM/scene-graph tests verify state-derived presentation and finite/shared geometry. They do **not** render pixels or judge cue contrast/audio/mobile comfort
- Local browser attempt: the Playwright-managed executable was absent. Retrying with installed `/usr/bin/chromium` failed before the test began with `process_singleton_posix.cc: socket() failed: Operation not permitted` (SIGABRT). No successful browser, GPU, audio or device playtest is claimed

## Human acceptance route

1. Warrior starting kit: walk straight up holding attack. Compare that with releasing before a tell, pressing at a real Counter cue, and dodging the next steady-state attack
2. Stand at ordinary sword/spear range. Confirm the Boss visibly approaches rather than endlessly preparing ranged shots while within your reach
3. Use an axe. The first hit earns an opening; subsequent steady-state hits must still hurt without permanently cancelling every preparation. Read the magenta pose/HUD and dodge
4. Enter phase two at close range. Read 1/2 then 2/2, move out of each locked wedge, and punish the full final recovery. Confirm no hidden tracking or range extension
5. Huntress: test body/flank/recovery heads, finite chill/paralysis and the zero-ammo knife route. Both classes must remain playable without mandatory consumables
6. Test a real late-chapter saved build, especially armor/HP and +4 offense. Upgrades should make a visible difference, while the encounter still presents its pressure clearly
7. Repeat with actual mouse and touch controls, including brief taps, held attack, release/repress, pause/resume and fullscreen interruptions. Confirm the on-screen Counter wording matches what the input does
8. Try cover, pre-lock concealment, a braced shove against a wall, a rush crash, death/reset and Heart interaction. Confirm earned openings, collision feedback and campaign-save isolation

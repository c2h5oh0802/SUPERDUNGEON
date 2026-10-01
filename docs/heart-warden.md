# Heart Warden v1 — fifth-floor Boss

Status: **Ready for Human Review**. One distinct Boss replaces the two ordinary guardian placeholders. Mechanics, progression and CPU scene data are testable here; GPU visuals, audio readability, enjoyment and final difficulty still need human play.

## Intent

The final encounter tests the existing slow-world-time rules: read a preparation, let it commit, move out of its fixed danger area, then choose an attack you can finish during recovery. It adds no damage RNG, unavoidable chip, summons, forced consumable check or new progression system.

The crowned bronze polearm wielder has fixed **32 HP** (previous pair: 13 + 16), radius 0.5 m, and three moves. The increase in difficulty comes from timing/position, not a large health pool. All values live in `ENEMIES.warden`.

## Attacks (world/AI seconds)

| Move | Selection and tell | Commitment / damage | Recovery |
|---|---|---|---|
| Cleave | Within 2.6 m; planted 0.8 s preparation, filled 90° ground wedge | Last 0.35 s locks yaw; 0.15 s active, 2.35 m reach plus player radius; 4 damage once. No hidden inner-circle hit or lunging | 1.1 s, stationary and crown open |
| Heart lance | At range up to 16 m with real sight and clear muzzle path; 1 s polearm preparation and line | Last 0.4 s locks target point and yaw; one physical 18 m/s bolt with at most 16 m travel, 4 damage. Dodge or Deflect; no retarget after commitment | 1.15 s, crown open |
| Crown rush | At half HP, every other ranged selection attempts a rush if within 8 m and the lane is traversable; otherwise lance | 1 s preparation, last 0.45 s locks yaw; straight at 8 m/s for at most 6 m, one 4-damage contact. No homing or follow-up explosion | 1.2 s; hitting a wall/closed door gives 1.5 s exposed stagger |

Half-health transition is announced only at the next safe move boundary, after the current attack and its full recovery. It does not cancel a player's earned opening. Pre-lock loss of sight cancels into paid recovery; locked attacks still resolve at their original direction/point. Tracking otherwise uses legitimate perception and last-known position. Pillars and doors remain physical protection; no new invisible arena seal is added.

Ground warnings include the player collision radius. The rush/lance ground strip is a conservative box around the swept lane; the lance also has the elevated muzzle-to-target line. Warning brightness, crown pose and HUD use the simulation's commitment/exposure state.

## Crown and class rules

- Closed crown protects **frontal headshots only** while alert, approaching or attacking. Body shots and side/back shots still work. Recovery/stagger opens the head. This is displayed before the first shot and a blocked hit gives a crown-specific message/sparks
- Accurate ordinary arrows still deal their normal 3 body / 6 head damage. No boss-only damage reduction or surprise immunity; bounced arrows use existing recoverable pickup behavior
- Warrior Counter interrupts a valid locked tell or reachable live rush into 1.1 s exposed stagger, with ordinary weapon damage. Lance uses ordinary Deflect, including its usual returned damage
- F/right-click is the existing position-only shove, not a block. It does not automatically cancel an attack; wall impact can stagger. Active rush cannot be shoved, matching the charger
- Knife, heavy-weapon stagger, Hunting Mark, chill, paralysis and damaging areas retain existing behavior. Only Sleep remains immune, as the prior arena already specified
- Paralysis freezes the existing timeline; chill slows it. A frozen closed crown stays closed, so use body shots for control. Finite arrows, consumables and effect durations bound repeated control; no new permanent stun state or broad immunity was introduced
- Base sword and a zero-ammo base knife both have no-consumable winning routes in simulation. Food, healing, ranged stock, talents and upgrades are not required to unlock or damage the Boss

## Campaign and practice

- Floors 1–4, all their generation/RNG/resource proofs, ordinary practice and the first three encounter trials remain unchanged
- Fixed chapter supplies remain Healing **3/2/2/2/0** (9 total), Food **1/1/2/2/0** (6), Upgrade **1/1/1/1/0** (4). Floor 5 has no random supplies/chests/traps
- One Boss awards **9 XP** and one kill, preserving the prior pair's combined XP. No random Boss loot draw
- Hunger runs in the antechamber and freezes only when the encounter begins; the existing post-defeat pause remains. You must defeat the Boss and then complete the normal E interaction with the Heart to win
- Existing floor-start saves need no migration: seed/class/carry/stats remain unchanged, and retry rebuilds a full dormant Boss with no retained phase, damage or status
- Human entry: main menu → choose class → **固定遭遇試玩 → 4 · 守心者**. It loads the actual floor-5 arena with the normal class starting kit, no extra trial potions/talents, and no campaign-save write. Esc resets; death resets; post-victory retry restores the same fixture

## Measured policy probes

`tests/wardenScenarios.ts` uses the real generated arena with a disclosed controlled player entry 6 m from the Boss. Then it only sends ordinary frame inputs: no invulnerability, healing, damage injection or movement teleports. All consumables are removed; knife also has zero arrows. These are perfect-aim scripted probes, not human balance evidence.

At 60 FPS, seed WARDEN-REVIEW:

| Policy | Result | Damage | World time | Resources |
|---|---|---:|---:|---|
| Stand and continuously aim at head | Dead; Boss 5 HP left | 12 recorded incoming damage | 6.017 s | 8 arrows; 3 crown blocks |
| Read tell, dodge, shoot recovery | Clear | 0 | 12.901 s | 6 ordinary arrows |
| Base sword Counter / Deflect | Clear | 0 | about 7.8 s | No ammo/consumables; 4 Counters and 1 Deflect |
| Base knife, back out of cleave tell then punish recovery | Clear | 0 | about 22.1 s | Zero ammo/consumables |

The three reading policies also clear at 30/120 FPS. Two mirrored layouts with a 120 ms real-time decision interval also clear. The naive knife policy that immediately walked back into a still-active wedge failed; holding outside until recovery is necessary. This validates a usable timing rule, not universal human fairness or final numbers. Full probe output is in `docs/warden-measurements.json`.

## Verification and limits

- Final strict typecheck, lint, **764 tests in 41 files**, production build (58 modules) and whitespace checks pass
- Focused suites cover immutable targets/yaw, pre-lock sight loss, wall/door blocking, full recovery, phase boundary, single-hit damage, status clocks, death cleanup, Counter/Deflect/shove, crown/body/flank hits, finite control and Hunting Mark, projectile owner death, resources/XP, save/retry and Heart gates
- CPU presentation tests cover 21 attack/phase poses, crown-predicate parity, finite transforms, shared geometry, configured collision extents and warning/death cleanup. They do **not** render pixels
- `e2e/warden.mjs` covers menu entry for both classes, base kits, crown HUD, Heart gating, Hunger, reset/retry and campaign-save isolation. State injection in that script is explicitly limited to progression/UI checks
- Exact browser attempt failed before any assertion: Chromium `process_singleton_posix.cc` could not create a socket (`Operation not permitted`, SIGABRT). No GPU screenshot, audible cue, or manual-play pass is claimed
- Independent review found a live-rush Counter cue near the end of its travel could promise a counter that had already become recovery; fixed with a remaining-commitment check and regression tests. The lance now has an explicit 16 m range/lifetime matching its ground warning; ordinary Deflect clears that hostile-only lifetime. Expiring capped bolts no longer advertise Deflect when they will disappear before the swing can reach them; uncapped projectile expiry remains unchanged

## Human acceptance route

1. Enter Warden practice as Warrior. Read the crown rule before engaging; approach until the cleave tell, Counter after its lock, then spend the exposed window. Deflect a lance from range
2. As Huntress, shoot a closed-crown head once to check feedback, then body/flank/recovery head. Compare stationary shooting with dodging first; confirm arrow pickup after a block
3. Use the knife without arrows. Back outside the filled wedge while it raises the weapon, stay out until it strikes, then close and land one quick recovery hit. No consumable is needed
4. Take it below half while a move is committed. That move/recovery must finish; the next valid ranged patterns alternate lance and straight rush. Sidestep the full lane, try a pillar/wall crash, and confirm the exposed crown
5. Try chill/paralysis before and after lock, F push before a rush versus during active rush, smoke/invisibility, cover and retreat through the doorway. No through-wall hits or hidden aim tracking
6. Attempt early Heart interaction, defeat it and use E, reset practice, switch classes, and Continue a pre-existing campaign. Confirm the campaign checkpoint is preserved

Outstanding human judgment: crown readability at play distance, warning contrast over stone floors, audio distinction, camera/movement comfort near pillars, Counter cadence, knife recovery accessibility, and difficulty with stronger floor-4 equipment. Tune those values after play rather than equating tests with fun.

# Combat wake-up and evidence-based Potion identification

Status: Ready for Human Review. Starting remote HEAD: `dcc15b70a31385fc7f02d5488c853dd0ac17e7c8` (Huntress Progression v2). 2026-10-01.

## Confirmed causes

- Sleeping actors multiplied all noise radii by 0.6. An 8m combat hit therefore reached only 4.8m, or 2.4m behind cover. This was too local for an ordinary open room.
- Enemy strike/launch sounds were presentation events without matching AI noise. Receiving a bolt or charge likewise lacked a sound at the victim's location.
- `shatterPotion` called `identify` before returning for harmless Invisibility/Haste/Healing. The old tests and descriptions explicitly preserved that incorrect policy.
- Nine initial regression cases reproduced eight failures before code changes, with quiet footsteps already correct.

## Rules

### Combat

Loud combat impacts, shield clashes, shouts and heavy impacts can carry through the connected space of their current authored room. A bounded cell flood stays inside that room and does not cross a solid partition or a closed door. Sound diffracts around furniture/pillars and over low obstacles. It uses actual coordinates, not the enemy's original spawn-room ID. This is a small room-acoustics approximation, not physical acoustics or global alarm.

Outside that room, existing radius, wall attenuation and sleep attenuation remain. Nearby muffled sounds can still be heard across a wall; closed doors do not imply perfect soundproofing. Ordinary steps, quiet walking, soft arrow-wall taps, thrown stones and glass keep their prior radius rules. No automatic room wake occurs merely because the player equips a weapon or enters combat UI.

Listeners wake into `investigate` at the sound location, never magically acquire the player's location, and never relay a shout merely from hearing. Alert actors keep their attack state. Actual enemy strikes, launches and contacts emit bounded events once at their existing phase/contact transitions. Wall impact acoustics originate just before the surface, fixing positive/negative cell-boundary asymmetry.

Sleep Scroll still casts quietly, still defers committed attacks rather than deleting them, and still permits surprise. Subsequent audible fighting can wake sleeping allies. A committed threat completing after the scroll can therefore disturb others: the scroll is not a guarantee of silence during ongoing combat.

### Potions

- Drinking still reveals identity through the normal item action.
- Unknown Invisibility, Haste and Healing only break when thrown or airburst. No identification, area, healing, or buff; known bottles remain known.
- Fire, Frost and Gas identify when their revealing grounded effect center is in the player's camera view, with clear geometry/smoke sight. Effects still exist outside view without revealing the bottle's identity.
- Camera FOV/aspect follows the renderer, including settings and resize. Simulation uses player yaw/pitch; cosmetic shake is excluded. Tests use explicit deterministic viewport defaults.
- Generic shards carry no potion subtype in the presentation event. The no-effect toast is generic and only shown if the break was observed. Unknown inventory descriptions no longer promise automatic discovery by throwing.
- Identification is evaluated at impact. Walking into an old area later does not retroactively associate it with an unknown bottle. This deliberately conservative v1 rule and effect-center visibility can miss partial edge-of-screen effects; human review should judge it.
- Save structure and existing knowledge are unchanged. Previously learned bottles remain learned; the change does not erase earned information.

## Reference, not copied implementation

Reviewed official Shattered Pixel Dungeon source on 2026-10-01:
- [Potion base](https://github.com/00-Evan/shattered-pixel-dungeon/blob/master/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/potions/Potion.java): generic shattering does not identify.
- [Invisibility](https://github.com/00-Evan/shattered-pixel-dungeon/blob/master/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/potions/PotionOfInvisibility.java): drinking identifies; harmless throw inherits base behavior.
- [Flame](https://github.com/00-Evan/shattered-pixel-dungeon/blob/master/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/potions/PotionOfLiquidFlame.java), [Frost](https://github.com/00-Evan/shattered-pixel-dungeon/blob/master/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/potions/PotionOfFrost.java), [Paralytic Gas](https://github.com/00-Evan/shattered-pixel-dungeon/blob/master/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/potions/PotionOfParalyticGas.java): harmful shattering identifies when impact cell is in hero FOV.
- [Mob](https://github.com/00-Evan/shattered-pixel-dungeon/blob/master/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/actors/mobs/Mob.java): ordinary sleep uses hostile perception, damage/debuffs; Swarm Intelligence beckoning is challenge-specific. Our room sound propagation is a first-person adaptation, not a claim that SPD wakes every room by this same rule.

## Verification

- `npx vitest run tests/combatWakeIdentification.test.ts`: 28 pass (nine initial cases first reproduced the defect; subsequently added real melee/three enemy attacks/bolt contacts, walls/doors/range, current room location, Sleep, view/smoke, harmless real throws, mirrored wall hits, high airburst).
- `npm test`: 464 tests across 29 files pass, including all Chapter, Healing, Huntress, Hunger, Upgrade, save and combat regressions.
- `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`: pass.
- `node --check e2e/potion-identification.mjs`: pass.
- `npm run dev -- --host 127.0.0.1 --port 5182`: Vite reports ready; a separate tool process could not connect to that loopback server, so this is not page-load verification.
- Attempted `BROWSER_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:5182 node e2e/{potion-identification,items,huntress-progression}.mjs`: all blocked during Chromium startup by `socket() failed: Operation not permitted`, before page assertions. No browser, sound, visual or human-play result is claimed.
- Independent review caught and verified fixes for airborne generic shards revealing a ground effect outside view, and directional wall-impact sound origins.

## Human route

1. In a room with multiple sleepers, start fighting one enemy while another is on the far side. The other should wake and investigate the fight, not know an unseen player's exact moving position.
2. Repeat with a pillar between them; repeat with a complete partition/closed door and another room. Listen/wake behavior should feel plausible rather than a level-wide alarm.
3. Use Sleep, remain quiet, then fight again; check the difference. Confirm stealth/quiet movement remains useful.
4. Use a new run with an unknown beneficial potion (Warrior can test unknown Invisibility/Haste; Huntress can test unknown Healing). Throw one and check remaining matching bottles stay unknown. Drink a later bottle to identify.
5. Throw Fire/Frost/Gas in front of you, then behind a wall or out of view. Only observed revealing effects should identify. Known identities remain visible.
6. Check wide/narrow display and FOV options; partial/offscreen effects should not feel unfair. Judge whether same-room wake pressure is readable and interesting; automated tests cannot prove this.

No weapon, enemy health, Chapter generation, Food/Hunger supply, Healing formula, Huntress talents, Upgrade investment, or save migration was rebalanced.

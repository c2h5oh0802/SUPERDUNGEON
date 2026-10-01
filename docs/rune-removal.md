# Rune Altar progression removal

Status: **Ready for Human Review**

Upgrade Scrolls were not removed. This change only removes the Rune Altar progression layer.

Base: `f8c397990726563c3c6ba3d2307e74e0fc13e10c`, default branch `claude/wizardly-lamport-dlnz24`. All 113 tracked source blobs were verified against GitHub before editing in an isolated cloud checkout. No user-computer access, dependency changes, manual deployment or service/settings changes.

## Scope

Removed the full find-altar → two Rune choices → persistent Rune buff loop:

- `RUNES`, `ALL_RUNES`, `RuneId`, descriptions, player/carry Rune state, `hasRune`, application and choice APIs
- Altar interactables, used state, offers/allocation, pending pause branch, prompts, screen/mode, HUD/results, map marker/legend, audio/dev fields
- Arrow/stone enemy penetration bonus and its now-unused projectile counter; arrows still pass through an airburst bottle as before
- Swift-blade melee timing multiplier and shadow detection multiplier; baseline weapon timings and perception remain
- Vigor max-HP/heal application, with the narrow legacy-save migration below

No Rune effects were moved into talents, affixes, upgrades, blessings or a replacement choice system.

**Kept:** Upgrade Scroll pickup/bag/use, `UPGRADE`, `upgradeTargets`/`applyUpgrade`, generic choice screen, weapon/armor/bow levels and +5 cap, naturally upgraded deeper loot, XP/level HP growth/talents, consumables, Hunger/Food, Combat v1, Living Dungeon AI, surprise and ordinary equipment. The existing disabled legacy shield upgrade/save policy is unchanged. `src/sim/items.ts`, `src/sim/progress.ts`, `src/sim/hunger.ts` and `src/gen/loot.ts` are unchanged.

## Rooms and generation

Both former altar layouts survive as `apse` (側廳) and `rotunda` (圓柱廳), using the existing combat role/pool. Their walls, pillars, enemy markers, patrol markers and ordinary supply positions remain. The `A` prop cell becomes normal floor, including the extra altar in the treasure vault; its collision and visual altar are removed, rather than leaving a misleading interactive-looking shrine.

Both templates still have nine room slots and the same graph connections, tiers and optional branches. Template A's old `Al` identifier is renamed `N0`; template B keeps `R2`. These slots use the existing combat role. There is no replacement guaranteed item: the ordinary one Upgrade Scroll and one ration per floor remain, and there is still one treasure chest. No added food or upgrades compensate for Rune removal.

Combat layout assignment and removing the Rune shuffle change RNG consumption, so an old seed need not reproduce its pre-change room selection, enemies or loot locations. Within this version the same seed remains deterministic, including continued floor-start saves. Seed validity, spawn safety, trap-free objective route, shortcut semantics and representative all-room connectivity are tested. The change preserves the physical room library and graph; it does not discard all old room art or introduce a new generation framework.

## Legacy v2 saves

Keep save version 2, storage key and floor-start checkpoint policy. Otherwise-valid old saves are accepted with absent, unknown, malformed or removed Rune fields/IDs. Parsed state drops that field; newly generated carry/save state has no active Rune progression. No save wipe, compensation or auto-upgrade.

Historical maximum HP had only base HP, level growth, toughness and vigor as sources. If the old `runes` array explicitly contains `vigor`, remove at most its historical +4 above:

`PLAYER.maxHp + (level - 1) * XP.hpPerLevel + toughnessHp when that talent exists`

Current HP is only clamped to the resulting maximum. Level/toughness growth is never subtracted; duplicate vigor IDs deduct once. If the recorded HP has already lost vigor's contribution, the stale ID cannot lower it again. Unknown IDs do not supply HP evidence. The old one-time heal cannot be separated from later healing/damage, so it is deliberately not retroactively subtracted. Re-saving/reloading is idempotent.

## Verification

Final code checks:

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: **301/301**, **22/22** files pass
- `npm run build`: pass, Vite 50 modules; JS `index-CBU2CTCd.js`, CSS `index-D6qEvMEW.css`
- `git diff --check`: pass
- Changed E2E JavaScript syntax checks: pass

Coverage includes fresh-player absence of Rune state/APIs; all four baseline melee timings; baseline enemy perception; arrows/stones stop at first enemy; hostile-bolt first-contact regression; 200 seed checks; 40 seeds across four floors; both reused room layouts and both nine-room graph variants; 64 extra template/floor cases for all-room reachability and unchanged guaranteed supply counts; Upgrade Scroll pickup → bag → valid target → +5 → floor/save persistence; XP/level/toughness HP and queued talent choices; Hunger freeze for talent/upgrade and mid-frame interruption; legacy Rune save migration/idempotence; Food/Hunger carry; full Combat/Living AI/stealth/item suites.

Browser E2E is **not passed**. `e2e/items.mjs` was attempted in the cloud: Playwright's default Chromium binary is absent; using the installed `/usr/bin/chromium` fails before a page opens with `process_singleton_posix.cc: socket() failed: Operation not permitted` and a crashpad database error. A normal approved sandbox escalation retry reached the same launch failure. `hunger`, `floors`, `browser`/map, `retry`/generation and the rest of browser suites were not executed after this shared launch blocker. No user-computer fallback or restriction bypass.

The items script now asserts the removed UI/dev fields and the retained talent/upgrade cards and pause. The floors script includes legacy Rune+vigor loading and verifies the subsequent save drops Rune state. These additions are syntax/lint checked, but browser assertions remain unexecuted.

Prior Hunger bot measurements are explicitly historical; they include the previous Rune choices/layout RNG and are not new Rune-free calibration. No claim of fun, survival balance, complete browser acceptance or human review.

## Manual acceptance route

1. Start a fresh seeded run. Check no Rune HUD/choice/map legend remains. Visit the former side/through-room slots in both layouts/templates; verify paths, enemies and room composition feel coherent, with no floating prop, invisible obstacle or interaction hint.
2. Find the floor's Upgrade Scroll, pick it up, open the bag and read it. Verify valid equipment choices, mouse/number input, level increase and max-level exclusion. Repeat for weapon, armor and huntress bow.
3. Earn XP in combat, check level-up maximum HP and choose a class talent. Confirm subsequent queued choices resolve normally.
4. Leave both upgrade and talent choices open while watching Hunger; world time/Hunger/damage remainder must stay frozen. Also check map, bag and pause.
5. Eat a ration, go to the next floor, reload and continue. Confirm equipment levels, XP/talents, legitimate maximum HP, Hunger/remainder and food carry over. Repeat with a backed-up old v2 Rune save; it must remain loadable without Rune buffs or new Rune save state.
6. Check bow/stone first enemy contact, normal melee commitment, Counter/Deflect/shove, Living AI and surprise in actual play.

Human question still open: does removing altar decisions make exploration cleaner, or make some side rooms feel less rewarding? Existing enemies/supplies remain, but that incentive is not proven by automated tests. No replacement mechanic is added in anticipation.

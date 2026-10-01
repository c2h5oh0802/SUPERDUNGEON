# Ground archer movement v1

Status: Ready for Human Review. Automated mechanics are verified; these are provisional encounter-feel values, not proof of fun or balance.

## Rules

- Ground archers with current sight may choose a nearby navigable firing angle when their pre-lock line is blocked by a wall or ally. When close, they try a short retreat first, with an angle fallback if retreat cannot work
- A leg has a fixed goal, at most 2.5 m displacement/travel and 1.1 AI seconds; the archer then stands for at least 1.25 AI seconds before trying another leg. This prevents endless close-range kiting
- No aim, lock, or shot begins while moving. Existing aim lasts 0.9 seconds, with its final 0.25 seconds committed. Once committed, the shot keeps its target and can physically hit an ally that steps in
- Lost sight, invisibility and smoke stop tactical tracking immediately; ordinary last-known-position search remains. Sleep, stagger, death and state resets clear movement. Paralysis freezes its timeline, chill slows it, external shove still displaces it
- Planner uses at most 16 local candidates per attempt (retreat and angle can each search once), each capped at 160 A* expansions. Failed attempts share a cooldown. No new RNG draws
- Ordinary sanctum ledge archers move one metre onto reachable adjacent floor. Firing galleries, optional sentry vaults, practice and fixed encounter trials retain their authored roles
- Archer HP, bow damage, projectiles, unrelated enemies, drops and resource economy are unchanged

## Verification

- Full typecheck, lint, 688 tests in 36 files and production build pass
- 96 exploration-floor samples: ground/perched archers change from 318/362 to 422/258. 104 sanctum spawns convert; 38 unmirrored and 58 mirrored floors, zero generation retries. Every pre-change generated field and every RNG result matches after undoing only the intended landing delta
- Historical healing-supply fingerprints remain checked after undoing that same landing delta. Guaranteed Healing remains 3/2/2/2/0, Food 1/1/2/2/0 and one Upgrade per exploration floor
- Movement tests cover wall/corner/door/ally clearance, no firing while moving, bounded pursuit, blocked retreat fallback, clear-line reacquisition, commitment/friendly fire, status and full world damage pipeline
- Independent review caught a failed-retreat cooldown blocking the same-tick angle fallback; fixed with an exact regression fixture. A door closing across an already selected route now ends that tactical leg without reopening it
- Existing living-dungeon and practice-trials browser E2E attempts could not start Chromium: socket creation returned EPERM before assertions. No playable browser, screenshot, or audio verification is claimed

## Human route

1. Start either class on a normal campaign. In sanctum rooms, watch a ground archer take a short step off an obstructed firing line, stop, aim and fire
2. Walk toward it without attacking. It should retreat in bounded legs and offer readable stationary attack windows
3. Put a guard between you and an archer. Before lock it should seek an angle; after lock, crossing the shot with an ally should preserve physical friendly fire
4. Check a dead end, tight doorway and smoke. No wall phasing, endless foot shuffling or tracking your hidden new position
5. Play the existing three fixed trials and optional sentry vault. Their elevated roles remain intact

Review encounter pressure, stop/aim readability and whether ordinary exploration contains enough useful movement; these require human play.

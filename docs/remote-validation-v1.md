# RemoteValidationV1: open calibration and disposable adventure

Status: **Ready for Human Review**. Controlled design revision: **`open_v2`**; post-validation engagement: **`engagement_v1`**. The public URL and this report's filename remain stable. This report describes implementation and deterministic verification, not acceptance of fun, timing, or real-player understanding. Historical choreography telemetry must not be combined with this revision's completion or assistance cohorts.

## Entry and scope

- Public route: `https://superdungeon.vercel.app/?playtest=1`
- Attribution: add `&src=x`, `reddit`, `discord`, or `direct`. Missing/empty maps to `direct`; all other values map to `unknown`. Arbitrary URL/referrer text is never forwarded.
- `playtest=1` wins over `dev`/`boss`; there is no public `window.__sd` or state-injection UI.
- Ordinary URL, developer Boss mode, fixed trials and ordinary Practice retain their existing routes. Practice retains automatic death reset; the public core requires a deliberate retry after death.
- Landing has one start button and the premise: 「停下腳步，時間就會慢下來。看清攻擊，再決定行動」. There is no class picker, seed entry or adventure menu.
- Any suggested new-player duration remains a design target. Elapsed time never grants calibration completion; human timing and enjoyment remain unverified.

## Current flow: open calibration

Phase 1: Landing → open single-guard calibration → formal healing interaction → optional unknown consumable → CoreEncounterWarrior → completion/death Results and optional fixed-choice feedback.

Phase 2: Results offers **Retry Core**, **Continue Adventure**, and **Return**. Continue starts a disposable, ordinary Warrior adventure with the existing dungeon/floor systems. Its play and outcomes do not extend or rewrite the controlled validation funnel.

The calibration uses a lit, open authored arena with one **ordinary shield guard** and the existing Warrior controls and combat. The player starts wounded at **5/10 HP** so a real healing item has an observable use; the ordinary completed healing drink restores up to 5 HP. The guard may be defeated through any valid native combat path, including countering, deflecting, ordinary attacks or movement. There is no required backstep, sidestep, attack phase, timed evade/recovery-hit chain, repeated cycle count, or prescribed solution.

Two factual observations are needed before the healing interaction:

1. The actual calibration guard is defeated through the ordinary simulation
2. At some point in the attempt, the player actually stops and the world runs at its stopped slow-time rate

These facts may occur in either order. Slowdown uses a 0.3-real-second sample of actual stopped idle-rate simulation as a factual noise filter; the player need not face the guard or match any combat/camera sequence. It is not tied to a particular guard windup, visual-attention proxy or combat beat. Movement/look/attack observations are diagnostics, not extra prerequisites. Elapsed time without the real stopped slowdown, movement input alone, or an invented success event cannot replace either fact.

After the kill and actual stopped slowdown, one formal healing potion becomes available **2.4 m away** (native 0.9 m pickup radius plus 1.5 m). Deterministic placement prefers the facing direction, checks the entire player-width walking approach and eye-to-bottle line of sight, and fans away from walls/corners/obstacles. Standing still does not collect it; the player must walk to it. No replacement is spawned each frame. This remains a normal pickup. Collection, inventory ownership, action commitment, item consumption and effect completion use the ordinary game systems. Drinking through any supported formal path counts; pressing a particular shortcut is not required. Desktop supports H or the native inventory's 「喝」 action; touch uses the native bag's 「喝」 action and has no separate healing button. Starting a drink or merely collecting the bottle is not completed healing. No parallel tutorial potion counter or direct scripted HP refill substitutes for the native item. The completed formal drink is reported as `healing_used`.

If the player intentionally destroys/spends the healing resource through a non-healing path and it is no longer recoverable, the calibration has an explicit resource-lost continuation. It is recorded separately as `healing_skipped_resource_lost`, never as a successful drink or inferred learning. A bottle still available in inventory or on the ground is not lost. This fallback prevents an unrecoverable tutorial state without silently replacing the item.

One real unknown haste potion is added to the bag after this resolution, and the ordinary inventory opens with a brief explanation plus an immediately available Continue-to-core button. The player may use its ordinary inventory/action/identification flow, close inventory and explore, or immediately continue; Pause also offers Continue. Its use, identification, wait time or effect is never an additional completion gate. No Identify scroll is supplied and the existing scroll/target-selection behavior is unchanged.

### Calibration safety boundary

Lethal protection applies only to the explicitly tagged public calibration. Actual damaging hits still produce their normal feedback and consequences, but the damage boundary retains at least **1 HP**. This is not an every-frame heal or a death-and-resurrection loop. The initial wound and subsequent healing remain meaningful. The ordinary core, adventure, Boss, fixed trials and Practice do not inherit this floor; their existing damage/death rules remain in force.

### What `calibration_complete` means

`calibration_complete` is a factual route milestone: the guard defeat and actual stopped slowdown were observed, and the healing interaction either completed through the formal simulation or took the explicitly recorded resource-lost fallback. Optional unknown-item exploration is not required. This event cannot establish that the player consciously read an attack, understood slow time, mastered a combat loop, or found the encounter fun.

The observer reads real World state and actual GameEvents. First movement, first look, first attack, stopped slowdown, counter, deflect and hurt are bounded observations, available independently in calibration and core. They do not prescribe an order or certify skill. `hurt_observed` reports a real hurt event, not an intended enemy hit. Combat outcomes remain actual simulation facts.

## Core encounter and assistance

CoreEncounterWarrior uses the existing `shield-crossfire` level, including its cover, two approaches, guard, perched archer and safe dog-leg spawn. It is built directly through `World` with the normal Warrior starting loadout, avoiding the fixed trial's bonus consumables. This is a compact position/priority problem after a single-threat calibration. Core completion means both existing enemies are defeated. Calibration supplies, wounds and optional-item effects do not carry into this fresh core world.

Existing world simulation, renderer, telegraphs, HUD, audio, action commitments, slow-time rules and desktop/touch inputs are shared. The calibration safety floor is narrowly scoped; enemy, weapon, class and ordinary combat-balance values are not changed to manufacture success. Hunger, XP and random loot are excluded only for explicitly tagged public worlds. The compact public HUD avoids the ordinary adventure growth/navigation presentation; formal inventory remains available where item interactions need it.

Normal HUD solution/tutorial hints are suppressed in the public core. Its objective says to clear two enemies. Bounded fallback hints can appear once per kind:

- `hint_inactivity`: more than 22 active real seconds without movement/attack; suggests Pause/settings/retry
- `hint_no_attack`: more than 35 active real seconds with no actual swing/fire; names the attack control
- `hint_repeated_damage`: at least three actual hurt events; suggests pausing to observe or retrying

No ordered route, preferred target, shield solution or archer dodge solution is supplied. Existing combat cues and telegraphs remain visible.

Each new core attempt initializes **assisted=false**. Displaying any bounded fallback hint sets **assisted=true** for the rest of that attempt, even if the hint disappears. Clearing a hint or calling `assistance(false)` cannot restore unassisted status. Explicit retry enters a fresh core stage and resets this flag. Calibration guidance does not taint a new core attempt. Completion, death, deliberate quit, numeric results, retry and feedback retain the attempt's assistance classification.

An unassisted completion means no bounded fallback was displayed. It does not prove independent understanding, and it is not a claim about any outside assistance. An assisted completion remains a valid completion and must be reported separately when evaluating self-directed core behavior.

## Results, retries and save isolation

Core completion or death closes the attempt exactly once. The app freezes outcome, active real time, damage, kills and assisted status in an immutable Core result; the result display uses those values. Terminal progression and numeric events are emitted only once. A selected optional feedback response still belongs to that closed result. Subsequent free-play combat, death, retry, floor changes, quit or browser lifecycle do not emit controlled Core events or change that snapshot.

Results provides three explicit choices:

1. **Retry Core** rebuilds a fresh deterministic Core without repeating calibration, clears hints/feedback/input/world state and initializes unassisted. It records `retry_core` engagement plus the existing explicitly contextualized retry event
2. **Continue Adventure** says the main test is finished and the following adventure is unsaved. It creates an ordinary Warrior `newRun`, reuses `createFloorWorld` and `nextFloor`, and restores the ordinary HUD, map, loot, hunger, equipment, XP/talents, inventory/unknown/Identify/Upgrade rules and later existing floors/Heart content. No parallel campaign or save format is introduced. The persistent badge and Pause say this is free play and does not save
3. **Return** discards the disposable world and returns to the public landing

Free-play death/win uses the ordinary Results presentation with free-play wording, a same-seed adventure retry and Return. It has no Core feedback form or continue-Core action. Class stays Warrior; adding a class picker was unnecessary for the smallest safe flow. Explicit free-play quit and terminal Results record bounded engagement totals. Reload/tab-close duration is not inferred or guaranteed.

**Save ownership never changes:** `playtestActive` is fixed by URL for the entire app lifetime. It guards campaign Continue/load and all save/write/delete ownership, including hidden normal New/Continue controls. `extendedPlay` only permits in-memory formal floor creation; it never grants campaign persistence. Calibration/Core construct no `RunState`; free play uses an in-memory `RunState` with its own seed/carry/stats. Descending, death/win, restart, cancellation and Return all leave `superdungeon.run.v1` byte-for-byte unchanged, with zero reads/writes/deletes. Shared user settings continue through their separate settings key. Returning to the ordinary URL restores the normal explicit campaign entry/Continue rules.

Duplicate Continue/retry clicks and stale world/lock loading completions are guarded. `extended_play_start` is emitted only after the new World is constructed; cancelling a pending load cannot report the preceding Core's metrics as adventure time.

## GameAnalytics adapter

Only `src/playtest/telemetry.ts` knows the provider API. The game calls semantic methods. `gameanalytics` stays pinned to **5.0.0** and bundled as an optional dynamic chunk. No key, environment or deployment configuration changes are part of this revision.

Configuration, through the build owner's existing deployment configuration:

```
VITE_GAMEANALYTICS_ENABLED=true
VITE_GAMEANALYTICS_GAME_KEY=<dedicated game collection key>
VITE_GAMEANALYTICS_SECRET_KEY=<dedicated game collection signing key>
```

The shipped `.env.example` disables telemetry and leaves both keys empty. No real credentials are added, transferred, generated or configured. Missing either key, invalid shape, disabled configuration, or an ordinary URL produces safe no-op behavior and **does not import the SDK**. Assistance and new factual events follow the same no-op boundary. No credentials are required to play.

**Browser key model:** the SDK accepts a game key and a game-specific collection signing “secret.” Browser bundles cannot keep either value private; `VITE_*` values are shipped publicly. Anyone with these values could forge collection events. Only game-scoped browser SDK collection credentials belong here; never use an account/admin API key, private server credential, token, password or unrelated secret. Private ingestion would require a separately approved backend design.

The installed npm 5.0.0 runtime exports `gameanalytics.GameAnalytics`, despite README/type declaration examples claiming a named `GameAnalytics`. The adapter validates that namespace boundary. It uses the documented configureBuild, available custom dimensions, setCustomDimension01/02/03, initialize, addDesignEvent and addProgressionEvent methods. Progression status values remain Start=1, Complete=2, Fail=3; the numeric score remains the fifth argument. No custom fields are needed.

Early events queue until the asynchronous SDK session is ready, capped at 100. The remote-config readiness callback defers one microtask so provider initialization completes before draining the queue. A 10-second timeout, import rejection, initialization-call failure or provider-call throw disables analytics without interrupting play. The callback can also occur after an offline/unauthorized response; ready is not evidence of authentication or server receipt. Transport callback exceptions inside the SDK are outside this adapter's call boundary; absent readiness still times out. Optional SDK health events are disabled. Unit tests use fake providers, never analytics network calls.

Provider sessions remain automatic. Blur/visibility signals are deduplicated and do not imply quitting. `pagehide_unknown` is best effort; asynchronous XHR does not guarantee that event or end-session delivery. There is no synchronous request, unload blocking or manual session hack. Only explicit Return-to-landing is `voluntary_quit`.

### Revision, dimensions and assistance mapping

- Build: package version plus Vercel commit SHA, local git SHA, or local fallback, generated at build time
- Dimension 01: `playtest_v1`, retained as the existing broad public-route cohort label
- Dimension 02: `desktop` or `touch` at entry
- Dimension 03: `x`, `reddit`, `discord`, `direct`, `unknown`
- Controlled validation design events start with **`playtest_open_v2`**; free-play engagement uses the independent **`playtest_engagement_v1`** prefix
- Progression first key: **`playtest_open_v2`**; second key: `calibration` or `core`
- Core progression third key: `unassisted` or `assisted`, captured when the event is enqueued; calibration has no third key

The closed revision namespace separates open calibration and its core attempts from historical choreography without consuming a fourth dimension. Dimension 01 alone must never be used to combine incompatible revisions.

Design events capture the stage in a closed suffix: `calibration`, `core_unassisted`, or `core_assisted`. Landing/start remain global within the new namespace. Examples:

```
playtest_open_v2:calibration_complete:calibration
playtest_open_v2:slow_time_observed:core_unassisted
playtest_open_v2:hint_no_attack:core_assisted
playtest_open_v2:core_complete:core_assisted
playtest_open_v2:player_death:core_unassisted
playtest_open_v2:voluntary_quit:core_assisted
playtest_open_v2:feedback:fun:position:core_assisted
```

The combined core-stage/assistance token keeps even feedback within the SDK's five-segment design-event limit. Each segment is at most 32 characters. Classification is snapshotted at enqueue time, so a delayed SDK load or later retry cannot relabel earlier events.

The app calls `stage('core')` for each new attempt and `assistance(true)` when a fallback becomes visible. The adapter also marks any of the three closed hint events as assisted defensively. Progression terminal events classify completion/failure by the final assistance state; design events distinguish death from explicit quit. A mid-attempt Retry/Return fails the abandoned attempt; browser lifecycle never does.

**Analysis denominator:** every core attempt starts unassisted and may later become assisted. Do not interpret initial `unassisted` starts as a permanent cohort, or calculate an assisted completion rate from assisted-only starts. Compare terminal assisted/unassisted outcomes against all core starts within `playtest_open_v2`, and retain the separate death/quit design events. No per-attempt unique ID or new persistent identity is introduced.

Session/install identity remains provider-managed. The app sends no chosen user ID, raw URL, query string, seed, typed text, save data, name, email or replay. Enabling collection displays a short landing notice; without configuration it says nothing is transmitted. Real dashboard receipt remains **unverified** until approved keys are configured and a human smoke test checks receipt.

### Current event inventory

- Entry: `landing`, `start`
- Bounded observations in either stage: `first_move`, `first_look`, `first_attack`, `slow_time_observed`, `counter_observed`, `deflect_observed`, `hurt_observed`
- Calibration facts: `guard_defeated`, `healing_used`, `healing_skipped_resource_lost`, `calibration_complete`
- Funnel: stage calibration/core, `core_start`, `core_complete`, `player_death`, `voluntary_quit`, `retry`
- Progression: Start/Complete/Fail for each stage with closed core assistance classification
- Results numeric values: `real_time`, `damage`, `kills`
- Hints: `hint_inactivity`, `hint_no_attack`, `hint_repeated_damage`
- Lifecycle: `blur`, `pagehide_unknown`
- Feedback fun: slow_time/dodge_counter/position/none; issue: unclear/controls/hard/easy/slow/performance/none

Post-validation engagement has a separate method and closed vocabulary: `retry_core`, `continue_adventure`, `extended_play_start`, `extended_play_exit`, `extended_play_real_time`, `extended_play_floor`. IDs are `playtest_engagement_v1:<event>` without calibration/core/assistance suffixes. The engagement method cannot change the current validation stage or sticky assistance state. Real time is the ordinary cumulative unpaused World statistic across floors; floor reached is a finite numeric value sent only at an observable exit/result. No unique seed/class data or per-frame engagement is sent. These are engagement facts, never fun/success/retention claims.

All IDs/dimensions use closed vocabularies. Numeric results are values, never unique event-name segments. There is no per-frame event stream.

### Historical v1 data is not the new completion metric

The retired adapter emitted `playtest:*` design IDs and `playtest_v1` progression keys. Its `core_loop_learned` required two ordered, observed guard attack/evade/recovery-hit cycles. Despite the old name, it was a conservative behavioral proxy, not proof of understanding. The historical `attack_seen`, `attack_committed`, `evade_equivalent`, `recovery_hit_equivalent`, `calibration_cycle_failed` and `calibration_retry_needed` had choreography-specific meanings.

Those names are removed from the current production event allowlist and rejected if passed at runtime. They are not aliases for `calibration_complete`, and historical rows must not be renamed, backfilled or merged into the new funnel. Prior v1 core outcomes also lack the new assistance classification; they cannot be relabelled unassisted. Use revision-specific dashboards or explicitly separated comparisons.

### Official references retained

- https://github.com/GameAnalytics/GA-SDK-JAVASCRIPT
- https://www.npmjs.com/package/gameanalytics
- https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/open-source-sdks/javascript/event-tracking/
- https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/setup/
- https://raw.githubusercontent.com/GameAnalytics/GA-SDK-JAVASCRIPT/master/dist/GameAnalytics.d.ts

The installed npm artifact was inspected for the export/type boundary; this revision does not upgrade it.

## Verification and limits

The open-revision adapter's deterministic coverage includes revision-separated IDs/progression, rejection of retired events, both-stage factual observations, sticky assistance on all three bounded hints, completion/death/quit classification, delayed queue snapshots, retry reset, five-segment limits and disabled/no-key no-import behavior. Existing timeout, failed-provider, finite-number, privacy allowlist and lifecycle tests remain in place. These tests do not establish live provider delivery.

Current combined-source verification: **1,275 / 1,275 tests across 65 files**; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `git diff --check` all pass. New coverage includes real native Counter, Shove, held attack and zero-Counter melee routes at 30/60/120 FPS, slow time before/after kill and without camera/phase/distance restrictions, native healing timing through H/inventory/touch-mode inventory, dropped-resource recovery and thrown-resource fallback, immediate unknown skip, calibration damage protection and unprotected ordinary contexts, explicit core death/retry, ordinary Practice autoreset, and zero campaign save-key operations. Additional current coverage: 2.4 m healing placement at center/four walls/four corners and a low obstacle, stationary non-collection and actual walking pickup; formal disposable adventure entry after both Core outcomes, floor carry, ordinary lethal death, closed validation events, independent engagement, same-seed retry, duplicate gestures, stale/cancelled loads and storage isolation. Focused public checks: **138 tests across 5 files**. Earlier counts below remain historical baselines.

Simulation tests use real combat and ordinary FrameInput actions but may inspect state to act deterministically. App integration tests stub DOM/rendering/audio/input plumbing while running the real world and calibration state machines. These establish reachable states and regressions, not human visual acceptance, timing, enjoyment or understanding.

Current browser attempts: `node e2e/browser.mjs` could not find the bundled Playwright Chromium; `BROWSER_PATH=/usr/bin/chromium node e2e/browser.mjs` failed at process launch with `socket() failed: Operation not permitted`. Vite starts successfully on 127.0.0.1, but the cloud browser blocks that local URL with `ERR_BLOCKED_BY_CLIENT`. Historical cloud-browser attempts were blocked for localhost (`ERR_BLOCKED_BY_CLIENT`) and could not create WebGL on the published baseline (`GL_RENDERER = Disabled`, `Error creating WebGL context`). No browser restriction was bypassed and no user computer was used. Do not treat those attempts as visual acceptance of this revision. Rendering, manual playthrough, physical touch control, performance, live analytics receipt and new-player behavior remain unverified unless the final report supplies direct evidence.

### Core fixture review and remaining risk

The existing `shield-crossfire` is retained: a sheltered dog-leg start, two approaches around cover, native guard and perched archer provide positioning and mixed-threat choices. The current state-informed optimal sword route produced **three native windups** (archer, guard, archer), cleared in **4.967 active seconds**, and took **2 damage**. Stationary attack spam and a straight held-attack rush from spawn did not clear within a 20-second simulation check. This is concrete reachability/threat evidence, not a claim that all rush policies fail or that the encounter demands sufficient judgment. An optimally aimed/path-found route is short, so under-challenge is a remaining human-review risk. No evidence justifies replacing it with a more content-heavy existing fixture in this onboarding change; enemy/weapon balance is unchanged.

### Modified files and implementation assumptions

`src/main.ts`, `src/playtest/calibration.ts`, `src/playtest/telemetry.ts`, `src/ui/style.css`, `index.html`, four `tests/playtest*.test.ts` files (App, Calibration, Guidance, Telemetry), and this report. Existing lethal-protection tests remain applicable and pass unchanged. No settings, deployment, dependencies, identification, combat or save-format changes. The unrelated local `node_modules` snapshot symlink deletion is excluded from publication.

The open calibration already present on the verified base is preserved rather than reimplemented. The repository's lack of applicable AGENTS/override/repo skills was checked both locally and in the remote tree. The safe small in-memory adventure path was available, so the allowed normal-menu fallback was unnecessary. Optional unknown exposure stays one real haste potion; no Identify Scroll demonstration or class-selection expansion is added. If the healing bottle is deliberately spent without healing, the pre-existing explicitly logged resource-lost continuation remains available and does not pretend a drink occurred.

## Human review route

1. Keep an existing adventure save. Open `?playtest=1&src=direct`; verify the single start action, concise goal and correct analytics notice
2. Enter calibration wounded. Stop at any point and observe genuine slow time. Defeat the guard through native combat; try countering, ordinary attacks and alternate movement without following an imposed sequence
3. Repeat in the reverse order: defeat the guard before stopping. Verify that actual stopped slowdown still permits progression and no arbitrary cycle/timing requirement appears
4. Let several guard attacks land. Confirm real damage feedback and a 1-HP floor only in calibration, with no resurrection, per-frame refill or defeated-guard reset
5. Confirm the bottle appears away from the player; standing still must not collect it. Walk to collect the post-kill healing bottle. On desktop try H and the native inventory's 「喝」 separately; on touch use the bag's 「喝」. Verify real action/consumption/effect completion. Dropping and recollecting it must remain recoverable; intentionally spending it without healing must use the explicit resource-lost fallback
6. At the unknown item, verify immediate Continue is available without identifying or consuming it. Separately try the optional native-item flow
7. In the fresh core, choose position and target priority without ordered solution hints. Test unassisted clear, assisted clear, real death, retry and explicit quit. Verify assistance stays true after a hint vanishes and resets on the next attempt
8. Check minimal results, optional feedback, pause/resume/settings, mouse relock, focus/rotation interruption and mobile landscape layout. Confirm slow-time and actual attack/counter/deflect/hurt observations are available in both stages without repeated per-frame events
9. At Core death/clear Results, try Retry (no repeated calibration), then Continue Adventure. Confirm the finished-test/unsaved notice, real dungeon content/HUD/hunger/loot, floor transitions and ordinary death. Quit/retry free play; return to the ordinary URL and verify original adventure Continue data is unchanged. Confirm ordinary Practice still auto-resets on death and Boss/fixed-trial damage and entry rules remain unchanged
10. Only with approved provider configuration: inspect `playtest_open_v2` design/progression events, stage/assistance suffixes and source/device/build dimensions in a separate test analytics game. Keep historical v1 data separate, block provider traffic and verify the complete game remains playable

Human review is still required for readability, autonomous tactics, danger feedback, natural healing, optional-item distraction, encounter representativeness, touch/desktop feel and the desire to continue. No automated result proves understanding or enjoyment.

## Historical release and pointer-lock fix

The original choreography release recorded **1,196 / 1,196 tests across 62 files**. Its 2026-10-02 restart/guidance fix recorded **1,214 / 1,214 tests across 64 files**, plus typecheck, lint, build and whitespace checks. A state-informed bot cleared the unchanged core in 4.967 active real seconds, taking 2 damage and defeating both enemies; that was reachability evidence, not a human duration target.

The pointer-lock fix makes start/retry change mode before the gesture-owned request, checks document lock truth, settles stale pending requests, retries Resume after fallback and offers “重新鎖定滑鼠”. Explicit buttons do not queue combat input; lock changes/blur clear held input. Restricted environments retain right-drag/arrow fallback. These input safeguards remain relevant.

The historical guide's two-cycle count, backstep/recovery timing instructions, failure/retry choreography and `core_loop_learned` criterion are superseded by the open-calibration flow above. Preserve old analytics as old data; do not present those instructions or test totals as validation of the new design.

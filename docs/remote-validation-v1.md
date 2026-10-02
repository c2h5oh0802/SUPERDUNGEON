# RemoteValidationV1

Status: **Ready for Human Review**. This is an implementation and deterministic verification report, not acceptance of fun, tutorial timing, or real-player understanding.

## Entry and scope

- Public route: `https://superdungeon.vercel.app/?playtest=1`
- Attribution: add `&src=x`, `reddit`, `discord`, or `direct`. Missing/empty maps to `direct`; all other values map to `unknown`. Arbitrary URL/referrer text is never forwarded.
- `playtest=1` wins over `dev`/`boss`; there is no public `window.__sd` or state-injection UI.
- Ordinary URL, developer Boss mode, fixed trials and ordinary Practice retain their existing routes. Practice retains automatic death reset; public playtest requires a deliberate retry.
- Landing has one start button and the promise: 「停下腳步，時間就會慢下來。看清攻擊，再決定行動」. No class picker, seed entry, inventory introduction or adventure menu is shown.
- The calibration targets roughly 60–120 seconds for new human players. There is no timer that grants completion, artificial wait, or claim that this duration has been validated.

## Flow

Landing → GuidedCalibration → two evidenced cycles → CoreEncounterWarrior → completion/death results → optional feedback and explicit retry.

Calibration uses a lit, open authored arena with one **ordinary shield guard**. Its native 8 HP permits two ordinary 4-damage sword hits. The first cycle has context-sensitive prompts; after a successful cycle, the second retains the goal and progress without step-by-step timing hints. If the player defeats the guard prematurely, the game recommends an explicit restart through Pause. It does not respawn, refill health, mark learning, or silently advance. Player death retains results.

CoreEncounterWarrior uses the existing `shield-crossfire` level, including its cover, two approaches, guard, perched archer and safe dog-leg spawn. It is built directly through `World` with the normal Warrior starting loadout, avoiding the fixed trial's bonus consumables. This is a compact position/priority problem after a single-threat calibration. No enemy, weapon, class or combat-balance values were changed. Core completion means both existing enemies are defeated.

Existing world simulation, renderer, telegraphs, HUD, audio, player action commitments, slow-time rules and desktop/touch inputs are shared. Hunger, XP and random loot are excluded only for explicitly tagged public worlds; no other world changes. The compact public HUD hides growth/inventory information. Inventory/map overlays are not part of this short route. Native starting weapons, smoke, push and time controls remain ordinary combat actions.

Results show only outcome, active real play time, damage and kills. Time uses the existing clamped, unpaused World real-time statistic, not time spent in menus/background. Core Retry resets the core encounter; calibration Retry resets calibration. Return goes to the public landing and cannot open/read the campaign menu. Feedback is optional, fixed choice, once per result, with no text field or numerical rating.

## What `core_loop_learned` actually means

`CalibrationObserver` snapshots the real World before each frame and observes actual post-frame state and `GameEvent`s. It requires all of these, twice on distinct guard attack cycles:

1. Ordinary movement/look are measured for diagnostics only. Facing the centered guard already counts as looking; there is no extra camera-wiggle or approach-distance prerequisite. Actual movement after commitment remains required below.
2. Guard windup within the player's camera frustum and unobstructed world line of sight (shared `observesPoint` geometry)
3. At least 0.3 continuous real seconds stopped, with no movement/wait/action, while the visible threat advances at the actual idle slow-time ratio
4. The guard's real `locked` state while observed and at its actual false-to-true lock transition and within native sword reach plus forward step; starting outside that threat envelope does not count as evasion
5. At least 0.5 m actual movement after lock
6. The full attack active phase reaches recovery, with no player damage, block, hit, counter, push, stun, or interruption invalidating the chain
7. A fresh non-counter melee action begins during recovery and produces positive `hitEnemy` damage on that guard within the same recovery window

Pre-frame recovery/HP snapshots allow a lethal second recovery hit to count even though death clears the enemy phase. An attack pressed before recovery, held attack, damage, timer alone, off-camera attack or invented semantic event does not count. `evade_equivalent` is sent only after full damage-free active-phase resolution, not merely from a movement key or displacement.

This is a conservative behavioral proxy. It cannot prove that the player consciously read the attack or understood the time system. The frustum/LOS proxy is not eye tracking. It may reject skilled alternatives (for example, correctly countering instead of evading), or a hit very near a recovery boundary. Those limits are intentional and need human evaluation before broadening the criterion.

## Core hints

Normal HUD solution/tutorial hints are suppressed throughout public mode. The core objective only says to clear two enemies. Bounded fallback hints can appear once per kind:

- `hint_inactivity`: >22 active real seconds without movement/attack; suggests Pause/settings/retry
- `hint_no_attack`: >35 active real seconds with no actual swing/fire; names the attack control
- `hint_repeated_damage`: at least three actual hurt events; suggests pausing to observe or retrying

No ordered route, preferred target, shield solution or archer dodge solution is supplied. Existing combat cues and telegraphs remain visible. Each displayed fallback kind is logged separately.

## Save isolation

The route never constructs a campaign `RunState`, calls `App.loadRun`, reads the campaign save key, writes it, or deletes it. Guarded paths include constructor Continue refresh, hidden Continue/Start/New controls, `startRun`, `startFloor`, `saveRun`, results, retry and return. The campaign key is `superdungeon.run.v1`. Shared user settings still work through the separate settings key. Fresh worlds contain no campaign carry, level-ups or test loadout.

## GameAnalytics adapter

Only `src/playtest/telemetry.ts` knows the provider API. The game calls semantic methods. `gameanalytics` is pinned to **5.0.0** and bundled as an optional dynamic chunk.

Configuration, via the build owner's existing deployment configuration:

```
VITE_GAMEANALYTICS_ENABLED=true
VITE_GAMEANALYTICS_GAME_KEY=<dedicated game collection key>
VITE_GAMEANALYTICS_SECRET_KEY=<dedicated game collection signing key>
```

The shipped `.env.example` disables telemetry and leaves both keys empty. No real credentials were added, transferred, generated, or configured. No account, backend, replay system, or new provider integration was created. Missing either key, invalid shape, disabled configuration, or ordinary URL produces safe no-op behavior and **does not import the SDK**. No credentials are required to play.

**Browser key model:** The official JavaScript SDK accepts a game key and a game-specific collection signing “secret.” Browser bundles cannot keep either value private. `VITE_*` values are intentionally shipped publicly. Anyone with these browser-visible values could forge collection events; a private ingestion key would require a separate backend design, which is out of scope. Only the game-scoped SDK collection credentials belong here; never place an account/admin API key, private server credential, token, password, or unrelated secret in these variables. If the proposed value is a truly private credential, do not enable this integration with it.

The published npm 5.0.0 runtime exports `gameanalytics.GameAnalytics`, despite README/type declaration examples claiming a named `GameAnalytics`. The adapter validates that namespace boundary. It calls documented configureBuild, available custom dimensions, setCustomDimension01/02/03, initialize, addDesignEvent and addProgressionEvent. Progression status values are Start=1, Complete=2, Fail=3; progression keys are `playtest_v1` and `calibration` or `core`. The numeric score occupies the fifth argument; current package declarations put custom fields sixth, so examples placing a custom-fields object fifth must not be copied. No custom fields are needed here.

Events emitted before the asynchronous SDK session is ready are queued, capped at 100. An SDK remote-config readiness callback is deferred one microtask so provider session initialization completes before draining the queue. A 10-second timeout, import rejection, initialization-call failure, or provider-call throw makes analytics unavailable without interrupting gameplay. The provider callback can also occur after an offline/unauthorized response, so ready does not establish authentication or server receipt. Transport callback exceptions inside the third-party SDK are outside this adapter’s call boundary; missing readiness still times out. Optional SDK health events are disabled. No analytics network is used by unit tests.

The adapter uses the provider's automatic sessions. Blur/visibility signals are deduplicated and do not imply quitting. `pagehide_unknown` is best effort; the SDK uses asynchronous XHR, so neither that event nor end-session delivery is guaranteed. No synchronous request, unload blocking, or manual session hack is used. Only explicit Return-to-landing is `voluntary_quit`.

### Build and dimensions

- `configureBuild`: package version plus Vercel commit SHA (or local git SHA / local fallback), generated at build time
- Dimension 01: `playtest_v1`
- Dimension 02: `desktop` or `touch` at entry
- Dimension 03: `x`, `reddit`, `discord`, `direct`, `unknown`

The current stage is a closed event-ID suffix, so a core death/retry/result is distinguishable from calibration. Session/install identity is managed by GameAnalytics; the app sends no chosen user ID, raw URL, query string, seed, typed text, save data, name, email or replay. Enabling collection displays a short GameAnalytics notice on the landing; without configuration it explicitly says nothing is transmitted. Real remote dashboard receipt is **unverified** until the owner configures approved game keys and performs a human smoke test.

### Event inventory

- Entry: `landing`, `start`
- Behavioral: `first_move`, `first_look`, `slow_time_observed`, `attack_seen`, `attack_committed`, `first_attack`, `evade_equivalent`, `recovery_hit_equivalent`, `core_loop_learned`
- Calibration diagnostics: `calibration_cycle_failed`, `calibration_retry_needed`
- Funnel: stage calibration/core, `core_start`, `core_complete`, `player_death`, `voluntary_quit`, `retry`
- Progression: Start/Complete/Fail for each stage; explicit mid-attempt Retry/Return fails the abandoned attempt, while browser lifecycle never does
- Results numeric values: `real_time`, `damage`, `kills`
- Hints: `hint_inactivity`, `hint_no_attack`, `hint_repeated_damage`
- Lifecycle: `blur`, `pagehide_unknown`
- Feedback fun: slow_time/dodge_counter/position/none; issue: unclear/controls/hard/easy/slow/performance/none

All event IDs/dimensions use closed vocabularies. Numeric results are values, never unique event-name segments. There is no per-frame event stream.

### Official references checked

- https://github.com/GameAnalytics/GA-SDK-JAVASCRIPT
- https://www.npmjs.com/package/gameanalytics
- https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/open-source-sdks/javascript/event-tracking/
- https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/setup/
- https://raw.githubusercontent.com/GameAnalytics/GA-SDK-JAVASCRIPT/master/dist/GameAnalytics.d.ts

The installed npm artifact was inspected in addition to the docs to resolve the export/type mismatch.

## Changed files

- `src/playtest/scenario.ts`: disposable worlds
- `src/playtest/calibration.ts`: real-state evidence observer and first-cycle cues
- `src/playtest/telemetry.ts`: optional GameAnalytics boundary
- `src/main.ts`: public flow, guardrails, results, retries, feedback and lifecycle
- `src/gen/generator.ts`, `src/sim/world.ts`: explicit public-world tag and no-hunger/no-growth scope
- `src/ui/hud.ts`, `src/ui/style.css`, `index.html`: reduced public presentation and landing/feedback controls
- `vite.config.ts`, package files, `.env.example`, `.gitignore`: build identity, pinned SDK, configuration hygiene
- `tests/playtestCalibration.test.ts`, `tests/playtestTelemetry.test.ts`, `tests/playtestApp.test.ts`: isolated simulation, adapter and app boundaries

## Verification and limits

Initial release cloud checks: **1,196 / 1,196 tests across 62 files**, including 22 new App, 10 calibration/core and 36 adapter tests. Typecheck, full lint, production build and whitespace checks all passed. Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `git diff --check`.

A state-informed bot completed the unchanged core with native gear in 4.967 active real seconds / 4.899 world seconds, taking 2 damage and defeating both enemies with three melee hits. This establishes reachability, not a human duration target.

Simulation tests use real combat and ordinary FrameInput actions. They may read world state to act deterministically, so they are not human input/visual acceptance. App integration tests stub DOM, rendering/audio and input plumbing while running the real world/calibration state machines. Campaign save sentinel bytes and all campaign-key read/write/delete calls are checked. Provider tests use fakes only.

Cloud-browser local preview was attempted: Vite runs at `http://127.0.0.1:5173/`, but the supported browser returned `ERR_BLOCKED_BY_CLIENT` for localhost. No access restrictions were bypassed and no user computer was used. The authorized live cloud-browser attempt also reproduced the pre-existing baseline blocker: Three.js cannot create a WebGL context (`GL_RENDERER = Disabled`, `Error creating WebGL context`). The ordinary baseline menu markup is visible, but the application cannot initialize in that browser. Live public-route verification is attempted after publication. Rendering, full manual playthrough, physical touch control, performance, actual GameAnalytics receipt, new-player duration and fun remain separate verification limits unless the completion report supplies direct evidence.

## Human review route

1. Keep an existing ordinary adventure save, open `?playtest=1&src=direct` in a new tab, and verify the single start action and correct analytics notice
2. Start facing the guard at a safe stand-off. Follow the explicit stop/read, S backward through the full sword swing, W approach, then left-click-once cue; no extra camera motion is required. Independently repeat; confirm automatic transition into the two-enemy core
3. Try holding attack or killing the calibration guard early; confirm no false learned event and an explicit restart path
4. In the core, decide position and target priority without ordered solution hints; test both death and clear
5. Check minimal results, optional feedback, explicit Retry, pause/resume/settings, focus/rotation interruption and mobile landscape layout
6. Return to the ordinary URL and verify the adventure Continue data is unchanged; verify ordinary Practice still auto-resets on death and Boss/fixed-trial entries still work
7. Only with approved provider configuration: use a separate test analytics game, inspect design/progression funnels and stage suffixes, source/device/build dimensions and optional feedback; also block provider traffic and verify the full game remains playable

Do not mark this version Accepted until real-player observation establishes the target duration, readable cues, self-directed core behavior and enjoyment.

## Restart and guidance fix (2026-10-02)

- Root cause: a single pointer-lock failure on restart set fallback permanently; Resume skipped future lock requests. The result/menu mode could also reject a synchronously delivered successful lock, and the cached lock flag could outlive the document lock.
- Start/retry changes mode before the gesture-owned request; Input checks document truth, settles stale pending requests, and Resume retries even from fallback. A clickable “重新鎖定滑鼠” control offers recovery without restarting. Explicit button clicks do not queue combat input. Lock changes/blur clear held input. Restricted environments retain right-drag/arrow fallback.
- Safe front-facing starter: player z=9.5, guard z=6.5. The first instruction is to release controls and observe the approaching guard. The previous “walk until he raises his sword” instruction could carry the player too close for a full backward evade.
- Tutorial shows 0/2 and 1/2 progress, one current action with desktop/touch controls, continuous backward retreat until the whole active swing ends, proximity-gated return-hit instructions, and immediate success/failure feedback. Failed cycles retry on the next attack without resetting earned progress. Only an actual death/early defeated guard needs a full retry.
- No extra camera turn or pre-combat walk is required. A previously credited melee action's remaining active tail does not invalidate the next cycle by itself; new/held attacks, pre-recovery damage, countering, blocking, hurt, off-camera evidence and non-threatening distant dodges remain rejected. Neither backward movement nor sideways movement is mandatory in the evidence rule.
- Regression coverage includes real App + real Input over fake browser pointer-lock events (success, rejection, error, timeout, synchronous delivery, retries, focus and cached-state races). Seven of nine tests fail against the pre-fix source and pass with the fix. Actual-World zero-camera backward-evade/return-hit runs at 30/60/120 fps exercise the natural starter. These are deterministic state-informed tests, not human usability or enjoyment validation.
- Live cloud-browser retry still cannot create WebGL (`GL_RENDERER = Disabled`) on the pre-fix published baseline. No browser restriction was bypassed and no user computer was used.

Fix validation: **1,214 / 1,214 tests across 64 files**, typecheck, full lint, production build and whitespace check passed. The final added edge cases retain a valid late-recovery action tail without granting missing next-cycle observation, and reject retreat already outside threat at commitment even if the player re-enters during locked windup. Combat config/simulation and telemetry code/package settings are unchanged.

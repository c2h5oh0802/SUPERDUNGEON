# Public playtest readiness: bilingual release

Reviewed 2026-10-03 against the source based on `00a6efd` and the installed GameAnalytics JavaScript SDK **5.0.0**. This is a source review and a same-build verification checklist, not a record of stranger playtesting, real-phone validation, provider delivery, or legal compliance. The checks below are unrun unless a release verification record explicitly supplies evidence.

The release uses one English / Traditional Chinese build, with English as the default for a new visitor. This review does not expand analytics, change deployment configuration, or ask players to disable their browser protections. The existing decision to leave Brave blocking in place remains unchanged.

## What the current analytics integration actually does

This section supersedes any historical shorthand describing the playtest data as “anonymous,” “not personal data,” or only game actions. A random identifier can link visits; its being random does not make the whole dataset anonymous.

### App-authored data

- Analytics is limited to `?playtest=1` with explicit build enablement and syntactically valid configured collection keys. Ordinary game URLs do not load this SDK through the adapter (`src/playtest/telemetry.ts`, `createBrowserPlaytestTelemetry` and `loadGameAnalytics`).
- `openPlaytestLanding()` emits `landing`. Initialization can begin as the landing page opens, **before Start is clicked**. The Start button is not a consent control.
- Closed gameplay milestones, observed actions, displayed hints, calibration/core entry, completion/death/voluntary return/retry, optional multiple-choice feedback, play duration, damage and kills are submitted. Stage, walk-in versus fresh retry, and assistance labels accompany the relevant events.
- Optional continued adventure uses a separate, closed engagement vocabulary: choosing continuation, run start/exit, time and floor reached. These are not evidence that the player understood or enjoyed the game.
- The three app-defined dimensions are a fixed playtest cohort, touch/desktop control mode, and a normalized source category (`x`, `reddit`, `discord`, `direct`, `unknown`). The source is a closed category parsed from `src`, not an arbitrary URL. The build label is sanitized and bounded.
- The app does not add a name, typed feedback, chat, recording, save contents, raw key stream, or per-frame input trace as these gameplay event fields. Do not generalize this statement to every network header or SDK diagnostic.

### Data added by SDK 5.0.0

The following locations refer to `node_modules/gameanalytics/dist/GameAnalytics.esm.js`, not a claim about every SDK or another version:

- A randomly generated default user identifier is restored/created at lines 1741–1747 and saved at line 3957. Local storage can preserve it across visits. It is not a fresh identifier for every attempt.
- Event annotations at lines 1643–1678 include identifier, event UUID, timestamp, SDK/build version, OS/platform, browser version, session ID/count, and connection category. Browser/OS classification reads `navigator` information (lines 943–1043).
- Device and manufacturer fields exist, but this JavaScript SDK's implementations return `unknown` (lines 974–980). Do not claim this build detects a precise hardware model. The connection category is coarse SDK classification, not proof of a player's physical network technology (lines 924–935).
- SDK initialization itself includes identifier, OS/platform, SDK/build version and session counter (lines 1700–1718). Automatic session events and duration are additional to the app's gameplay events (lines 2624–2653).
- Local storage can hold identifiers, queued events, sessions, progression state and SDK settings/configuration (lines 1278–1328, 1733–1791, 3102–3158). Storage restriction can affect persistence. Closing a tab does not guarantee final event delivery.
- Health collection is explicitly disabled by the adapter before initialization. This does **not** disable all SDK diagnostic events: `sendSdkErrorEvent` may send error category/area/action/parameter/reason and technical annotations (lines 1681–1698, 2114–2151). For example, a storage failure can include an SDK error stack (lines 3139–3142).
- SDK remote configuration/A-B identifiers can be added if supplied by the provider (lines 1667–1674). The app does not itself introduce a new experiment in this release.

### Network metadata and collection boundaries

Requests go to GameAnalytics over HTTPS. The recipient necessarily processes normal connection metadata, including the request IP and browser-supplied headers. GameAnalytics documents country lookup from the request IP; this is country inference, not access to device GPS. Do not claim this implementation independently verified the provider's retention or all of its downstream processing. See [GameAnalytics Collection API, country lookup by IP](https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/setup/#country-lookup-by-ip).

The application does not grant geolocation permission or add an IP address field itself. That does not mean no IP is processed. Likewise, not adding a referrer field is not a promise that HTTP requests have no referrer information. Hosting the game also involves the host's normal web requests; disabling this SDK is not a claim that all hosting/network data disappears.

### Reliability interpretation

- `configured` means the app has enabled, valid-shaped configuration. `ready` means SDK calls can be attempted. Neither is evidence that an event reached GameAnalytics.
- The adapter bounds its early queue at 100, times out readiness after 10 seconds, and catches import / synchronous provider-call failures. It must not gate Start, pause, resume or retry on analytics.
- A blocked init or event endpoint, SDK chunk failure, offline state, storage denial or provider error must leave the game playable. Preserve Brave's current blocking behavior; do not instruct players to disable protections to continue.
- `blur` and `pagehide_unknown` are uncertain browser lifecycle signals. They must not be relabeled as voluntary quit, failure, or proof that a player stopped enjoying the game.
- The SDK uses asynchronous XHR. A tab close, successful local call, SDK readiness callback, or queued event is not delivery confirmation. Verify the particular event request/response or corresponding provider record if making a delivery claim.

## Proposed player-facing copy

Keep the brief text visible beside Start and the longer details readable through a native expandable section or equivalent. Present disclosure as information, without “by continuing you accept,” a claimed consent state, or a compliance badge. Use the enabled copy only when configured. A failed/blocked provider remains an optional component; no analytics warning should obstruct play.

### English: brief, configured

This playtest sends gameplay and optional feedback choices to GameAnalytics to improve the game. Its SDK uses a persistent random identifier and browser/device, session, and network information. Collection starts when this page opens. Details

### 繁體中文：簡述，已設定分析

本試玩會把遊玩事件與選填回饋傳送至 GameAnalytics，用於改善遊戲。SDK 使用持續儲存的隨機識別碼，並處理瀏覽器／裝置、工作階段及網路資訊；本頁開啟時就會開始收集。查看詳情

### English: details

We use GameAnalytics to understand where this playtest works or gets confusing. The game sends fixed gameplay milestones, outcomes, time, damage, retries, displayed hints, optional feedback choices, and a broad source/control-mode category. Continuing the adventure adds time, floor reached, and start/exit events.

GameAnalytics' SDK adds a random identifier that can persist between visits, session information, timestamps, browser/OS information, and technical device/network fields. It can store identifiers and queued events in this browser and may send technical error diagnostics. Network requests expose normal connection information, including an IP address; GameAnalytics documents using the IP to infer country.

The game does not record your screen, microphone or chat, or include a name or adventure save in these gameplay events. Feedback is optional. Analytics may start before you press Start. A browser blocker or analytics failure does not prevent playing, and feedback delivery is not guaranteed.

### 繁體中文：詳情

我們使用 GameAnalytics 了解這次試玩哪些地方順暢、哪些地方容易卡住。遊戲會傳送固定的遊玩里程碑、結果、時間、受傷量、重試、顯示過的提示、選填回饋，以及概略的來源與操作方式分類。繼續冒險時，另記錄遊玩時間、抵達樓層及開始／離開事件。

GameAnalytics SDK 另附可跨次造訪保留的隨機識別碼、工作階段、時間戳記、瀏覽器／作業系統資訊，以及裝置與網路技術欄位。它可能在此瀏覽器儲存識別碼與待送事件，並傳送技術錯誤診斷。網路請求會讓服務接收一般連線資訊，包含 IP 位址；GameAnalytics 文件說明會用 IP 推估國家。

遊戲不錄製畫面、麥克風或聊天，也不會在這些遊玩事件中加入姓名或冒險存檔。回饋為選填。按下開始前，分析就可能已經啟動。瀏覽器阻擋或分析故障不會妨礙遊玩；回饋不保證能成功送達。

### Analytics not configured

- English: “GameAnalytics is off for this build. This game does not send playtest analytics or feedback choices to GameAnalytics.”
- 繁體中文：「此版本未啟用 GameAnalytics。遊戲不會向 GameAnalytics 傳送試玩分析或回饋選項。」

### Optional feedback status

- Disabled: “Thanks! Analytics is off; your choices stay on this screen and are not sent.” /「謝謝！分析未啟用；選項只留在本次畫面，不會傳送。」
- Unavailable before submission: “Thanks! Analytics is unavailable, so these choices could not be sent.” /「謝謝！分析服務目前無法使用，這次選項未能送出。」
- Attempted: “Thanks! We tried to send your choices. Delivery is not guaranteed.” /「謝謝！已嘗試送出你的選擇，網路傳送不保證成功。」

## Focused source-review findings

These locations describe the starting snapshot, before the bilingual/recovery edits. Recheck their disposition against the final commit; do not report them as still open without that recheck.

1. **Incomplete privacy description.** `src/main.ts:1021–1024` emits landing before showing the description, which describes data as anonymous; `src/playtest/telemetry.ts:137` repeats that characterization. Use the copy and boundaries above. Historical wording in `docs/remote-validation-v1.md:29` must not be read as a privacy claim for the whole SDK.
2. **No visible boot/load/runtime recovery.** `index.html:386` loads only the module; `src/main.ts:1232` constructs App without a recovery boundary. `startWorld`'s timer at lines 561–626 has unguarded world/renderer construction, and the frame loop schedules another frame even after a callback throws (`src/core/loop.ts:25–29`). Distinguish failed initial script/WebGL loading, later world loading, and a running-game failure. Expose a usable reload/return path; stop the failing gameplay loop and input before showing runtime recovery. Do not simply map every global error to “loading failed.”
3. **Interrupted loading can enter play later.** `onFocusLost` at lines 766–769 and `onLockChange` at 763 ignore `loading`; the pending lock completion at 583–588 calls `enterPlaying`. Input capture also excludes loading at line 106, so Escape before a lock is acquired needs its own narrow loading path. Preserve an interruption through completion and stay paused until an explicit resume. Keep the existing `worldTransition` checks to reject stale timer and lock completions.
4. **Optional SDK errors need isolation when adding recovery.** Adapter catches cover its calls, not every asynchronous SDK callback. For example SDK init and event-response handlers use `JSON.parse` at lines 2213 and 2168. A blanket window-error fatal overlay would let malformed analytics responses stop an otherwise functioning game. Catch owned boot/world/frame failures locally; keep unrelated SDK/resource failures nonfatal.
5. **Actual browser coverage remains distinct.** `tests/playtestApp.test.ts` mocks telemetry, renderer, HUD, loop, input and touch; it proves controller state assertions, not real script fetch, WebGL, pointer lock, native controls, or text layout. Existing browser/mobile suites cover valuable normal-mode paths but do not by themselves establish the final public bilingual route. Use the same production build for the checks below.

## Same-build release and stranger checklist

Record the exact commit/build and URL, date, locale, browser/version, platform and input mode. Mark each item **pass / fail / not run** with a brief observation. Keep browser automation, synthetic fault injection, real-device checks and genuine first-time-human observations separately labeled. Do not convert automated success into “strangers understand the game.”

### Actual browser: entry, language and readability

- [ ] Open the final production build's `?playtest=1` in a clean browser profile through a real document/script load. English is the default; loading and any pre-module fallback are visible and understandable without waiting for main.ts to execute.
- [ ] Switch to Traditional Chinese and back using native UI. Check landing, privacy details, initial control instructions, calibration cue, item pickup/use/inventory, core entry, pause/settings, loading, death/completion, retry, optional feedback, continued adventure, return and error recovery. Read actual rendered text, including accessible names and live-status strings.
- [ ] Refresh after choosing a language and check the documented persistence behavior. Deny localStorage and repeat: the current page remains usable and no storage exception hides the game.
- [ ] At desktop and compact touch viewport sizes, confirm headings, bilingual details, controls and long buttons neither overlap nor become unreachable. Keyboard-focus the language selector, privacy disclosure and Start.
- [ ] Start twice rapidly. Only one world and active loop result; there is no duplicate start/funnel from the ignored click.

### Interruption, recovery and repeat behavior

- [ ] Enter play, hold movement/attack, then press Esc; world simulation pauses, held input clears, pointer lock releases, and Resume returns without an unexpected move/attack or time jump. Repeat after opening/closing inventory.
- [ ] During deliberately delayed world creation or pending pointer lock, press Esc, blur the window and hide the tab in separate cases. On completion the game remains paused; a later lock completion cannot capture a returned landing screen. Repeat with pointer lock already denied, where Escape has no unlock event to rely on.
- [ ] Resume after pointer-lock refusal using the displayed fallback. Actually move, turn and attack, then pause and retry. Controls stay usable; there is no repeated mandatory lock request or analytics gate.
- [ ] Retry from calibration and core pause/results repeatedly. Calibration starts with its intended half-health/protected state; a fresh core retry starts at full health with the initial warrior loadout and reset hints. Walk-in core entry keeps its distinct carry-over state.
- [ ] Quit to the landing during a pending load, then start again. Old timer/promise completions do not replace or recapture the new screen/world.
- [ ] Observe a genuine death/completion, optional feedback submit, retry, continued adventure and return. Feedback is optional, buttons remain usable, and attempted delivery is not labeled as received.
- [ ] Preserve a normal adventure save before the public route. Public calibration, core, retry, continued adventure and return do not alter that save; shared language/control settings are tested separately.

### Touch and orientation

- [ ] In a touch-capable browser, start from the public landing in landscape. Two contacts can move and fire-drag aim independently. Short taps trigger once; held attack repeats; releasing/canceling contacts stops repetition.
- [ ] While contacts are held, open inventory/pause and return, change orientation, switch tabs, and trigger pointer cancel/lost capture. No stale movement, attack or aim survives. Native language/details/menu controls do not trigger gameplay beneath them.
- [ ] Rotate to portrait while loading and while playing. Confirm pause/instructions and a reachable return action. Rotate back; resume is explicit and restores visible controls. Check compact landscape separately.
- [ ] On actual targeted phones, check readable text, reachable controls, browser bars/safe areas, audio activation, fullscreen refusal and real performance. Emulation is not evidence of real-phone performance or comfort.

### Analytics must remain optional

- [ ] Against the same enabled build, block the SDK chunk, block initialization, block only event delivery after init, and take the browser offline in separate cases. Start, all required gameplay, pause, resume, retry and feedback UI remain usable.
- [ ] Exercise denied storage and a provider timeout. The app does not treat adapter `ready` as delivery; unknown source strings cannot become arbitrary telemetry values.
- [ ] Inject a malformed SDK response in a browser-only test. Any resulting SDK error is nonfatal to the game and is not misreported as a game-load or runtime failure.
- [ ] In Brave with its current protections unchanged, record observable playability and actual network blocking as separate facts. Do not require disabling protections or claim blocked events arrived.
- [ ] If delivery is checked using already authorized test configuration, distinguish an init request, an event request with successful response, and a visible provider event. Do not copy keys, identifiers or raw event payloads into the public report.

### Loading failure versus runtime failure

- [ ] Fail the initial main module/chunk before execution: the static boot failure message remains readable, localized as supported at boot, and offers a reachable reload. No reliance on a running App to show this state.
- [ ] Reject WebGL renderer construction at startup: the failure is visible, does not leave only an empty canvas, and explains a useful retry/browser path without diagnosing analytics as the cause.
- [ ] Throw during world creation after Start: world-loading recovery replaces the spinner and releases gameplay input; it is not left “loading” indefinitely.
- [ ] Throw during simulation/render after a successfully started game: a runtime-specific message appears, the loop/audio/input are safely stopped or suspended, and retry/reload does not create duplicate listeners/loops.
- [ ] Fail an optional analytics request or unrelated noncritical resource after the game starts: the fatal recovery UI does not appear just because a global error was observed.

### First-time human pass, once available

- [ ] A person unfamiliar with the build opens exactly the tested release, chooses their language and tries it without developer state injection or coaching. Record what they actually do and where they hesitate, rather than declaring comprehension from a milestone.
- [ ] Ask them to pause/resume and retry using the visible controls, and find/read the analytics details. Note whether the current language explains the interruption and recovery path.
- [ ] Record browser/control mode, observed blocker, and their optional stated reaction. Do not label unobserved outcomes as fun, retention, success or consent. This section stays **not run** until a real observation exists.

## Verification record

This independent source-review pass ran no game build, browser test, provider delivery check or human session. It added this document only. The release owner should record final automated and browser results for the exact published commit in the release report; the checklist is not a substitute for those results.


## Implemented release verification

The bilingual release adds display-boundary localization for static DOM text, dynamic game/UI text and accessible labels, plus canvas map room labels and the CSS alert indicator. All content remains in a single build; no remote translation service is used. The stored setting is `language` under the existing settings key, defaulting to `en`; campaign snapshots and analytics identifiers retain their original values. A native selector appears at entry, in Settings, on mobile intro, and on the recoverable error screen.

Owned failures are caught at bootstrap, world construction/entry, and the game-frame boundary. They use distinct visible messages and reload recovery; optional SDK errors are not wired to that fatal screen. Esc, loss of focus or unintentional pointer unlock during loading preserve a paused destination. Late lock acquisition is rejected on an error screen as well as on menus/results.

Verification in the cloud workspace:
- Complete Vitest suite, TypeScript, ESLint, production build and whitespace checks passed (final counts are in the release report).
- Localization tests inspect all current static text/accessible attributes and actual class/item/equipment/upgrade/room outputs. Additional tests cover English defaults, persisted and blocked settings, unchanged tokens, calibration/HUD/touch composition and error/interruption flows.
- An additional actual App + World + HUD DOM harness, with renderer/audio/animation-loop stubs, checked the landing, calibration/core HUD, pause/settings switching, inventory, core results, continued adventure, and adventure pause/inventory/results for untranslated text. This is controlled state coverage, not rendered play or human observation.
- A separate DOM/MutationObserver harness used the actual entry HTML and production localization modules. It checked initial English, all static Chinese text translated, dynamic text and HTML, three round trips between languages, error-message switching, and unchanged feedback values. This is a DOM test, not browser rendering or a human session.
- Local real-browser launch was attempted: cloud browser access to loopback was refused (`ERR_BLOCKED_BY_CLIENT`); isolated Chromium could not launch because its process singleton socket is unavailable in this environment. These are verification environment limits, not evidence of a game defect. Production page verification is recorded separately after publication.
- No user computer, production credentials, deployment settings, or actual strangers were used. Actual phone feel/performance and first-time-human comprehension are still not verified.

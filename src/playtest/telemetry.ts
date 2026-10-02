/**
 * Optional GameAnalytics 5.0.0 adapter. Ordinary game URLs never load the SDK.
 *
 * The browser SDK requires a game-specific collection "secret" to sign events.
 * A VITE_* value is visible in the shipped JavaScript: it is NOT a private server
 * credential. Never put account/API/admin secrets here or commit real keys.
 * See https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/setup/
 *
 * The installed 5.0.0 ESM runtime exports `gameanalytics`, despite its README and
 * declarations advertising a named `GameAnalytics` export. Keep the narrow
 * runtime boundary below until an SDK upgrade has been verified.
 */

export const PLAYTEST_EVENT_NAMES = [
  'landing', 'start', 'first_move', 'first_look', 'first_attack', 'slow_time_observed',
  'attack_seen', 'attack_committed', 'evade_equivalent', 'recovery_hit_equivalent',
  'core_loop_learned', 'core_start', 'core_complete', 'player_death',
  'voluntary_quit', 'retry', 'hint_inactivity', 'hint_no_attack',
  'hint_repeated_damage', 'calibration_retry_needed', 'calibration_cycle_failed',
  'blur', 'pagehide_unknown', 'real_time', 'damage', 'kills',
] as const;
export type PlaytestEventName = typeof PLAYTEST_EVENT_NAMES[number];
export type PlaytestStage = 'calibration' | 'core';
export type PlaytestSource = 'x' | 'reddit' | 'discord' | 'direct' | 'unknown';
export type PlaytestDevice = 'desktop' | 'touch';
export type PlaytestFun = 'slow_time' | 'dodge_counter' | 'position' | 'none';
export type PlaytestIssue = 'unclear' | 'controls' | 'hard' | 'easy' | 'slow' | 'performance' | 'none';
export type PlaytestTelemetryStatus = 'disabled' | 'loading' | 'ready' | 'unavailable' | 'disposed';

const SOURCES: PlaytestSource[] = ['x', 'reddit', 'discord', 'direct', 'unknown'];
const DEVICES: PlaytestDevice[] = ['desktop', 'touch'];
const FUN: PlaytestFun[] = ['slow_time', 'dodge_counter', 'position', 'none'];
const ISSUES: PlaytestIssue[] = ['unclear', 'controls', 'hard', 'easy', 'slow', 'performance', 'none'];
const EVENT_NAMES = new Set<string>(PLAYTEST_EVENT_NAMES);
const COHORT = 'playtest_v1';
const MAX_PENDING_EVENTS = 100;
const READY_TIMEOUT_MS = 10_000;
const PROGRESSION = { start: 1, complete: 2, fail: 3 } as const;

export function normalizePlaytestSource(raw: string | null | undefined): PlaytestSource {
  if (raw == null || raw.trim() === '') return 'direct';
  const source = raw.trim().toLowerCase();
  return SOURCES.includes(source as PlaytestSource) ? source as PlaytestSource : 'unknown';
}

type RemoteConfigListener = { onRemoteConfigsUpdated(): void };

/** A deliberately small boundary, also used by offline tests. No private SDK APIs. */
export interface PlaytestAnalyticsProvider {
  configureBuild(build: string): void;
  configureAvailableCustomDimensions01(values: string[]): void;
  configureAvailableCustomDimensions02(values: string[]): void;
  configureAvailableCustomDimensions03(values: string[]): void;
  setCustomDimension01(value: string): void;
  setCustomDimension02(value: string): void;
  setCustomDimension03(value: string): void;
  setEnabledInfoLog(enabled: boolean): void;
  setEnabledVerboseLog(enabled: boolean): void;
  setEnabledEventSubmission(enabled: boolean): void;
  enableHealthEvent(enabled: boolean): void;
  initialize(gameKey: string, secretKey: string): void;
  addDesignEvent(name: string, value?: number): void;
  addProgressionEvent(status: 1 | 2 | 3, first: string, second?: string, third?: string, score?: number): void;
  addRemoteConfigsListener(listener: RemoteConfigListener): void;
  removeRemoteConfigsListener(listener: RemoteConfigListener): void;
  isRemoteConfigsReady(): boolean;
}

export interface PlaytestTelemetryConfig {
  enabled: boolean;
  gameKey?: string;
  secretKey?: string;
  build?: string;
  source?: string | null;
  device: PlaytestDevice;
}

export interface PlaytestTelemetry {
  /** Synchronous configuration notice, not evidence of network delivery. */
  readonly configured: boolean;
  /** ready means provider calls can be attempted, never server acknowledgement. */
  readonly status: PlaytestTelemetryStatus;
  landing(): void;
  start(): void;
  stage(stage: PlaytestStage): void;
  progression(status: keyof typeof PROGRESSION, stage: PlaytestStage, score?: number): void;
  event(name: PlaytestEventName, value?: number): void;
  retry(): void;
  feedback(fun?: PlaytestFun, issue?: PlaytestIssue): void;
  visibility(hidden: boolean): void;
  pagehide(): void;
  dispose(): void;
}

type PendingEvent =
  | { kind: 'design'; id: string; value?: number }
  | { kind: 'progression'; status: 1 | 2 | 3; stage: PlaytestStage; score?: number };

async function loadGameAnalytics(): Promise<PlaytestAnalyticsProvider> {
  // Dynamic import is reached only after explicit enablement AND valid keys.
  const module: unknown = await import('gameanalytics');
  const sdk = (module as { gameanalytics?: { GameAnalytics?: PlaytestAnalyticsProvider } })
    .gameanalytics?.GameAnalytics;
  if (!sdk || typeof sdk.initialize !== 'function') throw new Error('Unsupported analytics SDK export');
  return sdk;
}

function validNumber(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1_000_000_000);
}

function validStage(stage: PlaytestStage): boolean {
  return stage === 'calibration' || stage === 'core';
}

/**
 * Uses only closed event IDs, finite numbers, and three low-cardinality dimensions.
 * No URL/referrer, typed feedback, player name, save data, or custom user ID is sent.
 * The SDK manages its own anonymous install identifier and automatic sessions.
 */
export function createPlaytestTelemetry(
  config: PlaytestTelemetryConfig,
  loader: () => Promise<PlaytestAnalyticsProvider> = loadGameAnalytics,
): PlaytestTelemetry {
  const gameKey = config.gameKey?.trim() ?? '';
  const secretKey = config.secretKey?.trim() ?? '';
  const configured = config.enabled === true && /^[A-Za-z0-9]{32}$/.test(gameKey)
    && /^[A-Za-z0-9]{40}$/.test(secretKey);
  const source = normalizePlaytestSource(config.source);
  const device = DEVICES.includes(config.device) ? config.device : 'desktop';
  const build = (config.build ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'unversioned';
  let state: PlaytestTelemetryStatus = configured ? 'loading' : 'disabled';
  let loadingStarted = false;
  let sdk: PlaytestAnalyticsProvider | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending: PendingEvent[] = [];
  let currentStage: PlaytestStage | undefined;
  let lastHidden = false;
  let hiddenPageReported = false;

  function removeReadinessListener(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    try { sdk?.removeRemoteConfigsListener(listener); } catch { /* Never affect play. */ }
  }

  function unavailable(): void {
    if (state === 'disposed' || state === 'disabled') return;
    state = 'unavailable';
    pending.length = 0;
    removeReadinessListener();
    try { sdk?.setEnabledEventSubmission(false); } catch { /* Provider is optional. */ }
  }

  function send(event: PendingEvent): void {
    if (!sdk || state !== 'ready') return;
    try {
      if (event.kind === 'design') sdk.addDesignEvent(event.id, event.value);
      else sdk.addProgressionEvent(event.status, COHORT, event.stage, undefined, event.score);
    } catch { unavailable(); }
  }

  // The provider fires this callback before assigning its session ID. Defer one
  // microtask so the provider finishes that synchronous callback before sending.
  const listener: RemoteConfigListener = {
    onRemoteConfigsUpdated() {
      void Promise.resolve().then(() => {
        if (state !== 'loading') return;
        state = 'ready';
        removeReadinessListener();
        const queued = pending.splice(0);
        for (const event of queued) send(event);
      });
    },
  };

  function load(): void {
    if (loadingStarted || state !== 'loading') return;
    loadingStarted = true;
    timer = setTimeout(unavailable, READY_TIMEOUT_MS);
    void Promise.resolve().then(loader).then((provider) => {
      if (state !== 'loading') return;
      sdk = provider;
      sdk.setEnabledInfoLog(false);
      sdk.setEnabledVerboseLog(false);
      sdk.enableHealthEvent(false);
      sdk.configureBuild(build);
      sdk.configureAvailableCustomDimensions01([COHORT]);
      sdk.configureAvailableCustomDimensions02([...DEVICES]);
      sdk.configureAvailableCustomDimensions03([...SOURCES]);
      sdk.setCustomDimension01(COHORT);
      sdk.setCustomDimension02(device);
      sdk.setCustomDimension03(source);
      sdk.addRemoteConfigsListener(listener);
      sdk.initialize(gameKey, secretKey);
      if (sdk.isRemoteConfigsReady()) listener.onRemoteConfigsUpdated();
    }).catch(unavailable);
  }

  function enqueue(event: PendingEvent): void {
    if (state === 'ready') send(event);
    else if (state === 'loading') {
      // Preserve the earliest funnel events if an offline client produces a lot.
      if (pending.length < MAX_PENDING_EVENTS) pending.push(event);
      load();
    }
  }

  function event(name: PlaytestEventName, value?: number): void {
    if (!EVENT_NAMES.has(name) || !validNumber(value)) return;
    if (name === 'landing' || name === 'start') currentStage = undefined;
    enqueue({ kind: 'design', id: contextualId(`playtest:${name}`), value });
  }

  function contextualId(id: string): string {
    // Dashboard design events cannot infer stage from a previously sent event.
    // Capture the closed stage now, not when an early-event queue is flushed.
    return currentStage ? `${id}:${currentStage}` : id;
  }

  return {
    configured,
    get status() { return state; },
    landing: () => event('landing'),
    start: () => event('start'),
    stage(stage) {
      if (!validStage(stage)) return;
      currentStage = stage;
      enqueue({ kind: 'design', id: `playtest:stage:${stage}` });
    },
    progression(status, stage, score) {
      if (Object.hasOwn(PROGRESSION, status) && validStage(stage) && validNumber(score)) {
        enqueue({ kind: 'progression', status: PROGRESSION[status], stage, score });
      }
    },
    event,
    retry: () => event('retry'),
    feedback(fun, issue) {
      if (fun !== undefined && FUN.includes(fun)) enqueue({ kind: 'design', id: contextualId(`playtest:feedback:fun:${fun}`) });
      if (issue !== undefined && ISSUES.includes(issue)) enqueue({ kind: 'design', id: contextualId(`playtest:feedback:issue:${issue}`) });
    },
    visibility(hidden) {
      if (hidden && !lastHidden) event('blur');
      if (!hidden) hiddenPageReported = false;
      lastHidden = hidden;
    },
    pagehide() {
      // Browser lifecycle signals do not mean a deliberate quit or failure.
      // The SDK uses async XHR: neither this event nor delivery is guaranteed.
      if (!hiddenPageReported) event('pagehide_unknown');
      hiddenPageReported = true;
    },
    dispose() {
      state = 'disposed';
      pending.length = 0;
      removeReadinessListener();
      try { sdk?.setEnabledEventSubmission(false); } catch { /* Never affect play. */ }
    },
  };
}

/** Called only for public playtests; the URL guard also protects accidental use. */
export function createBrowserPlaytestTelemetry(context: {
  source?: string | null;
  device: PlaytestDevice;
}): PlaytestTelemetry {
  const publicPlaytest = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('playtest') === '1';
  return createPlaytestTelemetry({
    enabled: publicPlaytest && import.meta.env.VITE_GAMEANALYTICS_ENABLED === 'true',
    gameKey: import.meta.env.VITE_GAMEANALYTICS_GAME_KEY,
    secretKey: import.meta.env.VITE_GAMEANALYTICS_SECRET_KEY,
    build: import.meta.env.VITE_BUILD_ID,
    source: context.source,
    device: context.device,
  });
}

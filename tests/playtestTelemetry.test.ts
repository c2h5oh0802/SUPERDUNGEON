import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserPlaytestTelemetry, createPlaytestTelemetry, normalizePlaytestSource,
  PLAYTEST_ENGAGEMENT_EVENT_NAMES, PLAYTEST_ENGAGEMENT_NAMESPACE,
  PLAYTEST_EVENT_NAMES, PLAYTEST_TELEMETRY_NAMESPACE,
  type PlaytestAnalyticsProvider, type PlaytestEngagementEventName, type PlaytestEventName, type PlaytestFun,
  type PlaytestIssue, type PlaytestStage, type PlaytestTelemetryConfig,
} from '../src/playtest/telemetry';

const sdkImport = vi.hoisted(() => vi.fn());
vi.mock('gameanalytics', () => {
  sdkImport();
  return { gameanalytics: { GameAnalytics: {} } };
});

type Listener = Parameters<PlaytestAnalyticsProvider['addRemoteConfigsListener']>[0];

function mockProvider() {
  const listeners = new Set<Listener>();
  let ready = false;
  const sdk = {
    configureBuild: vi.fn(),
    configureAvailableCustomDimensions01: vi.fn(),
    configureAvailableCustomDimensions02: vi.fn(),
    configureAvailableCustomDimensions03: vi.fn(),
    setCustomDimension01: vi.fn(),
    setCustomDimension02: vi.fn(),
    setCustomDimension03: vi.fn(),
    setEnabledInfoLog: vi.fn(),
    setEnabledVerboseLog: vi.fn(),
    setEnabledEventSubmission: vi.fn(),
    enableHealthEvent: vi.fn(),
    initialize: vi.fn(),
    addDesignEvent: vi.fn(),
    addProgressionEvent: vi.fn(),
    addRemoteConfigsListener: vi.fn((listener: Listener) => { listeners.add(listener); }),
    removeRemoteConfigsListener: vi.fn((listener: Listener) => { listeners.delete(listener); }),
    isRemoteConfigsReady: vi.fn(() => ready),
  } satisfies PlaytestAnalyticsProvider;
  return {
    sdk,
    ready() {
      ready = true;
      for (const listener of listeners) listener.onRemoteConfigsUpdated();
    },
  };
}

const CONFIG: PlaytestTelemetryConfig = {
  enabled: true,
  // Shape-only test values. These are never sent to an analytics service.
  gameKey: 'g'.repeat(32),
  secretKey: 's'.repeat(40),
  build: 'test-build-123',
  source: 'reddit',
  device: 'touch',
};

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('public playtest telemetry configuration', () => {
  it.each([
    { enabled: false }, { gameKey: undefined }, { secretKey: undefined },
    { gameKey: '' }, { secretKey: '' }, { gameKey: 'partial' },
    { secretKey: 'bad-key-shape' },
  ])('never imports the provider for disabled/missing/invalid configuration %j', async (override) => {
    const loader = vi.fn(async () => mockProvider().sdk);
    const telemetry = createPlaytestTelemetry({ ...CONFIG, ...override }, loader);
    telemetry.landing();
    telemetry.start();
    telemetry.feedback('position', 'none');
    telemetry.progression('start', 'calibration');
    telemetry.stage('core');
    telemetry.assistance(true);
    telemetry.event('hint_no_attack');
    telemetry.event('core_complete');
    telemetry.progression('complete', 'core', 1);
    for (const name of PLAYTEST_ENGAGEMENT_EVENT_NAMES) telemetry.engagement(name, 1);
    await flush();
    expect(telemetry.configured).toBe(false);
    expect(telemetry.status).toBe('disabled');
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not load or create a session until a configured playtest emits an event', () => {
    const loader = vi.fn(async () => mockProvider().sdk);
    const telemetry = createPlaytestTelemetry(CONFIG, loader);
    expect(telemetry.configured).toBe(true);
    telemetry.assistance(true);
    telemetry.assistance(false);
    expect(loader).not.toHaveBeenCalled();
    telemetry.dispose();
  });

  it.each(['', '?dev=1&boss=1', '?playtest=0', '?playtest=true'])('hard-disables the browser factory on normal URL %s', async (search) => {
    vi.stubGlobal('location', { search });
    vi.stubEnv('VITE_GAMEANALYTICS_ENABLED', 'true');
    vi.stubEnv('VITE_GAMEANALYTICS_GAME_KEY', CONFIG.gameKey);
    vi.stubEnv('VITE_GAMEANALYTICS_SECRET_KEY', CONFIG.secretKey);
    const telemetry = createBrowserPlaytestTelemetry({ device: 'desktop', source: 'x' });
    telemetry.landing();
    telemetry.engagement('continue_adventure');
    await flush();
    expect(telemetry.configured).toBe(false);
    expect(sdkImport).not.toHaveBeenCalled();
  });

  it('requires explicit enablement even on the public URL', async () => {
    vi.stubGlobal('location', { search: '?playtest=1' });
    vi.stubEnv('VITE_GAMEANALYTICS_ENABLED', 'false');
    vi.stubEnv('VITE_GAMEANALYTICS_GAME_KEY', CONFIG.gameKey);
    vi.stubEnv('VITE_GAMEANALYTICS_SECRET_KEY', CONFIG.secretKey);
    const telemetry = createBrowserPlaytestTelemetry({ device: 'desktop' });
    telemetry.landing();
    telemetry.engagement('extended_play_start');
    await flush();
    expect(telemetry.configured).toBe(false);
    expect(sdkImport).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'direct'], [undefined, 'direct'], ['', 'direct'], [' X ', 'x'],
    ['reddit', 'reddit'], ['discord', 'discord'], ['direct', 'direct'],
    ['unknown', 'unknown'], ['email@example.com', 'unknown'], ['twitter', 'unknown'],
    ['https://private.example/path', 'unknown'],
  ])('normalizes source %s to %s without forwarding arbitrary data', (raw, expected) => {
    expect(normalizePlaytestSource(raw)).toBe(expected);
  });
});

describe('post-validation engagement telemetry', () => {
  it('keeps the closed engagement vocabulary separate from factual validation events', () => {
    expect(PLAYTEST_ENGAGEMENT_NAMESPACE).toBe('playtest_engagement_v1');
    expect(PLAYTEST_TELEMETRY_NAMESPACE).toBe('playtest_connected_v3');
    expect(PLAYTEST_ENGAGEMENT_EVENT_NAMES).toEqual([
      'retry_core', 'continue_adventure', 'extended_play_start', 'extended_play_exit',
      'extended_play_real_time', 'extended_play_floor',
    ]);
    for (const name of PLAYTEST_ENGAGEMENT_EVENT_NAMES) expect(PLAYTEST_EVENT_NAMES).not.toContain(name);
    expect(PLAYTEST_EVENT_NAMES).toContain('core_complete');
    expect(PLAYTEST_EVENT_NAMES).toContain('player_death');
    expect(PLAYTEST_EVENT_NAMES).not.toContain('core_loop_learned');
  });

  it.each([
    ['calibration', false, 'calibration', undefined],
    ['core', false, 'core_fresh_retry_unassisted', 'fresh_retry_unassisted'],
    ['core', true, 'core_fresh_retry_assisted', 'fresh_retry_assisted'],
  ] as const)('queues context-free engagement without changing %s assistance=%s', async (stage, assisted, context, assistance) => {
    const provider = mockProvider();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.stage(stage);
    telemetry.assistance(assisted);
    for (const name of PLAYTEST_ENGAGEMENT_EVENT_NAMES) telemetry.engagement(name, 2);
    telemetry.event('real_time', 12.5);
    telemetry.progression('complete', stage, 3);
    telemetry.feedback('position', 'none');
    // Queued engagement must not inherit context even when a new attempt begins.
    telemetry.stage(stage === 'core' ? 'calibration' : 'core');
    await flush();
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    provider.ready();
    await flush();
    expect(provider.sdk.addDesignEvent.mock.calls.slice(1, 7)).toEqual(
      PLAYTEST_ENGAGEMENT_EVENT_NAMES.map(name => [`playtest_engagement_v1:${name}`, 2]),
    );
    expect(provider.sdk.addDesignEvent.mock.calls.slice(7, 10)).toEqual([
      [`playtest_connected_v3:real_time:${context}`, 12.5],
      [`playtest_connected_v3:feedback:fun:position:${context}`, undefined],
      [`playtest_connected_v3:feedback:issue:none:${context}`, undefined],
    ]);
    expect(provider.sdk.addProgressionEvent.mock.calls).toEqual([
      [2, 'playtest_connected_v3', stage, assistance, 3],
    ]);
    telemetry.dispose();
  });

  it('snapshots walking entry separately from clean retries in queued events and progression', async () => {
    const provider = mockProvider();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.stage('core', 'walk');
    telemetry.progression('start', 'core');
    telemetry.event('core_start');
    telemetry.assistance(true);
    telemetry.event('player_death');
    telemetry.progression('fail', 'core', 12);
    telemetry.retry();
    telemetry.stage('core', 'fresh_retry');
    telemetry.progression('start', 'core');
    telemetry.event('core_start');
    telemetry.event('core_complete');
    telemetry.progression('complete', 'core', 5);
    await flush(); provider.ready(); await flush();
    expect(provider.sdk.addDesignEvent.mock.calls.map(([id]) => id)).toEqual([
      'playtest_connected_v3:stage:core_walk_unassisted',
      'playtest_connected_v3:core_start:core_walk_unassisted',
      'playtest_connected_v3:player_death:core_walk_assisted',
      'playtest_connected_v3:retry:core_walk_assisted',
      'playtest_connected_v3:stage:core_fresh_retry_unassisted',
      'playtest_connected_v3:core_start:core_fresh_retry_unassisted',
      'playtest_connected_v3:core_complete:core_fresh_retry_unassisted',
    ]);
    expect(provider.sdk.addProgressionEvent.mock.calls).toEqual([
      [1, 'playtest_connected_v3', 'core', 'walk_unassisted', undefined],
      [3, 'playtest_connected_v3', 'core', 'walk_assisted', 12],
      [1, 'playtest_connected_v3', 'core', 'fresh_retry_unassisted', undefined],
      [2, 'playtest_connected_v3', 'core', 'fresh_retry_unassisted', 5],
    ]);
    telemetry.dispose();
  });

  it('rejects other vocabularies and invalid values before loading the provider', async () => {
    const provider = mockProvider();
    const loader = vi.fn(async () => provider.sdk);
    const telemetry = createPlaytestTelemetry(CONFIG, loader);
    for (const name of [...PLAYTEST_EVENT_NAMES, 'core_loop_learned', 'private input', '']) {
      telemetry.engagement(name as PlaytestEngagementEventName);
    }
    for (const name of PLAYTEST_ENGAGEMENT_EVENT_NAMES) telemetry.event(name as PlaytestEventName);
    for (const value of [NaN, Infinity, -Infinity, -1, 1_000_000_001, 'private input', null]) {
      telemetry.engagement('extended_play_real_time', value as number);
    }
    await flush();
    expect(loader).not.toHaveBeenCalled();
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    expect(provider.sdk.addProgressionEvent).not.toHaveBeenCalled();
    telemetry.dispose();
  });

  it('starts loading only for valid engagement and accepts bounded finite numeric observations', async () => {
    const provider = mockProvider();
    const loader = vi.fn(async () => provider.sdk);
    const telemetry = createPlaytestTelemetry(CONFIG, loader);
    telemetry.engagement('continue_adventure');
    telemetry.engagement('extended_play_floor', 0);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    provider.ready();
    await flush();
    telemetry.engagement('extended_play_real_time', 12.5);
    telemetry.engagement('extended_play_real_time', 1_000_000_000);
    expect(provider.sdk.addDesignEvent.mock.calls).toEqual([
      ['playtest_engagement_v1:continue_adventure', undefined],
      ['playtest_engagement_v1:extended_play_floor', 0],
      ['playtest_engagement_v1:extended_play_real_time', 12.5],
      ['playtest_engagement_v1:extended_play_real_time', 1_000_000_000],
    ]);
    expect(provider.sdk.addProgressionEvent).not.toHaveBeenCalled();
    telemetry.dispose();
    telemetry.engagement('extended_play_exit');
    expect(provider.sdk.addDesignEvent).toHaveBeenCalledTimes(4);
  });
});

describe('optional provider lifecycle and safe event mapping', () => {
  it('configures the build and three dimensions before initialization, then flushes early events in order', async () => {
    const provider = mockProvider();
    const loader = vi.fn(async () => provider.sdk);
    const telemetry = createPlaytestTelemetry(CONFIG, loader);
    telemetry.landing();
    telemetry.start();
    telemetry.stage('calibration');
    telemetry.progression('start', 'calibration');
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    expect(provider.sdk.configureBuild).toHaveBeenCalledWith('test-build-123');
    expect(provider.sdk.configureAvailableCustomDimensions01).toHaveBeenCalledWith(['playtest_v1']);
    expect(provider.sdk.configureAvailableCustomDimensions02).toHaveBeenCalledWith(['desktop', 'touch']);
    expect(provider.sdk.configureAvailableCustomDimensions03).toHaveBeenCalledWith(['x', 'reddit', 'discord', 'direct', 'unknown']);
    expect(provider.sdk.setCustomDimension01).toHaveBeenCalledWith('playtest_v1');
    expect(provider.sdk.setCustomDimension02).toHaveBeenCalledWith('touch');
    expect(provider.sdk.setCustomDimension03).toHaveBeenCalledWith('reddit');
    expect(provider.sdk.configureBuild.mock.invocationCallOrder[0]).toBeLessThan(provider.sdk.initialize.mock.invocationCallOrder[0]!);
    expect(provider.sdk.setCustomDimension03.mock.invocationCallOrder[0]).toBeLessThan(provider.sdk.initialize.mock.invocationCallOrder[0]!);
    expect(provider.sdk.enableHealthEvent).toHaveBeenCalledWith(false);
    provider.ready();
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    await flush();
    expect(telemetry.status).toBe('ready');
    expect(provider.sdk.addDesignEvent.mock.calls).toEqual([
      ['playtest_connected_v3:landing', undefined], ['playtest_connected_v3:start', undefined], ['playtest_connected_v3:stage:calibration', undefined],
    ]);
    expect(provider.sdk.addProgressionEvent).toHaveBeenCalledWith(1, 'playtest_connected_v3', 'calibration', undefined, undefined);
    telemetry.progression('complete', 'calibration', 3);
    telemetry.progression('fail', 'core');
    expect(provider.sdk.addProgressionEvent.mock.calls.slice(-2)).toEqual([
      [2, 'playtest_connected_v3', 'calibration', undefined, 3], [3, 'playtest_connected_v3', 'core', 'fresh_retry_unassisted', undefined],
    ]);
    telemetry.dispose();
  });

  it('bounds the early queue at 100 and preserves landing before a slow load', async () => {
    const provider = mockProvider();
    let resolve!: (sdk: PlaytestAnalyticsProvider) => void;
    const telemetry = createPlaytestTelemetry(CONFIG, () => new Promise((done) => { resolve = done; }));
    telemetry.landing();
    for (let i = 0; i < 300; i++) telemetry.event('damage', i);
    await flush();
    resolve(provider.sdk);
    await flush();
    provider.ready();
    await flush();
    expect(provider.sdk.addDesignEvent).toHaveBeenCalledTimes(100);
    expect(provider.sdk.addDesignEvent.mock.calls[0]).toEqual(['playtest_connected_v3:landing', undefined]);
    expect(provider.sdk.addDesignEvent.mock.calls[99]).toEqual(['playtest_connected_v3:damage', 98]);
    telemetry.dispose();
  });

  it('rejects arbitrary event/stage/feedback strings and non-finite or negative values', async () => {
    const provider = mockProvider();
    provider.ready();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.landing();
    await flush();
    provider.sdk.addDesignEvent.mockClear();
    telemetry.event('private input' as PlaytestEventName);
    telemetry.stage('user123' as PlaytestStage);
    telemetry.feedback('free text' as PlaytestFun, 'address' as PlaytestIssue);
    telemetry.feedback();
    telemetry.event('damage', NaN);
    telemetry.event('damage', Infinity);
    telemetry.event('damage', -1);
    telemetry.event('damage', 1_000_000_001);
    telemetry.progression('complete', 'core', NaN);
    telemetry.event('damage', 0);
    telemetry.event('real_time', 12.5);
    telemetry.feedback('none');
    telemetry.feedback(undefined, 'performance');
    expect(provider.sdk.addDesignEvent.mock.calls).toEqual([
      ['playtest_connected_v3:damage', 0], ['playtest_connected_v3:real_time', 12.5],
      ['playtest_connected_v3:feedback:fun:none', undefined], ['playtest_connected_v3:feedback:issue:performance', undefined],
    ]);
    expect(provider.sdk.addProgressionEvent).not.toHaveBeenCalled();
    telemetry.dispose();
  });

  it('treats background/pagehide as unknown lifecycle signals, never quit or failure', async () => {
    const provider = mockProvider();
    provider.ready();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.landing();
    await flush();
    provider.sdk.addDesignEvent.mockClear();
    telemetry.visibility(true);
    telemetry.visibility(true);
    telemetry.pagehide();
    telemetry.pagehide();
    telemetry.visibility(false);
    telemetry.visibility(true);
    telemetry.pagehide();
    expect(provider.sdk.addDesignEvent.mock.calls.map((call) => call[0])).toEqual([
      'playtest_connected_v3:blur', 'playtest_connected_v3:pagehide_unknown', 'playtest_connected_v3:blur', 'playtest_connected_v3:pagehide_unknown',
    ]);
    expect(provider.sdk.addProgressionEvent).not.toHaveBeenCalled();
    telemetry.dispose();
  });

  it('accepts factual open-calibration events without historical choreography semantics', async () => {
    const provider = mockProvider();
    provider.ready();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.event('first_attack');
    telemetry.event('guard_defeated');
    telemetry.event('healing_used');
    telemetry.event('healing_skipped_resource_lost');
    telemetry.event('calibration_complete');
    await flush();
    expect(provider.sdk.addDesignEvent.mock.calls.map((call) => call[0])).toEqual([
      'playtest_connected_v3:first_attack', 'playtest_connected_v3:guard_defeated', 'playtest_connected_v3:healing_used',
      'playtest_connected_v3:healing_skipped_resource_lost',
      'playtest_connected_v3:calibration_complete',
    ]);
    telemetry.dispose();
  });

  it('rejects historical choreography events rather than relabelling old success as completion', async () => {
    const provider = mockProvider();
    provider.ready();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.stage('calibration');
    await flush();
    provider.sdk.addDesignEvent.mockClear();
    for (const retired of [
      'core_loop_learned', 'attack_seen', 'attack_committed', 'evade_equivalent',
      'recovery_hit_equivalent', 'calibration_retry_needed', 'calibration_cycle_failed',
    ]) {
      expect(PLAYTEST_EVENT_NAMES).not.toContain(retired);
      telemetry.event(retired as PlaytestEventName);
    }
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    expect(PLAYTEST_TELEMETRY_NAMESPACE).toBe('playtest_connected_v3');
    telemetry.dispose();
  });

  it('allows actual slow-time and combat observations in both stages', async () => {
    const provider = mockProvider();
    provider.ready();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    for (const stage of ['calibration', 'core'] as const) {
      telemetry.stage(stage);
      for (const fact of [
        'first_move', 'first_look', 'first_attack', 'slow_time_observed',
        'counter_observed', 'deflect_observed', 'hurt_observed',
      ] as const) telemetry.event(fact);
    }
    await flush();
    expect(provider.sdk.addDesignEvent.mock.calls.map(call => call[0])).toEqual([
      'playtest_connected_v3:stage:calibration', 'playtest_connected_v3:first_move:calibration',
      'playtest_connected_v3:first_look:calibration', 'playtest_connected_v3:first_attack:calibration',
      'playtest_connected_v3:slow_time_observed:calibration', 'playtest_connected_v3:counter_observed:calibration',
      'playtest_connected_v3:deflect_observed:calibration', 'playtest_connected_v3:hurt_observed:calibration',
      'playtest_connected_v3:stage:core_fresh_retry_unassisted', 'playtest_connected_v3:first_move:core_fresh_retry_unassisted',
      'playtest_connected_v3:first_look:core_fresh_retry_unassisted', 'playtest_connected_v3:first_attack:core_fresh_retry_unassisted',
      'playtest_connected_v3:slow_time_observed:core_fresh_retry_unassisted', 'playtest_connected_v3:counter_observed:core_fresh_retry_unassisted',
      'playtest_connected_v3:deflect_observed:core_fresh_retry_unassisted', 'playtest_connected_v3:hurt_observed:core_fresh_retry_unassisted',
    ]);
    telemetry.dispose();
  });

  it.each(['core_complete', 'player_death', 'voluntary_quit'] as const)(
    'snapshots sticky assistance for queued %s outcomes and progression, then resets the next attempt',
    async (outcome) => {
      const provider = mockProvider();
      const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
      const terminal = outcome === 'core_complete' ? 'complete' : 'fail';
      telemetry.stage('calibration');
      telemetry.assistance(true); // Calibration support must not taint the core attempt.
      telemetry.stage('core');
      telemetry.progression('start', 'core');
      telemetry.event('core_start');
      telemetry.assistance(true);
      telemetry.assistance(false); // Sticky until a new attempt begins.
      telemetry.event(outcome);
      telemetry.progression(terminal, 'core', 12);
      telemetry.feedback('position', 'none');
      telemetry.retry();
      telemetry.stage('core');
      telemetry.progression('start', 'core');
      telemetry.event(outcome);
      telemetry.progression(terminal, 'core', 5);
      await flush();
      provider.ready();
      await flush();
      const ids = provider.sdk.addDesignEvent.mock.calls.map(call => call[0]);
      expect(ids).toContain(`playtest_connected_v3:${outcome}:core_fresh_retry_assisted`);
      expect(ids).toContain(`playtest_connected_v3:${outcome}:core_fresh_retry_unassisted`);
      expect(ids).toContain('playtest_connected_v3:core_start:core_fresh_retry_unassisted');
      expect(ids).toContain('playtest_connected_v3:feedback:fun:position:core_fresh_retry_assisted');
      expect(ids).toContain('playtest_connected_v3:feedback:issue:none:core_fresh_retry_assisted');
      expect(ids).toContain('playtest_connected_v3:retry:core_fresh_retry_assisted');
      expect(provider.sdk.addProgressionEvent.mock.calls).toEqual([
        [1, 'playtest_connected_v3', 'core', 'fresh_retry_unassisted', undefined],
        [terminal === 'complete' ? 2 : 3, 'playtest_connected_v3', 'core', 'fresh_retry_assisted', 12],
        [1, 'playtest_connected_v3', 'core', 'fresh_retry_unassisted', undefined],
        [terminal === 'complete' ? 2 : 3, 'playtest_connected_v3', 'core', 'fresh_retry_unassisted', 5],
      ]);
      for (const id of ids) {
        expect(id.split(':').length).toBeLessThanOrEqual(5);
        expect(id.split(':').every((part: string) => part.length <= 32)).toBe(true);
      }
      telemetry.dispose();
    },
  );

  it.each(['hint_inactivity', 'hint_no_attack', 'hint_repeated_damage'] as const)(
    'classifies a displayed %s as assistance without relying on caller ordering',
    async (hint) => {
      const provider = mockProvider();
      provider.ready();
      const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
      telemetry.stage('core');
      telemetry.event(hint);
      telemetry.assistance(false);
      telemetry.event('player_death');
      telemetry.progression('fail', 'core');
      await flush();
      expect(provider.sdk.addDesignEvent.mock.calls.map(call => call[0])).toEqual([
        'playtest_connected_v3:stage:core_fresh_retry_unassisted', `playtest_connected_v3:${hint}:core_fresh_retry_assisted`,
        'playtest_connected_v3:player_death:core_fresh_retry_assisted',
      ]);
      expect(provider.sdk.addProgressionEvent).toHaveBeenCalledWith(3, 'playtest_connected_v3', 'core', 'fresh_retry_assisted', undefined);
      telemetry.dispose();
    },
  );

  it('captures stage in queued milestone, outcome, stats, retry, and feedback IDs while landing/start stay global', async () => {
    const provider = mockProvider();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.landing();
    telemetry.start();
    telemetry.stage('calibration');
    telemetry.event('first_attack');
    telemetry.event('calibration_complete');
    telemetry.retry();
    telemetry.stage('core');
    telemetry.event('first_attack');
    telemetry.event('core_complete');
    telemetry.event('real_time', 12.5);
    telemetry.event('damage', 0);
    telemetry.event('kills', 3);
    telemetry.feedback('position', 'performance');
    telemetry.retry();
    telemetry.landing();
    telemetry.pagehide();
    telemetry.start();
    await flush();
    provider.ready();
    await flush();
    const ids = provider.sdk.addDesignEvent.mock.calls.map((call) => call[0] as string);
    expect(ids).toEqual([
      'playtest_connected_v3:landing', 'playtest_connected_v3:start', 'playtest_connected_v3:stage:calibration',
      'playtest_connected_v3:first_attack:calibration', 'playtest_connected_v3:calibration_complete:calibration',
      'playtest_connected_v3:retry:calibration', 'playtest_connected_v3:stage:core_fresh_retry_unassisted', 'playtest_connected_v3:first_attack:core_fresh_retry_unassisted',
      'playtest_connected_v3:core_complete:core_fresh_retry_unassisted', 'playtest_connected_v3:real_time:core_fresh_retry_unassisted', 'playtest_connected_v3:damage:core_fresh_retry_unassisted',
      'playtest_connected_v3:kills:core_fresh_retry_unassisted', 'playtest_connected_v3:feedback:fun:position:core_fresh_retry_unassisted',
      'playtest_connected_v3:feedback:issue:performance:core_fresh_retry_unassisted', 'playtest_connected_v3:retry:core_fresh_retry_unassisted',
      'playtest_connected_v3:landing', 'playtest_connected_v3:pagehide_unknown', 'playtest_connected_v3:start',
    ]);
    for (const id of ids) {
      expect(id.split(':').length).toBeLessThanOrEqual(5);
      expect(id.split(':').every((part) => part.length <= 32)).toBe(true);
    }
    telemetry.dispose();
  });

  it.each(['load', 'initialize', 'send'] as const)('isolates %s failures and stops further provider calls', async (failure) => {
    const provider = mockProvider();
    if (failure === 'initialize') provider.sdk.initialize.mockImplementation(() => { throw new Error('blocked'); });
    if (failure === 'send') provider.sdk.addDesignEvent.mockImplementation(() => { throw new Error('offline'); });
    const loader = vi.fn(async () => {
      if (failure === 'load') throw new Error('chunk blocked');
      return provider.sdk;
    });
    const telemetry = createPlaytestTelemetry(CONFIG, loader);
    expect(() => telemetry.landing()).not.toThrow();
    await flush();
    provider.ready();
    await flush();
    expect(telemetry.status).toBe('unavailable');
    expect(() => { telemetry.start(); telemetry.retry(); telemetry.dispose(); }).not.toThrow();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(provider.sdk.addDesignEvent).toHaveBeenCalledTimes(failure === 'send' ? 1 : 0);
  });

  it('times out a stalled provider and does not initialize it if its import resolves late', async () => {
    vi.useFakeTimers();
    const provider = mockProvider();
    let resolve!: (sdk: PlaytestAnalyticsProvider) => void;
    const telemetry = createPlaytestTelemetry(CONFIG, () => new Promise((done) => { resolve = done; }));
    telemetry.landing();
    await flush();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(telemetry.status).toBe('unavailable');
    resolve(provider.sdk);
    await flush();
    expect(provider.sdk.initialize).not.toHaveBeenCalled();
    telemetry.dispose();
  });

  it('times out a missing init response and discards subsequent queued events', async () => {
    vi.useFakeTimers();
    const provider = mockProvider();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.landing();
    await flush();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(telemetry.status).toBe('unavailable');
    expect(provider.sdk.setEnabledEventSubmission).toHaveBeenCalledWith(false);
    telemetry.start();
    provider.ready();
    await flush();
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
    telemetry.dispose();
  });

  it('disposes pending work without creating a provider session', async () => {
    const provider = mockProvider();
    const telemetry = createPlaytestTelemetry(CONFIG, async () => provider.sdk);
    telemetry.landing();
    telemetry.dispose();
    await flush();
    expect(telemetry.status).toBe('disposed');
    expect(provider.sdk.initialize).not.toHaveBeenCalled();
    expect(provider.sdk.addDesignEvent).not.toHaveBeenCalled();
  });
});

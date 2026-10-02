import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/ui/settings';

afterEach(() => vi.unstubAllGlobals());

describe('mobile control preference migration', () => {
  it('keeps old saves on automatic pointer detection without changing their quality', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ sensitivity: 1.4, pixelRatio: 1.25, cls: 'huntress' }) } });
    const store = new SettingsStore();
    expect(store.load()).toMatchObject({ touchControls: null, sensitivity: 1.4, pixelRatio: 1.25, cls: 'huntress' });
  });

  it.each([true, false])('persists an explicit %s touch choice without changing other preferences', (value) => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } });
    const store = new SettingsStore();
    store.load();
    store.update({ touchControls: value });
    expect(store.value.touchControls).toBe(value);
    expect(JSON.parse(setItem.mock.calls[0]![1])).toMatchObject({ touchControls: value, sensitivity: 1, pixelRatio: 1.5 });
  });

  it('rejects malformed touch values and works without local storage', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{"touchControls":"false"}', setItem: () => { throw new Error('blocked'); } } });
    const store = new SettingsStore();
    expect(store.load().touchControls).toBeNull();
    store.update({ touchControls: true });
    expect(store.value.touchControls).toBe(true);
    expect(store.persistent).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { FullscreenControls } from '../src/ui/fullscreen';
import { gameViewport } from '../src/ui/viewport';

class Button extends EventTarget {
  textContent = '';
  disabled = false;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}
function setup() {
  const buttons = [new Button(), new Button()];
  const notes = [{ textContent: '' }, { textContent: '' }];
  const doc = Object.assign(new EventTarget(), {
    documentElement: { requestFullscreen: vi.fn<() => Promise<void>>() },
    fullscreenElement: null as unknown,
    fullscreenEnabled: true,
    exitFullscreen: vi.fn<() => Promise<void>>(),
    querySelectorAll: (selector: string) => selector === '[data-fullscreen]' ? buttons : notes,
  });
  const change = (active: boolean) => {
    doc.fullscreenElement = active ? doc.documentElement : null;
    doc.dispatchEvent(new Event('fullscreenchange'));
  };
  doc.documentElement.requestFullscreen.mockImplementation(async () => { change(true); });
  doc.exitFullscreen.mockImplementation(async () => { change(false); });
  const onChange = vi.fn();
  const control = new FullscreenControls(onChange, doc as unknown as Document);
  return { control, doc, buttons, notes, change, onChange };
}

describe('optional fullscreen', () => {
  it('requests the whole document synchronously, with navigation hidden and shared accessible labels', async () => {
    const { control, doc, buttons, onChange } = setup();
    const pending = control.enter(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(buttons.every(b => b.disabled)).toBe(true);
    expect(await pending).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(buttons.every(b => b.textContent === '退出全螢幕' && b.attributes.get('aria-pressed') === 'true' && !b.disabled)).toBe(true);
  });

  it('uses click listeners for explicit enter and exit', async () => {
    const { buttons, doc } = setup();
    buttons[0]!.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    buttons[1]!.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(buttons.every(b => b.textContent === '全螢幕' && b.attributes.get('aria-pressed') === 'false')).toBe(true);
  });

  it('does not stack pending requests or re-enter after OS exit, but allows a new explicit tap', async () => {
    const { control, doc, change } = setup();
    let finish!: () => void;
    doc.documentElement.requestFullscreen.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = control.enter(true);
    expect(await control.toggle()).toBe(false);
    expect(await control.enter()).toBe(false);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    change(true); finish(); await first;
    change(false);
    expect(await control.enter(true)).toBe(false);
    const retry = control.toggle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
    change(true); finish(); await retry;
  });

  it.each(['missing', 'denied'] as const)('gracefully disables unavailable API: %s', async kind => {
    const { doc, buttons, notes, onChange } = setup();
    if (kind === 'missing') Object.assign(doc.documentElement, { requestFullscreen: undefined });
    else doc.fullscreenEnabled = false;
    const control = new FullscreenControls(onChange, doc as unknown as Document);
    expect(await control.enter(true)).toBe(false);
    expect(buttons.every(b => b.disabled && b.textContent.includes('不支援'))).toBe(true);
    expect(notes.every(n => n.textContent.includes('繼續一般模式'))).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(['reject', 'throw', 'abort'] as const)('absorbs %s and permits a manual retry without false success', async kind => {
    const { control, doc, buttons, notes, onChange } = setup();
    doc.documentElement.requestFullscreen.mockImplementation(() => {
      if (kind === 'throw') throw new Error('unsupported options');
      return Promise.reject(new DOMException('not allowed', kind === 'abort' ? 'AbortError' : 'NotAllowedError'));
    });
    expect(await control.enter(true)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(buttons.every(b => !b.disabled && b.textContent === '全螢幕')).toBe(true);
    expect(notes.every(n => n.textContent.includes('仍可正常遊玩'))).toBe(true);
    expect(await control.enter(true)).toBe(false);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    await control.toggle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
  });

  it('derives state from fullscreenchange and detects exit even if the entry promise resolves late', async () => {
    const { control, doc, change, onChange, buttons } = setup();
    let finish!: () => void;
    doc.documentElement.requestFullscreen.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const entry = control.enter();
    change(true); change(false); finish();
    expect(await entry).toBe(false);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(buttons.every(b => b.textContent === '全螢幕')).toBe(true);
  });

  it('failed exit leaves the actual active state and offers retry', async () => {
    const { control, doc, buttons, notes } = setup();
    await control.enter();
    doc.exitFullscreen.mockRejectedValue(new Error('exit rejected'));
    expect(await control.toggle()).toBe(false);
    expect(control.active).toBe(true);
    expect(buttons.every(b => b.textContent === '退出全螢幕' && !b.disabled)).toBe(true);
    expect(notes.every(n => n.textContent.includes('未能退出'))).toBe(true);
  });
});

function viewport(width: number, height: number, visual: Partial<VisualViewport> | null = null, touch = true) {
  return gameViewport({ innerWidth: width, innerHeight: height, visualViewport: visual as VisualViewport | null }, touch);
}
describe('shared visible viewport geometry', () => {
  it('uses inner size with no API and keeps desktop unchanged', () => {
    expect(viewport(844, 390)).toEqual({ width: 844, height: 390, left: 0, top: 0 });
    expect(viewport(1200, 800, { width: 800, height: 400, scale: 1, offsetTop: 20, offsetLeft: 0 }, false)).toEqual({ width: 1200, height: 800, left: 0, top: 0 });
  });
  it('fits reduced visible height and keyboard offsets, then expands after chrome hides', () => {
    expect(viewport(844, 390, { width: 844, height: 278, scale: 1, offsetTop: 12, offsetLeft: 0 })).toEqual({ width: 844, height: 278, left: 0, top: 12 });
    expect(viewport(844, 390, { width: 844, height: 390, scale: 1, offsetTop: 0, offsetLeft: 0 })).toEqual({ width: 844, height: 390, left: 0, top: 0 });
    expect(viewport(390, 844)).toEqual({ width: 390, height: 844, left: 0, top: 0 });
  });
  it('does not rescale content while pinching or accept transient zero dimensions', () => {
    expect(viewport(844, 390, { width: 422, height: 195, scale: 2 })).toEqual(viewport(844, 390));
    expect(viewport(844, 390, { width: 0, height: 0, scale: 1 })).toEqual(viewport(844, 390));
    expect(viewport(0, 0)).toEqual({ width: 1, height: 1, left: 0, top: 0 });
  });
});

describe('viewport and safe-area stylesheet contract (not a rendering test)', () => {
  it('keeps all touch surfaces aligned and preserves safe scrolling and insets', async () => {
    // Node is the configured test environment; this project has no @types/node.
    const fsModule: string = 'node:fs';
    const { readFileSync } = await import(fsModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
    const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`env(safe-area-inset-${side}, 0px)`);
    expect(css).toContain('--view-height: 100vh');
    expect(css).toContain('@supports (height: 100dvh)');
    expect(css).toContain('body.touch-mode #game,\nbody.touch-mode #hud,\nbody.touch-mode #touch-controls,\nbody.touch-mode .screen');
    expect(css).toContain('#screen-menu { justify-content: flex-start; }');
    expect(css).toContain('.menu-card { flex-shrink: 0; margin: auto 0; }');
    expect(css).toContain('max-height: calc(var(--view-height) - max(12px, var(--safe-top)) - max(12px, var(--safe-bottom)))');
    expect(html).toContain('viewport-fit=cover');
    expect(html.match(/data-fullscreen type="button"/g)).toHaveLength(2);
  });
});

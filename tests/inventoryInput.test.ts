import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, type InputHandlers, type RawFrame } from '../src/input/input';

type Mode = 'playing' | 'map' | 'choice' | 'inventory' | 'paused';

const idleFrame: RawFrame = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  keyYaw: 0,
  keyPitch: 0,
  fire: false,
  firePressed: false,
  selectSlot: null,
  shield: false,
  sneak: false,
  inventory: false,
  bottle: false,
  interact: false,
  potion: false,
  wait: false,
  map: false,
  escape: false,
  digit: null,
};

const inputs: Input[] = [];

function setup(mode: Mode = 'inventory', inventoryAware = true) {
  const state = { mode };
  const win = new EventTarget();
  const doc = new EventTarget();
  const canvas = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  const handlers: InputHandlers = {
    capturing: () => state.mode !== 'paused',
    onFocusLost: vi.fn(),
    onLockChange: vi.fn(),
    onLockError: vi.fn(),
  };
  if (inventoryAware) handlers.inventoryOpen = () => state.mode === 'inventory';
  const input = new Input(canvas as unknown as HTMLCanvasElement, handlers);
  input.attach();
  inputs.push(input);

  function emit(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), properties);
    target.dispatchEvent(event);
    return event;
  }

  return {
    state,
    input,
    handlers,
    key: (type: 'keydown' | 'keyup', code: string, repeat = false) => emit(win, type, { code, repeat }),
    wheel: () => emit(win, 'wheel'),
    down: (button: number) => emit(canvas, 'mousedown', { button }),
    up: (button: number) => emit(win, 'mouseup', { button }),
    move: (movementX: number, movementY: number) => emit(doc, 'mousemove', { movementX, movementY }),
    blur: () => emit(win, 'blur'),
  };
}

afterEach(() => {
  for (const input of inputs.splice(0)) input.detach();
  vi.unstubAllGlobals();
});

describe('inventory uses native HTML input without queuing gameplay', () => {
  it.each(['Tab', 'Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])(
    'leaves %s keydown, repeat, and keyup defaults intact',
    (code) => {
      const { input, key } = setup();
      expect(key('keydown', code).defaultPrevented).toBe(false);
      expect(key('keydown', code, true).defaultPrevented).toBe(false);
      expect(input.heldKeys()).toEqual([]);
      expect(input.consume()).toEqual(idleFrame);
      expect(key('keyup', code).defaultPrevented).toBe(false);
      expect(input.consume()).toEqual(idleFrame);
    },
  );

  it('does not queue any gameplay actions while the inventory is open', () => {
    const { input, state, key } = setup();
    const codes = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyH', 'KeyF', 'KeyM',
      'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'Space', 'Tab',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ];
    for (const code of codes) expect(key('keydown', code).defaultPrevented).toBe(false);
    expect(input.heldKeys()).toEqual([]);
    // Close before consuming: ignored menu inputs cannot become next-frame gameplay.
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
    for (const code of codes) key('keydown', code, true);
    expect(input.consume()).toEqual(idleFrame);
    for (const code of codes) key('keyup', code);
    key('keydown', 'KeyW');
    expect(input.consume()).toEqual({ ...idleFrame, moveZ: 1 });
  });

  it.each([
    ['KeyI', 'inventory'],
    ['Escape', 'escape'],
  ] as const)('routes only a fresh %s press to the close action', (code, field) => {
    const { input, key } = setup();
    expect(key('keydown', code).defaultPrevented).toBe(true);
    expect(input.heldKeys()).toEqual([]);
    expect(input.consume()).toEqual({ ...idleFrame, [field]: true });
    expect(key('keydown', code, true).defaultPrevented).toBe(true);
    expect(input.consume()).toEqual(idleFrame);
    expect(key('keyup', code).defaultPrevented).toBe(false);
    key('keydown', code);
    expect(input.consume()).toEqual({ ...idleFrame, [field]: true });
  });

  it('lets wheel scrolling through and ignores canvas fire, shield, and look input', () => {
    const { input, state, wheel, down, up, move } = setup();
    expect(wheel().defaultPrevented).toBe(false);
    expect(down(0).defaultPrevented).toBe(false);
    expect(down(2).defaultPrevented).toBe(false);
    move(12, 7);
    input.locked = true; // Pointer-lock release may arrive after the overlay opens.
    expect(down(2).defaultPrevented).toBe(false);
    move(10, -3);
    expect(input.consume()).toEqual(idleFrame);
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
    up(0);
    up(2);
    expect(input.consume()).toEqual(idleFrame);
  });

  it('clears input at UI transitions without resurrecting held or repeated keys', () => {
    const { input, state, key, down, move } = setup('playing');
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    down(0);
    down(2);
    move(20, 10);
    input.clear(); // releaseForUi()
    state.mode = 'inventory';
    expect(input.consume()).toEqual(idleFrame);
    key('keydown', 'KeyW', true);
    key('keydown', 'Space', true);
    key('keydown', 'Escape');
    input.clear(); // enterPlaying()
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
    key('keydown', 'KeyW', true);
    key('keydown', 'Space', true);
    expect(input.consume()).toEqual(idleFrame);
    key('keyup', 'KeyW');
    key('keyup', 'Space');
    key('keydown', 'Space');
    expect(input.consume()).toEqual({ ...idleFrame, wait: true });
  });

  it('releases pre-existing held keys on inventory keyup without blocking the UI', () => {
    const { input, state, key } = setup('playing');
    key('keydown', 'KeyW');
    input.consume();
    state.mode = 'inventory';
    expect(key('keyup', 'KeyW').defaultPrevented).toBe(false);
    expect(input.heldKeys()).toEqual([]);
    expect(input.consume()).toEqual(idleFrame);
  });
});

describe('gameplay, map, and choice routing remain unchanged', () => {
  it.each(['playing', 'map', 'choice'] as const)('preserves keyboard capture and actions in %s', (mode) => {
    const { input, key, wheel } = setup(mode);
    for (const code of ['KeyW', 'KeyD', 'ArrowLeft', 'ArrowUp', 'ShiftLeft', 'Space', 'Tab', 'Digit2', 'KeyF', 'KeyQ', 'KeyE', 'KeyH', 'KeyI', 'Escape']) {
      expect(key('keydown', code).defaultPrevented).toBe(true);
    }
    expect(wheel().defaultPrevented).toBe(true);
    expect(input.consume()).toEqual({
      ...idleFrame,
      moveX: 1, moveZ: 1, keyYaw: 1, keyPitch: 1, sneak: true, wait: true,
      map: true, selectSlot: 2, digit: 2, shield: true, bottle: true,
      interact: true, potion: true, inventory: true, escape: true,
    });
    key('keydown', 'Digit2', true);
    key('keydown', 'KeyI', true);
    expect(input.consume()).toEqual({
      ...idleFrame, moveX: 1, moveZ: 1, keyYaw: 1, keyPitch: 1, sneak: true, wait: true,
    });
    for (const code of input.heldKeys()) {
      expect(key('keyup', code).defaultPrevented).toBe(code !== 'Escape');
    }
    expect(input.consume()).toEqual(idleFrame);
    expect(key('keydown', 'Enter').defaultPrevented).toBe(false);
  });

  it('retains short clicks, held fire, fallback dragging, locked shield, and spike filtering', () => {
    const { input, down, up, move } = setup('playing');
    expect(down(0).defaultPrevented).toBe(true);
    up(0);
    expect(input.consume()).toEqual({ ...idleFrame, fire: true, firePressed: true });
    expect(input.consume()).toEqual(idleFrame);
    down(0);
    input.consume();
    expect(input.consume()).toEqual({ ...idleFrame, fire: true });
    up(0);
    expect(down(2).defaultPrevented).toBe(true);
    move(8, -4);
    move(281, 0);
    expect(input.consume()).toEqual({ ...idleFrame, lookDX: 8, lookDY: -4 });
    up(2);
    move(3, 3);
    expect(input.consume()).toEqual(idleFrame);
    input.locked = true;
    down(2);
    move(-6, 2);
    expect(input.consume()).toEqual({ ...idleFrame, shield: true, lookDX: -6, lookDY: 2 });
    expect(input.consume()).toEqual(idleFrame);
  });

  it('leaves uncaptured overlays native without queuing keys or latent fire', () => {
    const { input, state, key, wheel, down } = setup('paused');
    for (const code of ['Space', 'Tab', 'KeyW', 'KeyI', 'Escape']) {
      expect(key('keydown', code).defaultPrevented).toBe(false);
      expect(key('keyup', code).defaultPrevented).toBe(false);
    }
    expect(wheel().defaultPrevented).toBe(false);
    expect(down(0).defaultPrevented).toBe(false);
    expect(down(2).defaultPrevented).toBe(false);
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
  });

  it('keeps the new inventory handler optional for existing consumers', () => {
    const { input, key, wheel } = setup('playing', false);
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(wheel().defaultPrevented).toBe(true);
    expect(input.consume()).toEqual({ ...idleFrame, wait: true });
  });

  it('clears all pending input on blur and removes routing when detached', () => {
    const { input, handlers, key, wheel, down, blur } = setup('playing');
    key('keydown', 'KeyW');
    down(0);
    blur();
    expect(handlers.onFocusLost).toHaveBeenCalledOnce();
    expect(input.consume()).toEqual(idleFrame);
    input.detach();
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(wheel().defaultPrevented).toBe(false);
    expect(down(0).defaultPrevented).toBe(false);
    expect(input.consume()).toEqual(idleFrame);
    expect(input.listenerCount).toBe(0);
  });
});

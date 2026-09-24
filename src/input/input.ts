import type { Tool } from '../sim/types';

// 鍵鼠輸入：一律使用 event.code（中文輸入法開啟時仍可用）。
// 滑鼠鎖定失敗時（例如受限 iframe）改用「右鍵拖曳」與方向鍵轉視角，左鍵仍是攻擊。

const GAME_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyH',
  'KeyM',
  'Space',
  'Tab',
  'Digit1',
  'Digit2',
  'Digit3',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export interface RawFrame {
  moveX: number;
  moveZ: number;
  lookDX: number;
  lookDY: number;
  keyYaw: number;
  keyPitch: number;
  fire: boolean;
  firePressed: boolean;
  selectTool: Tool | null;
  bottle: boolean;
  interact: boolean;
  potion: boolean;
  wait: boolean;
  map: boolean;
  escape: boolean;
  digit: number | null;
}

export interface InputHandlers {
  onLockChange(locked: boolean): void;
  onLockError(): void;
  onFocusLost(): void;
  /** 目前是否在遊戲中（決定要不要攔截按鍵預設行為）。 */
  capturing(): boolean;
}

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  private fireHeld = false;
  private firePressed = false;
  private dragging = false;
  locked = false;
  /** 本工作階段中是否曾成功鎖定（用來區分冷卻期與環境不支援）。 */
  lockEverWorked = false;
  fallback = false;
  listenerCount = 0;
  private abort: AbortController | null = null;
  private pendingLock: ((ok: boolean) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private h: InputHandlers,
  ) {}

  attach(): void {
    this.detach();
    const ac = new AbortController();
    this.abort = ac;
    const o = { signal: ac.signal };
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: Event) => void, opts: AddEventListenerOptions = {}) => {
      t.addEventListener(type, fn, { ...o, ...opts });
      this.listenerCount++;
    };
    on(window, 'keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (!this.h.capturing()) return;
      if (GAME_CODES.has(e.code) || e.code === 'Escape') {
        e.preventDefault();
      }
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
    });
    on(window, 'keyup', (ev) => {
      const e = ev as KeyboardEvent;
      this.held.delete(e.code);
      if (this.h.capturing() && GAME_CODES.has(e.code)) e.preventDefault();
    });
    on(document, 'mousemove', (ev) => {
      const e = ev as MouseEvent;
      if (this.locked || this.dragging) {
        const mx = e.movementX || 0;
        const my = e.movementY || 0;
        // 部分瀏覽器在取得／恢復鎖定時會送出一次巨大的位移，忽略這種尖峰
        if (Math.abs(mx) > 280 || Math.abs(my) > 280) return;
        this.dx += mx;
        this.dy += my;
      }
    });
    on(this.canvas, 'mousedown', (ev) => {
      const e = ev as MouseEvent;
      if (!this.h.capturing()) return;
      if (e.button === 0) {
        this.fireHeld = true;
        this.firePressed = true;
      } else if (e.button === 2) {
        this.dragging = true;
      }
      e.preventDefault();
    });
    on(window, 'mouseup', (ev) => {
      const e = ev as MouseEvent;
      if (e.button === 0) this.fireHeld = false;
      else if (e.button === 2) this.dragging = false;
    });
    on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'wheel', (e) => {
      if (this.h.capturing()) e.preventDefault();
    }, { passive: false });
    on(window, 'blur', () => {
      this.clear();
      this.h.onFocusLost();
    });
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.clear();
        this.h.onFocusLost();
      }
    });
    on(document, 'pointerlockchange', () => {
      const now = document.pointerLockElement === this.canvas;
      this.locked = now;
      if (now) {
        this.lockEverWorked = true;
        this.fallback = false;
      }
      if (this.pendingLock) {
        this.pendingLock(now);
        this.pendingLock = null;
      }
      this.h.onLockChange(now);
    });
    on(document, 'pointerlockerror', () => {
      if (this.pendingLock) {
        this.pendingLock(false);
        this.pendingLock = null;
      }
      this.h.onLockError();
    });
  }

  detach(): void {
    if (this.abort) this.abort.abort();
    this.abort = null;
    this.listenerCount = 0;
  }

  /** 需在使用者手勢中呼叫。回傳是否成功鎖定。 */
  requestLock(): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      this.pendingLock = finish;
      try {
        const r = (this.canvas.requestPointerLock as unknown as () => Promise<void> | void).call(this.canvas);
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => finish(false));
      } catch {
        finish(false);
      }
      window.setTimeout(() => finish(this.locked), 900);
    });
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear(): void {
    this.held.clear();
    this.pressed.clear();
    this.fireHeld = false;
    this.firePressed = false;
    this.dragging = false;
    this.dx = 0;
    this.dy = 0;
  }

  heldKeys(): string[] {
    return [...this.held];
  }

  /** 取出本幀輸入，並清除邊緣觸發的狀態。 */
  consume(): RawFrame {
    const k = this.held;
    const p = this.pressed;
    const axis = (neg: string, pos: string) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    let digit: number | null = null;
    if (p.has('Digit1')) digit = 1;
    else if (p.has('Digit2')) digit = 2;
    else if (p.has('Digit3')) digit = 3;
    const f: RawFrame = {
      moveX: axis('KeyA', 'KeyD'),
      moveZ: axis('KeyS', 'KeyW'),
      lookDX: this.dx,
      lookDY: this.dy,
      keyYaw: axis('ArrowRight', 'ArrowLeft'),
      keyPitch: axis('ArrowDown', 'ArrowUp'),
      fire: this.fireHeld,
      firePressed: this.firePressed,
      selectTool: digit === 1 ? 'sword' : digit === 2 ? 'crossbow' : digit === 3 ? 'stone' : null,
      bottle: p.has('KeyQ'),
      interact: p.has('KeyE'),
      potion: p.has('KeyH'),
      wait: k.has('Space'),
      map: p.has('Tab') || p.has('KeyM'),
      escape: p.has('Escape'),
      digit,
    };
    this.dx = 0;
    this.dy = 0;
    this.firePressed = false;
    p.clear();
    return f;
  }
}

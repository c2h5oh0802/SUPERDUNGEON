/** Fullscreen is optional and must be requested directly from a trusted click. */
export class FullscreenControls {
  private pending = false;
  private automaticTried = false;
  private wasActive = false;
  private notice = '';
  private readonly buttons: HTMLButtonElement[];
  private readonly notes: HTMLElement[];

  constructor(private readonly onChange: (active: boolean) => void, private readonly doc = document) {
    this.buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>('[data-fullscreen]'));
    this.notes = Array.from(doc.querySelectorAll<HTMLElement>('[data-fullscreen-note]'));
    for (const button of this.buttons) button.addEventListener('click', () => { void this.toggle(); });
    doc.addEventListener('fullscreenchange', this.changed);
    this.wasActive = this.active;
    this.render();
  }

  get active(): boolean { return this.doc.fullscreenElement === this.doc.documentElement; }
  get supported(): boolean {
    return typeof this.doc.documentElement.requestFullscreen === 'function'
      && typeof this.doc.exitFullscreen === 'function' && this.doc.fullscreenEnabled !== false;
  }

  /** Best effort once per visit; never re-enter after the player exits or refuses. */
  enter(automatic = false): Promise<boolean> {
    if (this.active) return Promise.resolve(true);
    if (automatic && this.automaticTried) return Promise.resolve(false);
    this.automaticTried = true;
    if (!this.supported || this.pending) return Promise.resolve(false);
    return this.perform(true);
  }

  toggle(): Promise<boolean> {
    if (this.pending) return Promise.resolve(false);
    this.automaticTried = true;
    return this.active ? this.perform(false) : this.enter();
  }

  private async perform(enter: boolean): Promise<boolean> {
    this.pending = true;
    this.notice = '';
    this.render();
    try {
      // No await before the native call: keep the originating click's activation.
      if (enter) await this.doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else await this.doc.exitFullscreen();
      this.changed();
      return this.active === enter;
    } catch {
      this.notice = enter
        ? '未能進入全螢幕，仍可正常遊玩；可再點一次，或用 Android Chrome 開啟。'
        : '未能退出全螢幕；可再點一次，或使用瀏覽器的返回鍵。';
      return false;
    } finally {
      this.pending = false;
      this.render();
    }
  }

  private readonly changed = (): void => {
    const active = this.active;
    this.notice = '';
    if (active !== this.wasActive) {
      this.wasActive = active;
      // An OS/browser exit is respected just like our own exit button.
      this.automaticTried = true;
      this.onChange(active);
    }
    this.render();
  };

  private render(): void {
    const label = this.active ? '退出全螢幕' : this.supported ? '全螢幕' : '全螢幕（不支援）';
    for (const button of this.buttons) {
      button.textContent = label;
      button.disabled = this.pending || (!this.active && !this.supported);
      button.setAttribute('aria-pressed', String(this.active));
      button.setAttribute('aria-busy', String(this.pending));
    }
    const note = this.notice || (!this.supported && !this.active
      ? '此瀏覽器無法全螢幕。可改用 Android Chrome 開啟，或繼續一般模式。'
      : this.active ? '已全螢幕；可在暫停選單退出，或使用瀏覽器的返回鍵。'
        : '點選可嘗試隱藏網址列；是否支援由瀏覽器決定。');
    for (const element of this.notes) element.textContent = note;
  }
}

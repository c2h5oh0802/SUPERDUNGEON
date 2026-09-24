// 唯一的 requestAnimationFrame 迴圈。重複呼叫 start() 不會建立第二個迴圈。

let activeLoops = 0;

export function activeLoopCount(): number {
  return activeLoops;
}

export class Loop {
  private raf = 0;
  private running = false;
  private last = -1;
  private cb: ((dt: number, now: number) => void) | null = null;

  start(cb: (dt: number, now: number) => void): void {
    this.cb = cb;
    if (this.running) return;
    this.running = true;
    activeLoops++;
    this.last = -1;
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = this.last < 0 ? 0 : (now - this.last) / 1000;
      this.last = now;
      try {
        this.cb?.(dt, now);
      } finally {
        if (this.running) this.raf = requestAnimationFrame(tick);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** 下一幀的時間差歸零（暫停恢復時不補算背景時間）。 */
  resetClock(): void {
    this.last = -1;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    activeLoops--;
    cancelAnimationFrame(this.raf);
  }
}

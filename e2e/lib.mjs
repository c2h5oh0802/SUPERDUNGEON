// 共用的 Playwright 自動操作工具。
// 注意：自動化以「正常操作」輸入（WASD、方向鍵轉向、滑鼠左鍵、E/H/Q/空白），
// 但透過 ?dev=1 的 window.__sd 讀取狀態來決定路線與瞄準（狀態讀取輔助，不是真人操作）。
import { chromium } from 'playwright';

export const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
export const OUT = new URL('./out/', import.meta.url).pathname;

export async function launch({ headless = true, viewport = { width: 1280, height: 720 } } = {}) {
  const browser = await chromium.launch({
    headless,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return { browser, context, page, errors };
}

export const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export const yawTo = (px, pz, tx, tz) => Math.atan2(-(tx - px), -(tz - pz));

export class Bot {
  constructor(page, log = () => {}) {
    this.page = page;
    this.log = log;
    this.held = new Set();
  }
  async st() {
    return this.page.evaluate(() => window.__sd.state());
  }
  async down(k) {
    if (this.held.has(k)) return;
    this.held.add(k);
    await this.page.keyboard.down(k);
  }
  async up(k) {
    if (!this.held.has(k)) return;
    this.held.delete(k);
    await this.page.keyboard.up(k);
  }
  async releaseAll() {
    for (const k of [...this.held]) await this.up(k);
  }
  async tap(k, ms = 40) {
    await this.page.keyboard.down(k);
    await this.page.waitForTimeout(ms);
    await this.page.keyboard.up(k);
  }
  /** 以方向鍵轉向（2.2 rad/s 真實時間）。 */
  async turnTo(yaw, tol = 0.07) {
    for (let i = 0; i < 8; i++) {
      const s = await this.st();
      const d = wrap(yaw - s.player.yaw);
      if (Math.abs(d) < tol) return true;
      const key = d > 0 ? 'ArrowLeft' : 'ArrowRight';
      await this.page.keyboard.down(key);
      await this.page.waitForTimeout(Math.max(12, (Math.abs(d) / 2.2) * 1000 - 10));
      await this.page.keyboard.up(key);
    }
    return false;
  }
  async pitchTo(pitch, tol = 0.05) {
    for (let i = 0; i < 8; i++) {
      const s = await this.st();
      const d = pitch - s.player.pitch;
      if (Math.abs(d) < tol) return;
      const key = d > 0 ? 'ArrowUp' : 'ArrowDown';
      await this.page.keyboard.down(key);
      await this.page.waitForTimeout(Math.max(12, (Math.abs(d) / 1.5) * 1000 - 10));
      await this.page.keyboard.up(key);
    }
  }
  async click(ms = 50) {
    await this.page.mouse.down({ button: 'left' });
    await this.page.waitForTimeout(ms);
    await this.page.mouse.up({ button: 'left' });
  }
  async waitIdle(max = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      const s = await this.st();
      if (!s.player.action) return s;
      await this.page.waitForTimeout(30);
    }
    return this.st();
  }
}

export async function startRun(page, seed) {
  await page.fill('#seed-input', seed);
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 30000 });
}

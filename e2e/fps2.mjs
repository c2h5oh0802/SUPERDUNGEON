import { launch, startRun } from './lib.mjs';
const { browser, page } = await launch({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:5173/?dev=1');
await startRun(page, 'FPS1');
await page.waitForTimeout(800);
for (const what of ['none', 'enemies', 'level', 'props']) {
  await page.evaluate((w) => window.__sd.debug.hide(w), what);
  await page.waitForTimeout(600);
  const r = await page.evaluate(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { fps: n / ((performance.now() - t0) / 1000), calls: window.__sd.renderInfo().sceneCalls };
  });
  console.log('hide', what, 'fps', r.fps.toFixed(1), 'sceneCalls', r.calls);
}
await browser.close();

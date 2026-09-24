import { launch, startRun } from './lib.mjs';
for (const q of ['', '&gfx=low']) {
  const { browser, page } = await launch({ viewport: { width: 960, height: 540 } });
  await page.goto(`http://127.0.0.1:5173/?dev=1${q}`);
  await startRun(page, 'FPS1');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return n / ((performance.now() - t0) / 1000);
  });
  console.log(q || 'default', 'fps', r.toFixed(1));
  await browser.close();
}

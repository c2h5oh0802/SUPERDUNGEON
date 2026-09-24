// 量測：無頭 Chromium（SwiftShader 軟體渲染）的幀率。不代表真實硬體。
import { launch, startRun } from './lib.mjs';
for (const vp of [{ width: 1280, height: 720 }, { width: 640, height: 360 }]) {
  const { browser, page } = await launch({ viewport: vp });
  await page.goto('http://127.0.0.1:5173/?dev=1');
  await startRun(page, 'FPS1');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__sd.perf());
  const r = await page.evaluate(async () => {
    let n = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    return { fps: n / ((performance.now() - t0) / 1000), info: window.__sd.renderInfo(), perf: window.__sd.perf() };
  });
  console.log(`${vp.width}x${vp.height}`, 'fps', r.fps.toFixed(1), JSON.stringify(r.info), JSON.stringify(r.perf));
  await browser.close();
}

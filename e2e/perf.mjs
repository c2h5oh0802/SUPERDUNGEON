// 量測幀率（預設畫質 vs ?gfx=low）。在沒有 GPU 的環境是軟體渲染，數字不代表真實硬體。
import { BASE, launch, startRun } from './lib.mjs';

for (const q of ['', '&gfx=low']) {
  const { browser, page } = await launch({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${BASE}?dev=1${q}`);
  await startRun(page, 'FPS1');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    window.__sd.perf();
    let n = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const f = () => {
        n++;
        if (performance.now() - t0 < 4000) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    return { fps: n / ((performance.now() - t0) / 1000), perf: window.__sd.perf(), info: window.__sd.renderInfo() };
  });
  console.log(
    `${q || '預設畫質'}  fps=${r.fps.toFixed(1)}  JS 模擬=${r.perf.simMs.toFixed(2)}ms  JS 渲染提交=${r.perf.renderMs.toFixed(2)}ms  場景繪製呼叫=${r.info.sceneCalls}  關卡頂點=${r.info.vertices}  烘焙=${r.info.bakeMs.toFixed(0)}ms`,
  );
  await browser.close();
}

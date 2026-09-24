// 瀏覽器邊界測試：主選單按鈕、設定儲存被封鎖、失焦／分頁切換、Esc、視窗縮放、
// 受限 iframe、手機提示、連續重開不殘留資源。
import { chromium } from 'playwright';
import { BASE, OUT, launch, startRun } from './lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// 1) 主選單、說明、設定
{
  const { browser, page, errors } = await launch();
  await page.goto(`${BASE}?gfx=low`);
  await page.click('#btn-help');
  check('玩法說明可開啟', await page.isVisible('#screen-help'));
  await page.click('#screen-help button.back');
  check('玩法說明可返回', await page.isVisible('#screen-menu'));
  await page.click('#btn-settings');
  check('設定可開啟', await page.isVisible('#screen-settings'));
  await page.fill('#set-sens', '1.6');
  await page.dispatchEvent('#set-sens', 'input');
  const saved = await page.evaluate(() => localStorage.getItem('superdungeon.settings.v1'));
  check('設定寫入 localStorage', !!saved && JSON.parse(saved).sensitivity === 1.6, saved ?? '');
  await page.click('#screen-settings button.back');
  await page.click('#btn-seed-random');
  const seed = await page.inputValue('#seed-input');
  check('隨機種子按鈕產生種子', /^[A-Z0-9]{6}$/.test(seed), seed);
  check('主選單無 console 錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// 2) localStorage 被封鎖
{
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?gfx=low`);
  await page.waitForTimeout(300);
  const note = await page.textContent('#storage-note');
  check('localStorage 封鎖時不崩潰並提示', errors.length === 0 && (note ?? '').includes('本次'), `${note} ${errors.join('|')}`);
  await page.click('#btn-settings');
  await page.fill('#set-fov', '90');
  await page.dispatchEvent('#set-fov', 'input');
  check('封鎖時設定仍可在本次調整', (await page.textContent('#out-fov')) === '90°');
  await browser.close();
}

// 3) 失焦、分頁切換、Esc、恢復、縮放、重開
{
  const { browser, page, errors } = await launch();
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await startRun(page, 'EDGE1');
  const st = () => page.evaluate(() => window.__sd.state());
  check('開始冒險後進入遊戲', (await st()).mode === 'playing');
  check('開始按鈕的點擊啟用了音訊（AudioContext 已建立）', (await page.evaluate(() => window.__sd.audio())).active === true);
  // 按住 W 後失焦：應暫停並清空按鍵
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(100);
  const held = await page.evaluate(() => window.__sd.inputState().held);
  const s1 = await st();
  check('失焦時暫停', s1.mode === 'paused', s1.mode);
  check('失焦時清空卡住的按鍵', held.length === 0, JSON.stringify(held));
  const t0 = s1.time;
  await page.waitForTimeout(1500);
  check('暫停中世界時間不前進', (await st()).time === t0);
  await page.keyboard.up('KeyW');
  await page.click('#btn-resume');
  await page.waitForTimeout(1200);
  let s2 = await st();
  if (s2.mode !== 'playing') {
    // 瀏覽器的鎖定冷卻：再按一次
    await page.click('#btn-resume');
    await page.waitForTimeout(1200);
    s2 = await st();
  }
  check('按「繼續」後恢復', s2.mode === 'playing', s2.mode);
  check('恢復後沒有補算背景時間', s2.time - t0 < 0.3, `Δworld=${(s2.time - t0).toFixed(3)}`);
  // 分頁切換
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  check('切換分頁（hidden）時暫停', (await st()).mode === 'paused');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await page.click('#btn-resume');
  await page.waitForTimeout(1300);
  if ((await st()).mode !== 'playing') {
    await page.click('#btn-resume');
    await page.waitForTimeout(1300);
  }
  // Esc
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc 暫停', (await st()).mode === 'paused', (await st()).mode);
  await page.click('#btn-resume');
  await page.waitForTimeout(1300);
  if ((await st()).mode !== 'playing') {
    await page.click('#btn-resume');
    await page.waitForTimeout(1300);
  }
  // 地圖
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const sm = await st();
  check('Tab 開啟地圖且世界暫停', sm.mode === 'map');
  const tm = sm.time;
  await page.waitForTimeout(600);
  check('地圖開啟時世界不前進', (await st()).time === tm);
  await page.screenshot({ path: `${OUT}map.png` });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  check('再按 Tab 關閉地圖', (await st()).mode === 'playing');
  // 縮放
  for (const vp of [
    { width: 1600, height: 900 },
    { width: 900, height: 900 },
    { width: 1280, height: 600 },
  ]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);
    const box = await page.locator('#crosshair').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const ok = Math.abs(cx - vp.width / 2) < 2 && Math.abs(cy - vp.height / 2) < 2;
    check(`縮放 ${vp.width}×${vp.height} 準星置中`, ok, `${cx.toFixed(1)},${cy.toFixed(1)}`);
  }
  await page.screenshot({ path: `${OUT}resize-1280x600.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  // 連續重開 3 次：資源不增長、迴圈只有一個
  const snap = async () => page.evaluate(() => ({ r: window.__sd.renderInfo(), loops: window.__sd.loops(), listeners: window.__sd.listeners() }));
  const counts = [];
  for (let k = 0; k < 4; k++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if ((await st()).mode !== 'paused') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.click('#btn-restart');
    await page.waitForFunction(() => window.__sd.state().mode === 'playing', null, { timeout: 30000 });
    await page.waitForTimeout(800);
    counts.push(await snap());
  }
  console.log('restart snapshots', JSON.stringify(counts.map((c) => [c.r.geometries, c.r.textures, c.r.programs, c.loops, c.listeners])));
  const g = counts.map((c) => c.r.geometries);
  const tx = counts.map((c) => c.r.textures);
  check('重開後幾何數量不持續增加', g[3] <= g[1] + 2, g.join(','));
  check('重開後貼圖數量不持續增加', tx[3] <= tx[1], tx.join(','));
  check('始終只有一個渲染迴圈', counts.every((c) => c.loops === 1), counts.map((c) => c.loops).join(','));
  check('事件監聽數量不增加', counts.every((c) => c.listeners === counts[0].listeners), counts.map((c) => c.listeners).join(','));
  // 回主畫面
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await st()).mode !== 'paused') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.click('#btn-quit');
  await page.waitForTimeout(300);
  check('回主畫面', (await st()).mode === 'menu');
  check('遊戲中無 console 錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// 4) 受限 iframe（沒有 allow-pointer-lock）
{
  const { browser, page, errors } = await launch();
  await page.goto(`${BASE}e2e/iframe-host.html`);
  const frame = page.frameLocator('#game');
  await frame.locator('#seed-input').fill('FRAME1');
  await frame.locator('#btn-start').click();
  const f = page.frames().find((x) => x.url().includes('dev=1'));
  await f.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const s = await f.evaluate(() => window.__sd.state());
  check('受限 iframe：無法鎖定時切換為備用操作', s.fallback === true && s.mode === 'playing', `fallback=${s.fallback}`);
  check('受限 iframe：顯示備用操作提示', await frame.locator('#lock-banner').isVisible());
  // 方向鍵轉視角
  const y0 = s.player.yaw;
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(100);
  const y1 = (await f.evaluate(() => window.__sd.state())).player.yaw;
  check('受限 iframe：方向鍵可轉視角', y1 - y0 > 0.2, `Δyaw=${(y1 - y0).toFixed(2)}`);
  // 右鍵拖曳
  const box = await page.locator('#game').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150);
  const y2 = (await f.evaluate(() => window.__sd.state())).player.yaw;
  check('受限 iframe：右鍵拖曳可轉視角', Math.abs(y2 - y1) > 0.05, `Δyaw=${(y2 - y1).toFixed(3)}`);
  // 備用模式下 Esc 暫停
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('受限 iframe：Esc 暫停', (await f.evaluate(() => window.__sd.state())).mode === 'paused');
  await page.screenshot({ path: `${OUT}iframe-fallback.png` });
  // 瀏覽器本身在沙盒 iframe 拒絕滑鼠鎖定時會印出這一行，這是預期行為，不是遊戲錯誤
  const unexpected = errors.filter((e) => !e.includes("frame is sandboxed and the 'allow-pointer-lock' permission is not set"));
  check('受限 iframe：除了瀏覽器預期的沙盒提示外無 console 錯誤', unexpected.length === 0, unexpected.join(' | '));
  await browser.close();
}

// 5) 觸控裝置提示
{
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${BASE}?gfx=low`);
  await page.waitForTimeout(300);
  check('觸控裝置顯示需要鍵鼠的提示', await page.isVisible('#screen-mobile'));
  await page.screenshot({ path: `${OUT}mobile.png` });
  await page.click('#btn-mobile-continue');
  check('提示可關閉並回到主選單', await page.isVisible('#screen-menu'));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

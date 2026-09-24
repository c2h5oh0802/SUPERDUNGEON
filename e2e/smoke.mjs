// 快速煙霧測試：開頁、開始冒險、截圖（Chromium，無頭）。
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = new URL('./out/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`${BASE}?dev=1`);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}menu.png` });
await page.fill('#seed-input', 'DEMO1');
await page.click('#btn-start');
await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}start.png` });
const st = await page.evaluate(() => window.__sd.state());
console.log('mode', st.mode, 'template', st.template, 'fallback', st.fallback, 'enemies', st.enemies.length);
console.log('render', JSON.stringify(await page.evaluate(() => window.__sd.renderInfo())));
// 往前走一段
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}walk.png` });
console.log('player', JSON.stringify((await page.evaluate(() => window.__sd.state())).player));
console.log('errors', errors.length ? errors.join('\n') : 'none');
await browser.close();

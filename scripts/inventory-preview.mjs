/** CPU-only fixture export of the real UI markup/CSS. This is NOT gameplay QA. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? '/tmp/superdungeon-inventory-review');
await mkdir(output, { recursive: true });
const fixture = `
import { makeWorld, OPEN_ROOM } from './tests/helpers';
import { renderInventory } from './src/ui/inventory';
const w = makeWorld(OPEN_ROOM, [], 'huntress');
w.player.weapon = {id:'knife',level:2}; w.player.armor = {id:'leather',level:1};
w.player.bowLevel=2; w.player.hp=8; w.player.maxHp=12; w.player.hunger=96;
w.player.items=[
 {id:'weapon:axe',count:1,level:3},{id:'potion:frost',count:4,level:0},
 {id:'food:ration',count:6,level:0},{id:'scroll:mapping',count:1,level:0},
 {id:'armor:mail',count:1,level:0},{id:'potion:invisibility',count:2,level:0},
 {id:'scroll:upgrade',count:2,level:0},{id:'potion:healing',count:3,level:0}];
const nodes={'inv-gear':{innerHTML:''},'inv-status':{innerHTML:''},'inv-count':{textContent:''},'inv-list':{innerHTML:'',querySelectorAll:()=>[]}};
globalThis.document={getElementById:id=>nodes[id]};
renderInventory(w,()=>{}); console.log(JSON.stringify(nodes));`;
const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const result = spawnSync(process.execPath, ['--input-type=module'], { input: bundle.outputFiles[0].text, encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr);
const nodes = JSON.parse(result.stdout);
const source = await readFile(join(root, 'index.html'), 'utf8');
let screen = source.slice(source.indexOf('    <section id="screen-inventory"'), source.indexOf('    <section id="screen-map"')).replace('screen hidden', 'screen');
for (const id of ['inv-gear', 'inv-list', 'inv-status']) {
  screen = screen.replace(new RegExp(`(<(?:aside|div)[^>]*id="${id}"[^>]*>)</(?:aside|div)>`), (_, opening) => opening + nodes[id].innerHTML + (id === 'inv-gear' ? '</aside>' : '</div>'));
}
screen = screen.replace('<small id="inv-count"></small>', `<small id="inv-count">${nodes['inv-count'].textContent}</small>`);
screen = screen.replace(/src="[^"]*\/assets\/inventory\/([^"]+)"/g, (_, name) => `src="${pathToFileURL(join(root, 'src/assets/inventory', name)).href}"`);
const css = await readFile(join(root, 'src/ui/style.css'), 'utf8');
// PDF engines do not implement dvh, aspect-ratio or viewport media queries the
// same way as browsers. Explicit print-only sizes make this supporting preview
// reproducible; the actual application CSS and UI content remain unchanged.
const printAdapter = `
@page { size:1440px 1040px; margin:0; }
html,body { width:1440px; height:1040px; overflow:visible; background:#0b0f10; }
.review-caption { margin:0; padding:16px 32px 0; color:#bcbda9; font:12px 'Noto Sans CJK TC',sans-serif; }
#screen-inventory { position:relative; display:block; padding:20px 32px 32px; width:1440px; }
.panel.inv-panel { width:1376px; max-height:none; box-shadow:none; }
.inv-workbench { grid-template-columns:238px 1050px; }
.inv-list { grid-template-columns:580px 450px; }
.inv-grid { grid-template-columns:repeat(5,112px); }
.inv-panel .inv-tile { height:144px; width:112px; display:block; }
.inv-header { height:90px; }
.inv-header>div:first-child { width:250px; min-width:250px; }
.inv-footer { position:relative; }
[hidden], .equipment-details>div { display:none; }
.inv-art { filter:none; }`;
const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>Inventory static layout review</title><style>${css}\n${printAdapter}</style><body><p class="review-caption">靜態介面預覽 · 測試用物品 · 非遊戲截圖</p>${screen}</body></html>`;
await writeFile(join(output, 'inventory-static-preview.html'), html);
console.log(`Exported ${join(output, 'inventory-static-preview.html')}`);
console.log('Actual renderer markup and CSS with explicit print dimensions. This does not verify browser interactions or gameplay.');

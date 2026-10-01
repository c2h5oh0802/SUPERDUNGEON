import process from 'node:process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] || '.');
const output = resolve(process.argv[3] || 'huntress-calibration-results.json');
const { build } = await import(pathToFileURL(join(source, 'node_modules/esbuild/lib/main.js')));
async function sourceHashes() {
  const files = (await readdir(join(source, 'src'), { recursive: true })).filter(f => f.endsWith('.ts')).map(f => 'src/' + f);
  files.push('tests/helpers.ts');
  files.sort();
  const entries = await Promise.all(files.map(async f => [f, createHash('sha256').update(await readFile(join(source, f))).digest('hex')]));
  return Object.fromEntries(entries);
}
const before = await sourceHashes();
const harness = (await readFile(join(here, process.env.HARNESS || 'harness.mjs'), 'utf8')).replaceAll('__SOURCE__', source);
const bundle = await build({ stdin: { contents: harness, resolveDir: here, loader: 'js', sourcefile: 'harness.mjs' }, bundle: true, platform: 'node', format: 'esm', write: false });
const after = await sourceHashes();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source changed during bundling. Retry after it is stable.');
await mkdir(dirname(output), { recursive: true });
await writeFile(output + '.source-sha256.json', JSON.stringify(before, null, 2) + '\n');
const child = spawnSync(process.execPath, ['--input-type=module'], { input: bundle.outputFiles[0].text, stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, OUTPUT: output, SOURCE_REPO: source } });
process.exit(child.status ?? 1);

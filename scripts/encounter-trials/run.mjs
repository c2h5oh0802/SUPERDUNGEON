/** Recompute the current 30 bounded policies; --verify checks stored results. */
import process from 'node:process';
import console from 'node:console';
import { readFile, writeFile, readdir, mkdtemp, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { summarize } from './summarize.mjs';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../..');
const output=join(root,'docs/encounter-trials/measurements.json');
const sha=s=>createHash('sha256').update(s).digest('hex');
async function fingerprint() {
  const files=(await readdir(join(root,'src'),{recursive:true})).filter(f=>f.endsWith('.ts')).sort();
  return sha((await Promise.all(files.map(async f=>f+'\0'+sha(await readFile(join(root,'src',f)))))).join('\n'));
}
const before=await fingerprint(), harness=await readFile(join(here,'harness.mjs'),'utf8');
const bundle=await build({stdin:{contents:harness.replaceAll('__SOURCE__',root),resolveDir:here,loader:'js'},bundle:true,platform:'node',format:'esm',write:false});
if(before!==await fingerprint())throw new Error('Source changed during bundle; wait for edits to finish and retry.');
const rawAt=process.argv.indexOf('--raw');
const raw=rawAt<0?join(await mkdtemp(join(tmpdir(),'encounter-trials-')),'raw.json'):resolve(process.argv[rawAt+1]);
await mkdir(dirname(raw),{recursive:true});
const run=spawnSync(process.execPath,['--input-type=module'],{input:bundle.outputFiles[0].text,encoding:'utf8',env:{...process.env,OUTPUT:raw,BATCH:'final-v4'}});
if(run.stdout)console.log(run.stdout);if(run.stderr)console.error(run.stderr);
if(run.status)process.exit(run.status);
const result=JSON.parse(await readFile(raw,'utf8')), rows=result.rows.map(summarize);
const stored=JSON.parse(await readFile(output,'utf8'));
if(process.argv.includes('--verify')) {
  if(JSON.stringify(stored.final.rows)!==JSON.stringify(rows))throw new Error('Current policy results differ from measurements.json. Raw results: '+raw);
  console.log('Verified all 30 current runs exactly. Raw results: '+raw);
} else {
  stored.final={description:result.description,sourceSha256:before,harnessSha256:sha(harness),rows};
  await writeFile(output,JSON.stringify(stored)+'\n');
  console.log('Updated compact results; all prior exploration records preserved. Raw results: '+raw);
}

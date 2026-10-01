import process from "node:process";
import console from "node:console";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const files=process.argv.slice(2);
for(const file of files){
 const d=JSON.parse(readFileSync(file,'utf8'));const seen=new Set();
 for(const r of d.results){
  const id=[r.seed,r.cls,r.policy,r.guard,r.eatEnabled].join('/');assert(!seen.has(id),`Duplicate ${id}`);seen.add(id);
  assert(Number.isFinite(r.worldTime)&&r.worldTime>=0,id);
  assert(r.foodFound===(r.found['food:ration']||0),id);
  assert(r.foodRemaining===(r.remaining['food:ration']||0),id);
  for(const k of new Set([...Object.keys(r.initial),...Object.keys(r.found),...Object.keys(r.granted),...Object.keys(r.used),...Object.keys(r.remaining)])){
   assert.equal((r.initial[k]||0)+(r.found[k]||0)+(r.granted[k]||0)-(r.used[k]||0),r.remaining[k]||0,`${id}: conservation ${k}`);
  }
  assert.equal(r.complete,r.floors.length===(r.expectedFloors||4)&&r.floors.at(-1).outcome==='win',id);
 }
 console.log(`${file}: ${d.results.length} unique scenarios; resource accounting and outcome assertions passed`);
}

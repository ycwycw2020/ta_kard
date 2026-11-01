import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import engine from '../engine.cjs';
import {catalog,E,validTeam} from '../lib/game.mjs';

const strongest=catalog.filter(x=>x.cost===5).slice(0,4).map(x=>x.id);
const roster=strongest.map(id=>({id,skin:0}));
test('API team validator and engine accept four distinct characters costing exactly 20',()=>{
 assert.equal(strongest.length,4);
 assert.equal(E.config.teamCostCap,20);
 assert.deepEqual(validTeam(roster),roster);
 assert.equal(E.create(strongest,strongest,123,0).own.length,4);
});
test('browser rules agree with backend and preserve tactical point limits',()=>{
 const sandbox={};vm.runInNewContext(fs.readFileSync(new URL('../web/engine.js',import.meta.url),'utf8'),sandbox);
 const browser=sandbox.TalosEngine(catalog);
 assert.equal(browser.config.teamCostCap,20);
 assert.equal(browser.create(strongest,strongest,123,0).own.length,4);
 assert.equal(browser.config.apCap,6);assert.equal(browser.config.apRegen,2);
 assert.equal(E.config.apCap,6);assert.equal(E.config.apRegen,2);
});
test('legacy16 remains selectable and rejects a 20-cost roster without raising its cap',()=>{
 assert.throws(()=>validTeam(roster,16),/最多16/);
 assert.deepEqual(validTeam(roster,20),roster);
 assert.throws(()=>validTeam(roster,999),/未知/);
});
test('over-budget synthetic data is rejected, and duplicate or fifth slots remain invalid',()=>{
 const modified=structuredClone(catalog);modified.find(c=>c.id===strongest[0]).cost=6;
 assert.throws(()=>engine(modified).create(strongest,strongest,1,0),/不超过20/);
 const c=catalog.find(x=>x.id===strongest[0]),cost=c.cost;
 try{c.cost=6;assert.throws(()=>validTeam(roster),/最多20/);}finally{c.cost=cost;}
 assert.throws(()=>validTeam([roster[0],roster[0],...roster.slice(2)]));
 assert.throws(()=>validTeam([...roster,roster[0]]));
});

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {E,catalog,rulesVersion,runtimeRulesHash} from '../lib/game.mjs';
const count=Number(process.argv[2]||1000);assert.ok(Number.isInteger(count)&&count>0&&count<=10000);
let rng=385771;const rand=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return (rng>>>0)/4294967296;};
function roster(){for(;;){const ids=[];while(ids.length<4){const id=catalog[Math.floor(rand()*catalog.length)].id;if(!ids.includes(id))ids.push(id);}if(ids.reduce((n,id)=>n+E.byId(id).cost,0)<=16)return ids;}}
const rounds=[],histogram={},ultimates={},appearances={};
for(let i=0;i<count;i++){
 const b=E.create(roster(),roster(),i+9853,i%2);
 b.items[0].id=['resource_cell','full_restore','medkit','barrier_generator','cleanser','reactivation'][i%6];
 b.items[1].id=['full_restore','medkit','resource_cell','cleanser','reactivation','barrier_generator'][i%6];
 let guard=0;
 while(b.winner===null&&guard++<500){
  E.autoCombos(b,0);E.autoCombos(b,1);
  if(b.winner!==null)break;
  if(b.roundPending)E.endRound(b);else E.playAI(b,b.priority,['balanced','aggressive','defensive'][(i+b.priority)%3]);
  assert.ok(b.ap.every(x=>Number.isInteger(x)&&x>=0&&x<=6));
  assert.ok([...b.own,...b.enemy].every(u=>u.ultimateCharge>=0&&u.ultimateCharge<=E.byId(u.id).ultimate.requiredCasts));
 }
 assert.notEqual(b.winner,null,'Unfinished game');rounds.push(b.round);histogram[b.round]=(histogram[b.round]||0)+1;
 for(const u of [...b.own,...b.enemy]){appearances[u.id]=(appearances[u.id]||0)+1;if(u.ult)ultimates[u.id]=(ultimates[u.id]||0)+1;}
}
rounds.sort((a,b)=>a-b);
const report={rulesVersion,runtimeRulesHash,matches:count,min:rounds[0],max:rounds.at(-1),median:rounds[Math.floor(count/2)],mean:rounds.reduce((a,b)=>a+b,0)/count,within11to19Percent:100*rounds.filter(x=>x>=11&&x<=19).length/count,histogram,ultimateUsage:catalog.map(c=>({id:c.id,name:c.name,requiredCasts:c.ultimate.requiredCasts,appearances:appearances[c.id]||0,casts:ultimates[c.id]||0})),checked:'AP stays in 0..6; per-unit charge stays within its configured threshold; every match finishes'};
fs.writeFileSync(new URL(`../verification/balance-v${rulesVersion}.json`,import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,ultimateUsage:undefined},null,2));

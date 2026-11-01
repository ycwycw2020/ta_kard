import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Wallet,NonceManager,Contract} from 'ethers';
import {artifact,deployLinked} from '../scripts/battle-artifacts.mjs';
import {decodeBattleState} from '../lib/battle-chain.mjs';
import engine from '../engine.cjs';
const catalog=JSON.parse(fs.readFileSync('catalog.json','utf8')),E=engine(catalog);
const config=JSON.parse(fs.readFileSync(process.env.TALOS_CONFIG_PATH||'D:/card_endfiled/game/deployment/private/config.json','utf8'));
const provider=new JsonRpcProvider(config.rpc,config.chainId,{staticNetwork:true});provider.pollingInterval=300;
const signer=new NonceManager(new Wallet(config.wallets.admin.privateKey,provider));
const addresses={},receipts={};
const preflight='battle-preflight-deployments.json';
const hashFiles=()=>Object.fromEntries(fs.readdirSync('build').filter(x=>/^TalosBattle.*\.json$/.test(x)).map(x=>[x,crypto.createHash('sha256').update(fs.readFileSync('build/'+x)).digest('hex')]));
const hashes=hashFiles();
if(fs.existsSync(preflight)){
 const old=JSON.parse(fs.readFileSync(preflight));
 if(JSON.stringify(old.hashes)===JSON.stringify(hashes))for(const [name,address]of Object.entries(old.addresses))if(await provider.getCode(address)!=='0x')addresses[name]=address;
}
await deployLinked('TalosBattleHarness',signer,addresses,receipts);
fs.writeFileSync(preflight,JSON.stringify({hashes,addresses,receipts},null,2));
const harness=new Contract(addresses.TalosBattleHarness,artifact('TalosBattleHarness').abi,provider);
const stateParam=harness.interface.getFunction('make').outputs[0];
function unwrap(v,param){
 if(param.baseType==='array')return Array.from(v,x=>unwrap(x,param.arrayChildren));
 if(param.baseType==='tuple')return Object.fromEntries(param.components.map((c,i)=>[c.name,unwrap(v[i],c)]));
 if(typeof v==='bigint')return param.type==='uint128'?v:Number(v);
 return v;
}
const plain=v=>unwrap(v,stateParam);
const names=['attack','skill','ultimate','defend','item','pass','combo','cycle','round','surrender'];
const fields=['id','hp','shield','acted','combo','comboTriggered','ult','ultimateCharge','frozen','burn','electric','electricUntil','vulnerable','vulnerableUntil','barrier','barrierUntil','crossedHalf','vocalist'];
function comparable(b){
 const unit=u=>({...Object.fromEntries(fields.map(k=>[k,u[k]??(k==='ultimateCharge'?0:undefined)])),ready:u.ready?{targetSide:u.ready.targetSide,target:u.ready.target,actor:u.ready.actor,root:u.ready.root}:null,crystal:u.crystal,focus:u.focus});
 return {round:b.round,own:b.own.map(unit),enemy:b.enemy.map(unit),ap:b.ap,actions:b.actions,priority:b.priority,initiative:b.initiative,winner:b.winner,roundPending:b.roundPending,turns:b.turns,rootSeq:b.rootSeq,rng:b.rng>>>0,comboRefund:b.comboRefund,link:b.link,linkUntil:b.linkUntil,decks:b.decks.map(d=>({draw:d.draw,hand:d.hand,discard:d.discard,removed:d.removed,cycled:d.cycled})),items:b.items.map(x=>({id:x.disabled?'none':x.id,used:x.used,last:x.last}))};
}
function compare(raw,b,label){
 const got=comparable(decodeBattleState(raw)),expected=comparable(b);
 try{assert.deepEqual(got,expected,label);}catch(e){
  fs.writeFileSync('test/battle-differential-failure.json',JSON.stringify({label,got,expected,raw},(_,v)=>typeof v==='bigint'?v.toString():v,2));throw e;
 }
}
const steps=[];
async function step(raw,b,side,input,label){
 const kind=names.indexOf(input.type),x={kind,actor:input.actor??0,target:input.target??0,ally:input.ally??input.actor??0,hand:input.hand??0};
 let ok;
 if(kind===8){b.acks??=[];if(!b.acks.includes(side))b.acks.push(side);if(b.acks.length===2){ok=E.endRound(b);b.acks=[];}else ok=true;}
 else if(kind===7)ok=E.cycle(b,side,x.hand);
 else if(kind===9){b.winner=1-side;ok=true;}
 else ok=E.action(b,side,x.actor,input.type,x.target,x.ally);
 assert.equal(ok,true,'JS rejected '+label);
 const result=plain(await harness.step.staticCall(raw,side,x,{gasLimit:29500000}));
 compare(result,b,label);steps.push({label,round:b.round,type:input.type});return result;
}
function teamFor(id){const ids=[id];for(const c of catalog.filter(x=>x.cost<=3))if(ids.length<4&&!ids.includes(c.id))ids.push(c.id);return ids;}
const enemy=[3,4,6,21];
try{
 // All 32 characters: normal attack, selected skill, and charged ultimate in controlled states.
 for(let id=1;id<=32;id++)for(const type of ['attack','skill','ultimate']){
  const own=teamFor(id),ids=[...own,...enemy];let raw=plain(await harness.make(ids,[2,2],14326,0));
  let b=E.create(own,enemy,14326,0);b.items=[{id:'medkit',used:0,last:0},{id:'medkit',used:0,last:0}];
  compare(raw,b,'initial '+id);
  if(type!=='attack'){
   raw.decks[0].hand.fill(0);raw.decks[0].hand[0]=type==='skill'?1:2;raw.decks[0].handCount=1;
   b.decks[0].hand=[{id,type}];
  }
  if(type==='ultimate'){raw.round=3;raw.units[0].ultimateCharge=catalog[id-1].ultimate.requiredCasts;b.round=3;b.own[0].ultimateCharge=catalog[id-1].ultimate.requiredCasts;}
  raw.units[0].hp-=20;b.own[0].hp-=20;
  raw.units[1].hp-=20;b.own[1].hp-=20;
  raw=await step(raw,b,0,{type,actor:0,target:0,ally:1},id+' '+type);
 }
 // Several complete deterministic simulations exercise draw/discard recycling, combos and fatigue.
 for(const [run,own]of [[0,[1,3,6,12]],[1,[9,11,19,21]],[2,[14,20,23,27]],[3,[26,16,29,32]]]){
  const foe=teamFor([2,15,28,30][run]);let raw=plain(await harness.make([...own,...foe],[2,2],14326+run,0));
  const b=E.create(own,foe,14326+run,0);b.items=[{id:'medkit',used:0,last:0},{id:'medkit',used:0,last:0}];b.acks=[];compare(raw,b,'duel initial '+run);
  for(let i=0;i<350&&b.winner===null;i++){
   let side=0,input=null;
   for(let s=0;s<2&&!input;s++)if(!b.acks.includes(s)){const actor=E.ready(b,s)[0];if(actor!==undefined){side=s;input={type:'combo',actor,target:0,ally:actor};}}
   if(!input&&b.roundPending){side=b.acks.includes(0)?1:0;input={type:'round'};}
   if(!input){side=b.priority;const a=E.chooseAI(b,side);input={type:a.type,actor:a.i,target:Math.max(0,a.target),ally:Math.max(0,a.ally)};}
   raw=await step(raw,b,side,input,'duel '+run+' step '+i);
  }
  assert.notEqual(b.winner,null,'simulation did not finish');
 }
 const report={passed:true,chainId:config.chainId,harness:addresses.TalosBattleHarness,addresses,sourceArtifacts:hashes,cases:steps.length,allCharacterSkillVariants:96,completeSimulations:4,steps,executedAt:new Date().toISOString(),scope:'eth_call of actual deployed EVM rules library against JS reference; no real match accepts caller-supplied state'};
 fs.writeFileSync('test/battle-differential-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,cases:steps.length,harness:addresses.TalosBattleHarness}));
}finally{provider.destroy();}

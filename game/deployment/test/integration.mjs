import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {Wallet,JsonRpcProvider,Contract,randomBytes,hexlify} from 'ethers';
import {E} from '../lib/game.mjs';
const origin='http://localhost:8787',provider=new JsonRpcProvider('http://127.0.0.1:8545',20260926,{staticNetwork:true});
const cfg=await(await fetch(origin+'/api/config')).json(),report={started:new Date().toISOString(),checks:[],matches:[],transactions:[]};
async function actor(){const wallet=Wallet.createRandom().connect(provider);let cookie='';const call=async(p,data,expected=200)=>{for(let attempt=0;attempt<45;attempt++){const r=await fetch(origin+'/api'+p,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const j=await r.json();if(r.status===429){await new Promise(r=>setTimeout(r,1600));continue;}assert.equal(r.status,expected,JSON.stringify(j));return j;}throw Error('Rate limit retry expired');};const n=await call('/auth/nonce',{address:wallet.address}),signed={id:n.id,signature:await wallet.signMessage(n.message)};await call('/auth/verify',signed);await call('/auth/verify',signed,400);await call('/faucet',{});const contract=new Contract(cfg.contract,cfg.abi,wallet);assert.equal(Number(await contract.credits(wallet.address)),3000);return {wallet,call,contract};}
const a=await actor(),b=await actor();report.checks.push('One-use signed login; real starter mint for two independent wallets');
assert.equal(Object.keys((await a.call('/me')).owned).length,32);
const csrf=await fetch(origin+'/api/equip',{method:'POST',headers:{Origin:'http://evil.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);report.checks.push('Cross-origin mutation rejected');
const team=[1,2,3,6].map(id=>({id,skin:0}));
await a.call('/matches',{mode:'ai',team:team.map(x=>({...x,skin:17})),item:'none'},400);report.checks.push('Unowned cosmetic cannot enter battle');
let wins=new Map([[a,0],[b,0]]),minted=false;
for(let game=0;game<7&&!minted;game++){
 let m=await a.call('/matches',{mode:'pvp',team,item:'none'});const id=m.id;
 assert.ok((await b.call('/rooms')).some(r=>r.id===id),'Waiting PVP room must be discoverable before joining');
 await b.call('/matches/'+id+'/join',{team,item:'none'});
 assert.ok(!(await b.call('/rooms')).some(r=>r.id===id),'Started match must leave the waiting list');
 let calls=0,duplicates=false;
 while(calls++<500){
  const views=await Promise.all([a.call('/matches/'+id),b.call('/matches/'+id)]);if(views[0].finished){m=views[0];break;}
  for(const v of views){assert.equal(v.state.rng,undefined);assert.equal(v.state.decks[1].hand,undefined);assert.ok(v.state.enemy.every(u=>u.shelter===null));}
  let side=views[0].state.own.some(u=>u.ready&&u.frozen!==views[0].state.round&&u.hp>0)?0:views[1].state.own.some(u=>u.ready&&u.frozen!==views[1].state.round&&u.hp>0)?1:-1;
  let input;
  if(side>=0){const v=views[side];input={type:'combo',actor:v.state.own.findIndex(u=>u.ready&&u.frozen!==v.state.round&&u.hp>0),target:0,ally:0};}
  else if(views[0].state.roundPending){side=views[0].acks.includes(0)?1:0;input={type:'round'};}
  else {side=views[0].state.priority===0?0:1;const x=E.chooseAI(views[side].state,0);input={type:x.type,actor:x.i,target:Math.max(0,x.target),ally:Math.max(0,x.ally)};}
  const who=side?b:a,payload={...input,actionId:crypto.randomUUID(),expectedSeq:views[side].seq};
  if(!duplicates&&input.type!=='round'){const [one,two]=await Promise.all([who.call('/matches/'+id+'/action',payload),who.call('/matches/'+id+'/action',payload)]);assert.equal(one.seq,two.seq);duplicates=true;}else await who.call('/matches/'+id+'/action',payload);
 }
 assert.ok(m.finished,'match did not finish');assert.ok(m.state.round>=10&&m.state.round<20);report.matches.push({id,round:m.state.round,winner:m.state.winner,actions:m.reveal.replay.length});
 if(m.state.winner!==2){const winner=m.state.winner===0?a:b,r=await winner.call('/matches/'+id+'/reward');const receipt=await(await winner.contract.claimReward(r.value,r.signature,{gasPrice:0})).wait();report.transactions.push(receipt.hash);wins.set(winner,wins.get(winner)+1);fs.writeFileSync('integration-progress.json',JSON.stringify(report,null,2));console.log('PVP finished',m.state.round,'rounds; rewards',wins.get(a),wins.get(b));
  if(wins.get(winner)>=3){const next=await winner.contract.nextSeedId(),receipt=await(await winner.contract.requestMint(9,next,hexlify(randomBytes(32)),{gasPrice:0})).wait();report.transactions.push(receipt.hash);const event=receipt.logs.map(l=>{try{return winner.contract.interface.parseLog(l);}catch{return null;}}).find(x=>x?.name==='MintRequested'),requestId=Number(event.args.requestId);for(let i=0;i<20;i++){if(Number((await winner.contract.requests(requestId)).state)===2){minted=true;break;}await new Promise(r=>setTimeout(r,1500));}assert.ok(minted,'mint worker did not resolve');report.mintRequest=requestId;const owned=(await winner.call('/me')).owned;assert.ok(Object.keys(owned).some(k=>Math.floor(Number(k)/100)===9));}
 }
}
assert.ok(minted);report.checks.push('PVP rules authoritative; duplicate action idempotency; hidden opponent state; 10–19 round battles; signed victory rewards; commit/reveal mint');
const status=await(await fetch(origin+'/api/health')).json();assert.ok(status.nodes.every(n=>n.ok&&n.peers===2));
const h=Math.min(...status.nodes.map(n=>n.block)),blocks=await Promise.all([8545,8546,8547].map(async port=>{const p=new JsonRpcProvider('http://127.0.0.1:'+port,20260926,{staticNetwork:true});const b=await p.getBlock(h);p.destroy();return b.hash;}));assert.equal(new Set(blocks).size,1);report.chain={height:h,hash:blocks[0],nodes:status.nodes};
report.finished=new Date().toISOString();fs.writeFileSync('integration-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));provider.destroy();

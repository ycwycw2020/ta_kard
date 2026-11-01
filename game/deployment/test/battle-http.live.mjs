import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Contract,VoidSigner,Wallet,randomBytes,hexlify} from 'ethers';
import {createBattleAccess} from '../lib/battle-chain.mjs';
const config=JSON.parse(fs.readFileSync(process.env.TALOS_CONFIG_PATH||'D:/card_endfiled/game/deployment/private/config.json','utf8'));
const deployment=JSON.parse(fs.readFileSync('battle-deployment.json','utf8'));
const live=JSON.parse(fs.readFileSync('test/battle-contract-verification.json','utf8'));
assert.equal(live.passed,true,'Real contract acceptance must finish first');
const report={passed:false,checkedAt:new Date().toISOString(),url:'http://localhost:8787',battleContract:config.battleContract,checks:[]};
const check=text=>report.checks.push(text);
const provider=new JsonRpcProvider(config.rpc,config.chainId,{staticNetwork:true});
try{
 assert.equal(BigInt(await provider.send('eth_chainId',[])),20260926n);check('RPC reports the expected actual chain ID');
 const get=async p=>{const r=await fetch(report.url+p);assert.equal(r.status,200,p);return r;};
 const publicConfig=await(await get('/api/config')).json();
 assert.equal(publicConfig.battleContract,config.battleContract);assert.equal(publicConfig.battleAuthority,'contract');assert.equal(publicConfig.battleVisibility,'public');assert.equal(publicConfig.onchainBattleRulesHash,deployment.rulesHash);check('HTTP exposes the deployed contract ABI, rules hash and public battle mode');
 const health=await(await get('/api/health')).json();assert.equal(health.nodes.length,3);assert.ok(health.nodes.every(x=>x.ok));report.nodes=health.nodes;check('API and all three validator RPC endpoints are online');
 const page=await(await get('/')).text();assert.ok(page.includes('塔卫牌局'));assert.ok(page.includes('/web/app.js'));check('Game page and module entry point load');
 for(const file of ['/web/app.js','/web/battle-protocol.mjs','/web/engine.js','/web/style.css','/web/market.mjs']){const response=await get(file);assert.ok((await response.text()).length>100);}
 check('Updated battle client, common protocol, styles and existing marketplace modules load');
 for(const file of ['/assets/cards/display/c26-s15.webp','/assets/cards/4k/c26-s15.png']){const response=await fetch(report.url+file,{method:'HEAD'});assert.equal(response.status,200,file);assert.ok(response.headers.get('content-type').startsWith('image/'));}
 check('Existing display art and 4K art remain reachable');
 assert.equal((await fetch(report.url+'/private/config.json')).status,404);check('Private deployment configuration is not exposed through HTTP');
 const battle=createBattleAccess({config,provider,runAdmin:()=>{throw Error('Read-only verification must not sign');}});
 const direct=new Contract(config.battleContract,publicConfig.battleAbi,new VoidSigner(live.serviceWallets[0],provider));
 const rejected=async(fn,label)=>{let reverted=false;try{await fn();}catch(e){if(e.code!=='CALL_EXCEPTION')throw e;reverted=true;}assert.equal(reverted,true,label);check(label);};
 await rejected(()=>direct.createMatch.staticCall(hexlify(randomBytes(32)),live.teams[1].tokens,2,false),'Contract rejects using another wallet’s NFTs');
 await rejected(()=>direct.createMatch.staticCall(hexlify(randomBytes(32)),Array(4).fill(live.teams[0].tokens[0]),2,false),'Contract rejects duplicate characters in a team');
 await rejected(()=>direct.createMatch.staticCall(hexlify(randomBytes(32)),live.teams[0].tokens,255,false),'Contract rejects unknown tactical equipment');
 const matchId=live.matches.pvp.id,snapshot=await battle.snapshot(matchId,live.serviceWallets[0]);
 assert.equal(snapshot.authority,'TalosBattle');assert.equal(snapshot.publicState,true);assert.equal(snapshot.stateHash,live.matches.pvp.final.stateHash);assert.equal(snapshot.state.winner,live.matches.pvp.final.winner);
 assert.ok(Array.isArray(snapshot.state.decks[0].hand)&&Array.isArray(snapshot.state.decks[1].hand));assert.ok(Array.isArray(snapshot.state.decks[0].draw)&&Array.isArray(snapshot.state.decks[1].draw));check('Application adapter reconstructs completed public hands, deck order, sequence and winner directly from chain');
 const journal=await battle.journal(matchId,live.serviceWallets[0],0);assert.equal(journal.pageSize,6);assert.equal(journal.entries.length,6);assert.equal(journal.source,'onchain-events');report.journal={total:journal.total,pages:journal.pages,pageSize:journal.pageSize};check('Chain-event battle journal paginates six entries per page');
 if(snapshot.state.winner===0||snapshot.state.winner===1){
  const winner=live.serviceWallets[snapshot.state.winner],value=await battle.reward(matchId,winner);
  const cardsAbi=JSON.parse(fs.readFileSync('D:/card_endfiled/game/deployment/build/TalosCards.json','utf8')).abi;
  const cards=new Contract(config.contract,cardsAbi,new VoidSigner(winner,provider));
  const fields=cards.interface.getFunction('claimReward').inputs[0].components.map(x=>({name:x.name,type:x.type}));
  const signature=await new Wallet(config.wallets.reward.privateKey).signTypedData({name:'TalosCards',version:'1',chainId:config.chainId,verifyingContract:config.contract},{Reward:fields},value);
  await cards.claimReward.staticCall(value,signature);check('Actual on-chain winner is accepted by the old EIP-712 reward contract in a read-only simulation; no quota consumed');
 }
 report.passed=true;report.matchId=matchId;report.stateHash=snapshot.stateHash;report.finishedAt=new Date().toISOString();
}finally{provider.destroy();fs.writeFileSync('test/battle-http-verification.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));

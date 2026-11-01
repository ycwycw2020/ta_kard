import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Pool} from 'pg';
import {getAddress,verifyMessage,Wallet,ZeroAddress,keccak256,toUtf8Bytes,JsonRpcProvider,parseEther} from 'ethers';
import {config,artifact,provider,cards,rewardWallet,rewardDomain,rewardTypes,collection,ownsTeam,mintWorker,ensureTestAccess,runAdmin} from './lib/chain.mjs';
import {catalog,E,hash,itemNames,validTeam,project,projectLogs,rulesVersion,runtimeRulesHash} from './lib/game.mjs';
import {readAvailableArtwork,artworkAvailable} from './lib/artwork.mjs';
import {items,itemsArtifact,inventory,countsOf,marketPage} from './lib/items.mjs';
import {createBattleAccess,isChainMatchId,encodeBattleAction,ITEM_IDS} from './lib/battle-chain.mjs';
import {createBattleFleet} from './lib/battle-fleet.mjs';
const db=new Pool({...config.db,max:10});
const battle=createBattleFleet({config,provider,runAdmin,makeAccess:createBattleAccess});
await db.query(fs.readFileSync('schema.sql','utf8'));
await db.query('INSERT INTO indexer_state(id,block_number) VALUES(1,$1) ON CONFLICT DO NOTHING',[config.deployBlock-1]);
const encode=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const address=x=>getAddress(x).toLowerCase();
const error=(message,status=400)=>Object.assign(new Error(message),{status});
async function transaction(fn){const c=await db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function body(req){let text='';for await(const x of req){text+=x;if(text.length>524288)throw error('请求过大',413);}return text?JSON.parse(text):{};}
function json(res,obj,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(encode(obj));}
async function session(req){const t=/\btalos_session=([a-f0-9]{64})\b/.exec(req.headers.cookie||'')?.[1];if(!t)throw error('请连接钱包登录',401);const r=await db.query('SELECT address FROM sessions WHERE token_hash=$1 AND expires>now()',[hash(t)]);if(!r.rowCount)throw error('登录已过期',401);return r.rows[0].address;}
function validateItem(item){if(!Object.hasOwn(itemNames,item))throw error('未知战术道具');}
function battleTokens(team){if(team.some(x=>!x.tokenId))throw error('请先完成卡牌独立编号登记');return team.map(x=>x.tokenId);}
async function match(c,id,w,lock=false){if(!uuid(id))throw error('对局编号无效');const r=await c.query('SELECT * FROM matches WHERE id=$1'+(lock?' FOR UPDATE':''),[id]);if(!r.rowCount)throw error('对局不存在',404);if(r.rows[0].a!==w&&r.rows[0].b!==w)throw error('无参战权限',403);return r.rows[0];}
async function health(){
 const nodes=await Promise.all(config.nodeRPCs.map(async(url,i)=>{try{const p=new JsonRpcProvider(url,config.chainId,{staticNetwork:true});const [n,peers]=await Promise.all([p.send('eth_blockNumber',[]),p.send('net_peerCount',[])]);p.destroy();return {node:i+1,block:parseInt(n,16),peers:parseInt(peers,16),ok:true};}catch{return {node:i+1,ok:false};}}));
 const ix=(await db.query('SELECT * FROM indexer_state WHERE id=1')).rows[0];return {chainId:config.chainId,nodes,database:'Windows / D:\\card_endfiled\\database',indexer:ix,contract:config.contract};
}
const readRPC=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_sendRawTransaction','eth_getLogs','net_version']);
const rates=new Map();function rate(key,max=180){const now=Math.floor(Date.now()/60000);let r=rates.get(key);if(!r||r.n!==now){r={n:now,c:0};rates.set(key,r);}if(++r.c>max)throw error('请求过于频繁，请稍后重试',429);if(rates.size>2000)for(const [k,v] of rates)if(v.n<now)rates.delete(k);}
const server=http.createServer(async(req,res)=>{
 try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(!['localhost:8787','127.0.0.1:8787'].includes(req.headers.host))throw error('Host 不匹配',403);
  const url=new URL(req.url,config.origin),p=url.pathname;
  const internal=p.startsWith('/api/internal/');
  if(internal){if(req.headers.authorization!=='Bearer '+config.indexerToken)throw error('无索引权限',403);}
  else if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin!==config.origin)throw error('Origin 不匹配',403);
   if(p==='/api/config')return json(res,{releaseVersion:'1.0.0',walletResetId:config.walletResetId||null,chainId:config.chainId,contract:config.contract,abi:artifact.abi,itemsContract:config.itemsContract||null,itemsAbi:itemsArtifact?.abi||null,battleContract:battle.address||null,battleContracts:battle.addresses,battleModes:battle.modes,battleAbi:battle.abi,battleDeploymentBlock:config.battleDeploymentBlock||null,battleProtocolVersion:'onchain-v1',battleVisibility:'public',battleAuthority:'contract',rewardMode:'legacy-signature-from-onchain-outcome',onchainBattleRulesHash:battle.enabled?await battle.contract.rulesHash():null,cardIdentity:'chainId + itemsContract + tokenId',marketCurrency:'TEST ETH',battleRulesHash:config.battleRulesHash,runtimeRulesHash,runtimeRulesHashAlgorithm:'sha256',rulesVersion,teamCostCap:E.config.teamCostCap,tacticalPoints:{initial:E.config.initialAP,cap:E.config.apCap,perRound:E.config.apRegen},origin:config.origin,catalog,availableArtwork:readAvailableArtwork(),items:itemNames,itemMode:'equipment',testMintAllowance:1000,gameTitle:'塔卫牌局',aiActionDelay:{minSubmitDelayMs:600,maxSubmitDelayMs:1200,confirmation:'QBFT inclusion; actual interval depends on consensus'},cosmeticProbabilities:{normal:88,fine:10,exquisite:2},deployBlock:config.deployBlock});
  if(p.startsWith('/api/item-metadata/')){
   const tokenId=p.slice('/api/item-metadata/'.length);if(!items||!/^[1-9][0-9]{0,77}$/.test(tokenId)||BigInt(tokenId)>=2n**256n)throw error('卡牌编号无效',404);
   await items.ownerOf(tokenId);const artId=Number(await items.artworkOf(tokenId)),id=Math.floor(artId/100),skin=artId%100-1,card=catalog.find(c=>c.id===id),tier=skin>=15?'exquisite':skin>=10?'fine':'normal';
   return json(res,{name:`${card.name} · ${tokenId.padStart(16,'0')}`,description:'Individually numbered Talos fan-game card on a private test chain. Cosmetic rarity has no combat advantage.',image:config.origin+(artworkAvailable(artId)?`/assets/cards/4k/c${String(id).padStart(2,'0')}-s${String(skin).padStart(2,'0')}.png`:'/web/pending.svg'),external_url:config.origin,attributes:[{trait_type:'serial',value:tokenId},{trait_type:'artworkId',value:artId},{trait_type:'characterId',value:id},{trait_type:'skinIndex',value:skin},{trait_type:'tier',value:tier}],chainId:config.chainId,contract:config.itemsContract});
  }
  if(p.startsWith('/api/metadata/')){
   const key=p.slice('/api/metadata/'.length);if(!/^[a-fA-F0-9]{64}$/.test(key))throw error('ERC-1155 metadata id must be 64 hex digits');const tokenId=Number(BigInt('0x'+key)),id=Math.floor(tokenId/100),skin=tokenId%100-1;if(id<1||id>32||skin<0||skin>17)throw error('Unknown token',404);
   const card=catalog.find(c=>c.id===id),available=artworkAvailable(tokenId),tier=skin>=15?'exquisite':skin>=10?'fine':'normal';
   return json(res,{name:card.name+' · '+tier+' '+skin,description:'Talos private-chain test card. Cosmetic rarity does not affect combat stats.',image:config.origin+(available?`/assets/cards/4k/c${String(id).padStart(2,'0')}-s${String(skin).padStart(2,'0')}.png`:'/web/pending.svg'),attributes:[{trait_type:'characterId',value:id},{trait_type:'skinIndex',value:skin},{trait_type:'tier',value:tier},{trait_type:'artStatus',value:available?'available':'pending-artwork'},{trait_type:'HP',value:card.hp},{trait_type:'ATK',value:card.atk}],battleRulesHash:config.battleRulesHash});
  }
  if(p==='/api/health')return json(res,await health());
  if(p==='/api/auth/nonce'&&req.method==='POST'){
   rate('nonce',60);const d=await body(req),w=address(d.address),id=crypto.randomBytes(16).toString('hex'),issued=new Date(),expires=new Date(+issued+5*60000);
   const message=`localhost:8787 wants you to sign in with your Ethereum account:\n${getAddress(w)}\n\nSign in to Talos local test game. No real ETH.\n\nURI: ${config.origin}\nVersion: 1\nChain ID: ${config.chainId}\nNonce: ${id}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`;
   await db.query('INSERT INTO nonces VALUES($1,$2,$3,$4)',[id,w,message,expires]);return json(res,{id,message});
  }
  if(p==='/api/auth/verify'&&req.method==='POST'){
   rate('verify',90);const d=await body(req),r=await db.query('DELETE FROM nonces WHERE id=$1 AND expires>now() RETURNING *',[d.id]);if(!r.rowCount)throw error('登录签名请求已使用或过期');const n=r.rows[0];if(address(verifyMessage(n.message,d.signature))!==n.address)throw error('钱包签名不匹配');
   await db.query('INSERT INTO profiles(address) VALUES($1) ON CONFLICT DO NOTHING',[n.address]);const token=crypto.randomBytes(32).toString('hex');await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '12 hours')",[hash(token),n.address]);return json(res,{address:n.address},200,{'Set-Cookie':`talos_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
  }
  if(p==='/api/auth/logout'&&req.method==='POST'){const t=/\btalos_session=([a-f0-9]{64})\b/.exec(req.headers.cookie||'')?.[1];if(t)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(t)]);return json(res,{ok:true},200,{'Set-Cookie':'talos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
  if(p==='/rpc'&&req.method==='POST'){
   const w=await session(req);rate(w+':rpc',360);const d=await body(req);
   const one=async q=>{if(!readRPC.has(q.method))return {jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'RPC method disabled'}};try{return {jsonrpc:'2.0',id:q.id,result:await provider.send(q.method,q.params||[])};}catch(e){return {jsonrpc:'2.0',id:q.id,error:{code:-32000,message:e.shortMessage||e.message}};}};
   if(Array.isArray(d)&&d.length>50)throw error('RPC batch too large');return json(res,Array.isArray(d)?await Promise.all(d.map(one)):await one(d));
  }
  if(p==='/api/internal/cursor')return json(res,(await db.query('SELECT * FROM indexer_state WHERE id=1')).rows[0]);
  if(p==='/api/internal/index'&&req.method==='POST'){
   const d=await body(req);if(!Number.isInteger(d.from)||!Number.isInteger(d.to)||d.to<d.from||d.to-d.from>100||!Array.isArray(d.logs))throw error('Invalid index range');
   const block=await provider.getBlock(d.to);if(!block||block.hash!==d.blockHash)throw error('Indexer block mismatch');
   await transaction(async c=>{const s=(await c.query('SELECT * FROM indexer_state WHERE id=1 FOR UPDATE')).rows[0];if(d.from!==s.block_number+1)throw error('Refresh cursor',409);
    for(const l of d.logs){
     const origin=l.address.toLowerCase(),isItem=!!items&&origin===config.itemsContract.toLowerCase();
     if(!isItem&&origin!==config.contract.toLowerCase())throw error('Foreign contract');
     const parsed=(isItem?items:cards).interface.parseLog(l);if(!parsed)continue;
     const args=Object.fromEntries(parsed.fragment.inputs.map((x,i)=>[x.name,parsed.args[i]])),n=parseInt(l.blockNumber,16);if(n<d.from||n>d.to)throw error('Block range');
     const r=await c.query('INSERT INTO chain_events(tx_hash,log_index,block_number,block_hash,event_name,args,contract_address) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING tx_hash',[l.transactionHash,parseInt(l.logIndex,16),n,l.blockHash,parsed.name,encode(args),origin]);if(!r.rowCount)continue;
     if(isItem){
      if(parsed.name==='Transfer')await c.query('INSERT INTO card_instances(token_id,owner,updated_block,transaction_hash) VALUES($1,$2,$3,$4) ON CONFLICT(token_id) DO UPDATE SET owner=EXCLUDED.owner,updated_block=EXCLUDED.updated_block,transaction_hash=EXCLUDED.transaction_hash',[args.tokenId.toString(),args.to.toLowerCase(),n,l.transactionHash]);
      if(parsed.name==='CardMaterialized')await c.query('UPDATE card_instances SET artwork_id=$2 WHERE token_id=$1',[args.tokenId.toString(),Number(args.artworkId)]);
     }else if(parsed.name==='TransferSingle'||parsed.name==='TransferBatch'){
      const ids=parsed.name==='TransferSingle'?[args.id]:args.ids,values=parsed.name==='TransferSingle'?[args.value]:args.values;
      for(let i=0;i<ids.length;i++)for(const [owner,sign]of [[args.from,-1],[args.to,1]])if(owner.toLowerCase()!==ZeroAddress)await c.query('INSERT INTO card_balances VALUES($1,$2,$3) ON CONFLICT(address,token_id) DO UPDATE SET balance=card_balances.balance+EXCLUDED.balance',[owner.toLowerCase(),Number(ids[i]),sign*Number(values[i])]);
     }
    }
    await c.query('UPDATE indexer_state SET block_number=$1,block_hash=$2,updated=now() WHERE id=1',[d.to,d.blockHash]);
   });return json(res,{ok:true});
  }
  if(p.startsWith('/api/')){
   const w=await session(req);rate(w);
    if(p==='/api/me') {const profile=(await db.query('SELECT * FROM profiles WHERE address=$1',[w])).rows[0],active=await battle.active(w),ownedItems=items?await inventory(w):[];return json(res,{address:w,...profile,owned:items?countsOf(ownedItems):await collection(w),items:ownedItems,credits:Number(await cards.credits(w)),starterClaimed:await cards.starterClaimed(w),active});}
   if(p==='/api/market'&&req.method==='GET')return json(res,await marketPage(w,Number(url.searchParams.get('offset')||0)));
   if(p==='/api/card-transactions'&&req.method==='GET')return json(res,(await db.query("SELECT tx_hash,block_number,event_name,args FROM chain_events WHERE contract_address=$1 AND event_name IN ('Transfer','CardListed','ListingCancelled','CardSold','ProceedsWithdrawn') AND (lower(args->>'from')=$2 OR lower(args->>'to')=$2 OR lower(args->>'owner')=$2 OR lower(args->>'seller')=$2 OR lower(args->>'buyer')=$2) ORDER BY block_number DESC,log_index DESC LIMIT 60",[(config.itemsContract||'').toLowerCase(),w])).rows);
   if(p==='/api/loadout'&&req.method==='POST'){
    const d=await body(req),selectedBattle=battle.forMode(d.battleMode||'current20'),team=validTeam(d.team,selectedBattle.teamCostCap);validateItem(d.item);await ownsTeam(w,team);
    const equipped=Object.fromEntries(team.map(x=>[String(x.id),x.skin])),tokens=Object.fromEntries(team.filter(x=>x.tokenId).map(x=>[String(x.id),x.tokenId])),loadout={team:team.map(x=>x.id),item:d.item,battleMode:selectedBattle.mode.id};
    await db.query('UPDATE profiles SET loadout=$2,equipped=equipped || $3::jsonb,equipped_tokens=equipped_tokens || $4::jsonb WHERE address=$1',[w,encode(loadout),encode(equipped),encode(tokens)]);
    return json(res,{ok:true,loadout});
   }
   if(p==='/api/equip'&&req.method==='POST'){
    const d=await body(req);if(!Number.isInteger(d.tokenId))throw error('款式编号无效');const id=Math.floor(d.tokenId/100),skin=d.tokenId%100-1;
    if(id<1||id>32||skin<0||skin>17)throw error('未持有该卡面');
    let instanceId=null;
    if(items){const all=await inventory(w),chosen=all.find(x=>x.artworkId===d.tokenId&&(!d.instanceId||x.tokenId===String(d.instanceId)));if(!chosen)throw error('未持有该编号卡牌');instanceId=chosen.tokenId;}
    else if(await cards.balanceOf(w,d.tokenId)===0n)throw error('未持有该卡面');
    await db.query('UPDATE profiles SET equipped=jsonb_set(equipped,ARRAY[$2],to_jsonb($3::int)),equipped_tokens=equipped_tokens || $4::jsonb WHERE address=$1',[w,String(id),skin,encode(instanceId?{[id]:instanceId}:{})]);return json(res,{ok:true,instanceId});
   }
   if(p==='/api/faucet'&&req.method==='POST'){
    await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(88412)');const r=await c.query('UPDATE profiles SET faucet_used=true WHERE address=$1 AND faucet_used=false RETURNING address',[w]);if(!r.rowCount)return;const f=new Wallet(config.wallets.faucet.privateKey,provider);await(await f.sendTransaction({to:w,value:parseEther('10'),gasPrice:0})).wait();});await ensureTestAccess(w);return json(res,{ok:true});
   }
    if(p==='/api/rooms')return json(res,battle.enabled?await battle.rooms():[]);
    if(p==='/api/history'){const legacy=(await db.query('SELECT id,mode,finished,state->\'winner\' AS winner,a,b FROM matches WHERE (a=$1 OR b=$1) AND finished IS NOT NULL ORDER BY finished DESC LIMIT 30',[w])).rows.map(m=>({...m,finished:m.finished?Math.floor(new Date(m.finished).getTime()/1000):null,battleVersion:'legacy',legacyReadOnly:true}));const current=battle.enabled?await battle.history(w):[];return json(res,[...current,...legacy].sort((a,b)=>Number(b.finished)-Number(a.finished)).slice(0,30));}
   if(p==='/api/mint-requests') {const n=Number(await cards.requestCount()),list=[];for(let id=Math.max(1,n-300);id<=n;id++){const r=await cards.requests(id);if(r.player.toLowerCase()===w)list.push({id,characterId:Number(r.characterId),state:Number(r.state),seedId:Number(r.seedId),deadlineBlock:Number(r.deadlineBlock)});}return json(res,list);}
    // REST mutation routes only prepare wallet calls; no server battle adjudication.
    if(p==='/api/matches'&&req.method==='POST'){
     if(!battle.enabled)throw error('链上战斗合约尚未配置',503);
     const d=await body(req),selectedBattle=battle.forMode(d.battleMode||'current20'),team=validTeam(d.team,selectedBattle.teamCostCap);if(await battle.active(w))throw error('已有进行中的对局，请先完成或取消。',409);if(!['ai','pvp'].includes(d.mode))throw error('模式无效');validateItem(d.item);await ownsTeam(w,team);
     const id=d.id||'0x'+crypto.randomBytes(32).toString('hex');if(!isChainMatchId(id))throw error('链上对局编号无效');
     return json(res,{execution:'wallet',contract:selectedBattle.address,battleMode:selectedBattle.mode.id,teamCostCap:selectedBattle.teamCostCap,method:'createMatch',id,args:[id,battleTokens(team),ITEM_IDS[d.item],d.mode==='ai']});
    }
   const parts=p.split('/'),id=parts[3],operation=parts[4];
    if(parts[2]==='matches'&&isChainMatchId(id)){
     if(!battle.enabled)throw error('链上战斗合约尚未配置',503);
     const targetBattle=await battle.resolve(id);
     if(operation==='logs'&&req.method==='GET')return json(res,await targetBattle.journal(id,w,Number(url.searchParams.get('page')||0)));
     if(operation==='join'&&req.method==='POST'){const d=await body(req),team=validTeam(d.team,targetBattle.teamCostCap);validateItem(d.item);await ownsTeam(w,team);return json(res,{execution:'wallet',contract:targetBattle.address,method:'joinMatch',id,args:[id,battleTokens(team),ITEM_IDS[d.item]]});}
     if(operation==='action'&&req.method==='POST'){const d=await body(req);await targetBattle.snapshot(id,w,{withLogs:false});return json(res,{execution:'wallet',contract:targetBattle.address,method:'act',id,args:[id,...encodeBattleAction(d)]});}
     if(operation==='cancel'&&req.method==='POST'){const m=await targetBattle.load(id);if(m.info.playerA.toLowerCase()!==w||m.info.started)throw error('房间不能取消');return json(res,{execution:'wallet',contract:targetBattle.address,method:'cancelMatch',id,args:[id]});}
     if(operation==='reward'&&req.method==='GET'){const value=await targetBattle.reward(id,w);return json(res,{value,signature:await rewardWallet.signTypedData(rewardDomain,rewardTypes,value),source:'onchain-outcome-legacy-reward-signature',battleContract:targetBattle.address});}
     if(!operation&&req.method==='GET')return json(res,await targetBattle.snapshot(id,w));
     throw error('链上对局接口不存在',404);
    }
   if(parts[2]==='matches'&&uuid(id)){
    if(operation==='logs'&&req.method==='GET')return json(res,projectLogs(await match(db,id,w),w,Number(url.searchParams.get('page')||0)));
     if(!operation&&req.method==='GET')return json(res,{...project(await match(db,id,w),w),battleVersion:'legacy',legacyReadOnly:true});
     throw error('旧版本对局仅供查阅，请创建钱包签名的链上对局。',409);
   }
   throw error('接口不存在',404);
  }
  // Explicit public roots only: private keys, source, runtime and database are never served.
  const roots=[['/assets/',path.resolve('../assets')],['/web/',path.resolve('web')]];
  let file=p==='/'?path.resolve('web/index.html'):null;
  if(p==='/catalog.json')file=path.resolve('catalog.json');
  for(const [prefix,base] of roots)if(p.startsWith(prefix)){const candidate=path.resolve(base,decodeURIComponent(p.slice(prefix.length)));if(!candidate.startsWith(base+path.sep))throw error('路径无效',403);file=candidate;}
  if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile())throw error('文件不存在',404);
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':p.startsWith('/assets/')?'public,max-age=3600':'no-cache'});fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)json(res,{error:e.status?e.message:(e.shortMessage||e.message).slice(0,300)},e.status||400);else res.end();}
});
// AI only proposes signed actAI transactions. The contract calculates every result.
setInterval(()=>battle.tickAI().catch(e=>console.error('On-chain AI:',e.shortMessage||e.message)),500).unref();
server.listen(8787,'127.0.0.1',()=>console.log('Talos test game http://localhost:8787 — PostgreSQL on Windows'));
mintWorker();setInterval(mintWorker,5000).unref();
setInterval(()=>db.query('DELETE FROM nonces WHERE expires<now(); DELETE FROM sessions WHERE expires<now()').catch(console.error),60000).unref();
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(async()=>{provider.destroy();await db.end();process.exit(0);}));

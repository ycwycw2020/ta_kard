import fs from 'node:fs';
import crypto from 'node:crypto';
import {Contract,Interface,AbiCoder,keccak256,toUtf8Bytes,ZeroAddress} from 'ethers';
import {E} from './game.mjs';
import {ACTION_KINDS,ITEM_IDS,isChainMatchId,encodeBattleAction} from '../web/battle-protocol.mjs';
export {ACTION_KINDS,ITEM_IDS,isChainMatchId,encodeBattleAction};
export const BATTLE_EVENTS=[
 'event BattleAction(bytes32 indexed matchId,uint32 indexed seq,uint8 side,uint8 kind,uint8 actor,uint8 target,uint8 ally,uint8 hand)',
 'event BattleDamage(bytes32 indexed matchId,uint32 indexed seq,uint8 round,uint8 side,uint8 actor,uint8 target,uint8 action,uint8 element,uint16 baseDamage,uint16 bonusDamage,bool barrierBlocked,uint8 shieldAbsorbed,uint8 hpBefore,uint8 finalDamage)',
 'event BattleEffect(bytes32 indexed matchId,uint32 indexed seq,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail)'
];
const ruleEvents=new Interface(BATTLE_EVENTS),ITEM_NAMES=Object.keys(ITEM_IDS),ACTIONS=Object.keys(ACTION_KINDS);
const ACTION_LABELS=['普通攻击','战技','终结技','防御','战术装备','让过行动','连携技','调换手牌','确认结束本轮','投降','燃烧持续伤害','战场压力'];
const ELEMENTS=['物理','灼热','寒冷','电磁','自然'];
const number=(v,fallback=0)=>v===undefined||v===null?fallback:Number(v);
const lower=x=>String(x||ZeroAddress).toLowerCase();
const present=(tuple,name,index)=>tuple?.[name]??tuple?.[index];
const array=x=>Array.from(x||[]);
function card(code,units,side){
 const c=number(code);if(c<1||c>8)throw Error('链上手牌编码无效');
 return {id:units[side*4+Math.floor((c-1)/2)].id,type:c%2===0?'ultimate':'skill'};
}
export function decodeBattleState(raw,tokenIds=[],artworkIds=[]){
 const units=array(raw.units).map((u,index)=>{
  const ready=u.ready?.active?{targetSide:Math.floor(number(u.ready.target)/4),target:number(u.ready.target)%4,actor:number(u.ready.actor),side:number(u.ready.side),root:number(u.ready.root)}:null;
  const art=number(artworkIds[index]);
  return {id:number(u.id)||Math.floor(art/100),hp:number(u.hp),shield:number(u.shield),acted:!!u.acted,comboTriggered:!!u.comboTriggered,combo:!!u.combo,ult:!!u.ult,ultimateCharge:number(u.ultimateCharge),frozen:number(u.frozen),burn:number(u.burn),burnSource:{side:number(u.burnSide),actor:number(u.burnActor)},electric:!!u.electric,electricUntil:number(u.electricUntil),vulnerable:!!u.vulnerable,vulnerableUntil:number(u.vulnerableUntil),barrier:u.barrier?1:0,barrierUntil:number(u.barrierUntil),crossedHalf:!!u.crossedHalf,crystal:number(u.crystalCharges)>0?{charges:number(u.crystalCharges),until:number(u.crystalUntil)}:null,focus:number(u.focusUntil)>0?{side:Math.floor(number(u.focusTarget)/4),target:number(u.focusTarget)%4,until:number(u.focusUntil)}:null,vocalist:number(u.vocalist),ready,refundRound:0,skinIndex:art?art%100-1:0,...(BigInt(tokenIds[index]||0)>0n?{tokenId:String(tokenIds[index])}:{})};
 });
 if(units.length!==8)throw Error('链上战斗单位数量无效');
 for(const u of units)if(u.burnSource.side<2&&u.burnSource.actor<4)u.burnSource.sourceId=units[u.burnSource.side*4+u.burnSource.actor].id;
 const decks=array(raw.decks).map((d,side)=>({draw:array(d.draw).slice(0,number(d.drawCount)).map(c=>card(c,units,side)),hand:array(d.hand).slice(0,number(d.handCount)).map(c=>card(c,units,side)),discard:array(d.discard).slice(0,number(d.discardCount)).map(c=>card(c,units,side)),removed:array(d.removed).slice(0,number(d.removedCount)).map(c=>card(c,units,side)),cycled:!!d.cycled,handCount:number(d.handCount),drawCount:number(d.drawCount),discardCount:number(d.discardCount)}));
 const winner=number(raw.winner);
 return {round:number(raw.round,1),own:units.slice(0,4),enemy:units.slice(4),ap:array(raw.ap).map(Number),actions:array(raw.actions).map(Number),items:array(raw.items).map((id,s)=>({id:number(id)===0?'resource_cell':ITEM_NAMES[number(id)],used:number(id)===0?1:number(raw.used?.[s]),last:number(raw.last?.[s]),disabled:number(id)===0})),priority:number(raw.priority)===2?-1:number(raw.priority),initiative:number(raw.initiative),winner:winner===0?null:winner===3?2:winner-1,roundPending:!!raw.roundPending,acks:array(raw.acks).map(Boolean),seq:number(raw.seq),rng:number(raw.rng),rootSeq:number(raw.root),turns:number(raw.turns),comboRefund:array(raw.comboRefund).map(Number),link:array(raw.link).map(Number),linkUntil:array(raw.linkUntil).map(Number),decks,ledger:{},log:[],audit:[],auditSeq:0,rulesVersion:'onchain-v1',runtimeRulesHash:null};
}
export function selectAIAction(state){
 if(state.winner!==null||state.acks[1])return null;
 const actor=state.enemy.findIndex(u=>u.ready&&u.hp>0&&u.frozen!==state.round);
 if(actor>=0)return {type:'combo',actor,target:0,ally:actor,hand:0};
 if(state.roundPending)return state.acks[1]?null:{type:'round',actor:0,target:0,ally:0,hand:0};
 if(state.priority!==1)return null;
 const deck=state.decks[1];
 if(state.actions[1]===3&&!deck.cycled){const hand=deck.hand.findIndex(x=>!state.enemy.some(u=>u.id===x.id&&u.hp>0));if(hand>=0)return {type:'cycle',actor:0,target:0,ally:0,hand};}
 const picked=E.chooseAI(state,1);
 return {type:picked.type,actor:picked.i,target:Math.max(0,picked.target??0),ally:Math.max(0,picked.ally??picked.i??0),hand:0};
}
export function projectPublicBattle(state,side){
 const b=structuredClone(state);
 const order=side?[1,0]:[0,1];
 const remap=s=>s===0||s===1?s===side?0:1:s;
 for(const u of [...b.own,...b.enemy]){
  if(u.ready){u.ready.targetSide=remap(u.ready.targetSide);u.ready.side=remap(u.ready.side);}
  if(u.focus)u.focus.side=remap(u.focus.side);
  if(u.burnSource)u.burnSource.side=remap(u.burnSource.side);
 }
 const teams=[b.own,b.enemy];b.own=teams[side];b.enemy=teams[1-side];
 for(const key of ['ap','actions','items','decks','comboRefund','link','linkUntil','acks'])b[key]=order.map(s=>b[key][s]);
 b.priority=remap(b.priority);b.initiative=remap(b.initiative);b.winner=b.winner===null||b.winner===2?b.winner:remap(b.winner);
 return b;
}
export function battleLogRows(logs,state,interfaces=[]){
 let round=1;const records=[];
 const unit=(side,slot)=>side<2&&slot<4?[...state.own,...state.enemy][side*4+slot]:null;
 const parsedLogs=logs.map(log=>{
  for(const iface of [...interfaces,ruleEvents])try{const p=iface.parseLog(log);if(p)return {log,p};}catch{}
  return null;
 }).filter(Boolean);
 const libraryActions=new Set(parsedLogs.filter(x=>x.p.name==='BattleAction').map(x=>x.log.transactionHash));
 for(const {log,p} of parsedLogs){
  const a=p.args,seq=number(a.seq),side=number(a.side,2),actor=number(a.actor??a.unitIndex,255),targetGlobal=number(a.target,255),targetSide=targetGlobal<8?Math.floor(targetGlobal/4):null,target=targetGlobal<8?targetGlobal%4:null;
  const common={id:number(log.blockNumber)*100000+number(log.index??log.logIndex),round,seq,transactionHash:log.transactionHash,blockNumber:number(log.blockNumber),side:side<2?side:null,actor:actor<4?actor:null,sourceId:unit(side,actor)?.id,targetSide,target,targetId:targetSide!==null?unit(targetSide,target)?.id:undefined};
  if(p.name==='BattleDamage'){
   round=number(a.round,round);const kind=number(a.action),base=number(a.baseDamage),bonus=number(a.bonusDamage),shield=number(a.shieldAbsorbed),before=number(a.hpBefore),finalDamage=number(a.finalDamage),blocked=!!a.barrierBlocked;
   const afterBarrier=blocked?0:base+bonus,afterShield=Math.max(0,afterBarrier-shield);
   records.push({...common,round,kind:'damage',action:ACTIONS[kind]||(['burn','fatigue'][kind-10])||'attack',actionName:ACTION_LABELS[kind]||'伤害',element:ELEMENTS[number(a.element)]||'物理',baseDamage:base,bonuses:bonus,barrierBlocked:blocked,shieldAbsorbed:shield,hpBefore:before,finalDamage,formula:'基础'+base+' + 加成'+bonus+' = '+(base+bonus)+'；次数屏障'+(blocked?'抵挡':'未触发')+'；数值护盾吸收'+shield+'；最终生命伤害 min('+before+', '+afterShield+') = '+finalDamage});
  }else if(p.name==='BattleEffect'){
   const kind=number(a.kind),before=number(a.beforeValue),after=number(a.afterValue);
   const labels={1:'生命',2:'护盾',3:'状态',4:'终结充能',5:'战术点',6:'连携就绪',7:'回合',8:'战局结果'};
   if(kind===7)round=after||round;
   records.push({...common,round,kind:({1:'heal',2:'shield',3:'status',4:'charge',5:'resource',6:'status',7:'round',8:'outcome'})[kind]||'note',text:(labels[kind]||'状态')+' '+before+' → '+after,amount:after-before});
  }else if(p.name==='BattleAction'||p.name==='ActionAccepted'&&!libraryActions.has(log.transactionHash)){
   const kind=number(a.kind);records.push({...common,actor:[4,5,7,8,9].includes(kind)?null:common.actor,targetSide:null,target:null,targetId:undefined,kind:'action',action:ACTIONS[kind],actionName:ACTION_LABELS[kind],text:'链上确认行动 #'+seq});
  }else if(['MatchCreated','MatchJoined','MatchFinished','MatchCancelled'].includes(p.name))records.push({...common,kind:'note',text:({MatchCreated:'链上房间已创建',MatchJoined:'双方入席，链上对局开始',MatchFinished:'链上对局结束',MatchCancelled:'链上房间已取消'})[p.name]});
 }
 return records;
}
export function createBattleAccess({config,provider,runAdmin,contract:providedContract,abi:providedAbi}){
 const address=config.battleContract,enabled=!!address&&lower(address)!==lower(ZeroAddress);
 const artifact=enabled?(providedAbi?{abi:providedAbi}:JSON.parse(fs.readFileSync('build/TalosBattle.json','utf8'))):null;
 const contract=enabled?(providedContract||new Contract(address,artifact.abi,provider)):null;
 const aiDue=new Map(),logCache=new Map();let aiRunning=false;
 const libraryArtifact='build/TalosBattleEngine.json';
 const libraryInterface=enabled&&fs.existsSync(libraryArtifact)?new Interface(JSON.parse(fs.readFileSync(libraryArtifact,'utf8')).abi.filter(x=>x.type==='event')):null;
 const eventInterfaces=enabled?[contract.interface,libraryInterface,ruleEvents].filter(Boolean):[];
 const requireEnabled=()=>{if(!enabled)throw Error('链上战斗合约尚未配置');};
 const getBlock=async()=>number(BigInt(await provider.send('eth_blockNumber',[])));
 async function load(id,blockTag){
  requireEnabled();if(!isChainMatchId(id))throw Error('链上对局编号无效');
  blockTag??=await getBlock();const result=await contract.getMatch(id,{blockTag});
  const info=present(result,'info',0);if(!info?.exists)throw Error('链上对局不存在');
  const raw=present(result,'state',1),tokens=array(present(result,'tokenIds',2)),arts=array(present(result,'artworkIds',3));
  return {id,info,state:decodeBattleState(raw,tokens,arts),raw,tokens,arts,blockNumber:blockTag};
 }
 async function logsFor(id,to){
  const cached=logCache.get(id)||{to:number(config.battleDeploymentBlock)-1,logs:[]};
  for(let from=Math.max(0,cached.to+1);from<=to;from+=500){
   const end=Math.min(to,from+499);
   const logs=await provider.getLogs({address,topics:[null,id],fromBlock:from,toBlock:end});
   cached.logs.push(...logs);
  }
  cached.to=to;logCache.set(id,cached);if(logCache.size>200)logCache.delete(logCache.keys().next().value);
  return cached.logs;
 }
 function aiAction(m){return m.info.ai&&m.info.started&&!m.info.cancelled&&!number(m.info.finishedAt)?selectAIAction(m.state):null;}
 function due(m){
  if(!aiAction(m)){aiDue.delete(m.id);return null;}
  const saved=aiDue.get(m.id);if(saved?.seq===m.state.seq)return saved.at;
  // Submit shortly after confirmation; consensus adds the remaining visible interval.
  const at=Date.now()+crypto.randomInt(600,1201);aiDue.set(m.id,{seq:m.state.seq,at});return at;
 }
 function participant(m,w){const address=lower(w),side=lower(m.info.playerA)===address?0:!m.info.ai&&lower(m.info.playerB)===address?1:-1;if(side<0)throw Error('不是本场参战者');return side;}
 async function snapshot(id,w,{withLogs=true}={}){
  const m=await load(id),side=participant(m,w),logs=withLogs?await logsFor(id,m.blockNumber):[],events=battleLogRows(logs,m.state,eventInterfaces);
  const remap=e=>{const x={...e};for(const k of ['side','targetSide'])if(x[k]===0||x[k]===1)x[k]=x[k]===side?0:1;return x;};
  const relativeEvents=events.map(remap),b=projectPublicBattle(m.state,side);b.log=relativeEvents.slice(-12).reverse().map(e=>e.formula||e.text||e.actionName);b.audit=relativeEvents;b.auditSeq=relativeEvents.at(-1)?.id||0;
  const stateHash=typeof contract.stateHash==='function'?await contract.stateHash(id,{blockTag:m.blockNumber}):null;
  const replay=logs.flatMap(l=>{try{const p=contract.interface.parseLog(l);if(p?.name!=='ActionAccepted')return [];const a=p.args;return [{seq:number(a.seq),player:a.actor,input:{type:ACTIONS[number(a.kind)],actor:number(a.unitIndex),target:number(a.target),ally:number(a.ally),hand:number(a.hand)},stateHash:a.stateHash,transactionHash:l.transactionHash,blockNumber:number(l.blockNumber)}];}catch{return [];}});
  const team=(s)=>m.state[s===0?'own':'enemy'].map(u=>({id:u.id,skin:u.skinIndex,...(u.tokenId?{tokenId:u.tokenId}:{})}));
  return {id,chainMatchId:id,battleVersion:'onchain-v1',authority:'TalosBattle',publicState:true,mode:m.info.ai?'ai':'pvp',seq:m.state.seq,commitment:null,rosterHash:keccak256(AbiCoder.defaultAbiCoder().encode(['uint256[8]','uint16[8]','uint8[2]'],[m.tokens,m.arts,array(m.raw.items)])),waiting:!m.info.started,finished:number(m.info.finishedAt)||null,cancelled:!!m.info.cancelled,side,opponent:m.info.ai?null:lower(side?m.info.playerA:m.info.playerB),team:team(side),acks:m.state.acks.flatMap((v,i)=>v?[i]:[]),aiPending:!!aiAction(m),aiNextActionAt:due(m),rulesVersion:'onchain-v1',runtimeRulesHash:m.info.rulesHash,stateHash,blockNumber:m.blockNumber,battleContract:address,state:m.info.started?b:null,events:relativeEvents.slice(-80),reveal:number(m.info.finishedAt)?{seed:'公开链状态，无隐藏种子',replay}:undefined};
 }
 async function ids(blockTag){
  requireEnabled();const options=blockTag===undefined?{}:{blockTag},count=number(await contract.matchCount(options)),result=[];
  for(let i=count-1;i>=0;i--)result.push(await contract.matchIds(i,options));
  return result;
 }
 async function infoAt(id,blockTag){return typeof contract.matchInfo==='function'?contract.matchInfo(id,{blockTag}):(await load(id,blockTag)).info;}
 async function rooms(){const result=[],block=await getBlock();for(const id of await ids(block)){const info=await infoAt(id,block);if(info.exists&&!info.ai&&!info.started&&!info.cancelled&&!number(info.finishedAt))result.push({id,a:lower(info.playerA),created:new Date(number(info.createdAt)*1000).toISOString(),battleVersion:'onchain-v1'});if(result.length>=30)break;}return result;}
 async function history(w){const result=[],block=await getBlock();for(const id of await ids(block)){const info=await infoAt(id,block);if(lower(info.playerA)!==lower(w)&&(info.ai||lower(info.playerB)!==lower(w)))continue;if(!number(info.finishedAt)&&!info.cancelled)continue;const m=await load(id,block);result.push({id,mode:info.ai?'ai':'pvp',finished:number(info.finishedAt)||null,winner:info.cancelled?null:m.state.winner,a:lower(info.playerA),b:info.ai?null:lower(info.playerB),battleVersion:'onchain-v1',cancelled:!!info.cancelled});if(result.length>=30)break;}return result;}
 async function active(w){if(!enabled)return null;const id=await contract.activeMatch(w);return isChainMatchId(id)?id:null;}
 async function journal(id,w,page=0){if(!Number.isInteger(page)||page<0)throw Error('日志页码无效');const m=await load(id),side=participant(m,w),entries=battleLogRows(await logsFor(id,m.blockNumber),m.state,eventInterfaces).map(e=>{const x={...e};for(const key of ['side','targetSide'])if(x[key]===0||x[key]===1)x[key]=x[key]===side?0:1;return x;}).reverse(),pages=Math.max(1,Math.ceil(entries.length/6)),selected=Math.min(page,pages-1);return {page:selected,pages,total:entries.length,pageSize:6,entries:entries.slice(selected*6,selected*6+6),source:'onchain-events',blockNumber:m.blockNumber};}
 async function reward(id,w){
  const m=await load(id),side=participant(m,w);if(!number(m.info.finishedAt)||m.info.cancelled||m.state.winner===null||m.state.winner===2||m.state.winner!==side)throw Error('本场无可领取胜利奖励');
  const logs=await logsFor(id,m.blockNumber),finishedAt=number(m.info.finishedAt),matchId=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','bytes32'],[config.chainId,address,id]));
  return {deploymentId:config.deploymentId,matchId,playerA:m.info.playerA,playerB:m.info.ai?ZeroAddress:m.info.playerB,mode:m.info.ai?0:1,winner:w,finishedAt,rewardEpoch:Math.floor(finishedAt/86400),rewardRulesVersion:config.rewardRulesVersion,battleRulesHash:config.battleRulesHash,rosterSnapshotHash:keccak256(AbiCoder.defaultAbiCoder().encode(['uint256[8]','uint16[8]','uint8[2]'],[m.tokens,m.arts,array(m.raw.items)])),replayHash:keccak256(toUtf8Bytes(JSON.stringify(logs.map(l=>[l.transactionHash,number(l.index??l.logIndex),l.topics,l.data])))),validUntil:finishedAt+7*86400};
 }
 async function tickAI(){
  if(!enabled||aiRunning)return;aiRunning=true;
  try{for(const id of await ids()){
   const info=await infoAt(id);if(!info.ai||!info.started||info.cancelled||number(info.finishedAt))continue;
   const m=await load(id);
   const action=aiAction(m),at=due(m);if(!action||Date.now()<at)continue;
   const args=encodeBattleAction({...action,expectedSeq:m.state.seq});
   await runAdmin(async signer=>{await(await contract.connect(signer).actAI(id,...args,{gasPrice:0,gasLimit:25000000})).wait();});
   aiDue.delete(id);
  }}finally{aiRunning=false;}
 }
 return {enabled,address,abi:artifact?.abi||null,contract,load,snapshot,journal,rooms,history,active,reward,tickAI};
}

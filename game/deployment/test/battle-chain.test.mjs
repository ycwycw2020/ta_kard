import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress} from 'ethers';
import {decodeBattleState,projectPublicBattle,selectAIAction,battleLogRows,createBattleAccess,BATTLE_EVENTS,encodeBattleAction,isChainMatchId} from '../lib/battle-chain.mjs';
import {E} from '../lib/game.mjs';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),C='0x'+'33'.repeat(20),ID='0x'+'ab'.repeat(32),TX='0x'+'cd'.repeat(32);
const ids=[1,2,3,6,2,4,5,7],arts=ids.map(id=>BigInt(id*100+1)),tokens=ids.map((_,i)=>BigInt(1001000000000000+i));
function rawState(){
 const units=ids.map(id=>({id,hp:40,shield:0,acted:false,comboTriggered:false,combo:false,ult:false,ultimateCharge:0,frozen:0,burn:0,burnSide:0,burnActor:0,electric:false,electricUntil:0,vulnerable:false,vulnerableUntil:0,barrier:false,barrierUntil:0,crossedHalf:false,crystalCharges:0,crystalUntil:0,focusTarget:0,focusUntil:0,vocalist:0,ready:{active:false,target:0,actor:0,side:0,root:0}}));
 const decks=Array.from({length:2},()=>({draw:[5,6,7,8,1,2,3,4,0,0,0,0],drawCount:8,hand:[1,2,3,4,0,0],handCount:4,discard:Array(12).fill(0),discardCount:0,removed:Array(4).fill(0),removedCount:0,cycled:false}));
 return {units,decks,ap:[3,3],actions:[3,3],items:[0,2],used:[0,0],last:[0,0],round:1,priority:0,initiative:0,winner:0,roundPending:false,acks:[false,false],seq:4,rng:123,root:0,turns:0,link:[0,0],linkUntil:[0,0],comboRefund:[0,0],hits:Array(40).fill(0n)};
}
function context(raw=rawState(),changes={}){
 const info={playerA:A,playerB:B,ai:false,exists:true,started:true,cancelled:false,createdAt:1000n,finishedAt:0n,createdBlock:10n,lastBlock:12n,lastActionAt:1002n,rulesHash:'0x'+'44'.repeat(32),...changes};
 const provider={send:async()=> '0x20',getLogs:async()=>[]};
 const contract={interface:new Interface(BATTLE_EVENTS),getMatch:async()=>[info,raw,tokens,arts],matchInfo:async()=>info,matchCount:async()=>1n,matchIds:async()=>ID,activeMatch:async()=>ID};
 const config={chainId:20260926,battleContract:C,battleDeploymentBlock:10,deploymentId:'0x'+'55'.repeat(32),rewardRulesVersion:'0x'+'66'.repeat(32),battleRulesHash:'0x'+'77'.repeat(32)};
 return {access:createBattleAccess({config,provider,contract,abi:BATTLE_EVENTS,runAdmin:()=>{throw Error('no transactions in unit tests');}}),info,contract,provider,config};
}
test('protocol actions reject unknown intents, invalid positions and stale-size sequences',()=>{
 assert.deepEqual(encodeBattleAction({type:'skill',expectedSeq:9,actor:1,target:2,ally:3}),[9,1,1,2,3,0]);
 assert.throws(()=>encodeBattleAction({type:'setWinner',expectedSeq:0}));
 assert.throws(()=>encodeBattleAction({type:'attack',expectedSeq:2**32}));
 assert.throws(()=>encodeBattleAction({type:'cycle',expectedSeq:0,hand:6}));
 assert.equal(isChainMatchId(ID),true);assert.equal(isChainMatchId('0x'+'00'.repeat(32)),false);
});
test('fixed-size State decodes units, card encoding, public ready/focus and no equipment safely',()=>{
 const raw=rawState();raw.units[4].ready={active:true,target:2,actor:1,side:0,root:3};raw.units[4].focusTarget=6;raw.units[4].focusUntil=3;raw.units[4].crystalCharges=2;raw.units[4].crystalUntil=3;
 const state=decodeBattleState(raw,tokens,arts);
 assert.equal(state.winner,null);assert.deepEqual(state.decks[0].hand,[{id:1,type:'skill'},{id:1,type:'ultimate'},{id:2,type:'skill'},{id:2,type:'ultimate'}]);
 assert.deepEqual(state.enemy[0].ready,{targetSide:0,target:2,actor:1,side:0,root:3});assert.deepEqual(state.enemy[0].focus,{side:1,target:2,until:3});assert.deepEqual(state.enemy[0].crystal,{charges:2,until:3});
 assert.equal(state.items[0].disabled,true);assert.equal(E.itemStatus(state,0,0).remaining,0);assert.equal(state.own[0].tokenId,tokens[0].toString());
});
test('side-B projection retains BOTH public hands and remaps every visible side reference',()=>{
 const state=decodeBattleState(rawState(),tokens,arts);state.own[0].ready={targetSide:1,target:2,side:0,actor:1};state.winner=1;state.priority=1;state.acks=[true,false];
 const b=projectPublicBattle(state,1);assert.equal(b.own[1].id,4);assert.equal(b.enemy[0].id,1);assert.equal(b.winner,0);assert.equal(b.priority,0);assert.deepEqual(b.acks,[false,true]);
 assert.equal(b.decks[0].hand.length,4);assert.equal(b.decks[1].hand.length,4);assert.equal(b.rng,123);assert.equal(b.enemy[0].ready.targetSide,0);assert.equal(b.enemy[0].ready.side,1);
 assert.equal(state.own[0].ready.targetSide,1);
});
test('waiting room roster is reconstructed from on-chain artwork even before engine initialization',()=>{
 const raw=rawState();for(const u of raw.units)u.id=0;for(const d of raw.decks)d.handCount=d.drawCount=0;
 assert.deepEqual(decodeBattleState(raw,tokens,arts).own.map(u=>u.id),ids.slice(0,4));
});
test('AI submits a free ready combo before round acknowledgement; it never mutates state',()=>{
 const state=decodeBattleState(rawState(),tokens,arts);state.roundPending=true;state.priority=-1;state.actions=[0,0];state.enemy[0].ready={targetSide:0,target:1,side:0,actor:1};
 const before=JSON.stringify(state);assert.equal(selectAIAction(state).type,'combo');assert.equal(JSON.stringify(state),before);
 state.enemy[0].ready=null;assert.equal(selectAIAction(state).type,'round');state.acks[1]=true;assert.equal(selectAIAction(state),null);state.enemy[0].ready={targetSide:0,target:1};assert.equal(selectAIAction(state),null);
});
test('Rules events supply damage source, shield arithmetic and stable order without double action logs',()=>{
 const actionAbi='event ActionAccepted(bytes32 indexed matchId,uint32 seq,address actor,uint8 kind,uint8 unitIndex,uint8 target,uint8 ally,uint8 hand,bytes32 stateHash)';
 const iface=new Interface([...BATTLE_EVENTS,actionAbi]);
 const make=(name,args,index)=>({...iface.encodeEventLog(iface.getEvent(name),args),transactionHash:TX,blockNumber:20,index});
 const logs=[make('BattleAction',[ID,1,0,0,0,1,0,0],0),make('BattleDamage',[ID,1,1,0,0,5,0,0,10,2,false,3,8,8],1),make('ActionAccepted',[ID,1,A,0,0,1,0,0,'0x'+'00'.repeat(32)],2)];
 const rows=battleLogRows(logs,decodeBattleState(rawState(),tokens,arts),[iface]);
 assert.equal(rows.filter(x=>x.kind==='action').length,1);const damage=rows.find(x=>x.kind==='damage');assert.equal(damage.sourceId,1);assert.equal(damage.targetId,4);assert.equal(damage.targetSide,1);assert.equal(damage.target,1);assert.equal(damage.finalDamage,8);assert.match(damage.formula,/min\(8, 9\) = 8/);assert.deepEqual(rows.map(x=>x.id),[2000000,2000001]);
});
test('snapshot authority and participant restriction come from the contract; no SQL needed',async()=>{
 const {access}=context();const b=await access.snapshot(ID,B);assert.equal(b.authority,'TalosBattle');assert.equal(b.publicState,true);assert.equal(b.side,1);assert.equal(b.state.own[1].id,4);assert.equal(b.blockNumber,32);assert.equal(b.acks.length,0);await assert.rejects(()=>access.snapshot(ID,C),/参战者/);
});

test('room enumeration and history pin count, identifiers and state to one block',async()=>{
 const {access,contract,info}=context(),tags=[];
 contract.matchCount=async o=>{tags.push(o.blockTag);return 1n;};
 contract.matchIds=async(i,o)=>{tags.push(o.blockTag);return ID;};
 contract.matchInfo=async(id,o)=>{tags.push(o.blockTag);return info;};
 info.started=false;assert.equal((await access.rooms()).length,1);assert.deepEqual(tags,[32,32,32]);
 tags.length=0;info.started=true;info.finishedAt=1000n;assert.equal((await access.history(A)).length,1);assert.deepEqual(tags,[32,32,32]);
 info.exists=false;info.started=false;info.finishedAt=0n;assert.deepEqual(await access.rooms(),[]);
});
test('confirmed transaction replay and stateHash are read at the same pinned block',async()=>{
 const raw=rawState();raw.winner=1;const {access,contract,provider}=context(raw,{finishedAt:1000n});
 const iface=new Interface(['event ActionAccepted(bytes32 indexed matchId,uint32 seq,address actor,uint8 kind,uint8 unitIndex,uint8 target,uint8 ally,uint8 hand,bytes32 stateHash)']);
 contract.interface=iface;const digest='0x'+'99'.repeat(32);let hashBlock;
 contract.stateHash=async(id,{blockTag})=>{hashBlock=blockTag;return digest;};
 provider.getLogs=async()=>[{...iface.encodeEventLog(iface.getEvent('ActionAccepted'),[ID,4,A,1,0,1,2,0,digest]),transactionHash:TX,blockNumber:20,index:0}];
 const snapshot=await access.snapshot(ID,A);assert.equal(hashBlock,32);assert.equal(snapshot.stateHash,digest);assert.equal(snapshot.reveal.replay[0].input.type,'skill');assert.equal(snapshot.reveal.replay[0].stateHash,digest);assert.equal(snapshot.reveal.replay[0].transactionHash,TX);
});
test('chain journal is reverse ordered with exactly six entries per page and stable ids',async()=>{
 const {access,provider}=context();const iface=new Interface(BATTLE_EVENTS);
 provider.getLogs=async()=>Array.from({length:15},(_,i)=>({...iface.encodeEventLog(iface.getEvent('BattleAction'),[ID,i+1,0,0,0,1,0,0]),transactionHash:'0x'+(i+1).toString(16).padStart(64,'0'),blockNumber:20,index:i}));
 const first=await access.journal(ID,A,0),second=await access.journal(ID,A,1),last=await access.journal(ID,A,99);
 assert.equal(first.entries.length,6);assert.equal(first.entries[0].id,2000014);assert.equal(second.entries[0].id,2000008);assert.equal(first.total,15);assert.equal(last.page,2);assert.equal(last.entries.length,3);assert.equal(first.source,'onchain-events');
});
test('compatibility reward is derived from chain winner/time, not a supplied DB result',async()=>{
 const raw=rawState();raw.winner=1;const finishedAt=BigInt(Math.floor(Date.now()/1000)-10);const {access}=context(raw,{finishedAt});const reward=await access.reward(ID,A);
 assert.equal(reward.winner,A);assert.equal(reward.finishedAt,Number(finishedAt));assert.equal(reward.rewardEpoch,Math.floor(Number(finishedAt)/86400));assert.equal(reward.validUntil,Number(finishedAt)+604800);assert.equal(reward.playerB,B);assert.notEqual(reward.matchId,ID);await assert.rejects(()=>access.reward(ID,B),/奖励/);
});
test('AI compatibility reward uses the zero B participant required by the old reward contract',async()=>{
 const raw=rawState();raw.winner=1;const {access}=context(raw,{ai:true,playerB:ZeroAddress,finishedAt:1000n});const reward=await access.reward(ID,A);assert.equal(reward.mode,0);assert.equal(reward.playerB,ZeroAddress);
});
test('finished losses/draws/cancelled rooms cannot receive a compatibility reward',async()=>{
 for(const [winner,cancelled] of [[2,false],[3,false],[1,true]]){const raw=rawState();raw.winner=winner;const {access}=context(raw,{finishedAt:1000n,cancelled});await assert.rejects(()=>access.reward(ID,A),/奖励/);}
});

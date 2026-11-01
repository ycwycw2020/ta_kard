import test from 'node:test';
import assert from 'node:assert/strict';
import {E,catalog,start,apply,project,rulesVersion,runtimeRulesHash} from '../lib/game.mjs';
const vanguards=catalog.filter(c=>c.role==='先锋');
function battle(id=11){return E.create([id,1,3,6],[2,4,5,7],87654,0);}
function give(b,id,type){b.round=3;b.priority=0;b.decks[0].hand=[{id,type}];}
test('rounds add two points to both sides, preserve leftovers and cap at six',()=>{
 const b=battle();assert.deepEqual(b.ap,[3,3]);
 for(const [before,after] of [[[0,1],[2,3]],[[3,4],[5,6]],[[5,6],[6,6]]]){
  b.ap=before;b.actions=[0,0];b.roundPending=true;
  assert.equal(E.endRound(b),true);assert.deepEqual(b.ap,after);
  assert.equal(E.endRound(b),false);assert.deepEqual(b.ap,after);
 }
});
for(const c of vanguards){
 test(`${c.name}: qualifying skill returns 1 and charged ultimate returns 2`,()=>{
  for(const [type,gain] of [['skill',1],['ultimate',2]]){
   const b=battle(c.id);give(b,c.id,type);b.ap[0]=3;b.own[0].ultimateCharge=c.ultimate.requiredCasts;
   if([11,16].includes(c.id))b.enemy[0].electric=true;
   if(c.id===15)b.enemy[0].vulnerable=true;
   if(c.id===27)b.enemy[0].burn=b.round;
   if(c.id===12)b.own[0].hp=Math.floor(c.hp/2);
   assert.equal(E.action(b,0,0,type,0,0),true);
   assert.equal(b.ap[0],3-c[type].apCost+gain);
   assert.equal(b.actions[0],2);assert.equal(c[type].apRecovery,gain);
  }
 });
 test(`${c.name}: skill does not refund when its special condition is missing`,()=>{
  const b=battle(c.id);give(b,c.id,'skill');b.ap[0]=4;
  assert.equal(E.action(b,0,0,'skill',0,0),true);assert.equal(b.ap[0],4-c.skill.apCost);
 });
 test(`${c.name}: cannot pre-spend the refund; failed skill changes no AP`,()=>{
  const b=battle(c.id);give(b,c.id,'skill');b.ap[0]=1;
  assert.equal(E.action(b,0,0,'skill',0,0),false);assert.equal(b.ap[0],1);assert.equal(b.actions[0],3);
 });
 test(`${c.name}: free combo gives one AP, at most once and never above six`,()=>{
  for(const initial of [0,5,6]){
   const b=battle(c.id),u=b.own[0];b.ap[0]=initial;
   u.ready={targetSide:1,target:0,actor:0,root:1};u.comboTriggered=true;
   assert.equal(E.action(b,0,0,'combo'),true);assert.equal(b.ap[0],Math.min(6,initial+1));
   assert.deepEqual(b.actions,[3,3]);assert.equal(u.acted,false);
   assert.equal(E.action(b,0,0,'combo'),false);assert.equal(b.ap[0],Math.min(6,initial+1));
  }
 });
}
test('two vanguards triggered by the same real event each refund their own point',()=>{
 const b=E.create([11,12,15,16],[2,4,5,7],234,0);b.ap[0]=0;b.enemy[0].electric=true;
 assert.equal(E.action(b,0,0,'attack',0,0),true);
 assert.ok(b.own[0].ready);assert.ok(b.own[3].ready);
 assert.equal(E.action(b,0,0,'combo'),true);assert.equal(E.action(b,0,3,'combo'),true);
 assert.equal(b.ap[0],2);assert.equal(b.comboRefund[0],2);assert.equal(b.actions[0],2);
});
test('each of the 32 ultimates costs zero AP and requires its own 3 to 5 charges',()=>{
 for(const c of catalog){
  const other=catalog.filter(x=>x.id!==c.id).sort((a,b)=>a.cost-b.cost).slice(0,3).map(x=>x.id);
  const b=E.create([c.id,...other],[2,4,5,7],134,0);give(b,c.id,'ultimate');b.ap[0]=0;
  assert.equal(c.ultimate.apCost,0);assert.ok([3,4,5].includes(c.ultimate.requiredCasts));
  b.own[0].ultimateCharge=c.ultimate.requiredCasts-1;
  assert.equal(E.action(b,0,0,'ultimate',0,0),false,`${c.name}: premature ultimate`);
  b.own[0].ultimateCharge++;
  assert.equal(E.action(b,0,0,'ultimate',0,0),true,c.name);
  assert.equal(b.ap[0],c.role==='先锋'?2:0);assert.equal(b.own[0].ultimateCharge,0);
  b.priority=0;b.own[0].acted=false;b.own[0].ultimateCharge=c.ultimate.requiredCasts;give(b,c.id,'ultimate');
  assert.equal(E.action(b,0,0,'ultimate',0,0),false,'Ultimate stays once per match');
 }
});
test('skill and combo charge only their own character; attacks and failed actions do not',()=>{
 const b=battle(11),u=b.own[0];give(b,11,'skill');b.ap[0]=0;
 assert.equal(E.action(b,0,0,'skill',0,0),false);assert.equal(u.ultimateCharge,0);
 b.ap[0]=3;assert.equal(E.action(b,0,0,'skill',0,0),true);assert.equal(u.ultimateCharge,1);
 u.ready={targetSide:1,target:0,actor:0,root:1};u.comboTriggered=true;
 assert.equal(E.action(b,0,0,'combo'),true);assert.equal(u.ultimateCharge,2);
 b.priority=0;assert.equal(E.action(b,0,1,'attack',0,0),true);assert.equal(b.own[1].ultimateCharge,0);
 b.actions=[0,0];b.roundPending=true;E.endRound(b);assert.equal(u.ultimateCharge,2);
});
test('Akekuri cannot gain a point from a half-health ally whose numerical shield is already capped',()=>{
 const b=battle(12);give(b,12,'skill');b.ap[0]=3;b.own[0].hp=1;b.own[0].shield=E.config.shieldCap;
 assert.equal(E.action(b,0,0,'skill',0,0),true);assert.equal(b.ap[0],1);
});
test('non-vanguards do not gain the new skill refund',()=>{
 const b=battle(2);give(b,2,'skill');b.ap[0]=4;
 assert.equal(E.action(b,0,0,'skill',0,0),true);assert.equal(b.ap[0],4-E.byId(2).skill.apCost);
});
test('battery fills six points, still opens on round five and only works once',()=>{
 const b=battle();b.ap[0]=4;b.round=4;
 assert.equal(E.action(b,0,0,'item',0,0),false);
 b.round=5;assert.equal(E.action(b,0,0,'item',0,0),true);assert.equal(b.ap[0],6);
 b.priority=0;b.ap[0]=0;assert.equal(E.action(b,0,0,'item',0,0),false);
});
test('PVP refills exactly once after both round confirmations, with mirrored player views',()=>{
 const team=[1,2,3,6].map(id=>({id,skin:0}));
 const m={a:'alice',b:'bob',mode:'pvp',team_a:team,team_b:team,item_a:'none',item_b:'none',seed:'0x'+'12'.repeat(32),acks:[],seq:0};
 m.state=start(m);m.state.ap=[0,5];m.state.actions=[0,0];m.state.roundPending=true;
 apply(m,'alice',{type:'round'});assert.deepEqual(m.state.ap,[0,5]);
 apply(m,'alice',{type:'round'});assert.deepEqual(m.state.ap,[0,5]);
 apply(m,'bob',{type:'round'});assert.deepEqual(m.state.ap,[2,6]);
 assert.deepEqual(project(m,'bob').state.ap,[6,2]);
 assert.throws(()=>apply(m,'bob',{type:'round'}));assert.deepEqual(m.state.ap,[2,6]);
 assert.equal(m.state.rulesVersion,rulesVersion);assert.equal(m.replay[0].runtimeRulesHash,runtimeRulesHash);
});
test('ongoing legacy match records a rules transition without resetting its resources',()=>{
 const team=[1,2,3,6].map(id=>({id,skin:0}));
 const m={a:'alice',b:'bob',mode:'pvp',team_a:team,team_b:team,item_a:'none',item_b:'none',seed:'0x'+'12'.repeat(32),acks:[],seq:8,replay:[]};
 m.state=start(m);delete m.state.runtimeRulesHash;delete m.state.rulesVersion;m.replay=[];m.state.ap=[1,2];m.state.priority=0;
 apply(m,'alice',{type:'pass',actor:0,target:0,ally:0});assert.deepEqual(m.state.ap,[1,2]);
 assert.equal(m.replay[0].type,'rules');assert.equal(m.replay[0].beforeSeq,8);
});

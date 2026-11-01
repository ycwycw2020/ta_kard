import test from 'node:test';import assert from 'node:assert/strict';
import {E,catalog,project,projectLogs} from '../lib/game.mjs';
function battle(id=1){const others=catalog.filter(c=>c.id!==id).sort((a,b)=>a.cost-b.cost).slice(0,3).map(c=>c.id);return E.create([id,...others],[2,4,5,7],456,0);}
test('all 32 characters produce source, target, element and exact damage animation records',()=>{
 for(const c of catalog){const b=battle(c.id);assert.ok(E.action(b,0,0,'attack',0,0));const hit=b.audit.find(e=>e.kind==='damage');assert.equal(hit.sourceId,c.id);assert.equal(hit.targetId,2);assert.equal(hit.element,c.element);assert.equal(hit.finalDamage,c.atk);assert.match(hit.formula,new RegExp('= '+c.atk+'$'));}
});
test('damage keeps its selected target and resolves bonus, shield and overkill without half damage',()=>{
 const b=battle(1);b.enemy[0].vulnerable=true;b.enemy[0].shield=1;b.enemy[0].hp=2;
 b.enemy[1].shield=12;const otherHP=b.enemy[1].hp;
 E.action(b,0,0,'attack',0,0);const hit=b.audit.find(e=>e.kind==='damage');
 assert.equal(hit.intendedTarget,0);assert.equal(hit.target,0);
 assert.equal(hit.beforeReduction,E.byId(1).atk+2);assert.equal(hit.afterReduction,hit.beforeReduction);
 assert.equal(hit.shieldAbsorbed,1);assert.equal(hit.finalDamage,2);
 assert.equal(b.enemy[1].hp,otherHP);assert.equal(b.enemy[1].shield,12);
 assert.doesNotMatch(hit.formula,/减半|向上取整|庇护/);
 assert.ok(!Object.hasOwn(hit,'shelter'));
});
test('barrier damage records show zero life loss and retain numerical shield',()=>{
 const b=battle();b.enemy[0].barrier=1;b.enemy[0].shield=5;E.action(b,0,0,'attack',0,0);const hit=b.audit.find(e=>e.kind==='damage');assert.equal(hit.barrierBlocked,true);assert.equal(hit.finalDamage,0);assert.equal(b.enemy[0].shield,5);assert.match(hit.formula,/次数护盾/);
});
test('full public shield logs paginate six rows, preserve earlier operations and mirror both viewpoints',()=>{
 const b=battle(),m={a:'alice',b:'bob',state:b,acks:[]};
 for(let i=0;i<25;i++)E.record(b,{kind:'action',side:0,actor:0,sourceId:1,actionName:'操作'+i});
 b.own[3].shield=12;E.record(b,{kind:'shield',side:0,target:3,targetSide:0,text:'公开数值护盾 +12'});
 const a=projectLogs(m,'alice'),z=projectLogs(m,'bob');assert.equal(a.entries.length,6);assert.equal(z.entries.length,6);assert.equal(a.total,z.total);assert.ok(a.total>12);
 assert.ok(z.entries.some(e=>e.text==='公开数值护盾 +12'));assert.equal(z.entries[0].side,1);
 assert.equal(project(m,'bob').state.enemy[3].shield,12);
 const oldest=projectLogs(m,'alice',999);assert.equal(oldest.page,oldest.pages-1);assert.ok(oldest.entries.some(e=>e.kind==='note'));assert.throws(()=>projectLogs(m,'outsider'));assert.throws(()=>projectLogs(m,'alice',-1));
});

for(const id of [6,7,21,32]){
 test(`character ${id} grants the selected teammate exactly twelve extra public numerical shield`,()=>{
  const b=battle(id);b.decks[0].hand=[{id,type:'skill'}];
  assert.equal(E.action(b,0,0,'skill',0,1),true);
  assert.equal(b.own[1].shield,id===6?20:id===7?12:19);
  assert.equal(b.own[0].shield,id===7?5:0);
  assert.equal(b.own[2].shield,0);assert.equal(b.own[3].shield,0);
  assert.ok(b.own.every(u=>!Object.hasOwn(u,'shelter')));
  assert.ok(b.audit.filter(e=>e.kind==='shield').every(e=>!Object.hasOwn(e,'privateTo')));
 });
 test(`character ${id} may select itself and cannot exceed the global shield cap`,()=>{
  const b=battle(id);b.decks[0].hand=[{id,type:'skill'}];
  assert.equal(E.action(b,0,0,'skill',0,0),true);
  assert.equal(b.own[0].shield,id===6?20:id===7?17:19);
  const capped=battle(id);capped.own[1].shield=23;capped.decks[0].hand=[{id,type:'skill'}];
  assert.equal(E.action(capped,0,0,'skill',0,1),true);assert.equal(capped.own[1].shield,24);
 });
}

test('all numerical shield caps at 24 and expires at the end of the current global round',()=>{
 const b=battle();assert.equal(E.config.shieldCap,24);
 for(const u of [...b.own,...b.enemy]){E.shield(u,255);assert.equal(u.shield,24);}
 b.actions=[0,0];b.roundPending=true;assert.equal(E.endRound(b),true);
 assert.ok([...b.own,...b.enemy].every(u=>u.shield===0));assert.equal(b.round,2);
});

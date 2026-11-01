import fs from 'node:fs';
import crypto from 'node:crypto';
import engine from '../engine.cjs';
export const catalog=JSON.parse(fs.readFileSync(new URL('../catalog.json',import.meta.url),'utf8'));
export const E=engine(catalog);
export const rulesVersion='0.7.3';
export const runtimeRulesHash='0x'+crypto.createHash('sha256').update(fs.readFileSync(new URL('../engine.cjs',import.meta.url))).update(fs.readFileSync(new URL('../catalog.json',import.meta.url))).digest('hex');
function stampRules(m,b){
 if(b.runtimeRulesHash===runtimeRulesHash)return;
 m.replay??=[];
 m.replay.push({type:'rules',version:rulesVersion,runtimeRulesHash,hashAlgorithm:'sha256',beforeSeq:m.seq??0,round:b.round,previousRuntimeRulesHash:b.runtimeRulesHash??null});
 for(const u of [...b.own,...b.enemy])u.ultimateCharge??=0;
 b.runtimeRulesHash=runtimeRulesHash;b.rulesVersion=rulesVersion;
}
export const hash=x=>'0x'+crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const itemNames={none:'不携带战术道具',resource_cell:'战术蓄能电池',medkit:'急救包',full_restore:'全恢复装置',barrier_generator:'次数护盾',cleanser:'净化器',reactivation:'再行动许可'};
export function validTeam(team,costCap=E.config.teamCostCap){
 if(![16,20].includes(costCap))throw Error('未知对战费用上限');
 if(!Array.isArray(team)||team.length!==4||team.some(x=>!Number.isInteger(x.id)||!catalog.some(c=>c.id===x.id)||!Number.isInteger(x.skin)||x.skin<0||x.skin>17)||new Set(team.map(x=>x.id)).size!==4||team.reduce((n,x)=>n+catalog.find(c=>c.id===x.id).cost,0)>costCap)throw Error(`选择4名不同角色，编队费用最多${costCap}。`);
 return team.map(({id,skin,tokenId})=>{if(tokenId!==undefined&&(!/^[1-9][0-9]{0,77}$/.test(String(tokenId))||BigInt(tokenId)>=2n**256n))throw Error('卡牌唯一编号无效');return tokenId===undefined?{id,skin}:{id,skin,tokenId:String(tokenId)};});
}
function visibleEvents(m,side){
 const entries=m.state?.audit||(m.state?.log||[]).slice().reverse().map((text,i)=>({id:i+1,kind:'legacy',round:m.state.round,text}));
 return entries.filter(e=>e.privateTo===undefined||e.privateTo===side).map(e=>{
  const out={...e};delete out.privateTo;
  for(const k of ['side','targetSide'])if(out[k]===0||out[k]===1)out[k]=out[k]===side?0:1;
  return out;
 });
}
export function projectLogs(m,address,page=0){
 const side=m.a===address?0:m.b===address?1:-1;if(side<0)throw Error('不是本场参战者');
 if(!Number.isInteger(page)||page<0)throw Error('日志页码无效');
 const entries=visibleEvents(m,side).reverse(),pages=Math.max(1,Math.ceil(entries.length/6)),selected=Math.min(page,pages-1);
 return {page:selected,pages,total:entries.length,pageSize:6,entries:entries.slice(selected*6,selected*6+6)};
}
export function project(m,address){
 const side=m.a===address?0:m.b===address?1:-1;if(side<0)throw Error('不是本场参战者');
 const result={id:m.id,mode:m.mode,seq:m.seq,commitment:m.commitment,rosterHash:m.roster_hash,aiPending:m.mode==='ai'&&!!nextAIAction(m.state),aiNextActionAt:m.ai_due?Number(m.ai_due):null,waiting:!m.state,finished:m.finished,cancelled:m.cancelled,side,opponent:side?m.a:m.b,team:side?m.team_b:m.team_a,acks:m.acks,rulesVersion:m.state?.rulesVersion??null,runtimeRulesHash:m.state?.runtimeRulesHash??null};
 if(!m.state)return result;
 const b=structuredClone(m.state);
 result.events=visibleEvents(m,side).slice(-80);
 // Omit deck order, RNG, action ledger and undisclosed protection from the opponent's view.
 const own=E.team(b,side),enemy=E.team(b,1-side);
 for(const u of own)if(u.ready)u.ready={targetSide:u.ready.targetSide===side?0:1,target:u.ready.target};
 for(const u of enemy){u.shelter=null;u.ready=u.ready?{ready:true}:null;u.focus=null;u.crystal=null;}
 const mine=b.decks[side],op=b.decks[1-side];
 result.state={round:b.round,own,enemy,ap:side?[b.ap[1],b.ap[0]]:b.ap,actions:side?[b.actions[1],b.actions[0]]:b.actions,priority:b.priority===side?0:1,initiative:b.initiative===side?0:1,items:side?[b.items[1],b.items[0]]:b.items,turns:b.turns,winner:b.winner===null?null:b.winner===2?2:b.winner===side?0:1,roundPending:b.roundPending,log:b.log,decks:[{hand:mine.hand,drawCount:mine.draw.length,discardCount:mine.discard.length,cycled:mine.cycled},{handCount:op.hand.length,drawCount:op.draw.length,discardCount:op.discard.length}],comboRefund:side?[b.comboRefund[1],b.comboRefund[0]]:b.comboRefund,link:side?[b.link[1],b.link[0]]:b.link,linkUntil:side?[b.linkUntil[1],b.linkUntil[0]]:b.linkUntil};
 if(m.finished)result.reveal={seed:m.seed,replay:m.replay};
 return result;
}
export function nextAIAction(b){
 if(!b||b.winner!==null)return null;
 const actor=b.enemy.findIndex((u,i)=>u.ready&&!E.validate(b,1,i,'combo',0,i));
 if(actor>=0)return {type:'combo',actor,target:0,ally:actor};
 if(b.roundPending||b.priority!==1)return null;
 const deck=b.decks[1];if(b.actions[1]===3&&!deck.cycled){const hand=deck.hand.findIndex(x=>!b.enemy.some(u=>u.id===x.id&&u.hp>0));if(hand>=0)return {type:'cycle',actor:0,target:0,ally:0,hand};}
 const a=E.chooseAI(b,1);return {type:a.type,actor:a.i,target:Math.max(0,a.target),ally:Math.max(0,a.ally)};
}
export function scheduleAI(m,now=Date.now(),delay=crypto.randomInt(3500,4251)){
 if(m.mode!=='ai'||m.finished||m.cancelled||!nextAIAction(m.state)){m.ai_due=null;return;}
 if(!m.ai_due)m.ai_due=now+delay;
}
export function applyAI(m){
 if(m.mode!=='ai'||m.finished||m.cancelled)return null;const input=nextAIAction(m.state);if(!input)return null;stampRules(m,m.state);
 const ok=input.type==='cycle'?E.cycle(m.state,1,input.hand):E.action(m.state,1,input.actor,input.type,input.target,input.ally);
 if(!ok)throw Error('AI行动未通过规则校验');return input;
}
export function start(m){
 const b=E.create(m.team_a.map(x=>x.id),m.team_b.map(x=>x.id),parseInt(m.seed.slice(2,10),16),parseInt(m.seed.slice(-2),16)%2);
 b.own.forEach((u,i)=>u.skinIndex=m.team_a[i].skin);b.enemy.forEach((u,i)=>u.skinIndex=m.team_b[i].skin);
 b.own.forEach((u,i)=>{if(m.team_a[i].tokenId)u.tokenId=m.team_a[i].tokenId;});b.enemy.forEach((u,i)=>{if(m.team_b[i].tokenId)u.tokenId=m.team_b[i].tokenId;});
 b.items=[m.item_a,m.item_b].map(id=>id==='none'?{id:'resource_cell',used:1,last:0,disabled:true}:{id,used:0,last:0});
 stampRules(m,b);
 return b;
}
export function apply(m,address,input){
 if(!m.state||m.finished||m.cancelled)throw Error('对局未开始或已结束');
 const side=m.a===address?0:m.b===address?1:-1;if(side<0)throw Error('无参战权限');
 const b=m.state;
 stampRules(m,b);
 if(input.type==='round'){
  if(!b.roundPending)throw Error('本回合行动尚未结束');
  if(m.mode==='ai'&&nextAIAction(b))throw Error('AI正在完成轮末连携，请等待');
  if(!m.acks.includes(side)){m.acks.push(side);E.record(b,{kind:'action',side,actor:null,action:'confirm',actionName:'确认结束本轮'});}
  if(m.mode==='ai'||m.acks.length===2){E.endRound(b);m.acks=[];}
 }else if(input.type==='surrender') {E.record(b,{kind:'action',side,actor:null,action:'surrender',actionName:'投降'});b.winner=1-side;}
 else{
  for(const n of ['actor','target','ally'])if(!Number.isInteger(input[n])||input[n]<0||input[n]>3)throw Error('角色位置无效');
  if(m.acks.includes(side))throw Error('已确认结束本轮');
  if(input.type==='cycle'){if(!Number.isInteger(input.hand)||input.hand<0||input.hand>=6||!E.cycle(b,side,input.hand))throw Error('当前不能调换这张手牌');}
  else {if(!['attack','skill','ultimate','defend','item','pass','combo'].includes(input.type))throw Error('未知行动');const reason=E.validate(b,side,input.actor,input.type,input.target,input.ally);if(reason)throw Error(reason);if(!E.action(b,side,input.actor,input.type,input.target,input.ally))throw Error('行动未执行');}
 }
 scheduleAI(m);
}

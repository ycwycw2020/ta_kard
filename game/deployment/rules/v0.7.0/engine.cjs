/* Deterministic, DOM-free local prototype rules. All numeric effects are integers. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.TalosEngine=factory;})(globalThis,function(catalog,options={}){
 const byId=id=>catalog.find(c=>c.id===id);
 const config={maxRounds:19,fatigueStart:12,fatigueStep:3,shieldCap:12,...options};
 const itemConfig={resource_cell:[5,1,0,0],medkit:[2,3,1,2],full_restore:[5,1,3,0],barrier_generator:[2,2,2,3],cleanser:[2,2,1,2],reactivation:[4,1,1,0]};
 const team=(b,s)=>s?b.enemy:b.own;
 const frozen=(b,u)=>u.frozen===b.round;
 const alive=u=>u&&u.hp>0;
 const log=(b,t)=>{b.log.unshift(t);b.log.length=Math.min(12,b.log.length);};
 function random(b){b.rng^=b.rng<<13;b.rng^=b.rng>>>17;b.rng^=b.rng<<5;return (b.rng>>>0)/4294967296;}
 function shuffle(b,a){for(let i=a.length-1;i>0;i--){const j=Math.floor(random(b)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function unit(id){return {id,hp:byId(id).hp,shield:0,acted:false,combo:false,comboTriggered:false,ready:null,ult:false,frozen:0,burn:0,electric:false,electricUntil:0,vulnerable:false,vulnerableUntil:0,shelter:null,barrier:0,barrierUntil:0,crossedHalf:false,refundRound:0,crystal:null,focus:null,vocalist:0};}
 function draw(b,s,n){const d=b.decks[s];for(let k=0;k<n;k++){if(!d.draw.length&&d.discard.length)d.draw=shuffle(b,d.discard.splice(0));if(!d.draw.length)break;const card=d.draw.pop();if(d.hand.length<6)d.hand.push(card);else d.discard.push(card);}}
 function create(own,enemy,seed=14326,initiative=0){
  for(const ids of [own,enemy])if(ids.length!==4||new Set(ids).size!==4||ids.some(id=>!byId(id))||ids.reduce((n,id)=>n+byId(id).cost,0)>16)throw new Error('编队必须是4名不同角色，总费用不超过16');
  const b={round:1,own:own.map(unit),enemy:enemy.map(unit),ap:[3,3],actions:[3,3],priority:initiative,initiative,actor:0,target:0,allyTarget:0,item:'resource_cell',itemUsed:0,itemLast:0,items:[{id:'resource_cell',used:0,last:0},{id:'resource_cell',used:0,last:0}],turns:0,winner:null,log:[],rng:seed||1,rootSeq:0,ledger:{},comboRefund:[0,0],link:[0,0],linkUntil:[0,0],decks:[],roundPending:false};
  for(let s=0;s<2;s++){b.decks[s]={draw:shuffle(b,team(b,s).flatMap(u=>[{id:u.id,type:'skill'},{id:u.id,type:'skill'},{id:u.id,type:'ultimate'}])),hand:[],discard:[],removed:[],cycled:false};draw(b,s,4);}
  log(b,'双方4人，固定前后排，连携无资源消耗。');return b;
 }
 function range(u,type='attack'){const c=byId(u.id);return type==='skill'?c.targeting.skillTargetRange:type==='ultimate'?c.targeting.ultimateTargetRange:c.targeting.normalAttackRange;}
 function validTarget(b,s,i,u,type='attack'){const t=team(b,1-s),r=range(u,type);if(!alive(t[i])||r==='friendly')return false;return r==='any_enemy'||r==='all_enemies'||i<2||(r!=='front_only'&&!t.slice(0,2).some(alive));}
 function heal(u,n){if(!alive(u))return 0;const x=Math.max(0,Math.min(n,byId(u.id).hp-u.hp));u.hp+=x;return x;}
 function shield(u,n){if(alive(u))u.shield=Math.min(config.shieldCap,u.shield+n);}
 function recover(b,s,n,combo=false){const x=Math.min(n,3-b.ap[s],combo?1-b.comboRefund[s]:n);if(x>0){b.ap[s]+=x;if(combo)b.comboRefund[s]+=x;}return Math.max(0,x);}
 function win(b){if(b.winner!==null)return true;const a=b.own.some(alive),e=b.enemy.some(alive);if(!a||!e){b.winner=a?0:e?1:2;return true;}return false;}
 function status(b,u,key){return key==='frozen'?u.frozen>=b.round:key==='burn'?u.burn>=b.round:!!u[key];}
 function applyStatus(b,s,actor,targetSide,index,key,root,events){const u=team(b,targetSide)[index];if(!alive(u))return;const old=status(b,u,key);if(key==='frozen'){if(old)return;u.frozen=b.round+1;}else if(key==='burn')u.burn=b.round+1;else{u[key]=true;u[key+'Until']=b.round+1;}if(!old)events.push({type:'status',side:s,actor,targetSide,target:index,key,root});}
 function counts(b,s,targetSide,index){const key=s+':'+targetSide+':'+index;return b.ledger[key]||(b.ledger[key]={});}
 function hits(l,e){return (l[e]||[]).length;}
 function damage(b,s,actor,index,n,element,kind,root,events,condition={}){
  const enemies=team(b,1-s);let u=enemies[index];if(!alive(u))return null;
  let actual=index,reduced=false;if(u.shelter){const protector=enemies[u.shelter.protector];u.shelter=null;if(alive(protector)){actual=enemies.indexOf(protector);u=protector;reduced=true;log(b,`${byId(u.id).name}为指定目标抵挡，减伤50%。`);}}
  const pre={electric:u.electric,vulnerable:u.vulnerable,burn:u.burn>=b.round,frozen:frozen(b,u),pending:u.frozen>=b.round};
  const ledger=counts(b,s,1-s,actual),prior=Object.fromEntries(Object.entries(ledger).map(([k,v])=>[k,v.length])),priorCryoNature=new Set([...(ledger['寒冷']||[]),...(ledger['自然']||[])]).size;
  const c=byId(team(b,s)[actor].id);let consumed=null;
  if(kind!=='combo'){
   if(condition.burn&&pre.burn)n+=condition.burn;
   if(condition.freeze&&pre.frozen)n+=condition.freeze;
   if(condition.hitElement&&hits(ledger,condition.hitElement)>=condition.hitCount)n+=condition.hitBonus;
   if((element!=='物理'||condition.consumeElectric)&&pre.electric){n+=condition.electricBonus||2;u.electric=false;consumed='electric';}
   else if(pre.vulnerable){n+=condition.vulnerableBonus||2;u.vulnerable=false;consumed='vulnerable';}
   if(consumed)events.push({type:'consume',side:s,actor,targetSide:1-s,target:actual,key:consumed,root});
   if(condition.link&&b.link[s]){n++;b.link[s]=0;}
  }
  if(reduced)n=Math.ceil(n/2);n=Math.max(0,n);
  let absorbed=0,loss=0;const before=u.hp;
  if(n>0&&u.barrier){u.barrier=0;log(b,`${byId(u.id).name}的次数屏障抵挡伤害。`);}
  else{absorbed=Math.min(u.shield,n);u.shield-=absorbed;loss=Math.min(u.hp,n-absorbed);u.hp-=loss;}
  const effective=absorbed+loss>0;
  if(effective){ledger[element]??=[];if(!ledger[element].includes(root))ledger[element].push(root);}
  const half=before>byId(u.id).hp/2&&u.hp<=byId(u.id).hp/2&&!u.crossedHalf;if(half)u.crossedHalf=true;
  if(!alive(u)){u.shelter=null;u.ready=null;u.crystal=null;u.focus=null;u.vocalist=0;}
  events.push({type:'hit',side:s,actor,targetSide:1-s,target:actual,element,kind,root,effective,hpLoss:loss,pre,prior,priorCryoNature,half});
  log(b,`${c.name}${kind==='combo'?'连携':''} → ${byId(u.id).name}：${loss}生命${absorbed?' + '+absorbed+'护盾':''}`);
  return {u,index:actual,effective,pre,consumed};
 }
 function eligible(b,u){return alive(u)&&!frozen(b,u)&&!u.comboTriggered;}
 function trigger(b,s,index,e,targetSide=e.targetSide,target=e.target){const u=team(b,s)[index];if(!eligible(b,u)||!alive(team(b,targetSide)[target]))return;u.comboTriggered=true;u.ready={...e,targetSide,target};log(b,`${byId(u.id).name}的连携已就绪。`);}
 function process(b,events){
  for(const units of [b.own,b.enemy])for(const u of units)if(u.ready&&!alive(team(b,u.ready.targetSide)[u.ready.target])){u.ready=null;u.combo=true;}
  if(win(b))return;
  for(const e of events){
   if(e.type==='hit'&&e.kind==='attack'&&e.effective){for(const u of team(b,e.side)){if(u.id!==19||!alive(u)||frozen(b,u)||!u.crystal||u.crystal.until<b.round)continue;const t=lowest(b,e.side);if(t>=0&&heal(team(b,e.side)[t],1)>0){u.crystal.charges--;if(u.crystal.charges===0){u.crystal=null;trigger(b,e.side,team(b,e.side).indexOf(u),{...e,type:'crystal'},e.side,t);}}}}
   for(let s=0;s<2;s++)team(b,s).forEach((u,i)=>{
    if(!eligible(b,u))return;const id=u.id,ally=e.side===s,target=team(b,e.targetSide)[e.target];if(!alive(target))return;
    const hit=e.type==='hit'&&e.effective,normal=hit&&e.kind==='attack',fresh=e.type==='status',consume=e.type==='consume',elemental=fresh&&['electric','burn','frozen'].includes(e.key),vocalChange=elemental||consume&&['electric','burn'].includes(e.key);
    let yes=false;
    if(ally){
     const ledger=counts(b,s,e.targetSide,e.target),cross=(element,n)=>hit&&(e.prior[element]||0)<n&&hits(ledger,element)>=n;
     const union=(elements)=>new Set(elements.flatMap(k=>ledger[k]||[])).size;
     if(id===1)yes=hit&&e.kind==='combo'&&e.actor!==i;
     if(id===2)yes=fresh&&e.key==='vulnerable';
     if(id===3)yes=normal;
     if(id===4||id===13)yes=elemental;
     if(id===5)yes=normal&&!e.pre.electric&&!e.pre.vulnerable&&!e.pre.burn&&!e.pre.pending;
     if(id===8)yes=fresh&&e.key==='burn';
     if(id===9)yes=normal&&e.pre.frozen;
     if(id===10)yes=normal&&e.pre.vulnerable;
     if(id===11)yes=(fresh||consume)&&e.key==='electric';
     if(id===12)yes=hit&&e.half;
     if(id===14)yes=cross('寒冷',2);
     if(id===15)yes=consume&&e.key==='vulnerable';
     if(id===16)yes=consume;
     if(id===17||id===26)yes=normal&&e.pre.electric;
     if(id===18)yes=cross('物理',3);
     if(id===20)yes=fresh&&u.focus?.until>=b.round&&u.focus.side===e.targetSide&&u.focus.target===e.target;
     if(id===22)yes=fresh&&e.key==='frozen';
     if(id===23)yes=hit&&['寒冷','自然'].includes(e.element)&&e.priorCryoNature<2&&union(['寒冷','自然'])>=2;
     if(id===24)yes=hit&&e.element==='寒冷';
     if(id===25)yes=fresh&&target.vulnerable&&(target.electric||target.burn>=b.round||target.frozen>=b.round);
     if(id===27)yes=consume&&e.key==='burn';
     if(id===28)yes=cross('物理',2);
     if(id===29)yes=u.vocalist>=b.round&&vocalChange;
     if(id===30)yes=hit&&(e.element==='自然'||['灼热','电磁','寒冷'].filter(k=>hits(ledger,k)>0).length>=2);
     if(id===31)yes=cross('自然',2);
    }else if(hit&&e.hpLoss>0&&e.targetSide===s){
     if(id===6)yes=target.hp/byId(target.id).hp<.6;
     if(id===7||id===32)yes=true;
     if(id===21)yes=target.hp/byId(target.id).hp<.4;
    }
    if(yes)trigger(b,s,i,e);
   });
  }
 }
 function lowest(b,s){let best=-1;team(b,s).forEach((u,i)=>{if(alive(u)&&(best<0||u.hp/byId(u.id).hp<team(b,s)[best].hp/byId(team(b,s)[best].id).hp))best=i;});return best;}
 function combo(b,s,i){
  const u=team(b,s)[i],e=u?.ready;if(b.winner!==null||!e||!alive(u)||frozen(b,u))return false;
  u.ready=null;u.combo=true;const target=team(b,e.targetSide)[e.target];if(!alive(target)){log(b,'连携目标已阵亡，取消且不重定向。');return true;}
  b.comboCounts??={};b.comboCounts[u.id]=(b.comboCounts[u.id]||0)+1;
  const id=u.id,events=[],root=e.root;
  const amounts={1:2,2:2,3:1,4:1,5:1,7:1,8:3,9:3,10:2,11:1,12:1,13:1,14:3,15:1,16:1,17:3,18:3,20:1,22:1,23:2,24:2,25:3,26:2,27:1,28:2,29:1,30:1,31:3};
  const elements={1:'物理',2:'物理',3:'电磁',4:'灼热',5:'自然',7:'物理',8:'灼热',9:'寒冷',10:'物理',11:'物理',12:'物理',13:'自然',14:'寒冷',15:'物理',16:'物理',17:'电磁',18:'物理',20:'电磁',22:'物理',23:'自然',24:'寒冷',25:'物理',26:'电磁',27:'灼热',28:'物理',29:'电磁',30:'自然',31:'自然'};
  let hit=null;
  if(amounts[id]){const t=id===7?e.actor:e.target;if(alive(team(b,1-s)[t]))hit=damage(b,s,i,t,amounts[id],elements[id],'combo',root,events);}
  if(hit&&alive(hit.u)){
   const key=([1,13,22,30].includes(id)?'vulnerable':[3,20].includes(id)?'electric':id===4?'burn':null);
   if(key)applyStatus(b,s,i,1-s,hit.index,key,root,events);
  }
  if([5,29].includes(id)){const x=lowest(b,s);if(x>=0)heal(team(b,s)[x],2);}
  if(id===6)heal(target,3);
  if(id===7)heal(target,1);
  if([19,21].includes(id))shield(target,3);
  if(id===32){heal(target,1);shield(target,1);}
  if(id===10){b.link[s]=1;b.linkUntil[s]=b.round+1;}
  if([11,12,15,16,27].includes(id))recover(b,s,1,true);
  if(id===28)shield(u,1);
  process(b,events);return true;
 }
 function ready(b,s){return team(b,s).map((u,i)=>u.ready&&alive(u)&&!frozen(b,u)?i:-1).filter(i=>i>=0);}
 function autoCombos(b,s){let n=0;while(ready(b,s).length&&b.winner===null&&n++<8)combo(b,s,ready(b,s)[0]);}
 function itemStatus(b,s,allyIndex){
  const item=b.items[s],u=team(b,s)[allyIndex],[first,max,cost,cd]=itemConfig[item.id],remaining=max-item.used,wait=Math.max(0,Math.max(first,item.used?item.last+cd+1:first)-b.round);
  let reason='';if(b.winner!==null)reason='对局已结束';else if(b.priority!==s)reason='等待行动权';else if(remaining<=0)reason='次数已用尽';else if(wait)reason=`${wait}回合后可使用`;else if(!b.actions[s])reason='行动已用尽';else if(b.ap[s]<cost)reason='战术点不足';else if(!alive(u))reason='请选择存活队友';else if(item.id==='resource_cell'&&(b.ap[s]===3||b.actions[s]<2))reason='需资源未满且剩余2次行动';else if(['medkit','full_restore'].includes(item.id)&&u.hp===byId(u.id).hp)reason='目标已满血';else if(item.id==='barrier_generator'&&u.barrier)reason='已有次数屏障';else if(item.id==='cleanser'&&!['electric','vulnerable','burn','frozen'].some(k=>status(b,u,k)))reason='没有负面状态';else if(item.id==='reactivation'&&(!u.acted||frozen(b,u)||b.actions[s]<2))reason='需已行动队友和剩余2次行动';
  return {first,max,cost,cd,remaining,wait,reason,ready:!reason};
 }
 function validate(b,s,i,type,target=0,allyIndex=i){
  if(type==='combo')return ready(b,s).includes(i)?'':'连携尚未就绪';
  if(type==='item')return itemStatus(b,s,allyIndex).reason;
  if(b.winner!==null)return '对局已结束';if(b.priority!==s)return '等待行动权';if(b.actions[s]<=0)return '本轮行动已用尽';if(type==='pass')return '';
  const u=team(b,s)[i];if(!alive(u))return '角色已阵亡';if(frozen(b,u))return '本轮被冻结';if(u.acted)return '本轮已行动';
  const c=byId(u.id),a=type==='skill'?c.skill:type==='ultimate'?c.ultimate:null;
  if(a&&b.ap[s]<a.apCost)return '战术点不足';if(type==='ultimate'&&(u.ult||b.round<3))return u.ult?'本场已使用':'第3回合开放';
  if(a&&!b.decks[s].hand.some(x=>x.id===u.id&&x.type===type))return '未持有技能牌';
  if(type!=='defend'&&range(u,type)!=='friendly'&&!validTarget(b,s,target,u,type))return '目标受前排保护或已阵亡';
  if((a?.primaryEffect!=='damage'&&a||u.id===7&&type==='skill')&&!alive(team(b,s)[allyIndex]))return '请选择存活队友';return '';
 }
 function advance(b,s){b.actions[s]--;b.turns++;if(!b.actions[0]&&!b.actions[1]){b.roundPending=true;b.priority=-1;}else b.priority=b.actions[1-s]>0?1-s:s;}
 function action(b,s,i,type,target=0,allyIndex=i){
  if(type==='combo')return combo(b,s,i);if(validate(b,s,i,type,target,allyIndex))return false;
  const units=team(b,s),u=units[i],events=[],root=++b.rootSeq;
  if(type==='pass'){advance(b,s);return true;}
  if(type==='item'){
   const x=b.items[s],v=units[allyIndex],st=itemStatus(b,s,allyIndex);b.ap[s]-=st.cost;x.used++;x.last=b.round;
   if(x.id==='resource_cell')b.ap[s]=3;if(x.id==='medkit')heal(v,10);if(x.id==='full_restore')heal(v,byId(v.id).hp);if(x.id==='barrier_generator'){v.barrier=1;v.barrierUntil=b.round+1;}
   if(x.id==='cleanser'){v.electric=false;v.vulnerable=false;v.burn=0;v.frozen=0;}if(x.id==='reactivation')v.acted=false;
   if(s===0){b.itemUsed=x.used;b.itemLast=x.last;}advance(b,s);return true;
  }
  const c=byId(u.id),a=type==='skill'?c.skill:type==='ultimate'?c.ultimate:null;u.acted=true;
  if(a){b.ap[s]-=a.apCost;const hand=b.decks[s].hand,k=hand.findIndex(x=>x.id===u.id&&x.type===type),card=hand.splice(k,1)[0];b.decks[s][type==='ultimate'?'removed':'discard'].push(card);}
  if(type==='ultimate')u.ult=true;
  if(type==='defend')shield(u,4);
  else if(a&&a.primaryEffect!=='damage'){
   const targets=a.target.includes('全体')?units.filter(alive):[units[allyIndex]];
   targets.forEach(v=>a.primaryEffect==='heal'?heal(v,a.value):shield(v,a.value));
   if(type==='skill'&&[6,21,32].includes(u.id))units[allyIndex].shelter={protector:i};
   if(type==='ultimate'&&[6,21].includes(u.id))heal(u,4);
   if(type==='ultimate'&&[5,19].includes(u.id))shield(units[allyIndex],u.id===5?3:5);
   if(u.id===12)recover(b,s,type==='ultimate'?2:1);
   if(u.id===19&&type==='skill')u.crystal={charges:2,until:b.round+1};
   if(u.id===29)u.vocalist=b.round+1;
  }else{
   const enemies=team(b,1-s),r=range(u,type),targets=r==='all_enemies'?enemies.map((_,k)=>k).filter(k=>alive(enemies[k])):r==='front_only'?[0,1].filter(k=>alive(enemies[k])):[target];
   const post=[];let refund=false;
   for(const ti of targets){
    const cond={link:!!a&&ti===target};
    if(type==='skill'&&[1,10].includes(u.id))cond.vulnerableBonus=3;
    if(type==='skill'&&u.id===26)cond.electricBonus=3;
    if(type==='skill'&&u.id===11)cond.consumeElectric=true;
    if(type==='skill'&&u.id===8||type==='ultimate'&&u.id===4)cond.burn=2;
    if(type==='ultimate'&&u.id===9)cond.freeze=2;
    if(u.id===14&&a||u.id===31&&type==='skill'){cond.hitElement=u.id===14?'寒冷':'自然';cond.hitCount=type==='ultimate'?2:1;cond.hitBonus=type==='ultimate'?2:1;}
    const hit=damage(b,s,i,ti,a?a.value:c.atk,a?.damageElement||c.element,type,root,events,cond);if(!hit)continue;
    post.push({hit,main:ti===target});
    if(type==='skill'&&u.refundRound!==b.round&&(u.id===11&&hit.consumed==='electric'||u.id===15&&hit.consumed==='vulnerable'||u.id===27&&hit.pre.burn)){refund=true;u.refundRound=b.round;}
   }
   for(const {hit,main} of post){
    if(!a||!alive(hit.u))continue;let keys=[];
    if(type==='skill'){
     if([2,13,16,18,24,28,30].includes(u.id))keys.push('vulnerable');
     if(u.id===3)keys.push('electric');if([4,25].includes(u.id))keys.push('burn');if([9,22].includes(u.id))keys.push('frozen');
     if(u.id===20){u.focus={side:1-s,target:hit.index,until:b.round+1};keys.push('electric');}
     if(u.id===27&&hit.pre.burn){hit.u.burn=0;events.push({type:'consume',side:s,actor:i,targetSide:1-s,target:hit.index,key:'burn',root});}
    }else if(type==='ultimate'){
     if([1,25].includes(u.id)||main&&[13,22,30].includes(u.id))keys.push('vulnerable');
     if(main&&[3,17,20,26].includes(u.id))keys.push('electric');if([8,27].includes(u.id))keys.push('burn');if(main&&u.id===24)keys.push('frozen');
    }
    keys.forEach(key=>applyStatus(b,s,i,1-s,hit.index,key,root,events));
   }
   if(refund)recover(b,s,1);
   if(type==='ultimate'&&[11,15,16,27].includes(u.id))recover(b,s,1);
   if(u.id===7&&type==='skill'){shield(u,5);units[allyIndex].shelter={protector:i};}
   if(u.id===7&&type==='ultimate')shield(u,8);
   if(u.id===28&&a)shield(u,type==='skill'?3:4);
   if(u.id===32&&type==='ultimate')heal(u,5);
  }
  advance(b,s);process(b,events);return true;
 }
 function cycle(b,s,index){const d=b.decks[s];if(b.winner!==null||b.priority!==s||b.actions[s]!==3||d.cycled||!d.hand[index])return false;d.discard.push(d.hand.splice(index,1)[0]);draw(b,s,1);d.cycled=true;return true;}
 function endRound(b){
  if(!b.roundPending||b.winner!==null)return false;
  for(const units of [b.own,b.enemy])for(const u of units){if(alive(u)&&u.burn>=b.round){const x=Math.min(u.shield,2);u.shield-=x;u.hp=Math.max(0,u.hp-2+x);}}
  if(win(b))return true;
  const fatigue=b.round>=config.fatigueStart?(b.round-config.fatigueStart+1)*config.fatigueStep:0;
  if(fatigue){for(const units of [b.own,b.enemy])for(const u of units)if(alive(u))u.hp=Math.max(0,u.hp-fatigue);log(b,`轮末战场压力：双方存活角色失去${fatigue}生命。`);}
  if(win(b))return true;
  if(b.round>=config.maxRounds){const score=units=>[units.filter(alive).length,units.reduce((x,u)=>x+u.hp,0)];const a=score(b.own),e=score(b.enemy);b.winner=a[0]===e[0]?(a[1]===e[1]?2:a[1]>e[1]?0:1):a[0]>e[0]?0:1;return true;}
  for(let s=0;s<2;s++){
   for(const u of team(b,s)){u.shelter=null;if(u.barrierUntil<=b.round)u.barrier=0;if(u.electricUntil<=b.round)u.electric=false;if(u.vulnerableUntil<=b.round)u.vulnerable=false;if(u.crystal?.until<=b.round)u.crystal=null;if(u.focus?.until<=b.round)u.focus=null;u.shield=0;u.acted=false;u.combo=false;u.comboTriggered=false;u.ready=null;}
   if(b.linkUntil[s]<=b.round)b.link[s]=0;b.decks[s].cycled=false;draw(b,s,2);
  }
  b.round++;b.ap=[3,3];b.actions=[3,3];b.comboRefund=[0,0];b.roundPending=false;b.initiative=1-b.initiative;b.priority=b.initiative;b.ledger={};log(b,`第${b.round}回合开始。`);return true;
 }
 function chooseAI(b,s,style='balanced'){
  const choices=[];const units=team(b,s),enemies=team(b,1-s),injured=lowest(b,s);
  if(injured>=0&&!itemStatus(b,s,injured).reason){const item=b.items[s].id,u=units[injured],missing=byId(u.id).hp-u.hp;let score=-10;if(item==='full_restore')score=missing*.85-8;if(item==='medkit')score=Math.min(missing,10)-2;if(item==='resource_cell')score=b.decks[s].hand.length>1&&b.ap[s]===0?8:0;if(item==='cleanser'&&u.frozen>=b.round)score=7;if(item==='barrier_generator')score=u.hp<15?10:3;if(item==='reactivation')score=4;choices.push({type:'item',i:injured,target:0,ally:injured,score});}
  for(let i=0;i<4;i++)for(const type of ['attack','skill','ultimate','defend']){
   const u=units[i],c=byId(u.id),a=type==='skill'?c.skill:type==='ultimate'?c.ultimate:null;
   const friendly=a&&a.primaryEffect!=='damage',targets=friendly?[injured]:type==='defend'?[0]:enemies.map((_,k)=>k);
   for(const t of targets){const ally=friendly?t:injured;if(validate(b,s,i,type,t,ally))continue;let score=0;
    if(type==='defend')score=style==='defensive'&&i<2?3:0;
    else if(friendly){const count=a.target.includes('全体')?units.filter(alive):[units[t]];score=count.reduce((v,x)=>v+(a.primaryEffect==='heal'?Math.min(a.value,byId(x.id).hp-x.hp)*(style==='defensive'?1.3:1):Math.min(a.value,config.shieldCap-x.shield)*(units.indexOf(x)<2?.75:.35)),0);if(type==='skill'&&[6,21,32].includes(u.id))score+=3;if(u.id===12)score+=2;}
    else {const r=range(u,type),ts=r==='all_enemies'?enemies.filter(alive):r==='front_only'?enemies.slice(0,2).filter(alive):[enemies[t]],n=a?a.value:c.atk;score=ts.reduce((v,x)=>v+Math.min(x.hp+x.shield,n+(x.vulnerable||x.electric?2:0))+(x.hp+x.shield<=n?9:0),0);score+=Math.max(0,1-enemies[t].hp/byId(enemies[t].id).hp)*3;if(type==='skill'&&[9,22].includes(u.id)&&enemies[t].frozen<b.round)score+=4;if(type==='skill'&&[2,3,4,13,16,18,24,25,28,30].includes(u.id))score+=2;if(style==='aggressive')score*=1.15;}
    if(type==='skill'&&[11,15,27].includes(u.id)&&alive(enemies[t])){const mark=u.id===11?'electric':u.id===15?'vulnerable':'burn';if(status(b,enemies[t],mark))score+=3;}
    if(type==='skill'&&u.id===20)score+=3;
    if(a)score-=1;if(type==='ultimate')score-=.5;choices.push({i,type,target:t,ally,score});
   }
  }
  choices.sort((a,z)=>z.score-a.score||a.i-z.i||a.target-z.target);return choices[0]||{i:0,type:'pass',target:0,ally:0};
 }
 function playAI(b,s,style='balanced'){
  autoCombos(b,s);if(win(b)||b.priority!==s)return;
  const d=b.decks[s];if(b.actions[s]===3&&!d.cycled){const ix=d.hand.findIndex(x=>!alive(team(b,s).find(u=>u.id===x.id)));if(ix>=0)cycle(b,s,ix);}
  const a=chooseAI(b,s,style);action(b,s,a.i,a.type,a.target,a.ally);autoCombos(b,s);
 }
 return {config,byId,create,team,frozen,range,validTarget,heal,shield,win,action,validate,combo,ready,autoCombos,itemStatus,itemConfig,endRound,cycle,playAI,chooseAI,lowest};
});

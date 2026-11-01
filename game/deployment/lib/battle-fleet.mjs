// Keep historical matches on their original immutable rules contract.
export function createBattleFleet({config,makeAccess,...dependencies}) {
 function attach(access,id,label,teamCostCap){
  access.mode={id,label,contract:access.address,teamCostCap};access.teamCostCap=teamCostCap;
  const snapshot=access.snapshot;
  access.snapshot=async(...args)=>({...await snapshot(...args),battleMode:id,teamCostCap,ruleLabel:label});
  return access;
 }
 const current=attach(makeAccess({config,...dependencies}),'current20','新版 · 20费',20),all=[current],known=new Set([String(current.address).toLowerCase()]);
 for(const previous of config.previousBattleContracts||[]) {
  const address=previous.address;
  if(!/^0x[0-9a-f]{40}$/i.test(address||''))throw Error('Invalid archived battle contract');
  if(known.has(address.toLowerCase()))continue;
  known.add(address.toLowerCase());
  all.push(attach(makeAccess({...dependencies,config:{...config,battleContract:address,battleDeploymentBlock:previous.deploymentBlock}}),previous.mode||'legacy16','旧版 · 16费',16));
 }
 const owners=new Map();
 async function resolve(id) {
  if(owners.has(id))return owners.get(id);
  for(const access of all)if(access.enabled) {
   const info=await access.contract.getInfo(id);
   if(info.exists){owners.set(id,access);return access;}
  }
  throw Error('链上对局不存在');
 }
 const modes=all.filter(x=>x.enabled).map(x=>x.mode).sort((a,b)=>a.teamCostCap-b.teamCostCap);
 const forMode=(id='current20')=>{const access=all.find(x=>x.enabled&&x.mode.id===id);if(!access)throw Error('未知对战规则版本');return access;};
 return {...current,addresses:all.filter(x=>x.enabled).map(x=>x.address),modes,forMode,resolve,
  load:async(id,...args)=>(await resolve(id)).load(id,...args),
  snapshot:async(id,...args)=>(await resolve(id)).snapshot(id,...args),
  journal:async(id,...args)=>(await resolve(id)).journal(id,...args),
  reward:async(id,...args)=>(await resolve(id)).reward(id,...args),
  rooms:async()=>(await Promise.all(all.map(async x=>(await x.rooms()).map(r=>({...r,battleMode:x.mode.id,ruleLabel:x.mode.label,teamCostCap:x.teamCostCap,battleContract:x.address}))))).flat().slice(0,30),
  history:async w=>(await Promise.all(all.map(async x=>(await x.history(w)).map(r=>({...r,battleMode:x.mode.id,ruleLabel:x.mode.label,teamCostCap:x.teamCostCap,battleContract:x.address}))))).flat().sort((a,b)=>Number(b.finished||0)-Number(a.finished||0)).slice(0,30),
  active:async w=>{for(const access of all){const id=await access.active(w);if(id){owners.set(id,access);return id;}}return null;},
  tickAI:async()=>{for(const access of all)await access.tickAI();}
 };
}

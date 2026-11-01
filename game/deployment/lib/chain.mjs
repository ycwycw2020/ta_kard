import fs from 'node:fs';
import {JsonRpcProvider,Wallet,NonceManager,Contract,hexlify,randomBytes,keccak256} from 'ethers';
export const config=JSON.parse(fs.readFileSync('private/config.json','utf8'));
export const artifact=JSON.parse(fs.readFileSync('build/TalosCards.json','utf8'));
export const provider=new JsonRpcProvider(config.rpc,config.chainId,{staticNetwork:true});
provider.pollingInterval=500;
export const cards=new Contract(config.contract,artifact.abi,provider);
export const rewardWallet=new Wallet(config.wallets.reward.privateKey);
export const rewardTypes={Reward:[['deploymentId','bytes32'],['matchId','bytes32'],['playerA','address'],['playerB','address'],['mode','uint8'],['winner','address'],['finishedAt','uint256'],['rewardEpoch','uint256'],['rewardRulesVersion','bytes32'],['battleRulesHash','bytes32'],['rosterSnapshotHash','bytes32'],['replayHash','bytes32'],['validUntil','uint256']].map(([name,type])=>({name,type}))};
export const rewardDomain={name:'TalosCards',version:'1',chainId:config.chainId,verifyingContract:config.contract};
export async function collection(address){if(config.itemsContract){const {inventory,countsOf}=await import('./items.mjs');return countsOf(await inventory(address));}const ids=Array.from({length:32},(_,c)=>Array.from({length:18},(_,s)=>(c+1)*100+s+1)).flat();const values=await cards.balanceOfBatch(ids.map(()=>address),ids);return Object.fromEntries(ids.filter((id,i)=>values[i]>0n).map(id=>[id,Number(values[ids.indexOf(id)])]));}
export async function ownsTeam(address,team){if(config.itemsContract)return (await import('./items.mjs')).checkTeam(address,team);const ids=team.map(x=>x.id*100+x.skin+1),v=await cards.balanceOfBatch(ids.map(()=>address),ids);if(v.some(x=>x===0n))throw Error('编队含有钱包尚未持有的卡面');}
const grantSigner=new NonceManager(new Wallet(config.wallets.admin.privateKey,provider));
let grantQueue=Promise.resolve();
export function runAdmin(fn){
 const result=grantQueue.then(async()=>{try{return await fn(grantSigner);}catch(e){grantSigner.reset();throw e;}});
 grantQueue=result.catch(()=>{});return result;
}
export function ensureTestAccess(player){return runAdmin(async signer=>{if(!await cards.starterClaimed(player))await(await cards.connect(signer).grantTestAccounts([player],{gasPrice:0})).wait();});}
let running=false;
export async function mintWorker(){
 if(running)return;running=true;
 try{
  const signer=new Wallet(config.wallets.seeder.privateKey,provider),contract=cards.connect(signer);
  const count=Number(await cards.seedCount()),next=Number(await cards.nextSeedId());
  if(count-next<16){
   const batch=Array.from({length:64},()=>hexlify(randomBytes(32)));
   // Persist before broadcast: a crash cannot lose the preimage of an on-chain commitment.
   config.seeds.splice(count,config.seeds.length-count,...batch);
   fs.writeFileSync('private/config.json.tmp',JSON.stringify(config,null,2));fs.renameSync('private/config.json.tmp','private/config.json');
   await(await contract.commitSeeds(batch.map(keccak256),{gasPrice:0})).wait();
  }
  const latest=await provider.getBlockNumber(),requests=Number(await cards.requestCount());
  for(let id=1;id<=requests;id++){
   const r=await cards.requests(id);if(Number(r.state)!==1)continue;
   if(latest>Number(r.deadlineBlock)){await(await contract.refundExpired(id,{gasPrice:0})).wait();continue;}
   const seed=config.seeds[Number(r.seedId)-1];if(seed)await(await contract.fulfillMint(id,seed,{gasPrice:0})).wait();
  }
 }catch(e){console.error('Mint worker:',e.shortMessage||e.message);}finally{running=false;}
}

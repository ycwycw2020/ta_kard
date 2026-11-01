import fs from 'node:fs';
import {Contract} from 'ethers';
import {config,provider,cards,runAdmin} from './chain.mjs';
export const itemsArtifact=config.itemsContract?JSON.parse(fs.readFileSync('build/TalosCardItems.json','utf8')):null;
export const items=itemsArtifact?new Contract(config.itemsContract,itemsArtifact.abi,provider):null;
const pendingPlayers=new Map(),recent=new Map();
const faceIds=Array.from({length:32},(_,c)=>Array.from({length:18},(_,s)=>(c+1)*100+s+1)).flat();
export function itemValue(x){return {tokenId:x.tokenId.toString(),artworkId:Number(x.artworkId),owner:x.owner.toLowerCase(),priceWei:x.price.toString(),revision:x.revision.toString()};}
export async function ensureMaterialized(player){
 if(!items)return;if(pendingPlayers.has(player))return pendingPlayers.get(player);if(Date.now()-(recent.get(player)||0)<4000)return;
 const job=(async()=>{
  const values=await cards.balanceOfBatch(faceIds.map(()=>player),faceIds);const owned=faceIds.filter((id,i)=>values[i]>0n);
  for(let offset=0;offset<owned.length;offset+=64){const page=owned.slice(offset,offset+64);
   for(;;){const pending=await items.pendingFor(player,page);if(!pending.some(n=>n>0n))break;
    await runAdmin(async signer=>{await(await items.connect(signer).materializeFor(player,page,64,{gasPrice:0})).wait();});
   }
  }
  recent.set(player,Date.now());if(recent.size>2000)recent.clear();
 })();pendingPlayers.set(player,job);try{await job;}finally{pendingPlayers.delete(player);}
}
export async function inventory(player,{materialize=true}={}){
 if(!items)return [];if(materialize)await ensureMaterialized(player);
 // Read a consistent block snapshot so transfers cannot corrupt offset pagination.
 const blockTag=await provider.send('eth_blockNumber',[]),size=Number(await items.balanceOf(player,{blockTag})),result=[];
 for(let offset=0;offset<size;offset+=64)result.push(...(await items.itemsOf(player,offset,64,{blockTag})).map(itemValue));
 return result.sort((a,b)=>BigInt(a.tokenId)<BigInt(b.tokenId)?-1:1);
}
export const countsOf=list=>list.reduce((out,x)=>(out[x.artworkId]=(out[x.artworkId]||0)+1,out),{});
export async function checkTeam(player,team){
 const all=await inventory(player);
 for(const card of team){const matches=all.filter(x=>x.artworkId===card.id*100+card.skin+1),chosen=card.tokenId?matches.find(x=>x.tokenId===String(card.tokenId)):matches[0];if(!chosen)throw Error('编队卡牌已不属于本钱包，请重新选择卡面与编号。');card.tokenId=chosen.tokenId;}
}
export async function marketPage(player,offset=0){
 if(!items)throw Error('唯一编号与商城合约尚未启用');if(!Number.isSafeInteger(offset)||offset<0)throw Error('分页参数无效');
 const blockTag=await provider.send('eth_blockNumber',[]);
 const [count,list,balance,withdrawable]=await Promise.all([items.listedCount({blockTag}),items.listedItems(offset,24,{blockTag}),provider.getBalance(player,blockTag),items.proceeds(player,{blockTag})]);
 return {contract:config.itemsContract,total:Number(count),offset,pageSize:24,items:list.map(itemValue),balanceWei:balance.toString(),withdrawableWei:withdrawable.toString(),blockNumber:Number(BigInt(blockTag)),currency:'TEST ETH'};
}

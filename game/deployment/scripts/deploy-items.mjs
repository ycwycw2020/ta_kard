import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {JsonRpcProvider,Wallet,ContractFactory,Contract} from 'ethers';
import {Pool} from 'pg';
const config=JSON.parse(fs.readFileSync('private/config.json','utf8')),artifact=JSON.parse(fs.readFileSync('build/TalosCardItems.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('adaptive-node/installer-manifest.json','utf8'));
const provider=new JsonRpcProvider(config.rpc,config.chainId,{staticNetwork:true,cacheTimeout:0}),db=new Pool(config.db);
try{
 assert.equal(Number(BigInt(await provider.send('eth_chainId',[]))),manifest.chainId);
 assert.equal((await provider.getBlock(0)).hash,manifest.genesisBlockHash,'Refusing another chain');
 const originalContract=config.contract,resetId=config.walletResetId;
 await db.query(fs.readFileSync('schema.sql','utf8'));
 let nft;
 if(config.itemsContract){nft=new Contract(config.itemsContract,artifact.abi,provider);assert.equal((await nft.sourceCollection()).toLowerCase(),config.contract.toLowerCase());}
 else{
  nft=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,new Wallet(config.wallets.admin.privateKey,provider)).deploy(config.contract,'http://localhost:8787/api/item-metadata/',{gasPrice:0});
  const receipt=await nft.deploymentTransaction().wait();config.itemsContract=await nft.getAddress();config.itemsDeployBlock=receipt.blockNumber;config.itemsDeployTx=receipt.hash;
  fs.writeFileSync('private/config.json.items-tmp',JSON.stringify(config,null,2));fs.renameSync('private/config.json.items-tmp','private/config.json');
 }
 const code=await provider.getCode(config.itemsContract);
 const publicInfo={name:'TalosCardItems',standard:'ERC-721 Enumerable + fixed-price marketplace',chainId:config.chainId,address:config.itemsContract,sourceCollection:config.contract,deployBlock:config.itemsDeployBlock,deployTransaction:config.itemsDeployTx,runtimeBytecodeSha256:crypto.createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex'),serialFormat:'QCCC RRRRRRRR HHHH',qualityCodes:{normal:1,fine:2,exquisite:3},characterCodes:'001-032',checksum:'uint256(keccak256(UTF-8 first 12 decimal digits)) % 10000; decimal, padded to four digits',checksumIsEncryption:false,newChainCreated:false};
 fs.writeFileSync('items-deployment.json',JSON.stringify(publicInfo,null,2));
 const {inventory,countsOf,items}=await import('../lib/items.mjs');const {cards}=await import('../lib/chain.mjs');
 const players=(await db.query('SELECT address FROM profiles ORDER BY address')).rows.map(x=>x.address),ids=Array.from({length:32},(_,c)=>Array.from({length:18},(_,s)=>(c+1)*100+s+1)).flat();const snapshots=[];
 for(const player of players){
  const credits=await cards.credits(player),beforeItems=await inventory(player,{materialize:false}),expected=countsOf(beforeItems);
  for(let offset=0;offset<ids.length;offset+=64){const page=ids.slice(offset,offset+64),pending=await items.pendingFor(player,page);for(let i=0;i<page.length;i++)if(pending[i]>0n)expected[page[i]]=(expected[page[i]]||0)+Number(pending[i]);}
  const list=await inventory(player);assert.deepEqual(countsOf(list),expected,'Card counts changed during numbering');assert.equal(await cards.credits(player),credits);
  for(const x of list)assert.equal(await items.verifyIdentifier(x.tokenId),true);
  snapshots.push({player,cards:list.length,credits:credits.toString(),uniqueIdsValid:true});console.log('Numbered existing player',snapshots.length,'/',players.length,'cards',list.length);
 }
 assert.equal(config.contract,originalContract);assert.equal(config.walletResetId,resetId);
 // Rewind only the event cursor; primary-key deduplication preserves old events/balances.
 const cursor=(await db.query('SELECT block_number FROM indexer_state WHERE id=1')).rows[0];
 if(Number(cursor.block_number)>=config.itemsDeployBlock){const at=config.itemsDeployBlock-1,block=await provider.getBlock(at);await db.query('UPDATE indexer_state SET block_number=$1,block_hash=$2,updated=now() WHERE id=1',[at,block.hash]);}
 const report={completedAt:new Date().toISOString(),passed:true,...publicInfo,existingPlayers:snapshots,existingCardCountsPreserved:true,existingCreditsPreserved:true,walletResetIdUnchanged:true,originalMintContractUnchanged:true};
 fs.writeFileSync('items-migration-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,itemsContract:config.itemsContract,players:players.length,totalSupply:(await items.totalSupply()).toString(),newChainCreated:false}));
 // The imported application provider has its own sockets.
 (await import('../lib/chain.mjs')).provider.destroy();
}finally{await db.end();provider.destroy();}

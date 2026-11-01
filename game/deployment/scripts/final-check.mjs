import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {Contract,JsonRpcProvider} from 'ethers';

// Read-only deployment check; an empty fresh chain is valid.
const c=JSON.parse(fs.readFileSync('private/config.json','utf8'));
const a=JSON.parse(fs.readFileSync('build/TalosCards.json','utf8'));
const db=new Pool(c.db),ps=c.nodeRPCs.map(url=>new JsonRpcProvider(url,c.chainId,{staticNetwork:true}));
try {
 const readNodes=()=>Promise.all(ps.map(async(p,i)=>({node:i+1,height:parseInt(await p.send('eth_blockNumber',[]),16),peers:parseInt(await p.send('net_peerCount',[]),16),chainId:Number(BigInt(await p.send('eth_chainId',[])))})));
 let nodes=await readNodes();
 const initialHeights=nodes.map(n=>n.height),started=Date.now();
 do {
  await new Promise(resolve=>setTimeout(resolve,1000));
  nodes=await readNodes();
  if(nodes.every((n,i)=>n.height>initialHeights[i]))break;
 } while(Date.now()-started<30000);
 assert.ok(nodes.every((n,i)=>n.height>initialHeights[i]),'RPC is reachable but the chain is not advancing on every validator');
 const liveness={initialHeights,finalHeights:nodes.map(n=>n.height),observedMs:Date.now()-started,allValidatorsAdvanced:true};
 assert.ok(nodes.every(n=>n.chainId===c.chainId),'A node is on a different chain ID');
 assert.ok(nodes.every(n=>n.peers>=2),'Each original validator must reach at least two peers');
 const height=Math.min(...nodes.map(n=>n.height));
 assert.ok(height>=c.deployBlock,'A node has not reached the contract deployment');
 const blocks=await Promise.all(ps.map(p=>p.getBlock(height)));
 assert.equal(new Set(blocks.map(b=>b.hash)).size,1,'Common-height block hashes differ');
 const genesis=await Promise.all(ps.map(p=>p.getBlock(0)));
 assert.equal(new Set(genesis.map(b=>b.hash)).size,1,'Genesis block hashes differ');
 const validators=await ps[0].send('qbft_getValidatorsByBlockNumber',['latest']);
 assert.equal(validators.length,3,'Original three-validator topology changed');
 const codes=await Promise.all(ps.map(p=>p.getCode(c.contract,height)));
 assert.notEqual(codes[0],'0x','No contract code at the configured address');
 assert.equal(new Set(codes).size,1,'Contract code differs across nodes');
 const contract=new Contract(c.contract,a.abi,ps[0]);
 const requestCount=Number(await contract.requestCount());
 let ix;
 for(let i=0;i<40;i++){
  ix=(await db.query('SELECT block_number,block_hash,updated FROM indexer_state WHERE id=1')).rows[0];
  if(Number(ix?.block_number)>=height)break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.ok(Number(ix?.block_number)>=height,'Indexer did not catch up within 20 seconds');
 const indexedBlock=await ps[0].getBlock(Number(ix.block_number));
 assert.equal(ix.block_hash,indexedBlock.hash,'Indexer cursor hash differs from chain');
 const counts={};
 for(const table of ['profiles','matches','actions','card_balances','card_instances'])counts[table]=Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
 let numberedCards=null;
 if(c.itemsContract){
  const itemCodes=await Promise.all(ps.map(p=>p.getCode(c.itemsContract,height)));
  assert.notEqual(itemCodes[0],'0x','Numbered card contract missing');assert.equal(new Set(itemCodes).size,1,'Numbered card contract differs across nodes');
  const artifact=JSON.parse(fs.readFileSync('build/TalosCardItems.json','utf8'));
  const nft=new Contract(c.itemsContract,artifact.abi,ps[0]);assert.equal((await nft.sourceCollection()).toLowerCase(),c.contract.toLowerCase());
  const totalSupply=Number(await nft.totalSupply({blockTag:height}));
  assert.equal(counts.card_instances,totalSupply,'Numbered card index count differs from chain');
  const samples=(await db.query('SELECT token_id::text,owner,artwork_id FROM card_instances ORDER BY token_id LIMIT 8')).rows;
  for(const row of samples){
   assert.ok(await nft.verifyIdentifier(row.token_id),'Invalid numbered card checksum');
   assert.equal(Number(await nft.artworkOf(row.token_id)),row.artwork_id,'Indexed artwork differs from contract');
   const owners=await Promise.all(ps.map(p=>new Contract(c.itemsContract,artifact.abi,p).ownerOf(row.token_id,{blockTag:height})));
   assert.ok(owners.every(owner=>owner.toLowerCase()===row.owner.toLowerCase()),'Indexed ownership differs across nodes');
  }
  numberedCards={contract:c.itemsContract,runtimeBytes:(itemCodes[0].length-2)/2,totalSupply,indexedCount:counts.card_instances,sampledIdentifiers:samples.length,ownershipConsistent:true,format:'QCCC RRRRRRRR HHHH',checksum:'keccak256(UTF-8 first12 decimal digits) modulo 10000'};
 }
 const out={checkedAt:new Date().toISOString(),passed:true,readOnly:true,liveness,nodes,validatorCount:validators.length,commonBlock:{height,hash:blocks[0].hash},genesisBlockHash:genesis[0].hash,contract:c.contract,contractBytes:(codes[0].length-2)/2,mintRequests:requestCount,numberedCards,indexer:ix,databaseCounts:counts,profileCountMeaning:'Wallet account records, including QA wallets; not human player count or blockchain node count',databaseDirectory:'D:/card_endfiled/database'};
 fs.writeFileSync('runtime-verification.json',JSON.stringify(out,null,2));
 console.log(JSON.stringify(out,null,2));
} finally {await db.end();ps.forEach(p=>p.destroy());}

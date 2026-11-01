import fs from 'node:fs';
import {JsonRpcProvider,Wallet,ContractFactory} from 'ethers';
const c=JSON.parse(fs.readFileSync('private/config.json','utf8')),a=JSON.parse(fs.readFileSync('build/TalosCards.json','utf8'));
const p=new JsonRpcProvider(c.rpc,c.chainId,{staticNetwork:true});
if(c.contract&&await p.getCode(c.contract)!=='0x'){console.log('Existing contract preserved:',c.contract);process.exit(0);}
const f=new ContractFactory(a.abi,a.evm.bytecode.object,new Wallet(c.wallets.admin.privateKey,p));
const contract=await f.deploy(c.wallets.admin.address,c.wallets.seeder.address,c.wallets.reward.address,c.deploymentId,c.battleRulesHash,c.rewardRulesVersion,'http://localhost:8787/api/metadata/{id}','0x0000000000000000000000000000000000000000',{gasPrice:0});
const receipt=await contract.deploymentTransaction().wait();c.contract=await contract.getAddress();c.deployBlock=receipt.blockNumber;c.deployTx=receipt.hash;
fs.writeFileSync('private/config.json',JSON.stringify(c,null,2));fs.writeFileSync('contract-deployment.json',JSON.stringify({chainId:c.chainId,contract:c.contract,block:c.deployBlock,transaction:c.deployTx,deploymentId:c.deploymentId,battleRulesHash:c.battleRulesHash},null,2));
console.log('Contract deployed:',c.contract,'block',receipt.blockNumber);p.destroy();

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {JsonRpcProvider,Wallet,NonceManager,Contract,keccak256,concat} from 'ethers';
import {artifact,deployLinked,linkCode,maskImmutables} from './battle-artifacts.mjs';
const configFile=process.env.TALOS_CONFIG_PATH||'D:/card_endfiled/game/deployment/private/config.json';
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const provider=new JsonRpcProvider(config.rpc,config.chainId,{staticNetwork:true});
provider.pollingInterval=300;
const chain={chainId:BigInt(await provider.send('eth_chainId',[]))};if(chain.chainId!==20260926n)throw Error('Unexpected test chain');
if(!config.itemsContract||await provider.getCode(config.itemsContract)==='0x')throw Error('Existing ERC721 absent');
const rulesFiles=fs.readdirSync('contracts').filter(n=>/^TalosBattle.*\.sol$/.test(n)&&!n.includes('Harness')).sort().map(n=>'contracts/'+n);
const catalogBytes=fs.readFileSync('catalog.json');
const rulesHash=keccak256(concat([...rulesFiles.map(f=>fs.readFileSync(f)),catalogBytes]));
const catalogHash=keccak256(catalogBytes);
if(config.battleContract&&await provider.getCode(config.battleContract)!=='0x'){
    const previous=new Contract(config.battleContract,artifact('TalosBattle').abi,provider);
    if(await previous.rulesHash()===rulesHash){console.log('Matching battle deployment preserved:',config.battleContract);provider.destroy();process.exit(0);}
}
const signer=new NonceManager(new Wallet(config.wallets.admin.privateKey,provider));
const addresses={},receipts={};
// Reuse only byte-for-byte matching preflight libraries. Never reuse the test harness as the battle.
if(fs.existsSync('battle-preflight-deployments.json')){
    const preflight=JSON.parse(fs.readFileSync('battle-preflight-deployments.json','utf8'));
    for(const name of ['TalosBattleCatalog','TalosBattleEngine','TalosBattleRules','TalosBattleCombos']){
        const file='build/'+name+'.json',address=preflight.addresses?.[name];
        const digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if(address&&preflight.hashes?.[name+'.json']===digest&&await provider.getCode(address)!=='0x'){
            addresses[name]=address;
            if(preflight.receipts?.[name])receipts[name]=preflight.receipts[name];
        }
    }
}
const battleAddress=await deployLinked('TalosBattle',signer,addresses,receipts,[config.itemsContract,config.wallets.admin.address,rulesHash,catalogHash]);
const battle=new Contract(battleAddress,artifact('TalosBattle').abi,provider);
if((await battle.items()).toLowerCase()!==config.itemsContract.toLowerCase()||await battle.rulesHash()!==rulesHash||await battle.catalogHash()!==catalogHash)throw Error('Constructor verification failed');
const actualCode=await provider.getCode(battleAddress),a=artifact('TalosBattle');
const expected=linkCode(a,addresses,true);
if(maskImmutables(actualCode,a.evm.deployedBytecode.immutableReferences)!==maskImmutables(expected,a.evm.deployedBytecode.immutableReferences))throw Error('Runtime bytecode mismatch');
const proof={chainId:Number(chain.chainId),version:await battle.VERSION(),contract:battleAddress,block:receipts.TalosBattle.block,transaction:receipts.TalosBattle.transaction,itemsContract:config.itemsContract,aiOperator:config.wallets.admin.address,rulesHash,catalogHash,linkedLibraries:addresses,deployments:receipts,codeHash:keccak256(actualCode),runtimeVerifiedWithImmutableMask:true,sources:Object.fromEntries(rulesFiles.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),compiler:a.compiler,publicInformation:true,shield:{grant:12,cap:24,expires:'round end'},legacyRewardCompatibility:'Existing TalosCards EIP-712 reward entry retained; API derives the match outcome from TalosBattle.'};
fs.writeFileSync('battle-deployment.json',JSON.stringify(proof,null,2));
const target=path.dirname(path.dirname(configFile));
const stamp=new Date().toISOString().replaceAll(':','-');
fs.copyFileSync(configFile,configFile+'.before-battle-'+stamp);
config.battleContract=battleAddress;config.battleDeploymentBlock=proof.block;config.battleRulesVersion=proof.version;config.onchainBattleRulesHash=rulesHash;config.battleCatalogHash=catalogHash;
fs.writeFileSync(configFile,JSON.stringify(config,null,2));
fs.writeFileSync(path.join(target,'battle-deployment.json'),JSON.stringify(proof,null,2));
console.log(JSON.stringify({battleContract:battleAddress,rulesHash,block:proof.block,runtimeVerified:true}));
provider.destroy();

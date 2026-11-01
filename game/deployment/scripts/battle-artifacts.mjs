import fs from 'node:fs';
import {ContractFactory} from 'ethers';
export function artifact(name){return JSON.parse(fs.readFileSync('build/'+name+'.json','utf8'));}
export function linkCode(a,addresses,deployed=false){
    const code=deployed?a.evm.deployedBytecode:a.evm.bytecode;
    let hex=code.object;
    for(const libs of Object.values(code.linkReferences||{}))for(const [name,refs]of Object.entries(libs)){
        const address=addresses[name];if(!address)throw Error('Missing linked '+name);
        for(const ref of refs)hex=hex.slice(0,ref.start*2)+address.slice(2).toLowerCase()+hex.slice((ref.start+ref.length)*2);
    }
    if(!/^[0-9a-f]*$/i.test(hex))throw Error('Unlinked bytecode');
    return '0x'+hex;
}
export async function deployLinked(name,signer,addresses={},receipts={},args=[]){
    if(addresses[name])return addresses[name];
    const a=artifact(name);
    for(const libs of Object.values(a.evm.bytecode.linkReferences||{}))for(const dependency of Object.keys(libs))await deployLinked(dependency,signer,addresses,receipts);
    const factory=new ContractFactory(a.abi,linkCode(a,addresses),signer);
    const contract=await factory.deploy(...args,{gasPrice:0,gasLimit:29500000});
    const receipt=await contract.deploymentTransaction().wait();
    if(receipt.status!==1)throw Error('Deployment failed '+name);
    addresses[name]=await contract.getAddress();
    receipts[name]={address:addresses[name],transaction:receipt.hash,block:receipt.blockNumber,gasUsed:receipt.gasUsed.toString()};
    console.log('Deployed',name,addresses[name],'block',receipt.blockNumber);
    return addresses[name];
}
export function maskImmutables(code,references){
    let result=code.toLowerCase().replace(/^0x/,'');
    for(const ranges of Object.values(references||{}))for(const r of ranges)result=result.slice(0,r.start*2)+'0'.repeat(r.length*2)+result.slice((r.start+r.length)*2);
    return result;
}

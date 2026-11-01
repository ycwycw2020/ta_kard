import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
for(const name of ['TalosCards','TalosCardItems']){
const input={language:'Solidity',sources:{[name+'.sol']:{content:fs.readFileSync('contracts/'+name+'.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'london',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>({contents:fs.readFileSync(path.join('node_modules',p),'utf8')})}));
for(const e of output.errors||[]) console[e.severity==='error'?'error':'warn'](e.formattedMessage);
if(output.errors?.some(e=>e.severity==='error'))process.exit(1);
fs.mkdirSync('build',{recursive:true});fs.writeFileSync('build/'+name+'.json',JSON.stringify(output.contracts[name+'.sol'][name],null,2));
console.log('Compiled',name,'runtime bytes',output.contracts[name+'.sol'][name].evm.deployedBytecode.object.length/2);
}

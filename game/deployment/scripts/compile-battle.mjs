import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
const names=fs.readdirSync('contracts').filter(x=>/^TalosBattle.*\.sol$/.test(x));
const mainOnly=process.argv.includes('--main-only');
const outputs=['abi','evm.bytecode','evm.deployedBytecode','metadata'];
const input={language:'Solidity',sources:Object.fromEntries(names.map(n=>[n,{content:fs.readFileSync('contracts/'+n,'utf8')}])),settings:{optimizer:{enabled:true,runs:50},viaIR:true,evmVersion:'london',outputSelection:mainOnly?{'TalosBattle.sol':{'TalosBattle':outputs}}:{'*':{'*':outputs}}}};
const result=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{const file=name.startsWith('@')?path.join('node_modules',name):path.join('contracts',name);return fs.existsSync(file)?{contents:fs.readFileSync(file,'utf8')}:{error:'Missing import '+name};}}));
for(const e of result.errors||[])console[e.severity==='error'?'error':'warn'](e.formattedMessage);
if(result.errors?.some(x=>x.severity==='error'))process.exit(1);
fs.mkdirSync('build',{recursive:true});const report=[];
for(const [source,contracts]of Object.entries(result.contracts))for(const [name,artifact]of Object.entries(contracts))if(name.startsWith('TalosBattle')) {
    fs.writeFileSync('build/'+name+'.json',JSON.stringify({...artifact,source,compiler:solc.version()},null,2));
    const bytes=artifact.evm.deployedBytecode.object.length/2;
    report.push({name,bytes,linked:Object.keys(artifact.evm.bytecode.linkReferences)});
    if(bytes>24576)throw Error(name+' exceeds EIP-170: '+bytes);
}
if(mainOnly&&fs.existsSync('build/battle-compile-report.json')){
 const previous=JSON.parse(fs.readFileSync('build/battle-compile-report.json','utf8'));
 fs.writeFileSync('build/battle-compile-report.json',JSON.stringify([...previous.filter(x=>!report.some(y=>x.name===y.name)),...report],null,2));
}else fs.writeFileSync('build/battle-compile-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

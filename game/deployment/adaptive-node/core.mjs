import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const WINDOWS=process.platform==='win32';
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const exists=p=>fs.existsSync(p);
export const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function log(s){console.log(s);}
export function ipv4(s){if(net.isIP(s)!==4||s.startsWith('127.')||s==='0.0.0.0'||Number(s.split('.')[0])>=224)throw Error('请填写可互通的 IPv4 地址，例如 10.192.253.144。');return s;}
export function port(s){const n=Number(s);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('端口必须为1024～65535。');return n;}
export function inside(file,root){const rel=path.relative(path.resolve(root),path.resolve(file));return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
export function safeRoot(input){
 const p=path.resolve(input);
 if(p===path.parse(p).root||/[\r\n\x00]/.test(p))throw Error('安装目录必须是独立子目录。');
 let current=p;
 while(current!==path.dirname(current)){if(exists(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('安装路径不能经过符号链接或目录联接：'+current);current=path.dirname(current);}
 return p;
}
export function defaultRoot(){
 const candidates=WINDOWS?[path.join('D:\\','card_endfiled_node4'),path.join(process.env.LOCALAPPDATA||os.homedir(),'TalosCards','node')]:[path.join(os.homedir(),'talos-extra-node'),path.join(os.homedir(),'.local/share/talos/node')];
 const installed=candidates.filter(p=>exists(path.join(p,'node'))||exists(path.join(p,'.talos-install.json')));
 if(installed.length>1)throw Error('检测到多个已有节点，请用 --root 指定要安装或维护的目录：'+installed.join('；'));
 if(installed.length)return installed[0];
 if(WINDOWS&&exists('D:\\')){try{fs.accessSync('D:\\',fs.constants.W_OK);return candidates[0];}catch{}}
 return candidates[1];
}
export function parseToml(text){
 const out={};for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*([\w-]+)\s*=\s*(.*)$/);if(!m)continue;if(m[1] in out)throw Error('TOML存在重复配置：'+m[1]);let v=m[2].trim();if(v.startsWith('"')){try{v=JSON.parse(v);}catch{throw Error('无法读取 TOML 字符串：'+m[1]);}}else if(/^\d+$/.test(v))v=Number(v);out[m[1]]=v;}return out;
}
export function updateToml(text,changes){
 parseToml(text);let result=text;
 for(const [k,v]of Object.entries(changes)){const line=k+'='+JSON.stringify(v);const re=new RegExp('^\\s*'+k+'\\s*=[^\\r\\n]*','m');result=re.test(result)?result.replace(re,()=>line):result.trimEnd()+'\n'+line+'\n';}
 return result;
}
export function flattenPeers(value){
 const out=[];function visit(v,depth){if(depth>8)throw Error('节点列表嵌套过深');if(typeof v==='string'){if(!/^enode:\/\/[0-9a-fA-F]{128}@[0-9.]+:\d+(?:\?discport=\d+)?$/.test(v))throw Error('节点列表包含无效enode');out.push(v);}else if(Array.isArray(v)){v.forEach(x=>visit(x,depth+1));}else if(v&&'value'in v&&'Count'in v){visit(v.value,depth+1);}else throw Error('无法识别节点列表格式');}visit(value,0);if(!out.length||out.length>64)throw Error('节点列表数量错误');return out;
}
export async function probe(host,p,timeout=2500){
 return new Promise(resolve=>{const socket=net.createConnection({host,port:p,family:4});const end=result=>{socket.destroy();resolve(result);};socket.setTimeout(timeout);socket.once('connect',()=>end({ok:true,localIP:socket.localAddress}));socket.once('error',e=>end({ok:false,error:e.code}));socket.once('timeout',()=>end({ok:false,error:'TIMEOUT'}));});
}
export async function freePort(first,host='127.0.0.1',exclude=[]){
 for(let n=port(first);n<Math.min(Number(first)+100,65536);n++){if(exclude.includes(n))continue;const ok=await new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen({host,port:n,exclusive:true},()=>s.close(()=>resolve(true)));});if(ok)return n;}throw Error('未找到可用端口，请释放端口或自定义端口。');
}
export async function rpc(p,method,params=[]){
 const response=await fetch('http://127.0.0.1:'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(4000)});const value=await response.json();if(value.error)throw Error(value.error.message);return value.result;
}
export function inspect(root,manifest){
 root=safeRoot(root);let settings={},config={},text='';const state=exists(path.join(root,'.talos-install.json'))?readJson(path.join(root,'.talos-install.json')):null;
 if(exists(root)&&fs.readdirSync(root).filter(n=>n!=='install.lock').length&&!state&&!exists(path.join(root,'node'))&&!exists(path.join(root,'node-settings.json')))throw Error('该目录已有其他文件，请选择一个独立的节点目录。');
 for(const name of ['node','node/key','node/genesis.json','node/config.toml','node/static-nodes.json','node-settings.json']){const p=path.join(root,name);if(exists(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('节点文件不能是符号链接：'+name);}
 if(exists(path.join(root,'node-settings.json')))settings=readJson(path.join(root,'node-settings.json'));
 if(settings.chainId&&Number(settings.chainId)!==manifest.chainId)throw Error('安装目录属于另一条链，已保留原文件。');
 const genesis=path.join(root,'node/genesis.json');if(exists(genesis)&&sha(fs.readFileSync(genesis))!==manifest.genesisSha256)throw Error('已有创世文件与本游戏不一致，停止安装。');
 const cfg=path.join(root,'node/config.toml');if(exists(cfg)){text=fs.readFileSync(cfg,'utf8');config=parseToml(text);for(const k of ['data-path','node-private-key-file','genesis-file','static-nodes-file']){if(config[k]&&!inside(config[k],root))throw Error('已有配置指向安装目录以外，需人工核对：'+k);}for(const [k,n]of [['node-private-key-file','key'],['genesis-file','genesis.json'],['static-nodes-file','static-nodes.json']])if(config[k]&&path.resolve(config[k])!==path.resolve(root,'node',n))throw Error('已有节点使用非标准身份/配置文件位置，停止自动安装：'+k);}
 const key=path.join(root,'node/key'),data=config['data-path']||path.join(root,'node/data');
 if(exists(data)&&fs.lstatSync(data).isSymbolicLink())throw Error('链数据目录不能是符号链接。');
 if(exists(data)&&fs.readdirSync(data).length&&!exists(key))throw Error('已有链数据但节点密钥缺失，不能自动生成替代身份。');
 let publicKey='';const publicFile=path.join(root,'node/public-key.txt');if(exists(publicFile))publicKey=fs.readFileSync(publicFile,'utf8').trim().replace(/^0x/,'').replace(/^04(?=.{128}$)/,'');
 if(publicKey&&manifest.validatorPublicKeys.includes(publicKey.toLowerCase()))throw Error('这是原有验证者节点，外部节点安装器不会覆盖它。');
 if(settings.address&&exists(genesis)){const genesisText=fs.readFileSync(genesis,'utf8');if(JSON.parse(genesisText).extraData.toLowerCase().includes(settings.address.toLowerCase().replace(/^0x/,'')))throw Error('这是原有验证者节点，请使用原主机管理脚本。');}
 return {root,settings,config,text,state,publicKey,hasKey:exists(key),partial:exists(root),rpcPort:Number(settings.rpcPort||config['rpc-http-port']||(WINDOWS?8548:8545)),p2pPort:Number(settings.p2pPort||config['p2p-port']||(WINDOWS?30304:30303))};
}
export async function running(info,manifest){
 if(!(await probe('127.0.0.1',info.rpcPort,500)).ok)return false;
 try{const [id,block,enode]=await Promise.all([rpc(info.rpcPort,'eth_chainId'),rpc(info.rpcPort,'eth_getBlockByNumber',['0x0',false]),rpc(info.rpcPort,'net_enode')]);const pub=enode?.split('://')[1]?.split('@')[0];if(Number.parseInt(id,16)===manifest.chainId&&block.hash===manifest.genesisBlockHash&&info.publicKey&&pub===info.publicKey)return true;}catch{}
 // Occupied by another process: never treat it as this node, or stop it.
 return false;
}
export async function atomic(file,content){const temp=file+'.tmp-'+crypto.randomUUID();await fsp.mkdir(path.dirname(file),{recursive:true});try{await fsp.writeFile(temp,content);await fsp.rename(temp,file);}finally{if(exists(temp))await fsp.unlink(temp);}}
export async function transaction(root,changes){
 const changed=Object.entries(changes).filter(([p,data])=>!exists(p)||!fs.readFileSync(p).equals(Buffer.from(data)));
 if(!changed.length)return null;
 const backup=path.join(root,'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8));const done=[];
 await fsp.mkdir(backup,{recursive:true});
 try{for(const [file,data]of changed){if(!inside(file,root))throw Error('Refusing to write outside node root');const dest=path.join(backup,path.relative(root,file));const had=exists(file);if(had){await fsp.mkdir(path.dirname(dest),{recursive:true});await fsp.copyFile(file,dest);}await atomic(file,data);done.push({file,dest,had});}}
 catch(error){for(const x of done.reverse()){if(x.had)await fsp.copyFile(x.dest,x.file);else await fsp.unlink(x.file);}throw error;}
 return backup;
}
export async function lock(directory,name='install.lock'){
 await fsp.mkdir(directory,{recursive:true});const file=path.join(directory,name);
 for(let i=0;i<60;i++){
  try{const fd=await fsp.open(file,'wx');await fd.writeFile(JSON.stringify({pid:process.pid}));await fd.close();return async()=>{if(exists(file)&&readJson(file).pid===process.pid)await fsp.unlink(file);};}
  catch(e){if(e.code!=='EEXIST')throw e;let alive=true;try{process.kill(readJson(file).pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}if(!alive){await fsp.unlink(file);continue;}if(i%10===0)log('其他安装进程正在使用该目录，稍候…');await sleep(500);}
 }throw Error('该节点已有安装进程运行，请稍后重试。');
}
export async function fileHash(file){const h=crypto.createHash('sha256');for await(const block of fs.createReadStream(file))h.update(block);return h.digest('hex');}
export function run(command,args,opts={}){
 return new Promise((resolve,reject)=>{const proc=spawn(command,args,{windowsHide:true,...opts});let output='';if(proc.stdout)proc.stdout.on('data',d=>{output=(output+d).slice(-18000);});if(proc.stderr)proc.stderr.on('data',d=>{output=(output+d).slice(-18000);});proc.once('error',reject);proc.once('exit',code=>code===0?resolve(output):reject(Error(path.basename(command)+' 执行失败('+code+')：\n'+output)));});
}
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
export async function powershell(code){return run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); "+code,'utf16le').toString('base64')]);}
export async function download(spec,cache){
 if(path.basename(spec.file)!==spec.file||/[\\/]/.test(spec.file)||!/^\w[\w.-]+$/.test(spec.file))throw Error('下载文件名无效');
 await fsp.mkdir(cache,{recursive:true});const file=path.join(cache,spec.file),part=file+'.part';
 if(exists(file)&&await fileHash(file)===spec.sha256)return file;
 for(let attempt=1;attempt<=3;attempt++){
  try{const offset=exists(part)?fs.statSync(part).size:0;log(`下载 ${spec.file}（第${attempt}次${offset?'，继续已有下载':''}）`);const res=await fetch(spec.url,{headers:offset?{Range:'bytes='+offset+'-'}:{},signal:AbortSignal.timeout(600000)});if(res.status===416&&offset){if(await fileHash(part)===spec.sha256){await fsp.rename(part,file);return file;}await fsp.unlink(part);throw Error('续传文件超出有效范围，将重新下载');}if(!res.ok)throw Error('HTTP '+res.status);const append=offset>0&&res.status===206;if(append&&!res.headers.get('content-range')?.startsWith('bytes '+offset+'-'))throw Error('服务器返回的续传范围不匹配');await pipeline(Readable.fromWeb(res.body),fs.createWriteStream(part,{flags:append?'a':'w'}));if(await fileHash(part)!==spec.sha256){await fsp.unlink(part);throw Error('SHA-256 校验失败，将重新下载');}await fsp.rename(part,file);return file;}
  catch(e){if(attempt===3)throw Error(`下载未完成：${spec.file}。重新运行安装器会继续处理。\n${e.message}`);await sleep(1000);}
 }
}
export function runtimeFiles(runtime,m){return {runtime,java:path.join(runtime,m.javaFolder,'bin',WINDOWS?'java.exe':'java'),besu:path.join(runtime,'besu-'+m.besuVersion),lib:path.join(runtime,'besu-'+m.besuVersion,'lib')};}
export async function usableRuntime(runtime,m){
 if(!runtime)return false;const f=runtimeFiles(runtime,m);if(!exists(f.java)||!exists(f.lib)||fs.readdirSync(f.lib).filter(x=>x.endsWith('.jar')).length<10)return false;
 try{const result=await run(f.java,['-version']);return /version "25(?:\.|\")/.test(result);}catch{return false;}
}
export async function ensureRuntime(info,m,options={}){
 const cache=options.cache||path.join(WINDOWS?(process.env.LOCALAPPDATA||os.homedir()):path.join(os.homedir(),'.cache'),'TalosCards','runtime');
 const candidates=[options.runtime,info.settings.runtime,path.join(info.root,'runtime'),WINDOWS?'D:\\card_endfiled\\game\\deployment\\runtime':path.join(os.homedir(),'talos/runtime'),cache].filter(Boolean);
 for(const candidate of candidates){if(await usableRuntime(candidate,m)){log('复用 Java / Besu：'+candidate);return runtimeFiles(candidate,m);}}
 if(options.runtime)throw Error('指定运行环境不完整，需要包含 '+m.javaFolder+' 和 besu-'+m.besuVersion);
 if(options.offline)throw Error('离线模式找不到可用 Java / Besu，请指定 --runtime。');
 const unlock=await lock(cache,'runtime.lock');
 try{
  if(await usableRuntime(cache,m))return runtimeFiles(cache,m);
  for(const spec of [m.downloads.besu,WINDOWS?m.downloads.javaWin:m.downloads.javaLinux]){
   const archive=await download(spec,path.join(cache,'downloads'));const stage=path.join(cache,'.stage-'+crypto.randomUUID());await fsp.mkdir(stage);
   try{
    if(spec.format==='zip'){if(WINDOWS)await powershell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(stage)}`);else await run('unzip',['-q',archive,'-d',stage]);}
    else await run('tar',['-xf',archive,'-C',stage]);
    const folder=spec===m.downloads.besu?'besu-'+m.besuVersion:m.javaFolder;const target=path.join(cache,folder),extracted=path.join(stage,folder);if(!exists(extracted))throw Error('下载归档缺少预期目录：'+folder);
    if(exists(target))await fsp.rename(target,target+'.incomplete-'+Date.now());await fsp.rename(extracted,target);
   }finally{if(inside(stage,cache)&&path.basename(stage).startsWith('.stage-'))await fsp.rm(stage,{recursive:true,force:true});}
  }
  if(!WINDOWS)await fsp.chmod(runtimeFiles(cache,m).java,0o755);
  if(!await usableRuntime(cache,m))throw Error('Java / Besu 安装后验证失败，原节点身份保留。');
  return runtimeFiles(cache,m);
 }finally{await unlock();}
}
export function javaArgs(runtime,config){return [
 '-Dvertx.disableFileCPResolving=true','-Dbesu.home='+runtime.besu,
 '-Dlog4j.shutdownHookEnabled=false','-Dlog4j2.formatMsgNoLookups=true','-Djava.util.logging.manager=org.apache.logging.log4j.jul.LogManager',
 '--add-opens','java.base/sun.security.provider=ALL-UNNAMED','--add-opens','java.base/java.util=ALL-UNNAMED',
 '-Dio.netty.tryReflectionSetAccessible=true','--add-exports','java.base/jdk.internal.misc=ALL-UNNAMED','--add-opens','java.base/java.nio=ALL-UNNAMED',
 '--enable-native-access=ALL-UNNAMED','-XX:MaxHeapFreeRatio=30','-XX:MinHeapFreeRatio=10','-XX:MaxGCPauseMillis=100','-XX:+UseCompactObjectHeaders',
 '--sun-misc-unsafe-memory-access=allow','-Xms128m','-Xmx1024m','-cp',path.join(runtime.lib,'*'),'org.hyperledger.besu.Besu','--config-file='+config];}
export async function exportIdentity(root,runtime,m){
 const node=path.join(root,'node');await fsp.mkdir(node,{recursive:true});
 if(WINDOWS){await powershell(`$ErrorActionPreference='Stop'; $account=[Security.Principal.WindowsIdentity]::GetCurrent().Name; & icacls.exe ${psQuote(node)} /inheritance:r /grant:r ("{0}:(OI)(CI)F" -f $account) '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null; if($LASTEXITCODE -ne 0){throw 'Cannot protect node key directory'}`);}else await fsp.chmod(node,0o700);
 const key=path.join(node,'key'),oldHash=exists(key)?await fileHash(key):null;
 const prefix=['-Xms128m','-Xmx512m','-cp',path.join(runtime.lib,'*'),'org.hyperledger.besu.Besu','--data-path='+node,'public-key'];
 // Export to temporary public files; an existing private key is never rewritten.
 const suffix=crypto.randomUUID(),addressTmp=path.join(node,'address-'+suffix+'.tmp'),publicTmp=path.join(node,'public-'+suffix+'.tmp');
 try{
  await run(runtime.java,[...prefix,'export-address','--to='+addressTmp]);await run(runtime.java,[...prefix,'export','--to='+publicTmp]);
  const address=fs.readFileSync(addressTmp,'utf8').trim(),publicKey=fs.readFileSync(publicTmp,'utf8').trim().replace(/^0x/,'').replace(/^04(?=.{128}$)/,'');
  if(!/^0x[0-9a-fA-F]{40}$/.test(address)||!/^[0-9a-fA-F]{128}$/.test(publicKey))throw Error('Besu公钥导出格式异常');
  if(m.validatorPublicKeys.includes(publicKey.toLowerCase()))throw Error('该密钥属于原验证者，停止外部节点安装。');
  if(oldHash&&await fileHash(key)!==oldHash)throw Error('节点身份意外改变，停止后续操作。');
  if(!WINDOWS)await fsp.chmod(key,0o600);
  return {address,publicKey,preserved:!!oldHash};
 }finally{for(const p of [addressTmp,publicTmp])if(exists(p))await fsp.unlink(p);}
}
export function launchers(root,nodeBinary){
 const tool=path.join(root,'tools/install.mjs');const result={};
 if(WINDOWS){for(const [name,action]of [['Start','start'],['Status','status'],['Stop','stop']]){
  result[path.join(root,name+'-Node.ps1')]=`\uFEFF$ErrorActionPreference='Stop'\n& ${psQuote(nodeBinary)} ${psQuote(tool)} ${action} --root ${psQuote(root)}\nexit $LASTEXITCODE\n`;
  result[path.join(root,name+'-Node.cmd')]=`@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${name}-Node.ps1"\r\npause\r\n`;
 }
  result[path.join(root,'Change-Server.ps1')]='\uFEFF'+fs.readFileSync(new URL('./Change-Server.ps1',import.meta.url),'utf8').replace(/^\uFEFF/,'');
  result[path.join(root,'Change-Server.cmd')]='@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Change-Server.ps1"\r\npause\r\n';
  result[path.join(root,'Export-Server.ps1')]=`\uFEFFparam([string]$ServerIP,[string]$OutputFile)\n$ErrorActionPreference='Stop'\nif(!$ServerIP){$ServerIP=Read-Host '供其他电脑连接的本机 WLAN IPv4'}\nif(!$OutputFile){$OutputFile=Join-Path $PSScriptRoot ('server-connection-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.json')}\n& ${psQuote(nodeBinary)} ${psQuote(tool)} export-server --root ${psQuote(root)} --server $ServerIP --output $OutputFile\nexit $LASTEXITCODE\n`;
  result[path.join(root,'Export-Server.cmd')]='@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Export-Server.ps1"\r\npause\r\n';
 }else{const q=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";for(const action of ['start','status','stop','change','export']){
  const command=['change','export'].includes(action)?action+'-server':action;
  const file=['change','export'].includes(action)?action+'-server.sh':action+'-node.sh';
  result[path.join(root,file)]=`#!/usr/bin/env bash\nset -e\nexec ${q(nodeBinary)} ${q(tool)} ${command} --root ${q(root)} "$@"\n`;
 }}
 return result;
}
export async function status(root,m){
 const info=inspect(root,m);if(!await running(info,m))return {running:false,root,rpcPort:info.rpcPort,message:'节点未运行，或该端口属于其他程序。'};
 const [height,peers,syncing,validators,genesis]=await Promise.all([rpc(info.rpcPort,'eth_blockNumber'),rpc(info.rpcPort,'net_peerCount'),rpc(info.rpcPort,'eth_syncing'),rpc(info.rpcPort,'qbft_getValidatorsByBlockNumber',['latest']),rpc(info.rpcPort,'eth_getBlockByNumber',['0x0',false])]);
 return {running:true,root,chainId:m.chainId,genesisMatches:genesis?.hash===m.genesisBlockHash,blockHeight:parseInt(height,16),peers:parseInt(peers,16),syncing,nodeIP:info.settings.nodeIP,rpcPort:info.rpcPort,p2pPort:info.p2pPort,address:info.settings.address,isValidator:Array.isArray(validators)?validators.map(s=>s.toLowerCase()).includes(info.settings.address?.toLowerCase()):null,log:path.join(root,'logs/node.log')};
}
export async function start(root,m){
 const info=inspect(root,m);if(await running(info,m)){log('节点已经运行。');return status(root,m);}
 const previous=await ownedProcess(root);
 if(previous){throw Error('该节点进程仍在启动或停止，请稍候运行状态入口；不会重复启动第二个进程。');}
 if((await probe('127.0.0.1',info.rpcPort,500)).ok)throw Error('RPC端口被其他进程占用，请重新运行安装器自动选择端口。');
 if(!await usableRuntime(info.settings.runtime,m))throw Error('运行环境缺失，请重新运行安装器。');
 await fsp.mkdir(path.join(root,'logs'),{recursive:true});const fd=fs.openSync(path.join(root,'logs/node.log'),'a');
 const runtime=runtimeFiles(info.settings.runtime,m),config=path.join(root,'node/config.toml');let child;
 try{child=spawn(runtime.java,javaArgs(runtime,config),{detached:true,stdio:['ignore',fd,fd],windowsHide:true,cwd:root});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(fd);}
 await atomic(path.join(root,'node-process.json'),JSON.stringify({pid:child.pid,config,startedAt:new Date().toISOString()},null,2));child.unref();
 for(let i=0;i<40;i++){if(await running(inspect(root,m),m)){log('节点已在后台启动。');return status(root,m);}try{process.kill(child.pid,0);}catch{throw Error('节点启动后退出，请查看 '+path.join(root,'logs/node.log'));}await sleep(500);}
 throw Error('启动等待超时，进程可能仍在初始化；请运行状态入口并查看 logs/node.log。');
}
async function ownedProcess(root){
 const marker=path.join(root,'node-process.json');if(!exists(marker))return null;
 const {pid,config}=readJson(marker);if(!Number.isInteger(pid)||pid<=1||config!==path.join(root,'node/config.toml'))throw Error('进程记录异常，未停止任何进程。');
 let command='';if(WINDOWS)command=await powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){$p.CommandLine}`);else{try{command=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replaceAll('\0',' ');}catch{}}
 if(!command.trim()){await fsp.unlink(marker);return null;}
 if(!command.includes('org.hyperledger.besu.Besu')||!command.includes('--config-file='+config))throw Error('PID已被其他程序复用，未停止任何进程。');
 return pid;
}
export async function stop(root,m){
 const pid=await ownedProcess(root);
 if(!pid){if(!await running(inspect(root,m),m))return {stopped:true};throw Error('这是此前手动或systemd启动的节点，请先在原窗口Ctrl+C或停止原服务。');}
 process.kill(pid,'SIGTERM');
 for(let i=0;i<30;i++){await sleep(500);if(!await ownedProcess(root))return {stopped:true};}
 throw Error('节点仍在退出，进程记录已保留，请稍候再运行停止入口。');
}

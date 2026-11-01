import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline/promises';
import {WINDOWS,exists,readJson,sha,log,ipv4,port,defaultRoot,inspect,probe,freePort,running,atomic,transaction,lock,ensureRuntime,exportIdentity,launchers,start,stop,status,flattenPeers} from './core.mjs';
import {changeServer,exportServer,loadProfile} from './server.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export function parseArgs(args){
 const options={};let command='install';if(args[0]&&!args[0].startsWith('-'))command=args.shift();
 if(!['install','start','status','stop','change-server','export-server'].includes(command))throw Error('命令应为 install/start/status/stop/change-server/export-server');
 const switches=['prepare-only','offline','plan','json','no-prompt'];const values=['root','server','server-port','node-ip','runtime','cache','p2p-port','rpc-port','server-profile','output'];
 while(args.length){const a=args.shift();if(a==='--help'){options.help=true;continue;}const key=a.replace(/^--/,'');if(switches.includes(key))options[key]=true;else if(values.includes(key)&&args.length&&!args[0].startsWith('--'))options[key]=args.shift();else throw Error('无法识别参数：'+a);}
 return {command,options};
}
async function question(prompt){if(!process.stdin.isTTY)throw Error('请通过 --server 提供服务器 WLAN IPv4。');const r=readline.createInterface({input:process.stdin,output:process.stdout});try{return (await r.question(prompt)).trim();}finally{r.close();}}
async function install(options,m){
 if(!['win32','linux'].includes(process.platform)||process.arch!=='x64')throw Error('本安装包支持64位Windows / x86_64 Linux，请使用对应系统包。');
 const root=options.root?path.resolve(options.root):defaultRoot();
 if(root===here||(root===path.dirname(here)&&!exists(path.join(root,'.talos-install.json'))))throw Error('请选择独立节点目录，不要把节点安装到解压工具目录。');
 let info=inspect(root,m);
 const profile=options['server-profile']?loadProfile(options['server-profile'],m):null;
 if(options['no-prompt']&&!options.server&&!profile&&!info.settings.server)throw Error('无人值守安装需要 --server IPv4。');
 const server=ipv4(options.server||profile?.server||info.settings.server||await question(`服务器 WLAN IPv4（直接回车使用 ${m.suggestedServer}）：`)||m.suggestedServer);
 const serverPort=port(options['server-port']||profile?.serverPort||info.settings.serverPort||m.serverPort);let nodeIP;
 const serverPublicKey=profile?.publicKey||info.settings.serverPublicKey||m.primaryPublicKey;
 if(options.offline){if(!options['prepare-only']||!options['node-ip'])throw Error('离线配置需同时指定 --prepare-only 和 --node-ip。');nodeIP=ipv4(options['node-ip']);}
 else{
  log('检测服务器连接和本机网络接口…');const result=await probe(server,serverPort,4000);
  if(!result.ok)throw Error(`无法连接 ${server}:${serverPort} (${result.error})。请确认服务器已启动，并允许新电脑访问该TCP端口。Windows可测试：Test-NetConnection -ComputerName '${server}' -Port ${serverPort}`);
  nodeIP=ipv4(options['node-ip']||result.localIP);
  const addresses=Object.values(os.networkInterfaces()).flat().filter(Boolean).map(x=>x.address);
  if(!addresses.includes(nodeIP))throw Error('指定的本机IP不属于当前网卡：'+nodeIP);
 }
 let peerFormatCorrect=false;const peerFile=path.join(root,'node/static-nodes.json');const peer=`enode://${serverPublicKey}@${server}:${serverPort}`;
 if(exists(peerFile)){try{const value=readJson(peerFile);flattenPeers(value);peerFormatCorrect=Array.isArray(value)&&value.length===1&&value[0]===peer;}catch{}}
 const active=await running(info,m);
 const toolsCurrent=['core.mjs','install.mjs','server.mjs','Change-Server.ps1','installer-manifest.json'].every(name=>exists(path.join(root,'tools',name))&&fs.readFileSync(path.join(root,'tools',name)).equals(fs.readFileSync(path.join(here,name))));
 const needsRepair=!peerFormatCorrect||Number(info.config['sync-min-peers'])!==1||info.config['p2p-host']!==nodeIP||!toolsCurrent;
 if(active){
  if(!needsRepair){log('已检测到正在运行的同一节点，保留现有身份和服务。');return status(root,m);}
  if(options.plan)return {root,server,nodeIP,existing:true,running:true,needsRepair:true,action:'stop existing node before repair'};
  if(!exists(path.join(root,'node-process.json')))throw Error('已有节点正在手动或systemd运行。请先在原窗口按Ctrl+C，或停止原服务，再重新运行安装包；已有身份和数据会保留。');
  await stop(root,m);info=inspect(root,m);
 }
 const p2pPort=await freePort(options['p2p-port']||info.p2pPort,'0.0.0.0');
 const rpcPort=await freePort(options['rpc-port']||info.rpcPort,'127.0.0.1',[p2pPort]);
 const plan={root,server,serverPort,nodeIP,p2pPort,rpcPort,mode:info.hasKey?'repair / preserve identity':info.partial?'resume installation':'new node',platform:process.platform,architecture:process.arch,syncMinPeers:1};
 log('安装配置：\n'+JSON.stringify(plan,null,2));if(options.plan)return plan;
 const unlock=await lock(root);
 try{
  info=inspect(root,m); // Recheck after acquiring the lock.
  if(await running(info,m))throw Error('节点在安装检查后启动了，请先停止该节点再重试。');
  const oldSettings=info.settings;
  await atomic(path.join(root,'.talos-install.json'),JSON.stringify({version:m.version,phase:'preparing',server,createdAt:info.state?.createdAt||new Date().toISOString()},null,2));
  const runtime=await ensureRuntime(info,m,{runtime:options.runtime,cache:options.cache,offline:options.offline});
  const identity=await exportIdentity(root,runtime,m);
  log(identity.preserved?'已保留原节点身份。':'已创建独立节点身份。');
  const node=path.join(root,'node');const slash=p=>p.replaceAll('\\','/');
  const changes={'data-path':slash(path.join(node,'data')),'node-private-key-file':slash(path.join(node,'key')),'genesis-file':slash(path.join(node,'genesis.json')),'static-nodes-file':slash(peerFile),'network-id':m.chainId,'p2p-host':nodeIP,'p2p-port':p2pPort,'discovery-enabled':false,'rpc-http-enabled':true,'rpc-http-host':'127.0.0.1','rpc-http-port':rpcPort,'rpc-http-api':['ETH','NET','WEB3','QBFT'],'host-allowlist':['localhost','127.0.0.1'],'min-gas-price':0,'sync-mode':'FULL','sync-min-peers':1};
  // Keep custom, in-root data locations rather than abandon an existing database.
  for(const key of ['data-path','node-private-key-file','genesis-file','static-nodes-file'])if(info.config[key])changes[key]=info.config[key];
  if(path.resolve(changes['node-private-key-file'])!==path.resolve(path.join(node,'key'))||path.resolve(changes['static-nodes-file'])!==path.resolve(peerFile)||path.resolve(changes['genesis-file'])!==path.resolve(path.join(node,'genesis.json')))throw Error('已有节点采用非标准文件位置，已保留身份，请人工核对后迁移。');
  const {updateToml}=await import('./core.mjs');
  const settings={...oldSettings,version:m.version,chainId:m.chainId,nodeIP,p2pPort,rpcPort,server,serverPort,serverPublicKey,runtime:runtime.runtime,address:identity.address,genesisSHA256:m.genesisSha256,nodeBinary:process.execPath};
  const writes={
   [peerFile]:JSON.stringify([peer],null,2),
   [path.join(node,'config.toml')]:updateToml(info.text,changes),
   [path.join(root,'node-settings.json')]:JSON.stringify(settings,null,2),
   [path.join(node,'address.txt')]:identity.address+'\n',
   [path.join(node,'public-key.txt')]:identity.publicKey+'\n',
   [path.join(node,'enode.txt')]:`enode://${identity.publicKey}@${nodeIP}:${p2pPort}\n`,
   ...launchers(root,process.execPath)
  };
  if(!exists(path.join(node,'genesis.json')))writes[path.join(node,'genesis.json')]=fs.readFileSync(path.join(here,'genesis.json'));
  for(const name of ['install.mjs','core.mjs','server.mjs','Change-Server.ps1','installer-manifest.json','genesis.json','contract.json'])writes[path.join(root,'tools',name)]=fs.readFileSync(path.join(here,name));
  const backup=await transaction(root,writes);
  if(!WINDOWS)for(const name of ['start-node.sh','status-node.sh','stop-node.sh','change-server.sh','export-server.sh'])await fsp.chmod(path.join(root,name),0o755);
  await atomic(path.join(root,'.talos-install.json'),JSON.stringify({version:m.version,phase:'ready',server,createdAt:info.state?.createdAt||new Date().toISOString(),identityPreserved:identity.preserved,backup},null,2));
  log('安装完成：'+root);if(backup)log('原配置备份：'+backup);
  if(options['prepare-only'])return {...plan,prepared:true,identityPreserved:identity.preserved,address:identity.address};
  return await start(root,m);
 }catch(error){await atomic(path.join(root,'.talos-install.json'),JSON.stringify({version:m.version,phase:'interrupted',server,message:error.message,updatedAt:new Date().toISOString()},null,2));throw error;}finally{await unlock();}
}
export async function main(args=process.argv.slice(2)){
 const {command,options}=parseArgs([...args]);if(options.help){log('Install: install [--server IPv4] [--root directory] [--runtime directory] [--prepare-only] [--plan]\nManage: start|status|stop --root directory\nChange same-chain server: change-server --root directory --server IPv4 [--server-profile public.json]\nExport public connection: export-server [--root directory | --rpc-port N] --server IPv4 --output public.json\nOptional: --p2p-port N --rpc-port N --cache directory\nOffline preparation: --offline --prepare-only --node-ip IPv4 --server IPv4 --runtime directory');return;}
 const m=readJson(path.join(here,'installer-manifest.json'));if(sha(fs.readFileSync(path.join(here,'genesis.json')))!==m.genesisSha256)throw Error('安装包创世文件校验失败，请重新解压完整安装包。');
 let result;if(command==='install')result=await install(options,m);else if(command==='change-server'){
  if(!options.server&&!options['server-profile'])options.server=await question('新的服务器 WLAN IPv4：');
  result=await changeServer(options,m);
 }else if(command==='export-server'){
  if(!options.server)options.server=await question('供其他电脑连接的本机 WLAN IPv4：');
  result=await exportServer(options,m);
 }else{const root=options.root?path.resolve(options.root):defaultRoot();result=await ({start,status,stop}[command])(root,m);}
 log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('\n安装/维护未完成：'+e.message);process.exitCode=1;});

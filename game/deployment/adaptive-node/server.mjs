import fs from 'node:fs';
import path from 'node:path';
import {exists,readJson,ipv4,port,inspect,probe,rpc,running,lock,transaction,atomic,updateToml,start,stop,status,sleep,log} from './core.mjs';

export function validateProfile(value,m){
 if(!value||value.format!=='talos-server-v1'||value.chainId!==m.chainId||value.genesisBlockHash!==m.genesisBlockHash)throw Error('服务器连接文件属于另一条链或格式不正确。本工具不会新建测试链或修改现有链数据。');
 if(!/^[0-9a-fA-F]{128}$/.test(value.publicKey||''))throw Error('服务器连接文件缺少有效节点公钥。');
 return {format:'talos-server-v1',chainId:m.chainId,genesisBlockHash:m.genesisBlockHash,publicKey:value.publicKey.toLowerCase(),server:ipv4(value.server),serverPort:port(value.serverPort)};
}
export function loadProfile(file,m){
 if(fs.statSync(file).size>16384)throw Error('服务器连接文件过大，请使用 Export-Server 导出的公开 JSON 文件。');
 return validateProfile(readJson(file),m);
}
export function selectedPeerConnected(peers,publicKey){
 return Array.isArray(peers)&&peers.some(p=>String(p.id||p.enode?.match(/^enode:\/\/([0-9a-fA-F]{128})@/)?.[1]||'').replace(/^0x/,'').toLowerCase()===publicKey.toLowerCase());
}
export async function exportServer(options,m){
 let settings={};if(options.root)settings=inspect(path.resolve(options.root),m).settings;
 const rpcPort=port(options['rpc-port']||settings.rpcPort||8545);
 const [id,genesis,enode]=await Promise.all([rpc(rpcPort,'eth_chainId'),rpc(rpcPort,'eth_getBlockByNumber',['0x0',false]),rpc(rpcPort,'net_enode')]);
 const publicKey=enode?.match(/^enode:\/\/([0-9a-fA-F]{128})@/)?.[1];
 const serverPort=options['server-port']||settings.p2pPort||enode?.match(/:(\d+)(?:\?|$)/)?.[1];
 const profile=validateProfile({format:'talos-server-v1',chainId:parseInt(id,16),genesisBlockHash:genesis?.hash,publicKey,server:options.server||settings.nodeIP,serverPort},m);
 const file=path.resolve(options.output||path.join(options.root||process.cwd(),'server-connection.json'));
 // Export never overwrites a configuration, identity, or an existing document.
 fs.writeFileSync(file,JSON.stringify(profile,null,2)+'\n',{flag:'wx'});
 return {exported:true,file,profile,message:'仅含公开连接参数，不含私钥。请将此文件交给要连接本节点的用户。'};
}
export async function changeServer(options,m){
 if(!options.root)throw Error('请指定已有节点目录 --root。');
 if(!options.server&&!options['server-profile'])throw Error('请提供服务器 IPv4 或公开连接文件。');
 const root=path.resolve(options.root);let info=inspect(root,m);
 if(!info.hasKey||info.state?.phase!=='ready'||!info.settings.runtime)throw Error('请先用新版安装器安装或修复该节点，再运行更换服务器。');
 const profile=options['server-profile']?loadProfile(options['server-profile'],m):null;
 const server=ipv4(options.server||profile?.server);
 const serverPort=port(options['server-port']||profile?.serverPort||info.settings.serverPort||m.serverPort);
 const publicKey=profile?.publicKey||info.settings.serverPublicKey||m.primaryPublicKey;
 if(publicKey===info.publicKey)throw Error('不能将本节点设为自己的上游服务器。');
 const peer=`enode://${publicKey}@${server}:${serverPort}`;
 log('检查目标服务器连接…');const reachable=await probe(server,serverPort,4000);
 if(!reachable.ok)throw Error(`无法连接 ${server}:${serverPort}（${reachable.error}），原配置和服务未改动。`);
 const nodeIP=ipv4(reachable.localIP);
 const unlock=await lock(root);
 try{
  info=inspect(root,m);
  const active=await running(info,m);
  const files=[path.join(root,'node/static-nodes.json'),path.join(root,'node/config.toml'),path.join(root,'node-settings.json'),path.join(root,'node/enode.txt')];
  const previous=Object.fromEntries(files.map(p=>[p,fs.readFileSync(p)]));
  const writes={
   [files[0]]:JSON.stringify([peer],null,2),
   [files[1]]:updateToml(info.text,{'p2p-host':nodeIP,'sync-min-peers':1,'discovery-enabled':false,'rpc-http-host':'127.0.0.1','host-allowlist':['localhost','127.0.0.1'],'rpc-http-api':['ETH','NET','WEB3','QBFT','ADMIN']}),
   [files[2]]:JSON.stringify({...info.settings,server,serverPort,serverPublicKey:publicKey,nodeIP},null,2),
   [files[3]]:`enode://${info.publicKey}@${nodeIP}:${info.p2pPort}\n`
  };
  if(options.plan)return {root,server,serverPort,nodeIP,publicKey,running:active,identityPreserved:true,createsNewChain:false};
  // stop() only touches the Java process whose saved command line belongs to this root.
  await stop(root,m);
  let backup;try{
   backup=await transaction(root,writes);
   await start(root,m);
   const initial=Number.parseInt(await rpc(info.rpcPort,'eth_blockNumber'),16);
   log('等待目标节点握手和新区块（最多 60 秒）…');
   const deadline=Date.now()+60000;let state;
   while(Date.now()<deadline){
    state=await status(root,m);
    const targetPeerVerified=selectedPeerConnected(await rpc(info.rpcPort,'admin_peers'),publicKey);
    if(state.running&&state.genesisMatches&&targetPeerVerified&&state.blockHeight>initial){
     const result={changed:true,verified:true,targetPeerVerified,server,serverPort,publicKey,identityPreserved:true,createsNewChain:false,initialHeight:initial,...state,backup};
     await atomic(path.join(root,'last-server-change.json'),JSON.stringify(result,null,2));return result;
    }
    await sleep(1500);
   }
   throw Error('未确认目标节点提供本链新区块：可能是公钥不匹配、目标属于其他链或出块暂停。更换另一台服务器时请导入它导出的连接文件。');
  }catch(error){
   try{await stop(root,m);await transaction(root,previous);if(active)await start(root,m);}
   catch(restoreError){throw Error(`${error.message}\n自动恢复未完成：${restoreError.message}。请查看配置备份 ${backup||'节点 backups 目录'}；身份和链数据未被删除。`);}
   throw Error(`${error.message}\n已恢复原服务器配置${active?'并重新启动原节点':'，节点保持停止'}；身份和链数据保留。`);
  }
 }finally{await unlock();}
}

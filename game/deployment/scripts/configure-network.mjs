import fs from 'node:fs';
import path from 'node:path';
import {SigningKey} from 'ethers';
const dirs=fs.readdirSync('private/network/keys').sort();
const ips=['192.168.2.1','192.168.2.128','192.168.2.129'];
const nodes=dirs.map((d,i)=>{const key=fs.readFileSync('private/network/keys/'+d+'/key','utf8').trim();const pub=SigningKey.computePublicKey(key.startsWith('0x')?key:'0x'+key,false).slice(4);return {index:i+1,ip:ips[i],address:d,enode:`enode://${pub}@${ips[i]}:30303`,key};});
for(const n of nodes){
 const dir='private/node'+n.index;fs.mkdirSync(dir,{recursive:true});
 fs.copyFileSync('private/network/genesis.json',dir+'/genesis.json');fs.writeFileSync(dir+'/key',n.key);
 fs.writeFileSync(dir+'/static-nodes.json',JSON.stringify(nodes.filter(x=>x!==n).map(x=>x.enode),null,2));
 const base=n.index===1?path.resolve(dir).replaceAll('\\','/'):'/home/ycw/talos/node';
 const toml=`data-path="${base}/data"
genesis-file="${base}/genesis.json"
node-private-key-file="${base}/key"
static-nodes-file="${base}/static-nodes.json"
network-id=20260926
p2p-host="${n.ip}"
p2p-port=30303
discovery-enabled=false
rpc-http-enabled=true
rpc-http-host="127.0.0.1"
rpc-http-port=8545
rpc-http-api=["ETH","NET","WEB3","QBFT"]
host-allowlist=["localhost","127.0.0.1"]
min-gas-price=0
logging="INFO"
sync-mode="FULL"
sync-min-peers=1
`;
 fs.writeFileSync(dir+'/config.toml',toml);
}
fs.writeFileSync('network.json',JSON.stringify({chainId:20260926,nodes:nodes.map(({key,...n})=>n)},null,2));
console.log('Three distinct validator keys and private-network peer addresses configured.');

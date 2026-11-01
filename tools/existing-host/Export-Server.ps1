param([string]$Root='D:\card_endfiled',[string]$ServerIP,[string]$OutputFile)
$ErrorActionPreference='Stop'
if(!$ServerIP){$ServerIP=Read-Host '供其他电脑连接的本机 WLAN IPv4（不是默认网关）'}
if(!$OutputFile){$OutputFile=Join-Path $Root ('server-connection-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.json')}
$node=Join-Path $Root 'runtime/node/node.exe'
$tool=Join-Path $Root 'game/deployment/adaptive-node/install.mjs'
& $node $tool export-server --rpc-port 8545 --server $ServerIP --output $OutputFile
exit $LASTEXITCODE

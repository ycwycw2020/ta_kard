param([string]$Root='D:\card_endfiled',[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath $Root).Path
$app=Join-Path $taskRoot 'game\deployment'
$settings=Get-Content -LiteralPath (Join-Path $app 'local-host.json') -Raw | ConvertFrom-Json
function Test-Port([int]$Port){$tcp=New-Object Net.Sockets.TcpClient;try{$t=$tcp.ConnectAsync('127.0.0.1',$Port);return $t.Wait(700) -and $tcp.Connected}catch{return $false}finally{$tcp.Dispose()}}
function Wait-Port([int]$Port){for($i=0;$i -lt 90;$i++){if(Test-Port $Port){return};Start-Sleep -Seconds 1};throw "Service did not start on port $Port. Check $taskRoot\logs and $app\logs."}
function Start-Quiet($Exe,$Arguments,$Name,$WorkingDirectory){$p=Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput "$taskRoot\logs\$Name.log" -RedirectStandardError "$taskRoot\logs\$Name-error.log" -PassThru;return $p.Id}
$state=@{}
if(Test-Path "$app\private\run-state.json"){$old=Get-Content "$app\private\run-state.json" -Raw | ConvertFrom-Json;$old.PSObject.Properties | ForEach-Object {$state[$_.Name]=$_.Value}}
$ssh='C:\Windows\System32\OpenSSH\ssh.exe'
$sshBase=@('-i',"$app\private\ssh\key",'-o',"UserKnownHostsFile=$app/private/ssh/known_hosts",'-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=10')
foreach($service in @('VMnetDHCP','VMware NAT Service')){if((Get-Service $service).Status -ne 'Running'){throw "Start VMware NAT and DHCP services as administrator, then run again. See DEPLOYMENT.md."}}
$running=& $settings.vmrun list
foreach($vm in $settings.vms){
 if($running -notcontains $vm.vmx){& $settings.vmrun start $vm.vmx nogui;if($LASTEXITCODE -ne 0){throw "Cannot boot $($vm.vmx)"}}
}
foreach($vm in $settings.vms){
 $ready=$false
 # VMware Tools can fail to report an IP while the guest is already reachable.
 # Check the configured address using the pinned SSH host key instead.
 for($i=0;$i -lt 30;$i++){
  & $ssh @sshBase "ycw@$($vm.ip)" '/bin/true' 2>$null
  if($LASTEXITCODE -eq 0){$ready=$true;break}
  Start-Sleep -Seconds 2
 }
 if(!$ready){throw "Cannot establish trusted SSH to configured VM $($vm.ip). Check its boot state, VMware NAT address and SSH service; see DEPLOYMENT.md."}
 & $ssh @sshBase "ycw@$($vm.ip)" 'systemctl --user start talos-besu.service'
 if($LASTEXITCODE -ne 0){throw "SSH failed for $($vm.ip)"}
}
if(!(Test-Port 8545)){
 $env:JAVA_HOME=Join-Path $app 'runtime\jdk-25.0.4.1+1';$env:JAVA_OPTS='-Xms256m -Xmx1024m'
 $state.besu=Start-Quiet (Join-Path $app 'runtime\besu-26.8.1\bin\besu.bat') @("--config-file=$app/private/node1/config.toml") 'besu' $app
 Wait-Port 8545
}
foreach($vm in $settings.vms){
 if(!(Test-Port $vm.rpcPort)){
  $argsList=$sshBase+@('-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-L',"127.0.0.1:$($vm.rpcPort):127.0.0.1:8545",'-R','127.0.0.1:8787:127.0.0.1:8787')
  if($vm.indexer){$argsList+=@('-R','127.0.0.1:3001:127.0.0.1:8787')}
  $argsList+="ycw@$($vm.ip)";$state["tunnel$($vm.node)"]=Start-Quiet $ssh $argsList "ssh-node$($vm.node)" $app;Wait-Port $vm.rpcPort
 }
}
if(!(Test-Port 5433)){
 $pg=Start-Process -FilePath (Join-Path $taskRoot 'runtime\pgsql\bin\pg_ctl.exe') -ArgumentList @('start','-D',"$taskRoot/database",'-l',"$taskRoot/logs/postgres-start.log",'-w','-t','45') -WindowStyle Hidden -PassThru
 if(!$pg.WaitForExit(50000)){throw 'PostgreSQL launcher timed out'}
 if($pg.ExitCode -ne 0){throw 'PostgreSQL did not start'};Wait-Port 5433
}
if(!(Test-Port 8787)){$state.server=Start-Quiet (Join-Path $taskRoot 'runtime\node\node.exe') @('server.mjs') 'server' $app;Wait-Port 8787}
foreach($vm in $settings.vms){if($vm.indexer){& $ssh @sshBase "ycw@$($vm.ip)" 'systemctl --user start talos-indexer.service'}}
$state | ConvertTo-Json | Set-Content -LiteralPath "$app\private\run-state.json" -Encoding utf8
$health=Invoke-RestMethod 'http://localhost:8787/api/health' -TimeoutSec 15
if(@($health.nodes | Where-Object {!$_.ok}).Count){throw 'Game server is reachable, but a chain node is offline. Run Status-Game.ps1.'}
Write-Host 'Game ready: http://localhost:8787' -ForegroundColor Green
Write-Host 'Database: D:\card_endfiled\database | 3 Besu validators | No real ETH'
if(!$NoBrowser){Start-Process 'http://localhost:8787'}

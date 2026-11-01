param([string]$Root='D:\card_endfiled')
$ErrorActionPreference='Stop';$taskRoot=(Resolve-Path -LiteralPath $Root).Path;$app=Join-Path $taskRoot 'game\deployment'
$settings=Get-Content "$app\local-host.json" -Raw | ConvertFrom-Json
$states=@{}
foreach($file in @('chain-pids.json','run-state.json')){if(Test-Path "$app\private\$file"){(Get-Content "$app\private\$file" -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object {$states[$_.Name]=[int]$_.Value}}}
if(Test-Path "$app\private\server.pid"){$states.legacyServer=[int](Get-Content "$app\private\server.pid")}
function Stop-OwnedTree([int]$ProcessId){
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
 if(!$p){return}
 if(!$p.CommandLine -or !$p.CommandLine.Replace('/','\').ToLower().Contains($taskRoot.ToLower())){Write-Warning "Skipped unrelated or reused process id $ProcessId";return}
 $all=@(Get-CimInstance Win32_Process);$ids=New-Object 'System.Collections.Generic.List[int]';$ids.Add($ProcessId)
 for($i=0;$i -lt $ids.Count;$i++){foreach($child in $all){if($child.ParentProcessId -eq $ids[$i]){$ids.Add([int]$child.ProcessId)}}}
 for($i=$ids.Count-1;$i -ge 0;$i--){Stop-Process -Id $ids[$i] -ErrorAction SilentlyContinue}
}
foreach($name in @('server','legacyServer')){if($states.ContainsKey($name)){Stop-OwnedTree $states[$name]}}
$ssh='C:\Windows\System32\OpenSSH\ssh.exe';$opts=@('-i',"$app\private\ssh\key",'-o',"UserKnownHostsFile=$app/private/ssh/known_hosts",'-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=8')
foreach($vm in $settings.vms){& $ssh @opts "ycw@$($vm.ip)" 'systemctl --user stop talos-indexer.service talos-besu.service 2>/dev/null || systemctl --user stop talos-besu.service'}
if($states.ContainsKey('besu')){Stop-OwnedTree $states.besu}
foreach($name in @('tunnel2','tunnel3')){if($states.ContainsKey($name)){Stop-OwnedTree $states[$name]}}
& "$taskRoot\runtime\pgsql\bin\pg_ctl.exe" stop -D "$taskRoot\database" -m fast -w -t 45
Write-Host 'Game services stopped. VM power state and unrelated services were preserved.'

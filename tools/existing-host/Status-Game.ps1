param([string]$Root='D:\card_endfiled')
$ErrorActionPreference='Stop'
try{$h=Invoke-RestMethod 'http://localhost:8787/api/health' -TimeoutSec 15;$h | ConvertTo-Json -Depth 6}catch{Write-Host 'Game server is offline. Run Start-Game.ps1.';exit 1}
$blocks=@();$heights=@($h.nodes | Where-Object {$_.ok} | ForEach-Object {$_.block})
if($heights.Count -eq 3){$height=($heights | Measure-Object -Minimum).Minimum;foreach($port in @(8545,8546,8547)){$body=@{jsonrpc='2.0';id=1;method='eth_getBlockByNumber';params=@(('0x{0:x}' -f [int]$height),$false)} | ConvertTo-Json;$blocks+=(Invoke-RestMethod "http://127.0.0.1:$port" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 8).result.hash};if(@($blocks | Select-Object -Unique).Count -eq 1){Write-Host "All 3 nodes agree at block $height : $($blocks[0])" -ForegroundColor Green}else{throw 'Node block hash mismatch'}}else{exit 1}

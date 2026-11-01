param([Parameter(Mandatory=$true)][string]$Address)
$ErrorActionPreference='Stop'
if($Address -notmatch '^0x[0-9a-fA-F]{40}$'){throw 'Use the address from the NEW node address.txt, not a wallet or private key.'}
foreach($port in @(8545,8546,8547)){
 $body=@{jsonrpc='2.0';id=1;method='qbft_proposeValidatorVote';params=@($Address,$true)} | ConvertTo-Json
 $r=Invoke-RestMethod "http://127.0.0.1:$port" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
 if($r.error){throw ($r.error | ConvertTo-Json)}
 Write-Host "Validator vote submitted on RPC $port : $($r.result)"
}
Write-Host 'Wait for new blocks, then verify qbft_getValidatorsByBlockNumber. This script changes the validator set; run only after the new node has synchronized.'

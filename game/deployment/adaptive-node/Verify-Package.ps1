param([switch]$Quiet)
$ErrorActionPreference='Stop'
$file=Join-Path $PSScriptRoot 'manifest-sha256.json'
$manifest=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
$count=0
foreach($entry in $manifest.files.PSObject.Properties){
 if([IO.Path]::GetFileName($entry.Name) -ne $entry.Name){throw 'Invalid package manifest path'}
 $target=Join-Path $PSScriptRoot $entry.Name
 if(!(Test-Path -LiteralPath $target -PathType Leaf)){throw "Missing package file: $($entry.Name)"}
 if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -ne $entry.Value){throw "Package checksum mismatch: $($entry.Name)"}
 $count++
}
if(!$Quiet){Write-Host "Package verified: $count files"}

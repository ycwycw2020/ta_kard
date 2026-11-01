param(
 [string]$ServerIP,
 [string]$InstallDir,
 [string]$RuntimePath,
 [string]$ServerProfile,
 [switch]$NoGui,
 [switch]$PrepareOnly,
 [switch]$Plan
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'manifest-sha256.json')){& (Join-Path $PSScriptRoot 'Verify-Package.ps1') -Quiet}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installer-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if(!$InstallDir){
 $fallback=Join-Path $env:LOCALAPPDATA 'TalosCards\node'
 if(Test-Path -LiteralPath 'D:\card_endfiled_node4\node'){$InstallDir='D:\card_endfiled_node4'}
 elseif(Test-Path -LiteralPath (Join-Path $fallback 'node')){$InstallDir=$fallback}
 elseif(Test-Path -LiteralPath 'D:\'){$InstallDir='D:\card_endfiled_node4'}else{$InstallDir=$fallback}
}
if(!$NoGui -and !$ServerIP){
 Add-Type -AssemblyName System.Windows.Forms
 Add-Type -AssemblyName System.Drawing
 [Windows.Forms.Application]::EnableVisualStyles()
 $form=New-Object Windows.Forms.Form
 $form.Text='塔卫牌局 · Windows 节点安装';$form.ClientSize=New-Object Drawing.Size(620,300);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
 $form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
 $title=New-Object Windows.Forms.Label;$title.Text='填写服务器地址，一键安装或修复节点';$title.Location=New-Object Drawing.Point(24,18);$title.Size=New-Object Drawing.Size(570,32);$form.Controls.Add($title)
 $label1=New-Object Windows.Forms.Label;$label1.Text='服务器 WLAN IPv4';$label1.Location=New-Object Drawing.Point(24,70);$label1.Size=New-Object Drawing.Size(170,26);$form.Controls.Add($label1)
 $server=New-Object Windows.Forms.TextBox;$server.Text=$manifest.suggestedServer;$server.Location=New-Object Drawing.Point(200,67);$server.Size=New-Object Drawing.Size(385,28);$form.Controls.Add($server)
 $label2=New-Object Windows.Forms.Label;$label2.Text='安装目录（可修改）';$label2.Location=New-Object Drawing.Point(24,118);$label2.Size=New-Object Drawing.Size(170,26);$form.Controls.Add($label2)
 $directory=New-Object Windows.Forms.TextBox;$directory.Text=$InstallDir;$directory.Location=New-Object Drawing.Point(200,115);$directory.Size=New-Object Drawing.Size(300,28);$form.Controls.Add($directory)
 $browse=New-Object Windows.Forms.Button;$browse.Text='选择';$browse.Location=New-Object Drawing.Point(508,114);$browse.Size=New-Object Drawing.Size(77,30);$browse.Add_Click({$dialog=New-Object Windows.Forms.FolderBrowserDialog;if($dialog.ShowDialog() -eq 'OK'){$directory.Text=$dialog.SelectedPath};$dialog.Dispose()});$form.Controls.Add($browse)
 $note=New-Object Windows.Forms.Label;$note.Text='本机 IP、端口和运行环境自动识别。已有节点保留原身份与数据。';$note.Location=New-Object Drawing.Point(24,168);$note.Size=New-Object Drawing.Size(570,44);$form.Controls.Add($note)
 $button=New-Object Windows.Forms.Button;$button.Text='一键安装 / 修复';$button.Location=New-Object Drawing.Point(350,226);$button.Size=New-Object Drawing.Size(235,42)
 $button.Add_Click({$ip=$null;if(![Net.IPAddress]::TryParse($server.Text.Trim(),[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){[Windows.Forms.MessageBox]::Show('请输入有效的服务器 IPv4 地址。');return};if(!$directory.Text.Trim()){[Windows.Forms.MessageBox]::Show('请选择安装目录。');return};$form.DialogResult=[Windows.Forms.DialogResult]::OK;$form.Close()})
 $form.Controls.Add($button);$form.AcceptButton=$button
 if($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){$form.Dispose();exit 0}
 $ServerIP=$server.Text.Trim();$InstallDir=$directory.Text.Trim();$form.Dispose()
}
if(!$ServerIP){$ServerIP=Read-Host '服务器 WLAN IPv4';if(!$ServerIP){$ServerIP=$manifest.suggestedServer}}
$arch=$env:PROCESSOR_ARCHITECTURE;if($env:PROCESSOR_ARCHITEW6432){$arch=$env:PROCESSOR_ARCHITEW6432}
if($arch -notin @('AMD64','x86_64')){throw '此安装包需要 x64 Windows。'}
$candidates=@('D:\card_endfiled\runtime\node\node.exe')
$found=Get-Command node.exe -ErrorAction SilentlyContinue;if($found){$candidates=@($found.Source)+$candidates}
$cache=Join-Path $env:LOCALAPPDATA 'TalosCards\installer-runtime'
$cachedNode=Join-Path $cache "node-v$($manifest.nodeVersion)-win-x64\node.exe"
$candidates+=@($cachedNode);$node=$null
foreach($candidate in $candidates){if(Test-Path -LiteralPath $candidate){try{$v=& $candidate -p 'process.versions.node';if($LASTEXITCODE -eq 0 -and [int]($v.Split('.')[0]) -ge 20){$node=$candidate;break}}catch{}}}
if(!$node){
 Write-Host '准备安装器运行环境，首次运行需要联网下载…'
 New-Item -ItemType Directory -Path $cache -Force | Out-Null
 [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
 $spec=$manifest.downloads.nodeWin;$archive=Join-Path $cache $spec.file
 if(!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $spec.sha256){
  $temp=$archive+'.part-'+$PID
  Invoke-WebRequest -UseBasicParsing -Uri $spec.url -OutFile $temp
  if((Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLower() -ne $spec.sha256){throw '安装器下载校验失败，请重试。'}
  Move-Item -LiteralPath $temp -Destination $archive -Force
 }
 Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force
 $node=$cachedNode
}
$arguments=@((Join-Path $PSScriptRoot 'install.mjs'),'install','--server',$ServerIP,'--root',$InstallDir)
if($RuntimePath){$arguments+=@('--runtime',$RuntimePath)}
if($ServerProfile){$arguments+=@('--server-profile',$ServerProfile)}
if($PrepareOnly){$arguments+='--prepare-only'}
if($Plan){$arguments+='--plan'}
& $node @arguments
exit $LASTEXITCODE

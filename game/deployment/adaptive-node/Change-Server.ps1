param([string]$ServerIP,[string]$ServerProfile,[string]$NodeRoot=$PSScriptRoot,[switch]$NoGui)
$ErrorActionPreference='Stop'
$settings=Get-Content -LiteralPath (Join-Path $NodeRoot 'node-settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if(!$ServerIP -and !$NoGui){
 Add-Type -AssemblyName System.Windows.Forms
 Add-Type -AssemblyName System.Drawing
 [Windows.Forms.Application]::EnableVisualStyles()
 $form=New-Object Windows.Forms.Form
 $form.Text='塔卫牌局 · 更换服务器';$form.ClientSize=New-Object Drawing.Size(640,330);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
 $form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
 $title=New-Object Windows.Forms.Label;$title.Text='保留节点身份与数据，更换同一条链的连接入口';$title.Location=New-Object Drawing.Point(22,18);$title.Size=New-Object Drawing.Size(596,30);$form.Controls.Add($title)
 $label=New-Object Windows.Forms.Label;$label.Text='服务器 WLAN IPv4';$label.Location=New-Object Drawing.Point(22,66);$label.Size=New-Object Drawing.Size(176,28);$form.Controls.Add($label)
 $server=New-Object Windows.Forms.TextBox;$server.Text=$settings.server;$server.Location=New-Object Drawing.Point(206,63);$server.Size=New-Object Drawing.Size(410,28);$form.Controls.Add($server)
 $label2=New-Object Windows.Forms.Label;$label2.Text='公开连接文件（可选）';$label2.Location=New-Object Drawing.Point(22,117);$label2.Size=New-Object Drawing.Size(182,28);$form.Controls.Add($label2)
 $profile=New-Object Windows.Forms.TextBox;$profile.Text=$ServerProfile;$profile.Location=New-Object Drawing.Point(206,114);$profile.Size=New-Object Drawing.Size(324,28);$form.Controls.Add($profile)
 $browse=New-Object Windows.Forms.Button;$browse.Text='选择';$browse.Location=New-Object Drawing.Point(538,112);$browse.Size=New-Object Drawing.Size(78,32)
 $browse.Add_Click({$dialog=New-Object Windows.Forms.OpenFileDialog;$dialog.Filter='服务器连接文件 (*.json)|*.json';if($dialog.ShowDialog() -eq 'OK'){$profile.Text=$dialog.FileName;try{$connection=Get-Content -LiteralPath $dialog.FileName -Raw -Encoding UTF8 | ConvertFrom-Json;$server.Text=$connection.server}catch{[Windows.Forms.MessageBox]::Show('文件无法读取，请选择导出的 JSON 连接文件。')}};$dialog.Dispose()});$form.Controls.Add($browse)
 $note=New-Object Windows.Forms.Label;$note.Text='原服务器只是 IP 变化：只改地址即可。换到另一台节点：选择对方导出的连接文件。工具验证握手与新区块；失败时恢复原配置。不会新建测试链。';$note.Location=New-Object Drawing.Point(22,167);$note.Size=New-Object Drawing.Size(596,75);$form.Controls.Add($note)
 $button=New-Object Windows.Forms.Button;$button.Text='连接并验证';$button.Location=New-Object Drawing.Point(386,266);$button.Size=New-Object Drawing.Size(230,42)
 $button.Add_Click({$ip=$null;if(![Net.IPAddress]::TryParse($server.Text.Trim(),[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){[Windows.Forms.MessageBox]::Show('请输入有效 IPv4。');return};$form.DialogResult=[Windows.Forms.DialogResult]::OK;$form.Close()});$form.Controls.Add($button);$form.AcceptButton=$button
 if($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){$form.Dispose();exit 0}
 $ServerIP=$server.Text.Trim();$ServerProfile=$profile.Text.Trim();$form.Dispose()
}
if(!$ServerIP){$ServerIP=Read-Host '新的服务器 WLAN IPv4'}
$arguments=@((Join-Path $NodeRoot 'tools/install.mjs'),'change-server','--root',$NodeRoot,'--server',$ServerIP)
if($ServerProfile){$arguments+=@('--server-profile',$ServerProfile)}
& $settings.nodeBinary @arguments
exit $LASTEXITCODE

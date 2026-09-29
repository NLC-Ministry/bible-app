# 正式環境每週備份的 Windows 包裝（#345）。見 docs/backup.md。
#
#   .\scripts\backup-production.ps1 -SetSecrets   產生雲端壓縮檔的加密密碼，只在你的視窗顯示一次，
#                                                 用 DPAPI 加密存檔（只有這台電腦的這個 Windows 帳號解得開）
#   .\scripts\backup-production.ps1 -Install      建立備份目錄、把腳本複製到 <備份目錄>\bin、
#                                                 註冊工作排程器（每週二 00:00，錯過會補跑）
#   .\scripts\backup-production.ps1               執行一次備份（排程呼叫的就是這個）
#
# 不存 DB 密碼：備份程式每次連線前用已登入的 Supabase CLI 換一組臨時帳號。
# 備份目錄預設 %USERPROFILE%\Documents\bible-speed-reading-backups，可用環境變數 BACKUP_ROOT 改。
# 改了 backup-production.mjs 之後要重跑 -Install，排程才會用到新版。

param(
  [switch]$SetSecrets,
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$TaskName = 'BibleSpeedReading-ProductionBackup'
$Root = if ($env:BACKUP_ROOT) { $env:BACKUP_ROOT } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'bible-speed-reading-backups' }
$ArchiveSecretFile = Join-Path $Root 'secrets\archive-password.dpapi'

function Read-SecretFile([string]$Path) {
  if (-not (Test-Path $Path)) { throw "找不到 $Path，請先執行 -SetSecrets" }
  # Set-Content 會在檔尾加換行，ConvertTo-SecureString 讀到換行會失敗
  $secure = (Get-Content -Path $Path -Raw).Trim() | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function New-ArchivePassword([int]$Length = 32) {
  # 去掉容易看錯的 0/O、1/l/I，方便抄寫
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 1
  $chars = New-Object System.Collections.Generic.List[char]
  try {
    while ($chars.Count -lt $Length) {
      $rng.GetBytes($bytes)
      # 拒絕取樣，避免字元分布不均
      if ($bytes[0] -lt (256 - (256 % $alphabet.Length))) { $chars.Add($alphabet[$bytes[0] % $alphabet.Length]) }
    }
  } finally { $rng.Dispose() }
  return -join $chars
}

function Show-FailureNotice([string]$Message) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Warning
    $icon.Visible = $true
    $icon.ShowBalloonTip(15000, '聖經速讀：正式站備份失敗', $Message, [System.Windows.Forms.ToolTipIcon]::Error)
    Start-Sleep -Seconds 15
    $icon.Dispose()
  } catch { }
}

if ($SetSecrets) {
  if (Test-Path $ArchiveSecretFile) {
    Write-Host '已經設定過壓縮密碼。換新密碼後，之前的雲端副本仍然要用舊密碼才打得開。'
    if ((Read-Host '確定要換新密碼嗎？輸入 yes 繼續') -ne 'yes') { Write-Host '沒有變更'; exit 0 }
  }
  $password = New-ArchivePassword
  Write-Host ''
  Write-Host '雲端備份的壓縮密碼（只顯示這一次）：'
  Write-Host ''
  Write-Host "    $password"
  Write-Host ''
  Write-Host '請現在存進你的密碼管理器，或抄下來放在這台電腦以外的安全地方。'
  Write-Host '這台電腦壞掉時，要用它才能打開 OneDrive 上的備份。'
  $tail = Read-Host '存好之後，輸入密碼的最後 4 個字確認'
  if ($tail -cne $password.Substring($password.Length - 4)) {
    Clear-Host
    throw '最後 4 個字不對，沒有存檔。請重新執行 -SetSecrets'
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $ArchiveSecretFile) | Out-Null
  ConvertTo-SecureString -String $password -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $ArchiveSecretFile -Encoding ascii
  $password = $null
  Clear-Host
  Write-Host "已加密存到 $ArchiveSecretFile"
  exit 0
}

if ($Install) {
  # 專案主資料夾（不是 worktree）：備份程式要在這裡跑 npx supabase
  $gitCommon = (& git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir).Trim()
  $ProjectDir = (Split-Path -Parent $gitCommon) -replace '/', '\'
  $BinScripts = Join-Path $Root 'bin\scripts'
  New-Item -ItemType Directory -Force -Path $BinScripts | Out-Null
  Copy-Item -Force (Join-Path $PSScriptRoot 'backup-production.mjs') $BinScripts
  Copy-Item -Force (Join-Path $PSScriptRoot 'backup-production.ps1') $BinScripts

  $ConfigFile = Join-Path $Root 'backup.config.json'
  $config = if (Test-Path $ConfigFile) { Get-Content $ConfigFile -Raw | ConvertFrom-Json } else { New-Object PSObject }
  $config | Add-Member -NotePropertyName projectDir -NotePropertyValue $ProjectDir -Force
  $config | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding utf8

  $ps1 = Join-Path $BinScripts 'backup-production.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`""
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday -At '00:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description '新生命聖經速讀：正式站 Supabase 每週備份（#345，docs/backup.md）' -Force | Out-Null
  Write-Host "已安裝到 $BinScripts（專案資料夾 $ProjectDir），排程「$TaskName」每週二 00:00（錯過會在下次登入後補跑）"
  exit 0
}

try {
  $env:BACKUP_ROOT = $Root
  $env:BACKUP_ARCHIVE_PASSWORD = Read-SecretFile $ArchiveSecretFile
  & node (Join-Path $PSScriptRoot 'backup-production.mjs') run
  $code = $LASTEXITCODE
} catch {
  Write-Host "備份失敗：$($_.Exception.Message)"
  $code = 1
} finally {
  Remove-Item Env:BACKUP_ARCHIVE_PASSWORD -ErrorAction SilentlyContinue
}

if ($code -ne 0) { Show-FailureNotice "請看 $Root\logs 裡最新的 log" }
exit $code

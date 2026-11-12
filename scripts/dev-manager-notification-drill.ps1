$ErrorActionPreference = "Stop"
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Questo test è disponibile solo su Windows."
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = New-Object System.Windows.Forms.NotifyIcon
try {
  $icon.Icon = [System.Drawing.SystemIcons]::Warning
  $icon.Visible = $true
  $icon.BalloonTipTitle = "Vivarqo Dev Manager - test"
  $icon.BalloonTipText = "Notifica di prova. Il manager può restare minimizzato/in background."
  $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
  $icon.ShowBalloonTip(10000)
  Start-Sleep -Seconds 11
  $answer = Read-Host "Hai visualizzato la notifica nell'area di notifica di Windows? (s/n)"
  if ($answer -notmatch "^(s|si|sì|y|yes)$") {
    throw "Notifica non confermata. Controlla notifiche Windows, Focus Assist e sessione desktop."
  }
  Write-Host "PASS: notifica desktop visualizzata e confermata." -ForegroundColor Green
}
finally {
  $icon.Visible = $false
  $icon.Dispose()
}

$ErrorActionPreference = "Stop"
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Questo test è disponibile solo su Windows."
}

$port = if ($env:VIVARQO_MANAGER_PORT) { [int]$env:VIVARQO_MANAGER_PORT } else { 4179 }
$stateUrl = "http://127.0.0.1:$port/api/state"
try {
  $state = Invoke-RestMethod -Uri $stateUrl -TimeoutSec 3
} catch {
  throw "Avvia prima pnpm dev:manager e minimizza la sua finestra. Dashboard non raggiungibile su $stateUrl."
}

$api = $state.services | Where-Object { $_.name -eq "api" } | Select-Object -First 1
if (-not $api -or -not $api.pid) {
  throw "Il manager non espone un processo API attivo."
}
$oldPid = [int]$api.pid

Write-Host "Termino forzatamente il processo API PID $oldPid. Il manager deve riavviarlo e mostrare una notifica desktop."
& taskkill.exe /PID $oldPid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "taskkill non è riuscito a terminare il processo API."
}

$deadline = [DateTime]::UtcNow.AddSeconds(35)
$newPid = $null
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $state = Invoke-RestMethod -Uri $stateUrl -TimeoutSec 2
    $api = $state.services | Where-Object { $_.name -eq "api" } | Select-Object -First 1
    if ($api -and $api.state -eq "running" -and $api.pid -and [int]$api.pid -ne $oldPid) {
      $newPid = [int]$api.pid
      break
    }
  } catch {}
  Start-Sleep -Milliseconds 300
}
if (-not $newPid) {
  throw "L'API non è stata riavviata entro 35 secondi. Controlla la dashboard e i log."
}

Write-Host "API riavviata: PID $oldPid -> $newPid." -ForegroundColor Green
$answer = Read-Host "Con la finestra del manager minimizzata, hai visto la notifica Windows generata dal riavvio? (s/n)"
if ($answer -notmatch "^(s|si|sì|y|yes)$") {
  throw "Notifica non confermata. Controlla le notifiche di Windows, Non disturbare e la sessione desktop interattiva."
}
Write-Host "PASS: il manager ha riavviato l'API e la notifica è stata confermata visivamente." -ForegroundColor Green

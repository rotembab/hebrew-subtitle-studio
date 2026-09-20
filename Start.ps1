param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$studioRoot = $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Install Node.js 22 or newer from https://nodejs.org, then open Start.cmd again.'
    exit 1
}
$studioNodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($studioNodeMajor -lt 22) { Write-Host 'Node.js 22 or newer is required.'; exit 1 }
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 }
    catch { Start-Process -FilePath (Get-Command ollama).Source -ArgumentList 'serve' -WindowStyle Hidden }
}
$studioRunning = $false
try {
    $studioStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/status' -TimeoutSec 2
    $studioRunning = $studioStatus.app -eq 'hebrew-subtitle-studio'
} catch { }
if (-not $studioRunning) {
    $studioRuntime = Join-Path $studioRoot '.runtime'
    New-Item -ItemType Directory -Path $studioRuntime -Force | Out-Null
    Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server.mjs' -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioRuntime 'server.log') -RedirectStandardError (Join-Path $studioRuntime 'server-error.log')
    for ($studioAttempt = 0; $studioAttempt -lt 30; $studioAttempt++) {
        try {
            $studioStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/status' -TimeoutSec 2
            if ($studioStatus.app -eq 'hebrew-subtitle-studio') { $studioRunning = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
}
if (-not $studioRunning) { Write-Host 'Could not start the app. Check .runtime/server-error.log or run node server.mjs in this folder.'; exit 1 }
Write-Host 'Hebrew Subtitle Studio: http://127.0.0.1:4318'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4318' }

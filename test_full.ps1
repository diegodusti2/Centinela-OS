param(
  [switch]$Reset,
  [switch]$StartServer,
  [switch]$InstallApk,
  [switch]$StartDashboard
)

$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $serverRoot
$dbPath = Join-Path $serverRoot 'data\centinela.db'
$serverUrl = if ($env:CENTINELA_API_URL) { $env:CENTINELA_API_URL.TrimEnd('/') } else { 'http://localhost:3000' }
$adminUser = if ($env:CENTINELA_ADMIN_USER) { $env:CENTINELA_ADMIN_USER } else { 'admin' }
$adminPassword = if ($env:CENTINELA_ADMIN_PASSWORD) { $env:CENTINELA_ADMIN_PASSWORD } else { 'change-me-now' }
$passed = 0
$failed = 0
$serverProcess = $null
$dashboardProcess = $null

function Write-Result([string]$name, [bool]$ok, [string]$detail = '') {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host "[$mark] $name $detail" -ForegroundColor $color
  if ($ok) { $script:passed++ } else { $script:failed++ }
}

function Invoke-Api([string]$method, [string]$path, [object]$body = $null, [hashtable]$headers = @{}) {
  $requestHeaders = @{}
  foreach ($key in $headers.Keys) { $requestHeaders[$key] = $headers[$key] }
  $params = @{ Uri = "$serverUrl$path"; Method = $method; Headers = $requestHeaders; TimeoutSec = 10 }
  if ($null -ne $body) {
    $params.ContentType = 'application/json'
    $params.Body = ($body | ConvertTo-Json -Depth 8 -Compress)
  }
  Invoke-RestMethod @params
}

function Wait-Api {
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { Invoke-Api 'GET' '/health' | Out-Null; return }
    catch { Start-Sleep -Milliseconds 500 }
  }
  throw "Servidor no disponible en $serverUrl"
}

Write-Host 'Centinela OS v3 - prueba integral' -ForegroundColor Cyan

if ($Reset) {
  $connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  foreach ($path in @($dbPath, "$dbPath-wal", "$dbPath-shm")) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'Base SQLite reiniciada.' -ForegroundColor Yellow
}

if ($StartServer) {
  $serverProcess = Start-Process -FilePath 'node' -ArgumentList 'src\index.js' -WorkingDirectory $serverRoot -PassThru
  Start-Sleep -Seconds 1
}

if ($StartDashboard) {
  $dashboardRoot = Join-Path $projectRoot 'centinela_dashboard'
  $webRoot = Join-Path $dashboardRoot 'build\web'
  if (-not (Test-Path $webRoot)) {
    Push-Location $dashboardRoot
    try { flutter build web --release } finally { Pop-Location }
  }
  $dashboardProcess = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', '8080', '--directory', $webRoot -PassThru
}

if ($InstallApk) {
  $apkRoot = Join-Path $projectRoot 'centinela_v2'
  Push-Location $apkRoot
  try { flutter build apk --debug } finally { Pop-Location }
  $apk = Join-Path $apkRoot 'build\app\outputs\flutter-apk\app-debug.apk'
  $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
  if (-not (Test-Path $adb)) { throw "ADB no encontrado: $adb" }
  if (-not (Test-Path $apk)) { throw "APK no encontrada: $apk" }
  $adbDevices = @(& $adb devices 2>$null | Where-Object { $_ -match '\sdevice\s*$' })
  if ($adbDevices.Count -eq 0) {
    Write-Result 'Telefono ADB conectado' $false 'No hay dispositivo; se omite instalacion'
  } else {
    & $adb install -r $apk | Out-Host
    Write-Result 'APK instalada' ($LASTEXITCODE -eq 0)
  }
}

try {
  if ($StartServer) { Wait-Api }
  $health = Invoke-Api 'GET' '/health'
  Write-Result 'Servidor disponible' ($health.status -eq 'ok') "v$($health.version)"

  $admin = Invoke-Api 'POST' '/api/auth/login' @{ username = $adminUser; password = $adminPassword }
  $adminHeaders = @{ Authorization = "Bearer $($admin.token)" }
  Write-Result 'Login administrador' ($admin.role -eq 'admin')

  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  $deviceId = "TEST-$stamp"
  $device = Invoke-Api 'POST' '/api/devices' @{ deviceId = $deviceId; deviceName = 'Dispositivo de prueba'; model = 'Android Test' } $adminHeaders
  Write-Result 'Registro de dispositivo' ($device.success -eq $true -and $device.deviceToken)
  $deviceHeaders = @{ 'X-Device-Token' = $device.deviceToken }

  $location = Invoke-Api 'POST' "/api/devices/$deviceId/locations" @{ latitude = -17.7833; longitude = -63.1821; battery = 90; event = 'test' } $deviceHeaders
  Write-Result 'Reporte GPS autenticado' ($location.success -eq $true)
  $event = Invoke-Api 'POST' "/api/devices/$deviceId/events" @{ type = 'TEST'; description = 'Prueba integral' } $deviceHeaders
  Write-Result 'Reporte de evento autenticado' ($event.success -eq $true)

  $command = Invoke-Api 'POST' '/api/commands' @{ deviceId = $deviceId; command = 'loc'; params = @{} } $adminHeaders
  Write-Result 'Comando de localizacion' ($command.success -eq $true)
  $pending = Invoke-Api 'GET' "/api/commands/$deviceId" $null $deviceHeaders
  Write-Result 'Polling de comandos del dispositivo' ($pending.Count -eq 1)
  $completed = Invoke-Api 'PUT' "/api/commands/$deviceId/$($command.commandId)" @{ status = 'executed'; result = 'OK' } $deviceHeaders
  Write-Result 'Confirmacion de comando' ($completed.success -eq $true)

  $devices = @(Invoke-Api 'GET' '/api/devices' $null $adminHeaders)
  Write-Result 'Listado protegido de dispositivos' (($devices | Where-Object { $_.id -eq $deviceId }).Count -eq 1)
  $licenses = Invoke-Api 'GET' '/api/licenses' $null $adminHeaders
  Write-Result 'Listado protegido de licencias' ($null -ne $licenses.licenses)
} catch {
  Write-Result 'Prueba integral' $false $_.Exception.Message
}

Write-Host "Resultado: $passed PASS / $failed FAIL" -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }

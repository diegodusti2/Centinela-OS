param(
  [string]$HostAddress = '',
  [int]$ApiPort = 3000,
  [int]$DashboardPort = 8080,
  [switch]$Reset,
  [switch]$StartServer,
  [switch]$StartDashboard,
  [switch]$InstallApk,
  [switch]$TestAndroid,
  [string]$AndroidSerial = ''
)

$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $serverRoot
$dbPath = Join-Path $serverRoot 'data\centinela.db'
$adminUser = if ($env:CENTINELA_ADMIN_USER) { $env:CENTINELA_ADMIN_USER } else { 'admin' }
$adminPassword = if ($env:CENTINELA_ADMIN_PASSWORD) { $env:CENTINELA_ADMIN_PASSWORD } else { 'change-me-now' }
$serverProcess = $null
$dashboardProcess = $null
$passed = 0
$failed = 0

function Get-LanAddress {
  $address = Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object InterfaceIndex |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $address) { throw 'No se encontró una IPv4 de la red WiFi. Conecta el equipo a la misma red que el teléfono.' }
  return $address
}

if (-not $HostAddress) {
  $HostAddress = if ($env:CENTINELA_LAN_HOST) { $env:CENTINELA_LAN_HOST } else { Get-LanAddress }
}

$apiUrl = "http://${HostAddress}:${ApiPort}"
$dashboardUrl = "http://${HostAddress}:${ApiPort}"

function Write-Result([string]$name, [bool]$ok, [string]$detail = '') {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host "[$mark] $name $detail" -ForegroundColor $color
  if ($ok) { $script:passed++ } else { $script:failed++ }
}

function Test-Listening([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Invoke-Api([string]$method, [string]$path, [object]$body = $null, [hashtable]$headers = @{}) {
  $requestHeaders = @{}
  foreach ($key in $headers.Keys) { $requestHeaders[$key] = $headers[$key] }
  $params = @{ Uri = "$apiUrl$path"; Method = $method; Headers = $requestHeaders; TimeoutSec = 10 }
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
  throw "La API no responde en $apiUrl"
}

Write-Host 'Centinela OS v3 - prueba WiFi LAN' -ForegroundColor Cyan
Write-Host "Host LAN: $HostAddress"
Write-Host "API: $apiUrl"
Write-Host "Dashboard: $dashboardUrl"

try {
  if ($Reset) {
    $connections = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    foreach ($path in @($dbPath, "$dbPath-wal", "$dbPath-shm")) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
    Write-Host 'Base SQLite reiniciada.' -ForegroundColor Yellow
  }

  if ($StartServer -and -not (Test-Listening $ApiPort)) {
    $serverProcess = Start-Process -FilePath 'node' -ArgumentList 'src\index.js' -WorkingDirectory $serverRoot -PassThru
  }
  if ($StartDashboard -and -not (Test-Listening $DashboardPort)) {
    $dashboardRoot = Join-Path $projectRoot 'centinela_dashboard'
    $webRoot = Join-Path $dashboardRoot 'build\web'
    if (-not (Test-Path (Join-Path $webRoot 'main.dart.js'))) {
      Push-Location $dashboardRoot
      try { flutter build web --release --dart-define="CENTINELA_API_URL=$apiUrl/api" } finally { Pop-Location }
    }
    $dashboardProcess = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', $DashboardPort, '--directory', $webRoot -WorkingDirectory $dashboardRoot -PassThru
  }

  Wait-Api
  $health = Invoke-Api 'GET' '/health'
  Write-Result 'API accesible por IP LAN' ($health.status -eq 'ok') "v$($health.version)"

  $dashboard = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 10
  Write-Result 'Dashboard accesible por IP LAN' ($dashboard.StatusCode -eq 200)

  $cors = Invoke-WebRequest -Uri "$apiUrl/health" -Method Options -Headers @{
    Origin = $dashboardUrl
    'Access-Control-Request-Method' = 'GET'
    'Access-Control-Request-Headers' = 'content-type'
  } -UseBasicParsing -TimeoutSec 10
  $allowOrigin = $cors.Headers['Access-Control-Allow-Origin']
  Write-Result 'CORS permite el dashboard LAN' ($cors.StatusCode -in @(200, 204) -and $allowOrigin -eq $dashboardUrl)

  $login = Invoke-Api 'POST' '/api/auth/login' @{ username = $adminUser; password = $adminPassword }
  Write-Result 'Login por IP LAN' ($login.role -eq 'admin')
  $adminHeaders = @{ Authorization = "Bearer $($login.token)" }

  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  $deviceId = "WIFI-TEST-$stamp"
  $device = Invoke-Api 'POST' '/api/devices' @{ deviceId = $deviceId; deviceName = 'Telefono WiFi'; model = 'LAN test' } $adminHeaders
  Write-Result 'Emision de token de dispositivo' ($device.success -eq $true -and $device.deviceToken)
  $deviceHeaders = @{ 'X-Device-Token' = $device.deviceToken }

  $location = Invoke-Api 'POST' "/api/devices/$deviceId/locations" @{ latitude = -17.7833; longitude = -63.1821; battery = 87; event = 'wifi_test' } $deviceHeaders
  Write-Result 'GPS autenticado por WiFi' ($location.success -eq $true)

  $event = Invoke-Api 'POST' "/api/devices/$deviceId/events" @{ type = 'TEST'; description = 'Prueba desde IP LAN' } $deviceHeaders
  Write-Result 'Evento autenticado por WiFi' ($event.success -eq $true)

  $command = Invoke-Api 'POST' '/api/commands' @{ deviceId = $deviceId; command = 'loc'; params = @{} } $adminHeaders
  $pending = Invoke-Api 'GET' "/api/commands/$deviceId" $null $deviceHeaders
  Write-Result 'Polling de comandos por WiFi' ($pending.Count -eq 1 -and $pending[0].command -eq 'loc')
  $completed = Invoke-Api 'PUT' "/api/commands/$deviceId/$($command.commandId)" @{ status = 'executed'; result = 'LAN_OK' } $deviceHeaders
  Write-Result 'Confirmación de comando por WiFi' ($completed.success -eq $true)

  try {
    Invoke-WebRequest -Uri "$apiUrl/api/devices/$deviceId/locations" -Method Post -ContentType 'application/json' -Body '{"latitude":1,"longitude":2}' -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Result 'Rechazo de telemetría sin token' $false 'La API aceptó una petición sin autenticación'
  } catch {
    $status = [int]$_.Exception.Response.StatusCode
    Write-Result 'Rechazo de telemetría sin token' ($status -eq 401)
  }

  if ($InstallApk) {
    $apkRoot = Join-Path $projectRoot 'centinela_v2'
    Push-Location $apkRoot
    try { flutter build apk --debug --dart-define="CENTINELA_API_URL=$apiUrl/api" } finally { Pop-Location }
    $apk = Join-Path $apkRoot 'build\app\outputs\flutter-apk\app-debug.apk'
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (-not (Test-Path $adb)) { throw "ADB no encontrado: $adb" }
    $adbDevices = @(& $adb devices 2>$null | Where-Object { $_ -match '\sdevice\s*$' })
    if ($adbDevices.Count -eq 0) {
      Write-Result 'Instalación APK' $false 'No hay dispositivo ADB conectado'
    } else {
      & $adb install -r $apk | Out-Host
      Write-Result 'Instalación APK' ($LASTEXITCODE -eq 0)
    }
  }

  if ($TestAndroid) {
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (-not (Test-Path $adb)) { throw "ADB no encontrado: $adb" }
    $adbPrefix = if ($AndroidSerial) { @('-s', $AndroidSerial) } else { @() }
    $androidDevices = @(& $adb @adbPrefix devices 2>$null | Where-Object { $_ -match '\sdevice\s*$' })
    if ($androidDevices.Count -eq 0) {
      Write-Result 'Android conectado por ADB' $false 'No hay dispositivo autorizado'
    } else {
      $wifiAddress = (& $adb @adbPrefix shell ip -4 addr show wlan0 2>$null | Out-String).Trim()
      Write-Host "Android wlan0: $wifiAddress"
      Write-Result 'Android conectado por ADB' $true
      & $adb @adbPrefix shell toybox nc -z -w 3 $HostAddress $ApiPort
      $androidApiExit = $LASTEXITCODE
      & $adb @adbPrefix shell toybox nc -z -w 3 $HostAddress $DashboardPort
      $androidDashboardExit = $LASTEXITCODE
      Write-Result 'Android alcanza API por WiFi' ($androidApiExit -eq 0)
    }
  }
} catch {
  Write-Result 'Prueba WiFi LAN' $false $_.Exception.Message
}

Write-Host "Resultado LAN: $passed PASS / $failed FAIL" -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }

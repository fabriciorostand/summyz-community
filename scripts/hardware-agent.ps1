param([Parameter(Mandatory = $true)][string]$RepositoryDirectory)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$repositoryPath = (Resolve-Path -LiteralPath $RepositoryDirectory).Path
$eventIdentifier = "SummyzHardwareChange"

function Read-AgentSetting {
  param([string]$Name, [string]$Default = "")
  foreach ($line in [IO.File]::ReadAllLines((Join-Path $repositoryPath ".env"))) {
    if ($line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$' -and $Matches[1].Trim() -eq $Name) {
      $value = $Matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
          ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        return $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $Default
}

function Get-AgentSnapshot {
  $processors = @(Get-CimInstance Win32_Processor)
  $system = Get-CimInstance Win32_ComputerSystem
  $cores = ($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
  $adapters = @()
  $nvidiaSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if ($null -ne $nvidiaSmi) {
    $output = @(& $nvidiaSmi.Source "--query-gpu=index,name,memory.total" "--format=csv,noheader,nounits" 2>$null)
    if ($LASTEXITCODE -eq 0) {
      foreach ($line in $output) {
        $fields = ([string]$line).Split(",")
        if ($fields.Count -ne 3) { continue }
        $gpu = @{ id = "nvidia-$($fields[0].Trim())"; name = $fields[1].Trim(); vendor = "nvidia" }
        $memory = 0L
        if ([long]::TryParse($fields[2].Trim(), [ref]$memory) -and $memory -gt 0) {
          $gpu.memoryBytes = $memory * 1024L * 1024L
        }
        $adapters += $gpu
      }
    }
  }
  foreach ($adapter in @(Get-CimInstance Win32_VideoController)) {
    $identity = "$($adapter.PNPDeviceID) $($adapter.Name)"
    $vendor = if ($identity -match '(?i)VEN_1002|AMD|Radeon') { "amd" }
      elseif ($identity -match '(?i)VEN_8086|Intel') { "intel" }
      elseif ($identity -match '(?i)VEN_10DE|NVIDIA') { "nvidia" }
      else { "unknown" }
    if ($vendor -eq "nvidia" -and @($adapters | Where-Object { $_.vendor -eq "nvidia" }).Count -gt 0) { continue }
    $gpu = @{ id = [string]$adapter.PNPDeviceID; name = [string]$adapter.Name; vendor = $vendor }
    if ([string]::IsNullOrWhiteSpace($gpu.id)) { $gpu.id = "windows-$($adapters.Count)" }
    if ([long]$adapter.AdapterRAM -gt 0) { $gpu.memoryBytes = [long]$adapter.AdapterRAM }
    $adapters += $gpu
  }
  return @{
    platform = "win32"
    detectedAt = [DateTime]::UtcNow.ToString("o")
    hardware = @{
      cpuCores = [int]$cores
      cpuName = [string]$processors[0].Name
      memoryBytes = [long]$system.TotalPhysicalMemory
      accelerators = @($adapters)
    }
  } | ConvertTo-Json -Depth 6 -Compress
}

$key = Read-AgentSetting "SUMMYZ_SECRETS_KEY"
if ([string]::IsNullOrWhiteSpace($key)) { throw "The installation secrets key is missing" }
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  $token = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes("summyz-hardware/v1:$key")))).Replace("-", "").ToLowerInvariant()
} finally { $hasher.Dispose() }
$hostAddress = Read-AgentSetting "WEB_HOST" "127.0.0.1"
if ($hostAddress -eq "::") { $hostAddress = "::1" }
if ($hostAddress -in @("0.0.0.0", "localhost")) { $hostAddress = "127.0.0.1" }
$parsedAddress = $null
if (-not [Net.IPAddress]::TryParse($hostAddress, [ref]$parsedAddress)) { throw "WEB_HOST must be an IP address for the hardware agent" }
if ($parsedAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { $hostAddress = "[$hostAddress]" }
$port = Read-AgentSetting "WEB_PORT" "8787"
if ($port -notmatch '^\d{1,5}$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw "Invalid dashboard port" }
$endpoint = "http://" + $hostAddress + ":" + $port + "/api/internal/hardware"
$origin = Read-AgentSetting "PUBLIC_BASE_URL" "http://127.0.0.1:$port"
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(10)
$client.DefaultRequestHeaders.Add("x-summyz-hardware-token", $token)
$client.DefaultRequestHeaders.Add("Origin", $origin)
$client.DefaultRequestHeaders.Host = "127.0.0.1:$port"

try {
  Register-CimIndicationEvent -Namespace "root/cimv2" -Query "SELECT * FROM Win32_DeviceChangeEvent" -SourceIdentifier $eventIdentifier | Out-Null
  $payload = Get-AgentSnapshot
  while ($true) {
    $posted = $false
    $body = [Net.Http.StringContent]::new($payload, [Text.Encoding]::UTF8, "application/json")
    try {
      $response = $client.PostAsync($endpoint, $body).GetAwaiter().GetResult()
      try {
        $posted = $response.IsSuccessStatusCode
        if (-not $posted) { [Console]::Error.WriteLine('{"event":"hardware_report_failed","httpStatus":' + [int]$response.StatusCode + '}') }
      } finally { $response.Dispose() }
    } catch {
      [Console]::Error.WriteLine('{"event":"hardware_report_failed","reason":"dashboard_unreachable"}')
    } finally { $body.Dispose() }
    if ($posted) {
      Wait-Event -SourceIdentifier $eventIdentifier | Out-Null
    } else {
      # Retry delivery of the same report; inventory is scanned only after a native event.
      Wait-Event -SourceIdentifier $eventIdentifier -Timeout 5 | Out-Null
    }
    $events = @(Get-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue)
    if ($events.Count -gt 0) {
      $events | Remove-Event
      $payload = Get-AgentSnapshot
    }
  }
} finally {
  Unregister-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue
  Get-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue | Remove-Event
  $client.Dispose()
}

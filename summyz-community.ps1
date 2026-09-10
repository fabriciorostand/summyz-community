$ErrorActionPreference = "Stop"

$repositoryDirectory = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Set-Location $repositoryDirectory

$commandName = if ($args.Count -gt 0) { [string]$args[0] } else { "" }
$remainingArguments = @($args | Select-Object -Skip 1)
$dryRun = $remainingArguments -contains "--dry-run"
$unexpectedArguments = @($remainingArguments | Where-Object { $_ -ne "--dry-run" })
if ($commandName -eq "" -or $unexpectedArguments.Count -gt 0) {
  [Console]::Error.WriteLine("Usage: .\summyz-community.ps1 <up|down|restart|status|logs|recover-access> [--dry-run]")
  exit 2
}

function New-RandomBase64Url {
  param([Parameter(Mandatory = $true)][int]$ByteCount)

  $bytes = [byte[]]::new($ByteCount)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Initialize-DotEnv {
  $environmentPath = Join-Path $repositoryDirectory ".env"
  if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    $templatePath = Join-Path $repositoryDirectory ".env.example"
    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
      throw ".env.example is missing"
    }
    $databasePassword = New-RandomBase64Url -ByteCount 32
    $contents = [IO.File]::ReadAllText($templatePath)
    $contents = $contents -replace '(?m)^SUMMYZ_SECRETS_KEY=.*$', "SUMMYZ_SECRETS_KEY=$(New-RandomBase64Url -ByteCount 32)"
    $contents = $contents -replace '(?m)^SUMMYZ_SETUP_TOKEN=.*$', "SUMMYZ_SETUP_TOKEN=$(New-RandomBase64Url -ByteCount 32)"
    $contents = $contents -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=postgresql://summyz_community:$databasePassword@postgres:5432/summyz-community-db"
    $contents = $contents -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$databasePassword"
    [IO.File]::WriteAllText($environmentPath, $contents, [Text.UTF8Encoding]::new($false))
    Write-Output "Created .env with random local secrets. Keep this file private."
  }

  $password = Get-DotEnvSetting -Name "POSTGRES_PASSWORD"
  $databaseUrl = Get-DotEnvSetting -Name "DATABASE_URL"
  $secretsKey = Get-DotEnvSetting -Name "SUMMYZ_SECRETS_KEY"
  $setupToken = Get-DotEnvSetting -Name "SUMMYZ_SETUP_TOKEN"
  $invalidValues = @("", "troque-esta-senha", "change-me", "changeme")
  if ($null -eq $password -or $password.Trim().ToLowerInvariant() -in $invalidValues) {
    throw "POSTGRES_PASSWORD must contain a non-placeholder value in .env"
  }
  if ($null -eq $databaseUrl -or $databaseUrl -match '(?i)troque-esta-senha|change-?me') {
    throw "DATABASE_URL must contain a non-placeholder PostgreSQL password in .env"
  }
  if ([string]::IsNullOrWhiteSpace($secretsKey)) {
    throw "SUMMYZ_SECRETS_KEY must be set in .env"
  }
  if ([string]::IsNullOrWhiteSpace($setupToken)) {
    throw "SUMMYZ_SETUP_TOKEN must be set in .env"
  }
}

function Get-DotEnvSetting {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Test-Path -LiteralPath ".env" -PathType Leaf)) {
    return $null
  }
  foreach ($line in Get-Content -LiteralPath ".env") {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([^=]+?)\s*=\s*(.*?)\s*$') {
      continue
    }
    if ($Matches[1].Trim() -ne $Name) {
      continue
    }
    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      return $value.Substring(1, $value.Length - 2)
    }
    return $value
  }
  return $null
}

function Get-Setting {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Default
  )

  $environmentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($environmentValue)) {
    return $environmentValue.Trim()
  }
  $fileValue = Get-DotEnvSetting -Name $Name
  if (-not [string]::IsNullOrWhiteSpace($fileValue)) {
    return $fileValue.Trim()
  }
  return $Default
}

if ($commandName -in @("up", "restart")) {
  Initialize-DotEnv
}

$device = Get-Setting -Name "LOCAL_AI_DEVICE" -Default "auto"
$fallback = Get-Setting -Name "LOCAL_AI_FALLBACK" -Default "none"
if ($device -notin @("auto", "gpu", "cpu")) {
  [Console]::Error.WriteLine("LOCAL_AI_DEVICE must be auto, gpu, or cpu")
  exit 2
}
if ($fallback -notin @("none", "cpu")) {
  [Console]::Error.WriteLine("LOCAL_AI_FALLBACK must be none or cpu")
  exit 2
}

$profile = "cpu"
$gpuName = ""

function Use-CpuFallback {
  param([Parameter(Mandatory = $true)][string]$Reason)

  if ($script:fallback -eq "cpu") {
    Write-Warning "$Reason; authorized CPU fallback selected"
    $script:profile = "cpu"
    $script:gpuName = ""
    return
  }
  [Console]::Error.WriteLine(
    "$Reason. Set LOCAL_AI_FALLBACK=cpu to authorize CPU fallback."
  )
  exit 1
}

function Find-Acceleration {
  if ($script:device -eq "cpu") {
    return
  }

  $injectedVendor = [Environment]::GetEnvironmentVariable(
    "SUMMYZ_DETECTED_GPU_VENDOR",
    "Process"
  )
  if (-not [string]::IsNullOrWhiteSpace($injectedVendor)) {
    switch ($injectedVendor) {
      "nvidia" {
        $script:profile = "nvidia"
        $script:gpuName = Get-Setting -Name "SUMMYZ_DETECTED_GPU_NAME" -Default "NVIDIA GPU"
        return
      }
      "amd" {
        Use-CpuFallback -Reason "AMD GPU acceleration through Docker is unavailable on Windows"
        return
      }
      default {
        Use-CpuFallback -Reason "GPU vendor $injectedVendor has no supported Docker profile"
        return
      }
    }
  }

  $nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
  if ($null -ne $nvidiaSmi) {
    $output = @(
      & $nvidiaSmi.Source `
        "--query-gpu=index,name,memory.total" `
        "--format=csv,noheader,nounits" 2>$null
    )
    if ($LASTEXITCODE -eq 0 -and $output.Count -gt 0) {
      $fields = ([string]$output[0]).Split(",")
      if ($fields.Count -ge 3) {
        $script:profile = "nvidia"
        $script:gpuName = $fields[1].Trim()
        [Environment]::SetEnvironmentVariable(
          "SUMMYZ_DETECTED_GPU_VENDOR",
          "nvidia",
          "Process"
        )
        [Environment]::SetEnvironmentVariable(
          "SUMMYZ_DETECTED_GPU_NAME",
          $script:gpuName,
          "Process"
        )
        $memoryMebibytes = 0L
        if ([long]::TryParse($fields[2].Trim(), [ref]$memoryMebibytes) -and $memoryMebibytes -gt 0) {
          [Environment]::SetEnvironmentVariable(
            "SUMMYZ_DETECTED_GPU_MEMORY_BYTES",
            [string]($memoryMebibytes * 1024L * 1024L),
            "Process"
          )
        }
        return
      }
    }
  }

  $adapters = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue)
  $amdAdapter = $adapters | Where-Object {
    $_.Name -match '(?i)AMD|ATI|Radeon' -or $_.PNPDeviceID -match '(?i)VEN_1002'
  } | Select-Object -First 1
  if ($null -ne $amdAdapter) {
    Use-CpuFallback -Reason "AMD GPU detected, but Docker Desktop on Windows does not expose ROCm"
    return
  }
  if ($script:device -eq "gpu") {
    Use-CpuFallback -Reason "No compatible GPU and driver were detected"
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeCommand)

  $composeArguments = @("-f", "docker-compose.yaml")
  if ($script:profile -eq "nvidia") {
    $composeArguments += @("-f", "docker-compose.nvidia.yaml")
  } elseif ($script:profile -eq "amd") {
    $composeArguments += @("-f", "docker-compose.amd.yaml")
  }
  if ([Environment]::GetEnvironmentVariable("SUMMYZ_PUBLIC_MODE", "Process") -eq "true") {
    $composeArguments += @("-f", "docker-compose.public.yaml")
  }
  $composeArguments += $ComposeCommand
  Write-Output "Executing: docker compose $($composeArguments -join ' ')"

  if ($script:dryRun) {
    return
  }
  if ($null -eq (Get-Command "docker.exe" -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("Docker is not installed or is unavailable in PATH")
    exit 1
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("Docker daemon is unavailable")
    exit 1
  }
  & docker compose @composeArguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Open-SetupPage {
  $setupToken = Get-DotEnvSetting -Name "SUMMYZ_SETUP_TOKEN"
  if ([string]::IsNullOrWhiteSpace($setupToken)) {
    return
  }
  $publicBaseUrl = Get-DotEnvSetting -Name "PUBLIC_BASE_URL"
  $webPort = Get-Setting -Name "WEB_PORT" -Default "8787"
  $baseUrl = if ([string]::IsNullOrWhiteSpace($publicBaseUrl)) {
    "http://127.0.0.1:$webPort"
  } else {
    $publicBaseUrl.TrimEnd("/")
  }
  $setupUrl = "$baseUrl/setup#claim=$([Uri]::EscapeDataString($setupToken))"
  if ([Environment]::GetEnvironmentVariable("SUMMYZ_PUBLIC_MODE", "Process") -eq "true") {
    Write-Output "Open the private setup link shown below. It stops working after setup is completed."
    Write-Output $setupUrl
    return
  }
  Start-Process $setupUrl
}

switch ($commandName) {
  "up" {
    Find-Acceleration
    if ($profile -eq "nvidia") {
      Write-Output "GPU: $gpuName"
      Write-Output "Profile: NVIDIA/CUDA"
    } else {
      Write-Output "Profile: CPU"
    }
    Invoke-Compose "up" "-d" "--build"
    if (-not $dryRun) { Open-SetupPage }
  }
  "restart" {
    Find-Acceleration
    if ($profile -eq "nvidia") {
      Write-Output "GPU: $gpuName"
      Write-Output "Profile: NVIDIA/CUDA"
    } else {
      Write-Output "Profile: CPU"
    }
    Invoke-Compose "up" "-d" "--build" "--force-recreate"
  }
  "down" { Invoke-Compose "down" }
  "status" { Invoke-Compose "ps" }
  "logs" { Invoke-Compose "logs" "--follow" }
  "recover-access" { Invoke-Compose "exec" "dashboard" "node" "dist/api/installation-access-recovery.js" }
  default {
    [Console]::Error.WriteLine("Usage: .\summyz-community.ps1 <up|down|restart|status|logs|recover-access> [--dry-run]")
    exit 2
  }
}

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
    $contents = $contents -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=postgresql://summyz_community:$databasePassword@postgres:5432/summyz-community-db"
    $contents = $contents -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$databasePassword"
    $contents = $contents.TrimEnd([char[]]"`r`n") + [Environment]::NewLine
    $contents += "SUMMYZ_SECRETS_KEY=$(New-RandomBase64Url -ByteCount 32)" + [Environment]::NewLine
    $contents += "SUMMYZ_SETUP_TOKEN=$(New-RandomBase64Url -ByteCount 32)" + [Environment]::NewLine
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

$profile = "cpu"
$gpuName = ""

function Use-CpuOnly {
  param([Parameter(Mandatory = $true)][string]$Reason)
  Write-Warning "$Reason; GPU unavailable, CPU instances remain available"
  $script:profile = "cpu"
  $script:gpuName = ""
}

function Find-Acceleration {
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
        Use-CpuOnly -Reason "AMD GPU acceleration through Docker is unavailable on Windows"
        return
      }
      default {
        Use-CpuOnly -Reason "GPU vendor $injectedVendor has no supported Docker profile"
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
    Use-CpuOnly -Reason "AMD GPU detected, but Docker Desktop on Windows does not expose ROCm"
    return
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeCommand)

  $composeArguments = @("-f", "compose.yaml")
  if ($script:profile -eq "nvidia") {
    $composeArguments += @("-f", "docker/compose.nvidia.yaml")
  } elseif ($script:profile -eq "amd") {
    $composeArguments += @("-f", "docker/compose.amd.yaml")
  }
  if ([Environment]::GetEnvironmentVariable("SUMMYZ_PUBLIC_MODE", "Process") -eq "true") {
    $composeArguments += @("-f", "docker/compose.public.yaml")
  }
  $composeArguments += $ComposeCommand
  Write-Output "Executing: docker compose $($composeArguments -join ' ')"

  if ($script:dryRun) {
    return
  }
  if ($null -eq (Get-Command "docker.exe" -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("Docker is not installed or is unavailable in PATH")
    throw "Docker executable unavailable"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("Docker daemon is unavailable")
    throw "Docker daemon unavailable"
  }
  & docker compose @composeArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed with exit code $LASTEXITCODE"
  }
}

function Start-GpuServices {
  if ($script:profile -eq "cpu") { return }
  $gpuServices = @("ollama-gpu")
  if ($script:profile -eq "nvidia") { $gpuServices += "faster-whisper-gpu" }
  foreach ($gpuService in $gpuServices) {
    try {
      Invoke-Compose "up" "-d" "--build" "--no-deps" "--wait" "--wait-timeout" "90" $gpuService
    } catch {
      Write-Warning "$gpuService failed to start; this provider's GPU is unavailable, CPU remains available"
      try { Invoke-Compose "stop" $gpuService } catch { Write-Warning "Unable to stop unavailable GPU service" }
      try { Invoke-Compose "rm" "-f" $gpuService } catch { Write-Warning "Unable to remove unavailable GPU service" }
    }
  }
}

function Invoke-HardwareAgentSetup {
  param([Parameter(Mandatory = $true)][ValidateSet("install", "stop")][string]$Action)
  if ($script:dryRun) {
    Write-Output "Hardware event detector: $Action at system startup (dry run)"
    return
  }
  $installerPath = Join-Path $repositoryDirectory "scripts/install-hardware-agent.ps1"
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    & $installerPath -Action $Action -RepositoryDirectory $repositoryDirectory -InstallationUser $identity.Name
    return
  }
  $installerArguments = @(
    "-NoProfile", "-NonInteractive", "-File", ('"' + $installerPath + '"'),
    "-Action", $Action, "-RepositoryDirectory", ('"' + $repositoryDirectory + '"'),
    "-InstallationUser", ('"' + $identity.Name + '"')
  )
  $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $installerArguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Unable to configure the host hardware event detector" }
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
    Start-GpuServices
    Invoke-HardwareAgentSetup -Action "install"
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
    Start-GpuServices
    Invoke-HardwareAgentSetup -Action "install"
  }
  "down" {
    Invoke-HardwareAgentSetup -Action "stop"
    Invoke-Compose "down" "--remove-orphans"
  }
  "status" { Invoke-Compose "ps" }
  "logs" { Invoke-Compose "logs" "--follow" }
  "recover-access" { Invoke-Compose "exec" "dashboard" "node" "dist/api/installation-access-recovery.js" "--access-mode" "public" }
  default {
    [Console]::Error.WriteLine("Usage: .\summyz-community.ps1 <up|down|restart|status|logs|recover-access> [--dry-run]")
    exit 2
  }
}

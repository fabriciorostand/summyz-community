$ErrorActionPreference = "Stop"

$repositoryDirectory = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Set-Location $repositoryDirectory

$commandName = if ($args.Count -gt 0) { [string]$args[0] } else { "" }
$remainingArguments = @($args | Select-Object -Skip 1)
$dryRun = $remainingArguments -contains "--dry-run"
$unexpectedArguments = @($remainingArguments | Where-Object { $_ -ne "--dry-run" })
if ($commandName -eq "" -or $unexpectedArguments.Count -gt 0) {
  [Console]::Error.WriteLine("Usage: .\summyz.ps1 <up|down|restart|status|logs> [--dry-run]")
  exit 2
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

  $nvidiaSmi = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
  if ($null -ne $nvidiaSmi) {
    $output = & $nvidiaSmi.Source `
      "--query-gpu=index,name,memory.total" `
      "--format=csv,noheader,nounits" 2>$null
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
  exit $LASTEXITCODE
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
  default {
    [Console]::Error.WriteLine("Usage: .\summyz.ps1 <up|down|restart|status|logs> [--dry-run]")
    exit 2
  }
}

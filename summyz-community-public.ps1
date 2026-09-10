$ErrorActionPreference = "Stop"

$repositoryDirectory = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$environmentPath = Join-Path $repositoryDirectory ".env"
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  & (Join-Path $repositoryDirectory "summyz-community.ps1") up --dry-run *> $null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    [Console]::Error.WriteLine("Unable to create .env for public mode")
    exit 1
  }
}

$publicBaseUrl = $null
foreach ($line in Get-Content -LiteralPath $environmentPath) {
  if ($line -match '^\s*PUBLIC_BASE_URL\s*=\s*(.*?)\s*$') {
    $publicBaseUrl = $Matches[1].Trim().Trim('"').Trim("'")
    break
  }
}
if ([string]::IsNullOrWhiteSpace($publicBaseUrl) -or -not $publicBaseUrl.StartsWith("https://")) {
  [Console]::Error.WriteLine("PUBLIC_BASE_URL must use HTTPS in public mode. Edit .env and run this command again.")
  exit 2
}

[Environment]::SetEnvironmentVariable("SUMMYZ_PUBLIC_MODE", "true", "Process")
& (Join-Path $repositoryDirectory "summyz-community.ps1") @args
exit $LASTEXITCODE

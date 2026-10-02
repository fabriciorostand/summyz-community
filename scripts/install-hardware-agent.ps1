param(
  [Parameter(Mandatory = $true)][ValidateSet("install", "stop", "uninstall")][string]$Action,
  [Parameter(Mandatory = $true)][string]$RepositoryDirectory,
  [Parameter(Mandatory = $true)][string]$InstallationUser
)
$ErrorActionPreference = "Stop"
$repositoryPath = (Resolve-Path -LiteralPath $RepositoryDirectory).Path
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$administrator = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $administrator.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Hardware startup registration requires an elevated PowerShell"
}
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  $suffix = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($repositoryPath)))).Replace("-", "").Substring(0, 12)
} finally { $hasher.Dispose() }
$taskName = "SummyzHardware-$suffix"
if ($Action -in @("stop", "uninstall")) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $taskName
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    if ($Action -eq "uninstall") { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
  }
  return
}
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) { Stop-ScheduledTask -TaskName $taskName }
$scriptPath = Join-Path $repositoryPath "scripts/hardware-agent.ps1"
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $scriptPath + '" -RepositoryDirectory "' + $repositoryPath + '"'
$taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $InstallationUser -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Host hardware event detector registered for startup."

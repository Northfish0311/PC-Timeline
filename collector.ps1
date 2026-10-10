$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$warnings = @(); $drives = @(); $usb = @(); $software = @()
try {
  $drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ id = $_.DeviceID; total = [double]$_.Size; free = [double]$_.FreeSpace } })
} catch { $warnings += 'disk' }
try {
  $usb = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\*' } | ForEach-Object {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $id = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($_.InstanceId))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    @{ id = $id; name = [string]$_.FriendlyName; version = [string]$_.Class; status = [string]$_.Status }
  })
} catch { $warnings += 'usb' }
try {
  $roots = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
  $software = @(Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and !$_.SystemComponent } | ForEach-Object { @{ id = [string]$_.PSChildName; name = [string]$_.DisplayName; version = [string]$_.DisplayVersion } } | Sort-Object { $_.name }, { $_.id } -Unique)
} catch { $warnings += 'software' }
@{ time = [DateTime]::UtcNow.ToString('o'); drives = $drives; usb = $usb; software = $software; warnings = $warnings } | ConvertTo-Json -Depth 6 -Compress

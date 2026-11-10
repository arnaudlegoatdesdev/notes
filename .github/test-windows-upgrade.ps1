$ErrorActionPreference = 'Stop'

function Get-Registration([string]$name) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $hive = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    $key = $hive.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Uninstall\$name")
    if ($null -ne $key) {
      $result = [pscustomobject]@{
        DisplayName = $key.GetValue('DisplayName')
        DisplayVersion = $key.GetValue('DisplayVersion')
        MainBinaryName = $key.GetValue('MainBinaryName')
        InstallLocation = $key.GetValue('InstallLocation')
      }
      $key.Dispose()
      $hive.Dispose()
      return $result
    }
    $hive.Dispose()
  }
  return $null
}

function Invoke-Installer([string]$path, [string[]]$arguments) {
  $process = Start-Process -FilePath $path -ArgumentList $arguments -PassThru
  if (-not $process.WaitForExit(180000)) {
    $process.Kill($true)
    throw "Le test de l’installeur a dépassé le délai autorisé."
  }
  if ($process.ExitCode -ne 0) { throw "L’installeur a échoué : $($process.ExitCode)." }
}

$legacyInstaller = Join-Path $env:RUNNER_TEMP 'notes-upgrade-previous.exe'
Invoke-WebRequest 'https://github.com/arnaudlegoatdesdev/flion/releases/download/v0.1.0/Flion_0.1.0_x64-setup.exe' -OutFile $legacyInstaller
Invoke-Installer $legacyInstaller @('/S')
$legacy = Get-Registration 'Flion'
if ($null -eq $legacy -or $legacy.DisplayVersion -ne '0.1.0' -or $legacy.MainBinaryName -ine 'flion.exe') {
  throw "La version précédente n’a pas été installée comme prévu."
}
$directory = ([string]$legacy.InstallLocation).Trim('"')
if (-not (Test-Path (Join-Path $directory 'flion.exe'))) { throw "Exécutable précédent introuvable." }

$notesProfileDirectory = Join-Path $env:LOCALAPPDATA 'fr.flion.notes'
New-Item -ItemType Directory -Force $notesProfileDirectory | Out-Null
$marker = Join-Path $notesProfileDirectory 'upgrade-preservation-marker.txt'
'Storage must survive a product rename.' | Set-Content $marker
$installer = Get-Item 'src-tauri/target/release/bundle/nsis/Notes_0.1.1_x64-setup.exe'
if ($null -eq $installer) { throw "Installeur Notes introuvable." }
Invoke-Installer $installer.FullName @('/S', '/UPDATE')

$current = Get-Registration 'Notes'
if ($null -eq $current -or $current.DisplayName -ne 'Notes' -or $current.DisplayVersion -ne '0.1.1') {
  throw "La mise à jour n’a pas enregistré Notes correctement."
}
if ($null -ne (Get-Registration 'Flion')) { throw "Une ancienne entrée de désinstallation subsiste." }
$currentDirectory = ([string]$current.InstallLocation).Trim('"')
if ($currentDirectory -ne $directory) { throw "La mise à jour n’a pas conservé le répertoire existant." }
if (-not (Test-Path (Join-Path $directory 'Notes.exe'))) { throw "Exécutable Notes introuvable." }
if (Test-Path (Join-Path $directory 'flion.exe')) { throw "L’ancien exécutable subsiste." }
if ((Get-Content $marker -Raw).Trim() -ne 'Storage must survive a product rename.') { throw "Les données applicatives n’ont pas été préservées." }

$startMenu = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$notesShell = New-Object -ComObject WScript.Shell
foreach ($folder in @($startMenu, $desktop)) {
  if (Test-Path (Join-Path $folder 'Flion.lnk')) { throw "Un ancien raccourci subsiste." }
  $link = Join-Path $folder 'Notes.lnk'
  if (-not (Test-Path $link)) { throw "Raccourci Notes introuvable." }
  if ($notesShell.CreateShortcut($link).TargetPath -ine (Join-Path $directory 'Notes.exe')) { throw "Un raccourci Notes pointe vers un exécutable incorrect." }
}
Write-Output 'Mise à jour Windows validée : un seul produit Notes, données conservées et raccourcis actualisés.'

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $PSScriptRoot 'bin\MeetScribeHotkey.exe'
New-Item -ItemType Directory -Force (Split-Path -Parent $output) | Out-Null
Add-Type -TypeDefinition (Get-Content (Join-Path $PSScriptRoot 'MeetScribeHotkey.cs') -Raw) `
  -ReferencedAssemblies System.Windows.Forms `
  -OutputAssembly $output `
  -OutputType WindowsApplication
Write-Output "Built $output"

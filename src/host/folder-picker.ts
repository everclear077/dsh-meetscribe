import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const folderPickerScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 MeetScribe Word 输出文件夹'
$dialog.ShowNewFolderButton = $true
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Write($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
  $owner.Close()
  $owner.Dispose()
}
`

/** Open the interactive Windows folder picker on the user's desktop. */
export async function selectWindowsDirectory(): Promise<string | null> {
  if (process.platform !== 'win32') throw new Error('文件夹选择目前仅支持 Windows')
  const encoded = Buffer.from(folderPickerScript, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-EncodedCommand', encoded,
  ], {
    windowsHide: true,
    maxBuffer: 16 * 1024,
  })
  return stdout.trim() || null
}

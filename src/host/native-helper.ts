import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let child: ChildProcess | null = null

/** Start the optional Windows global-hotkey companion next to the packaged plugin. */
export function startGlobalHotkeyHelper(): { running: boolean; path?: string } {
  if (process.platform !== 'win32' || child?.exitCode === null) return { running: !!child }
  const executable = fileURLToPath(new URL('../native/bin/MeetScribeHotkey.exe', import.meta.url))
  if (!existsSync(executable)) return { running: false, path: executable }
  child = spawn(executable, [], { stdio: 'ignore', windowsHide: true })
  child.once('exit', () => { child = null })
  child.once('error', (error) => {
    console.warn('[dsh-meetscribe] Global hotkey helper failed:', error)
    child = null
  })
  return { running: true, path: executable }
}

export function stopGlobalHotkeyHelper(): void {
  if (child?.exitCode === null) child.kill()
  child = null
}

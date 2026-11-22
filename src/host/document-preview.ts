import { lstat, readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { GeneratedFile } from '../shared/types.ts'

interface OfficeKitResult {
  pdf: Uint8Array
  missingFonts: string[]
}

interface OfficeKitService {
  convert(request: {
    extension: 'docx'
    priority: 'foreground'
    source: {
      key: string
      version: string
      bytes: number
      read(signal: AbortSignal, maxBytes: number): Promise<{ bytes: Uint8Array; version: string }>
    }
  }, signal?: AbortSignal): Promise<OfficeKitResult>
}

/** Use DSH's own Host Office renderer; never opens an external application. */
export async function renderMinutesPdf(ctx: Context, file: GeneratedFile): Promise<OfficeKitResult> {
  const officeKit = ctx.get('officeKit') as OfficeKitService | undefined
  if (!officeKit || typeof officeKit.convert !== 'function') {
    throw new Error('当前 DSH 没有可用的 Office 预览组件，无法在内置查看器中打开 Word')
  }
  const link = await lstat(file.path)
  if (!link.isFile() || link.isSymbolicLink()) throw new Error('纪要文件不是可预览的普通文件')
  const metadata = await stat(file.path)
  if (metadata.size <= 0 || metadata.size > 50 * 1024 * 1024) throw new Error('纪要文件为空或超过 DSH 的 50 MB 预览上限')
  const version = `${metadata.mtimeMs.toString(36)}-${metadata.size.toString(36)}`
  return officeKit.convert({
    extension: 'docx',
    priority: 'foreground',
    source: {
      key: `meetscribe:${file.version}:${file.path}`,
      version,
      bytes: metadata.size,
      read: async (signal, maxBytes) => {
        signal.throwIfAborted()
        if (metadata.size > maxBytes) throw new Error('纪要文件超过本次预览允许的大小')
        const bytes = await readFile(file.path, { signal })
        const after = await stat(file.path)
        const currentVersion = `${after.mtimeMs.toString(36)}-${after.size.toString(36)}`
        if (!after.isFile() || currentVersion !== version || bytes.length !== metadata.size) {
          throw new Error('预览期间文件发生变化，请关闭后重新打开')
        }
        signal.throwIfAborted()
        return { bytes, version }
      },
    },
  })
}

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ALLOWED_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'hf-mirror.com',
])
const MAX_REDIRECTS = 6

export type EnsureUrlFileResult = 'cached' | 'downloaded'

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function allowedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (
      ALLOWED_HOSTS.has(url.hostname) ||
      url.hostname.endsWith('.huggingface.co') ||
      url.hostname.endsWith('.hf.co')
    )
  } catch {
    return false
  }
}

async function fetchAllowed(
  initialUrl: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Response> {
  let current = initialUrl
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!allowedUrl(current)) throw new Error('模型下载地址不在允许列表中')
    const response = await fetcher(current, {
      headers: { 'user-agent': 'dsh-meetscribe' },
      redirect: 'manual',
      signal,
    })
    if (response.url && !allowedUrl(response.url)) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('模型下载响应地址不在允许列表中')
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) throw new Error('模型下载重定向缺少目标地址')
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  throw new Error('模型下载重定向次数过多')
}

/**
 * Download a pinned public model asset without executing downloaded content.
 * Existing files are replaced only after the new file passes size and SHA-256 checks.
 */
export async function ensureUrlFile(options: {
  url: string
  path: string
  sha256: string
  expectedSize?: number
  onProgress?: (percent: number) => void
  signal?: AbortSignal
  fetcher?: typeof fetch
}): Promise<EnsureUrlFileResult> {
  if (!allowedUrl(options.url)) throw new Error('模型下载地址不在允许列表中')
  const existing = await stat(options.path).catch(() => null)
  if (existing && !existing.isFile()) throw new Error('模型路径不是普通文件')
  if (
    existing &&
    (options.expectedSize === undefined || existing.size === options.expectedSize) &&
    await fileSha256(options.path).catch(() => '') === options.sha256
  ) {
    options.onProgress?.(100)
    return 'cached'
  }

  await mkdir(dirname(options.path), { recursive: true })
  const suffix = `${process.pid}-${randomUUID()}`
  const part = `${options.path}.${suffix}.part`
  const backup = `${options.path}.${suffix}.backup`
  const response = await fetchAllowed(options.url, options.fetcher ?? fetch, options.signal)
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`模型下载失败 (HTTP ${response.status})`)
  }

  const reader = response.body.getReader()
  const sink = createWriteStream(part, { flags: 'wx' })
  const total = Number(response.headers.get('content-length') || options.expectedSize || 0)
  let received = 0
  let movedExisting = false
  try {
    options.onProgress?.(0)
    const chunks = async function* (): AsyncGenerator<Buffer> {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        received += chunk.length
        if (total > 0) options.onProgress?.(Math.min(99, Math.floor(received / total * 100)))
        yield chunk
      }
    }
    await pipeline(Readable.from(chunks()), sink)
    const actual = await stat(part)
    if (options.expectedSize !== undefined && actual.size !== options.expectedSize) {
      throw new Error(`模型文件大小校验失败：期望 ${options.expectedSize}，实际 ${actual.size}`)
    }
    if (await fileSha256(part) !== options.sha256) throw new Error('模型文件 SHA-256 校验失败')

    if (existing) {
      await rename(options.path, backup)
      movedExisting = true
    }
    try {
      await rename(part, options.path)
    } catch (error) {
      if (movedExisting) await rename(backup, options.path).catch(() => undefined)
      movedExisting = false
      throw error
    }
    if (movedExisting) await unlink(backup).catch(() => undefined)
    options.onProgress?.(100)
    return 'downloaded'
  } catch (error) {
    sink.destroy()
    await reader.cancel().catch(() => undefined)
    await unlink(part).catch(() => undefined)
    if (movedExisting) await rename(backup, options.path).catch(() => undefined)
    throw error
  }
}

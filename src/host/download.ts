import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

const ALLOWED_REDIRECT_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'hf-mirror.com',
])

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function allowedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (ALLOWED_REDIRECT_HOSTS.has(url.hostname) || url.hostname.endsWith('.huggingface.co') || url.hostname.endsWith('.hf.co'))
  } catch {
    return false
  }
}

/** Download a pinned public model asset without executing any downloaded content. */
export async function ensureUrlFile(options: {
  url: string
  path: string
  sha256: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}): Promise<boolean> {
  const existing = await stat(options.path).catch(() => null)
  if (existing?.isFile() && await fileSha256(options.path).catch(() => '') === options.sha256) return true
  if (existing) await unlink(options.path).catch(() => undefined)
  if (!allowedUrl(options.url)) throw new Error('Model URL host is not allowed')
  await mkdir(dirname(options.path), { recursive: true })
  const part = `${options.path}.part`
  const response = await fetch(options.url, {
    headers: { 'user-agent': 'dsh-meetscribe' },
    redirect: 'follow',
    signal: options.signal,
  })
  if (!response.ok || !response.body || !allowedUrl(response.url)) return false
  const total = Number(response.headers.get('content-length') || 0)
  const sink = createWriteStream(part)
  const reader = response.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!sink.write(value)) await new Promise<void>((resolve) => sink.once('drain', resolve))
      received += value.byteLength
      if (total > 0) options.onProgress?.(Math.min(100, Math.round(received / total * 100)))
    }
    sink.end()
    await new Promise<void>((resolve, reject) => {
      sink.once('finish', resolve)
      sink.once('error', reject)
    })
    if (await fileSha256(part) !== options.sha256) {
      await unlink(part).catch(() => undefined)
      return false
    }
    await rename(part, options.path)
    options.onProgress?.(100)
    return true
  } catch (error) {
    sink.destroy()
    throw error
  }
}

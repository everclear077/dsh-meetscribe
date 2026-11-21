import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureUrlFile, LocalModelManager, SpeakerIdentifier } from '../lib/index.js'

const url = 'https://huggingface.co/example/model.bin'
const content = Buffer.from('verified local model fixture')
const sha256 = createHash('sha256').update(content).digest('hex')

async function fixtureDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-model-download-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function response(body = content, init = {}, responseUrl = url) {
  const value = new Response(body, { status: 200, ...init })
  Object.defineProperty(value, 'url', { value: responseUrl })
  return value
}

test('model download writes the verified file and reuses its cache', async (t) => {
  const directory = await fixtureDirectory(t)
  const path = join(directory, 'model.bin')
  let requests = 0
  const progress = []
  const fetcher = async () => { requests++; return response() }
  const options = { url, path, sha256, expectedSize: content.length, fetcher, onProgress: (value) => progress.push(value) }
  assert.equal(await ensureUrlFile(options), 'downloaded')
  assert.equal(await ensureUrlFile(options), 'cached')
  assert.deepEqual(await readFile(path), content)
  assert.equal(requests, 1)
  assert.equal(progress.at(-1), 100)
  assert.deepEqual(await readdir(directory), ['model.bin'])
})

test('failed checksum preserves the previous file and removes temporary data', async (t) => {
  const directory = await fixtureDirectory(t)
  const path = join(directory, 'model.bin')
  await writeFile(path, 'previous-file')
  const fetcher = async () => response(Buffer.alloc(content.length, 1))
  await assert.rejects(
    ensureUrlFile({ url, path, sha256, expectedSize: content.length, fetcher }),
    /SHA-256/,
  )
  assert.equal(await readFile(path, 'utf8'), 'previous-file')
  assert.deepEqual(await readdir(directory), ['model.bin'])
})

test('every redirect must remain on an allowed HTTPS host', async (t) => {
  const directory = await fixtureDirectory(t)
  let requests = 0
  const fetcher = async () => {
    requests++
    const value = new Response(null, { status: 302, headers: { location: 'https://untrusted.example/model' } })
    Object.defineProperty(value, 'url', { value: url })
    return value
  }
  await assert.rejects(
    ensureUrlFile({ url, path: join(directory, 'model.bin'), sha256, fetcher }),
    /允许列表/,
  )
  assert.equal(requests, 1)
  assert.deepEqual(await readdir(directory), [])
})

test('model manager deduplicates concurrent downloads of the same model', async (t) => {
  const directory = await fixtureDirectory(t)
  const definition = { fileName: 'model.bin', directory: 'asr', url, sha256, size: content.length }
  const catalog = { asr: definition, vad: definition, speaker: definition }
  let requests = 0
  let release
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const fetcher = async () => {
    requests++
    const blocked = new Promise((resolve) => { release = resolve })
    markStarted()
    await blocked
    return response()
  }
  const manager = new LocalModelManager(directory, fetcher, catalog)
  const first = manager.ensure('asr')
  const second = manager.ensure('asr')
  assert.strictEqual(first, second)
  await started
  release()
  assert.deepEqual(await first, { path: join(directory, 'asr', 'model.bin'), downloaded: true })
  assert.equal(requests, 1)
  assert.equal((await manager.ensure('asr')).downloaded, false)
  assert.equal(requests, 1)
})

test('installed-model inspection performs no network request and rejects corruption', async (t) => {
  const directory = await fixtureDirectory(t)
  const definition = { fileName: 'model.bin', directory: 'speaker', url, sha256, size: content.length }
  const catalog = { asr: definition, vad: definition, speaker: definition }
  let requests = 0
  const fetcher = async () => { requests++; return response() }
  const manager = new LocalModelManager(directory, fetcher, catalog)
  assert.equal(await manager.installed('speaker'), null)
  assert.equal(requests, 0)
  assert.equal((await manager.ensure('speaker')).downloaded, true)
  assert.equal(requests, 1)
  assert.deepEqual(await manager.installed('speaker'), { path: manager.path('speaker'), downloaded: false })
  assert.equal(requests, 1)
  await writeFile(manager.path('speaker'), Buffer.alloc(content.length, 1))
  assert.equal(await manager.installed('speaker'), null)
  assert.equal(requests, 1)
})

test('speaker lazy loading does not download a missing model during recording', async () => {
  let installedChecks = 0
  let downloads = 0
  const manager = {
    path: () => 'speaker.onnx',
    async installed() { installedChecks++; return null },
    async ensure() { downloads++; throw new Error('explicit download requested') },
  }
  const speaker = new SpeakerIdentifier(manager, () => undefined)
  assert.equal(await speaker.ready(), false)
  assert.equal(installedChecks, 1)
  assert.equal(downloads, 0)
  assert.match(speaker.status().error, /检查并准备模型/)
  assert.equal(await speaker.ready(), false)
  assert.equal(installedChecks, 1)
  assert.equal(downloads, 0)
  assert.equal(await speaker.prepare(), false)
  assert.equal(downloads, 1)
})

test('model manager retries the pinned mirror after a network failure', async (t) => {
  const directory = await fixtureDirectory(t)
  const mirror = 'https://hf-mirror.com/example/model.bin'
  const definition = { fileName: 'model.bin', directory: 'asr', url, fallbackUrls: [mirror], sha256, size: content.length }
  const catalog = { asr: definition, vad: definition, speaker: definition }
  const requests = []
  const fetcher = async (input) => {
    const requested = String(input)
    requests.push(requested)
    if (requested === url) throw new Error('primary unavailable')
    const value = response(content, {}, requested)
    return value
  }
  const manager = new LocalModelManager(directory, fetcher, catalog)
  assert.equal((await manager.ensure('asr')).downloaded, true)
  assert.deepEqual(requests, [url, mirror])
  assert.deepEqual(await readFile(manager.path('asr')), content)
})

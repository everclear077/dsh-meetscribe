import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAsrRuntime, pcmToSamples, resolveLocalModelPaths } from '../lib/index.js'

const capabilities = { nativeSampleRate: 16000, maxAudioMs: 30000, supportsStreaming: false }
const tick = () => new Promise((resolve) => setImmediate(resolve))

async function modelFiles(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-local-runtime-'))
  const modelPaths = { asr: join(directory, 'asr.gguf'), vad: join(directory, 'vad.gguf') }
  await writeFile(modelPaths.asr, 'test-model')
  await writeFile(modelPaths.vad, 'test-vad')
  t.after(() => rm(directory, { recursive: true, force: true }))
  return modelPaths
}

function fakeAsrModel(transcribe) {
  return {
    roles: ['asr'],
    capabilities,
    arch: 'sensevoice',
    variant: 'sensevoice-small',
    transcribe,
    dispose() {},
  }
}

test('local model paths stay inside the plugin model directory', () => {
  const root = join(tmpdir(), 'meetscribe-models')
  const paths = resolveLocalModelPaths(root)
  assert.equal(paths.asr, join(root, 'asr', 'SenseVoiceSmall-Q8_0.gguf'))
  assert.equal(paths.vad, join(root, 'vad', 'silero-vad-v6.2-F32.gguf'))
  assert.throws(() => resolveLocalModelPaths(''), /模型目录不能为空/)
})

test('Local partial snapshots and final transcription preserve raw and corrected text', async (t) => {
  const modelPaths = await modelFiles(t)
  const calls = []
  const model = fakeAsrModel(async (pcm, options) => {
    calls.push({ samples: pcm.length, options })
    return { text: '对其和向梁数据库' }
  })
  let now = 10000
  const runtime = createAsrRuntime({
    modelPaths,
    senseITN: () => true,
    broadcast: () => undefined,
    replaceText: (text) => text.replace('对其', '对齐').replace('向梁数据库', '向量数据库'),
  }, { loadAsrModel: async () => model, now: () => now })
  t.after(() => runtime.dispose())
  assert.equal(await runtime.retryModel('asr'), true)

  const first = await runtime.feed('meeting', new Float32Array(8000), false, 0, 4)
  assert.equal(first.text, '')
  await tick()
  const partial = await runtime.feed('meeting', new Float32Array(0), false, 8000, 4)
  assert.equal(partial.rawText, '对其和向梁数据库')
  assert.equal(partial.text, '对齐和向量数据库')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].samples, 8000)
  assert.equal(calls[0].options.itn, 'on')

  now += 1000
  const final = await runtime.feed('meeting', new Float32Array(1600), true, 8000, 4)
  assert.equal(final.rawText, '对其和向梁数据库')
  assert.equal(final.text, '对齐和向量数据库')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].samples, 9600)

  const retry = await runtime.feed('meeting', new Float32Array(0), true, 9600, 4)
  assert.equal(retry.text, final.text)
  assert.equal(calls.length, 2, 'final retries reuse the cached raw model result')
})

test('concurrent Local final requests share one native inference', async (t) => {
  const modelPaths = await modelFiles(t)
  let release
  let calls = 0
  const model = fakeAsrModel(() => {
    calls++
    return new Promise((resolve) => { release = () => resolve({ text: '同一段文本' }) })
  })
  const runtime = createAsrRuntime({ modelPaths, senseITN: () => true, broadcast: () => undefined }, { loadAsrModel: async () => model })
  t.after(() => runtime.dispose())
  await runtime.retryModel('asr')
  const first = runtime.feed('meeting', new Float32Array(8000), true, 0, 0)
  const second = runtime.feed('meeting', new Float32Array(8000), true, 0, 0)
  await tick()
  assert.equal(calls, 1)
  release()
  assert.deepEqual((await first).text, '同一段文本')
  assert.deepEqual((await second).text, '同一段文本')
  assert.equal(calls, 1)
})

test('reset prevents an in-flight final from polluting a reused epoch', async (t) => {
  const modelPaths = await modelFiles(t)
  let release
  let calls = 0
  const model = fakeAsrModel(() => {
    calls++
    if (calls === 1) return new Promise((resolve) => { release = () => resolve({ text: '旧文本' }) })
    return Promise.resolve({ text: '新文本' })
  })
  const runtime = createAsrRuntime({ modelPaths, senseITN: () => true, broadcast: () => undefined }, { loadAsrModel: async () => model })
  t.after(() => runtime.dispose())
  await runtime.retryModel('asr')
  const stale = runtime.feed('meeting', new Float32Array(8000), true, 0, 0)
  await tick()
  runtime.reset('meeting')
  release()
  assert.equal((await stale).text, '旧文本')
  const fresh = await runtime.feed('meeting', new Float32Array(8000), true, 0, 0)
  assert.equal(fresh.text, '新文本')
  assert.equal(calls, 2)
})

test('Local VAD detect uses native frame probabilities and resets sessions', async (t) => {
  const modelPaths = await modelFiles(t)
  let resets = 0
  let disposed = false
  const session = {
    async streamFeed() { return { probs: [0.1, 0.8], firstFrame: 0, segments: [] } },
    async streamReset() { resets++ },
    dispose() { disposed = true },
  }
  const runtime = createAsrRuntime({ modelPaths, senseITN: () => true, broadcast: () => undefined }, {
    loadVadModel: async () => ({
      createVadSession: () => session,
      dispose() {},
    }),
  })
  t.after(() => runtime.dispose())
  assert.deepEqual(await runtime.detect('meeting', new Float32Array(1600)), { isSpeech: true })
  assert.equal(runtime.modelStatus().vad.ready, true)
  runtime.reset('meeting')
  await tick()
  assert.equal(resets, 1)
  assert.equal(disposed, true)
})

test('replaced Local ASR model waits for active inference before reloading', async (t) => {
  const modelPaths = await modelFiles(t)
  let release
  let loads = 0
  const disposed = []
  const runtime = createAsrRuntime({ modelPaths, senseITN: () => true, broadcast: () => undefined }, {
    loadAsrModel: async () => {
      const id = ++loads
      const model = fakeAsrModel(() => id === 1
        ? new Promise((resolve) => { release = () => resolve({ text: '旧模型结果' }) })
        : Promise.resolve({ text: '新模型结果' }))
      return { ...model, dispose: () => disposed.push(id) }
    },
  })
  t.after(() => runtime.dispose())
  assert.equal(await runtime.retryModel('asr'), true)
  assert.equal(await runtime.retryModel('asr'), true)
  assert.equal(loads, 1)
  const pending = runtime.feed('meeting', new Float32Array(8000), true, 0, 0)
  await tick()
  const reloaded = runtime.retryModel('asr', true)
  await tick()
  assert.deepEqual(disposed, [])
  release()
  assert.equal((await pending).text, '旧模型结果')
  assert.equal(await reloaded, true)
  assert.equal(loads, 2)
  assert.deepEqual(disposed, [1])
  const fresh = await runtime.feed('fresh', new Float32Array(8000), true, 0, 0)
  assert.equal(fresh.text, '新模型结果')
})

test('replaced Local VAD model disposes old sessions and reloads', async (t) => {
  const modelPaths = await modelFiles(t)
  let loads = 0
  const disposedModels = []
  const disposedSessions = []
  const runtime = createAsrRuntime({ modelPaths, senseITN: () => true, broadcast: () => undefined }, {
    loadVadModel: async () => {
      const id = ++loads
      return {
        createVadSession: () => ({
          async streamFeed() { return { probs: [0.8], firstFrame: 0, segments: [] } },
          async streamReset() {},
          dispose() { disposedSessions.push(id) },
        }),
        dispose() { disposedModels.push(id) },
      }
    },
  })
  t.after(() => runtime.dispose())
  assert.deepEqual(await runtime.detect('meeting', new Float32Array(1600)), { isSpeech: true })
  assert.equal(await runtime.retryModel('vad'), true)
  assert.equal(loads, 1)
  assert.equal(await runtime.retryModel('vad', true), true)
  assert.equal(loads, 2)
  assert.deepEqual(disposedSessions, [1])
  assert.deepEqual(disposedModels, [1])
  assert.deepEqual(await runtime.detect('meeting', new Float32Array(1600)), { isSpeech: true })
})

test('missing Local model gives an actionable error without invoking the loader', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-local-missing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let loads = 0
  const runtime = createAsrRuntime({
    modelPaths: { asr: join(directory, 'missing.gguf'), vad: join(directory, 'missing-vad.gguf') },
    senseITN: () => true,
    broadcast: () => undefined,
  }, { loadAsrModel: async () => { loads++; return fakeAsrModel(async () => ({ text: '' })) } })
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.feed('meeting', new Float32Array(8000), false, 0, 0), /未找到本地识别模型/)
  assert.equal(loads, 0)
})

test('PCM conversion rejects unaligned float32 payloads', () => {
  assert.equal(pcmToSamples(Buffer.alloc(3)), null)
  const pcm = pcmToSamples(Buffer.alloc(8))
  assert.ok(pcm instanceof Float32Array)
  assert.equal(pcm.length, 2)
})

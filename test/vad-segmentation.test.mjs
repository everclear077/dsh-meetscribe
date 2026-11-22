import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/asr.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  define: { __AUDIO_WORKLET__: '""' },
  logLevel: 'silent',
})
const { createAsrEngine } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

const FRAME = 1600 // 100 ms at 16 kHz
const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

async function engineFixture(t, vad) {
  let now = 0
  let processor
  let detectCalls = 0
  const segments = []
  const finals = []
  const hostAudio = new Map()
  const track = { getSettings: () => ({ echoCancellation: true }), stop() {} }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }

  class FakeAudioContext {
    sampleRate = 16000
    destination = {}
    audioWorklet = undefined
    async resume() {}
    async close() {}
    createMediaStreamSource() { return { connect() {} } }
    createScriptProcessor() {
      processor = { onaudioprocess: null, connect() {}, disconnect() {} }
      return processor
    }
  }

  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.searchParams.get('reset') === '1') return Response.json({ ok: true })
    const samples = new Float32Array(init.body ?? new ArrayBuffer(0))
    if (url.searchParams.get('vadOnly') === '1') {
      detectCalls++
      const result = await vad(samples, detectCalls)
      return Response.json(typeof result === 'object'
        ? result
        : { isSpeech: result, available: true })
    }
    const epoch = Number(url.searchParams.get('epoch') || 0)
    const offset = Number(url.searchParams.get('offset') || 0)
    const audio = hostAudio.get(epoch) ?? []
    for (let i = 0; i < samples.length; i++) audio[offset + i] = samples[i]
    hostAudio.set(epoch, audio)
    if (url.searchParams.get('final') === '1') {
      finals.push({ epoch, offset, appended: samples.length, audio: Float32Array.from(audio) })
      return Response.json({ text: 'recognized' })
    }
    return Response.json({ text: '', isSpeech: false })
  })

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeAudioContext } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'http://meetscribe.test' } })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation)
    else delete globalThis.location
  })

  const engine = createAsrEngine({
    basePath: '/meetscribe',
    silenceMs: 800,
    segmentation: 'vad',
    mode: 'toggle',
    acquireAudio: async () => stream,
  }, 'synthetic-meeting')
  engine.onSegment((text) => segments.push(text))
  await engine.start()
  t.after(() => engine.stop())

  return {
    engine,
    segments,
    finals,
    get detectCalls() { return detectCalls },
    async frame(amplitude) {
      now += 100
      const pcm = new Float32Array(FRAME)
      pcm.fill(amplitude)
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => pcm } })
      await tick()
    },
  }
}

test('meeting VAD opens and finalizes a complete sentence below the RMS threshold', async (t) => {
  const fixture = await engineFixture(t, (_samples, call) => call <= 4)
  // 400 ms speech + 800 ms silence, all below SPEECH_RMS=0.015.
  for (let i = 0; i < 12; i++) await fixture.frame(0.001)
  assert.deepEqual(fixture.segments, ['recognized'])
  assert.equal(fixture.finals.length, 1)
  assert.equal(fixture.finals[0].audio.length, 12 * FRAME)
})

test('VAD finalization retains an in-flight tail for the next segment without overlap', async (t) => {
  let releaseTwelfth
  const twelfth = new Promise((resolve) => { releaseTwelfth = resolve })
  const fixture = await engineFixture(t, (_samples, call) => {
    if (call <= 4) return true
    if (call === 12) return twelfth
    return call === 13
  })
  for (let i = 0; i < 12; i++) await fixture.frame(0.001)
  // Two more frames arrive while the 800 ms silence response is in flight.
  await fixture.frame(0.001)
  await fixture.frame(0.001)
  assert.equal(fixture.detectCalls, 12)
  releaseTwelfth(false)
  await tick()
  await tick()
  await tick()
  assert.equal(fixture.finals.length, 1)
  assert.equal(fixture.finals[0].audio.length, 12 * FRAME)

  // Call 13 contains the two retained frames plus this one and opens the next segment.
  await fixture.frame(0.001)
  for (let i = 0; i < 8; i++) await fixture.frame(0.001)
  assert.equal(fixture.finals.length, 2)
  assert.equal(fixture.finals[1].audio.length, 11 * FRAME)
  assert.equal(fixture.finals[0].audio.length + fixture.finals[1].audio.length, 23 * FRAME)
  assert.deepEqual(fixture.segments, ['recognized', 'recognized'])
})

test('VAD-confirmed speech shorter than 250 ms is still sent to ASR', async (t) => {
  const fixture = await engineFixture(t, (_samples, call) => call <= 2)
  for (let i = 0; i < 10; i++) await fixture.frame(0.001)
  assert.deepEqual(fixture.segments, ['recognized'])
  assert.equal(fixture.finals.length, 1)
  assert.equal(fixture.finals[0].audio.length, 10 * FRAME)
})

test('VAD model-unavailable responses also fall back to RMS', async (t) => {
  const fixture = await engineFixture(t, () => ({ isSpeech: false, available: false }))
  for (let i = 0; i < 4; i++) await fixture.frame(0.02)
  for (let i = 0; i < 9; i++) await fixture.frame(0)
  assert.deepEqual(fixture.segments, ['recognized'])
  assert.equal(fixture.finals.length, 1)
})

test('VAD request failures fall back to RMS instead of muting the meeting', async (t) => {
  const fixture = await engineFixture(t, () => { throw new Error('synthetic VAD outage') })
  for (let i = 0; i < 4; i++) await fixture.frame(0.02)
  for (let i = 0; i < 9; i++) await fixture.frame(0)
  assert.deepEqual(fixture.segments, ['recognized'])
  assert.equal(fixture.finals.length, 1)
  assert.ok(fixture.finals[0].audio.length >= 12 * FRAME)
})

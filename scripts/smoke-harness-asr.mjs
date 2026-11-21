import { readFile } from 'node:fs/promises'
import { decodePcm16Wav } from './smoke-local-asr.mjs'

const baseUrl = (process.argv[2] || process.env.MEETSCRIBE_URL || '').replace(/\/+$/, '')
const wavPath = process.argv[3]
if (!baseUrl || !wavPath) throw new Error('Usage: node scripts/smoke-harness-asr.mjs <http://127.0.0.1:port> <16k-mono-pcm16.wav>')
const endpoint = `${baseUrl}/meetscribe`
let meetingId = ''

async function request(path, options = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: { origin: baseUrl, ...options.headers },
    signal: AbortSignal.timeout(120000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${text}`)
  return body
}

try {
  const created = await request('/meetings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '本地 合成音频验证（自动清理）' }),
  })
  meetingId = created.id
  await request(`/meetings/${encodeURIComponent(meetingId)}/start`, { method: 'POST' })
  const pcm = decodePcm16Wav(await readFile(wavPath))
  const startedAt = performance.now()
  const asrPath = (final, offset) => `/asr?sessionId=${encodeURIComponent(meetingId)}&epoch=0&offset=${offset}&final=${final ? 1 : 0}&source=microphone`
  const postPcm = (final, offset, samples) => request(asrPath(final, offset), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
  })
  const cut = Math.min(16000, Math.floor(pcm.length / 2))
  const vad = await request(`${asrPath(false, 0)}&vadOnly=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from(pcm.buffer, pcm.byteOffset, Math.min(pcm.byteLength, 6400)),
  })
  if (typeof vad.isSpeech !== 'boolean') throw new Error(`Invalid 本地 VAD response: ${JSON.stringify(vad)}`)
  let partialText = ''
  if (cut > 0 && cut < pcm.length) {
    await postPcm(false, 0, pcm.subarray(0, cut))
    for (let attempt = 0; attempt < 50 && !partialText; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const partial = await postPcm(false, cut, pcm.subarray(0, 0))
      partialText = partial.text || ''
    }
    if (!partialText) throw new Error('Host did not produce a temporary 本地 snapshot within 5 seconds')
  }
  const result = await postPcm(true, cut, pcm.subarray(cut))
  if (!result.text || !result.segmentId) throw new Error(`Host returned no finalized transcript segment: ${JSON.stringify(result)}`)
  const meeting = await request(`/meetings/${encodeURIComponent(meetingId)}`)
  const segment = meeting.segments.find((item) => item.id === result.segmentId)
  if (!segment) throw new Error('Finalized segment was not persisted')
  if (Object.hasOwn(segment, 'embedding')) throw new Error('Public meeting response leaked a speaker embedding')
  console.log(JSON.stringify({
    ok: true,
    elapsedMs: Math.round(performance.now() - startedAt),
    partialText,
    vadResponded: true,
    text: result.text,
    rawText: segment.rawText,
    displayText: segment.displayText,
    speakerId: result.speakerId,
    segmentPersisted: true,
  }, null, 2))
} finally {
  if (meetingId) {
    await request(`/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' })
    console.log('Test meeting deleted: true')
  }
}

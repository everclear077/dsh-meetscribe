import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { TranscribeModel } from 'transcribe-cpp'

export function decodePcm16Wav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected a RIFF/WAVE file')
  }
  let format
  let data
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > bytes.length) throw new Error(`Truncated WAV chunk: ${id}`)
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk')
      format = {
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      data = bytes.subarray(start, end)
    }
    offset = end + (size % 2)
  }
  if (!format || !data) throw new Error('WAV format or audio data is missing')
  if (format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bitsPerSample !== 16) {
    throw new Error(`Expected 16 kHz mono PCM16 WAV, received ${JSON.stringify(format)}`)
  }
  if (data.length % 2 !== 0) throw new Error('PCM16 data has odd byte length')
  const pcm = new Float32Array(data.length / 2)
  for (let index = 0; index < pcm.length; index++) pcm[index] = data.readInt16LE(index * 2) / 32768
  return pcm
}

async function main() {
  const modelPath = process.env.ORCA_ASR_MODEL || join(
    process.env.APPDATA || '',
    'orca',
    'speech-models',
    'sense-voice-zh-en-ja-ko-yue',
    'SenseVoiceSmall-Q8_0.gguf',
  )
  const files = process.argv.slice(2)
  if (files.length === 0) throw new Error('Usage: node scripts/smoke-orca-asr.mjs <16k-mono-pcm16.wav> [...more.wav]')
  const startedAt = performance.now()
  const model = await TranscribeModel.load(modelPath, { backend: 'cpu' })
  const loadMs = Math.round(performance.now() - startedAt)
  try {
    if (!model.roles.includes('asr')) throw new Error(`Model has no ASR role: ${modelPath}`)
    const session = model.createSession({ nThreads: 4 })
    try {
      const results = []
      for (const file of files) {
        const pcm = decodePcm16Wav(await readFile(file))
        const started = performance.now()
        const result = await session.run(pcm, { itn: 'on' })
        results.push({
          file,
          audioMs: Math.round(pcm.length / 16),
          elapsedMs: Math.round(performance.now() - started),
          text: result.text,
          language: result.language,
          truncated: result.truncated,
        })
      }
      console.log(JSON.stringify({ modelPath, loadMs, arch: model.arch, variant: model.variant, results }, null, 2))
    } finally {
      session.dispose()
    }
  } finally {
    model.dispose()
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

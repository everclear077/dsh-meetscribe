import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { SpeakerEmbeddingExtractor } = require('sherpa-onnx-node')

function cosine(a, b) {
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return dot / Math.sqrt(aa * bb)
}

function normalize(values) {
  const result = Float32Array.from(values)
  let norm = 0
  for (const value of result) norm += value * value
  for (let i = 0; i < result.length; i++) result[i] /= Math.sqrt(norm)
  return result
}

function average(vectors) {
  const result = new Float32Array(vectors[0].length)
  for (const vector of vectors) for (let i = 0; i < result.length; i++) result[i] += vector[i] / vectors.length
  return normalize(result)
}

function decodeWave(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a RIFF WAVE file')
  let format
  let data
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const kind = buffer.toString('ascii', offset, offset + 4)
    if (kind === 'fmt ') format = { encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), bits: buffer.readUInt16LE(start + 14) }
    if (kind === 'data') data = buffer.subarray(start, start + size)
    offset = start + size + (size % 2)
  }
  if (!format || !data || format.sampleRate !== 16000) throw new Error('Expected 16 kHz PCM WAVE with fmt and data chunks')
  if (![1, 3].includes(format.encoding) || ![16, 32].includes(format.bits)) throw new Error(`Unsupported WAVE encoding ${format.encoding}/${format.bits}`)
  const bytes = format.bits / 8
  const frames = Math.floor(data.length / bytes / format.channels)
  const samples = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let value = 0
    for (let channel = 0; channel < format.channels; channel++) {
      const offset = (frame * format.channels + channel) * bytes
      value += format.encoding === 3 ? data.readFloatLE(offset) : data.readInt16LE(offset) / 32768
    }
    samples[frame] = value / format.channels
  }
  return samples
}

const [fixtures, ...modelPaths] = process.argv.slice(2)
if (!fixtures || modelPaths.length === 0) throw new Error('Usage: node scripts/evaluate-speaker-models.mjs FIXTURE_DIR MODEL.onnx [...MODEL.onnx]')
const speakers = ['fangjun', 'leijun', 'liudehua']
const files = new Map()
for (const speaker of speakers) {
  for (const kind of ['sr', 'test']) {
    for (let sequence = 1; sequence <= 3; sequence++) {
      const name = kind === 'sr' ? `${speaker}-sr-${sequence}.wav` : `${speaker}-test-sr-${sequence}.wav`
      const path = resolve(fixtures, name)
      const samples = await readFile(path).then(decodeWave).catch(() => null)
      if (samples) files.set(name, samples)
    }
  }
}

for (const modelPath of modelPaths) {
  const started = performance.now()
  const extractor = new SpeakerEmbeddingExtractor({ model: resolve(modelPath), numThreads: 2, provider: 'cpu', debug: 0 })
  const embed = (samples) => {
    const stream = extractor.createStream()
    stream.acceptWaveform({ sampleRate: 16000, samples })
    return extractor.compute(stream, false)
  }
  const enrollments = new Map()
  const tests = []
  for (const speaker of speakers) {
    const enrollment = [...files.entries()].filter(([name]) => name.startsWith(`${speaker}-sr-`)).map(([, samples]) => embed(samples))
    enrollments.set(speaker, average(enrollment))
    for (const [name, samples] of files) if (name.startsWith(`${speaker}-test-`)) tests.push({ speaker, name, samples, embedding: embed(samples) })
  }
  const same = []
  const different = []
  const rows = []
  for (const test of tests) {
    const scores = Object.fromEntries(speakers.map((speaker) => [speaker, cosine(test.embedding, enrollments.get(speaker))]))
    same.push(scores[test.speaker])
    const other = Math.max(...speakers.filter((speaker) => speaker !== test.speaker).map((speaker) => scores[speaker]))
    different.push(other)
    rows.push({ file: test.name, seconds: Number((test.samples.length / 16000).toFixed(2)), own: Number(scores[test.speaker].toFixed(4)), bestOther: Number(other.toFixed(4)) })
  }
  const padding = []
  for (const test of tests) {
    const values = { file: test.name }
    for (const milliseconds of [300, 700]) {
      const padded = new Float32Array(test.samples.length + 16000 * milliseconds / 1000)
      padded.set(test.samples)
      values[`pad${milliseconds}`] = Number(cosine(test.embedding, embed(padded)).toFixed(4))
    }
    padding.push(values)
  }
  const shortSegments = []
  for (const seconds of [0.6, 0.8, 1, 1.5, 2]) {
    const ownScores = []
    const otherScores = []
    for (const test of tests) {
      if (test.samples.length < seconds * 16000) continue
      const embedding = embed(test.samples.slice(0, Math.round(seconds * 16000)))
      ownScores.push(cosine(embedding, enrollments.get(test.speaker)))
      otherScores.push(Math.max(...speakers.filter((speaker) => speaker !== test.speaker).map((speaker) => cosine(embedding, enrollments.get(speaker)))))
    }
    shortSegments.push({ seconds, clips: ownScores.length, ownMin: Math.min(...ownScores), ownMean: ownScores.reduce((a, b) => a + b, 0) / ownScores.length, bestOtherMax: Math.max(...otherScores), margin: Math.min(...ownScores) - Math.max(...otherScores) })
  }
  const summary = {
    model: basename(modelPath),
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    enrollmentSpeakers: [...enrollments.keys()].length,
    testClips: tests.length,
    sameSpeaker: { min: Math.min(...same), mean: same.reduce((a, b) => a + b, 0) / same.length },
    bestDifferentSpeakerPerClip: { max: Math.max(...different), mean: different.reduce((a, b) => a + b, 0) / different.length },
    margin: Math.min(...same) - Math.max(...different),
    shortSegments,
    rows,
    paddingStability: padding,
  }
  if (process.env.SPEAKER_EVAL_SUMMARY === '1') {
    delete summary.rows
    delete summary.paddingStability
  }
  console.log(JSON.stringify(summary, null, 2))
}

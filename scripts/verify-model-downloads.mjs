import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createAsrRuntime, LocalModelManager, SpeakerIdentifier } from '../lib/index.js'

const root = process.argv[2]
if (!root) throw new Error('Usage: node scripts/verify-model-downloads.mjs <model-directory>')
const manager = new LocalModelManager(resolve(root))
const progress = new Map()

for (const kind of ['asr', 'vad', 'speaker']) {
  const prepared = await manager.ensure(kind, (percent) => {
    const bucket = Math.floor(percent / 25) * 25
    if (progress.get(kind) !== bucket) {
      progress.set(kind, bucket)
      console.log(`${kind}: ${bucket}%`)
    }
  })
  const info = await stat(prepared.path)
  console.log(JSON.stringify({ kind, downloaded: prepared.downloaded, bytes: info.size }))
}

const runtime = createAsrRuntime({
  modelPaths: manager.speechPaths,
  senseITN: () => true,
  broadcast: () => undefined,
})
try {
  if (!await runtime.retryModel('asr')) throw new Error(runtime.modelStatus().error || 'ASR runtime did not load')
  const asrResult = await runtime.feed('model-download-smoke', new Float32Array(8000), true, 0, 0)
  if (typeof asrResult.text !== 'string') throw new Error('ASR returned no text field')
  if (!await runtime.retryModel('vad')) throw new Error(runtime.modelStatus().error || 'VAD runtime did not load')
  const vadResult = await runtime.detect('model-download-smoke', new Float32Array(512))
  if (typeof vadResult.isSpeech !== 'boolean') throw new Error('VAD returned no speech decision')
  const speaker = new SpeakerIdentifier(manager, () => undefined)
  if (!await speaker.prepare()) throw new Error(speaker.status().error || 'Speaker model did not load')
  const speakerSamples = new Float32Array(16000)
  for (let i = 0; i < speakerSamples.length; i++) speakerSamples[i] = Math.sin(i / 20) * 0.1
  const speakerResult = await speaker.identify('model-download-smoke', speakerSamples, 0.56, 8)
  if (!speakerResult?.speakerId || speakerResult.embedding.length === 0) throw new Error('Speaker model returned no embedding')
  const status = runtime.modelStatus()
  console.log(JSON.stringify({
    ok: true,
    asr: {
      ready: status.asr.ready,
      loaded: status.asr.loaded,
      arch: status.asr.arch,
      variant: status.asr.variant,
      inferenceCompleted: true,
    },
    vad: { ready: status.vad.ready, loaded: status.vad.loaded, decision: vadResult.isSpeech },
    speaker: { ...speaker.status(), inferenceCompleted: true, embeddingSize: speakerResult.embedding.length },
  }, null, 2))
} finally {
  runtime.dispose()
}

import { join } from 'node:path'
import { ensureUrlFile } from './download.ts'
import { SpeakerClusterer } from '../shared/speaker.ts'

const SPEAKER_MODEL_FILE = '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx'
const SPEAKER_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${SPEAKER_MODEL_FILE}`
const SPEAKER_MODEL_SHA256 = 'eda0bf86422a9725a3523d5a1d3d75dedf340664e0ba65cfc1c7b2a78b6cf0b5'

interface SpeakerExtractor {
  createStream(): {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
  }
  compute(stream: unknown, enableExternalBuffer?: boolean): Float32Array
}

export interface SpeakerResult {
  speakerId: string
  confidence: number
  isNew: boolean
  embedding: number[]
}

export class SpeakerIdentifier {
  private extractor: SpeakerExtractor | null = null
  private loading: Promise<boolean> | null = null
  private readonly clusters = new Map<string, SpeakerClusterer>()
  lastError = ''

  constructor(
    private readonly modelDirectory: string,
    private readonly onProgress: (percent: number) => void,
  ) {}

  get modelPath(): string {
    return join(this.modelDirectory, SPEAKER_MODEL_FILE)
  }

  async ready(): Promise<boolean> {
    if (this.extractor) return true
    if (!this.loading) this.loading = this.initialize().finally(() => { this.loading = null })
    return this.loading
  }

  private async initialize(): Promise<boolean> {
    const downloaded = await ensureUrlFile({
      url: SPEAKER_MODEL_URL,
      path: this.modelPath,
      sha256: SPEAKER_MODEL_SHA256,
      onProgress: this.onProgress,
    })
    if (!downloaded) return false
    const module = await import('sherpa-onnx-node') as unknown as {
      SpeakerEmbeddingExtractor?: new (config: { model: string; numThreads: number; provider: string; debug: number }) => SpeakerExtractor
      default?: { SpeakerEmbeddingExtractor?: new (config: { model: string; numThreads: number; provider: string; debug: number }) => SpeakerExtractor }
    }
    const Extractor = module.SpeakerEmbeddingExtractor ?? module.default?.SpeakerEmbeddingExtractor
    if (!Extractor) throw new Error('sherpa-onnx-node 未提供 SpeakerEmbeddingExtractor')
    this.extractor = new Extractor({
      model: this.modelPath,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    })
    return true
  }

  async identify(meetingId: string, samples: Float32Array, threshold: number, maxSpeakers: number): Promise<SpeakerResult | null> {
    if (samples.length < 16000 * 0.8 || !(await this.ready()) || !this.extractor) return null
    const stream = this.extractor.createStream()
    stream.acceptWaveform({ sampleRate: 16000, samples })
    // Electron's Node integration can reject native external ArrayBuffers.
    // Let N-API copy the embedding into a regular JavaScript-owned buffer.
    const embedding = this.extractor.compute(stream, false)
    this.lastError = ''
    let cluster = this.clusters.get(meetingId)
    if (!cluster) {
      cluster = new SpeakerClusterer(threshold, maxSpeakers)
      this.clusters.set(meetingId, cluster)
    }
    let sequence = cluster.size + 1
    const result = cluster.add(embedding, () => `speaker-${sequence++}`)
    return { ...result, embedding: Array.from(embedding) }
  }

  reset(meetingId: string): void {
    this.clusters.delete(meetingId)
  }

  status(): { ready: boolean; loading: boolean; error?: string } {
    return { ready: this.extractor !== null, loading: this.loading !== null, error: this.lastError || undefined }
  }
}

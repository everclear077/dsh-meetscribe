import { LocalModelManager } from './model-manager.ts'
import { SpeakerClusterer } from '../shared/speaker.ts'

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
  private initializationAttempted = false
  private readonly clusters = new Map<string, SpeakerClusterer>()
  lastError = ''

  constructor(
    private readonly models: LocalModelManager,
    private readonly onProgress: (percent: number) => void,
  ) {}

  get modelPath(): string {
    return this.models.path('speaker')
  }

  async ready(): Promise<boolean> {
    if (this.extractor) return true
    if (this.initializationAttempted) return false
    return this.initializeOnce(false)
  }

  async prepare(): Promise<boolean> {
    return this.initializeOnce(true)
  }

  private initializeOnce(allowDownload: boolean): Promise<boolean> {
    this.initializationAttempted = true
    if (!this.loading) {
      this.loading = this.initialize(allowDownload)
        .then(() => { this.lastError = ''; return true })
        .catch((error: unknown) => {
          this.lastError = error instanceof Error ? error.message : String(error)
          return false
        })
        .finally(() => { this.loading = null })
    }
    return this.loading
  }

  private async initialize(allowDownload: boolean): Promise<void> {
    const prepared = allowDownload
      ? await this.models.ensure('speaker', this.onProgress)
      : await this.models.installed('speaker')
    if (!prepared) throw new Error('声纹模型未安装或校验未通过，请在“识别设置”中点击“检查并准备模型”')
    if (this.extractor && !prepared.downloaded) return
    this.extractor = null
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

/**
 * Local transcribe.cpp ASR runtime with plugin-managed model files.
 *
 * SenseVoiceSmall-Q8_0.gguf is non-streaming. During a browser-delimited segment
 * we refresh a cached temporary result from immutable PCM snapshots; final=1
 * transcribes the complete segment. Meetings use Silero VAD segmentation through
 * detect(); RMS remains a compatibility fallback for other voice interactions.
 */
import { statSync } from 'node:fs'
import {
  TranscribeModel,
  type TranscriptionResult,
  type VadResult,
} from 'transcribe-cpp'
import { LOCAL_MODEL_CATALOG, type LocalModelPaths } from './model-manager.ts'

export const LOCAL_ASR_MODEL = LOCAL_MODEL_CATALOG.asr.fileName
export const LOCAL_VAD_MODEL = LOCAL_MODEL_CATALOG.vad.fileName
export const LOCAL_ENGINE = 'transcribe.cpp-0.4.1'

const SAMPLE_RATE = 16000
const MAX_MODEL_SAMPLES = SAMPLE_RATE * 30
const PARTIAL_MIN_SAMPLES = SAMPLE_RATE * 0.4
const PARTIAL_INTERVAL_MS = 900
const PARTIAL_MIN_NEW_SAMPLES = SAMPLE_RATE * 0.3
const SEGMENT_IDLE_MS = 90000

function fileSize(path: string): number {
  if (!path) return 0
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

export interface AsrRuntimeOptions {
  senseITN: () => boolean
  broadcast: (event: string, payload: unknown) => void
  replaceText?: (text: string) => string
  /** Plugin-managed paths; explicit values also keep integration tests isolated. */
  modelPaths: LocalModelPaths
}

export interface LocalAsrModel {
  readonly roles: readonly string[]
  readonly capabilities: { nativeSampleRate: number; maxAudioMs: number; supportsStreaming: boolean }
  readonly arch: string
  readonly variant: string
  transcribe(pcm: Float32Array, options: { timestamps: 'none'; itn: 'on' | 'off' }): Promise<TranscriptionResult>
  dispose(): void
}

export interface LocalVadSession {
  streamFeed(pcm: Float32Array): Promise<VadResult>
  streamReset(): Promise<void>
  dispose(): void
}

export interface LocalVadModel {
  createVadSession(): LocalVadSession
  dispose(): void
}

export interface LocalRuntimeDependencies {
  loadAsrModel?: (path: string) => Promise<LocalAsrModel>
  loadVadModel?: (path: string) => Promise<LocalVadModel>
  now?: () => number
}

export interface AsrRuntime {
  feed(
    sessionId: string,
    samples: Float32Array,
    final: boolean,
    offset?: number,
    epoch?: number,
    manualPressed?: boolean,
  ): Promise<{ text: string; rawText?: string; loading?: boolean; endpoint?: boolean; isSpeech?: boolean }>
  detect(sessionId: string, samples: Float32Array): Promise<{ isSpeech: boolean; available: boolean }>
  reset(sessionId: string): void
  dispose(): void
  modelStatus(): ModelsStatus
  retryModel(kind: 'asr' | 'vad', reload?: boolean): Promise<boolean>
  warmup(): void
  markStale(): void
}

export interface ModelFileStatus {
  name: string
  exists: boolean
  size: number
}

export interface ModelsStatus {
  asr: {
    repo: string
    ready: boolean
    loaded: boolean
    files: ModelFileStatus[]
    arch?: string
    variant?: string
    streaming: false
    error?: string
  }
  vad: { repo: string; ready: boolean; loaded: boolean; size: number; error?: string }
  loading: boolean
  error?: string
  progress: null
}

/** PCM f32 LE payload -> Float32Array (length alignment checked). */
export function pcmToSamples(buf: Buffer): Float32Array | null {
  if (buf.length % 4 !== 0) return null
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
}

interface SegmentState {
  chunks: Float32Array[]
  fed: number
  text: string
  lastAttemptAt: number
  lastAttemptSamples: number
  lastActivity: number
  generation: number
  pending?: { samples: number; promise: Promise<string> }
}

function missingModelMessage(path: string): string {
  return `未找到本地识别模型：${path}。请打开左侧 MeetScribe 的“识别设置”，点击“检查并准备模型”。`
}

export function createAsrRuntime(
  options: AsrRuntimeOptions,
  dependencies: LocalRuntimeDependencies = {},
): AsrRuntime {
  const paths = options.modelPaths
  const now = dependencies.now ?? Date.now
  const loadAsr = dependencies.loadAsrModel ?? ((path: string) => TranscribeModel.load(path, { backend: 'cpu' }))
  const loadVad = dependencies.loadVadModel ?? ((path: string) => TranscribeModel.load(path, { backend: 'cpu' }))
  const segments = new Map<string, Map<number, SegmentState>>()
  const finalized = new Map<string, Map<number, string>>()
  const finalizing = new Map<string, Map<number, Promise<string>>>()
  const resetGenerations = new Map<string, number>()
  const detectSessions = new Map<string, { session: LocalVadSession; lastUse: number }>()
  let asrModel: LocalAsrModel | null = null
  let vadModel: LocalVadModel | null = null
  let asrLoading: Promise<LocalAsrModel | null> | null = null
  let vadLoading: Promise<LocalVadModel | null> | null = null
  let asrError = fileSize(paths.asr) > 0 ? '' : missingModelMessage(paths.asr)
  let vadError = ''
  let disposed = false
  let asrQueue: Promise<unknown> = Promise.resolve()
  let vadQueue: Promise<unknown> = Promise.resolve()

  const reportError = (kind: 'asr' | 'vad', error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    if (kind === 'asr') asrError = message
    else vadError = message
    options.broadcast('asr-error', { kind, message })
  }

  const ensureAsrModel = async (): Promise<LocalAsrModel | null> => {
    if (asrModel) return asrModel
    if (disposed) return null
    if (!paths.asr || fileSize(paths.asr) === 0) {
      asrError = missingModelMessage(paths.asr)
      return null
    }
    if (!asrLoading) {
      asrLoading = loadAsr(paths.asr)
        .then((loaded) => {
          if (!loaded.roles.includes('asr')) throw new Error('本地模型不包含 ASR 能力')
          if (loaded.capabilities.nativeSampleRate !== SAMPLE_RATE) throw new Error('本地模型采样率不是 16 kHz')
          if (loaded.capabilities.maxAudioMs < 12000) throw new Error('本地模型不支持当前 12 秒会议分段')
          if (disposed) {
            loaded.dispose()
            return null
          }
          asrModel = loaded
          asrError = ''
          options.broadcast('asr-ready', { kind: 'asr', engine: LOCAL_ENGINE, model: LOCAL_ASR_MODEL })
          return loaded
        })
        .catch((error: unknown) => {
          reportError('asr', error)
          return null
        })
        .finally(() => {
          asrLoading = null
        })
    }
    return asrLoading
  }

  const ensureVadModel = async (): Promise<LocalVadModel | null> => {
    if (vadModel) return vadModel
    if (disposed || !paths.vad || fileSize(paths.vad) === 0) return null
    if (!vadLoading) {
      vadLoading = loadVad(paths.vad)
        .then((loaded) => {
          if (disposed) {
            loaded.dispose()
            return null
          }
          vadModel = loaded
          vadError = ''
          options.broadcast('asr-ready', { kind: 'vad', engine: LOCAL_ENGINE, model: LOCAL_VAD_MODEL })
          return loaded
        })
        .catch((error: unknown) => {
          reportError('vad', error)
          return null
        })
        .finally(() => {
          vadLoading = null
        })
    }
    return vadLoading
  }

  const enqueueAsr = <T>(work: () => Promise<T>): Promise<T> => {
    const result = asrQueue.then(work, work)
    asrQueue = result.then(() => undefined, () => undefined)
    return result
  }
  const enqueueVad = <T>(work: () => Promise<T>): Promise<T> => {
    const result = vadQueue.then(work, work)
    vadQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const snapshot = (segment: SegmentState): Float32Array => {
    const pcm = new Float32Array(segment.fed)
    let offset = 0
    for (const chunk of segment.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    return pcm
  }

  const transcribe = async (model: LocalAsrModel, pcm: Float32Array): Promise<string> => {
    if (pcm.length === 0) return ''
    const result = await enqueueAsr(() => model.transcribe(pcm, {
      timestamps: 'none',
      itn: options.senseITN() ? 'on' : 'off',
    }))
    if (asrError) {
      asrError = ''
      options.broadcast('asr-ready', { kind: 'asr', engine: LOCAL_ENGINE, model: LOCAL_ASR_MODEL, recovered: true })
    }
    return result.text.trim()
  }

  const removeSegment = (sessionId: string, epoch: number): void => {
    const session = segments.get(sessionId)
    session?.delete(epoch)
    if (session?.size === 0) segments.delete(sessionId)
  }

  const maybeStartPartial = (sessionId: string, epoch: number, segment: SegmentState): void => {
    const time = now()
    if (
      segment.pending ||
      segment.fed < PARTIAL_MIN_SAMPLES ||
      segment.fed - segment.lastAttemptSamples < PARTIAL_MIN_NEW_SAMPLES ||
      time - segment.lastAttemptAt < PARTIAL_INTERVAL_MS
    ) return
    const model = asrModel
    if (!model) return
    const pcm = snapshot(segment)
    segment.lastAttemptAt = time
    segment.lastAttemptSamples = segment.fed
    const promise = transcribe(model, pcm)
      .then((text) => {
        const current = segments.get(sessionId)?.get(epoch)
        if (current === segment && current.generation === (resetGenerations.get(sessionId) ?? 0)) {
          current.text = text
        }
        return text
      })
      .catch((error: unknown) => {
        reportError('asr', error)
        throw error
      })
    segment.pending = { samples: pcm.length, promise }
    void promise.catch(() => undefined).finally(() => {
      if (segment.pending?.promise === promise) segment.pending = undefined
    })
  }

  const appendAudio = (segment: SegmentState, samples: Float32Array, offset: number): void => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > segment.fed) throw new Error('AUDIO_OFFSET_GAP')
    const end = offset + samples.length
    if (end <= segment.fed) return
    const increment = samples.subarray(Math.max(0, segment.fed - offset))
    if (segment.fed + increment.length > MAX_MODEL_SAMPLES) throw new Error('SenseVoice 单段音频不能超过 30 秒')
    segment.chunks.push(increment.slice())
    segment.fed += increment.length
    segment.lastActivity = now()
  }

  const cachedFinal = (sessionId: string, epoch: number): string | undefined =>
    finalized.get(sessionId)?.get(epoch)

  const feedRaw: AsrRuntime['feed'] = async (
    sessionId,
    samples,
    final,
    offset = 0,
    epoch = 0,
  ) => {
    if (disposed) return { text: '' }
    const cached = cachedFinal(sessionId, epoch)
    if (cached !== undefined) return { text: cached }
    const pendingFinal = finalizing.get(sessionId)?.get(epoch)
    if (pendingFinal) return { text: final ? await pendingFinal : '' }

    let session = segments.get(sessionId)
    if (!session) {
      session = new Map()
      segments.set(sessionId, session)
    }
    let segment = session.get(epoch)
    if (!segment) {
      if (samples.length === 0 && final) return { text: '' }
      segment = {
        chunks: [],
        fed: 0,
        text: '',
        lastAttemptAt: -Infinity,
        lastAttemptSamples: 0,
        lastActivity: now(),
        generation: resetGenerations.get(sessionId) ?? 0,
      }
      session.set(epoch, segment)
    }
    appendAudio(segment, samples, offset)

    if (!final) {
      if (!asrModel) {
        if (asrError && !asrLoading) throw new Error(asrError)
        void ensureAsrModel()
        return { text: '', loading: true }
      }
      const model = await ensureAsrModel()
      if (!model) throw new Error(asrError || '本地识别模型加载失败，请检查模型文件后重试')
      if (segments.get(sessionId)?.get(epoch) !== segment) return { text: '' }
      maybeStartPartial(sessionId, epoch, segment)
      return { text: segment.text }
    }

    // Register final work before the first await so a concurrent retry shares it.
    removeSegment(sessionId, epoch)
    const generation = segment.generation
    const promise = (async (): Promise<string> => {
      const model = await ensureAsrModel()
      if (!model) throw new Error(asrError || '本地识别模型加载失败，请检查模型文件后重试')
      if ((resetGenerations.get(sessionId) ?? 0) !== generation) return ''
      if (segment.pending?.samples === segment.fed) return segment.pending.promise
      return transcribe(model, snapshot(segment))
    })()
    let sessionFinalizing = finalizing.get(sessionId)
    if (!sessionFinalizing) {
      sessionFinalizing = new Map()
      finalizing.set(sessionId, sessionFinalizing)
    }
    sessionFinalizing.set(epoch, promise)
    try {
      const text = await promise
      if (!disposed && (resetGenerations.get(sessionId) ?? 0) === generation) {
        let sessionFinalized = finalized.get(sessionId)
        if (!sessionFinalized) {
          sessionFinalized = new Map()
          finalized.set(sessionId, sessionFinalized)
        }
        sessionFinalized.set(epoch, text)
        if (sessionFinalized.size > 32) {
          const first = sessionFinalized.keys().next().value
          if (first !== undefined) sessionFinalized.delete(first)
        }
      }
      return { text }
    } catch (error) {
      reportError('asr', error)
      throw error
    } finally {
      const current = finalizing.get(sessionId)
      if (current?.get(epoch) === promise) {
        current.delete(epoch)
        if (current.size === 0) finalizing.delete(sessionId)
      }
    }
  }

  const feed: AsrRuntime['feed'] = async (...args) => {
    const out = await feedRaw(...args)
    if (!out.text) return out
    return { ...out, rawText: out.text, text: options.replaceText?.(out.text) ?? out.text }
  }

  const resetDetect = (sessionId: string): void => {
    const current = detectSessions.get(sessionId)
    detectSessions.delete(sessionId)
    if (!current) return
    void enqueueVad(async () => {
      try { await current.session.streamReset() } catch { /* best effort */ }
      current.session.dispose()
    })
  }

  const sweep = (): void => {
    const time = now()
    for (const [sessionId, session] of segments) {
      for (const [epoch, segment] of session) {
        if (time - segment.lastActivity > SEGMENT_IDLE_MS) session.delete(epoch)
      }
      if (session.size === 0) segments.delete(sessionId)
    }
    for (const sessionId of finalized.keys()) {
      if (!segments.has(sessionId) && !finalizing.has(sessionId)) finalized.delete(sessionId)
    }
    for (const [sessionId, current] of detectSessions) {
      if (time - current.lastUse > SEGMENT_IDLE_MS) resetDetect(sessionId)
    }
  }
  const sweepTimer = setInterval(sweep, 30000)
  sweepTimer.unref?.()

  return {
    feed,
    detect: async (sessionId, samples) => {
      const model = await ensureVadModel()
      if (!model || disposed) return { isSpeech: false, available: false }
      let current = detectSessions.get(sessionId)
      if (!current) {
        current = { session: model.createVadSession(), lastUse: now() }
        detectSessions.set(sessionId, current)
      }
      current.lastUse = now()
      const result = await enqueueVad(() => current!.session.streamFeed(samples))
      const probability = result.probs.at(-1) ?? 0
      return { isSpeech: probability >= 0.35, available: true }
    },
    reset: (sessionId) => {
      segments.delete(sessionId)
      finalized.delete(sessionId)
      finalizing.delete(sessionId)
      resetGenerations.set(sessionId, (resetGenerations.get(sessionId) ?? 0) + 1)
      resetDetect(sessionId)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      clearInterval(sweepTimer)
      segments.clear()
      finalized.clear()
      finalizing.clear()
      resetGenerations.clear()
      for (const sessionId of [...detectSessions.keys()]) resetDetect(sessionId)
      const model = asrModel
      const vad = vadModel
      asrModel = null
      vadModel = null
      void asrQueue.finally(() => model?.dispose())
      void vadQueue.finally(() => vad?.dispose())
    },
    warmup: () => {
      void ensureAsrModel()
      void ensureVadModel()
    },
    markStale: () => {
      // ITN is read for each inference, so no loaded model needs rebuilding.
    },
    modelStatus: () => {
      const asrSize = fileSize(paths.asr)
      const vadSize = fileSize(paths.vad)
      return {
        asr: {
          repo: LOCAL_ENGINE,
          ready: asrModel !== null,
          loaded: asrModel !== null,
          files: [{ name: LOCAL_ASR_MODEL, exists: asrSize > 0, size: asrSize }],
          arch: asrModel?.arch,
          variant: asrModel?.variant,
          streaming: false,
          error: asrError || undefined,
        },
        vad: {
          repo: LOCAL_ENGINE,
          ready: vadModel !== null,
          loaded: vadModel !== null,
          size: vadSize,
          error: vadError || undefined,
        },
        loading: asrLoading !== null || vadLoading !== null,
        error: asrError || vadError || undefined,
        progress: null,
      }
    },
    retryModel: async (kind, reload = false) => {
      if (kind === 'asr') {
        if (reload) {
          if (asrLoading) await asrLoading
          const previous = asrModel
          asrModel = null
          await asrQueue
          previous?.dispose()
        }
        asrError = ''
        const loaded = await ensureAsrModel()
        if (!loaded && asrError) options.broadcast('asr-error', { kind, message: asrError })
        return loaded !== null
      }
      if (reload) {
        if (vadLoading) await vadLoading
        for (const sessionId of [...detectSessions.keys()]) resetDetect(sessionId)
        const previous = vadModel
        vadModel = null
        await vadQueue
        previous?.dispose()
      }
      vadError = ''
      const loaded = await ensureVadModel()
      if (!loaded) {
        vadError = `未找到或无法加载本地 VAD 模型：${paths.vad || LOCAL_VAD_MODEL}`
        options.broadcast('asr-error', { kind, message: vadError })
      }
      return loaded !== null
    },
  }
}

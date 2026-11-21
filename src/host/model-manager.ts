import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureUrlFile, fileSha256 } from './download.ts'

export type LocalModelKind = 'asr' | 'vad' | 'speaker'

export interface LocalModelDefinition {
  fileName: string
  directory: LocalModelKind
  url: string
  fallbackUrls?: string[]
  sha256: string
  size: number
}

export const LOCAL_MODEL_CATALOG: Record<LocalModelKind, LocalModelDefinition> = {
  asr: {
    fileName: 'SenseVoiceSmall-Q8_0.gguf',
    directory: 'asr',
    url: 'https://huggingface.co/handy-computer/SenseVoiceSmall-gguf/resolve/3a0bdb48724176417334c69555a26b2db6e136a0/SenseVoiceSmall-Q8_0.gguf',
    fallbackUrls: ['https://hf-mirror.com/handy-computer/SenseVoiceSmall-gguf/resolve/3a0bdb48724176417334c69555a26b2db6e136a0/SenseVoiceSmall-Q8_0.gguf'],
    sha256: '6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29',
    size: 252684608,
  },
  vad: {
    fileName: 'silero-vad-v6.2-F32.gguf',
    directory: 'vad',
    url: 'https://huggingface.co/handy-computer/silero-vad-v6.2-gguf/resolve/97bbd75179f535e4708bccdf61e9278b8b60dfc7/silero-vad-v6.2-F32.gguf',
    fallbackUrls: ['https://hf-mirror.com/handy-computer/silero-vad-v6.2-gguf/resolve/97bbd75179f535e4708bccdf61e9278b8b60dfc7/silero-vad-v6.2-F32.gguf'],
    sha256: '0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6',
    size: 1241056,
  },
  speaker: {
    fileName: '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx',
    directory: 'speaker',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx',
    sha256: 'eda0bf86422a9725a3523d5a1d3d75dedf340664e0ba65cfc1c7b2a78b6cf0b5',
    size: 71441527,
  },
}

export interface LocalModelPaths {
  asr: string
  vad: string
}

export function localModelPath(root: string, kind: LocalModelKind): string {
  if (!root.trim()) throw new Error('模型目录不能为空')
  const model = LOCAL_MODEL_CATALOG[kind]
  return join(root, model.directory, model.fileName)
}

export function resolveLocalModelPaths(root: string): LocalModelPaths {
  return { asr: localModelPath(root, 'asr'), vad: localModelPath(root, 'vad') }
}

export interface PreparedLocalModel {
  path: string
  downloaded: boolean
}

export class LocalModelManager {
  private readonly pending = new Map<LocalModelKind, Promise<PreparedLocalModel>>()

  constructor(
    readonly root: string,
    private readonly fetcher?: typeof fetch,
    private readonly catalog: Record<LocalModelKind, LocalModelDefinition> = LOCAL_MODEL_CATALOG,
  ) {
    if (!root.trim()) throw new Error('模型目录不能为空')
  }

  path(kind: LocalModelKind): string {
    const model = this.catalog[kind]
    return join(this.root, model.directory, model.fileName)
  }

  get speechPaths(): LocalModelPaths {
    return { asr: this.path('asr'), vad: this.path('vad') }
  }

  async installed(kind: LocalModelKind): Promise<PreparedLocalModel | null> {
    const model = this.catalog[kind]
    const path = this.path(kind)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile() || info.size !== model.size) return null
    if (await fileSha256(path).catch(() => '') !== model.sha256) return null
    return { path, downloaded: false }
  }

  ensure(kind: LocalModelKind, onProgress?: (percent: number) => void): Promise<PreparedLocalModel> {
    const current = this.pending.get(kind)
    if (current) return current
    const model = this.catalog[kind]
    const path = this.path(kind)
    const task = (async (): Promise<PreparedLocalModel> => {
      const errors: string[] = []
      const urls = [model.url, ...(model.fallbackUrls ?? [])]
      for (const url of urls) {
        try {
          const result = await ensureUrlFile({
            url,
            path,
            sha256: model.sha256,
            expectedSize: model.size,
            onProgress,
            fetcher: this.fetcher,
          })
          return { path, downloaded: result === 'downloaded' }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      throw new Error(`模型下载失败：${errors.join('；')}`)
    })().finally(() => { this.pending.delete(kind) })
    this.pending.set(kind, task)
    return task
  }
}

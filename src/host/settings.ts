import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type MeetScribeSettings } from '../shared/types.ts'

export function defaultOutputDirectory(): string {
  return join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'MeetScribe')
}

export function normalizeSettings(input: unknown): MeetScribeSettings {
  const value = input && typeof input === 'object' ? input as Partial<MeetScribeSettings> : {}
  return {
    shortcut: typeof value.shortcut === 'string' && value.shortcut.length <= 40 ? value.shortcut : DEFAULT_SETTINGS.shortcut,
    silenceMs: clampNumber(value.silenceMs, 500, 5000, DEFAULT_SETTINGS.silenceMs),
    modelHost: typeof value.modelHost === 'string' ? value.modelHost.slice(0, 200) : '',
    senseVoice: typeof value.senseVoice === 'boolean' ? value.senseVoice : DEFAULT_SETTINGS.senseVoice,
    senseITN: typeof value.senseITN === 'boolean' ? value.senseITN : DEFAULT_SETTINGS.senseITN,
    speakerEnabled: typeof value.speakerEnabled === 'boolean' ? value.speakerEnabled : DEFAULT_SETTINGS.speakerEnabled,
    speakerThreshold: clampNumber(value.speakerThreshold, 0.4, 0.9, DEFAULT_SETTINGS.speakerThreshold),
    maxSpeakers: Math.round(clampNumber(value.maxSpeakers, 2, 16, DEFAULT_SETTINGS.maxSpeakers)),
    fillerRemoval: typeof value.fillerRemoval === 'boolean' ? value.fillerRemoval : DEFAULT_SETTINGS.fillerRemoval,
    retainAudio: typeof value.retainAudio === 'boolean' ? value.retainAudio : DEFAULT_SETTINGS.retainAudio,
    preloadModels: typeof value.preloadModels === 'boolean' ? value.preloadModels : DEFAULT_SETTINGS.preloadModels,
    outputDir: typeof value.outputDir === 'string' && value.outputDir.trim() ? value.outputDir.trim() : defaultOutputDirectory(),
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export class SettingsStore {
  private current: MeetScribeSettings = normalizeSettings({})

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    try {
      this.current = normalizeSettings(JSON.parse(await readFile(this.path, 'utf8')))
    } catch {
      this.current = normalizeSettings({})
      await this.save(this.current)
    }
  }

  get(): MeetScribeSettings {
    return { ...this.current }
  }

  async save(patch: Partial<MeetScribeSettings>): Promise<MeetScribeSettings> {
    this.current = normalizeSettings({ ...this.current, ...patch })
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(this.current, null, 2), 'utf8')
    await rename(temporary, this.path)
    return this.get()
  }
}

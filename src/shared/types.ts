export type MeetingStatus = 'idle' | 'recording' | 'paused' | 'finalizing' | 'completed' | 'error'
export type AudioSource = 'microphone' | 'system' | 'manual'
export type SegmentStatus = 'partial' | 'final' | 'failed'

export interface Speaker {
  id: string
  name: string
  color: string
  confirmed: boolean
  manuallyAssigned?: boolean
}

export interface TranscriptSegment {
  id: string
  meetingId: string
  speakerId: string
  source: AudioSource
  startMs: number
  endMs: number
  rawText: string
  displayText: string
  revision: number
  status: SegmentStatus
  speakerConfidence?: number
  manuallyAssigned?: boolean
  embedding?: number[]
  createdAt: string
  updatedAt: string
}

export interface MeetingMetadata {
  topic: string
  location: string
  format: 'offline' | 'online' | 'hybrid'
  host: string
  recorder: string
  attendees: string[]
  absentees: string[]
  project: string
  confidentiality: 'internal' | 'confidential' | 'public'
  notes: string
}

export interface GeneratedFile {
  path: string
  version: number
  createdAt: string
}

export type MinutesTaskStage = 'preparing' | 'model' | 'parsing' | 'document' | 'completed'
export type MinutesTaskStatus = 'running' | 'completed' | 'failed'

export interface MinutesTask {
  id: string
  meetingId: string
  meetingTitle: string
  status: MinutesTaskStatus
  stage: MinutesTaskStage
  progress: number
  receivedChars: number
  reasoningChars?: number
  createdAt: string
  updatedAt: string
  error?: string
  version?: number
}

export interface MinutesProgressUpdate {
  stage: Exclude<MinutesTaskStage, 'completed'>
  progress: number
  receivedChars?: number
  reasoningChars?: number
}

export interface Meeting {
  id: string
  title: string
  status: MeetingStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  endedAt?: string
  metadata: MeetingMetadata
  speakers: Speaker[]
  segments: TranscriptSegment[]
  vocabulary: string[]
  generatedFiles: GeneratedFile[]
}

export interface AsrReplacement {
  /** 识别器常听成的写法（一个或多个）。 */
  from: string[]
  /** 想要的标准写法。 */
  to: string
}

/** A model route only; credentials always remain owned by Harness. */
export interface MinutesModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface MinutesReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface MinutesModelOption {
  provider: string
  providerName: string
  model: string
  name: string
  description?: string
  reasoningEfforts: MinutesReasoningEffort[]
  defaultReasoningEffort?: string
}

export interface MinutesModelCatalog {
  /** DSH modelCatalog.default, used when minutesModel is null. */
  current: MinutesModelSelection | null
  /** DSH conversation catalog order; the settings UI restores Provider groups. */
  options: MinutesModelOption[]
  errors: string[]
}

export interface MeetScribeSettings {
  shortcut: string
  silenceMs: number
  senseITN: boolean
  speakerEnabled: boolean
  speakerThreshold: number
  maxSpeakers: number
  fillerRemoval: boolean
  retainAudio: boolean
  preloadModels: boolean
  outputDir: string
  asrReplacements: AsrReplacement[]
  /** Null follows the DSH default; an explicit route applies only to new minutes tasks. */
  minutesModel: MinutesModelSelection | null
  /** Inactivity limit, not a total generation deadline. */
  minutesIdleTimeoutMs: number
}

export interface ModelProgress {
  file: string
  percent: number
}

export interface ModelStatus {
  ready: boolean
  speakerReady: boolean
  loading: boolean
  progress: ModelProgress | null
  error?: string
}

export const SPEAKER_COLORS = ['#3d7a6b', '#4d6fa5', '#9a633c', '#805d9b', '#a34f62', '#5f7a3d', '#387987', '#9a6b86']

export const DEFAULT_METADATA: MeetingMetadata = {
  topic: '',
  location: '',
  format: 'online',
  host: '',
  recorder: '',
  attendees: [],
  absentees: [],
  project: '',
  confidentiality: 'internal',
  notes: '',
}

export const DEFAULT_MINUTES_IDLE_TIMEOUT_MS = 5 * 60 * 1000

export const DEFAULT_SETTINGS: MeetScribeSettings = {
  shortcut: 'Ctrl+E',
  silenceMs: 800,
  senseITN: true,
  speakerEnabled: true,
  speakerThreshold: 0.65,
  maxSpeakers: 8,
  fillerRemoval: false,
  retainAudio: false,
  preloadModels: true,
  outputDir: '',
  asrReplacements: [],
  minutesModel: null,
  minutesIdleTimeoutMs: DEFAULT_MINUTES_IDLE_TIMEOUT_MS,
}

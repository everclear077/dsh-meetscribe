import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_METADATA,
  SPEAKER_COLORS,
  type Meeting,
  type MeetingMetadata,
  type Speaker,
  type TranscriptSegment,
} from '../shared/types.ts'

export type StoreEvent = { type: 'meeting-updated' | 'meeting-deleted'; meetingId: string }

export class MeetingStore {
  private readonly meetings = new Map<string, Meeting>()
  private readonly listeners = new Set<(event: StoreEvent) => void>()
  private readonly writes = new Map<string, Promise<void>>()

  constructor(private readonly directory: string) {}

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const files = await readdir(this.directory).catch(() => [])
    await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
      try {
        const meeting = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as Meeting
        if (meeting.id && Array.isArray(meeting.segments) && Array.isArray(meeting.speakers)) {
          if (meeting.status === 'recording' || meeting.status === 'paused' || meeting.status === 'finalizing') {
            meeting.status = 'idle'
          }
          this.meetings.set(meeting.id, meeting)
        }
      } catch (error) {
        console.warn(`[dsh-meetscribe] Ignoring unreadable meeting file ${file}:`, error)
      }
    }))
  }

  subscribe(listener: (event: StoreEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): Meeting[] {
    return [...this.meetings.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): Meeting | undefined {
    return this.meetings.get(id)
  }

  async create(title?: string): Promise<Meeting> {
    const now = new Date().toISOString()
    const meeting: Meeting = {
      id: randomUUID(),
      title: title?.trim() || `会议 ${new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}`,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      metadata: { ...DEFAULT_METADATA },
      speakers: [],
      segments: [],
      vocabulary: [],
      generatedFiles: [],
    }
    this.meetings.set(meeting.id, meeting)
    await this.persist(meeting)
    this.emit({ type: 'meeting-updated', meetingId: meeting.id })
    return meeting
  }

  async update(id: string, patch: Partial<Pick<Meeting, 'title' | 'status' | 'startedAt' | 'endedAt' | 'vocabulary'>> & { metadata?: Partial<MeetingMetadata> }): Promise<Meeting> {
    const meeting = this.require(id)
    if (patch.title !== undefined) meeting.title = patch.title.trim() || meeting.title
    if (patch.status !== undefined) meeting.status = patch.status
    if (patch.startedAt !== undefined) meeting.startedAt = patch.startedAt
    if (patch.endedAt !== undefined) meeting.endedAt = patch.endedAt || undefined
    if (patch.vocabulary !== undefined) meeting.vocabulary = [...new Set(patch.vocabulary.map((v) => v.trim()).filter(Boolean))].slice(0, 200)
    if (patch.metadata) {
      meeting.metadata = {
        ...meeting.metadata,
        ...patch.metadata,
        attendees: patch.metadata.attendees?.filter(Boolean) ?? meeting.metadata.attendees,
        absentees: patch.metadata.absentees?.filter(Boolean) ?? meeting.metadata.absentees,
      }
    }
    await this.touch(meeting)
    return meeting
  }

  ensureSpeaker(meeting: Meeting, speakerId?: string, name?: string): Speaker {
    if (speakerId) {
      const existing = meeting.speakers.find((speaker) => speaker.id === speakerId)
      if (existing) return existing
    }
    const id = speakerId || randomUUID()
    const speaker: Speaker = {
      id,
      name: name?.trim() || `发言人 ${meeting.speakers.length + 1}`,
      color: SPEAKER_COLORS[meeting.speakers.length % SPEAKER_COLORS.length],
      confirmed: false,
    }
    meeting.speakers.push(speaker)
    return speaker
  }

  async addSegment(meetingId: string, input: Pick<TranscriptSegment, 'speakerId' | 'source' | 'startMs' | 'endMs' | 'rawText' | 'displayText'> & Partial<Pick<TranscriptSegment, 'speakerConfidence' | 'embedding'>>): Promise<TranscriptSegment> {
    const meeting = this.require(meetingId)
    this.ensureSpeaker(meeting, input.speakerId)
    const now = new Date().toISOString()
    const segment: TranscriptSegment = {
      id: randomUUID(),
      meetingId,
      ...input,
      revision: 1,
      status: 'final',
      createdAt: now,
      updatedAt: now,
    }
    meeting.segments.push(segment)
    await this.touch(meeting)
    return segment
  }

  async renameSpeaker(meetingId: string, speakerId: string, name: string): Promise<Meeting> {
    const meeting = this.require(meetingId)
    const speaker = meeting.speakers.find((item) => item.id === speakerId)
    if (!speaker) throw new Error('Speaker not found')
    const clean = name.trim().slice(0, 40)
    if (!clean) throw new Error('Speaker name cannot be empty')
    speaker.name = clean
    speaker.confirmed = true
    speaker.manuallyAssigned = true
    if (!meeting.vocabulary.includes(clean)) meeting.vocabulary.push(clean)
    await this.touch(meeting)
    return meeting
  }

  async mergeSpeakers(meetingId: string, sourceId: string, targetId: string): Promise<Meeting> {
    if (sourceId === targetId) return this.require(meetingId)
    const meeting = this.require(meetingId)
    if (!meeting.speakers.some((s) => s.id === sourceId) || !meeting.speakers.some((s) => s.id === targetId)) {
      throw new Error('Speaker not found')
    }
    for (const segment of meeting.segments) {
      if (segment.speakerId === sourceId) {
        segment.speakerId = targetId
        segment.revision += 1
        segment.updatedAt = new Date().toISOString()
      }
    }
    meeting.speakers = meeting.speakers.filter((speaker) => speaker.id !== sourceId)
    await this.touch(meeting)
    return meeting
  }

  async reassignSegment(meetingId: string, segmentId: string, speakerId: string): Promise<Meeting> {
    const meeting = this.require(meetingId)
    const segment = meeting.segments.find((item) => item.id === segmentId)
    if (!segment) throw new Error('Segment not found')
    this.ensureSpeaker(meeting, speakerId)
    segment.speakerId = speakerId
    segment.manuallyAssigned = true
    segment.revision += 1
    segment.updatedAt = new Date().toISOString()
    await this.touch(meeting)
    return meeting
  }

  async addGeneratedFile(meetingId: string, path: string): Promise<Meeting> {
    const meeting = this.require(meetingId)
    const version = Math.max(0, ...meeting.generatedFiles.map((file) => file.version)) + 1
    meeting.generatedFiles.push({ path, version, createdAt: new Date().toISOString() })
    await this.touch(meeting)
    return meeting
  }

  async delete(id: string): Promise<void> {
    this.meetings.delete(id)
    await rm(join(this.directory, `${id}.json`), { force: true })
    this.emit({ type: 'meeting-deleted', meetingId: id })
  }

  private require(id: string): Meeting {
    const meeting = this.meetings.get(id)
    if (!meeting) throw new Error('Meeting not found')
    return meeting
  }

  private async touch(meeting: Meeting): Promise<void> {
    meeting.updatedAt = new Date().toISOString()
    await this.persist(meeting)
    this.emit({ type: 'meeting-updated', meetingId: meeting.id })
  }

  private persist(meeting: Meeting): Promise<void> {
    const previous = this.writes.get(meeting.id) ?? Promise.resolve()
    const next = previous.then(async () => {
      const target = join(this.directory, `${meeting.id}.json`)
      const temporary = `${target}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(meeting, null, 2), 'utf8')
      await rename(temporary, target)
    }).catch((error) => {
      console.error('[dsh-meetscribe] Failed to persist meeting:', error)
      throw error
    })
    this.writes.set(meeting.id, next)
    void next.finally(() => {
      if (this.writes.get(meeting.id) === next) this.writes.delete(meeting.id)
    }).catch(() => undefined)
    return next
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

import { useSyncExternalStore } from 'react'
import type { Meeting, MeetingMetadata } from '../shared/types.ts'
import { createAsrEngine, type AsrEngine } from './asr.ts'
import { acquireMeetingAudio, releaseMeetingAudio } from './audio.ts'
import { api } from './api.ts'

export interface MeetingState {
  ready: boolean
  open: boolean
  minimized: boolean
  expanded: boolean
  tab: 'transcript' | 'details' | 'files' | 'history'
  meetings: Meeting[]
  current: Meeting | null
  pending: string
  audioLevel: number
  busy: boolean
  generating: boolean
  error: string
  notice: string
  elapsed: number
}

const initial: MeetingState = {
  ready: false, open: false, minimized: false, expanded: false, tab: 'transcript', meetings: [], current: null,
  pending: '', audioLevel: 0, busy: false, generating: false, error: '', notice: '', elapsed: 0,
}

class MeetingController {
  private state = initial
  private listeners = new Set<() => void>()
  private engine: AsrEngine | null = null
  private events: EventSource | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private runSince = 0
  private accumulated = 0
  private lastLevelAt = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = (): MeetingState => this.state
  private patch(patch: Partial<MeetingState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private fail(error: unknown): void {
    this.patch({ busy: false, generating: false, error: error instanceof Error ? error.message : String(error) })
  }
  private elapsed(): number { return this.accumulated + (this.runSince ? Date.now() - this.runSince : 0) }
  private clock(on: boolean): void {
    if (on && !this.timer) this.timer = setInterval(() => this.patch({ elapsed: this.elapsed() }), 500)
    if (!on && this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async init(): Promise<void> {
    if (this.events) return
    try {
      const meetings = await api.meetings()
      const current = meetings[0] ? await api.meeting(meetings[0].id) : null
      this.patch({ meetings, current, ready: true })
      this.events = new EventSource('/meetscribe/events')
      this.events.addEventListener('meeting', (event) => {
        const meeting = JSON.parse((event as MessageEvent).data) as Meeting
        const meetings = [meeting, ...this.state.meetings.filter((item) => item.id !== meeting.id)]
        this.patch({ meetings, current: this.state.current?.id === meeting.id ? meeting : this.state.current })
      })
      this.events.addEventListener('meeting-deleted', (event) => {
        const { id } = JSON.parse((event as MessageEvent).data) as { id: string }
        this.patch({ meetings: this.state.meetings.filter((item) => item.id !== id), current: this.state.current?.id === id ? null : this.state.current })
      })
    } catch (error) { this.fail(error); this.patch({ ready: true }) }
  }

  refresh = async (): Promise<void> => {
    try {
      const list = await api.meetings()
      this.patch({ meetings: list, ready: true, error: '' })
    } catch (error) { this.fail(error) }
  }

  toggle = (): void => {
    if (this.state.open && !this.state.minimized) this.patch({ open: false, error: '', notice: '' })
    else this.open()
  }
  open = (autoRecord = true): void => {
    this.patch({ open: true, minimized: false, error: '', notice: '' })
    if (!autoRecord || this.engine || this.state.busy) return
    const status = this.state.current?.status
    if (status === 'paused' || status === 'recording') void this.begin(true)
    else void this.begin(false)
  }
  close = (): void => { this.patch({ open: false, minimized: false }) }
  minimize = (): void => { this.patch({ minimized: true }) }
  restore = (): void => { this.patch({ open: true, minimized: false }) }
  expand = (): void => { this.patch({ expanded: !this.state.expanded, minimized: false }) }
  setTab = (tab: MeetingState['tab']): void => { this.patch({ tab }) }
  clearMessage = (): void => { this.patch({ error: '', notice: '' }) }

  select = async (id: string): Promise<void> => {
    if (this.engine) { this.patch({ error: '请先结束当前录音，再切换会议' }); return }
    try { this.patch({ current: await api.meeting(id), tab: 'transcript', error: '', elapsed: 0 }) } catch (error) { this.fail(error) }
  }
  create = async (): Promise<void> => {
    if (this.engine) return
    try {
      const meeting = await api.create()
      this.patch({ current: meeting, meetings: [meeting, ...this.state.meetings], tab: 'transcript', elapsed: 0, notice: '已新建会议' })
    } catch (error) { this.fail(error) }
  }

  private async begin(resume: boolean): Promise<void> {
    if (this.engine || this.state.busy) return
    this.patch({ busy: true, error: '', notice: '', audioLevel: 0 })
    let prepared: Meeting | null = null
    try {
      let meeting = this.state.current
      if (!meeting || meeting.status === 'completed') meeting = await api.create()
      meeting = await api.action(meeting.id, resume ? 'resume' : 'start')
      prepared = meeting
      this.patch({ current: meeting, meetings: [meeting, ...this.state.meetings.filter((item) => item.id !== meeting!.id)], pending: '' })
      if (!resume) this.accumulated = 0
      this.runSince = Date.now()
      const settings = await api.settings()
      const engine = createAsrEngine({
        basePath: '/meetscribe', silenceMs: settings.silenceMs, mode: 'toggle', bargeInMode: 'auto', audioSource: 'microphone',
        acquireAudio: () => acquireMeetingAudio('microphone'),
        releaseAudio: releaseMeetingAudio,
      }, meeting.id)
      this.engine = engine
      engine.onPartial((pending) => this.patch({ pending }))
      engine.onSegment(() => this.patch({ pending: '' }))
      engine.onError((message) => this.patch({ error: message }))
      engine.onLevel((level) => {
        const now = Date.now()
        if (now - this.lastLevelAt < 50) return
        this.lastLevelAt = now
        this.patch({ audioLevel: Math.max(level, this.state.audioLevel * 0.55) })
      })
      await engine.start()
      this.patch({ current: meeting, meetings: [meeting, ...this.state.meetings.filter((item) => item.id !== meeting!.id)], busy: false, pending: '', audioLevel: 0 })
      this.clock(true)
    } catch (error) {
      await this.engine?.stop().catch(() => undefined)
      this.engine = null
      this.runSince = 0
      this.clock(false)
      if (prepared) {
        const started = prepared
        const paused = await api.action(started.id, 'pause').catch(() => started)
        this.patch({ current: paused, meetings: [paused, ...this.state.meetings.filter((item) => item.id !== paused.id)] })
      }
      this.patch({ audioLevel: 0 })
      this.fail(error)
    }
  }
  start = (): Promise<void> => this.begin(false)
  resume = (): Promise<void> => this.begin(true)

  pause = async (): Promise<void> => {
    const meeting = this.state.current
    if (!meeting || !this.engine) return
    this.patch({ busy: true, error: '' })
    try {
      await this.engine.stop(); this.engine = null
      this.accumulated = this.elapsed(); this.runSince = 0; this.clock(false)
      this.patch({ current: await api.action(meeting.id, 'pause'), busy: false, pending: '', audioLevel: 0 })
    } catch (error) { this.fail(error) }
  }

  finish = async (): Promise<void> => {
    const meeting = this.state.current
    if (!meeting) return
    this.patch({ busy: true, error: '' })
    try {
      await this.engine?.stop(); this.engine = null
      this.accumulated = this.elapsed(); this.runSince = 0; this.clock(false)
      const updated = await api.action(meeting.id, 'finish')
      this.patch({ current: updated, busy: false, pending: '', audioLevel: 0, elapsed: this.accumulated, notice: '会议已结束，逐字稿已保存在本机' })
    } catch (error) { this.fail(error) }
  }

  toggleRecording = (): void => {
    const status = this.state.current?.status
    if (status === 'recording') void this.pause()
    else if (status === 'paused') void this.resume()
    else void this.start()
  }

  clear = async (): Promise<void> => {
    const meeting = this.state.current
    if (!meeting || this.state.busy) return
    const wasRecording = !!this.engine || meeting.status === 'recording'
    this.patch({ busy: true, error: '', notice: '' })
    try {
      await this.engine?.stop()
      this.engine = null
      this.accumulated = 0
      this.runSince = 0
      this.clock(false)
      const cleared = await api.clear(meeting.id)
      this.patch({
        current: cleared,
        meetings: [cleared, ...this.state.meetings.filter((item) => item.id !== meeting.id && item.id !== cleared.id)],
        busy: false,
        pending: '',
        audioLevel: 0,
        elapsed: 0,
        notice: wasRecording ? '' : '逐字稿已清空',
      })
      if (wasRecording) await this.begin(false)
    } catch (error) { this.fail(error) }
  }

  clearHistory = async (): Promise<void> => {
    if (this.state.busy) return
    const wasRecording = !!this.engine || this.state.current?.status === 'recording'
    this.patch({ busy: true, error: '', notice: '' })
    try {
      await this.engine?.stop()
      this.engine = null
      this.accumulated = 0
      this.runSince = 0
      this.clock(false)
      await api.clearHistory()
      this.patch({
        current: null,
        meetings: [],
        busy: false,
        pending: '',
        audioLevel: 0,
        elapsed: 0,
        tab: wasRecording ? 'transcript' : this.state.tab,
        notice: wasRecording ? '' : '已清空全部历史会议',
      })
      if (wasRecording) await this.begin(false)
    } catch (error) {
      this.fail(error)
    }
  }

  note = async (text: string): Promise<void> => {
    const meeting = this.state.current
    if (!meeting || !text.trim()) return
    try { await api.note(meeting.id, text); this.patch({ current: await api.meeting(meeting.id), notice: '已添加人工记录' }) } catch (error) { this.fail(error) }
  }
  rename = async (speakerId: string, name: string): Promise<void> => {
    if (!this.state.current || !name.trim()) return
    try { this.patch({ current: await api.rename(this.state.current.id, speakerId, name) }) } catch (error) { this.fail(error) }
  }
  reassign = async (segmentId: string, speakerId: string): Promise<void> => {
    if (!this.state.current) return
    try { this.patch({ current: await api.reassign(this.state.current.id, segmentId, speakerId) }) } catch (error) { this.fail(error) }
  }
  merge = async (sourceId: string, targetId: string): Promise<void> => {
    if (!this.state.current || sourceId === targetId) return
    try { this.patch({ current: await api.merge(this.state.current.id, sourceId, targetId), notice: '发言人已合并' }) } catch (error) { this.fail(error) }
  }
  saveMetadata = async (title: string, metadata: MeetingMetadata): Promise<void> => {
    if (!this.state.current) return
    try { this.patch({ current: await api.update(this.state.current.id, { title, metadata }), notice: '会议信息已保存' }) } catch (error) { this.fail(error) }
  }
  generate = async (): Promise<void> => {
    if (!this.state.current || this.state.generating) return
    if (this.engine) { this.patch({ error: '请先暂停录音，再生成会议纪要' }); return }
    this.patch({ generating: true, error: '', notice: '' })
    try {
      const meeting = await api.generate(this.state.current.id)
      this.patch({ current: meeting, generating: false, tab: 'files', expanded: true, minimized: false, notice: 'Word 会议纪要已生成' })
    } catch (error) { this.fail(error) }
  }
  dispose(): void {
    void this.engine?.stop(); this.events?.close(); this.clock(false)
  }
}

export const meetings = new MeetingController()
export function useMeetings(): MeetingState { return useSyncExternalStore(meetings.subscribe, meetings.getSnapshot) }

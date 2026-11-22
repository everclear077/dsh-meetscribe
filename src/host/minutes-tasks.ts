import { randomUUID } from 'node:crypto'
import type { Meeting, MinutesProgressUpdate, MinutesTask } from '../shared/types.ts'

type MinutesOperation = (report: (update: MinutesProgressUpdate) => void) => Promise<Meeting>

/** Host-owned generation tasks survive floating-window close and browser view switches. */
export class MinutesTaskManager {
  private readonly tasks = new Map<string, MinutesTask>()
  private readonly activeByMeeting = new Map<string, string>()
  private readonly listeners = new Set<(task: MinutesTask) => void>()

  subscribe(listener: (task: MinutesTask) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  list(): MinutesTask[] {
    return [...this.tasks.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((task) => ({ ...task }))
  }

  active(meetingId: string): MinutesTask | undefined {
    const id = this.activeByMeeting.get(meetingId)
    const task = id ? this.tasks.get(id) : undefined
    return task ? { ...task } : undefined
  }

  hasRunning(): boolean {
    return this.activeByMeeting.size > 0
  }

  /** Remove terminal history after its meeting or transcript has been deleted. */
  remove(meetingId?: string): void {
    for (const task of this.tasks.values()) {
      if ((!meetingId || task.meetingId === meetingId) && task.status !== 'running') this.tasks.delete(task.id)
    }
  }

  start(meeting: Pick<Meeting, 'id' | 'title'>, operation: MinutesOperation): MinutesTask {
    const active = this.active(meeting.id)
    if (active) return active
    for (const task of this.tasks.values()) {
      if (task.meetingId === meeting.id && task.status === 'failed') this.tasks.delete(task.id)
    }
    const now = new Date().toISOString()
    const task: MinutesTask = {
      id: randomUUID(),
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      status: 'running',
      stage: 'preparing',
      progress: 0,
      receivedChars: 0,
      reasoningChars: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)
    this.activeByMeeting.set(meeting.id, task.id)
    this.emit(task)
    void this.run(task.id, operation)
    return { ...task }
  }

  private async run(taskId: string, operation: MinutesOperation): Promise<void> {
    try {
      const generated = await operation((update) => {
        const task = this.tasks.get(taskId)
        if (!task || task.status !== 'running') return
        this.update(task, {
          stage: update.stage,
          progress: Math.max(task.progress, Math.min(95, update.progress)),
          receivedChars: update.receivedChars ?? task.receivedChars,
          reasoningChars: update.reasoningChars ?? task.reasoningChars,
        })
      })
      const task = this.tasks.get(taskId)
      if (!task) return
      this.update(task, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        version: Math.max(0, ...generated.generatedFiles.map((file) => file.version)),
        error: undefined,
      })
    } catch (error) {
      const task = this.tasks.get(taskId)
      if (!task) return
      this.update(task, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      const task = this.tasks.get(taskId)
      if (task && this.activeByMeeting.get(task.meetingId) === task.id) this.activeByMeeting.delete(task.meetingId)
      this.prune()
    }
  }

  private update(task: MinutesTask, patch: Partial<MinutesTask>): void {
    Object.assign(task, patch, { updatedAt: new Date().toISOString() })
    this.emit(task)
  }

  private emit(task: MinutesTask): void {
    const snapshot = { ...task }
    for (const listener of this.listeners) listener(snapshot)
  }

  private prune(): void {
    const terminal = this.list().filter((task) => task.status !== 'running')
    for (const task of terminal.slice(20)) this.tasks.delete(task.id)
  }
}

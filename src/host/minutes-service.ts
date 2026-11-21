import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { MeetingStore } from './meeting-store.ts'
import type { Meeting, MeetScribeSettings } from '../shared/types.ts'
import { completeWithDefaultModel } from './llm.ts'
import {
  MINUTES_SYSTEM_PROMPT,
  buildMinutesPrompt,
  generateMinutesDocx,
  parseMinutesJson,
  type MeetingMetadata,
} from '../word/index.ts'

const safeName = (name: string): string => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 70) || '会议纪要'
const time = (iso?: string): string => iso ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '待补充'

function metadataFor(meeting: Meeting): MeetingMetadata {
  const format = { offline: '线下', online: '线上', hybrid: '混合' } as const
  return {
    name: meeting.title,
    topic: meeting.metadata.topic || '待补充',
    date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(meeting.startedAt ?? meeting.createdAt)),
    startTime: time(meeting.startedAt),
    endTime: time(meeting.endedAt),
    location: meeting.metadata.location || '待补充',
    format: format[meeting.metadata.format],
    host: meeting.metadata.host || '待补充',
    recorder: meeting.metadata.recorder || '待补充',
    attendees: meeting.metadata.attendees,
    absentees: meeting.metadata.absentees,
    project: meeting.metadata.project || '待补充',
    confidentiality: { internal: '内部', confidential: '机密', public: '公开' }[meeting.metadata.confidentiality],
  }
}

export function buildTranscriptForMinutes(meeting: Meeting): Array<{ segmentId: string; speaker: string; text: string }> {
  const names = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.name]))
  return meeting.segments.map((segment) => ({
    segmentId: segment.id,
    speaker: names.get(segment.speakerId) || '发言人',
    // 术语纠正在 ASR 出口完成；生成纪要使用纠正后的展示文本，原始模型文本仍独立留存。
    text: segment.displayText || segment.rawText,
  }))
}

/** Explicit user action: only this path sends transcript text to the configured DSH LLM. */
export async function generateWordMinutes(ctx: Context, store: MeetingStore, settings: MeetScribeSettings, meetingId: string): Promise<Meeting> {
  const meeting = store.get(meetingId)
  if (!meeting) throw new Error('会议不存在')
  const transcript = buildTranscriptForMinutes(meeting)
  const metadata = metadataFor(meeting)
  const prompt = buildMinutesPrompt(JSON.stringify(transcript), metadata)
  const response = await completeWithDefaultModel(ctx, MINUTES_SYSTEM_PROMPT, prompt)
  const minutes = parseMinutesJson(response)
  // User-confirmed fields are authoritative even if the model ignored the prompt.
  minutes.metadata = metadata
  await mkdir(settings.outputDir, { recursive: true })
  const version = Math.max(0, ...meeting.generatedFiles.map((file) => file.version)) + 1
  const output = join(settings.outputDir, `${safeName(meeting.title)}-纪要-v${version}.docx`)
  await generateMinutesDocx(minutes, output)
  return store.addGeneratedFile(meetingId, output)
}

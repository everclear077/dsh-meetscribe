import { createRoot } from 'react-dom/client'
import type { Meeting } from '../shared/types.ts'
import { MeetingApp } from './meeting.tsx'
import { meetings } from './meeting-controller.ts'
import { styles } from './styles.ts'

const now = new Date().toISOString()
const meeting: Meeting = {
  id: 'preview', title: 'MeetScribe 产品评审会', status: 'paused', createdAt: now, updatedAt: now,
  startedAt: now, metadata: { topic: '本地转写与 Word 纪要验收', location: '线上会议', format: 'online', host: '李敏', recorder: '陈晨', attendees: ['李敏', '陈晨', '王璐'], absentees: [], project: 'MeetScribe', confidentiality: 'internal', notes: '' },
  speakers: [
    { id: 'speaker-1', name: '李敏', color: '#3d7a6b', confirmed: true },
    { id: 'speaker-2', name: '陈晨', color: '#4d6fa5', confirmed: true },
    { id: 'speaker-3', name: '王璐', color: '#9a633c', confirmed: true },
  ],
  segments: [
    { id: 's1', meetingId: 'preview', speakerId: 'speaker-1', source: 'microphone', startMs: 74000, endMs: 81000, rawText: '今天主要确认本地识别、说话人管理和 Word 输出这三项。', displayText: '今天主要确认本地识别、说话人管理和 Word 输出这三项。', revision: 1, status: 'final', createdAt: now, updatedAt: now },
    { id: 's2', meetingId: 'preview', speakerId: 'speaker-2', source: 'microphone', startMs: 89000, endMs: 99000, rawText: '中文和中英混合识别已经完成联调，嗯，句末停顿后会自动定稿。', displayText: '中文和中英混合识别已经完成联调，句末停顿后会自动定稿。', revision: 1, status: 'final', createdAt: now, updatedAt: now },
    { id: 's3', meetingId: 'preview', speakerId: 'speaker-3', source: 'microphone', startMs: 108000, endMs: 119000, rawText: '纪要保留原始逐字稿，只有用户点击生成时才调用大模型。', displayText: '纪要保留原始逐字稿，只有用户点击生成时才调用大模型。', revision: 1, status: 'final', createdAt: now, updatedAt: now },
  ], vocabulary: [], generatedFiles: [],
}

globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  const path = String(input)
  if (path.includes('/settings')) return Response.json({ silenceMs: 1500 })
  return Response.json(path.endsWith('/meetings') ? [meeting] : meeting)
}
globalThis.EventSource = class { addEventListener(): void {} close(): void {} } as unknown as typeof EventSource

const style = document.createElement('style')
style.textContent = styles + 'body{margin:0;background:#e9eef1;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}.gallery-shell{height:100vh;position:relative}.gallery-caption{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);font-size:11px;color:#7b8a98;letter-spacing:.04em}'
document.head.appendChild(style)
document.body.innerHTML = '<div class="gallery-shell"><div id="root"></div><div class="gallery-caption">MEETSCRIBE · LOCAL MEETING NOTES</div></div>'
void meetings.init().then(() => {
  meetings.toggle()
  createRoot(document.getElementById('root')!).render(<MeetingApp />)
})

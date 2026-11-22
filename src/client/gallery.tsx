import { createRoot } from 'react-dom/client'
import type { Meeting, MinutesTask } from '../shared/types.ts'
import { DEFAULT_SETTINGS } from '../shared/types.ts'
import { MeetingApp } from './meeting.tsx'
import { MeetingSettings } from './settings.tsx'
import { MeetScribeWorkspace } from './workspace.tsx'
import { meetings } from './meeting-controller.ts'
import { styles } from './styles.ts'

const now = '2026-11-21T02:30:00.000Z'
const metadata = { topic: '本地转写与 Word 纪要验收', location: '线上会议', format: 'online' as const, host: '发言人甲', recorder: '发言人乙', attendees: ['发言人甲', '发言人乙', '发言人丙'], absentees: [], project: 'MeetScribe', confidentiality: 'internal' as const, notes: '' }
const meeting: Meeting = {
  id: 'preview', title: 'MeetScribe 产品评审会', status: 'paused', createdAt: now, updatedAt: now,
  startedAt: now, metadata,
  speakers: [
    { id: 'speaker-1', name: '发言人甲', color: '#3d7a6b', confirmed: true },
    { id: 'speaker-2', name: '发言人乙', color: '#4d6fa5', confirmed: true },
    { id: 'speaker-3', name: '发言人丙', color: '#9a633c', confirmed: true },
  ],
  segments: [
    { id: 's1', meetingId: 'preview', speakerId: 'speaker-1', source: 'microphone', startMs: 74000, endMs: 81000, rawText: '今天主要确认本地识别、说话人管理和 Word 输出这三项。', displayText: '今天主要确认本地识别、说话人管理和 Word 输出这三项。', revision: 1, status: 'final', createdAt: now, updatedAt: now },
    { id: 's2', meetingId: 'preview', speakerId: 'speaker-2', source: 'microphone', startMs: 89000, endMs: 99000, rawText: '中文和中英混合识别已经完成联调，嗯，句末停顿后会自动定稿。', displayText: '中文和中英混合识别已经完成联调，句末停顿后会自动定稿。', revision: 1, status: 'final', createdAt: now, updatedAt: now },
    { id: 's3', meetingId: 'preview', speakerId: 'speaker-3', source: 'microphone', startMs: 108000, endMs: 119000, rawText: '会议文本只在生成 Word 或主动发送 DSH 草稿时交给大模型。', displayText: '会议文本只在生成 Word 或主动发送 DSH 草稿时交给大模型。', revision: 1, status: 'final', createdAt: now, updatedAt: now },
  ],
  vocabulary: [],
  generatedFiles: [
    { path: 'C:\\Users\\you\\Documents\\MeetScribe\\MeetScribe 产品评审会-v2.docx', version: 2, createdAt: now },
    { path: 'C:\\Users\\you\\Documents\\MeetScribe\\MeetScribe 产品评审会-v1.docx', version: 1, createdAt: '2026-11-20T09:00:00.000Z' },
  ],
}
const weekly: Meeting = {
  ...meeting,
  id: 'weekly', title: '十一月研发周会', createdAt: '2026-11-19T01:00:00.000Z', updatedAt: '2026-11-19T01:00:00.000Z', speakers: [], segments: [],
  generatedFiles: [{ path: 'C:\\Users\\you\\Documents\\MeetScribe\\十一月研发周会-v1.docx', version: 1, createdAt: '2026-11-19T01:00:00.000Z' }],
}

const previewTask: MinutesTask = {
  id: 'preview-task', meetingId: 'preview', meetingTitle: meeting.title, status: 'running', stage: 'model', progress: 45, receivedChars: 768, reasoningChars: 1024,
  createdAt: '2026-11-21T02:29:50.000Z', updatedAt: now,
}
const failedTask: MinutesTask = {
  ...previewTask, id: 'failed-task', status: 'failed', progress: 45, error: '大模型请求失败（AUTH）：合成测试凭据被拒绝',
}
const completedTask: MinutesTask = {
  ...previewTask, id: 'completed-task', status: 'completed', stage: 'completed', progress: 100, receivedChars: 1842, version: 2,
}
function previewTasks(): MinutesTask[] {
  const currentView = (globalThis as unknown as { meetScribeGalleryView?: string }).meetScribeGalleryView
  if (currentView === 'workspace') return [previewTask]
  if (currentView === 'workspace-tasks') return [failedTask, completedTask]
  return []
}

let previewSettings = { ...DEFAULT_SETTINGS, outputDir: 'C:\\Users\\you\\Documents\\MeetScribe' }
const previewMinutesModels = {
  current: { provider: 'synthetic', model: 'minutes-reasoning', reasoningEffort: 'standard' },
  options: [
    {
      provider: 'synthetic', providerName: '合成 Provider', model: 'minutes-fast', name: '快速纪要模型',
      reasoningEfforts: [], defaultReasoningEffort: undefined,
    },
    {
      provider: 'synthetic', providerName: '合成 Provider', model: 'minutes-reasoning', name: '深思纪要模型',
      reasoningEfforts: [
        { id: 'standard', name: '标准' },
        { id: 'high', name: '深入' },
      ],
      defaultReasoningEffort: 'standard',
    },
  ],
  errors: [],
}
let previewTemplates = {
  selectedId: null as string | null,
  templates: [
    { id: 'builtin', name: '正式会议纪要', fileName: '内置模板', createdAt: '', bytes: 0, builtIn: true },
    { id: '123e4567-e89b-42d3-a456-426614174000', name: '合成部门模板', fileName: '合成部门模板.docx', createdAt: now, bytes: 24576, builtIn: false },
  ],
}
const templateCatalog = (): unknown => JSON.parse(JSON.stringify(previewTemplates))

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input)
  if (path.endsWith('/meetings') && init?.method === 'DELETE') return Response.json({ ok: true })
  if (path.endsWith('/minutes-tasks')) return Response.json(previewTasks())
  if (path.includes('/generate')) return Response.json({ ...failedTask, id: 'retry-task', status: 'running', stage: 'preparing', progress: 0, receivedChars: 0, error: undefined, version: undefined }, { status: 202 })
  if (path.includes('/conversation-prompt')) return Response.json({ prompt: '合成会议提示词' })
  if (path.includes('/models/status')) return Response.json({ asr: { ready: true, loaded: true, files: [{ exists: true }] }, vad: { ready: true, loaded: true }, speaker: { ready: true } })
  if (path.endsWith('/minutes-models')) return Response.json(previewMinutesModels)
  if (path.includes('/documents/2/preview')) return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]), { status: 200, headers: { 'content-type': 'application/pdf' } })
  if (path.endsWith('/minutes-templates/default') && init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as { id: string | null }
    previewTemplates = { ...previewTemplates, selectedId: body.id }
    return Response.json(templateCatalog())
  }
  if (path.endsWith('/minutes-templates') && init?.method === 'POST') return Response.json({ id: '123e4567-e89b-42d3-a456-426614174001', name: '新上传合成模板', fileName: '新上传合成模板.docx', createdAt: now, bytes: 1024, builtIn: false }, { status: 201 })
  if (path.endsWith('/minutes-templates')) return Response.json(templateCatalog())
  if (path.includes('/clear')) return Response.json({ ...meeting, id: 'preview-cleared', status: 'paused', speakers: [], segments: [] })
  if (path.includes('/settings') && init?.method === 'PUT') {
    previewSettings = { ...previewSettings, ...JSON.parse(String(init.body)) }
    return Response.json(previewSettings)
  }
  if (path.includes('/settings')) return Response.json(previewSettings)
  return Response.json(path.endsWith('/meetings') ? [meeting, weekly] : meeting)
}
globalThis.EventSource = class { addEventListener(): void {} close(): void {} } as unknown as typeof EventSource

const style = document.createElement('style')
style.textContent = styles + `
body{margin:0;background:#eaf1f8;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}
:root[data-ms-theme="dark"] body{background:#050505}
.gallery-shell{height:100vh;position:relative}
.gallery-shell #root{height:100%}
.gallery-caption{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);font-size:11px;color:#72869b;letter-spacing:.04em}
:root[data-ms-theme="dark"] .gallery-caption{color:#777}
.gallery-settings{max-width:860px;margin:24px auto;background:var(--ms-bg);border:1px solid #d9e4ef;border-radius:12px;overflow:hidden}
`
document.head.appendChild(style)
document.body.innerHTML = '<div class="gallery-shell"><div id="root"></div><div class="gallery-caption">MEETSCRIBE · LOCAL MEETING NOTES</div></div>'
const view = (globalThis as unknown as { meetScribeGalleryView?: string }).meetScribeGalleryView
const workspace = view === 'workspace' || view === 'workspace-settings' || view === 'workspace-tasks'
;(globalThis as unknown as { meetScribeGalleryController?: typeof meetings }).meetScribeGalleryController = meetings
if (view === 'settings' || workspace) document.querySelector('.gallery-caption')?.remove()
void meetings.init().then(() => {
  if (!view || view === 'meeting') meetings.open(false)
  createRoot(document.getElementById('root')!).render(workspace
    ? <MeetScribeWorkspace initialView={view === 'workspace-settings' ? 'settings' : 'documents'} />
    : view === 'settings' ? <div className="gallery-settings"><MeetingSettings /></div> : <MeetingApp />)
})

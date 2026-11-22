import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createAsrRuntime, pcmToSamples } from './host/local-asr-runtime.ts'
import { LOCAL_MODEL_CATALOG, LocalModelManager, type LocalModelKind } from './host/model-manager.ts'
import { MeetingStore } from './host/meeting-store.ts'
import { SettingsStore } from './host/settings.ts'
import { SpeakerIdentifier } from './host/speaker-identifier.ts'
import { isLoopbackRequest, sameOriginRequest } from './host/security.ts'
import { removeFillerWords } from './shared/speaker.ts'
import type { Meeting, MeetScribeSettings, ModelProgress } from './shared/types.ts'
import { startGlobalHotkeyHelper, stopGlobalHotkeyHelper } from './host/native-helper.ts'
import { buildConversationMinutesPrompt, generateWordMinutes } from './host/minutes-service.ts'
import { listMinutesModels } from './host/llm.ts'
import { MinutesTaskManager } from './host/minutes-tasks.ts'
import { selectWindowsDirectory } from './host/folder-picker.ts'
import { createAsrReplacer } from './host/text-replacements.ts'
import { MinutesTemplateStore, MAX_TEMPLATE_BYTES } from './host/minutes-templates.ts'
import { renderMinutesPdf } from './host/document-preview.ts'

export const name = 'meetscribe'
export { MeetingStore } from './host/meeting-store.ts'
export { SettingsStore } from './host/settings.ts'
export { SpeakerIdentifier } from './host/speaker-identifier.ts'
export { SpeakerClusterer, cosineSimilarity, removeFillerWords } from './shared/speaker.ts'
export { createAsrReplacer } from './host/text-replacements.ts'
export { normalizeAsrReplacements, parseAsrReplacements, formatAsrReplacements } from './shared/vocabulary.ts'
export { collectMinutesDocuments, queryMinutesDocuments } from './shared/documents.ts'
export { completeWithDefaultModel, completeWithModel, listMinutesModels } from './host/llm.ts'
export { buildTranscriptForMinutes, buildConversationMinutesPrompt, generateWordMinutes } from './host/minutes-service.ts'
export { MinutesTaskManager } from './host/minutes-tasks.ts'
export { MinutesTemplateStore } from './host/minutes-templates.ts'
export { renderMinutesPdf } from './host/document-preview.ts'
export { createAsrRuntime, pcmToSamples } from './host/local-asr-runtime.ts'
export { LOCAL_MODEL_CATALOG, LocalModelManager, localModelPath, resolveLocalModelPaths } from './host/model-manager.ts'
export { ensureUrlFile, fileSha256 } from './host/download.ts'
export const inject = ['webServer']

const BASE_PATH = '/meetscribe'
const MAX_JSON_BYTES = 1024 * 1024
const MAX_ASR_BYTES = 4 * 1024 * 1024

function respondJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function publicMeeting(meeting: Meeting): Meeting {
  return {
    ...meeting,
    segments: meeting.segments.map(({ embedding: _embedding, ...segment }) => segment),
  }
}

function summarizeMeeting(meeting: Meeting): Record<string, unknown> {
  return {
    id: meeting.id,
    title: meeting.title,
    status: meeting.status,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    speakers: meeting.speakers,
    segmentCount: meeting.segments.length,
    generatedFiles: meeting.generatedFiles,
  }
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    if (size > maxBytes) throw new Error('PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, MAX_JSON_BYTES)
  if (body.length === 0) return {}
  const value = JSON.parse(body.toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON')
  return value as Record<string, unknown>
}

export function apply(ctx: Context & { webServer: { register(route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }): () => void } }): void {
  const dataRoot = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'dsh-meetscribe')
    : join(homedir(), '.local', 'share', 'dsh-meetscribe')
  const settings = new SettingsStore(join(dataRoot, 'settings.json'))
  const store = new MeetingStore(join(dataRoot, 'meetings'))
  const templates = new MinutesTemplateStore(join(dataRoot, 'templates'))
  const modelRoot = join(dataRoot, 'models')
  const modelManager = new LocalModelManager(modelRoot)
  const clients = new Set<ServerResponse>()
  const minutesTasks = new MinutesTaskManager()
  let activeMeetingId: string | null = null
  let preparingModels: Promise<void> | null = null
  let lastProgress: ModelProgress | null = null
  let lastModelError = ''
  const audio = new Map<string, Map<number, Float32Array[]>>()
  const finalizedEpochs = new Set<string>()
  startGlobalHotkeyHelper()

  const send = (event: string, payload: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const client of clients) client.write(frame)
  }

  let replacementRules = settings.get().asrReplacements
  let replaceAsrText = createAsrReplacer(replacementRules)
  const asr = createAsrRuntime({
    modelPaths: modelManager.speechPaths,
    senseITN: () => settings.get().senseITN,
    replaceText: (text) => {
      const rules = settings.get().asrReplacements
      if (rules !== replacementRules) {
        replacementRules = rules
        replaceAsrText = createAsrReplacer(rules)
      }
      return replaceAsrText(text)
    },
    broadcast: (event, payload) => {
      if (event === 'asr-progress') lastProgress = payload as ModelProgress
      if (event === 'asr-ready') {
        lastProgress = null
        lastModelError = ''
      }
      if (event === 'asr-error') {
        const detail = payload as { message?: unknown }
        lastModelError = typeof detail?.message === 'string' ? detail.message : '本地模型加载失败，请检查模型文件后重试'
      }
      send(event, payload)
    },
  })
  const speakerIdentifier = new SpeakerIdentifier(modelManager, (percent) => {
    lastProgress = { file: LOCAL_MODEL_CATALOG.speaker.fileName, percent }
    send('asr-progress', lastProgress)
  })

  const ready = (async () => {
    await settings.init()
    await store.init()
    await templates.init()
    if (!settings.get().minutesTemplateId || !templates.catalog(settings.get().minutesTemplateId).selectedId) {
      if (settings.get().minutesTemplateId) await settings.save({ minutesTemplateId: null })
    }
    if (settings.get().preloadModels) asr.warmup()
  })().catch((error) => {
    lastModelError = String(error)
    console.error('[dsh-meetscribe] Initialization failed:', error)
  })

  store.subscribe((event) => {
    if (event.type === 'meeting-deleted') send('meeting-deleted', { id: event.meetingId })
    else {
      const meeting = store.get(event.meetingId)
      if (meeting) send('meeting', publicMeeting(meeting))
    }
  })

  minutesTasks.subscribe((task) => send('minutes-task', task))

  function modelStatus(): Record<string, unknown> {
    const status = asr.modelStatus()
    const speaker = speakerIdentifier.status()
    return {
      ...status,
      speaker,
      loading: status.loading || lastProgress !== null || speaker.loading,
      error: lastModelError || status.error || speaker.error || undefined,
    }
  }

  async function downloadModels(): Promise<void> {
    if (activeMeetingId) throw new Error('请先暂停记录，再检查并准备模型')
    if (preparingModels) return preparingModels
    preparingModels = (async () => {
      lastModelError = ''
      const reportProgress = (kind: LocalModelKind) => (percent: number): void => {
        lastProgress = { file: LOCAL_MODEL_CATALOG[kind].fileName, percent }
        send('asr-progress', lastProgress)
      }
      const asrPrepared = await modelManager.ensure('asr', reportProgress('asr'))
      const asrReady = await asr.retryModel('asr', asrPrepared.downloaded)
      if (!asrReady) throw new Error(lastModelError || asr.modelStatus().error || '本地识别模型不可用')
      const vadPrepared = await modelManager.ensure('vad', reportProgress('vad'))
      const vadReady = await asr.retryModel('vad', vadPrepared.downloaded)
      if (!vadReady) throw new Error(lastModelError || asr.modelStatus().error || '本地 VAD 模型不可用')
      if (settings.get().speakerEnabled) {
        const ok = await speakerIdentifier.prepare()
        if (!ok) throw new Error(speakerIdentifier.status().error || '说话人模型下载、校验或加载失败')
      }
    })().catch((error: unknown) => {
      lastModelError = error instanceof Error ? error.message : String(error)
      throw error
    }).finally(() => {
      lastProgress = null
      preparingModels = null
      send('models', modelStatus())
    })
    return preparingModels
  }

  function clearAudio(meetingId: string, epoch?: number): void {
    if (epoch === undefined) {
      audio.delete(meetingId)
      for (const key of finalizedEpochs) if (key.startsWith(`${meetingId}:`)) finalizedEpochs.delete(key)
    } else {
      audio.get(meetingId)?.delete(epoch)
      finalizedEpochs.delete(`${meetingId}:${epoch}`)
    }
  }

  function collectAudio(meetingId: string, epoch: number, offset: number, samples: Float32Array): void {
    if (samples.length === 0) return
    let epochs = audio.get(meetingId)
    if (!epochs) {
      epochs = new Map()
      audio.set(meetingId, epochs)
    }
    const chunks = epochs.get(epoch) ?? []
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (offset > total) throw new Error('AUDIO_OFFSET_GAP')
    const skip = Math.max(0, total - offset)
    if (skip < samples.length) chunks.push(samples.slice(skip))
    epochs.set(epoch, chunks)
  }

  function takeAudio(meetingId: string, epoch: number): Float32Array {
    const chunks = audio.get(meetingId)?.get(epoch) ?? []
    audio.get(meetingId)?.delete(epoch)
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  async function handleAsr(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const meetingId = url.searchParams.get('sessionId') || ''
    if (!activeMeetingId || meetingId !== activeMeetingId || !store.get(meetingId)) {
      respondJson(res, 403, { error: '当前会议已停止或不存在' })
      return
    }
    const epoch = Math.max(0, Math.floor(Number(url.searchParams.get('epoch') || 0)))
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset') || 0)))
    const final = url.searchParams.get('final') === '1'
    if (url.searchParams.get('reset') === '1') {
      asr.reset(meetingId)
      clearAudio(meetingId)
      respondJson(res, 200, { ok: true })
      return
    }
    const body = await readBody(req, MAX_ASR_BYTES)
    const samples = body.length === 0 && final ? new Float32Array(0) : pcmToSamples(body)
    if (!samples) {
      respondJson(res, 400, { error: '无效音频数据' })
      return
    }
    if (url.searchParams.get('vadOnly') === '1') {
      respondJson(res, 200, await asr.detect(meetingId, samples))
      return
    }
    collectAudio(meetingId, epoch, offset, samples)
    const epochKey = `${meetingId}:${epoch}`
    if (finalizedEpochs.has(epochKey)) {
      respondJson(res, 409, { error: '该音频段已经完成定稿' })
      return
    }
    if (final) finalizedEpochs.add(epochKey)
    let result
    try {
      result = await asr.feed(meetingId, samples, final, offset, epoch)
    } catch (error) {
      finalizedEpochs.delete(epochKey)
      throw error
    }
    if (!final || result.loading) {
      if (result.loading) finalizedEpochs.delete(epochKey)
      respondJson(res, result.loading ? 202 : 200, result)
      return
    }
    if (final && !store.get(meetingId)) {
      clearAudio(meetingId, epoch)
      respondJson(res, 409, { error: '会议已清空或删除，已丢弃旧识别结果' })
      return
    }
    if (!result.text.trim()) {
      takeAudio(meetingId, epoch)
      respondJson(res, 200, result)
      return
    }
    const meeting = store.get(meetingId)!
    const segmentAudio = takeAudio(meetingId, epoch)
    const current = settings.get()
    let speaker = current.speakerEnabled
      ? await speakerIdentifier.identify(meetingId, segmentAudio, current.speakerThreshold, current.maxSpeakers).catch((error) => {
          console.warn('[dsh-meetscribe] Speaker identification failed:', error)
          speakerIdentifier.lastError = error instanceof Error ? error.message : String(error)
          return null
        })
      : null
    const fallbackSpeakerId = meeting.speakers.at(-1)?.id ?? 'speaker-1'
    const speakerId = speaker?.speakerId ?? fallbackSpeakerId
    if (!speaker && meeting.speakers.length === 0) store.ensureSpeaker(meeting, speakerId, '我')
    const endMs = meeting.startedAt ? Math.max(0, Date.now() - Date.parse(meeting.startedAt)) : 0
    const segment = await store.addSegment(meetingId, {
      speakerId,
      source: url.searchParams.get('source') === 'system' || url.searchParams.get('source') === 'mixed' ? 'system' : 'microphone',
      startMs: Math.max(0, endMs - Math.round(segmentAudio.length / 16)),
      endMs,
      rawText: result.rawText ?? result.text,
      displayText: current.fillerRemoval ? removeFillerWords(result.text) : result.text,
      speakerConfidence: speaker?.confidence,
      embedding: speaker?.embedding,
    })
    respondJson(res, 200, { ...result, segmentId: segment.id, speakerId })
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackRequest(req)) {
      respondJson(res, 403, { error: '仅允许本机访问' })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOriginRequest(req)) {
      respondJson(res, 403, { error: '请求来源无效' })
      return
    }
    const url = new URL(req.url ?? BASE_PATH, 'http://localhost')
    const path = url.pathname.slice(BASE_PATH.length) || '/'
    await ready

    if (path === '/' || path === '/health') {
      respondJson(res, 200, { ok: true, name: 'dsh-meetscribe', version: '0.1.0', activeMeetingId })
      return
    }
    if (path === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 1500\n\n')
      clients.add(res)
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
      req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
      return
    }
    if (path === '/asr' && req.method === 'POST') {
      await handleAsr(req, res, url)
      return
    }
    if (path === '/settings/select-directory' && req.method === 'POST') {
      respondJson(res, 200, { path: await selectWindowsDirectory() })
      return
    }
    if (path === '/settings') {
      if (req.method === 'GET') {
        respondJson(res, 200, settings.get())
        return
      }
      if (req.method === 'PUT') {
        const next = await settings.save(await readJson(req))
        asr.markStale()
        send('settings', next)
        respondJson(res, 200, next)
        return
      }
    }
    if (path === '/models/status' && req.method === 'GET') {
      respondJson(res, 200, modelStatus())
      return
    }
    if (path === '/models/download' && req.method === 'POST') {
      await downloadModels()
      respondJson(res, 200, modelStatus())
      return
    }
    if (path === '/hotkey/status' && req.method === 'GET') {
      respondJson(res, 200, startGlobalHotkeyHelper())
      return
    }
    if (path === '/minutes-tasks' && req.method === 'GET') {
      respondJson(res, 200, minutesTasks.list())
      return
    }
    if (path === '/minutes-models' && req.method === 'GET') {
      respondJson(res, 200, await listMinutesModels(ctx))
      return
    }
    if (path === '/minutes-templates' && req.method === 'GET') {
      respondJson(res, 200, templates.catalog(settings.get().minutesTemplateId))
      return
    }
    if (path === '/minutes-templates' && req.method === 'POST') {
      const fileName = url.searchParams.get('fileName') ?? ''
      const uploaded = await templates.upload(fileName, await readBody(req, MAX_TEMPLATE_BYTES))
      respondJson(res, 201, uploaded)
      return
    }
    if (path === '/minutes-templates/default' && req.method === 'PUT') {
      const body = await readJson(req)
      const id = body.id === null ? null : String(body.id ?? '')
      if (id !== null) await templates.snapshot(id)
      const next = await settings.save({ minutesTemplateId: id })
      send('settings', next)
      respondJson(res, 200, templates.catalog(next.minutesTemplateId))
      return
    }
    const templateMatch = path.match(/^\/minutes-templates\/([a-f0-9-]{36})$/)
    if (templateMatch && req.method === 'DELETE') {
      const id = templateMatch[1]
      await templates.remove(id)
      if (settings.get().minutesTemplateId === id) {
        const next = await settings.save({ minutesTemplateId: null })
        send('settings', next)
      }
      respondJson(res, 200, templates.catalog(settings.get().minutesTemplateId))
      return
    }
    if (path === '/meetings' && req.method === 'GET') {
      respondJson(res, 200, store.list().map(summarizeMeeting))
      return
    }
    if (path === '/meetings' && req.method === 'DELETE') {
      if (minutesTasks.hasRunning()) {
        respondJson(res, 409, { error: '有会议纪要正在生成，请完成后再清空历史' })
        return
      }
      const all = store.list()
      for (const meeting of all) {
        asr.reset(meeting.id)
        clearAudio(meeting.id)
        speakerIdentifier.reset(meeting.id)
      }
      activeMeetingId = null
      await store.deleteAll()
      minutesTasks.remove()
      send('minutes-tasks-removed', {})
      respondJson(res, 200, { ok: true })
      return
    }
    if (path === '/meetings' && req.method === 'POST') {
      const body = await readJson(req)
      const meeting = await store.create(typeof body.title === 'string' ? body.title : undefined)
      respondJson(res, 201, publicMeeting(meeting))
      return
    }

    const match = path.match(/^\/meetings\/([^/]+)(?:\/(.*))?$/)
    if (!match) {
      respondJson(res, 404, { error: '未找到请求的功能' })
      return
    }
    const meetingId = decodeURIComponent(match[1])
    const action = match[2] || ''
    const meeting = store.get(meetingId)
    if (!meeting) {
      respondJson(res, 404, { error: '会议不存在' })
      return
    }
    if (!action && req.method === 'GET') {
      respondJson(res, 200, publicMeeting(meeting))
      return
    }
    if (!action && req.method === 'PATCH') {
      const updated = await store.update(meetingId, await readJson(req))
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (!action && req.method === 'DELETE') {
      if (minutesTasks.active(meetingId)) {
        respondJson(res, 409, { error: '该会议的纪要正在生成，请完成后再删除' })
        return
      }
      if (activeMeetingId === meetingId) {
        asr.reset(meetingId)
        clearAudio(meetingId)
        activeMeetingId = null
      }
      await store.delete(meetingId)
      minutesTasks.remove(meetingId)
      send('minutes-tasks-removed', { meetingId })
      respondJson(res, 200, { ok: true })
      return
    }
    if (action === 'clear' && req.method === 'POST') {
      if (minutesTasks.active(meetingId)) {
        respondJson(res, 409, { error: '该会议的纪要正在生成，请完成后再清空逐字稿' })
        return
      }
      asr.reset(meetingId)
      clearAudio(meetingId)
      speakerIdentifier.reset(meetingId)
      if (activeMeetingId === meetingId) activeMeetingId = null
      const cleared = await store.clearTranscript(meetingId)
      minutesTasks.remove(meetingId)
      send('minutes-tasks-removed', { meetingId })
      respondJson(res, 200, publicMeeting(cleared))
      return
    }
    if (action === 'start' && req.method === 'POST') {
      if (preparingModels) {
        respondJson(res, 409, { error: '正在准备模型，请完成后再开始记录' })
        return
      }
      activeMeetingId = meetingId
      asr.reset(meetingId)
      clearAudio(meetingId)
      speakerIdentifier.reset(meetingId)
      const startedAt = meeting.startedAt ?? new Date().toISOString()
      const updated = await store.update(meetingId, { status: 'recording', startedAt, endedAt: '' })
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (action === 'pause' && req.method === 'POST') {
      asr.reset(meetingId)
      clearAudio(meetingId)
      if (activeMeetingId === meetingId) activeMeetingId = null
      const updated = await store.update(meetingId, { status: 'paused' })
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (action === 'resume' && req.method === 'POST') {
      if (preparingModels) {
        respondJson(res, 409, { error: '正在准备模型，请完成后再继续记录' })
        return
      }
      activeMeetingId = meetingId
      const updated = await store.update(meetingId, { status: 'recording' })
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (action === 'finish' && req.method === 'POST') {
      asr.reset(meetingId)
      clearAudio(meetingId)
      if (activeMeetingId === meetingId) activeMeetingId = null
      const updated = await store.update(meetingId, { status: 'completed', endedAt: new Date().toISOString() })
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (action === 'segments' && req.method === 'POST') {
      const body = await readJson(req)
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!text) {
        respondJson(res, 400, { error: '记录内容不能为空' })
        return
      }
      const speakerId = typeof body.speakerId === 'string' ? body.speakerId : meeting.speakers[0]?.id ?? 'speaker-1'
      if (meeting.speakers.length === 0) store.ensureSpeaker(meeting, speakerId, '我')
      const endMs = meeting.startedAt ? Math.max(0, Date.now() - Date.parse(meeting.startedAt)) : 0
      const segment = await store.addSegment(meetingId, {
        speakerId,
        source: 'manual',
        startMs: endMs,
        endMs,
        rawText: text,
        displayText: text,
      })
      respondJson(res, 201, segment)
      return
    }
    const speakerMatch = action.match(/^speakers\/([^/]+)$/)
    if (speakerMatch && req.method === 'PATCH') {
      const body = await readJson(req)
      const updated = await store.renameSpeaker(meetingId, decodeURIComponent(speakerMatch[1]), String(body.name ?? ''))
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (action === 'speakers/merge' && req.method === 'POST') {
      const body = await readJson(req)
      const updated = await store.mergeSpeakers(meetingId, String(body.sourceId ?? ''), String(body.targetId ?? ''))
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    const reassignMatch = action.match(/^segments\/([^/]+)\/speaker$/)
    if (reassignMatch && req.method === 'POST') {
      const body = await readJson(req)
      const updated = await store.reassignSegment(meetingId, decodeURIComponent(reassignMatch[1]), String(body.speakerId ?? ''))
      respondJson(res, 200, publicMeeting(updated))
      return
    }
    if (action === 'conversation-prompt' && req.method === 'POST') {
      if (meeting.segments.length === 0) {
        respondJson(res, 400, { error: '当前会议还没有逐字稿，无法在 DSH 对话中整理' })
        return
      }
      respondJson(res, 200, { prompt: buildConversationMinutesPrompt(meeting) })
      return
    }
    if (action === 'generate' && req.method === 'POST') {
      if (meeting.segments.length === 0) {
        respondJson(res, 400, { error: '当前会议还没有逐字稿，无法生成纪要' })
        return
      }
      const task = minutesTasks.start(meeting, (progress) => generateWordMinutes(ctx, store, settings.get(), meetingId, progress, templates))
      respondJson(res, 202, task)
      return
    }
    const previewMatch = action.match(/^documents\/(\d+)\/preview$/)
    if (previewMatch && req.method === 'GET') {
      const version = Number(previewMatch[1])
      const file = meeting.generatedFiles.find((item) => item.version === version)
      if (!file) {
        respondJson(res, 404, { error: '文件不存在' })
        return
      }
      const preview = await renderMinutesPdf(ctx, file)
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(file.path).replace(/\.docx$/i, '.pdf'))}`,
        'content-length': preview.pdf.byteLength,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(Buffer.from(preview.pdf))
      return
    }
    respondJson(res, 405, { error: '不支持的操作' })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void route(req, res).catch((error) => {
        console.error('[dsh-meetscribe] Request failed:', error)
        if (res.headersSent) {
          res.end()
          return
        }
        const status = String(error?.message).includes('PAYLOAD_TOO_LARGE') ? 413 : 500
        respondJson(res, status, { error: error instanceof Error ? error.message : '操作失败，请重试' })
      })
    },
  }))

  ctx.effect(() => () => {
    asr.dispose()
    stopGlobalHotkeyHelper()
    for (const client of clients) client.end()
    clients.clear()
  })
}

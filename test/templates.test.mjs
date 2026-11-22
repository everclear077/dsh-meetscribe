import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import { strFromU8, unzipSync } from 'fflate'
import {
  MeetingStore,
  MinutesTemplateStore,
  SettingsStore,
  generateWordMinutes,
  renderMinutesPdf,
} from '../lib/index.js'

async function template() {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('自定义 {{MEETING_NAME}}'),
    new Paragraph('{{MEETSCRIBE_BODY}}'),
  ] }] }))
}

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'meetscribe-templates-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('template store uploads local DOCX, selects a default and falls back after deletion', async (t) => {
  const root = await directory(t)
  const store = new MinutesTemplateStore(join(root, 'templates'))
  await store.init()
  assert.equal(store.catalog(null).templates[0].builtIn, true)
  const uploaded = await store.upload('合成正式模板.docx', await template())
  assert.equal(uploaded.builtIn, false)
  assert.equal(store.catalog(uploaded.id).selectedId, uploaded.id)
  const snapshot = await store.snapshot(uploaded.id)
  assert.ok(snapshot.data.length > 100)
  await store.remove(uploaded.id)
  assert.equal(store.catalog(null).selectedId, null)
  assert.equal(store.catalog(null).templates.length, 1)
  assert.equal(snapshot.data.subarray(0, 2).toString(), 'PK', '删除后，任务启动时的字节快照仍可使用')
  await assert.rejects(store.snapshot(uploaded.id), /已被删除/)
})

test('Word generation reads the selected template before the model request and uses its immutable snapshot', async (t) => {
  const root = await directory(t)
  const settingsStore = new SettingsStore(join(root, 'settings.json'))
  await settingsStore.init()
  const settings = await settingsStore.save({ outputDir: join(root, 'output'), minutesTemplateId: '123e4567-e89b-42d3-a456-426614174000' })
  const meetings = new MeetingStore(join(root, 'meetings'))
  await meetings.init()
  const meeting = await meetings.create('合成项目会议')
  await meetings.addSegment(meeting.id, { speakerId: 'speaker-1', source: 'manual', startMs: 0, endMs: 1000, rawText: '维持灰度。', displayText: '维持灰度。' })
  const calls = []
  const response = JSON.stringify({
    metadata: { name: '模型标题', format: '线上' }, agenda: ['发布范围'], discussion: [],
    decisions: [{ content: '维持现有灰度范围。' }], actionItems: [], openIssues: [], nextMeeting: null,
  })
  const ctx = { get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'synthetic', model: 'minutes-test' }) }
    if (name !== 'llm') return undefined
    return { stream() { return (async function * () {
      calls.push('model')
      yield { type: 'text-delta', index: 0, text: response }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })() } }
  } }
  const templates = { async snapshot(id) {
    assert.equal(id, settings.minutesTemplateId)
    calls.push('template')
    return { id, name: '合成模板', data: await template() }
  } }
  const updated = await generateWordMinutes(ctx, meetings, settings, meeting.id, undefined, templates)
  assert.deepEqual(calls, ['template', 'model'])
  const generated = updated.generatedFiles.at(-1)
  const xml = strFromU8(unzipSync(await readFile(generated.path))['word/document.xml'])
  assert.ok(xml.includes('自定义 合成项目会议'))
  assert.ok(xml.includes('维持现有灰度范围'))
  assert.ok(!xml.includes('MEETSCRIBE_BODY'))
})

test('DSH Office preview reads an authorized generated file and returns PDF bytes without native open', async (t) => {
  const root = await directory(t)
  const path = join(root, 'minutes.docx')
  await writeFile(path, 'synthetic docx bytes')
  const calls = []
  const ctx = { get(name) {
    assert.equal(name, 'officeKit')
    return { async convert(request) {
      calls.push(request)
      const source = await request.source.read(new AbortController().signal, 1024)
      assert.equal(new TextDecoder().decode(source.bytes), 'synthetic docx bytes')
      return { pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]), missingFonts: [] }
    } }
  } }
  const result = await renderMinutesPdf(ctx, { path, version: 2, createdAt: new Date().toISOString() })
  assert.equal(new TextDecoder().decode(result.pdf), '%PDF')
  assert.equal(calls[0].extension, 'docx')
  assert.equal(calls[0].source.bytes, Buffer.byteLength('synthetic docx bytes'))
})

test('DSH Office preview rejects unavailable conversion and files changed during reading', async (t) => {
  const root = await directory(t)
  const path = join(root, 'minutes.docx')
  await writeFile(path, 'synthetic docx bytes')
  const file = { path, version: 2, createdAt: new Date().toISOString() }
  const unavailable = { get: () => undefined }
  await assert.rejects(renderMinutesPdf(unavailable, file), /没有可用的 Office 预览组件/)
  const changed = { get: () => ({ async convert(request) {
    await writeFile(path, 'changed while reading')
    return request.source.read(new AbortController().signal, 1024)
  } }) }
  await assert.rejects(renderMinutesPdf(changed, file), /预览期间文件发生变化/)
})

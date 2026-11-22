import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MeetingStore, SettingsStore, SpeakerClusterer, cosineSimilarity, removeFillerWords, createAsrReplacer, parseAsrReplacements, formatAsrReplacements, buildTranscriptForMinutes, collectMinutesDocuments, queryMinutesDocuments } from '../lib/index.js'

test('speaker clusters update centroids and respect maximum speakers', () => {
  const cluster = new SpeakerClusterer(0.7, 2)
  let sequence = 0
  const id = () => `speaker-${++sequence}`
  assert.equal(cluster.add(new Float32Array([1, 0]), id).speakerId, 'speaker-1')
  assert.equal(cluster.add(new Float32Array([0.99, 0.01]), id).speakerId, 'speaker-1')
  assert.equal(cluster.add(new Float32Array([0, 1]), id).speakerId, 'speaker-2')
  assert.equal(cluster.add(new Float32Array([-1, 0]), id).isNew, false)
  assert.equal(cluster.size, 2)
  assert.ok(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0])) > 0.99)
})

test('short same-speaker drift remains merged at an explicitly lower threshold', () => {
  // Real ERes2NetV2 diagnostic: a 0.8 s clip from the same voice scored 0.577.
  const sameVoice = new Float32Array([0.577, Math.sqrt(1 - 0.577 ** 2)])
  const differentVoice = new Float32Array([0.331, Math.sqrt(1 - 0.331 ** 2)])
  const cluster = new SpeakerClusterer(0.56)
  let sequence = 0
  const id = () => `speaker-${++sequence}`
  assert.equal(cluster.add(new Float32Array([1, 0]), id).speakerId, 'speaker-1')
  const same = cluster.add(sameVoice, id)
  assert.equal(same.speakerId, 'speaker-1')
  assert.equal(same.isNew, false)
  assert.ok(Math.abs(same.confidence - 0.577) < 1e-6)
  const distinct = new SpeakerClusterer()
  let distinctSequence = 0
  const distinctId = () => `speaker-${++distinctSequence}`
  distinct.add(new Float32Array([1, 0]), distinctId)
  assert.equal(distinct.add(differentVoice, distinctId).speakerId, 'speaker-2')

  const previous = new SpeakerClusterer(0.62, 8)
  let previousSequence = 0
  const previousId = () => `speaker-${++previousSequence}`
  previous.add(new Float32Array([1, 0]), previousId)
  assert.equal(previous.add(sameVoice, previousId).speakerId, 'speaker-2')
})

test('default threshold separates the reproduced two-voice boundary sample', () => {
  // Synthetic Huihui/Zira regression: the first different-voice clip scored 0.6339
  // against the established voice and was merged by every threshold through 0.60.
  const differentVoice = new Float32Array([0.6339, Math.sqrt(1 - 0.6339 ** 2)])
  const cluster = new SpeakerClusterer()
  let sequence = 0
  const id = () => `speaker-${++sequence}`
  cluster.add(new Float32Array([1, 0]), id)
  const result = cluster.add(differentVoice, id)
  assert.equal(result.speakerId, 'speaker-2')
  assert.equal(result.isNew, true)
})

test('borderline matches cannot contaminate a centroid and merge later voices', () => {
  const vector = (similarity) => new Float32Array([similarity, Math.sqrt(1 - similarity ** 2)])
  const cluster = new SpeakerClusterer(0.62, 8)
  let sequence = 0
  const id = () => `speaker-${++sequence}`
  cluster.add(vector(1), id)
  // This first boundary sample is still labeled as the existing speaker, but it
  // must not shift the centroid. The next different-voice sample scored 0.5671.
  assert.equal(cluster.add(vector(0.6339), id).speakerId, 'speaker-1')
  assert.equal(cluster.add(vector(0.5671), id).speakerId, 'speaker-2')
  assert.equal(cluster.size, 2)
})

test('meeting clusters apply changed settings without losing voice history', () => {
  const cluster = new SpeakerClusterer(0.5, 2)
  let sequence = 0
  const id = () => `speaker-${++sequence}`
  cluster.add(new Float32Array([1, 0]), id)
  cluster.configure(0.65, 4)
  const result = cluster.add(new Float32Array([0.6, 0.8]), id)
  assert.equal(result.speakerId, 'speaker-2')
  assert.equal(result.isNew, true)
})

test('minutes document library collects versions, searches and sorts deterministically', () => {
  const documents = collectMinutesDocuments([
    { id: 'review', title: '产品评审', generatedFiles: [
      { path: 'D:\\minutes\\Alpha 10.docx', version: 10, createdAt: '2026-11-20T00:00:00.000Z' },
      { path: 'D:\\minutes\\Alpha 2.docx', version: 2, createdAt: '2026-11-21T00:00:00.000Z' },
    ] },
    { id: 'weekly', title: '研发周会', generatedFiles: [
      { path: 'C:/minutes/Zeta.docx', version: 1, createdAt: '2026-11-19T00:00:00.000Z' },
    ] },
  ])
  assert.deepEqual(documents.map((document) => document.fileName), ['Alpha 10.docx', 'Alpha 2.docx', 'Zeta.docx'])
  assert.deepEqual(queryMinutesDocuments(documents, '', 'created-desc').map((document) => document.key), ['review:2', 'review:10', 'weekly:1'])
  assert.deepEqual(queryMinutesDocuments(documents, '', 'created-asc').map((document) => document.key), ['weekly:1', 'review:10', 'review:2'])
  assert.deepEqual(queryMinutesDocuments(documents, '', 'name-asc').map((document) => document.fileName), ['Alpha 2.docx', 'Alpha 10.docx', 'Zeta.docx'])
  assert.deepEqual(queryMinutesDocuments(documents, '', 'name-desc').map((document) => document.fileName), ['Zeta.docx', 'Alpha 10.docx', 'Alpha 2.docx'])
  assert.deepEqual(queryMinutesDocuments(documents, ' 研发 ', 'created-desc').map((document) => document.key), ['weekly:1'])
  assert.deepEqual(queryMinutesDocuments(documents, 'alpha', 'created-desc').length, 2)
  assert.deepEqual(queryMinutesDocuments(documents, '不存在', 'created-desc'), [])
})

test('filler removal preserves meaningful text', () => {
  assert.equal(removeFillerWords('嗯，我们周五发布。'), '我们周五发布。')
  assert.equal(removeFillerWords('这个，方案需要评审'), '方案需要评审')
})

test('ASR terminology replacements handle mixed text without changing unrelated words', () => {
  const replace = createAsrReplacer([
    { to: 'OKR', from: ['欧凯尔', '欧 k 尔'] },
    { to: 'API', from: ['阿皮', 'a p i'] },
    { to: '向量数据库', from: ['项链数据库'] },
    { to: '新浪', from: ['sina'] },
  ])
  assert.equal(replace('欧 K 尔和阿皮，A P I 与项链数据库。'), 'OKR和API，API 与向量数据库。')
  assert.equal(replace('sina Sinatra SINA'), '新浪 Sinatra 新浪')
  assert.equal(replace('没有配置的生造词保持原样'), '没有配置的生造词保持原样')
})

test('terminology editor parses, formats and rejects ambiguous rules', () => {
  const text = 'OKR = 欧凯尔 | 欧 k 尔\nAPI ＝ 阿皮｜A P I'
  const rules = parseAsrReplacements(text)
  assert.deepEqual(rules[0], { to: 'OKR', from: ['欧凯尔', '欧 k 尔'] })
  assert.equal(formatAsrReplacements(rules), 'OKR = 欧凯尔 | 欧 k 尔\nAPI = 阿皮 | A P I')
  assert.throws(() => parseAsrReplacements('没有分隔符'), /缺少/)
  assert.throws(() => parseAsrReplacements('OKR = 欧凯尔\n目标 = 欧凯尔'), /重复/)
  assert.throws(() => parseAsrReplacements('只有标准词 ='), /至少一个/)
  assert.throws(() => parseAsrReplacements(`${'长'.repeat(101)} = 误识别`), /100 字符/)
  assert.throws(() => parseAsrReplacements(`标准词 = ${Array.from({ length: 21 }, (_, index) => `误识别${index}`).join('|')}`), /20 个/)
  assert.throws(() => parseAsrReplacements(Array.from({ length: 101 }, (_, index) => `术语${index} = 误识别${index}`).join('\n')), /100 条/)
})

test('meeting store persists, edits speakers and reloads safely', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new MeetingStore(directory)
  await store.init()
  const meeting = await store.create('评审会')
  store.ensureSpeaker(meeting, 'speaker-1', '发言人 1')
  const segment = await store.addSegment(meeting.id, { speakerId: 'speaker-1', source: 'microphone', startMs: 0, endMs: 1000, rawText: '原始文本', displayText: '清理文本' })
  assert.equal(buildTranscriptForMinutes(store.get(meeting.id))[0].text, '清理文本')
  assert.equal(store.get(meeting.id).segments[0].rawText, '原始文本')
  await store.renameSpeaker(meeting.id, 'speaker-1', '李敏')
  assert.equal(store.get(meeting.id).vocabulary.includes('李敏'), true)
  await store.update(meeting.id, { status: 'recording', startedAt: new Date().toISOString(), endedAt: '' })
  assert.equal(store.get(meeting.id).endedAt, undefined)
  await store.reassignSegment(meeting.id, segment.id, 'speaker-2')
  assert.equal(store.get(meeting.id).segments[0].manuallyAssigned, true)
  await store.mergeSpeakers(meeting.id, 'speaker-2', 'speaker-1')
  assert.equal(store.get(meeting.id).segments[0].speakerId, 'speaker-1')
  assert.equal(store.get(meeting.id).segments[0].revision, 3)
  const persisted = JSON.parse(await readFile(join(directory, `${meeting.id}.json`), 'utf8'))
  assert.equal(persisted.title, '评审会')
  const reloaded = new MeetingStore(directory)
  await reloaded.init()
  assert.equal(reloaded.get(meeting.id).status, 'idle')
  assert.equal(reloaded.get(meeting.id).segments[0].rawText, '原始文本')
})

test('clear replaces transcript data but preserves meeting details and Word versions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-clear-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new MeetingStore(directory)
  await store.init()
  const meeting = await store.create('清空测试')
  await store.update(meeting.id, { metadata: { topic: '保留会议主题', attendees: ['发言人甲'] } })
  store.ensureSpeaker(meeting, 'speaker-1', '发言人甲')
  await store.addSegment(meeting.id, { speakerId: 'speaker-1', source: 'microphone', startMs: 0, endMs: 1000, rawText: '需要清空的文本', displayText: '需要清空的文本' })
  await store.addGeneratedFile(meeting.id, 'C:\\tmp\\minutes.docx')
  const cleared = await store.clearTranscript(meeting.id)
  assert.notEqual(cleared.id, meeting.id)
  assert.equal(cleared.title, '清空测试')
  assert.equal(cleared.metadata.topic, '保留会议主题')
  assert.deepEqual(cleared.metadata.attendees, ['发言人甲'])
  assert.equal(cleared.generatedFiles.length, 1)
  assert.equal(cleared.status, 'idle')
  assert.equal(cleared.segments.length, 0)
  assert.equal(cleared.speakers.length, 0)
  assert.equal(store.get(meeting.id), undefined)
  await assert.rejects(readFile(join(directory, `${meeting.id}.json`), 'utf8'))
  const reloaded = new MeetingStore(directory)
  await reloaded.init()
  assert.equal(reloaded.list().length, 1)
  assert.equal(reloaded.get(cleared.id).segments.length, 0)
})

test('clear history removes every meeting and its persisted JSON', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-clear-history-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new MeetingStore(directory)
  await store.init()
  const first = await store.create('历史会议一')
  const second = await store.create('历史会议二')
  await store.update(first.id, { status: 'paused' })
  await store.deleteAll()
  assert.deepEqual(store.list(), [])
  await assert.rejects(readFile(join(directory, `${first.id}.json`), 'utf8'))
  await assert.rejects(readFile(join(directory, `${second.id}.json`), 'utf8'))
  const reloaded = new MeetingStore(directory)
  await reloaded.init()
  assert.deepEqual(reloaded.list(), [])
})

test('settings are validated and persisted', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new SettingsStore(join(directory, 'settings.json'))
  await store.init()
  assert.equal(store.get().silenceMs, 800)
  assert.equal(store.get().speakerThreshold, 0.65)
  assert.deepEqual(store.get().asrReplacements, [])
  assert.equal(store.get().minutesModel, null)
  assert.equal(store.get().minutesIdleTimeoutMs, 300000)
  const value = await store.save({ speakerThreshold: 99, maxSpeakers: -2, silenceMs: 20, minutesIdleTimeoutMs: 99999999, minutesModel: { provider: ' synthetic ', model: ' minutes-model ', reasoningEffort: 'deep', apiKey: 'must-not-persist' }, asrReplacements: [{ to: 'OKR', from: ['欧凯尔', '欧 k 尔'] }] })
  assert.ok(value.speakerThreshold <= 0.9)
  assert.ok(value.maxSpeakers >= 1)
  assert.ok(value.silenceMs >= 300)
  assert.equal(value.minutesIdleTimeoutMs, 1800000)
  assert.deepEqual(value.minutesModel, { provider: 'synthetic', model: 'minutes-model', reasoningEffort: 'deep' })
  assert.equal('apiKey' in value.minutesModel, false)
  const reloaded = new SettingsStore(join(directory, 'settings.json'))
  await reloaded.init()
  assert.equal(reloaded.get().silenceMs, value.silenceMs)
  assert.deepEqual(reloaded.get().minutesModel, value.minutesModel)
  assert.equal(reloaded.get().minutesIdleTimeoutMs, 1800000)
  assert.deepEqual(reloaded.get().asrReplacements, [{ to: 'OKR', from: ['欧凯尔', '欧 k 尔'] }])
  const reset = await reloaded.save({ minutesModel: null, minutesIdleTimeoutMs: 0 })
  assert.equal(reset.minutesModel, null)
  assert.equal(reset.minutesIdleTimeoutMs, 60000)
})

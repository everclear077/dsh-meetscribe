import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MeetingStore, SettingsStore, SpeakerClusterer, cosineSimilarity, removeFillerWords } from '../lib/index.js'

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

test('filler removal preserves meaningful text', () => {
  assert.equal(removeFillerWords('嗯，我们周五发布。'), '我们周五发布。')
  assert.equal(removeFillerWords('这个，方案需要评审'), '方案需要评审')
})

test('meeting store persists, edits speakers and reloads safely', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new MeetingStore(directory)
  await store.init()
  const meeting = await store.create('评审会')
  store.ensureSpeaker(meeting, 'speaker-1', '发言人 1')
  const segment = await store.addSegment(meeting.id, { speakerId: 'speaker-1', source: 'microphone', startMs: 0, endMs: 1000, rawText: '原始文本', displayText: '清理文本' })
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

test('settings are validated and persisted', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meetscribe-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new SettingsStore(join(directory, 'settings.json'))
  await store.init()
  const value = await store.save({ speakerThreshold: 99, maxSpeakers: -2, silenceMs: 20 })
  assert.ok(value.speakerThreshold <= 0.9)
  assert.ok(value.maxSpeakers >= 1)
  assert.ok(value.silenceMs >= 300)
  const reloaded = new SettingsStore(join(directory, 'settings.json'))
  await reloaded.init()
  assert.equal(reloaded.get().silenceMs, value.silenceMs)
})

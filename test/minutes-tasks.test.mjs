import test from 'node:test'
import assert from 'node:assert/strict'
import { MinutesTaskManager } from '../lib/index.js'

const meeting = { id: 'meeting-1', title: '合成评审会' }
const generated = { generatedFiles: [{ version: 3, path: 'synthetic.docx', createdAt: '2026-11-22T00:00:00.000Z' }] }
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('minutes tasks are Host-owned, deduplicated and expose every generation stage', async () => {
  const manager = new MinutesTaskManager()
  const pending = deferred()
  const events = []
  manager.subscribe((task) => events.push(task))
  const task = manager.start(meeting, async (report) => {
    report({ stage: 'preparing', progress: 10 })
    report({ stage: 'model', progress: 25, receivedChars: 0, reasoningChars: 256 })
    report({ stage: 'model', progress: 45, receivedChars: 800, reasoningChars: 512 })
    report({ stage: 'parsing', progress: 80, receivedChars: 800 })
    report({ stage: 'document', progress: 90, receivedChars: 800 })
    return pending.promise
  })
  const duplicate = manager.start(meeting, async () => generated)
  assert.equal(duplicate.id, task.id)
  assert.equal(manager.active(meeting.id).id, task.id)
  const completed = new Promise((resolve) => manager.subscribe((value) => {
    if (value.id === task.id && value.status === 'completed') resolve(value)
  }))
  pending.resolve(generated)
  const result = await completed
  assert.equal(result.stage, 'completed')
  assert.equal(result.progress, 100)
  assert.equal(result.version, 3)
  assert.equal(result.reasoningChars, 512)
  assert.equal(manager.active(meeting.id), undefined)
  assert.deepEqual(events.filter((value) => value.id === task.id).map((value) => value.stage), [
    'preparing', 'preparing', 'model', 'model', 'parsing', 'document', 'completed',
  ])
  manager.remove(meeting.id)
  assert.equal(manager.list().length, 0)
})

test('minutes task failures retain their stage and actionable error', async () => {
  const manager = new MinutesTaskManager()
  const failed = new Promise((resolve) => manager.subscribe((task) => {
    if (task.status === 'failed') resolve(task)
  }))
  manager.start(meeting, async (report) => {
    report({ stage: 'model', progress: 45, receivedChars: 100 })
    throw new Error('synthetic provider failure')
  })
  const task = await failed
  assert.equal(task.stage, 'model')
  assert.equal(task.error, 'synthetic provider failure')
  assert.equal(manager.active(meeting.id), undefined)
  assert.equal(manager.hasRunning(), false)
})

test('a failed meeting can be retried without a stale active-task lock', async () => {
  const manager = new MinutesTaskManager()
  const failed = new Promise((resolve) => manager.subscribe((task) => {
    if (task.status === 'failed') resolve(task)
  }))
  manager.start(meeting, async () => { throw new Error('synthetic failure') })
  await failed
  const completed = new Promise((resolve) => manager.subscribe((task) => {
    if (task.status === 'completed') resolve(task)
  }))
  const retry = manager.start(meeting, async () => generated)
  const result = await completed
  assert.equal(result.id, retry.id)
  assert.equal(manager.list().length, 1)
})

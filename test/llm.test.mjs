import test from 'node:test'
import assert from 'node:assert/strict'
import { completeWithDefaultModel, completeWithModel, listMinutesModels } from '../lib/index.js'

function context(chunks, selection = { provider: 'synthetic', model: 'test-model' }, catalog = {}) {
  const calls = []
  const catalogCalls = []
  const registryCalls = []
  const providers = catalog.providers ?? [{ id: 'synthetic', name: 'Synthetic Provider' }]
  const models = catalog.models ?? { synthetic: [{ provider: 'synthetic', id: 'test-model', name: 'Test Model' }] }
  return {
    calls,
    catalogCalls,
    registryCalls,
    ctx: {
      get(name) {
        if (name === 'agentDefaultModel') return { currentSelection: () => selection }
        if (name === 'sessionController') return {
          async modelCatalog() {
            catalogCalls.push(true)
            if (catalog.modelCatalogError) throw new Error(catalog.modelCatalogError)
            return catalog.modelCatalog ?? { default: selection, groups: [], failures: [] }
          },
        }
        if (name === 'llm') return {
          listProviders() { registryCalls.push('listProviders'); return providers },
          async listModels(provider) {
            registryCalls.push('listModels')
            if (catalog.listErrors?.[provider]) throw new Error(catalog.listErrors[provider])
            return models[provider] ?? []
          },
          async resolveModelInfo(provider, model) {
            registryCalls.push('resolveModelInfo')
            return { provider, id: model, name: model }
          },
          stream(options) {
            calls.push(options)
            return (async function * () {
              for (const chunk of chunks) {
                if (typeof chunk === 'function') await chunk(options)
                else if (chunk instanceof Error) throw chunk
                else yield chunk
              }
            })()
          },
        }
        return undefined
      },
    },
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

test('LLM completion follows the DSH default and collects deltas without duplicating blocks', async () => {
  const { ctx, calls } = context([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '{"summary":' },
    { type: 'text-delta', index: 0, text: '"完成"}' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '{"summary":"完成"}' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ], { provider: 'synthetic', model: 'test-model', reasoningEffort: 'low' })
  const progress = []
  const output = await completeWithDefaultModel(ctx, 'system', 'user', 1000, (value) => progress.push(value))
  assert.equal(output, '{"summary":"完成"}')
  assert.equal(calls[0].provider, 'synthetic')
  assert.equal(calls[0].model, 'test-model')
  assert.equal(calls[0].reasoningEffort, 'low')
  assert.ok(progress.some((value) => value.receivedChars === output.length))
})

test('explicit minutes model and reasoning effort override DSH without changing its selection', async () => {
  const { ctx, calls } = context([
    { type: 'text-delta', index: 0, text: '{"summary":"显式模型"}' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const output = await completeWithModel(ctx, 'system', 'user', {
    selection: { provider: 'chosen-provider', model: 'chosen-model', reasoningEffort: 'chosen-effort' },
    idleTimeoutMs: 1000,
  })
  assert.equal(output, '{"summary":"显式模型"}')
  assert.equal(calls[0].provider, 'chosen-provider')
  assert.equal(calls[0].model, 'chosen-model')
  assert.equal(calls[0].reasoningEffort, 'chosen-effort')
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test('minutes catalog reuses the DSH conversation modelCatalog and its display ordering', async () => {
  const { ctx, catalogCalls, registryCalls } = context([], { provider: 'synthetic', model: 'unused-default' }, {
    modelCatalog: {
      default: { provider: 'custom', model: 'custom-model', reasoningEffort: 'deep' },
      routableProviders: ['custom', 'deepseek-official', 'deepseek-account'],
      groups: [
        {
          id: 'custom', name: 'Custom Provider', models: [{
            id: 'custom-model', name: 'Custom Model', description: 'Synthetic description',
            reasoning: {
              efforts: [{ id: 'standard', name: '标准' }, { id: 'deep', name: '深入', description: '合成说明' }],
              defaultEffort: 'deep',
            },
          }],
        },
        { id: 'deepseek-official', name: 'DeepSeek Official', models: [{ id: 'official-a', name: 'Official A' }, { id: 'official-b', name: 'Official B' }] },
        { id: 'deepseek-account', name: 'DeepSeek Account', models: [{ id: 'account-a', name: 'Account A' }, { id: 'account-b', name: 'Account B' }] },
      ],
      failures: [{ id: 'broken', name: 'Broken Provider', message: 'synthetic catalog unavailable' }],
    },
  })
  const catalog = await listMinutesModels(ctx)
  assert.deepEqual(catalog.current, { provider: 'custom', model: 'custom-model', reasoningEffort: 'deep' })
  assert.deepEqual(catalog.options.map((option) => option.model), ['account-a', 'account-b', 'official-a', 'official-b', 'custom-model'])
  assert.equal(catalog.options[0].providerName, 'DeepSeek 账号')
  assert.deepEqual(catalog.options[4].reasoningEfforts.map((effort) => effort.id), ['standard', 'deep'])
  assert.equal(catalog.options[4].defaultReasoningEffort, 'deep')
  assert.match(catalog.errors[0], /Broken Provider.*synthetic catalog unavailable/)
  assert.equal(catalogCalls.length, 1)
  assert.deepEqual(registryCalls, [], 'must not build a divergent list through llm registry enumeration')
  assert.equal('apiKey' in catalog, false)
})

test('minutes catalog preserves DSH catalog failures without substituting another model list', async () => {
  const { ctx, registryCalls } = context([], undefined, { modelCatalogError: 'synthetic conversation catalog unavailable' })
  const catalog = await listMinutesModels(ctx)
  assert.deepEqual(catalog.options, [])
  assert.match(catalog.errors[0], /DSH 对话模型列表.*synthetic conversation catalog unavailable/)
  assert.deepEqual(registryCalls, [])
})

test('LLM completion accepts an assembled text block when deltas are absent', async () => {
  const { ctx } = context([
    { type: 'block-end', index: 2, block: { type: 'text', text: '{"summary":"块级响应"}' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  assert.equal(await completeWithDefaultModel(ctx, 'system', 'user'), '{"summary":"块级响应"}')
})

test('Harness terminal error chunks preserve the real provider failure', async () => {
  const { ctx } = context([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'synthetic credential rejected', status: 401 } } },
  ])
  await assert.rejects(
    completeWithDefaultModel(ctx, 'system', 'user'),
    /AUTH.*synthetic credential rejected/,
  )
})

test('unavailable model routes and unsupported efforts point back to minutes settings', async () => {
  const unavailable = context([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'NO_ADAPTER', message: 'synthetic route removed' } } },
  ])
  await assert.rejects(completeWithDefaultModel(unavailable.ctx, 'system', 'user'), /识别设置.*NO_ADAPTER/)
  const unsupported = context([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'synthetic effort removed' } } },
  ])
  await assert.rejects(completeWithDefaultModel(unsupported.ctx, 'system', 'user'), /推理强度.*模型默认.*UNSUPPORTED_REASONING_EFFORT/)
})

test('reasoning-only responses are not reported as an empty retryable response', async () => {
  const { ctx } = context([
    { type: 'reasoning-delta', index: 0, text: 'synthetic hidden reasoning' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  await assert.rejects(completeWithDefaultModel(ctx, 'system', 'user'), /只返回了思考内容/)
})

test('stream timeout errors receive an actionable inactivity error', async () => {
  const timeout = new Error('synthetic timeout')
  timeout.name = 'TimeoutError'
  const { ctx } = context([timeout])
  await assert.rejects(completeWithDefaultModel(ctx, 'system', 'user'), /请求超时.*识别设置/)
})

test('a stalled stream is aborted after the configured inactivity limit', async () => {
  const { ctx, calls } = context([async (options) => {
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('synthetic abort')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })
  }])
  await assert.rejects(
    completeWithModel(ctx, 'system', 'user', { idleTimeoutMs: 20 }),
    /请求超时.*1 秒.*没有返回数据/,
  )
  assert.equal(calls[0].signal.aborted, true)
})

test('reasoning and text reset the inactivity timer instead of imposing a total deadline', async () => {
  const { ctx } = context([
    async () => sleep(30),
    { type: 'reasoning-delta', index: 0, text: '合成推理' },
    async () => sleep(30),
    { type: 'text-delta', index: 0, text: '{"summary":' },
    async () => sleep(30),
    { type: 'text-delta', index: 0, text: '"持续生成"}' },
    async () => sleep(30),
    { type: 'text-delta', index: 0, text: '' },
    async () => sleep(30),
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const progress = []
  const started = Date.now()
  const output = await completeWithModel(ctx, 'system', 'user', {
    idleTimeoutMs: 100,
    onProgress: (value) => progress.push(value),
  })
  assert.ok(Date.now() - started >= 120, 'the successful stream must outlive one inactivity interval')
  assert.equal(output, '{"summary":"持续生成"}')
  assert.ok(progress.some((value) => value.reasoningChars > 0 && value.receivedChars === 0))
})

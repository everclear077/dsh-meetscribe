import {
  DEFAULT_MINUTES_IDLE_TIMEOUT_MS,
  type MinutesModelCatalog,
  type MinutesModelOption,
  type MinutesModelSelection,
} from '../shared/types.ts'

export interface LlmContext {
  get?: (name: string) => unknown
}

interface LlmFailure {
  code?: string
  message?: string
  status?: number
}

interface LlmStreamChunk {
  type: string
  index?: number
  text?: string
  block?: { type?: string; text?: string }
  reason?: { kind?: string; failure?: LlmFailure }
}

interface DshModelCatalog {
  default: MinutesModelSelection
  groups: readonly {
    id: string
    name: string
    models: readonly {
      id: string
      name: string
      description?: string
      reasoning?: {
        efforts: readonly { id: string; name: string; description?: string }[]
        defaultEffort?: string
      }
    }[]
  }[]
  failures: readonly { id: string; name: string; message: string }[]
}

interface SessionControllerService {
  modelCatalog?(): Promise<DshModelCatalog>
}

interface LlmService {
  stream(options: {
    provider: string
    model: string
    reasoningEffort?: string
    system?: string
    signal?: AbortSignal
    messages: { role: 'user'; content: { type: 'text'; text: string }[] }[]
  }): AsyncIterable<LlmStreamChunk>
}

interface ModelSelection {
  currentSelection?: () => MinutesModelSelection | undefined
}

export interface LlmProgress {
  receivedChars: number
  reasoningChars: number
}

export interface LlmCompletionOptions {
  /** Null or omission follows the DSH default. Explicit routes never mutate that default. */
  selection?: MinutesModelSelection | null
  /** Reset after every stream event, including reasoning-only events. */
  idleTimeoutMs?: number
  onProgress?: (progress: LlmProgress) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failureMessage(failure: LlmFailure | undefined, aborted: boolean): string {
  const code = failure?.code || (aborted ? 'ABORTED' : 'ERROR')
  const detail = failure?.message?.trim()
  if (code === 'NO_ADAPTER') {
    return `所选纪要模型的服务通道已不可用，请在识别设置中重新选择模型（NO_ADAPTER）${detail ? `：${detail}` : ''}`
  }
  if (code === 'UNSUPPORTED_REASONING_EFFORT') {
    return `所选纪要模型不支持当前推理强度，请在识别设置中改为“模型默认”或选择其他强度（UNSUPPORTED_REASONING_EFFORT）${detail ? `：${detail}` : ''}`
  }
  if (aborted && (!detail || /abort|timeout|timed out/iu.test(detail))) {
    return '生成纪要的大模型请求已超时或被取消，请重试'
  }
  return `大模型请求失败（${code}）${detail ? `：${detail}` : '，请检查 DSH 的模型配置'}`
}

function currentDefault(ctx: LlmContext): MinutesModelSelection | null {
  const selection = ctx.get?.('agentDefaultModel') as ModelSelection | undefined
  const selected = selection?.currentSelection?.()
  if (!selected?.provider || !selected.model) return null
  return {
    provider: selected.provider,
    model: selected.model,
    ...selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {},
  }
}

/**
 * Read the exact Host catalog used by the DSH conversation model selector.
 * Provider credentials and provider configuration are never read or returned.
 */
export async function listMinutesModels(ctx: LlmContext): Promise<MinutesModelCatalog> {
  const errors: string[] = []
  let current: MinutesModelSelection | null = null
  try {
    current = currentDefault(ctx)
  } catch (error) {
    errors.push(`无法读取 DSH 当前模型：${errorMessage(error)}`)
  }
  const controller = ctx.get?.('sessionController') as SessionControllerService | undefined
  if (!controller || typeof controller.modelCatalog !== 'function') {
    return { current, options: [], errors: [...errors, '当前 DSH 没有对话模型目录服务，请升级 Harness 后重试'] }
  }

  let catalog: DshModelCatalog
  try {
    catalog = await controller.modelCatalog()
  } catch (error) {
    // Do not substitute a second registry walk: it can disagree with the
    // conversation selector about availability, ordering and reasoning data.
    return { current, options: [], errors: [...errors, `无法读取 DSH 对话模型列表：${errorMessage(error)}`] }
  }
  if (catalog.default?.provider && catalog.default.model) {
    current = {
      provider: catalog.default.provider,
      model: catalog.default.model,
      ...catalog.default.reasoningEffort ? { reasoningEffort: catalog.default.reasoningEffort } : {},
    }
  }
  const providerRank = (id: string): number => id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2
  const groups = [...catalog.groups].sort((left, right) => providerRank(left.id) - providerRank(right.id))
  const options = groups.flatMap((provider): MinutesModelOption[] => provider.models.map((model) => ({
    provider: provider.id,
    providerName: provider.id === 'deepseek-account' ? 'DeepSeek 账号' : provider.name,
    model: model.id,
    name: model.name,
    ...model.description ? { description: model.description } : {},
    reasoningEfforts: model.reasoning?.efforts.map((effort) => ({
      id: effort.id,
      name: effort.name,
      ...effort.description ? { description: effort.description } : {},
    })) ?? [],
    ...model.reasoning?.defaultEffort ? { defaultReasoningEffort: model.reasoning.defaultEffort } : {},
  })))
  return {
    current,
    options,
    errors: [...errors, ...catalog.failures.map((failure) => `${failure.name}：${failure.message}`)],
  }
}

function idleDuration(milliseconds: number): string {
  if (milliseconds % 60000 === 0) return `${milliseconds / 60000} 分钟`
  return `${Math.max(1, Math.ceil(milliseconds / 1000))} 秒`
}

/** Explicit user action: collect visible text and preserve Harness terminal failures. */
export async function completeWithModel(
  ctx: LlmContext,
  system: string,
  user: string,
  options: LlmCompletionOptions = {},
): Promise<string> {
  const llm = ctx.get?.('llm') as LlmService | undefined
  if (!llm || typeof llm.stream !== 'function') throw new Error('当前 DSH 没有可用的大模型服务')
  const selected = options.selection == null ? currentDefault(ctx) : options.selection
  if (!selected?.provider || !selected.model) {
    throw new Error('请先在 MeetScribe 识别设置或 DSH 中选择用于生成纪要的大模型')
  }
  const requestedIdleTimeout = options.idleTimeoutMs ?? DEFAULT_MINUTES_IDLE_TIMEOUT_MS
  const idleTimeoutMs = Number.isFinite(requestedIdleTimeout) && requestedIdleTimeout > 0
    ? Math.floor(requestedIdleTimeout)
    : DEFAULT_MINUTES_IDLE_TIMEOUT_MS
  const timeoutMessage = `生成纪要的大模型请求超时：所选模型连续 ${idleDuration(idleTimeoutMs)} 没有返回数据，请求已停止。请重试，或在识别设置中更换纪要模型、调整无响应超时`
  const controller = new AbortController()
  let didIdleTimeout = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      didIdleTimeout = true
      controller.abort()
    }, idleTimeoutMs)
    idleTimer.unref?.()
  }
  const onProgress = options.onProgress
  let output = ''
  let reasoningChars = 0
  let lastReported = -1
  let lastReportedReasoning = -1
  let finishKind = ''
  const deltaBlocks = new Set<number>()
  const eventCounts = new Map<string, number>()

  const report = (force = false): void => {
    if (!onProgress) return
    const unchanged = output.length === lastReported && reasoningChars === lastReportedReasoning
    if (force && unchanged) return
    if (!force && lastReported >= 0 && output.length - lastReported < 512
      && lastReportedReasoning >= 0 && reasoningChars - lastReportedReasoning < 512) return
    lastReported = output.length
    lastReportedReasoning = reasoningChars
    onProgress({ receivedChars: output.length, reasoningChars })
  }

  resetIdleTimer()
  try {
    const stream = llm.stream({
      provider: selected.provider,
      model: selected.model,
      ...selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {},
      system,
      signal: controller.signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    })
    for await (const chunk of stream) {
      resetIdleTimer()
      if (!chunk || typeof chunk.type !== 'string') continue
      eventCounts.set(chunk.type, (eventCounts.get(chunk.type) ?? 0) + 1)
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        if (typeof chunk.index === 'number') deltaBlocks.add(chunk.index)
        output += chunk.text
        report()
      } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        reasoningChars += chunk.text.length
        report()
      } else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
        // The Harness protocol normally includes deltas. This fallback supports
        // adapters that only provide the assembled block without duplicating text.
        if (typeof chunk.index !== 'number' || !deltaBlocks.has(chunk.index)) output += chunk.block.text
        report()
      } else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind ?? ''
        if (finishKind === 'error' || finishKind === 'aborted') {
          throw new Error(failureMessage(chunk.reason?.failure, finishKind === 'aborted'))
        }
      }
    }
  } catch (error) {
    if (didIdleTimeout || controller.signal.aborted
      || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }

  report(true)
  if (!output.trim()) {
    const events = Object.fromEntries(eventCounts)
    console.warn('[dsh-meetscribe] LLM stream returned no visible text:', JSON.stringify({ events, reasoningChars, finishKind }))
    if (reasoningChars > 0) throw new Error('模型只返回了思考内容，没有返回纪要正文；请重试或在识别设置中更换纪要模型')
    if (finishKind === 'max-tokens') throw new Error('模型达到输出长度上限，但没有返回可用纪要正文；请缩短输入或调整模型')
    throw new Error('模型流已结束，但没有收到纪要正文；请检查纪要模型或稍后重试')
  }
  return output
}

/** Backward-compatible entry point: follow DSH with an inactivity, not total, timeout. */
export function completeWithDefaultModel(
  ctx: LlmContext,
  system: string,
  user: string,
  timeoutMs = DEFAULT_MINUTES_IDLE_TIMEOUT_MS,
  onProgress?: (progress: LlmProgress) => void,
): Promise<string> {
  return completeWithModel(ctx, system, user, { idleTimeoutMs: timeoutMs, onProgress })
}

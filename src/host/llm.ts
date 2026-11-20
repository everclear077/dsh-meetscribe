export interface LlmContext {
  get?: (name: string) => unknown
}

interface LlmService {
  stream(options: {
    provider: string
    model: string
    system?: string
    signal?: AbortSignal
    messages: { role: 'user'; content: { type: 'text'; text: string }[] }[]
  }): AsyncIterable<{ type: string; text?: string }>
}

interface ModelSelection {
  currentSelection?: () => { provider: string; model: string } | undefined
}

export async function completeWithDefaultModel(ctx: LlmContext, system: string, user: string, timeoutMs = 120000): Promise<string> {
  const llm = ctx.get?.('llm') as LlmService | undefined
  const selection = ctx.get?.('agentDefaultModel') as ModelSelection | undefined
  const selected = selection?.currentSelection?.()
  if (!llm || typeof llm.stream !== 'function') throw new Error('当前 DSH 没有可用的大模型服务')
  if (!selected?.provider || !selected.model) throw new Error('请先在 DSH 中选择用于生成纪要的大模型')
  const stream = llm.stream({
    provider: selected.provider,
    model: selected.model,
    system,
    signal: AbortSignal.timeout(timeoutMs),
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
  })
  let output = ''
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
  }
  if (!output.trim()) throw new Error('大模型返回了空内容，请重试')
  return output
}

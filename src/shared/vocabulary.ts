import type { AsrReplacement } from './types.ts'

const MAX_RULES = 100
const MAX_ALIASES = 20
const MAX_TEXT_LENGTH = 100

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : ''
}

/** Validate and bound persisted ASR replacement rules. */
export function normalizeAsrReplacements(input: unknown): AsrReplacement[] {
  if (!Array.isArray(input)) return []
  const rules: AsrReplacement[] = []
  const aliases = new Set<string>()
  for (const value of input.slice(0, MAX_RULES)) {
    if (!value || typeof value !== 'object') continue
    const candidate = value as Partial<AsrReplacement>
    const to = clean(candidate.to)
    if (!to || !Array.isArray(candidate.from)) continue
    const from: string[] = []
    for (const item of candidate.from) {
      const heard = clean(item)
      const heardKey = heard.toLocaleLowerCase()
      const key = heard.replace(/\s+/g, '').toLocaleLowerCase()
      if (!heard || heardKey === to.toLocaleLowerCase() || aliases.has(key)) continue
      aliases.add(key)
      from.push(heard)
      if (from.length >= MAX_ALIASES) break
    }
    if (from.length > 0) rules.push({ from, to })
  }
  return rules
}

/** Parse one rule per line: 标准写法 = 常见误识别 1 | 常见误识别 2. */
export function parseAsrReplacements(text: string): AsrReplacement[] {
  const rules: AsrReplacement[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.includes('=') ? '=' : line.includes('＝') ? '＝' : ''
    if (!separator) throw new Error(`第 ${index + 1} 行缺少“=”，请使用“标准术语 = 常见误识别”格式`)
    const split = line.indexOf(separator)
    const to = line.slice(0, split).trim()
    const from = line.slice(split + 1).split(/[|｜]/).map((value) => value.trim()).filter(Boolean)
    if (!to || from.length === 0) throw new Error(`第 ${index + 1} 行需要标准术语和至少一个常见误识别`)
    if (to.length > MAX_TEXT_LENGTH || from.some((value) => value.length > MAX_TEXT_LENGTH)) throw new Error(`第 ${index + 1} 行超过 ${MAX_TEXT_LENGTH} 字符上限`)
    if (from.length > MAX_ALIASES) throw new Error(`第 ${index + 1} 行最多配置 ${MAX_ALIASES} 个误识别写法`)
    if (rules.length >= MAX_RULES) throw new Error(`最多配置 ${MAX_RULES} 条术语规则`)
    rules.push({ to, from })
  }
  const normalized = normalizeAsrReplacements(rules)
  if (normalized.length !== rules.length) throw new Error('术语或误识别写法重复；请合并重复行后再保存')
  return normalized
}

export function formatAsrReplacements(rules: readonly AsrReplacement[]): string {
  return rules.map((rule) => `${rule.to} = ${rule.from.join(' | ')}`).join('\n')
}

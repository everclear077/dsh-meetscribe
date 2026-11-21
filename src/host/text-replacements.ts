/**
 * 转写后替换表：把识别器反复听错的词（人名、产品名、英文词）改成想要的写法。
 *
 * Orca 当前下载的 SenseVoice Small GGUF 不提供 vocabulary 或 context_prompt
 * 能力，因此统一在 transcribe.cpp 的文本出口做明确配置的单次纠正。
 * 临时快照和最终整段识别共用这一套规则，原始模型文本另行保留。
 *
 * 匹配规则：
 * - 不区分大小写；同一位置优先匹配更长的写法；一次扫描，替换结果不会再被匹配。
 * - 写法两端是英文字母/数字时要求整词（「sina」不会改到「Sinatra」）；两端是汉字或符号时直接按子串匹配。
 * - 空白不敏感：中英交界处和写法里的空白都容许任意空白（「ski 男」与「ski男」等价），识别器常在中英之间插入空格。
 */

import type { AsrReplacement } from '../shared/types.ts'

export type { AsrReplacement } from '../shared/types.ts'

export type AsrReplacer = (text: string) => string

const ASCII_WORD = /[A-Za-z0-9]/

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 把写法编译成正则片段：中英交界处和写法里的空白都容许任意空白（识别器常在「ski男」中间补空格），
 * 两端为英文字母/数字时加整词界。
 */
function patternOf(heard: string): string | null {
  const chars = [...heard.replace(/\s+/g, ' ').trim()]
  if (chars.length === 0) return null
  let body = ''
  let prev = ''
  let spaced = false
  for (const ch of chars) {
    if (ch === ' ') {
      spaced = true
      continue
    }
    if (prev && (spaced || ASCII_WORD.test(prev) !== ASCII_WORD.test(ch))) body += '\\s*'
    body += escapeRegExp(ch)
    prev = ch
    spaced = false
  }
  const first = [...heard.trim()][0]!
  const trimmed = [...heard.trim()]
  const last = trimmed[trimmed.length - 1]!
  const head = ASCII_WORD.test(first) ? '(?<![A-Za-z0-9])' : ''
  const tail = ASCII_WORD.test(last) ? '(?![A-Za-z0-9])' : ''
  return `${head}${body}${tail}`
}

/** 编译替换表；空表返回恒等函数。 */
export function createAsrReplacer(rules: readonly AsrReplacement[]): AsrReplacer {
  const entries: Array<{ pattern: string; key: string; to: string; length: number }> = []
  for (const rule of rules) {
    if (!rule.to) continue
    for (const heard of rule.from) {
      const pattern = patternOf(heard)
      if (!pattern) continue
      entries.push({ pattern, key: heard.replace(/\s+/g, '').toLowerCase(), to: rule.to, length: heard.replace(/\s+/g, '').length })
    }
  }
  if (entries.length === 0) return (text) => text
  entries.sort((a, b) => b.length - a.length)
  const targets = new Map<string, string>()
  for (const e of entries) if (!targets.has(e.key)) targets.set(e.key, e.to)
  const regex = new RegExp(entries.map((e) => `(${e.pattern})`).join('|'), 'giu')
  return (text) => {
    if (!text) return text
    return text.replace(regex, (match) => targets.get(match.replace(/\s+/g, '').toLowerCase()) ?? match)
  }
}

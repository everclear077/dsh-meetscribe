import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { XMLValidator } from 'fast-xml-parser'
import { buildMinutesDocx } from './document.js'
import type { MeetingMinutes } from './types.js'

const BODY_TOKEN = '{{MEETSCRIBE_BODY}}'
const TOKEN_VALUES: Record<string, (minutes: MeetingMinutes) => string> = {
  '{{MEETING_NAME}}': (minutes) => minutes.metadata.name,
  '{{MEETING_TOPIC}}': (minutes) => minutes.metadata.topic,
  '{{MEETING_DATE}}': (minutes) => minutes.metadata.date,
  '{{MEETING_TIME}}': (minutes) => `${minutes.metadata.startTime}—${minutes.metadata.endTime}`,
  '{{MEETING_LOCATION}}': (minutes) => minutes.metadata.location,
  '{{MEETING_FORMAT}}': (minutes) => minutes.metadata.format,
  '{{MEETING_HOST}}': (minutes) => minutes.metadata.host,
  '{{MEETING_RECORDER}}': (minutes) => minutes.metadata.recorder,
  '{{MEETING_ATTENDEES}}': (minutes) => minutes.metadata.attendees.join('、'),
  '{{MEETING_ABSENTEES}}': (minutes) => minutes.metadata.absentees.join('、'),
  '{{MEETING_PROJECT}}': (minutes) => minutes.metadata.project,
  '{{MEETING_CONFIDENTIALITY}}': (minutes) => minutes.metadata.confidentiality,
}

const MAX_ENTRIES = 512
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const decoder = new TextDecoder()

function fail(message: string): never {
  throw new Error(`模板校验失败：${message}`)
}

function entriesOf(data: Uint8Array): Record<string, Uint8Array> {
  if (data.length < 22 || data.length > 10 * 1024 * 1024) fail('文件大小不符合要求')
  let eocd = -1
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset -= 1) {
    if (read32(data, offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) fail('不是有效的 DOCX ZIP 文件')
  const count = read16(data, eocd + 10)
  if (count !== read16(data, eocd + 8) || count > MAX_ENTRIES) fail('ZIP 条目数量不符合要求')
  let central = read32(data, eocd + 16)
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (read32(data, central) !== 0x02014b50) fail('ZIP 中央目录损坏')
    const flags = read16(data, central + 8)
    const method = read16(data, central + 10)
    const compressed = read32(data, central + 20)
    const uncompressed = read32(data, central + 24)
    const nameLength = read16(data, central + 28)
    const extraLength = read16(data, central + 30)
    const commentLength = read16(data, central + 32)
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || compressed === 0xffffffff || uncompressed === 0xffffffff) {
      fail('不支持加密、ZIP64 或非常规压缩条目')
    }
    const name = decoder.decode(data.subarray(central + 46, central + 46 + nameLength))
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name)
      || name.split('/').some((part) => part === '..' || part === '.')) fail('ZIP 包含不安全路径')
    total += uncompressed
    if (total > MAX_UNCOMPRESSED_BYTES) fail('解压后的内容超过 64 MB')
    central += 46 + nameLength + extraLength + commentLength
  }
  try {
    return unzipSync(data)
  } catch {
    fail('DOCX 解包失败')
  }
}

function read16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) fail('ZIP 目录越界')
  return data[offset]! | (data[offset + 1]! << 8)
}

function read32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) fail('ZIP 目录越界')
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0
}

function xml(entries: Record<string, Uint8Array>, name: string, required = true): string {
  const bytes = entries[name]
  if (!bytes) {
    if (required) fail(`缺少 ${name}`)
    return ''
  }
  const value = strFromU8(bytes)
  if (/<!DOCTYPE|<!ENTITY|xml-stylesheet|<w:(?:altChunk|object|control|subDoc)\b/i.test(value)) {
    fail(`${name} 包含不允许的外部或嵌入内容`)
  }
  if (/<Relationship\b[^>]*\bTargetMode\s*=\s*["']External["']/i.test(value)
    || /<w:instrText\b[^>]*>[\s\S]*(?:DDE(?:AUTO)?\b|INCLUDETEXT\b|LINK\s)/i.test(value)
    || /<w:fldSimple\b[^>]*\bw:instr\s*=\s*["'][^"']*(?:DDE(?:AUTO)?\b|INCLUDETEXT\b|LINK\s)/i.test(value)) {
    fail('模板不能包含外部链接、DDE 或动态外部字段')
  }
  const validation = XMLValidator.validate(value)
  if (validation !== true) fail(`${name} 不是有效 XML`)
  return value
}

function validatePackage(data: Uint8Array): Record<string, Uint8Array> {
  const entries = entriesOf(data)
  for (const name of Object.keys(entries)) {
    if (/(?:^|\/)(?:vbaProject\.bin|activeX|embeddings|externalLinks|customXml)(?:\/|$)/i.test(name)
      || /\.(?:exe|dll|js|vbs|ps1|bat|cmd|com|msi)$/i.test(name)) fail('模板包含宏、嵌入对象或可执行内容')
  }
  xml(entries, '[Content_Types].xml')
  xml(entries, '_rels/.rels')
  const document = xml(entries, 'word/document.xml')
  for (const name of Object.keys(entries)) {
    if (/(?:\.xml|\.rels)$/i.test(name)) xml(entries, name)
  }
  const markers = paragraphTexts(document).filter((text) => text.trim() === BODY_TOKEN).length
  if (markers !== 1) fail(`必须在正文单独一段放置且只放置一个 ${BODY_TOKEN} 内容标记`)
  return entries
}

/** Validate without executing the document, resolving relationships or extracting files to disk. */
export async function validateMinutesTemplate(data: Uint8Array): Promise<void> {
  validatePackage(data)
}

function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi, (entity, decimal: string, hex: string) => {
    if (decimal) return String.fromCodePoint(Number(decimal))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity.toLowerCase()] ?? entity
  })
}

function encodeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

function paragraphTexts(document: string): string[] {
  return [...document.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(([paragraph]) =>
    [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1]!)).join(''))
}

function replaceParagraphs(document: string, replace: (paragraph: string, text: string) => string | null): string {
  return document.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1]!)).join('')
    return replace(paragraph, text) ?? paragraph
  })
}

function replaceTokens(document: string, minutes: MeetingMinutes): string {
  return replaceParagraphs(document, (paragraph, text) => {
    let changed = false
    let result = text
    for (const [token, read] of Object.entries(TOKEN_VALUES)) {
      if (!result.includes(token)) continue
      changed = true
      result = result.split(token).join(read(minutes) || '待补充')
    }
    if (!changed) return null
    const opening = paragraph.match(/^<w:p\b[^>]*>/)![0]
    const properties = paragraph.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/)?.[0] ?? ''
    return `${opening}${properties}<w:r><w:t xml:space="preserve">${encodeXml(result)}</w:t></w:r></w:p>`
  })
}

function generatedParts(entries: Record<string, Uint8Array>, name: string): string {
  return xml(entries, name)
}

function fragmentFrom(document: string): string {
  const body = document.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)?.[1]
  if (body === undefined) fail('生成的正文缺少 w:body')
  return body.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g, '')
    .replace(/(<w:pStyle\b[^>]*\bw:val=")(Title|Heading1|Heading2)(")/g, (_match, before: string, id: string, after: string) => `${before}MeetScribe${id}${after}`)
}

function mergeStyles(template: string, generated: string): string {
  let styles = generated
  const additions: string[] = []
  for (const id of ['Title', 'Heading1', 'Heading2']) {
    const expression = new RegExp(`<w:style\\b[^>]*\\bw:styleId="${id}"[^>]*>[\\s\\S]*?<\\/w:style>`)
    const block = generated.match(expression)?.[0]
    if (!block) continue
    const renamed = block.replaceAll(`"${id}"`, `"MeetScribe${id}"`)
    additions.push(renamed)
    styles = styles.replace(expression, '')
  }
  if (!template) return generated.replace(/(<w:style\b[^>]*\bw:styleId=")(Title|Heading1|Heading2)(")/g, '$1MeetScribe$2$3')
    .replace(/(w:(?:basedOn|next|link)\b[^>]*\bw:val=")(Title|Heading1|Heading2)(")/g, '$1MeetScribe$2$3')
  for (const id of ['MeetScribeTitle', 'MeetScribeHeading1', 'MeetScribeHeading2']) {
    template = template.replace(new RegExp(`<w:style\\b[^>]*\\bw:styleId="${id}"[^>]*>[\\s\\S]*?<\\/w:style>`, 'g'), '')
  }
  return template.replace('</w:styles>', `${additions.join('')}</w:styles>`)
}

function mergeNumbering(template: string, generated: string): { xml: string; idMap: Map<number, number> } {
  const generatedIds = [...generated.matchAll(/<w:num\b[^>]*\bw:numId="(\d+)"/g)].map((match) => Number(match[1]))
  const existingIds = [...template.matchAll(/<w:num\b[^>]*\bw:numId="(\d+)"/g)].map((match) => Number(match[1]))
  const offset = existingIds.length ? Math.max(...existingIds) + 1 : 1
  const idMap = new Map(generatedIds.map((id) => [id, id + offset]))
  const abstractGenerated = [...generated.matchAll(/<w:abstractNum\b[^>]*\bw:abstractNumId="(\d+)"/g)].map((match) => Number(match[1]))
  const abstractExisting = [...template.matchAll(/<w:abstractNum\b[^>]*\bw:abstractNumId="(\d+)"/g)].map((match) => Number(match[1]))
  const abstractOffset = abstractExisting.length ? Math.max(...abstractExisting) + 1 : 1
  const abstractMap = new Map(abstractGenerated.map((id) => [id, id + abstractOffset]))
  const abstractBlocks = [...generated.matchAll(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g)].map(([block]) => block
    .replace(/(<w:abstractNum\b[^>]*\bw:abstractNumId=")(\d+)(")/g, (_m, a: string, id: string, b: string) => `${a}${abstractMap.get(Number(id))}${b}`))
  const numberBlocks = [...generated.matchAll(/<w:num\b[^>]*>[\s\S]*?<\/w:num>/g)].map(([block]) => block
    .replace(/(<w:num\b[^>]*\bw:numId=")(\d+)(")/g, (_m, a: string, id: string, b: string) => `${a}${idMap.get(Number(id))}${b}`)
    .replace(/(<w:abstractNumId\b[^>]*\bw:val=")(\d+)(")/g, (_m, a: string, id: string, b: string) => `${a}${abstractMap.get(Number(id))}${b}`))
  return { xml: template.replace('</w:numbering>', `${abstractBlocks.join('')}${numberBlocks.join('')}</w:numbering>`), idMap }
}

function addRelationship(entries: Record<string, Uint8Array>, part: 'styles' | 'numbering', type: string): void {
  const name = 'word/_rels/document.xml.rels'
  let relationships = xml(entries, name)
  const ids = [...relationships.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
  const id = Math.max(0, ...ids) + 1
  relationships = relationships.replace('</Relationships>', `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${part}.xml"/></Relationships>`)
  entries[name] = strToU8(relationships)
  let contentTypes = xml(entries, '[Content_Types].xml')
  const partName = `/word/${part}.xml`
  if (!contentTypes.includes(`PartName="${partName}"`)) {
    const mime = part === 'styles' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="${partName}" ContentType="${mime}"/></Types>`)
    entries['[Content_Types].xml'] = strToU8(contentTypes)
  }
}

/** Merge generated content into a validated template while preserving its page setup and headers/footers. */
export async function applyMinutesTemplate(minutes: MeetingMinutes, templateBytes: Uint8Array): Promise<Buffer> {
  const entries = validatePackage(templateBytes)
  const generated = entriesOf(await buildMinutesDocx(minutes, { bodyOnly: true }))
  let fragment = fragmentFrom(generatedParts(generated, 'word/document.xml'))

  const generatedNumbering = generatedParts(generated, 'word/numbering.xml')
  const hasNumbering = !!entries['word/numbering.xml']
  const emptyNumbering = generatedNumbering
    .replace(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g, '')
    .replace(/<w:num\b[^>]*>[\s\S]*?<\/w:num>/g, '')
  const numbering = mergeNumbering(hasNumbering ? xml(entries, 'word/numbering.xml') : emptyNumbering, generatedNumbering)
  entries['word/numbering.xml'] = strToU8(numbering.xml)
  fragment = fragment.replace(/(<w:numId\b[^>]*\bw:val=")(\d+)(")/g, (_m, a: string, id: string, b: string) => `${a}${numbering.idMap.get(Number(id)) ?? Number(id)}${b}`)
  if (!hasNumbering) addRelationship(entries, 'numbering', 'numbering')

  const generatedStyles = generatedParts(generated, 'word/styles.xml')
  const hasStyles = !!entries['word/styles.xml']
  entries['word/styles.xml'] = strToU8(mergeStyles(hasStyles ? xml(entries, 'word/styles.xml') : '', generatedStyles))
  if (!hasStyles) addRelationship(entries, 'styles', 'styles')

  let replaced = 0
  let document = xml(entries, 'word/document.xml')
  document = replaceParagraphs(document, (_paragraph, text) => {
    if (text.trim() !== BODY_TOKEN) return null
    replaced += 1
    return fragment
  })
  if (replaced !== 1) fail(`无法替换 ${BODY_TOKEN} 内容标记`)
  document = replaceTokens(document, minutes)
  entries['word/document.xml'] = strToU8(document)
  for (const [name, bytes] of Object.entries(entries)) {
    if (/^word\/(?:header|footer)\d*\.xml$/i.test(name)) entries[name] = strToU8(replaceTokens(strFromU8(bytes), minutes))
  }
  const packed: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(entries)) if (!name.endsWith('/')) packed[name] = bytes
  return Buffer.from(zipSync(packed, { level: 6 }))
}

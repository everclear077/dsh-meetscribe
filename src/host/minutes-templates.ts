import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MinutesTemplateCatalog, MinutesTemplateSummary } from '../shared/types.ts'
import { validateMinutesTemplate } from '../word/template.ts'

interface StoredTemplate extends MinutesTemplateSummary {
  builtIn: false
}

export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024

export class MinutesTemplateStore {
  private templates: StoredTemplate[] = []
  private readonly indexPath: string

  constructor(private readonly directory: string) {
    this.indexPath = join(directory, 'index.json')
  }

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      const value: unknown = JSON.parse(await readFile(this.indexPath, 'utf8'))
      if (!Array.isArray(value)) throw new Error('模板索引格式无效')
      this.templates = value.map((item): StoredTemplate => {
        if (!item || typeof item !== 'object') throw new Error('模板索引格式无效')
        const row = item as Partial<StoredTemplate>
        if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id)
          || typeof row.name !== 'string' || typeof row.fileName !== 'string'
          || typeof row.createdAt !== 'string' || !Number.isSafeInteger(row.bytes)) {
          throw new Error('模板索引格式无效')
        }
        return { id: row.id, name: row.name, fileName: row.fileName, createdAt: row.createdAt, bytes: row.bytes!, builtIn: false }
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.templates = []
    }
  }

  catalog(selectedId: string | null): MinutesTemplateCatalog {
    const templates: MinutesTemplateSummary[] = [{
      id: 'builtin', name: '正式会议纪要', fileName: '内置模板', createdAt: '', bytes: 0, builtIn: true,
    }, ...this.templates.map(({ builtIn: _builtIn, ...summary }) => ({ ...summary, builtIn: false }))]
    return { selectedId: selectedId && this.templates.some((item) => item.id === selectedId) ? selectedId : null, templates }
  }

  async upload(fileName: string, data: Buffer): Promise<MinutesTemplateSummary> {
    const safeFileName = fileName.normalize('NFC').trim().slice(0, 160)
    if (!safeFileName.toLowerCase().endsWith('.docx')) throw new Error('请上传 .docx 格式的 Word 模板')
    if (data.length === 0 || data.length > MAX_TEMPLATE_BYTES) throw new Error('Word 模板不能为空，且大小不能超过 10 MB')
    await validateMinutesTemplate(data)
    const id = randomUUID()
    const path = join(this.directory, `${id}.docx`)
    await writeFile(path, data, { flag: 'wx' })
    const summary: StoredTemplate = {
      id,
      name: safeFileName.slice(0, -5).trim() || '自定义模板',
      fileName: safeFileName,
      createdAt: new Date().toISOString(),
      bytes: data.length,
      builtIn: false,
    }
    this.templates = [summary, ...this.templates]
    try {
      await this.persist()
    } catch (error) {
      this.templates = this.templates.filter((item) => item.id !== id)
      await rm(path, { force: true })
      throw error
    }
    const { builtIn: _builtIn, ...result } = summary
    return { ...result, builtIn: false }
  }

  /** Immutable task snapshot: deleting or replacing the default cannot affect a running task. */
  async snapshot(id: string | null): Promise<{ id: string; name: string; data: Buffer } | null> {
    if (id === null) return null
    const template = this.templates.find((item) => item.id === id)
    if (!template) throw new Error('所选会议纪要模板已被删除，请重新选择默认模板')
    const data = await readFile(join(this.directory, `${template.id}.docx`))
    await validateMinutesTemplate(data)
    return { id: template.id, name: template.name, data }
  }

  async remove(id: string): Promise<void> {
    const template = this.templates.find((item) => item.id === id)
    if (!template) throw new Error('模板不存在或已删除')
    const previous = this.templates
    this.templates = previous.filter((item) => item.id !== id)
    try {
      await this.persist()
    } catch (error) {
      this.templates = previous
      throw error
    }
    await rm(join(this.directory, `${id}.docx`), { force: true })
  }

  private async persist(): Promise<void> {
    const temporary = `${this.indexPath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(this.templates, null, 2), 'utf8')
    await rename(temporary, this.indexPath)
  }
}

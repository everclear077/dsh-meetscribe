import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MinutesTemplateCatalog } from '../shared/types.ts'
import { api } from './api.ts'
import { Icon } from './components.tsx'

const EMPTY: MinutesTemplateCatalog = { selectedId: null, templates: [] }
const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })

export function MinutesTemplateManager(): ReactNode {
  const [catalog, setCatalog] = useState<MinutesTemplateCatalog>(EMPTY)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const upload = useRef<HTMLInputElement>(null)
  const load = async (): Promise<void> => {
    try { setCatalog(await api.minutesTemplates()) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  useEffect(() => { void load() }, [])

  const select = async (id: string | null): Promise<void> => {
    if (busy) return
    setBusy(id ?? 'builtin'); setMessage('')
    try {
      setCatalog(await api.selectMinutesTemplate(id))
      setMessage('默认模板已保存；之后新建的纪要任务会使用该模板')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  const remove = async (id: string, name: string): Promise<void> => {
    if (busy || !window.confirm(`删除模板“${name}”？已经生成的 Word 不受影响。`)) return
    setBusy(id); setMessage('')
    try { setCatalog(await api.deleteMinutesTemplate(id)); setMessage('模板已删除；若它曾是默认模板，已恢复为内置模板') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  const onUpload = async (file: File | undefined): Promise<void> => {
    if (!file || busy) return
    setBusy('upload'); setMessage('')
    try {
      const uploaded = await api.uploadMinutesTemplate(file)
      await load()
      setMessage(`模板“${uploaded.name}”已上传。点击“设为默认”后才会用于新任务。`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(''); if (upload.current) upload.current.value = '' }
  }

  return <section className="ms-section"><div className="ms-settings-section-heading"><h3>会议纪要模板</h3><label className={`ms-action ms-template-upload ${busy ? 'is-disabled' : ''}`}><Icon name="file" />{busy === 'upload' ? '正在校验…' : '上传 Word 模板'}<input ref={upload} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={!!busy} onChange={(event) => void onUpload(event.target.files?.[0])} /></label></div>
    <p className="ms-hint">模板只保存在本机，不会上传给模型。默认模板在新任务开始时固定；更改或删除模板不会改变正在生成的任务和已有 Word。</p>
    {message && <div className={message.includes('失败') || message.includes('校验') ? 'ms-error' : 'ms-notice'} role="status" style={{ margin: '10px 0' }}>{message}</div>}
    <div className="ms-template-list">{catalog.templates.map((template) => {
      const selected = template.builtIn ? catalog.selectedId === null : catalog.selectedId === template.id
      return <div className={`ms-template-row ${selected ? 'is-default' : ''}`} key={template.id}><span><strong>{template.name}</strong><small>{template.builtIn ? '内置 · 正式黑白版式 · 议题、讨论、议定事项与任务分工' : `${template.fileName} · ${(template.bytes / 1024).toFixed(1)} KB · ${date.format(new Date(template.createdAt))}`}</small></span><span className="ms-template-actions">{selected ? <span className="ms-template-default-badge">当前默认</span> : <button type="button" className="ms-action" disabled={!!busy} onClick={() => void select(template.builtIn ? null : template.id)}>{busy === template.id || (template.builtIn && busy === 'builtin') ? '正在保存…' : '设为默认'}</button>}{!template.builtIn && <button type="button" className="ms-icon" title={`删除 ${template.name}`} aria-label={`删除模板 ${template.name}`} disabled={!!busy} onClick={() => void remove(template.id, template.name)}><Icon name="clear" /></button>}</span></div>
    })}</div>
    <details className="ms-template-help"><summary>自定义模板的内容标记</summary><p>上传 .docx，正文必须单独一段放置 <code>{'{{MEETSCRIBE_BODY}}'}</code>，这里会插入议题、讨论、议定事项、任务分工等待整理内容。可在正文或页眉页脚使用 <code>{'{{MEETING_NAME}}'}</code>、<code>{'{{MEETING_TOPIC}}'}</code>、<code>{'{{MEETING_DATE}}'}</code>、<code>{'{{MEETING_TIME}}'}</code>、<code>{'{{MEETING_LOCATION}}'}</code>、<code>{'{{MEETING_HOST}}'}</code>、<code>{'{{MEETING_RECORDER}}'}</code>、<code>{'{{MEETING_ATTENDEES}}'}</code> 等标记。页面设置和页眉页脚保留。</p><p>为保证安全，文件不能超过 10 MB；宏、OLE 嵌入对象、外部关系和可执行内容会被拒绝。MeetScribe 只解包并写入 XML，不执行模板中的任何内容。</p></details>
  </section>
}

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api.ts'
import { Icon } from './components.tsx'

export interface DocumentPreviewTarget {
  meetingId: string
  version: number
  fileName: string
}

export function DocumentPreview({ target, onClose }: { target: DocumentPreviewTarget; onClose: () => void }): ReactNode {
  const [state, setState] = useState<{ url?: string; error?: string }>({})
  useEffect(() => {
    const controller = new AbortController()
    let url = ''
    setState({})
    void fetch(api.documentPreviewUrl(target.meetingId, target.version), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) {
        const value = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(value.error || `打开失败 (${response.status})`)
      }
      if (response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf') !== true) throw new Error('DSH 没有返回可预览的 PDF')
      url = URL.createObjectURL(await response.blob())
      if (!controller.signal.aborted) setState({ url })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [target.meetingId, target.version])
  return createPortal(<div className="ms-root ms-document-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ms-document-preview" role="dialog" aria-modal="true" aria-label={`在 DSH 中查看 ${target.fileName}`}>
      <header><span><Icon name="file" /><strong>{target.fileName}</strong><small>DSH 内置 Office 预览 · 本地文件</small></span><button type="button" className="ms-icon" aria-label="关闭文档预览" title="关闭" onClick={onClose}><Icon name="close" /></button></header>
      {state.error ? <div className="ms-document-preview-error" role="alert"><strong>无法在 DSH 中打开</strong><p>{state.error}</p><button type="button" className="ms-action" onClick={onClose}>返回文件列表</button></div> : state.url ? <iframe title={target.fileName} src={state.url} className="ms-document-preview-frame" /> : <div className="ms-document-preview-loading" aria-live="polite"><strong>正在 DSH 中打开…</strong><p>正在使用 Harness Office 组件生成本地预览。</p></div>}
    </section>
  </div>, document.body)
}

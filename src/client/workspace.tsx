import { useMemo, useState, type ReactNode } from 'react'
import { collectMinutesDocuments, queryMinutesDocuments, type MinutesSort } from '../shared/documents.ts'
import { api } from './api.ts'
import { Icon, Mark } from './components.tsx'
import { meetings, useMeetings } from './meeting-controller.ts'
import { MeetingSettings } from './settings.tsx'

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

function documentTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : timeFormatter.format(date)
}

export function MeetScribeWorkspace({ initialView = 'documents' }: { initialView?: 'documents' | 'settings' }): ReactNode {
  const state = useMeetings()
  const [view, setView] = useState(initialView)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<MinutesSort>('created-desc')
  const [refreshing, setRefreshing] = useState(false)
  const documents = useMemo(() => collectMinutesDocuments(state.meetings), [state.meetings])
  const visibleDocuments = useMemo(() => queryMinutesDocuments(documents, query, sort), [documents, query, sort])
  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try { await meetings.refresh() } finally { setRefreshing(false) }
  }
  return <div className="ms-root ms-workspace">
    <header className="ms-workspace-header">
      <div className="ms-workspace-brand"><Mark /><span><strong>MeetScribe</strong><small>本地会议工作台</small></span></div>
      <nav className="ms-workspace-nav" aria-label="MeetScribe 工作台">
        <button className={view === 'documents' ? 'is-active' : ''} aria-current={view === 'documents' ? 'page' : undefined} onClick={() => setView('documents')}><Icon name="file" />纪要文件</button>
        <button className={view === 'settings' ? 'is-active' : ''} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => setView('settings')}><Icon name="settings" />识别设置</button>
      </nav>
    </header>
    {view === 'settings' ? <main className="ms-workspace-settings"><MeetingSettings /></main> : <main className="ms-workspace-content">
      <section className="ms-documents" aria-labelledby="ms-documents-title">
        <div className="ms-documents-heading">
          <div><h1 id="ms-documents-title">会议纪要</h1><p>{documents.length} 个 Word 文档，保留每一次生成版本。</p></div>
          <button className="ms-action" onClick={() => meetings.open(false)}><Icon name="play" />打开会议浮窗</button>
        </div>
        <div className="ms-document-tools">
          <label className="ms-document-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、会议名称或路径" aria-label="搜索会议纪要" /></label>
          <select value={sort} onChange={(event) => setSort(event.target.value as MinutesSort)} aria-label="纪要排序方式">
            <option value="created-desc">时间：最新优先</option>
            <option value="created-asc">时间：最早优先</option>
            <option value="name-asc">名称：正序</option>
            <option value="name-desc">名称：倒序</option>
          </select>
          <button className="ms-icon ms-document-refresh" title="刷新文件列表" aria-label="刷新文件列表" aria-busy={refreshing} onClick={() => void refresh()}><Icon name="refresh" /></button>
        </div>
        {state.error && <div className="ms-error" role="alert">{state.error}</div>}
        <div className="ms-document-list">
          {visibleDocuments.length > 0 && <div className="ms-document-list-head" aria-hidden="true"><span>文件</span><span>版本</span><span>生成时间</span><span>操作</span></div>}
          {!state.ready ? <div className="ms-empty"><strong>正在读取会议纪要…</strong></div> : documents.length === 0 ? <div className="ms-empty ms-documents-empty"><Icon name="file" /><strong>还没有会议纪要</strong><small>在会议浮窗中暂停录音，然后点击“生成纪要”。生成的 Word 文件会集中显示在这里。</small><button className="ms-action ms-primary" onClick={() => meetings.open(false)}>打开会议浮窗</button></div> : visibleDocuments.length === 0 ? <div className="ms-empty ms-documents-empty"><Icon name="search" /><strong>没有匹配的文档</strong><small>尝试搜索其他文件名或会议名称。</small><button className="ms-action" onClick={() => setQuery('')}>清除搜索</button></div> : <ul>
            {visibleDocuments.map((document) => <li className="ms-document-row" key={document.key}>
              <div className="ms-document-name"><span className="ms-file-icon" aria-hidden="true">W</span><span><strong title={document.path}>{document.fileName}</strong><small>{document.meetingTitle}</small></span></div>
              <span className="ms-document-version">第 {document.version} 版</span>
              <time className="ms-document-time" dateTime={document.createdAt}>{documentTime(document.createdAt)}</time>
              <a className="ms-action ms-document-download" href={api.documentUrl(document.meetingId, document.version)} download={document.fileName} aria-label={`下载 ${document.fileName}`}><Icon name="download" /><span>下载</span></a>
            </li>)}
          </ul>}
        </div>
        <footer className="ms-documents-footer">{query ? `当前显示 ${visibleDocuments.length} / ${documents.length} 个文件` : `共 ${documents.length} 个文件`}<span>文件保存在本机，仅在点击“生成纪要”时调用大模型。</span></footer>
      </section>
    </main>}
  </div>
}

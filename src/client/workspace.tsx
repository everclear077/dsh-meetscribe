import { useMemo, useState, type ReactNode } from 'react'
import { collectMinutesDocuments, queryMinutesDocuments, type MinutesSort } from '../shared/documents.ts'
import type { MinutesTask, MinutesTaskStage } from '../shared/types.ts'
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

const taskSteps: { id: Exclude<MinutesTaskStage, 'completed'>; label: string }[] = [
  { id: 'preparing', label: '准备逐字稿' },
  { id: 'model', label: 'DSH 模型整理' },
  { id: 'parsing', label: '解析纪要内容' },
  { id: 'document', label: '生成 Word' },
]

function modelProgressLabel(task: MinutesTask): string {
  if (task.receivedChars > 0) return `正在接收模型正文，已收到 ${task.receivedChars.toLocaleString('zh-CN')} 个字符`
  if ((task.reasoningChars ?? 0) > 0) return `模型正在思考，已收到 ${(task.reasoningChars ?? 0).toLocaleString('zh-CN')} 个推理字符，等待纪要正文`
  return '已发送完整逐字稿，正在等待所选纪要模型响应'
}

function GenerationTask({ task }: { task: MinutesTask }): ReactNode {
  const currentStep = task.stage === 'completed' ? taskSteps.length : taskSteps.findIndex((step) => step.id === task.stage)
  return <article className={`ms-generation-task is-${task.status}`}>
    <div className="ms-generation-task-heading">
      <span><strong>{task.meetingTitle}</strong><small>{task.status === 'running' ? '正在生成会议纪要' : task.status === 'completed' ? `第 ${task.version ?? ''} 版已生成` : '生成未完成'}</small></span>
      <span className="ms-generation-task-status">{task.status === 'running' ? '进行中' : task.status === 'completed' ? '已完成' : '失败'}</span>
    </div>
    <div className="ms-generation-progress" role="progressbar" aria-label={`${task.meetingTitle}纪要生成进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><span style={{ width: `${task.progress}%` }} /></div>
    <ol className="ms-generation-steps">
      {taskSteps.map((step, index) => <li key={step.id} className={index < currentStep || task.status === 'completed' ? 'is-done' : index === currentStep ? task.status === 'failed' ? 'is-error' : 'is-current' : ''}>{step.label}</li>)}
    </ol>
    {task.status === 'running' && task.stage === 'model' && <small className="ms-generation-detail">{modelProgressLabel(task)}</small>}
    {task.status === 'failed' && <div className="ms-generation-error" role="alert"><span>{task.error}</span><button className="ms-action" onClick={() => void meetings.generate(task.meetingId)}>重试生成</button></div>}
    {task.status === 'completed' && task.version !== undefined && <a className="ms-action" href={api.documentUrl(task.meetingId, task.version)} download><Icon name="download" />下载 Word</a>}
  </article>
}

export function MeetScribeWorkspace({ initialView = 'documents' }: { initialView?: 'documents' | 'settings' }): ReactNode {
  const state = useMeetings()
  const [view, setView] = useState(initialView)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<MinutesSort>('created-desc')
  const [refreshing, setRefreshing] = useState(false)
  const documents = useMemo(() => collectMinutesDocuments(state.meetings), [state.meetings])
  const visibleDocuments = useMemo(() => queryMinutesDocuments(documents, query, sort), [documents, query, sort])
  const visibleTasks = useMemo(() => [...state.minutesTasks].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.updatedAt.localeCompare(a.updatedAt)), [state.minutesTasks])
  const runningTasks = visibleTasks.filter((task) => task.status === 'running').length
  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try { await meetings.refresh() } finally { setRefreshing(false) }
  }
  return <div className="ms-root ms-workspace">
    <header className="ms-workspace-header">
      <div className="ms-workspace-brand"><Mark /><span><strong>MeetScribe</strong><small>本地会议工作台</small></span></div>
      <nav className="ms-workspace-nav" aria-label="MeetScribe 工作台">
        <button className={view === 'documents' ? 'is-active' : ''} aria-current={view === 'documents' ? 'page' : undefined} onClick={() => setView('documents')}><Icon name="file" />纪要文件{runningTasks > 0 && <span className="ms-task-count" aria-label={`${runningTasks} 个生成任务进行中`}>{runningTasks}</span>}</button>
        <button className={view === 'settings' ? 'is-active' : ''} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => setView('settings')}><Icon name="settings" />识别设置{runningTasks > 0 && <span className="ms-task-dot" title={`${runningTasks} 个生成任务进行中`} />}</button>
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
        {visibleTasks.length > 0 && <section className="ms-generation-tasks" aria-labelledby="ms-generation-tasks-title">
          <div className="ms-generation-tasks-heading"><h2 id="ms-generation-tasks-title">生成任务</h2><span>{runningTasks > 0 ? `${runningTasks} 个进行中` : '最近任务'}</span></div>
          <div className="ms-generation-task-list">{visibleTasks.map((task) => <GenerationTask task={task} key={task.id} />)}</div>
        </section>}
        <div className="ms-document-list">
          {visibleDocuments.length > 0 && <div className="ms-document-list-head" aria-hidden="true"><span>文件</span><span>版本</span><span>生成时间</span><span>操作</span></div>}
          {!state.ready ? <div className="ms-empty"><strong>正在读取会议纪要…</strong></div> : documents.length === 0 ? visibleTasks.length === 0 ? <div className="ms-empty ms-documents-empty"><Icon name="file" /><strong>还没有会议纪要</strong><small>在会议浮窗中暂停录音，然后点击“生成纪要”。生成的 Word 文件会集中显示在这里。</small><button className="ms-action ms-primary" onClick={() => meetings.open(false)}>打开会议浮窗</button></div> : <div className="ms-empty"><strong>还没有已完成的 Word 文档</strong><small>生成任务完成后，文件会显示在这里。</small></div> : visibleDocuments.length === 0 ? <div className="ms-empty ms-documents-empty"><Icon name="search" /><strong>没有匹配的文档</strong><small>尝试搜索其他文件名或会议名称。</small><button className="ms-action" onClick={() => setQuery('')}>清除搜索</button></div> : <ul>
            {visibleDocuments.map((document) => <li className="ms-document-row" key={document.key}>
              <div className="ms-document-name"><span className="ms-file-icon" aria-hidden="true">W</span><span><strong title={document.path}>{document.fileName}</strong><small>{document.meetingTitle}</small></span></div>
              <span className="ms-document-version">第 {document.version} 版</span>
              <time className="ms-document-time" dateTime={document.createdAt}>{documentTime(document.createdAt)}</time>
              <a className="ms-action ms-document-download" href={api.documentUrl(document.meetingId, document.version)} download={document.fileName} aria-label={`下载 ${document.fileName}`}><Icon name="download" /><span>下载</span></a>
            </li>)}
          </ul>}
        </div>
        <footer className="ms-documents-footer">{query ? `当前显示 ${visibleDocuments.length} / ${documents.length} 个文件` : `共 ${documents.length} 个文件`}<span>音频不发送给大模型；生成 Word 或主动发送会议草稿时才发送文本。</span></footer>
      </section>
    </main>}
  </div>
}

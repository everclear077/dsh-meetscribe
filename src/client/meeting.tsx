import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { MeetingMetadata, Speaker } from '../shared/types.ts'
import { meetings, useMeetings } from './meeting-controller.ts'
import { Icon, Mark, clock, segmentTime } from './components.tsx'

function Speakers({ speakers }: { speakers: Speaker[] }): ReactNode {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const save = (id: string): void => { void meetings.rename(id, name); setEditing(null) }
  return <div className="ms-speakers" aria-label="发言人">
    {speakers.length === 0 && <span className="ms-speakers-empty">发言人将在识别后显示在这里</span>}
    {speakers.map((speaker) => editing === speaker.id
      ? <input key={speaker.id} className="ms-speaker-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save(speaker.id)} onKeyDown={(e) => { if (e.key === 'Enter') save(speaker.id); if (e.key === 'Escape') setEditing(null) }} aria-label="发言人姓名" />
      : <button key={speaker.id} className="ms-speaker" style={{ '--speaker': speaker.color } as React.CSSProperties} title="点击重命名" onClick={() => { setEditing(speaker.id); setName(speaker.name) }}>{speaker.name}</button>)}
    {speakers.length > 1 && <span className="ms-spacer" />}
    {speakers.length > 1 && <>
      <select className="ms-source" aria-label="要合并的发言人" value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}><option value="">合并…</option>{speakers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      {mergeSource && <select className="ms-source" aria-label="合并到" value={mergeTarget} onChange={(e) => { setMergeTarget(e.target.value); void meetings.merge(mergeSource, e.target.value); setMergeSource('') }}><option value="">合并到</option>{speakers.filter((s) => s.id !== mergeSource).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    </>}
  </div>
}

const WAVE_SHAPE = [0.2, 0.36, 0.58, 0.8, 0.52, 0.92, 0.68, 1, 0.74, 0.46, 0.86, 0.62, 0.94, 0.54, 0.76, 0.44, 0.28]

function RecordingStatus(): ReactNode {
  const state = useMeetings()
  const recording = state.current?.status === 'recording'
  const hasSound = recording && state.audioLevel >= 0.035
  const label = state.busy
    ? '正在准备默认麦克风'
    : recording
      ? hasSound ? '检测到有声音' : '正在聆听'
      : state.current?.status === 'paused' ? '记录已暂停' : '等待继续'
  return <div className={`ms-recording-status ${recording ? 'is-active' : ''} ${hasSound ? 'has-sound' : ''}`} title="使用系统默认麦克风">
    <div className="ms-voice-wave" role="img" aria-label={label}>
      {WAVE_SHAPE.map((weight, index) => <i key={index} style={{ height: `${4 + (recording ? state.audioLevel : 0) * weight * 30}px` }} />)}
    </div>
    <span className="ms-spacer" />
    <span className="ms-time">{clock(state.elapsed)}</span>
  </div>
}

function Transcript(): ReactNode {
  const { current, pending } = useMeetings()
  const [raw, setRaw] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [current?.segments.length, pending])
  if (!current || (current.segments.length === 0 && !pending)) return <div className="ms-transcript"><div className="ms-empty"><strong>{current?.status === 'recording' ? '说点什么，文字会出现在这里' : current?.status === 'paused' ? '记录已暂停' : current ? '准备继续记录' : '正在准备会议'}</strong><small>{current?.status === 'recording' ? '整句结束后自动定稿，原始文本会保留。' : '点击“继续”即可使用默认麦克风记录。'}</small></div></div>
  return <div className="ms-transcript" aria-live="polite">
    <div className="ms-row ms-transcript-tools"><span>逐字记录</span><button className="ms-text-button" onClick={() => setRaw(!raw)}>{raw ? '显示清理文本' : '查看原始逐字稿'}</button></div>
    {current.segments.map((segment) => {
      const speaker = current.speakers.find((item) => item.id === segment.speakerId)
      return <div className="ms-segment" key={segment.id} style={{ '--speaker': speaker?.color || '#718094' } as React.CSSProperties}>
        <div className="ms-segment-meta">
          <select className="ms-segment-select ms-segment-name" value={segment.speakerId} onChange={(e) => void meetings.reassign(segment.id, e.target.value)} aria-label="调整该段发言人">{current.speakers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
          <span className="ms-segment-time">{segmentTime(segment.startMs)}</span>
        </div>
        <p className="ms-segment-text">{raw ? segment.rawText : segment.displayText}</p>
      </div>
    })}
    {pending && <p className="ms-pending">{pending}</p>}
    <div ref={bottom} />
  </div>
}

function Details(): ReactNode {
  const { current } = useMeetings()
  const [title, setTitle] = useState(current?.title ?? '')
  const [metadata, setMetadata] = useState<MeetingMetadata | null>(current?.metadata ?? null)
  useEffect(() => { setTitle(current?.title ?? ''); setMetadata(current?.metadata ?? null) }, [current?.id])
  if (!current || !metadata) return <div className="ms-detail"><div className="ms-empty">先新建或选择一场会议</div></div>
  const update = <K extends keyof MeetingMetadata>(key: K, value: MeetingMetadata[K]): void => setMetadata({ ...metadata, [key]: value })
  const field = (label: string, key: 'topic' | 'location' | 'host' | 'recorder' | 'project'): ReactNode => <label className="ms-field">{label}<input value={metadata[key]} onChange={(e) => update(key, e.target.value)} placeholder="未填写" /></label>
  return <div className="ms-detail ms-detail-metadata"><form className="ms-section ms-detail-form" onSubmit={(e) => { e.preventDefault(); void meetings.saveMetadata(title, metadata) }}>
    <h3>会议信息</h3><div className="ms-fields">
      <label className="ms-field ms-wide">会议名称<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      {field('会议主题', 'topic')}{field('项目 / 部门', 'project')}{field('地点或会议链接', 'location')}{field('主持人', 'host')}{field('记录人', 'recorder')}
      <label className="ms-field">会议形式<select value={metadata.format} onChange={(e) => update('format', e.target.value as MeetingMetadata['format'])}><option value="online">线上</option><option value="offline">线下</option><option value="hybrid">混合</option></select></label>
      <label className="ms-field">保密级别<select value={metadata.confidentiality} onChange={(e) => update('confidentiality', e.target.value as MeetingMetadata['confidentiality'])}><option value="internal">内部</option><option value="confidential">机密</option><option value="public">公开</option></select></label>
      <label className="ms-field">出席人员（逗号分隔）<input value={metadata.attendees.join('，')} onChange={(e) => update('attendees', e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} placeholder="仅填写已确认人员" /></label>
      <label className="ms-field">缺席人员（逗号分隔）<input value={metadata.absentees.join('，')} onChange={(e) => update('absentees', e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} /></label>
      <label className="ms-field ms-wide">补充说明<textarea value={metadata.notes} onChange={(e) => update('notes', e.target.value)} /></label>
    </div><div className="ms-row ms-detail-actions"><button className="ms-action ms-primary" type="submit">保存会议信息</button><span className="ms-hint">这些信息会在生成 Word 时优先采用。</span></div>
  </form></div>
}

function Files(): ReactNode {
  const { current } = useMeetings()
  return <div className="ms-detail"><section className="ms-section"><h3>Word 会议纪要</h3>
    {!current?.generatedFiles.length && <div className="ms-empty"><strong>还没有生成文件</strong><small>暂停录音后点击“生成纪要”。只有此时才会把逐字稿发送给 DSH 当前配置的大模型。</small></div>}
    {[...(current?.generatedFiles ?? [])].reverse().map((file) => <div className="ms-file" key={file.version}><span className="ms-file-icon">W</span><div className="ms-file-info"><strong>{current!.title} · 第 {file.version} 版</strong><small>{new Date(file.createdAt).toLocaleString('zh-CN')}</small></div><a className="ms-action" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }} href={`/meetscribe/meetings/${encodeURIComponent(current!.id)}/documents/${file.version}`} download>下载 .docx</a></div>)}
  </section></div>
}

function History(): ReactNode {
  const state = useMeetings()
  const [confirmingClear, setConfirmingClear] = useState(false)
  useEffect(() => { if (state.meetings.length === 0) setConfirmingClear(false) }, [state.meetings.length])
  const clearAll = async (): Promise<void> => {
    await meetings.clearHistory()
    setConfirmingClear(false)
  }
  return <div className="ms-detail"><section className="ms-section">
    <div className="ms-row ms-history-heading"><h3>本机会议记录</h3><span className="ms-spacer" />
      {confirmingClear ? <>
        <span className="ms-hint">{state.current?.status === 'recording' ? '将删除全部历史并继续记录' : '将删除全部会议记录'}</span>
        <button className="ms-action ms-clear" onClick={() => void clearAll()} disabled={state.busy}>确认清空</button>
        <button className="ms-action" onClick={() => setConfirmingClear(false)} disabled={state.busy}>取消</button>
      </> : <button className="ms-action ms-clear" onClick={() => setConfirmingClear(true)} disabled={state.busy || state.meetings.length === 0}><Icon name="clear" />清空全部</button>}
      {!confirmingClear && <button className="ms-action" onClick={() => void meetings.create()} disabled={state.busy || state.current?.status === 'recording'}>新建会议</button>}
    </div>
    {state.meetings.length === 0 && <div className="ms-empty">还没有会议记录</div>}
    {state.meetings.map((meeting) => <button className="ms-history-item" key={meeting.id} onClick={() => void meetings.select(meeting.id)}><strong>{meeting.title}</strong><small>{meeting.segments?.length ?? 0} 段 · {new Date(meeting.updatedAt).toLocaleDateString('zh-CN')}</small></button>)}
  </section></div>
}

function MeetingView({ panel = false }: { panel?: boolean }): ReactNode {
  const state = useMeetings()
  const [note, setNote] = useState('')
  const current = state.current
  const recording = current?.status === 'recording'
  const transcriptVisible = (!state.expanded && !panel) || state.tab === 'transcript'
  const canClear = !!current && (current.segments.length > 0 || current.speakers.length > 0 || !!state.pending)
  const submitNote = (event: FormEvent): void => { event.preventDefault(); void meetings.note(note); setNote('') }
  const statusLabel = state.busy ? '正在准备' : recording ? '正在记录' : current?.status === 'paused' ? '已暂停' : current?.status === 'completed' ? '已结束' : '本地识别'
  const statusClass = state.busy ? 'is-busy' : recording ? 'is-live' : current?.status === 'paused' ? 'is-paused' : 'is-ready'
  if (!panel && !state.open) return null
  if (!panel && state.minimized) return <div className="ms-root ms-float ms-minimized" role="dialog" aria-label="MeetScribe 已最小化">
    <header className="ms-header">
      <button className="ms-brand ms-restore" title="恢复会议记录" onClick={meetings.restore}><Mark /><span>{current?.title || 'MeetScribe'}</span></button>
      <span className={`ms-live ${statusClass}`} role="img" aria-label={statusLabel} title={statusLabel} />
      <span className="ms-spacer" /><span className="ms-time">{clock(state.elapsed)}</span>
      <button className="ms-icon" title="恢复浮窗" onClick={meetings.restore}><Icon name="restore" /></button>
      <button className="ms-icon" title="关闭浮窗" onClick={meetings.close}><Icon name="close" /></button>
    </header>
  </div>
  return <div className={`ms-root ${panel ? 'ms-panel' : `ms-float ${state.expanded ? 'ms-expanded' : ''}`}`} role={panel ? undefined : 'dialog'} aria-label="MeetScribe 会议记录">
    <header className="ms-header"><div className="ms-brand" title={current?.title || 'MeetScribe'}><Mark /><span>{current?.title || 'MeetScribe'}</span></div><span className={`ms-live ${statusClass}`} role="img" aria-label={statusLabel} title={statusLabel} /><span className="ms-spacer" />
      <div className="ms-header-actions">
        <button className="ms-icon ms-record-control" aria-label={state.busy ? '请稍候' : recording ? '暂停' : '继续'} title={state.busy ? '正在准备默认麦克风' : recording ? '暂停录音' : '继续录音'} onClick={meetings.toggleRecording} disabled={state.busy || !current}><Icon name={recording ? 'pause' : 'play'} /></button>
        <button className="ms-icon ms-clear-control" aria-label="清空" title="清空当前逐字稿" onClick={() => void meetings.clear()} disabled={state.busy || !canClear}><Icon name="clear" /></button>
        <button className="ms-icon" aria-label="生成纪要" title={state.generating ? '正在生成纪要' : '生成 Word 会议纪要'} aria-busy={state.generating} onClick={() => void meetings.generate()} disabled={!current?.segments.length || state.generating || state.busy || recording}><Icon name="file" /></button>
        <span className="ms-header-divider" />
        {!panel && <button className="ms-icon" title="最小化" onClick={meetings.minimize}><Icon name="minimize" /></button>}
        {!panel && <button className="ms-icon" title={state.expanded ? '收起详情' : '展开详情'} onClick={meetings.expand}><Icon name={state.expanded ? 'collapse' : 'expand'} /></button>}
        {!panel && <button className="ms-icon" title="关闭浮窗" onClick={meetings.close}><Icon name="close" /></button>}
      </div>
    </header>
    {(state.expanded || panel) && <nav className="ms-tabs">{([['transcript', '实时记录'], ['details', '会议信息'], ['files', '纪要文件'], ['history', '历史会议']] as const).map(([id, label]) => <button key={id} className={`ms-tab ${state.tab === id ? 'is-active' : ''}`} onClick={() => meetings.setTab(id)}>{label}</button>)}</nav>}
    {state.error && <div className="ms-error" role="alert">{state.error}<button className="ms-icon" style={{ color: 'inherit', float: 'right', width: 20, height: 20 }} onClick={meetings.clearMessage}>×</button></div>}
    {state.notice && <div className="ms-notice">{state.notice}<button className="ms-icon" style={{ color: 'inherit', float: 'right', width: 20, height: 20 }} onClick={meetings.clearMessage}>×</button></div>}
    {transcriptVisible && <RecordingStatus />}
    {transcriptVisible && (state.expanded || panel) && <Speakers speakers={current?.speakers ?? []} />}
    {transcriptVisible ? <Transcript /> : state.tab === 'details' ? <Details /> : state.tab === 'files' ? <Files /> : <History />}
    {transcriptVisible && (state.expanded || panel) && <form className="ms-notebar" onSubmit={submitNote}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充一条人工记录…" disabled={!current} /><button type="submit" disabled={!note.trim() || !current}>添加</button></form>}
  </div>
}

export function MeetingApp({ panel = false }: { panel?: boolean }): ReactNode {
  if (panel || typeof document === 'undefined') return <MeetingView panel={panel} />
  return createPortal(<MeetingView />, document.body)
}

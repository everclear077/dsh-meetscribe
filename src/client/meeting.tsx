import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
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

function Transcript(): ReactNode {
  const { current, pending } = useMeetings()
  const [raw, setRaw] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [current?.segments.length, pending])
  if (!current || (current.segments.length === 0 && !pending)) return <div className="ms-transcript"><div className="ms-empty"><span className="ms-empty-wave"><i /><i /><i /><i /><i /></span><strong>{current?.status === 'recording' ? '正在聆听' : '准备好后，开始记录'}</strong><small>{current?.status === 'recording' ? '说完一句话后稍作停顿，定稿会自动出现在这里。灰色文字仍在识别。' : '按 Ctrl+E 可随时收起或唤出此窗口。识别在本机完成。'}</small></div></div>
  return <div className="ms-transcript" aria-live="polite">
    <div className="ms-row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}><button className="ms-icon" style={{ color: '#718094', width: 'auto', fontSize: 11 }} onClick={() => setRaw(!raw)}>{raw ? '显示清理文本' : '查看原始逐字稿'}</button></div>
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
  return <div className="ms-detail"><form className="ms-section" onSubmit={(e) => { e.preventDefault(); void meetings.saveMetadata(title, metadata) }}>
    <h3>会议信息</h3><div className="ms-fields">
      <label className="ms-field ms-wide">会议名称<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      {field('会议主题', 'topic')}{field('项目 / 部门', 'project')}{field('地点或会议链接', 'location')}{field('主持人', 'host')}{field('记录人', 'recorder')}
      <label className="ms-field">会议形式<select value={metadata.format} onChange={(e) => update('format', e.target.value as MeetingMetadata['format'])}><option value="online">线上</option><option value="offline">线下</option><option value="hybrid">混合</option></select></label>
      <label className="ms-field">保密级别<select value={metadata.confidentiality} onChange={(e) => update('confidentiality', e.target.value as MeetingMetadata['confidentiality'])}><option value="internal">内部</option><option value="confidential">机密</option><option value="public">公开</option></select></label>
      <label className="ms-field">出席人员（逗号分隔）<input value={metadata.attendees.join('，')} onChange={(e) => update('attendees', e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} placeholder="仅填写已确认人员" /></label>
      <label className="ms-field">缺席人员（逗号分隔）<input value={metadata.absentees.join('，')} onChange={(e) => update('absentees', e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} /></label>
      <label className="ms-field ms-wide">补充说明<textarea value={metadata.notes} onChange={(e) => update('notes', e.target.value)} /></label>
    </div><div className="ms-row" style={{ marginTop: 14 }}><button className="ms-action ms-primary" type="submit">保存会议信息</button><span className="ms-hint">这些信息会在生成 Word 时优先采用。</span></div>
  </form></div>
}

function Files(): ReactNode {
  const { current } = useMeetings()
  return <div className="ms-detail"><section className="ms-section"><h3>Word 会议纪要</h3>
    {!current?.generatedFiles.length && <div className="ms-empty"><strong>还没有生成文件</strong><small>结束录音后点击“生成纪要”。只有此时才会把逐字稿发送给 DSH 当前配置的大模型。</small></div>}
    {[...(current?.generatedFiles ?? [])].reverse().map((file) => <div className="ms-file" key={file.version}><span className="ms-file-icon">W</span><div className="ms-file-info"><strong>{current!.title} · 第 {file.version} 版</strong><small>{new Date(file.createdAt).toLocaleString('zh-CN')}</small></div><a className="ms-action" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }} href={`/meetscribe/meetings/${encodeURIComponent(current!.id)}/documents/${file.version}`} download>下载 .docx</a></div>)}
  </section></div>
}

function History(): ReactNode {
  const state = useMeetings()
  return <div className="ms-detail"><section className="ms-section"><div className="ms-row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>本机会议记录</h3><button className="ms-action" onClick={() => void meetings.create()}>新建会议</button></div>
    {state.meetings.length === 0 && <div className="ms-empty">还没有会议记录</div>}
    {state.meetings.map((meeting) => <button className="ms-history-item" key={meeting.id} onClick={() => void meetings.select(meeting.id)}><strong>{meeting.title}</strong><small>{meeting.segments?.length ?? 0} 段 · {new Date(meeting.updatedAt).toLocaleDateString('zh-CN')}</small></button>)}
  </section></div>
}

export function MeetingApp({ panel = false }: { panel?: boolean }): ReactNode {
  const state = useMeetings()
  const [note, setNote] = useState('')
  const current = state.current
  const recording = current?.status === 'recording'
  const submitNote = (event: FormEvent): void => { event.preventDefault(); void meetings.note(note); setNote('') }
  if (!panel && !state.open) return null
  return <div className={`ms-root ${panel ? 'ms-panel' : `ms-float ${state.expanded ? 'ms-expanded' : ''}`}`} role={panel ? undefined : 'dialog'} aria-label="MeetScribe 会议记录">
    <header className="ms-header"><div className="ms-brand"><Mark /><span>{current?.title || 'MeetScribe'}</span></div><span className={`ms-live ${recording ? 'is-live' : ''}`}>{recording ? '正在记录' : current?.status === 'paused' ? '已暂停' : '本地识别'}</span><span className="ms-spacer" />
      {!panel && <button className="ms-icon" title={state.expanded ? '收起详情' : '展开详情'} onClick={meetings.expand}><Icon name={state.expanded ? 'collapse' : 'expand'} /></button>}
      {!panel && <button className="ms-icon" title="关闭浮窗" onClick={meetings.close}><Icon name="close" /></button>}
    </header>
    <Speakers speakers={current?.speakers ?? []} />
    {(state.expanded || panel) && <nav className="ms-tabs">{([['transcript', '实时记录'], ['details', '会议信息'], ['files', '纪要文件'], ['history', '历史会议']] as const).map(([id, label]) => <button key={id} className={`ms-tab ${state.tab === id ? 'is-active' : ''}`} onClick={() => meetings.setTab(id)}>{label}</button>)}</nav>}
    {state.error && <div className="ms-error" role="alert">{state.error}<button className="ms-icon" style={{ color: 'inherit', float: 'right', width: 20, height: 20 }} onClick={meetings.clearMessage}>×</button></div>}
    {state.notice && <div className="ms-notice">{state.notice}<button className="ms-icon" style={{ color: 'inherit', float: 'right', width: 20, height: 20 }} onClick={meetings.clearMessage}>×</button></div>}
    {(!state.expanded && !panel) || state.tab === 'transcript' ? <Transcript /> : state.tab === 'details' ? <Details /> : state.tab === 'files' ? <Files /> : <History />}
    {((!state.expanded && !panel) || state.tab === 'transcript') && <>
      <form className="ms-notebar" onSubmit={submitNote}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充一条人工记录…" disabled={!current} /><button type="submit" disabled={!note.trim() || !current}>添加</button></form>
      <footer className="ms-controls">
        <button className={`ms-record ${recording ? 'is-recording' : ''}`} onClick={meetings.recordButton} disabled={state.busy}><span className="ms-record-dot" />{state.busy ? '请稍候' : recording ? '结束' : current?.status === 'paused' ? '继续' : '开始记录'}</button>
        <span className="ms-time">{clock(state.elapsed)}</span>
        {recording && <button className="ms-icon" style={{ color: '#637386' }} title="暂停" onClick={() => void meetings.pause()} disabled={state.busy}><Icon name="pause" /></button>}
        <select className="ms-source" value={state.source} onChange={(e) => meetings.setSource(e.target.value as 'microphone' | 'system' | 'mixed')} disabled={recording} title="音频来源"><option value="microphone">麦克风</option><option value="system">系统声音</option><option value="mixed">麦克风 + 系统</option></select>
        <span className="ms-spacer" /><button className="ms-action" onClick={() => void meetings.generate()} disabled={!current?.segments.length || state.generating || recording}>{state.generating ? '正在生成…' : '生成纪要'}</button>
      </footer>
    </>}
  </div>
}

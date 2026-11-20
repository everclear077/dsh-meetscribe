import { useEffect, useState, type ReactNode } from 'react'
import type { MeetScribeSettings } from '../shared/types.ts'
import { api } from './api.ts'

interface ModelState {
  asr?: { ready: boolean; repo: string }
  vad?: { ready: boolean }
  sense?: { ready: boolean; enabled: boolean }
  speaker?: { ready: boolean; loading: boolean }
  loading?: boolean
  progress?: { file: string; percent: number } | null
  error?: string
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }): ReactNode {
  return <div className="ms-setting-row"><div className="ms-setting-copy"><strong>{label}</strong><small>{description}</small></div><input className="ms-switch" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} /></div>
}

export function MeetingSettings(): ReactNode {
  const [settings, setSettings] = useState<MeetScribeSettings | null>(null)
  const [models, setModels] = useState<ModelState>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void api.settings().then(setSettings).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
    void api.models().then(setModels).catch(() => undefined)
    const events = new EventSource('/meetscribe/events')
    const update = (): void => { void api.models().then(setModels).catch(() => undefined) }
    events.addEventListener('asr-progress', update); events.addEventListener('asr-ready', update); events.addEventListener('asr-error', update)
    return () => events.close()
  }, [])
  const save = async (patch: Partial<MeetScribeSettings>): Promise<void> => {
    if (!settings) return
    const previous = settings
    setSettings({ ...settings, ...patch })
    try { setSettings(await api.saveSettings(patch)); setMessage('设置已保存') } catch (error: unknown) { setSettings(previous); setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const download = async (): Promise<void> => {
    setBusy(true); setMessage('正在下载并校验模型，请保持网络连接…')
    try { setModels(await api.downloadModels()); setMessage('所需模型已就绪') } catch (error: unknown) { setMessage(error instanceof Error ? error.message : String(error)); setModels(await api.models().catch(() => ({}))) } finally { setBusy(false) }
  }
  if (!settings) return <div className="ms-root ms-settings">正在读取 MeetScribe 设置…{message && <div className="ms-error">{message}</div>}</div>
  const asrReady = !!(models.asr?.ready && models.vad?.ready && (!settings.senseVoice || models.sense?.ready))
  const speakerReady = !settings.speakerEnabled || !!models.speaker?.ready
  return <div className="ms-root ms-settings">
    <h2 style={{ color: '#17253a', margin: '0 0 6px', fontSize: 20 }}>MeetScribe</h2><p className="ms-hint" style={{ marginTop: 0 }}>本地会议转写、说话人管理与 Word 纪要。默认快捷键 Ctrl+E。</p>
    {message && <div className={message.includes('失败') || message.includes('错误') ? 'ms-error' : 'ms-notice'} style={{ margin: '12px 0' }}>{message}</div>}
    <section className="ms-section"><h3>本地识别模型</h3>
      <div className="ms-row"><span className={`ms-live ${asrReady && speakerReady ? 'is-live' : ''}`} style={{ color: '#536476' }}>{asrReady && speakerReady ? '模型已就绪' : '需要下载模型'}</span><span className="ms-spacer" /><button className="ms-action ms-primary" disabled={busy} onClick={() => void download()}>{busy ? '正在准备…' : asrReady && speakerReady ? '检查模型' : '下载所需模型'}</button></div>
      <p className="ms-hint">流式 Zipformer 中文识别、Silero VAD{settings.senseVoice ? '、SenseVoice 定稿' : ''}{settings.speakerEnabled ? '与 CAM++ 说话人模型' : ''}。下载可能需要数百 MB；识别过程不依赖云端语音服务。</p>
      {models.progress && <><div className="ms-progress"><i style={{ width: `${Math.min(100, models.progress.percent)}%` }} /></div><small className="ms-hint">{models.progress.file} · {Math.floor(models.progress.percent)}%</small></>}
      {models.error && <div className="ms-error" style={{ margin: '10px 0 0' }}>{models.error}</div>}
    </section>
    <section className="ms-section"><h3>识别与说话人</h3>
      <Toggle label="启用说话人区分" description="根据声纹自动聚类。先显示匿名发言人，可在浮窗顶部重命名或合并。" checked={settings.speakerEnabled} onChange={(speakerEnabled) => void save({ speakerEnabled })} />
      <Toggle label="SenseVoice 定稿" description="句结束后再次识别，改善标点和中英混合文本；会增加本地计算与模型下载。" checked={settings.senseVoice} onChange={(senseVoice) => void save({ senseVoice })} />
      <Toggle label="逆文本规范化" description="把数字、日期等口语形式整理为更适合阅读的书面形式。" checked={settings.senseITN} onChange={(senseITN) => void save({ senseITN })} />
      <Toggle label="去除口语填充词" description="在清理视图中隐藏“嗯、呃”等常见填充词；原始逐字稿始终保留。" checked={settings.fillerRemoval} onChange={(fillerRemoval) => void save({ fillerRemoval })} />
      <div className="ms-setting-row"><div className="ms-setting-copy"><strong>说话人相似度阈值</strong><small>当前 {settings.speakerThreshold.toFixed(2)}。调低会减少匿名人数，调高会更倾向拆分新发言人。</small></div><input type="range" min="0.4" max="0.85" step="0.01" value={settings.speakerThreshold} onChange={(e) => void save({ speakerThreshold: Number(e.target.value) })} /></div>
      <div className="ms-setting-row"><div className="ms-setting-copy"><strong>句末静音</strong><small>连续静音达到此时长后定稿，当前 {settings.silenceMs} ms。</small></div><input type="number" min="500" max="4000" step="100" value={settings.silenceMs} onChange={(e) => void save({ silenceMs: Number(e.target.value) })} style={{ width: 90 }} /></div>
    </section>
    <section className="ms-section"><h3>存储与隐私</h3>
      <label className="ms-field">Word 输出目录<input value={settings.outputDir} onChange={(e) => setSettings({ ...settings, outputDir: e.target.value })} onBlur={() => void save({ outputDir: settings.outputDir })} /></label>
      <p className="ms-hint">逐字稿和说话人声纹只保存在本机。插件不保存录音。只有点击“生成纪要”时，文本才会发送给 DSH 当前选择的大模型；音频不会发送。</p>
      <Toggle label="启动时预加载模型" description="减少第一次记录的等待时间，但会在 DSH 启动后下载并加载本地模型。" checked={settings.preloadModels} onChange={(preloadModels) => void save({ preloadModels })} />
    </section>
  </div>
}

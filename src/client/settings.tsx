import { useEffect, useState, type ReactNode } from 'react'
import type { MeetScribeSettings } from '../shared/types.ts'
import { formatAsrReplacements, parseAsrReplacements } from '../shared/vocabulary.ts'
import { api } from './api.ts'
import { Icon } from './components.tsx'

interface ModelState {
  asr?: { ready: boolean; loaded: boolean; repo: string; variant?: string; files?: Array<{ exists: boolean }> }
  vad?: { ready: boolean; loaded: boolean }
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
  const [vocabularyDraft, setVocabularyDraft] = useState('')
  const [savingVocabulary, setSavingVocabulary] = useState(false)
  const [models, setModels] = useState<ModelState>({})
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void api.settings().then((value) => {
      setSettings(value)
      setVocabularyDraft(formatAsrReplacements(value.asrReplacements ?? []))
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
    void api.models().then(setModels).catch(() => undefined)
    const events = new EventSource('/meetscribe/events')
    const update = (): void => { void api.models().then(setModels).catch(() => undefined) }
    events.addEventListener('asr-progress', update); events.addEventListener('asr-ready', update); events.addEventListener('asr-error', update); events.addEventListener('models', update)
    return () => events.close()
  }, [])
  const save = async (patch: Partial<MeetScribeSettings>): Promise<boolean> => {
    if (!settings) return false
    const previous = settings
    setSettings({ ...settings, ...patch })
    try {
      setSettings(await api.saveSettings(patch))
      setMessage('设置已保存')
      return true
    } catch (error: unknown) {
      setSettings(previous)
      setMessage(error instanceof Error ? error.message : String(error))
      return false
    }
  }
  const saveVocabulary = async (): Promise<void> => {
    if (!settings || savingVocabulary) return
    setSavingVocabulary(true)
    try {
      const asrReplacements = parseAsrReplacements(vocabularyDraft)
      if (!await save({ asrReplacements })) return
      setVocabularyDraft(formatAsrReplacements(asrReplacements))
      setMessage(`术语表已保存，共 ${asrReplacements.length} 条；后续实时识别与定稿自动生效`)
    } catch (error: unknown) {
      setMessage(`术语表保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSavingVocabulary(false)
    }
  }
  const download = async (): Promise<void> => {
    setBusy(true); setMessage('正在下载、校验并加载本地模型；校验通过的现有文件会直接复用…')
    try { setModels(await api.downloadModels()); setMessage('所需模型已下载、校验并加载') } catch (error: unknown) { setMessage(error instanceof Error ? error.message : String(error)); setModels(await api.models().catch(() => ({}))) } finally { setBusy(false) }
  }
  const chooseDirectory = async (): Promise<void> => {
    if (choosing) return
    setChoosing(true)
    setMessage('')
    try {
      const { path } = await api.selectOutputDirectory()
      if (path) await save({ outputDir: path })
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setChoosing(false)
    }
  }
  if (!settings) return <div className="ms-root ms-settings">正在读取语音识别设置…{message && <div className="ms-error">{message}</div>}</div>
  const asrReady = !!(models.asr?.ready && models.vad?.ready)
  const speakerReady = !settings.speakerEnabled || !!models.speaker?.ready
  const allReady = asrReady && speakerReady
  const modelLabel = allReady ? '模型已就绪' : models.loading || busy ? '正在准备模型' : !models.asr ? '正在读取模型' : models.asr.files?.[0]?.exists === false ? '未安装本地模型' : '模型未就绪'
  return <div className="ms-root ms-settings">
    <header className="ms-settings-heading"><h2>语音识别</h2><p>MeetScribe 在本机完成会议转写与说话人区分，按需生成 Word 纪要。默认快捷键 Ctrl+E。</p></header>
    {message && <div className={message.includes('失败') || message.includes('错误') ? 'ms-error' : 'ms-notice'} style={{ margin: '12px 0' }}>{message}</div>}
    <section className="ms-section"><h3>本地识别模型</h3>
      <div className="ms-row"><span className={`ms-model-state ${allReady ? 'is-ready' : ''}`}>{modelLabel}</span><span className="ms-spacer" /><button className="ms-action ms-primary" disabled={busy || models.loading} onClick={() => void download()}>{busy || models.loading ? '正在准备…' : allReady ? '重新检查模型' : '检查并准备模型'}</button></div>
      <p className="ms-hint">transcribe.cpp 0.4.1 · SenseVoice Small Q8 · Silero VAD v6.2{settings.speakerEnabled ? ' · ERes2NetV2 声纹' : ''}。首次准备时，ASR/VAD 约需下载 254 MB{settings.speakerEnabled ? '，启用声纹后合计约 325 MB' : ''}，文件保存到 %LOCALAPPDATA%\dsh-meetscribe\models；固定地址下载，校验文件大小与 SHA-256 后才加载，已校验文件不会重复下载。SenseVoice 按音频段识别，默认 800ms 静音后整段定稿。</p>
      {models.progress && <><div className="ms-progress"><i style={{ width: `${Math.min(100, models.progress.percent)}%` }} /></div><small className="ms-hint">{models.progress.file} · {Math.floor(models.progress.percent)}%</small></>}
      {models.error && <div className="ms-error" style={{ margin: '10px 0 0' }}>{models.error}</div>}
    </section>
    <section className="ms-section"><h3>识别与说话人</h3>
      <Toggle label="启用说话人区分" description="根据声纹自动聚类。先显示匿名发言人，可在浮窗顶部重命名或合并。" checked={settings.speakerEnabled} onChange={(speakerEnabled) => void save({ speakerEnabled })} />
      <Toggle label="逆文本规范化" description="把数字、日期等口语形式整理为更适合阅读的书面形式。" checked={settings.senseITN} onChange={(senseITN) => void save({ senseITN })} />
      <Toggle label="去除口语填充词" description="在清理视图中隐藏“嗯、呃”等常见填充词；原始逐字稿始终保留。" checked={settings.fillerRemoval} onChange={(fillerRemoval) => void save({ fillerRemoval })} />
      <div className="ms-setting-row"><div className="ms-setting-copy"><strong>说话人相似度阈值</strong><small>当前 {settings.speakerThreshold.toFixed(2)}，默认 0.56。调低会减少同一人被拆成多个匿名发言人，但相似音色更容易合并；调高则相反。</small></div><input type="range" min="0.4" max="0.85" step="0.01" value={settings.speakerThreshold} onChange={(e) => void save({ speakerThreshold: Number(e.target.value) })} /></div>
      <div className="ms-setting-row"><div className="ms-setting-copy"><strong>句末静音</strong><small>连续静音达到此时长后定稿，当前 {settings.silenceMs} ms。默认 800 ms，减少过于灵敏的断句，并为声纹判断保留更长的语音上下文。连续讲话最长约 12 秒自动分段。</small></div><input type="number" min="500" max="4000" step="100" value={settings.silenceMs} onChange={(e) => void save({ silenceMs: Number(e.target.value) })} style={{ width: 90 }} /></div>
    </section>
    <section className="ms-section"><h3>行业术语纠正</h3>
      <div className="ms-setting-copy ms-vocabulary-copy"><strong>标准术语与常见误识别</strong><small>每行一条，用“=”分隔标准写法和误识别，用“|”分隔多个误识别。只替换明确配置的写法，不模糊猜词；同时作用于后续临时结果与整段定稿，原始识别文本仍保留。</small></div>
      <textarea className="ms-vocabulary" aria-label="行业术语纠正表" value={vocabularyDraft} onChange={(event) => setVocabularyDraft(event.target.value)} placeholder={'OKR = 欧凯尔 | 欧 k 尔\nAPI = 阿皮 | A P I'} spellCheck={false} />
      <div className="ms-row ms-vocabulary-actions"><span className="ms-hint">最多 100 条，每条最多 20 个误识别写法。示例仅演示格式，请按所在行业填写。</span><button type="button" className="ms-action ms-primary" disabled={savingVocabulary} onClick={() => void saveVocabulary()}>{savingVocabulary ? '正在保存…' : '保存术语表'}</button></div>
    </section>
    <section className="ms-section"><h3>存储与隐私</h3>
      <div className="ms-setting-copy ms-directory-setting"><strong>Word 输出目录</strong><small>点击选择 Windows 文件夹，生成的 Word 纪要会保存在这里。</small></div>
      <button type="button" className="ms-directory" onClick={() => void chooseDirectory()} disabled={choosing} title={settings.outputDir}>
        <Icon name="folder" /><span>{settings.outputDir}</span><strong>{choosing ? '正在选择…' : '选择文件夹'}</strong>
      </button>
      <p className="ms-hint">逐字稿和说话人声纹只保存在本机。插件不保存录音。只有点击“生成纪要”时，文本才会发送给 DSH 当前选择的大模型；音频不会发送。</p>
      <Toggle label="启动时预加载模型" description="减少第一次记录的等待时间；DSH 启动后只预加载已经安装的 ASR/VAD，声纹模型按需加载，不会静默下载模型文件。" checked={settings.preloadModels} onChange={(preloadModels) => void save({ preloadModels })} />
    </section>
  </div>
}

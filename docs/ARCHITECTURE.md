# dsh-meetscribe 技术架构

更新日期：2026-11-21
状态：v0.1 实际实现说明

## 1. 进程与数据流

```text
其他应用（Windows）
       │ Ctrl+E
       ▼
MeetScribeHotkey.exe ── 临时注销热键并转发按键 ──▶ Harness 主窗口
                                                    │
Harness Browser Client                             │
├─ shell.overlay / 右侧会议面板 / 左侧独立工作台     │
├─ 应用内 shortcuts + DOM 兼容兜底                  │
├─ getUserMedia / AudioWorklet / 16 kHz 重采样      │
├─ 浏览器 RMS 静音分段（默认 800ms）                │
└─ 会议控制器 + SSE 订阅                            │
       │ 本地 HTTP：PCM、控制、元数据                ▼
       ▼                                    Harness Cordis Host
       └────────────────────────────────────────────▶ /meetscribe
                                                    ├─ Orca transcribe.cpp 0.4.1
                                                    │  ├─ SenseVoice Small Q8 GGUF
                                                    │  └─ Silero VAD v6.2 GGUF
                                                    ├─ ERes2NetV2 embedding + 聚类
                                                    ├─ 原子 JSON 会议存储
                                                    ├─ 显式 LLM 调用
                                                    └─ 结构化校验 + 原生 DOCX
```

浮窗是 Harness 的 `shell.overlay`，不是独立原生窗口。Windows 助手只负责全局 Ctrl+E，不负责音频、识别或系统级浮窗。

## 2. Browser Client

入口：`src/client/client.tsx`

注入点：

- `shell.overlay`：紧凑/展开会议窗口；
- `conversation.input.right`：输入框入口；
- `sidebar.panellist`：左侧 MeetScribe 独立入口；
- `main`：纪要文档库与识别设置组成的主工作台；
- `sidebar.right.pane.tab`：右侧会议面板；
- `shortcuts`：应用内 Ctrl+E。

`meeting-controller.ts` 使用 `useSyncExternalStore` 管理会议状态、历史、计时、真实音量电平、说话人操作和生成任务。浮窗从关闭状态打开时自动开始或继续默认麦克风录音；SSE 接收 Host 的会议与模型事件。非 panel 浮窗通过 `react-dom` Portal 挂载到 `document.body`，避免被 `shell.overlay` 父级层叠上下文或左侧栏遮挡；录音控制位于顶部。

### 独立文档工作台

`workspace.tsx` 通过 `sidebar.panellist` 注册左侧 MeetScribe 图标，并以 `main` 插槽渲染完整主界面。默认“纪要文件”视图使用 `useMeetings()` 订阅现有会议存储，不建立第二份数据副本；`shared/documents.ts` 将每场会议的 `generatedFiles` 展平为文件条目，提供文件名/会议名称/路径搜索及名称、时间正倒序。每个版本使用原有 `/meetings/:id/documents/:version` 下载路由，不接受任意文件路径。

“识别设置”复用 `MeetingSettings` 和既有 Settings/Model API；卸载 Harness `settings.section` 只改变入口，不改变设置持久化或识别行为。会议生成、删除和清空事件仍通过 SSE 更新同一控制器，工作台也可手动刷新摘要列表。

### 音频与分段

- 默认 `getUserMedia` 获取系统默认单声道麦克风；当前会议控制器不暴露设备或来源选择器。
- 启用回声消除，关闭自动增益与浏览器噪声抑制。
- AudioWorklet 优先，ScriptProcessor 作为兼容兜底；真实采集电平节流后驱动浮窗声波。
- 重采样到 16 kHz Float32 PCM，以 `sessionId + epoch + offset + final` 上传。
- 浏览器 RMS 检测语音；默认连续静音 800ms 定稿，连续讲话最长约 12 秒自动分段。
- partial 请求约每 100ms 增量上传，但 Orca 模型本身不是流式模型；Host 按有界间隔刷新临时快照，不是在浏览器中运行流式解码。
- 当前 UI 不提供系统/混合采集入口。底层 `getDisplayMedia` 路径在 Harness 0.2.2-rc.5 实测拒绝该权限，成功路径尚未验证。
- 自定义 MediaStream 的 track、AudioContext 和监听器在暂停、停止或异常时释放；关闭和最小化浮窗不会释放采集。

## 3. Host HTTP 边界

入口：`src/index.ts`，通过 `ctx.webServer.register` 注册 `/meetscribe` 前缀。

主要路由：

```text
GET  /health
GET  /events
POST /asr
GET/PUT /settings
GET  /models/status
POST /models/download
GET  /hotkey/status
GET/POST/DELETE /meetings
GET/PATCH/DELETE /meetings/:id
POST /meetings/:id/start|pause|resume|finish|clear
POST /meetings/:id/segments
PATCH /meetings/:id/speakers/:speakerId
POST /meetings/:id/speakers/merge
POST /meetings/:id/segments/:segmentId/speaker
POST /meetings/:id/generate
GET  /meetings/:id/documents/:version
```

`/models/download` 保留现有路由名以兼容客户端，但实际行为是检查并加载 Orca 已下载的 ASR/VAD GGUF，再按需下载和校验声纹模型；不会下载 Zipformer 或 sherpa-onnx SenseVoice。

安全规则：loopback-only、写操作同源检查、请求体大小限制、Word 下载路径来自已登记文件，不接收任意文件路径。

## 4. Orca ASR、VAD 与说话人

### 4.1 模型发现与加载

`src/host/orca-asr-runtime.ts` 直接复用本机 Orca 的模型目录：

| 用途 | 引擎与模型 | 默认位置（`%APPDATA%` 下） |
| --- | --- | --- |
| 文字识别 | transcribe.cpp 0.4.1 / `SenseVoiceSmall-Q8_0.gguf` | `orca/speech-models/sense-voice-zh-en-ja-ko-yue/` |
| 帧级语音检测 | transcribe.cpp 0.4.1 / `silero-vad-v6.2-F32.gguf` | `orca/speech-models/silero-vad-v6.2/` |
| 声纹 | `sherpa-onnx-node` / ERes2NetV2 ONNX | `%LOCALAPPDATA%/dsh-meetscribe/models/speaker/` |

本机 Orca 1.4.268 中实际存在上述两个 GGUF；未把 Orca 支持但未下载的 Whisper 或 Parakeet 当作当前模型。transcribe.cpp 要求 Node 22+；Harness Host 和构建环境均满足。Host 以 `backend: 'cpu'` 加载，使用 npm `transcribe-cpp@0.4.1` 及对应原生包，不启动 Orca 进程，也不把音频发给 Orca 服务。

SenseVoice Small Q8 的能力经真实加载确认：16 kHz，中文/粤语/英文/日文/韩文，支持 ITN，最大音频 30 秒，不支持原生流式、vocabulary 或 context prompt。当前 12 秒浏览器分段低于模型上限；Host 另设 30 秒防御上限。

ASR 不再包含 Streaming Zipformer，也不包含 sherpa-onnx SenseVoice worker 或任何 sherpa ASR 降级路径。`sherpa-onnx-node` 仅保留给 ERes2NetV2 声纹嵌入；它不是文字识别引擎。

### 4.2 非流式模型的临时结果与定稿

Orca SenseVoice 的调用单位是完整 PCM 段：

1. Host 按 `sessionId + epoch` 累积增量 PCM，并按 `offset` 去重；缺口直接报错。
2. 模型加载后，段长至少 0.4 秒、距上次快照至少 900ms 且有足够新音频时，启动一次后台快照识别。
3. 快照是不可变副本；原生调用借用该 PCM 直到 Promise 完成，期间不会追加或修改它。
4. partial HTTP 请求返回最近一次已完成快照，不等待本次新快照，因此协议仍轻量，但文字刷新粒度受快照间隔与推理耗时影响。
5. `final=1` 复用覆盖全部音频的在途快照，否则对完整段重新识别；800ms 静音分段来自浏览器，不由 SenseVoice 伪造成流式端点。
6. 一个 ASR 模型上的原生计算通过 Host 队列串行执行；同一 epoch 的并发 final 共享同一个 Promise 和缓存结果。
7. `reset` 的代际计数防止在途旧结果写入复用 epoch；final 后还会再次检查会议是否仍存在，避免清空/删除后的旧文本写回。
8. 原始模型文本与术语纠正后的展示文本分别返回和持久化；ITN 在每次推理时读取最新设置，无需重建模型。

这是一种“分段期间刷新临时结果、句末整段定稿”的适配，不应描述为 SenseVoice 原生实时流式输出。

### 4.3 VAD

会议断句由浏览器 RMS 和 800ms 静音设置决定。Orca Silero VAD GGUF 用于 `detect()` / `vadOnly=1` 帧级语音检测通道；VAD session 独立串行，reset 时清理。它不是 Zipformer 的附属组件，也不再负责两个 ASR 引擎之间的切换。

### 4.4 声纹聚类

`speaker-identifier.ts` 使用 `sherpa-onnx-node` 的 `SpeakerEmbeddingExtractor`。短于 0.8 秒的段不计算声纹。嵌入与既有簇质心计算余弦相似度，达到阈值则归入该说话人，否则创建匿名标签，直到达到最大人数。默认新建标签阈值由 0.62 调整为 **0.56**，配合默认 800ms 句末静音减少短段造成的同一人过度拆分；降低阈值也会增加相似音色被合并的可能，因此保留设置项和人工合并/重指派能力。

Electron 环境禁止 native external ArrayBuffer，因此调用 `extractor.compute(stream, false)`，让 N-API 返回 JavaScript 拥有的副本。公开 HTTP 会议响应会移除 embedding；本地 JSON 保留它供聚类使用。

当前是在线匿名聚类，不是注册身份识别，也没有离线全局重分段。重叠语音可能产生误分。Orca 当前没有已下载的说话人分离模型，因此没有把文字模型更换误称为声纹模型更换。

模型选择使用 `scripts/evaluate-speaker-models.mjs` 对 sherpa-onnx release 的公开说话人音频做同条件对照。ERes2NetV2 相比此前 CAM++ 的完整句同人平均相似度为 0.8333 / 0.8046，最短同人与最高异人分数间隔为 0.3978 / 0.3208；0.8 秒窗口的同人平均相似度为 0.6349 / 0.5628。样本规模较小且不是真人会议室，结果只支持本次模型选择，不构成泛化准确率承诺。

另用本机 ERes2NetV2 对 6 段同一 Windows Huihui 合成语音做完整段、1.5 秒与 0.8 秒截断诊断。完整段和 1.5 秒输入在 0.62 下均保持一个标签；0.8 秒输入中有一段与既有质心相似度降至 0.577，旧阈值 0.62 将其错误新建为 `speaker-2`，0.56 则全部保持 `speaker-1`。随后加入的 Zira 不同声音相似度约 0.331，在 0.56 下仍新建独立标签。该诊断解释了本次阈值调整，但不证明真实会议室或相似音色的分离准确率。

### 4.5 术语纠正

`src/shared/vocabulary.ts` 负责全局规则的解析、长度/数量限制和持久化规范化；`src/host/text-replacements.ts` 编译大小写不敏感、最长优先、英文整词边界、中英空白容忍的单次替换器。

当前 Orca SenseVoice GGUF 不支持 vocabulary 或 context prompt，因此保留确定性文本纠正，而不是宣称模型能够原生接收热词。Host 在 ASR 共同文本出口套用规则，覆盖临时结果和最终整段识别；替换器按设置数组身份缓存。原始模型文本和纠正后的展示文本分别写入会议 JSON，生成纪要使用展示文本。

## 5. 持久化

`meeting-store.ts` 每场会议一个 JSON：

- 稳定 meeting、speaker、segment ID；
- 原始文本和显示文本；
- 时间、来源、说话人置信度、revision；
- 用户元数据和生成文件版本；
- 改名、合并、逐段指派和订阅事件。

写入流程为临时文件 → `rename`，删除旧会议前先等待其待处理写入，避免清空后的旧异步写入重新创建文件。启动时把异常中断的 recording 状态恢复为可操作状态。设置同样采用原子写入和范围校验；旧 `modelHost`、`senseVoice` 字段在读取时迁移丢弃，输出目录、800ms 分段、ITN 和术语表保持不变。

清空采用替换语义：Host 先重置该会议的 ASR、音频与说话人状态并解除活动会议，再删除旧会议，创建带新 ID 的空白会议；标题、元数据和生成文件版本保留，segments、speakers 与 vocabulary 清空。新 ID 配合 epoch/会话校验，防止在途 final 请求把旧文本写回。

`DELETE /meetings` 重置并删除全部会议，用于历史记录的二次确认清空；若调用前正在录音，客户端随后自动创建空白会议并重新开始默认麦克风采集。它不会删除输出目录中已经生成的 Word 文件。

Windows 数据目录：`%LOCALAPPDATA%\dsh-meetscribe`。当前不保存原始音频文件。

## 6. 显式 LLM 与 Word

只有 `POST /meetings/:id/generate` 会进入 LLM 路径：

```text
术语纠正后的展示逐字稿 + segmentId + 说话人 + 用户元数据
       ↓
Harness 当前默认模型（流式 text-delta 收集）
       ↓
JSON 提取 + 严格 schema 校验
       ↓
docx 原生 OOXML 渲染
       ↓
版本化文件名 + Meeting.generatedFiles
```

用户元数据具有权威性。提示词禁止虚构参会人、负责人、日期、地点和决议，未知字段使用“待补充/待确认”。源 segmentId 用于追溯，但当前没有自动验证每条模型总结是否真正忠实于该段，仍需人工复核。

`src/word/document.ts` 使用 A4、中文字体、固定 DXA 列宽、真实 numbering、页码和重复表头。输出不经过 Markdown。当前一次性发送整场会议；长会议的分块和层级总结属于后续工作。

## 7. 全局热键

`native/MeetScribeHotkey.cs` 使用 Win32 `RegisterHotKey` 注册 Ctrl+E。触发后：

1. 找到 Harness 主窗口并前台化；
2. 临时 `UnregisterHotKey`，避免助手拦截自己的合成输入；
3. 注入 Ctrl+E；
4. 恢复热键注册。

客户端只让 Harness shortcuts 或 DOM 兜底其中一条路径生效，避免双切换。冲突写入 `%LOCALAPPDATA%\dsh-meetscribe-hotkey-error.log`。

## 8. 构建与测试

`build.mjs` 生成：

- `lib/index.js`：Host ESM，目标 Node 22；
- `lib/word/index.js`：Word 测试/样例入口；
- `lib/client.js`：Browser CJS ModuleLoader 包。

Host 的 Cordis、`transcribe-cpp`、声纹用 `sherpa-onnx-node` 和 Node built-in 保持 external；Client 的 React、ReactDOM 由宿主提供。AudioWorklet 先编译为 IIFE，再注入 Client。旧 `sense-worker.mjs` 和 sherpa ASR 依赖已移除。

质量命令：

```powershell
npm run verify
npm run sample:word
npm run sample:ui
```

真实 Orca 模型与 Host 链路复测（使用自行准备的 16 kHz 单声道 PCM16 WAV）：

```powershell
node scripts/smoke-orca-asr.mjs <sample.wav> [...more.wav]
node scripts/smoke-harness-orca.mjs http://127.0.0.1:<host-port> <sample.wav>
```

后者创建一个明确标记的合成测试会议，验证 partial、final、持久化和公开响应不泄露 embedding，最后只删除该测试会议。真实桌面验证和限制见根目录 `TESTING.md`。

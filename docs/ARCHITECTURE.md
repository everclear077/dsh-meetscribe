# dsh-meetscribe 技术架构

更新日期：2026-11-22
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
├─ 连续 Silero VAD 会议分段（RMS 故障回退）       │
└─ 会议控制器 + SSE 订阅                            │
       │ 本地 HTTP：PCM、控制、元数据                ▼
       ▼                                    Harness Cordis Host
       └────────────────────────────────────────────▶ /meetscribe
                                                    ├─ transcribe.cpp 0.4.1
                                                    │  ├─ SenseVoice Small Q8 GGUF
                                                    │  └─ Silero VAD v6.2 GGUF
                                                    ├─ ERes2NetV2 embedding + 聚类
                                                    ├─ 原子 JSON 会议存储
                                                    ├─ Host 内存纪要任务 + SSE 进度
                                                    ├─ 本地模板目录 + 不可信 DOCX 校验
                                                    ├─ 显式 LLM 调用 / DSH 对话草稿
                                                    ├─ 结构化校验 + 原生/自定义模板 DOCX
                                                    └─ officeKit.convert → 内置 PDF 预览
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
- `shortcuts`：应用内 Ctrl+E；
- `uiWorkspace.startSession`：把完整会议整理提示作为 DSH 对话草稿追加，不自动发送。

`meeting-controller.ts` 使用 `useSyncExternalStore` 管理会议状态、历史、计时、真实音量电平、说话人操作和生成任务。浮窗从关闭状态打开时自动开始或继续默认麦克风录音；SSE 接收 Host 的会议、模型、`minutes-task` 与任务移除事件。非 panel 浮窗通过 `react-dom` Portal 挂载到 `document.body`，避免被 `shell.overlay` 父级层叠上下文或左侧栏遮挡；录音控制位于顶部。

“在 DSH 对话中整理”先从 loopback Host 构造包含完整展示逐字稿、人工元数据和事实约束的提示，再调用 `ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })`。Harness 负责工作区、会话选择、模型路由和 composer；追加模式不覆盖已有草稿，插件不执行发送。该路径生成 Markdown 对话结果，不自动进入 DOCX 服务。

### 独立文档工作台

`workspace.tsx` 通过 `sidebar.panellist` 注册左侧 MeetScribe 图标，并以 `main` 插槽渲染完整主界面。默认“纪要文件”视图使用 `useMeetings()` 订阅现有会议存储，不建立第二份数据副本；`shared/documents.ts` 将每场会议的 `generatedFiles` 展平为文件条目，提供文件名/会议名称/路径搜索及名称、时间正倒序。文件列表和已完成任务只提交 `meetingId + version` 到 `/meetings/:id/documents/:version/preview`，Host 从会议记录解析实际路径，Client 不接受或提交任意文件路径。

`src/client/document-preview.tsx` 是独立工作台、已完成任务和浮窗“纪要文件”共用的预览组件。它获取 Host 返回的 PDF，强制检查 `application/pdf`，以 Object URL 在 MeetScribe 自己的 modal/iframe 中展示；卸载时中止请求并释放 URL。组件通过 React Portal 挂载到 `document.body` 并保留 `ms-root` 主题变量，避免被浮窗的 transform/overflow 层叠上下文裁剪或让浮窗盖住弹窗。它不调用 `shell.openExternal`、文件管理器或外部 Office。独立工作台不能假定右侧栏存在已挂载 Session，因此没有采用依赖 Session surface 的 `sidebarRight.openResource()`。

“识别设置”复用 `MeetingSettings` 和既有 Settings/Model API；卸载 Harness `settings.section` 只改变入口，不改变设置持久化或识别行为。纪要模型区域另调用 `/minutes-models`，直接读取 DSH 对话选择器的同一份 `sessionController.modelCatalog()`，保持 Provider 分组、顺序和 reasoning 元数据。`minutesModel=null` 表示跟随 DSH；显式路由只用于新 Word 任务，不写回 DSH 默认模型。会议生成、删除和清空事件仍通过 SSE 更新同一控制器，工作台也可手动刷新摘要列表。

`MinutesTemplateManager` 调用 `/minutes-templates` 上传、选择默认和删除本地模板。上传使用原始 File body，不在浏览器自行构造 multipart；列表只显示内置模板与本地索引中的用户模板，切换默认只影响之后的新任务。

工作台同时渲染 `state.minutesTasks`：running 任务固定在文档列表之前，展示准备、模型、解析和 Word 四阶段、单调进度及模型已接收字符数；失败卡片保留 Host 错误并提供重试，完成卡片按 `meetingId + version` 打开内置 PDF 预览。导航显示进行中数量，空文档列表不会隐藏任务。Client 忽略乱序的旧任务快照，重试时用新 running 任务替换同会议 failed 卡片。

### 音频与分段

- 默认 `getUserMedia` 获取系统默认单声道麦克风；当前会议控制器不暴露设备或来源选择器。
- 启用回声消除，关闭自动增益与浏览器噪声抑制。
- AudioWorklet 优先，ScriptProcessor 作为兼容兜底；真实采集电平节流后驱动浮窗声波。
- 重采样到 16 kHz Float32 PCM，以 `sessionId + epoch + offset + final` 上传。
- 会议以连续 Silero VAD 开段，保留 1.5 秒滚动前置音频；默认连续静音 800ms 定稿，连续讲话最长约 12 秒自动分段。VAD 暂不可用或请求失败时回退 RMS，避免检测加载期间静默。
- VAD 响应按全局样本序号对齐；partial 只上传已检测部分，final 保留在途尾部给下一段，防止异步边界丢字或重复。
- partial 请求约每 100ms 增量上传，但 模型本身不是流式模型；Host 按有界间隔刷新临时快照，不是在浏览器中运行流式解码。
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
GET  /minutes-tasks
GET  /minutes-models                    # 仅模型路由与能力元数据，无凭据
GET  /minutes-templates
POST /minutes-templates?fileName=...     # 原始 DOCX bytes，最大 10 MB
PUT  /minutes-templates/default
DELETE /minutes-templates/:uuid
GET/POST/DELETE /meetings
GET/PATCH/DELETE /meetings/:id
POST /meetings/:id/start|pause|resume|finish|clear
POST /meetings/:id/segments
PATCH /meetings/:id/speakers/:speakerId
POST /meetings/:id/speakers/merge
POST /meetings/:id/segments/:segmentId/speaker
POST /meetings/:id/generate                 # 202 + MinutesTask
POST /meetings/:id/conversation-prompt      # 仅构造草稿文本，不调用 LLM
GET  /meetings/:id/documents/:version/preview   # 仅 PDF inline；无原样 DOCX 下载路由
```

`/models/download` 由 `LocalModelManager` 依次准备 ASR、VAD，并在启用说话人时准备声纹模型。每类文件按固定地址、大小和 SHA-256 下载或复用，完成后立即调用原生运行时加载；同一模型的并发准备任务共享 Promise。ASR/VAD 主地址连接失败会尝试内置备用镜像，完整性约束不变。启动预加载不触发下载；录音中的声纹懒加载只检查并加载已安装的有效文件，不会隐式下载。活动录音期间禁止安装或修复模型，模型准备期间 start/resume 返回 409，避免两条流程竞争。

安全规则：loopback-only、写操作同源检查、请求体大小限制、Word 预览路径来自已登记文件，不接收任意文件路径。模板上传限制原始字节数，并在写入本地索引前完成 ZIP/XML 安全校验；模板目录不进入 Git，模板字节不进入 LLM 请求。

## 4. 本地模型、ASR、VAD 与说话人

### 4.1 下载、校验与加载

`src/host/model-manager.ts` 集中声明三类模型的固定地址、文件大小和 SHA-256，并统一保存到 `%LOCALAPPDATA%\dsh-meetscribe\models`：

| 用途 | 引擎与模型 | 插件模型目录 |
| --- | --- | --- |
| 文字识别 | transcribe.cpp 0.4.1 / `SenseVoiceSmall-Q8_0.gguf` | `asr/` |
| 帧级语音检测 | transcribe.cpp 0.4.1 / `silero-vad-v6.2-F32.gguf` | `vad/` |
| 声纹 | `sherpa-onnx-node` / ERes2NetV2 ONNX | `speaker/` |

`LocalModelManager.ensure()` 先检查现有文件的精确大小和 SHA-256，匹配则直接复用。缺失或不匹配时从固定 HTTPS 地址下载；ASR/VAD 主地址连接失败会尝试内置备用镜像，摘要保持一致。初始 URL 和每次重定向都执行主机允许列表检查。每个文件写入唯一 `.part` 路径，验证通过后才替换正式文件，失败会清理临时文件并保留旧文件。同一模型的并发准备共享同一个 Promise。准备路由会把是否实际替换文件传给运行时：ASR 等待在途推理后重建实例，VAD 清理旧会话后重建实例，声纹在实际替换后重建 extractor；单纯缓存命中不重复加载。

`src/host/local-asr-runtime.ts` 只接收上述插件模型路径，不再探测外部应用目录。transcribe.cpp 要求 Node 22+；Host 以 `backend: 'cpu'` 加载 ASR/VAD。SenseVoice Small Q8 为 16 kHz，支持中文、粤语、英文、日文、韩文和 ITN，最大音频 30 秒，不支持原生流式、vocabulary 或 context prompt。当前 12 秒浏览器分段低于模型上限，Host 另设 30 秒防御上限。

ASR 不包含 Streaming Zipformer、sherpa-onnx SenseVoice worker 或云端 ASR 降级路径。`sherpa-onnx-node` 仅保留给 ERes2NetV2 声纹嵌入。

### 4.2 非流式模型的临时结果与定稿

SenseVoice 的调用单位是完整 PCM 段：

1. Host 按 `sessionId + epoch` 累积增量 PCM，并按 `offset` 去重；缺口直接报错。
2. 模型加载后，段长至少 0.4 秒、距上次快照至少 900ms 且有足够新音频时，启动一次后台快照识别。
3. 快照是不可变副本；原生调用借用该 PCM 直到 Promise 完成，期间不会追加或修改它。
4. partial HTTP 请求返回最近一次已完成快照，不等待本次新快照，因此协议仍轻量，但文字刷新粒度受快照间隔与推理耗时影响。
5. `final=1` 复用覆盖全部音频的在途快照，否则对完整段重新识别；800ms 静音分段来自客户端连续 VAD 结果，不由 SenseVoice 伪造成流式端点。
6. 一个 ASR 模型上的原生计算通过 Host 队列串行执行；同一 epoch 的并发 final 共享同一个 Promise 和缓存结果。
7. `reset` 的代际计数防止在途旧结果写入复用 epoch；final 后还会再次检查会议是否仍存在，避免清空/删除后的旧文本写回。
8. 原始模型文本与术语纠正后的展示文本分别返回和持久化；ITN 在每次推理时读取最新设置，无需重建模型。

这是一种“分段期间刷新临时结果、句末整段定稿”的适配，不应描述为 SenseVoice 原生实时流式输出。

### 4.3 VAD

会议以 Silero VAD GGUF 的连续 `detect()` / `vadOnly=1` 帧级结果开段，并按 800ms 静音设置定稿；1.5 秒 prePad 覆盖检测窗和异步响应。VAD 不可用、请求失败或积压时回退 RMS，首个有效响应后恢复 VAD。VAD session 独立串行并跨 ASR epoch 保持连续，会话 start/stop/discard 时清理。它不负责 ASR 模型之间的切换。

### 4.4 声纹聚类

`speaker-identifier.ts` 使用 `sherpa-onnx-node` 的 `SpeakerEmbeddingExtractor`。短于 0.8 秒的段不计算声纹。嵌入与既有簇质心计算余弦相似度，达到阈值则归入该说话人，否则创建匿名标签，直到达到最大人数。新装默认新建标签阈值为 **0.65**，已有用户自定义值不做自动迁移。已有会议每次识别前应用最新阈值和最大人数，不重建聚类器。

只有相似度达到 `max(0.72, threshold + 0.06)` 的高置信匹配才增量更新质心；边界匹配可以保留当次标签，但不能把既有质心拉向可能是新声音的样本。该策略配合 0.65 修复了“一次边界误并后，后续不同声音持续合并”的在线聚类问题。阈值仍是折中：调低会减少同一人拆分，却更容易合并不同声音，因此保留设置项和人工合并/重指派能力。

Electron 环境禁止 native external ArrayBuffer，因此调用 `extractor.compute(stream, false)`，让 N-API 返回 JavaScript 拥有的副本。公开 HTTP 会议响应会移除 embedding；本地 JSON 保留它供聚类使用。

当前是在线匿名聚类，不是注册身份识别，也没有离线全局重分段。重叠语音可能产生误分；文字识别模型与声纹模型是两条独立链路，不能把其中一种模型的能力误称为另一种。

模型选择使用 `scripts/evaluate-speaker-models.mjs` 对 sherpa-onnx release 的公开说话人音频做同条件对照。ERes2NetV2 相比此前 CAM++ 的完整句同人平均相似度为 0.8333 / 0.8046，最短同人与最高异人分数间隔为 0.3978 / 0.3208；0.8 秒窗口的同人平均相似度为 0.6349 / 0.5628。样本规模较小且不是真人会议室，结果只支持本次模型选择，不构成泛化准确率承诺。

此前用本机 ERes2NetV2 对 6 段同一 Windows Huihui 合成语音做完整段、1.5 秒与 0.8 秒截断诊断，曾据此采用 0.56 减少短句拆分。本轮新增两种系统语音的明确双人回归后，发现 0.56 会把不同声音全部合并；当前因此改用 0.65 和保守质心更新。真实 ERes2NetV2 复测中，两种发言顺序都形成两个标签并正确归类后续段。短段旧样本继续作为显式 0.56 回归，而不是声称一个阈值适合所有场景。这些诊断都不证明真人会议室、远场或重叠语音的分离准确率。

### 4.5 术语纠正

`src/shared/vocabulary.ts` 负责全局规则的解析、长度/数量限制和持久化规范化；`src/host/text-replacements.ts` 编译大小写不敏感、最长优先、英文整词边界、中英空白容忍的单次替换器。

当前 SenseVoice GGUF 不支持 vocabulary 或 context prompt，因此保留确定性文本纠正，而不是宣称模型能够原生接收热词。Host 在 ASR 共同文本出口套用规则，覆盖临时结果和最终整段识别；替换器按设置数组身份缓存。原始模型文本和纠正后的展示文本分别写入会议 JSON，生成纪要使用展示文本。

## 5. 持久化

`meeting-store.ts` 每场会议一个 JSON：

- 稳定 meeting、speaker、segment ID；
- 原始文本和显示文本；
- 时间、来源、说话人置信度、revision；
- 用户元数据和生成文件版本；
- 改名、合并、逐段指派和订阅事件。

写入流程为临时文件 → `rename`，删除旧会议前先等待其待处理写入，避免清空后的旧异步写入重新创建文件。启动时把异常中断的 recording 状态恢复为可操作状态。设置同样采用原子写入和范围校验；旧 `modelHost`、`senseVoice` 字段在读取时迁移丢弃，输出目录、800ms 分段、ITN 和术语表保持不变。新增 `minutesModel` 只保留 provider、model 和可选 reasoningEffort，未知字段（包括任何凭据字段）不会进入规范化结果；缺省为 null。`minutesIdleTimeoutMs` 限制在 60000–1800000，缺省 300000。`minutesTemplateId` 缺省为 null（内置模板），只接受自定义模板 UUID。

`MinutesTemplateStore` 把用户 DOCX 和 `index.json` 保存在 `%LOCALAPPDATA%\dsh-meetscribe\templates`。用户文件名只用于显示，磁盘文件名为 UUID；上传先验证再写文件，索引原子更新，失败时回滚内存状态并清理未完成上传。目录接口始终包含内置模板；删除默认模板由 Host 路由把设置恢复为 null。`snapshot()` 每次重新读取并验证字节，返回的 Buffer 是任务启动时的不可变输入，不依赖模板之后是否仍存在。

清空采用替换语义：Host 先重置该会议的 ASR、音频与说话人状态并解除活动会议，再删除旧会议，创建带新 ID 的空白会议；标题、元数据和生成文件版本保留，segments、speakers 与 vocabulary 清空。新 ID 配合 epoch/会话校验，防止在途 final 请求把旧文本写回。

`DELETE /meetings` 重置并删除全部会议，用于历史记录的二次确认清空；若调用前正在录音，客户端随后自动创建空白会议并重新开始默认麦克风采集。它不会删除输出目录中已经生成的 Word 文件。

`MinutesTaskManager` 只把任务保存在 Host 内存，按会议维护 active lock；同会议 running 时重复生成返回原任务，终态后释放锁，最多保留 20 个已结束任务。删除会议、清空逐字稿或清空历史后移除对应终态任务，并用 `minutes-tasks-removed` 同步所有 Client。running 任务期间禁止这些破坏性操作。Harness 进程重启不会恢复任务列表，但已落盘的会议与 Word 版本不受影响。

Windows 数据目录：`%LOCALAPPDATA%\dsh-meetscribe`。当前不保存原始音频文件。

## 6. 显式 LLM 与 Word

Word 生成路径只有用户点击后的 `POST /meetings/:id/generate` 会进入 LLM；独立的 DSH 对话路径只在用户检查草稿并主动发送后由 Harness 调用模型：

```text
术语纠正后的展示逐字稿 + segmentId + 说话人 + 用户元数据
       ↓
读取并验证 minutesTemplateId 对应的本地模板字节，固定任务快照
       ↓
MeetScribe 显式纪要模型；minutesModel=null 时读取 DSH 默认选择
       ↓
Harness llm.stream（无响应看门狗 + 流式 text-delta 收集）
       ↓
JSON 提取 + 严格 schema 校验
       ↓
docx 原生 OOXML 渲染；有快照时合并自定义模板样式、编号和正文
       ↓
版本化文件名 + Meeting.generatedFiles
```

用户元数据具有权威性。提示词禁止虚构参会人、负责人、日期、地点和决议，未知字段使用“待补充/待确认”。源 segmentId 用于追溯，但当前没有自动验证每条模型总结是否真正忠实于该段，仍需人工复核。

`MinutesTaskManager` 在后台执行上述流程，按 preparing(10%) → model(25% 起) → parsing(80%) → document(90%) → completed(100%) 广播。首个 reasoning 事件会报告实际推理字符数但进度保持 25%；正文首个 delta 后提高到 45%，后续约每 512 个推理或正文字符以及结束时报告实际计数。进度只前进且完成前不超过 95%。关闭浮窗或切换工作台页面不取消任务。

`listMinutesModels()` 直接调用当前安装 Harness 的 `sessionController.modelCatalog()`。这正是浏览器对话模型选择器通过 `remote.session.modelCatalog()` 读取的 Host 目录，因此 MeetScribe 不再用 `llm.listProviders/listModels/resolveModelInfo` 另建一份可能不同的投影。插件保留 DSH 返回的 Provider 分组、组内模型顺序、模型名称、说明、`reasoning.efforts/defaultEffort` 和按 Provider 隔离的 failures，并复用对话选择器的账号/官方 Provider 优先顺序与“DeepSeek 账号”显示名。目录整体读取失败时显示真实错误，不回退到另一套枚举；公开响应不包含 Provider 配置或凭据。最终生成请求仍由 Harness 校验路由与推理强度。

`llm.ts` 收集 `text-delta`，按 block index 防止 `block-end` 重复追加，并支持只有 assembled block 的适配器；reasoning 只计数，不混入正文。显式 `minutesModel` 优先，只有 null 才调用 `agentDefaultModel.currentSelection()`。请求使用可重置的 `AbortController` 看门狗：每个流事件都重置无响应计时，不再使用 `AbortSignal.timeout(120000)` 作为总期限；超时后中止请求并报告实际无响应时长。除迭代异常外，还处理 Harness 规范化的 `finish.reason.kind=error|aborted`，透传实际 failure code/message，并对 NO_ADAPTER 和 UNSUPPORTED_REASONING_EFFORT 指出设置修复入口。只有正常终态且确实没有正文时才区分 reasoning-only、输出长度上限或空流，不再统一报“空内容”。诊断日志只记录事件计数、reasoning 字符数和 finish kind，不记录会议或模型正文。

`src/word/document.ts` 使用 A4、黑白灰正式版式、中文字体、固定 DXA 列宽、真实 numbering、页码和重复表头。输出不经过 Markdown。当前一次性发送整场会议；长会议的分块和层级总结属于后续工作。

`src/word/template.ts` 使用 `fflate` 在内存中解包和重打包 DOCX，并用 `fast-xml-parser` 校验 XML。上传时检查中央目录、条目数、解压总量、路径、宏/OLE/可执行内容，以及包内所有 XML/RELS 中的 DOCTYPE、外部关系、动态外部字段和嵌入内容。应用模板时，唯一 `{{MEETSCRIBE_BODY}}` 段落被替换为 `buildMinutesDocx(..., { bodyOnly: true })` 片段；模板自己的 `sectPr`、页眉和页脚保留，正文样式改名合并且编号 ID 重映射。元数据标记在正文及页眉页脚替换。模板不发送给 LLM，也不写入任意用户路径。

### DSH 内置 Office 预览

`src/host/document-preview.ts` 直接调用 Harness Host `officeKit.convert()`，输入 `extension:'docx'`、`priority:'foreground'` 和授权后的 `OfficeKitSource.read()`。这是 Harness 内建 Office 预览相同的转换边界，但不需要 MeetScribe 独立页面挂载 Session，也不写 Session 事件。

转换前用 `lstat/stat` 检查普通文件、符号链接和 50 MB 上限；读取后再次核对大小与 mtime 版本，预览期间发生变化则拒绝。PDF 响应使用 `content-type: application/pdf`、`content-disposition: inline`、`private, no-store` 和 `nosniff`。原样 DOCX attachment 路由已经移除，因此“打开”不是隐藏的下载换名。

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

真实模型下载与加载复测，以及 Host 链路复测（音频使用自行准备的 16 kHz 单声道 PCM16 WAV）：

```powershell
npm run build
node scripts/verify-model-downloads.mjs <model-directory>
node scripts/smoke-local-asr.mjs <sample.wav> [...more.wav]
node scripts/smoke-harness-asr.mjs http://127.0.0.1:<host-port> <sample.wav>
```

后者创建一个明确标记的合成测试会议，验证 partial、final、持久化和公开响应不泄露 embedding，最后只删除该测试会议。真实桌面验证和限制见根目录 `TESTING.md`。

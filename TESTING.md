# 测试报告

最近更新：2026-11-22
目标宿主：DeepSeek Harness Desktop **0.2.2-rc.5**（Windows 11 x64）

本报告区分自动化测试、真实模型下载、真实桌面链路、合成输入和未验证项目，避免把界面样例当成识别验证。

## 本轮自动化检查

```text
npm run typecheck  通过
npm test           60/60 通过
npm run sample:ui  通过，重新生成 12 张组件截图
npm pack <项目路径> --dry-run 通过，36 个文件，不含模型缓存或测试产物
```

覆盖内容：

- 模型文件下载后核对精确大小和 SHA-256，有效缓存直接复用且不再请求网络；
- 录音路径的已安装模型检查不产生网络请求，缺失或损坏文件不会被当作可用模型；声纹懒加载在缺失时不调用下载器，只有显式准备才进入下载流程；
- 校验失败保留旧文件并清理临时数据；每一次重定向都必须留在允许的 HTTPS 主机；
- 同一模型的并发下载共享 Promise，主地址网络失败后切换到固定备用镜像；
- 插件模型路径分别位于 `asr`、`vad`、`speaker` 子目录，不探测外部应用目录；
- 已加载 ASR 文件被替换后，等待在途推理结束再释放旧实例并加载新实例；普通重试不重复加载；
- 已加载 VAD 文件被替换后，清理旧会话、释放旧实例并加载新实例；
- 非流式 partial 快照、final 整段识别、raw/display 术语纠正、final 缓存与并发去重、reset 后 epoch 复用隔离、VAD 帧概率和 PCM 对齐校验；
- 会议 VAD 对低于 RMS 0.015 门限的合成整句开段并定稿；异步静音响应期间到达的尾部完整留给下一段且两段不重叠；VAD 请求失败时 RMS 兜底仍能定稿；
- 缺失模型返回指向“识别设置 → 检查并准备模型”的可操作错误，不调用原生加载器；
- 声纹余弦聚类、质心更新与最大说话人数；默认 0.65 分开复现样本中相似度 0.6339 的不同声音，边界误并不再污染质心，后续 0.5671 样本正确新建标签；已有聚类器可应用新阈值和最大人数而保留历史；
- 既有短段回归显式使用 0.56，验证同一人 0.8 秒短段的 0.577 相似度在该较低阈值下保持原标签，0.331 的不同声音仍新建标签；
- 纪要文档库汇总全部生成版本，路径文件名提取、搜索、名称数字感知排序和时间排序；
- 会议原子持久化、说话人改名/合并/分段指派、异常中断状态恢复、当前清空和全部历史清空；
- 设置范围校验、默认 800ms 句末静音、新装默认 0.65 说话人阈值、术语规则解析和 UTF-8 持久化；纪要模型默认 null（跟随 DSH）、无响应超时默认 300000ms 并限制在 1–30 分钟，显式路由去空白后持久化且额外 apiKey 字段被剥离，可重置为跟随 DSH；
- Host 纪要任务按会议去重，完整经过 preparing/model/parsing/document/completed，记录版本；失败保留实际阶段和错误，释放重试锁，重试替换旧失败卡片，删除或清空后移除终态任务；reasoning 与正文字符计数跨阶段保留；
- 纪要模型目录只调用 DSH 对话选择器同一 Host 接口 `sessionController.modelCatalog()`，保持账号/官方/其他 Provider 顺序和各组模型顺序，读取目录自带的 reasoning efforts/defaultEffort 与单 Provider failures，公开结果不含 apiKey；测试确认不会再调用 `listProviders/listModels/resolveModelInfo` 构造另一份列表，目录失败时也不替换数据源；显式 Provider/Model/reasoningEffort 覆盖 DSH 默认，缺省仍跟随 `currentSelection()`；
- LLM 流收集不重复追加 block-end，支持无 delta 的块级回退，转发 reasoning effort 和最终字符进度；Harness `finish` 的 AUTH 等真实 failure 不再被误报为通用空内容，NO_ADAPTER 与 UNSUPPORTED_REASONING_EFFORT 指向识别设置，reasoning-only 与无响应超时分别给出可操作错误；
- 无响应看门狗对停滞流执行 abort；合成流总耗时超过一个超时间隔，但每段思考/正文间隔低于阈值时仍成功完成，证明计时按活动重置而非固定总截止时间；
- ASR 术语替换的中英混合、大小写、空白容忍、最长优先和英文整词边界；
- LLM JSON 提取、schema 校验、事实约束提示词，以及原生 DOCX ZIP 签名、固定表格宽度、numbering 和页码域；
- 内置正式模板的新章节、8732 DXA 固定正文宽度、六列任务表、重复表头和“待确认”显示；空可选章节不生成，列表使用真正的 Word numbering；
- 自定义模板保留页面设置，替换跨 runs 的元数据与正文标记，合并 `MeetScribe*` 样式并重映射编号；正文所有 `numId` 在合并后的 numbering 中有定义，不重复插入内置封面；
- 缺失/重复正文标记、宏、根关系及辅助部件中的外部关系、ZIP 路径穿越均被拒绝；所有 XML/RELS 都进入校验；
- 模板存储上传、目录、默认选择、删除和回退；删除后任务启动时取得的字节快照仍可使用；
- Word 生成在模型请求之前读取模板，调用顺序明确为 `template → model`，并真正用自定义快照生成 DOCX；
- DSH Office preview 通过 `officeKit.convert()` 的授权 source 读取已登记文件并返回 PDF，不调用外部打开；缺少 Office 组件和读取期间文件变化均返回明确错误。

UI 截图脚本实际验证当前会议清空、全部历史二次确认、录音中清空后自动续录、绿色录音圆点、顶部纯图标控制、设置模型状态布局、术语保存、文档搜索/排序/刷新，以及 360px 窄屏无横向溢出。文件列表与浮窗“纪要文件”都断言不再存在下载链接，实际点击“在 DSH 中打开”，等待预览 dialog 与 PDF iframe 后关闭；已完成任务也显示同一打开入口。浮窗入口测试曾发现内部弹窗被浮窗层叠/裁剪拦截，随后将共用预览组件 Portal 到 `document.body` 并复测通过。任务覆盖进行中、模型接收字符数、失败原因、重试后替换失败卡片和窄屏布局；模板设置实际切换用户模板与内置模板默认状态，并展开内容标记说明。纪要设置使用合成 DSH 对话模型目录响应，实际选择分组内的 Provider/Model、保存 reasoningEffort、调整无响应超时、刷新列表，并验证 360px 模型设置不溢出。DSH 对话交接使用合成回调验证完整提示只进入草稿边界、浮窗随后关闭，不自动调用生成接口。展开浮窗通过 `document.body` Portal 和模拟高层级左侧栏的 `elementFromPoint` 检查验证不会被遮挡。

## 本轮内置预览与模板验收边界

- 已从 Harness 0.2.2-rc.5 源码核对内建 Office 预览链路：浏览器文档预览使用 `remote.officeKit.render()`，Host `OfficeKit.convert()` 也可直接接收授权后的 `OfficeKitSource`。MeetScribe 采用后者，不猜测不存在的 `openFile()`，也不依赖独立工作台没有挂载的 Session 右侧栏。
- Host 预览接口、`officeKit.convert()` 字节读取、PDF 响应和 Client dialog/iframe 已由单元测试及合成 UI 覆盖；原样 DOCX 下载路由和 Client `documentUrl` 已移除。测试没有调用外部 Word/WPS。
- **尚未在加载本轮代码的真实 Harness Desktop 中点击 PDF 预览**。合成 gallery 的 iframe 与 mock PDF 通过不等于 Electron 内置 PDF viewer 已通过；仍需在无活动录音、允许重启后验证实际转换、字体、关闭和失败提示。
- 新默认样张标题明确标记“【合成示例】”，不包含真实会议文本。已用本机 Microsoft Word 不可见后台导出为 **4 页 PDF**，再用隔离安装的 pypdfium2/Pillow 渲染 4 张 PNG 并逐页查看：页眉、页码、跨页重复表头、六列任务表、长文本和“待确认”均未见溢出或异常分页。
- 本次只实际验证了 Microsoft Word 后台导出；**LibreOffice 与 WPS 未验证**。自定义模板的单元测试覆盖 OOXML 合并和快照语义，但没有把任意第三方企业模板的真实 Word/WPS 兼容性记为通过。
- 本轮未重启 Harness、未恢复最小化窗口、未接管前台输入，也未读取、复制或删除真实会议。未执行真实全部历史清空。

## 本轮纪要模型与超时修复验证边界

- 已从当前安装的 Harness 0.2.2-rc.5 精确源码核对：对话选择器通过 `remote.session.modelCatalog()` 读取目录，Host 对应 `sessionController.modelCatalog()`；返回 `default/groups/failures`，各模型包含 `reasoning.efforts/defaultEffort`。MeetScribe 现在复用该接口及其 Provider 排序规则，不再猜测接口或另建模型列表。
- 新 Host 路由、DSH 对话模型目录复用、显式模型路由、无响应看门狗及设置保存已由 54 项自动化测试和合成 UI 交互覆盖；这些测试不向外部 Provider 发送真实会议内容。
- 最终真实 Harness 检查时发现正在录音，因此本轮**没有重启 Harness，也没有把新设置页或新生成请求记为真实桌面验证通过**。未读取或复制会议正文，未清空历史。待无活动录音后仍需复测模型列表、显式选择保存和一次合成会议 Word 生成。

## 本轮新增真实 Harness 与双人声纹回归

- 确认活动会议和录音均为空后完整重启 Harness；新 Host 健康接口、`GET /minutes-tasks` 和真实设置 `speakerThreshold=0.65` 均生效。窗口关闭按钮只最小化到托盘，最终结束空闲进程并后台启动；未清空任何历史会议。
- 使用明确标记的合成会议和 16 kHz 合成 WAV 走真实 Host：ASR final 持久化成功，生成接口返回 **202**，任务由 `model / 25% / 0 chars` 推进到 `completed / 100% / 1438 chars`，生成并登记 Word 第 1 版。随后只删除该测试会议及其新生成的测试 Word；原有会议保留，活动会议恢复为空。
- 这次真实 DSH 当前模型调用成功，未复现用户此前看到的“空内容”。旧实现忽略 Harness `finish` 终态中的 Provider failure，因此无法从旧提示反推当时根因；新错误透传已由合成 AUTH failure 测试验证，若再次失败界面会显示实际 code/message。
- 真实 DSH 对话草稿点击 **尚未通过桌面 GUI 验证**：后台重启后的窗口可见，但可访问性树未暴露目标按钮；未恢复窗口、未接管前台输入，也未把任何真实会议文本注入对话。`startSession` 签名来自当前安装 Harness，草稿交接由组件测试覆盖。
- 用真实 ERes2NetV2 重新计算两种 Windows 系统语音的 6 个完整段：同一人相邻样本对首段相似度为 0.9284/0.9420 与 0.9168/0.9153；不同声音对首段为 0.6339、0.5671、0.5706。默认 **0.65** 加保守质心更新后，无论先连续播放一人还是两人交替，标签均为两个且后续段全部归对；0.50 与 0.56 在这组样本的两种顺序下仍全部合并。该结果只覆盖明确标记的合成双人音频，不代表真人会议室保证。

## 本轮真实模型下载与原生验证

验证脚本：`scripts/verify-model-downloads.mjs`，使用独立测试模型目录，不读取或修改真实会议数据。

- 首轮连接 `huggingface.co` 出现 `TypeError: fetch failed` / `ConnectTimeoutError` / `UND_ERR_CONNECT_TIMEOUT`，因此加入固定 revision 的内置备用镜像；镜像仍要求相同大小和 SHA-256。
- 首次真实下载：ASR `downloaded:true`、252,684,608 字节；VAD `downloaded:true`、1,241,056 字节。
- 首次全量任务在声纹临时文件达到约 69.17 MB / 71.44 MB 时被后台 30 分钟时限终止，并非校验或原生加载失败；该次不计为通过。随后清理未完成的测试临时文件，以更长后台时限重新执行完整流程。
- ASR/VAD 随后在同一目录均为 `downloaded:false`，证明缓存复用；生产 `createAsrRuntime` 中两者均为 `ready=true, loaded=true`，ASR 识别为 `sensevoice` / `sensevoice-small`。
- 生产 VAD session 实际接收 512 个静音采样并返回布尔 `isSpeech=false`；生产 ASR 对 0.5 秒合成 PCM 完成一次原生 final 推理并返回文本字段。该合成调用只证明执行链路，不作为识别准确率证据。
- 长时限重跑中，声纹模型真实下载完成：`downloaded:true`、71,441,527 字节，大小与 SHA-256 校验通过，原生 extractor 为 `ready=true, loading=false`。
- 最终在同一目录再次完整复测，ASR、VAD、声纹全部为 `downloaded:false`，证明三类有效缓存均不重复下载。生产 ASR 原生推理完成，VAD session 返回有效布尔结果，声纹对 1 秒合成波形实际生成 **192 维 embedding**；输出不记录向量内容。
- 本轮另用全新 Windows 合成中文 WAV 连续调用生产 runtime 的真实 Silero VAD：音频约 9.955 秒，切成 100 个 100ms 窗口；正常 RMS 0.0558 与缩放后的 RMS 0.0050 均返回 `available:true`，并分别检出 83 个语音窗。正常和低音量 WAV 经真实 SenseVoice 均完整正确定稿，`truncated=false`。这证明测试样本在低于旧 RMS 0.015 门限时仍可被检测和识别，但不代表真人远场或重叠语音的识别准确率；本次未更换 ASR 权重。

## 真实 Harness 桌面验证（此前版本链路）

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| 插件加载 | 链接到 desktop profile，完整重启 Harness | 通过；Host 健康接口、设置和输入框入口可用 |
| 左侧独立工作台 GUI | 后台启动后读取窗口与可访问性树 | **未完整验证：Harness 保持最小化，未恢复窗口或接管前台；组件交互已通过** |
| 本地原生模型加载 | 确认无活动录音后完整重启 Harness，读取 `/models/status` | 通过；transcribe.cpp 0.4.1、SenseVoice Small Q8 和 Silero VAD 均为 `ready=true, loaded=true`；文件大小分别为 252,684,608 与 1,241,056 字节 |
| 800ms、0.56 与设置迁移 | 完整重启后读取真实设置 | 通过；旧 `senseVoice/modelHost` 不再下发，输出目录和术语表保持不变 |
| 0.8 秒同人短段 Host 回归 | 将 6 个 Huihui 合成短段依次经真实 Host final，仅删除测试会议 | 通过；6 段全部归为 `speaker-1` |
| VAD、partial/final 与持久化 | 用已知中英混合 WAV 调用真实 Host，最后仅删除测试会议 | 通过；VAD 返回布尔结果，临时与最终段落、raw/display 文本均持久化，公开响应不含 embedding |
| 中文 Host 链路 | 用已知 11.07 秒中文 WAV 调用真实 Host | 通过；完整中文文本定稿并分配 `speaker-1`，总路由耗时约 1.934 秒 |
| 术语设置持久化 | 向真实 Host 保存两条合成规则，读取响应后恢复空表 | 通过；中文未乱码，未写入真实会议 |
| 浮窗与自动录音 | 点击输入框旁 MeetScribe 图标 | 通过；自动创建会议并请求默认麦克风，无额外开始按钮 |
| 真实音量声波 | 比较麦克风有声音与静默时的界面 | 通过；柱高随真实电平变化 |
| 暂停/继续 | 在真实浮窗点击顶部图标 | 通过；状态与采集随操作切换 |
| 一键清空 | 清空当前逐字稿并检查 Host | 通过；保留会议信息和 Word 版本，录音中自动继续 |
| 展开布局与主题 | 真实展开截图、深色桌面及浅色组件截图 | 通过；浮窗位于左侧栏之上，顶部控制不遮挡 |
| 最小化/恢复 | 录音中最小化并检查活动会议 | 通过；采集不中断，活动会议 ID 保持不变 |
| Windows 文件夹选择 | 调用受同源保护的 Host 路由 | 通过；原生对话框返回临时测试目录 |
| 设置页完整 GUI 流程 | 后台可访问性自动操作 | **未完整验证：部分点击返回 `background_unavailable`，未接管用户鼠标键盘** |
| 全局 Ctrl+E | 在 Notepad 活跃时发送 Ctrl+E | 通过；Harness 前台化并打开浮窗 |
| 多说话人 | Huihui 与 Zira 两种系统语音分段播放 | 通过本次合成测试；形成两个说话人标签 |
| Word/LLM | 在真实会议点击“生成纪要” | 通过；生成并记录版本化 `.docx` |
| Word 渲染 | Microsoft Word 转 PDF，再渲染为 PNG | 通过；真实文件 2 页，完整样例 3 页 |
| 系统声音/混合采集 | 检查界面与底层权限 | 当前界面不提供入口；旧 `getDisplayMedia` 路径返回 `Permission denied`，成功路径未验证 |

这些桌面结果证明此前本地引擎与 Host 链路可用，但不能替代本轮“插件独立下载三类模型”的真实下载验证，也不构成真人会议室准确率证明。

## SenseVoice 直接推理复测

对应脚本现为 `scripts/smoke-local-asr.mjs`。模型为 `SenseVoiceSmall-Q8_0.gguf`，引擎 `transcribe.cpp 0.4.1`，CPU backend，4 个 session threads。输入由 Windows 系统语音生成，16 kHz、单声道、PCM16；文本预先已知，不包含用户会议内容。单次本机耗时只用于检查链路量级，不是跨设备性能承诺。

| 样本 | 音频时长 | 本次推理耗时 | 结果 |
| --- | ---: | ---: | --- |
| 中文 | 11.07 秒 | 385ms | 完整中文句正确定稿 |
| 中英混合 | 9.74 秒 | 315ms | API、OKR、MVP 可识别；“对齐、向量”误为“对其、向梁” |
| 英文 | 6.28 秒 | 215ms | 英文句正确定稿，语言检测为 `en` |

中文输出：

```text
各位同事大家好。今天我们讨论下一版本的产品发布计划，请项目经理在星期五之前提交完整的测试报告。
```

中英混合输出：

```text
本期需要完成API网关OKR对其和向梁数据库的评审，并在星期五发布MVP。
```

英文输出：

```text
Good morning everyone, I will share the final report with the project manager on Friday.
```

真实 Harness 混合样本还验证了 1 秒输入后的临时结果“本期需要。”和随后的完整段定稿。两次 Host 冒烟分别约 981ms 与 1498ms；最终一次包含 `vadOnly=1` 原生 VAD 调用。最终状态 ASR/VAD/声纹均 ready，活动会议为 `null`，测试会议 0 残留。对应脚本现为 `scripts/smoke-harness-asr.mjs`，只删除自己创建的测试会议；未对真实历史执行全部清空。

这些样本证明本地模型、临时快照和 Host 持久化链路可用。混合样本的行业词错误仍需术语纠正，不能宣称换模型后所有识别问题已消失。

## 公开语音声纹模型对照

脚本：`scripts/evaluate-speaker-models.mjs`。输入为 sherpa-onnx `speaker-recongition-models` release 中 3 位说话人的公开 enrollment/test WAV，模型与音频均按官方 `checksum.txt` 校验。每位说话人使用 2–3 段 enrollment 质心，对 7 段 test 计算余弦相似度；不是用户会议音频。

| 模型 | 完整句同人平均分 | 最短同人与最高异人分数间隔 | 0.8 秒窗口同人平均分 | 0.8 秒窗口分数间隔 |
| --- | ---: | ---: | ---: | ---: |
| CAM++ zh-en advanced（此前） | 0.8046 | 0.3208 | 0.5628 | -0.0623 |
| **ERes2NetV2 zh-cn（当前）** | **0.8333** | **0.3978** | **0.6349** | **0.2111** |
| ERes2Net-Base-200k zh-cn | 0.8220 | 0.3353 | 未纳入最终短句复测 | 未纳入最终短句复测 |
| WeSpeaker zh CN-Celeb ResNet34-LM | 0.8065 | 0.2289 | 未纳入最终短句复测 | 未纳入最终短句复测 |

公开 fixture 为中文语音；本机只有一种英文系统语音，无法组成有效的双英文说话人对照，因此不宣称英文或中英混读场景有同等提升。

另用 6 段同一 Windows Huihui 合成语音做完整段、1.5 秒与 0.8 秒截断诊断。完整段和 1.5 秒输入在阈值 0.62 下均保持一个标签；0.8 秒输入中有一段相似度降至 0.577，被旧阈值错误新建为 `speaker-2`，0.56 则全部保持 `speaker-1`。随后加入的 Zira 不同声音相似度约 0.331，仍新建独立标签。该诊断支持当时的 800ms / 0.56 参数组合，但不证明真实会议室或相似音色的分离准确率。本轮新的双人回归发现 0.56 会合并相似度更高的不同声音，因此当前新装默认值已调整为 0.65，并限制低置信匹配更新质心；既有 0.8 秒同人短段仍作为显式低阈值回归保留。

## 旧 sherpa ASR 的历史识别样例

以下仅保留此前 Zipformer + sherpa-onnx SenseVoice 链路的回归记录，不能用于评价当前 SenseVoice GGUF：

```text
各位同事大家好。今天我们。
讨论下一版本的产品发布计划，请项目经理在星期五之前提。
交完整的测试报告。
```

```text
Good morning, everyone.
I'll sharehare the final report with the project manager.
```

这些历史结果暴露了旧链路的断句偏早、句尾漏字和 `sharehare` 重复词，也是替换文字识别引擎的背景之一，不再代表当前输出。

## Word 与截图来源

完整 Word 示例：`docs/samples/meeting-minutes-sample.docx`；渲染图：`docs/images/word-sample/page-1.png` 至 `page-4.png`。当前 4 页合成样张已逐页检查 A4 黑白正式排版、固定列宽、真实列表、页码、跨页重复表头和未知字段的“待补充/待确认”。

- `floating-transcript*.png`、`expanded-transcript*.png`、`meeting-details.png`、`minimized-dark.png`：真实 React 组件 + 明确的合成会议数据，不是识别准确率证据。
- `workspace-documents-*.png`：真实工作台组件 + 3 个合成 Word 条目和合成进行中任务，不是用户真实文件列表。
- `workspace-task-states-light.png`、`workspace-tasks-narrow.png`：合成失败/完成/进行中任务，用于检查错误、重试、内置打开入口和 360px 布局。
- `settings-*.png`：真实设置组件 + 模拟模型/设置/模板目录响应，包含内置与“合成部门模板”，使用合成的 `C:\Users\you\...` 路径，不包含个人本机信息。
- `harness-desktop-transcript.png`：旧识别引擎时期的历史窗口截图，不作为当前模型准确率证据。
- `word-sample/*.png`：由示例 DOCX 渲染，不是 Word 界面样机。

## 尚未覆盖与限制

- 本轮 DSH 内置 PDF 预览、自定义模板管理和新正式模板尚未在加载新代码的真实 Harness Desktop 中完整点击复测；未重启 Harness。Host 接口、60 项测试、Word 后台渲染和真实组件交互通过不等同于真实 GUI 通过；
- 自定义模板的 Word/WPS/LibreOffice 兼容性、极复杂页眉页脚和第三方企业模板尚未做通用保证；含宏、OLE、外部关系或动态外部字段的模板按安全设计拒绝；
- 纪要任务只保存在 Host 内存，Harness 进程重启后任务列表不恢复；已生成 Word 与会议版本记录仍持久化；
- 旧代码把 Word 纪要请求固定为 120 秒总时限，即使模型仍在生成也会中止；但仅凭那次提示不能反推当时是否另有 Provider 网络问题。新实现改为活动重置的无响应超时并保留真实终态错误，仍须在无活动录音后做真实复测；
- 用户更早那次 Provider 的具体底层错误无法从旧“空内容”提示确定；新代码已透传终态 failure，仍须在再次发生时以实际错误为准；
- 当前模型接入后的真实麦克风与真人会议室复测尚未完成，此前直接推理使用已知 WAV 注入 Host；
- 真人两人在同一会议室同时交谈、重叠语音、相似音色和远场麦克风；
- 数小时长会议、模型上下文超限和分段层级总结；
- 非 Windows 平台；
- 系统音频与混合采集的成功路径；
- 热键被其他应用占用时的自动重映射，当前仅记录冲突日志；
- 下载暂不支持断点续传、自定义镜像、自定义模型目录或界面内删除模型。

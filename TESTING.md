# 测试报告

最近更新：2026-11-22
目标宿主：DeepSeek Harness Desktop **0.2.2-rc.5**（Windows 11 x64）

本报告区分自动化测试、真实模型下载、真实桌面链路、合成输入和未验证项目，避免把界面样例当成识别验证。

## 本轮自动化检查

```text
npm run typecheck  通过
npm test           32/32 通过
npm run sample:ui  通过，重新生成 10 张组件截图
npm pack --dry-run 通过，33 个文件，不含模型缓存或测试产物
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
- 缺失模型返回指向“识别设置 → 检查并准备模型”的可操作错误，不调用原生加载器；
- 声纹余弦聚类、质心更新与最大说话人数；同一人 0.8 秒短段的 0.577 相似度在阈值 0.56 下保持原标签，0.331 的不同声音仍新建标签；
- 纪要文档库汇总全部生成版本，路径文件名提取、搜索、名称数字感知排序和时间排序；
- 会议原子持久化、说话人改名/合并/分段指派、异常中断状态恢复、当前清空和全部历史清空；
- 设置范围校验、默认 800ms 句末静音、0.56 说话人阈值、术语规则解析和 UTF-8 持久化；
- ASR 术语替换的中英混合、大小写、空白容忍、最长优先和英文整词边界；
- LLM JSON 提取、schema 校验、事实约束提示词，以及原生 DOCX ZIP 签名、固定表格宽度、numbering 和页码域。

UI 截图脚本实际验证当前会议清空、全部历史二次确认、录音中清空后自动续录、绿色录音圆点、顶部纯图标控制、设置模型状态布局、术语保存、文档搜索/排序/刷新/下载路由，以及 360px 窄屏无横向溢出。展开浮窗通过 `document.body` Portal 和模拟高层级左侧栏的 `elementFromPoint` 检查验证不会被遮挡。

## 本轮真实模型下载与原生验证

验证脚本：`scripts/verify-model-downloads.mjs`，使用独立测试模型目录，不读取或修改真实会议数据。

- 首轮连接 `huggingface.co` 出现 `TypeError: fetch failed` / `ConnectTimeoutError` / `UND_ERR_CONNECT_TIMEOUT`，因此加入固定 revision 的内置备用镜像；镜像仍要求相同大小和 SHA-256。
- 首次真实下载：ASR `downloaded:true`、252,684,608 字节；VAD `downloaded:true`、1,241,056 字节。
- 首次全量任务在声纹临时文件达到约 69.17 MB / 71.44 MB 时被后台 30 分钟时限终止，并非校验或原生加载失败；该次不计为通过。随后清理未完成的测试临时文件，以更长后台时限重新执行完整流程。
- ASR/VAD 随后在同一目录均为 `downloaded:false`，证明缓存复用；生产 `createAsrRuntime` 中两者均为 `ready=true, loaded=true`，ASR 识别为 `sensevoice` / `sensevoice-small`。
- 生产 VAD session 实际接收 512 个静音采样并返回布尔 `isSpeech=false`；生产 ASR 对 0.5 秒合成 PCM 完成一次原生 final 推理并返回文本字段。该合成调用只证明执行链路，不作为识别准确率证据。
- 长时限重跑中，声纹模型真实下载完成：`downloaded:true`、71,441,527 字节，大小与 SHA-256 校验通过，原生 extractor 为 `ready=true, loading=false`。
- 最终在同一目录再次完整复测，ASR、VAD、声纹全部为 `downloaded:false`，证明三类有效缓存均不重复下载。生产 ASR 原生推理完成，VAD session 返回有效布尔结果，声纹对 1 秒合成波形实际生成 **192 维 embedding**；输出不记录向量内容。

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

另用 6 段同一 Windows Huihui 合成语音做完整段、1.5 秒与 0.8 秒截断诊断。完整段和 1.5 秒输入在阈值 0.62 下均保持一个标签；0.8 秒输入中有一段相似度降至 0.577，被旧阈值错误新建为 `speaker-2`，0.56 则全部保持 `speaker-1`。随后加入的 Zira 不同声音相似度约 0.331，仍新建独立标签。因此默认句末静音调为 800ms、默认新建标签阈值调为 0.56。该诊断只支持本次参数调整，不证明真人、远场、重叠语音或相似音色的分离准确率。

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

完整 Word 示例：`docs/samples/meeting-minutes-sample.docx`；渲染图：`docs/images/word-sample/page-1.png` 至 `page-3.png`。已检查 A4 中文商务排版、固定列宽、真实列表、页码、跨页重复表头和未知字段的“待补充/待确认”。

- `floating-transcript*.png`、`expanded-transcript*.png`、`meeting-details.png`、`minimized-dark.png`：真实 React 组件 + 明确的合成会议数据，不是识别准确率证据。
- `workspace-documents-*.png`：真实工作台组件 + 3 个合成 Word 条目，不是用户真实文件列表。
- `settings-*.png`：真实设置组件 + 模拟模型/设置响应，使用合成的 `C:\Users\you\...` 路径，不包含个人本机信息。
- `harness-desktop-transcript.png`：旧识别引擎时期的历史窗口截图，不作为当前模型准确率证据。
- `word-sample/*.png`：由示例 DOCX 渲染，不是 Word 界面样机。

## 尚未覆盖与限制

- 新版模型管理界面尚未在重启后的真实 Harness Desktop 中点击复测；本轮使用同一生产模块和原生依赖的独立脚本，不把它记为真实 GUI 通过；
- 当前模型接入后的真实麦克风与真人会议室复测尚未完成，此前直接推理使用已知 WAV 注入 Host；
- 真人两人在同一会议室同时交谈、重叠语音、相似音色和远场麦克风；
- 数小时长会议、模型上下文超限和分段层级总结；
- 非 Windows 平台；
- 系统音频与混合采集的成功路径；
- 热键被其他应用占用时的自动重映射，当前仅记录冲突日志；
- 下载暂不支持断点续传、自定义镜像、自定义模型目录或界面内删除模型。

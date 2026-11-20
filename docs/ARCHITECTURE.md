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
├─ shell.overlay / 右侧会议面板 / 设置页            │
├─ 应用内 shortcuts + DOM 兼容兜底                  │
├─ getUserMedia / AudioWorklet / 16 kHz 重采样      │
└─ 会议控制器 + SSE 订阅                            │
       │ 本地 HTTP：PCM、控制、元数据                ▼
       ▼                                    Harness Cordis Host
       └────────────────────────────────────────────▶ /meetscribe
                                                    ├─ Streaming Zipformer + VAD
                                                    ├─ SenseVoice worker 定稿
                                                    ├─ CAM++ embedding + 聚类
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
- `settings.section`：模型与识别设置；
- `sidebar.right.pane.tab`：右侧会议面板；
- `shortcuts`：应用内 Ctrl+E。

`meeting-controller.ts` 使用 `useSyncExternalStore` 管理会议状态、历史、计时、说话人操作和生成任务。SSE 接收 Host 的会议与模型事件。

### 音频

- 默认 `getUserMedia` 获取单声道麦克风；启用回声消除，关闭自动增益与浏览器噪声抑制。
- AudioWorklet 优先，ScriptProcessor 作为兼容兜底。
- 重采样到 16 kHz Float32 PCM，以 `sessionId + epoch + offset + final` 上传。
- 系统/混合采集通过 `getDisplayMedia` 和 Web Audio 混音实现，但 Harness 0.2.2-rc.5 实测拒绝该权限，成功路径尚未验证。
- 自定义 MediaStream 的 track、AudioContext 和监听器在停止/异常时释放。

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
GET/POST /meetings
GET/PATCH/DELETE /meetings/:id
POST /meetings/:id/start|pause|resume|finish
POST /meetings/:id/segments
PATCH /meetings/:id/speakers/:speakerId
POST /meetings/:id/speakers/merge
POST /meetings/:id/segments/:segmentId/speaker
POST /meetings/:id/generate
GET  /meetings/:id/documents/:version
```

安全规则：loopback-only、写操作同源检查、请求体大小限制、下载路径来自已登记文件，不接收任意文件路径。

## 4. ASR 与说话人

### 实时识别

`asr-runtime.ts` 复用并调整 sherpa-onnx WASM 流式识别：

1. 流式 Zipformer 产生 partial；
2. Silero VAD 与静音时长决定分段；
3. epoch 防止旧段请求覆盖新段；
4. final 时由 worker 中的 SenseVoice 复识别；
5. 空文本不写会议，重复 final 被去重；
6. `reset/finish` 清理音频与识别状态。

### 声纹聚类

`speaker-identifier.ts` 使用 `sherpa-onnx-node` 的 `SpeakerEmbeddingExtractor`。短于 0.8 秒的段不计算声纹。嵌入与既有簇质心计算余弦相似度，超过阈值则归入该说话人，否则创建匿名标签，直到达到最大人数。

Electron 环境禁止 native external ArrayBuffer，因此调用：

```ts
extractor.compute(stream, false)
```

让 N-API 返回 JavaScript 拥有的副本。公开 HTTP 会议响应会移除 embedding；本地 JSON 保留它供聚类与后续校准使用。

当前是**在线匿名聚类**，不是注册身份识别，也没有离线全局重分段。重叠语音可能产生误分。

## 5. 持久化

`meeting-store.ts` 每场会议一个 JSON：

- 稳定 meeting、speaker、segment ID；
- 原始文本和显示文本；
- 时间、来源、说话人置信度、revision；
- 用户元数据和生成文件版本；
- 改名、合并、逐段指派和订阅事件。

写入流程为临时文件 → `rename`。启动时把异常中断的 recording 状态恢复为可操作状态。设置同样采用原子写入和范围校验。

Windows 数据目录：`%LOCALAPPDATA%\dsh-meetscribe`。当前不保存原始音频文件。

## 6. 显式 LLM 与 Word

只有 `POST /meetings/:id/generate` 会进入 LLM 路径：

```text
原始逐字稿 + segmentId + 说话人 + 用户元数据
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

`src/word/document.ts` 使用 A4、中文字体、固定 DXA 列宽、真实 numbering、页码和重复表头。输出不经过 Markdown。

当前一次性发送整场会议；长会议的分块和层级总结属于后续工作。

## 7. 全局热键

`native/MeetScribeHotkey.cs` 使用 Win32 `RegisterHotKey` 注册 Ctrl+E。触发后：

1. 找到 Harness 主窗口并前台化；
2. 临时 `UnregisterHotKey`，避免助手拦截自己的合成输入；
3. 注入 Ctrl+E；
4. 恢复热键注册。

客户端只让 Harness shortcuts 或 DOM 兜底其中一条路径生效，避免双切换。冲突写入 `%LOCALAPPDATA%\dsh-meetscribe-hotkey-error.log`。

## 8. 构建与测试

`build.mjs` 生成：

- `lib/index.js`：Host ESM；
- `lib/sense-worker.mjs`：SenseVoice worker；
- `lib/word/index.js`：Word 测试/样例入口；
- `lib/client.js`：Browser CJS ModuleLoader 包。

Host 的 Cordis、sherpa native 和 Node built-in 保持 external；Client 的 React 由宿主提供。AudioWorklet 先编译为 IIFE，再注入 Client。

质量命令：

```powershell
npm run verify
npm run sample:word
npm run sample:ui
```

真实桌面验证和未通过项见根目录 `TESTING.md`。

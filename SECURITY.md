# 安全与隐私

## 数据流

MeetScribe 默认在本地完成音频处理、语音识别、说话人嵌入和会议持久化。音频不会发送给 LLM。

只有用户明确点击“生成纪要”后，插件才会把以下文本发送到 DeepSeek Harness 当前选择的模型：

- 术语纠正后的展示逐字稿及说话人名称；
- 用户填写的会议名称、主题、地点、主持人、记录人、参会人等元数据；
- 用于约束结构化 Word 输出的提示词。

模型提供方、网络位置和保留政策由 Harness 的当前配置决定。机密会议使用前，请确认该提供方符合你的组织要求。

## 本地数据

Windows 默认目录：

```text
%LOCALAPPDATA%\dsh-meetscribe\
├─ settings.json
├─ meetings\       # 每场会议一个 JSON，含文本和声纹嵌入
└─ models\speaker\ # ERes2NetV2 声纹模型（仅此处仍由插件下载）
```

Orca ASR/VAD 权重只从以下既有目录读取，由 Orca 自己管理：

```text
%APPDATA%\orca\speech-models\
├─ sense-voice-zh-en-ja-ko-yue\SenseVoiceSmall-Q8_0.gguf
└─ silero-vad-v6.2\silero-vad-v6.2-F32.gguf
```

Word 默认输出到 `%USERPROFILE%\Documents\MeetScribe`。

当前版本不把会议音频保存为文件；音频仅按段保留在内存中，定稿后释放。声纹嵌入可用于区分匿名说话人，应视为敏感生物特征相关数据。删除会议 JSON 才会删除相应嵌入。

## 网络安全边界

- Host 路由只接受 loopback 请求。
- 非 GET/HEAD 请求执行同源检查。
- JSON 和音频请求有大小限制。
- 文档下载只允许读取会议中已登记的生成文件。
- Orca ASR/VAD 不经过插件网络下载；插件检查本地文件并由 transcribe.cpp 实际加载。
- 声纹模型使用固定 GitHub release 来源；下载写入临时文件，SHA-256 校验通过后才替换正式文件。

## Word 与提示词约束

结构化输出经过 schema 校验。提示词禁止编造参会人、负责人、期限、地点和决议；未知字段使用“待补充/待确认”。这不能替代人工复核：LLM 仍可能误归纳或漏掉约束。

## 全局热键助手

`native/bin/MeetScribeHotkey.exe` 只注册 Ctrl+E、寻找 Harness 主窗口并注入该组合键。源码和本地构建脚本随仓库提供。它不包含网络功能，也不采集音频。

若 Ctrl+E 被占用，错误日志位于：

```text
%LOCALAPPDATA%\dsh-meetscribe-hotkey-error.log
```

## 报告安全问题

请通过仓库 Security Advisory 或私下联系维护者，不要在公开 issue 中附上会议逐字稿、声纹嵌入、API 密钥或模型服务凭据。报告应包含版本、复现步骤和影响范围。

## 凭据

本仓库不需要也不应保存 LLM API 密钥。不要提交 `.env`、Harness profile、本地会议 JSON、模型缓存或个人输出目录。

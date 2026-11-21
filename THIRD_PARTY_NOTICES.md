# 第三方声明

## 复用代码

### dsh-voice-mode

本项目的浏览器音频采集、增量 PCM 协议和部分会议状态处理在 [qishuilalala/dsh-voice-mode](https://github.com/qishuilalala/dsh-voice-mode) 的 MIT 实现基础上修改，原始日志标识和部分协议注释保留以便追溯。

原声明：

```text
MIT License
Copyright (c) 2026 dsh-voice-mode contributors
```

完整 MIT 许可文本见项目根目录 `LICENSE`；该许可同样适用于上述复用部分。MeetScribe 对 Orca ASR 运行时、会议状态、说话人管理、LLM 结构化纪要和 Word 输出做了独立扩展。旧 Zipformer / sherpa-onnx SenseVoice ASR 实现已移除。

## 主要运行依赖

- [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) / npm `transcribe-cpp@0.4.1`：Orca GGUF 的本地 ASR 与 VAD 推理；MIT。Windows x64 使用对应 `@transcribe-cpp/win32-x64-cpu-vulkan` 原生包，当前以 CPU backend 运行。
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) / `sherpa-onnx-node@1.13.6`：**仅用于 ERes2NetV2 speaker embedding**，不再用于文字识别或 SenseVoice；上游采用 Apache-2.0。
- [docx](https://github.com/dolanmiu/docx)：生成原生 Office Open XML Word 文档；MIT。
- [React](https://react.dev/)：客户端 UI；MIT。
- DeepSeek Harness / Cordis：宿主插件服务，按其各自条款使用。

精确 npm 依赖版本见 `package-lock.json`。间接依赖的完整许可文本位于安装后的 `node_modules`。

## 运行时模型

模型权重不随本仓库分发。

| 用途 | 模型 | 获取与管理方式 |
| --- | --- | --- |
| 中文/中英混合/英文 ASR | `SenseVoiceSmall-Q8_0.gguf`（SenseVoice Small Q8） | 用户通过 Orca 下载；MeetScribe 从 `%APPDATA%\orca\speech-models\sense-voice-zh-en-ja-ko-yue` 读取 |
| VAD | `silero-vad-v6.2-F32.gguf`（Silero VAD v6.2） | 用户通过 Orca 下载；MeetScribe 从 `%APPDATA%\orca\speech-models\silero-vad-v6.2` 读取 |
| 说话人嵌入 | `3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx`（ERes2NetV2） | 插件从 sherpa-onnx speaker-recognition models release 下载，并按仓库固定 SHA-256 校验 |

Orca GGUF 由 Orca 的模型管理流程获取；MeetScribe 检查文件存在并通过 transcribe.cpp 实际加载验证，不重新下载这些文件，也不声称对 Orca 管理文件执行了插件自己的 SHA-256 校验。声纹模型仍使用插件的固定上游、临时文件和 SHA-256 校验流程。

相关上游：

- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [3D-Speaker / ERes2NetV2](https://github.com/modelscope/3D-Speaker)
- [sherpa-onnx 模型文档](https://k2-fsa.github.io/sherpa/onnx/)
- Orca 1.4.268（本机模型与 transcribe.cpp 的来源环境；以其安装包内声明为准）

模型权重、训练数据和转换后文件的许可可能不同于运行时代码，也可能包含各自的使用条件。下载和商用前请检查对应上游仓库、模型卡及 Orca 随附声明；本仓库不重新授予模型权重许可。

## 示例数据

`docs/samples` 中的会议内容是虚构的产品评审样例，只用于展示结构化 JSON 和 Word 排版，不代表真实个人、组织或会议记录。ASR 复测使用本机系统语音生成的已知文本，不包含用户会议内容。

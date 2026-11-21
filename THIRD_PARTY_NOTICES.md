# 第三方声明

## 复用代码

### dsh-voice-mode

本项目的浏览器音频采集、增量 PCM 协议和部分会议状态处理在 [qishuilalala/dsh-voice-mode](https://github.com/qishuilalala/dsh-voice-mode) 的 MIT 实现基础上修改，原始日志标识和部分协议注释保留以便追溯。

原声明：

```text
MIT License
Copyright (c) 2026 dsh-voice-mode contributors
```

完整 MIT 许可文本见项目根目录 `LICENSE`；该许可同样适用于上述复用部分。MeetScribe 对本地 ASR 运行时、模型管理、会议状态、说话人管理、LLM 结构化纪要和 Word 输出做了独立扩展。旧 Zipformer / sherpa-onnx SenseVoice ASR 实现已移除。

## 主要运行依赖

- [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) / npm `transcribe-cpp@0.4.1`：GGUF 的本地 ASR 与 VAD 推理；MIT。Windows x64 使用对应 `@transcribe-cpp/win32-x64-cpu-vulkan` 原生包，当前以 CPU backend 运行。
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) / `sherpa-onnx-node@1.13.6`：**仅用于 ERes2NetV2 speaker embedding**，不用于文字识别；上游采用 Apache-2.0。
- [docx](https://github.com/dolanmiu/docx)：生成原生 Office Open XML Word 文档；MIT。
- [React](https://react.dev/)：客户端 UI；MIT。
- DeepSeek Harness / Cordis：宿主插件服务，按其各自条款使用。

精确 npm 依赖版本见 `package-lock.json`。间接依赖的完整许可文本位于安装后的 `node_modules`。

## 运行时模型

模型权重不随本仓库分发。插件在用户点击“检查并准备模型”后下载，并保存到 `%LOCALAPPDATA%\dsh-meetscribe\models`。

| 用途 | 文件与大小 | 固定来源与完整性校验 |
| --- | --- | --- |
| 中文/中英混合/英文 ASR | `SenseVoiceSmall-Q8_0.gguf`，252,684,608 字节 | `handy-computer/SenseVoiceSmall-gguf` 的固定 revision；SHA-256 `6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29` |
| VAD | `silero-vad-v6.2-F32.gguf`，1,241,056 字节 | `handy-computer/silero-vad-v6.2-gguf` 的固定 revision；SHA-256 `0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6` |
| 说话人嵌入 | `3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx`，71,441,527 字节 | `k2-fsa/sherpa-onnx` 的 speaker-recognition models release；SHA-256 `eda0bf86422a9725a3523d5a1d3d75dedf340664e0ba65cfc1c7b2a78b6cf0b5` |

ASR/VAD 优先从官方 Hugging Face 文件地址下载，连接失败时自动尝试内置 `hf-mirror.com` 备用地址。主备地址使用完全相同的文件大小和 SHA-256；备用来源不会降低完整性要求。声纹模型使用 GitHub Release 文件。

下载器限制 HTTPS 和重定向主机，使用唯一临时文件，校验通过后才替换旧文件；不会执行下载内容。精确地址、revision、文件大小和摘要集中维护在 `src/host/model-manager.ts`。

相关上游：

- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)
- [SenseVoice Small GGUF](https://huggingface.co/handy-computer/SenseVoiceSmall-gguf)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [Silero VAD GGUF](https://huggingface.co/handy-computer/silero-vad-v6.2-gguf)
- [3D-Speaker / ERes2NetV2](https://github.com/modelscope/3D-Speaker)
- [sherpa-onnx 模型文档](https://k2-fsa.github.io/sherpa/onnx/)

模型权重、训练数据和转换后文件的许可可能不同于运行时代码，也可能包含各自的使用条件。下载和商用前请检查对应上游仓库与模型卡；本仓库不重新授予模型权重许可。

## 示例数据

`docs/samples` 中的会议内容是虚构的产品评审样例，只用于展示结构化 JSON 和 Word 排版，不代表真实个人、组织或会议记录。ASR 复测使用本机系统语音生成的已知文本，不包含用户会议内容。

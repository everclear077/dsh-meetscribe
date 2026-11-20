# 第三方声明

## 复用代码

### dsh-voice-mode

本项目的浏览器 ASR、模型下载和本地识别运行时在 [qishuilalala/dsh-voice-mode](https://github.com/qishuilalala/dsh-voice-mode) 的 MIT 实现基础上修改，原始日志标识和部分协议注释保留以便追溯。

原声明：

```text
MIT License
Copyright (c) 2026 dsh-voice-mode contributors
```

完整 MIT 许可文本见项目根目录 `LICENSE`；该许可同样适用于上述复用部分。MeetScribe 对会议状态、说话人管理、音频源、LLM 结构化纪要和 Word 输出做了独立扩展。

## 主要运行依赖

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) / `sherpa-onnx-node`：本地 ASR、VAD、SenseVoice 和 speaker embedding 运行时；上游采用 Apache-2.0。
- [docx](https://github.com/dolanmiu/docx)：生成原生 Office Open XML Word 文档；MIT。
- [React](https://react.dev/)：客户端 UI；MIT。
- DeepSeek Harness / Cordis：宿主插件服务，按其各自条款使用。

精确 npm 依赖版本见 `package-lock.json`。间接依赖的完整许可文本位于安装后的 `node_modules`。

## 运行时模型

模型不随本仓库分发。用户主动下载时，从以下上游获取，并执行仓库内固定的 SHA-256 校验：

| 用途 | 上游项目/模型 |
| --- | --- |
| 流式 ASR | `csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30` |
| VAD | `csukuangfj/vad` / Silero VAD |
| 整句复识别 | `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` |
| 说话人嵌入 | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`，来自 sherpa-onnx speaker-recognition models release |

相关上游：

- [Silero VAD](https://github.com/snakers4/silero-vad)
- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)
- [3D-Speaker / CAM++](https://github.com/modelscope/3D-Speaker)
- [sherpa-onnx 模型文档](https://k2-fsa.github.io/sherpa/onnx/)

模型权重、训练数据和转换后文件的许可可能不同于运行时代码，也可能包含各自的使用条件。下载和商用前请检查对应上游仓库、Hugging Face/ModelScope 模型卡及 release 随附声明；本仓库不重新授予模型权重许可。

## 示例数据

`docs/samples` 中的会议内容是虚构的产品评审样例，只用于展示结构化 JSON 和 Word 排版，不代表真实个人、组织或会议记录。

# Changelog

本项目遵循 Keep a Changelog 的结构，版本号采用语义化版本。

## [0.1.0] - 2026-11-21

### Added

- DeepSeek Harness 会议浮窗、展开工作台、设置页和右侧会议面板。
- Windows 全局 Ctrl+E 原生助手及应用内快捷键。
- sherpa-onnx 本地流式中文/英文识别、Silero VAD 分段和 SenseVoice 整句复识别。
- CAM++ 本地声纹嵌入、在线说话人聚类、改名、合并和逐段重新指派。
- 原始/清理文本视图、人工记录、会议元数据、历史会议与原子 JSON 持久化。
- 显式调用 Harness 当前 LLM 的结构化纪要流程。
- 原生 DOCX 商务模板、版本化文件记录和下载入口。
- 本地模型下载、主机允许列表、重定向校验和 SHA-256 校验。
- 单元测试、UI 组件截图、Word 示例和真实 Harness 测试报告。

### Verified

- Harness 0.2.2-rc.5 中的麦克风 → 本地 ASR → 持久化 → 浮窗显示链路。
- 两种合成语音形成两个真实声纹标签，并完成中英文识别。
- 从 Notepad 通过全局 Ctrl+E 唤起 Harness 浮窗。
- 使用真实 Harness LLM 生成 DOCX，并经 Word/PDF/PNG 渲染检查。

### Known limitations

- Harness 0.2.2-rc.5 拒绝 `getDisplayMedia`，系统声音和混合采集尚未取得可用权限。
- 实测存在断句偏早、漏字和重复词；重叠语音与真实远场会议仍待验证。
- 长会议尚未实现自动分块和层级汇总。

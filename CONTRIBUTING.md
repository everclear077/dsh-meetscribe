# 贡献指南

## 开发环境

- Windows 10/11 x64（完整桌面验证）
- Node.js 22+（transcribe.cpp 要求）
- DeepSeek Harness Desktop
- 可选：Microsoft Word 或 LibreOffice，用于 DOCX 渲染复核

```powershell
npm ci
npm run verify
```

不要提交 `.env`、个人 Harness profile、API 密钥、真实会议 JSON、声纹嵌入或模型缓存。

## 目录

```text
src/index.ts              Host 路由和业务编排
src/host/                模型、ASR、声纹、存储、LLM 与安全边界
src/client/              React UI、音频采集和会议控制器
src/shared/              共享类型与说话人聚类
src/word/                结构化纪要 schema、提示词和原生 DOCX
native/                  Windows Ctrl+E 助手
scripts/                 构建外的样例与诊断脚本
test/                    Node 单元测试
docs/                    产品、架构、模板和截图
```

## 修改原则

- 保持音频本地处理；新增外传路径必须获得用户明确操作授权并更新隐私文档。
- 不用模型输出覆盖用户填写的会议元数据，不编造未知事实。
- 原始逐字稿不可被清理视图覆盖。
- 保持会议、说话人、段落 ID 稳定，持久化写入使用临时文件 + 原子替换。
- Word 交付必须是原生 `.docx`，不能以 Markdown 或扩展名伪装替代。
- UI 样例必须标记合成数据；识别验证必须来自真实应用链路和实际保存段落。

## 验证

提交前至少运行：

```powershell
npm run typecheck
npm test
npm run sample:word
npm run sample:ui
```

修改 DOCX 后，将文件渲染为 PDF/PNG 并查看页面，不只检查 ZIP/XML。修改全局热键、音频或 ASR 后，需在真实 Harness Desktop 操作并更新 `TESTING.md`，明确成功、失败和未验证项目。

## 全局热键助手

```powershell
Get-Process MeetScribeHotkey -ErrorAction SilentlyContinue | Stop-Process -Force
.\native\build-helper.ps1
```

`Add-Type` 无法覆盖正在运行的 EXE，因此先停止助手。修改后完整重启 Harness，并从另一个应用测试 Ctrl+E。

## 提交与 Pull Request

- 使用聚焦的小提交，描述行为变化而非仅列文件名。
- PR 说明测试命令、真实桌面验证和剩余限制。
- 如果修改了隐私边界、模型来源或下载地址，同时更新 `SECURITY.md` 与 `THIRD_PARTY_NOTICES.md`。

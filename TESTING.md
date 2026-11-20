# 测试报告

测试日期：2026-11-21
目标宿主：DeepSeek Harness Desktop **0.2.2-rc.5**（Windows 11 x64）

本报告区分自动化测试、真实桌面链路、合成输入和未通过项目，避免把界面样例当成识别验证。

## 自动化检查

```text
npm run typecheck  通过
npm test           10/10 通过
npm run sample:ui  通过，生成 3 张组件截图
```

覆盖内容：

- 声纹余弦聚类、质心更新与最大说话人数；
- 填充词清理和中文标点边界；
- 会议原子持久化、说话人改名/合并/分段指派、异常中断状态恢复；
- 设置校验和范围收敛；
- LLM JSON 提取、schema 校验、事实约束提示词；
- 原生 DOCX ZIP 签名、固定表格宽度、真实 numbering、页码域和空章节省略。

## 真实 Harness 桌面验证

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| 插件加载 | 链接到 desktop profile，完整重启 Harness | 通过；Host 健康接口、设置和输入框入口可用 |
| 浮窗 | 点击输入框旁 MeetScribe 图标 | 通过；紧凑/展开界面可操作 |
| 全局 Ctrl+E | 在 Notepad 活跃时发送 Ctrl+E | 通过；Harness 前台化并打开浮窗 |
| 麦克风采集 | 浏览器授权后使用本机默认麦克风 | 通过；进入记录/聆听状态 |
| 本地 ASR | 扬声器播放中文与英文合成语音，由真实麦克风采集 | 通过；产生真实持久化段落 |
| 多说话人 | 中文 Huihui 与英文 Zira 两种系统语音分段播放 | 通过本次测试；形成 `speaker-1`、`speaker-2`，并保存实际置信度 |
| Word/LLM | 在真实会议点击“生成纪要”，使用 Harness 当前模型 | 通过；生成并记录版本化 `.docx` |
| Word 渲染 | Microsoft Word 转 PDF，再渲染为 PNG 检查 | 通过；真实文件 2 页，完整样例 3 页 |
| 系统声音 | 选择“系统声音”并点击开始 | **未通过：宿主返回 `Permission denied`，未显示共享选择器** |
| 麦克风 + 系统 | 依赖同一 `getDisplayMedia` 权限 | **未验证；受相同宿主权限限制** |

### 真实识别样例

中文：

```text
各位同事大家好。今天我们。
讨论下一版本的产品发布计划，请项目经理在星期五之前提。
交完整的测试报告。
```

英文：

```text
Good morning, everyone.
I'll sharehare the final report with the project manager.
```

中文段与英文段分别聚为两个说话人。后续中文段置信度约 `0.9207`、`0.8951`，英文新标签首段为 `0.3211`，后续为 `0.7606`。首轮英文测试已有真实文本；此前“英文未出段”不是最终结论。

这些结果也暴露了真实问题：断句偏早、句尾漏字和 `sharehare` 重复词。当前版本没有把合成语音测试包装成真人会议室准确率证明。

### 修复过程中定位的真实问题

1. `sherpa-onnx-node` 在 Harness/Electron 中默认返回 external ArrayBuffer，触发 `External buffers are not allowed`。现改为 `compute(stream, false)`，由 N-API 复制到 JavaScript 缓冲区；真实声纹结果已验证。
2. 全局助手注入 Ctrl+E 时仍持有同一热键，会拦截自己的合成输入。现于注入前临时注销，随后恢复；Notepad → Harness 全局调用已验证。
3. Harness 快捷键和 DOM 兜底可能同时切换浮窗。现仅在快捷键注册失败时启用 DOM 兜底。

## Word 视觉检查

完整示例：`docs/samples/meeting-minutes-sample.docx`

渲染图：`docs/images/word-sample/page-1.png` 至 `page-3.png`

已检查：

- A4 中文商务排版、标题和元数据表；
- 讨论、决议、行动项、未决事项；
- 固定列宽、页码和跨页重复表头；
- 缺少的信息显示“待补充/待确认”，未生成虚构的具名参会人。

## 截图来源说明

- `floating-transcript.png`、`expanded-transcript.png`、`meeting-details.png`：真实 React 组件 + 明确的合成会议数据，用于稳定展示布局，**不是识别准确率证据**。
- `harness-desktop-transcript.png`：真实 Harness 窗口，包含真实中英文转写和两个声纹标签。截图顶部保留了随后系统音频测试产生的权限错误，作为限制记录。
- `word-sample/*.png`：由示例 DOCX 渲染，不是 Word 界面样机。

## 尚未覆盖

- 真人两人在同一会议室同时交谈、重叠语音和远场麦克风；
- 数小时长会议、模型上下文超限和分段层级总结；
- 非 Windows 平台；
- 系统音频与混合采集的成功路径；
- 热键被其他应用占用时的自动重映射（当前仅记录冲突日志）。

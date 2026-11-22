import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

await mkdir('artifacts', { recursive: true })
await mkdir('docs/images', { recursive: true })
await build({ entryPoints: ['src/client/gallery.tsx'], outfile: 'artifacts/gallery.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { __AUDIO_WORKLET__: '""' } })
let browser
try { browser = await chromium.launch({ headless: true }) } catch { browser = await chromium.launch({ channel: 'msedge', headless: true }) }
const errors = []

async function galleryPage(theme, view = 'meeting', height = 900) {
  const page = await browser.newPage({ viewport: { width: 1280, height }, deviceScaleFactor: 1, colorScheme: theme })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('about:blank')
  await page.evaluate(({ theme, view }) => {
    document.documentElement.dataset.msTheme = theme
    window.meetScribeGalleryView = view
  }, { theme, view })
  await page.addScriptTag({ path: 'artifacts/gallery.js' })
  await page.locator(view.startsWith('workspace') ? '.ms-workspace' : view === 'settings' ? '.ms-settings' : '.ms-float').waitFor()
  await page.waitForTimeout(250)
  return page
}

const light = await galleryPage('light')
await light.screenshot({ path: 'docs/images/floating-transcript.png', fullPage: true })
if (await light.locator('.ms-controls').count()) throw new Error('Recording controls are still rendered in the footer.')
if (await light.locator('.ms-header .ms-record-control').count() !== 1) throw new Error('Header recording control is missing.')
if ((await light.locator('.ms-header .ms-live').textContent()) !== '') throw new Error('Header status still displays duplicate text.')
await light.getByTitle('展开详情').click()
const layerCheck = await light.evaluate(() => {
  const float = document.querySelector('.ms-float')
  if (!float) return { portaled: false, aboveSidebar: false }
  const rect = float.getBoundingClientRect()
  const sidebar = document.createElement('div')
  sidebar.style.cssText = 'position:fixed;left:0;top:0;width:280px;height:100vh;z-index:100000;background:red'
  document.body.appendChild(sidebar)
  const hit = document.elementFromPoint(rect.left + 24, rect.top + 28)
  const aboveSidebar = !!hit?.closest('.ms-float')
  sidebar.remove()
  return { portaled: float.parentElement === document.body, aboveSidebar }
})
if (!layerCheck.portaled || !layerCheck.aboveSidebar) throw new Error('Expanded float can still be covered by a high-z-index sidebar.')
await light.screenshot({ path: 'docs/images/expanded-transcript.png', fullPage: true })
await light.getByRole('button', { name: '会议信息', exact: true }).click()
await light.screenshot({ path: 'docs/images/meeting-details.png', fullPage: true })
const panelBox = await light.locator('.ms-float').boundingBox()
const saveBox = await light.getByRole('button', { name: '保存会议信息', exact: true }).boundingBox()
if (!panelBox || !saveBox || saveBox.y < panelBox.y || saveBox.y + saveBox.height > panelBox.y + panelBox.height) {
  throw new Error('Expanded meeting details hide the save action outside the visible panel.')
}
await light.getByRole('button', { name: '纪要文件', exact: true }).click()
if (await light.getByRole('link', { name: /下载/ }).count()) throw new Error('Meeting file details still expose a DOCX download link.')
await light.getByRole('button', { name: '在 DSH 中打开 MeetScribe 产品评审会 第 2 版', exact: true }).click()
await light.getByRole('dialog', { name: '在 DSH 中查看 MeetScribe 产品评审会-纪要-v2.docx', exact: true }).waitFor()
await light.locator('.ms-document-preview-frame').waitFor()
await light.getByRole('button', { name: '关闭文档预览', exact: true }).click()
await light.getByRole('button', { name: '实时记录', exact: true }).click()
await light.getByRole('button', { name: '清空', exact: true }).click()
await light.locator('.ms-notice').filter({ hasText: '逐字稿已清空' }).waitFor()
if (await light.locator('.ms-segment').count()) throw new Error('Clear did not remove transcript segments.')
if (await light.getByRole('button', { name: '开始记录', exact: true }).count()) throw new Error('Start button is still rendered.')
if (await light.locator('select[title="音频来源"]').count()) throw new Error('Audio source selector is still rendered.')
await light.getByRole('button', { name: '历史会议', exact: true }).click()
await light.getByRole('button', { name: '清空全部', exact: true }).click()
await light.getByRole('button', { name: '确认清空', exact: true }).click()
await light.locator('.ms-notice').filter({ hasText: '已清空全部历史会议' }).waitFor()
if (await light.locator('.ms-history-item').count()) throw new Error('Clear history did not remove every meeting.')
await light.close()

const conversationHandoff = await galleryPage('light')
await conversationHandoff.evaluate(() => {
  window.__meetingPrompts = []
  window.meetScribeGalleryController.setConversationHandoff((prompt) => window.__meetingPrompts.push(prompt))
})
await conversationHandoff.getByRole('button', { name: '在 DSH 对话中整理', exact: true }).click()
await conversationHandoff.waitForFunction(() => window.__meetingPrompts?.length === 1)
const handoffState = await conversationHandoff.evaluate(() => ({ prompts: window.__meetingPrompts, open: window.meetScribeGalleryController.getSnapshot().open }))
if (handoffState.prompts[0] !== '合成会议提示词' || handoffState.open) throw new Error('Conversation handoff did not leave a complete draft and close the floating window.')
await conversationHandoff.close()

const dark = await galleryPage('dark')
await dark.screenshot({ path: 'docs/images/floating-transcript-dark.png', fullPage: true })
await dark.getByTitle('最小化').click()
await dark.locator('.ms-minimized').waitFor()
await dark.screenshot({ path: 'docs/images/minimized-dark.png', fullPage: true })
await dark.getByTitle('恢复浮窗').click()
await dark.getByTitle('展开详情').click()
await dark.screenshot({ path: 'docs/images/expanded-transcript-dark.png', fullPage: true })
await dark.close()

const recordingHistory = await galleryPage('light')
await recordingHistory.evaluate(() => {
  const controller = window.meetScribeGalleryController
  const current = { ...controller.getSnapshot().current, status: 'recording' }
  controller.state = { ...controller.getSnapshot(), current, meetings: [current], open: true, expanded: true }
  controller.engine = { stop: async () => {} }
  controller.begin = async () => { window.__historyRestarted = true }
  controller.setTab('history')
})
await recordingHistory.getByRole('button', { name: '清空全部', exact: true }).click()
const recordingDot = await recordingHistory.locator('.ms-header .ms-live.is-live').evaluate((element) => getComputedStyle(element).backgroundColor)
if (recordingDot !== 'rgb(59, 168, 119)') throw new Error(`Recording status is not green: ${recordingDot}`)
await recordingHistory.getByRole('button', { name: '确认清空', exact: true }).click()
await recordingHistory.waitForFunction(() => window.__historyRestarted === true)
await recordingHistory.close()

const workspaceLight = await galleryPage('light', 'workspace')
if (await workspaceLight.locator('.ms-document-row').count() !== 3) throw new Error('Workspace does not list every generated Word version.')
if (!await workspaceLight.locator('.ms-document-row').first().getByText('MeetScribe 产品评审会-v2.docx', { exact: true }).count()) throw new Error('Default document sort is not newest first.')
const search = workspaceLight.getByLabel('搜索会议纪要')
await search.fill('研发')
if (await workspaceLight.locator('.ms-document-row').count() !== 1 || !await workspaceLight.getByText('十一月研发周会-v1.docx', { exact: true }).count()) throw new Error('Document search did not filter by meeting and file name.')
await search.fill('')
await workspaceLight.getByLabel('纪要排序方式').selectOption('name-asc')
const nameOrder = await workspaceLight.locator('.ms-document-name strong').allTextContents()
const expectedNameOrder = [...nameOrder].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }))
if (JSON.stringify(nameOrder) !== JSON.stringify(expectedNameOrder)) throw new Error(`Document name sort is incorrect: ${nameOrder.join(', ')}`)
await workspaceLight.getByLabel('纪要排序方式').selectOption('created-desc')
const openDocument = workspaceLight.getByRole('button', { name: '在 DSH 中打开 MeetScribe 产品评审会-v2.docx', exact: true })
if (await workspaceLight.getByRole('link', { name: /下载/ }).count()) throw new Error('Workspace still exposes a download link.')
await openDocument.click()
await workspaceLight.getByRole('dialog', { name: '在 DSH 中查看 MeetScribe 产品评审会-v2.docx', exact: true }).waitFor()
await workspaceLight.locator('.ms-document-preview-frame').waitFor()
await workspaceLight.getByRole('button', { name: '关闭文档预览', exact: true }).click()
await workspaceLight.getByRole('button', { name: '刷新文件列表', exact: true }).click()
if (await workspaceLight.locator('.ms-document-row').count() !== 3) throw new Error('Refreshing the document library changed its contents unexpectedly.')
await workspaceLight.screenshot({ path: 'docs/images/workspace-documents-light.png', fullPage: true })
if (await workspaceLight.locator('.ms-generation-task.is-running').count() !== 1) throw new Error('Workspace does not show the running generation task.')
if (!await workspaceLight.getByText('正在接收模型正文，已收到 768 个字符', { exact: true }).count()) throw new Error('Model streaming progress is not visible.')
await workspaceLight.getByRole('button', { name: /识别设置/ }).click()
await workspaceLight.locator('.ms-settings').waitFor()
await workspaceLight.getByRole('button', { name: /纪要文件/ }).click()
await workspaceLight.locator('.ms-document-list').waitFor()
await workspaceLight.close()

const workspaceDark = await galleryPage('dark', 'workspace')
await workspaceDark.screenshot({ path: 'docs/images/workspace-documents-dark.png', fullPage: true })
await workspaceDark.close()

const workspaceNarrow = await galleryPage('light', 'workspace')
await workspaceNarrow.setViewportSize({ width: 360, height: 760 })
const narrowLayout = await workspaceNarrow.evaluate(() => ({
  viewport: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  workspaceWidth: document.querySelector('.ms-workspace')?.scrollWidth,
  openVisible: !!document.querySelector('.ms-document-open')?.getBoundingClientRect().width,
}))
if (narrowLayout.documentWidth > narrowLayout.viewport || narrowLayout.workspaceWidth > narrowLayout.viewport || !narrowLayout.openVisible) throw new Error(`Narrow workspace layout overflows: ${JSON.stringify(narrowLayout)}`)
if (await workspaceNarrow.locator('.ms-generation-task.is-running').count() !== 1) throw new Error('Running task disappears in the narrow workspace.')
await workspaceNarrow.screenshot({ path: 'docs/images/workspace-tasks-narrow.png', fullPage: true })
await workspaceNarrow.close()

const workspaceTasks = await galleryPage('light', 'workspace-tasks')
if (!await workspaceTasks.getByText('大模型请求失败（AUTH）：合成测试凭据被拒绝', { exact: true }).count()) throw new Error('Generation failure detail is not shown in the workspace.')
const completedOpen = workspaceTasks.getByRole('button', { name: '在 DSH 中打开', exact: true })
if (!await completedOpen.count()) throw new Error('Completed task does not open its generated Word version in DSH.')
await workspaceTasks.screenshot({ path: 'docs/images/workspace-task-states-light.png', fullPage: true })
await workspaceTasks.getByRole('button', { name: '重试生成', exact: true }).click()
await workspaceTasks.locator('.ms-generation-task.is-running').waitFor()
if (await workspaceTasks.getByRole('button', { name: '重试生成', exact: true }).count()) throw new Error('Retry did not replace the failed task with a running task.')
await workspaceTasks.close()

async function checkWorkspaceSettings(theme) {
  const page = await galleryPage(theme, 'workspace-settings', 1400)
  const modelStateLayout = await page.locator('.ms-model-state').evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width,
    text: element.textContent,
  }))
  if (modelStateLayout.text !== '模型已就绪' || modelStateLayout.height > 30 || modelStateLayout.width < 60) {
    throw new Error(`Model readiness label layout is broken: ${JSON.stringify(modelStateLayout)}`)
  }
  if (!await page.getByText('transcribe.cpp 0.4.1', { exact: false }).count()) throw new Error('Local model description is stale.')
  if (!await page.getByText('ERes2NetV2 声纹', { exact: false }).count()) throw new Error('Speaker model description is stale.')
  const minutesModelSelect = page.getByLabel('纪要模型', { exact: true })
  if (await minutesModelSelect.inputValue() !== '') throw new Error('Minutes model should follow the DSH default by default.')
  if (await page.getByLabel('模型无响应超时', { exact: true }).inputValue() !== '300000') throw new Error('Default model idle timeout is not five minutes.')
  const silenceInput = page.locator('input[type="number"]')
  if (await silenceInput.inputValue() !== '800') throw new Error('Default silence is not 800 ms.')
  const speakerThresholdInput = page.locator('input[type="range"]')
  if (await speakerThresholdInput.inputValue() !== '0.65') throw new Error('Default speaker threshold is not 0.65.')
  if (theme === 'light') {
    await minutesModelSelect.selectOption(JSON.stringify(['synthetic', 'minutes-reasoning']))
    const reasoningSelect = page.getByLabel('纪要推理强度', { exact: true })
    await reasoningSelect.selectOption('high')
    await page.getByLabel('模型无响应超时', { exact: true }).selectOption('600000')
    await page.getByRole('button', { name: '刷新纪要模型列表', exact: true }).click()
    if (await minutesModelSelect.locator('option').count() !== 3) throw new Error('DSH conversation model catalog is not shown in settings.')
    if (await minutesModelSelect.locator('optgroup').count() !== 1) throw new Error('DSH provider grouping is not preserved.')
    if (await minutesModelSelect.locator('optgroup').getAttribute('label') !== '合成 Provider') throw new Error('DSH provider group label is not preserved.')
    if (await reasoningSelect.inputValue() !== 'high') throw new Error('Reasoning effort selection was not preserved.')
    const customTemplate = page.locator('.ms-template-row').filter({ hasText: '合成部门模板' })
    await customTemplate.getByRole('button', { name: '设为默认', exact: true }).click()
    await customTemplate.getByText('当前默认', { exact: true }).waitFor()
    const builtinTemplate = page.locator('.ms-template-row').filter({ hasText: '正式会议纪要' })
    await builtinTemplate.getByRole('button', { name: '设为默认', exact: true }).click()
    await builtinTemplate.getByText('当前默认', { exact: true }).waitFor()
    await page.getByText('自定义模板的内容标记', { exact: true }).click()
    if (!await page.getByText('{{MEETSCRIBE_BODY}}', { exact: true }).count()) throw new Error('Custom template content marker guidance is missing.')
    await page.getByText('自定义模板的内容标记', { exact: true }).click()
    await page.getByLabel('行业术语纠正表').fill('OKR = 欧凯尔 | 欧 k 尔\nAPI = 阿皮')
    await page.getByRole('button', { name: '保存术语表', exact: true }).click()
    await page.locator('.ms-notice').filter({ hasText: '术语表已保存，共 2 条' }).waitFor()
    if (!/OKR = 欧凯尔 \| 欧 k 尔/.test(await page.getByLabel('行业术语纠正表').inputValue())) throw new Error('Terminology editor did not preserve the saved rules.')
  }
  await page.locator('.ms-workspace-settings').evaluate((element) => element.scrollTo({ top: 0 }))
  await page.screenshot({ path: `docs/images/settings-${theme}.png`, fullPage: true })
  await page.close()
}
await checkWorkspaceSettings('light')
await checkWorkspaceSettings('dark')

const settingsNarrow = await galleryPage('light', 'workspace-settings', 760)
await settingsNarrow.setViewportSize({ width: 360, height: 760 })
const narrowSettings = await settingsNarrow.evaluate(() => ({
  viewport: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  settingsWidth: document.querySelector('.ms-settings')?.scrollWidth,
  modelSelectWidth: document.querySelector('select[aria-label="纪要模型"]')?.getBoundingClientRect().width,
}))
if (narrowSettings.documentWidth > narrowSettings.viewport || narrowSettings.settingsWidth > narrowSettings.viewport || !narrowSettings.modelSelectWidth) throw new Error(`Narrow model settings overflow: ${JSON.stringify(narrowSettings)}`)
await settingsNarrow.close()

await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
console.log('Saved light/dark meeting, minimized, document workspace and settings screenshots to docs/images.')

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
const downloadHref = await workspaceLight.getByRole('link', { name: '下载 MeetScribe 产品评审会-v2.docx', exact: true }).getAttribute('href')
if (downloadHref !== '/meetscribe/meetings/preview/documents/2') throw new Error(`Document download route is incorrect: ${downloadHref}`)
await workspaceLight.getByRole('button', { name: '刷新文件列表', exact: true }).click()
if (await workspaceLight.locator('.ms-document-row').count() !== 3) throw new Error('Refreshing the document library changed its contents unexpectedly.')
await workspaceLight.screenshot({ path: 'docs/images/workspace-documents-light.png', fullPage: true })
await workspaceLight.getByRole('button', { name: '识别设置', exact: true }).click()
await workspaceLight.locator('.ms-settings').waitFor()
await workspaceLight.getByRole('button', { name: '纪要文件', exact: true }).click()
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
  downloadVisible: !!document.querySelector('.ms-document-download')?.getBoundingClientRect().width,
}))
if (narrowLayout.documentWidth > narrowLayout.viewport || narrowLayout.workspaceWidth > narrowLayout.viewport || !narrowLayout.downloadVisible) throw new Error(`Narrow workspace layout overflows: ${JSON.stringify(narrowLayout)}`)
await workspaceNarrow.close()

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
  if (!await page.getByText('transcribe.cpp 0.4.1', { exact: false }).count()) throw new Error('Orca model description is stale.')
  if (!await page.getByText('ERes2NetV2 声纹', { exact: false }).count()) throw new Error('Speaker model description is stale.')
  const silenceInput = page.locator('input[type="number"]')
  if (await silenceInput.inputValue() !== '800') throw new Error('Default silence is not 800 ms.')
  const speakerThresholdInput = page.locator('input[type="range"]')
  if (await speakerThresholdInput.inputValue() !== '0.56') throw new Error('Default speaker threshold is not 0.56.')
  if (theme === 'light') {
    await page.getByLabel('行业术语纠正表').fill('OKR = 欧凯尔 | 欧 k 尔\nAPI = 阿皮')
    await page.getByRole('button', { name: '保存术语表', exact: true }).click()
    await page.locator('.ms-notice').filter({ hasText: '术语表已保存，共 2 条' }).waitFor()
    if (!/OKR = 欧凯尔 \| 欧 k 尔/.test(await page.getByLabel('行业术语纠正表').inputValue())) throw new Error('Terminology editor did not preserve the saved rules.')
  }
  await page.screenshot({ path: `docs/images/settings-${theme}.png`, fullPage: true })
  await page.close()
}
await checkWorkspaceSettings('light')
await checkWorkspaceSettings('dark')

await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
console.log('Saved light/dark meeting, minimized, document workspace and settings screenshots to docs/images.')

import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

await mkdir('artifacts', { recursive: true })
await mkdir('docs/images', { recursive: true })
await build({ entryPoints: ['src/client/gallery.tsx'], outfile: 'artifacts/gallery.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { __AUDIO_WORKLET__: '""' } })
let browser
try { browser = await chromium.launch({ headless: true }) } catch { browser = await chromium.launch({ channel: 'msedge', headless: true }) }
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.goto('about:blank')
await page.addScriptTag({ path: 'artifacts/gallery.js' })
await page.locator('.ms-float').waitFor()
await page.waitForTimeout(250)
await page.screenshot({ path: 'docs/images/floating-transcript.png', fullPage: true })
await page.getByTitle('展开详情').click()
await page.screenshot({ path: 'docs/images/expanded-transcript.png', fullPage: true })
await page.getByRole('button', { name: '会议信息', exact: true }).click()
await page.screenshot({ path: 'docs/images/meeting-details.png', fullPage: true })
await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
console.log('Saved three UI screenshots to docs/images.')

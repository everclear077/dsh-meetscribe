import type { ReactNode } from 'react'
import { MeetingApp } from './meeting.tsx'
import { MeetScribeWorkspace } from './workspace.tsx'
import { Mark } from './components.tsx'
import { meetings } from './meeting-controller.ts'
import { styles } from './styles.ts'

interface SlotRegistry {
  inject(name: string, callback: () => unknown): unknown
  register(meta: Record<string, unknown>, component: (...args: never[]) => ReactNode): unknown
}
interface ClientContext {
  slots: SlotRegistry
  shortcuts: { register(command: Record<string, unknown>): () => void }
  sidebarRight: { openTab(kind: string): void }
  sidebarRightTabs: { register(definition: Record<string, unknown>): () => void }
  effect(callback: () => void | (() => void)): void
}

function OpenButton(): ReactNode {
  return <button className="ms-root ms-icon ms-open-button" style={{ width: 32, height: 32 }} title="MeetScribe 会议记录 (Ctrl+E)" onClick={meetings.toggle}><Mark /></button>
}

function PanelIcon(): ReactNode {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" /></svg>
}

export const name = 'dsh-meetscribe'
export const inject = ['slots', 'shortcuts', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx: ClientContext): void {
  let shortcutRegistered = false
  ctx.effect(() => {
    const style = document.createElement('style')
    style.id = 'dsh-meetscribe-styles'
    style.textContent = styles
    document.head.appendChild(style)
    const themeMedia = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = (): void => {
      const declared = [document.documentElement, document.body]
        .map((element) => `${element.className} ${element.getAttribute('data-theme') ?? ''} ${element.getAttribute('data-color-scheme') ?? ''}`)
        .join(' ').toLowerCase()
      document.documentElement.dataset.msTheme = declared.includes('dark') || (!declared.includes('light') && themeMedia.matches) ? 'dark' : 'light'
    }
    const themeObserver = new MutationObserver(syncTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] })
    if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] })
    themeMedia.addEventListener('change', syncTheme)
    syncTheme()
    void meetings.init()
    const keydown = (event: KeyboardEvent): void => {
      if (shortcutRegistered) return
      if (event.key.toLowerCase() === 'e' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !event.repeat) {
        event.preventDefault()
        meetings.toggle()
      }
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('dsh-meetscribe:toggle', meetings.toggle)
    return () => {
      style.remove()
      themeObserver.disconnect()
      themeMedia.removeEventListener('change', syncTheme)
      delete document.documentElement.dataset.msTheme
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('dsh-meetscribe:toggle', meetings.toggle)
      meetings.dispose()
    }
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'meetscribe.overlay', order: 80 }, MeetingApp))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'meetscribe.open', order: 80 }, OpenButton))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-meetscribe', order: 70, label: () => 'MeetScribe' }, PanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-meetscribe' }, MeetScribeWorkspace))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: 'dsh-meetscribe', kind: 'meetscribe', title: () => '会议记录', keepMounted: true }))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-meetscribe' }, MeetingApp))
  try {
    ctx.effect(() => {
      const unregister = ctx.shortcuts.register({
      id: 'meetscribe.toggle', label: () => '唤出 MeetScribe 会议记录', aliases: ['meeting', 'transcription', '会议'],
      defaults: {
        'desktop:windows': { code: 'KeyE', modifiers: ['primary'] },
        'web:windows': { code: 'KeyE', modifiers: ['primary'] },
        'desktop:macos': { code: 'KeyE', modifiers: ['control'] },
        'web:macos': { code: 'KeyE', modifiers: ['control'] },
        'desktop:linux': { code: 'KeyE', modifiers: ['primary'] },
        'web:linux': { code: 'KeyE', modifiers: ['primary'] },
      },
      regions: ['page', 'editable'], modals: [],
      resolve: () => ({ status: 'handled', run() { meetings.toggle() } }),
      })
      shortcutRegistered = true
      return () => {
        shortcutRegistered = false
        unregister()
      }
    })
  } catch {
    // The DOM listener above remains as a compatibility fallback.
  }
}

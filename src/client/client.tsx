import type { ReactNode } from 'react'
import { MeetingApp } from './meeting.tsx'
import { MeetingSettings } from './settings.tsx'
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
  return <button className="ms-root ms-icon" style={{ color: '#526579', width: 32, height: 32 }} title="MeetScribe 会议记录 (Ctrl+E)" onClick={meetings.toggle}><Mark /></button>
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
    return () => { style.remove(); window.removeEventListener('keydown', keydown); window.removeEventListener('dsh-meetscribe:toggle', meetings.toggle); meetings.dispose() }
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'meetscribe.overlay', order: 80 }, MeetingApp))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'meetscribe.open', order: 80 }, OpenButton))
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'meetscribe', order: 90, label: () => 'MeetScribe 会议记录' }, MeetingSettings))
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

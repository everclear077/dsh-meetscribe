import type { ReactNode } from 'react'

export function Icon({ name }: { name: 'expand' | 'collapse' | 'close' | 'pause' | 'play' | 'clear' | 'file' | 'more' | 'minimize' | 'restore' | 'folder' | 'search' | 'settings' | 'download' | 'refresh' | 'chat' }): ReactNode {
  const paths = {
    expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></>,
    collapse: <><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 5 11 7-11 7z" />,
    clear: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
    file: <><path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    minimize: <path d="M5 12h14" />,
    restore: <><path d="M8 8V5h11v11h-3" /><path d="M5 8h11v11H5z" /></>,
    folder: <path d="M3 7V5h6l2 2h10v12H3z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    settings: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 20h16" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.8-1L20 12M4 12l2.1 5a7 7 0 0 0 11.8-1" /></>,
    chat: <><path d="M4 4h16v12H9l-5 4z" /><path d="M8 8h8M8 12h5" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export function Mark(): ReactNode {
  return <span className="ms-mark" aria-hidden="true"><i /><i /><i /><i /></span>
}

export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function segmentTime(ms: number): string {
  return clock(ms).replace(/^00:/, '')
}

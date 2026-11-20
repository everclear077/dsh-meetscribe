import type { ReactNode } from 'react'

export function Icon({ name }: { name: 'expand' | 'collapse' | 'close' | 'pause' | 'file' | 'more' }): ReactNode {
  const paths = {
    expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></>,
    collapse: <><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    pause: <path d="M8 5v14M16 5v14" />,
    file: <><path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
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

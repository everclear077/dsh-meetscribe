import type { Meeting } from './types.ts'

export type MinutesSort = 'created-desc' | 'created-asc' | 'name-asc' | 'name-desc'

export interface MinutesDocument {
  key: string
  meetingId: string
  meetingTitle: string
  fileName: string
  path: string
  version: number
  createdAt: string
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || '会议纪要.docx'
}

export function collectMinutesDocuments(meetings: Meeting[]): MinutesDocument[] {
  return meetings.flatMap((meeting) => (meeting.generatedFiles ?? []).map((file) => ({
    key: `${meeting.id}:${file.version}`,
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    fileName: fileName(file.path),
    path: file.path,
    version: file.version,
    createdAt: file.createdAt,
  })))
}

export function queryMinutesDocuments(documents: MinutesDocument[], query: string, sort: MinutesSort): MinutesDocument[] {
  const normalizedQuery = query.trim().normalize('NFKC').toLocaleLowerCase()
  const filtered = normalizedQuery
    ? documents.filter((document) => `${document.fileName}\n${document.meetingTitle}\n${document.path}`.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery))
    : [...documents]
  const direction = sort === 'created-desc' || sort === 'name-desc' ? -1 : 1
  return filtered.sort((a, b) => {
    if (sort === 'name-asc' || sort === 'name-desc') {
      return direction * a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true, sensitivity: 'base' })
        || b.createdAt.localeCompare(a.createdAt)
        || b.version - a.version
    }
    return direction * (a.createdAt.localeCompare(b.createdAt) || a.meetingId.localeCompare(b.meetingId) || a.version - b.version)
  })
}

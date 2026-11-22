import type { Meeting, MeetScribeSettings, MinutesModelCatalog, MinutesTask } from '../shared/types.ts'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/meetscribe${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })
  const value = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new ApiError(value.error || `请求失败 (${response.status})`, response.status)
  return value
}

export const api = {
  meetings: () => request<Meeting[]>('/meetings'),
  meeting: (id: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}`),
  documentUrl: (meetingId: string, version: number) => `/meetscribe/meetings/${encodeURIComponent(meetingId)}/documents/${version}`,
  create: (title?: string) => request<Meeting>('/meetings', { method: 'POST', body: JSON.stringify({ title }) }),
  clearHistory: () => request<{ ok: boolean }>('/meetings', { method: 'DELETE' }),
  update: (id: string, patch: Record<string, unknown>) => request<Meeting>(`/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  action: (id: string, action: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' }),
  clear: (id: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}/clear`, { method: 'POST', body: '{}' }),
  note: (id: string, text: string, speakerId?: string) => request<unknown>(`/meetings/${encodeURIComponent(id)}/segments`, { method: 'POST', body: JSON.stringify({ text, speakerId }) }),
  rename: (id: string, speakerId: string, name: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}/speakers/${encodeURIComponent(speakerId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  merge: (id: string, sourceId: string, targetId: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}/speakers/merge`, { method: 'POST', body: JSON.stringify({ sourceId, targetId }) }),
  reassign: (id: string, segmentId: string, speakerId: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}/segments/${encodeURIComponent(segmentId)}/speaker`, { method: 'POST', body: JSON.stringify({ speakerId }) }),
  generate: (id: string) => request<MinutesTask>(`/meetings/${encodeURIComponent(id)}/generate`, { method: 'POST', body: '{}' }),
  conversationPrompt: (id: string) => request<{ prompt: string }>(`/meetings/${encodeURIComponent(id)}/conversation-prompt`, { method: 'POST', body: '{}' }),
  minutesTasks: () => request<MinutesTask[]>('/minutes-tasks'),
  minutesModels: () => request<MinutesModelCatalog>('/minutes-models'),
  settings: () => request<MeetScribeSettings>('/settings'),
  saveSettings: (settings: Partial<MeetScribeSettings>) => request<MeetScribeSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  selectOutputDirectory: () => request<{ path: string | null }>('/settings/select-directory', { method: 'POST', body: '{}' }),
  models: () => request<Record<string, unknown>>('/models/status'),
  downloadModels: () => request<Record<string, unknown>>('/models/download', { method: 'POST', body: '{}' }),
}

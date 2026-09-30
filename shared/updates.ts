export interface UpdateItem {
  id: string
  label: string
  category: 'dependency' | 'agent' | 'system'
  current: string | null
  latest: string | null
  available: boolean
  canUpdate: boolean
  error: string | null
}
export interface UpdateJob {
  running: boolean
  items: { id: string; state: 'queued' | 'running' | 'succeeded' | 'failed'; error: string | null }[]
}
export interface UpdatesStatus { items: UpdateItem[]; checkedAt: number; job: UpdateJob }

export function batchUpdateIds(items: UpdateItem[]): string[] {
  return items.filter(item => item.canUpdate && item.category === 'system').map(item => item.id)
}

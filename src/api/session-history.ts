import { sessionHistoryBounds, type MewSessionHistory, type SessionHistoryFilter } from '../../shared/active-sessions'
export { sessionHistoryBounds, type SessionHistoryFilter } from '../../shared/active-sessions'

function historyQuery(filter: SessionHistoryFilter) {
  const bounds = sessionHistoryBounds(filter)
  return new URLSearchParams({ ...Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, String(value)])), ...(filter.person ? { person: filter.person } : {}) }).toString()
}
async function response(url: string, signal?: AbortSignal) {
  const result = await fetch(url, { signal, cache: 'no-store' })
  if (!result.ok) throw new Error(`History request failed (${result.status})`)
  return result
}
export async function fetchSessionHistory(filter: SessionHistoryFilter, signal: AbortSignal): Promise<MewSessionHistory> {
  return (await response(`/api/presence/history?${historyQuery(filter)}`, signal)).json() as Promise<MewSessionHistory>
}
export async function downloadSessionHistory(filter: SessionHistoryFilter) {
  const blob = await (await response(`/api/presence/history/export?${historyQuery(filter)}`)).blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = `mew-sessions-${filter.day}-${String(filter.fromHour).padStart(2, '0')}-${String(filter.toHour).padStart(2, '0')}.xlsx`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

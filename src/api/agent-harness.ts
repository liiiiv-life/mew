import type { HarnessDetail, HarnessInventory, HarnessKind, HarnessMutation } from '../../shared/agent-harness'

async function result<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다')
  return body
}
export function fetchHarness(cwd: string, kind: HarnessKind, signal?: AbortSignal) {
  return fetch(`/api/agent/harness?${new URLSearchParams({ cwd, kind })}`, { signal }).then(result<HarnessInventory>)
}
export function fetchHarnessDetail(cwd: string, kind: HarnessKind, id: string, signal?: AbortSignal) {
  return fetch(`/api/agent/harness/detail?${new URLSearchParams({ cwd, kind, id })}`, { signal }).then(result<HarnessDetail>)
}
export function mutateHarness(input: HarnessMutation) {
  return fetch('/api/agent/harness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(result<{ ok: boolean }>)
}

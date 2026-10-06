import type { DebugConfig, DebugSnapshot } from '../../shared/debugger'
export async function debuggerRequest<T>(root: string, endpoint = '', body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/debugger${endpoint}`, { method, signal, headers: { 'Content-Type': 'application/json', 'X-Mew-Debug-Workspace': encodeURIComponent(root) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data as T
}
export interface DebuggerStatus { config: DebugConfig; session: DebugSnapshot; adapter: { installed: boolean; version: string } }

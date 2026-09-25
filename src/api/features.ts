import { uiText } from '@mew/ui/i18n-core'
import type { Feature, FeatureRequest, FeatureRun, FeatureWorkspace } from '../../shared/features'
export type FeatureSnapshot = FeatureWorkspace & { canEdit: boolean }
async function result<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || uiText("기능 요청에 실패했습니다"))
  return data as T
}
export const fetchFeatures = (workspace: string, signal?: AbortSignal) => fetch(`/api/features?workspace=${encodeURIComponent(workspace)}`, { signal }).then(result<FeatureSnapshot>)
function send<T>(workspace: string, url: string, body: unknown, method = 'POST'): Promise<T> {
  return fetch(`/api/features${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body as object, workspace }) }).then(result<T>)
}
export const requestFeature = (workspace: string, input: FeatureRequest) => send<{ run: FeatureRun }>(workspace, '/requests', input)
export const editFeature = (workspace: string, feature: Pick<Feature, 'id' | 'version' | 'title' | 'content' | 'parentId'>) => send<{ feature: Feature }>(workspace, `/${encodeURIComponent(feature.id)}`, feature, 'PATCH')
export const judgeFeature = (workspace: string, id: string, version: number, status: 'verified' | 'needs-fix') => send<{ feature: Feature }>(workspace, `/${encodeURIComponent(id)}/status`, { version, status })
export const cancelFeatureRun = (workspace: string, id: string) => send<{ ok: true }>(workspace, `/runs/${encodeURIComponent(id)}/cancel`, {})

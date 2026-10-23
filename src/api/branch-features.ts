import type { BranchFeaturePatch, BranchFeatureSnapshot } from '../../shared/branch-features'
import { mewFetch } from '../utils/remote-transport'
import { uiText } from '@mew/ui/i18n-core'
async function snapshot(response: Response): Promise<BranchFeatureSnapshot> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || uiText('기능 요청에 실패했습니다'))
  return data
}
export function fetchBranchFeatures(workspace: string, signal?: AbortSignal) {
  return mewFetch(`/api/features/branches?workspace=${encodeURIComponent(workspace)}`, { signal }).then(snapshot)
}
export function saveBranchFeature(workspace: string, patch: BranchFeaturePatch) {
  return mewFetch('/api/features/branches', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, ...patch }) }).then(snapshot)
}

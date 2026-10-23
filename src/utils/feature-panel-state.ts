import type { FeatureSort } from '../../shared/features'

export type FeaturePanelState = {
  expandedFeatures: string[]
  expandedSections: string[]
  sort: FeatureSort
  scrollTop: number
}

export function featurePanelState(value: unknown): FeaturePanelState {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<FeaturePanelState> : {}
  const strings = (items: unknown) => Array.isArray(items) ? [...new Set(items.filter((item): item is string => typeof item === 'string'))] : []
  return {
    expandedFeatures: strings(state.expandedFeatures),
    expandedSections: strings(state.expandedSections),
    sort: state.sort === 'name' || state.sort === 'created' ? state.sort : 'updated',
    scrollTop: typeof state.scrollTop === 'number' && Number.isFinite(state.scrollTop) ? Math.max(0, state.scrollTop) : 0,
  }
}

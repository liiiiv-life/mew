export const FEATURES = ['filesRead', 'filesWrite', 'agent', 'terminal', 'desktop', 'browser', 'android', 'serverFiles', 'git', 'database', 'collaboration', 'chat', 'system', 'schedules'] as const
export type Feature = typeof FEATURES[number]
export type Capabilities = Record<Feature, boolean>
export type AccessRole = 'guest' | 'member' | 'manager' | 'owner'
export const GUEST_FEATURES: readonly Feature[] = ['filesRead', 'filesWrite']
export interface FileRule { path: string; view: boolean; edit: boolean }
export interface AccessRow {
  subject: string
  role: AccessRole
  displayName: string
  capabilities: Capabilities
  overrides: Partial<Capabilities>
}
export interface AccessSettings { rows: AccessRow[]; workspace: string }
export function defaultCapabilities(role: AccessRole): Capabilities {
  return Object.fromEntries(FEATURES.map(feature => [feature,
    role === 'owner' || role === 'manager' || (role === 'guest' ? GUEST_FEATURES.includes(feature) : ['filesRead', 'filesWrite', 'database', 'collaboration', 'chat'].includes(feature)),
  ])) as Capabilities
}

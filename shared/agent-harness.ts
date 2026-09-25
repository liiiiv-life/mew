export type HarnessKind = 'skills' | 'mcp'
export interface HarnessScope { id: string; label: string; path: string; global: boolean }
export interface HarnessLocation {
  id: string
  kind: HarnessKind
  scope: string
  agent: string
  label: string
  path: string
  writable: boolean
  reason?: string
}
export interface HarnessItem {
  managed?: boolean
  id: string
  location: string
  name: string
  description: string
  path: string
  writable: boolean
  reason?: string
}
export interface HarnessInventory {
  scopes: HarnessScope[]
  agents: { id: string; label: string }[]
  locations: HarnessLocation[]
  items: HarnessItem[]
  warnings: string[]
}
export interface HarnessDetail { item: HarnessItem; content: string; revision: string; files: string[] }
export interface HarnessMutation {
  cwd: string
  kind: HarnessKind
  action: 'save' | 'move' | 'delete' | 'create'
  id?: string
  revision?: string
  target?: string
  name?: string
  content?: string
}

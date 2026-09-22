export interface RagSettings {
  enabled: boolean
  agentGuidance: boolean
}

export interface RagConfiguration extends RagSettings {
  environmentDisabled: boolean
}

export interface RagDocument {
  path: string
  chunks: number
  bytes: number
  modifiedAt: number
}

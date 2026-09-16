export interface ProjectAgentSettings {
  version: 1
  enabled: boolean
  docsDir: string
  entrypoints: string[]
  instructions: string
}

export interface AgentContextBinding {
  projectRoot: string
  docsRoot: string
}

export interface ProjectSetupInput {
  projectRoot: string
  settings: ProjectAgentSettings
  initDocs?: boolean
  exportAgents?: boolean
  create?: boolean
}

export interface ProjectSetupPlan {
  projectRoot: string
  settings: ProjectAgentSettings
  files: { path: string; action: 'create' | 'preserve' | 'update' }[]
  revision: string
  context: string
}

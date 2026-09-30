export const MEWCAT_PANELS = ['agent', 'documents', 'git', 'browser', 'settings', 'projects'] as const
export type MewcatPanel = typeof MEWCAT_PANELS[number]
export type MewcatAction =
  | { kind: 'open_project'; path: string }
  | { kind: 'open_panel'; panel: MewcatPanel }
  | { kind: 'open_file'; projectRoot: string; path: string }
  | { kind: 'refresh_documents'; projectRoot: string }
  | { kind: 'start_project_session'; projectRoot: string; runtime: string; request: string }
export interface MewcatContext { projectRoot: string | null; locale: string }
export interface MewcatActionRequest { type: 'mewcat_action'; id: string; action: MewcatAction }
export type MewcatClientMessage =
  | { type: 'mewcat_context'; context: MewcatContext }
  | { type: 'mewcat_action_result'; id: string; ok: boolean; code?: string }
export const MEWCAT_HELP_TOPICS = ['start', 'projects', 'documents', 'agents', 'git', 'mewcat'] as const
export const MEWCAT_TOOLS = [
  { name: 'mew_get_context', description: 'Get the live Mew project, UI language, permissions, and default parent for new projects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'mew_get_help', description: 'Read current Mew product documentation. Use before explaining unfamiliar functionality.', inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: MEWCAT_HELP_TOPICS } }, required: ['topic'], additionalProperties: false } },
  { name: 'mew_create_project', description: 'Create a new project folder in an existing parent. Existing folders are never overwritten. Returns the absolute project path; then use mew_open_project.', inputSchema: { type: 'object', properties: { parent: { type: 'string' }, name: { type: 'string' } }, required: ['parent', 'name'], additionalProperties: false } },
  { name: 'mew_open_project', description: 'Open an existing project in the user’s Mew project tabs. Waits for the browser to finish switching.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'mew_setup_documents', description: 'Create missing Documents entrypoints in a project, preserving its existing settings and documents. Uses the user’s UI language.', inputSchema: { type: 'object', properties: { projectRoot: { type: 'string' } }, required: ['projectRoot'], additionalProperties: false } },
  { name: 'mew_open_file', description: 'Open an existing UTF-8 project file in the Mew editor. Path is relative to projectRoot.', inputSchema: { type: 'object', properties: { projectRoot: { type: 'string' }, path: { type: 'string' } }, required: ['projectRoot', 'path'], additionalProperties: false } },
  { name: 'mew_open_panel', description: 'Open a Mew feature screen in the user’s browser.', inputSchema: { type: 'object', properties: { panel: { type: 'string', enum: MEWCAT_PANELS } }, required: ['panel'], additionalProperties: false } },
  { name: 'mew_start_project_session', description: 'Open a separate project work conversation with an initial request. The request is prefilled for the user to review and send.', inputSchema: { type: 'object', properties: { projectRoot: { type: 'string' }, request: { type: 'string' } }, required: ['projectRoot', 'request'], additionalProperties: false } },
] as const
